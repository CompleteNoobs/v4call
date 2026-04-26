# CLAUDE.md — v4call Project Context

> **⚠️ This project was vibe-coded with Claude Opus 4.6 → 4.7. The author is a tinkerer, not a developer. Use at your own risk — review the code before trusting it with real money.**

## What This Is

v4call is a decentralised paid video, voice, and text communication platform built on the Hive blockchain. Users set their own rates for receiving calls and messages. Callers pay with HBD or custom Hive-Engine tokens. Unused credit is refunded automatically. The server operator earns a platform fee from each paid interaction. Multiple server operators can federate so users on different servers see, call, and message each other.

**The core idea:** I don't want strangers ringing my phone for free. If they value my time, they can pay. If not, my phone doesn't ring. Family and friends get custom rules — free calls, different hours, different rates.

## Current Version

- **Software:** v0.11 — multi-server federation working between two production-deployed servers (call.completenoobs.com ↔ hive-book.com).
- **Federation protocol:** v0.3 — verify.json domain proof, Hive-tag discovery directory, manual peer approval, paid cross-server calls + DMs.

The version split is intentional: the application keeps evolving (UI/UX/features), the federation protocol bumps separately when wire-format changes.

## Tech Stack

- **Backend:** Node.js, Express, Socket.io, better-sqlite3, ws (federation WebSocket)
- **Frontend:** Single HTML file (`public/index.html`) — all HTML, CSS, and JS in one file. Plus four standalone operator-tool pages (rate/sign/announce/admin-peers).
- **Blockchain:** @hiveio/dhive for Hive API, hivecrypt for posting-key encryption
- **External APIs:** Hive blockchain (identity, rates, HBD payments), Hive-Engine API at `https://api.hive-engine.com/rpc/contracts` (token balances, transfers)
- **WebRTC:** Peer-to-peer audio/video via browser APIs, STUN via Google's public server
- **Federation transport:** Server-to-server WebSocket on `/federation` (separate from Socket.io)
- **Deployment:** Docker (node:20-alpine), Nginx reverse proxy, Let's Encrypt SSL
- **Databases:** Two separate SQLite files in `/app/logs/` (mounted as `./data/logs/`) + `approved-peers.json` for federation approvals

## File Map

```
server.js                              — All backend logic: socket handlers, rate parsing, payment
                                         verification, escrow disbursement, chat storage, room
                                         management, federation transport + verification + discovery
public/index.html                      — Entire main frontend: login, lobby, rooms, calls, DMs,
                                         payment modals, mobile bottom-tab nav
public/rate-editor.html                — Rate post builder (generates V1/V2 rates posts for Hive)
public/server-sign.html                — Generates the signed v4call-server.json domain-proof file.
                                         Operator runs this once per config change.
public/server-announce.html            — Publishes the v4call-server Hive post (directory listing).
                                         Operator runs this when server config changes.
public/admin-peers.html                — Federation peer admin UI: discover, approve, revoke peers.
public/info.html                       — Public landing page (shown to non-authenticated visitors)
public/.well-known/v4call-server.json  — Domain-proof file (placeholder shipped; operator overwrites
                                         with own signed file via server-sign.html). Served at
                                         https://yourdomain.com/.well-known/v4call-server.json
Dockerfile                             — node:20-alpine, runs as user node (UID 1000)
docker-compose.yml                     — app + nginx + certbot services
nginx/v4call.conf                      — HTTPS config, WebSocket proxy, /federation block (no auth),
                                         optional basic auth (commented by default)
.env                                   — All server config (never committed)
data/logs/v4call-ledger.db             — Payment records (server writes only)
data/logs/v4call-chat.db               — Encrypted DM + room message storage
data/logs/approved-peers.json          — Federation approval list (auto-managed)
WalkThrough.wiki                       — Operator deploy guide (also lives at
                                         https://completenoobs.com/index.php/V4call)
FEDERATION-BUILD-SPEC.md               — Federation protocol spec, completed milestones, next steps
```

**Do not split index.html into separate files.** The entire main frontend lives in one file. This is intentional. The four operator-tool pages (rate-editor, server-sign, server-announce, admin-peers) are deliberately separate — they're standalone tools used outside normal user sessions.

## Architecture

