/**
 * gpsExport.worker.ts — Web Worker entry point for off-main-thread GPS serialization.
 *
 * Receives a { data: ExportData; format: ExportFormat } message, calls the
 * appropriate serializer, then posts back { ok: true, content } or
 * { ok: false, error }.
 *
 * Spawned by serializeAsync() in gpsExport.ts via `new Worker(new URL(...))`.
 */
import { serializeGpx, serializeKml, type ExportData, type ExportFormat } from "./gpsExport";

interface WorkerRequest {
  data: ExportData;
  format: ExportFormat;
}

interface WorkerResponse {
  ok: boolean;
  content?: string;
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const content =
      e.data.format === "gpx"
        ? serializeGpx(e.data.data)
        : serializeKml(e.data.data);
    const response: WorkerResponse = { ok: true, content };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
