---
name: ArcGIS/WCS upstream endpoint drift
description: Lessons from the 2026-07 live-download smoke pass — upstream bathymetry services get deleted/moved; how to fix and probe.
---

Upstream bathymetry endpoints drift constantly; treat live smoke failures as endpoint drift first, not code bugs.

**Findings (verified 2026-07):**
- NCEI ArcGIS WCS dropped `aaigrid` (GeoTIFF only; coverage id = service name, not "1"); `bag_mosaic`, `NOAA_Great_Lakes_mosaics`, `NOAA_Coastal_Relief_Model_Southern_Alaska` services deleted. Replacements: `multibeam_mosaic` (coverage `multibeam_mosaic_combined`), `DEM_mosaics/DEM_global_mosaic`, `DEM_mosaics/DEM_all`.
- GEBCO + ETOPO WCS fully broken; temporarily substituted by `DEM_global_mosaic` GeoTIFF (bundles GEBCO base grid).
- 3DEP WCS dropped aaigrid → use `exportImage` REST (format=tiff, pixelType=F32, f=image).
- NYSDEC statewide `DEC_Lake_Bathymetry` FeatureServer org deleted (services6 org lists zero services); only Finger Lakes remains (`ENV_Finger_Lake_Bathymetry`, polygon DEPTH). Lake George has NO ArcGIS source anymore — falls through to 3DEP.
- MN DNR moved from webgis.dnr.state.mn.us (dead host) to `enterprise.gisdata.mn.gov/aghost/.../water_lake_bathymetry/MapServer/0` (lowercase `depth` field, feet).

**Rules learned:**
- Hosted ArcGIS FeatureServer rejects `outFields` naming absent columns ("Cannot perform query. Invalid query parameters.") — always use `outFields=*` and pick depth field client-side.
- Enterprise-hosted layers may be in projected CRS — always pass `inSR=4326&outSR=4326` in query params.
- To find replacement services: `www.arcgis.com/sharing/rest/search?f=json&q=...` and state hub DCAT feeds (e.g. data.gis.ny.gov/api/feed/dcat-us/1.1.json).

**How to apply:** when an arcgis-rest/WCS live test fails with "Invalid URL"/HTTP 400, curl the base `?f=json` first; if the service root itself errors, hunt for the moved service rather than debugging query params.
