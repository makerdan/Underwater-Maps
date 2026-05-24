import type { ResponsesInputItem, TerrainGrid } from "./types.js";

export function buildVisionInput(
  prompt: string,
  imageDataUrl: string,
): ResponsesInputItem[] {
  return [
    { type: "input_text", text: prompt },
    { type: "input_image", image_url: imageDataUrl },
  ];
}

export function buildMultiModalMessages(
  systemPrompt: string,
  userText: string,
  imageDataUrl: string,
): Array<{ role: string; content: Array<{ type: string; text?: string; image_url?: { url: string } }> }> {
  return [
    {
      role: "system",
      content: [{ type: "text", text: systemPrompt }],
    },
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

export function depthGridToBase64Png(grid: TerrainGrid, targetSize = 256): string {
  const { depths, width, height, minDepth, maxDepth } = grid;
  const range = maxDepth - minDepth || 1;
  const size = targetSize;

  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcX = Math.floor((x / size) * width);
      const srcY = Math.floor((y / size) * height);
      const srcIdx = srcY * width + srcX;
      const depth = typeof depths[srcIdx] === "number" ? (depths[srcIdx] as number) : 0;
      const norm = Math.max(0, Math.min(1, (depth - minDepth) / range));
      const grey = Math.round(norm * 255);
      const dstIdx = (y * size + x) * 4;
      pixels[dstIdx] = grey;
      pixels[dstIdx + 1] = grey;
      pixels[dstIdx + 2] = grey;
      pixels[dstIdx + 3] = 255;
    }
  }

  return buildDataUrlFromPixels(pixels, size, size);
}

function buildDataUrlFromPixels(pixels: Uint8Array, width: number, height: number): string {
  const pngBytes = encodePngGreyscale(pixels, width, height);
  const base64 = Buffer.from(pngBytes).toString("base64");
  return `data:image/png;base64,${base64}`;
}

function encodePngGreyscale(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const { deflateRawSync } = require("zlib") as typeof import("zlib");

  const rowSize = width + 1;
  const rawData = new Uint8Array(rowSize * height);
  for (let y = 0; y < height; y++) {
    rawData[y * rowSize] = 0;
    for (let x = 0; x < width; x++) {
      rawData[y * rowSize + 1 + x] = rgba[(y * width + x) * 4];
    }
  }

  const compressed = deflateRawSync(rawData);

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = buildChunk("IHDR", buildIhdr(width, height));
  const idat = buildChunk("IDAT", compressed);
  const iend = buildChunk("IEND", new Uint8Array(0));

  const total = signature.length + ihdr.length + idat.length + iend.length;
  const png = new Uint8Array(total);
  let offset = 0;
  for (const chunk of [signature, ihdr, idat, iend]) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}

function buildIhdr(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(13);
  const view = new DataView(buf.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  buf[8] = 8;
  buf[9] = 0;
  buf[10] = 0;
  buf[11] = 0;
  buf[12] = 0;
  return buf;
}

function crc32(data: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let _crcTable: Uint32Array | null = null;
function getCrc32Table(): Uint32Array {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    _crcTable[n] = c;
  }
  return _crcTable;
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
