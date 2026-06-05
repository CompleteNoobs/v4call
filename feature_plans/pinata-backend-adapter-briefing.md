# Briefing: Pinata as a user-selectable storage backend for v4call
# (bring-your-own-Pinata-account adapter, alongside ipfs-gate)

> Intended audience: a fresh Claude Code thread, started in the **v4call
> repo** (`~/CAI/v4call`). This is a v4call *client-side* feature —
> ipfs-gate is NOT involved (Pinata replaces it for users who choose it).
> Author: Claude (v4call dev thread, 2026-06-04).
> User: noob (project owner, tinkerer; prefers 2–3 sentence advice +
> tradeoff before any build; "just talk no build" unless he says build).
>
> **Status: design captured, NOT started. This is a FUTURE quest —
> AFTER the ipfs-gate v0.3 pricing rollout. Do not interleave with
> pricing. The briefing exists so the idea is preserved and ready.**

---

## The one-paragraph goal

v4call already lets a user pick which **ipfs-gate** instance hosts their
encrypted attachments (e.g. `ipfs.completenoobs.com`). This feature
generalises that picker so a user can instead choose **Pinata** and use
**their own Pinata account** (their own API key, their own subscription)
as the storage backend. foo (no Pinata) keeps using ipfs-gate; bar (has
Pinata) uses Pinata. Same v4call, same encryption, same sharing — only
the "where do the bytes get parked" step differs per user.

---

## The mental model (read this first — it makes the scope obvious)

A "storage backend" does two jobs: **pin** (upload/store) and **gateway**
(fetch). They're decoupled.

1. **Encryption is client-side, in the browser, before upload.** So every
   backend is just a **dumb byte-store** — it never sees plaintext, never
   needs to understand the content. THIS is what makes backends swappable.
