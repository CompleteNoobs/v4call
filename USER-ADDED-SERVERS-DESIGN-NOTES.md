# User-Added Servers — Design Notes (future feature)

**Status:** Deferred. Not building yet — nGate and ipfs-gate are higher priority. These notes capture the design discussion from 2026-05-27 so you can pick it up later without re-deriving everything.

**Origin:** brainstorm thread 2026-05-27, after v0.16.17 (DM IPFS attachments) shipped. User explicitly wants this noted but pushed back to give nGate + ipfs-gate room.

**Companion:** This builds on the v0.18.5+ Nostr + Lightning plan in CLAUDE.md. Nostr there is **server-discovery layer**. This feature is **client-side aggregation layer**. They compose; neither replaces the other.

---

## The product gap

Today, federation is operator-to-operator. If `hive-book.com` and `v4call.com` are mutually approved, users on either see/DM/call across the boundary. But if `call.bar.com` isn't in either of those operators' approved list, users on hive-book.com can't reach friends on call.bar.com.

**The scenario that motivates this feature:**
- User `@foo` logs into `hive-book.com` (home server)
- `@foo` has friends on `call.bar.com`
- `call.bar.com` is NOT federated with hive-book.com, has NOT posted a `v4call-server` Hive announcement, is NOT discoverable via Nostr
- `@foo` wants to add `call.bar.com` to their browser session so they can comm with those friends — **without** needing either operator's permission

The user-added-server feature lets `@foo` paste `call.bar.com` into a "Add server" dialog and get aggregated comms across all three servers.

---

## Why this is mostly client-side

A v4call server already accepts any Hive-identified user via Keychain login. The browser doesn't need anyone's permission to open a Socket.io to `wss://call.bar.com` and log in as `@foo`. From `call.bar.com`'s perspective, this is indistinguishable from `@foo` "visiting" the server normally — it's just a login.

So the architecture is: browser maintains N+1 parallel Socket.io connections (1 home + up to N user-added), merges lobby/DM/room views, routes outbound by which socket sees the target user.

**Zero federation protocol changes required.** This is purely a frontend feature with one optional backend nicety (server-info endpoint for "is this a real v4call server?" validation).

---

## Trust verification — tiered approach

Three independent trust signals exist for "is `call.bar.com` a real v4call server I should add?":

| Signal | What it proves | Cost to operator |
|---|---|---|
| `/.well-known/v4call-server.json` (signed) | "@op controls this domain" via Hive key signature over the domain | One-time, free, no Hive post needed |
| `v4call-server` Hive post | Publicly announced, indexable on chain, auditable | Costs RC, 5-min post-gap rule, public commitment |
| Nostr `kind 30078` event (v0.19+ Nostr discovery layer) | Real-time discoverable via relays | Operator runs/uses a relay |

A "private friend server" can host the signed well-known file (cheap, technical, no public footprint) without ever doing the Hive announce or Nostr publish. This is the **sweet spot** for the `call.bar.com` scenario — small, doesn't want public Hive presence, but can prove its operator's identity.

**Make Hive announce optional, not required.** Forcing it closes off the private-friend-server use case, which is a legitimate (probably common) v4call deployment pattern.

### Suggested UX tiers for the "Add Server" dialog

- **Green / silent (verified)**: well-known signed + Hive announce + (later) Nostr → `✓ Verified server — operator @op (signed proof + Hive announcement)`. Add silently.
- **Amber / soft warn (signed-only)**: well-known signed but no Hive announce → `⚠ Domain proven by @op, but this server isn't publicly listed. Add only if you trust @op personally.` User confirms.
- **Red / hard warn (unsigned)**: no signed well-known file or signature fails → `✗ This server can't prove who runs it. Adding will let it see your username and relay messages claiming to be from your friends. Only continue if you personally trust the URL.` User confirms loudly.

**Trust framing for the docs:** Adding a server is the same trust act as choosing a home server. You're saying "I trust @op_of_bar to relay my messages, not log my plaintext metadata, and honour paid disbursements." That's no more or less risky than picking hive-book.com as home — but it deserves a loud surface because users may not realize they're making a trust decision when they paste a URL.

---

## What works naturally vs what needs follow-up work

### Works naturally (browser-side aggregation gets this for free)

