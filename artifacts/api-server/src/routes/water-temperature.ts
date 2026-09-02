/**
 * water-temperature.ts — Current sea-surface temperature for a lat/lon point.
 *
 * GET /api/water-temperature?lat=&lon=
 *
 * Data source: Open-Meteo Marine API (free, no API key required).
 *   https://marine-api.open-meteo.com/v1/marine
 *
 * The HUD temperature readout (see artifacts/bathyscan/src/lib/waterTemp.ts)
 * uses the returned SST as the surface anchor of a thermocline model so the
 * value reflects real ocean conditions for the user's dataset / GPS location.
 * When the live feed is unreachable we return { available: false } so the
 * client can gracefully fall back to an estimated value and the chip can
 * surface a "simulated" attribution to the user.
 */

import { Router } from "express";
import { LatLonQuerySchema } from "./schemas.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { logger } from "../lib/logger.js";
import { GetWaterTemperatureResponse } from "@workspace/api-zod";
import { validateProxyResponse } from "../middlewares/validateResponse.js";
import { fetchCurrentSst, pickCurrentSst } from "../domains/environmental/service.js";

const router = Router();

const SOURCE_LABEL = "Open-Meteo Marine API (sea-surface temperature)";
const SOURCE_URL = "https://open-meteo.com/en/docs/marine-weather-api";
export { pickCurrentSst };

router.get("/water-temperature", asyncHandler(async (req, res): Promise<void> => {
  const parsed = LatLonQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: parsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }
  const { lat, lon } = parsed.data;

  // Cache for 30 minutes — SST changes very slowly and the Open-Meteo
  // forecast is itself hourly.
  res.setHeader("Cache-Control", "public, max-age=1800");

  try {
    const picked = await fetchCurrentSst(lat, lon);
    if (picked) {
        res.json(validateProxyResponse(GetWaterTemperatureResponse, {
          available: true,
          lat,
          lon,
          sstCelsius: picked.sst,
          timestamp: picked.timestamp,
          source: SOURCE_LABEL,
          sourceUrl: SOURCE_URL,
        }, {
          available: false,
          lat,
          lon,
          source: SOURCE_LABEL,
          sourceUrl: SOURCE_URL,
        }, "GET /api/water-temperature"));
        return;
    }
  } catch (err) {
    logger.error({ err, lat, lon }, "[water-temperature] Open-Meteo fetch failed");
    // fall through to unavailable response
  }

  res.json(validateProxyResponse(GetWaterTemperatureResponse, {
    available: false,
    lat,
    lon,
    source: SOURCE_LABEL,
    sourceUrl: SOURCE_URL,
  }, {
    available: false,
    lat,
    lon,
    source: SOURCE_LABEL,
    sourceUrl: SOURCE_URL,
  }, "GET /api/water-temperature"));
}));

export default router;
