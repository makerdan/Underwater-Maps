---
name: PUT /api/settings extra-keys 400
description: Root cause of the palette e2e 400 on PUT /api/settings — not Zod, but MAX_EXTRA_KEYS limit.
---

## Rule
The PUT /api/settings 400 is **not** from Zod validation failure. It is from the extra-keys security guard at the bottom of the same handler (`MAX_EXTRA_KEYS = 32`). The browser's Zustand settingsStore sends the full settings object on every PUT, including 76+ keys that are not in `PutSettingsBody`. These all become "extras" and exceed the 32-key cap.

**Why:** The `PutSettingsBody` OpenAPI/Zod schema has not been updated to include many keys that the client's settingsStore has grown to include (e.g. `hasSeenOnboarding`, `bookmarks`, `keyBindings`, `schemaVersion`, `showCompassMinimap`, and ~70 others). The extra-keys guard was set to 32 expecting a small number of truly unknown legacy keys, not 76 currently-used client-side keys.

**How to apply:** When diagnosing PUT /api/settings 400s, check ALL three 400 branches in the handler — not just the Zod branch:
1. `!parsed.success` → Zod rejection (my logger.warn fires here)
2. `badKey !== undefined` → key fails EXTRA_KEY_RE or is in FORBIDDEN_EXTRA_KEYS
3. `Object.keys(extras).length > MAX_EXTRA_KEYS` → too many extras (this is the current failure)
4. `Buffer.byteLength(...) > MAX_EXTRAS_BYTES` → extras payload too large

Fix options (in priority order):
- **Short-term:** Raise `MAX_EXTRA_KEYS` from 32 to ≥128 in `artifacts/api-server/src/routes/settings.ts`
- **Long-term:** Add the 76 missing keys to the OpenAPI spec and regenerate `PutSettingsBody` so they are no longer "extras"

The 76 extra keys observed (as of this diagnosis):
schemaVersion, showAdvancedEverywhere, mouseZoomSensitivity, touchpadZoomSensitivity, pinchZoomSensitivity, joystickMode, showJoystickInOrbit, fieldOfView, renderDistance, lastSession, qualityPreset, terrainExaggeration, enableMarineSnow, fogColor, ambientLightIntensity, directionalLightIntensity, lampRange, antialiasing, showWaterSurface, showLandmass, landmassStyle, satelliteImagery, terrainImagery, showDepthLegend, showDepthScaleBar, showCompassMinimap, showControlsLegend, showTidePanel, showHabitatPanel, showDatasetPanel, showQueryPanel, timeFormat, temperatureUnit, contoursEnabled, contourInterval, defaultDepthPoleColor, markerClusterThreshold, autoLoadTidal, defaultTidalDepthLayer, currentArrowDensity, layerArrowDensity, windOverlayStyle, tideOverlayStyle, currentOverlayStyle, currentsEnabled, currentsSource, currentsManualDirectionDeg, currentsManualSpeedKt, currentsTidePhase, currentsAutoAdvance, currentsShowParticles, currentsShowArrows, currentsShowStreamlines, autoShowZoneOverlay, defaultHabitatSpecies, habitatOverlayIntensity, habitatOverlayColor, autoStartTrailRecording, defaultTrailColor, trailRetention, autoLoadLastDataset, defaultMapLoad, reducedMotion, colorBlindSafePalette, largeHudText, highContrastHud, brightDaylight, colormapUserSet, telemetryOptIn, llmDisclosureAcknowledged, hasSeenOnboarding, datasetFolderExpanded, bookmarks, keyBindings, crosshairMenuGamepadButton, lastSyncedAt
