---
name: NCEI geoportal response format
description: NCEI Geoportal search API wire-format quirks — f=json vs default ES format, envelope_geo bbox field
---

The NCEI Geoportal search endpoint (`/metadata/geoportal/rest/metadata/search`) returns two different shapes:

- **No `f` param (or Accept: application/json)** → raw Elasticsearch wire format: `{ hits: { hits: [{ _id, _source }] } }`. This is what our proxy parses.
- **`f=json`** → atom-style shape `{ start, num, total, results: [...] }` — NOT parseable by our normalizer. Passing `f=json` silently yields `[]` results.

**Why:** The proxy originally sent `f=json` and expected ES format; upstream now maps `f=json` to the atom shape, so every search returned empty with HTTP 200 — no error anywhere.

Also: in the current (2026) index schema, `_source` no longer has `extent.spatial.bbox` or `bbox`; the spatial extent lives in `envelope_geo: [{ type: "envelope", coordinates: [[minLon, maxLat], [maxLon, minLat]] }]` (upper-left, lower-right), and the abstract is in `description` rather than `abstract`. `normalizeNceiHit` handles all variants.

**How to apply:** If NCEI search suddenly returns empty arrays with 200s, curl the upstream directly and diff the response keys against what the normalizer expects before assuming a bbox/keyword issue.
