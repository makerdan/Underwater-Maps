import * as zlib from "zlib";

/**
 * Streaming gunzip with an early-abort size guard.
 * Rejects with `{ code: "DECOMPRESS_TOO_LARGE" }` if inflated output exceeds
 * maxBytes *during* decompression (no full buffer materialises beyond the cap).
 * Rejects with the underlying zlib error if the input is not a valid gzip.
 */
export function gunzipBounded(input: Buffer, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const gz = zlib.createGunzip();
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    function abort(err: Error) {
      if (settled) return;
      settled = true;
      gz.destroy();
      reject(err);
    }

    gz.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        abort(Object.assign(new Error("DECOMPRESS_TOO_LARGE"), { code: "DECOMPRESS_TOO_LARGE" }));
        return;
      }
      chunks.push(chunk);
    });

    gz.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });

    gz.on("error", (err) => abort(err));

    gz.write(input);
    gz.end();
  });
}
