# v4call Federation — Spec & Status

> **Read CLAUDE.md first.** This document is the federation-specific spec. CLAUDE.md has the project-wide context (architecture, file map, design decisions, .env vars, security posture).

## Status

| Milestone | Version | Status | Notes |
|-----------|---------|--------|-------|
| Hardcoded peers, presence, DM relay, 1:1 call relay | **v0.2** | ✅ Shipped | Original spec scope. Caller's-server-hosts-room model. |
| v4call-server.json domain proof + Hive directory + manual peer approval | **v0.3** | ✅ Shipped | Replaces hardcoded-only with crypto-verified discovery + admin approval. |
| Cross-server rooms (invite + accept/decline + multi-party join + federated token-gate + canonical-form banlist + fed-drop eviction) | **v0.4** (v4call v0.16) | ✅ Shipped | New `room-invite` / `room-response` envelopes + explicit `protocol_version` gate. Cross-server join itself reuses the existing 1:1 federated-call temp-Socket.io transport — no new envelope for the join. |
| Nostr peer discovery + cross-server presence | **(outside WS protocol)** | ✅ Shipped (v4call, 2026-05) | Nostr relays via `kind:30078` — faster discovery than the 2h Hive scan + cross-server presence. Server-side only; Hive-anchored npub↔domain trust. No WS protocol change. See `NOSTR-FED-BUILD-PLAN.md`. |
| **Nostr payload transport** — optional fallback for `dm` + `dm-attachment` when WSS is down/disabled | **(outside WS protocol)** | ✅ Shipped (v4call v0.16.29, proven 2026-06-11) | NIP-44-encrypted `kind:1314` relay events; the recipient dispatches through the SAME `fedHandleMessage` switch via a per-peer pseudo-socket, so rate enforcement + escrow disburse + refunds run unchanged. `NOSTR_FED_TRANSPORT`, default off; WSS-first/Nostr-fallback. Calls + rooms stay WSS-only. **No `protocol_version` bump** — orthogonal to the WS wire format. |

OR-gated rooms + banlist (originally bundled with v0.4 in this doc) shipped earlier as part of single-server **v4call v0.14** — see CLAUDE.md "v0.14 polish".

Three production servers (`call.completenoobs.com` ↔ `hive-book.com` ↔ `v4call.com`) run v0.4 and federate successfully. Cross-server presence, free DMs, paid DMs, voice calls, video calls, cross-server room invites (with accept/decline handshake), and cross-server room joining (multi-party WebRTC, federated token-gating, banlist by canonical form) all work end-to-end over the WSS transport. **Nostr runs as an optional additional layer** (outside the WS protocol): it carries peer discovery + presence, and — as of v4call v0.16.29 — an **optional fallback transport for `dm` + `dm-attachment` when WSS is down/disabled** (proven 2026-06-11, default off). See `NOSTR-FED-BUILD-PLAN.md` + `FED-RECOVERY-NOTES.md` Lesson 12.

## What Was Actually Built (v0.2 + v0.3)

### Architecture decisions confirmed in implementation

- **Option A confirmed**: caller's server hosts the room. Callee's browser opens a temporary cross-server Socket.io connection for WebRTC signalling. Media stays peer-to-peer (browsers connect directly).
- **Model 3 refined**: callee's escrow holds funds; *callee's server* (which holds the active key) does all disbursement. Caller's server is verifier + router only — never touches money.
- **Domain tiebreaker**: when both peers initiate outbound at the same time, only the lexicographically-smaller domain keeps its outbound. The other accepts inbound only ("passive mode"). Both ends use `SERVER_DOMAIN.localeCompare(peerDomain) < 0` so they agree on the surviving connection. This eliminates the flapping bug we hit in early testing.
- **Per-socket Promise queue**: `fedHandleMessage` is async (hello awaits verification). Without serialization, presence messages arriving during hello-verification got silently dropped. The queue chains handlers so messages process in order.
- **v4call-server.json is fail-closed**: peers without a valid signed verify file cannot federate, period. No "warn-but-allow" path.
- **Approval gate on top of verification**: a verified peer still must be in `approvedPeers` (seeded from `FEDERATION_PEERS` env, plus manual `/admin/peers/approve`). Verified-but-unapproved = socket close with `1008 not approved` and a clear log line telling the operator how to approve.

