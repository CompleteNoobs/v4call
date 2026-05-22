# v4call ↔ Nostr Federation — Build Plan & Steps

> **Read order:** v4call `CLAUDE.md` → v4call `FEDERATION-BUILD-SPEC.md` → this file →
> nGate `NOSTR-DESIGN.md` + `NOSTR-DESIGN-NOTES.md` (the design rationale; lives in the
> nGate repo at `/home/noob/CAI/nGate/`).
>
> **Purpose:** A self-contained pickup point for the v4call-side Nostr federation work.
> Any thread / AI / person should be able to read this and know exactly what is done,
> what is not, the locked decisions, and the next concrete step. Design lives in nGate;
> **execution lives here.**
>
> **Status:** Planning. No v4call-side code written yet. Created 2026-05-18.

---

## 1. The one-paragraph situation

v4call has working WebSocket federation (presence, paid DMs, calls, payments) but it
has reliability problems — "users sometimes don't show across servers." The fix is to
move *discovery and presence* onto a Nostr pub/sub substrate while keeping Hive as the
trust root and keeping all real-time/paid/signaling concerns on the existing server
infrastructure. **The relay-side gate (nGate) is already built and live in production.**
The remaining work is entirely the v4call `server.js` side: a server-only Nostr client
that publishes its own announce and subscribes to others.

---

## 2. Two repos, two jobs — do not conflate

| | nGate (`/home/noob/CAI/nGate/`) | v4call (`/home/noob/CAI/v4call/`) |
|---|---|---|
| Role | The bouncer at the relay door | The guest who publishes & listens |
| Decides | Which server npubs may **write** to a relay | Which relays to read; what to publish |
| Driven by | Hive `v4call-server` posts → strfry whitelist | Each server's own Hive `NOSTR-RELAYS` field |
| State | **DONE — Stage 4 strfry live on both relays** | **NOT BUILT — this plan** |

**Critical separation (intentional, from nGate NOSTR-DESIGN-NOTES "separation of
concerns"):** nGate does NOT advertise relay URLs to v4call. v4call servers learn
relays from each peer's own Hive announce post. Do not wire nGate → v4call directly;
it destroys the composability that was deliberately designed in. Each side evolves
independently.

---

## 3. What is already done (do not rebuild)

- **nGate Stage 4 (2026-05-18):** strfry policy-plugin relays live and reproducible on
  `nostr.v4call.com` AND `nostr.hive-book.com`. Whitelist updates are a live
  `whitelist.json` rewrite — no relay restart. nGate holds no private keys.
- **nGate scan/verify/gate pipeline:** reads Hive `v4call-server` posts, verifies Hive
  sig + Nostr attestation + tag cross-checks, applies HP/token gate, rewrites whitelist.
- **Operator tooling already emits Nostr fields:** `server-sign.html` and
  `server-announce.html` have the NOSTR card (npub + hex + relay slots) and embed a
  kind-30078 attestation. `server-announce.html` adds `NOSTR_PUBKEY:` / Nostr trailer
  to the Hive post body. Option B canonical payload (Hive sig covers 9-or-12 fields,
  NOT attestation.id) — backward-compatible with v4call's existing federation verify.
- **server.js already parses a per-user `NOSTR:` field** in V2 rate posts. **This is a
  DIFFERENT namespace** (the v0.18.5 per-user reachability feature) — see §7.

**Implication:** the original 8-phase plan's Phases 1–3 (learn Nostr / spike / run a
relay) are effectively spent by the nGate work. v4call enters at ~Phase 4. There are
live relays to test against on day one.

---

## 4. Locked design decisions (this plan)

Carries forward nGate `NOSTR-DESIGN.md` "Design Decisions Locked In" plus decisions
made 2026-05-18:

