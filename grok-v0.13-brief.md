# v4call v0.13 — Brief for Grok

You are helping ship **v4call v0.13** — a focused 1–2 session feature pass on top of the production-deployed v0.12. v4call is a decentralised paid video/voice/text comms platform built on the Hive blockchain. The author is a tinkerer (not a developer). Code conservatively. **Match the existing patterns; do not refactor.**

This brief is self-contained. You do not need any prior conversation context.

---

## What v0.13 ships

Two independent features in one release:

1. **4-tab lobby reorganization** (DM gets its own tab, fixes "DMs mixing into lobby chat")
2. **Lobby anti-spam gate** (HP and/or token thresholds on lobby posting, configurable via `.env`)

Plus a small server-side `lobby-config` event that the client uses to render the lobby title / notice / requirements text.

---

## Repo layout (only the files you'll touch)

```
/server.js                — All backend. Single file. Express + Socket.io + better-sqlite3 + ws.
/public/index.html        — Entire main frontend. Single file. Do NOT split.
/.env.example             — Documented env vars. Add new ones here.
/CLAUDE.md                — Project context (read it; do not modify unless asked)
/README.md                — User-facing docs; bump if you add user-visible config
```

**Do not touch:**
- `public/rate-editor.html`, `public/server-sign.html`, `public/server-announce.html`, `public/admin-peers.html`, `public/info.html` — standalone operator pages, deliberately separate
- `nginx/`, `Dockerfile`, `docker-compose.yml` — deploy infra
- `WalkThrough.wiki`, `FEDERATION-BUILD-SPEC.md` — docs the user maintains by hand

---

## Hard constraints (read these — they're load-bearing)

