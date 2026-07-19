/**
 * Smoke tests for the shared Three.js / R3F / Drei stubs.
 *
 * These tests import the mock modules DIRECTLY (not via vi.mock) so that
 * any stub gap — a missing export, a constructor that returns undefined, a
 * constant with the wrong type — is caught immediately rather than silently
 * causing `undefined` to flow into real test logic.
 *
 * The suite is intentionally narrow and fast (< 100 ms). It does NOT test
 * Three.js itself; it only verifies that each exported name is present and
 * returns a sensible minimal value.
 */

import { describe, it, expect } from "vitest";

import * as ThreeStub from "./three";
import * as R3FStub from "./r3f";
import * as DreiStub from "./drei";

// ---------------------------------------------------------------------------
// three.ts — classes
// ---------------------------------------------------------------------------

describe("three stub — Color", () => {
  it("is a constructor", () => {
    expect(typeof ThreeStub.Color).toBe("function");
  });

  it("parses a hex string: #ff0000 → r ≈ 1, g=0, b=0", () => {
    const c = new ThreeStub.Color("#ff0000");
    expect(c.r).toBeCloseTo(1, 2);
    expect(c.g).toBeCloseTo(0, 2);
    expect(c.b).toBeCloseTo(0, 2);
  });

  it("parses a hex number: 0x00ff00 → g ≈ 1", () => {
    const c = new ThreeStub.Color(0x00ff00);
    expect(c.g).toBeCloseTo(1, 2);
    expect(c.r).toBeCloseTo(0, 2);
  });

  it("default constructor yields r=g=b=0", () => {
    const c = new ThreeStub.Color();
    expect(c.r).toBe(0);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
  });

  it("clone() copies r/g/b", () => {
    const c = new ThreeStub.Color("#0000ff");
    const d = c.clone();
    expect(d.b).toBeCloseTo(1, 2);
    expect(d.r).toBeCloseTo(0, 2);
  });

  it("set() returns the instance", () => {
    const c = new ThreeStub.Color();
    expect(c.set(1, 0, 0)).toBe(c);
  });

  it("copy() returns the instance", () => {
    const c = new ThreeStub.Color();
    const src = new ThreeStub.Color("#ff0000");
    expect(c.copy(src)).toBe(c);
  });

  it("convertLinearToSRGB() returns the instance", () => {
    const c = new ThreeStub.Color("#ffffff");
    expect(c.convertLinearToSRGB()).toBe(c);
  });

  it("lerpColors() interpolates correctly at α=0.5", () => {
    const c = new ThreeStub.Color();
    const a = new ThreeStub.Color("#000000");
    const b = new ThreeStub.Color("#ffffff");
    c.lerpColors(a, b, 0.5);
    expect(c.r).toBeCloseTo(0.5, 2);
    expect(c.g).toBeCloseTo(0.5, 2);
    expect(c.b).toBeCloseTo(0.5, 2);
  });

  it("dispose() does not throw", () => {
    expect(() => new ThreeStub.Color().dispose()).not.toThrow();
  });
});

