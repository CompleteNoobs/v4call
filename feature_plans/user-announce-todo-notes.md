# user-announce.html — open TODO notes

Running notes captured while building/iterating `public/user-announce.html`
(the one modular Hive post — title `user-announce` — replacing per-app announce posts).

## 0. Positional rate priority — server resolver must read DOCUMENT ORDER (NEW 2026-06-05)
**Status:** editor handoff prompt issued 2026-06-06 (drag-to-reorder UI + emit order + "who pays what"
preview, tokens-as-one-contiguous-group, BLOCKED pinned top / default pinned bottom). **Server resolver
document-order change is still PENDING** — `getRatesForCaller` + `computePaymentOptions` currently still
resolve tokens-then-lists (fixed category order). Do the server side once the editor lands so the two agree.

The rates editor now lets the user **drag to reorder** rate rules; **priority is purely
positional** — the order blocks appear inside `[V4CALL-RATES-V2]` IS the evaluation order.
No new field/tag. Editor emits: `[BLOCKED]` first → middle units in the user's chosen order
(named lists + ONE contiguous `[TOKEN:*]` group) → `[LIST:default]` last.
- **Server change (separate v4call-server thread):** `getRatesForCaller` / `parseRateBlock`
  must resolve in **document order, first-match-wins** — walk units top-to-bottom: a `[LIST:name]`
  matches if caller ∈ USERS and day/time in a window; the token group matches if caller holds ≥1
  priced token (→ multi-currency picker among held). `[BLOCKED]` always first (ALLOW-IF-TOKEN
  bypass), `[LIST:default]` always last.
- **Backward-compat:** today's posts emit tokens BEFORE lists; document-order resolution of an
  un-reordered post reproduces current (tokens-first) behaviour. Don't migrate old posts.
- The editor's "WHO PAYS WHAT" tester replicates this exact algorithm as a footgun guard
  (e.g. ranking the token group above the family list). Keep editor + server algorithms in sync.

## 1. Federation hosting → escrow rules (NEW, raised 2026-06-05)
The "🌐 V4call service" section asks the user for their home server's **domain** + the
**escrow account that server controls**. Today there is **no standard rule** telling a user
how to discover the escrow account for a given federated host — they have to read that
provider's docs. The service-section info box says so explicitly.
- **TODO:** define a federation-hosting contract for escrow discovery — e.g. surface
  `ESCROW_ACCOUNT` in the host's `/.well-known/v4call-server.json` (already announced in the
  federation hello) and/or let user-announce auto-fill the escrow field by fetching the chosen
  server's verify file. Until then the field is manual.

## 2. Rate-field semantics changed — v4call server parser follows (DONE 2026-06-05, v0.16.27)
The rates section now emits, per window/token/list:
- `INVITE:`  → "Invite fee"  (cost to invite/offer you into a room — unchanged prefix; server already reads it)
- `OFFER:`   → "Offer fee"   (**new** prefix — server now **parses & captures** it into `r.offer`, read-only)
- `DM:`      → "DM fee"      (**new** prefix; replaces the old `TEXT:` per-DM fee)
- `TEXT-SESSION:` — **removed** entirely (the "/hr text session" concept is dropped)
- `PLATFORM-FEE:` — **removed** from the post (server falls back to its `DEFAULT_PLATFORM_FEE`)

**Status — server-side landed (v0.16.27):**
- `parseRateBlock` now reads `DM:` → `r.text` (the existing paid-DM machinery), with `TEXT:` kept as a
  backward-compat alias (DM wins if both present); `TEXT-SESSION:` still parsed for legacy posts.
- `OFFER:` is **parsed into `r.offer` (read-only)** — captured so user-announce posts round-trip, but
  **nothing consumes it yet**. The v0.17 paid-expert-invite flow is the intended consumer — see
  `project_v017_paid_invite_inviter_holds_funds`.
- **`fetchRates` now reads ONLY the `user-announce` post** — the old `v4call-rates` title match AND the
  fixed-permlink fallback were removed. Tradeoff: a user with only a legacy `v4call-rates` post (no
  user-announce yet) resolves to **no rates = free-for-all** until they post via `user-announce.html`.

## 3. New blocks not yet parsed by any consumer (deferred, by design)
`[OFFER removed]`, `[DOMAINS-V1]` (with `[DLIST:name]` → `DOMAINS:csv`), `[NOSTR-V1]`,
`[BITCOIN-V1]`, `[LIGHTNING-V1]`, `[SSH-V1]`, `[CONTACT-V1]`. The post format is loose-coupled
(each block independently versioned) so adding a reader is a self-contained extension.
nGate user-tier (Stage 5) + v0.18.5 Nostr/Lightning display are the natural first consumers.

## 4. Contacts section — design not baked
Current contact section is flat opt-in PHONE / EMAIL / FAX (one each). The user wants
**function-labelled, repeatable** contacts: e.g. `phone: work: 0123…`, `phone: personal: …`,
`email: admin@foo.com`, `email: admin@bar.com`. Idea not finalised.
- **TODO:** design a repeatable `{ kind, label, value }` entry list (kind = phone/email/fax/…,
  label = work/personal/role, value). Emit as `[CONTACT-V1]` lines like
  `PHONE:work:0123…` / `EMAIL:admin@foo.com:admin@foo.com`. Keep every entry opt-in + the
  "public & permanent on-chain" PII warning.

## 5. Caller-rates: full named-list editor not ported
user-announce supports one 24/7 window per named list. Multi-time-window / day-of-week splits
still live only in `rate-editor.html` (kept as-is for archive / fallback). Port later if needed.

## 6. Not yet linked / cleanup
- Link `user-announce.html` from `info.html` / `index.html`.
- Decide whether to deprecate `nostr-announce.html` once Nostr lives in the unified post.
- `rate-editor.html` intentionally left unchanged (archive + fallback).
