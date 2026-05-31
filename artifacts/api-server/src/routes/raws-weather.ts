/**
 * raws-weather.ts — AOOS RAWS per-station observation endpoint.
 *
 * GET /raws-weather?datasetId=
 *
 * Fetches the latest observation for a single RAWS station. The datasetId
 * must match the pattern `raws_.*` (basic allowlist to prevent arbitrary
 * ERDDAP dataset access). Returns `{ available: false }` on failure with
 * HTTP 200 so the UI degrades gracefully.
 */

import { Router } from "express";
import { logger } from "../lib/logger.js";
import { fetchRawsObservation } from "../lib/rawsErddap.js";

const router = Router();

const DATASET_ID_PATTERN = /^raws_[a-zA-Z0-9_-]+$/;

router.get("/raws-weather", async (req, res): Promise<void> => {
  const datasetId = String(req.query["datasetId"] ?? "");

  if (!datasetId || !DATASET_ID_PATTERN.test(datasetId)) {
    res.status(400).json({
      error: "invalid_params",
      details: "datasetId is required and must match the raws_* pattern",
    });
    return;
  }

  try {
    const obs = await fetchRawsObservation(datasetId);
    if (!obs) {
      res.json({ available: false });
      return;
    }
    res.json({ available: true, observation: obs, station: { datasetId } });
  } catch (err) {
    logger.warn({ err, datasetId }, "raws-weather: unexpected error");
    res.json({ available: false });
  }
});

export default router;
