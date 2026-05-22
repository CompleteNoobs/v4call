# v4call ↔ Nostr Federation — Phase D Design (Presence)

> **Status:** Design only — no code. Built when Phase C has baked in production
> ~3–7 days. Created 2026-05-21 immediately after Phase C shipped to all 3
> production servers.
>
> **Read order:** v4call `CLAUDE.md` → `FEDERATION-BUILD-SPEC.md` →
> `NOSTR-FED-BUILD-PLAN.md` (Phases A–C done) → **this file** → eventually
> the Phase D wiki section (written after it works).

---

## 1. The one-paragraph mission

Phase D adds cross-server **presence** via Nostr: each server publishes a
throttled snapshot of its online users, other servers subscribe, and the
lobby UI shows users from other federated servers with a domain badge and a
click-through link. Phase D solves the original "users sometimes don't show
across servers" pain — but **additively**, not by replacing the WS
federation's existing presence relay. WS stays authoritative; Nostr only
**adds** users WS hasn't reported. If Phase D misbehaves, it can be turned
off with one env knob and v4call loses nothing.

---

## 2. Locked decisions (this doc)

1. **Reconciliation: WS-wins-Nostr-additive.** The existing WS-federation
   presence is authoritative. Nostr presence can ADD a user the WS path
   hasn't yet reported, but it can NEVER mark anyone offline. If WS later
   reports a user the Nostr path also lists, the Nostr entry is dropped
   silently (no UI flap). Smallest behavioural change; trivially rollback-able.
2. **Trust model:** identical to Phase C — trust nothing in the event payload
   for security. A presence event is only considered if its `pubkey` matches
   an already-Phase-C-verified peer (we know which npub belongs to which
   domain because Phase C wrote it). Events from unknown pubkeys are dropped.
3. **Server-side only.** Users have no Nostr keys, browsers never touch
   relays. (Unchanged from the locked plan.)
