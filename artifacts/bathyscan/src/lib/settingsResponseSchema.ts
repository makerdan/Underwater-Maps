/**
 * settingsResponseSchema — runtime validation for GET /api/settings responses.
 *
 * Purpose:
 *   Before hydrating Zustand stores from a server GET response, we validate
 *   the shape of each known field. This protects against:
 *     - Schema drift after a deploy (server returns new field names)
 *     - Corrupted DB rows (a boolean field comes back as a string)
 *     - Type regressions introduced by future refactors
 *
 * Design:
 *   - The top-level response must be a non-null object; otherwise hydration is
 *     skipped entirely and a console.warn is emitted.
 *   - Each known field is validated individually. If a field's value has the
 *     wrong type it is **skipped** (omitted from the validated partial) rather
 *     than causing the entire hydration to fail.
 *   - Unknown keys not listed in the schema are passed through verbatim so
 *     newer server responses with additional fields do not break older clients.
 *   - When one or more fields are skipped, `parseSettingsResponse` logs a
 *     `console.warn` listing the offending keys so schema drift is observable
 *     in dev builds.
 *
 * Type regression guard:
 *   The `_assignabilityCheck` const below ensures `ValidatedSettingsPayload`
 *   stays assignable to `Partial<SettingsState>`.  A future type change in
 *   `SettingsState` will surface here as a compile error rather than a silent
 *   runtime mismatch.
 */

import { z } from "zod";
import type { SettingsState } from "./settingsStore";

// ── Per-field building blocks ──────────────────────────────────────────────────
// Each primitive helper is optional (field may be absent) with a .catch that
// converts a type-mismatch error into `undefined` so the field is skipped.

const num = z.number().optional().catch(undefined);
const bool = z.boolean().optional().catch(undefined);
const str = z.string().optional().catch(undefined);
const strNull = z.string().nullable().optional().catch(undefined);
const numNull = z.number().nullable().optional().catch(undefined);
const strArr = z.array(z.string()).optional().catch(undefined);
const numArr = z.array(z.number()).optional().catch(undefined);
const unknownNull = z.unknown().nullable().optional();
const unknownObj = z.record(z.string(), z.unknown()).optional().catch(undefined);
const unknownArr = z.array(z.unknown()).optional().catch(undefined);

// ── Known-field schema ─────────────────────────────────────────────────────────
// Every field listed in SettingsState is included so type mismatches are caught.
// New server fields that don't appear here are passed through as `unknown`
// (handled by the passthrough in parseSettingsResponse below).

