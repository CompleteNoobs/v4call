# v4call — Decentralised Paid Communications

> ⚠️ **WARNING: This project was vibe-coded with Claude Opus 4.6 → 4.7. The author is a tinkerer, not a developer. Use at your own risk — review the code before trusting it with real money.**

Video, audio and text calling with Hive blockchain identity, HBD micropayments, custom Hive-Engine token support, and cross-server federation.

Callers pay to ring. Callees set their own rates. Unused credit is refunded. Everything is on-chain.

**Current version**
- Software **v0.16.6** — Recipient-side rate enforcement for federated paid flows. Federation `dm` and `payment-verified` handlers now re-fetch the recipient's rates post and re-validate (block-list, platform fee minimum, paid amount ≥ required rate) before disbursing — closing the caller-side-trust class of bypasses. On reject, the caller is auto-refunded from the recipient's escrow. The paid-call ring-fee handler now uses OUR computed `ratePerHour` from our copy of the rates post; the caller-server-supplied `msg.ratePerHour` is no longer trusted (was the bypass surface). New design rule #15 added to "Key Design Decisions" — "Recipients enforce their own rules" — applies to all current and future paid flows. Builds on v0.16.5 — Lobby DM bypass fix (removed the `lobby-encrypted` socket event entirely so that bypass class is also closed). No federation protocol bump — both v0.16.5 and v0.16.6 are server-local fixes; new validation only protects callees on a v0.16.6+ server. Production-deployed on [call.completenoobs.com](https://call.completenoobs.com) ↔ [hive-book.com](https://hive-book.com) ↔ [v4call.com](https://v4call.com).
- Federation protocol **v0.4** — unchanged in v0.16.5 / v0.16.6 (both are server-local fixes, no wire-format changes). v0.4 introduced `room-invite` / `room-response` envelopes (generic `payload: {}` for forward-compat with v0.17 paid expert invites) plus an explicit `protocol_version: '0.4'` field in the hello, so older v0.3 peers continue to federate fully for everything they could do at v0.3. Cross-server room *join* itself reuses the existing direct browser↔host-server Socket.io transport (same as 1:1 federated calls) — no extra federation envelope for the join.

**Key features**
- Voice-only and video calls with separate rate tiers
- Encrypted direct messages with persistent chat history (server only sees ciphertext)
- Custom token payments (any Hive-Engine token — CNOOBS, PIZZA, etc.)
- **Pay in BTC, DOGE, ETH, LTC, and more** via the SWAP.* family on tribaldex.com (SWAP.BTC, SWAP.DOGE, SWAP.ETH, SWAP.LTC, etc. — 1:1 wrapped tokens on Hive-Engine, work as v4call payment currencies out of the box; no v4call code change needed). Counterparty risk via the wrapper service is the trade-off; minimum withdrawal back to native chain is non-trivial (e.g. 0.01 SWAP.BTC). Verified working in v4call testing 2026-05-04.
- Payment option picker — callers choose which currency to pay with
- Free-market platform fees — servers set minimums, users shop around
- Hive Keychain login — no key paste needed
- **Mobile UI** — bottom-tab nav, full-width single column on phones
- **Federation** — cross-server presence, paid DMs, voice/video calls, custom token payments
- **Operator tools** — signed verify file generator, on-chain server announcer, peer admin UI

---

## Two Ways to Use v4call

**1. Use a hosted v4call server (zero capital, zero hosting)**

Sign up free with your Hive account in seconds. The server operator takes a small platform fee (typically 5–15%) from your *received* payments only — never from you, only from what callers pay you. Free calls and DMs cost nothing. Best for casual users.

**2. Run your own server (keep 100% of your earnings)**

From **$6/month for a VPS** you keep 100% of your call fees (`DEFAULT_PLATFORM_FEE=0`). Best for high-volume users — pays for itself at any meaningful earning level. One small one-time setup: stake a little Hive Power on your escrow account (or get a friend to delegate ~50 HP) so it can broadcast payouts on-chain.