1. **Architecture B before C, non-negotiable.**
   - **B** = Nostr augments/replaces the 2-hour Hive discovery scan. Low blast radius,
     additive, validates the whole key→relay→whitelist→subscribe pipeline. Ship this.
   - **C** = presence federation ("user foo went offline @hive-book.com"). The actual
     fix for "users don't show." Higher risk. Separate version, AFTER B is stable in
     production. Do not bundle.
   - Honest note: B alone is *partly cosmetic* (server discovery is rare). B's real job
     is to de-risk C and add a parallel-failure-mode channel + reduced Hive RPC load.

2. **Per-server Nostr keypair, file-first, in the mounted data dir.**
   - Path: `data/nostr-key.json`, chmod 600. `data/` is already fully `.gitignore`d.
   - **Survives `docker compose down && build --no-cache` automatically** because
     `./data/` is a host bind-mount (same persistence guarantee as the SQLite ledger
     DB). Zero operator action on rebuild. Only lost if the host `data/` dir is deleted.
   - **Bring-your-own key supported (file-first detection):** on boot, if
     `data/nostr-key.json` exists → use it (server-generated OR operator-supplied before
     first boot). If absent → auto-generate.
   - **Optional one-time `.env` seed:** `NOSTR_NSEC` (an existing nsec). Read **once** to
     write `data/nostr-key.json`, then the file wins forever. Operator should remove the
     env var after first boot. Convenience path for BYO without hand-crafting JSON. The
     key never lives only in `.env` long-term (keeps it out of the escrow-key blast
     radius — escrow key stays the only long-lived secret in `.env`).
   - **Key never goes browser-side, never logged.**

3. **Hive↔npub cross-reference is the trust backstop, re-checked in server.js.**
   - Every Nostr event is intrinsically schnorr-signed; nGate's relay only admits
     whitelisted npubs. But **public fallback relays do NOT run nGate policy.** So
     `server.js` MUST independently re-verify the Hive announce ↔ npub binding before
     trusting any discovered peer. No fourth signing layer needed — verify the three
     anchors that already exist (Nostr sig + relay whitelist + Hive cross-ref).

4. **Key rotation flow (resolves nGate open question #3):** generate new key → update
   `NOSTR_PUBKEY:` in the Hive announce post (via `server-announce.html`) → republish.
   The old key naturally ages out of the relay whitelist on nGate's next scan. No
   signed-transition-note protocol at current scale (3 informally-trusted operators).
   Revisit if the federation grows to many untrusted operators.

5. **Discovery feeds the EXISTING approval flow, never auto-connect.** Nostr-discovered
   peers become candidates in the existing `discoveredPeers` → `admin-peers.html`
   manual-approval path, same as Hive-scan candidates. The Hive 2h scan stays as a
   fallback — it is NOT deleted. Fail-open to the old path.

6. **Server-side only.** New module is required by `server.js` (e.g. `lib/nostr-fed.js`).
   `public/index.html` is untouched (consistent with v4call's "don't split index.html"
   and "browsers stay dumb" rules). No browser ever connects to a relay.

7. **kind 30078 (NIP-78 parameterized replaceable), `d` tag = domain.** Re-announces
   replace, don't pile up. `t=v4call-server` for discovery. (`t=v4call-presence`,
   `d=domain:users` is Architecture C / Phase D — not B.)

8. **No federation protocol bump.** Nostr is entirely outside the existing federation
   WS protocol. v0.4 stays valid. Existing `FEDERATION_PEERS` keeps working. Purely
   additive.

---

## 5. Phased build path (v4call repo)

Each phase ships something working and is independently rollback-able. Stop and
measure in production at the Phase C checkpoint before touching Phase D.

### Phase A — Spike (throwaway, ~1 day)
- `scripts/nostr-spike.js` (~100 lines, `nostr-tools`).
- Generate a key, publish kind-30078 `t=v4call-server` to the **live**
  `nostr.v4call.com`, run a second instance subscribing for the same tag, see it
  round-trip.
- **Why first:** proves server-key → nGate-whitelist → publish/subscribe works
  end-to-end against real infra before any `server.js` change. The relays already exist.