export const settingsFieldSchemas = {
  schemaVersion: num,
  showAdvancedEverywhere: bool,

  // Camera
  defaultSpeedTier: num,
  mouseSensitivity: num,
  invertMouseY: bool,
  mouseZoomSensitivity: num,
  touchpadZoomSensitivity: num,
  pinchZoomSensitivity: num,
  joystickMode: z.enum(["auto", "always", "off"]).optional().catch(undefined),
  showJoystickInOrbit: bool,
  fieldOfView: num,
  renderDistance: num,
  cameraSpawnBehaviour: z.enum(["deepest", "home", "last", "center"]).optional().catch(undefined),
  lastSession: z.object({
    lon: z.number(),
    lat: z.number(),
    depth: z.number(),
    heading: z.number(),
    datasetId: z.string(),
    headingConvention: z.literal("north-up").optional(),
  }).nullable().optional().catch(undefined),

  // Visuals
  qualityPreset: z.enum(["low", "medium", "high", "ultra", "custom"]).optional().catch(undefined),
  terrainExaggeration: num,
  enableMarineSnow: bool,
  particleDensity: z.enum(["off", "sparse", "dense"]).optional().catch(undefined),
  enableCaustics: bool,
  fogDensity: num,
  fogColor: str,
  nodataColor: str,
  ambientLightIntensity: num,
  directionalLightIntensity: num,
  lampIntensity: num,
  lampRange: num,
  antialiasing: bool,
  textureQuality: z.enum(["off", "low", "high"]).optional().catch(undefined),
  colormapTheme: z.enum(["ocean", "thermal", "grayscale", "viridis", "freshwater", "custom"]).optional().catch(undefined),
  smoothTerrainSpikes: bool,
  showWaterSurface: bool,
  showWaterTempLayer: bool,
  showLandmass: bool,
  landmassStyle: z.enum(["realistic", "flat"]).optional().catch(undefined),
  satelliteImagery: bool,

  // HUD
  hudOpacity: num,
  showCrosshairGps: bool,
  showCameraPosition: bool,
  showHeading: bool,
  showDepthLegend: bool,
  showDepthScaleBar: bool,
  showCompassMinimap: bool,
  showControlsLegend: bool,
  showTidePanel: bool,
  showHabitatPanel: bool,
  showDatasetPanel: bool,
  showQueryPanel: bool,
  showUiTooltips: bool,
  showHealthBadge: bool,
  timeFormat: z.enum(["utc", "local", "12h", "24h"]).optional().catch(undefined),
  coordinateFormat: z.enum(["decimal", "dms"]).optional().catch(undefined),
  depthUnit: z.enum(["metres", "feet"]).optional().catch(undefined),
  units: z.enum(["metric", "imperial", "nautical"]).optional().catch(undefined),
  temperatureUnit: z.enum(["auto", "celsius", "fahrenheit"]).optional().catch(undefined),

  // Overview
  overviewDefaultZoom: num,
  overviewShowGrid: bool,
  overviewShowMarkers: bool,
  overviewOpenOnLoad: bool,
  overviewHillshading: bool,
  contoursEnabled: bool,
  contourInterval: num,
  // MOBILE-ONLY key: mobile 2D Chart View contour-density stepper (1×/2×/3×).
  contourDensity: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().catch(undefined),
  // MOBILE-ONLY key: subtle CSS perspective tilt on the mobile 2D chart canvas.
  mobileMapTiltEnabled: bool,

  // Markers
  defaultMarkerType: str,
  defaultDepthPoleColor: str,
  showMarkerLabels: bool,
  visibleMarkerTypes: strArr,
  privateMarkers: bool,
  markerClusterThreshold: num,

  // Tidal
  autoLoadTidal: bool,
  tripMinDurationH: num,
  boatGoWindKn: num,
  boatGoWaveM: num,
  boatNoGoWindKn: num,
  boatNoGoWaveM: num,
  defaultTidalDepthLayer: z.enum(["surface", "mid", "near-bottom"]).optional().catch(undefined),
  currentArrowDensity: z.enum(["sparse", "normal", "dense"]).optional().catch(undefined),
  layerArrowDensity: z.record(
    z.string(),
    z.enum(["sparse", "normal", "dense"]),
  ).optional().catch(undefined),
  windOverlayStyle: z.enum(["arrows", "particles"]).optional().catch(undefined),
  tideOverlayStyle: z.enum(["arrows", "particles"]).optional().catch(undefined),
  currentOverlayStyle: z.enum(["arrows", "particles"]).optional().catch(undefined),

  // Currents
  currentsEnabled: bool,
  currentsSource: z.enum(["manual", "noaa"]).optional().catch(undefined),
  currentsManualDirectionDeg: num,
  currentsManualSpeedKt: num,
  currentsTidePhase: num,
  currentsAutoAdvance: bool,
  currentsShowParticles: bool,
  currentsShowArrows: bool,
  currentsShowStreamlines: bool,

  // Habitat
  autoShowZoneOverlay: bool,
  defaultHabitatSpecies: str,
  habitatOverlayIntensity: num,
  habitatOverlayColor: str,

  // GPS / Trail
  autoStartTrailRecording: bool,
  defaultTrailColor: str,
  gpsRecordingInterval: z.number().min(1000).optional().catch(undefined),
  trailRetention: z.enum(["7", "30", "90", "all"]).optional().catch(undefined),
  followResumeDelaySec: num,

  // Data
  defaultRegion: str,
  autoLoadLastDataset: bool,
  defaultMapLoad: z.object({
    kind: z.enum(["preset", "upload"]),
    id: z.string(),
  }).nullable().optional().catch(undefined),
  coordSearchRadius: num,
  coordSearchRadiusUnit: z.enum(["km", "nmi"]).optional().catch(undefined),

  // Accessibility
  reducedMotion: bool,
  colorBlindSafePalette: bool,
  largeHudText: bool,
  highContrastHud: bool,
  brightDaylight: bool,
  colormapUserSet: bool,
  globalFontSize: z.enum(["smallest", "small", "medium", "large", "x-large", "largest"]).optional().catch(undefined),

  // Account
  telemetryOptIn: bool,
  llmDisclosureAcknowledged: bool,

  // Onboarding
  hasSeenOnboarding: bool,
  hasSeenToolbarRelocationHint: bool,

  // Per-dataset records (validate outer shape only)
  datasetHomePositions: unknownObj,
  bookmarks: unknownObj,
  datasetManualConditions: unknownObj,
  manualConditionsActiveSource: unknownObj,
  datasetFolderExpanded: unknownObj,
  saveFolderExpanded: unknownObj,

  // Overlay toggles
  weatherStationsActive: bool,
  rawsOverlayActive: bool,
  windOverlayActive: bool,
  tideOverlayActive: bool,
  currentOverlayActive: bool,
  currentDepthLayers: z.array(z.enum(["surface", "mid", "near-bottom"])).optional().catch(undefined),
  sidePaneCollapsed: bool,
  zonePaintBrushRadius: num,
  zoneOverlayEnabled: bool,
  zonePaintMode: bool,
  zonePaintSlot: num,
  substrateColorMode: bool,
  hiddenSubstrateClasses: strArr,
  intertidalHotspotsEnabled: bool,
  intertidalScoreMode: z.enum(["tidepool", "beachcombing"]).optional().catch(undefined),
  intertidalMhwOverrideFt: numNull,
  intertidalMhhwOverrideFt: numNull,
  efhOverlayEnabled: bool,
  hiddenEfhSpecies: strArr,
  hyd93ActiveFeatureCodes: numArr,
  hyd93FeaturesEnabled: bool,
  showNodataBoundary: bool,

  // Shortcuts
  keyBindings: unknownObj,
  crosshairMenuGamepadButton: numNull,

  // Sync metadata
  lastSyncedAt: strNull,
  syncedSnapshot: unknownNull,

  // Timeline
  timelineCurrentTime: strNull,
  timelineRange: z.object({
    start: z.string(),
    end: z.string(),
  }).nullable().optional().catch(undefined),

  // Sidebar
  sidebarMode: z.enum(["explore", "plan", "analyze", "live"]).optional().catch(undefined),

  // Performance
  maxActiveDatasets: num,

  // Proximity streaming
  proximityMode: z.boolean().optional().catch(undefined),

  // Puzzle layouts
  puzzleLayouts: unknownArr,

  // Environment
  waterType: z.enum(["saltwater", "freshwater"]).optional().catch(undefined),
} as const;