- **Cross-server presence** within each connected server's local lobby (foo sees who's online on each of the 3 servers, with `@server` badges to disambiguate).
- **Cross-server DMs** — foo on hive-book.com DMs `@bob` on call.bar.com via foo's call.bar.com socket. Paid DMs hit call.bar.com's escrow per bob's rate post (assuming bob's rate post lists an escrow call.bar.com controls — see multi-escrow section below).
- **Cross-server 1:1 calls** — same routing. foo's browser opens the call via call.bar.com socket; WebRTC P2P media as usual; paid flows hit call.bar.com's escrow.
- **Identity proof** — `@foo` is the same Hive account on all 3 servers (Hive identity is server-agnostic). One Keychain identity, N logins.
- **Anti-spam gates** — each server still enforces its own `LOBBY_POST_MIN_HP` etc. against foo. No new bypass surface.
- **Offline DM delivery** — call.bar.com stores DMs to its local users in its own `dm_messages` table. Standard mechanics.

### Doesn't work cleanly without follow-up

1. **Cross-server room invites** rely on operator-level federation envelopes (`room-invite` over `/federation`). If hive-book.com isn't federated with call.bar.com, foo can't invite `@bob` to a room hosted on hive-book.com via the existing path. **Workaround:** send the invite as a DM ("foo invited you to room X on hive-book.com — click here"). Recipient's browser opens a temp Socket.io to hive-book.com (same pattern as v0.16 federated calls). Browser-mediated, not operator-mediated. Doable but a separate sub-build.
2. **Operator-level discovery** of new users (presence broadcast) doesn't propagate between unfederated servers. foo's view of who's online on call.bar.com is just call.bar.com's local lobby + everyone call.bar.com federates with. So adding a server gets you "everyone visible from that server" — not the union of all v4call users everywhere.
3. **Paid disbursement** lives where the recipient's escrow is. **This is the multi-escrow piece (see section below) — the load-bearing detail that makes paid flows across user-added unfederated servers actually work.**

---

## Multi-escrow in the rate post (companion feature)

**This is the piece that makes user-added unfederated servers a viable paid-flow path.** Without multi-escrow, paid DMs/calls to friends on `call.bar.com` only work if `call.bar.com` controls bob's single announced escrow — which it won't if bob is primarily on a different server.

### Current model
- Rate post has one `ESCROW:` line.
- Escrow account's active key must be controlled by the user's home server's operator.
- Cross-server paid flows: caller's server is verifier, callee's server (which controls the escrow key) is treasurer. Works as long as the rate-post escrow is on the callee's home server.

### Multi-escrow extension

**Syntax** (preferred, reuses existing `@user@server` federated-handle notation):

```
ESCROW: bob-escrow-hb@hive-book.com
ESCROW: bob-escrow-bar@call.bar.com
ESCROW-DEFAULT: bob-escrow-hb@hive-book.com
```

A line with no `@server` suffix means "single escrow valid everywhere" (today's behaviour). Backwards compat is free — existing rate posts work unchanged.

### Caller-side resolution algorithm

1. Parse rate post → list of escrows with optional server suffix.
2. Determine which server the caller is invoking the recipient through (the server where the recipient is currently visible to caller's browser).
3. If a multi-escrow entry's server suffix matches that server's domain, use it. Cross-check the escrow account against the server's announced `ESCROW_ACCOUNT` in `/.well-known/v4call-server.json` (the existing escrow-mismatch guard naturally extends).
4. Else use `ESCROW-DEFAULT` or the first entry.
5. If no match and no default → fail loudly with the same mismatch error pattern that exists today (no orphan funds).

### Rate-editor UX changes

- New section: list of `(server → escrow account)` rows. User can add multiple.
- For each row, the editor auto-fetches the server's `/.well-known/v4call-server.json` to:
  - Validate the server is real (catches typos)
  - Show the operator's Hive account (so user knows who they're trusting)
  - Suggest the server's announced `ESCROW_ACCOUNT` as the default value for that row
- "Default escrow" radio among the rows for the fallback case.
- Default row pre-filled with the current home server's announced escrow (preserves existing single-escrow UX for users who don't need multi).

### Operator-side change

**Zero.** Each server already controls one `ESCROW_ACCOUNT`. The multi-escrow change is entirely in the rate post + caller-side resolver. The user delegates the active key for `bob-escrow-bar` to bar.com's op via standard Hive account ops — same trust act as delegating to their home server's op today.

### Trust cost to the recipient

Multi-escrow means the recipient is trusting **N operators with N separate escrow accounts**. If the recipient creates separate escrow accounts (`bob-escrow-hb`, `bob-escrow-bar`), each operator only has the key to their own — clean isolation. If the recipient reuses one escrow across operators by sharing the active key with multiple ops, that's a real trust escalation (any of them can move funds). **Discourage key-sharing; require per-server accounts in the editor UI**.

### Forward-compat with federated paid invites

v0.16.11's inviter-holds-funds pattern (cap held in inviter's-server-escrow) extends naturally — inviter's escrow on inviter's home server, recipient's escrow on recipient's home server. If they're different servers (which is exactly the multi-server scenario), multi-escrow on either side handles it transparently with no protocol bump.

