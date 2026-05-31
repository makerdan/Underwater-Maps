/**
 * DirectionParticleField — reusable R3F particle flow layer.
 *
 * Renders a swarm of small THREE.Points that stream along a heading vector
 * at a speed proportional to magnitude. When a `terrain` grid is provided,
 * each particle's velocity is locally deflected to follow the seafloor's
 * isobaths: real flow bends around shoals and curls into bays, so we sample
 * the depth gradient under every particle and project the heading onto the
 * tangent of the local depth contour. Without `terrain` (or in deep, flat
 * water) the layer falls back to a straight downstream sweep.
 *
 * Particles wrap by lifetime: each one respawns at its upstream spawn point
 * (field centre for grid mode, anchor point for anchored mode) after it has
 * lived long enough to traverse one nominal `span`.
 *
 * Used as the alternative visual style for the Wind / Tide / Current
 * overlays when their per-overlay style setting is "particles". The component
 * mirrors the props of {@link DirectionArrowField} as closely as possible so
 * the two layers are interchangeable from the call site.
 */
import React, { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { WORLD_SIZE, getTerrainSurfaceY } from "@/lib/terrain";

export interface DirectionParticleFieldProps {
  /** Direction the flow points TOWARD, degrees from north, clockwise. */
  directionDeg: number;
  /** Flow magnitude (e.g. knots). Drives streaming speed and density. */
  magnitude: number;
  /** Reference magnitude that maps to ~baseline speed/density. */
  referenceMagnitude?: number;
  /** Hex/css colour for the particles. */
  color: string;
  /** World-Y position of the particle layer. */
  layerY: number;
  /** Particles per row when no `positions` are supplied (grid density). */
  density?: number;
  /**
   * Optional explicit list of (worldX, worldZ) anchor positions. When set,
   * particles are seeded around these anchors (used by the Tide overlay to
   * constrain particles to the shoreline band).
   */
  positions?: Array<[number, number]>;
  /** Base particle size in world units before zoom scaling. */
  baseSize?: number;
  /** When true, particles stream along the heading; false = static dots. */
  animate?: boolean;
  /** Render order for transparency stacking. */
  renderOrder?: number;
  /** Optional opacity multiplier (legend keying, "estimated" data, etc). */
  opacity?: number;
  /**
   * When provided, particles deflect around terrain features. Sampled per
   * particle per frame; cheap (one bilinear depth lookup + two for the
   * gradient finite-difference). Omit for purely flat / heading-only flow.
   */
  terrain?: TerrainData;
}

/**
 * Strength of terrain steering relative to the nominal heading. 0 = no
 * deflection (pure heading), 1 = fully aligned with the local isobath.
 * Tuned by the smoothstep below using local slope.
 */
const DEFLECT_SLOPE_MIN = 0.05;
const DEFLECT_SLOPE_MAX = 0.45;
const DEFLECT_MAX_BLEND = 0.9;
/**
 * Finite-difference offset (world units) used when sampling the depth
 * gradient. 1.0 is smaller than the smallest typical grid cell on a 100 unit
 * world but large enough to avoid quantisation noise from bilinear sampling.
 */
const GRADIENT_EPSILON = 1.0;

export const DirectionParticleField: React.FC<DirectionParticleFieldProps> = ({
  directionDeg,
  magnitude,
  referenceMagnitude = 1,
  color,
  layerY,
  density = 14,
  positions,
  baseSize = 0.6,
  animate = true,
  renderOrder = 9,
  opacity = 0.85,
  terrain,
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  // Denser swarm when there's no explicit position list — particles are cheap
  // compared to arrows so we can afford more of them for a fuller flow look.
  const count = positions
    ? Math.max(positions.length * 4, 96)
    : density * density;

  const { camera } = useThree();

  const dirRad = useMemo(() => (directionDeg * Math.PI) / 180, [directionDeg]);
  // Match DirectionArrowField's heading convention: x = sin, z = -cos.
  const dirVec = useMemo(
    () => new THREE.Vector3(Math.sin(dirRad), 0, -Math.cos(dirRad)).normalize(),
    [dirRad],
  );
  // Perpendicular axis used to seed lateral jitter when a particle respawns.
  const perpVec = useMemo(
    () => new THREE.Vector3(-dirVec.z, 0, dirVec.x),
    [dirVec],
  );

  // Per-particle state (kept in refs so identity is stable across renders).
  // Unlike the previous parametric scheme, we now track *actual* world XZ
  // because the per-particle velocity diverges from the nominal heading as
  // particles deflect around terrain. `age` is normalised to [0, 1) and
  // respawn fires whenever it crosses 1.
  const posXRef = useRef<Float32Array>(new Float32Array(count));
  const posZRef = useRef<Float32Array>(new Float32Array(count));
  const ageRef = useRef<Float32Array>(new Float32Array(count));
  const seedAcrossRef = useRef<Float32Array>(new Float32Array(count));
  const anchorIdxRef = useRef<Int32Array>(new Int32Array(count));
  // Per-particle phase used to give the swarm subtle twinkle so it doesn't
  // look like a flat sheet of dots.
  const phaseRef = useRef<Float32Array>(new Float32Array(count));

  // Span along the heading: how far a particle travels before respawning.
  // Bigger for grid mode (whole-field sweep), smaller for anchored mode so
  // particles cluster near their shoreline anchor.
  const anchors = positions ?? null;
  const span = anchors ? WORLD_SIZE * 0.18 : WORLD_SIZE;
  const acrossSpread = anchors ? WORLD_SIZE * 0.05 : WORLD_SIZE * 0.5;

  // Reset particle state whenever count, anchor set, or nominal heading
  // changes. The heading dependency matters because the spawn point is
  // computed in the (heading, perpendicular) frame.
  useEffect(() => {
    const posX = new Float32Array(count);
    const posZ = new Float32Array(count);
    const age = new Float32Array(count);
    const seedAcross = new Float32Array(count);
    const anchorIdx = new Int32Array(count);
    const phase = new Float32Array(count);
    const anchorCount = anchors ? anchors.length : 0;
    for (let i = 0; i < count; i++) {
      const across = (Math.random() - 0.5) * 2;
      seedAcross[i] = across;
      anchorIdx[i] = anchorCount > 0 ? i % anchorCount : -1;
      phase[i] = Math.random() * Math.PI * 2;
      // Stagger initial ages so the swarm doesn't all respawn together.
      const initAge = Math.random();
      age[i] = initAge;

      let baseX = 0;
      let baseZ = 0;
      if (anchors && anchorCount > 0) {
        const a = anchors[i % anchorCount]!;
        baseX = a[0];
        baseZ = a[1];
      }
      // Spawn upstream of base then walk forward by `initAge * span` along
      // the nominal heading — the per-frame integrator will take over from
      // there with terrain-deflected velocities.
      const along = (initAge - 0.5) * span;
      posX[i] = baseX + dirVec.x * along + perpVec.x * across * acrossSpread;
      posZ[i] = baseZ + dirVec.z * along + perpVec.z * across * acrossSpread;
    }
    posXRef.current = posX;
    posZRef.current = posZ;
    ageRef.current = age;
    seedAcrossRef.current = seedAcross;
    anchorIdxRef.current = anchorIdx;
    phaseRef.current = phase;
    // dirVec / perpVec / acrossSpread / span are all derived from the props
    // captured here, so the exhaustive-deps lint is satisfied implicitly.
  }, [count, anchors, dirVec, perpVec, acrossSpread, span]);

  // Geometry: one vertex per particle, repositioned every frame.
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    );
    return geo;
  }, [count]);

  // Material: round, additive-soft point sprite drawn from a generated canvas
  // so the swarm reads as glowing droplets rather than square pixels.
  const material = useMemo(() => {
    const tex = makeParticleTexture(color);
    return new THREE.PointsMaterial({
      color,
      size: baseSize,
      sizeAttenuation: true,
      transparent: true,
      opacity,
      depthWrite: false,
      map: tex,
      alphaTest: 0.01,
      blending: THREE.AdditiveBlending,
    });
  }, [color, baseSize, opacity]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      if (material.map) material.map.dispose();
    };
  }, [geometry, material]);

  useFrame((_, delta) => {
    const pts = pointsRef.current;
    if (!pts) return;

    const magRatio = Math.max(0.1, magnitude / referenceMagnitude);
    const driftSpeed = animate ? Math.min(2.5, magRatio) : 0;

    // Zoom-aware sizing: keep particles readable from far OVERVIEW shots
    // without exploding into giant blobs up close.
    const camDist = camera.position.length();
    const zoomScale = THREE.MathUtils.clamp(camDist / 60, 0.8, 2.6);
    material.size = baseSize * zoomScale * (0.85 + 0.35 * magRatio);

    // World-units / second the particles travel along the (possibly
    // deflected) flow. Calibrated to match the previous parametric scheme:
    // old wrap was `seedAlong += driftSpeed * 0.12 * delta`, so a particle
    // crossed `span` in `1 / (driftSpeed * 0.12)` seconds.
    const worldSpeed = driftSpeed * 0.12 * span;
    const ageRate = driftSpeed * 0.12; // per second (matches old wrap)

    const posX = posXRef.current;
    const posZ = posZRef.current;
    const age = ageRef.current;
    const seedAcross = seedAcrossRef.current;
    const anchorIdx = anchorIdxRef.current;
    const phase = phaseRef.current;

    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      // Lifetime accounting. Respawn upstream when this particle has lived
      // long enough to nominally traverse one `span`.
      age[i] = (age[i] ?? 0) + delta * ageRate;
      if (age[i]! >= 1) {
        // Respawn at the upstream edge of the local field (anchor + lateral
        // jitter, walked back by half a span along the heading).
        let baseX = 0;
        let baseZ = 0;
        if (anchors) {
          const a = anchors[anchorIdx[i] ?? 0];
          if (a) {
            baseX = a[0];
            baseZ = a[1];
          }
        }
        const across = seedAcross[i] ?? 0;
        posX[i] = baseX - dirVec.x * (span * 0.5) + perpVec.x * across * acrossSpread;
        posZ[i] = baseZ - dirVec.z * (span * 0.5) + perpVec.z * across * acrossSpread;
        age[i] = age[i]! - 1;
      }

      // Compute the locally-deflected unit velocity.
      let vxN = dirVec.x;
      let vzN = dirVec.z;
      if (terrain) {
        const [dx, dz] = deflect(terrain, posX[i]!, posZ[i]!, dirVec.x, dirVec.z);
        vxN = dx;
        vzN = dz;
      }

      // Advance.
      posX[i] = posX[i]! + vxN * worldSpeed * delta;
      posZ[i] = posZ[i]! + vzN * worldSpeed * delta;

      // Small vertical jitter so the layer has thickness rather than reading
      // as a single razor-flat slice.
      const wobble = animate
        ? Math.sin(phase[i]! + age[i]! * Math.PI * 2) * 0.25
        : 0;

      arr[i * 3] = posX[i]!;
      arr[i * 3 + 1] = layerY + wobble;
      arr[i * 3 + 2] = posZ[i]!;
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      renderOrder={renderOrder}
      frustumCulled={false}
    />
  );
};

