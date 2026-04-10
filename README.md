# v4call — Decentralised Paid Communications

Video, audio and text calling with Hive blockchain identity and HBD micropayments.

Callers pay to ring. Callees set their own rates. Unused credit is refunded. Everything is on-chain.

---

## Quick Start (Docker)

### Requirements
- A VPS or server with Docker and Docker Compose installed
- A domain name pointing to your server
- A Hive account for your server identity
- A separate Hive account for escrow (holds caller funds during calls)

### 1. Clone and configure

```bash
git clone https://github.com/yourname/v4call
cd v4call
cp .env.example .env
nano .env
```

Fill in all values in `.env` — especially:
- `SERVER_NAME` — your brand name (replaces "v4call" in the UI)
- `SERVER_DOMAIN` — your domain (e.g. mycallapp.com)
- `ESCROW_ACCOUNT` — your Hive escrow account username
- `V4CALL_ESCROW_KEY` — the **active** private key for the escrow account
- `ADMIN_KEY` — a secret for accessing admin endpoints

### 2. Configure Nginx

```bash
cp nginx/v4call.conf nginx/myapp.conf
nano nginx/myapp.conf
# Replace all occurrences of v4call.com with your domain
```

### 3. Get SSL certificate

```bash
# Start everything first (HTTP only, needed for Certbot domain verification)
docker compose up -d

# Get your SSL certificate
docker compose run --rm certbot certonly --webroot \
  -w /var/www/certbot \
  -d yourdomain.com \
  --email your@email.com \
  --agree-tos \
  --no-eff-email

# Restart Nginx to load the certificate
docker compose restart nginx
```

### 4. Done

Your v4call server is running at `https://yourdomain.com`

---

## Quick Start (without Docker — existing VPS with Nginx)

If you already have Nginx and Node.js set up:

```bash
cd /opt
git clone https://github.com/yourname/v4call
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

## Customising Your Fork

All text, colours and branding are in `public/index.html`.

Search for `v4call` to find all instances of the brand name.

The key variables to change in `.env`:
- `SERVER_NAME` — shown in the page title and header logo
- `SERVER_DOMAIN` — your domain
- `SERVER_HIVE_ACCOUNT` — where platform fees go

---

## Admin Endpoints

Once `ADMIN_KEY` is set:

```
# View call history and payment ledger
GET /admin/ledger?key=YOUR_ADMIN_KEY

# View escrow account balance
GET /admin/balance?key=YOUR_ADMIN_KEY

# View specific call
GET /admin/ledger?key=YOUR_ADMIN_KEY&call_id=CALL_ID
```

---

## User Setup (Callers and Callees)

### Setting your call rates (callees)

1. Go to `https://yourdomain.com/rate-editor.html`
2. Set your rates per time window and list
3. Click **Post to Hive** (requires Hive Keychain browser extension)
4. Your rates are now live — anyone calling you will see the payment modal

Your rates post on Hive should look like:
```
[V4CALL-RATES-V1]
ACCOUNT:yourusername
SERVER:yourdomain.com
UPDATED:2026-01-01
PLATFORM-FEE:10%
ESCROW:your-escrow-account
[LIST:default]
[DAYS:mon-sun][TIME:09:00-23:00]
TEXT:0.100 HBD
VOICE:RING:0.100 HBD;CONNECT:0.500 HBD;RATE:2.000 HBD/hr;MIN-DEPOSIT:10min
VIDEO:RING:0.200 HBD;CONNECT:1.000 HBD;RATE:5.000 HBD/hr;MIN-DEPOSIT:10min
[/TIME]
[/LIST]
[/V4CALL-RATES-V1]
```

### Making calls (callers)

1. Log in with your Hive posting key
2. Install [Hive Keychain](https://hive-keychain.com) browser extension
3. Click 📞 next to any online user
4. Review the payment modal and approve via Keychain
5. Call connects — unused credit refunded at call end

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
       ├── SQLite (call/payment ledger)
       └── v4call-escrow Hive account (holds funds during calls)
```

---

## Viewing the Ledger Database

```bash
# Direct SQLite access
sqlite3 data/logs/v4call-ledger.db

# Useful queries
.headers on
.mode column
SELECT * FROM calls ORDER BY id DESC LIMIT 20;
SELECT * FROM payments ORDER BY id DESC LIMIT 20;
SELECT status, COUNT(*) FROM calls GROUP BY status;
.quit
```

---

## Federation (Coming Soon)

v4call is designed to be federated — users on different servers will be able to call each other. Add `SERVER:yourdomain.com` to your rates post now to be ready when federation launches.

---

## License

MIT — fork freely, run your own server, keep all your platform fees.
