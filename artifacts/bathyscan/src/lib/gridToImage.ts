import type { TerrainData } from "@workspace/api-client-react";

/**
 * Convert a TerrainData depth grid to a 256×256 grayscale PNG base64 data URL.
 * Lighter pixels = deeper, darker pixels = shallower — matches the Poe AI prompt.
 *
 * Samples the source grid using nearest-neighbour at 256×256 output resolution
 * regardless of the source grid's native resolution.
 */
export function gridToBase64Png(grid: TerrainData): string {
  const SIZE = 256;
  const { depths, minDepth, maxDepth, width: W, height: H } = grid;
  const depthRange = maxDepth - minDepth || 1;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");

  const imageData = ctx.createImageData(SIZE, SIZE);

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const srcRow = Math.round((row / (SIZE - 1)) * (H - 1));
      const srcCol = Math.round((col / (SIZE - 1)) * (W - 1));
      const depth = depths[srcRow * W + srcCol] ?? minDepth;
      const t = Math.max(0, Math.min(1, (depth - minDepth) / depthRange));
      const v = Math.round(t * 255);
      const i = (row * SIZE + col) * 4;
      imageData.data[i]     = v;
      imageData.data[i + 1] = v;
      imageData.data[i + 2] = v;
      imageData.data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}