2. **Identity is ALWAYS Hive.** Even a Pinata user logs into v4call with
   Hive, signs the attachment **envelope** with their Hive posting key,
   and recipients verify the sender via Hive — unchanged. **Pinata is
   only the storage credential, NOT a v4call login.** (ipfs-gate doesn't
   need a separate storage credential because it reuses the Hive key +
   on-chain payment; Pinata needs one because it's an external account.)
3. **Fetch is already universal.** A CID is a CID. A Pinata-pinned CID
   resolves from any IPFS gateway, so recipients fetching a `gateway_hint`
   URL already work regardless of who pinned it. **Cross-service sharing
   is free:** bar-on-Pinata shares to foo-on-ipfs-gate, foo just fetches
   the CID. The services never talk to each other.

**Consequence:** the only NEW code is the *upload step* + the *credential
handling*. Everything else (encryption, envelope, Hive signing, socket
delivery, history replay, recipient render) is REUSED unchanged.

---

## Current state (what exists today, v0.16.16+)

The shipped attachment flow speaks **ipfs-gate's protocol specifically**:
`POST /reserve` → Keychain Hive token payment with a memo →
`POST /upload` (multipart: ciphertext + reservation_id + tx_id +
uploader_pubkey + upload_proof_sig) → gate verifies the on-chain payment,
pins to Kubo, returns the CID + gateway_url. Then v4call signs the
envelope (`cid|size|sender|created|expires|room|kind|recipients`) and
emits the `room-attachment` / `dm-attachment` socket event.

The service selector is currently an **ipfs-gate URL picker** (persisted
in `localStorage`), assuming the ipfs-gate protocol.

Multi-format already works (MP3/MP4/PDF/tar/text + public unencrypted
upload-and-share) as of the uncommitted multi-format build.

---

## The feature spec (what noob sketched)

1. **Rename / generalise the selector.** The "IPFS-GATE" field becomes
   "**IPFS SERVICE**" (or add a service-*type* dropdown). Two types:
   - `ipfs-gate` — URL + Hive-payment flow (existing).
   - `pinata` — API-key field (new).
2. **Pinata setup (user does this once, outside v4call):** create a
   Pinata account → API Keys → generate a key with **only
   `pinFileToIPFS` enabled** (the "legacy endpoints" custom-permissions
   screen; NOT admin) → copy the JWT.
3. **In v4call:** user picks `pinata`, pastes the JWT. Stored client-side
   (see "Key storage" below — ride v4call's existing posting-key
   encryption pattern).
4. **On send:** encrypt in the browser (if encryption is selected; public
   uploads skip it) → `POST` ciphertext to Pinata `pinFileToIPFS` with
   `Authorization: Bearer <JWT>` → get the CID back → write a Pinata (or
   any public) gateway URL as the `gateway_hint` → run the EXISTING
   envelope-sign + socket-emit flow. Share link appears in the room.
5. **Recipients:** unchanged — fetch the CID from `gateway_hint`,
   AES-GCM decrypt, render. (A Pinata CID is publicly resolvable since
   Pinata announces to the DHT, unlike ipfs-gate's `DHT=none`.)

---

## Pinata API specifics (verify against current Pinata docs)

- **Pin endpoint:** `POST https://api.pinata.cloud/pinning/pinFileToIPFS`
- **Auth header:** `Authorization: Bearer <JWT>`
- **Body:** `multipart/form-data` with a `file` field (the ciphertext
  blob). Optional `pinataMetadata` / `pinataOptions` JSON fields.
- **Response:** `{ IpfsHash: "Qm…/bafy…", PinSize, Timestamp }` —
  `IpfsHash` is the CID.
- **Public gateway:** `https://gateway.pinata.cloud/ipfs/<CID>` (rate-
  limited; dedicated gateway is a paid feature). Any public gateway
  (ipfs.io, cloudflare-ipfs.com) also resolves it → use one as the
  `gateway_hint`, or let the user set their dedicated gateway.
- **Validate-on-paste (nice UX):**
  `GET https://api.pinata.cloud/data/testAuthentication` with the Bearer
  header returns a success message if the key is valid → show
  "✓ Pinata connected". **Verify** a `pinFileToIPFS`-only scoped key is
  permitted to call `testAuthentication`; if not, skip pre-validation or
  validate by attempting a tiny test pin.

---

## ⚠ THE FEASIBILITY GATE — do this FIRST, before any build

**Can a browser call Pinata's pin endpoint directly (CORS)?** Pinata's
pinning API is historically server-side-oriented. If its CORS policy
allows browser-origin requests with a JWT → this is a ~20–40 line adapter
(everything else is reused). If it BLOCKS browser-direct calls → you'd
need a proxy (a server relay), which is more work AND reintroduces a
middleman, breaking the "no server in the middle / user's own account"
property.

**The spike (≈30 min, not a build):** from a browser console on an HTTPS
page, `fetch()` a tiny file to `pinFileToIPFS` with a real scoped Bearer
JWT and observe: success vs CORS preflight (OPTIONS) failure / missing
`Access-Control-Allow-Origin`. Report the result. **This single test
decides whether the feature is a half-day adapter or a proxy project.**
Do NOT design the rest until this is known.

---

## Key storage security (noob asked — here's the correct posture)

The Pinata JWT is a **bearer token** (≈ a scoped, revocable password),
NOT a signing key — you transmit the secret itself on every request.

- **You cannot meaningfully encrypt it in RAM against other OS
  processes** from inside a browser — the decryption key would live in
  the same RAM, so anything that can read the memory reads the key too.
  That threat is an OS boundary, not a web-app one.
- **Other *websites* already can't read it** — browser origin isolation
  is free and is the real "other apps can't see it" guarantee.
- **The useful encryption is AT REST on disk:** store the JWT as an
  encrypted blob behind the user's session passphrase, decrypt into
  memory only for the upload. **v4call ALREADY has this exact mechanism**
  — the 🔑 encryption-unlock panel that encrypts the Hive posting key for
  Keychain users. **Reuse it for the Pinata key.** Do not invent a new
  storage scheme.
- **The scoped key is its own mitigation:** `pinFileToIPFS`-only means a
  worst-case leak lets someone burn the user's Pinata quota — they can't
  read, delete, or touch billing. Combined with revocability (delete the
  key in Pinata's dashboard), the blast radius is small.
- The key is the user's own, **never sent to v4call's server** (client-
  side only, exactly like the manual-posting-key paste path).

---

## Economics — independent of the pricing work

Pinata-BYO **bypasses the entire v4call/ipfs-gate payment + pricing
system.** No Hive payment, no two-part tariff, no operator earnings — the
user pays Pinata directly via their subscription. This is a clean
"bring-your-own-cost / independence" lane, **orthogonal to the ipfs-gate
v0.3 pricing rollout** (which governs only the ipfs-gate path). Building
this later changes nothing about that pricing. They are separate lanes.

---

## Out of scope / deferred

- **Operator-side Pinata backend** (an ipfs-gate operator backing their
  gate with Pinata instead of Kubo) — different feature; not this.
- **Pinata presigned/temp-key flow** (needs a backend to mint creds) —
  only relevant if the CORS spike fails and you accept a proxy; decide
  then.
- **web3.storage / Filebase / other backends** — same adapter pattern,
  separate quests. This briefing is Pinata-only.
- **Unpin / file-management UI** on Pinata — v0.1 just pins + shares;
  expiry is whatever the user's Pinata plan does.

---

## The task for the new thread

1. **Run the CORS spike (above) FIRST.** Report success/failure. If it
   fails, stop and tell noob — the feature shape changes (proxy needed).
2. If CORS is OK: write a short plan — the selector generalisation, the
   `pinata` adapter upload function, where the JWT field + encrypted
   storage hook in (reusing the posting-key encryption pattern), the
   `gateway_hint` choice. **Just talk → get noob's approval → then build.**
3. Keep the diff contained: it's one adapter + one credential field +
   one selector tweak. The encryption/envelope/signing/socket/render are
   all REUSED — do not touch them.

---

## Don't be confused by

- **This is NOT a "Pinata login."** v4call identity is always Hive. The
  Pinata JWT is a storage credential layered on top, not an auth.
- **"Legacy endpoints" in Pinata's key screen** = the original/classic
  pinning REST API (`api.pinata.cloud/pinning/*`). Stable and exactly
  what you want — not deprecated-and-dying. Pick `pinFileToIPFS` only.
- **noob is a tinkerer, not a developer.** Explain trade-offs. Do the
  CORS spike + plan and get approval BEFORE building. Do not slap it
  together.
- **Sequencing:** this is a future quest, after the ipfs-gate pricing
  rollout. If noob brings this thread up mid-pricing, gently confirm he
  wants to switch tracks before diving in.
- **Encryption is content- and backend-agnostic** — a Pinata blob is the
  same ciphertext an ipfs-gate blob is. Don't re-architect crypto.

## End of briefing

When the CORS spike result + plan land, noob reviews and picks the path.
