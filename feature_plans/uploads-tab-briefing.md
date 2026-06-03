# Briefing: User uploads-management tab in v4call

> Hand-off date: 2026-06-03.
> Audience: a fresh Claude Code session, started in `~/CAI/v4call`.
> User: noob (project owner, tinkerer, prefers 2–3 sentence advice +
> tradeoff before any build). Says "just talk no build" when they want
> design-only mode.
> Companion threads: a separate Claude session in `~/CAI/IPFS-Gate` owns
> the gate side; coordinate via files in `~/CAI/v4call/feature_plans/`
> and tell the user when to prompt the gate thread.

---

## What just shipped (last session)

The multi-format file attachment arc completed across v0.16.16 → v0.16.24.
Quick reference for what works today:

- v4call attachments accept 15 MIMEs across image / audio / video / pdf /
  text / archive families. See `ATTACH_ALLOWED_MIMES` in
  `public/index.html` (~line 3826).
- Renderer pipeline in `addAttachmentBubble` branches on `env.kind_hint`:
  `image` → `<img>`, `audio` → `<audio>`, `video` → `<video>`, `pdf` →
  `<iframe>`, `text` → `<pre>` (UTF-8, 64 KB inline cap), `file` →
  generic download card with size + filename.
- Gate-side cap is dynamic from `payment.max_size_mb` in the gate's `/`
  response. v4call learns the cap when the user opens the Attach modal.
