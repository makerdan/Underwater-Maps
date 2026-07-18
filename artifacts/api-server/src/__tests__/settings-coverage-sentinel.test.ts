/**
 * settings-coverage-sentinel.test.ts
 *
 * CI gap-detection: asserts that every field in PutSettingsBody has a
 * corresponding entry in SETTINGS_TESTED_FIELDS below.
 *
 * HOW IT WORKS
 * ------------
 * PutSettingsBody.shape is the authoritative list of accepted PUT /api/settings
 * fields (generated from the OpenAPI spec via orval). SETTINGS_TESTED_FIELDS is
 * a manually maintained registry of fields that have at least one test case in
 * the settings test suite.
 *
 * When a developer adds a new field to the OpenAPI spec (and re-runs codegen),
 * PutSettingsBody.shape gains a new key. This test will immediately fail with a
 * message that names the uncovered field and points to where to add the test.
 *
 * WHEN THIS TEST FAILS
 * --------------------
 * 1. Add a test for the flagged field in the appropriate test file:
 *    - v15/v16 overlay / paint / substrate / EFH fields → me.test.ts
 *    - palette / colour-band fields                     → settings-palette.test.ts
 *    - core validation (type errors, enum guards)       → settings-validation.test.ts
 * 2. Add the field name to SETTINGS_TESTED_FIELDS below (with a comment
 *    indicating which file covers it).
 *
 * WHERE EACH FIELD IS TESTED
 * --------------------------
 * me.test.ts                      — v15/v16 overlay, paint, substrate, EFH, font-size fields
 * settings-palette.test.ts        — palette, colour-band, fog, hud fields
 * settings-validation.test.ts     — core schema validation (textureQuality, fogDensity, …)
 */

import { describe, it, expect } from "vitest";
import { PutSettingsBody } from "@workspace/api-zod";

