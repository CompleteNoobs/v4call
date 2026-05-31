# IPFS-Gate Room Attachments over WSS Federation — Research Notes
**Date:** 2026-05-28 (analysis performed this session)  
**Status:** Pure research — no code changes or diffs produced.  
**Source files examined:** `server.js` (attachment handlers + federation switch + room membership), `public/index.html` (client send path + rsock + FEDERATED_ROOM_EVENTS), design docs + prior grok/ analysis.

**Goal:** Answer the 5 questions from the 2026-05-28 grok-briefing.md so the implementation quest (owned by Claude) has a solid foundation.

---

## 1. What is the current federation envelope / handling for room attachments?

**Short answer:** There is **none**.

### Server-side (host of the room)
- `socket.on('room-attachment', (env) => { ... })` exists (lines ~4771-4814 in server.js).
- It performs basic validation (sender is in the room's current members, envelope shape, etc.).
- Then:
  ```js
  io.to(room).emit('room-attachment', env);
  chatStoreRoomAttachment(env);
  ```
- It then attempts "away notifications":
  ```js
  for (const recip of Object.keys(env.per_recipient || {})) {
    if (liveMembers.has(recip)) continue;
    ...
    io.to(lu.socketId).emit('attachment-notification', { room, sender, cid });
  }
  ```
- **Critical comment in the code (lines 4794-4796):**
  > "Federated recipients (hosted on a peer server) are skipped here — cross-server attachment notify is a v0.3+ federation extension."

- There is **no** `case 'room-attachment':` (or similar) anywhere in the `fedHandleMessage` switch.
- No `fedSend` of room-attachment envelopes.
- No `room-attachment-failed` back-channel (unlike DM attachments).

### Client-side
- Room attachments are sent via `rsock().emit('room-attachment', envelope)` (line ~4294).
- `rsock()` returns `activeRoomSocket` (the direct temp connection to the foreign room host) when in a federated room, otherwise the main lobby socket.
- The receive handler is registered on the **main** socket:
  ```js
  socket.on('room-attachment', (env) => { addAttachmentBubble(env); });
  ```
- `attachment-notification` is also listened on the main socket.

### Conclusion for Q1
Room attachments are purely **local to the room host** today. They were added in the v0.16 era alongside the rest of the ipfs-gate integration, before (or without) the cross-server delivery path that DM attachments received in v0.16.18.

---

## 2. What's the parallel DM-attachment design that we should mirror?

The DM-attachment federation path (v0.16.18) is the **canonical example** of "additive paid envelope over federation" and follows design rule #15 perfectly.

### Client → Server (sender's home)
- `socket.emit('dm-attachment', { ...envelope, msgId, textPaid, textMemo, textCurrency })`
- Server resolves `federatedTo = peerForUser(to)`
- If local: normal delivery + payout on this server.
- If federated:
  - Do rate/payment validation up to the point of "we know this needs to go to the peer".
  - Strip payment fields for the wire envelope.
  - `fedSend(federatedTo.ws, { type: 'dm-attachment', from, to, envelope: wireEnv, msgId, textPaid, textMemo, textCurrency, fromServer })`
  - Echo the envelope back to the local sender immediately for UI.

### Federation receive side (`case 'dm-attachment':` ~5821)
- Re-verify payment on-chain to **our** escrow (recipient's home server is the treasurer).
- Re-run `computePaymentOptions` + full recipient-side policy (block list, fee min, rate match) — **never trust the source server**.
- On any failure: auto-refund from our escrow + send back `dm-attachment-failed`.
- On success: disburse (net to recipient, fee to platform), persist, and `io.to(recipient.socketId).emit('dm-attachment', envelope)`.
- Also handles the free (no payment) path cleanly.

### Back-channel
- `dm-attachment-failed` → surfaces error on the original sender's side.

### Key architectural points
- Caller server = verifier + router only.
- Recipient's home server = sole policy enforcer + treasurer.
- The encrypted envelope itself is opaque and forwarded verbatim.
- Payment fields are server-to-server routing metadata.

**For room attachments the situation is different** (see Q3), so we should **not** blindly copy the full DM machinery.

---

## 3. What's the room-membership model for federated rooms?

This is the most important mental model difference vs DMs.

### How a federated user ends up in a room
1. Admin on host server (or via allowlist) invites `@user@peer.com`.
2. `room-invite` envelope goes over federation to the target's home server.
3. Target accepts → their browser opens a **temporary direct Socket.io connection** to the room host (`openFederatedRoomSocket(serverDomain)`).
4. They emit `join` on that temp socket, including `homeServer: theirDomain`.
5. Host server stores in `rooms[room].members`:
   ```js
   { socketId: theTempSocket.id, username, pubKey, joinedVia, homeServer: 'peer.com' }
   ```
6. The temp socket also does `socket.join(room)` (Socket.io room) on the host.

### Key properties
- The **room host server is the single source of truth** for room state (members, messages, attachments, spotlight, etc.).
- Federated members' **live presence in the room** is represented by active temp sockets **directly to the host** — not proxied through their home server's federation WS.
- When the federation WS between home and host drops, `cleanupFederatedMembersForPeer(domain)` runs on the host and evicts those members (sends `kicked` via the still-living temp socket).
- History replay (`room-history`, `room-attachments-history`) is sent by the host over the temp socket at join time.

### Implications for attachments
- **Live in-room delivery** (`io.to(room).emit('room-attachment', env)`) should already reach federated members because:
  - They are in the Socket.io `room` channel.
  - Their temp socket is active and listening.
- The sender (if federated) emits directly on their temp socket (`rsock()`) → arrives at the host's `room-attachment` handler → gets broadcast back out the same way.
- The sender's **home server never sees the 'room-attachment' event** at all (unlike DMs).

This is why the problem statement is narrower than "DM attachments don't work."

---

## 4. Concrete gaps identified (why room attachments don't cross federation today)

### Gap A — Event forwarding on the client temp socket (high probability root cause)
In `public/index.html`:

```js
const FEDERATED_ROOM_EVENTS = [
  'offer', 'answer', 'ice-candidate',
  'user-joined', 'user-left',
  'room-users', 'room-users-resync',
  'room-info', 'room-history',
  'chat-message',
  ... (many call events)
  // NO 'room-attachment'
  // NO 'attachment-notification'
  // NO 'room-attachments-history' ? (history is sent at join time, may work)
];
```

The forwarding loop only wires these events from `activeRoomSocket` → main `socket` listeners.

When a `room-attachment` envelope arrives on the temp socket (either as the sender's echo or as a broadcast from another member), the client's `socket.on('room-attachment', ...)` never fires.

Same for `attachment-notification`.

**This alone would make room attachments appear completely broken for federated room participants.**

### Gap B — Away-notification path explicitly skips federated users (server)
See comment in the `room-attachment` handler (already quoted in Q1).

The code that does:
```js
const liveMembers = new Set(...);
for (const recip ...) {
  if (liveMembers.has(recip)) continue;
  ... emit 'attachment-notification'
}
```
Has no concept of "this recipient lives on a peer server — I need to tell their home server to notify them."

Even if we fixed Gap A, users who are online on their home server but not currently inside the room tab would never get the red dot / system message.

### Gap C — No cross-server "someone in a room I'm a member of sent an attachment" signaling
For a federated user who is **not** currently connected to the room (in another tab or on their home lobby), their home server has no idea an attachment happened in a room they belong to.

DM attachments solve this because the home server is the delivery point.

For rooms, the home server would need some new federation envelope (or piggyback on existing presence) if we want that UX.

### Gap D — Sender home server visibility
When a federated user sends a room attachment, their home server learns nothing. This might affect:
- Any future "my recent activity" UI
- Audit / ledger entries on the sender's home server
- (Probably minor for v1)

### Gap E — History replay edge cases
`room-attachments-history` is sent by the host at join time over the temp socket. It is not in the forwarding list, but because it happens during the explicit join flow it may still work. Worth verifying.

---

## 5. Federation protocol_version implications

**Recommendation: No protocol_version bump required (v0.4 remains sufficient).**

Reasons:
- Per the existing design (FED-RECOVERY-NOTES.md Lesson 8 and NOSTR-FED-BUILD-PLAN): additive message types are **silently dropped** by older peers. This is accepted behavior.
- A new `room-attachment` federation envelope (if we even need one — see below) would only be used for the away-notification / cross-server signaling path.
- Live room delivery does **not** require any new federation envelope at all (direct temp sockets).
- Mixed-version mesh would mean: un-upgraded peers simply don't get away-notifications for room attachments in rooms with federated members. Degraded UX, not a crash or security issue.
- The v0.4 gate is reserved for structural changes that would break older peers (the room-invite handshake itself).

If we later decide we need reliable cross-server room-attachment *signaling* (not just live delivery), we can introduce a new envelope type `room-attachment-notify` (or similar) as a pure additive v0.4+ feature. Older peers ignore it.

Document this clearly in any rollout notes.

---

## 6. Future file formats (mp3, mp4, pdf, txt, tar/zip, etc.)

Captured from the briefing + code observations for the follow-on work.

### Current constraints (ipfs-gate side)
- v0.1 of the gate **only accepts `image/jpeg`**.
- This must be relaxed on the gate **before** v4call can usefully upload other types.
- The gate returns cost + accepts the reserve/upload flow per content type.

### v4call encryption layer
- Content-agnostic: AES-GCM over the raw bytes + a small `header JSON` (filename, mime).
- The `kind_hint` field in the envelope currently hardcodes `'image'`.
- `per_recipient` wrapping is the same regardless of content.

### Client rendering implications (future work)
- **mp3 / audio**: Browser can do `new Audio()` + `Blob` from decrypted bytes → `createObjectURL`. Range requests on encrypted blobs are painful — simplest first cut is full download before playback.
- **mp4 / video**: Same as above + `<video>` element. Autoplay + controls work once the blob URL exists.
- **PDF**: `blob:...#toolbar=0` inside an `<iframe>` works in modern browsers; graceful fallback to download.
- **txt / markdown / code**: Easy — render as `<pre>` or with a lightweight viewer. Size limits will matter.
- **tar / zip / archives**: Download only for v1. A "peek inside" preview (list of top-level entries) is possible client-side with JS unzip libraries but adds weight and complexity. Defer unless there's strong demand.
- **General**: The existing attachment bubble UI will need a `mime` / `kind` switch. Thumbnail generation for non-images will be harder (or skipped).

### Other notes worth capturing now
- Expiration still applies (the gate will stop serving after `expires_at`).
- The client already tolerates 404s on expired pins gracefully.
- Paid flow for rooms (if ever added) would be different from DMs — probably room pot / split / creator pays, etc. Not in scope for the basic federation relay work.

**Recommendation:** Create `grok/file-types-future-notes.md` as a living scratchpad before the actual implementation starts.

---

## 7. Minimal viable design sketch (for Claude / implementation)

**Hypothesis (to be validated):**

1. **Live delivery** for people *in the room* probably already works once `room-attachment` + `attachment-notification` + `room-attachments-history` are added to `FEDERATED_ROOM_EVENTS` on the client (and the server emits them on the temp sockets, which it already does via `io.to(room)` and direct `socket.emit` on the temp socket).

2. The **real new work** is the away-notification path for federated room members:
   - When the host processes a `room-attachment`, it needs to identify which addressed recipients have `homeServer` set.
   - For each such recipient, send a lightweight federation message to their home server: "user X sent an attachment in room Y (cid Z)".
   - Home server delivers `attachment-notification` to the local socket (or stores it for next login).

3. We may or may not need a full `room-attachment` envelope over federation — the away-notification can probably be a tiny `room-attachment-notify` envelope containing only the minimal fields the home server needs to surface the dot + system message.

4. Sender-side history on the federated sender's home server is a secondary/nice-to-have.

5. Protocol version: additive, no bump.

This is dramatically lighter than the DM-attachment machinery because of the direct temp-socket room model.

---

## 8. Open questions / things to verify before implementation

- Confirm whether `room-attachments-history` currently reaches federated joiners (it is sent over the temp socket at join time).
- Does the client ever listen for `room-attachment` on `activeRoomSocket` directly in some code path, or is it 100% reliant on the forwarding list?
- Are there any rate-limiting or spam protections on room-attachment that would interact badly with federated senders?
- Exact shape of the minimal notify envelope we would introduce (if any).
- Whether the room host should also persist "I notified these federated homes" or just fire-and-forget (home server can always replay history on next join anyway).

---

**End of research notes.**

Ready for Claude / user to review. If green light is given for implementation, I can produce minimal, reviewable diffs inside `grok/grok-diff/`.

All analysis performed strictly inside the allowed `grok/` boundary.