```
   Browser (caller)  ──────WebRTC P2P (encrypted)──────►  Browser (callee)
        │                                                       │
        │ Socket.io                                             │ Socket.io (own server,
        ▼                                                       ▼  OR cross-server temp
   Caller's server.js                            Callee's server.js  socket for federated)
        │
        ├── Hive blockchain API (identity, rates, HBD payments)
        ├── Hive-Engine API (custom token balances + transfers)
        ├── SQLite: v4call-ledger.db (payments — server writes only)
        ├── SQLite: v4call-chat.db (encrypted DMs + room messages — separate for security)
        ├── Escrow Hive account (holds HBD + tokens during calls)
        ┊
        ┊──── Federation WebSocket (/federation) ────────────►
        ▼                                                     ▼
   Federation peer servers (presence, DM relay, call invites, payment-verified, call-ended)
```

**Federation flow at a glance** (this is the most non-obvious part of the system):

1. Each server publishes a *signed* `/.well-known/v4call-server.json` proving the Hive account at the field `hive_account` controls this domain. Operators generate it via `/server-sign.html`.
2. Each server publishes a `v4call-server` tagged Hive post advertising its existence and pointing at the verify URL. Operators generate it via `/server-announce.html`.
3. Other servers periodically scan Hive for `v4call-server` posts, fetch each candidate's verify file, cryptographically verify, and present the candidate list at `/admin-peers.html`.
4. Operator approves a candidate → outgoing federation WebSocket established (one direction only — lower-domain side initiates, see "Domain tiebreaker" below).
5. On the wire, federation messages: `hello` (with verify recheck), `presence`, `user-online`/`user-offline`, `dm`, `call-invite`/`call-response`/`call-declined`/`call-cancelled`/`call-missed`, `payment-verified`, `call-ended`, `call-receipt-fed`.
6. For paid cross-server calls/DMs, the caller pays the *callee's escrow on Hive* directly. The caller's server verifies on-chain and forwards the payment notification to the callee's server. The callee's server independently re-verifies and disburses (callee-net, platform-fee) from its own escrow at call end. Refunds to the caller are cross-server Hive transfers from the callee's escrow.

## Features (What's Built and Working in v0.11)

