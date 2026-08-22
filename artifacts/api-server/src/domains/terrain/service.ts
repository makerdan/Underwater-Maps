/**
 * Terrain-processing domain service.
 *
 * Routes retain HTTP validation, upload state transitions, persistence, and
 * response formatting. This service owns the CPU-heavy terrain boundary:
 * worker-thread parsing/gridding and on-demand bundle fetching.
 */

import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";
import { gridPoints, parseXyzCsv, type TerrainGrid } from "../../lib/terrain.js";
import type { BathyFetchBundle, Bbox, FetchStrategy } from "../../lib/fetchers/types.js";
import { getFetcher } from "../../lib/fetchers/index.js";
import { parseUploadedFile, type RawPoint } from "../../lib/uploadParsers.js";
import {
  parsePdfContourFile,
  PdfRasterOnlyError,
  type PdfDepthUnit,
} from "../../lib/pdfContour.js";
import {
  parseRasterPdfContourFile,
  parseRasterImageContourFile,
} from "../../lib/pdfContourRaster.js";

export interface TerrainParseWorkerInput {
  filePath: string;
  fileName: string;
  resolution: number;
  gridId: string;
  datasetName: string;
  smoothing: boolean;
  prePoints?: { lon: number; lat: number; depth: number }[];
  onProgress: (progress: number) => void;
}

export interface TerrainParseWorkerResult {
  terrain: TerrainGrid;
  overview: TerrainGrid;
}

export interface TerrainUploadInput {
  buffer: Buffer;
  fileName: string;
  resolution: number;
  gridId: string;
  datasetName: string;
  smoothing: boolean;
  pdfBbox?: Bbox;
  pdfDepthUnit?: PdfDepthUnit;
}

export class TerrainInsufficientDataError extends Error {
  constructor() {
    super("File must contain at least 10 valid (lon, lat, depth) rows");
    this.name = "TerrainInsufficientDataError";
  }
}

const PARSE_WORKER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "lib",
  "parseWorker.mjs",
);

/**
 * Run the bounded parse + grid pipeline in the dedicated worker thread.
 * Worker lifecycle and all progress milestones remain identical to the
 * pre-domain implementation.
 */
export function runTerrainParseWorker(
  params: TerrainParseWorkerInput,
): Promise<TerrainParseWorkerResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(PARSE_WORKER_PATH, {
      workerData: {
        filePath: params.filePath,
        fileName: params.fileName,
        resolution: params.resolution,
        gridId: params.gridId,
        datasetName: params.datasetName,
        smoothing: params.smoothing,
        prePoints: params.prePoints,
      },
    });

    const terminate = () => {
      worker.terminate().catch(() => undefined);
    };

    worker.on("message", (msg: {
      type: string;
      progress?: number;
      terrain?: unknown;
      overview?: unknown;
      message?: string;
    }) => {
      if (msg.type === "progress" && typeof msg.progress === "number") {
        params.onProgress(msg.progress);
      } else if (msg.type === "result") {
        if (settled) return;
        settled = true;
        terminate();
        resolve({
          terrain: msg.terrain as TerrainGrid,
          overview: msg.overview as TerrainGrid,
        });
      } else if (msg.type === "error" && typeof msg.message === "string") {
        if (settled) return;
        settled = true;
        terminate();
        reject(new Error(msg.message));
      }
    });

    worker.on("error", (err) => {
      if (settled) return;
      settled = true;
      terminate();
      reject(err);
    });

    worker.on("exit", (code) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Parse worker exited unexpectedly with code ${code}`));
    });
  });
}

/** Grid already-parsed points at the requested and overview resolutions. */
export function processTerrainPoints(input: {
  points: { lon: number; lat: number; depth: number }[];
  resolution: number;
  gridId: string;
  datasetName: string;
  smoothing: boolean;
}): TerrainParseWorkerResult {
  return {
    terrain: gridPoints(input.points, input.resolution, input.gridId, input.datasetName, {
      smoothing: input.smoothing,
    }),
    overview: gridPoints(input.points, 64, input.gridId, input.datasetName, {
      smoothing: input.smoothing,
    }),
  };
}

/**
 * Parse a direct upload and generate both persisted terrain grids.
 *
 * This is the synchronous-upload counterpart to runTerrainParseWorker. Keeping
 * format dispatch here means direct and chunked uploads use the same parser
 * implementations and grid-generation contract. HTTP validation and response
 * mapping remain in the route.
 */
export async function processTerrainUpload(
  input: TerrainUploadInput,
): Promise<TerrainParseWorkerResult> {
  const points = await parseTerrainUpload(input);
  return processTerrainPoints({
    points,
    resolution: input.resolution,
    gridId: input.gridId,
    datasetName: input.datasetName,
    smoothing: input.smoothing,
  });
}

/** Parse a direct upload without requiring grid parameters. */
export async function parseTerrainUpload(
  input: Pick<TerrainUploadInput, "buffer" | "fileName" | "pdfBbox" | "pdfDepthUnit">,
): Promise<RawPoint[]> {
  const baseFileName = input.fileName.toLowerCase().endsWith(".gz")
    ? input.fileName.slice(0, -3)
    : input.fileName;
  const fileExt = baseFileName.toLowerCase().split(".").pop() ?? "";
  const textExtensions = new Set(["csv", "xyz", "txt"]);

  let points: RawPoint[];
  if (fileExt === "pdf") {
    if (!input.pdfBbox) {
      throw new Error("PDF georeference is required");
    }
    try {
      points = await parsePdfContourFile(
        input.buffer,
        input.pdfBbox,
        input.pdfDepthUnit ?? "feet",
      );
    } catch (err) {
      if (!(err instanceof PdfRasterOnlyError)) throw err;
      points = await parseRasterPdfContourFile(
        input.buffer,
        input.pdfBbox,
        input.pdfDepthUnit ?? "feet",
      );
    }
  } else if (fileExt === "png" || fileExt === "jpg" || fileExt === "jpeg") {
    if (!input.pdfBbox) {
      throw new Error("PDF georeference is required");
    }
    points = await parseRasterImageContourFile(
      input.buffer,
      input.pdfBbox,
      input.pdfDepthUnit ?? "feet",
    );
  } else if (textExtensions.has(fileExt)) {
    points = parseXyzCsv(input.buffer.toString("utf8"), baseFileName);
  } else {
    points = await parseUploadedFile(input.buffer, baseFileName);
  }

  if (points.length < 10) {
    throw new TerrainInsufficientDataError();
  }
  return points;
}

/** Fetch one catalog bundle using the canonical fetcher registry. */
export async function fetchTerrainBundle(
  strategy: FetchStrategy,
  bbox: Bbox,
  resolution = 256,
): Promise<BathyFetchBundle> {
  const fetcher = getFetcher(strategy);
  return fetcher.fetch(strategy, bbox, resolution);
}