const SETTINGS_TESTED_FIELDS = new Set<string>([
  // ── Core visual quality (settings-validation.test.ts) ────────────────────
  "textureQuality",
  "enableCaustics",
  "particleDensity",
  "lampIntensity",
  "fogDensity",           // also settings-palette.test.ts, me.test.ts (defaults)

  // ── Colour palette (settings-palette.test.ts) ────────────────────────────
  "colormapTheme",
  "paletteShallow",
  "paletteDeep",
  "customStops",
  "bandColors",
  "bandBoundaries",       // also settings-validation.test.ts
  "hudOpacity",

  // ── Camera / controls (settings-validation.test.ts) ──────────────────────
  "defaultSpeedTier",
  "invertMouseY",
  "mouseSensitivity",
  "cameraSpawnBehaviour",

  // ── HUD toggles (settings-validation.test.ts) ────────────────────────────
  "showCrosshairGps",
  "showCameraPosition",
  "showSpeedIndicator",
  "showHeading",
  "showUiTooltips",

  // ── Units & format (settings-validation.test.ts) ─────────────────────────
  "coordinateFormat",
  "depthUnit",
  "units",
  "waterType",

  // ── Overview map (settings-validation.test.ts) ───────────────────────────
  "overviewDefaultZoom",
  "overviewShowGrid",
  "overviewShowMarkers",
  "overviewOpenOnLoad",

  // ── Markers (settings-validation.test.ts) ────────────────────────────────
  "visibleMarkerTypes",
  "showMarkerLabels",
  "privateMarkers",
  "defaultMarkerType",
  "defaultRegion",

  // ── Misc (settings-validation.test.ts) ───────────────────────────────────
  "smoothTerrainSpikes",
  "gpsRecordingInterval",
  "panelCollapse",
  "zoneOverlaySlots",

  // ── v15 overlay toggles (me.test.ts) ─────────────────────────────────────
  "weatherStationsActive",
  "rawsOverlayActive",
  "windOverlayActive",
  "tideOverlayActive",
  "currentOverlayActive",
  "currentDepthLayers",

  // ── v15 side-pane / zone-paint (me.test.ts) ──────────────────────────────
  "sidePaneCollapsed",
  "zonePaintBrushRadius",
  "zoneOverlayEnabled",
  "zonePaintMode",
  "zonePaintSlot",

  // ── v15 substrate (me.test.ts) ───────────────────────────────────────────
  "substrateColorMode",
  "hiddenSubstrateClasses",

  // ── v15 intertidal (me.test.ts) ──────────────────────────────────────────
  "intertidalHotspotsEnabled",
  "intertidalScoreMode",

  // ── v15 EFH overlay (me.test.ts) ─────────────────────────────────────────
  "efhOverlayEnabled",
  "hiddenEfhSpecies",

  // ── v16 accessibility (me.test.ts) ───────────────────────────────────────
  "globalFontSize",

  // ── v17 HYD93 feature filter (me.test.ts) ────────────────────────────────
  "hyd93ActiveFeatureCodes",
  "hyd93FeaturesEnabled",

  // ── v19 fields promoted from extras path (settings-schema-sync.test.ts) ──
  // These fields were previously stored as unvalidated extras; they are now
  // first-class PutSettingsBody fields with Zod validation and server defaults.
  // Schema/default coverage is verified by settings-schema-sync.test.ts.
  "schemaVersion",
  "showAdvancedEverywhere",
  "mouseZoomSensitivity",
  "touchpadZoomSensitivity",
  "pinchZoomSensitivity",
  "joystickMode",
  "showJoystickInOrbit",
  "fieldOfView",
  "renderDistance",
  "lastSession",
  "qualityPreset",
  "terrainExaggeration",
  "enableMarineSnow",
  "fogColor",
  "ambientLightIntensity",
  "directionalLightIntensity",
  "lampRange",
  "antialiasing",
  "showWaterSurface",
  "showLandmass",
  "landmassStyle",
  "satelliteImagery",
  "terrainImagery",
  "showDepthLegend",
  "showDepthScaleBar",
  "showCompassMinimap",
  "showControlsLegend",
  "showTidePanel",
  "showHabitatPanel",
  "showDatasetPanel",
  "showQueryPanel",
  "timeFormat",
  "temperatureUnit",
  "contoursEnabled",
  "contourInterval",
  "defaultDepthPoleColor",
  "markerClusterThreshold",
  "autoLoadTidal",
  "tripMinDurationH",      // settings-validation.test.ts
  "followResumeDelaySec",  // settings-validation.test.ts
  "defaultTidalDepthLayer",
  "currentArrowDensity",
  "layerArrowDensity",
  "windOverlayStyle",
  "tideOverlayStyle",
  "currentOverlayStyle",
  "currentsEnabled",
  "currentsSource",
  "currentsManualDirectionDeg",
  "currentsManualSpeedKt",
  "currentsTidePhase",
  "currentsAutoAdvance",
  "currentsShowParticles",
  "currentsShowArrows",
  "currentsShowStreamlines",
  "autoShowZoneOverlay",
  "defaultHabitatSpecies",
  "habitatOverlayIntensity",
  "habitatOverlayColor",
  "autoStartTrailRecording",
  "defaultTrailColor",
  "trailRetention",
  "autoLoadLastDataset",
  "defaultMapLoad",
  "reducedMotion",
  "colorBlindSafePalette",
  "largeHudText",
  "highContrastHud",
  "brightDaylight",
  "colormapUserSet",
  "telemetryOptIn",
  "llmDisclosureAcknowledged",
  "hasSeenOnboarding",
  "datasetFolderExpanded",
  "bookmarks",
  "keyBindings",
  "crosshairMenuGamepadButton",
  "lastSyncedAt",

  // ── v22 sidebar / timeline / water-temp (settings-schema-sync.test.ts) ───
  // Promoted from the client-only extras path; now first-class validated fields.
  // The schema/default parity is verified by settings-schema-sync.test.ts.
  "showWaterTempLayer",
  "timelineCurrentTime",
  "timelineRange",
  "sidebarMode",

  // ── v23 toolbar-relocation hint (me.test.ts) ──────────────────────────────
  "hasSeenToolbarRelocationHint",
]);

describe("PutSettingsBody field-coverage sentinel", () => {
  it("every PutSettingsBody field has a corresponding test entry in SETTINGS_TESTED_FIELDS", () => {
    const schemaFields = Object.keys(PutSettingsBody.shape) as string[];
    const untested = schemaFields.filter((f) => !SETTINGS_TESTED_FIELDS.has(f));

    expect(untested, [
      "",
      `${untested.length} PutSettingsBody field(s) have no test coverage:`,
      "",
      untested.map((f) => `  • "${f}"`).join("\n"),
      "",
      "To fix:",
      "  1. Add a test for each flagged field in me.test.ts (for overlay/paint/",
      "     substrate/EFH/accessibility fields), settings-palette.test.ts (colour",
      "     fields), or settings-validation.test.ts (core validation).",
      '  2. Add the field name to SETTINGS_TESTED_FIELDS in',
      "     src/__tests__/settings-coverage-sentinel.test.ts.",
      "",
    ].join("\n")).toEqual([]);
  });

  it("SETTINGS_TESTED_FIELDS contains no stale entries absent from PutSettingsBody", () => {
    const schemaFields = new Set(Object.keys(PutSettingsBody.shape) as string[]);
    const stale = [...SETTINGS_TESTED_FIELDS].filter((f) => !schemaFields.has(f));

    expect(stale, [
      "",
      `${stale.length} SETTINGS_TESTED_FIELDS entr${stale.length === 1 ? "y" : "ies"} no longer exist in PutSettingsBody:`,
      "",
      stale.map((f) => `  • "${f}"`).join("\n"),
      "",
      "Remove the stale entries from SETTINGS_TESTED_FIELDS in",
      "src/__tests__/settings-coverage-sentinel.test.ts.",
      "",
    ].join("\n")).toEqual([]);
  });
});