- **Exit:** spike works from two machines / two keys. Throwaway after.

### Phase B — server.js publishes (Architecture B, half 1)
- New `lib/nostr-fed.js`, required by `server.js`. Behind `NOSTR_ENABLED` (default off
  until proven, then default on).
- Key bootstrap per §4.2 (file-first; auto-gen; optional one-time `NOSTR_NSEC` seed).
- On first boot with no npub in own Hive announce: print a loud, non-blocking warning
  ("Add NOSTR_PUBKEY:npub… to your Hive announce post"). Graceful degradation — server
  runs normally on Hive-only discovery meanwhile.
- Publish own kind-30078 announce on boot + every `NOSTR_REPUBLISH_HOURS` (default 6).
- **Exit:** the server's announce is observable from an external Nostr client.

### Phase C — server.js subscribes + feeds discovery (Architecture B, half 2) — **SHIPPABLE MILESTONE**
- Subscribe to configured relays with a `t=v4call-server` filter.
- For each event: re-verify Hive↔npub binding server-side (§4.3), then drop the peer
  into the existing `discoveredPeers` structure → surfaces in `admin-peers.html` for
  manual approval. Hive 2h scan stays as fallback.
- Multi-relay publish + dedupe-on-read by event id (standard Nostr pattern).
- **Exit / checkpoint:** new peers appear in the admin approval queue within seconds
  (vs up to 2h). Run in production. Measure reliability + RPC-load delta BEFORE Phase D.
- **This is the v0.19-class ship.** Stop here until it's boringly stable.

### Phase D — Presence federation (Architecture C) — separate version, separate scope
- Only after Phase C is stable in production with measured improvement.
- Throttled `kind 30078`, `d=domain:users`, `t=v4call-presence` events: server batches
  join/leave changes (≤1 publish / 30s) + heartbeat republish (~60s).
- Each server subscribes to peers' presence, maintains a local cross-fed user
  directory, renders it in the lobby with click-through to the peer server (Q1 decision:
  click-through via existing Hive auth — no new contact-request protocol).
- **This is the real "users don't show" fix.** Document its own sub-plan when Phase C
  is done; do not pre-design it in detail here (scope discipline).

---

## 6. Proposed `.env` / `.env.example` additions

```bash
# ── Nostr Federation Discovery (optional, additive) ───────────
# Comma-separated relay WS URLs. Include >=1 v4call-operated relay
# AND >=2 public relays for redundancy.
NOSTR_RELAYS=wss://nostr.v4call.com,wss://nostr.hive-book.com,wss://relay.damus.io,wss://nos.lol

# Re-publish own announce every N hours (guards against relay drops).
NOSTR_REPUBLISH_HOURS=6

# Master switch. false = server runs Hive-only discovery, unchanged.
NOSTR_ENABLED=true

# OPTIONAL one-time bring-your-own-key seed. An existing nsec.
# Read ONCE on first boot to create data/nostr-key.json, then ignored.
# Remove this line after first successful boot. Leave blank to auto-generate.
NOSTR_NSEC=
```

`data/nostr-key.json` needs no `.gitignore` entry — `data/` is already fully ignored.

---

## 7. Two `NOSTR` namespaces — do not cross them

| | Per-user `NOSTR:` (rate post V2) | Server `NOSTR_PUBKEY:` (server-announce) |
|---|---|---|
| Scope | One v4call user's reachability | One v4call server's federation identity |
| Set via | `rate-editor.html` | `server-sign.html` / `server-announce.html` |
| Feature | v0.18.5 per-user (display-only buttons) | THIS plan (federation discovery) |
| Parsed where | already in `server.js` `parseRatesV2` | new `lib/nostr-fed.js` |

Same word, totally different trust scope and lifecycle. The v0.18.5 per-user Nostr
plan and this federation plan are independent — keep them out of each other.

---

## 8. Known gotchas (collected from nGate's road)

