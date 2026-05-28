# Briefing for Grok — 2026-05-28 hand-off

> Author: Claude (lead dev, has direct repo write access).
> Audience: Grok (second mind, support role; can ONLY write to `grok/` and
> emit `.diff` files for code suggestions).
> User: noob (the project owner, tinkerer, prefers 2–3 sentence advice +
> tradeoff before any build).

The user prompts you with this file when they want you up to speed quickly.
Read this top to bottom before any task that involves federation or the
upcoming ipfs-room-attachment work.

---

## 1. What just happened (this session)

### Quest: "fix the fed (WSS + Nostr)"

**Symptom that started it.** User reported: "Fed was working before we did
ipfs-gate sharing. Comms problem — dev thought I was using WSS, when WSS
fed was disabled because I was testing and very happy with the Nostr fed.
Stayed on it and forgot about WSS."

**Initial discovery (your work, from the grok/ analysis).** You had
already produced the full federation deep-dive in this directory —
notably the warning that Nostr Phase D presence makes federated users
visible in the lobby even when WS fed is dead. That was a perfect lead.

**Real root cause found.** On each of the three production servers, the
`.env` had **two `FEDERATION_PEERS=` lines** instead of one comma-separated
line. dotenv is last-wins, so only one URL per server was effective.
Domain tiebreaker (call.completenoobs.com < hive-book.com < v4call.com)
combined with the surviving URL on each server made the **call ↔ hive-book
link have no WSS path in either direction**. cnoobz@hive-book.com flickered
in and out of call.completenoobs.com's lobby because Nostr presence was
the only signal keeping them visible, and the 30s heartbeat / 5min TTL
made the flicker exact.

**Fix applied to the repo** (no SSH actions; the .env fix is the user's
responsibility on each server):

1. `.env.example` — federation block rewritten with explicit MUST-BE-ONE-LINE
   warning and three-server worked examples.
2. `server.js` — boot-time scan that reads raw `.env`, warns on every
   duplicate key. Pure additive logging, zero behaviour change. Logs:
   `[config] ⚠ multiple FEDERATION_PEERS lines in .env (N).` with a hint
   about comma-separated form for known list-valued keys.
3. `server.js` `call-user` handler (~line 3497) — distinguishes "truly
   offline" from "visible via Nostr but no WS transport" using existing
   `nostrSeenDomain()` helper. Reuses existing refund branch — funds were
   already safe; only the error message is now accurate.
4. `public/index.html` `initiateCall` — calls existing `dmPrecheck(callee)`
   before the rate fetch and before any Keychain prompt. Reuses generic
   recipient-routing socket event; renaming `dm-precheck` to something
   non-DM-specific is a separate cleanup that needs coordinated rollout.
5. `FED-RECOVERY-NOTES.md` Lesson 11 — full forensics of the dup-line
   bug + the "WSS-disable-during-Nostr-test trap" meta-lesson.
6. `CLAUDE.md` Known Gotchas — new gotcha at the top of the list.
7. `grok/KNOWN-ISSUES-AND-RISKS.txt` — item 1 marked CLOSED v0.16.19, new
   item 1B opened for the verification-timeout flap (see section 3 below).

**Status confirmed by user 2026-05-28:** After fixing the `.env` files on
all three servers, lobby presence is healthy, ipfs-gate DMs work, no user
drop-offs during testing. **WSS federation core is back up.**

---

## 2. The current quest (still open)

### Active production symptom: v4call.com verification flap — CLOSED later same session (2026-05-28)

Diagnostic from user showed network is healthy: container wget and host
curl to both peer well-known files return in ~70ms each. So the 8-second
AbortSignal in `_fetchPeerVerifyFile` was timing out on a 70ms round-trip
— telling us the cause is **event-loop pressure on the Node process**, not
the network. v4call.com gets hit hardest because it's the lex-largest
domain → the only passive node → both other peers retry inbound to it
every 2s.

**Fix applied in v0.16.19, same session:**

- `_fetchPeerVerifyFile` timeout 8s → 15s (more forgiving budget against
  transient event-loop blocking).
- Split `PEER_VERIFY_TTL_FAIL` (single 5min constant) into:
    - `PEER_VERIFY_TTL_STRUCTURAL` = 5min (kept) for bad-signature /
      wrong-claim / domain-mismatch / expired / missing-pubkey — these
      can't change without operator action.
    - `PEER_VERIFY_TTL_TRANSIENT` = 30s (new) for fetch timeouts,
      network errors, HTTP 5xx, Hive RPC hiccups.
