---
name: PUT /api/settings extra-keys 400
description: Root cause and fix for the palette e2e 400 on PUT /api/settings — MAX_EXTRA_KEYS limit, not Zod.
---

## Rule
The PUT /api/settings 400 was **not** from Zod validation failure. It was from the extra-keys security guard (`MAX_EXTRA_KEYS`) in the handler. The browser's Zustand settingsStore sends the full settings object on every PUT, including 76+ keys that are not in `PutSettingsBody`. These all become "extras" and exceeded the old 32-key cap.

**Fix applied:** Raised `MAX_EXTRA_KEYS` from 32 to 512 in `artifacts/api-server/src/routes/settings.ts`. All 3 failing e2e tests now pass. The proper long-term fix (add the 76 missing keys to the OpenAPI spec) is tracked in the "Prevent settings sync from silently breaking" task.

**Why:** The `PutSettingsBody` OpenAPI/Zod schema has not been updated to include many keys that the client's settingsStore has grown to include. The extra-keys guard was set to 32 expecting a small number of truly unknown legacy keys, not 76 currently-used client-side keys.

**How to apply:** When diagnosing PUT /api/settings 400s, check ALL three 400 branches in the handler — not just the Zod branch:
1. `!parsed.success` → Zod rejection (logger.warn fires here)
2. `badKey !== undefined` → key fails EXTRA_KEY_RE or is in FORBIDDEN_EXTRA_KEYS
3. `Object.keys(extras).length > MAX_EXTRA_KEYS` → too many extras (was the failure)
4. `Buffer.byteLength(...) > MAX_EXTRAS_BYTES` → extras payload too large

The 76 extra keys observed (as of this diagnosis):
schemaVersion, showAdvancedEverywhere, mouseZoomSensitivity, touchpadZoomSensitivity, pinchZoomSensitivity, joystickMode, showJoystickInOrbit, fieldOfView, renderDistance, lastSession, qualityPreset, terrainExaggeration, enableMarineSnow, fogColor, ambientLightIntensity, directionalLightIntensity, lampRange, antialiasing, showWaterSurface, showLandmass, landmassStyle, satelliteImagery, terrainImagery, showDepthLegend, showDepthScaleBar, showCompassMinimap, showControlsLegend, showTidePanel, showHabitatPanel, showDatasetPanel, showQueryPanel, timeFormat, temperatureUnit, contoursEnabled, contourInterval, defaultDepthPoleColor, markerClusterThreshold, autoLoadTidal, defaultTidalDepthLayer, currentArrowDensity, layerArrowDensity, windOverlayStyle, tideOverlayStyle, currentOverlayStyle, currentsEnabled, currentsSource, currentsManualDirectionDeg, currentsManualSpeedKt, currentsTidePhase, currentsAutoAdvance, currentsShowParticles, currentsShowArrows, currentsShowStreamlines, autoShowZoneOverlay, defaultHabitatSpecies, habitatOverlayIntensity, habitatOverlayColor, autoStartTrailRecording, defaultTrailColor, trailRetention, autoLoadLastDataset, defaultMapLoad, reducedMotion, colorBlindSafePalette, largeHudText, highContrastHud, brightDaylight, colormapUserSet, telemetryOptIn, llmDisclosureAcknowledged, hasSeenOnboarding, datasetFolderExpanded, bookmarks, keyBindings, crosshairMenuGamepadButton, lastSyncedAt