- **npub vs hex is a silent-failure class.** strfry whitelist needs hex, not bech32.
  Be deliberate about encoding at every boundary when publishing. `nostr-tools`
  handles both but won't stop a wrong-format-wrong-field mistake.
- **Public fallback relays don't enforce nGate policy** — hence the mandatory
  server-side Hive↔npub re-check (§4.3). Never trust a presence/announce event purely
  because it arrived from a relay.
- **Relay reliability is mediocre.** Publish to multiple, subscribe from multiple,
  dedupe by event id. Don't go all-in on self-operated relays — keep 2–3 public ones
  in the default list as backup.
- **`nostr-tools` v2 is ESM-only in Node.** nGate uses a `.mjs` helper for this. Match
  that pattern or configure module type accordingly.
- **Don't delete the Hive scan.** It is the fallback and the trust root. Nostr is the
  speed layer on top, not a replacement.
- **Bind-mount persistence is the rebuild-survival mechanism** — only works if the key
  file is under the mounted `./data/` path, not an ephemeral container path. Same trap
  class as the historical SQLite UID/mount issues.

---

## 9. Scope boundaries — what this is explicitly NOT

- Not browser-side. Browsers talk only to their home server, unchanged.
- Not Nostr DMs / chat content. Direct messaging stays on the WS federation.
- Not a payment channel. Payments stay Hive-native.
- Not token-gating in v4call — that is nGate's job (already built). Stake/burn/
  subscribe gating (Variant 2/3) is a separate future, not Architecture B.
- Not a federation protocol bump. v0.4 WS protocol stays valid.
- Not a Nostr social presence. No notes, no follows, no feeds.
- Not for end-users to think about. Operators configure relays; users just see "the
  federation feels more reliable."

---

## 10. Open questions still to resolve (carried from nGate design docs)

1. Final recommended public relay default list (kind-30078 reliability + retention).
2. Relay storage policy per kind (server announces: keep; presence: short expiry) —
   relevant at Phase D, set in strfry config (nGate side).
3. Nostr-only peer with no Hive announce — Phase C decision: reject / quarantine with
   "unverified" badge. Lean: quarantine + operator-visible flag, never auto-approve.
4. Presence throttle interval — start 30s, tune from Phase D operational data.

Resolved by this plan: key storage (§4.2), BYO key (§4.2), key rotation (§4.4),
discovery-into-existing-approval (§4.5), no protocol bump (§4.8).

---

## 11. Status log

