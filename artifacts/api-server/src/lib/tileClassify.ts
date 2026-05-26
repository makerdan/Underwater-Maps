/**
 * tileClassify.ts — pure helpers for the tiled zone classifier.
 *
 * The classifier in `routes/poe.ts` downsamples any dataset — large or small —
 * to a single 32×32 greyscale image before asking the LLM what's there. For
 * high-resolution uploads this throws away almost all of the detail that
 * would let the model distinguish, say, a rocky shelf from a coral ridge.
 *
 * This module slices the source depth grid into overlapping 32×32 tiles, lets
 * the caller classify each at the existing per-call resolution, then stitches
 * the per-tile label arrays back into a single coarseWidth × coarseHeight
 * grid. Overlap bands are resolved deterministically (closest non-overlap
 * tile center wins; ties broken by tile index) so seams disappear without a
 * separate smoothing model.
 *
 * Everything in here is pure / sync / dependency-free so it can be
 * unit-tested directly without booting Express or mocking the Poe client.
 */

import { deflateRawSync } from "node:zlib";

/** Cap on per-axis tile count. 4 → at most 16 tiles per dataset. */
export const MAX_TILES_PER_SIDE = 4;
/** Hard cap on total LLM calls per dataset (also enforced by MAX_TILES_PER_SIDE²). */
export const MAX_CLASSIFY_TILES = MAX_TILES_PER_SIDE * MAX_TILES_PER_SIDE;
/** Concurrency limit when issuing per-tile Poe requests. */
export const TILE_CONCURRENCY = 4;
/** Per-tile resolution sent to the LLM — matches the existing single-tile prompt. */
export const TILE_SIZE = 32;
/**
 * Overlap (in source cells) each tile extends into its neighbours. A small
 * overlap lets the stitching pass reconcile disagreement along shared edges
 * without a separate smoothing model.
 */
export const TILE_OVERLAP_SRC = 4;

export interface TileBounds {
  /** Tile index in the K×K grid (row, col). */
  tileRow: number;
  tileCol: number;
  /** Source-pixel bounds [r0,r1) × [c0,c1) including the overlap band. */
  r0: number;
  r1: number;
  c0: number;
  c1: number;
  /** Tile centre (in source-pixel coords) of the non-overlap core. */
  cy: number;
  cx: number;
}

export interface TilePlan {
  /** Number of tiles per axis (square grid: K × K). */
  K: number;
  /** Width of the stitched output zones grid (== K * TILE_SIZE). */
  coarseWidth: number;
  /** Height of the stitched output zones grid (== K * TILE_SIZE). */
  coarseHeight: number;
  tiles: TileBounds[];
}

/**
 * Pick a tile layout for a `width × height` depth grid.
 *   • K targets roughly one tile per 64 source cells per axis (so a 32×32
 *     tile downsamples ~2× — twice the detail of today's single-thumbnail
 *     path). For a 256-cell grid that gives K=4 (16 tiles, max); for a
 *     64-cell grid K=1 (single-tile fall-through — no regression on small
 *     datasets).
 *   • K is clamped to `[1, maxPerSide]`. Callers can pass a smaller
 *     `maxPerSide` to enforce a per-request cap below the module default.
 */
export function planTiles(
  width: number,
  height: number,
  maxPerSide: number = MAX_TILES_PER_SIDE,
): TilePlan {
  const minSide = Math.min(width, height);
  const cap = Math.max(1, Math.min(MAX_TILES_PER_SIDE, maxPerSide | 0));
  const fromSize = Math.max(1, Math.floor(minSide / 64));
  const K = Math.max(1, Math.min(cap, fromSize));

  const tiles: TileBounds[] = [];
  const tileH = height / K;
  const tileW = width / K;
  for (let tr = 0; tr < K; tr++) {
    for (let tc = 0; tc < K; tc++) {
      const baseR0 = Math.floor(tr * tileH);
      const baseR1 = Math.ceil((tr + 1) * tileH);
      const baseC0 = Math.floor(tc * tileW);
      const baseC1 = Math.ceil((tc + 1) * tileW);
      const r0 = Math.max(0, baseR0 - (tr > 0 ? TILE_OVERLAP_SRC : 0));
      const r1 = Math.min(height, baseR1 + (tr < K - 1 ? TILE_OVERLAP_SRC : 0));
      const c0 = Math.max(0, baseC0 - (tc > 0 ? TILE_OVERLAP_SRC : 0));
      const c1 = Math.min(width, baseC1 + (tc < K - 1 ? TILE_OVERLAP_SRC : 0));
      tiles.push({
        tileRow: tr,
        tileCol: tc,
        r0,
        r1,
        c0,
        c1,
        // Centre of the *non-overlap* core, not the overlapped bbox — so the
        // distance-to-centre tie-break in stitch() rewards labels from the
        // tile that "owns" the cell, not the one whose overlap reaches into
        // it.
        cy: (baseR0 + baseR1) / 2,
        cx: (baseC0 + baseC1) / 2,
      });
    }
  }

  return {
    K,
    coarseWidth: K * TILE_SIZE,
    coarseHeight: K * TILE_SIZE,
    tiles,
  };
}