### Federation message protocol (final shape)

Each message is a JSON envelope with a `type` field, sent over the persistent WebSocket to `/federation`.

```json
// Connection establishment — both sides send on connect, both sides verify the other.
// hive_account is announced so the receiver can pin v4call-server.json's signer to it.
// escrow is announced so the receiver can detect rates-post escrow mismatches.
{ "type": "hello", "domain": "v4call.com", "name": "v4call", "version": "0.3",
  "hive_account": "v4call", "escrow": "v4call-escrow" }

// Presence — full snapshot sent right after a successful hello.
{ "type": "presence", "users": [
  { "username": "noblemage", "pubKey": "STM..." }
]}

// Presence deltas
{ "type": "user-online",  "username": "noblemage", "pubKey": "STM..." }
{ "type": "user-offline", "username": "noblemage" }

// DM relay (encrypted ciphertext only). For paid DMs, payment fields are present
// and the recipient's server re-verifies on-chain before disbursing.
{ "type": "dm", "from": "noblemage", "to": "cnoobz",
  "ciphertext": "...", "signature": "...", "timestamp": "...",
  "textPaid": 1.0, "textMemo": "v4call:text:abc", "textCurrency": "CNOOBS",
  "msgId": "msg_xxx", "fromServer": "v4call.com" }

{ "type": "dm-delivered", "from": "...", "to": "...", "msgId": "..." }
{ "type": "dm-failed",    "from": "...", "to": "...", "reason": "..." }

// 1:1 call lifecycle
{ "type": "call-invite",     "caller": "...", "callee": "...", "callType": "voice",
  "roomName": "call_xxx", "callerPubKey": "STM...", "callerServer": "v4call.com",
  "ringFeePaid": 0.001 }
{ "type": "call-response",   "caller": "...", "callee": "...", "accepted": true,  "roomName": "..." }
{ "type": "call-declined",   "caller": "...", "callee": "...", "roomName": "..." }
{ "type": "call-cancelled",  "caller": "...", "callee": "...", "roomName": "..." }
{ "type": "call-missed",     "caller": "...", "callee": "...", "roomName": "..." }

// Cross-server payment lifecycle (v0.3 addition)
// Caller's server forwards a verified payment to the callee's server.
// Callee's server re-verifies on-chain and records in its own activePayments.
{ "type": "payment-verified", "paymentType": "ring|deposit|topup",
  "callId": "...", "from": "...", "to": "...", "amount": 1.0, "currency": "CNOOBS",
  "memo": "...", "ratePerHour": 33, "platformFee": 0.10, "callType": "voice",
  "callerServer": "v4call.com" }

{ "type": "payment-rejected", "callId": "...", "paymentType": "...", "reason": "..." }

// Caller's server signals end-of-call to callee's server, which then disburses.
{ "type": "call-ended", "callId": "...", "durationMs": 65000,
  "endReason": "hangup|cap_reached|credit_exhausted|disconnected", "callerServer": "v4call.com" }

// Callee's server sends back the caller's receipt after disbursement.
{ "type": "call-receipt-fed", "callId": "...", "receipt": { ... } }
```

### v0.4 — protocol_version gate + cross-server rooms (shipped in v4call v0.16)

The `hello` envelope adds an explicit gate field:

```json
{ "type": "hello", "domain": "...", "name": "...", "version": "0.4",
  "protocol_version": "0.4",
  "hive_account": "...", "escrow": "..." }
```

`protocol_version` is the canonical version marker. Older v0.3 peers don't send it; we treat its absence as `< 0.4` and refuse to send v0.4-only message types. The legacy `version` field is kept for backwards compat (no peer reads it).

Two new envelopes carry the cross-server room invite handshake:

