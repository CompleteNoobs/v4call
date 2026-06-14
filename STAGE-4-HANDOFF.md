# Stage 4–6 Handoff — Private Encrypted Hosting (v4call client side)

> **Quest:** bring ipfs-gate + v4call up to the *Private Encrypted Hosting v1* working model.
> **Gate side (Stages 1a–3) is DONE** in the `IPFS-Gate` repo — claim/MB-hour pricing,
> backstop escrow + FIFO baton-pass, extend, moderation×escrow, replication dial,
> release authority. 36 isolated tests green; committed. This doc hands off the
> **v4call client side (Stages 4–6)** so a fresh thread can start without re-deriving
> the gate contracts.
>
> Written 2026-06-14. Source of truth for the gate: `IPFS-Gate/roadmap_status.md`,
> `IPFS-Gate/PRICING-V1-DESIGN-NOTES.md`, `IPFS-Gate/ipfs-gate-cohosting-backstop.md`.
> **All new client work goes in `public/app.html`** (the active frontend — NOT index.html).

---

## 0. What Stage 4–6 builds (the product)

A standalone **"encrypt a file to specific people, pay to host it for a chosen time,
they Reveal it"** flow — distinct from the existing room/DM attachments. Privacy is
**encryption, not hosting**: anyone can fetch the ciphertext from the gateway, only the
wrapped Hive keys decrypt. Recipients can prove receipt and (by policy) trigger early
stop-hosting + refund.

| Stage | Where | Scope |
|---|---|---|
| **4 — Encrypted upload, send side** | v4call | Pick file + recipients + duration + copies + release policy → random-key AES-GCM encrypt → wrap key to each recipient's Hive key → **embed a commitment salt** (for Stage 6) → push through the gate's claim flow → return a shareable link. |
| **5 — "Reveal" tab** | v4call | Paste a link → fetch ciphertext → unwrap with your posting key → decrypt → view/save. **Tab name is LOCKED: "Reveal".** |
| **6 — Proof-of-receipt** | both | After decrypt, hash+sign the plaintext; a NEW gate endpoint verifies it against the stored commitment, records a per-recipient receipt, and **lights that recipient's release right** (feeds the Stage-3 `all_of` threshold). |

**Build order:** 4 → 5 → 6, test each before the next (the gate stages already follow this).
Stage 6 needs a small **gate-side** addition too (see §5).

---

## 1. ⚠️ Cutover breakage to fix FIRST (or fold into Stage 4)

The gate's `/reserve` was **cut over to computed MB-hour quotes** — the flat fee is gone.
The two existing client upload paths still call `/reserve` with only `{uploader, size_bytes}`:

- `sendAttachment()` — [app.html:5889](public/app.html#L5889) (encrypted room/DM attachments)
- `uploadPublicFile()` — [app.html:5586](public/app.html#L5586) (public share)

Both read `reserve.payment.amount` and pay whatever the gate returns. Because they send
**no `hours_requested`**, the gate quotes the **default duration (`DEFAULT_HOURS`, ~168h)**
× size × rate — wildly different from the old "1 token flat". So today's deployed
attachment flow either overpays massively or fails. **Decide up front:**

- **Option A (recommended):** teach both call sites the new quote shape — send
  `hours_requested` + `copies`, surface the computed cost in the modal before the
  Keychain pop (read `quote.total` / `quote.currency`). Small, unblocks existing features.
- **Option B:** fold attachments into the new Stage-4 claim-aware uploader and retire the
  old path.

Either way, the new Stage-4 uploader must send `hours_requested`/`copies` — so do Option A
as the first commit, then build Stage 4 on the same pattern.

---

## 2. Gate API contracts (everything Stage 4–6 calls)

Base URL = the user's chosen gate (the storage-backend picker; `getStorageBackend()`
[app.html:4695](public/app.html#L4695)). All money is in the gate's `PAYMENT_CURRENCY`
(test deployments use the **TEST** token).

### `GET /` — capabilities + pricing
```jsonc
{ "version":"1.0.0-dev",
  "payment": { "model":"claim-mb-hour", "currency":"TEST", "max_size_mb":10, "default_hours":168 },
  "pricing": { "rate_per_mb_hour":1, "min_hours":1, "mb_divisor":1000000,
               "node_count":1, "copies_max":1, "replication_leeway":2 },
  "features": { "claim_model":true, "public_uploads":true, "uploads_tab":true } }
```

### `POST /reserve` — get a quote + memo (two-phase, replay-safe)
Body: `{ uploader, size_bytes, hours_requested?, copies?, mode? }`  (`mode`: `encrypted`(default)|`public`)
```jsonc
{ "reservation_id":"…", "mode":"encrypted",
  "payment": { "currency":"TEST", "amount":"15", "escrow_account":"…", "memo":"ipfs-gate:upload:<reservation_id>" },
  "quote": { "billable_mb":5, "billable_hrs":3, "copies":1, "copies_requested":1, "copies_capped":false,
             "node_count":1, "replication":{…}, "rate_per_mb_hour":1, "total":15, "currency":"TEST" } }
```
Pay `payment.amount` of `payment.currency` to `payment.escrow_account` with `payment.memo`
(Keychain `requestCustomJson` for tokens / `requestTransfer` for HIVE/HBD), then:

### `POST /upload` — multipart; verifies payment + pins; creates the claim
Fields: `reservation_id, tx_id, uploader_pubkey, upload_proof_sig, ciphertext(file)`, plus
`mime`(public only), **`release_policy`** (JSON string, NEW for Stage 4).
- `upload_proof_sig` signs `ipfs-gate:upload-proof:v1:<sha256hex>:<reservation_id>:<uploader>`
  — already built by `buildUploadProofMessage()` [app.html:4497](public/app.html#L4497).
- `release_policy` = `{"type":"owner_only"|"any_of"|"all_of","addresses":["alice","bob"]}`.
```jsonc
{ "cid":"…", "expires_at":"…", "gateway_url":"…/ipfs/<cid>",
  "claim_id":"clm_…", "order_id":"ord_…",
  "claim": { "paid_hours":3, "copies":1, "size_mb":5, "rate_per_mb_hour":1, "amount_paid":15, "currency":"TEST" } }
```
Keep the returned `order_id` — it's what `/claims/release` and the share link need.

### `GET /ipfs/:cid` — fetch the (cipher)bytes (Stage 5 Reveal)

### `POST /claims/release` — signed; recipient/owner consents to stop hosting (Stage 5/6)
Body: `{ order_id, hive_account, ts, pubkey, sig }`; signed message
`ipfs-gate:release:v1:<order_id>:<hive_account>:<ts>`.
- `owner_only` → only owner; `any_of` → owner or any listed recipient → ends immediately;
  `all_of` → records each consent, ends only when the full set has consented; **owner can
  always release** (override). Ending = pro-rata refund to owner + reconcile (a queued
  backstop still takes over — release ≠ deletion).
- Response when waiting: `{released:false, needed:N, got:M}`; when ended:
  `{released:true, ended:true, refund:{…}, activated_backstop:…}`.

### Signed-request auth pattern (reuse the uploads-tab code)
`/claims/release`, `/claims/cancel`, `/uploads/by-user`, `/uploads/delete` are
**signed user requests**: send `hive_account, ts(unix s), pubkey, sig` where `sig` is a
posting-key `signRaw` over the per-endpoint message. The gate proves `pubkey` is the
account's live posting key on Hive. The uploads tab already does this exact dance
(`signRaw` [app.html:4626](public/app.html#L4626), cached 240s) — copy it. Messages:
| Endpoint | Signed message |
|---|---|
| release | `ipfs-gate:release:v1:<order_id>:<account>:<ts>` |
| cancel  | `ipfs-gate:cancel-claim:v1:<claim_id>:<account>:<ts>` |
| list    | `ipfs-gate:list-uploads:v1:<account>:<ts>` |
| delete  | `ipfs-gate:delete-pin:v1:<cid>:<account>:<ts>` |

### Other claim endpoints (already built, mostly v0.2+ / optional for Stage 4)
- `POST /claims/cancel` (signed) — owner cancels early → pro-rata refund.
- `GET /backstop/quote` → pay (memo `ipfs-gate:backstop:<cid>`) → `POST /backstop/pledge {pledger,cid,hours_requested?,copies?,tx_id}`; `GET /backstop/queue?cid=`.
- `GET /claims/extend/quote` → pay (memo `ipfs-gate:extend:<claim_id>`) → `POST /claims/extend {claim_id,extra_hours,tx_id}`.
- `POST /uploads/delete` now does **cancel-with-refund** (not just unpin).

---

## 3. Stage 4 — reuse map (the crypto already exists in app.html)

The existing `sendAttachment()` [app.html:5816](public/app.html#L5816) is the template —
it already does encrypt → wrap → reserve → pay → upload. Stage 4 is a **new uploader**
(its own modal + a shareable-link result, not a room broadcast) reusing these verbatim:

| Need | Existing helper | Line |
|---|---|---|
| Random-key AES-GCM encrypt / decrypt | `aesGcmEncrypt` / `aesGcmDecrypt` | [4437](public/app.html#L4437) / [4444](public/app.html#L4444) |
| Inner blob `[nonce][AES-GCM([len][header][bytes])]` build/parse | `buildInnerBlob` / `parseInnerBlob` | [4485](public/app.html#L4485) / [4449](public/app.html#L4449) |
| Per-recipient key-wrap to Hive keys | `hivecrypt.encode` / `hivecrypt.decode` | [4390](public/app.html#L4390) / [4396](public/app.html#L4396) |
| Recipient pubkey lookup (by username, on-chain) | `fetchPubKey` | [2090](public/app.html#L2090) |
| ciphertext SHA-256 hex | `sha256HexBytes` | [4433](public/app.html#L4433) |
| upload-proof message | `buildUploadProofMessage` | [4497](public/app.html#L4497) |
| envelope sig input / sign / verify | `buildEnvelopeSigInput` / `signRaw` / `verifyEnvelopeSig` | [4615](public/app.html#L4615) / [4626](public/app.html#L4626) / [4471](public/app.html#L4471) |
| gate URL + Pinata backend | `getStorageBackend` / `pinataPin` | [4695](public/app.html#L4695) / [4736](public/app.html#L4736) |

**New in Stage 4 (not in the attachment flow):**
1. Send `hours_requested` + `copies` to `/reserve`; show `quote.total`/`currency` before paying.
2. Pass `release_policy` (recipient list → `addresses`; user picks `owner_only`/`any_of`/`all_of`) to `/upload`.
3. **Commitment salt in the envelope** — generate a random salt, store `commitment = H(plaintext || salt)`
   (or per the Stage-6 design you settle on) inside the signed envelope, so Stage 6's
   proof-of-receipt can verify a recipient actually decrypted. Decide the exact commitment
   scheme when you build Stage 6's gate endpoint — but **emit the field at Stage 4** or
   you'll have to re-upload to add it.
4. Produce a **shareable link/artifact**: the CID + the per-recipient wrapped keys + the
   signed envelope (the existing attachment envelope is room-scoped; Stage 4's is
   recipient-list-scoped — design a new envelope shape, model it on `buildEnvelopeSigInput`).

---

## 4. Stage 5 — the "Reveal" tab

A lobby tab named **"Reveal"** (name locked): paste the Stage-4 link → fetch ciphertext via
`GET /ipfs/:cid` → find your wrapped key → `hivecrypt.decode` to get the AES key →
`parseInnerBlob` + `aesGcmDecrypt` → render (reuse the attachment renderers in
`addAttachmentBubble`) with Save/Open. A non-listed account has no wrapped key → can't
decrypt (test this). Verify the envelope sig (`verifyEnvelopeSig`) before trusting the bytes.

---

## 5. Stage 6 — proof-of-receipt (needs a NEW gate endpoint too)

**Client:** after a successful Reveal, hash the decrypted plaintext, sign
`hash || salt` with the posting key, POST it to the gate.
**Gate (new, build in `IPFS-Gate`):** a `POST /claims/receipt`-style endpoint that verifies
the proof against the stored commitment, writes a per-recipient receipt, then **calls the
existing `quota.recordReleaseConsent(order_id, releaser)`** — so a verified receipt feeds
straight into the Stage-3 release threshold (`all_of` ends only after every recipient's
receipt). The Stage-3 release machinery (`evaluateRelease`, `endActiveClaimForRelease`,
`release_consents` table) is already there — Stage 6 is the bridge that turns "I decrypted
it" into a release consent. A forged/unsigned proof must be rejected.

---

## 6. Test plan (each stage)

- **Stage 4:** upload a file to 3 recipients → ciphertext on IPFS, 3 wrapped keys, commitment
  stored, link returned; the claim lands with the right `release_policy`.
- **Stage 5:** each of the 3 recipients decrypts via the Reveal tab; a 4th non-listed account
  cannot; tampered ciphertext fails the sig check.
- **Stage 6:** a verified receipt records exactly that recipient's consent; an `all_of` order
  ends (refunds owner, a backstop still survives) only after all receipts; a forged proof is
  rejected.
- **Live (needs the VPS + funded escrow key):** the payment + refund **broadcasts** are only
  testable on the VPS — see `IPFS-Gate`'s handoff notes. Unit tests stub Hive/Kubo; the
  client-side crypto + UI can be tested in a browser against a live gate.

---

## 7. Gotchas

- **`public/app.html` only** — never index.html (legacy). Don't split app.html.
- **Desktop-only** focus right now (per CLAUDE.md) — surface Stage 4–6 desktop-first; mobile deferred.
- **Keychain can't expose private keys** → `hivecrypt.encode/decode` need the unlocked posting
  key in memory (the existing "unlock encryption" panel). Reveal requires the user to have unlocked.
- **iOS** has no `window.hive_keychain` — paid actions/signing fall through there (known, not a bug).
- **Currency:** the gate advertises one `PAYMENT_CURRENCY`; show it from `GET /` / the reserve
  quote (don't hardcode CNOOBS — the old code's fallback at [app.html:5906](public/app.html#L5906) is legacy).
- **No federation of these uploads** in v1 (CID is portable across gateways, but the
  claim/escrow lives on one gate). Cross-gate is v2.
```