/**
 * Sample a 32×32 depth tile out of `depthsFull` (row-major, width × height)
 * covering `bounds` in source-pixel space. Uses nearest-neighbour sampling at
 * cell centres. Non-finite source depths fall back to 0 so the result is
 * always a clean numeric array.
 */
export function extractTileDepths32(
  depthsFull: ArrayLike<number>,
  width: number,
  height: number,
  bounds: TileBounds,
): number[] {
  const out = new Array<number>(TILE_SIZE * TILE_SIZE);
  const spanH = Math.max(1, bounds.r1 - bounds.r0);
  const spanW = Math.max(1, bounds.c1 - bounds.c0);
  for (let r = 0; r < TILE_SIZE; r++) {
    const sr = Math.min(
      height - 1,
      Math.max(0, bounds.r0 + Math.floor(((r + 0.5) / TILE_SIZE) * spanH)),
    );
    for (let c = 0; c < TILE_SIZE; c++) {
      const sc = Math.min(
        width - 1,
        Math.max(0, bounds.c0 + Math.floor(((c + 0.5) / TILE_SIZE) * spanW)),
      );
      const v = depthsFull[sr * width + sc];
      out[r * TILE_SIZE + c] =
        typeof v === "number" && Number.isFinite(v) ? v : 0;
    }
  }
  return out;
}

/**
 * Stable content fingerprint for a 32×32 depth tile. Identical tiles across
 * different datasets share a cache entry. Uses the same FNV-1a 32-bit hash
 * as the client-side `hashGrid` so cross-checks line up.
 */
