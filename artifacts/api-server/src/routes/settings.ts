import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, userSettingsTable } from "@workspace/db";
import { GetSettingsResponse, PutSettingsBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router = Router();

const DEFAULT_SETTINGS = {
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
};

/**
 * Stored settings may include extra fields (advanced sections, accessibility,
 * etc.) that aren't in the strict zod schema. We merge stored extras with the
 * validated known fields when responding.
 */
function mergeForResponse(
  stored: Record<string, unknown> | null | undefined,
  validated: Record<string, unknown>,
): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (stored) {
    for (const [k, v] of Object.entries(stored)) {
      if (!(k in DEFAULT_SETTINGS)) extras[k] = v;
    }
  }
  return { ...validated, ...extras };
}

router.get("/settings", requireAuth, async (req, res): Promise<void> => {
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

  const validated = GetSettingsResponse.parse(merged) as Record<string, unknown>;
  res.json(mergeForResponse(stored, validated));
});

router.put("/settings", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = PutSettingsBody.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.message });
    return;
  }

  // Extra validation for bandBoundaries: the generated Zod schema only checks
  // array length (11) and item range [0, 2000]. The spec also requires strictly
  // increasing values, first element 0, and last element 2000 — enforce these
  // here since orval does not emit superRefine calls from plain descriptions.
  if ("bandBoundaries" in body) {
    const bb = parsed.data.bandBoundaries as number[];
    const first = bb[0];
    const last = bb[bb.length - 1];
    const notStrictlyIncreasing = bb.slice(1).some((v, i) => v <= (bb[i] as number));
    if (first !== 0 || last !== 2000 || notStrictlyIncreasing) {
      res.status(400).json({
        error: "invalid_request",
        details: "bandBoundaries must be strictly increasing, start at 0, and end at 2000",
      });
      return;
    }
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

  // Preserve any extra (non-spec) fields so advanced settings persist server-side.
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!(k in DEFAULT_SETTINGS)) extras[k] = v;
  }
  // Server is the source of truth for the sync timestamp — never trust the
  // client's value here. This is what cross-device hydration uses to decide
  // whether the stored server state is newer than the local snapshot.
  delete extras.__updatedAt;
  const updatedAt = new Date().toISOString();

  // Merge over the previously stored row so unspecified fields keep their
  // existing values (rather than being reset to DEFAULT_SETTINGS).
  const [existing] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId));
  const stored = (existing?.settings ?? {}) as Record<string, unknown>;

  const merged: Record<string, unknown> = {
    ...DEFAULT_SETTINGS,
    ...stored,
    ...sentValidated,
    ...extras,
    __updatedAt: updatedAt,
  };

  // Migration for legacy rows: normalize a flat zoneOverlaySlots array to the
  // new per-water-type object shape so it is stored correctly going forward.
  if (Array.isArray(merged.zoneOverlaySlots)) {
    merged.zoneOverlaySlots = {
      saltwater: merged.zoneOverlaySlots,
      freshwater: DEFAULT_SETTINGS.zoneOverlaySlots.freshwater,
    };
  }

  await db
    .insert(userSettingsTable)
    .values({ userId, settings: merged })
    .onConflictDoUpdate({
      target: userSettingsTable.userId,
      set: { settings: merged },
    });

  res.json(merged);
});

export default router;
