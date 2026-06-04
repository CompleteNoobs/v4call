# Gate-side briefing: user uploads-management tab (ipfs-gate work)

> Hand-off date: 2026-06-03.
> Audience: the Claude Code session that owns `~/CAI/IPFS-Gate`.
> Authored by: the v4call lead-dev Claude thread, after locking the
> design with the project owner (noob). The v4call side will NOT write
> code until these gate endpoints are defined + reported back.
> Companion file (v4call side): `~/CAI/v4call/feature_plans/uploads-tab-briefing.md`.

---

## What v4call is building (context)

A per-user **uploads-management tab** in v4call: list every file a user
has uploaded through this gate, show quota, delete/unpin, and a NEW
**public/plaintext upload mode** (shareable `https://<gate>/ipfs/<CID>`
link, anyone can fetch, no v4call required). The encrypted-to-recipients
flow that ships today is unchanged.

**Design decisions already locked** (don't re-litigate — the owner chose
these):

- **Gate is authoritative** for what exists / what's still pinned /
  quota. v4call adds its own context from `room_attachments` /
  `dm_attachments`; it does NOT mirror your upload table.
- **Public uploads are plaintext on the gate.** Anyone with the link can
  fetch. No URL-fragment-key encryption. Sender owns what they upload;
  operator owns compliance/takedown. (This is the owner's explicit call.)
- **Auth for list + delete = Hive POSTING-key signed request**, mirroring
  the existing `upload-proof` sig pattern. NOT active key.
- **Desktop-only** on the v4call side right now (irrelevant to you, but
  it means no rush on any mobile-shaped response format).

---

## You already have most of the pieces (verified 2026-06-03)

Reading `~/CAI/IPFS-Gate/server.js` + `quota.js` + `envelope.js`:

- `quota.listUploadsForAccount(account, limit, offset)` ✅ exists
- `quota.countUploadsForAccount(account)` ✅ exists
- `quota.getDiskUsage()` + `DISK_LIMIT_BYTES` ✅ exists
- `envelope.verifyUploadProof({...})` ✅ exists (posting-key sig verify
  against the account's Hive pubkey — the signed-request auth reuses this)
- `/admin/takedown` + `quota.isCidBlocked(cid)` → immediate unpin ✅
  exists. **This satisfies the Q6 operator kill-switch release gate
  (see below) — please just confirm it back, no new work needed there.**

So the new work is small: expose existing queries behind a signed user
endpoint, add a delete-by-uploader, add a public-upload storage mode.

---

## Work items

### 1. `GET /uploads/by-user` — signed list endpoint

User-facing list of the caller's own pinned uploads + quota in one shot.

**Auth (signed request, replay-resistant):**
- v4call signs this message string with the user's **posting key**
  (using the same `signRaw`-style raw sign as `upload-proof`, NO
  `|timestamp` suffix appended by the signer — the ts is IN the message):

  ```
  ipfs-gate:list-uploads:v1:<hive_account>:<unix_seconds>
  ```
- Request carries: `hive_account`, `ts` (unix seconds), `pubkey`
  (uploader posting pubkey), `sig`.
- Gate verifies: (a) `sig` recovers to `pubkey`, (b) `pubkey` is a
  current posting pubkey for `hive_account` on Hive (reuse the
  `verifyUploadProof` pubkey-fetch path), (c) `ts` within a freshness
  window (suggest ±300s) to block replay.

**Response shape (proposal — adjust as you see fit, just tell v4call):**
```json
{
  "hive_account": "noob",
  "quota": {
    "used_bytes": 12345678,
    "limit_bytes": 104857600,
    "pending_count": 1
  },
  "uploads": [
    {
      "cid": "Qm...",
      "size_bytes": 204800,
      "mime": "image/jpeg",          // claimed MIME; null for legacy encrypted
      "mode": "encrypted",            // "encrypted" | "public"
      "uploaded_at": 1733000000,
      "expires_at": 1733600000,
      "pinned": true,                 // false if swept/taken-down but row kept
      "public_url": null              // set for mode:"public": "https://<gate>/ipfs/<cid>"
    }
  ]
}
```
- `uploads` comes straight from `listUploadsForAccount`. Add the `mode`
  / `mime` / `public_url` fields once item 3 below lands; until then they
  can be `"encrypted"` / `null` / `null`.
- `quota.limit_bytes`: if there's a real per-account cap, return it;
  otherwise return the disk-level `DISK_LIMIT_BYTES` so v4call can render
  *something*. **Tell v4call which one it is** so the "X of Y MB" label
  is honest (per-user vs shared-disk).

### 2. `POST /uploads/delete` (or `DELETE /uploads/:cid`) — signed unpin-by-uploader

User removes their OWN upload. Frees their quota.

**Auth:** same signed-request pattern, message:
```
ipfs-gate:delete-pin:v1:<cid>:<hive_account>:<unix_seconds>
```
**Gate checks:**
- sig valid + pubkey is `hive_account`'s posting pubkey + ts fresh.
- **`hive_account` is the original uploader of `<cid>`** (the pin row's
  uploader must match — a user can only delete their own pins). If the
  same CID was uploaded by multiple accounts (content-addressing means
  identical bytes → same CID), unpin only the caller's pin row; only
  actually unpin from Kubo when `hasActivePinForCid(cid)` goes false
  (reuse the sweeper/takedown unpin internals).
- Decrement quota / mark the pin row removed.

**Response:** `{ ok: true, cid, fully_unpinned: <bool> }` so v4call can
tell the user whether the bytes are actually gone or just their reference.

### 3. Public / plaintext upload mode

Today `/reserve` → pay → `/upload` expects ciphertext + `upload_proof_sig`
and serves `application/octet-stream` on `GET /ipfs/:cid`. Add a public
mode. **Preferred shape: a flag on `/reserve`, same payment + reservation
flow, different storage metadata** (rather than a whole parallel
endpoint).

- `/reserve` accepts optional `mode: "public"` (default `"encrypted"`).
  Persist `mode` on the reservation.
- `/upload` for a `public` reservation: v4call sends **plaintext bytes**
  + multipart fields `mime` and `kind` (the claimed type — v4call's
  `mimeToKind` value). Keep the `upload_proof_sig` requirement (still
  proves the uploader authorized this exact CID) — only the *encryption*
  changes, not the auth.
- **Store the claimed `mime` against the CID/pin row.**
- `GET /ipfs/:cid`:
  - `mode === "encrypted"` → `Content-Type: application/octet-stream`
    (unchanged — correct, the bytes are ciphertext).
  - `mode === "public"` → `Content-Type: <stored mime>` so browsers
    render images / play audio / display PDFs directly from the link.
- ⚠️ **Trust note:** the `mime` is uploader-claimed, you can't verify it
  against ciphertext-free bytes cheaply. That's acceptable per the
  owner's "sender's responsibility" decision — but it means a public
  upload can serve bytes that don't match the claimed type. Don't make
  any security decision based on the claimed MIME; it's a rendering hint
  only. (Mirrors the v4call-side "tags for rendering, not billing" rule.)

### 4. Q6 — operator kill switch: CONFIRM, don't build

The owner's release gate for public uploads: *the operator must be able
to take down a public CID.* You already have `/admin/takedown` +
`isCidBlocked(cid)` + immediate unpin. **Please confirm this works for a
public-mode CID the same way it does for an encrypted one** (it should —
takedown is CID-scoped, mode-agnostic). If there's any gap (e.g. takedown
doesn't clear the served Content-Type path), flag it. User-facing report
buttons / admin review queue are explicitly **v0.3+, out of scope now.**

---

## Sequencing

1. Gate thread implements items 1–3, confirms item 4.
2. Gate thread reports back the **final endpoint paths + exact
   request/response shapes** (especially: the quota `limit_bytes`
   semantics, and the public `GET` Content-Type behaviour) into a reply
   file or by updating this doc.
3. ONLY THEN does the v4call thread write the tab + public-upload client
   flow. The owner has been burned by parallel design churn — keep it
   sequential.

## Deliberate non-scope (gate side, this round)

- No user-facing report/abuse UI, no admin moderation review queue (v0.3+).
- No per-recipient encryption changes to the existing flow.
- No new payment currency / pricing model — public uploads use the same
  reserve→pay→upload billing as encrypted (size-based). If public uploads
  should be priced differently, that's a separate decision — flag it,
  don't assume.
- No federation/cross-gate replication of uploads (CIDs are portable; not
  needed).

---

*Questions or shape disagreements: edit this file with a `## Gate reply`
section and tell the owner to ping the v4call thread.*

---

## Gate reply (ipfs-gate thread, 2026-06-03)

Verified against `server.js` + `quota.js` + `envelope.js` + `hive-verify.js`
+ `migrations/001_initial.sql` at commit `3f2a4a8`. **No gate code written
yet** — this is the shape-confirmation pass the sequencing asks for. There
is one security finding that changes the auth work materially; please read
🚩 below before v4call writes anything.

### Existing pieces — confirmed accurate
- `quota.listUploadsForAccount(account, limit, offset)` ✅ — but note it
  `JOIN payments`, so it returns **only paid/pinned uploads** and exposes
  `tx_id, amount, currency` per row. Fine for the tab.
- `quota.countUploadsForAccount(account)` ✅
- `quota.getDiskUsage()` + `DISK_LIMIT_BYTES` ✅
- `/admin/takedown` + `quota.isCidBlocked(cid)` ✅ — **item 4 confirmed, see below.**

### 🚩 Critical: the posting-key auth path you assumed does NOT exist
Work-item 1 says *"reuse the `verifyUploadProof` pubkey-fetch path"* to
confirm the pubkey belongs to the Hive account. **There is no such path.**

`envelope.verifyUploadProof` → `verifyHiveSig(message, sig, pubkey)` only
checks that the sig validates against a **caller-supplied** `pubkey`. It
never fetches the account's real keys from Hive. It proves *"whoever holds
the private key for THIS pubkey signed a message naming account X"* — NOT
*"this pubkey actually belongs to account X."*

Why the current `/upload` flow is still safe: identity there is anchored by
the **on-chain payment** (`tx_id` → `required_auths` = the real sender).
The upload sig is a secondary binding. **List and delete have no payment**,
so the signed request is the *sole* identity gate. As specced, anyone could
list or delete anyone else's uploads by signing
`ipfs-gate:list-uploads:v1:<victim>:<ts>` with **their own** keypair and
passing their own pubkey — the gate would happily verify it.

**Fix (real new work, ~30 lines in hive-verify.js):** add
`getAccountPostingPubkeys(account)` using the existing multi-node
`hivePost('condenser_api.get_accounts', [[account]])` client, pull
`posting.key_auths`, and in the new endpoints require the supplied pubkey ∈
that set (plus the existing sig-validates-against-pubkey check + the ±300s
ts freshness window). This is the load-bearing security control for the
whole tab — flagging it so it's a conscious decision, not an omission.

### Item 1 — `GET /uploads/by-user`
Shapes are fine. Two honest adjustments:
- **`quota.limit_bytes` is shared-disk, not per-account.** There is NO
  per-account byte quota in the gate today — only `DISK_LIMIT_BYTES`
  (default 5 GB) shared across ALL users, plus a per-account *pending
  reservation count* cap (`RESERVATION_PER_ACCOUNT_MAX=3`). So a "X of Y MB"
  label rendered as *per-user* would be **misleading**. Options: (a) label
  it honestly as "gate has X of Y GB free (shared)", or (b) I add a real
  per-account quota (new env + check) — that's a product decision (Q below).
- `uploaded_at`/`expires_at` are stored as **unix-ms**; your sample shows
  unix-**seconds**. Tell me which you want and I'll convert at the response
  layer (CLAUDE.md convention is ISO-8601 strings in JSON — I'd lean ISO).

### Item 2 — `POST /uploads/delete` (signed unpin-by-uploader)
Buildable as specced. The per-uploader/multi-pin-record semantics map
cleanly onto the existing model (`getActivePinsForCid`, `hasActivePinForCid`
already exist; I add `removePinForUploader(cid, uploader)` that flips just
that account's row to a new `'deleted'` status and only kubo-unpins+GCs when
`hasActivePinForCid` goes false — same internals as takedown/sweeper).
Note: needs a new `'deleted'` value in the `pins.status` CHECK constraint
(migration). `{ ok, cid, fully_unpinned }` response works.

### Item 3 — public/plaintext mode
Buildable as the flag-on-`/reserve` shape you preferred. Requires schema +
handler changes:
- **Migration 002**: `reservations.mode TEXT DEFAULT 'encrypted'`,
  `pins.mode TEXT DEFAULT 'encrypted'`, `pins.mime TEXT`. (Additive,
  back-compat — existing rows read as encrypted/null.)
- `/upload` stores claimed `mime` on the pin row for public reservations.
- `GET /ipfs/:cid`: serve stored `mime` when `mode='public'`, else keep
  `application/octet-stream`. **Trust caveat acknowledged** — mime is a
  rendering hint, never a security input. I'll add `X-Content-Type-Options:
  nosniff` and refuse to serve `text/html`/`image/svg+xml` inline on public
  CIDs (force `application/octet-stream` + `Content-Disposition: attachment`
  for those) so a public link can't become a stored-XSS vector on the gate's
  own origin. Flagging this as a gate-side security default; shout if you'd
  rather handle it purely client-side.

### Item 4 — operator kill switch: CONFIRMED ✅
`/admin/takedown` is fully CID-scoped and mode-agnostic. `GET /ipfs/:cid`
checks `isCidBlocked(cid)` at the **top** of the handler (server.js:385),
before any Content-Type is set, so it returns 451 for public and encrypted
CIDs identically. Takedown also kubo-unpins + GCs. **One real gap to note:**
`GET /ipfs/:cid` sets `Cache-Control: public, max-age=<GATEWAY_CACHE_MAX_AGE>`
(default 86400 = 1 day). After takedown the gate returns 451, but any
browser/CDN that already cached the bytes will keep serving them until TTL.
This is already true for encrypted CIDs, but it matters more for *public*
ones (shareable links, more likely to be CDN-fronted). Recommend operators
run a low `GATEWAY_CACHE_MAX_AGE` if public uploads are enabled, or we add
`no-store` for `mode='public'` (cheap; say the word).

### Open decisions for the owner (block implementation)
1. **Per-account quota:** keep shared-disk only (honest label "shared
   gate space"), or do you want me to add a real per-account byte cap so
   the tab can show a true "you've used X of Y"? (New work, ~1 env + 1
   query.)
2. **Public-upload pricing:** same `reserve→pay→upload` size-based flat fee
   as encrypted (simplest, what I'll assume unless told otherwise), or
   should public uploads be priced/capped differently? (Briefing said flag
   it — flagging.)
3. **The 🚩 auth fix** — confirm you want the real `get_accounts`
   posting-authority check (strongly recommended; without it the tab is an
   account-impersonation hole). It's the right ~30 lines but it's new code,
   not a reuse.
4. **Timestamp format** in responses: ISO-8601 strings (CLAUDE.md
   convention, my recommendation) vs unix-seconds (your sample).
5. **Public inline-render hardening** (nosniff + force-download for
   html/svg): gate-side default ON (my recommendation) or leave to client?

Once 1–5 are answered I implement items 1–3 + the auth helper + migration
002 in one gate release, re-confirm the final shapes here, *then* v4call
builds the tab.

---

## Gate reply — IMPLEMENTED (ipfs-gate `feature/uploads-tab`, 2026-06-03)

Owner decided: **(1)** add the real `get_accounts` posting-key check;
**(2)** quota = honest shared-disk label (no per-account cap); **(3)** public
uploads priced same as encrypted. Defaults taken: ISO-8601 timestamps; public
inline-render hardening ON. **All built + offline-tested on a branch. Not yet
committed/pushed, not yet deployed.** Files: `migrations/002_uploads_tab.sql`
(new), `quota.js`, `hive-verify.js`, `server.js`, `.env.example`.

### Final endpoint contracts (build v4call against these)

**`GET /uploads/by-user`** — query params `hive_account`, `ts` (unix
**seconds**), `pubkey`, `sig`.
Signed message (raw-sign with posting key, ts is IN the message, no suffix):
```
ipfs-gate:list-uploads:v1:<hive_account>:<ts>
```
Response:
```json
{
  "hive_account": "alice",
  "quota": {
    "quota_scope": "shared_disk",   // ← honest: NOT per-user. Label as shared.
    "used_bytes": 12345678,
    "limit_bytes": 5368709120,
    "available_bytes": 5356363442,
    "pending_count": 1
  },
  "uploads": [
    {
      "cid": "Qm...",
      "size_bytes": 204800,
      "mime": "audio/mpeg",          // null for encrypted uploads
      "mode": "encrypted",           // "encrypted" | "public"
      "kind": null,                  // reserved; gate doesn't persist kind yet
      "uploaded_at": "2026-06-03T21:00:00.000Z",   // ISO-8601 (not unix)
      "expires_at":  "2026-06-10T21:00:00.000Z",
      "pinned": true,                // status === 'active'
      "status": "active",            // active|expired|banned|takedown|refunded
      "public_url": null             // set when mode==="public"
    }
  ]
}
```
Returns up to 500 most-recent uploads (no paging param yet — shout if you need
offset/limit exposed).

**`POST /uploads/delete`** — JSON body `{ cid, hive_account, ts, pubkey, sig }`.
Signed message:
```
ipfs-gate:delete-pin:v1:<cid>:<hive_account>:<ts>
```
Response: `{ "ok": true, "cid": "...", "removed": 1, "fully_unpinned": true }`.
- Flips only the caller's active pin row(s) for that CID to
  `status='expired', status_reason='user_deleted'`; other accounts' pins for
  the same CID survive. Quota frees automatically.
- `fully_unpinned` = no active pin remained → gate kubo-unpinned + GC'd.
- `404 not_found` if the account has no active pin for that CID.

**Auth (both endpoints), all three must pass or `401 unauthorized`:**
1. `ts` within ±`SIGNED_REQUEST_MAX_SKEW_SEC` (default 300s) of gate clock.
2. `sig` validates over the message by `pubkey` (`verifyHiveSig`).
3. `pubkey` ∈ `account`'s **current posting `key_auths`** fetched live from
   Hive (`condenser_api.get_accounts`). Fails closed → `422` if Hive is
   unreachable. **This is the 🚩 fix — it's what stops impersonation.**

### Public upload flow (item 3) — final
- `POST /reserve` accepts optional `mode: "public"` (default `"encrypted"`);
  echoes `mode` back. Same payment/billing.
- `POST /upload` for a public reservation: send **plaintext bytes** + multipart
  field `mime` (required, validated `type/subtype`, ≤255 chars; lower-cased).
  `kind` accepted but not persisted. `upload_proof_sig` still required
  (signs over the uploaded bytes' sha256 — content-agnostic, unchanged).
  Invalid/missing `mime` on a public reservation → `400` (rejected before any
  Hive payment work).
- `GET /ipfs/:cid`: encrypted → `application/octet-stream` (unchanged);
  public → the stored `mime`, **except** `text/html`, `application/xhtml+xml`,
  `image/svg+xml` which are forced to `octet-stream` + `Content-Disposition:
  attachment` (anti stored-XSS on the gate origin). `X-Content-Type-Options:
  nosniff` on all gateway responses.

### Item 4 — re-confirmed against the new code
Takedown still wins: `GET /ipfs/:cid` checks `isCidBlocked(cid)` at the top
before any mode/mime/content-type logic, for public and encrypted alike. The
`Cache-Control` caveat from the first reply stands — if you enable public
uploads, run a low `GATEWAY_CACHE_MAX_AGE` (or ask me to set `no-store` for
`mode='public'`; ~2 lines).

### New env vars (defaults are sane; nothing required to set)
`RATE_LIMIT_USER_API_PER_MIN=60`, `SIGNED_REQUEST_MAX_SKEW_SEC=300`. Added to
`.env.example`. Migration runner is now version-aware (`NNN_*.sql`, applied
once); 002 verified on fresh-install, v0.1→v0.2 upgrade, and reboot-idempotency.

### Not exercised offline (needs the live VPS for end-to-end)
A real posting-key signature → membership pass, a real Kubo pin of public
bytes, and the served public Content-Type. Those are the Phase-1 integration
test on `ipfs.completenoobs.com`. Everything up to the network boundary is
tested green.

**v4call can now build the tab against the contracts above.** Ping the gate
thread if any shape needs adjusting before you wire it.

---

## v4call client built — verify on deploy (v4call thread, 2026-06-03)

Phase 1 (list + quota tab) and Phase 2 (delete/unpin) are coded on the v4call
side (`public/index.html`, client-only, desktop). Built **exactly** against the
"Gate reply — IMPLEMENTED" contracts above. Two things to confirm when the gate
branch is deployed to `ipfs.completenoobs.com`:

1. **CORS / preflight.** v4call calls these cross-origin (v4call on
   hive-book.com / call.completenoobs.com → gate on ipfs.completenoobs.com):
   - `GET /uploads/by-user?hive_account&ts&pubkey&sig` (simple request).
   - `POST /uploads/delete` with `Content-Type: application/json` — this
     **triggers a CORS preflight (OPTIONS)**. The gate must answer the
     preflight + send `Access-Control-Allow-Origin` (and allow the
     `Content-Type` header) for the v4call origin(s). `/reserve` + `/upload`
     already work cross-origin so the middleware likely covers it — just
     confirm it also covers the JSON POST + the new paths.
2. **Exact request encoding v4call sends** (so there's no shape drift):
   - List: query string, `ts` = unix **seconds**, `pubkey` + `sig`
     `encodeURIComponent`-escaped. Signed message:
     `ipfs-gate:list-uploads:v1:<account>:<ts>` (raw posting-key sign, no
     suffix).
   - Delete: JSON body `{ cid, hive_account, ts, pubkey, sig }`, `ts` = unix
     seconds. Signed message: `ipfs-gate:delete-pin:v1:<cid>:<account>:<ts>`.
   - v4call caches the list signature for 240s to avoid a Keychain prompt on
     every tab-open/Refresh; delete always fresh-signs. Both stay inside your
     ±300s freshness window.

v4call renders quota as **"Your uploads: X across N files"** (its own active-pin
footprint, summed client-side) **primary**, with **"Gate storage: A of B used
(shared across all users)"** as secondary context — matching the
`quota_scope: "shared_disk"` honesty you flagged.

**Still TODO on the v4call side (next session):** Phase 3 — the public/plaintext
upload mode in the Attach modal (the `mode:"public"` `/reserve` + plaintext
`/upload` + `mime` field flow). That's the only part that exercises your new
public-upload path end-to-end. The list/delete endpoints can be smoke-tested
independently as soon as the branch is live.

---

## Gate confirm — CORS + shapes verified, ready to deploy (gate thread, 2026-06-03)

Both your verify-on-deploy points checked:

1. **CORS preflight — confirmed by test, no gate change needed.** The existing
   app-wide `cors({ origin: '*' })` middleware answers the preflight before
   route matching. `OPTIONS /uploads/delete` (Origin `https://hive-book.com`,
   `Access-Control-Request-Headers: content-type`) returned `204` with
   `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: …,POST,…`,
   `Access-Control-Allow-Headers: content-type`. `GET /uploads/by-user` returns
   `Access-Control-Allow-Origin: *` on the actual response too. Both new paths +
   the JSON POST are covered.
2. **No shape drift.** Your encodings match the gate exactly: list = query
   string, `ts` unix-seconds (string), message
   `ipfs-gate:list-uploads:v1:<account>:<ts>`; delete = JSON body, message
   `ipfs-gate:delete-pin:v1:<cid>:<account>:<ts>`. Gate lowercases `<account>`
   when rebuilding the message — fine since Hive names are already lowercase.
   The 240s list-sig cache sits comfortably inside the ±300s freshness window.

**Status:** committed + pushed (`7a64f20` on `origin/feature/uploads-tab`).
Migration 002 auto-runs at container boot (`boot()` → `runMigrations()`), so
deploy is just: **back up the DB → checkout branch on the VPS → `docker compose
down && up -d --build`.** New env vars have safe defaults; nothing required in
`.env`. Once live, `curl https://ipfs.completenoobs.com/` should show
`version: 0.2.0-dev` + `features.uploads_tab`, and the container log should
print `applied migration 002_uploads_tab.sql` (once). Then list/delete is
smoke-testable standalone; Phase 3 (public mode) is the only remaining
end-to-end gap.
