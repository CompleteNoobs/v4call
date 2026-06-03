# Briefing: Multi-format file support across v4call + ipfs-gate
# (originally scoped MP3-only — expanded 2026-05-28 to cover the full
# file-type taxonomy upfront, ship in phases)

> Intended audience: a fresh Claude Code thread, started in
> `~/CAI/ipfs-gate` (NOT in the v4call repo).
> Author: Claude (v4call lead dev, 2026-05-28).
> User: noob (project owner, tinkerer, prefers 2–3 sentence advice +
> tradeoff before any build).
>
> The user will paste this whole file into a new Claude session pointed
> at the ipfs-gate repo. That session does the gate-side investigation
> and proposes changes. The v4call side is owned by a separate Claude
> session (which is me).

---

## The goal

**Design the full multi-format file-attachment surface upfront, ship
in phases.** First implementation phase is MP3 (`audio/mpeg`) alongside
JPEG. But the gate-side design decisions (allowlist shape, size limits
per category, `kind` claim at `/reserve`, operator config) should be
made once and cover ALL future types so subsequent phases are
small implementation cycles, not re-architecture.

The full file-type taxonomy v4call will eventually support:

| kind_hint | MIME examples | How the recipient renders |
|---|---|---|
| `image` | jpeg, png, gif, webp | `<img>` inline + Save + Open |
| `audio` | mp3, wav, ogg, m4a/aac | `<audio controls>` inline + Save |
| `video` | mp4, webm, ogg | `<video controls>` inline + Save |
| `pdf` | application/pdf | `<iframe src=blob:...>` inline + Save + Open |
| `text` | text/plain, text/markdown | `<pre>` decoded UTF-8 inline + Save |
| `file` | everything else (zip, tar.gz, docx, exe-blocked, …) | Generic download card, no preview |

**Three security calls embedded in this taxonomy worth flagging in
the report:**

- **SVG (image/svg+xml) is downgraded to `file`**, not `image`. SVG
  can contain `<script>` which executes when rendered inline. Block
  inline render, allow download only. Operator can opt-in to SVG
  inline render later with a DOMPurify pass.
- **Executable extensions** (`.exe`, `.dmg`, `.apk`, `.msi`, `.bat`,
  `.sh`, `.cmd`) should be blockable by operator policy at the gate
  level. The gate IS the right enforcement point here — every
  client uploads through the gate. Suggest `BLOCKED_EXTENSIONS` env
  var (operator-overridable).
- **Unknown MIME** → falls into `file` kind on the client side
  (download-only, no interpretation). No client tries to render
  bytes it doesn't recognize. New types added in future phases
  upgrade gracefully from `file` to a more specific kind.

This is the **first multi-format step** for v4call attachments.
Future quests add the other categories one at a time, each as a small
client-side renderer addition. But the gate-side change is ONCE.

## Cross-repo context (read first)

**v4call** is the only client of ipfs-gate today. The flow as
currently shipped (v0.16.16, JPEG only):

1. v4call user clicks 📎 Attach in a room (or DM panel).
2. v4call browser encrypts the file: fresh AES-GCM 256 key, per-recipient
   hivecrypt-wrap of the AES key, inner blob =
   `[12B nonce][AES-GCM([4B BE len][header JSON][file bytes])]`.
3. v4call calls `POST /reserve` on ipfs-gate → gets a reservation_id +
   the payment memo to use.
4. v4call user does a Keychain CNOOBS transfer to the gate's
   `PAYMENT_ACCOUNT` with the returned memo.
5. v4call calls `POST /upload` (multipart) with the ciphertext blob +
   reservation_id + tx_id + uploader_pubkey + upload_proof_sig.
6. ipfs-gate verifies the on-chain payment matches the reservation,
   pins the ciphertext to its Kubo node, returns the CID.
7. v4call signs the envelope (CID + size + sender + ... + kind_hint +
   recipients) with the sender's Hive posting key, emits the
   `room-attachment` (or `dm-attachment`) socket event.
8. Recipients fetch ciphertext from the gateway URL, AES-GCM decrypt,
   render inline.

The ipfs-gate **never sees plaintext** — only ciphertext bytes. It
also never sees the file's original MIME type (that lives inside the
encrypted header JSON). The current "JPEG only" check in the gate
must be at a layer that doesn't depend on the plaintext.

**Encryption envelope is content-agnostic.** The header JSON inside
the ciphertext carries the original filename + MIME. v4call's
`kind_hint` field (in the OUTER envelope, signed by the sender's
posting key) tells the recipient's client which renderer to use
(`'image'`, `'audio'`, eventually `'video'`/`'file'`).