4. **No federation protocol bump.** Nostr lives outside the WS protocol.
5. **One small surgical change to `index.html`** is acceptable for Phase D —
   the lobby user-list render gets a new section for cross-fed users with a
   server badge + click-through. CLAUDE.md "don't split index.html" still
   holds (we don't split; we add a small block).
6. **Phase D is feature-gated.** New env `FED_PRESENCE_VIA_NOSTR=true|false`
   (default `false` until proven). When false, none of this code runs; v4call
   behaves identically to post-Phase-C state. The gate stays separate from
   `FED_DISCOVERY_MODE` so presence can be tested independently of discovery.

---

## 3. Event schema

```json
{
  "kind": 30078,
  "created_at": <unix seconds>,
  "tags": [
    ["d", "<domain>:users"],
    ["t", "v4call-presence"],
    ["protocol", "0.4"]
  ],
  "content": "{\"domain\":\"<domain>\",\"users\":[\"foo\",\"bar\"],\"updated_at\":\"2026-05-21T14:32:00Z\"}",
  "pubkey": "<server's Phase B nostr hex>",
  "sig": "<schnorr sig>"
}
```

- `d` tag = `<domain>:users` — distinct from the discovery `d=<domain>` so
  the two event types don't collide on relays. NIP-78 keeps only the newest
  per d-tag — re-publishes replace, never accumulate.
- `t` tag = `v4call-presence` — distinct from `v4call-server`. Subscribers
  filter on this tag exclusively for the presence stream.
- `content` is a JSON string. Display + reconciliation values come from
  here, but `domain` is cross-checked against the `d` tag (mismatch → drop).
- Signed by the **same per-server Nostr key** Phase B already manages. No
  new key bootstrap.

---

## 4. Publish logic (server-side)

### Triggers

A publish is **scheduled** (not immediately sent) when:
- A local user joins the lobby (existing `lobby-join` socket handler).
- A local user disconnects / leaves (`lobby-leave` / `disconnect` handlers).
- The heartbeat timer fires.

### Throttle + heartbeat

Two timers:
- **Throttle:** at most one publish per `NOSTR_PRESENCE_THROTTLE_SECONDS`
  (default 30). All scheduled-publishes within the window collapse to one
  send at window-end.
- **Heartbeat:** every `NOSTR_PRESENCE_HEARTBEAT_SECONDS` (default 60) we
  republish even if nothing changed, so relays that dropped events recover.

Edge case (back-to-back bursts at the 30s mark): acceptable; traffic is
still tiny. Documented, not optimised.

### Content

```js
{
  domain: SERVER_DOMAIN,
  users: Array.from(localOnlineUsernames).sort(),  // sorted = stable diffs
  updated_at: new Date().toISOString(),
}
```

`localOnlineUsernames` reuses the existing server-side set the WS presence
path already maintains — we don't track a new state, we just snapshot.

### Mode gate

Publishes only when `FED_PRESENCE_VIA_NOSTR=true` AND
`FED_DISCOVERY_MODE` includes Nostr (`nostr` or `both`). If discovery is
`hive`, presence is silently off (the relays might not even be configured).

---

## 5. Subscribe logic (server-side)

### Subscription

A second long-lived `SimplePool.subscribeMany` next to Phase C's, filter
`{ kinds:[30078], '#t':['v4call-presence'] }`. Same belt-and-braces 30-min
re-open. Same own-pubkey skip (we don't process our own publishes).

### Trust gate (the core safety property)

For each incoming event:
1. Extract `domain` from the `d` tag (`<domain>:users` → strip `:users`).
2. Cross-check `content.domain === domain` (mismatch → drop, no log spam).
3. **Look up the expected pubkey for `domain` in `discoveredPeers`.**
   Prefer the **Hive-signature-anchored** binding (`verified_nostr_hex`)
   from `verifyPeer`'s 12-field "Option B" canonical — available since the
   2026-05-22 canonical-mismatch fix. If absent (peer hasn't re-signed
   with Nostr fields yet), fall back to Phase C's `nostr_pubkey` from the
   discovery event (untrusted "poke" binding). If `event.pubkey` matches
   neither, drop.
4. If the peer is **not in `discoveredPeers` at all yet**, drop and queue the
   event for re-check after the next discovery cycle. (Don't trust a
   presence event for a domain we've never Hive-verified.)

This is the same "Hive is the only trust gate" rule from Phase C, but
*upgraded* — when a peer's verify file uses Option B (Nostr fields signed
into the Hive canonical), the npub↔domain binding has the same Hive
posting-key signature backing it as the domain itself. A forged presence
event for an Option-B peer cannot pass even if the relay layer is
compromised. The Phase C "poke" binding stays as a fallback for peers
still on the 9-field canonical until they re-sign.

### State

New server-side map:

```js
nostrCrossFedPresence = {
  // domain → { users: Set<string>, lastUpdated: ms, lastEventId: string }
}
```

Updates atomically per incoming verified event (newer-timestamp wins per
domain). Older events are dropped.

### TTL / staleness

A periodic sweep (every 60s) drops any domain whose `lastUpdated` is older
than `NOSTR_PRESENCE_TTL_SECONDS` (default 300 — five heartbeats). This
auto-clears ghost presence when a peer's relay link dies.

---

## 6. Reconciliation (WS-wins-Nostr-additive)

The **lobby presence view** the browser already gets via the WS-federation
path stays the source of truth. We compute a small additive layer:

```
For each federated peer domain D in nostrCrossFedPresence:
  wsKnownUsers = users currently reported by D via the WS path
  nostrUsers   = nostrCrossFedPresence[D].users
  extraUsers   = nostrUsers MINUS wsKnownUsers
  emit to local clients: { domain: D, extra_users: extraUsers, source: 'nostr' }
```

Properties of this design:

- If WS path is healthy, `extraUsers` is usually empty → zero visual change.
- If WS link is delayed/missing while Nostr arrives first, `extraUsers`
  briefly contains users WS will report a moment later. They appear with a
  Nostr badge until WS catches up, then silently re-badge as normal WS users.
- Nostr **never removes** a user the WS path reports — the function only
  ever does `nostr MINUS ws`.
- If Nostr says X is offline but WS still says X is online, WS wins (X stays
  online in the UI).
- If WS link drops entirely, the existing WS-side timeout logic already
  marks users offline on its own timer; the additive Nostr layer can then
  start showing the same names from its own presence map as `extra_users`
  until the WS link recovers.

**Edge case — slow WS, fast Nostr at first sight:** a user joins on
hive-book.com; v4call.com hears via Nostr in ~2s, via WS in ~5s. For 3s the
user appears in v4call.com's lobby with a "via Nostr" badge, then re-badges
to normal. Acceptable; the alternative (hiding until WS confirms) defeats
the purpose.

---

## 7. Client-side change (the small `index.html` touch)

Minimal, surgical. Existing user-list render gets a new code path:

- A new socket event `cross-fed-presence` carries `{ domain, extra_users, source }`.
- The client appends extra_users to the user list with:
  - A small `@domain` badge (mirrors the existing federated-room badge style)
  - A click-handler that opens `https://<domain>/` in a new tab (no message
    is sent across — user just travels to the destination server, where
    Hive auth carries them).
- Removal: server emits an updated `cross-fed-presence` (or a TTL sweep
  drops the user); client re-renders.

No new persistent state, no new auth, no Nostr code in the browser.

---

## 8. Env knobs (final shape)

```
# Phase D — presence over Nostr (additive to WS presence)
FED_PRESENCE_VIA_NOSTR=false              # master gate, default off until proven
NOSTR_PRESENCE_THROTTLE_SECONDS=30        # at most one publish per N seconds
NOSTR_PRESENCE_HEARTBEAT_SECONDS=60       # republish every N seconds even unchanged
NOSTR_PRESENCE_TTL_SECONDS=300            # drop a domain's presence if stale this long
```

Three new knobs total (plus the existing Phase A–C ones). Documented as a
group in `.env.example`.

---

## 9. Scope boundaries (still NOT in Phase D)

- WebRTC signalling, paid DMs, call initiation, escrow, payments,
  call-receipt-fed — all stay on the WS transport.
- Lobby chat / room chat *content* — stays on WS.
- Server-discovery semantics — Phase C is the channel; Phase D doesn't
  rediscover, it relies on Phase C's binding.
- No new federation envelope types. No `protocol_version` bump.
- No browser-side Nostr code.
- No new peer-approval mechanism — only already-Phase-C-verified peers can
  contribute presence data.

---

## 10. Failure modes + behaviour

| Failure | Effect | Mitigation |
|---|---|---|
| All Nostr relays down | No new Nostr presence updates; existing in-memory presence ages out after TTL; WS path keeps working unchanged | TTL sweep; WS-wins reconciliation; user sees no behaviour change |
| One relay down | Other relays carry events; SimplePool reconnect | Multi-relay redundancy |
| Forged presence event from wrong pubkey | Dropped at the trust gate | The Phase C npub↔domain binding |
| Presence event from unknown domain (not in discoveredPeers) | Dropped; optionally queued for re-check post-discovery | Discovery is the prerequisite |
| Clock skew between servers | Newer `created_at` wins per domain; small skew tolerable; large skew is a server-clock bug | Document; rely on NTP |
| Relay echoes very old presence event | TTL sweep drops it; newer-wins also prevents adoption | TTL + newer-wins |
| Peer rotates its Nostr key | Discovery (Phase C) re-binds the new pubkey; old-key presence events stop being trusted on next discovery cycle | Existing Phase C behaviour |
| Throttle window edge-case burst | Two publishes ~30s apart instead of one. Tiny extra traffic. | Documented, not optimised |

---

## 11. Test plan (when we build)

### Isolated (`scripts/nostr-spike-presence.mjs`)
- Publish a presence event with our Phase B identity to a public relay.
- Subscribe with a stub that just logs receipt.
- Verify own-pubkey skip works.
- Verify a *forged* event (different pubkey claiming our domain) is dropped
  by the trust gate.

### Local (single server harness, similar to Phase B/C tests)
- Mock `discoveredPeers` with a known peer.
- Inject a synthetic presence event claiming that domain with the wrong
  pubkey → expect drop.
- Inject with the right pubkey → expect `nostrCrossFedPresence` updated.
- Wait past TTL with no refresh → expect entry purged.
- Subsequent valid event → re-populates.

### Live (3-server)
- `FED_PRESENCE_VIA_NOSTR=false` everywhere → no behaviour change vs Phase C
  (sanity baseline).
- Enable on call.completenoobs.com only → others ignore its presence stream
  (gate off → no subscribe). No cross-effects.
- Enable on all 3 → noblemage on v4call.com sees guest33 on hive-book.com
  appear in seconds with a `@hive-book.com` badge. Click-through opens
  hive-book.com.
- Kill the WS link briefly (firewall) → Nostr layer keeps the cross-fed
  presence visible. Restore link → entries silently re-badge to WS.

### Production (post-deploy)
- Enable on one server, leave others off for 24h — observe traffic, no
  regressions to WS presence.
- Enable all three for ~3 days — measure cross-fed presence visibility
  latency (target: < 5s typical).
- Stress: simulate relay outage; verify graceful degradation.

---

## 12. Estimated scope

- `server.js`: ~80–120 lines (publish trigger + throttle + heartbeat + the
  subscribe handler + trust gate + state map + TTL sweep + the
  reconciliation emit).
- `nostr-fed.mjs`: ~40–60 lines (a second subscribe path, the presence
  publish helper). Reuses Phase A–C infra (pool, key, 3-state logging).
- `public/index.html`: ~30–60 lines (new socket handler + extra-users
  rendering with badge + click-through).
- `.env.example`: 3 new lines + comments.
- `noob-docs/nostr-fed-walkthrough.wiki`: new Phase D section + new glossary
  terms (written after it works on real servers).

Realistic build session: 1–2 focused sessions. Test cycle: 1 more session
covering both isolated + 3-server live tests.

---

## 13. Open questions (small ones, settled at build time)

1. **Click-through URL format.** Just `https://<domain>/`? Or with a query
   param hint? Lean: plain root URL, Hive Keychain auth carries.
2. **Badge label.** `@hive-book.com` or just `via @hive-book.com`? Match
   existing federated-room badge style (probably the former).
3. **First-publish on boot.** Publish immediately on boot, or wait for the
   first local join? Lean: publish on boot (could be empty `users:[]`); other
   servers learn we're alive sooner. Heartbeat handles the rest.
4. **Server-side log noise.** Throttle the "got presence event from X"
   line to once per minute per source, or log every event? Lean: every
   event at debug level, summary at info level once per heartbeat.
5. **What if a domain's `nostr_pubkey` rotates between Phase C re-discovery
   cycles?** Phase D presence from the old key is dropped on next discovery
   refresh. Acceptable; a few minutes of stale presence. No special path
   needed.

---

## 14. Status log

- **2026-05-22** — Trust gate (§5) upgraded to **prefer Hive-anchored
  `verified_nostr_hex`** from the Option B 12-field canonical (free thanks
  to the canonical-mismatch fix landed today). Phase C "poke" binding
  retained as a fallback for peers still on the 9-field canonical.
  Strictly stronger than the original Phase D design — same code shape,
  cleaner trust story.
- **2026-05-21** — Design captured immediately after Phase C shipped to all
  3 production servers. Build deferred until Phase C has baked ~3–7 days in
  production. Locked: WS-wins-Nostr-additive reconciliation, server-side
  only, feature-gated by `FED_PRESENCE_VIA_NOSTR` (default off), trust gate
  reuses Phase C's npub↔domain binding, one small surgical addition to
  `index.html` is permitted.
