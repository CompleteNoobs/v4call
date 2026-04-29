# CLAUDE.md — v4call Project Context

> **⚠️ This project was vibe-coded with Claude Opus 4.6 → 4.7. The author is a tinkerer, not a developer. Use at your own risk — review the code before trusting it with real money.**

## What This Is

v4call is a decentralised paid video, voice, and text communication platform built on the Hive blockchain. Users set their own rates for receiving calls and messages. Callers pay with HBD or custom Hive-Engine tokens. Unused credit is refunded automatically. The server operator earns a platform fee from each paid interaction. Multiple server operators can federate so users on different servers see, call, and message each other.

**The core idea:** I don't want strangers ringing my phone for free. If they value my time, they can pay. If not, my phone doesn't ring. Family and friends get custom rules — free calls, different hours, different rates.

## Current Version

- **Software:** v0.16 — Cross-server rooms, end-to-end. **Part A** (already shipped): admin types `@user@peer.com` into a room's allowlist; server validates target is an approved + connected v0.4+ peer; sends `room-invite` over federation; receiving server delivers a popup with source-server badge; accept/decline flows back as `room-response`. **Part B** (this build): accepting a federated invite now actually joins the room. Reeman's browser opens a temp Socket.io to the host server (mirroring the 1:1 federated-call pattern), joins as a real participant with a `@homeServer` badge in the user-list and on video tiles, multi-party WebRTC works, token-gating works (chain-side balance check, peer-agnostic), banlist auto-kick honours the canonical `user@server` form, accepting auto-leaves any current local room first (no grace period — design call (a)). Federation socket drop while reeman is mid-room → host server immediately kicks any federated members for that peer. Temp socket drop on the joiner's side → "Lost connection to host" system message, clean exit back to lobby. Builds on v0.15 (spotlight + local pin + admin spotlight broadcast + admin role transfer + Share Screen + WebRTC SDP m-line fix). Production-deployed on call.completenoobs.com ↔ hive-book.com.
- **Federation protocol:** v0.4 — first wire-format bump since v0.11. New `room-invite` / `room-response` envelopes (generic `payload: {}` for forward-compat with v0.17 paid expert invites) and an explicit `protocol_version: '0.4'` field in the hello. v0.3 peers continue to federate fully for everything they could do at v0.3; v0.4-only features (cross-server room invites + cross-server room joining) are gated by `protocol_version`. The cross-server room-join itself reuses the existing direct browser↔host-server Socket.io transport from 1:1 federated calls — no new envelope on the federation wire for the join itself; only the invite handshake goes via federation. Verify.json domain proof, Hive-tag discovery, manual peer approval, paid cross-server calls + DMs all unchanged.

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

