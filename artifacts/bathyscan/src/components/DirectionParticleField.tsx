/**
 * DirectionParticleField — reusable R3F particle flow layer.
 *
 * Renders a swarm of small THREE.Points that stream along a single heading
 * vector at a speed proportional to magnitude. Particles wrap around the
 * field bounds so the visual is continuous: when one drifts past the
 * "downstream" edge it respawns at the upstream edge with a fresh lateral
 * jitter, giving the impression of an infinite flow without ever popping.
 *
 * Used as the alternative visual style for the Wind / Tide / Current
 * overlays (settings.conditionsOverlayStyle === "particles"). The component
 * mirrors the props of {@link DirectionArrowField} as closely as possible so
 * the two layers are interchangeable from the call site.
 */
import React, { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { WORLD_SIZE } from "@/lib/terrain";

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
}

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
  renderOrder = 3,
  opacity = 0.85,
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
  // `seedAlong` / `seedAcross` are the particle's parametric position in a
  // local (heading, perpendicular) frame anchored at field centre. Wrapping
  // along `seedAlong` makes respawn trivial: `% span`.
  const seedAlongRef = useRef<Float32Array>(new Float32Array(count));
  const seedAcrossRef = useRef<Float32Array>(new Float32Array(count));
  // Anchor indices map each particle to its base position from `positions`.
  // When `positions` is undefined the anchor is field centre (0, 0).
  const anchorIdxRef = useRef<Int32Array>(new Int32Array(count));
  // Per-particle phase used to give the swarm subtle twinkle so it doesn't
  // look like a flat sheet of dots.
  const phaseRef = useRef<Float32Array>(new Float32Array(count));

  // Reset particle state whenever count or anchor set changes.
  useEffect(() => {
    const seedAlong = new Float32Array(count);
    const seedAcross = new Float32Array(count);
    const anchorIdx = new Int32Array(count);
    const phase = new Float32Array(count);
    const anchorCount = positions ? positions.length : 0;
    for (let i = 0; i < count; i++) {
      seedAlong[i] = Math.random();
      seedAcross[i] = (Math.random() - 0.5) * 2;
      anchorIdx[i] = anchorCount > 0 ? i % anchorCount : -1;
      phase[i] = Math.random() * Math.PI * 2;
    }
    seedAlongRef.current = seedAlong;
    seedAcrossRef.current = seedAcross;
    anchorIdxRef.current = anchorIdx;
    phaseRef.current = phase;
  }, [count, positions]);

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

    // Span along the heading: how far a particle travels before respawning.
    // Bigger for grid mode (whole-field sweep), smaller for anchored mode
    // (particles cluster near their shoreline anchor).
    const anchors = positions ?? null;
    const span = anchors ? WORLD_SIZE * 0.18 : WORLD_SIZE;
    const acrossSpread = anchors ? WORLD_SIZE * 0.05 : WORLD_SIZE * 0.5;

    const seedAlong = seedAlongRef.current;
    const seedAcross = seedAcrossRef.current;
    const anchorIdx = anchorIdxRef.current;
    const phase = phaseRef.current;

    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      // Advance along-heading parameter; wrap [0, 1) for seamless respawn.
      seedAlong[i] = ((seedAlong[i] ?? 0) + delta * driftSpeed * 0.12) % 1;
      if (seedAlong[i]! < 0) seedAlong[i]! += 1;

      const along = (seedAlong[i]! - 0.5) * span;
      const across = (seedAcross[i] ?? 0) * acrossSpread;

      let baseX = 0;
      let baseZ = 0;
      if (anchors) {
        const a = anchors[anchorIdx[i] ?? 0];
        if (a) {
          baseX = a[0];
          baseZ = a[1];
        }
      }

      const x = baseX + dirVec.x * along + perpVec.x * across;
      const z = baseZ + dirVec.z * along + perpVec.z * across;
      // Small vertical jitter so the layer has thickness rather than reading
      // as a single razor-flat slice.
      const wobble = animate
        ? Math.sin(phase[i]! + seedAlong[i]! * Math.PI * 2) * 0.25
        : 0;

      arr[i * 3] = x;
      arr[i * 3 + 1] = layerY + wobble;
      arr[i * 3 + 2] = z;
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
