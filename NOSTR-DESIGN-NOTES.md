# NOSTR-DESIGN-NOTES.md — pointer (content moved)

> This file was a 0-byte stub but `CLAUDE.md` referenced it as authoritative.
> Resolved 2026-05-18.

The Nostr **design rationale** (Architecture B/C, token mechanics, locked decisions,
the 8-phase original plan) lives in the **nGate repo**, not here:

- `/home/noob/CAI/nGate/NOSTR-DESIGN.md` — full design (Architecture B → C, token
  mechanics, phased plan).
- `/home/noob/CAI/nGate/NOSTR-DESIGN-NOTES.md` — further rationale, trade-offs,
  open questions.

The v4call-side **execution plan** (what to build in `server.js`, phases A→D,
key storage, `.env` additions, gotchas) is in this repo:

- [NOSTR-FED-BUILD-PLAN.md](./NOSTR-FED-BUILD-PLAN.md) — **start here for v4call work.**

See also [FEDERATION-BUILD-SPEC.md](./FEDERATION-BUILD-SPEC.md) for the existing
WebSocket federation (v0.2–v0.4) that Nostr augments but does not replace.
