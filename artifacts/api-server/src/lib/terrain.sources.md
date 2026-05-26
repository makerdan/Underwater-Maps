# Bathymetry source resolver (Task #398)

`buildTerrainGrid` resolves a terrain tile for any AOI by walking a single
**ranked list of bathymetry sources** declared in `terrain.ts`. The first
source that returns a usable grid wins; failures fall through to the next
source. When every ranked source fails the resolver returns `null` and the
caller drops to a synthetic fbm terminal so the viewer always has something
to render.

This replaces the old hard-coded `bundled → NCEI → GEBCO → synthetic`
chain. The chain is still expressed — but now declaratively, in two tables.

## Tables

### `BATHYMETRY_SOURCES` — concrete sources

```ts
export const BATHYMETRY_SOURCES = {
  "bundled-survey":          { scope: "local",    fetch(meta, N) { … } },
  "ncei-bag-mosaic":         { scope: "regional", fetch(meta, N) { … } },
  "ncei-dem-global-mosaic":  { scope: "regional", fetch(meta, N) { … } },
  "gebco":                   { scope: "global",   fetch(meta, N) { … } },
};
```

Each entry declares `{ id, label, scope, dataSource, creditUrl, fetch }`.
The `fetch(meta, N)` contract is the same one the legacy `fetchNceiGrid` /
`fetchGebcoGrid` helpers used: return a `SourceFetchResult` or **throw**
(the resolver catches and falls through). Sources are AOI-agnostic — one
entry serves every dataset that ranks it.

### `DATASET_SOURCE_PRIORITY` — per-AOI ranked list

```ts
export const DATASET_SOURCE_PRIORITY = {
  "thorne-bay":       ["ncei-bag-mosaic", "ncei-dem-global-mosaic", "gebco"],
  "lake-ray-roberts": ["bundled-survey", "gebco"],
  …
};
```

AOIs not listed default to `["gebco"]` (and then synthetic).

## Ranking rubric

Order entries highest priority first using these tie-breakers, in order:

1. **Quality** — native resolution (1–50 m local multibeam beats 8–30 m
   community DEM beats ~400 m global grid), survey recency, and survey
   type (purpose-built hydro survey > integrated DEM mosaic > satellite
   altimetry).
2. **Accessibility** — public WCS / REST / bundled grid, no auth,
   reasonable response time (<60 s for a 256² tile). A source that
   requires a manual download or FOIA request never makes the list.
3. **Scope** — within a quality tier prefer narrower scope
   (`local` > `regional` > `state` > `national` > `global`), because
   local surveys are usually purpose-built for the AOI.

## Adding a new source

1. Add an entry to `BATHYMETRY_SOURCES` with an `id`, human-readable
   `label`, `scope`, `dataSource` (one of the existing
   `TerrainDataSource` values, or extend that union), `creditUrl`, and
   a `fetch(meta, N) -> SourceFetchResult` implementation.
2. Add the new id to every AOI's ranked list in
   `DATASET_SOURCE_PRIORITY`, placing it per the rubric above.
3. Bump `TERRAIN_CACHE_VERSION` and add a one-line history entry so any
   cached tiles get rebuilt with the new chain.
4. Add a unit test in
   `src/lib/__tests__/bathymetrySourceResolver.test.ts` for the new
   source and its placement in at least one AOI's ranked list.

## Adding a new AOI

1. Append the `DatasetMeta` to `PRESET_DATASETS` or
   `FRESHWATER_PRESET_DATASETS`.
2. Add a `DATASET_SOURCE_PRIORITY[<id>]` entry with at least the top 2–3
   candidate sources in ranked order. Omit the entry to default to
   GEBCO-only (saltwater) or synthetic (inland).
3. Bump `TERRAIN_CACHE_VERSION`.

## Back-compat

`NCEI_DATASET_COVERAGES` is still exported (used by `catalogSeeder.ts`
and mirrored client-side by `DatasetPanel.tsx`) but is now derived from
`DATASET_SOURCE_PRIORITY`. New code should use
`getDatasetSourcePriority(id)` instead.
