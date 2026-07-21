---
name: Catalog upstream successor services
description: Mapping of deleted bathymetry services to their live successors, and the fetch-strategy matching gotcha.
---
Verified 2026-07: NCEI bag_mosaic → multibeam_mosaic; old /arcgis/services/DEM_global_mosaic/ → DEM_mosaics/DEM_global_mosaic; S-Alaska CRM → DEM_mosaics/DEM_all; NOAA_Great_Lakes_mosaics → DEM_global_mosaic; 3DEP WCSServer → ImageServer exportImage REST; MN glo MapServer → enterprise.gisdata.mn.gov water_lake_bathymetry (depth in FEET, negative); statewide NYSDEC lake bathymetry → Finger Lakes item (covers only Canadice/Canandaigua/Conesus/Hemlock/Honeoye/Seneca — Lake George & Cayuga fall back to usgs-3dep; no public LG survey exists, only a DEC PDF).

**Why:** upstream ArcGIS/WCS services get deleted or moved without redirects; a dead-host denylist test in catalogSeeder.test.ts guards regressions.

**How to apply:** when changing endpointUrls, the URL-substring rules in catalogFetchStrategy.ts must be updated in lockstep, and the five Great Lakes entries are matched by entry id (they share the DEM_global_mosaic URL). Route suites that vi.mock terrain.js must stub NYSDEC/MN_DNR/BUNDLED exports.
