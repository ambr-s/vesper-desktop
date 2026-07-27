# Vesper config service

This Cloudflare Worker serves per-account Vesper configuration from:

```text
GET https://vsp.asy.st/config/{sha256(lowercase ACI)}
```

The raw ACI never leaves the client. A successful response has this shape:

```json
{
  "schemaVersion": 1,
  "developerAciHashes": ["64-character lowercase SHA-256 digest"],
  "flagOverrides": [{ "name": "vesper.example", "value": true }]
}
```

Unknown account hashes return the same response with an empty
`flagOverrides` list. Responses are private and non-cacheable; Cloudflare KV
provides a 60-second edge cache for the two backing reads.

Desktop and Android both cache the complete last valid response locally. They
restore it without network access during startup, then refresh in the
background with `If-None-Match`. Internal users refresh on every app start;
other users refresh after a successful fetch is at least 24 hours old. A failed
or invalid refresh leaves the last valid cache intact and never blocks startup.
Neither client bundles a developer hash list or any other badge fallback.

The same Worker serves Vesper's hCaptcha handoff pages for desktop and Android:

```text
GET https://vsp.asy.st/captcha/registration/generate.html
GET https://vsp.asy.st/captcha/challenge/generate.html
```

Desktop uses the default `vespercaptcha` callback. Android appends
`?scheme=signalcaptcha` because its in-app WebView intercepts Signal's internal
captcha callback before it reaches the operating system. Callback schemes are
allowlisted; arbitrary query-string schemes are ignored.

## Storage

The `CONFIG` KV namespace uses:

- `developers`: JSON array of developer ACI hashes.
- `overrides:{ACI hash}`: JSON object mapping flag names to boolean, finite
  number, string, or null values.
No public mutation endpoint exists. Manage production values with Wrangler:

```sh
developers_json="$(
  npm run --silent developers-json -- \
    00000000-0000-0000-0000-000000000000
)"
npx wrangler kv key put developers "$developers_json" \
  --binding CONFIG \
  --remote

npx wrangler kv key put \
  "overrides:$(npm run --silent hash-aci -- \
    00000000-0000-0000-0000-000000000000)" \
  '{"vesper.example":true}' \
  --binding CONFIG \
  --remote
```

Run `npm install`, `npm run check`, and `npm run deploy` from this directory.
The checked-in Wrangler configuration owns the `vsp.asy.st` custom domain.