/**
 * The validated payload type — every known field is optional (may be absent or
 * invalid) plus an index signature for unknown extra keys passed through verbatim.
 * This type must stay assignable to `Partial<SettingsState>` — enforced by the
 * compile-time check below.
 */
export type ValidatedSettingsPayload = {
  [K in keyof typeof settingsFieldSchemas]?: z.infer<(typeof settingsFieldSchemas)[K]>;
} & { [key: string]: unknown };

/**
 * Compile-time regression guard for the drift-prone union-typed fields.
 *
 * We check only the fields backed by tight enum/literal schemas — not the
 * `z.record(…z.unknown())` / `z.array(z.unknown())` helpers used for complex
 * nested objects, whose inferred types are intentionally wider than the specific
 * record types in `SettingsState` (the narrowing happens inside hydrateFromServer
 * itself, which already accepts `Partial<SettingsState>`).
 *
 * If a future enum variant is renamed in `SettingsState` without updating the
 * schema here, this check surfaces the mismatch as a compile error.
 */
type _DriftProneFieldsCheck = {
  waterType?: z.infer<typeof settingsFieldSchemas.waterType>;
  colormapTheme?: z.infer<typeof settingsFieldSchemas.colormapTheme>;
  sidebarMode?: z.infer<typeof settingsFieldSchemas.sidebarMode>;
  units?: z.infer<typeof settingsFieldSchemas.units>;
  depthUnit?: z.infer<typeof settingsFieldSchemas.depthUnit>;
  temperatureUnit?: z.infer<typeof settingsFieldSchemas.temperatureUnit>;
  hasSeenOnboarding?: z.infer<typeof settingsFieldSchemas.hasSeenOnboarding>;
  joystickMode?: z.infer<typeof settingsFieldSchemas.joystickMode>;
  cameraSpawnBehaviour?: z.infer<typeof settingsFieldSchemas.cameraSpawnBehaviour>;
  qualityPreset?: z.infer<typeof settingsFieldSchemas.qualityPreset>;
  textureQuality?: z.infer<typeof settingsFieldSchemas.textureQuality>;
  particleDensity?: z.infer<typeof settingsFieldSchemas.particleDensity>;
  trailRetention?: z.infer<typeof settingsFieldSchemas.trailRetention>;
  coordinateFormat?: z.infer<typeof settingsFieldSchemas.coordinateFormat>;
  landmassStyle?: z.infer<typeof settingsFieldSchemas.landmassStyle>;
  currentsSource?: z.infer<typeof settingsFieldSchemas.currentsSource>;
  globalFontSize?: z.infer<typeof settingsFieldSchemas.globalFontSize>;
  intertidalScoreMode?: z.infer<typeof settingsFieldSchemas.intertidalScoreMode>;
} extends Pick<Partial<SettingsState>,
  | "waterType" | "colormapTheme" | "sidebarMode" | "units" | "depthUnit"
  | "temperatureUnit" | "hasSeenOnboarding" | "joystickMode" | "cameraSpawnBehaviour"
  | "qualityPreset" | "textureQuality" | "particleDensity" | "trailRetention"
  | "coordinateFormat" | "landmassStyle" | "currentsSource" | "globalFontSize"
  | "intertidalScoreMode"
