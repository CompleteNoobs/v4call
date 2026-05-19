#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────────────────
// nostr-spike.mjs — v4call Nostr Federation, PHASE A (throwaway spike)
//
// PURPOSE
//   Prove the whole Nostr pipe end-to-end BEFORE touching server.js:
//     make a key  →  sign a kind-30078 event  →  publish to a relay  →
//     subscribe   →  see our own event come back.
//   If this works, the protocol + library + relay all work. Then we build
//   Phase B for real. This file is DISPOSABLE — delete after Phase A.
//
// WHAT IS kind 30078?
//   A Nostr "event" is a signed JSON blob. The number "kind" says what type
//   it is. 30078 = NIP-78 "app data, replaceable per d-tag". For v4call it
//   means: "a server announcing itself; newest announce per domain replaces
//   the old one." Same shape as the real design doc.
//
// USAGE
//   node nostr-spike.mjs roundtrip [wss://relay]   ← do this first (default relay works)
//   node nostr-spike.mjs pub       [wss://relay]   ← only publish, print relay replies
//   node nostr-spike.mjs sub       [wss://relay]   ← only listen for v4call-server events
//
//   Default relay = wss://relay.damus.io  (a PUBLIC relay: any key may write,
//   so the spike "just works" on day one and you see the protocol move).
//
//   Then try the GATED relay:
//   node nostr-spike.mjs pub wss://nostr.v4call.com
//   It will REJECT us — that is CORRECT. nGate only lets whitelisted server
//   keys write. Seeing the rejection IS the lesson: the gate is real.
// ───────────────────────────────────────────────────────────────────────────

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';
import { webcrypto } from 'node:crypto';

// Node 18 doesn't expose Web Crypto globally (Node 19+ does). The crypto
// library nostr-tools uses needs it for random key generation. One-line fix.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// Node 18 has no built-in WebSocket. nostr-tools needs one. Hand it the 'ws'
// package. (Node 21+ wouldn't need this line — kept here so it runs anywhere.)
useWebSocketImplementation(WebSocket);

const mode  = (process.argv[2] || 'roundtrip').toLowerCase();
const relay = process.argv[3] || 'wss://relay.damus.io';
const relays = [relay];

// ── Make a throwaway identity ──────────────────────────────────────────────
// In Phase B this becomes the per-server key in data/nostr-key.json. For the
// spike it is fresh every run — we are testing the pipe, not identity.
const sk      = generateSecretKey();          // private key (Uint8Array)
const pkHex   = getPublicKey(sk);             // public key, HEX form
const pkNpub  = npubEncode(pkHex);            // public key, npub form

console.log('── spike identity (throwaway) ──');
console.log('  pubkey hex :', pkHex);
console.log('  pubkey npub:', pkNpub);
console.log('  relay      :', relay);
console.log('  mode       :', mode);
console.log('');

// ── Build the kind-30078 announce event (mirrors the real design shape) ────
function buildEvent() {
  const domain = 'spike.example.com';            // pretend domain for the test
  const unsigned = {
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', domain],                             // replaceable key = domain
      ['t', 'v4call-server'],                    // discovery tag we filter on
      ['protocol', '0.4'],
    ],
    content: JSON.stringify({
      verify_url: `https://${domain}/.well-known/v4call-server.json`,
      hive_account: 'spike-test',
      announced_at: new Date().toISOString(),
      note: 'PHASE A SPIKE — not a real v4call server',
    }),
  };
  return finalizeEvent(unsigned, sk);            // adds id + schnorr signature
}

const pool = new SimplePool();

// ── publish: send the event, print each relay's reply ──────────────────────
async function doPublish() {
  const ev = buildEvent();
  console.log('publishing event id:', ev.id);
  const results = await Promise.allSettled(pool.publish(relays, ev));
  results.forEach((r, i) => {
    // GOTCHA (learned the hard way): nostr-tools pool.publish RESOLVES (does
    // not reject) when the relay is unreachable — it resolves with the STRING
    // "connection failure: ...". A real relay OK also resolves (with "" or a
    // short message). A relay REJECTION (e.g. nGate "blocked") rejects with
    // an Error. So we must inspect the resolved VALUE, not just fulfilled vs
    // rejected — otherwise "relay is down" looks like "relay accepted".
    if (r.status === 'rejected') {
      // Real relay said no. e.g. nGate: "blocked: not on relay whitelist".
      console.log(`  ✗ ${relays[i]} REJECTED by relay: ${r.reason}`);
    } else if (typeof r.value === 'string' && r.value.startsWith('connection failure')) {
      // Relay never answered — down, wrong DNS, no TLS, not built yet.
      console.log(`  … ${relays[i]} UNREACHABLE (relay not answering): ${r.value}`);
    } else {
      // Relay sent OK=true. Genuinely accepted.
      console.log(`  ✓ ${relays[i]} ACCEPTED${r.value ? ' — ' + r.value : ''}`);
    }
  });
  return ev;
}

// ── subscribe: listen for v4call-server announces ──────────────────────────
// Returns a promise that resolves with the set of event ids we saw.
function doSubscribe(stopAfterMs = 8000, wantId = null) {
  return new Promise((resolve) => {
    const seen = new Set();
    console.log('subscribing for kind 30078, t=v4call-server …');
    const sub = pool.subscribeMany(
      relays,
      // nostr-tools v2.23 takes ONE filter object here (older versions took
      // an array). Filter = "only kind 30078 events tagged t=v4call-server,
      // from the last 2 minutes."
      { kinds: [30078], '#t': ['v4call-server'], since: Math.floor(Date.now() / 1000) - 120 },
      {
        onevent(e) {
          seen.add(e.id);
          const mine = wantId && e.id === wantId ? '  ← THIS IS OUR EVENT 🎉' : '';
          console.log(`  ◀ got event ${e.id.slice(0, 12)}… from ${e.pubkey.slice(0, 12)}…${mine}`);
        },
        oneose() { console.log('  (relay sent everything it has stored — now live)'); },
      }
    );
    setTimeout(() => { sub.close(); resolve(seen); }, stopAfterMs);
  });
}

// ── roundtrip: subscribe, then publish, confirm we hear ourselves ──────────
async function doRoundtrip() {
  const seenP = doSubscribe(9000);     // start listening first
  await new Promise(r => setTimeout(r, 1500));   // let the sub settle
  const ev = await doPublish();        // now publish
  const seen = await seenP;            // wait for the listen window to close
  console.log('');
  if (seen.has(ev.id)) {
    console.log('✅ ROUNDTRIP OK — published event came back via subscription.');
    console.log('   The Nostr pipe works. Phase A criterion met.');
  } else {
    console.log('⚠  Did NOT see our own event come back.');
    console.log('   If this relay is GATED (nGate), that is expected: it');
    console.log('   refused our throwaway key, so there was nothing to read.');
    console.log('   Re-run against the default public relay to see a success.');
  }
}

try {
  if (mode === 'pub')            await doPublish();
  else if (mode === 'sub')      await doSubscribe(15000);
  else if (mode === 'roundtrip') await doRoundtrip();
  else { console.log('unknown mode. use: roundtrip | pub | sub'); }
} finally {
  pool.close(relays);
  // give sockets a beat to close, then hard-exit (Nostr sockets linger)
  setTimeout(() => process.exit(0), 500);
}
