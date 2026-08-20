/**
 * ExcelJS worker for GPS imports. The worker owns workbook loading and row
 * conversion so large spreadsheets do not block the import dialog's UI thread.
 */
import {
  parseExcelFromArrayBuffer,
  type ExcelParseProgress,
} from "./gpsImport";

interface Request {
  data: ArrayBuffer;
  fileName: string;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const result = await parseExcelFromArrayBuffer(
      event.data.data,
      event.data.fileName,
      (progress: ExcelParseProgress) => self.postMessage({ type: "progress", progress }),
    );
    self.postMessage({ type: "result", ...result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};