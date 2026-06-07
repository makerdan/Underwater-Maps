/**
 * CurrentsLayer — Coordinates the bathymetric currents visualization.
 *
 * Lives inside <Canvas>. Reads settings + tidal data, builds the flow field
 * (memoized on terrain + ambient + tide phase), publishes it to
 * currentsStore so Drift Planner can sample it, and renders any of the three
 * R3F visualization layers the user has enabled (particles, arrows,
 * streamlines).
 *
 * Renders nothing when `currentsEnabled` is false or terrain isn't loaded.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useCurrentsStore } from "@/lib/currentsStore";
import {
  buildFlowField,
  fingerprintFor,
  sampleFlowField,
  tidePhaseToAmbient,
  type FlowField,
} from "@/lib/flowField";
import { speedToColor, speedToThreeColor } from "@/lib/currentColor";
import { WORLD_SIZE, MAX_DEPTH_WORLD, getTerrainSurfaceY } from "@/lib/terrain";

// ----- Animated particles -----------------------------------------------------

interface ParticleLayerProps {
  field: FlowField;
  surfaceY: number;
  terrain: TerrainData;
}

const PARTICLE_COUNT = 800;
const PARTICLE_SIZE = 0.35;
/** World units per second per knot of ambient speed. */
const WORLD_UNITS_PER_KNOT = 0.5;
/** Particle lifetime in seconds before respawn. */
const PARTICLE_LIFETIME = 4.0;

const CurrentParticleLayer: React.FC<ParticleLayerProps> = ({ field, surfaceY, terrain }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const ageRef = useRef<Float32Array>(new Float32Array(PARTICLE_COUNT));

  const { positions, colors } = useMemo(() => {
    const p = new Float32Array(PARTICLE_COUNT * 3);
    const c = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      p[i * 3] = (Math.random() - 0.5) * WORLD_SIZE;
      p[i * 3 + 1] = surfaceY - 0.1;
      p[i * 3 + 2] = (Math.random() - 0.5) * WORLD_SIZE;
      ageRef.current[i] = Math.random() * PARTICLE_LIFETIME;
    }
    return { positions: p, colors: c };
  }, [surfaceY]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [positions, colors]);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: PARTICLE_SIZE,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    [],
  );

  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);

  useEffect(() => {
    return () => { material.dispose(); };
  }, [material]);

  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    const posAttr = points.geometry.attributes["position"] as THREE.BufferAttribute;
    const colAttr = points.geometry.attributes["color"] as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;
    const maxS = Math.max(0.001, field.maxSpeed);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      ageRef.current[i] = (ageRef.current[i] ?? 0) + delta;
      let respawn = (ageRef.current[i] ?? 0) > PARTICLE_LIFETIME;

      const x = pos[i * 3]!;
      const z = pos[i * 3 + 2]!;
      const s = sampleFlowField(field, x, z);
      if (s.speed === 0) respawn = true;

      if (respawn) {
        pos[i * 3] = (Math.random() - 0.5) * WORLD_SIZE;
        pos[i * 3 + 2] = (Math.random() - 0.5) * WORLD_SIZE;
        pos[i * 3 + 1] = surfaceY - 0.1;
        ageRef.current[i] = 0;
        col[i * 3] = 0;
        col[i * 3 + 1] = 0;
        col[i * 3 + 2] = 0;
        continue;
      }

      pos[i * 3] = x + s.vx * delta * WORLD_UNITS_PER_KNOT;
      pos[i * 3 + 2] = z + s.vz * delta * WORLD_UNITS_PER_KNOT;
      // Stay slightly above terrain surface (clamp upward if needed)
      const tY = getTerrainSurfaceY(terrain, pos[i * 3]!, pos[i * 3 + 2]!);
      pos[i * 3 + 1] = Math.max(tY + 0.4, surfaceY - 0.1);

      const c = speedToColor(s.speed / maxS);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} material={material} renderOrder={4} />
  );
};

// ----- Instanced arrows coloured by speed ------------------------------------

const ARROW_DENSITY = 18; // ARROW_DENSITY × ARROW_DENSITY arrows
const ARROW_BASE_SCALE = 1.4;

function buildArrowGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5);
  shape.lineTo(0.20, 0.05);
  shape.lineTo(0.08, 0.05);
  shape.lineTo(0.08, -0.5);
  shape.lineTo(-0.08, -0.5);
  shape.lineTo(-0.08, 0.05);
  shape.lineTo(-0.20, 0.05);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

interface ArrowLayerProps {
  field: FlowField;
  surfaceY: number;
}

const CurrentArrowLayer: React.FC<ArrowLayerProps> = ({ field, surfaceY }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = ARROW_DENSITY * ARROW_DENSITY;
  const geometry = useMemo(() => buildArrowGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        vertexColors: false,
        color: "#ffffff",
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();
    const spacing = WORLD_SIZE / (ARROW_DENSITY + 1);
    const maxS = Math.max(0.001, field.maxSpeed);

    for (let row = 0; row < ARROW_DENSITY; row++) {
      for (let col = 0; col < ARROW_DENSITY; col++) {
        const i = row * ARROW_DENSITY + col;
        const x = -WORLD_SIZE / 2 + spacing * (col + 1);
        const z = -WORLD_SIZE / 2 + spacing * (row + 1);
        const s = sampleFlowField(field, x, z);
        const norm = s.speed / maxS;
        const scale = (s.speed === 0 ? 0 : ARROW_BASE_SCALE * (0.35 + 0.85 * norm));

        dummy.position.set(x, surfaceY + 0.05, z);
        dummy.rotation.y = Math.atan2(s.vx, s.vz);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        speedToThreeColor(norm, tmpColor);
        mesh.setColorAt(i, tmpColor);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [field, surfaceY]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      renderOrder={4}
    />
  );
};

// ----- Animated streamlines --------------------------------------------------

const STREAMLINE_COUNT = 36;
const STREAMLINE_SAMPLES = 24;
const STREAMLINE_STEP = 0.7; // world units per integration step
/**
 * Number of dash cycles visible along a streamline's full traced length when
 * every sample is at unit-normalized speed. With STREAMLINE_SAMPLES = 24 this
 * yields roughly 3 marching dashes per line — busy enough to read direction
 * but not noisy.
 */
const STREAMLINE_DASH_FREQ = 3.0;
/** Cycles per second a feature on the line completes (visual pacing). */
const STREAMLINE_MARCH_HZ = 0.6;

interface StreamlineLayerProps {
  field: FlowField;
  surfaceY: number;
  /** When false, holds the marching phase steady (animation paused). */
  animate: boolean;
}

const CurrentStreamlineLayer: React.FC<StreamlineLayerProps> = ({ field, surfaceY, animate }) => {
  const groupRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);

  const seeds = useMemo(() => {
    const arr: Array<{ x: number; z: number }> = [];
    const n = Math.ceil(Math.sqrt(STREAMLINE_COUNT));
    const span = WORLD_SIZE * 0.92;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (arr.length >= STREAMLINE_COUNT) break;
        const x = -span / 2 + (i + 0.5) * (span / n) + (Math.random() - 0.5) * 1.5;
        const z = -span / 2 + (j + 0.5) * (span / n) + (Math.random() - 0.5) * 1.5;
        arr.push({ x, z });
      }
    }
    return arr;
  }, []);

  /**
   * Allocate geometry/material/buffers ONCE per seed set. We never recreate
   * GPU resources for tide-phase ambient changes — instead we mutate the
   * existing position/baseColor/phaseCoord buffers in place via the effect
   * below. This keeps allocations stable while auto-advance is running.
   */
  const lines = useMemo(() => {
    return seeds.map(() => {
      const positions = new Float32Array(STREAMLINE_SAMPLES * 3);
      const colors = new Float32Array(STREAMLINE_SAMPLES * 3);
      const baseColors = new Float32Array(STREAMLINE_SAMPLES * 3);
      const phaseCoord = new Float32Array(STREAMLINE_SAMPLES);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      });
      return { geo, mat, positions, colors, baseColors, phaseCoord };
    });
  }, [seeds]);

  // Dispose GPU resources only when the seed set changes (essentially never)
  // or this layer unmounts.
  useEffect(() => {
    return () => {
      for (const ln of lines) {
        ln.geo.dispose();
        ln.mat.dispose();
      }
    };
  }, [lines]);

  /**
   * Re-trace every streamline when the flow field or surface changes, writing
   * into the existing buffers. Per vertex we store:
   *   - `positions`: world-space polyline samples
   *   - `baseColors`: the unmodulated speed colour
   *   - `phaseCoord`: a unitless "fluid-time" coordinate τ that increases
   *     faster where the flow is slow. A dash riding the current keeps τ
   *     constant, so animating brightness with sin(2π·(τ − t·MARCH_HZ))
   *     produces dashes that march at the local fluid speed.
   * Per-frame work then collapses to a single sin() per vertex with no
   * flow-field integration — strictly cheaper than the previous
   * trace-every-frame implementation.
   */
  useEffect(() => {
    const maxS = Math.max(0.001, field.maxSpeed);
    for (let k = 0; k < seeds.length; k++) {
      const seed = seeds[k]!;
      const { positions, baseColors, phaseCoord, geo } = lines[k]!;

      let x = seed.x;
      let z = seed.z;
      let tau = 0;
      let stalledFrom = STREAMLINE_SAMPLES;
      for (let i = 0; i < STREAMLINE_SAMPLES; i++) {
        positions[i * 3] = x;
        positions[i * 3 + 1] = surfaceY + 0.06;
        positions[i * 3 + 2] = z;

        const s = sampleFlowField(field, x, z);
        const norm = s.speed / maxS;
        const c = speedToColor(norm);
        baseColors[i * 3] = c.r;
        baseColors[i * 3 + 1] = c.g;
        baseColors[i * 3 + 2] = c.b;

        if (s.speed === 0) {
          stalledFrom = i + 1;
          for (let j = i + 1; j < STREAMLINE_SAMPLES; j++) {
            positions[j * 3] = x;
            positions[j * 3 + 1] = surfaceY + 0.06;
            positions[j * 3 + 2] = z;
            baseColors[j * 3] = 0;
            baseColors[j * 3 + 1] = 0;
            baseColors[j * 3 + 2] = 0;
            phaseCoord[j] = tau;
          }
          break;
        }
        // dτ = (arc step in normalized speed units). Using normalized speed
        // keeps the visual dash wavelength stable across fields with very
        // different magnitudes while preserving the relative
        // faster-here-slower-there feel.
        const dtau = STREAMLINE_STEP * (norm > 0 ? 1 / Math.max(0.05, norm) : 0);
        tau += dtau;
        phaseCoord[i] = tau;
        x += (s.vx / s.speed) * STREAMLINE_STEP;
        z += (s.vz / s.speed) * STREAMLINE_STEP;
      }

      // Normalize phaseCoord so the line spans STREAMLINE_DASH_FREQ cycles
      // end-to-end regardless of how far it actually traced before stalling.
      const lastIdx = Math.max(0, stalledFrom - 1);
      const tauMax = phaseCoord[lastIdx] || 1;
      for (let i = 0; i < STREAMLINE_SAMPLES; i++) {
        phaseCoord[i] = (phaseCoord[i]! / tauMax) * STREAMLINE_DASH_FREQ;
      }

      (geo.attributes["position"] as THREE.BufferAttribute).needsUpdate = true;
    }
  }, [lines, seeds, field, surfaceY]);

  useFrame((_, delta) => {
    if (animate) timeRef.current += delta;
    const phase = timeRef.current * STREAMLINE_MARCH_HZ;
    const TWO_PI = Math.PI * 2;

    for (let k = 0; k < lines.length; k++) {
      const { geo, colors, baseColors, phaseCoord } = lines[k]!;
      for (let i = 0; i < STREAMLINE_SAMPLES; i++) {
        // Brightness wave moves against τ at MARCH_HZ cycles/sec — dashes
        // appear to march downstream at the local fluid speed.
        const wave = Math.sin(TWO_PI * (phaseCoord[i]! - phase));
        const alpha = 0.25 + 0.75 * (0.5 + 0.5 * wave);
        colors[i * 3] = baseColors[i * 3]! * alpha;
        colors[i * 3 + 1] = baseColors[i * 3 + 1]! * alpha;
        colors[i * 3 + 2] = baseColors[i * 3 + 2]! * alpha;
      }
      (geo.attributes["color"] as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  // Build the THREE.Line objects once per stable line set so React doesn't
  // recreate them on every field change.
  const lineObjects = useMemo(
    () => lines.map((ln) => new THREE.Line(ln.geo, ln.mat)),
    [lines],
  );

  return (
    <group ref={groupRef} renderOrder={4}>
      {lineObjects.map((obj, i) => (
        <primitive key={i} object={obj} />
      ))}
    </group>
  );
};

// ----- Coordinator -----------------------------------------------------------

interface CurrentsLayerProps {
  terrain: TerrainData;
  /** Live NOAA-derived ambient (post tide-phase). null when unavailable. */
  noaaAmbient: { speedKt: number; directionDeg: number } | null;
}

export const CurrentsLayer: React.FC<CurrentsLayerProps> = ({ terrain, noaaAmbient }) => {
  const enabled = useSettingsStore((s) => s.currentsEnabled);
  const source = useSettingsStore((s) => s.currentsSource);
  const manualDir = useSettingsStore((s) => s.currentsManualDirectionDeg);
  const manualSpeed = useSettingsStore((s) => s.currentsManualSpeedKt);
  const tidePhase = useSettingsStore((s) => s.currentsTidePhase);
  const autoAdvance = useSettingsStore((s) => s.currentsAutoAdvance);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const setTidePhase = useSettingsStore((s) => s.setCurrentsTidePhase);
  const showParticles = useSettingsStore((s) => s.currentsShowParticles);
  const showArrows = useSettingsStore((s) => s.currentsShowArrows);
  const showStreamlines = useSettingsStore((s) => s.currentsShowStreamlines);
  const setField = useCurrentsStore((s) => s.setField);

  // Auto-advance the tide phase scrubber when the user has enabled it.
  // 1 cycle per ~30 wall-clock seconds (visual, not real-time).
  useFrame((_, delta) => {
    if (!enabled || !autoAdvance || reducedMotion) return;
    const next = (tidePhase + delta / 30) % 1;
    if (Math.abs(next - tidePhase) > 0.001) setTidePhase(next);
  });

  // Pick the base ambient based on source.
  const baseAmbient = useMemo(() => {
    if (source === "noaa" && noaaAmbient) return noaaAmbient;
    return { speedKt: manualSpeed, directionDeg: manualDir };
  }, [source, noaaAmbient, manualSpeed, manualDir]);

  // Apply tide-phase modulation on top of the base ambient.
  const phaseAmbient = useMemo(
    () => tidePhaseToAmbient(baseAmbient.speedKt, baseAmbient.directionDeg, tidePhase),
    [baseAmbient, tidePhase],
  );

  // Build the flow field; memoized via a fingerprint that includes terrain
  // identity and the post-phase ambient vector.
  const fieldFingerprint = fingerprintFor(terrain, {
    ambientSpeedKnots: phaseAmbient.speedKnots,
    ambientDirectionDeg: phaseAmbient.directionDeg,
  });
  const field = useMemo(() => {
    if (!enabled) return null;
    return buildFlowField(terrain, {
      ambientSpeedKnots: phaseAmbient.speedKnots,
      ambientDirectionDeg: phaseAmbient.directionDeg,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fieldFingerprint]);

  // Publish the field to the runtime store for sampling by Drift Planner.
  useEffect(() => {
    setField(field);
    return () => setField(null);
  }, [field, setField]);

  if (!enabled || !field) return null;

  // Sea-surface Y in world coordinates.
  const depthRange = (terrain.maxDepth - terrain.minDepth) || 1;
  const surfaceY = (terrain.minDepth / depthRange) * MAX_DEPTH_WORLD;

  return (
    <>
      {showParticles && (
        <CurrentParticleLayer field={field} surfaceY={surfaceY} terrain={terrain} />
      )}
      {showArrows && <CurrentArrowLayer field={field} surfaceY={surfaceY} />}
      {showStreamlines && (
        <CurrentStreamlineLayer
          field={field}
          surfaceY={surfaceY}
          animate={autoAdvance && !reducedMotion}
        />
      )}
    </>
  );
};