## Features (What's Built and Working in v0.15)

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
- **Custom token payments:** Any Hive-Engine token via [TOKEN:SYMBOL] sections in rates post. Token creation on Hive-Engine costs a flat 100 BEE (≈ 62 HIVE / ~£5–£6 at the time CNOOBS was minted) — cheap enough to be a real wedge for creator-economy use cases. Created tokens work as payment currency, lobby anti-spam gate, room token-gate, and blocked-list bypass without any further setup.
- **Payment picker:** When multiple currencies qualify, caller sees all options with balances and chooses
- **Token transfers:** Uses Keychain requestCustomJson for Hive-Engine sidechain operations
- **Token verification:** Balance-check verification (not transferHistory — that API doesn't work reliably)
- **Platform fee enforcement:** Server sets minimum (DEFAULT_PLATFORM_FEE), user's rates post sets their willingness. If user's fee < server minimum → rejected with message. If user's fee >= minimum → server charges its own rate (best price for user)
- **Rate system:** V1 and V2 formats, named lists (family/friends/work/default), time windows, day-of-week, blocked users, ALLOW-IF-TOKEN bypass, per-token rate sections
- **Payment flow:** Ring fee → connect fee → duration deposit. Unused credit refunded. Platform fee deducted. All verified on-chain before proceeding.
- **Call types:** Voice and video have separate rate tiers in the rates post
- **Mobile UI:** Responsive `@media (max-width: 720px)` collapses three columns into a full-width single column with a fixed bottom-tab nav (USERS/CHAT/ROOMS for lobby, VIDEO/CHAT/MEMBERS for room)

### v0.12 polish (added on top of v0.11)
- **iOS viewport zoom fix:** Inputs/textareas forced to 16px on `≤720px` so iOS Safari/WebKit doesn't auto-zoom on focus and leave the page zoomed-in afterward.
- **Mobile DM panel layout:** Header wraps so multi-token picker chips appear on their own row below the title; body stacks textarea on its own full-width row with cancel + send below (the prior single-row layout cramped the textarea down to ~30% of the viewport).
- **DM dedup:** Per-conversation history is fetched once per session (`dmHistoryLoaded` Set); message-level dedup by signature in `addLobbyMsg` catches reconnect/preview overlaps. Fixes the "every DM-button click re-appends history" bug.
- **Paid-DM currency badge:** `dm_messages` schema migrated to add a `currency` column. `lobby-dm` socket payload + federation `dm` message now carry `textCurrency`; client renders the actual currency in the badge instead of hardcoded "HBD". History rows now display their original send timestamp instead of `new Date()`.
- **Room joins default to text-only:** `room-created` / `acceptInvite` / `knockRoom` paths set `pendingCallType = 'text'` — no media acquisition on join. Two new buttons in the room chat header (`🎤 Enable Mic`, `🎥 Enable Cam`) opt the user in mid-room with proper WebRTC renegotiation. The `socket.on('offer')` handler reuses an existing peer connection if one exists, so adding tracks mid-call works without dropping the connection. 1:1 voice/video calls still acquire media as before.
- **Discovery scanner repaired:** Hive nodes tightened `condenser_api.get_discussions_by_created` to a max `limit` of 20 (was 50). Every node was returning `Assert Exception` and `hivePost` was silently swallowing it. Cap reduced to 20; Hive node fallback list refreshed (dropped `anyx.io`, `hived.emre.sh`; added `hive-api.arcange.eu`, `api.openhive.network`, `techcoderx.com`).
- **`hivePost` logging:** Now logs HTTP status, JSON-RPC errors, and raw body preview when a node returns 200 OK but no `result` field. The previous silent skip turned every protocol-level breakage into "discovery returned 0 — must be a network bug".
- **Token balance cache hardening:** `getHiveEngineTokenBalance` no longer caches a 0 result from API errors, error responses, or unexpected response shapes — only from genuine empty-balance responses. Prevents a transient Hive-Engine hiccup from poisoning the picker for 5 minutes.
- **`/admin/discovery-test` endpoint:** Auth-protected diagnostic that hits each Hive node directly with the discovery query and returns per-node HTTP status + result count + raw preview, plus the cached peer list. Designed to be run via `docker compose exec app curl` (curl now installed in the container) so you see what the running container sees.
- **`/debug-rates` extended:** Now includes `picker_diagnostics` showing per-token caller balance, qualifies-flag, and which call types each token covers — so picker UI mismatches can be diagnosed without a fresh build.

### v0.13 polish (added on top of v0.12)
- **4-tab lobby UI:** Lobby panel now has four tabs — `💬 DMs / 📢 Local Lobby / 🚪 Active Rooms / ✉️ Included Rooms`. Default active tab on login is `lobby`. Mobile bottom-tab nav mirrors the new structure with four buttons (`USERS / DMS / LOBBY / ROOMS`); `Included Rooms` is reachable on mobile via the inline `#lobby-tabs` strip at the top.
- **DM panel relocated:** `#dm-panel` now lives inside the DM tab. DM messages render into a dedicated `#dm-messages` container; `addLobbyMsg` routes by `type === 'dm'` so DMs no longer mix into the lobby broadcast/system feed. Resolves the "DMs mixing into lobby chat" UX issue without changing the existing `dm-history` / `lobby-dm` / dedup machinery.
- **DM tab user picker:** Top of the DM tab shows a chip-row of currently-online users (sourced from `window.lobbyUsers` set in the existing `lobby-users` handler). Click a chip → `openDmPanel(username)` opens the conversation.
- **Included Rooms tab:** Rooms where the current user is on the allowlist *and* not currently in (`r.name !== currentRoom`) show with a "Knock →" button (reuses existing `knockRoom(name)`). The room can have other members or be empty — being allowlisted is what counts. Active Rooms tab continues to show rooms with `memberCount > 0`. Both lists update from the same `lobby-rooms` socket event by partitioning the payload client-side; server payload unchanged. (Initial release filtered Included on `memberCount === 0` instead, which hid populated allowlisted rooms — fixed in the same v0.13 cycle.)
- **`lobby-config` socket event:** Server emits on `lobby-join` with `{ serverName, serverDomain, notice, requirementsText }`. Client renders `notice` as a `.lobby-notice` block above lobby messages; `requirementsText` renders as a `.lobby-requirements` block below it (hidden if empty). Both texts auto-generate from gate vars + `SERVER_DOMAIN` when the corresponding env var is blank.
- **Anti-spam gate on lobby posting:** Server-side check on both `lobby-chat` (broadcast) and `lobby-encrypted` (toggle) handlers. Three independent gate env vars: `LOBBY_POST_MIN_HP` (staked Hive Power), `LOBBY_POST_MIN_HIVE` (liquid HIVE balance), `LOBBY_POST_MIN_TOKEN` (`SYMBOL:amount` for any Hive-Engine token). `LOBBY_POST_GATE_MODE` (`or` default / `and`) controls how 2+ gates combine. Gate is **fully short-circuited** when all three thresholds are disabled — no extra Hive API calls per message. DMs and calls are never gated.
- **`getAccountStats` helper:** Single Hive API call (`condenser_api.get_accounts`) populates both `hp` (computed from `vesting_shares × hive_per_vest`) and `liquidHive` (`acct.balance`). Wrappers `getHivePower(username)` and `getLiquidHive(username)` share one cache and one network round-trip. **HP is owned VESTS only** — does NOT include `delegated_vesting_shares` or `received_vesting_shares` so a whale can't rent out posting privileges by delegation. 5-min cache (mirrors token cache pattern), with a separate 1-hour cache for `hive_per_vest` (it moves slowly). Failures don't poison the cache.
- **`lobby-post-rejected` event:** New socket event the server emits when the gate fails. Client renders it as a system message: `⚠ This server requires X HP OR Y TOKEN to post in the lobby. You have ... .`
- **Mid-room media toggles:** The two `🎤 Enable Mic` / `🎥 Enable Cam` buttons from v0.12 are now full toggles — click again to fully release the device (`track.stop()` + `pc.removeTrack(sender)` + renegotiate, not `track.enabled = false` mute). Browser mic/cam indicators genuinely go away on disable, and the camera light turns off. Each transition is a proper WebRTC renegotiation; the offer-handler's existing-PC reuse from v0.12 makes this work without dropping the connection.
- **🖥️ Share Screen button (placeholder):** Third button alongside mic/cam in the room chat header. UI is in place now so the room toolbar layout is stable; the actual `getDisplayMedia()` flow lands in v0.15 alongside the spotlight room layout. Clicking it today posts `🖥️ Screen sharing arrives in v0.15 — UI placeholder for now.` as a system message.

### v0.14 polish (added on top of v0.13)
- **Token-gated rooms:** Room creator can optionally set `tokenGate: { symbol, amount }` at creation (UI fields tucked into the create-room panel, off by default). Server `join` check is now: banlist → reject; allowlist → allow as `joinedVia: 'allowlist'`; v0.17 paidInvitees hook (no-op in v0.14); tokenGate balance check via existing `getHiveEngineTokenBalance` → allow as `joinedVia: 'token'` if `bal >= amount`. Otherwise reject with a clear "needs allowlist or X SYMBOL" message. Room `roomsSnapshot()` now includes `tokenGate` so lobby room cards show "🪙 Open to holders of X SYMBOL".
- **"via TOKEN" badge:** Members who joined via token-gate (not allowlist) get a small accent-coloured `via SYMBOL` badge in the room user list. Threaded through `addRoomUser`, `applyRoomUsers`, `socket.on('user-joined', ...)`, and `room-users-resync` so it survives reconnects.
- **Live banlist:** Two new socket events — `room-ban` (admin-only; auto-kicks if currently in-room via existing `kicked` event) and `room-unban`. Banlist overrides allowlist + tokenGate. Username normalised lowercase, optional leading `@` stripped.
- **Banlist visibility:** Per-room `banlistVisibility: 'admin' | 'all'` (admin default). Server's per-member `room-info` emit (`emitRoomInfoToMembers`) sends the banlist array to the creator unconditionally and to other members only when visibility is `'all'`; non-visible members get `banlist: null` and the client hides the section. Non-creators never see the unban buttons even when they can see the banlist.
- **Forward-compat for v0.17:** Every room is created with `paidInvitees: new Map()`. The join check evaluates `r.paidInvitees.has(username)` between the allowlist and tokenGate checks — always falsy in v0.14 (Map stays empty). v0.17 populates this Map with `username → { connectFee, ratePerHour, currency, maxDuration, ... }` and the join flow needs zero refactor — just an additional `joinedVia: 'paid'` branch.
- **`emitRoomInfoToMembers(r, roomName)` helper:** Replaces the existing `io.to(room).emit('room-info', ...)` calls in `allowlist-add` / `allowlist-remove` / `room-ban` / `room-unban` so the per-recipient banlist visibility logic runs on every state change.

### v0.14.5 polish (added on top of v0.14)
- **Room export — `📥 Export` button (purple, room header):** Visible to any current room member. Calls `socket.on('room-export', ...)` which assembles a `.v4room` JSON containing room metadata (name, creator, allowlist, tokenGate, banlist, banlistVisibility, created_at) + every row from `room_messages` (ciphertext only — server never sees plaintext). Browser saves it as `<roomname>@<source-domain>__<ISO-timestamp>.v4room`. Filename sorts alphabetically = sorts chronologically; `@` separates room from server (mailbox/Mastodon style); `__` before timestamp makes splitting trivial; ISO with hyphens not colons keeps it Windows-safe.
- **Room import — `📤 Import .v4room file` button (lobby → JOIN BY NAME panel):** Any logged-in user can import. Reads file in-browser via FileReader, sends to `socket.on('room-import', ...)` which validates structure (file_type, format_version, required fields, room-name regex), creates a new room owned by the *importer* (not the original creator), preserves the file's allowlist (importer auto-added), tokenGate, banlist, banlistVisibility, then bulk-inserts all messages via `chatStoreRoomMsg`. Returns `{ collision: true }` if the room name exists; client prompts for a rename and retries. 20MB file size cap.
- **Encryption preserved across export/import:** `.v4room` files contain ciphertext only — the server never had plaintext. Anyone can hold the file but only original key-holders can decrypt their addressed messages. Cryptographic signature verification stays client-side at decryption time (the existing `⚠ bad sig` badge still catches forgeries on display).
- **`chatGetRoomMessagesAll(roomName)` helper:** New; returns every row from `room_messages` for a given room (no per-recipient filter). Used only by export. Existing `chatGetRoomHistory(roomName, username)` still does the per-recipient filter for normal in-room delivery.
- **Format spec (`format_version: 1`):** Self-documenting top-level fields `file_type: "v4room"`, `format_version`, `source_server`, `exported_at`, `exported_by`, plus nested `room` and `messages` objects. Bumping the format version in future requires a parallel server-side import branch — current import rejects unknown versions with a clear error.
- **Two long-standing CSS bugs in the room-exit UI fixed:**
  - **Bug A** — `#call-cost-ticker` had a duplicate `display:` declaration (`display:none;...display:flex;`); last-wins meant the ticker was always visible regardless of the `.active` modifier, so End Call appeared in every room (including non-call rooms). Fixed by removing the second `display:flex` from the base rule. End Call now only appears via `.active` during real paid 1:1 calls.
  - **Bug B** — `style.display = ''` doesn't override CSS `display:none` (the empty string just removes the inline override; cascade re-applies the `display:none` rule). The four header buttons (`#leave-room-btn`, `#popout-btn`, `#export-room-btn`, `#end-room-btn`) were therefore **never visible** since v0.11. Users had been clicking End Call as their de-facto leave button. Fixed by switching to the `.shown` class pattern that already worked for `#enable-mic-btn` etc. (`#id.class` specificity beats `#id` alone).
  - **Why the bugs masked each other:** End Call was always visible (Bug A); Leave Room was never visible (Bug B); users clicked End Call thinking it was Leave Room; End Call's server handler emitted `peer-hung-up` to all members → cascaded `leaveRoom()` calls → "non-admin leaves kicks everyone" symptom (which was the v0.14 Bug 3 we patched at the server-side `call-end` handler). The patch was correct but the root cause was missing UI — both layers are now fixed.

### v0.15 polish (added on top of v0.14.5)
- **Spotlight room layout (Part A):** `#video-panel` is now a flex column with `#spotlight-slot` (large tile, full panel width, 4/3 desktop / 16/9 mobile) on top and `#peer-strip` (horizontal flex row, 90px tiles desktop / 110px mobile, 2px gap, accent-coloured hover border, scrolls horizontally) below. Local tile starts in the spotlight on room entry. Strip is `display:none` when empty so there's no leftover border line in solo rooms.
- **Local pin (Part A):** `setSpotlight(wrapper, opts)` moves a wrapper into the spotlight slot, displacing whatever was there into the strip. Click any tile to pin — works for everyone (admin and non-admin alike, same behaviour). When `opts.user` is true and the new pin differs from the room broadcast (Part B), `localSpotlightOverride` flips true so subsequent admin broadcasts don't yank the view away.
- **Auto fall-back when spotlit user leaves:** the existing `user-left` handler now checks if the leaver was in the spotlight slot. If so, the local tile slides back into the spotlight. Works for both local-pin and broadcast-spotlight cases. `leaveRoom` cleans up all peer wrappers (whether in strip or spotlight) and restores the local tile.
- **Admin spotlight broadcast (Part B):** room admin sees a `📌` button next to every non-self member in the room user-list (gated by `#room-users-list.am-creator` CSS class — non-admins never see the buttons). Click → `socket.emit('room-spotlight-set', { room, target: username })`. Server validates `socket._username === r.creator`, resolves username → socketId, broadcasts `room-spotlight-changed { target, targetSocketId }` to all room members. Server stores `r.spotlight = username` (stable across socket reconnects). New joiners receive the current target via the `spotlight` field added to `room-info`. Spotlight clears automatically when the spotlit user leaves (helper `clearSpotlightIfMember` called in `leave-room` / `disconnect` / `room-ban` handlers).
- **Soft override for broadcasts:** when `room-spotlight-changed` arrives, `applyRoomSpotlight()` only moves tiles if `localSpotlightOverride` is false. Users who manually pinned someone else keep their pin and see a `↺ Follow room spotlight` button in the room chat header (uses the `.shown` class pattern). Click it → `localSpotlightOverride = false` + `applyRoomSpotlight()` → snap to the broadcast.
- **Per-row "active" indicator:** `updateFollowAffordance()` flips `.active` on the `📌` button matching the current broadcast target so the admin can see at a glance who's spotlit.
- **Admin role transfer (Part B):** `👑` button next to every non-self member in the user-list. Click → confirm dialog → `socket.emit('room-transfer-admin', { room, username })`. Server validates current admin, validates target is a current member (else `room-admin-transfer-failed { reason }` to the requesting admin), sets `r.creator = target`, ensures target on allowlist, calls `emitRoomInfoToMembers`. Client `room-info` handler now sets `amCreator = (creator === myUsername)` (was previously OR-only — needed to flip BOTH ways for the previous admin's UI to demote correctly). `am-creator` class on `#room-users-list` toggles per-row admin buttons via CSS without re-rendering each entry.
- **Pre-render admin buttons + CSS gate:** `addRoomUser` always renders `<span class="ue-admin-btns"><button class="ue-spotlight-btn">📌</button><button class="ue-makeadmin-btn">👑</button></span>` inside every non-self row. CSS `display:none` by default; visible only when `#room-users-list.am-creator .user-entry:not(.self) .ue-admin-btns` matches. Result: zero re-render needed when `amCreator` flips during a session — just toggle one class on the parent. The user-entry's own `onclick` (recipient toggle) checks `ev.target.closest('.ue-admin-btns')` first so admin button clicks don't also flip the message-recipient toggle.
- **🖥️ Share Screen wired up (Part C):** `toggleScreen()` is no longer a placeholder. `startScreenShare()` calls `getDisplayMedia({video:true})`, stops the cam first if it's on (mutually exclusive — camera light goes off), then either `replaceTrack(screenTrack)` on the existing video sender (cam-was-on path → no renegotiation needed) OR `addTrack` + renegotiate (cam-was-off path → reuses the recvonly transceiver from `createPC`, no duplicate m-line). Auto-pins the sharer's own tile to their local spotlight (other users keep their current view; admin can broadcast room-wide if they want). Browser's "Stop sharing" floating bar synced via `screenTrack.onended`. Cam button is `disabled` + greyed while sharing so a misclick doesn't tear down the share via `disableCam` (which is also guarded with `if (currentScreenStream) return;` for belt-and-braces). On Stop: removes track + renegotiates; per design choice, video stays off until user clicks `🎥 Enable Cam` again (no auto-cam-restore — keeps the state machine simple, can be revisited later).
- **iOS gracefully degrades:** `getDisplayMedia` doesn't exist on iOS Safari/Brave. Click → `🖥️ Screen sharing is not supported on this device (iOS Safari/Brave can't do it).` system message, no crash. Detection via `if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function')`.
- **WebRTC fix — text-only / voice-only joiners actually receive existing peers' video and audio:** Long-standing bug since v0.12 (when text-only room entry shipped). Root cause: `createPC` only added tracks when `localStream` had them, so text-only joiners' offer SDP had **zero `m=` lines**, the answer mirrored that, and the joiner never received any of the existing peers' tracks. Fixed by always ensuring both audio + video transceivers exist in the PC: `if (!haveAudio) pc.addTransceiver('audio', { direction: 'recvonly' })` + same for video. Chrome's `addTrack` algorithm reuses these unused recvonly transceivers later if the user enables their own mic/cam, so no duplicate m-lines and the existing enable-cam-mid-room path keeps working unchanged.

### v0.16 polish (Part A — added on top of v0.15)
- **Federation protocol bump to v0.4:** `FEDERATION_VERSION` constant now `'0.4'`. The hello envelope adds an explicit `protocol_version: '0.4'` field alongside the legacy `version` field. v0.3 peers don't read or send `protocol_version`, so the new code reads `peer.protocolVersion` (null on v0.3 peers) and gates v0.4-only features on `parseFloat(...) >= 0.4`. Backwards-compat: v0.3 peers continue to federate fully for everything they could do at v0.3 (DMs, 1:1 calls, presence, payments).
- **Federated allowlist input:** the existing `al-add-input` field now accepts both `@user` (local) and `@user@server.com` (federated) forms. Server-side `parseFederatedHandle()` strips a leading `@`, lower-cases, splits on `@`. If the second part matches an approved + connected v0.4+ peer, the entry is stored canonically as `user@server.com` in the room's allowlist; if not, the admin gets a clear `allowlist-error` system message ("not approved", "not connected", "needs v0.4"). Typing your own server's domain in the suffix collapses to the local path.
- **`room-invite` / `room-response` federation envelopes:** new in fed v0.4. `room-invite` is a generic envelope with `{ invite_id, from_user, to_user, room_name, source_server, payload: {} }` — empty `payload` is the v0.17 hook (Paid Expert Invites populate it with `{ connectFee, ratePerHour, currency, maxDuration, ... }` without needing a separate paid-invite message type). `room-response` carries `{ invite_id, response: 'accepted'|'declined', reason? }`; `reason: 'offline'` is an automatic decline emitted by the receiving server when the target isn't online.
- **`pendingFederatedInvites` map + TTL sweep:** in-memory Map keyed by `invite_id`. Outgoing entries on the source server hold `{ room, from_user, target_user, target_server, created_at }`; incoming entries on the receiving server hold `{ target_user, from_user, from_server, room, created_at }`. A 5-minute interval prunes anything older than 15 minutes (`FED_INVITE_TTL_MS`) — covers peer disconnect mid-flow + user-never-responded.
- **Federated invite popup gets a source-server badge + "cross-server" hint:** existing `socket.on('room-invite', ...)` reads new optional `from_server` and `invite_id` fields. When `from_server` is set, the popup renders `@from <span style="color:var(--accent)">@from_server</span>` plus a small subtext line explaining it's a cross-server invite. The system message in lobby chat shows `@user@server` form. `pendingInvite` state now stores `from_server` + `invite_id`.
- **Accept/decline branches on `from_server`:** `acceptInvite()` / `declineInvite()` now check `pendingInvite.from_server`. If set, emit `room-invite-respond` socket event (server forwards as `room-response` over federation) instead of entering the room directly. v0.16 Part A leaves the actual cross-server room-join machinery to Part B — for now, accept just confirms receipt with a "Cross-server join arrives in v0.16 Part B" system message. Decline is silent on the inviter side (matches local-invite decline behaviour, per the design call).
- **Allowlist chip rendering for federated entries:** the allowlist panel splits `user@server.com` entries on `@` and renders `@user` plus a small italic `@server.com` badge (`.fed-badge` class). Local entries continue to render as plain `@user`. Removal/ban buttons work on the canonical full-form key.
- **`lobby-info` socket event:** new generic info channel — server emits `{ text }` to a specific user's socket and the client renders it as a system message in the lobby. Used in v0.16 Part A to confirm federated invite acceptance and to surface offline-target auto-declines.
- **Fail-closed peer guard on the inviting side:** before sending `room-invite`, the server checks `approvedPeers.has(server)`, `peer.connected`, AND `peerSupportsV04(server)`. Each failure returns a clear `allowlist-error` to the admin instead of silently failing or dispatching a wire message the peer would silently drop.
- **`room-invite-respond` socket handler:** receives `{ invite_id, response }` from the responding user. Validates `socket._username === entry.target_user` (anti-forgery), looks up the source server in `federationPeers`, sends `room-response` over federation, deletes the pending entry. If the source peer disconnected mid-flow, surface a clear "lost connection" system message to the user.
- **Source-server validation on incoming envelopes:** the `room-invite` federation handler validates `source_server.toLowerCase() === ws._domain` to prevent a peer impersonating a third party in the envelope's metadata. The `room-response` handler validates the responding peer matches the original `entry.target_server`.
- **A.5 polish — invite-flow messages route to current room:** `showInviteMsg(text)` helper added — checks `currentRoom` and writes via `addSystemMsg` (room chat) when the user is in a room, falls back to `addLobbyMsg({type:'system'})` when in lobby. All Part A invite-flow surfaces (`room-invite` popup-trigger, `acceptInvite` / `declineInvite` confirmations, `lobby-info` / `allowlist-info` / `allowlist-error` system events) route through this helper. Reason: admin adds federated invitees from inside a room → response/error messages were rendering in the lobby chat (which the admin can't see while in a room) and the lobby gets busy with broadcast traffic anyway.
- **A.5 polish — `room-create` resolves federated invitees:** lobby user-picker selections of federated users (e.g. ticking `@noblemage@hive-book.com` in the lobby list before clicking Create Room) now actually send the federated invite. The handler resolves each invitee in three priority order: (1) explicit `user@server` form → federated, (2) local lobby user → local, (3) bare username matching a federated peer's user list via `peerForUser()` → federated fallback. Federated invitees go through the same `pendingFederatedInvites` + `room-invite` envelope path as `allowlist-add`. Allowlist storage is canonical (bare for local, `user@server` for federated), so post-create allowlist edits and joins continue to work.

### v0.16 Part B polish (cross-server room join)
- **Federated `join` accepts `homeServer` field:** server's `socket.on('join')` reads `homeServer` from the payload. When non-empty and not equal to our own `SERVER_DOMAIN`, the joiner is treated as federated. Authorisation match uses the canonical form `${username}@${homeServer}` against `r.allowlist` (so the entry the admin added in Part A — `noblemage@hive-book.com` — matches). Token-gate balance check uses the bare username (Hive identity is server-agnostic, peer-agnostic — design call 4(a)). The bare username is what's stored on each member record's `username` field; `homeServer` is a separate optional field on the member record.
- **Member dedup uses canonical key:** the existing v0.13 stale-member dedup (`r.members = r.members.filter(u => u.username !== username)`) was changed to dedup by canonical key (`${u.username}@${u.homeServer}` for federated, bare for local) so a local `@noblemage` and a federated `@noblemage@hive-book.com` can coexist as separate members in the same room without one displacing the other on reconnect.
- **`homeServer` threaded through every room-state payload:** `room-users`, `room-users-resync`, `user-joined`. Each member entry carries `homeServer: 'hive-book.com' | null`. Client's `addRoomUser(sid, username, pubKey, isSelf, joinedVia, homeServer)` renders a `.fed-badge` next to the @username for federated members (mirrors the v0.16 Part A allowlist chip + lobby federated-user style). `pc.ontrack` tile-creation label and `addRoomUser` both render `@user @server.com` on tiles for federated members. Self never gets a badge or suffix (you're "you" from your own perspective).
- **Federated `lobbyUsers[username].inRoom` not touched:** the host server's `inRoom` field tracks LOCAL users only (`if (!isFed && lobbyUsers[username]) lobbyUsers[username].inRoom = room;`). Federated members are tracked solely on the room's `members` array — their home server doesn't need (and wouldn't be able to set) `inRoom` on their lobby entry across federation.
- **Banlist + allowlist-remove auto-kick recognises canonical form:** `room-ban` / `allowlist-remove` member-find now matches `target` against either `${m.username}@${m.homeServer}` (canonical) or bare `m.username`. So banning `noblemage@hive-book.com` from the allowlist panel kicks the right member; banning `@noblemage` (bare) still works for local members + as a fallback when there's no name clash.
- **Federation socket drop → immediate eviction (design call 5(a)):** new `cleanupFederatedMembersForPeer(domain)` helper iterates every room and kicks any member whose `homeServer === domain`, emits `kicked` on the temp Socket.io for each (with a clear "Federation connection to X was lost" reason), broadcasts `user-left` to room peers, runs `clearSpotlightIfMember` if a kicked member was spotlit. If a room has zero members after eviction, it's destroyed (timers cleared, chat history deleted) — same lifecycle as the existing leave-room flow. The fed-socket `ws.on('close')` handler calls this before `broadcastLobby` so the lobby refresh reflects the cleaned-up state in one round.
- **Client federated invite-accept flow:** `acceptInvite()` for `pendingInvite.from_server` now: emits `room-invite-respond { invite_id, response: 'accepted' }` over the home-server socket → shows `🔗 Connecting to <host>…` in the current surface (room or lobby) → if `currentRoom` is set, calls `leaveRoom()` first (auto-leave per design call 5(a)) → calls existing `openFederatedRoomSocket(targetServer, ...)` (the same one 1:1 federated calls already use) → on temp-socket connect, runs `enterRoom(targetRoom)` against it. `enterRoom`'s `join` payload now includes `homeServer: MY_SERVER_DOMAIN` when `activeRoomSocket` is set (federated context).
- **Temp-socket `disconnect` handler:** if the temp Socket.io drops while we're in the federated room (host crashed, federation drop, network glitch), client surfaces `⚠ Lost connection to <host> — you were removed from #<room>.` and runs `leaveRoom()` for clean local cleanup. User-initiated leave (click Leave Room) clears `currentRoom` first, so this disconnect-handler is a no-op in that case (avoids double-cleanup).
- **B.5 fix — 1:1 federated calls:** call rooms are created in [server.js:2751](server.js#L2751) with `allowlist: new Set([caller, callee])` (both BARE names). Part B's canonical-form allowlist match (`r.allowlist.has(canonicalUser)`) broke the federated-callee path because `reeman@v4call.com` doesn't match bare `reeman` in the allowlist. **Fix:** added bare-fallback in the join handler — `else if (isFed && r.allowlist.has(username)) joinedVia = 'allowlist'` (and same for `paidInvitees`). v0.16 federated rooms still match canonically (their allowlist entries are canonical, so the canonical match wins); the bare-fallback is only the legacy 1:1-call path.
- **B.5 fix — temp-socket transient disconnect:** the disconnect handler was firing on EVERY disconnect including transient ones (transport close, ping timeout). Socket.io's auto-reconnect handles those, but my handler was calling `leaveRoom()` first → user got yanked out of the room mid-call when the network blipped. **Fix:** gate on `reason === 'io server disconnect'` only — that's the server-explicit-close case (genuinely non-recoverable). Transient drops now let Socket.io reconnect transparently. Explicit kicks still come through the existing `kicked` event (which is in `FEDERATED_ROOM_EVENTS` and properly forwarded), so the fed-drop eviction path remains correct.
- **B.6 fix — 1:1 call rooms crash on join after Part B's broader field expectations.** The B.5 banlist guard accessed `rooms[room].banlist.has(...)`, but 1:1 call rooms (created in the `call-invite` handler at server.js:2749) only initialise `creator/allowlist/members/createdAt/isCall/callType/callId/federated` — no `banlist`, no `paidInvitees`, no `tokenGate`, no `banlistVisibility`, no `spotlight`. Part B's join handler unconditionally reads all of these, so joining ANY 1:1 call room crashed the entire Node process with `TypeError: Cannot read properties of undefined (reading 'has')`. Docker auto-restarted the container, but the user's test session was constantly hitting fresh server state — explains the cascading symptoms (caller in lobby with broken End-Call, callee alone in room, "noblemage kicked out then can't rejoin", stuck media). **Fix:** call-room creation now initialises `banlist: new Set()`, `tokenGate: null`, `banlistVisibility: 'admin'`, `paidInvitees: new Map()`, `spotlight: null` — same default shape as multi-party rooms. The B.5 banlist `b && (...)` defensive guard remains as belt-and-braces against any future room-creation path that forgets a field.

### Federation (v0.4)
- **Server-to-server WebSocket:** persistent connection on `/federation`, domain tiebreaker so only the lower-domain initiates outbound (avoids flapping)
- **Verify.json domain proof:** signer page produces a Hive-key-signed JSON file hosted at `/.well-known/v4call-server.json`. Discovering servers fetch + verify the signature against the signer's posting pubkey from Hive.
- **Hive directory:** server-announce page produces a `v4call-server` tagged Hive post. Discovery scanner queries `condenser_api.get_discussions_by_created` every 2h.
- **Approval gate:** verified peers must be explicitly approved. Seed list from `FEDERATION_PEERS` env auto-approves on startup; manual approvals via `POST /admin/peers/approve` persist to `approved-peers.json`.
- **Cross-server presence:** federated users appear in the lobby with a server-domain badge.
- **Cross-server DMs:** ciphertext relayed via federation `dm` message; server never sees plaintext. Supports paid DMs (recipient's server re-verifies on-chain, disburses from its own escrow).
- **Cross-server 1:1 calls:** caller's server hosts the room, callee's browser opens a temporary cross-server Socket.io connection for WebRTC signalling. Media still peer-to-peer.
- **Cross-server payments:** caller pays callee's escrow on Hive. Caller's server verifies and forwards `payment-verified`. Callee's server re-verifies, disburses callee-net + platform-fee + refund (refund as cross-server Hive transfer from its own escrow back to the caller).
- **Escrow-mismatch guard:** if a callee's rates-post escrow doesn't match the peer's announced escrow, paid calls fail loudly with a clear error explaining the mismatch.
- **Cross-server room invites (v0.4 Part A):** admin types `@user@peer.com` into the room's allowlist; server validates target server is approved + connected + on protocol_version >= 0.4; sends `room-invite` over federation. Receiving server delivers a popup with a source-server badge. Accept/decline flow back as `room-response`. Pending invites prune after 15 minutes.
- **Cross-server room join (v0.4 Part B):** accepting a federated room invite opens a temp Socket.io from the joiner's browser to the host server (same direct browser↔server pattern 1:1 federated calls already use). `homeServer` in the `join` payload lets the host server match the joiner against the room's canonical `user@server` allowlist entry. Multi-party WebRTC media is peer-to-peer as ever. Federated members appear in the room user-list and on video tiles with a `@hive-book.com`-style server badge. Token-gating works across federation (chain-side balance check is peer-agnostic). Banlist + allowlist-remove auto-kick honour canonical form. Federation peer drop while a federated user is mid-room → host server immediately evicts them (no grace period for rooms — no payment to refund). Temp-socket drop on the joiner side → "Lost connection to host" message + clean leave-room.
- **`protocol_version` gate:** explicit version field added to the hello envelope. Allows incremental wire-format additions (v0.4, v0.5, ...) without breaking older peers — old peers ignore unknown message types, new features only activate when both ends advertise the required version.

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
- **Hive node failures look quiet:** Fixed in v0.12 — `hivePost` now logs HTTP status, JSON-RPC errors, and a raw body preview when a node returns 200 OK without `result`. If you ever see this regress, check `server.js`'s `hivePost` helper.
- **`condenser_api.get_discussions_by_created` `limit` cap is 20:** Hive nodes enforce this with `Assert Exception` on values > 20. The discovery scanner's `limit` was 50 in v0.11 and silently failed on every node; fixed in v0.12. If you add another `get_discussions_by_*` query, keep `limit ≤ 20` and paginate via `start_author + start_permlink` if you need more.
- **Browser cache hides client fixes:** After a `docker compose ... up -d` of new client code, mobile Safari/Brave can keep serving the cached `index.html` for hours. If a fix that should be visible isn't, clear browser history/site data on the device first.
- **iPhone Hive Keychain doesn't inject `window.hive_keychain`:** iOS Safari and iOS Brave (also WebKit) don't allow extensions that inject scripts into pages. The Hive Keychain *mobile app* exists but can't talk to web pages the way the desktop extension does, so paid actions fall through the "Keychain required" error on iOS. **Not a v4call bug.** Future workaround options: HiveSigner web flow (`https://hivesigner.com/sign/transfer?...`) as a fallback when `window.hive_keychain` is undefined; or `@hiveio/keychain-sdk` for QR/deep-link handshake to the mobile app. See "Future Work" for the planned approach.
- **`element.style.display = ''` does NOT override a CSS `display:none` rule.** Setting an empty string just *removes* the inline declaration; the cascade re-applies whatever the stylesheet says — which for v4call's hidden-by-default buttons is `none`. This bit us hard from v0.11 to v0.14.5: four header buttons (`#leave-room-btn`, `#popout-btn`, `#export-room-btn`, `#end-room-btn`) were never visible. The working pattern is the `.shown` class that `#enable-mic-btn` etc. use — `#id { display: none; }` + `#id.shown { display: inline-block; }` (the compound selector has higher specificity than the ID alone), with JS toggling via `classList.add('shown')` / `classList.remove('shown')` (or `classList.toggle('shown', cond)` for conditional cases). When adding a new hidden-by-default button, **use the `.shown` class pattern, never `style.display = ''`.**
- **Avoid duplicate property declarations in the same CSS rule.** `#call-cost-ticker` had `{ display:none; ...; display:flex; ... }` from v0.11 onwards — last-wins meant it was always `flex` and the `.active` modifier was a no-op (End Call button always visible regardless of ticker state). When CSS rules grow long, scan for repeated property names before pasting more.
- **A WebRTC offer with no `m=` lines forces an answer with no `m=` lines.** From v0.12 (when text-only room joins shipped) until v0.15: text-only joiners' `createPC` had no `localStream` so no tracks got added → no transceivers → `createOffer()` produced an SDP with zero media sections. Existing peers' `createAnswer()` mirrors the offer's m-lines (per JSEP), so the answer was also empty. Result: existing peers' tracks were attached to the new PC but never sent — text-only joiners couldn't see anyone's cam or hear their mic until they enabled their own. Fix: **always ensure both audio + video transceivers exist** in `createPC` — `if (!haveAudio) pc.addTransceiver('audio', { direction: 'recvonly' })` + same for video. Chrome's `addTrack` algorithm reuses unused recvonly transceivers, so the existing enable-cam-mid-room path keeps working without duplicate m-lines. **Lesson:** when adding `addTrack` conditionally based on local media availability, also add `addTransceiver(kind, { direction: 'recvonly' })` for the kinds you're not sending — otherwise you can't receive that kind either.
- **`git fetch --all && git reset --hard origin/main` will clobber operator-specific files.** Specifically `nginx/v4call.conf` (where the operator's domain replaces the placeholder `v4call.com`) and `public/.well-known/v4call-server.json` (the operator's signed verify file from `/server-sign.html`). Both ship as templates/placeholders in git; a hard reset reverts them to the shipped versions, which breaks HTTPS (wrong domain in nginx config) and federation (verify.json reverts to placeholder). **Operators must back up these two files before updating** — see WalkThrough.wiki "Updating to a new version" for the recommended `cp ... bk....` flow. When proposing repo updates to the user, always remind them to back up these two files first.

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

# v0.13 — Lobby Notice + Anti-Spam Gate (built)
LOBBY_NOTICE             — Custom text shown under the lobby title. Blank = auto-generated
                           from SERVER_DOMAIN ("<domain> — local lobby. For federated
                           contacts use rooms / DMs / calls.").
LOBBY_REQUIREMENTS_TEXT  — Custom text describing posting requirements. Blank = auto-
                           generated from the gate vars below.
LOBBY_POST_MIN_HP        — Minimum *owned, staked* Hive Power to post in lobby
                           (broadcast or encrypted-toggle). 0 or blank = no HP gate.
                           Owned-only — delegated-in HP does NOT count.
                           HP = vesting_shares × hive_per_vest.
LOBBY_POST_MIN_HIVE      — Minimum *liquid* HIVE balance (the spendable wallet balance,
                           NOT staked HP). 0 or blank = no liquid-HIVE gate.
LOBBY_POST_MIN_TOKEN     — Minimum custom Hive-Engine token balance to post (format:
                           SYMBOL:amount, e.g. HIVEBOOK:10). Blank = no token gate.
LOBBY_POST_GATE_MODE     — or | and. Only used when 2+ of the gates above are set.
                           "or"  = user passes if ANY single threshold is met (default)
                           "and" = user passes only if ALL configured thresholds are met
                           One gate set → that one gate is the requirement.
                           No gates set → no posting restriction.
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

### v0.12 — Polish + Diagnose ✅ shipped
All items below landed. See "v0.12 polish" section above for what each fix does.
- ~~Mobile viewport zoom fix~~ → 16px input rule on `≤720px` (iOS-only issue, Android was fine)
- ~~Mobile DM panel currency picker parity with desktop~~ → header wrapping + body stacking on mobile
- ~~Room joins default to text-only~~ → with `🎤 Enable Mic` / `🎥 Enable Cam` buttons + WebRTC renegotiation
- ~~DM preview duplication fix~~ → `dmHistoryLoaded` Set + signature dedup in `addLobbyMsg`
- ~~`text-payment-received` event leaking to sender~~ → wasn't actually leaking; same root cause as the dedup bug (sender was seeing repeated history renders, mistook for a server-side leak)
- ~~Discovery scanner returning 0 peers~~ → Hive node `limit` capped at 20 (was 50). Fixed + improved logging exposed it within minutes.
- **Bonus fixes added during the pass:**
  - Paid-DM badge now shows the actual currency (was hardcoded "HBD"); `dm_messages` schema migrated to add `currency` column
  - Token balance cache no longer poisons itself with 0 from API errors
  - `/admin/discovery-test` + extended `/debug-rates` for fast diagnosis without a fresh build
  - `curl` added to the container (was missing — alpine ships only `wget`)

### v0.13 — Lobby Reorganization + Notice + Anti-Spam Gate ✅ shipped
All items below landed. See "v0.13 polish" section above for what each fix does.
- ~~4-tab lobby (DM / Local Lobby / Active Rooms / Included Rooms)~~
- ~~DM panel relocated into its own tab + dedicated `#dm-messages` container~~
- ~~`lobby-config` event with `LOBBY_NOTICE` / `LOBBY_REQUIREMENTS_TEXT`~~ (auto-generated from gate vars + `SERVER_DOMAIN` when blank)
- ~~Anti-spam gate on `lobby-chat` / `lobby-encrypted` with `LOBBY_POST_MIN_HP` / `LOBBY_POST_MIN_TOKEN` / `LOBBY_POST_GATE_MODE`~~ — short-circuits when disabled, owned-HP only (no delegated)

### v0.14 — Token-Gated Rooms + Banlist ✅ shipped
All items below landed in one focused session. See the "v0.14 polish" subsection above for what each fix does.
- ~~Token-gate at room creation~~ → optional `tokenGate: { symbol, amount }`, off by default
- ~~Server join check: allowlist OR token balance~~ → with explicit `joinedVia` tag
- ~~"via TOKEN" badge~~ → threaded through `addRoomUser` / `applyRoomUsers` / `user-joined` / resync
- ~~Live banlist~~ → `room-ban` / `room-unban` events; auto-kick via existing `kicked`
- ~~Banlist visibility toggle~~ → per-recipient `room-info` emit (`emitRoomInfoToMembers`)
- ~~Forward-compat `paidInvitees: Map`~~ → join check has the v0.17 hook line as a no-op

### v0.14.5 — Room Export / Import (`.v4room` files) ✅ shipped
All items below landed. See "v0.14.5 polish" subsection above for what each piece does.
- ~~JSON format with `.v4room` extension~~ — `format_version: 1`
- ~~Filename convention `<roomname>@<source-domain>__<ISO-timestamp>.v4room`~~
- ~~Any current member can export~~ — `📥 Export` button in room header
- ~~Any logged-in user can import~~ — `📤 Import .v4room file` in lobby
- ~~Room-name collision → prompt for rename~~
- ~~Server-side structural validation only; signature verification stays client-side~~
- ~~Importer becomes new admin; allowlist + tokenGate + banlist + visibility preserved~~
- **Bonus during the same cycle:** fixed two long-standing CSS bugs (`#call-cost-ticker` duplicate `display:` + `style.display = ''` not overriding CSS) — End Call no longer always-visible, Leave Room / Pop out / End Room finally show up. Documented in the v0.14.5 polish section above and in Known Gotchas.

### v0.15 — Spotlight Room Layout + Admin Delegation + Screen Share ✅ shipped
All items below landed in three independently-shipped builds (Part A, Part B, Part C). See "v0.15 polish" subsection above for what each piece does.
- ~~Centre spotlight tile, other participants tiled below~~ → spotlight slot + horizontal peer strip; mobile spotlight fills viewport, strip scrolls horizontally below
- ~~Local pin~~ → click any tile (admin and non-admin alike). `setSpotlight(wrapper, {user:true})` flags as user-initiated
- ~~Admin click-to-promote~~ → `📌` button in the room user-list (admin-only via `#room-users-list.am-creator` CSS gate). Server stores `r.spotlight` as username, broadcasts `room-spotlight-changed`. Soft override — users with a local pin keep it and see `↺ Follow room spotlight`
- ~~Admin role transfer~~ → `👑` button in the room user-list. Confirms, then `room-transfer-admin` server event. Validates target is current member; `room-info` `amCreator` flips both ways now (was OR-only) so previous admin's UI demotes correctly
- ~~Wire up the 🖥️ Share Screen button~~ → `getDisplayMedia({video:true})`, `replaceTrack` for cam-on path (no renegotiation), `addTrack` + renegotiate for cam-off path (reuses createPC's recvonly transceiver, no duplicate m-line). Auto-pins the sharer's own tile. Browser "Stop sharing" floating bar synced via `screenTrack.onended`. Cam button disabled while sharing. iOS gracefully shows "not supported" message
- **Bonus fix during the same cycle:** WebRTC SDP m-lines bug — text-only / voice-only joiners now actually receive existing peers' video and audio without enabling their own. `createPC` now adds recvonly transceivers for any media kind not already covered by `localStream` tracks, so the offer SDP has m-lines and the answer can carry the existing peers' tracks back. Long-standing bug since text-only room entry shipped in v0.12. Documented in Known Gotchas.

### v0.16 / federation v0.4 — Cross-Server Rooms ✅ shipped
- ~~Federated room invites — invite cnoobz on hive-book.com to a room on call.completenoobs.com~~ ✅ Part A shipped (v0.16)
- ~~Federation message types added: `room-invite`, `room-response`~~ ✅ Part A shipped (v0.16)
- ~~Forward-compat: `room-invite` envelope is a generic `{ ..., payload: {} }` so v0.17 paid expert invites populate `payload` instead of needing a new message type~~ ✅ confirmed in implementation
- ~~Backwards-compat: explicit `protocol_version: '0.4'` field gates v0.4-only features so v0.3 peers continue to work for everything they could do at v0.3~~ ✅ Part A shipped (v0.16)
- ~~A.5 polish — invite-flow messages route to current room when in one (lobby gets busy); `room-create` resolves federated invitees via `peerForUser` fallback so lobby user-picker selections actually invite~~ ✅ shipped
- ~~Cross-server room join: joiner's browser opens temp Socket.io to host server (same pattern as 1:1 federated calls), `homeServer` in `join` payload matches canonical allowlist form, auto-leave any current local room first per design call 5(a)~~ ✅ Part B shipped (v0.16)
- ~~Token-gating works across federation — chain-side balance check is peer-agnostic; uses bare username~~ ✅ Part B shipped
- ~~Federated badge in room user-list + video-tile labels (mirrors lobby + allowlist styles)~~ ✅ Part B shipped
- ~~Banlist + allowlist-remove auto-kick recognises canonical `user@server` form for federated members~~ ✅ Part B shipped
- ~~Federation peer drop → immediate eviction of that peer's federated members from all rooms; temp-socket drop → "Lost connection to host" message + clean leave-room~~ ✅ Part B shipped
- **No `room-ended` envelope shipped:** initially planned but turned out unnecessary — the temp Socket.io is a direct browser↔host-server connection independent of the federation socket, so existing `kicked` events propagate through it for end-room / ban / federation-drop cases. The home server has no `inRoom` state for federated rooms (per design — federated joins don't touch home-server room state), so there's nothing to clean up via federation. Saved one envelope.
- **Forward-compat reminder for v0.17:** the cross-server room-join flow should track an optional per-user "billing context" alongside the join (null for free invitees, an `activePayments` reference for paid invitees in v0.17). This thread is still un-pulled in v0.16 — `room.members` entries are `{ socketId, username, pubKey, joinedVia, homeServer }` and v0.17 adds an optional `activePayments` reference per member without refactoring the existing fields.

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
- **iPhone paid-action workaround** — see "iPhone Hive Keychain doesn't inject" in Known Gotchas. Plan: detect missing `window.hive_keychain` on mobile and fall back to a HiveSigner web URL (`https://hivesigner.com/sign/transfer?...` for HBD, `/sign/custom-json?...` for Hive-Engine tokens). User approves in the HiveSigner tab and returns to v4call. Adds an external dependency (hivesigner.com uptime + trust) but works with no extension and no SDK. Bigger version with `@hiveio/keychain-sdk` (QR/deep-link to the Keychain mobile app) is more polished but requires a build step.
- Persistent (non-ephemeral) rooms option
- Per-conversation read tracking (currently per-user last_seen)
- Voice-to-video upgrade mid-call (now half-built — v0.12 added enable-mic / enable-cam mid-room with renegotiation; the 1:1-call upgrade variant would reuse the same mechanism)
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
