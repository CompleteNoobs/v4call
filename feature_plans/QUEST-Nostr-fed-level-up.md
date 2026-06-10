# QUEST: Ravenpost — a sealed courier-road between allied keeps for when the highroad is shut *(design-ready, build-gated, vibe-coding welcome)*

*A notice, pinned to the board by a hand you will not see.*

---

## The matter, in brief

Three allied keeps already know one another well. They see each other's folk by the light of the watch-fires — *presence* — and they know each other's true names by the heralds' standing cries — *discovery*. This much has held true and unbroken since the spring; no hand has disturbed it.

But there is a thing the keeps have **never** been able to do, though many assumed otherwise: when the great paved **highroad** between them is barred, **no parcel crosses**. Letters strand. Locked chests sit at the gate. The watch-fires made the folk *look* reachable — and so the keeps seemed alive — but seeing a man across the valley is not the same as a road to his door.

This quest lays the missing road. Build a flock of carrier-ravens that bears **sealed** parcels — plain letters and the locked chests of attachments alike — from keep to keep, so that nothing is stranded when the highroad sleeps.

---

## What to build

**The elegant trick — a false rider.** Do not rebuild the gate. The keep's gate-keeper, when it receives a parcel, only ever touches the *rider who brought it* for two small things: the rider's home-keep name (for the watch-ledger) and the means to send a reply home. So forge a **false rider** — a thing shaped like a highroad-rider but whose every "ride home" instead looses a raven. Hand that false rider to the *existing, unchanged* gate-keeper, and every rite it already knows — receive a letter, receive a locked chest, send back a failure — runs exactly as before. The recipient-side toll-check, the escrow re-verify, the refund on failure: all come **free**, because it is the same gate-keeper doing the same work. The reply simply flies home by raven.

**The seal.** Each parcel is sealed keep-key to keep-key with the direct cipher (NIP-44), *not* the anonymizing gift-wrap. For three known allies, hiding *which* keeps speak buys nothing — the heralds already cry it aloud — and the gift-wrap's time-jitter fights our store-and-forward ordering and our rot-by-expiry. The seal hides what truly matters: the names, the chest-label, the toll-memo *within* the parcel.

**The parcel itself.** A *stored* raven-mark (kind `1314`, "v4call fedmsg") — not a replaceable mark (a new one would overwrite the last) and not an ephemeral one (the ravens would not hold a backlog). It carries tags naming the recipient, a watch-word so the right ravens are heeded, and a rot-date so old parcels crumble on their own. The envelope is light — a pointer to the stone-vault, the wrapped keys, a signature, a label — for the heavy bytes sleep in the vault (IPFS), not on the raven's back. Add a guard regardless: if ever a parcel grows too fat for the seal, refuse it and cry the reason plainly.

**What rides, and what stays on the highroad.** The ravens carry **letters** and **locked chests**, and their *delivered / failed* replies — nothing more. They do **not** carry call-parley (the ringing has but thirty seconds, and the voice-thread is a direct line a raven cannot hold), nor room-invitations (the joining itself needs a direct thread), nor the watch-fires of presence (already lit by their own rite). A strict gate at the raven-watch turns away anything that is not a letter or a chest.

**The toll-guard — heed this above all, for coin is at stake.** The rites of disbursement and escrow are **not** twice-safe: pay a parcel twice and the recipient is paid twice, with no ward in the coin-ledger to stop it. So before any parcel is opened and acted upon, set **two wards of seen-parcel-marks** — one at the raven-watch, one at the gate — each time-windowed and pruned so they never swell unbounded. And set a **per-keep ordering-queue** so one slow ally cannot jam the road for the others. A raven that brings a parcel already seen must be turned away **in silence**.

All of this is **additive and dark by default** — sealed behind a master gate that begins shut. The highroad is never touched and remains the *preferred* road: lowest toll, surest delivery.

---

## Why it is worthy

- **It is the keystone.** Everything yet to come — sealed file-passage across keeps, the paid-courier economy — rests on this road simply *existing*.
- **The false-rider trick is genuinely fine work** — one small forgery makes the old gate carry an entire new road without a single change to the gate.
- **It closes an honest snare.** The keeps once *saw* one another's folk and assumed a parcel could cross. This build makes the gate speak true: "reachable by raven" when it is, "not routable" when it is not — no more comforting lies.

---

## Honest unknowns — where the dragons sleep