```json
// Source (admin's) server → invitee's home server. Generic envelope:
// `payload` is empty in v0.4 / v4call v0.16; v4call v0.17 (Paid Expert Invites)
// will populate it with { connectFee, ratePerHour, currency, maxDuration, ... }
// without needing a separate paid-invite message type.
{ "type": "room-invite",
  "invite_id": "<random hex>",
  "from_user": "noblemage",
  "to_user":   "cnoobz",
  "room_name": "myroom",
  "source_server": "call.completenoobs.com",
  "payload": {} }

// Invitee's home server → source server. Carries accept/decline + optional reason.
// `reason: "offline"` is an automatic decline emitted by the receiving server
// when the target user isn't online to receive the popup.
{ "type": "room-response",
  "invite_id": "<random hex>",
  "response":  "accepted" | "declined",
  "reason":    "offline" | undefined }
```

**Pending invite tracking.** Both sides keep a `pendingFederatedInvites` map keyed by `invite_id`. Outgoing entries on the source server hold `{ room, from_user, target_user, target_server }`; incoming entries on the receiving server hold `{ target_user, from_user, from_server, room }`. A 5-minute sweep prunes anything older than 15 minutes (peer disconnect mid-flow, user never responded).

**Allowlist canonical form.** Federated allowlist entries are stored as `user@server.com` (full form). Local entries remain bare `user`. The room-join check compares both forms so federated joiners' temp Socket.io can resolve correctly. Bare-fallback exists for legacy 1:1 call rooms whose allowlist contains BARE names.

**Backwards compatibility.** A v0.3 peer connecting to a v0.4 server — and vice versa — continues to work for everything they could do at v0.3. The v0.4 server's federated `allowlist-add` checks `peerSupportsV04(server)` first and refuses with a clear error to the inviting admin if the peer hasn't advertised v0.4+.

### Domain proof (v4call-server.json)

Lives at `https://yourdomain.com/.well-known/v4call-server.json`. Generated by `/server-sign.html`. Operator signs with their `SERVER_HIVE_ACCOUNT` posting key (via Keychain or paste).

```json
{
  "claim": "v4call-server-ownership",
  "domain": "hive-book.com",
  "hive_account": "hive-book",
  "escrow": "v4call-escrow",
  "fee_account": "hive-book",
  "federation_ws": "wss://hive-book.com/federation",
  "issued":  "2026-04-24T13:58:44Z",
  "expires": "",
  "nonce":   "84d42e4494c8c2a9",
  "key_type": "posting",
  "signature": "..."
}
```

**Canonical signed payload** (pipe-separated, fixed field order):
```
v4call-server-ownership|domain|hive_account|escrow|fee_account|federation_ws|issued|expires|nonce
```

Verifier reproduces this string, SHA-256s it via `dhive.cryptoUtils.sha256`, fetches the signer's posting pubkey from Hive, and verifies via `dhive.PublicKey.verify(hash, signature)`.

**Verification cache:** 1h positive results, 5min negative results — keyed by domain. Avoids hammering peers on every reconnect.

**Expiry policy:** optional. Default no expiry. Operators rotate by re-signing with a new nonce when config changes (or on key rotation). The signed file gets replaced on the domain — old caches naturally expire.

### Hive directory (announce post)

Generated by `/server-announce.html`. Posts a `v4call-server` tagged Hive post from the operator's `SERVER_HIVE_ACCOUNT`. Title: `v4call-server`. Permlink: `v4call-server-{unix-ts}` (timestamped so re-posting doesn't require an edit).

Body contains a machine-readable block:
```
[V4CALL-SERVER-V1]
DOMAIN: hive-book.com
HIVE-ACCOUNT: hive-book
ESCROW: v4call-escrow
FEE-ACCOUNT: hive-book
FEDERATION-WS: wss://hive-book.com/federation
VERIFY-URL: https://hive-book.com/.well-known/v4call-server.json
SOFTWARE: v4call
PROTOCOL: 0.3
DECLARED: 2026-04-24T14:00:00Z
[/V4CALL-SERVER-V1]
```

### Discovery scanner

Runs 5s after startup, then every 2h. Calls `condenser_api.get_discussions_by_created` with `tag: "v4call-server"`. Keeps the most-recent post per author (filters strays). For each, parses the V4CALL-SERVER-V1 block, cross-checks `hive_account` matches the post author, runs `verifyPeer()`, populates `discoveredPeers`.

**Important:** discovery does NOT auto-connect. It populates a candidate list. Operator approves via `POST /admin/peers/approve?domain=X` (or the `admin-peers.html` UI button).

