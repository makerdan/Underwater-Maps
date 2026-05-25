import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, userSettingsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router = Router();

const DEFAULT_SETTINGS = {
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
  hudOpacity: 0.75,
  overviewDefaultZoom: 1.0,
  overviewShowGrid: true,
  overviewShowMarkers: true,
  overviewOpenOnLoad: false,
  visibleMarkerTypes: ["fish", "shipwreck", "coral", "vent", "custom"],
  showMarkerLabels: true,
  privateMarkers: false,
  defaultMarkerType: "fish",
  defaultRegion: "mariana-trench",
  gpsRecordingInterval: 10000,
};

router.get("/settings", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const [row] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId));

  const merged = { ...DEFAULT_SETTINGS, ...(row?.settings ?? {}) };
  res.json(merged);
});

router.put("/settings", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const incoming = req.body as Record<string, unknown>;

  const merged = { ...DEFAULT_SETTINGS, ...incoming };

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