describe("three stub — Vector3", () => {
  it("is a constructor", () => {
    expect(typeof ThreeStub.Vector3).toBe("function");
  });

  it("constructor captures x/y/z", () => {
    const v = new ThreeStub.Vector3(1, 2, 3);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
    expect(v.z).toBe(3);
  });

  it("default constructor yields 0,0,0", () => {
    const v = new ThreeStub.Vector3();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it("normalize() returns the instance", () => {
    const v = new ThreeStub.Vector3(1, 0, 0);
    expect(v.normalize()).toBe(v);
  });

  it("copy() returns the instance", () => {
    const v = new ThreeStub.Vector3();
    const src = new ThreeStub.Vector3(5, 6, 7);
    const result = v.copy(src);
    expect(result).toBe(v);
    expect(v.x).toBe(5);
  });

  it("clone() returns a new Vector3 with same values", () => {
    const v = new ThreeStub.Vector3(9, 8, 7);
    const w = v.clone();
    expect(w).not.toBe(v);
    expect(w.x).toBe(9);
    expect(w.z).toBe(7);
  });

  it("set() returns the instance", () => {
    const v = new ThreeStub.Vector3();
    expect(v.set(1, 2, 3)).toBe(v);
  });
});

describe("three stub — generic _Stub subclasses are constructors", () => {
  const stubClasses = [
    "Vector2",
    "Quaternion",
    "Euler",
    "Matrix4",
    "Sphere",
    "Box3",
    "Raycaster",
    "Object3D",
    "Group",
    "Mesh",
    "Points",
    "LineSegments",
    "Line",
    "TextureLoader",
    "Texture",
    "MeshStandardMaterial",
    "MeshBasicMaterial",
    "LineBasicMaterial",
    "PointsMaterial",
    "BufferGeometry",
    "CatmullRomCurve3",
  ] as const;

  for (const name of stubClasses) {
    it(`${name} is a constructor and instantiates without throwing`, () => {
      const Ctor = ThreeStub[name] as new () => object;
      expect(typeof Ctor).toBe("function");
      expect(() => new Ctor()).not.toThrow();
    });
  }

  it("CatmullRomCurve3.getPoints() returns an array", () => {
    const curve = new ThreeStub.CatmullRomCurve3();
    expect(Array.isArray(curve.getPoints())).toBe(true);
  });
});

describe("three stub — PerspectiveCamera", () => {
  it("is a constructor", () => {
    expect(typeof ThreeStub.PerspectiveCamera).toBe("function");
  });

  it("has numeric fov, near, far", () => {
    const cam = new ThreeStub.PerspectiveCamera();
    expect(typeof cam.fov).toBe("number");
    expect(typeof cam.near).toBe("number");
    expect(typeof cam.far).toBe("number");
  });

  it("has a position (Vector3-like)", () => {
    const cam = new ThreeStub.PerspectiveCamera();
    expect(cam.position).toBeDefined();
  });

  it("updateProjectionMatrix() does not throw", () => {
    expect(() => new ThreeStub.PerspectiveCamera().updateProjectionMatrix()).not.toThrow();
  });
});

describe("three stub — BufferAttribute", () => {
  it("is a constructor", () => {
    expect(typeof ThreeStub.BufferAttribute).toBe("function");
  });

  it("stores array and itemSize", () => {
    const arr = new Float32Array([1, 2, 3]);
    const attr = new ThreeStub.BufferAttribute(arr, 3);
    expect(attr.array).toBe(arr);
    expect(attr.itemSize).toBe(3);
  });
});

describe("three stub — Float32BufferAttribute", () => {
  it("is a constructor", () => {
    expect(typeof ThreeStub.Float32BufferAttribute).toBe("function");
  });

  it("stores array and itemSize from Float32Array", () => {
    const arr = new Float32Array([1, 2, 3]);
    const attr = new ThreeStub.Float32BufferAttribute(arr, 3);
    expect(attr.array).toBe(arr);
    expect(attr.itemSize).toBe(3);
  });

  it("converts plain number[] to Float32Array", () => {
    const attr = new ThreeStub.Float32BufferAttribute([1, 2, 3, 4, 5, 6], 3);
    expect(attr.array).toBeInstanceOf(Float32Array);
    expect(attr.array.length).toBe(6);
  });
});

describe("three stub — BufferGeometry setAttribute", () => {
  it("setAttribute stores into .attributes", () => {
    const geo = new ThreeStub.BufferGeometry();
    const arr = new Float32Array([0, 1, 2]);
    const attr = new ThreeStub.Float32BufferAttribute(arr, 3);
    geo.setAttribute("position", attr);
    expect(geo.attributes["position"]).toBe(attr);
    expect(geo.attributes["position"].array).toBe(arr);
  });
});

describe("three stub — PlaneGeometry", () => {
  it("is a constructor", () => {
    expect(typeof ThreeStub.PlaneGeometry).toBe("function");
  });

  it("attributes.position exists and has a Float32Array", () => {
    const geo = new ThreeStub.PlaneGeometry(1, 1, 1, 1);
    expect(geo.attributes.position).toBeDefined();
    expect(geo.attributes.position.array).toBeInstanceOf(Float32Array);
  });

  it("position array has the correct vertex count: (segW+1)*(segH+1)*3", () => {
    const geo = new ThreeStub.PlaneGeometry(10, 10, 4, 4);
    expect(geo.attributes.position.array.length).toBe(5 * 5 * 3);
  });

  it("rotateX() returns the instance", () => {
    const geo = new ThreeStub.PlaneGeometry(1, 1, 1, 1);
    expect(geo.rotateX(Math.PI / 2)).toBe(geo);
  });

  it("dispose() does not throw", () => {
    expect(() => new ThreeStub.PlaneGeometry(1, 1, 1, 1).dispose()).not.toThrow();
  });
});

describe("three stub — ShaderMaterial", () => {
  it("is a constructor", () => {
    expect(typeof ThreeStub.ShaderMaterial).toBe("function");
  });

  it("default constructor yields empty uniforms object", () => {
    const mat = new ThreeStub.ShaderMaterial();
    expect(typeof mat.uniforms).toBe("object");
    expect(mat.uniforms).not.toBeNull();
  });

  it("accepts uniforms via constructor options", () => {
    const mat = new ThreeStub.ShaderMaterial({
      uniforms: { uColor: { value: 0xff0000 } },
    });
    expect(mat.uniforms.uColor).toBeDefined();
    expect(mat.uniforms.uColor.value).toBe(0xff0000);
  });

  it("dispose() does not throw", () => {
    expect(() => new ThreeStub.ShaderMaterial().dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// three.ts — numeric constants
// ---------------------------------------------------------------------------

describe("three stub — numeric constants", () => {
  it("DoubleSide is a number", () => expect(typeof ThreeStub.DoubleSide).toBe("number"));
  it("FrontSide is a number", () => expect(typeof ThreeStub.FrontSide).toBe("number"));
  it("BackSide is a number", () => expect(typeof ThreeStub.BackSide).toBe("number"));
  it("AdditiveBlending is a number", () => expect(typeof ThreeStub.AdditiveBlending).toBe("number"));
  it("NormalBlending is a number", () => expect(typeof ThreeStub.NormalBlending).toBe("number"));
  it("ClampToEdgeWrapping is a number", () => expect(typeof ThreeStub.ClampToEdgeWrapping).toBe("number"));
  it("RepeatWrapping is a number", () => expect(typeof ThreeStub.RepeatWrapping).toBe("number"));
  it("LinearFilter is a number", () => expect(typeof ThreeStub.LinearFilter).toBe("number"));

  it("DoubleSide, FrontSide, BackSide are distinct", () => {
    const { DoubleSide, FrontSide, BackSide } = ThreeStub;
    expect(DoubleSide).not.toBe(FrontSide);
    expect(DoubleSide).not.toBe(BackSide);
    expect(FrontSide).not.toBe(BackSide);
  });
});

describe("three stub — string constants", () => {
  it("SRGBColorSpace is a non-empty string", () => {
    expect(typeof ThreeStub.SRGBColorSpace).toBe("string");
    expect(ThreeStub.SRGBColorSpace.length).toBeGreaterThan(0);
  });

  it("NoColorSpace is a string (may be empty)", () => {
    expect(typeof ThreeStub.NoColorSpace).toBe("string");
  });

  it("SRGBColorSpace and NoColorSpace are distinct", () => {
    expect(ThreeStub.SRGBColorSpace).not.toBe(ThreeStub.NoColorSpace);
  });
});

// ---------------------------------------------------------------------------
// three.ts — MathUtils
// ---------------------------------------------------------------------------

describe("three stub — MathUtils", () => {
  it("is defined", () => {
    expect(ThreeStub.MathUtils).toBeDefined();
  });

  it("clamp(5, 0, 10) → 5", () => {
    expect(ThreeStub.MathUtils.clamp(5, 0, 10)).toBe(5);
  });

  it("clamp(-1, 0, 10) → 0", () => {
    expect(ThreeStub.MathUtils.clamp(-1, 0, 10)).toBe(0);
  });

  it("clamp(15, 0, 10) → 10", () => {
    expect(ThreeStub.MathUtils.clamp(15, 0, 10)).toBe(10);
  });

  it("degToRad(180) ≈ Math.PI", () => {
    expect(ThreeStub.MathUtils.degToRad(180)).toBeCloseTo(Math.PI, 5);
  });

  it("degToRad(0) → 0", () => {
    expect(ThreeStub.MathUtils.degToRad(0)).toBe(0);
  });

  it("lerp(0, 10, 0.5) → 5", () => {
    expect(ThreeStub.MathUtils.lerp(0, 10, 0.5)).toBe(5);
  });

  it("lerp(0, 10, 0) → 0", () => {
    expect(ThreeStub.MathUtils.lerp(0, 10, 0)).toBe(0);
  });

  it("lerp(0, 10, 1) → 10", () => {
    expect(ThreeStub.MathUtils.lerp(0, 10, 1)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// r3f.tsx — @react-three/fiber stub
// ---------------------------------------------------------------------------

describe("r3f stub — exports", () => {
  it("Canvas is defined and is a function", () => {
    expect(typeof R3FStub.Canvas).toBe("function");
  });

  it("useThree is defined and is a function", () => {
    expect(typeof R3FStub.useThree).toBe("function");
  });

  it("useThree() returns an object with camera, gl, scene, size", () => {
    const state = R3FStub.useThree();
    expect(state).toBeDefined();
    expect(state.camera).toBeDefined();
    expect(state.gl).toBeDefined();
    expect(state.scene).toBeDefined();
    expect(state.size).toBeDefined();
  });

  it("useThree().camera has fov, position, quaternion", () => {
    const { camera } = R3FStub.useThree();
    expect(typeof camera.fov).toBe("number");
    expect(camera.position).toBeDefined();
    expect(camera.quaternion).toBeDefined();
  });

  it("useThree().size has width and height", () => {
    const { size } = R3FStub.useThree();
    expect(typeof size.width).toBe("number");
    expect(typeof size.height).toBe("number");
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });

  it("useFrame is defined and is a function", () => {
    expect(typeof R3FStub.useFrame).toBe("function");
  });

  it("useFrame() does not throw", () => {
    expect(() => R3FStub.useFrame(() => {})).not.toThrow();
  });

  it("extend is defined and is a function", () => {
    expect(typeof R3FStub.extend).toBe("function");
  });

  it("extend() does not throw", () => {
    expect(() => R3FStub.extend({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// drei.tsx — @react-three/drei stub
// ---------------------------------------------------------------------------

describe("drei stub — exports", () => {
  it("Billboard is defined and is a function", () => {
    expect(typeof DreiStub.Billboard).toBe("function");
  });

  it("Line is defined and is a function", () => {
    expect(typeof DreiStub.Line).toBe("function");
  });

  it("Text is defined and is a function", () => {
    expect(typeof DreiStub.Text).toBe("function");
  });
});