### Core (single-server)
- **Login:** Hive Keychain (recommended, no key paste) or manual posting key
- **Encryption unlock:** Keychain users get a 🔑 panel to enter posting key for encrypted messaging (Keychain can't expose private keys)
- **Voice calls:** Green phone button, audio only, no camera permission
- **Video calls:** Blue camera button, audio + camera
- **DMs:** Purple chat bubble button, end-to-end encrypted with Hive posting keys
- **Chat storage:** Both sender and recipient copies stored as ciphertext in v4call-chat.db, configurable retention (DM_RETENTION_DAYS, ROOM_RETENTION_DAYS)
- **Unread DM alerts:** Popup on login showing count and senders, based on last_seen tracking
- **DM previews:** Last N messages per conversation loaded on login (DM_PREVIEW_COUNT, 0 = off)
- **DM history:** Full conversation loaded on demand when opening DM panel
- **Rooms:** Private, allowlist-based, ephemeral (deleted when last person leaves, including stored messages)
- **Room history:** Replayed on join — broadcasts in full, encrypted messages only if addressed to the joiner
- **Custom token payments:** Any Hive-Engine token via [TOKEN:SYMBOL] sections in rates post
- **Payment picker:** When multiple currencies qualify, caller sees all options with balances and chooses
- **Token transfers:** Uses Keychain requestCustomJson for Hive-Engine sidechain operations
- **Token verification:** Balance-check verification (not transferHistory — that API doesn't work reliably)
- **Platform fee enforcement:** Server sets minimum (DEFAULT_PLATFORM_FEE), user's rates post sets their willingness. If user's fee < server minimum → rejected with message. If user's fee >= minimum → server charges its own rate (best price for user)
- **Rate system:** V1 and V2 formats, named lists (family/friends/work/default), time windows, day-of-week, blocked users, ALLOW-IF-TOKEN bypass, per-token rate sections
- **Payment flow:** Ring fee → connect fee → duration deposit. Unused credit refunded. Platform fee deducted. All verified on-chain before proceeding.
- **Call types:** Voice and video have separate rate tiers in the rates post
- **Mobile UI:** Responsive `@media (max-width: 720px)` collapses three columns into a full-width single column with a fixed bottom-tab nav (USERS/CHAT/ROOMS for lobby, VIDEO/CHAT/MEMBERS for room)

### Federation (v0.3)
- **Server-to-server WebSocket:** persistent connection on `/federation`, domain tiebreaker so only the lower-domain initiates outbound (avoids flapping)
- **Verify.json domain proof:** signer page produces a Hive-key-signed JSON file hosted at `/.well-known/v4call-server.json`. Discovering servers fetch + verify the signature against the signer's posting pubkey from Hive.
- **Hive directory:** server-announce page produces a `v4call-server` tagged Hive post. Discovery scanner queries `condenser_api.get_discussions_by_created` every 2h.
- **Approval gate:** verified peers must be explicitly approved. Seed list from `FEDERATION_PEERS` env auto-approves on startup; manual approvals via `POST /admin/peers/approve` persist to `approved-peers.json`.
- **Cross-server presence:** federated users appear in the lobby with a server-domain badge.
- **Cross-server DMs:** ciphertext relayed via federation `dm` message; server never sees plaintext. Supports paid DMs (recipient's server re-verifies on-chain, disburses from its own escrow).
- **Cross-server 1:1 calls:** caller's server hosts the room, callee's browser opens a temporary cross-server Socket.io connection for WebRTC signalling. Media still peer-to-peer.
- **Cross-server payments:** caller pays callee's escrow on Hive. Caller's server verifies and forwards `payment-verified`. Callee's server re-verifies, disburses callee-net + platform-fee + refund (refund as cross-server Hive transfer from its own escrow back to the caller).
- **Escrow-mismatch guard:** if a callee's rates-post escrow doesn't match the peer's announced escrow, paid calls fail loudly with a clear error explaining the mismatch.

## Key Design Decisions

1. **Separate databases:** v4call-chat.db is separate from v4call-ledger.db. If chat storage is exploited, the payment ledger is untouched. Only the server writes to the ledger.

2. **Platform fee is a minimum, not a fixed rate:** Server operators compete on fees. Users shop around. This is now a real free market across federated servers.

3. **Encryption uses Hive posting keys via hivecrypt:** This means Keychain login users need to enter their posting key separately for encryption. There's no workaround — Keychain deliberately never exposes private keys.

4. **Hive-Engine API is at `/rpc/contracts`:** The old endpoint `/contracts` returns HTML and is dead. This was a painful debugging session. Do not change this URL.

5. **Token payment verification uses balance checks, not transfer history:** The Hive-Engine `transferHistory` table is not reliably queryable via the contracts RPC. Instead, we verify that the escrow account's token balance is sufficient. The payment was already signed via Keychain.

6. **`docker compose down` is required before rebuilding:** Without this, Docker reuses the old container even after `docker compose build --no-cache`. This caused hours of debugging where changes weren't taking effect.

7. **Rooms are ephemeral:** When the last person leaves, the room and all its stored messages are deleted from the database. This is deliberate — rooms are not meant to persist.

8. **All three buttons (voice, video, DM) use inline SVG icons:** No image files, no emoji. The SVGs inherit colour from CSS via `stroke="currentColor"`.

9. **Federation domain tiebreaker:** When both peers connect outbound at the same time, only the lexicographically-smaller domain keeps its outbound. The other peer goes "passive mode" and accepts inbound only. This avoids the flapping bug where both sides closed the other's connection. See `fedShouldInitiate()`.

10. **Federation handshake is fail-closed:** A peer must (a) verify cryptographically, (b) be in `approvedPeers`. Anything else closes the socket with a clear log message.

11. **Per-socket message ordering on federation:** Each federation WebSocket has a Promise queue chain so messages are processed strictly in order. Without this, presence arriving while hello was still verifying got silently dropped.

12. **Escrow account must match the server holding its key:** A user's `v4call-rates` post declares one `ESCROW:` account. That account's active key must live on the server where the user is currently logged in. Mismatch = paid flows fail because the destination server can't disburse from an escrow it doesn't own. The federation hello announces each server's `ESCROW_ACCOUNT` so the caller side can detect this mismatch and emit a clear error.

13. **Caller's server is the verifier and router; callee's server is the treasurer:** For cross-server paid calls/DMs, the caller's server *only* verifies on-chain payments and forwards a notification. It never disburses cross-server escrows. The callee's server (which holds the escrow key) does all disbursement. Both sides re-verify the on-chain payment for safety.

14. **The four operator pages are intentionally standalone:** rate-editor, server-sign, server-announce, admin-peers. They sign with the operator's Hive key (via Keychain or paste) — the key never reaches the v4call server. Same security pattern as the rate editor.

## Known Gotchas and Debugging Tips

- **Changes not appearing after deploy:** Always `docker compose down && docker compose build --no-cache && docker compose up -d`. Never just `docker compose restart`.
- **Hive-Engine balance check returning 0:** Check the API URL is `https://api.hive-engine.com/rpc/contracts` not the old `/contracts` endpoint.
- **Token symbol case sensitivity:** The symbol in the rates post must match Hive-Engine exactly (usually all uppercase).
- **SQLite permission errors:** The app runs as UID 1000 inside Docker. Fix with `chown -R 1000:1000 ./data/logs/` on the host.
- **Certbot failing:** Must use `--entrypoint certbot` flag or Docker runs the renewal loop instead of `certonly`.
- **Nginx cert crash loop:** Never put HTTPS config in nginx before the cert exists. Start HTTP-only, get cert, then add HTTPS.
- **Sign error on login:** The `hivecrypt` library needs the posting key as a string. Keychain mode doesn't have this, so signing falls back to `requestSignBuffer`. Hash type wrapping fixed in v0.11 by using `dhive.cryptoUtils.sha256` instead of raw Uint8Array.
- **`.well-known` directory must use a hyphen** — `.well_known` (underscore) is wrong (RFC 8615). The verify file must be at `public/.well-known/v4call-server.json` exactly. Wrong filename or directory = federation handshake 404 = federation broken.
- **Verify.json placeholder:** The repo ships a tiny placeholder at `public/.well-known/v4call-server.json`. Each operator must overwrite it with their own signed file from `/server-sign.html` before federation works. Commit your generated file so fresh installs include it.
- **Federation flapping:** If you see endless `Outbound connected → Disconnected` cycles, the domain tiebreaker may be misconfigured or the peer's verify.json isn't matching. Check both sides' logs for `✓ Peer verified` or `✗ Peer verification failed`.
- **Federated paid call/DM fails silently:** Likely an escrow mismatch — the user's rates post points at an escrow not controlled by their home server. Caller-side server emits a clear `lobby-dm-error` or `call-failed` explaining this once the federation hello has exchanged escrow info.
- **Hive node failures look quiet:** The `hivePost` helper only logs nodes that *throw*. Nodes returning `{error: ...}` (no `result` field) are silently skipped to the next node. If discovery returns "No response", grep `[hive]` in logs to see partial failure data — but two of four nodes can fail invisibly.

## Coding Style

- **CSS:** Use the existing CSS variables from `:root` — `--bg`, `--surface`, `--accent`, `--green`, `--blue`, `--purple`, `--text`, `--subtext`, `--muted`, `--border`, `--danger`
- **Fonts:** IBM Plex Mono for UI elements/labels, IBM Plex Sans for body text
- **Theme:** Dark theme throughout, never light
- **HTML:** Keep everything in `public/index.html` for the main app. The four operator pages stay separate.
- **Button styling:** 24x24px rounded circles with coloured borders and backgrounds. Green = voice, Blue = video, Purple = DM.
- **Modals:** Fixed overlay with backdrop blur, z-index 2000-3000
- **System messages:** Use `addLobbyMsg({type:'system', text:'...'})` or `addSystemMsg('...')` for room messages
- **Mobile breakpoint:** `@media (max-width: 720px)` for the bottom-tab nav and stacked panels. Bottom nav uses `position: fixed` with `padding-bottom: env(safe-area-inset-bottom)` for notched phones.

## .env Variables

```
SERVER_NAME              — Display name (default: v4call)
SERVER_DOMAIN            — Domain (default: v4call.com)
SERVER_HIVE_ACCOUNT      — Receives platform fees + signs federation verify.json
ESCROW_ACCOUNT           — Holds funds during calls. Active key for this account MUST live on this server.
V4CALL_ESCROW_KEY        — Active private key for escrow (REQUIRED, never log)
ADMIN_KEY                — Password for /admin/* endpoints (ledger, balance, peers)
DEFAULT_PLATFORM_FEE     — Minimum platform fee % (default: 10)
DM_RETENTION_DAYS        — Days to keep DMs (default: 33)
ROOM_RETENTION_DAYS      — Days to keep room messages (default: 33)
DM_PREVIEW_COUNT         — Recent DMs per conversation on login, 0=off (default: 1)
HIVE_API                 — Override primary Hive node (blank = auto)
MAX_CALL_DURATION_MIN    — Max call length (default: 120)
CALL_COOLDOWN_MS         — Between call attempts (default: 30000)
PAYMENT_VERIFY_RETRIES   — Verification attempts (default: 3)
PAYMENT_VERIFY_DELAY_MS  — Between retries (default: 5000)
PORT                     — Server port (default: 3000)
BIND_HOST                — Bind address (default: 127.0.0.1)
FEDERATION_PEERS         — Comma-separated peer WS URLs (e.g. wss://peer.com/federation).
                           Listed peers are auto-approved on startup. Blank = standalone mode.

# v0.13 additions (planned — not yet built)
LOBBY_NOTICE             — Custom text shown under the lobby title. Blank = auto-generated
                           from SERVER_DOMAIN + "Local lobby — federation via DM/calls".
LOBBY_REQUIREMENTS_TEXT  — Custom text describing posting requirements. Blank = auto-
                           generated from the gate vars below.
LOBBY_POST_MIN_HP        — Minimum Hive Power to post in lobby (e.g. 100). Blank = no HP gate.
LOBBY_POST_MIN_TOKEN     — Minimum custom token to post in lobby (format: SYMBOL:amount,
                           e.g. HIVEBOOK:10). Blank = no token gate.
LOBBY_POST_GATE_MODE     — or | and. Only used when BOTH gates above are set.
                           "or"  = user passes if EITHER HP or token threshold met (default)
                           "and" = user passes only if BOTH HP and token thresholds met
                           Set just HP (token blank) → HP-only gate.
                           Set just token (HP blank) → token-only gate.
```

## Security Assessment (from VS Code review)

### Current Posture: Moderate

**Strengths:** Parameterized SQL queries, encrypted chat storage (ciphertext only), on-chain payment verification with multi-node fallback, escrow-based payment flow, non-root Docker container, HTTPS enforcement, federation domain proof via Hive-key signature.

**Known Weaknesses (accepted for v0.11, fix before high-value production):**

1. **Username spoofing (HIGH):** `lobby-join` trusts client-provided username/pubKey without server-side Hive verification. Doesn't affect payments (verified on-chain) but allows message impersonation.
   - *Fix:* Server-side challenge-response identity verification on join.

2. **No rate limiting (HIGH):** Socket.io connections and messages have no limits. Vulnerable to connection flooding and message spam.
   - *Fix:* Socket.io middleware rate limiter, Nginx connection limits per IP.

3. **No server-side signature verification:** Chat messages carry signatures but the server doesn't verify them — verification happens client-side only.
   - *Fix:* Verify signatures server-side before relaying.

4. **Input validation gaps (MEDIUM):** Usernames, room names, and memos aren't length-limited or character-validated server-side. SQL injection is prevented by parameterization, but malformed data could cause client-side issues.
   - *Fix:* Validate inputs (alphanumeric + limited special chars, max lengths).

5. **Unencrypted SQLite at rest (MEDIUM):** Both databases are unencrypted on disk.
   - *Fix:* Consider SQLCipher for production deployments.

6. **Debug endpoints exposed (LOW):** `/debug-state` and `/debug-rates/*` are publicly accessible.
   - *Fix:* Auth-protect or remove in production.

7. **Escrow key in env var (LOW):** Standard practice but no HSM/vault integration.
   - *Long-term:* Docker secrets or vault integration.

8. **Token balance caching (LOW):** 5-minute TTL could allow stale balance reads.

9. **Federation inbound trust (MEDIUM, federation-specific):** A peer that publishes a valid signed verify.json + Hive announce can connect to any v4call server (subject to operator approval). Once approved, federated peers send presence/DMs/call invites we trust the wire format of. Worst case: an approved-then-malicious peer can inject fake presence (UI noise) or relay tampered ciphertext (recipient detects via signature verification client-side). Cannot steal money — payments are still on-chain verified.

**Not a risk:** CORS/CSRF (WebSocket-based), payment verification (on-chain, robust), encryption (client-side hivecrypt with Hive keys).

## Planned Features (Not Built Yet)

The active development plan, in order. Each version is independently shippable.

### v0.12 — Polish + Diagnose (1–2 sessions)
- Mobile viewport zoom fix (lobby starts zoomed-in on first load)
- Mobile DM panel — currency picker (CNOOBS / token chooser) parity with desktop
- Room joins default to **text-only**; user clicks explicit button to enable cam/mic
- DM preview duplication fix — client-side dedup so reconnects don't append the same message multiple times
- `text-payment-received` event leaking to sender side — investigate + fix
- Discovery scanner returning 0 peers despite Hive having posts:
  - Better logging in `hivePost` helper (currently silently skips nodes that return without `result`)
  - Refresh fallback Hive node list (anyx.io / hived.emre.sh have been intermittent/dead)
  - Verify the request from inside the container

### v0.13 — Lobby Reorganization + Notice + Anti-Spam Gate (1–2 sessions)
- 4-tab lobby layout: **DM / Local Lobby / Active Rooms / Included Rooms**
- "Included Rooms" = rooms you're allowlisted to but not currently in
- Migrate the DM panel into its own tab cleanly (resolves the "DMs mixing into lobby chat" UX issue)
- **Lobby title / notice** — server emits `lobby-config` event on connect with admin-set text:
  - `LOBBY_NOTICE` — short text under the lobby title, makes it clear the lobby is local-server-only ("for federated contacts use rooms / DMs / calls"). Auto-generated from `SERVER_DOMAIN` if blank.
  - `LOBBY_REQUIREMENTS_TEXT` — short text describing the posting gate (auto-generated from the gate vars if blank).
- **Anti-spam gate on lobby posting** — server-side check on `lobby-chat` and `lobby-encrypted`. Three configs:
  - `LOBBY_POST_MIN_HP` — minimum Hive Power required (lookup via `condenser_api.get_accounts` → `vesting_shares` → convert to HP using `dynamic_global_properties.hive_per_vest`). Cached per-user, 5-min TTL like the existing token cache.
  - `LOBBY_POST_MIN_TOKEN` — minimum custom token balance, format `SYMBOL:amount`. Reuses existing `getHiveEngineTokenBalance`.
  - `LOBBY_POST_GATE_MODE` — `or` (default) or `and`. Only relevant when both gates above are set. Set just one to require only that one. Set neither = no gate (current behaviour).
  - Rejection emits a clear error: *"This server requires 100 HP or 10 HIVEBOOK to post. You have 50 HP and 0 HIVEBOOK."* Same shape as existing rate-rejection messages.

### v0.14 — Token-Gated Rooms + Banlist (1 session)
- Room creator can set optional `min_token_balance: { symbol, amount }` gate at room creation
- Server-side join check: allowlisted **OR** token balance ≥ threshold
- Token-gate joiners get a "via TOKEN" badge in the room user list (vs allowlisted users who appear normally)
- **Live-appendable banlist** — admin can ban any user (in-room or by name), banned overrides allowlist + token gate
- Auto-kick currently-in-room user on ban (server emits `kicked` event)
- Banlist visibility toggle: admin chooses at room creation whether banlist is admin-only-visible or visible to all members. Default admin-only.
- **Forward-compat reminder:** when designing per-room state, leave room for a `paidInvitees: Map` alongside `allowlist` and `banlist`. v0.17 (Paid Expert Invites) populates this — keeping the data structure pluggable now means no refactor later.

### v0.15 — Spotlight Room Layout + Admin Delegation (2–3 sessions)
- Centre spotlight tile (active speaker), other participants tiled below
- Admin click-to-promote — moves a tiled user into the spotlight
- Admin role transfer — current admin can hand off to another participant
- Bundle with default-text-mode room joins (already in v0.12) since same UI surface

### v0.16 / federation v0.4 — Cross-Server Rooms (2 sessions)
- Federated room invites — invite cnoobz on hive-book.com to a room on call.completenoobs.com
- Cross-server room join: callee's browser opens temporary cross-server Socket.io to caller's server (same pattern as 1:1 federated calls already work)
- Token-gating works across federation (Hive-Engine balance check is chain-side, peer-agnostic)
- Federation message types added: `room-invite`, `room-response`, `room-ended`
- **Forward-compat reminder:** design `room-invite` as a generic envelope with a free-form `payload` object rather than fixed fields. v0.17 (Paid Expert Invites) reuses this with `payload: { connectFee, ratePerHour, currency, maxDuration, ... }` instead of inventing a separate `paid-room-invite` message type.
- **Forward-compat reminder:** the cross-server room-join flow should track an optional per-user "billing context" alongside the join (null for free invitees, an `activePayments` reference for paid invitees in v0.17).

### v0.17 / federation v0.5 — Paid Expert Invites (2–3 sessions)
**The seed feature.** Reverse the v4call payment direction: instead of "caller pays callee for receiving", the room admin pays an invited expert for joining and contributing. Turns v4call from personal paid comms into paid consulting infrastructure (Clarity.fm / Maven / Intro / Fiverr-Consultations territory). Requires v0.16 federated rooms to land first.

**Locked-in design:**
- **Payer model — admin only.** The room admin pays the expert from their own escrow. Splitting between members deferred (see Deferred section).
- **The invite IS the negotiated contract.** Admin sets `connectFee + ratePerHour + currency + maxDuration` in the invite payload. Expert sees explicit terms before accepting — no surprise rates. Accept = consent to those exact terms; expert's normal rates post is ignored. Optional client helper: pre-fill the offer with the expert's posted rates so admin can negotiate from there.
- **Connect fee billing — bundled with final settlement, NOT charged on join.** The connect fee is added to the bill when the expert joins the room and paid out together with the pro-rated duration cost when the session ends. This protects against accidental disconnects: if the expert drops by mistake and admin re-invites, admin can choose to waive the connect fee on the second invite. (Future toggle: `connect_fee_charged_upfront: bool` if some admins prefer the upfront model — defer.)
- **Termination flows** — voluntary leave / kick / room-end / connection-drop all settle the same way: final bill = connect fee + (actual duration × ratePerHour), capped at `maxDuration × ratePerHour`. 30-second grace period for reconnect (mirrors existing call disconnect handling) before settling.
- **Same-room model** — expert joins as a normal participant with a 💎 "paid expert" badge in the user list. Sees and speaks with everyone. Not a sub-room or special bubble.
- **Federation natural fit** — invite flows via federation `room-invite` (with paid `payload` per the v0.16 forward-compat note). Expert's home server delivers the popup. Cross-server escrow flow already works (admin's server verifies, expert's server disburses to expert + takes its platform fee).
- **Expert UI** — earnings ticker mirroring the existing caller's spend ticker (counts up instead of down). Clear "✓ Accept terms" / "✗ Decline" modal with the explicit rate breakdown.
- **Admin UI** — offer-builder modal at invite time (currency picker, fee fields, max duration), live-spend ticker per paid invitee while session runs.

**Estimated scope:** ~300 lines server (paid invite flow, per-expert escrow tracking, end-of-session settlement), ~150 lines client (offer-builder, accept modal, expert earnings ticker). 2–3 sessions.

**Why this is the seed worth building toward:** paid 1:1 calls (current v4call) compete with WhatsApp + voluntary tipping — hard sell, low values. Paid expert-invites compete with Clarity.fm / Maven / Intro — markets where $50–500/hr is normal, on-chain settlement is a feature (transparent, trustless, instant), and Hive's micropayments are competitive vs. Stripe/PayPal fees. Real wedge.

### Deferred / On Hold
- **Paid lobby posting** (charge per message in lobby) — interesting but operational complexity > value at this stage
- **Paid room creation** (charge fee to create a room) — same reasoning
- **Split-equal expert pay** (v0.17 extension) — N members pre-fund their share before the invite goes out; invite holds until everyone's funded. More coordination friction; defer until single-payer is proven and there's demand.
- **Pay-as-you-add expert pay** (v0.17 extension) — admin invites the expert, individual members opt in to sponsor a share. Most complex of the three payer models; defer.
- **Connect fee charged upfront on accept** (v0.17 toggle) — opposite of the locked-in "bundle with final bill" mode. Some admins may prefer it; add as a per-invite toggle if requested.

### Longer-Term Future Work
- Persistent (non-ephemeral) rooms option
- Per-conversation read tracking (currently per-user last_seen)
- Voice-to-video upgrade mid-call
- STUN/TURN server configuration via .env
- Server-side signature verification
- Rate limiting middleware
- Input validation hardening
- Nostr layer for real-time push (server liveness, broadcasts) — only after federation is otherwise stable

## Resources

- **Deploy guide (wiki):** https://completenoobs.com/index.php/V4call
- **Deploy guide (in-repo):** WalkThrough.wiki
- **Federation spec:** FEDERATION-BUILD-SPEC.md
- **GitHub:** https://github.com/CompleteNoobs/v4call
- **Hive signup:** https://signup.hive.io
- **Hive Keychain:** https://hive-keychain.com
- **Hive-Engine:** https://hive-engine.com
- **TribalDex (token swaps):** https://tribaldex.com/swap
- **Hive API docs:** https://developers.hive.io
