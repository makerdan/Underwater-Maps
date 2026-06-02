/**
 * Shared Three.js stub for vitest.
 *
 * Covers all use cases found across the test suite:
 *  - Functional Color (handles both "#rrggbb" string and 0xRRGGBB number)
 *  - Functional Vector3 with normalize/copy
 *  - Functional BufferAttribute / PlaneGeometry (needed for terrain math tests)
 *  - Functional ShaderMaterial with uniforms support
 *  - Generic stubs for the remaining classes (geometry, materials, objects)
 *  - All widely-used constants and MathUtils
 *
 * Wire-up: __mocks__/three.ts re-exports this file so that
 *   vi.mock("three")          (no factory)
 * automatically uses these stubs.  Individual tests no longer need an
 * inline factory.  They still need the vi.mock("three") call — just
 * without the bulky implementation.
 */

export class Color {
  r = 0;
  g = 0;
  b = 0;

  constructor(hex?: string | number) {
    if (typeof hex === "string") {
      const n = parseInt(hex.replace("#", ""), 16);
      this.r = ((n >> 16) & 0xff) / 255;
      this.g = ((n >> 8) & 0xff) / 255;
      this.b = (n & 0xff) / 255;
    } else if (typeof hex === "number") {
      this.r = ((hex >> 16) & 0xff) / 255;
      this.g = ((hex >> 8) & 0xff) / 255;
      this.b = (hex & 0xff) / 255;
    }
  }

  set(_r: number, _g: number, _b: number) { return this; }
  copy(_c: Color) { return this; }
  clone() {
    const c = new Color();
    c.r = this.r;
    c.g = this.g;
    c.b = this.b;
    return c;
  }
  dispose() {}
  convertLinearToSRGB() { return this; }
  lerpColors(a: Color, b: Color, alpha: number) {
    this.r = a.r + (b.r - a.r) * alpha;
    this.g = a.g + (b.g - a.g) * alpha;
    this.b = a.b + (b.b - a.b) * alpha;
    return this;
  }
}

export class Vector3 {
  x = 0;
  y = 0;
  z = 0;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(_x: number, _y: number, _z: number) { return this; }
  copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  normalize() { return this; }
  dispose() {}
}

class _Stub {
  r = 0;
  g = 0;
  b = 0;
  set(..._args: unknown[]) { return this; }
  copy(..._args: unknown[]) { return this; }
  clone() { return this; }
  dispose() {}
  lerpColors() { return this; }
  computeVertexNormals() {}
  rotateX() { return this; }
  setAttribute() {}
  setDrawRange() {}
  normalizeNormals() {}
  getPoints() { return []; }
  attributes: Record<string, { array: Float32Array }> = {};
}

export class Vector2 extends _Stub {}
export class Quaternion extends _Stub {}
export class Euler extends _Stub {}
export class Matrix4 extends _Stub {}
export class Sphere extends _Stub {}
export class Box3 extends _Stub {}
export class Raycaster extends _Stub {}
export class Object3D extends _Stub {}
export class Group extends _Stub {}
export class Mesh extends _Stub {}
export class Points extends _Stub {}
export class LineSegments extends _Stub {}
export class Line extends _Stub {}
export class TextureLoader extends _Stub {}
export class Texture extends _Stub {}
export class MeshStandardMaterial extends _Stub {}
export class MeshBasicMaterial extends _Stub {}
export class LineBasicMaterial extends _Stub {}
export class PointsMaterial extends _Stub {}
export class BufferGeometry extends _Stub {}
export class PerspectiveCamera extends _Stub {
  fov = 60;
  near = 0.1;
  far = 2000;
  position = new Vector3();
  quaternion = new Quaternion();
  updateProjectionMatrix() {}
  lookAt() {}
}

export class CatmullRomCurve3 extends _Stub {
  getPoints() { return []; }
}

export class BufferAttribute {
  array: Float32Array;
  itemSize: number;
  constructor(arr: Float32Array, itemSize: number) {
    this.array = arr;
    this.itemSize = itemSize;
  }
}

export class PlaneGeometry {
  attributes: Record<string, { array: Float32Array }> = {};

  constructor(w: number, h: number, segW: number, segH: number) {
    const vertsX = segW + 1;
    const vertsZ = segH + 1;
    const pos = new Float32Array(vertsX * vertsZ * 3);
    for (let r = 0; r < vertsZ; r++) {
      for (let c = 0; c < vertsX; c++) {
        const i = (r * vertsX + c) * 3;
        pos[i] = (c / segW - 0.5) * w;
        pos[i + 1] = 0;
        pos[i + 2] = (r / segH - 0.5) * h;
      }
    }
    this.attributes = { position: { array: pos } };
  }

  rotateX(_angle: number) { return this; }
  setAttribute(_name: string, _attr: BufferAttribute) {}
  computeVertexNormals() {}
  dispose() {}
}

export class ShaderMaterial {
  uniforms: Record<string, { value: unknown }> = {};
  constructor(opts: { uniforms?: Record<string, { value: unknown }> } = {}) {
    this.uniforms = opts.uniforms ?? {};
  }
  dispose() {}
}

export const DoubleSide = 2;
export const FrontSide = 0;
export const BackSide = 1;
export const AdditiveBlending = 1;
export const NormalBlending = 2;
export const ClampToEdgeWrapping = 1001;
export const RepeatWrapping = 1000;
export const LinearFilter = 1006;
export const SRGBColorSpace = "srgb";
export const NoColorSpace = "";

export const MathUtils = {
  clamp: (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi),
  degToRad: (d: number) => (d * Math.PI) / 180,
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
};
