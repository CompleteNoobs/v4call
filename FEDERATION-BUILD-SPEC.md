# v4call Federation — Build Specification

## IMPORTANT: Read CLAUDE.md First
The file `CLAUDE.md` in the repo root contains the full project context — architecture, features, design decisions, known gotchas, coding style, and security notes. Read it before making any changes.

## Objective
Add basic federation between two v4call servers so users on different servers can see each other online and make calls/DMs across server boundaries. This is a testing-phase implementation — hardcoded peers, no automatic discovery.

## Test Setup
- **Server A:** v4call.com (already running)
- **Server B:** hive-book.com (new instance, same codebase, different .env)
- **User on A:** noblemage
- **User on B:** cnoobz
- **Goal:** noblemage on v4call.com can see cnoobz online, call them (voice/video), and DM them — and vice versa.

## Architecture Decision: Option A + Model 3

### Option A — Caller's server hosts the room
When noblemage (on v4call.com) calls cnoobz (on hive-book.com):
1. v4call.com creates the call room
2. v4call.com tells hive-book.com "relay this call invite to cnoobz"
3. hive-book.com pushes the incoming call overlay to cnoobz's browser
4. cnoobz accepts → cnoobz's browser opens a temporary WebSocket connection directly to v4call.com for WebRTC signalling
5. WebRTC peer-to-peer connection established → audio/video flows directly between browsers
6. Neither server is in the media path

### Model 3 — Callee's escrow handles payment
- Payment always flows through the callee's escrow account (as defined in their Hive rates post)
- The callee's server takes the platform fee
- The caller's server facilitates the connection but earns nothing from this specific call
- Each server earns when its own users are callees (receiving calls)
- **No new payment logic needed** — the existing system already reads escrow and platform fee from the callee's rates post on Hive

### Why these choices
- Option A is the simplest to build — one server manages the room, callee connects to it temporarily
- Model 3 requires zero changes to the payment flow — payments already go to the escrow defined in the callee's rates post
- Both servers earn from their own users' incoming calls, creating balanced incentives
- The media is peer-to-peer (WebRTC encrypted), so the hosting server can't eavesdrop regardless

## New .env Variable

```
# Comma-separated list of federated peer server URLs (WebSocket)
# Leave blank for standalone mode (no federation)
FEDERATION_PEERS=wss://hive-book.com/federation
```

On hive-book.com:
```
FEDERATION_PEERS=wss://v4call.com/federation
```

## What Needs to Be Built

### 1. Server-to-Server WebSocket Connection (server.js)

A new WebSocket server endpoint at `/federation` (separate from Socket.io) that accepts connections from peer v4call servers.

**On startup:**
- Parse `FEDERATION_PEERS` from .env
- For each peer URL, open a persistent WebSocket connection
- Reconnect automatically if connection drops (exponential backoff)
- Log connection status: `[federation] Connected to hive-book.com` / `[federation] Lost connection to hive-book.com — reconnecting...`

**Also listen for incoming connections:**
- The `/federation` endpoint accepts WebSocket connections from peers
- Validate that the connecting server is expected (optional for v0.2 — can skip validation for hardcoded peers)

### 2. Federation Message Protocol

Simple JSON messages over the WebSocket. Each message has a `type` field:

