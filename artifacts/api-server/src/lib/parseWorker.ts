/**
 * parseWorker.ts — Worker-thread entry point for the parse+grid pipeline.
 *
 * Spawned by processUploadJob (datasets.ts) via Node.js worker_threads.
 * Runs the CPU-intensive steps (file read → parse → gridPoints × 2) in a
 * dedicated OS thread so the main HTTP server event loop is never blocked,
 * even for very large uploads.
 *
 * Message protocol (parentPort):
 *   { type: "progress", progress: number }  — progress milestones (0–100)
 *   { type: "result",  terrain: TerrainGrid, overview: TerrainGrid }
 *   { type: "error",   message: string }
 *
 * workerData shape: ParseWorkerInput (see below).
 */

import { workerData, parentPort } from "worker_threads";
import * as fs from "fs";
import { parseXyzCsv, gridPoints } from "./terrain.js";
import { parseUploadedFile, type RawPoint } from "./uploadParsers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParseWorkerInput {
  filePath: string;
  fileName: string;
  resolution: number;
  gridId: string;
  datasetName: string;
  smoothing: boolean;
  /**
   * Pre-parsed points — when present, the file-read and parse steps are
   * skipped and these points are used directly for gridding.  Used by the
   * NOAA tar.gz router which aggregates points from multiple inner files
   * before dispatching to the worker.
   */
  prePoints?: RawPoint[];
}

export type ParseWorkerMessage =
  | { type: "progress"; progress: number }
  | { type: "result"; terrain: ReturnType<typeof gridPoints>; overview: ReturnType<typeof gridPoints> }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const TEXT_EXTENSIONS = new Set(["csv", "xyz", "txt"]);

async function run(): Promise<void> {
  const {
    filePath,
    fileName,
    resolution,
    gridId,
    datasetName,
    smoothing,
    prePoints,
  } = workerData as ParseWorkerInput;

  const port = parentPort!;

  // ── Step 1: Read + Parse ──────────────────────────────────────────────────
  let points: RawPoint[];

  if (Array.isArray(prePoints)) {
    // Pre-parsed points supplied by the caller (e.g. NOAA tar.gz router).
    // Skip the file-read and parse steps entirely.
    port.postMessage({ type: "progress", progress: 40 } satisfies ParseWorkerMessage);
    points = prePoints;
  } else {
    // Derive extension from inner filename (strip .gz if present)
    const baseFileName = fileName.toLowerCase().endsWith(".gz")
      ? fileName.slice(0, -3)
      : fileName;
    const fileExt = baseFileName.split(".").pop() ?? "";

    // Note: when fileName ends in .gz, filePath already points to the
    // decompressed file (datasets.ts strips the gz before spawning the worker).
    // We pass baseFileName to the parsers so they route on the real extension.
    if (TEXT_EXTENSIONS.has(fileExt)) {
      const fileContent = await fs.promises.readFile(filePath, "utf8");
      port.postMessage({ type: "progress", progress: 40 } satisfies ParseWorkerMessage);
      points = parseXyzCsv(fileContent, baseFileName);
    } else {
      const raw = await fs.promises.readFile(filePath);
      port.postMessage({ type: "progress", progress: 40 } satisfies ParseWorkerMessage);
      points = await parseUploadedFile(raw, baseFileName);
    }
  }

  port.postMessage({ type: "progress", progress: 55 } satisfies ParseWorkerMessage);

  if (points.length < 10) {
    throw new Error("File must contain at least 10 valid (lon, lat, depth) rows");
  }

  // ── Step 2: Grid (terrain resolution) ────────────────────────────────────
  port.postMessage({ type: "progress", progress: 60 } satisfies ParseWorkerMessage);
  const terrain = gridPoints(points, resolution, gridId, datasetName, { smoothing });

  port.postMessage({ type: "progress", progress: 80 } satisfies ParseWorkerMessage);

  // ── Step 3: Grid (overview — fixed 64×64) ────────────────────────────────
  const overview = gridPoints(points, 64, gridId, datasetName, { smoothing });

  port.postMessage({ type: "progress", progress: 88 } satisfies ParseWorkerMessage);

  // ── Done ─────────────────────────────────────────────────────────────────
  port.postMessage({ type: "result", terrain, overview } satisfies ParseWorkerMessage);
}

run().catch((err) => {
  const message = err instanceof Error ? err.message : "Parse worker error";
  parentPort!.postMessage({ type: "error", message } satisfies ParseWorkerMessage);
});
