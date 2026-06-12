# v4call — Status Report (June 2026 · v0.16.29 · federation protocol v0.4)

**What it is:** A decentralized, federated communications platform built for
self-sovereignty. Anyone runs their own instance via Docker; instances federate
so users on different servers reach each other. Identity, payments, and discovery
run on open networks (Hive blockchain + Nostr) — not a central company. Users set
their own rates for paid calls and messages.

## Working now

**Communications**
- Voice calls, video calls, and screen-share — peer-to-peer (WebRTC), end-to-end
  encrypted; media never passes through the server.
- Encrypted direct messages — signed + encrypted to each user's Hive key; the
  server only ever stores ciphertext.
- Private rooms — allowlist-based, ephemeral (deleted when empty), multi-party
  video with a spotlight layout, optional token-gated entry, live banlist, and
  admin role transfer.
- Lobby presence + broadcast chat; federated users show with a server-domain badge.

**Identity & payments**
- Log in with your Hive account (Keychain or posting key) — no signup, no email.
- Set your own rates + named lists (family / friends / work / default) for who can
  contact you, for what, and at what fee — via the unified `user-announce` post.
  Time windows, blocked users, and token-gate bypass all supported.
- Pay with HBD, HIVE, or any Hive-Engine token (including SWAP.BTC / other SWAP.*
  wrapped coins). Funds held in escrow, verified on-chain, unused credit
  auto-refunded; missed/declined calls are refundable.
- Paid DMs, paid calls (ring + connect + per-minute), and paid room invites
  (anti-spam). The operator takes a small *minimum* platform fee — a free market,
  it varies per server.

**Federation**
- Primary transport: a direct server-to-server WebSocket link carrying presence,
  DMs, calls, rooms, and payments. Three servers live: v4call.com, hive-book.com,
  call.completenoobs.com.
- Nostr relays add fast peer discovery + cross-server presence — and, newly, an
  **optional fallback transport for DMs + file attachments** when the WebSocket
  link is down (calls + rooms stay on WebSocket).
- New `/api/info` endpoint: every server publicly reports its live escrow fee +
  capabilities, so the landing page auto-displays the fee and other apps can scan
  the federation.

**File sharing & media (over IPFS)**
- Send files in rooms + DMs, encrypted per-recipient — only addressed users can
  decrypt; everyone else sees a locked card.
- Two storage backends, your choice:
  - **Own IPFS-Gate** — paid in Hive tokens (current test setting: 1 TEST per
    upload, up to 60 MB, pinned for 14 min / 0.01 day).
  - **Pinata** — bring your own account (free 1 GB tier to test); you pay Pinata
    directly, no Hive fee.
- 15 file types (image / audio / video / PDF / text / archive) with **inline
  display** — image thumbnails, audio + video players, PDF viewer, text preview —
  or a download card.
- **📦 Uploads tab** — see, share, and do basic management of your pins across
  both IPFS-Gate and Pinata (delete / unpin, quota, status).
- **Public / plaintext uploads** — produce a shareable `https://…/ipfs/<cid>` link
  anyone can open, no v4call needed.
- A CID resolves from any IPFS gateway, so Pinata ↔ IPFS-Gate users interoperate
  freely.

**Rooms — extras**
- Export / import rooms as `.v4room` files — encrypted message history preserved
  (ciphertext only).
- Room content is encrypted to each member's key; an **ALL** option sends an
  unencrypted (plaintext) message to everyone in the room when you want open chat.

**Operator tooling**
- One-command Docker deploy; standalone tools for rate editing, server
  signing/announcing, peer admin, and Nostr/QR key generation.

## Known limits / next up
- **SWAP.BTC and other SWAP tokens currently work only down to 0.001** (a universal
  rate floor). Sub-floor rates (e.g. 0.00000001 SWAP.BTC) aren't supported yet —
  fixable via a per-currency precision upgrade.
- Mobile UI is on hold — current focus is the desktop experience.
- The Nostr DM/attachment transport is best-effort and optional (off by default);
  the WebSocket link stays preferred and is required for calls and rooms.
- Coming: per-user Nostr + Lightning contact fields, paid expert-invites (reverse
  payment — pay an expert to join your room), and in-browser user-added servers.