```json
// Server announces itself on connect
{ "type": "hello", "domain": "v4call.com", "name": "v4call", "version": "0.2" }

// Presence: full user list (sent on connect and periodically)
{ "type": "presence", "users": [
  { "username": "noblemage", "pubKey": "STM..." },
  { "username": "anotheruser", "pubKey": "STM..." }
]}

// Presence: single user update
{ "type": "user-online", "username": "noblemage", "pubKey": "STM..." }
{ "type": "user-offline", "username": "noblemage" }

// Call invite relay
{ "type": "call-invite", "caller": "noblemage", "callee": "cnoobz", "callType": "voice", "roomName": "call_123", "callerPubKey": "STM...", "callerServer": "v4call.com" }

// Call response relay
{ "type": "call-response", "caller": "noblemage", "callee": "cnoobz", "accepted": true, "roomName": "call_123" }
{ "type": "call-declined", "caller": "noblemage", "callee": "cnoobz" }
{ "type": "call-cancelled", "caller": "noblemage", "callee": "cnoobz", "roomName": "call_123" }
{ "type": "call-missed", "caller": "noblemage", "callee": "cnoobz" }

// DM relay (encrypted ciphertext — server never sees plaintext)
{ "type": "dm", "from": "noblemage", "to": "cnoobz", "ciphertext": "...", "senderCiphertext": "...", "signature": "...", "timestamp": "...", "fromServer": "v4call.com" }

// DM delivery confirmation
{ "type": "dm-delivered", "from": "noblemage", "to": "cnoobz", "msgId": "..." }
{ "type": "dm-failed", "from": "noblemage", "to": "cnoobz", "reason": "user offline" }
```

### 3. Server-Side Changes (server.js)

**New state:**
```javascript
const federationPeers = {};  // domain → { ws, users: Map, connected: boolean }
```

**Presence exchange:**
- When a user joins the lobby (`lobby-join`), broadcast `user-online` to all connected federation peers
- When a user disconnects, broadcast `user-offline` to peers
- On federation connect, send full `presence` snapshot
- On receiving `presence`/`user-online`/`user-offline` from a peer, update `federationPeers[domain].users`

**Lobby users update:**
- Modify `lobbySnapshot()` (or create a new function) to include federated users
- Federated users should include a `server` field so the client can display the badge
- Send combined local + federated user list to clients

**Call routing:**
- When `initiateCall` targets a federated user, instead of directly emitting to a local socket:
  - Look up which federation peer has that user
  - Send `call-invite` over the federation WebSocket
  - The peer server receives it and emits `incoming-call` to the callee's browser
- When the callee responds (accept/decline), the peer server sends `call-response` back
- On accept, the caller's server creates the room as usual
- The callee's browser needs the caller's server URL to connect for WebRTC signalling

**DM routing:**
- When a DM targets a federated user:
  - Look up which peer has that user
  - Send `dm` message over the federation WebSocket
  - The peer server delivers it to the recipient's browser via the existing `lobby-dm` event
  - Peer server also stores the recipient's copy in its chat database
  - Caller's server stores the sender's copy locally
- Rate checking: the caller's server fetches the callee's rates from Hive (already works — `fetchRates` reads from the blockchain, not from the local server)

**Rate checking for federated users:**
- No changes needed — `get-rates` and `get-all-rates` already fetch rates from Hive by username
- The callee's rates post defines their escrow account and platform fee
- Payment verification already checks Hive blockchain, not local state
- The callee's server just needs to know a payment happened (it doesn't — but it doesn't need to, because the escrow disbursement happens on-chain)

### 4. Client-Side Changes (public/index.html)

**Lobby display:**
- Federated users appear in the online list with a server badge
- Add a small label showing the server domain, e.g. `@cnoobz` with a subtle `hive-book.com` tag
- Same three buttons (voice, video, DM) — no difference in UX
- CSS for the server badge: small text, muted colour, below or beside the username

**Calling a federated user:**
- `initiateCall` works the same — it calls `get-all-rates` which fetches from Hive (unchanged)
- Payment modal works the same — rates come from the callee's Hive post (unchanged)
- `confirmPayAndCall` works the same — payment goes to the callee's escrow (unchanged)
- The only difference: when `call-accepted` fires for a federated call, the client needs to know to connect to the caller's server for the room

**Accepting a call from a federated user:**
- The incoming call overlay shows the caller with their server badge
- On accept, the callee's browser opens a temporary Socket.io connection to the caller's server (the `callerServer` URL from the invite)
- The callee joins the room on the foreign server using this connection
- WebRTC signalling flows through the foreign server's Socket.io
- Once the peer-to-peer connection is established, media flows directly
- When the call ends, the temporary connection is closed

