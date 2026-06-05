# user-announce.html — open TODO notes

Running notes captured while building/iterating `public/user-announce.html`
(the one modular Hive post — title `user-announce` — replacing per-app announce posts).

## 0. Positional rate priority — server resolver must read DOCUMENT ORDER (NEW 2026-06-05)
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

## 2. Rate-field semantics changed — v4call server parser must follow (NOT done)
The rates section now emits, per window/token/list:
- `INVITE:`  → "Invite fee"  (cost to invite/offer you into a room — unchanged prefix; server already reads it)
- `OFFER:`   → "Offer fee"   (**new** prefix — server does NOT parse it yet)
- `DM:`      → "DM fee"      (**new** prefix; replaces the old `TEXT:` per-DM fee)
- `TEXT-SESSION:` — **removed** entirely (the "/hr text session" concept is dropped)
- `PLATFORM-FEE:` — **removed** from the post (server falls back to its `DEFAULT_PLATFORM_FEE`)

**Consequence:** the current `server.js` `parseRateBlock` reads `TEXT:` (→ `r.text`, the paid-DM
rate) and `TEXT-SESSION:`. A `user-announce` post made with the new labels will NOT have its DM
fee enforced until the server learns `DM:` (and optionally `OFFER:`). This is deferred consumer
wiring — same bucket as parsing the other new blocks. When wiring:
- map `DM:` → `r.text` (the existing paid-DM machinery) OR introduce `r.dm` and migrate.
- decide what `OFFER:` means server-side (likely the v0.17 paid-expert-invite floor) — see
  `project_v017_paid_invite_inviter_holds_funds`.
- keep reading old `TEXT:`/`TEXT-SESSION:` from legacy `v4call-rates` posts for back-compat.

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
