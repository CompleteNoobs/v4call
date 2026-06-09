# v4call — TODO

## Public `/api/info` endpoint (landing-page integration)

A landing page (`index.html` in this repo, once the live app moves to
`app.html`) needs to display this server's escrow platform fee. There is
no public read endpoint today; the fee lives in `PLATFORM_FEE` (set from
`DEFAULT_PLATFORM_FEE` env var, default 10) and is only emitted as part
of per-user rate resolution.

### What to add

A small public JSON endpoint that returns server-level non-sensitive
config:

```
GET /api/info  ->  200 OK
{
  "server":      "v4call.com",
  "escrow":      "v4call-escrow",
  "platformFee": 0.01,          // fraction, not percent
  "version":     "0.16.13",
  "federation":  { "transport": "wss", "enabled": true }
}
```

- No auth required.
- Set permissive CORS so the landing page can `fetch()` it.
- Document it once it exists so other apps can read it too.

### What changes on the landing page

The page already has a `CONFIG.SERVER_FEE_PERCENT` block (manual override).
Once `/api/info` exists, replace the manual override with a `fetch('/api/info')`
on `DOMContentLoaded` and populate the escrow-fee table cell from
`platformFee * 100`. Fall back to the static test-fed table if the
fetch fails.

Tracked in landing-page work-thread; see GitHub issue (link once filed).