- `detectFileMime(file)` handles the messy edge cases (`.tar.gz`, `.md`,
  `.7z` etc. where browsers don't reliably set `file.type`).
- All federated. Room attachments work cross-server thanks to
  `FEDERATED_ROOM_EVENTS` whitelist fix earlier in the session
  (v0.16.19).
- ipfs-gate side is content-agnostic — never sees plaintext, never
  enforces MIME. Pure pay-to-pin CDN. See
  `~/CAI/IPFS-Gate/MP3-SUPPORT-OPTIONS.md` for the gate-side analysis
  done by the companion thread.
- Briefing for the multi-format work (cross-repo design notes + the
  three gate-side gotchas discovered during shipping) lives at
  `feature_plans/mp3-room-attachment-briefing.md`. Read it for
  context on how the v4call + ipfs-gate coordination has been working.

You do NOT need to touch any of that. It's stable.

---

## The new quest — user uploads-management tab

Goal: give each v4call user a dedicated tab where they can see and
manage every file they've uploaded through the ipfs-gate, including:

1. **List view** — every upload the user has made, with metadata
   (filename, size, MIME/kind, when uploaded, expires when, where it
   was sent or whether it's public).
2. **Two upload modes**:
   - **Encrypted (existing flow)** — sender encrypts client-side,
     uploads ciphertext, addresses to specific recipients' Hive
     pubkeys. This is the only mode today.
   - **Public / unencrypted (NEW)** — sender uploads plaintext bytes
     to the gate, gets a shareable URL
     (`https://ipfs.completenoobs.com/ipfs/CID`) that anyone can fetch
     without v4call. For sharing with friends outside the v4call
     network. Decided by the user: **plaintext on the gate, anyone
     with the link can fetch**. No URL-fragment-keyed encryption.
     Sender's responsibility for what they upload; gate operator's
     responsibility for compliance/takedown.
3. **Delete / unpin** — user clicks remove on an upload, gate unpins
   the CID, the user's quota / disk allowance frees up.

User explicitly framed this as "potentially long". Probably 3–5
sessions of work. Plan accordingly.

---

## Open design questions for the user — discuss before building

These have non-obvious trade-offs and the user should pick the path,
not have it picked for them. Use the AskUserQuestion tool for each.

### Q1. Source of truth for the upload list — gate or v4call?

- **Gate-side authoritative**. Gate already tracks every upload
  (uploader, CID, size, MIME, ttl) in its SQLite. Add a new endpoint
  `/uploads/by-user/:hive_account` (or signed-request based) that
  returns the list. v4call just fetches and renders. Pro: no double
  bookkeeping, always accurate about what's actually pinned. Con:
  every list-refresh is a gate HTTP call.
- **v4call-side index**. v4call maintains its own `user_uploads` table
  with metadata mirroring what was sent. Pro: fast, no gate roundtrip,
  v4call can show context ("this was sent to #room-x"). Con: can drift
  from what's actually pinned (TTL expiry, manual gate-operator
  unpins, gate restarts).
- **Hybrid**. v4call keeps the local context table; the list view
  hits the gate to confirm which CIDs are still pinned + merges. Pro:
  best of both. Con: more code.

**Recommendation to user**: gate-side authoritative for v0.2. Adds one
gate endpoint, no v4call schema change. v4call only needs a list-render
view. Local context (which room/DM sent it) can be added in a v0.3
iteration if needed.

### Q2. Where does the tab live?

Lobby today has four tabs (`💬 DMs / 📢 Local Lobby / 🚪 Active Rooms /
✉️ Included Rooms`). Options:
- Fifth lobby tab `📦 Uploads`.
- Top-level button outside the lobby tabs (header area).
- Inside the existing user-profile / settings panel.

**Recommendation**: fifth lobby tab. Lobby tabs are the natural home
for user-scoped views.

### Q3. Mobile UI — ❌ OUT OF SCOPE (author decision 2026-06-03)

**RESOLVED: mobile is deferred entirely. Desktop browser UI is the sole
focus for all current feature work.** The author explicitly put mobile
on hold on 2026-06-03 and asked that this be recorded across docs (done:
see the 🖥️ focus callout near the top of `CLAUDE.md`). Build the uploads
tab for desktop only — surface it via the `#lobby-tabs` strip. Do NOT
add a fifth bottom-nav button, do NOT chase `@media (max-width:720px)`
parity, do NOT build touch affordances for this feature. Mobile UI gets
revisited as its own pass after the desktop feature set settles.

### Q4. Privacy of the upload list itself

The user wants to manage their own uploads — does the list need to be
private to them?
- **Per-user, signed-request fetch**. Gate verifies a Hive sig on the
  list request, returns only that user's uploads. Standard.
- **Public list** (probably wrong, but flag it). Anyone could query
  another user's uploads.

**Recommendation**: per-user signed-request fetch. Mirrors the existing
upload-proof signature pattern.

### Q5. Quota display

Gate already enforces per-user reservation cap + disk quota. v4call
should show "X of Y MB used" so user knows when delete is needed.
- Surface on the uploads tab header.
- Surface in the existing Attach modal too (helpful before upload).

**Recommendation**: both.

### Q6. Public-upload abuse handling

Plaintext public uploads change the risk surface for the gate operator.
What happens when someone uploads something the operator doesn't want
to host?
- Operator already has `/admin/*` endpoints (verify by reading gate
  CLAUDE.md + server.js). Probably has unpin-by-CID admin action
  today.
- Should public uploads surface differently in admin tooling so
  operator can review?
- Should there be a "report" affordance on public links?

**Recommendation**: out of scope for v0.2 of this feature. Operator
moderation is a v0.3+ concern. Document it as deferred.

---

## What changes on the v4call side (rough sketch — not a plan)

1. **New lobby tab `📦 Uploads`** in the lobby tabs strip
   (`#lobby-tabs`). Mirrors the existing tab pattern.
2. **List render** — table or card layout: filename / size / kind icon
   (reuse the icon table from `addAttachmentBubble`) / uploaded date /
   expires / context (room name, DM target, or "public") / delete
   button.
3. **Upload button** at top of tab — opens a variant of the existing
   Attach modal with a new "Recipients" mode: a radio toggle
   `Encrypted (pick users) | Public (anyone with link)`.
4. **Public-mode upload flow** — skip encryption, skip recipient
   picker, upload bytes directly. The new upload-mode also affects:
   what's signed in the envelope, what the gate stores, what URL is
   returned, what's displayed on the bubble for the sender's record.
5. **Public link copy affordance** — after a successful public
   upload, show the gateway URL with a copy-to-clipboard button.
6. **Delete confirmation** — modal asking "are you sure? unpinning
   means recipients won't be able to fetch anymore (encrypted) /
   anyone with the link gets 404 (public)".
7. **Fetch list on tab open** — single gate call, render.

## What changes on the ipfs-gate side (for the companion thread)

These need a separate briefing for the ipfs-gate Claude. Drop it as
`~/CAI/v4call/feature_plans/uploads-tab-gate-briefing.md` when ready.
The gate-side gist:

1. **New plaintext-upload path** — `POST /upload` currently expects
   ciphertext bytes + the upload-proof signature flow. Either add a
   parallel `POST /upload-public` or a flag on `/reserve` that says
   "this will be a plaintext upload, set Content-Type appropriately
   on GET". Probably the latter — same payment + reservation flow,
   just a different storage mode.
2. **Per-MIME Content-Type on GET for public uploads** — encrypted
   uploads stay `application/octet-stream` (correct). Public uploads
   need the real MIME on GET so browsers display images / play audio
   / view PDFs directly from the link. Gate has to store the claimed
   MIME alongside the CID at upload time. (This is the gate-side
   `mime` + `kind` claim that the original briefing already discussed
   — it just becomes load-bearing now.)
3. **`/uploads/by-user/:hive_account` endpoint** — list endpoint that
   takes a Hive-signed request, returns the uploader's pinned CIDs
   with metadata.
4. **Delete-by-uploader endpoint** — Hive-signed request: "I am @foo,
   unpin CID X". Gate verifies sig matches the original uploader of
   X, then unpins + decrements quota.
5. **Per-user quota query** — possibly already exists; if so, expose
   it on a user-friendly endpoint (not just `/admin/*`).

Coordinate with the gate Claude thread: this v4call briefing locks
the design choices (encryption-to-users vs public-plaintext, list
authority is gate-side, signed-request auth). The gate thread does
the gate-side implementation.

---

## Rules of engagement (carry forward from prior sessions)

- **Claude (lead dev)** owns code in this repo. Can edit anything in
  `~/CAI/v4call`. Reviews diffs from companion threads before applying.
- **Grok (research backup)** writes to `~/CAI/v4call/grok/` only.
  Produces research notes + `.diff` suggestions. **Grok has broken
  code in the past** when allowed to edit directly — never let it
  edit outside `grok/`.
- **Companion ipfs-gate Claude** owns the gate repo. Briefing files
  in `feature_plans/` are the bridge. User prompts each thread
  manually.
- **User is a tinkerer, not a dev**. Prefers 2–3 sentence advice +
  tradeoff before any build. Says "just talk no build" when they
  want design-only mode.
- **Explicit "deliberate non-scope"** lists at the end of each
  shipped chunk are valued. Always include them.

## Where things sit on disk

- `public/index.html` — entire v4call frontend. Attach flow lives
  around lines 3700–4700 area. `mimeToKind`, `detectFileMime`,
  `ATTACH_ALLOWED_MIMES`, `TEXT_INLINE_PREVIEW_BYTES` all already
  exist and should be reused.
- `server.js` — v4call backend. Existing socket events around
  attachments: `dm-attachment`, `room-attachment`,
  `dm-attachments-history`, `room-attachments-history`,
  `attachment-notification`.
- `data/logs/v4call-chat.db` — already has `room_attachments` table.
  Probably a `dm_attachments` equivalent. Look there before designing
  any new persistence.
- `CLAUDE.md` — project memory. Read the most recent v0.16.16 entry
  for full context on the attachment flow.
- `FED-RECOVERY-NOTES.md` — federation institutional memory. Lessons
  1–11 worth scanning if you'll touch federation paths.
- `feature_plans/mp3-room-attachment-briefing.md` — the multi-format
  cross-repo briefing. Section "Gate-side gotchas discovered during
  shipping" has three gotchas that will affect this work too.
- `grok/grok-briefing.md` — Grok's hand-off briefing. Has the
  rules-of-engagement table.

---

## Suggested first session for fresh Claude

1. Read this briefing top to bottom.
2. Read the most recent CLAUDE.md entry (v0.16.16 section is the
   attachment context; v0.16.24-ish is multi-format).
3. Open a "just talk" conversation with the user — ask Q1–Q6 above
   one or two at a time (don't dump all six). Lock in design choices.
4. Once design is locked, produce the gate-side briefing file for the
   companion thread (`feature_plans/uploads-tab-gate-briefing.md`).
   Tell the user to prompt the gate thread with it.
5. Wait for gate-side report before any v4call code lands — the v4call
   side depends on the gate endpoints being defined.

Do NOT start coding the v4call side until the design + gate-side
endpoints are locked. The user has been burned by parallel design
churn before; sequential is safer.

---

## Session 1 outcome — design LOCKED (2026-06-03)

Talked through Q1–Q6 with the author. Decisions:

- **Q1 — List authority: gate-authoritative + v4call enriches.** The
  gate's new list endpoint is the source of truth for what exists +
  what's still pinned + quota (must be queried for delete to be honest
  anyway). v4call decorates each row with context it ALREADY holds in
  `room_attachments` / `dm_attachments` (which room / DM it went to).
  Public uploads carry no context ("public" is the context).
  **No new v4call table.**
- **Q2 — Placement: fifth lobby tab `📦 Uploads`** via the existing
  `switchLobbyTab` pattern in the `#lobby-tabs` strip.
- **Q3 — Mobile: OUT OF SCOPE.** Desktop browser UI only. Recorded in
  `CLAUDE.md` (🖥️ focus callout) + this file. Revisit later.
- **Q4 — List/delete auth: posting-key signed request.** Same key +
  `signRaw` pattern as the existing upload-proof flow. Gate verifies the
  sig matches the Hive account, returns only that account's uploads.
  Active key is NOT used (overkill for a read).
- **Q5 — Quota display: both** the uploads-tab header AND the Attach
  modal (the modal one is higher value — shows remaining space before
  the user picks a file + pays).
- **Q6 — Public-upload abuse: defer user-facing moderation UX
  (report buttons + admin review queue = v0.3+), BUT require an admin
  unpin-by-CID kill switch as a release gate.** Once a public link is
  out, the operator needs a takedown path. Gate briefing must CONFIRM
  this exists (likely already does from orphan-payment cleanup work)
  before public uploads ship.

**Next step:** write `feature_plans/uploads-tab-gate-briefing.md` for
the companion ipfs-gate Claude thread, then the author prompts that
thread. No v4call code lands until the gate endpoints are defined.

---

*End of briefing. Multi-format arc complete. Next quest awaits.*
