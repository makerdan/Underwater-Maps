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
const STREAMLINE_ANIM_SPEED = 0.4; // cycles per second

interface StreamlineLayerProps {
  field: FlowField;
  surfaceY: number;
}

const CurrentStreamlineLayer: React.FC<StreamlineLayerProps> = ({ field, surfaceY }) => {
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

  // Pre-allocate line geometries (one per streamline).
  const lines = useMemo(() => {
    return seeds.map(() => {
      const positions = new Float32Array(STREAMLINE_SAMPLES * 3);
      const colors = new Float32Array(STREAMLINE_SAMPLES * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      });
      return { geo, mat, positions, colors };
    });
  }, [seeds]);

  useFrame((_, delta) => {
    timeRef.current += delta;
    const tphase = (timeRef.current * STREAMLINE_ANIM_SPEED) % 1;
    const maxS = Math.max(0.001, field.maxSpeed);

    for (let k = 0; k < seeds.length; k++) {
      const seed = seeds[k]!;
      const { positions, colors, geo } = lines[k]!;

      let x = seed.x;
      let z = seed.z;
      for (let i = 0; i < STREAMLINE_SAMPLES; i++) {
        positions[i * 3] = x;
        positions[i * 3 + 1] = surfaceY + 0.06;
        positions[i * 3 + 2] = z;

        const s = sampleFlowField(field, x, z);
        const norm = s.speed / maxS;
        const c = speedToColor(norm);
        // Animate along arc-length using tphase to fade in/out leading edge.
        const head = (i / STREAMLINE_SAMPLES + tphase) % 1;
        const alpha = 0.25 + 0.75 * Math.sin(head * Math.PI);
        colors[i * 3] = c.r * alpha;
        colors[i * 3 + 1] = c.g * alpha;
        colors[i * 3 + 2] = c.b * alpha;

        if (s.speed === 0) {
          // Stalled — collapse remaining samples to this point.
          for (let j = i + 1; j < STREAMLINE_SAMPLES; j++) {
            positions[j * 3] = x;
            positions[j * 3 + 1] = surfaceY + 0.06;
            positions[j * 3 + 2] = z;
            colors[j * 3] = 0; colors[j * 3 + 1] = 0; colors[j * 3 + 2] = 0;
          }
          break;
        }
        x += (s.vx / s.speed) * STREAMLINE_STEP;
        z += (s.vz / s.speed) * STREAMLINE_STEP;
      }
      (geo.attributes["position"] as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes["color"] as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} renderOrder={4}>
      {lines.map((ln, i) => (
        <primitive key={i} object={new THREE.Line(ln.geo, ln.mat)} />
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
      {showStreamlines && <CurrentStreamlineLayer field={field} surfaceY={surfaceY} />}
    </>
  );
};
