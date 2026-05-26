/**
 * Progress-aware JSON fetcher.
 *
 * Streams the response body through a ReadableStream reader, accumulates the
 * received bytes, reports progress via the optional `onProgress` callback,
 * then parses the full buffer as JSON. Honours an AbortSignal so callers
 * can cancel in-flight requests (e.g. when the user picks a different
 * dataset mid-load).
 */
export interface ProgressEvent {
  loaded: number;
  total: number | null;
}

export interface FetchWithProgressOptions {
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
  init?: RequestInit;
}

const TEXT_DECODER = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;

function decodeChunks(chunks: Uint8Array[]): string {
  if (TEXT_DECODER) {
    const decoder = new TextDecoder();
    let out = "";
    for (let i = 0; i < chunks.length; i++) {
      out += decoder.decode(chunks[i]!, { stream: i < chunks.length - 1 });
    }
    return out;
  }
  let out = "";
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) out += String.fromCharCode(chunk[i]!);
  }
  return out;
}

export async function fetchJsonWithProgress<T = unknown>(
  url: string,
  options: FetchWithProgressOptions = {},
): Promise<T> {
  const { signal, onProgress, init } = options;
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 200)}`);
  }

  const totalHeader = response.headers.get("content-length");
  const total = totalHeader && !Number.isNaN(Number(totalHeader)) ? Number(totalHeader) : null;

  // Fall back to .json() when streaming is unavailable (older runtimes / jsdom).
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await response.text();
    const loaded = total ?? text.length;
    onProgress?.({ loaded, total });
    return JSON.parse(text) as T;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  // Fire an initial 0-progress so the dial starts at zero immediately.
  onProgress?.({ loaded: 0, total });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.({ loaded, total });
      }
    }
  } catch (err) {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
    throw err;
  }

  const text = decodeChunks(chunks);
  return JSON.parse(text) as T;
}