1. **Do not split `index.html`.** All HTML/CSS/JS for the main app lives in one file. This is intentional. Do not extract CSS or JS into separate files.
2. **Do not invent new abstractions.** v4call is vibe-coded. Match the existing flat style — small functions, inline event handlers, CSS variables.
3. **CSS variables only.** Never hardcode colours. Use `--bg`, `--surface`, `--surface2`, `--accent` (orange), `--green`, `--blue`, `--purple`, `--text`, `--subtext`, `--muted`, `--border`, `--danger`. Dark theme only — never add a light theme.
4. **Fonts:** `'IBM Plex Mono'` for UI labels/badges/buttons; `'IBM Plex Sans'` for body text. Both already loaded.
5. **Mobile breakpoint:** `@media (max-width: 720px)`. iPhone inputs/textareas must be `font-size: 16px` (already in the global mobile rule — don't undo it).
6. **No backwards-compat shims.** v4call is a fresh project; just change the code.
7. **No comments explaining what code does.** Only add a comment when *why* is non-obvious (a hidden constraint, a workaround for a specific Hive quirk, a subtle invariant).
8. **No new dependencies.** Use what's already in `package.json`: `express`, `socket.io`, `better-sqlite3`, `ws`, `@hiveio/dhive`, `hivecrypt`, `node-fetch` (built-in fetch is fine — use that).
9. **Federation protocol does NOT bump.** v0.13 is all local-server changes. Do not add new federation message types.
10. **Deploy cycle is `docker compose down && docker compose build --no-cache && docker compose up -d`.** No need to run it; just write code that survives this cycle.

---

## Reusable infrastructure you should leverage

### `hivePost(body, nodes?)` at server.js ~line 1078
Sends a JSON-RPC request to Hive nodes with automatic fallback. Already logs errors verbosely.
```js
const data = await hivePost({
  jsonrpc: '2.0',
  method:  'condenser_api.get_accounts',
  params:  [['username']],
  id: 1
});
if (data?.result?.[0]) { ... }
```
**Important:** any `get_discussions_by_*` query must use `limit ≤ 20` (Hive nodes assert otherwise). Other methods are unrestricted.

### `getHiveEngineTokenBalance(account, symbol)` at server.js ~line 498
Returns the account's balance of the given Hive-Engine token. Uses a 5-minute cache (`tokenBalanceCache`, `TOKEN_CACHE_TTL`). Returns `0` on any failure mode (logged but not cached, so retries can recover). Use it directly:
```js
const bal = await getHiveEngineTokenBalance(username, 'HIVEBOOK');
if (bal >= 10) { ... }
```

### `lobbyUsers` map at server.js ~line 395
`{ username → { socketId, pubKey, invisible, inCall? } }`. Source of truth for who's online locally.

### Existing posting handlers (the gate must intercept these)
- `socket.on('lobby-chat', ({ message, signature, timestamp }) => { ... })` — **server.js ~line 1965** — broadcast to all online users
- `socket.on('lobby-encrypted', ({ to, ciphertext, senderCiphertext, signature, timestamp }) => { ... })` — **server.js ~line 1978** — toggled per-recipient encrypted DM in the lobby

Both currently pass through with no posting gate. Your gate must run **before** the broadcast/relay.

### Existing lobby-tab UI (you'll extend, not rewrite)
- `index.html` has `#lobby-tabs` (~line 574) with two `.lobby-tab` buttons calling `switchLobbyTab('chat'|'rooms')`
- `switchLobbyTab(tab)` is at ~line 1309 — toggles `.active` on `.lobby-tab` buttons + `.lobby-tab-content` panels
- Mobile bottom-tab nav (`.mob-nav`) is separate; see CSS at lines 304–340 for how it currently maps `mob-tab-chat` / `mob-tab-rooms` to which middle-panel tab is shown

### DM panel (you'll relocate, not rewrite)
- HTML: `#dm-panel` (~line 573) currently lives inside `#tab-chat` (the lobby chat tab)
- Open: `openDmPanel(username)` at ~line 1326 — flips the panel to active, fetches history once per session via `dmHistoryLoaded` Set, fetches rates via `socket.emit('get-all-rates', ...)` and renders the multi-token picker
- Send: `sendDmMessage()` at ~line 1490 — handles free + paid (Keychain `requestTransfer` / `requestCustomJson`)
- Close: `closeDmPanel()` at ~line 1453
- Live receive: `socket.on('lobby-dm', ...)` calls `addLobbyMsg({type:'dm', ..., signature, timestamp, currency})`
- `addLobbyMsg` at ~line 1655 dedups DMs by signature (`renderedDmKeys` Set) and renders into `#lobby-messages`

**The bug v0.13 fixes:** `addLobbyMsg` writes both lobby-broadcast and DM messages into the *same* `#lobby-messages` div. Moving DMs into their own tab means giving them their own message container.

---

## v0.13 — exact spec

### Part A: 4-tab lobby

Replace the current 2-tab lobby with **four tabs**, in this order:

| Tab key | Label | Contents |
|---|---|---|
| `dm` | 💬 DMs | DM panel + DM-only message history (encrypted DMs to/from individual users) |
| `lobby` | 📢 Local Lobby | Lobby broadcasts + lobby-encrypted (toggle) messages + system messages. Plus the lobby title + notice + requirements text rendered above the message list. |
| `active` | 🚪 Active Rooms | The currently-rendered "Active Rooms" list (existing `#tab-rooms` content) |
| `included` | ✉️ Included Rooms | Rooms where the current user is on the allowlist but is **not currently in**. Each row shows room name + creator + a "Knock" button that calls existing `knockRoom(name)`. |

**Behavioural details:**

- Default active tab on login: `lobby` (matches today's "drops you into the lobby chat" behaviour).
- The mobile bottom-tab nav (`.mob-nav` at ~line 727) currently has `USERS / CHAT / ROOMS`. Update it to mirror the new four tabs as `USERS / DMS / LOBBY / ROOMS`. Keep `USERS` as the "show users panel" mobile tab. Drop nothing — the room-screen mob-nav (VIDEO / CHAT / MEMBERS) is unrelated and stays as-is.
- `Active Rooms` and `Included Rooms` should both pull from the same `socket.on('lobby-rooms', roomsData => { ... })` handler at ~line 1733. Today that handler renders only into `#rooms-list`. Update it to render into two separate lists by partitioning `roomsData`:
  - `Active`: rooms where `r.memberCount > 0` (or the user has any membership relationship — match today's existing logic)
  - `Included`: rooms where `r.allowlist.includes(myUsername)` AND `r.memberCount === 0` (i.e. allowlisted but room is currently empty)
  - **Verify against the actual `roomsSnapshot()` shape in server.js — match what's already emitted; do not change the server payload.**
- DM tab content:
  - Top: a small "Open DMs with @username:" autocomplete/picker so the user can start a new conversation (use the existing `lobbyUsers` data already in the client to show online users)
  - OR equivalently, show a list of recent DM partners (anyone with stored history) as click-to-open. Match whichever pattern is simpler given the existing code.
  - Below: the relocated `#dm-panel` (or a clean rebuild of equivalent structure)
  - Below that: a `#dm-messages` div (separate from `#lobby-messages`) that holds **only DM messages**

**Required edit to `addLobbyMsg`:** route DM messages (`type === 'dm'`) into `#dm-messages` instead of `#lobby-messages`. System messages stay in `#lobby-messages`. This is the surgical fix for "DMs mixing into lobby chat".

### Part B: Lobby title / notice (server-driven)

On `lobby-join`, after the existing emits, the server emits a new `lobby-config` event:
```js
socket.emit('lobby-config', {
  serverName:        SERVER_NAME,
  serverDomain:      SERVER_DOMAIN,
  notice:            LOBBY_NOTICE_RESOLVED,         // see below
  requirementsText:  LOBBY_REQUIREMENTS_RESOLVED    // see below
});
```

**Resolution logic (server.js, near other env parsing at the top):**

```js
const LOBBY_NOTICE_RAW = process.env.LOBBY_NOTICE || '';
const LOBBY_REQUIREMENTS_RAW = process.env.LOBBY_REQUIREMENTS_TEXT || '';
const LOBBY_POST_MIN_HP    = parseFloat(process.env.LOBBY_POST_MIN_HP || '0') || 0;
const LOBBY_POST_MIN_TOKEN_RAW = (process.env.LOBBY_POST_MIN_TOKEN || '').trim(); // "SYMBOL:amount"
const LOBBY_POST_GATE_MODE = (process.env.LOBBY_POST_GATE_MODE || 'or').toLowerCase() === 'and' ? 'and' : 'or';

let LOBBY_POST_MIN_TOKEN_SYMBOL = null;
let LOBBY_POST_MIN_TOKEN_AMOUNT = 0;
if (LOBBY_POST_MIN_TOKEN_RAW.includes(':')) {
  const [sym, amt] = LOBBY_POST_MIN_TOKEN_RAW.split(':');
  LOBBY_POST_MIN_TOKEN_SYMBOL = sym.trim().toUpperCase();
  LOBBY_POST_MIN_TOKEN_AMOUNT = parseFloat(amt) || 0;
}

const LOBBY_NOTICE_RESOLVED = LOBBY_NOTICE_RAW ||
  `${SERVER_DOMAIN} — local lobby. For federated contacts use rooms / DMs / calls.`;

const LOBBY_REQUIREMENTS_RESOLVED = LOBBY_REQUIREMENTS_RAW || (() => {
  const parts = [];
  if (LOBBY_POST_MIN_HP > 0) parts.push(`${LOBBY_POST_MIN_HP} HP`);
  if (LOBBY_POST_MIN_TOKEN_SYMBOL) parts.push(`${LOBBY_POST_MIN_TOKEN_AMOUNT} ${LOBBY_POST_MIN_TOKEN_SYMBOL}`);
  if (parts.length === 0) return ''; // no gate
  if (parts.length === 1) return `Posting requires ${parts[0]}.`;
  return `Posting requires ${parts.join(LOBBY_POST_GATE_MODE === 'and' ? ' AND ' : ' OR ')}.`;
})();
```

**Client (`index.html`):**

- Render `notice` as the first child of the `lobby` tab (above the message list), styled as a `.lobby-notice` block — small, muted text, distinct from system messages.
- Render `requirementsText` directly under `notice` as a `.lobby-requirements` block. If empty, hide the block entirely. Use a slightly different colour so the requirement reads as actionable info rather than a passive notice.
- Both texts stick to the top of the `lobby` tab while messages scroll below.

### Part C: Anti-spam gate

Server-side check on **both** `lobby-chat` and `lobby-encrypted` (the two lobby posting paths). Runs **before** broadcast/relay.

#### Hive Power lookup

Add a new helper near `getHiveEngineTokenBalance`:

```js
const hpCache = {}; // username → { hp, fetchedAt }
const HP_CACHE_TTL = 5 * 60 * 1000;
let hivePerVestCache = { value: null, fetchedAt: 0 };
const HIVE_PER_VEST_TTL = 60 * 60 * 1000; // hive_per_vest moves slowly; 1h is fine

async function getHivePerVest() {
  if (hivePerVestCache.value && (Date.now() - hivePerVestCache.fetchedAt) < HIVE_PER_VEST_TTL) {
    return hivePerVestCache.value;
  }
  const data = await hivePost({
    jsonrpc: '2.0',
    method:  'condenser_api.get_dynamic_global_properties',
    params:  [], id: 1
  });
  if (!data?.result) return null;
  const totalVesting     = parseFloat(data.result.total_vesting_fund_hive);
  const totalVestingShares = parseFloat(data.result.total_vesting_shares);
  if (!totalVesting || !totalVestingShares) return null;
  const hivePerVest = totalVesting / totalVestingShares;
  hivePerVestCache = { value: hivePerVest, fetchedAt: Date.now() };
  return hivePerVest;
}

async function getHivePower(username) {
  const cached = hpCache[username];
  if (cached && (Date.now() - cached.fetchedAt) < HP_CACHE_TTL) return cached.hp;

  const data = await hivePost({
    jsonrpc: '2.0',
    method:  'condenser_api.get_accounts',
    params:  [[username]], id: 1
  });
  if (!data?.result?.[0]) {
    console.warn(`[hp] account @${username} not found — treating HP as 0 (not cached)`);
    return 0;
  }
  const acct = data.result[0];
  const ownedVests = parseFloat(acct.vesting_shares);  // "12345.678901 VESTS"
  const hivePerVest = await getHivePerVest();
  if (!hivePerVest) {
    console.warn(`[hp] hive_per_vest unavailable — treating HP as 0 (not cached)`);
    return 0;
  }
  const hp = ownedVests * hivePerVest;
  hpCache[username] = { hp, fetchedAt: Date.now() };
  return hp;
}

// Periodic cache cleanup (mirror tokenBalanceCache pattern)
setInterval(() => {
  const cutoff = Date.now() - HP_CACHE_TTL;
  for (const k in hpCache) if (hpCache[k].fetchedAt < cutoff) delete hpCache[k];
}, 15 * 60 * 1000);
```

**Notes:**
- `vesting_shares` is a string like `"12345.678901 VESTS"` — `parseFloat` will pull the leading number cleanly.
- Do not include `delegated_vesting_shares` or `received_vesting_shares` in the calculation. The spec says "minimum HP required" → the user's *owned* HP is the natural anti-spam signal; including delegated-in HP would let one whale rent posting privileges.

#### Gate enforcement

Single helper that returns `{ allowed: true }` or `{ allowed: false, message }`:

```js
async function checkLobbyPostGate(username) {
  if (LOBBY_POST_MIN_HP <= 0 && !LOBBY_POST_MIN_TOKEN_SYMBOL) {
    return { allowed: true };
  }
  const checks = [];
  let hp = null, tokenBal = null;

  if (LOBBY_POST_MIN_HP > 0) {
    hp = await getHivePower(username);
    checks.push({ kind: 'hp', actual: hp, required: LOBBY_POST_MIN_HP, pass: hp >= LOBBY_POST_MIN_HP });
  }
  if (LOBBY_POST_MIN_TOKEN_SYMBOL) {
    tokenBal = await getHiveEngineTokenBalance(username, LOBBY_POST_MIN_TOKEN_SYMBOL);
    checks.push({
      kind: 'token', symbol: LOBBY_POST_MIN_TOKEN_SYMBOL,
      actual: tokenBal, required: LOBBY_POST_MIN_TOKEN_AMOUNT,
      pass: tokenBal >= LOBBY_POST_MIN_TOKEN_AMOUNT
    });
  }

  const passed = LOBBY_POST_GATE_MODE === 'and'
    ? checks.every(c => c.pass)
    : checks.some(c => c.pass);

  if (passed) return { allowed: true };

  const required = checks.map(c => c.kind === 'hp'
    ? `${c.required} HP`
    : `${c.required} ${c.symbol}`
  ).join(LOBBY_POST_GATE_MODE === 'and' ? ' AND ' : ' OR ');
  const actual = checks.map(c => c.kind === 'hp'
    ? `${c.actual.toFixed(1)} HP`
    : `${c.actual} ${c.symbol}`
  ).join(', ');
  return {
    allowed: false,
    message: `This server requires ${required} to post in the lobby. You have ${actual}.`
  };
}
```

**Wire into the existing handlers:**

```js
socket.on('lobby-chat', async ({ message, signature, timestamp }) => {
  const from = socket._username;
  if (!from) return;
  const gate = await checkLobbyPostGate(from);
  if (!gate.allowed) { socket.emit('lobby-post-rejected', { reason: gate.message }); return; }
  io.emit('lobby-chat', { from, message, signature, timestamp });
});

socket.on('lobby-encrypted', async ({ to, ciphertext, senderCiphertext, signature, timestamp }) => {
  const from = socket._username;
  if (!from) return;
  const gate = await checkLobbyPostGate(from);
  if (!gate.allowed) { socket.emit('lobby-post-rejected', { reason: gate.message }); return; }
  // ... rest of existing handler unchanged
});
```

**Client:** add a handler for the new rejection event:
```js
socket.on('lobby-post-rejected', ({ reason }) => {
  addLobbyMsg({ type: 'system', text: `⚠ ${reason}` });
});
```

DMs are **not** gated. The lobby gate is for the lobby broadcast/encrypted-toggle channel only. Paid-DM gating is already enforced via the rates post.

### Part D: `.env.example` additions

Append to `.env.example` (do not change existing lines):

```env
# ── v0.13 — Lobby Notice + Anti-Spam Gate ────────────────
# Custom text shown under the lobby title. Blank = auto-generated from
# SERVER_DOMAIN ("hive-book.com — local lobby. For federated contacts use
# rooms / DMs / calls.")
LOBBY_NOTICE=

# Custom text describing posting requirements. Blank = auto-generated from
# the gate vars below.
LOBBY_REQUIREMENTS_TEXT=

# Minimum *owned* Hive Power to post in the lobby (broadcast or encrypted
# toggle). Set to 0 or leave blank to disable the HP gate. Does not affect
# DMs or calls.
LOBBY_POST_MIN_HP=

# Minimum custom Hive-Engine token balance to post. Format: SYMBOL:amount
# (e.g. HIVEBOOK:10). Leave blank to disable the token gate.
LOBBY_POST_MIN_TOKEN=

# How the two gates above combine when BOTH are set:
#   or  = user passes if EITHER threshold met (default)
#   and = user passes only if BOTH thresholds met
# Only relevant when BOTH LOBBY_POST_MIN_HP and LOBBY_POST_MIN_TOKEN are set.
LOBBY_POST_GATE_MODE=or
```

### Part E: Documentation updates

After the code is done:

- Update **`CLAUDE.md`**:
  - Bump "Current Version" to v0.12 → v0.13 (federation protocol stays at v0.3)
  - Move the v0.13 entry from "Planned Features" to a "v0.13 polish" subsection under "Features (What's Built and Working)"
  - Update the `.env Variables` block to include the new `LOBBY_*` vars (the variable names already exist as a "v0.13 additions (planned — not yet built)" comment block — drop the "(planned — not yet built)" qualifier)
- Update **`README.md`**:
  - Bump "Current version" line to v0.13
  - Mark v0.13 row in the Roadmap table as ✅ shipped (mirror the v0.12 strikethrough format)
  - Add the new `LOBBY_*` vars to the Configuration Reference table

---

## What success looks like

Once you're done:

1. `node -c server.js` parses cleanly, and `new Function(scriptText)` parses every `<script>` block in `index.html` cleanly (verify before claiming done).
2. With `.env` containing `LOBBY_POST_MIN_HP=100` and `LOBBY_POST_MIN_TOKEN=HIVEBOOK:5` and `LOBBY_POST_GATE_MODE=or`, a user with 50 HP and 0 HIVEBOOK who posts in the lobby gets:
   `⚠ This server requires 100 HP OR 5 HIVEBOOK to post in the lobby. You have 50.0 HP, 0 HIVEBOOK.`
3. With no gate vars set, lobby posting works exactly as today (no extra latency from cache misses).
4. The DM tab is its own tab. DM messages render only inside the DM tab. Switching to the Lobby tab shows broadcasts + system messages, not DMs.
5. Allowlisted-but-empty rooms appear in the "Included Rooms" tab with a working Knock button.
6. The lobby notice text + requirements text render above the lobby messages, both styled as muted blocks.
7. `git diff --stat` shows changes only in `server.js`, `public/index.html`, `.env.example`, `CLAUDE.md`, `README.md` — nothing else.
8. No new files in `public/`. No new npm dependencies. No federation message types.

---

## Common foot-guns to avoid

- **Don't gate DMs or calls.** Only `lobby-chat` and `lobby-encrypted`.
- **Don't break the existing lobby tab toggle on mobile.** The `mob-tab-*` CSS classes drive which middle-panel tab is shown on phones; if you add a tab, also add the corresponding `mob-tab-*` rule and handler.
- **Don't fetch HP / token balance on every lobby post unconditionally.** The `checkLobbyPostGate` short-circuit at the top (if both gates are 0/null, return allowed immediately) is mandatory — without it you add Hive API calls to every chat message even when the gate is disabled.
- **Don't change the `addLobbyMsg` signature.** Just route by `type` to a different container. Many other call sites pass varying argument shapes; adding required params would break them.
- **Don't invent a `lobby-dm` history endpoint per-tab.** Reuse the existing `dm-history` socket call + `dmHistoryLoaded` Set + `renderedDmKeys` Set — they already work.
- **The Hive `get_discussions_by_*` `limit` cap is 20.** You won't hit this in v0.13 (no discovery work) but if you do query it, keep `limit ≤ 20`.
- **Don't add backwards-compat checks for old clients.** v4call ships from one repo; whatever the server emits, the client knows how to handle it because they ship together.

---

## Ship checklist (do this in order)

1. Read `server.js` lines 1–150 (env parsing, config), 390–560 (lobby state + token cache), 1965–2040 (lobby-chat / lobby-encrypted handlers), 1862–1940 (lobby-join + lobby-config emit point).
2. Read `index.html` lines 540–610 (lobby tab structure), 880–950 (mobile nav), 1300–1700 (DM panel, openDmPanel, switchLobbyTab, lobby-rooms handler, addLobbyMsg).
3. Implement Part A (4-tab UI + DM relocation) — no server changes yet, just the tab restructure and `addLobbyMsg` routing.
4. Implement Part B (lobby-config event + client render) — server emits it, client renders the two text blocks.
5. Implement Part C (gate helpers + handler wiring + rejection event).
6. Add Part D env vars to `.env.example`.
7. Run the syntax checks. Test paths manually (or describe the test plan if you can't run a browser).
8. Do Part E doc updates last.
9. Hand back a summary of: files changed, lines added/removed (`git diff --stat`), any deviations from this brief and why, anything that needs human verification (e.g. rendered UI screenshots).

If anything in this brief contradicts what you find in the code, **stop and report the contradiction** before changing the spec — the brief might be out of date.