- **2026-05-22** — **🟢 NOSTR FEDERATION ARC — COMPLETE.** Phases A
  (throwaway spike) → B (publish own announce) → C (subscribe + Hive-anchored
  discovery, the shippable v0.19-class milestone) → D (cross-server presence,
  WS-wins-Nostr-additive) all in production on three federated servers
  (hive-book.com, v4call.com, call.completenoobs.com). Cross-server users
  appear in lobbies near-realtime instead of taking up to 2 hours via the
  Hive scan window — the original "users sometimes don't show across
  servers" pain solved.
  Plus three latent-bug closes surfaced by Phase D testing — each generalised
  into a meta-rule for future work:
  (1) **Canonical mismatch** (v0.16.13) — signer + verifier must stay
  byte-for-byte in lockstep when an optional trailer can grow the signed
  shape.
  (2) **Paid-invite bypass class** (v0.16.14) — every paid flow that
  crosses the federation MUST re-validate on the recipient side; never
  trust the source's enforcement. Third instance of the recipient-enforces
  rule #15 class (after lobby-encrypted DM and paid DM).
  (3) **Visibility = approval** (v0.16.15) — Phase D's additive visibility
  was independent of approvedPeers, opening a small spam/social-eng surface
  for any Hive-account-owning party. Fixed; persisted approvals now also
  load on every boot regardless of FEDERATION_PEERS in .env. Approval is
  the single switch.
  All four phases + the three fixes have proper sections in
  `noob-docs/nostr-fed-walkthrough.wiki` with real production log output
  and Common Problems entries. The wiki ends with a "Words explained"
  glossary that grew with the work.
  **Next:** the IPFS file-attachments arc (v0.19+ per CLAUDE.md "Planned
  Features"). Builds on top of the proven federation foundation; doesn't
  need to redo any of it. The federation, the paid-flow plumbing, the
  recipient-enforces rule, and the Hive-anchored Nostr binding are all
  available for the IPFS work to compose with.
- **2026-05-22** — **Phase D visibility/approval coherence FIXED (v0.16.15)
  + persisted-approvals always-load FIXED in the same patch.** Operator
  during Phase D production testing observed cross-server users appearing
  in lobbies of servers that hadn't approved each other and asked the
  security question. Threat model analysed: not a real federation bypass
  (WS transport still gated on `approvedPeers`, so no calls/DMs/payments
  to unapproved peers, no impersonation possible without forging Hive
  signatures), but a small spam / social-engineering surface — a bad actor
  with a real Hive account + Nostr key + domain + signed `v4call-server.json`
  could publish fake usernames into every v4call server's lobby. Capability
  was low-cost (~$3-5 in Hive RC) so worth closing rather than noting.
  **Fix part 1:** `nostrAdditivePresenceSnapshot()` skips any domain not
  in `approvedPeers`. The write side (`recordNostrPresence`) is unchanged
  so approving a previously-rejected peer surfaces their users on the
  next `broadcastLobby` without waiting for a heartbeat. Phase C's
  `discoveredPeers` population stays independent of approval — that's
  what `/admin-peers.html` reviews.
  **Fix part 2:** `loadApprovedPeers()` moved OUT of `if (FEDERATION_ENABLED)`
  so disk-persisted approvals load on every boot regardless of whether
  `.env` has seed peers. Matches the data/ bind-mount persistence pattern
  used everywhere else; closes the surprise where commenting out
  `FEDERATION_PEERS` silently dropped all prior approvals from in-memory
  state on next boot.
  **Meta-rule captured in wiki Common Problem #2d:** "approval is the
  operator's *I want to interact with this server* signal — every channel
  that surfaces in front of users (lobby presence, callable handles,
  badge rendering) must gate on it. Discovery stays independent because
  that's what discovery is for." Forward-applicable to anything new that
  bridges discovery → user-facing presence.
- **2026-05-22** — **Federated paid-invite BYPASS-CLASS bug FIXED (v0.16.14).**
  Phase D production testing surfaced a long-latent bypass: the federated
  `room-invite` recipient handler only re-validated when the source claimed
  a payment. If the source sent `payload: {}` (its own `getInviteOptions`
  returned free — stale cache, wrong parse, or malicious peer), the
  recipient blindly delivered the invite popup. This is the **third** time
  we've hit this bypass class (after lobby-encrypted DM in v0.16.5 and
  federated paid DM in v0.16.6) and the same violation of locked design
  rule #15 ("Recipients enforce their own rules").
  **Why Phase D surfaced it:** before Phase D, cross-server invites were a
  rare admin-typed allowlist edit. Phase D made cross-server presence
  ubiquitous — toggling a federated user and clicking Create Room became a
  one-click flow. The bypass had always been there; it just wasn't a daily
  workflow.
  **Fix:** recipient `room-invite` handler now ALWAYS re-fetches
  `getInviteOptions(target, from_user)`, regardless of source claim. Three
  recipient-side responses: `blocked`, `fee_rejected`, `fee_required`. On
  `fee_required` the recipient includes the rate options in the response;
  the source's `room-response` handler routes them into the existing
  `invite-payment-required` picker so the admin pays and re-invites
  (self-healing UX). Source-side `allowlist-add` restructured so
  payment-provided wins over source's `isPaid` (handles the fee_required
  cycle when source rates are cached-stale).
  **No federation protocol bump.** Reuses existing `room-response` envelope
  with the existing `reason:'paid_rejected'` and a new `detail:'fee_required'`
  string + optional `required` field carrying the rate options. Pre-fix
  peers (v0.4 wire-compat) keep working — they just don't get the
  picker-pop UX, fall back to a clear info message.
  **Meta-lesson captured in wiki Common Problem #2c:** "do not trust the
  source's enforcement, ever — every paid flow that crosses the federation
  must re-validate on the recipient side." Forward-applicable to v0.17
  Paid Expert Invites, v0.18+ file attachments, and anything else paid
  that crosses servers.
