import { describe, it, expect } from "vitest";
import {
  planTiles,
  extractTileDepths32,
  tileFingerprint,
  stitchTileLabels,
  mapWithConcurrency,
  tileDepthsToPngDataUrl,
  TILE_SIZE,
  MAX_TILES_PER_SIDE,
} from "../tileClassify.js";

describe("planTiles", () => {
  it("falls through to K=1 for small datasets", () => {
    const plan = planTiles(64, 64);
    expect(plan.K).toBe(1);
    expect(plan.coarseWidth).toBe(32);
    expect(plan.coarseHeight).toBe(32);
    expect(plan.tiles).toHaveLength(1);
  });

  it("scales up tile count with resolution", () => {
    expect(planTiles(128, 128).K).toBe(2);
    expect(planTiles(256, 256).K).toBe(4);
  });

  it("caps tile count at MAX_TILES_PER_SIDE per axis", () => {
    const plan = planTiles(1024, 1024);
    expect(plan.K).toBe(MAX_TILES_PER_SIDE);
    expect(plan.tiles.length).toBeLessThanOrEqual(
      MAX_TILES_PER_SIDE * MAX_TILES_PER_SIDE,
    );
  });

  it("honours a caller-supplied maxPerSide cap", () => {
    expect(planTiles(1024, 1024, 2).K).toBe(2);
  });

  it("includes overlap on interior edges but not on outer borders", () => {
    const plan = planTiles(128, 128);
    // K=2, so 4 tiles. The top-left tile starts at (0,0) with no overlap on
    // its top/left edges; bottom-right starts inside the source with overlap
    // on its top/left.
    const tl = plan.tiles[0]!;
    expect(tl.r0).toBe(0);
    expect(tl.c0).toBe(0);
    const br = plan.tiles[plan.tiles.length - 1]!;
    expect(br.r1).toBe(128);
    expect(br.c1).toBe(128);
    expect(br.r0).toBeLessThan(64);
    expect(br.c0).toBeLessThan(64);
  });
});

describe("extractTileDepths32", () => {
  it("samples exactly TILE_SIZE² cells from the source", () => {
    const W = 128;
    const H = 128;
    const depths = new Array(W * H).fill(0).map((_, i) => i);
    const plan = planTiles(W, H);
    const out = extractTileDepths32(depths, W, H, plan.tiles[0]!);
    expect(out).toHaveLength(TILE_SIZE * TILE_SIZE);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("replaces non-finite source depths with 0", () => {
    const depths = new Array(64 * 64).fill(NaN);
    const plan = planTiles(64, 64);
    const out = extractTileDepths32(depths, 64, 64, plan.tiles[0]!);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

describe("tileFingerprint", () => {
  it("returns a stable 8-char hex hash", () => {
    const depths = new Array(TILE_SIZE * TILE_SIZE).fill(0).map((_, i) => i * 0.1);
    const fp = tileFingerprint(depths);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(tileFingerprint(depths)).toBe(fp);
  });

  it("changes when any cell changes", () => {
    const a = new Array(TILE_SIZE * TILE_SIZE).fill(1);
    const b = a.slice();
    b[42] = 2;
    expect(tileFingerprint(a)).not.toBe(tileFingerprint(b));
  });
});

describe("stitchTileLabels", () => {
  it("returns a coarseWidth × coarseHeight grid", () => {
    const plan = planTiles(128, 128);
    const labels = plan.tiles.map((_, i) =>
      new Array(TILE_SIZE * TILE_SIZE).fill(String.fromCharCode(65 + i)) as string[],
    );
    const out = stitchTileLabels(labels, plan, 128, 128, () => []);
    expect(out).toHaveLength(plan.coarseWidth * plan.coarseHeight);
  });

  it("uses heuristicForTile when a per-tile result is null", () => {
    const plan = planTiles(128, 128);
    const labels: Array<string[] | null> = plan.tiles.map(() => null);
    let calls = 0;
    const out = stitchTileLabels(labels, plan, 128, 128, (i) => {
      calls++;
      return new Array(TILE_SIZE * TILE_SIZE).fill(`H${i}`);
    });
    // Heuristic should be invoked once per missing tile, not per output cell.
    expect(calls).toBe(plan.tiles.length);
    // Each tile's quadrant of the output should carry that tile's heuristic.
    const quad0 = out[0]!;
    expect(quad0.startsWith("H")).toBe(true);
  });

  it("each tile dominates its own quadrant (centre cells)", () => {
    const plan = planTiles(128, 128);
    // K=2: 4 tiles. Label each tile entirely with its index.
    const labels = plan.tiles.map((_, i) =>
      new Array(TILE_SIZE * TILE_SIZE).fill(`T${i}`) as string[],
    );
    const out = stitchTileLabels(labels, plan, 128, 128, () => []);
    // The centre of tile 0's quadrant should report T0.
    const cw = plan.coarseWidth;
    const ch = plan.coarseHeight;
    const tileQH = ch / plan.K;
    const tileQW = cw / plan.K;
    for (let tr = 0; tr < plan.K; tr++) {
      for (let tc = 0; tc < plan.K; tc++) {
        const idx = tr * plan.K + tc;
        const row = Math.floor((tr + 0.5) * tileQH);
        const col = Math.floor((tc + 0.5) * tileQW);
        expect(out[row * cw + col]).toBe(`T${idx}`);
      }
    }
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order in results", async () => {
    const items = [10, 20, 30, 40, 50];
    const out = await mapWithConcurrency(items, 2, async (x, i) => {
      await new Promise((r) => setTimeout(r, (items.length - i) * 5));
      return x * 2;
    });
    expect(out).toEqual([20, 40, 60, 80, 100]);
  });

  it("caps concurrent inflight calls", async () => {
    let inflight = 0;
    let peak = 0;
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    await mapWithConcurrency(items, 3, async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight--;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("tileDepthsToPngDataUrl", () => {
  it("produces a valid base64 PNG data URL with PNG magic bytes", () => {
    const depths = new Array(TILE_SIZE * TILE_SIZE).fill(0).map((_, i) => i);
    const url = tileDepthsToPngDataUrl(depths);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const b64 = url.slice("data:image/png;base64,".length);
    const bytes = Buffer.from(b64, "base64");
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(Array.from(bytes.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it("handles a constant tile (zero dynamic range) without throwing", () => {
    const depths = new Array(TILE_SIZE * TILE_SIZE).fill(5);
    const url = tileDepthsToPngDataUrl(depths);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });
});