## What v4call will do (already designed; not your task)

The v4call side ships in **phases**, one renderer at a time. The gate
side opens the door for all of them at once.

### Phase 1 — MP3 (ships first, alongside this gate change)

Six small changes, all in `public/index.html` (~30–50 lines):

1. File picker `accept="image/jpeg"` → `accept="image/jpeg,audio/mpeg"`.
2. `kind_hint` derivation table (replaces two hardcoded `'image'`
   literals) — small client-side function `mimeToKind(mime)` that
   maps MIME → kind_hint. Falls back to `'file'` for unknowns. Has
   the special-case `image/svg+xml → 'file'` security downgrade.
3. `addAttachmentBubble` branches on `env.kind_hint`: audio → render
   `<audio controls src="objectURL">`; image → existing `<img>` path;
   else → existing locked-card path (for now). Future phases each add
   one branch.
4. Double-check `file.type` against the gate's allowlist before
   encryption. If the gate exposes its allowlist via `/` endpoint
   (currently returns gate metadata including cost), v4call can
   read it dynamically. Otherwise hard-coded list per gate version.
5. Existing cost-line auto-fetches gate price per byte → MP3 cost
   surfaces automatically. No new size-warning UI for v0.2.
6. Zero changes to server.js, federation envelopes, encryption,
   signing, transport. All content-agnostic.

### Phase 2+ — audio family, video, pdf, text, file (each separate quest)

Each subsequent phase = 1 session, ~20–50 lines client-side, zero
gate-side change (assuming the gate change accommodated all of them
upfront per this briefing).

- **Phase 2: Audio family** — wav, ogg, m4a. Same `<audio>` renderer.
  Just allowlist extension + MIME table entries.
- **Phase 3: Image family** — png, gif, webp. Same `<img>` renderer.
  Just allowlist extension + MIME table entries.
- **Phase 4: Video** — mp4, webm. New `<video controls>` bubble
  branch. Small renderer addition.
- **Phase 5: PDF** — application/pdf. New `<iframe src="blob:...">`
  bubble. Cross-browser quirk: iOS Safari opens PDF in new tab
  instead of inline. Accept it.
- **Phase 6: Text** — text/plain, text/markdown. New `<pre>` bubble
  with UTF-8 decode + size cap (e.g. show first 1MB inline, full
  via download).
- **Phase 7: File** — zip, tar.gz, docx, etc. Generic download-only
  card. No preview attempt. The `file` kind has been the fallback
  all along; Phase 7 just makes it look intentional (better icon,
  filename, size, download button).

**v4call will NOT start Phase 1 until ipfs-gate supports audio/mpeg.**
The gate is the gating dependency.

## Your task (the ipfs-gate Claude session)

**This round is "just talk" — no code changes yet.** The user wants a
design conversation first, then will decide which option to apply.

Investigate the ipfs-gate codebase and produce a short structured
report covering:

### 1. Where is the JPEG-only check enforced today?