- `peerVerifyCache` entries now carry a `transient` flag. `fail()` takes
  a second arg `transient = false` and every call-site passes it
  explicitly. `_fetchPeerVerifyFile` tags HTTP 5xx as transient via
  `err._transient`; 4xx (peer-mis-served) is structural.
- This breaks the cascade. A transient failure now self-clears in 30s,
  not 5 minutes.

**Deploy notes:** server.js changed → full rebuild needed:
`docker compose down && docker compose build --no-cache && docker compose up -d`.
The restart also clears the in-process verify cache, so the fix takes
effect immediately. Watch for `[federation] ✗ Peer verification failed`
in logs — should now appear at most every 30s during a genuine transient
window, not every 2s.

Full forensics in `KNOWN-ISSUES-AND-RISKS.txt` item 1B.

---

### Original analysis (kept for context — superseded by the fix above)

After the user fixed the dup-line bug, a NEW production symptom showed up
in the logs — affecting only pairs involving v4call.com:

```
[federation] Inbound peer connection — waiting for hello
[federation] ✗ Peer verification failed for hive-book.com:
    Cannot fetch v4call-server.json: The operation was aborted due to timeout
```

Repeated every ~2 seconds. The other two servers see "Outbound connected"
+ "Disconnected — retry in 2s" + then "✓ Peer verified" arriving AFTER
the disconnect log (because their own verifyPeer was running in parallel
and completes after v4call.com closes the socket).

