# v4call Federation — Spec & Status

> **Read CLAUDE.md first.** This document is the federation-specific spec. CLAUDE.md has the project-wide context (architecture, file map, design decisions, .env vars, security posture).

## Status

| Milestone | Version | Status | Notes |
|-----------|---------|--------|-------|
| Hardcoded peers, presence, DM relay, 1:1 call relay | **v0.2** | ✅ Shipped | Original spec scope. Caller's-server-hosts-room model. |
| Verify.json domain proof + Hive directory + manual peer approval | **v0.3** | ✅ Shipped | Replaces hardcoded-only with crypto-verified discovery + admin approval. |
| Federated rooms (multi-party cross-server) + OR-gated rooms + banlist | **v0.4** | ⏳ Planned | See "Next: v0.4" section. |

Both production servers (`call.completenoobs.com` ↔ `hive-book.com`) currently run v0.3 and federate successfully. Cross-server presence, free DMs, paid DMs, voice calls, and video calls all work end-to-end.

## What Was Actually Built (v0.2 + v0.3)

### Architecture decisions confirmed in implementation

- **Option A confirmed**: caller's server hosts the room. Callee's browser opens a temporary cross-server Socket.io connection for WebRTC signalling. Media stays peer-to-peer (browsers connect directly).
- **Model 3 refined**: callee's escrow holds funds; *callee's server* (which holds the active key) does all disbursement. Caller's server is verifier + router only — never touches money.
- **Domain tiebreaker**: when both peers initiate outbound at the same time, only the lexicographically-smaller domain keeps its outbound. The other accepts inbound only ("passive mode"). Both ends use `SERVER_DOMAIN.localeCompare(peerDomain) < 0` so they agree on the surviving connection. This eliminates the flapping bug we hit in early testing.
- **Per-socket Promise queue**: `fedHandleMessage` is async (hello awaits verification). Without serialization, presence messages arriving during hello-verification got silently dropped. The queue chains handlers so messages process in order.
- **Verify.json is fail-closed**: peers without a valid signed verify file cannot federate, period. No "warn-but-allow" path.
- **Approval gate on top of verification**: a verified peer still must be in `approvedPeers` (seeded from `FEDERATION_PEERS` env, plus manual `/admin/peers/approve`). Verified-but-unapproved = socket close with `1008 not approved` and a clear log line telling the operator how to approve.

### Federation message protocol (final shape)

Each message is a JSON envelope with a `type` field, sent over the persistent WebSocket to `/federation`.

```json
// Connection establishment — both sides send on connect, both sides verify the other.
// hive_account is announced so the receiver can pin verify.json's signer to it.
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

### Domain proof (verify.json)

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
| `public/server-sign.html` | New — generates signed verify.json |
| `public/server-announce.html` | New — publishes v4call-server Hive post via Keychain `requestPost` |
| `public/admin-peers.html` | New — peer admin UI (list / approve / revoke / rescan) |
| `public/.well-known/v4call-server.json` | New — placeholder; each operator overwrites with own signed file |
| `nginx/v4call.conf` | `/federation` location block (no auth) |
| `.env.example` | `FEDERATION_PEERS` variable |
| `package.json` | `ws` dependency |
| `WalkThrough.wiki` | Step 17 (federation setup) added; nginx step updated; admin endpoints listed; common federation problems documented |

---

# Next: v0.4 (Federated Rooms + OR-Gated Rooms + Banlist)

This is the next federation milestone. Three related features that share scope.

## v0.4 Design

### Federated rooms

Same model as 1:1 federated calls, scaled to N participants:

- **Room hosting**: caller's server still hosts the room state (membership, message bus, allowlist, banlist). Single-server-of-truth per room.
- **Federated invitees**: when noblemage on call.completenoobs.com creates a room and invites cnoobz on hive-book.com, the invite goes via federation `room-invite` message (new). cnoobz's home server delivers the popup, cnoobz accepts, her browser opens a temporary cross-server Socket.io to call.completenoobs.com and joins the room there.
- **Federated leave**: when cnoobz leaves the room, her temporary socket disconnects from call.completenoobs.com and her client sends `federated-room-ended` to her home server (matches the existing `federated-call-ended` pattern).
- **Token-gate across federation**: if the room requires N CNOOBS tokens, the host server checks cnoobz's Hive-Engine balance regardless of which server she's on (chain-side check, peer-agnostic).

New federation message types:
- `room-invite` — host server → invitee's home server
- `room-invite-response` — invitee's home server → host server (accept/decline)
- `room-cancelled` — host server → invitee's home server (host cancelled the invite before accept)

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

## v0.4 Build Order (proposed)

1. **OR-gated rooms (single-server first)** — get token-gate logic working with two local users before federating.
2. **Banlist (single-server first)** — same; ban + auto-kick locally.
3. **Banlist visibility toggle** — small addition to step 2.
4. **Federation message types** — `room-invite`, `room-invite-response`, `room-cancelled` (parallel to existing `call-invite` infrastructure).
5. **Cross-server room join** — reuse the existing federated-1:1-call cross-server Socket.io pattern. cnoobz's browser opens temporary connection, joins room, leaves cleanly.
6. **Cross-server token gate** — host server checks federated user's Hive-Engine balance (no new code; balance check is chain-side and works for any account).

Ships incrementally — steps 1–3 work without federation, steps 4–6 add federation.

## v0.4 Estimated Scope

- Server-side: ~400–500 lines (gate logic, banlist state, federation message handlers, cross-server-join routing for rooms)
- Client-side: ~150–250 lines (room create UI for gate + banlist, in-room admin controls, federated invite handling)
- No new dependencies, no schema changes (room state is in-memory)

## v0.4 Testing Checklist (forward-looking)

- [ ] Local room with token gate accepts holder, rejects non-holder
- [ ] Local room with banlist auto-kicks added user
- [ ] Banlist visibility toggle hides/shows correctly to non-admins
- [ ] Federated room invite reaches federated user with popup
- [ ] Federated invitee can accept and join the host server's room
- [ ] Federated invitee can leave cleanly without breaking either server's state
- [ ] Token gate works for federated joiner (balance check independent of home server)
- [ ] "via TOKEN" badge shows on token-gate joiners
- [ ] Admin can ban federated user (kick crosses federation)
- [ ] Multiple federated users from different servers can be in the same room

---

## Resources

- **Project context:** `CLAUDE.md`
- **Operator deploy guide:** `WalkThrough.wiki` (also at https://completenoobs.com/index.php/V4call)
- **GitHub:** https://github.com/CompleteNoobs/v4call
- **Hive API docs:** https://developers.hive.io
- **Hive Keychain:** https://hive-keychain.com