- **2026-05-22** — **Phase D shipped & proven on 3 production servers** —
  WS-wins-Nostr-additive presence. Cross-server lobby visibility
  near-realtime. No `index.html` change needed (cleaner architecture than
  the design doc proposed: extended `lobbySnapshot()` so existing
  federated-user render handles Nostr-additive users identically).
  Feature-gated by `FED_PRESENCE_VIA_NOSTR` (default false; flipped to
  true on all 3 servers for testing). Federation-discovery + presence
  pipelines now run side-by-side cleanly. THIS is the v0.19-class
  shippable milestone the build plan pointed at. Phase A spike removed
  (`scripts/` deleted) per the doc convention.
- **2026-05-22** — **Canonical-mismatch latent bug FIXED (server.js
  `_verifyPayloadString`).** `public/server-sign.html`'s `buildPayload` was
  updated to nGate "Option B" 2026-05-13 (conditional 12-field canonical
  appending `nostr_npub|nostr_hex|relays_csv` when any Nostr field is set).
  `server.js`'s verifier was never updated to match — it stayed at the
  9-field shape. The bug was latent because none of the deployed verify
  files had Nostr fields populated until call.completenoobs.com became the
  first. From then on, every other v4call server rejected its file with
  "signature does not match posting key" — misleading message; the
  signature was valid, the canonicals differed.
  **Fix:** mirrored `buildPayload` in `_verifyPayloadString` byte-for-byte
  (conditional Nostr trailer). Cross-checked against the LIVE files of all
  3 servers + their Hive posting keys: Option B verifies completenoobs ✓,
  9-field rejects (the bug); both canonicals verify hive-book + v4call
  (backward compatible — no Nostr fields → no trailer). **No re-sign
  needed on any server.**
  **Bonus for Phase D:** when the 12-field canonical verifies, `nostr_hex`
  is Hive-signature-anchored. `verifyPeer` now exposes
  `verified_nostr_hex` / `verified_nostr_npub` on success; threaded into
  `discoveredPeers` from both `scanV4CallDirectory` and
  `discoverPeerViaNostr`. **Option (a) (Hive-anchored npub↔domain
  binding) is now free for Phase D** — presence events can be checked as
  `event.pubkey === peer.verified_nostr_hex` directly, without depending
  on the Phase C "poke" indirection. Phase D design doc updated to use
  this binding. Lesson captured in
  `noob-docs/nostr-fed-walkthrough.wiki` Phase B Common Problems #2b: when
  a signed canonical can conditionally grow, signer and verifier MUST
  stay byte-for-byte in lockstep — cross-reference each other with
  comments, and (ideally) a shared helper.
- **2026-05-21** — **Phase C DONE & proven on all 3 production servers**
  (hive-book.com, v4call.com, call.completenoobs.com — the latter joined as a
  brand-new third server during this verification, an ideal test). Subscribe
  + dedupe + own-pubkey/own-domain skip + newest-per-domain logic in
  `nostr-fed.mjs` (`startSubscribe`); new `discoverPeerViaNostr()` in
  `server.js` reuses the existing Hive-anchored `verifyPeer()` (Option C —
  trust nothing in the event payload, only the domain as a "poke"); new knobs
  `NOSTR_HIVE_FALLBACK` (default true) + `NOSTR_SUBSCRIBE_ENABLED` + computed
  `HIVE_SCAN_ENABLED`; 2h Hive scan gated accordingly so pure
  `nostr` + `NOSTR_HIVE_FALLBACK=false` test mode works. **Hive-scan
  precedence rule** keeps Nostr from degrading richer Hive-discovered entries
  (Nostr just refreshes `last_seen`). Belt-and-braces 30-min subscription
  re-open — cheap, gentle, traffic to public relays is <5 events/hour per
  server. New-peer discovery latency: **seconds** (vs up to 2h). Federation
  remained green throughout; no regressions to DMs/calls/payments;
  `verifyPeer` canonical untouched; `index.html` untouched; no new federation
  envelopes; no protocol bump. Phase C wiki section written with real
  production log output. **Phase C is the v0.19-class shippable milestone.**
  Measure-in-prod checkpoint informally passed (3-server federation works as
  designed; UNREACHABLE blips on public relays handled gracefully by multi-
  relay redundancy as planned).
