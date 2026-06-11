# Federation Recovery + Lessons Notes

> **Status:** Living doc. Started 2026-05-27 during the v0.16.18 federation debugging quest. Update as we learn more. Future-you (noob, AI, or dev) will read this when something federation-related breaks — please add to it rather than rewriting.

## The big picture (read this first if you've forgotten everything)

v4call has **two independent federation layers** that look similar but do completely different jobs. Mixing them up is the #1 source of "why is X broken" confusion.

| Layer | Protocol | What it does | What it does NOT do |
|---|---|---|---|
| **WS server-to-server** | WebSocket on `/federation` between two v4call servers | Carries actual message payloads cross-server: DMs (text + attachments), call signaling, room invites, paid-flow notifications | Discovery, presence broadcast |
| **Nostr (Phase C + D)** | Nostr relays via `kind:30078` events | Phase C = peer **discovery** (finding new servers); Phase D = peer **presence broadcast** (who's online on which server) | Any actual payload delivery. No DMs, no calls, no attachments. Just visibility. |
| **Nostr payload transport** (optional, `NOSTR_FED_TRANSPORT=true`) | NIP-44-encrypted `kind:1314` events on the same relays | Carries **dm + dm-attachment** envelopes server→peer when WS is down/disabled. Reuses the WS `fedHandleMessage` dispatcher via a pseudo-socket. | Calls, room invite/join, presence — those stay WS-only / Phase D. Best-effort (relay reliability), so WS is preferred. |

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
| Cross-server text DM | ✓ | ✗ → ✓ with `NOSTR_FED_TRANSPORT` | ✓ |
| Cross-server paid DM | ✓ | ✗ → ✓ with `NOSTR_FED_TRANSPORT` | ✓ |
| Cross-server attachment DM | ✓ (v0.16.18) | ✗ → ✓ with `NOSTR_FED_TRANSPORT` | ✓ |
| Cross-server 1:1 call | ✓ | ✗ | ✓ |
| Cross-server room invite | ✓ | ✗ | ✓ |
| Cross-server room join (multi-party) | ✓ (browser → host server direct Socket.io) | ✗ | ✓ |
| Peer **discovery** (finding new servers) | ✗ (manual config only) | ✓ (Phase C scans Nostr) | ✓ |

**Bottom line:** WS server-to-server is the **payload transport** and stays the *preferred* one. Nostr is the **presence + discovery layer** on top — and, with `NOSTR_FED_TRANSPORT=true`, an **optional best-effort payload transport for DMs + attachments** when WS is down/disabled (calls + rooms stay WS-only). See Lesson 12.

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

### Lesson 11 — Duplicate `FEDERATION_PEERS=` lines silently dedup (last-wins)

**Symptom (2026-05-28):** Three-server mesh. Lobby presence worked (Nostr Phase D was up). cnoobz@hive-book.com would flicker in and out of call.completenoobs.com's lobby every minute or so. DMs/calls between those two were broken. The third leg (call ↔ v4call.com) worked perfectly.

**Root cause:** Each server's `.env` had **two** `FEDERATION_PEERS=` lines instead of one comma-separated line:
```
FEDERATION_PEERS=wss://hive-book.com/federation
FEDERATION_PEERS=wss://v4call.com/federation
```
Dotenv parsing is **last-wins** — `process.env.FEDERATION_PEERS` only sees the second URL. The first is silently dropped, no warning, no log line. Effective state per server:
- call.completenoobs.com → only `v4call.com` in its peer list
- v4call.com → only `call.completenoobs.com`
- hive-book.com → only `v4call.com`

Cross with the domain tiebreaker (smaller initiates: `call.completenoobs.com < hive-book.com < v4call.com`) and you get: call ↔ v4call up, hive-book ↔ v4call up, **call ↔ hive-book has no WSS link in either direction**. Nostr presence still made cnoobz visible on call.completenoobs.com, but only for the 5-min TTL window of each heartbeat — hence the flicker.

**Fix:** One line per `.env`, comma-separated:
```
FEDERATION_PEERS=wss://hive-book.com/federation,wss://v4call.com/federation
```
Then `docker compose down && docker compose up -d` (no rebuild — `.env` is mounted).

**Server-side safety net (v0.16.19+):** Boot-time scan reads `.env` directly and warns on every duplicate key. Log line: `[config] ⚠ multiple FEDERATION_PEERS lines in .env — dotenv keeps only the LAST. Use comma-separated form.` Same for any other env vars that have ever been documented as comma-separated lists. Doesn't change behaviour — only surfaces the silent dedup loudly so the next operator sees it within 5 seconds of `docker compose up`.

**Why it was easy to miss:** The original `.env.example` only showed the single-peer form (one URL per server). Adding a third server naturally invites copy-paste a second line. The example block has since been rewritten with explicit two-peer comma-separated examples plus a giant comment warning. Same fix lives in `CLAUDE.md` Known Gotchas.

**The bigger meta-lesson (call it the "WSS-disable-during-Nostr-test trap"):** Whenever you disable WSS fed to isolate-test Nostr, write a one-line note in the .env right next to the change, and a follow-up task to re-enable it. The user lost weeks because Nostr presence made everything look healthy while the WSS pipes had silently regressed. Adjacent rule: any time WS and Nostr can mask each other, default to running BOTH during testing and only isolate one when explicitly verifying that one's behaviour.

### Lesson 12 — Nostr payload transport (the fix for "wrappers over Nostr")

**The quest:** make the ipfs-gate/Pinata media "wrappers" (and text DMs) deliver cross-server over Nostr, so a Nostr-only deployment (WS `FEDERATION_PEERS` commented out) actually works for DMs/attachments — not just *looks* alive via presence (the Lesson 1 trap).

**The realisation that unblocked it:** the Nostr fed was never "broken" when we switched to WS-only — it had only ever done discovery (Phase C) + presence (Phase D). The wrappers were *always* WS-only. So this wasn't a re-enable; it was building the missing payload transport (old open-issue #3).

**The design (server-side only; `nostr-fed.mjs` + `server.js`):**
- **Pseudo-socket shim.** The WS dispatcher `fedHandleMessage(ws, json)` uses `ws` only for `ws._domain` + `fedSend(ws, reply)` in the dm/dm-attachment cases. A per-peer `{ _domain, readyState:1, send(str){ publish over Nostr } }` object makes those handlers — incl. recipient-side rate enforcement + escrow refunds (design rule #15) — run **unchanged** over Nostr. Replies (`dm-delivered`/`dm-failed`/`dm-attachment-failed`) route back automatically because the pseudo-socket's `send()` re-publishes to the sender server.
- **Encryption: NIP-44 server→peer**, `kind:1314` (regular/stored so a briefly-offline peer gets relay backlog), `['p',peerHex]` + `['t','v4call-fedmsg']` + NIP-40 `['expiration',…]`. Relay sees only ciphertext; the user-level metadata (from/to/cid/filename/memo) is inside it. **Not** NIP-59 gift-wrap (its `created_at` randomization fights store-and-forward + expiration; the which-servers-talk metadata it hides is already public from Phase C/D).
- **Trust gate (server.js owns it):** inbound fedmsg pubkey must map to an **approved** domain via the Hive-anchored `verified_nostr_hex` binding (mirrors `recordNostrPresence`). A **type whitelist** (`dm`,`dm-attachment`,`dm-delivered`,`dm-failed`,`dm-attachment-failed`) guarantees hello/call/room/presence never ride Nostr.
- **Send-side router `fedRouteSend(user, msg)`: WS first, Nostr fallback.** WS stays preferred (latency + guaranteed delivery). `recipientStatus` gains a `nostr` status; `dm-precheck` reports it as `federated` (sendable) for DMs but `nostr-only` for **calls** (`purpose:'call'`) since calls are WS-only.

**MONEY safety — dedup is load-bearing.** `ledgerPayment`/`sendFromEscrow` are NOT idempotent, and relays redeliver events. A redelivered paid fedmsg that re-ran the disburse path would **double-pay**. Guard: event-id dedup in BOTH layers (a `seenIds` Set in the module + an authoritative time-windowed `seenFedEventIds` Map in `server.js` before dispatch) + a per-domain ordering queue. **When testing, explicitly force a resubscribe / restart the recipient and confirm the already-delivered paid message is dropped (no second payout).**

**Gotchas to remember:**
- Transport needs `FED_DISCOVERY_MODE=nostr|both` AND `FED_PRESENCE_VIA_NOSTR=true` (the router resolves which peer hosts a username from Phase D presence) AND the peer's `NOSTR_PUBKEY` in their signed `v4call-server.json`. Boot-logs a warning if `NOSTR_FED_TRANSPORT=true` without these.
- Best-effort: a dropped paid fedmsg = sender paid, recipient credited only when it lands. Keep ≥1 operator-controlled (nGate) relay in `NOSTR_RELAYS`.
- NIP-44 caps plaintext at 65535B; the wrapper is small metadata (file bytes are on IPFS) so there's wide headroom + a 48KB pre-publish guard.
- This is the *inverse* of the Lesson 1 trap: with the transport on, Nostr-visible now means actually-routable for DMs/attachments — the "visibility lies" gap is closed for those (calls still correctly report unroutable).

**PROVEN 2026-06-11** on the 3 prod servers with WSS commented out: a paid text DM (3 TEST → recipient-side disburse + `dm-delivered` receipt) AND an encrypted ipfs-gate attachment both delivered cross-server over the two gated relays. Three things bit during the rollout, all now understood:
- **`NOSTR_FED_TRANSPORT` was unset on all 3 servers** → silent default-off (no `fedmsg subscribe`/`publish`), and presence masked it. Set it in `.env` on every peer (needs `FED_DISCOVERY_MODE=nostr|both` + `FED_PRESENCE_VIA_NOSTR=true` too). `.env`-only change → `down && up -d`, no rebuild.
- **First-ever DM to a Nostr-only user failed silently** — `sendDmMessage` bailed when the recipient pubkey wasn't cached, and Nostr presence (unlike WSS) carries no pubkeys. Fixed client-side: fall back to `fetchPubKey` (Hive posting key is public on-chain) the way the call/attachment/allowlist paths already do.
- **The attachment "cannot transfer to self / orphan-payments" error was NOT a v4call/Nostr bug** — the ipfs-gate's fee-receiving account equalled the uploader (testin), and Hive blocks self-transfers. Test attachments as a user who isn't the gate's payment account.
- After publishing nostr keys into a server's `.well-known`, **verify the published key == that server's `data/nostr/nostr-key.json` signing key** — `verified_nostr_hex` (from the well-known) takes precedence in the trust gate, so a mismatch silently drops that server's presence + fedmsgs (a likely cause of asymmetric "server X can't see server Y" presence).

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
3. ~~**No Nostr-based DM transport**~~ — **RESOLVED (Nostr payload transport, `NOSTR_FED_TRANSPORT`).** DMs + attachments now route over NIP-44-encrypted `kind:1314` events when WS is down/disabled. NIP-44 server→peer (not NIP-17 gift-wrap — gift-wrap's `created_at` randomization fights store-and-forward + expiration for a 3-trusted-operator set). Calls + room invite/join still WS-only (deferred — they need a direct browser↔host Socket.io). See Lesson 12.
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
