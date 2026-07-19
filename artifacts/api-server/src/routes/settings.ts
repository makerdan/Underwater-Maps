import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, userSettingsTable } from "@workspace/db";
import { GetSettingsResponse, PutSettingsBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { logger } from "../lib/logger.js";
import { sanitizeZodIssue } from "../middlewares/validateBody.js";

const router = Router();

export const DEFAULT_SETTINGS = {
  panelCollapse: {} as Record<string, boolean>,
  textureQuality: "high",
  enableCaustics: false,
  particleDensity: "sparse",
  fogDensity: 0.012,
  colormapTheme: "ocean",
  lampIntensity: 2,
  defaultSpeedTier: 2,
  invertMouseY: false,
  mouseSensitivity: 1.0,
  cameraSpawnBehaviour: "deepest",
  showCrosshairGps: true,
  showCameraPosition: true,
  showSpeedIndicator: true,
  showHeading: true,
  coordinateFormat: "decimal",
  depthUnit: "metres",
  units: "metric",
  hudOpacity: 0.75,
  overviewDefaultZoom: 1.0,
  overviewShowGrid: true,
  overviewShowMarkers: true,
  overviewOpenOnLoad: false,
  visibleMarkerTypes: ["fish", "shipwreck", "coral", "vent", "custom"],
  showMarkerLabels: true,
  smoothTerrainSpikes: true,
  privateMarkers: false,
  defaultMarkerType: "fish",
  defaultRegion: "",
  gpsRecordingInterval: 10000,
  waterType: "saltwater",
  showUiTooltips: true,
  zoneOverlaySlots: {
    saltwater: [
      { color: "#f5d58a", visible: true },
      { color: "#c49a6c", visible: true },
      { color: "#8ab4d0", visible: true },
      { color: "#b06060", visible: true },
    ],
    freshwater: [
      { color: "#f5d58a", visible: true },
      { color: "#c49a6c", visible: true },
      { color: "#8ab4d0", visible: true },
      { color: "#b06060", visible: true },
    ],
  },
  weatherStationsActive: false,
  rawsOverlayActive: false,
  windOverlayActive: false,
  tideOverlayActive: false,
  currentOverlayActive: false,
  currentDepthLayers: ["mid"],
  sidePaneCollapsed: false,
  zonePaintBrushRadius: 4,
  zoneOverlayEnabled: false,
  zonePaintMode: false,
  zonePaintSlot: 0,
  substrateColorMode: false,
  hiddenSubstrateClasses: [] as string[],
  intertidalHotspotsEnabled: false,
  intertidalScoreMode: "tidepool",
  efhOverlayEnabled: false,
  hiddenEfhSpecies: [] as string[],
  hyd93ActiveFeatureCodes: [89, 103, 146, 530, 988] as number[],
  hyd93FeaturesEnabled: false,
  globalFontSize: "medium",
  paletteShallow: "#00e5ff",
  paletteDeep: "#283593",
  customStops: [
    { position: 0.0, hex: "#00e5ff" },
    { position: 0.3, hex: "#0d47a1" },
    { position: 0.65, hex: "#1a237e" },
    { position: 1.0, hex: "#283593" },
  ],
  bandColors: [
    "#00e5ff",
    "#00c8de",
    "#00a8d0",
    "#0288d1",
    "#0277bd",
    "#1565c0",
    "#0d47a1",
    "#1a237e",
    "#283593",
    "#1e2b6e",
  ],
  bandBoundaries: [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000],

  // ── Newly promoted from extras path (previously validated client-side only) ──
  schemaVersion: 19,
  showAdvancedEverywhere: false,
  mouseZoomSensitivity: 1.0,
  touchpadZoomSensitivity: 1.0,
  pinchZoomSensitivity: 1.0,
  joystickMode: "auto",
  showJoystickInOrbit: false,
  fieldOfView: 45,
  renderDistance: 400,
  lastSession: null as null,
  qualityPreset: "medium",
  terrainExaggeration: 1,
  enableMarineSnow: true,
  fogColor: "#020818",
  ambientLightIntensity: 0.05,
  directionalLightIntensity: 0.35,
  lampRange: 40,
  antialiasing: true,
  showWaterSurface: true,
  showLandmass: false,
  landmassStyle: "realistic",
  satelliteImagery: true,
  terrainImagery: false,
  showDepthLegend: true,
  showDepthScaleBar: true,
  showCompassMinimap: true,
  showControlsLegend: true,
  showTidePanel: true,
  showHabitatPanel: true,
  showDatasetPanel: true,
  showQueryPanel: true,
  timeFormat: "local",
  temperatureUnit: "auto",
  contoursEnabled: true,
  contourInterval: 10,
  defaultDepthPoleColor: "#22d3ee",
  markerClusterThreshold: 25,
  autoLoadTidal: false,
  tripMinDurationH: 0,
  boatGoWindKn: 12,
  boatGoWaveM: 0.8,
  boatNoGoWindKn: 22,
  boatNoGoWaveM: 1.5,
  defaultTidalDepthLayer: "surface",
  currentArrowDensity: "normal",
  layerArrowDensity: { surface: "normal", mid: "normal", "near-bottom": "normal" } as Record<string, string>,
  windOverlayStyle: "arrows",
  tideOverlayStyle: "arrows",
  currentOverlayStyle: "arrows",
  currentsEnabled: false,
  currentsSource: "noaa",
  currentsManualDirectionDeg: 90,
  currentsManualSpeedKt: 0.8,
  currentsTidePhase: 0,
  currentsAutoAdvance: false,
  currentsShowParticles: true,
  currentsShowArrows: true,
  currentsShowStreamlines: false,
  autoShowZoneOverlay: false,
  defaultHabitatSpecies: "",
  habitatOverlayIntensity: 0.4,
  habitatOverlayColor: "#ff9919",
  autoStartTrailRecording: false,
  defaultTrailColor: "#ff6600",
  trailRetention: "30",
  followResumeDelaySec: 20,
  autoLoadLastDataset: true,
  defaultMapLoad: null as null,
  reducedMotion: false,
  colorBlindSafePalette: false,
  largeHudText: false,
  highContrastHud: false,
  brightDaylight: false,
  colormapUserSet: false,
  telemetryOptIn: false,
  llmDisclosureAcknowledged: false,
  hasSeenOnboarding: false,
  hasSeenToolbarRelocationHint: false,
  datasetFolderExpanded: {} as Record<string, boolean>,
  bookmarks: {} as Record<string, unknown[]>,
  keyBindings: {} as Record<string, string>,
  crosshairMenuGamepadButton: 3 as number | null,
  lastSyncedAt: null as string | null,
  showWaterTempLayer: false,
  timelineCurrentTime: null as string | null,
  timelineRange: null as { start: string; end: string } | null,
  sidebarMode: "explore" as "explore" | "plan" | "analyze" | "live",
};

/**
 * Stored settings may include extra fields (advanced sections, accessibility,
 * etc.) that aren't in the strict zod schema. We merge stored extras with the
 * validated known fields when responding.
 */
function mergeForResponse(
  stored: Record<string, unknown> | null | undefined,
  validated: object,
): Record<string, unknown> {
  // Include any stored field that is not already present in the validated
  // schema response. This covers both fields that are completely outside the
  // spec (e.g. showCompassMinimap) AND fields that live in DEFAULT_SETTINGS
  // but were added after the OpenAPI spec was last regenerated and therefore
  // aren't yet part of GetSettingsResponse (e.g. weatherStationsActive,
  // efhOverlayEnabled, globalFontSize, …). Both categories deserve to be
  // passed through so the frontend can hydrate them correctly.
  const extras: Record<string, unknown> = {};
  if (stored) {
    for (const [k, v] of Object.entries(stored)) {
      if (!(k in validated)) extras[k] = v;
    }
  }
  return { ...(validated as Record<string, unknown>), ...extras };
}

router.get("/settings", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const [row] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId));

  const stored = (row?.settings ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS, ...stored };

  // Migration for legacy rows: stored settings from before bandColors was
  // persisted server-side have paletteShallow but no bandColors. Derive
  // bandColors[0] from the stored paletteShallow so the rendered top band
  // immediately matches the user's previously-configured shallow colour
  // rather than reverting to the default. This mirrors the same guard that
  // already runs in paletteStore's localStorage merge function.
  if (!("bandColors" in stored)) {
    const legacyShallow = merged.paletteShallow;
    const bc = [...(DEFAULT_SETTINGS.bandColors as string[])];
    if (typeof legacyShallow === "string" && /^#[0-9a-fA-F]{6}$/i.test(legacyShallow)) {
      bc[0] = legacyShallow.toLowerCase();
    }
    merged.bandColors = bc;
  }

  // Migration for legacy rows: stored settings from before bandBoundaries was
  // persisted server-side. Fall back to the default boundaries so the schema
  // validation always receives a valid array.
  if (!("bandBoundaries" in stored)) {
    merged.bandBoundaries = [...DEFAULT_SETTINGS.bandBoundaries];
  }

  // Migration for legacy rows: stored settings from before zoneOverlaySlots
  // was split into per-water-type palettes. If the stored value is a flat
  // 4-element array, promote it to the new object format (saltwater = stored
  // array, freshwater = default palette). Without this, Zod validation throws
  // a 500 for any existing user whose row pre-dates this change.
  if (Array.isArray(merged.zoneOverlaySlots)) {
    merged.zoneOverlaySlots = {
      saltwater: merged.zoneOverlaySlots,
      freshwater: DEFAULT_SETTINGS.zoneOverlaySlots.freshwater,
    };
  }

  // Migration for legacy rows: terrainExaggeration was widened to the
  // [1, 20] slider range (old default was 0.8, below the new minimum) and
  // contourInterval now allows fine 0.5 intervals with a 0.5 floor. Clamp
  // stored out-of-range values so schema validation never 500s for rows
  // written before the range change.
  if (typeof merged.terrainExaggeration === "number") {
    merged.terrainExaggeration = Math.min(20, Math.max(1, merged.terrainExaggeration));
  }
  if (typeof merged.contourInterval === "number") {
    merged.contourInterval = Math.min(1000, Math.max(0.5, merged.contourInterval));
  }

  let validated: z.infer<typeof GetSettingsResponse>;
  try {
    validated = GetSettingsResponse.parse(merged);
  } catch (err) {
    // Do NOT return err.message — Zod error messages include .received values
    // which may echo stored user data in the error response. Return only a
    // generic message; field paths are logged server-side for debugging.
    logger.warn({ userId, err }, "[settings] GET /api/settings — response schema validation failed");
    res.status(500).json({ error: "internal", details: "Server settings failed internal schema validation" });
    return;
  }
  res.json(mergeForResponse(stored, validated));
}));