/**
 * Project a unit heading onto the local depth isobath at (x, z).
 *
 * The seafloor surface Y returned by `getTerrainSurfaceY` is 0 at sea level
 * and decreases (more negative) with depth, so its gradient (dY/dx, dY/dz)
 * points *uphill* — toward shallower water. Real flow tends to follow
 * contours rather than climb shoals, so we remove the component of velocity
 * pointing into the slope and blend toward the resulting tangent based on
 * how steep the local terrain is.
 *
 * Returns a (vx, vz) unit vector. Falls back to the input heading when the
 * floor is essentially flat (open / deep water).
 */
export function deflect(
  terrain: TerrainData,
  x: number,
  z: number,
  vx: number,
  vz: number,
): [number, number] {
  const y0 = getTerrainSurfaceY(terrain, x, z);
  const yx = getTerrainSurfaceY(terrain, x + GRADIENT_EPSILON, z);
  const yz = getTerrainSurfaceY(terrain, x, z + GRADIENT_EPSILON);
  const gx = (yx - y0) / GRADIENT_EPSILON;
  const gz = (yz - y0) / GRADIENT_EPSILON;
  const slope = Math.sqrt(gx * gx + gz * gz);
  if (slope < DEFLECT_SLOPE_MIN) {
    return [vx, vz];
  }
  const nx = gx / slope;
  const nz = gz / slope;
  // Tangent to the contour: original velocity minus its uphill component.
  const dot = vx * nx + vz * nz;
  const tx = vx - dot * nx;
  const tz = vz - dot * nz;
  // Smooth blend from "pure heading" on near-flat ground to "pure isobath
  // following" on steep walls. Capped so steep terrain still preserves a
  // hint of the ambient heading (otherwise particles can stall on perfectly
  // perpendicular slopes).
  const t = Math.min(
    1,
    Math.max(0, (slope - DEFLECT_SLOPE_MIN) / (DEFLECT_SLOPE_MAX - DEFLECT_SLOPE_MIN)),
  );
  const alpha = t * t * (3 - 2 * t) * DEFLECT_MAX_BLEND; // smoothstep
  let ox = vx * (1 - alpha) + tx * alpha;
  let oz = vz * (1 - alpha) + tz * alpha;
  const m = Math.sqrt(ox * ox + oz * oz);
  if (m < 1e-4) return [vx, vz];
  return [ox / m, oz / m];
}

/**
 * Build a 64x64 radial-falloff sprite tinted to `color`. Drawn once per
 * material instance; the GPU bilinear-filters it as it scales.
 */
function makeParticleTexture(color: string): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, hexWithAlpha(color, 0.7));
    grad.addColorStop(1, hexWithAlpha(color, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function hexWithAlpha(color: string, alpha: number): string {
  // Best-effort: handle #rgb / #rrggbb; fall back to rgba(...) of black.
  const c = new THREE.Color(color);
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
