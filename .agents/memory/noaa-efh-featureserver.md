---
name: NOAA Alaska EFH FeatureServer
description: Confirmed ArcGIS org, service URLs, and layer structure for NOAA Alaska EFH data backing the BathyScan efhFetcher.
---

## Confirmed NOAA ArcGIS details (verified 2026-05-26)

- **ArcGIS org**: `C8EMgrsFcRFL6LrL` (NOT `C8EMgrsFjeySN5NN`)
- **Owner**: `ammon.bailey_noaa`
- **Portal**: `https://noaa.maps.arcgis.com`
- **EFH Mapper app item**: `66d51e1a1c34468bb766f6ec1b6f58d9`

## Primary FeatureServer (used by BathyScan)

`https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/GulfOfAlaska/FeatureServer`

- **153 layers**, IDs 1–153, one per species + life-stage + season combination
- **Layer name format**: `_GOA_{Species}_{LifeStage}_{Season}_EFH_Level{1|2}`
- **Feature fields**: `OBJECTID`, `Id`, `EFH_NAME`, `Link`, `Shape__Area`, `Shape__Length`
- Species identity is **only** in the layer name, NOT in feature properties
- `maxRecordCount` = 1000; pagination via `resultOffset` required for large layers
- GeoJSON query format: `.../FeatureServer/{layerId}/query?where=1%3D1&outFields=EFH_NAME%2CLink&returnGeometry=true&resultRecordCount=1000&f=geojson`
- Reachable from Replit container via curl/fetch (confirmed working)

## Key layer IDs for BathyScan catalog entries

| Species | Common Name | Layer IDs |
|---------|-------------|-----------|
| hippoglossus_stenolepis | Pacific Halibut | 56 (adult summer), 57 (juvenile summer) |
| gadus_macrocephalus | Pacific Cod | 79–84 (all life stages/seasons) |
| sebastes_ruberrimus | Yelloweye Rockfish | 147–150 |
| sebastes_alutus | Pacific Ocean Perch | 85–90 |
| sebastes_aleutianus | Rougheye Rockfish | 107–111 |
| sebastes_variabilis | Dusky Rockfish | 41–45 |
| sebastes_melanops | Black Rockfish | 30 |
| sebastes_maliger | Quillback Rockfish | 92 |
| atheresthes_stomias | Arrowtooth Flounder | 14–19 (adults fall/spring/summer/winter, juveniles, larvae) |
| anoplopoma_fimbria | Sablefish | 112–117 (adults fall/spring/summer/winter, juveniles, larvae) |
| gadus_chalcogrammus | Walleye Pollock | 135–141 (adults fall/spring/summer/winter, eggs, juveniles, larvae) |

## Data geometry notes

- Raw features are often a single MultiPolygon with hundreds of parts (layer 79 / Pacific cod fall has 475 parts)
- The fetcher expands each MultiPolygon to one EfhFeature per polygon part to preserve full coverage
- Coordinates are WGS84 lon/lat (even though the service declares spatialReference wkid 102100, the GeoJSON output is re-projected to 4326 automatically)

## Other regional EFH services (same org, not currently used)

- `EasternBeringSea`: bbox [-179.6, 54.2, -157.9, 65.5]
- `AleutianIslandEFH`: bbox [-180, 51.1, 180, 54.5]
- `SalmonEFH`: pan-Alaska salmon EFH
- `ArcticEFHgroup`: Arctic species

**Why:** Previous sessions used wrong org ID (C8EMgrsFjeySN5NN) causing HTTP 400/403 errors. The correct org is C8EMgrsFcRFL6LrL, confirmed from ArcGIS item metadata for the official Alaska EFH Mapper app.

**How to apply:** Any future work touching NOAA EFH endpoints must use C8EMgrsFcRFL6LrL and the GulfOfAlaska FeatureServer. Species metadata must be injected from the layer spec table — it is NOT available in feature properties.
