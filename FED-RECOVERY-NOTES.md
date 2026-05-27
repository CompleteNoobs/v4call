# Federation Recovery + Lessons Notes

> **Status:** Living doc. Started 2026-05-27 during the v0.16.18 federation debugging quest. Update as we learn more. Future-you (noob, AI, or dev) will read this when something federation-related breaks — please add to it rather than rewriting.

## The big picture (read this first if you've forgotten everything)

v4call has **two independent federation layers** that look similar but do completely different jobs. Mixing them up is the #1 source of "why is X broken" confusion.

| Layer | Protocol | What it does | What it does NOT do |
|---|---|---|---|
| **WS server-to-server** | WebSocket on `/federation` between two v4call servers | Carries actual message payloads cross-server: DMs (text + attachments), call signaling, room invites, paid-flow notifications | Discovery, presence broadcast |
| **Nostr (Phase C + D)** | Nostr relays via `kind:30078` events | Phase C = peer **discovery** (finding new servers); Phase D = peer **presence broadcast** (who's online on which server) | Any actual payload delivery. No DMs, no calls, no attachments. Just visibility. |

Both can be enabled independently:
- `FEDERATION_PEERS` env (WS layer): list of `wss://peer.com/federation` URLs to connect to. Empty → WS fed disabled.
- `FED_PRESENCE_VIA_NOSTR=true` env (Nostr Phase D): enables Nostr presence broadcast + receive.

**The trap I (Claude) and the user keep falling into:**
Nostr presence makes federated users *visible in the lobby* even when WS fed isn't connected. Looks like federation is working. Then when you try to actually DM/call them → silent failure or misleading error. The visibility lies.

**Current production topology (as of 2026-05-27):**
The user had been running **Nostr-only** for a while (WS fed commented out in `.env`). Lobby presence + same-server DMs all worked. Cross-server DMs/calls/attachments were broken but never noticed because no end-to-end test was run for those.

## What works today, what doesn't

| Action | WS-only | Nostr-only | Both enabled |
|---|---|---|---|
| Same-server lobby presence | ✓ | ✓ | ✓ |
| Cross-server lobby presence | ✓ (slow, on user-online events) | ✓ (fast, heartbeat) | ✓ (fastest, redundant) |
| Same-server text DM | ✓ | ✓ | ✓ |
| Same-server paid DM | ✓ | ✓ | ✓ |
| Same-server attachment DM (ipfs-gate) | ✓ | ✓ | ✓ |
| Cross-server text DM | ✓ | ✗ (no transport) | ✓ |
| Cross-server paid DM | ✓ | ✗ | ✓ |
| Cross-server attachment DM | ✓ (v0.16.18) | ✗ | ✓ |
| Cross-server 1:1 call | ✓ | ✗ | ✓ |
| Cross-server room invite | ✓ | ✗ | ✓ |
| Cross-server room join (multi-party) | ✓ (browser → host server direct Socket.io) | ✗ | ✓ |
| Peer **discovery** (finding new servers) | ✗ (manual config only) | ✓ (Phase C scans Nostr) | ✓ |

**Bottom line:** WS server-to-server is the **payload transport**. Nostr is the **presence + discovery layer** on top. You need WS for anything cross-server beyond visibility.

## Lessons learned (chronological — add new ones at the bottom)

### Lesson 1 — Phase D Nostr presence + WS-fed-disabled = visible-but-unreachable users

**Symptom:** Lobby shows users from other servers. DM-ing them fails with confusing "not online" message even though they're right there in the user list.

**Root cause:** `nostrAdditivePresenceSnapshot()` ([server.js:862](server.js#L862)) injects Nostr-only-visible users into the lobby snapshot when WS doesn't already report them. The lobby visibly works. But `peerForUser()` ([server.js:928](server.js#L928)) — used by the DM/call/attachment routing paths — checks ONLY the `federationPeers` (WS) map. So routing fails for users who are visible only via Nostr.

**Fix (v0.16.18):** Added `recipientStatus(username)` ([server.js:951](server.js#L951)) that returns one of `local | federated | nostr-only | offline`. The `dm-precheck` socket call lets the client check status BEFORE prompting for any Keychain payments. The DM panel surfaces a clear "Cross-server DM unavailable (WS fed disabled)" badge when state is `nostr-only` AND `FEDERATION_ENABLED === false`. When WS is enabled but reconnecting → "⏳ Federation reconnecting — wait ~30s".

**For the noob who forgets:** If users appear online but DMs say "not online" / never arrive, FIRST check `grep FEDERATION_PEERS .env` on both servers. If commented out, WS fed is off and Nostr is lying to your eyes.

### Lesson 2 — Paid actions MUST gate on routing before charging

**Mistake we almost made (and partly did):** The v0.16.17 attachment send flow charged BOTH the paid-DM rate (Keychain prompt to recipient's escrow) AND the ipfs-gate CNOOBS fee BEFORE the server confirmed the recipient was reachable. If the recipient was Nostr-only-visible, the server would later reject the DM with "not online" but the user had already burned two on-chain payments with no delivery.

**Fix (v0.16.18):** Client-side `dmPrecheck(target)` call inserted at the TOP of both `sendDmMessage` and `sendAttachment` (DM mode), before any Keychain prompt. If `nostr-only` or `offline`, abort with a clear message — no payment charged.

**Rule for future paid actions:** Whenever you add a new paid flow (paid call, paid invite, etc.), the routing check MUST come before any Keychain prompt. The current `recipientStatus` + `dm-precheck` pattern is the template — extend it (`call-precheck`, `invite-precheck`, etc.) rather than re-implementing.

### Lesson 3 — `docker compose logs --tail=0 -f` hides startup logs

**Mistake during debugging:** I told the user to run `docker compose logs --tail=0 -f app | grep ...`. The `--tail=0` flag starts streaming from the END of the log, so all the federation startup logs (`[config] Federation: ENABLED`, `[federation] Approved peers: …`, `[federation] Connecting to wss://…`, `[federation] Outbound connected: …`) already scrolled past. Result: I diagnosed "WS federation isn't connecting" when actually it WAS (or wasn't) — I had no way to tell from the tail.

**Correct command for federation-startup debugging:**
```bash
docker compose logs app 2>&1 | grep -E "\[config\]|\[federation\]|Approved peers|Passive mode|Outbound|Inbound|Peer verified"
```
No `-f`, no `--tail`. Shows full history from container start.

**For live tailing AFTER startup:**
```bash
docker compose logs -f app  # no --tail flag
```
This shows full log + follows new lines.

### Lesson 4 — Domain tiebreaker means only ONE side initiates

**Got confused once:** "Why isn't v4call.com connecting to hive-book.com?" Answer: per the domain tiebreaker (`fedShouldInitiate()`), the lexicographically-LOWER domain initiates outbound. `hive-book.com < v4call.com`, so hive-book.com initiates and v4call.com goes passive (logs `[federation] Passive mode for hive-book.com (domain tiebreaker — peer will initiate)`).

**Practical implication:** If federation is failing, check the INITIATOR side's logs first. v4call.com (the passive side) won't log connection attempts — it just waits for inbound. Look at hive-book.com's logs for `Connecting to wss://v4call.com/federation...` / `Outbound connected: …` / `Disconnected ... retry in Ns`.

**Why the tiebreaker exists:** without it, both sides could connect outbound to each other at the same time, get a "duplicate peer" rejection, both close, both retry, infinite flap. The tiebreaker breaks the symmetry deterministically.

### Lesson 5 — Operator-specific files survive `git reset --hard` only if you cp them back

**Files that get clobbered by `git fetch --all && git reset --hard origin/main`:**
- `nginx/v4call.conf` (operator's domain replaces the placeholder)
- `public/.well-known/v4call-server.json` (operator's signed verify file)

**Files that DO survive:**
- `.env` (gitignored — never committed, never reset)
- `data/logs/v4call-ledger.db`, `data/logs/v4call-chat.db`, `data/logs/approved-peers.json` (volume mount in docker-compose)

**The user's update recipe (works):**
```bash
git fetch --all && git reset --hard origin/main && \
  cp nginx/bk.v4call.conf nginx/v4call.conf && \
  cp public/.well-known/bk.v4call-server.json public/.well-known/v4call-server.json && \
  docker compose down && docker compose build --no-cache && docker compose up -d
```
Keeps backup copies (`bk.*`) of the operator files committed alongside the templates, so the cp restores them after reset.

### Lesson 6 — Only changing `.env` doesn't need `--no-cache` rebuild

`.env` is mounted into the container at runtime, not baked into the image. So:
- Changed `.env` only → `docker compose down && docker compose up -d` (no rebuild needed)
- Changed `server.js` / `public/index.html` / `Dockerfile` → full `docker compose down && docker compose build --no-cache && docker compose up -d`

Saves ~30-60s on `.env`-only changes.

### Lesson 7 — `keychainTransferCnoobs` was hardcoded; gate currency change needs the helper to be parametric

**Symptom:** Changed `PAYMENT_CURRENCY=TEST` in ipfs-gate `.env`, gate cost line showed "≈ 1 TEST" correctly, but Keychain popup still asked for CNOOBS, payment landed as wrong currency, gate rejected.

**Root cause:** `keychainTransferCnoobs({ to, amount, memo })` in v0.16.16 was hardcoded to `symbol: 'CNOOBS'` and prompt label "Pay X CNOOBS to ipfs-gate". The cost-line read currency from the gate's `/` endpoint correctly, but the transfer helper didn't.

**Fix (v0.16.18):** Renamed to `keychainTransferGateToken({ to, amount, memo, symbol })`, currency-parametric. The actual currency is now read from `reserve.payment.currency` (the gate's `/reserve` response, authoritative per upload) and threaded through.

**Now:** Operator changes `PAYMENT_CURRENCY` in ipfs-gate's `.env`, restarts ipfs-gate, done. No v4call rebuild needed. Cost line + Keychain transfer both data-driven.

### Lesson 8 — Federation `case 'X':` switch in server.js: new types are silently dropped by older peers

The federation message dispatcher is `switch (msg.type) { case 'dm': ..., case 'call-invite': ..., default: }`. When you add a new envelope type like `dm-attachment`:

- v0.16.18+ peers (have the new case) process it normally.
- v0.16.17 peers (no new case) hit `default:` — silently dropped, no error.

**Implication for federation rollouts:** Mixed-version federation is mostly fine. New features just don't reach un-upgraded peers. Plan rollouts so paired servers upgrade together, otherwise un-upgraded peers degrade to "feature missing" rather than crashing.

**No protocol_version bump needed for additive changes.** The v0.4 `protocol_version` gate is for changes that fundamentally require both sides to understand (e.g. v0.16 cross-server rooms). New message types alone don't require it.

### Lesson 9 — Don't trust caller-server's claimed payment fields (recipient-side enforcement)

**Rule of thumb (CLAUDE.md "Key Design Decisions" #15):** The recipient's home server is the ONLY server trusted to enforce the recipient's policies (block-list, rate, fee, currency, etc.).

Caller-side server is a verifier + router. It may pre-check rates for UX (showing what to pay), and verify the on-chain payment landed, but **CAN NOT** be trusted as sole policy enforcer — a malicious or stale-cache caller server could lie.

Federation `case 'dm':` handler ([server.js:5440](server.js#L5440)) AND `case 'dm-attachment':` handler ([server.js:5583](server.js#L5583)) both:
1. Re-fetch recipient's rates
2. Re-verify on-chain payment to OUR escrow
3. Re-check block-list, fee-minimum, currency, amount via `computePaymentOptions`
4. Refund the caller from our escrow on any reject

Don't skip these checks "for performance". The reject path also auto-refunds, so a misconfigured or hostile peer can't grief the recipient with stuck funds.

### Lesson 10 — DM tab user picker doesn't auto-refresh (fixed v0.16.18)

Was: `renderDmUserList()` only ran on `switchLobbyTab('dm')` click. If new users came online while user was sitting on the DM tab, picker stayed stale until they re-clicked the tab.

Now: `lobby-users` socket handler also calls `renderDmUserList()` if the DM tab is currently active. Same pattern likely applies to any other "click-to-refresh" panels — audit when adding new ones.

## Current state of the code (v0.16.18)

### Two new client-side helpers

- **`dmPrecheck(target)`** (`public/index.html:1673`): single socket round-trip returning `{ status, domain?, federationEnabled? }`. Use BEFORE any paid action.
- **`keychainTransferGateToken({ to, amount, memo, symbol })`** (`public/index.html:3729`): currency-parametric replacement for the old hardcoded-CNOOBS helper.

### Two new server-side helpers

- **`nostrSeenDomain(username)`** (`server.js:937`): returns the Nostr domain visible-via-Nostr or null.
- **`recipientStatus(username)`** (`server.js:951`): single source of truth, returns `local | federated | nostr-only | offline`.

### New socket events
- `dm-precheck` (client → server, ack callback) — routing pre-flight
- `dm-attachment` (bidirectional) — attachment envelope, local + federated
- `dm-attachments-history` (client → server, ack callback) — history replay
- `dm-attachment-error`, `dm-attachment-payment-required`, `dm-attachment-sent` (server → client) — error/status

### New federation envelope types
- `type: 'dm-attachment'` — full encrypted attachment envelope, paid-DM gated
- `type: 'dm-attachment-failed'` — peer rejection, source-side refund

## Known open issues (track here, fix later)

1. **DM delivery noblemage → cnoobz currently failing post-fed-reconnect** (this session, 2026-05-27). Need fresh test + log paste with the new diagnostic logging from this commit. Likely candidates:
   - Recipient socket state stale on hive-book.com
   - Federation `case 'dm':` handler reject path silent on the receiving side (recipient-side rate enforcement rejecting a free DM by mistake?)
   - Some `[fed-text]` or `[text]` log line will pinpoint it
2. **Same routing race exists for paid voice/video calls** — `call-invite` socket handler hasn't been updated to use `recipientStatus` yet. Lower priority since voice/video isn't currently the test focus.
3. **No Nostr-based DM transport** — would let Nostr-only deployments work cross-server. Real engineering work (NIP-17 gift-wrap or similar). Tracked under v0.18.5+ Nostr + Lightning plan. Multi-session build.
4. **`call.completenoobs.com` peer is in approved-peers.json on both v4call.com and hive-book.com but no current FEDERATION_PEERS line points to it.** Up to operator whether to re-enable that triangle.

## Test recipes (the noob's cheat sheet)

### "Is WS federation actually connected?"
```bash
docker compose logs app 2>&1 | grep -E "\[federation\]" | tail -20
```
Look for `Outbound connected` (on the initiator) or `Inbound peer connection` + `Peer verified` (on the receiver). If you only see retries with growing delays, the connection is failing at TCP/TLS/cert level — check nginx config and certs.

### "Is Nostr presence working?"
```bash
docker compose logs app 2>&1 | grep -E "\[nostr\]" | tail -30
```
Look for `[nostr] presence publish (heartbeat): N local user(s) for domain.com — event abc…`. If you see ACCEPTED on multiple relays, your side is publishing. If you don't see incoming `[presence]` lines from the other server, the other side may not be publishing OR your subscribers don't share the same relays.

### "Why isn't DM working?"
Send the DM with both sides running:
```bash
docker compose logs app 2>&1 | grep -E "\[text\]|\[fed-text\]|\[fed-att\]|lobby-dm|dm-attachment"
```
- Sender side should log: `[text] @from → @to@peer.com: fedSend(type=dm) issued (ws.open=true, ...)`. If `ws.open=false`, fed socket is in a bad state on sender's side.
- Receiver side should log: `[fed-text] ← @from@peer → @to: delivered to local socket (sid abc…)`. If you see `recipient NOT in local lobbyUsers — message stored in chat DB only`, the recipient socket isn't where the receiver expected it to be (maybe the lobby-users state on hive-book.com side missed an update).

### "Is the user actually online via WS, or just visible via Nostr?"
Look at the lobby snapshot — federated users have a `server` badge. If you can DM them and the dm-precheck returns `federated` (not `nostr-only`), WS is the source. If `nostr-only`, only presence is via Nostr.

## What to do RIGHT NOW (next test cycle)

After this commit, the user should:
1. `docker compose down && docker compose build --no-cache && docker compose up -d` on BOTH servers
2. Wait for WS fed to connect (look for `[federation] Outbound connected` on hive-book.com's logs)
3. Confirm both servers can see each other in the lobby
4. Have noblemage send a text DM to cnoobz
5. Paste the relevant log lines from BOTH servers — specifically the `[text]` / `[fed-text]` lines (the new ones from this commit will tell us exactly where the DM is going / not going)
6. Also paste any `[fed-text] ✗` or `dm-failed` lines

The diagnostic logging added this commit makes this much easier to pinpoint than before.

---

*Last updated: 2026-05-27 (mid-debug session — federation just re-enabled, DM delivery test pending).*
