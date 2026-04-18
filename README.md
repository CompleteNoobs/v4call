# v4call — Decentralised Paid Communications

> ⚠️ **WARNING: This project was vibe-coded with Claude Opus 4.6. The author is a tinkerer, not a developer. Use at your own risk — review the code before trusting it with real money.**

Video, audio and text calling with Hive blockchain identity, HBD micropayments, and custom Hive-Engine token support.

Callers pay to ring. Callees set their own rates. Unused credit is refunded. Everything is on-chain.

**Key features:**
- Voice-only and video calls with separate rate tiers
- Encrypted direct messages with persistent chat history
- Custom token payments (any Hive-Engine token — CNOOBS, PIZZA, etc.)
- Payment option picker — callers choose which currency to pay with
- Free-market platform fees — servers set minimums, users shop around
- Hive Keychain login — no key paste needed
- Unread DM alerts and message previews on login
- Ephemeral encrypted rooms with chat history for active members

---

## Full Deploy Guide

**New to self-hosting?** Follow the complete step-by-step guide:

**[Deploy v4call on Ubuntu 24.04 with Docker](https://completenoobs.com/index.php/V4call)**

The guide covers everything from creating a VPS to a working HTTPS server — no coding knowledge required.

---

## Quick Start (Docker)

### Requirements
- A VPS or server with Docker and Docker Compose installed
- A domain name pointing to your server
- A Hive account for your server identity
- A separate Hive account for escrow (holds caller funds during calls)
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
DEFAULT_PLATFORM_FEE=10

# ── Chat Storage ─────────────────────────────────────────
DM_RETENTION_DAYS=33          # days to keep DMs (cleanup runs hourly)
ROOM_RETENTION_DAYS=33        # days to keep room messages
DM_PREVIEW_COUNT=1            # recent DMs per conversation on login (0 = off)

# ── Network ──────────────────────────────────────────────
PORT=3000
BIND_HOST=127.0.0.1
```

### 2. Configure Nginx

Edit `nginx/v4call.conf` — replace all occurrences of `v4call.com` with your domain.

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

---

## Quick Start (without Docker — existing VPS with Nginx)

If you already have Nginx and Node.js set up:

```bash
cd /opt
git clone https://github.com/CompleteNoobs/v4call
cd v4call
npm install
cp .env.example .env
nano .env
```

Add to your systemd service file (`/etc/systemd/system/v4call.service`):
```ini
[Unit]
Description=v4call Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/v4call
ExecStart=/usr/bin/node /opt/v4call/server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/v4call/.env

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable v4call
systemctl start v4call
```

---

## Features

### Login Options

Two ways to sign in:
- **Hive Keychain** (recommended) — no key paste needed. Keychain signs a challenge to prove identity. A 🔑 panel in the lobby lets you optionally enter your posting key to unlock encrypted messaging.
- **Manual posting key** — paste your Hive posting private key directly. Stays in browser session memory only.

### Voice and Video Calls

Each online user shows three action buttons:
- 📞 **Green phone** — voice-only call (audio, no camera)
- 🎥 **Blue camera** — video call (audio + camera)
- 💬 **Purple chat bubble** — direct message

Separate rates can be set for voice and video in the rates post.

### Direct Messages

- End-to-end encrypted using Hive posting keys — server stores only ciphertext
- Stored for up to `DM_RETENTION_DAYS` (default 33 days) with hourly cleanup
- Both sender and recipient get their own encrypted copy for history retrieval
- Unread alert popup on login showing message count and senders
- Preview of recent DMs loaded into lobby on login (configurable via `DM_PREVIEW_COUNT`)
- Full conversation history loaded on demand when opening a DM panel

### Custom Token Payments

- Users can accept any Hive-Engine token (e.g. CNOOBS, PIZZA) via `[TOKEN:SYMBOL]` sections in their rates post
- Server checks caller's token balance via Hive-Engine API automatically
- When multiple payment options qualify, a **currency picker** shows all options with balances
- Token transfers use Keychain `custom_json` (Hive-Engine sidechain)
- Escrow account must hold the accepted tokens for payouts and refunds

### Platform Fee System

- Server sets `DEFAULT_PLATFORM_FEE` in `.env` — this is the **minimum** fee
- Users set `PLATFORM-FEE` in their rates post — this is the **maximum** they'll pay
- If the user's fee is **below** the server minimum → paid contacts are **rejected** with a clear message
- If the user's fee **meets or exceeds** the minimum → server charges **its own rate** (best price for the user)
- No fee line in rates post → server default is used automatically
- Free contacts are never affected by fee enforcement

### Rooms

- Private rooms with allowlist-based access
- Encrypted messaging and WebRTC video/voice
- Room history replayed to new joiners (broadcasts in full, encrypted messages only if addressed to them)
- Ephemeral — when the last person leaves, the room and all its stored messages are deleted

---

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_NAME` | `v4call` | Display name for your server |
| `SERVER_DOMAIN` | `v4call.com` | Your server's domain |
| `SERVER_HIVE_ACCOUNT` | `v4call` | Hive account that receives platform fees |
| `ESCROW_ACCOUNT` | `v4call-escrow` | Hive account that holds funds during calls |
| `V4CALL_ESCROW_KEY` | *(none)* | Active private key for escrow account. **Required.** |
| `ADMIN_KEY` | *(none)* | Password for admin endpoints |
| `DEFAULT_PLATFORM_FEE` | `10` | Server's minimum platform fee (%) |
| `DM_RETENTION_DAYS` | `33` | Days to keep stored DMs |
| `ROOM_RETENTION_DAYS` | `33` | Days to keep stored room messages |
| `DM_PREVIEW_COUNT` | `1` | Recent DMs per conversation on login (0 = off) |
| `HIVE_API` | *(blank)* | Override Hive API node (blank = auto-select) |
| `MAX_CALL_DURATION_MIN` | `120` | Max call length before auto-disconnect |
| `CALL_COOLDOWN_MS` | `30000` | Cooldown between call attempts |
| `PAYMENT_VERIFY_RETRIES` | `3` | Payment verification retry attempts |
| `PAYMENT_VERIFY_DELAY_MS` | `5000` | Delay between verification retries |

---

## Admin & Debug Endpoints

```
# Debug — no auth required
GET /debug-state                                    # Current lobby users and rooms
GET /debug-rates/USERNAME                           # Parsed rates for a user
GET /debug-rates/USERNAME?caller=CALLER&type=voice  # Rates for a specific caller (checks tokens)

# Admin — requires ADMIN_KEY
GET /admin/ledger?key=YOUR_ADMIN_KEY                # Payment ledger
GET /admin/balance?key=YOUR_ADMIN_KEY               # Escrow HBD balance
GET /admin/ledger?key=YOUR_ADMIN_KEY&call_id=ID     # Specific call details
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

### Making calls (callers)

1. Log in with Hive Keychain or your posting key
2. Click 📞 (voice), 🎥 (video), or 💬 (DM) next to any online user
3. If payment is required, choose your preferred currency and approve via Keychain
4. Call connects — unused credit refunded at call end

---

## Architecture

```
Browser (caller)  ──WebRTC──►  Browser (callee)
       │                              │
       │ Socket.io                    │ Socket.io
       ▼                              ▼
  v4call Node.js server (signalling only — media is peer-to-peer)
       │
       ├── Hive blockchain (identity, rates, payments)
       ├── Hive-Engine API (custom token balances, transfers)
       ├── SQLite: v4call-ledger.db (call/payment records — server writes only)
       ├── SQLite: v4call-chat.db (encrypted DMs, room messages — separate for security)
       └── v4call-escrow Hive account (holds HBD + tokens during calls)
```

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
```

---

## Customising Your Fork

All text, colours and branding are in `public/index.html`.

Search for `v4call` to find all instances of the brand name.

Key variables in `.env`:
- `SERVER_NAME` — shown in the page title and header logo
- `SERVER_DOMAIN` — your domain
- `SERVER_HIVE_ACCOUNT` — where platform fees go
- `DEFAULT_PLATFORM_FEE` — your server's minimum fee percentage

---

## Federation (Coming Soon)

v4call is designed to be federated — users on different servers will be able to see each other online, call, and DM across server boundaries. Identity is verified on Hive, rates are read from Hive, payments flow through each server's escrow. Different servers can set different platform fees, creating a free market for server operators.

Add `SERVER:yourdomain.com` to your rates post now to be ready when federation launches.

---

## License

MIT — fork freely, run your own server, keep all your platform fees.
