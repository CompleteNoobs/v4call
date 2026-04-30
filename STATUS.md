# v4call — Status Brief

A 2-minute "where are we?" snapshot. Detailed context lives in [CLAUDE.md](CLAUDE.md). Operator deploy steps live in [WalkThrough.wiki](WalkThrough.wiki). Federation wire format lives in [FEDERATION-BUILD-SPEC.md](FEDERATION-BUILD-SPEC.md).

Last updated: 2026-04-30

## Current state

- **Software:** v0.16
- **Federation protocol:** v0.4
- **Production servers (federated):** call.completenoobs.com, hive-book.com, v4call.com
- **Stable:** yes — multi-party rooms, paid 1:1 calls, paid DMs, cross-server rooms all working

## Right now

**Building:** v0.17 / federation v0.5 — Paid Expert Invites
**Stage:** design locked-in (admin-only payer, invite-as-contract, inviter holds escrow funds upfront), awaiting Part A build

## Next 3 builds (in order)

1. **v0.17 Part A** — Local paid-expert invite + settlement (single server, no federation)
2. **v0.17 Part B** — Cross-server paid-expert invite (federation v0.5 gate, populates `payload.paidExpert`)
3. **v0.18 (provisional)** — Spotlight UI overhaul (bigger spotlight, restructured layout — design pass needed before build)

## Recently shipped

- **v0.16** — Cross-server rooms (federated invites + multi-party WebRTC across servers, federated badge, token-gating across federation, XSS hygiene pass)
- **v0.15** — Spotlight room layout, screen share, admin role transfer, WebRTC SDP m-line fix
- **v0.14.5** — Room export / import (`.v4room` files), CSS bugs fixed (End Call always-visible, Leave Room never-visible)
- **v0.14** — Token-gated rooms + live banlist + visibility toggle
- **v0.13** — 4-tab lobby, anti-spam gate (HP / liquid HIVE / token), lobby notice + requirements
- **v0.12** — Mobile polish, text-only room joins with mid-room enable-mic/cam, discovery scanner repaired

## Known bugs

- **Lobby user-list toggle bypasses paid-DM rates.** When users are toggle-selected in the lobby (the same toggle used to pre-select users for invite to a new room) and you type a message in the lobby chat input, the message sends as a **free DM** to those selected users instead of posting to the lobby. This bypasses any paid-DM rates the recipient has set. Fix: lobby chat send button should ALWAYS post to lobby (local-server only); user-list toggle-select should only affect the room-create flow. Discovered 2026-04-30 during 3-server federation testing. **Affects:** correctness + payment-flow security. **Build estimate:** small focused fix in `public/index.html` (and possibly server-side hardening to reject the bypass path).

## Backlog (unordered)

### Paid-flow hardening (post-v0.17)
- Settlement state persistence (paid sessions survive server restart)
- Federation-drop grace for paid sessions (vs. immediate eviction for free members)
- Admin-leaves-mid-paid-session settlement behaviour
- Global escrow reservation accounting (when "one offer at a time" limit is lifted)
- "Anyone in room with funds can invite" expansion (currently admin-only for v0.17)

### Deferred features
- Paid lobby posting
- Paid room creation
- Split-equal expert pay (members fund shares)
- Pay-as-you-add expert pay
- Persistent (non-ephemeral) rooms option
- Per-conversation read tracking

### Security hardening
- Server-side signature verification on chat messages
- Rate limiting middleware (Socket.io + Nginx)
- Input validation hardening (usernames, room names, memos)
- SQLCipher for at-rest encryption (production deployments)

### Platform / infra
- iPhone Keychain workaround (HiveSigner web fallback)
- STUN/TURN server config via .env
- Nostr layer for real-time push (after federation otherwise stable)
- Voice-to-video upgrade mid-call (1:1 calls — half-built, mid-room version already shipped)

### Doc / housekeeping
- Cost of creating a custom Hive-Engine token (worked example using CNOOBS)

## Where to read more

- [CLAUDE.md](CLAUDE.md) — full project context, design decisions, Known Gotchas
- [README.md](README.md) — what v4call is, public-facing
- [WalkThrough.wiki](WalkThrough.wiki) — operator deploy guide
- [FEDERATION-BUILD-SPEC.md](FEDERATION-BUILD-SPEC.md) — federation wire format

## Maintenance rule

Update this file as the **last step** of every shipped version:
1. Bump "Software: vX.Y" line
2. Move just-shipped item from "Right now" → top of "Recently shipped" (oldest drops off the list)
3. Pull next item from "Next 3 builds" up to "Right now"

30 seconds. If you forget, the brief gets stale but nothing breaks.