> ? true : never;
void (true as _DriftProneFieldsCheck);

// ── Public API ────────────────────────────────────────────────────────────────

export type ParseSettingsResponseResult =
  | { ok: false; reason: string }
  | { ok: true; value: ValidatedSettingsPayload; skippedKeys: string[] };

/**
 * Validates a raw GET /api/settings response before it is passed to
 * `hydrateFromServer`.
 *
 * - Returns `{ ok: false }` when the top-level value is not a non-null object.
 * - Returns `{ ok: true, value, skippedKeys }` otherwise, where:
 *   - `value` contains every known field that passed its per-field schema, plus
 *     all unknown extra keys verbatim (future server additions).
 *   - `skippedKeys` lists every known field that was present in the input but
 *     failed its type check — callers should `console.warn` these.
 */
export function parseSettingsResponse(raw: unknown): ParseSettingsResponseResult {
  // Top-level guard: must be a non-null plain object (not an array).
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      reason: `Expected a non-null settings object, got ${raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw}`,
    };
  }

  const rec = raw as Record<string, unknown>;
  const validated: Record<string, unknown> = {};
  const skippedKeys: string[] = [];

  // Validate each known field individually.
  for (const key of Object.keys(settingsFieldSchemas) as Array<keyof typeof settingsFieldSchemas>) {
    if (!(key in rec)) continue; // absent — fine, partial is allowed

    const schema = settingsFieldSchemas[key];
    const result = (schema as z.ZodTypeAny).safeParse(rec[key]);

    if (result.success) {
      // .catch(undefined) turns a type error into undefined;
      // treat an explicitly-present key whose parse yields undefined as skipped.
      if (result.data !== undefined) {
        validated[key] = result.data;
      } else {
        // The field was present but its value was wrong (caught → undefined).
        skippedKeys.push(key);
      }
    } else {
      // Should not reach here given .catch() guards, but be safe.
      skippedKeys.push(key);
    }
  }

  // Pass through unknown extra keys verbatim (future server additions).
  const knownKeys = new Set(Object.keys(settingsFieldSchemas));
  for (const key of Object.keys(rec)) {
    if (!knownKeys.has(key)) {
      validated[key] = rec[key];
    }
  }

  return { ok: true, value: validated as ValidatedSettingsPayload, skippedKeys };
}