The current v0.1.3 gate rejects everything except `image/jpeg`. Find
the exact code path. Likely candidates:
- `POST /reserve` body validation (does it take a `kind` or `mime`
  parameter? what's the whitelist?)
- `POST /upload` multipart Content-Type field check
- Some other layer (size-only enforcement, magic-byte sniffing on the
  ciphertext, etc.)

**Report:** file + line numbers for the check, what input field it
gates on, what the rejection error looks like to the v4call caller
(so v4call's error UX can be predicted).

**Design target — the full v0.2 allowlist** (not just MP3):

```
image/jpeg
image/png
image/gif
image/webp
audio/mpeg
audio/wav
audio/ogg
audio/mp4
audio/x-m4a
video/mp4
video/webm
video/ogg
application/pdf
text/plain
text/markdown
application/zip
application/x-tar
application/gzip
application/x-7z-compressed
```

This is the "yes, ship all of these in v0.2" set. v4call will
introduce them progressively (phases 1–7), but the gate accepts them
all from v0.2 onwards. The two security calls:

- **Do NOT add `image/svg+xml`** to the gate allowlist. v4call's
  policy is to never inline-render SVG (XSS surface). If a sender
  encrypts an SVG with `kind: 'file'` (download-only), it should
  work as any other file — but the gate doesn't need to know that;
  the client-side kind is what matters.
- **Operator-overridable**: the allowlist should be an env var
  (e.g. `ALLOWED_MIMES`) so different operators can be more or
  less restrictive. Default ships with the set above.

### 2. How does the gate know it's getting "the right thing"?

The gate only sees CIPHERTEXT. It can't sniff plaintext bytes for
magic numbers (e.g. JPEG `FF D8 FF` or MP3 `FF FB`). So the MIME
check has to be one of:

- **Client-supplied claim, trusted** (insecure: any caller can lie
  about the MIME). What's the risk surface today, and does it
  change when we add audio?
- **Reservation-time declaration** (client declares MIME at reserve;
  server verifies it matches at upload). Slightly better — the
  declaration is tied to the paid reservation.
- **None** — gate just stores bytes and trusts v4call's client-side
  validation. Pure CDN/pinning role. Honest about what the gate
  does and doesn't enforce.

**Report:** which model is in place, security implications of
widening to audio/mpeg under that model, recommendation for v0.2.

### 3. Size limits — per category, not a single number

Different file types have different reasonable maxes. JPEGs in chat
are typically <2 MB. MP3s 5–10 MB. Videos can hit 100 MB+ easily.
PDFs vary wildly. Find:

- Current `MAX_UPLOAD_BYTES` (or equivalent) constant.
- Whether it's a hard reject or a configurable env var.
- Whether the per-byte payment rate scales linearly (probably yes —
  gate charges per byte stored × retention period).
- Whether v4call needs to surface a "this file exceeds the gate's
  max" error proactively, or if the rejection at `/upload` is clean
  enough for the existing v4call error UX (which shows the
  `reservation_id` and `tx_id` so the user can ask the operator
  about an orphan payment — see v4call CLAUDE.md v0.16.16 polish).

**Two design options to evaluate:**

- **Option A — single `MAX_UPLOAD_BYTES`** (simplest).
  Pick a number that's big enough for video (say 200 MB) and
  small types fit underneath. Easy to implement, less optimal
  storage cost prediction for operators.

- **Option B — per-category caps** (`MAX_BYTES_IMAGE`,
  `MAX_BYTES_AUDIO`, `MAX_BYTES_VIDEO`, `MAX_BYTES_PDF`,
  `MAX_BYTES_TEXT`, `MAX_BYTES_FILE`). Operator can lock down
  expensive categories (e.g. allow images and audio but cap video
  at 20 MB). More config surface but more honest.

**Recommendation:** Option B if not much extra work, A if it would
add real complexity. Whichever is chosen, expose the limits on the
gate's `/` endpoint so v4call can show "max X MB for this type" in
the file picker UI before the user even selects.

Sane starting defaults (operator-overridable):
- image: 10 MB
- audio: 50 MB
- video: 200 MB
- pdf: 50 MB
- text: 5 MB
- file: 100 MB

**Report:** current limit, which option (A or B) makes sense given
the gate's existing code shape, recommended defaults.

### 4. Pin retention

What's the current pin TTL? Same as v4call's envelope expiry
(typically 30 days for v0.1)? If pinning costs scale with bytes ×
days, MP3s will be ~3–5× more expensive per upload than JPEGs of
equivalent duration. Is the per-byte rate already correct for that,
or does the gate charge a flat per-upload fee that needs adjustment?

**Report:** current retention behaviour, payment math sanity-check
for a 5 MB MP3 vs a 1 MB JPEG at the same per-byte rate.

### 5. Response headers on GET

When v4call clients fetch ciphertext from the gate's `gateway_hint`
URL, what `Content-Type` does the gate return? Almost certainly
`application/octet-stream` (because the bytes ARE octet-stream —
the plaintext MIME is inside the encrypted blob). Confirm this is
true and doesn't need changing for audio support.

**Report:** observed Content-Type, whether anything needs to change.

### 6. Operator config

Is the JPEG-only check a hardcoded check, or a configurable allow-list
(e.g. `ALLOWED_MIMES=image/jpeg`)? Per v4call's design philosophy,
configurable is better than hardcoded — different operators may want
different policies (one gate might only allow images, another might
allow everything, etc.). If it's hardcoded, propose making it
configurable via env var in the same change.

**Report:** current shape, proposed shape for v0.2.

### 7. Magic-byte sniff is impossible — what about a "kind" claim?

Since the gate can't sniff plaintext, consider adding two parameters
to `POST /reserve` that the gate records alongside the reservation:

- `mime`: the claimed plaintext MIME (e.g. `audio/mpeg`).
- `kind`: the v4call kind_hint (e.g. `audio`).

The gate doesn't enforce either (no way to), but:

- They're logged for audit ("operator can see: 'this upload claimed
  to be audio/mpeg'").
- They're exposed on `GET /reservations/:id` (admin endpoint, if any)
  so operators have visibility into what's being pinned.
- v4call passes them based on its own client-side validation.
- The gate's allowlist check happens against the CLAIMED `mime` —
  if a client claims `application/exe` and that's not in the
  allowlist, the reservation is rejected. Doesn't stop a lying
  client, but provides defensible audit trail.

This is the **"honest about what we don't enforce"** middle path —
v4call is the only client today, but if a future client lies, the
gate's audit log shows what was claimed at upload time.

**Report:** is this worth doing now (recommend yes — it's the
operator-policy enforcement point), or YAGNI?

### 8. `BLOCKED_EXTENSIONS` operator policy

Even within the `application/zip` allowlist entry, an operator may
want to block specific extensions (e.g. `.exe`, `.dmg`, `.apk`,
`.msi`, `.bat`, `.sh`, `.cmd`). The gate could expose a separate
`BLOCKED_EXTENSIONS` env var that's checked against the claimed
filename at `/reserve` time.

This is parallel to the MIME allowlist — a different policy lever.
An operator might run a permissive MIME policy (allow everything)
but want to specifically block executable extensions.

**Report:** is this worth a separate env var, or just fold into the
existing MIME allowlist by being strict about MIME (e.g. don't
allow `application/octet-stream` which is the typical "anything"
MIME)?

## What to produce in the report

A single markdown file in `~/CAI/ipfs-gate/` (or wherever the project's
docs live) named `MULTIFORMAT-V0.2-OPTIONS.md`. Structure:

```
## Current state (what the gate does today for JPEG)
- [reference to specific files + line numbers for each of the 8 points]

## The minimum change to accept the full v0.2 allowlist
- [smallest diff to allow all 19 MIMEs from the design target in point 1]

## The well-designed v0.2 change (recommended)
- [config-driven allowlist (point 1) + size limits (point 3) +
   /reserve mime+kind claim (point 7) + operator policy levers (points
   6, 8). One change, covers all of phases 1–7.]

## Recommended path
- [one or two paragraphs: which option, why, what's deferred]

## Open questions for the user (noob — the project owner)
- [anything that needs operator policy decisions: default size caps,
   whether to ship BLOCKED_EXTENSIONS in v0.2 or defer, whether the
   gate's / endpoint should expose the allowlist/caps for v4call's
   file picker UI, etc.]
```

**Do NOT write code yet.** This is research + recommendation only.
Once the user reads the report and picks the option they want, a
follow-up Claude session implements the gate change. Then I
(v4call Claude) implement Phase 1 (MP3 client-side render). Phases
2–7 are subsequent sessions.

## v4call-side coordination

When the gate-side change ships:

1. **Phase 1 — MP3 only**: v4call makes the 6 small client-side changes
   for Phase 1 (see top of this briefing). Both repos versioned in
   sync (gate v0.2 + v4call v0.16.20 or whatever the next number is).
2. **Phase 2–7** (audio family, image family, video, pdf, text, file)
   each as separate small v4call quests in subsequent sessions. No
   gate-side change needed for any of them, because the v0.2 gate
   already accepts the full allowlist set.
3. Test plan for Phase 1: same flow as v0.16.16 testing (production
   servers call.completenoobs.com / hive-book.com / v4call.com against
   ipfs.completenoobs.com), but with MP3 instead of JPEG. Federated
   delivery should "just work" because the v0.16.19 fix
   (`FEDERATED_ROOM_EVENTS` whitelist) is content-agnostic.

If the gate adds `mime` + `kind` parameters at `/reserve` (point 7),
v4call passes them. That's another ~5 lines in `public/index.html`,
trivial.

The gate's `/` endpoint should expose the full allowlist + per-category
size caps so v4call can show them in the file picker UI ("max 50 MB
for audio"). This avoids the existing JPEG-only file picker becoming
stale every time the gate config changes.

## Don't be confused by

- **CNOOBS vs TEST token.** The v4call project uses the user's
  personal CNOOBS token in production. There's also a TEST token
  minted for dev (supply 333,333,333 on Hive-Engine, see v4call's
  memory `project_test_token_for_testing.md`). The gate's
  `PAYMENT_CURRENCY` env var picks which token it accepts. For
  MP3 testing, TEST is preferable so production CNOOBS isn't
  burned through.
- **The user being a tinkerer, not a developer.** Explain
  trade-offs clearly. Do NOT just slap a fix together. Ask
  before implementing.
- **Grok is a research backup mind, not a coder.** If you (the
  ipfs-gate Claude) want a second opinion on something, the user
  can prompt Grok separately — but Grok writes to `grok/` only
  and produces .diff suggestions for review. You're the only
  coder for the gate side.

## End of briefing

When the report lands in `MP3-SUPPORT-OPTIONS.md`, the user brings
it back to this (v4call) Claude session and we pick a path together.