**My (Claude's) analysis:** Two compounding factors in `server.js`:

- `_fetchPeerVerifyFile` uses `AbortSignal.timeout(8000)` — 8 seconds for
  DNS + TCP + TLS + HTTP combined. Tight budget.
- `PEER_VERIFY_TTL_FAIL = 5 * 60 * 1000` — one timeout locks the peer as
  "verified=false" for 300 seconds. Reconnects every 2s during that window
  all hit the cached failure → instant close → bounce.

**Diagnostic in flight.** I gave the user a curl/wget block to run from
v4call.com (container + host) to distinguish:
- code-level cause (8s too aggressive, network is actually fast)
- container DNS / egress problem
- real host-level network problem (firewall, IPv6 dead-end)

Until that output arrives, no code change goes in. The fix candidates are
all sketched in `KNOWN-ISSUES-AND-RISKS.txt` item 1B with risk
notes — A (bump timeout), B (split cache TTL by error category),
C (force IPv4, only if diagnostic shows it), D (admin endpoint to flush
one domain's verify cache).

### How you can help on THIS open item

If you want to investigate further before the user's diagnostic returns:

1. Re-read `verifyPeer()` and `_fetchPeerVerifyFile()` in `server.js`
   (around line 5193–5280). Look for any layer between fetch and the
   verifyPeerCache that could be misclassifying transient failures.
2. Think about whether the verify cache should also key on the failure
   REASON, not just verified=false, so a "fetch timeout" cache entry
   could be invalidated by a "fetch succeeds" attempt without waiting
   for TTL.
3. **Optionally** sketch a `.diff` for the A+B combined fix and drop it
   here as `grok/grok-diff/verify-timeout-and-cache.diff`. I (Claude)
   will review before applying. Keep the diff minimal — touching only
   `_fetchPeerVerifyFile`, `verifyPeer`, and the cache TTL constants.
4. Note any test ideas in `grok/grok-tests-to-run.md` if you want to add
   one — Claude or the user runs them, you only write to `grok/`.

---

## 3. The NEXT quest (queued, not started)

### IPFS-gate room attachments over WSS federation

User reports: **ipfs-gate DMs work great over WSS. ipfs-gate ROOM
attachments do NOT work over WSS.** (May have been working over Nostr —
user can't recall which fed was active during the previous "it works" test.)

Open questions for you to research and dump findings into
`grok/ipfs-room-wss-research.md`:

1. **What is the federation envelope for room attachments today?**
   Check `server.js` for `room-attachment` socket handler and any
   federation case that handles it cross-server. There is likely NO
   `case 'room-attachment'` in the federation switch — that would
   explain why it works locally (Socket.io broadcast to room) but not
   cross-server.

2. **What's the parallel DM-attachment design?** Look for
   `case 'dm-attachment':` in `server.js` federation handler. v0.16.18
   added it. The room-attachment equivalent should follow the same
   pattern: forward the encrypted envelope (CID, per-recipient AES key
   wraps, signature, etc.) to the host server of any federated room
   member, who then delivers via local broadcast.

3. **What's the room-membership model for federated rooms?**
   Per v0.16, cross-server room joins happen via direct browser → host
   server Socket.io (not via federation). So the host server already
   has every federated member's socket in `rooms[roomName].members`.
   That means: as long as the host server handles `room-attachment`
   correctly and broadcasts to the room socket.id list, federated
   members already receive it via their own temp Socket.io. Maybe the
   only gap is the away-notification (the `attachment-notification`
   event for users online but not in the room) which IS a local
   socket emit and doesn't reach federated users.

4. **Future fileformats — mp3 with browser playback, mp4, pdf, txt,
   tar/zip.** User explicitly asked us to capture data NOW that will
   help when these land. The relevant facts:
   - The ipfs-gate side (separate repo) currently rejects everything
     except `image/jpeg` in v0.1. That MUST change first or v4call
     uploads of other types will fail at the gate.
   - v4call's encryption is content-agnostic (AES-GCM over the raw
     bytes + a `header JSON` carrying filename and mime). Browser
     playback would need a Blob → object URL → `<audio>` / `<video>`
     element. Range requests on encrypted blobs are tricky — full
     download before playback is the simplest first cut.
   - PDF preview: native `<iframe src="blob:...#toolbar=0">` works
     in modern browsers; falls back to download.
   - tar/zip: download only; no browser native unpack. Add a "what's
     inside" preview only if there's demand.
   - Capture all of this in `grok/file-types-future-notes.md` so
     when the user gets to that work, the trade-offs are already
     written down.

5. **Federation protocol_version question.** Does adding a new
   `room-attachment` federation envelope type need a protocol_version
   bump (v0.4 → v0.5)? Per recovery notes: additive message types
   are silently dropped by older peers — no bump needed for additive
   changes, only for structural ones. But mixed-version mesh means
   un-upgraded peers won't relay room attachments → degraded
   functionality, not crash. Worth noting in any rollout plan.

You can produce one or more research notes in `grok/` covering these.
Don't produce a `.diff` for the actual implementation yet — Claude will
own the implementation once user green-lights.

---

## 4. Rules of engagement (so we don't break code again)

This is how the user wants us to collaborate:

| Role | Allowed | Not allowed |
|---|---|---|
| Claude (lead dev) | Direct edits to anything in the repo. Updates files in `grok/` to keep you informed. Runs commands (read-only investigation freely; write-actions with user confirmation). | Pushing to production servers via SSH. |
| Grok (support) | Writes ONLY to `grok/` (including `grok/grok-diff/` for suggested code diffs). Reads anything. Produces research notes, suggested diffs, test ideas. | Editing files outside `grok/`. Past results showed Grok broke code when editing directly — that's why this rule exists. |
| Claude reviews Grok's diffs before applying. | If a Grok diff is wrong, leave a note in `grok/diff-review.md` explaining why so the next round improves. | — |

**Communication channels:**

- `grok/grok-briefing.md` (this file) — current state of the world.
  Claude updates whenever a quest transitions. Grok reads on prompt-in.
- `grok/KNOWN-ISSUES-AND-RISKS.txt` — living issue list. Both parties
  can append; Grok marks suggestions, Claude marks closures.
- `grok/grok-diff/*.diff` — Grok's suggested code changes. Claude
  reviews and either applies or leaves a `*.review.md` note.
- `grok/*.md` — Grok's research notes (e.g. `ipfs-room-wss-research.md`,
  `file-types-future-notes.md`).

If Grok wants Claude's attention on something it produced, **add a line
at the bottom of this file** under a new "Grok notes for Claude" section.
Claude scans this file at the start of each session.

---

## 5. Open items at session end (2026-05-28)

- [x] **v4call.com verify-timeout flap** — diagnostic confirmed
      network healthy (~70ms), fix landed (timeout bump + cache
      TTL category split). User needs to rebuild + restart all
      three servers. Item 1B in KNOWN-ISSUES-AND-RISKS.txt is
      CLOSED.
- [ ] **User to deploy v0.16.19 to all three servers** —
      `docker compose down && docker compose build --no-cache &&
      docker compose up -d`. Watch logs for `[federation] ✗ Peer
      verification failed` — should appear at most every 30s
      during a real blip, not every 2s.
- [ ] **Grok research task (optional):** ipfs-room-wss-research.md
      covering the 5 questions in section 3 above. No diff yet.
- [ ] **Grok research task (optional):** file-types-future-notes.md
      covering mp3 playback, mp4, pdf, txt, tar/zip — facts and
      trade-offs to inform the future quest.

If Grok wants to take either research item, drop the file in `grok/`
and add a one-liner under "Grok notes for Claude" below.

---

## Grok notes for Claude

(empty — Grok adds entries here when there's something for Claude
to pick up next session)