export function tileFingerprint(depths32: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < depths32.length; i++) {
    const v = depths32[i];
    const bits = Math.round((typeof v === "number" ? v : 0) * 1000) & 0xffffffff;
    h ^= bits & 0xff;            h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (bits >>> 8) & 0xff;    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (bits >>> 16) & 0xff;   h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (bits >>> 24) & 0xff;   h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Stitch K×K per-tile label arrays (each length TILE_SIZE²) into a single
 * `coarseWidth × coarseHeight` zones grid.
 *
 * For each output cell we map back into source-pixel space, find every tile
 * whose bbox contains that source point, and pick the tile whose *core*
 * centre is closest (ties broken by tile-index order). The chosen tile's
 * 32×32 label is sampled at the equivalent fractional position. This makes
 * the overlap band a graceful blend without introducing a smoothing model:
 * along a shared edge each side gives way to its neighbour as you cross,
 * because the neighbour's centre is closer.
 *
 * `heuristicForTile(i)` is called lazily to fill tiles whose AI labels are
 * missing (null or wrong length) — letting the caller defer the per-tile
 * heuristic until it's actually needed.
 */
export function stitchTileLabels(
  perTileLabels: Array<string[] | null>,
  plan: TilePlan,
  width: number,
  height: number,
  heuristicForTile: (tileIdx: number) => string[],
): string[] {
  const resolved: string[][] = perTileLabels.map((labels, i) =>
    labels && labels.length === TILE_SIZE * TILE_SIZE ? labels : heuristicForTile(i),
  );

  const out = new Array<string>(plan.coarseWidth * plan.coarseHeight);
  for (let or = 0; or < plan.coarseHeight; or++) {
    const sy = ((or + 0.5) / plan.coarseHeight) * height;
    for (let oc = 0; oc < plan.coarseWidth; oc++) {
      const sx = ((oc + 0.5) / plan.coarseWidth) * width;

      let bestIdx = -1;
      let bestD = Infinity;
      for (let i = 0; i < plan.tiles.length; i++) {
        const t = plan.tiles[i]!;
        if (sy < t.r0 || sy >= t.r1 || sx < t.c0 || sx >= t.c1) continue;
        const dy = sy - t.cy;
        const dx = sx - t.cx;
        const d = dy * dy + dx * dx;
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) {
        for (let i = 0; i < plan.tiles.length; i++) {
          const t = plan.tiles[i]!;
          const dy = sy - t.cy;
          const dx = sx - t.cx;
          const d = dy * dy + dx * dx;
          if (d < bestD) {
            bestD = d;
            bestIdx = i;
          }
        }
      }

      const tile = plan.tiles[bestIdx]!;
      const tr = Math.min(
        TILE_SIZE - 1,
        Math.max(
          0,
          Math.floor(((sy - tile.r0) / Math.max(1e-9, tile.r1 - tile.r0)) * TILE_SIZE),
        ),
      );
      const tc = Math.min(
        TILE_SIZE - 1,
        Math.max(
          0,
          Math.floor(((sx - tile.c0) / Math.max(1e-9, tile.c1 - tile.c0)) * TILE_SIZE),
        ),
      );
      out[or * plan.coarseWidth + oc] =
        resolved[bestIdx]![tr * TILE_SIZE + tc]!;
    }
  }

  return out;
}

/**
 * Run `fn` over `items` with at most `concurrency` in-flight at a time.
 * Order-preserving — `result[i]` corresponds to `items[i]` regardless of
 * completion order. `fn` is responsible for catching its own errors and
 * encoding them in `R`; rejections bubble up and abort the whole run.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  const workers: Promise<void>[] = [];
  for (let w = 0; w < lanes; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = nextIndex++;
          if (i >= items.length) return;
          results[i] = await fn(items[i]!, i);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Tiny greyscale PNG encoder — used to turn a 32×32 tile of depths into the
// `data:image/png;base64,…` URL the Poe vision endpoint expects. Inlined here
// (rather than imported from @workspace/poe) so this module stays a pure,
// stdlib-only helper that's trivially unit-testable.
// ---------------------------------------------------------------------------

/**
 * Render a 32×32 depth tile to a base64 greyscale PNG data URL using the
 * tile's own min/max as the contrast range — so each tile uses its full
 * dynamic range instead of being washed out by the dataset-wide extremes.
 */
export function tileDepthsToPngDataUrl(depths32: ArrayLike<number>): string {
  let minD = Infinity;
  let maxD = -Infinity;
  for (let i = 0; i < depths32.length; i++) {
    const v = depths32[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < minD) minD = v;
    if (v > maxD) maxD = v;
  }
  if (!Number.isFinite(minD)) {
    minD = 0;
    maxD = 1;
  }
  const range = maxD - minD || 1;
  const pixels = new Uint8Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < pixels.length; i++) {
    const v = depths32[i];
    const t = Number.isFinite(v)
      ? Math.max(0, Math.min(1, ((v as number) - minD) / range))
      : 0;
    pixels[i] = Math.round(t * 255);
  }
  const png = encodePngGreyscale(pixels, TILE_SIZE, TILE_SIZE);
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

function encodePngGreyscale(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const rowSize = width + 1; // +1 for per-scanline filter byte
  const raw = new Uint8Array(rowSize * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0; // filter = None
    for (let x = 0; x < width; x++) {
      raw[y * rowSize + 1 + x] = pixels[y * width + x]!;
    }
  }
  const deflated = deflateRawSync(raw);
  const zlibStream = wrapZlibFromRaw(raw, deflated);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = buildChunk("IHDR", buildIhdr(width, height));
  const idat = buildChunk("IDAT", zlibStream);
  const iend = buildChunk("IEND", new Uint8Array(0));
  return concat([sig, ihdr, idat, iend]);
}

/** Build a zlib stream (header + raw deflate + Adler-32 of raw) around `deflated`. */
function wrapZlibFromRaw(raw: Uint8Array, deflated: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + deflated.length + 4);
  out[0] = 0x78; // CMF: deflate, 32K window
  out[1] = 0x9c; // FLG: default level, no preset dict (checksum valid)
  out.set(deflated, 2);
  const adler = adler32(raw);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  dv.setUint32(2 + deflated.length, adler >>> 0);
  return out;
}

function buildIhdr(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(13);
  const view = new DataView(buf.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  buf[8] = 8;  // bit depth
  buf[9] = 0;  // colour type: greyscale
  buf[10] = 0; // compression
  buf[11] = 0; // filter
  buf[12] = 0; // interlace
  return buf;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  return chunk;
}

function adler32(data: Uint8Array): number {
  const MOD = 65521;
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

let _crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ _crcTable[(crc ^ data[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