**This is the trickiest client-side change** — the callee needs to connect to a second Socket.io server and join a room on it. The existing `enterRoom` function assumes a single `socket` connection. For federation, the callee would need a separate socket for the federated room.

**DMs to federated users:**
- `openDmPanel` works the same — rates come from Hive
- `sendDmMessage` works the same — the server handles routing
- The client doesn't need to know the recipient is federated — the server figures it out

### 5. Nginx Changes

Add the federation WebSocket endpoint to the Nginx config:

```nginx
# Federation WebSocket — server-to-server
location /federation {
    proxy_pass         http://app:3000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
}
```

### 6. CORS for Cross-Server Client Connections

When cnoobz's browser (loaded from hive-book.com) connects to v4call.com for a federated call room, it's a cross-origin request. The Socket.io server on v4call.com needs to allow this.

In server.js, update the Socket.io initialization:
```javascript
const io = new Server(server, {
  cors: {
    origin: function(origin, callback) {
      // Allow connections from known federation peers
      callback(null, true);  // For testing, allow all origins
      // For production: check against FEDERATION_PEERS list
    }
  }
});
```

## What Does NOT Change

- **Payment flow** — payments go to the callee's escrow as defined in their Hive rates post. No changes.
- **Rate checking** — rates are fetched from Hive by username. Works regardless of which server the user is on.
- **Encryption** — messages are encrypted client-side with Hive posting keys. Server never sees plaintext. Federation just relays ciphertext.
- **Token payments** — token balance checks go to Hive-Engine API. Payment picker works the same.
- **Platform fee enforcement** — each server enforces its own minimum against the callee's posted fee. If cnoobz's fee doesn't meet hive-book.com's minimum, hive-book.com rejects. v4call.com doesn't enforce on behalf of hive-book.com.
- **Chat storage** — each server stores its own users' copies. Sender's copy on sender's server, recipient's copy on recipient's server.
- **Room management** — rooms are still ephemeral, still hosted on one server.

## Build Order

1. **Server-to-server WebSocket** — get two servers connecting and exchanging hello messages
2. **Presence exchange** — federated users appear in each other's lobbies with server badges
3. **DM relay** — send encrypted DMs across servers (simpler than calls, good test of the relay)
4. **Call invite/response relay** — ring a federated user's phone
5. **Cross-server room join** — callee connects to caller's server for WebRTC (the hardest part)
6. **Testing** — full voice call between noblemage on v4call.com and cnoobz on hive-book.com

## Files to Modify

- `server.js` — federation WebSocket server, presence exchange, call/DM relay routing
- `public/index.html` — server badge on federated users, cross-server Socket.io connection for calls
- `nginx/v4call.conf` — add `/federation` location block
- `.env.example` — add `FEDERATION_PEERS` variable

## Testing Checklist

- [ ] Both servers start and connect to each other via WebSocket
- [ ] Reconnection works when one server restarts
- [ ] Users on server A see users on server B in their lobby (with server badge)
- [ ] Users going offline on one server disappear from the other's lobby
- [ ] DM from noblemage (v4call.com) to cnoobz (hive-book.com) arrives
- [ ] DM is stored on both servers (sender copy + recipient copy)
- [ ] Rate checking works for federated users (reads from Hive, not local)
- [ ] Payment modal shows correct rates and currency options for federated users
- [ ] Voice call from v4call.com user to hive-book.com user rings
- [ ] Callee can accept/decline the federated call
- [ ] On accept, callee's browser connects to caller's server and joins the room
- [ ] WebRTC peer-to-peer connection establishes and audio works
- [ ] Call cost ticker works for federated calls
- [ ] Call end triggers correct escrow disbursement (to callee's escrow, not caller's)
- [ ] Refund works for federated calls
- [ ] Video calls work cross-server
- [ ] Token payments work cross-server

## Estimated Scope

- Server-side: ~500-800 lines of new code
- Client-side: ~100-200 lines of changes
- Nginx: ~10 lines
- The hardest part is the cross-server Socket.io connection for the callee joining a foreign room
- The payment system requires zero changes