**Honest scaling math:**

| Annual call earnings | On a 10% server | On your own server | Annual saving |
|---|---|---|---|
| $600 | $60 | ~$72 hosting + ~$25 one-time HP | break-even year 1, $60/yr after |
| $6,000 | $600 | ~$72/yr | **~$528/yr** |
| $60,000 (consultant tier) | $6,000 | ~$72/yr + ~$200 in HP | **~$5,800/yr** |

Hive blockchain transactions themselves are **free** (no per-tx cost like Bitcoin/Ethereum). The only ongoing cost on your own server is the VPS hosting + maintaining enough Hive Power on the escrow account to cover transaction Resource Credits.

---

## Full Deploy Guide

**New to self-hosting?** Follow the complete step-by-step walkthrough:

**[→ Deploy v4call v0.11 on Ubuntu 24.04 with Docker](https://www.completenoobs.com/noobs/V4call-v0.11)**

(The v0.11 walkthrough remains accurate for v0.12 — same deploy steps, same `.env` shape, same `docker compose down && docker compose build --no-cache && docker compose up -d` rebuild cycle.)

The guide covers everything from creating a VPS to a working HTTPS server with federation enabled — no coding knowledge required.

A copy lives in this repo too: [WalkThrough.wiki](WalkThrough.wiki).

For project context (architecture, design decisions, dev plan): [CLAUDE.md](CLAUDE.md). For federation protocol spec: [FEDERATION-BUILD-SPEC.md](FEDERATION-BUILD-SPEC.md).

---

## Quick Start (Docker)

### Requirements
- A VPS with Docker and Docker Compose installed (Vultr $6/mo plan works)
- A domain name pointing to your server
- A Hive account for your server identity
- A separate Hive account for escrow (holds caller funds during calls)
- ~50 HP staked or delegated on the escrow account (for transaction Resource Credits)
- Hive Keychain browser extension (for login and payments)

### 1. Clone and configure

```bash
git clone https://github.com/CompleteNoobs/v4call
cd v4call
cp .env.example .env
nano .env
```

Fill in all values in `.env`:

```env
# ── Server Identity ──────────────────────────────────────
SERVER_NAME=yourcallapp
SERVER_DOMAIN=call.yourdomain.com
SERVER_HIVE_ACCOUNT=yourhiveaccount
ESCROW_ACCOUNT=yourescrowaccount
V4CALL_ESCROW_KEY=5Kxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ADMIN_KEY=make-up-a-long-random-string

# ── Platform Fee ─────────────────────────────────────────
# Minimum % your server takes from paid calls/DMs (10 = 10%)
# Set to 0 if you're the only user on your own server.
DEFAULT_PLATFORM_FEE=10

# ── Chat Storage ─────────────────────────────────────────
DM_RETENTION_DAYS=33          # days to keep DMs (cleanup runs hourly)
ROOM_RETENTION_DAYS=33        # days to keep room messages
DM_PREVIEW_COUNT=1            # recent DMs per conversation on login (0 = off)

# ── Network ──────────────────────────────────────────────
PORT=3000
BIND_HOST=127.0.0.1

# ── Federation (optional) ────────────────────────────────
# Comma-separated peer v4call server WebSocket URLs.
# Listed peers are auto-approved on startup. Blank = standalone mode.
# See WalkThrough.wiki Step 17 for full federation setup.
FEDERATION_PEERS=
```

### 2. Configure Nginx

Edit `nginx/v4call.conf` — replace all occurrences of `v4call.com` with your domain. The shipped config includes the `/federation` location block needed for cross-server traffic.

### 3. Build and get SSL

```bash
# Start with HTTP only first (needed for Certbot verification)
docker compose up -d --build

# Get your SSL certificate
docker compose run --rm \
  --entrypoint certbot \
  certbot certonly \
  --webroot \
  -w /var/www/certbot \
  -d yourdomain.com \
  --email your@email.com \
  --agree-tos \
  --no-eff-email

# Update nginx/v4call.conf to enable HTTPS, then:
docker compose restart nginx
```

### 4. Done

Your v4call server is running at `https://yourdomain.com`

**Important:** After any code changes, always use the full rebuild cycle:
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### 5. Optional — Federate with other v4call servers

Visit `https://yourdomain.com/server-sign.html` to generate your signed verify file, then `https://yourdomain.com/server-announce.html` to publish your server to the on-chain directory. Manage peers at `https://yourdomain.com/admin-peers.html`. Full guide in [WalkThrough.wiki](WalkThrough.wiki) Step 17.

---

## Features

### Login Options

Two ways to sign in:
- **Hive Keychain** (recommended on desktop) — no key paste needed. Keychain signs a challenge to prove identity. A 🔑 panel in the lobby lets you optionally enter your posting key to unlock encrypted messaging.
- **Manual posting key** — paste your Hive posting private key directly. Stays in browser session memory only.

**iPhone / iPad note:** iOS Safari and iOS Brave (also WebKit) do not allow browser extensions that inject `window.hive_keychain` into web pages. The Hive Keychain *mobile app* exists but cannot talk to web pages the way the desktop extension does. **Free** calls, DMs, presence, and federation work fine on iPhone — but **paid** actions (paid DMs, paid calls, custom-token payments) need a desktop browser with the Hive Keychain extension installed. A HiveSigner-based fallback for iOS is on the longer-term roadmap.

### Voice and Video Calls

Each online user shows three action buttons:
- 📞 **Green phone** — voice-only call (audio, no camera)
- 🎥 **Blue camera** — video call (audio + camera)
- 💬 **Purple chat bubble** — direct message

Separate rates can be set for voice and video in the rates post. Federated users (on a different v4call server) appear in the lobby with a small server-domain badge — calling/DMing them works the same way.

**In-room media controls:** Once you're in a room (1:1 call or multi-party room), three buttons in the chat header let you toggle your own devices on the fly:

- 🎤 **Enable Mic / Disable Mic** — full release on disable, so the browser's microphone indicator actually goes away (not a soft mute). Re-enable re-acquires the device.
- 🎥 **Enable Cam / Disable Cam** — same pattern; the camera light turns off when disabled.
- 🖥️ **Share Screen / Stop Sharing** (v0.15) — `getDisplayMedia()` flow. Mutually exclusive with cam (cam stops automatically when sharing starts; cam button greys out until you stop). Click `🖥️ Stop Sharing` or use the browser's own "Stop sharing" floating bar — both reset the toolbar correctly. Auto-pins your tile to your local spotlight so you see your share clearly. iOS Safari/Brave doesn't support `getDisplayMedia` — clicking the button on iOS posts a clear "not supported" message instead of crashing.

Room joins (knock, accept invite, room creation) default to **text-only** — no camera/mic prompt until you click one of the toggle buttons. **Text-only and voice-only joiners now correctly receive existing peers' video and audio** (a long-standing WebRTC SDP bug fixed in v0.15).

### Direct Messages

- End-to-end encrypted using Hive posting keys — server stores only ciphertext
- Stored for up to `DM_RETENTION_DAYS` (default 33 days) with hourly cleanup
- Both sender and recipient get their own encrypted copy for history retrieval
- Unread alert popup on login showing message count and senders
- Preview of recent DMs loaded into lobby on login (configurable via `DM_PREVIEW_COUNT`)
- Full conversation history loaded on demand when opening a DM panel
- Cross-server DMs work for both free and paid messages (recipient's server re-verifies on-chain)

### Custom Token Payments

- Users can accept any Hive-Engine token (e.g. CNOOBS, PIZZA) via `[TOKEN:SYMBOL]` sections in their rates post
- Server checks caller's token balance via Hive-Engine API automatically
- When multiple payment options qualify, a **currency picker** shows all options with balances
- Token transfers use Keychain `custom_json` (Hive-Engine sidechain)
- Escrow account must hold the accepted tokens for payouts and refunds

**Creating your own token is cheap and works everywhere v4call accepts a Hive-Engine token.** As of writing, Hive-Engine charges a flat **100 BEE** to create a new token (≈ 62 HIVE at the time of this note — check the current BEE/HIVE rate at [tribaldex.com](https://tribaldex.com/swap) or [hive-engine.com](https://hive-engine.com); recent real-world cost was about £5 / $6 USD when CNOOBS was minted). Once minted, the token works as:
- a payment currency in your `v4call-rates` post (`[TOKEN:SYMBOL]` block)
- the `LOBBY_POST_MIN_TOKEN` anti-spam gate (server operators)
- the `tokenGate: { symbol, amount }` for token-gated rooms (room creators)
- the `ALLOW-IF-TOKEN` bypass for blocked-list overrides

This is a real wedge for creator economies: stake your token, distribute it to your community, then run a server (or use one) where holders get paid access / posting rights / room access via on-chain balance checks.

### Platform Fee System

- Server sets `DEFAULT_PLATFORM_FEE` in `.env` — this is the **minimum** fee
- Users set `PLATFORM-FEE` in their rates post — this is the **maximum** they'll pay
- If the user's fee is **below** the server minimum → paid contacts are **rejected** with a clear message
- If the user's fee **meets or exceeds** the minimum → server charges **its own rate** (best price for the user)
- No fee line in rates post → server default is used automatically
- Free contacts are never affected by fee enforcement

### Rooms

- Private rooms with allowlist-based access
- **Token-gated rooms (v0.14):** Optionally allow non-allowlisted users to join if they hold ≥ N of a Hive-Engine token. Set at room creation (off by default). Holders who join via the token gate get a `via SYMBOL` badge in the user list so admins can tell at a glance how each member got in.
- **Live admin banlist (v0.14):** Room creator can ban any user (in-room or by name). Bans override allowlist + token gate, auto-kick if currently in the room, and persist for the room's lifetime. Per-room visibility toggle at creation: admin-only (default) or visible to all members.
- **Room export / import as `.v4room` files (v0.14.5):** Any room member can click `📥 Export` to download a snapshot of the room — metadata + every ciphertext message — as `<roomname>@<source-domain>__<ISO-timestamp>.v4room`. Any user can `📤 Import` it back on the same or a different v4call server (lobby → JOIN BY NAME panel). Importer becomes the new admin; allowlist + token gate + banlist + visibility are preserved. Encryption is preserved — anyone can hold the file but only original key-holders can decrypt their addressed messages. Lets you opt into persistence without changing the server's ephemeral default.
- **Spotlight room layout (v0.15):** One large spotlight tile + horizontal strip of peer thumbs (replaces the equal-size vertical column). Click any tile to **pin it locally** to your own view — your pin is private and survives reconnects. Strip is hidden in solo rooms.
- **Admin spotlight broadcast (v0.15):** Room admin sees a `📌` button next to every member in the room user-list. Click → that member is broadcast as the room-wide spotlight target. **Soft override:** users who have manually pinned someone else keep their pin and see a `↺ Follow room spotlight` button — admin influences, never overrides. New joiners get the current spotlight automatically. Spotlight clears if the spotlit user leaves.
- **Admin role transfer (v0.15):** Admin sees a `👑` button next to every other current member. Click → confirm dialog → that member becomes admin (gets End Room, ban controls, allowlist edits, spotlight broadcast). Previous admin demoted instantly across all clients.
- Encrypted messaging and WebRTC video/voice
- Room history replayed to new joiners (broadcasts in full, encrypted messages only if addressed to them)
- Ephemeral — when the last person leaves, the room and all its stored messages are deleted

### Federation

- Multiple v4call servers see each other's online users via a federation WebSocket on `/federation`
- Each server publishes a Hive-key-signed `/.well-known/v4call-server.json` proving domain ownership
- Each server publishes a `v4call-server` tagged Hive post advertising itself in the on-chain directory
- Discovery scanner finds peers; operator approves via `/admin-peers.html`
- Cross-server calls: caller's server hosts the room, callee's browser opens a temporary cross-server connection for WebRTC signalling. Media stays peer-to-peer.
- Cross-server payments: caller pays callee's escrow on Hive directly. Callee's server (which holds the escrow key) handles all disbursement — including refunds back to the cross-server caller.
- **Cross-server rooms (v0.4, v0.16):** admin types `@user@peer.com` into a room's allowlist; server validates the peer is approved + on protocol_version ≥ 0.4 and sends `room-invite` over federation. Receiving server delivers a popup with a source-server badge; accept opens a temp Socket.io to the host server and the user joins as a real participant (multi-party WebRTC, federated token-gating, banlist auto-kick by canonical `user@server` form, federated badge in user-list + tile labels). Federation peer drop while a federated user is mid-room → host server immediately evicts them.

### Mobile

Responsive layout collapses three columns into a full-width single-column with a fixed bottom-tab nav at `≤720px`. Lobby tabs: USERS / CHAT / ROOMS. Room tabs: VIDEO / CHAT / MEMBERS. Includes `safe-area-inset-bottom` padding for notched phones.

---

## Operator Tool Pages

Standalone HTML pages bundled with v4call. Each signs with the operator's Hive key client-side via Keychain — keys never reach the server.

| URL | Purpose |
|-----|---------|
| `/rate-editor.html` | Generate your `v4call-rates` Hive post (V1 / V2 formats) |
| `/server-sign.html` | Generate your signed `/.well-known/v4call-server.json` |
| `/server-announce.html` | Publish your `v4call-server` Hive post to the federation directory |
| `/admin-peers.html` | Federation peer admin: discover, approve, revoke |
| `/info.html` | Public landing page (shown to non-authenticated visitors when basic-auth is enabled) |

---

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_NAME` | `v4call` | Display name for your server |
| `SERVER_DOMAIN` | `v4call.com` | Your server's domain |
| `SERVER_HIVE_ACCOUNT` | `v4call` | Hive account that receives platform fees + signs federation verify file |
| `ESCROW_ACCOUNT` | `v4call-escrow` | Hive account that holds funds. Active key MUST live on this server. |
| `V4CALL_ESCROW_KEY` | *(none)* | Active private key for escrow. **Required.** |
| `ADMIN_KEY` | *(none)* | Password for admin endpoints (`/admin/*`) |
| `DEFAULT_PLATFORM_FEE` | `10` | Server's minimum platform fee (%). Set to `0` to take nothing. |
| `FEDERATION_PEERS` | *(blank)* | Comma-separated peer WS URLs (e.g. `wss://peer.com/federation`). Auto-approved on startup. Blank = standalone mode. |
| `DM_RETENTION_DAYS` | `33` | Days to keep stored DMs |
| `ROOM_RETENTION_DAYS` | `33` | Days to keep stored room messages |
| `DM_PREVIEW_COUNT` | `1` | Recent DMs per conversation on login (0 = off) |
| `HIVE_API` | *(blank)* | Override Hive API node (blank = auto-select from built-in list) |
| `MAX_CALL_DURATION_MIN` | `120` | Max call length before auto-disconnect |
| `CALL_COOLDOWN_MS` | `30000` | Cooldown between call attempts |
| `PAYMENT_VERIFY_RETRIES` | `3` | Payment verification retry attempts |
| `PAYMENT_VERIFY_DELAY_MS` | `5000` | Delay between verification retries |
| `LOBBY_NOTICE` | *(blank)* | Custom text under lobby title — auto-generated from `SERVER_DOMAIN` if blank |
| `LOBBY_REQUIREMENTS_TEXT` | *(blank)* | Custom posting requirements text — auto-generated from gate vars if blank |
| `LOBBY_POST_MIN_HP` | `0` | Minimum *owned, staked* Hive Power (vesting_shares × hive_per_vest). 0 or blank = no HP gate. Delegated-in HP doesn't count. |
| `LOBBY_POST_MIN_HIVE` | `0` | Minimum *liquid* HIVE balance (the spendable wallet balance, not staked HP). 0 or blank = no liquid-HIVE gate. |
| `LOBBY_POST_MIN_TOKEN` | *(blank)* | `SYMBOL:amount` (e.g. `HIVEBOOK:10`) — minimum Hive-Engine token balance to post. Blank = no token gate. |
| `LOBBY_POST_GATE_MODE` | `or` | `or` (default) or `and` — combine the gates when 2+ are set. Doesn't gate DMs or calls. |

---

## Admin & Debug Endpoints

```
# Debug — no auth required
GET  /debug-state                                    # Current lobby users and rooms
GET  /debug-rates/USERNAME                           # Parsed rates for a user
GET  /debug-rates/USERNAME?caller=CALLER&type=voice  # Rates for a specific caller (checks tokens)

# Admin — requires ADMIN_KEY
GET  /admin/ledger?key=YOUR_ADMIN_KEY                # Payment ledger
GET  /admin/ledger?key=YOUR_ADMIN_KEY&call_id=ID     # Specific call details
GET  /admin/balance?key=YOUR_ADMIN_KEY               # Escrow HBD balance

# Federation peer admin — requires ADMIN_KEY
GET  /admin/peers?key=YOUR_ADMIN_KEY                 # Discovered + approved peers
POST /admin/peers/approve?key=YOUR_ADMIN_KEY&domain=peer.com
POST /admin/peers/revoke?key=YOUR_ADMIN_KEY&domain=peer.com
POST /admin/peers/rescan?key=YOUR_ADMIN_KEY          # Force a Hive directory rescan
GET  /admin/discovery-test?key=YOUR_ADMIN_KEY        # Per-Hive-node raw response + cached peer list (diagnostic)
```

---

## User Setup (Callers and Callees)

### Setting your call rates (callees)

1. Go to `https://yourdomain.com/rate-editor.html`
2. Set your rates per time window and list
3. Set `PLATFORM-FEE` to at least the server's minimum (e.g. `10` for 10%)
4. Optionally add `[TOKEN:SYMBOL]` sections for custom token rates
5. Click **Post to Hive** (requires Hive Keychain)

Example V2 rates post with a custom token:
```
[V4CALL-RATES-V2]
ACCOUNT:yourusername
SERVER:yourdomain.com
CHAIN:hive
PLATFORM-FEE:10%
ESCROW:your-escrow-account

[TOKEN:CNOOBS]
ALLOW-BLOCKED:yes
TEXT:1
VOICE:RING:1;CONNECT:1;RATE:33/hr;MIN-DEPOSIT:10min
VIDEO:RING:1;CONNECT:1;RATE:33/hr;MIN-DEPOSIT:10min
[/TOKEN]

[LIST:default]
[DAYS:mon-sun][TIME:00:00-23:59]
TEXT:0.100
VOICE:RING:0.100;CONNECT:0.500;RATE:2.000/hr;MIN-DEPOSIT:10min
VIDEO:RING:0.200;CONNECT:1.000;RATE:5.000/hr;MIN-DEPOSIT:10min
[/TIME]
[/LIST]
[/V4CALL-RATES-V2]
```

**Important — escrow must match the server you're using.** The `ESCROW:` field declares where callers should pay. The active key for that account must live on the v4call server you're logged in on. Mismatch = paid calls fail because the destination server can't disburse from an escrow it doesn't own.

### Making calls (callers)

1. Log in with Hive Keychain or your posting key
2. Click 📞 (voice), 🎥 (video), or 💬 (DM) next to any online user
3. If payment is required, choose your preferred currency and approve via Keychain
4. Call connects — unused credit refunded at call end

---

## Architecture

```
   Browser (caller)  ──────WebRTC P2P (encrypted)──────►  Browser (callee)
        │                                                       │
        │ Socket.io                                             │ Socket.io
        ▼                                                       ▼
   Caller's server.js                            Callee's server.js
        │
        ├── Hive blockchain (identity, rates, payments)
        ├── Hive-Engine API (custom token balances + transfers)
        ├── SQLite: v4call-ledger.db (payments — server writes only)
        ├── SQLite: v4call-chat.db (encrypted DMs + room messages — separate for security)
        ├── Escrow Hive account (holds HBD + tokens during calls)
        ┊
        ┊──── Federation WebSocket (/federation) ────────────►
        ▼                                                     ▼
   Federation peer servers (presence, DMs, calls, payment-verified, call-ended)
```

**Compatibility note (untested):** v4call uses Hive blockchain APIs throughout (`@hiveio/dhive`, `condenser_api.*`, `hivecrypt`, Hive-Engine sidechain). Steem and Hive share a common ancestor and largely-compatible RPC schemas, so v4call *should* be portable to Steem (steemit.com) with API endpoint changes — `https://api.hive.blog` → a Steem RPC node, plus matching adjustments for any chain-specific calls. **Not tested on Steem** — the author doesn't have a Steem account to verify. Pull requests welcome from anyone interested in running v4call on the Steem chain.

---

## Viewing the Databases

```bash
# Payment ledger
sqlite3 data/logs/v4call-ledger.db
.headers on
.mode column
SELECT * FROM calls ORDER BY id DESC LIMIT 20;
SELECT * FROM payments ORDER BY id DESC LIMIT 20;
SELECT status, COUNT(*) FROM calls GROUP BY status;
.quit

# Chat storage
sqlite3 data/logs/v4call-chat.db
.headers on
.mode column
SELECT * FROM dm_messages ORDER BY id DESC LIMIT 20;
SELECT * FROM room_messages ORDER BY id DESC LIMIT 20;
SELECT username, last_seen FROM user_seen;
.quit

# Federation approvals (just JSON)
cat data/logs/approved-peers.json
```

---

## Customising Your Fork

All text, colours and branding are in `public/index.html`. Search for `v4call` to find all instances of the brand name.

The four standalone operator pages (`rate-editor.html`, `server-sign.html`, `server-announce.html`, `admin-peers.html`) are deliberately separate — they're tools used outside normal user sessions. Each can be rebranded independently.

Key variables in `.env`:
- `SERVER_NAME` — shown in the page title and header logo
- `SERVER_DOMAIN` — your domain
- `SERVER_HIVE_ACCOUNT` — where platform fees go
- `DEFAULT_PLATFORM_FEE` — your server's minimum fee percentage
- `FEDERATION_PEERS` — peer servers you want to federate with

Forks are encouraged. v4call's federation protocol is open — any implementation that speaks the protocol can federate with v4call instances. Multiple implementations strengthen the ecosystem the same way Bitcoin's multi-implementation model does.

---

## Roadmap

The active development plan, in order. Each version ships independently. Full detail in [CLAUDE.md](CLAUDE.md) "Planned Features".

| Version | Scope |
|---------|-------|
| ~~**v0.12**~~ ✅ shipped | Polish: iOS zoom, mobile DM picker layout, room joins default to text-only with mid-room 🎤/🎥 enable + WebRTC renegotiation, DM dedup, paid-DM currency badge fix, discovery scanner repaired (Hive `limit` cap), `/admin/discovery-test` diagnostic |
| ~~**v0.13**~~ ✅ shipped | 4-tab lobby (DM / Local Lobby / Active Rooms / Included Rooms) + DM panel relocated + server-driven lobby notice + anti-spam gate (HP / liquid HIVE / Hive-Engine token, configurable OR/AND) + mid-room mic/cam toggles (full release on disable) + 🖥️ Share Screen button placeholder for v0.15 |
| ~~**v0.14**~~ ✅ shipped | Token-gated rooms (allowlist OR Hive-Engine balance) + "via TOKEN" badges + live admin banlist (overrides everything; auto-kicks; per-room visibility toggle) + forward-compat `paidInvitees: Map` for v0.17 |
| ~~**v0.14.5**~~ ✅ shipped | Room export / import (`.v4room` JSON files) + fixed long-standing CSS bugs in room-exit UI (Leave Room / Pop out / End Room buttons now visible; End Call no longer always-on) |
| ~~**v0.15**~~ ✅ shipped | Spotlight room layout (large spotlight + horizontal peer strip) + local pin (any user) + admin spotlight broadcast (📌, soft override with `↺ Follow room spotlight` for users with a local pin) + admin role transfer (👑) + 🖥️ Share Screen wired up (replaceTrack for in-place swap, addTrack + renegotiate fallback, browser "Stop sharing" sync via `track.onended`, iOS gracefully shows "not supported") + WebRTC SDP m-line fix so text-only / voice-only joiners actually receive existing peers' video and audio |
| ~~**v0.16 / fed v0.4**~~ ✅ shipped | Cross-server rooms end-to-end. `room-invite` / `room-response` federation envelopes (generic `payload: {}` for v0.17 forward-compat) + `protocol_version: '0.4'` hello gate (v0.3 peers keep working for DMs/calls/presence/payments). Federated allowlist input `@user@peer.com`, lobby user-picker resolution for federated users, cross-server room join via temp Socket.io (mirrors 1:1 federated calls), federated badge in user-list + tile labels, federated token-gating (chain-side balance check, peer-agnostic), banlist auto-kick by canonical `user@server` form, federation peer drop → immediate eviction. Plus XSS hygiene pass: dynamic inline onclicks replaced by `data-action` event delegation. |
| ~~**v0.16.5**~~ ✅ shipped | Lobby DM bypass fix. Removed `lobby-encrypted` socket event entirely (was bypassing paid-DM rates, blocked-list, platform fee minimum, currency / token-gate / time-window rules — including over federation as free `dm` envelopes with `textPaid: 0`). Lobby chat is now broadcast-only; user-list toggle single-purpose for "Create Room" invite. Server keeps a deprecation stub for stale clients. No federation protocol bump. |
| ~~**v0.16.6**~~ ✅ shipped | Recipient-side rate enforcement — federation `dm` and `payment-verified` handlers re-fetch recipient's rates + re-validate block-list / fee minimum / paid amount ≥ required rate before disbursing; auto-refund the caller from our escrow on reject. Ring-fee handler uses OUR computed `ratePerHour` instead of caller-server-supplied claim (closes the bypass surface). New design rule #15: "Recipients enforce their own rules." No protocol bump. |
| **v0.17 / fed v0.5** | **Paid Expert Invites** — admin pays an invited expert to join a room; reverses the v4call payment direction. Locked-in design: inviter holds the funds (NOT expert) to prevent escrow rug-pull; admin-only payer for first build; one paid offer at a time per inviter. The seed feature. |

Deferred (interesting but not blocking): paid lobby posting, paid room creation, split-payer expert invites.

---

## License

MIT — see [LICENSE](LICENSE) for full text.

---

## Resources

- **Deploy walkthrough:** https://www.completenoobs.com/noobs/V4call-v0.11
- **In-repo deploy guide:** [WalkThrough.wiki](WalkThrough.wiki)
- **Project context:** [CLAUDE.md](CLAUDE.md)
- **Federation protocol spec:** [FEDERATION-BUILD-SPEC.md](FEDERATION-BUILD-SPEC.md)
- **GitHub:** https://github.com/CompleteNoobs/v4call
- **Hive signup:** https://signup.hive.io
- **Hive Keychain:** https://hive-keychain.com
- **Hive-Engine:** https://hive-engine.com
- **TribalDex (token swaps):** https://tribaldex.com/swap
- **Hive API docs:** https://developers.hive.io