- **2026-05-19** — **Phase B DONE & proven on production servers.** `nostr-fed.mjs`
  (ESM, isolated), ~20 lines in `server.js` (config consts + non-blocking dynamic
  `import()` after the unchanged federation block), `nostr-tools` added to
  `package.json`, `./data/nostr:/app/nostr` mount, `.env.example` block,
  `FED_DISCOVERY_MODE=both` knob. Key bootstrap (file → NOSTR_NSEC seed →
  generate) verified incl. crash-proof backstop. Live result on hive-book.com:
  identity persisted, all 4 relays (2 gated + 2 public) ACCEPTED (nGate
  whitelisting via Hive announce works end-to-end). Phase B wiki section written
  with real log output.
  **Two traps captured (do not repeat):**
  (1) **Dockerfile COPY trap** — the Dockerfile copies files individually
  (`COPY server.js`, `COPY public/`); a new top-level server file is NOT
  auto-included. Every new top-level server file needs its own `COPY` line in
  the Dockerfile, or it's missing inside the container (`Cannot find module`).
  (2) **Account-mismatch after `git reset --hard`** — federation verifies that
  `.env` `SERVER_HIVE_ACCOUNT`, the deployed `/.well-known/v4call-server.json`
  signer, and the Hive announce `HIVE-ACCOUNT` all name the SAME Hive account.
  Restoring a `bk.v4call-server.json` signed by a different-but-valid account
  (`hive-book` vs `hive-book.com` — both real Hive accounts) makes federation
  flap forever with "account mismatch". Not Nostr-related; a rebuild merely
  surfaced latent config drift. Fix = align all three, no rebuild needed
  (`.env` + static file only). Lesson: after a break "caused by a build",
  check what the reset/build *restored*, not only what code changed.
- **2026-05-19** — **Phase A DONE.** `scripts/nostr-spike.mjs` (self-contained, own
  deps, nothing in server.js/index.html touched). Round-trip proven on a public relay.
  nGate confirmed blocking non-whitelisted keys on BOTH `nostr.v4call.com` and
  `nostr.hive-book.com` ("blocked: not on relay whitelist"). Three gotchas captured in
  `noob-docs/nostr-fed-walkthrough.wiki`: (1) Node-18 Web Crypto polyfill;
  (2) nostr-tools 2.23 takes a single filter object, not an array; (3) `pool.publish`
  RESOLVES (not rejects) on an unreachable relay with a "connection failure" string —
  so the spike now reports three states ACCEPTED / REJECTED / UNREACHABLE, a
  distinction Phase C must reuse (peer-down ≠ peer-rejected). Spike is disposable now
  the wiki exists.
- **2026-05-18** — Plan created. nGate confirmed at Stage 4 (strfry live, both relays).
  Locked: Architecture B first; per-server key file-first in `data/nostr-key.json`
  (survives no-cache rebuild via bind-mount); BYO key via file-drop or one-time
  `NOSTR_NSEC` seed; Hive↔npub re-checked server-side; key rotation = update Hive
  announce + age out; discovery feeds existing approval flow; server-side only; no
  protocol bump. Phases A→D defined; Phase C is the shippable milestone with a
  measure-in-production checkpoint before Phase D.