const MAX_TOTAL_SETTINGS_BYTES = 256 * 1024;

router.put("/settings", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = PutSettingsBody.safeParse(body);
  if (!parsed.success) {
    const safeIssues = parsed.error.issues.map((i) =>
      sanitizeZodIssue(i as unknown as Record<string, unknown>),
    );
    const sanitizedDetails = parsed.error.issues
      .map((i) => `${(i.path ?? []).join(".") || "(root)"}: ${i.code}`)
      .join("; ");
    // For server logs, keep only path and code — Zod's message field can
    // embed the user-supplied value (e.g. "received 'attoparsecs'"), so
    // it is intentionally excluded from the log to avoid leaking input.
    const logIssues = parsed.error.issues.map((i) => ({ path: i.path, code: i.code }));
    process.stderr.write(`[settings] PUT /api/settings 400 — userId=${userId} issues=${JSON.stringify(logIssues)}\n`);
    logger.warn({ userId, issues: logIssues }, "PUT /api/settings — Zod validation failed");
    res.status(400).json({ error: "invalid_request", details: sanitizedDetails, issues: safeIssues });
    return;
  }

  // PUT is a partial update: only the fields the client actually included in
  // the request body should overwrite stored state. The generated zod schema
  // has `.default(...)` on every field, so `parsed.data` always contains every
  // known key — even ones the client didn't send. Use the raw body to decide
  // which validated fields to apply, otherwise a partial PUT (e.g. the
  // water-type toggle sending just `{ waterType }`) would silently reset every
  // other setting (units, depthUnit, hudOpacity, …) back to its default.
  const sentKeys = new Set(Object.keys(body));
  const sentValidated: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (sentKeys.has(k)) sentValidated[k] = v;
  }

  // Preserve fields that the client sent but that aren't part of the validated
  // Zod schema (i.e. fields whose keys are not present in parsed.data). These
  // are fields that are completely unknown to the current API spec — for
  // example legacy client keys like showCompassMinimap, or fields that a newer
  // client version sends before the server's schema has been updated to include
  // them. NOTE: all fields listed in DEFAULT_SETTINGS (including zonePaintSlot,
  // globalFontSize, efhOverlayEnabled, weatherStationsActive, etc.) ARE already
  // present in PutSettingsBody and will therefore appear in parsed.data; they
  // do NOT go through this extras path. Only genuinely unrecognised keys reach
  // this block.
  //
  // POLICY (documented decision): unknown keys are accepted for backward and
  // forward compatibility, but they are constrained rather than merged blindly:
  //   * key names must match EXTRA_KEY_RE (letter-first identifier, ≤ 64 chars)
  //     — this rejects prototype-pollution vectors (__proto__, constructor,
  //     prototype), dunder keys, and arbitrary injected key strings;
  //   * at most MAX_EXTRA_KEYS unknown keys per request;
  //   * the serialized extras payload is capped at MAX_EXTRAS_BYTES.
  // A request violating any of these returns a structured 400 instead of
  // silently storing attacker-controlled keys.
  const schemaKeys = new Set(Object.keys(parsed.data as Record<string, unknown>));
  // Null-prototype object: a plain `{}` would treat an assignment to
  // "__proto__" as a prototype mutation (silently vanishing from
  // Object.keys) instead of an own property, letting the key evade the
  // policy checks below.
  const extras: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(body)) {
    // __updatedAt is excluded here — the server is the sole authority for the
    // sync timestamp and we overwrite it unconditionally below, so accepting a
    // client-supplied value would let a client inject a future timestamp and
    // break cross-device hydration ordering.
    if (!schemaKeys.has(k) && k !== "__updatedAt") extras[k] = v;
  }

  const EXTRA_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
  const FORBIDDEN_EXTRA_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const MAX_EXTRA_KEYS = 512;
  const MAX_EXTRAS_BYTES = 16 * 1024;

  const badKey = Object.keys(extras).find(
    (k) => FORBIDDEN_EXTRA_KEYS.has(k) || !EXTRA_KEY_RE.test(k),
  );
  if (badKey !== undefined) {
    process.stderr.write(`[settings] PUT /api/settings 400 — badKey userId=${userId} key=${JSON.stringify(badKey)} allExtras=${JSON.stringify(Object.keys(extras))}\n`);
    logger.warn({ userId, badKey, extraKeys: Object.keys(extras) }, "PUT /api/settings — bad extra key name");
    res.status(400).json({
      error: "invalid_request",
      details: `Unknown settings key '${badKey}' is not an allowed key name`,
    });
    return;
  }
  if (Object.keys(extras).length > MAX_EXTRA_KEYS) {
    process.stderr.write(`[settings] PUT /api/settings 400 — tooManyExtras userId=${userId} count=${Object.keys(extras).length} keys=${JSON.stringify(Object.keys(extras))}\n`);
    logger.warn({ userId, extraKeyCount: Object.keys(extras).length, extraKeys: Object.keys(extras) }, "PUT /api/settings — too many extra keys");
    res.status(400).json({
      error: "invalid_request",
      details: `Too many unknown settings keys (max ${MAX_EXTRA_KEYS})`,
    });
    return;
  }
  if (Buffer.byteLength(JSON.stringify(extras), "utf8") > MAX_EXTRAS_BYTES) {
    process.stderr.write(`[settings] PUT /api/settings 400 — extrasTooLarge userId=${userId} bytes=${Buffer.byteLength(JSON.stringify(extras), "utf8")} keys=${JSON.stringify(Object.keys(extras))}\n`);
    logger.warn({ userId, extraBytes: Buffer.byteLength(JSON.stringify(extras), "utf8"), extraKeys: Object.keys(extras) }, "PUT /api/settings — extra keys payload too large");
    res.status(400).json({
      error: "invalid_request",
      details: `Unknown settings keys exceed the ${MAX_EXTRAS_BYTES}-byte size cap`,
    });
    return;
  }
  // Server is the source of truth for the sync timestamp — never trust the
  // client's value here. This is what cross-device hydration uses to decide
  // whether the stored server state is newer than the local snapshot.
  // The extraction loop above already excludes __updatedAt (k !== "__updatedAt"),
  // so no explicit removal is needed here — the server timestamp is set below.
  const updatedAt = new Date().toISOString();

  // Merge over the previously stored row so unspecified fields keep their
  // existing values (rather than being reset to DEFAULT_SETTINGS).
  let existing: typeof userSettingsTable.$inferSelect | undefined;
  try {
    [existing] = await db
      .select()
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, userId));
  } catch (selectErr) {
    const e = selectErr as Error & { code?: string };
    logger.error(
      { userId, errMessage: e.message, errCode: e.code, step: "db.select" },
      "PUT /api/settings — DB SELECT threw",
    );
    throw selectErr;
  }
  const stored = (existing?.settings ?? {}) as Record<string, unknown>;

  // Object.create(null) gives a null-prototype object so a "__proto__" key
  // in any of the spread sources (e.g. a legacy stored row) is copied as an
  // own property rather than silently mutating Object.prototype. Equivalent
  // behaviour to the spread but prototype-safe. JSON.stringify reads only own
  // enumerable properties, so serialisation is unaffected.
  const merged: Record<string, unknown> = Object.assign(
    Object.create(null) as Record<string, unknown>,
    DEFAULT_SETTINGS,
    stored,
    sentValidated,
    extras,
    { __updatedAt: updatedAt },
  );

  // Migration for legacy rows: normalize a flat zoneOverlaySlots array to the
  // new per-water-type object shape so it is stored correctly going forward.
  if (Array.isArray(merged.zoneOverlaySlots)) {
    merged.zoneOverlaySlots = {
      saltwater: merged.zoneOverlaySlots,
      freshwater: DEFAULT_SETTINGS.zoneOverlaySlots.freshwater,
    };
  }

  // Guard: cap the total size of the merged settings object to prevent
  // unbounded database growth. This catches cases where a large stored row
  // combined with a small valid request would still produce an oversized row.
  let mergedJson: string;
  try {
    mergedJson = JSON.stringify(merged);
  } catch (jsonErr) {
    const e = jsonErr as Error;
    logger.error(
      { userId, errMessage: e.message, step: "JSON.stringify(merged)" },
      "PUT /api/settings — JSON serialization of merged settings threw",
    );
    throw jsonErr;
  }
  const totalMergedBytes = Buffer.byteLength(mergedJson, "utf8");
  if (totalMergedBytes > MAX_TOTAL_SETTINGS_BYTES) {
    process.stderr.write(`[settings] PUT /api/settings 400 — totalTooLarge userId=${userId} bytes=${totalMergedBytes}\n`);
    logger.warn({ userId, totalMergedBytes }, "PUT /api/settings — merged settings payload too large");
    res.status(400).json({
      error: "invalid_request",
      details: `Settings payload exceeds the ${MAX_TOTAL_SETTINGS_BYTES}-byte total size cap`,
    });
    return;
  }

  // Sanitize the null-prototype merged object into a plain object before
  // passing to Drizzle. The pg driver may call instanceof Object or toJSON on
  // the value; a null-prototype object would fail those checks. A JSON
  // round-trip is the cheapest way to guarantee a plain, regular-prototype
  // object reaches the wire — and it is safe because JSON.stringify already
  // reads only own enumerable properties, which is exactly what we want.
  const safeSettings = JSON.parse(mergedJson) as Record<string, unknown>;

  try {
    await db
      .insert(userSettingsTable)
      .values({ userId, settings: safeSettings })
      .onConflictDoUpdate({
        target: userSettingsTable.userId,
        set: { settings: safeSettings },
      });
  } catch (upsertErr) {
    const e = upsertErr as Error & { code?: string };
    logger.error(
      { userId, errMessage: e.message, errCode: e.code, step: "db.insert.onConflictDoUpdate" },
      "PUT /api/settings — DB upsert threw",
    );
    throw upsertErr;
  }

  res.json(safeSettings);
}));

export default router;