### Discovery / validation

When the user adds an escrow line for `@call.bar.com`, the rate-editor queries `https://call.bar.com/.well-known/v4call-server.json` and:
- Confirms the server is reachable + signed
- Reads the announced `ESCROW_ACCOUNT` and pre-fills it as the suggested escrow
- Shows operator's Hive account so user can verify "yes I want to delegate to @op_of_bar"

Reduces user error (wrong account name = paid flows to bar.com break silently).

---

## Storage of foo's added-server list

| Option | Pros | Cons | When |
|---|---|---|---|
| `localStorage` | Simple, no chain footprint, fast | Per-device, doesn't sync | v0.1 |
| Hive `account_update` json_metadata field | Syncs across devices, lives with Hive identity | Public commitment, costs RC | v0.2+ |
| Rate post `EXTRA-SERVERS:` line | Syncs, auditable, fits existing rate post format | Conflates rate config with comm config; bloats rate post | Probably not — keep rate post focused |
| Encrypted memo via Hive | Syncs, private | Complexity, hard to debug | v0.3+ if anyone asks |

**v0.1 = localStorage.** Defer chain-sync.

---

## Cap on added servers

User initially suggested 3. Reasonable for browser resource cost (3 extra Socket.io connections + presence streams) and UI density.

**Soft cap recommended**: UI strongly suggests 3, but the data structure doesn't refuse a 4th. Users who really want more can have them, with maybe a "you have a lot of servers connected — performance may degrade" warning at 5+.

---

## UX axes still to decide

1. **Per-server tabs vs unified lobby**: do you want one merged lobby with `@server` badges everywhere, or separate tabs per server? Merged is closer to today's federation UX (one DM tab, one room list); separate is clearer about which server hosts whom. Probably merged for DMs (conversations are per-user, not per-server) + a server-status sidebar showing connection health.
2. **Identity check on add**: should the browser verify foo's `@foo` Hive account works on the added server before completing the add? Almost certainly yes — that's just the existing v4call login flow. Worth saying explicitly so it's not skipped for "convenience."
3. **Persistent reconnect on page reload**: if foo refreshes the tab, do they auto-reconnect to all 3 added servers? Probably yes (localStorage-stored list + auto-reconnect on load). Keychain prompt cadence becomes the constraint — could be 1 prompt per session (challenge signed once, server issues a short-lived token).
4. **Remove a server from the list**: simple "✕" button per row. Disconnects the Socket.io, removes from localStorage. Any in-flight paid flows on that server's escrow stay on Hive regardless.

---

## Why this is deferred

User's framing: "nGate and IPFS-Gate is required". Both are higher-priority dependency work. User-added servers is a feature-rich enhancement that benefits power users + the multi-server-friend-group use case, but doesn't block anyone today (operator-level federation covers the 80% case).

Comes back into focus once:
- Nostr discovery layer (v0.19+) is in production — gives this feature a "verified server" path
- nGate + ipfs-gate are stable — no longer competing for design + ops attention
- Multi-escrow rate-editor extension is built — unblocks the paid-flow piece

Likely v0.20+ feature target. Probably 2-3 sessions of work:
- Session 1: backend `/info` endpoint, client-side multi-socket aggregation, localStorage list
- Session 2: rate-editor multi-escrow UI + caller-side resolver
- Session 3: UX polish (server-status sidebar, Add Server dialog with tiered warnings, identity check flow)

---

## Open questions to answer when you pick this back up

1. **Does Nostr discovery (v0.19+) ship before or alongside user-added servers?** If before, the Add Server dialog can have a "Browse known servers" picker (Nostr-sourced) alongside the manual URL entry. If alongside, manual entry only for v0.1.
2. **Does adding a server require Keychain login at add-time, or just at first comm action?** Add-time is friendlier UX (user knows immediately if the server doesn't accept them) but burns a Keychain prompt. Lazy login is fewer prompts but failures surface later.
3. **What happens to user-added servers when the operator of one disappears?** Server-status sidebar should clearly show "● online", "○ offline", "✗ unreachable", with auto-retry on the offline cases and manual remove for the unreachable ones.
4. **Cross-server room invites (item 1 in "Doesn't work cleanly")** — is the DM-link workaround acceptable, or does this need a proper protocol extension? Acceptable for v0.1; protocol extension only if usage data shows users actually want federated rooms across user-added servers.

---

*Last updated: 2026-05-27. Ping `@user-added-servers` in conversation to revisit. Multi-escrow piece is conceptually independent and could ship earlier as a rate-editor enhancement even before the user-added-server browser code lands.*