- **Ravens are best-effort.** A dropped *paid* parcel means the sender's coin is spent and the recipient credited only when it finally lands. Mitigation: keep at least one raven you yourself command in the flock; and the highroad stays the preferred road precisely because its delivery is sure.
- **Double-pay if the wards ever regress.** The trials *must* prove redelivery and backlog explicitly — not as an afterthought.
- **The seal has a hard size-cap.** Guard before sending; never discover it at the worst moment.
- **Seal-keys may rotate.** Refresh the recipient's key each send; a rotation window loses a parcel or two, then self-heals once the new key is re-verified.

---

## The precondition (the gate this build waits behind)

An elder must first confirm the watch-fires and the heralds still burn true on all three keeps — the ravens reachable, the watch-ledger intact, presence visible across the valley — **before a single raven is loosed**. The build proceeds only once that word comes back green.

---

## The call

No reward of gold is offered. Only the work, and a road that did not exist before.

Sought: a **wright** unafraid of coin-handling code, patient through three-keep trials, with the discipline to lay the new road **without ever touching the working highroad**. The design is drawn, the snares are marked, the dragons named. Vibe-coding welcome.

**Repo:** *pinned beneath this notice.*

---

## A plainspoken gloss for the wright *(so none of the above is mistaken for mere poetry)*

| Flavor | Plain meaning |
|---|---|
| The highroad | The WSS `/federation` transport (working; stays preferred) |
| Ravens / the flock | Nostr relays |
| Allied keeps | The 3 federated v4call servers |
| Watch-fires | Presence (Phase D) — already working |
| Heralds' cries | Discovery (Phase C) + Hive-anchored `verified_nostr_hex` binding |
| Sealed parcel | NIP-44–encrypted envelope (server-key → peer-key) |
| The false rider | The **pseudo-ws shim**: `{ _domain, readyState:1, send() }` whose `send()` republishes over Nostr; lets existing `dm` / `dm-attachment` / `dm-attachment-failed` handlers run **unchanged** |
| The gate-keeper | `fedHandleMessage` — left untouched |
| Letters / locked chests | `dm` (text) / `dm-attachment` (media wrappers) + their `dm-delivered` / `dm-failed` / `dm-attachment-failed` replies |
| Raven-mark `1314` | Nostr **stored** kind `1314` ("v4call fedmsg") — not replaceable `30078`, not ephemeral `2xxxx` |
| Tags on the mark | `['p', recipientHex]`, `['t','v4call-fedmsg']`, `['expiration', now+TTL]` (NIP-40 GC) |
| Stone-vault | IPFS — the file bytes; only the small metadata envelope rides Nostr |
| Two wards of seen-marks | Two-layer event-id dedup: `seenIds` in `startFedTransport` + `seenFedEventIds` in `onNostrFedMessage`, both time-windowed Maps, pruned on a timer |
| Per-keep ordering-queue | `nostrFedQueues[domain]` promise chain (per-domain, mirrors WSS `ws._processQueue`) |
| The strict gate at the raven-watch | Receive-side type whitelist: `dm, dm-attachment, dm-delivered, dm-failed, dm-attachment-failed` only |
| Master gate, dark by default | `NOSTR_FED_TRANSPORT=false` (enable on all peers together; mixed peers degrade gracefully) |
| Rot-date / TTL | `NOSTR_FEDMSG_TTL_SECONDS=86400` (store-and-forward window) |
| Stays on the highroad only | Calls (`call-*`), room invite/join — out of scope, reasons in the plan |
| Reachable-by-raven vs. a comforting lie | `recipientStatus` / dm-precheck returns `status:'nostr'` (sendable) when transport on + `nostrSeenDomain` + no WS peer — closes the "visibility lies" gap |

**Build footprint, plainly:**
- `nostr-fed.mjs` — **extend, do not add a new `.mjs`** (a new top-level file needs its own Dockerfile `COPY`). Add `nostrFedSend`, `startFedTransport`, extend the controller. Reuses `publishOnce`, the `SimplePool`, the per-server key.
- `server.js` — `domainForNostrPubkey`, `nostrPseudoWsForDomain`, `onNostrFedMessage`, `nostrFedSendToDomain`, `fedRouteSend` (WSS-first, Nostr-fallback), `peerEscrowForDomain`; send-site transport-only refactors at `lobby-dm` (~3038) and `dm-attachment` (~4947); `recipientStatus`/dm-precheck update; wire into `startNostrFed` (~6798).
- `.env` / `.env.example` — `NOSTR_FED_TRANSPORT`, `NOSTR_FEDMSG_TTL_SECONDS` + doc block.
- `FED-RECOVERY-NOTES.md` — close open-issue #3, record the visibility-vs-routability resolution.
- **Dockerfile — no change.** Verify `nostr-fed.mjs` COPY + `/app/nostr` volume already present. Reuse the existing per-server key — no new key file, never browser-side, never logged.
