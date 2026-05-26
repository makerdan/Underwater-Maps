# NOAA NCEI High-Resolution DEMs for Southeast Alaska

This document evaluates NOAA NCEI Digital Elevation Models (DEMs) for the
Southeast Alaska panhandle and records which ones BathyScan ingests as
preferred sources for preset datasets. The goal is to replace the GEBCO
2024 fallback (~450 m grid) in SE Alaska fjords and channels with much
sharper survey-derived bathymetry wherever it exists.

Last surveyed: 2026-05.

## Vertical datum

All NCEI bathy/topo composites used here are reported as **elevation in
metres**, positive up, with land > 0 and seafloor < 0. The vertical datum
is typically **MHW (topo)** + **MLLW (bathy)** as compiled by NCEI's
"merged bathy/topo" workflow.

For BathyScan's `TerrainGrid` contract (positive-down depths, positive
elevations for topography), we use the existing sign-flip — `depth = -elev`
when `elev < 0`, `elevation = elev` when `elev > 0`, and `nodata` cells go
to `depth = 0`.

MLLW vs. MSL differs by < 2 m across SE Alaska, which is well below the
visible vertical resolution of our 3D viewer; we treat the two as
equivalent and do **not** apply a per-source datum shift. If a future
source uses NAVD88 only, the offset will be added at fetch time.

## Candidate sources

| Source | Native res. | Coverage | Endpoint | Recommendation |
|---|---|---|---|---|
| **NCEI BAG Mosaic** (multibeam composite) | 1–50 m where surveyed | Inside Passage, surveyed corridors | `gis.ngdc.noaa.gov/.../bag_mosaic/ImageServer/WCSServer` | **Ingest** — primary high-res source for Thorne Bay, Ketchikan, Sitka, Juneau approaches |
| **NCEI DEM Global Mosaic** (best-available, integrates community DEMs) | 8–90 m | Global; high-res over US coastal DEMs incl. SE AK communities | `gis.ngdc.noaa.gov/.../DEM_global_mosaic/ImageServer/WCSServer` | **Ingest** — secondary fallback after BAG; gives ~24 m over Glacier Bay / Icy Strait community DEMs |
| **Juneau, AK 1/3 arc-second DEM** | ~10 m | Juneau / Stephens Passage / Lynn Canal approaches | NCEI THREDDS / community DEM | Covered via DEM Global Mosaic (do not duplicate) |
| **Sitka, AK 8/15 arc-second DEM** | ~16 m | Sitka Sound + Baranof outer coast | NCEI THREDDS / community DEM | Covered via DEM Global Mosaic |
| **Ketchikan, AK 8/15 arc-second DEM** | ~16 m | Tongass Narrows, Revillagigedo Channel | NCEI THREDDS / community DEM | Covered via DEM Global Mosaic |
| **Craig, AK 1/3 arc-second DEM** | ~10 m | Klawock / Craig / west Prince of Wales | NCEI THREDDS / community DEM | Covered via DEM Global Mosaic — add Craig preset |
| **Skagway, AK 1/3 arc-second DEM** | ~10 m | upper Lynn Canal / Skagway / Haines | NCEI THREDDS / community DEM | Covered via DEM Global Mosaic — add Skagway preset |
| **Wrangell / Petersburg DEM area** | ~16–30 m | central Inside Passage, Wrangell Narrows | NCEI THREDDS / community DEM | Covered via DEM Global Mosaic — add Wrangell–Petersburg preset |
| **Yakutat 1/3 arc-second DEM** | ~10 m | Yakutat Bay, outer Gulf of Alaska | NCEI THREDDS / community DEM | **Skip** for now — outside Inside Passage focus |
| **SE Alaska Coastal Relief Model** | ~90 m | Whole panhandle | NCEI THREDDS | **Skip** — DEM Global Mosaic is finer where it overlaps; not worth a separate fetch path |
| **Statewide ARDEM** | ~450 m | All of Alaska | NCEI / OSU | **Out of scope** (separate task) |

## Implementation notes

- The `fetchNceiGrid()` helper now accepts a **coverage spec** (URL +
  coverage layer) instead of being hard-coded to the BAG Mosaic. Two
  endpoints are wired up: `bagMosaic` and `demGlobalMosaic`.
- `NCEI_DATASET_COVERAGES` maps each SE Alaska preset to an ordered list
  of coverages to try; if every NCEI attempt fails or returns no data,
  the fetcher falls through to GEBCO and finally to the synthetic fbm
  fallback — same behaviour as before for Thorne Bay.
- New presets added: **Craig**, **Wrangell–Petersburg**, **Skagway**.
- Existing SE AK presets (Thorne Bay, Glacier Bay, Icy Strait, Sitka
  Sound, Juneau Approaches, Ketchikan) are flagged as NCEI-preferred so
  they get the high-res path before GEBCO.
- Catalog rows reflect the new endpoints with NOAA/NCEI attribution.
