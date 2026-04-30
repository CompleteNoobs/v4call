# v4call — Status Brief

A 2-minute "where are we?" snapshot. Detailed context lives in [CLAUDE.md](CLAUDE.md). Operator deploy steps live in [WalkThrough.wiki](WalkThrough.wiki). Federation wire format lives in [FEDERATION-BUILD-SPEC.md](FEDERATION-BUILD-SPEC.md).

Last updated: 2026-04-30

## Current state

- **Software:** v0.16.5 (lobby DM bypass fix shipped)
- **Federation protocol:** v0.4 (unchanged — v0.16.5 is a server-local fix, no protocol bump)
- **Production servers (federated):** call.completenoobs.com, hive-book.com, v4call.com
- **Stable:** yes — multi-party rooms, paid 1:1 calls, paid DMs, cross-server rooms all working

## Right now

**Just shipped:** v0.16.5 — awaiting user test + multi-server rollout
**Next planned build:** v0.16.6 — recipient-side rate enforcement (the architectural class fix; closes caller-side bypass surfaces before v0.17 adds more paid flows)

## Next 3 builds (in order)

1. **v0.16.6** — Recipient-side rate enforcement (re-validate rates on recipient's server for federated paid DMs + paid calls; closes the caller-side-trust class of bypasses)
2. **v0.17 Part A** — Local paid-expert invite + settlement (single server, no federation; inviter holds escrow funds)
3. **v0.17 Part B** — Cross-server paid-expert invite (federation v0.5 gate, populates `payload.paidExpert`)
4. **v0.18 (provisional)** — Spotlight UI overhaul (bigger spotlight, restructured layout — design pass needed before build)

## Recently shipped

- **v0.16.5** — Lobby DM bypass fix. Removed `lobby-encrypted` socket event entirely (was bypassing paid-DM rates / blocked-list / platform fee minimum / currency rules across federation). Lobby chat broadcast-only; user-list toggle now single-purpose (pre-select for Create Room invite). No protocol bump.
- **v0.16** — Cross-server rooms (federated invites + multi-party WebRTC across servers, federated badge, token-gating across federation, XSS hygiene pass)
- **v0.15** — Spotlight room layout, screen share, admin role transfer, WebRTC SDP m-line fix
- **v0.14.5** — Room export / import (`.v4room` files), CSS bugs fixed (End Call always-visible, Leave Room never-visible)
- **v0.14** — Token-gated rooms + live banlist + visibility toggle
- **v0.13** — 4-tab lobby, anti-spam gate (HP / liquid HIVE / token), lobby notice + requirements
- **v0.12** — Mobile polish, text-only room joins with mid-room enable-mic/cam, discovery scanner repaired

## Known bugs

*None currently tracked.* (v0.16.5 closed the lobby DM bypass; v0.16.6 will close the broader caller-side-trust class.)

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
