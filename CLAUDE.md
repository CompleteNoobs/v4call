# CLAUDE.md — v4call Project Context

> **⚠️ This project was vibe-coded with Claude Opus 4.6. The author is a tinkerer, not a developer. Use at your own risk — review the code before trusting it with real money.**

## What This Is

v4call is a decentralised paid video, voice, and text communication platform built on the Hive blockchain. Users set their own rates for receiving calls and messages. Callers pay with HBD or custom Hive-Engine tokens. Unused credit is refunded automatically. The server operator earns a platform fee from each paid interaction.

**The core idea:** I don't want strangers ringing my phone for free. If they value my time, they can pay. If not, my phone doesn't ring. Family and friends get custom rules — free calls, different hours, different rates.

## Current Version

**v0.1** — concept/testing phase. Single-server deployment. Not yet federated.

## Tech Stack

- **Backend:** Node.js, Express, Socket.io, better-sqlite3
- **Frontend:** Single HTML file (`public/index.html`) — all HTML, CSS, and JS in one file
- **Blockchain:** @hiveio/dhive for Hive API, hivecrypt for posting-key encryption
- **External APIs:** Hive blockchain (identity, rates, HBD payments), Hive-Engine API at `https://api.hive-engine.com/rpc/contracts` (token balances, transfers)
- **WebRTC:** Peer-to-peer audio/video via browser APIs, STUN via Google's public server
- **Deployment:** Docker (node:20-alpine), Nginx reverse proxy, Let's Encrypt SSL
- **Databases:** Two separate SQLite files in `/app/logs/` (mounted as `./data/logs/`)

## File Map

```
server.js                  — All backend logic: socket handlers, rate parsing, payment
                             verification, escrow disbursement, chat storage, room management
public/index.html          — Entire frontend: login, lobby, rooms, calls, DMs, payment modals
public/rate-editor.html    — Rate post builder (generates V1/V2 rates posts for Hive)
public/info.html           — Getting started guide for new users
Dockerfile                 — node:20-alpine, runs as user node (UID 1000)
docker-compose.yml         — app + nginx + certbot services
nginx/v4call.conf          — HTTPS config, WebSocket proxy, optional basic auth
.env                       — All server config (never committed)
```

**Do not split index.html into separate files.** The entire frontend lives in one file. This is intentional.

## Architecture

```
Browser (caller)  ──WebRTC──►  Browser (callee)
       │                              │
       │ Socket.io                    │ Socket.io
       ▼                              ▼
  server.js (signalling only — media is peer-to-peer)
       │
       ├── Hive blockchain API (identity, rates, HBD payments)
       ├── Hive-Engine API (custom token balances + transfers)
       ├── SQLite: v4call-ledger.db (payments — server writes only)
       ├── SQLite: v4call-chat.db (encrypted DMs + room messages — separate for security)
       └── Escrow Hive account (holds HBD + tokens during calls)
```