### Approval persistence

Approved peer domains live in `data/logs/approved-peers.json`:
```json
["call.completenoobs.com", "hive-book.com"]
```

Loaded on startup, merged with `FEDERATION_PEERS` env (env entries are auto-approved). Mutations via `/admin/peers/approve` and `/admin/peers/revoke` rewrite the file.

### Cross-server money flow (paid call, federated)

```
1. Caller's client pays callee's escrow on Hive (Keychain → callee's server's escrow account)
2. Caller's server verifies the on-chain transfer (read-only, against the right escrow)
3. Caller's server → fed `payment-verified` → callee's server
4. Callee's server re-verifies on-chain (trust-but-verify) and records in its activePayments
5. Call happens; caller's server runs the credit-burn timer + cap timer
6. Call ends → caller's server runs processCallEnd → sees `room.federated` → fed `call-ended`
   to callee's server. No local disbursement.
7. Callee's server runs processFederatedCallEnd:
   • callee-net  → local callee  (own escrow → on-chain transfer)
   • platform-fee → own SERVER_HIVE_ACCOUNT (own escrow)
   • refund      → remote caller (cross-server Hive transfer from own escrow)
8. Callee's server → fed `call-receipt-fed` → caller's server → emits `call-receipt`
   to caller's client
```

### What does NOT change vs. single-server (still true)

- **Encryption** — messages are encrypted client-side with Hive posting keys. Server never sees plaintext. Federation just relays ciphertext.
- **Token payments** — token balance checks go to Hive-Engine API. Payment picker works the same.
- **Chat storage** — each server stores its own users' copies. Sender's copy on sender's server, recipient's copy on recipient's server.
- **Rate checking** — rates are fetched from Hive by username. Works regardless of which server the user is on.

## Known Issues (under v0.12 fix scope)

### Discovery scanner returns 0 peers despite Hive having posts

**Confirmed reproducible.** From the logs on both production servers:
```
[discovery] Scanning Hive tag "v4call-server" for federation peers…
[hive] Node https://anyx.io failed: Unexpected token 'B', "Bad Gateway
[hive] Node https://hived.emre.sh failed: fetch failed — trying next
[discovery] No response from Hive tag query
```

Only 2 of the 4 configured Hive nodes log failures. The other 2 (`api.hive.blog` and `api.deathwing.me`) silently return responses without a `result` field — `hivePost` skips them quietly because the only logging is in the `catch` branch. The user did manually `curl` `api.hive.blog` from outside and it worked, so the issue is specific to the in-container request OR a transient outage on those specific endpoints.

**Fix scope (v0.12):**
- Add logging to `hivePost` for the silent-skip case (response received but no `result` field — log the error body)
- Refresh the `HIVE_API_NODES` fallback list — current candidates `api.openhive.network`, `rpc.mahdiyari.info`, `techcoderx.com` are more reliable than `anyx.io` / `hived.emre.sh`
- Add a manual test from inside the container as part of the diagnostic step

### DM preview duplication

Same DM appears 2–5 times in the lobby chat after multiple browser reconnects. Theory: client `dm-previews` handler appends without dedup, and every `socket.on('connect')` re-emits `lobby-join` which re-sends previews. **Fix scope (v0.12):** client-side dedup before appending.

### `text-payment-received` showing on sender's screen

The "💰 paid you N CNOOBS" notification appears on the sender's lobby chat as well as the recipient's. Should only be the recipient's. **Fix scope (v0.12):** investigate the emit destination + the client render path.

## Files Modified (v0.2 + v0.3)

| File | Notes |
|------|-------|
| `server.js` | Federation WebSocket server, peer client, message protocol, verifyPeer, scanV4CallDirectory, parseV4CallServerPost, peer admin endpoints |
| `public/index.html` | Server badge in lobby user list, cross-server Socket.io for federated rooms, federated-call-ended handler |
| `public/server-sign.html` | New — generates signed v4call-server.json |
| `public/server-announce.html` | New — publishes v4call-server Hive post via Keychain `requestPost` |
| `public/admin-peers.html` | New — peer admin UI (list / approve / revoke / rescan) |
| `public/.well-known/v4call-server.json` | New — placeholder; each operator overwrites with own signed file |
| `nginx/v4call.conf` | `/federation` location block (no auth) |
| `.env.example` | `FEDERATION_PEERS` variable |
| `package.json` | `ws` dependency |
| `WalkThrough.wiki` | Step 17 (federation setup) added; nginx step updated; admin endpoints listed; common federation problems documented |

