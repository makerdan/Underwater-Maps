/**
 * Procedural terrain texture generation.
 *
 * Generates four tiling colour textures + matching normal maps for the seafloor
 * bottom texture system using seeded 2D simplex noise (fractal Brownian motion).
 * Textures are created once as a lazy singleton and shared across all terrain
 * mesh instances.
 *
 * Zones:
 *   sand      — shallow/shelf    light tan, subtle ripple
 *   sediment  — mid-slope        dark grey-brown, granular
 *   silt      — abyssal plain    pale grey-blue, nearly smooth
 *   basalt    — trench/volcanic  near-black, sharp crags
 */
import * as THREE from "three";
import { createNoise2D } from "simplex-noise";

const TEX_SIZE = 256;

/** Seeded LCG — ensures identical textures on every page load. */
function makeSeededRng(seed: number) {
  let s = (Math.abs(seed) | 0) || 1;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    s = s >>> 0;
    return s / 0x100000000;
  };
}

const noiseSand = createNoise2D(makeSeededRng(42));
const noiseSediment = createNoise2D(makeSeededRng(137));
const noiseSilt = createNoise2D(makeSeededRng(271));
const noiseBasalt = createNoise2D(makeSeededRng(529));

/** Fractal Brownian motion — sum octaves of noise for richer texture. */
function fbm(
  noiseFn: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves: number,
  baseFreq: number,
): number {
  let value = 0;
  let amplitude = 1;
  let freq = baseFreq;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    value += noiseFn(x * freq, y * freq) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    freq *= 2;
  }
  return value / total; // [-1, 1]
}

interface TexConfig {
  r: number;
  g: number;
  b: number;
  contrast: number;
  freq: number;
  octaves: number;
  normalStrength: number;
}

const CONFIGS: Record<string, TexConfig> = {
  sand: { r: 218, g: 190, b: 145, contrast: 0.13, freq: 4, octaves: 3, normalStrength: 4 },
  sediment: { r: 92, g: 78, b: 62, contrast: 0.32, freq: 7, octaves: 4, normalStrength: 8 },
  silt: { r: 168, g: 175, b: 192, contrast: 0.07, freq: 2, octaves: 2, normalStrength: 1.5 },
  basalt: { r: 38, g: 33, b: 32, contrast: 0.48, freq: 11, octaves: 5, normalStrength: 14 },
};

function generateColorCanvas(
  type: string,
  noiseFn: (x: number, y: number) => number,
): HTMLCanvasElement {
  const cfg = CONFIGS[type]!;
  const canvas = document.createElement("canvas");
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);

  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const nx = x / TEX_SIZE;
      const ny = y / TEX_SIZE;
      const n = fbm(noiseFn, nx, ny, cfg.octaves, cfg.freq); // [-1,1]
      const f = 1 + n * cfg.contrast;
      const i = (y * TEX_SIZE + x) * 4;
      img.data[i]     = Math.round(Math.max(0, Math.min(255, cfg.r * f)));
      img.data[i + 1] = Math.round(Math.max(0, Math.min(255, cfg.g * f)));
      img.data[i + 2] = Math.round(Math.max(0, Math.min(255, cfg.b * f)));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function generateNormalCanvas(
  noiseFn: (x: number, y: number) => number,
  freq: number,
  octaves: number,
  strength: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const eps = 1 / TEX_SIZE;

  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const nx = x / TEX_SIZE;
      const ny = y / TEX_SIZE;
      const dx = fbm(noiseFn, nx + eps, ny, octaves, freq) - fbm(noiseFn, nx - eps, ny, octaves, freq);
      const dz = fbm(noiseFn, nx, ny + eps, octaves, freq) - fbm(noiseFn, nx, ny - eps, octaves, freq);
      // Tangent-space normal from height-field gradient
      const nx_ = -dx * strength;
      const nz_ = -dz * strength;
      const len = Math.sqrt(nx_ * nx_ + nz_ * nz_ + 1);
      const i = (y * TEX_SIZE + x) * 4;
      img.data[i]     = Math.round((nx_ / len * 0.5 + 0.5) * 255); // R = X
      img.data[i + 1] = Math.round((nz_ / len * 0.5 + 0.5) * 255); // G = Y (Z in tangent space)
      img.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);   // B = Z (up)
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function makeTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export interface TerrainTextures {
  colorTextures: [
    THREE.CanvasTexture,
    THREE.CanvasTexture,
    THREE.CanvasTexture,
    THREE.CanvasTexture,
  ];
  normalMaps: [
    THREE.CanvasTexture,
    THREE.CanvasTexture,
    THREE.CanvasTexture,
    THREE.CanvasTexture,
  ];
}

let _cached: TerrainTextures | null = null;

/**
 * Lazy singleton — generates all eight textures once and caches them.
 * Must be called inside a browser context (uses HTMLCanvasElement).
 */
export function getTerrainTextures(): TerrainTextures {
  if (_cached) return _cached;

  const sandCfg = CONFIGS["sand"]!;
  const sedCfg = CONFIGS["sediment"]!;
  const siltCfg = CONFIGS["silt"]!;
  const basaltCfg = CONFIGS["basalt"]!;

  _cached = {
    colorTextures: [
      makeTexture(generateColorCanvas("sand", noiseSand)),
      makeTexture(generateColorCanvas("sediment", noiseSediment)),
      makeTexture(generateColorCanvas("silt", noiseSilt)),
      makeTexture(generateColorCanvas("basalt", noiseBasalt)),
    ],
    normalMaps: [
      makeTexture(generateNormalCanvas(noiseSand, sandCfg.freq, sandCfg.octaves, sandCfg.normalStrength)),
      makeTexture(generateNormalCanvas(noiseSediment, sedCfg.freq, sedCfg.octaves, sedCfg.normalStrength)),
      makeTexture(generateNormalCanvas(noiseSilt, siltCfg.freq, siltCfg.octaves, siltCfg.normalStrength)),
      makeTexture(generateNormalCanvas(noiseBasalt, basaltCfg.freq, basaltCfg.octaves, basaltCfg.normalStrength)),
    ],
  };
  return _cached;
}