## Features (What's Built and Working)

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
- **Ephemeral warning banner:** Shown at top of every room
- **Custom token payments:** Any Hive-Engine token via [TOKEN:SYMBOL] sections in rates post
- **Payment picker:** When multiple currencies qualify, caller sees all options with balances and chooses
- **Token transfers:** Uses Keychain requestCustomJson for Hive-Engine sidechain operations
- **Token verification:** Balance-check verification (not transferHistory — that API doesn't work reliably)
- **Platform fee enforcement:** Server sets minimum (DEFAULT_PLATFORM_FEE), user's rates post sets their willingness. If user's fee < server minimum → rejected with message. If user's fee >= minimum → server charges its own rate (best price for user)
- **Rate system:** V1 and V2 formats, named lists (family/friends/work/default), time windows, day-of-week, blocked users, ALLOW-IF-TOKEN bypass, per-token rate sections
- **Payment flow:** Ring fee → connect fee → duration deposit. Unused credit refunded. Platform fee deducted. All verified on-chain before proceeding.
- **Call types:** Voice and video have separate rate tiers in the rates post
- **Tooltips:** SVG icon buttons with CSS hover tooltips

## Key Design Decisions

1. **Separate databases:** v4call-chat.db is separate from v4call-ledger.db. If chat storage is exploited, the payment ledger is untouched. Only the server writes to the ledger.

2. **Platform fee is a minimum, not a fixed rate:** Server operators compete on fees. Users shop around. This enables a free market when federation arrives.

3. **Encryption uses Hive posting keys via hivecrypt:** This means Keychain login users need to enter their posting key separately for encryption. There's no workaround — Keychain deliberately never exposes private keys.

4. **Hive-Engine API is at `/rpc/contracts`:** The old endpoint `/contracts` returns HTML and is dead. This was a painful debugging session. Do not change this URL.

5. **Token payment verification uses balance checks, not transfer history:** The Hive-Engine `transferHistory` table is not reliably queryable via the contracts RPC. Instead, we verify that the escrow account's token balance is sufficient. The payment was already signed via Keychain.

6. **`docker compose down` is required before rebuilding:** Without this, Docker reuses the old container even after `docker compose build --no-cache`. This caused hours of debugging where changes weren't taking effect.

7. **Rooms are ephemeral:** When the last person leaves, the room and all its stored messages are deleted from the database. This is deliberate — rooms are not meant to persist.

8. **All three buttons (voice, video, DM) use inline SVG icons:** No image files, no emoji. The SVGs inherit colour from CSS via `stroke="currentColor"`.

## Known Gotchas and Debugging Tips

- **Changes not appearing after deploy:** Always `docker compose down && docker compose build --no-cache && docker compose up -d`. Never just `docker compose restart`.
- **Hive-Engine balance check returning 0:** Check the API URL is `https://api.hive-engine.com/rpc/contracts` not the old `/contracts` endpoint.
- **Token symbol case sensitivity:** The symbol in the rates post must match Hive-Engine exactly (usually all uppercase).
- **SQLite permission errors:** The app runs as UID 1000 inside Docker. Fix with `chown -R 1000:1000 ./data/logs/` on the host.
- **Certbot failing:** Must use `--entrypoint certbot` flag or Docker runs the renewal loop instead of `certonly`.
- **Nginx cert crash loop:** Never put HTTPS config in nginx before the cert exists. Start HTTP-only, get cert, then add HTTPS.
- **Sign error on login:** The `hivecrypt` library needs the posting key as a string. Keychain mode doesn't have this, so signing falls back to `requestSignBuffer`.

## Coding Style

- **CSS:** Use the existing CSS variables from `:root` — `--bg`, `--surface`, `--accent`, `--green`, `--blue`, `--purple`, `--text`, `--subtext`, `--muted`, `--border`, `--danger`
- **Fonts:** IBM Plex Mono for UI elements/labels, IBM Plex Sans for body text
- **Theme:** Dark theme throughout, never light
- **HTML:** Keep everything in `public/index.html`. Do not split into separate JS/CSS files.
- **Button styling:** 24x24px rounded circles with coloured borders and backgrounds. Green = voice, Blue = video, Purple = DM.
- **Modals:** Fixed overlay with backdrop blur, z-index 2000-3000
- **System messages:** Use `addLobbyMsg({type:'system', text:'...'})` or `addSystemMsg('...')` for room messages

## .env Variables

```
SERVER_NAME              — Display name (default: v4call)
SERVER_DOMAIN            — Domain (default: v4call.com)
SERVER_HIVE_ACCOUNT      — Receives platform fees
ESCROW_ACCOUNT           — Holds funds during calls
V4CALL_ESCROW_KEY        — Active private key for escrow (REQUIRED, never log)
ADMIN_KEY                — Password for /admin/* endpoints
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
```

## Security Assessment (from VS Code review)

### Current Posture: Moderate

**Strengths:** Parameterized SQL queries, encrypted chat storage (ciphertext only), on-chain payment verification with multi-node fallback, escrow-based payment flow, non-root Docker container, HTTPS enforcement.

**Known Weaknesses (accepted for v0.1, fix before production):**

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

**Not a risk:** CORS/CSRF (WebSocket-based), payment verification (on-chain, robust), encryption (client-side hivecrypt with Hive keys).

## Planned Features (Not Built Yet)

### Federation (v0.2+)
- Multiple v4call servers discover each other and share user presence
- Cross-server calls and DMs
- Identity verified on Hive (same chain), rates from Hive posts
- Payment flows through callee's server escrow
- Key open questions: payment routing (whose platform fee on cross-server calls?), WebRTC signalling relay, trust between servers, user "home server" assignment
- Start with hardcoded peers in .env (`FEDERATION_PEERS`), add Nostr discovery later
- Domains ready: callpayu.com, phonepayu.com

### Nostr Integration (future)
- Server-to-server discovery via Nostr relays (kind 30078 events)
- Server publishes existence and capabilities as Nostr events
- Other servers subscribe and discover automatically
- NOT for identity (Hive handles that), NOT for payments (Hive handles that)
- Only for: real-time discovery, server announcements, liveness checks
- Small implementation (~200 lines, `nostr-tools` npm package)
- Add after federation basics work with hardcoded peers

### Other Future Work
- Persistent (non-ephemeral) rooms option
- Per-conversation read tracking (currently per-user last_seen)
- Voice-to-video upgrade mid-call
- STUN/TURN server configuration via .env
- Server-side signature verification
- Rate limiting middleware
- Input validation hardening

## Resources

- **Deploy guide:** https://completenoobs.com/index.php/V4call
- **GitHub:** https://github.com/CompleteNoobs/v4call
- **Hive signup:** https://signup.hive.io
- **Hive Keychain:** https://hive-keychain.com
- **Hive-Engine:** https://hive-engine.com
- **TribalDex (token swaps):** https://tribaldex.com/swap
- **Hive API docs:** https://developers.hive.io