---

# v0.4 — Federated Rooms (✅ Shipped in v4call v0.16)

OR-gated rooms + banlist (originally bundled with v0.4 in this doc) shipped earlier as part of single-server **v4call v0.14** — see CLAUDE.md "v0.14 polish". The federation-only piece (cross-server room invites + cross-server room join) is in v4call v0.16.

## v0.4 Design (as built)

### Federated rooms

Same model as 1:1 federated calls, scaled to N participants:

- **Room hosting**: caller's server still hosts the room state (membership, message bus, allowlist, banlist). Single-server-of-truth per room.
- **Federated invitees**: when noblemage on call.completenoobs.com creates a room and invites cnoobz on hive-book.com, the invite goes via federation `room-invite` message (new). cnoobz's home server delivers the popup, cnoobz accepts, her browser opens a temporary cross-server Socket.io to call.completenoobs.com and joins the room there.
- **Federated leave**: when cnoobz leaves the room, her temporary socket disconnects from call.completenoobs.com and her client sends `federated-room-ended` to her home server (matches the existing `federated-call-ended` pattern).
- **Token-gate across federation**: if the room requires N CNOOBS tokens, the host server checks cnoobz's Hive-Engine balance regardless of which server she's on (chain-side check, peer-agnostic).

New federation message types (as shipped):
- `room-invite` — source server → invitee's home server. Generic envelope `{ invite_id, from_user, to_user, room_name, source_server, payload: {} }`. Empty `payload` is the v0.17 hook (Paid Expert Invites populate it without needing a separate message type).
- `room-response` — invitee's home server → source server. `{ invite_id, response: 'accepted' | 'declined', reason? }`. `reason: 'offline'` is an automatic decline emitted when the target user isn't online.
- (Originally planned `room-cancelled` and `room-ended` envelopes were not needed — the temp Socket.io's existing `kicked` events propagate end-room / ban / fed-drop cases without a federation-side envelope.)

### OR-gated room joining

Room creation gets two optional gates that combine as OR:

1. **Allowlist** (existing) — admin invites specific users by name.
2. **Token gate** (new) — admin specifies `min_token_balance: { symbol: "CNOOBS", amount: 33 }`. Anyone holding ≥ 33 CNOOBS can join freely.

Server-side check on `join` event:
```
allowed = allowlist.has(user) OR (gate is set AND user's balance ≥ gate amount)
allowed = allowed AND NOT banned.has(user)   // ban always wins
```

Token-gate joiners get a "via TOKEN" badge in the room user list to distinguish from allowlisted users.

### Live-appendable banlist

Per-room set of banned usernames. Admin can mutate live:

- Admin clicks 🚫 button on any in-room user, or types `/ban @username` → server adds to banlist
- Banned overrides allowlist + token gate
- If banned user is currently in the room, server emits `kicked` to them with reason "banned by admin"
- Banlist is ephemeral with the room (dies when last person leaves, like room state)

**Visibility toggle (admin-set at room creation)**: `banlist_public: bool`
- `false` (default) — only admin sees the banlist; non-admin members just see banned users vanish
- `true` — all members see the banlist (sometimes transparency wins)

### Admin role delegation

Existing admin (room creator) can transfer the admin role to another participant. Old admin loses ban/promote/kick powers; new admin gains them. One admin per room at a time. (Bundle with v0.15 spotlight UI work.)

## v0.4 Shipped Scope (v4call v0.16)

The OR-gated rooms / banlist / banlist visibility-toggle pieces shipped earlier in single-server **v4call v0.14** (`tokenGate` at room creation, `joinedVia: 'token'` tag, `room-ban` / `room-unban`, `banlistVisibility: 'admin' | 'all'` per-recipient `room-info`). The federation-only pieces shipped in **v4call v0.16**:

- **Federation envelopes** — `room-invite` (generic `payload: {}` for v0.17 forward-compat) + `room-response`. Source-server validation on incoming envelopes prevents spoofed source identity. Pending-invite TTL sweep (15 min).
- **`protocol_version: '0.4'` hello gate** — v0.3 peers continue to federate fully for DMs / 1:1 calls / presence / payments; only cross-server room invites + cross-server room joins require v0.4.
- **Federated allowlist input** — `parseFederatedHandle()` accepts `@user@server.com`. Approved + connected + v0.4+ peer required, else clear `allowlist-error` to the admin.
- **`room-create` resolves federated invitees** — three-priority resolution: explicit `user@server`, local lobby user, or bare username + `peerForUser()` fallback.
- **Cross-server room join** — joiner's browser opens temp Socket.io to host server, `homeServer` field in `join` payload matches canonical allowlist entry. Reuses the existing 1:1 federated-call temp-Socket.io transport. No new envelope for the join itself.
- **`homeServer` threaded through every room-state payload** — `room-users`, `room-users-resync`, `user-joined`. Federated badge in user-list + on video tile labels.
- **Banlist + allowlist-remove auto-kick** — recognises canonical `user@server` form. Bare-fallback for legacy 1:1 call rooms.
- **Member dedup uses canonical key** — local + federated same-username members can coexist.
- **Federation peer drop → immediate eviction** (`cleanupFederatedMembersForPeer`). Temp-socket drop gates on `'io server disconnect'` only — transient blips let Socket.io reconnect.
- **No `room-ended` envelope** — initially planned, turned out unnecessary. The temp Socket.io is direct (independent of the federation socket), so existing `kicked` events propagate through it for end-room / ban / fed-drop cases. Home server has no `inRoom` state for federated rooms.
- **XSS hygiene pass** — `data-action` event delegation replaces dynamic inline onclicks across rooms / allowlist / banlist / lobby user-list. New `escapeHtml` helper for remaining innerHTML insertions.

Server-side: ~230 lines added across the v0.16 cycle. Client-side: ~150 lines. No new dependencies, no schema changes, no new federation envelopes (just the new `payload` field shape + `protocol_version` field in hello).

## v0.4 Testing Checklist (Shipped)

- [x] Inviting `@user@peer.com` from the allowlist panel sends `room-invite` over federation; popup on the receiving server shows the source-server badge
- [x] Accept → `room-response: accepted` reaches source server; joiner's browser opens temp Socket.io and joins the host server's room with the federated badge
- [x] Decline → `room-response: declined` reaches source server, silent on the inviter side (matches local-invite decline)
- [x] Offline target → receiving server auto-replies `declined, reason: 'offline'`, source server surfaces this to the admin
- [x] v0.3 peer rejection: admin gets "needs v0.4" error before any wire send when target server is on older protocol
- [x] Pending invites prune after 15 minutes (TTL sweep)
- [x] Backwards compat: a v0.3 peer can still federate, do DMs, do 1:1 calls — they just can't be invited to rooms
- [x] Federated invitee can leave cleanly (`leaveRoom` → `closeFederatedRoomSocket` → home-server cleanup)
- [x] Token gate works for federated joiner (balance check uses bare username; chain-side, peer-agnostic). "via TOKEN" badge shows on federated token-gate joiners
- [x] Admin can ban federated user — auto-kick honours canonical `user@server` form
- [x] Multiple federated users from different servers can coexist in the same room (member dedup uses canonical key)
- [x] Spotlight broadcast (v0.15) propagates to federated members (existing socketId-driven, peer-agnostic)
- [x] Federation peer drop → host immediately evicts that peer's federated members. Temp Socket.io drop → transient drops auto-reconnect; `'io server disconnect'` triggers "Lost connection to host" + clean leave-room

---

## Resources

- **Project context:** `CLAUDE.md`
- **Operator deploy guide:** `WalkThrough.wiki` (also at https://completenoobs.com/index.php/V4call)
- **GitHub:** https://github.com/CompleteNoobs/v4call
- **Hive API docs:** https://developers.hive.io
- **Hive Keychain:** https://hive-keychain.com
