/**
 * DriftWaterPlane — R3F animated ocean surface for Drift Planner mode.
 *
 * Renders a large plane at sea-surface Y with a GLSL shader that simulates
 * two scrolling wave layers driven by the resultant wind + tidal current vector.
 * Pointer events on the plane reposition the drift start point (click-to-place).
 *
 * Reverse drift mode:
 *   When reverseModeActive is true, the first click instead sets the catch
 *   location. reverseComputeDrift() is called immediately to compute the
 *   backward path, which is stored in reverseDriftPath for DriftPath to render.
 */

import React, { useRef, useMemo, useCallback, useEffect } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { WORLD_SIZE } from "@/lib/terrain";
import { worldXZToLonLat } from "@/lib/terrain";
import { useDriftStore } from "@/lib/driftStore";
import { computeDrift, reverseComputeDrift } from "@/lib/computeDrift";
import { useSettingsStore } from "@/lib/settingsStore";
import { sampleCurrentAt } from "@/lib/currentsStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

const vertexShader = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform vec2 uFlowDir;
uniform float uWaveAmp;

void main() {
  vUv = uv;
  float wave = sin(position.x * 0.8 + uTime * 0.6 + uFlowDir.x * 2.0)
             * cos(position.z * 0.6 + uTime * 0.5 + uFlowDir.y * 1.5)
             * uWaveAmp;
  vec3 pos = position + vec3(0.0, wave, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform vec2 uFlowDir;

void main() {
  vec2 flow = normalize(uFlowDir + vec2(0.001, 0.001));
  vec2 uv1 = vUv * 6.0 + flow * uTime * 0.03;
  vec2 uv2 = vUv * 10.0 + flow * uTime * 0.05 + vec2(0.4, 0.1);

  float ripple1 = sin(uv1.x * 12.0 + uTime * 0.7) * sin(uv1.y * 10.0 + uTime * 0.5);
  float ripple2 = sin(uv2.x * 18.0 + uTime * 0.9) * sin(uv2.y * 15.0 + uTime * 0.6);
  float ripple = (ripple1 * 0.6 + ripple2 * 0.4) * 0.5 + 0.5;

  vec3 deep    = vec3(0.02, 0.15, 0.35);
  vec3 shallow = vec3(0.08, 0.42, 0.72);
  vec3 foam    = vec3(0.75, 0.88, 0.97);

  vec3 waterColor = mix(deep, shallow, ripple * 0.7);
  waterColor = mix(waterColor, foam, max(0.0, ripple - 0.7) * 1.5);

  float edgeFade = 1.0 - pow(length(vUv - 0.5) * 1.6, 3.0);
  float alpha = clamp(0.82 * edgeFade, 0.0, 0.88);

  gl_FragColor = vec4(waterColor, alpha);
}
`;

interface DriftWaterPlaneProps {
  surfaceY: number;
  terrain: TerrainData;
}

export const DriftWaterPlane: React.FC<DriftWaterPlaneProps> = ({ surfaceY, terrain }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);
  const driftConditions = useDriftStore((s) => s.driftConditions);
  const driftHour = useDriftStore((s) => s.driftHour);
  const lineLengthM = useDriftStore((s) => s.lineLengthM);
  const lineWeightG = useDriftStore((s) => s.lineWeightG);
  const setDriftStart = useDriftStore((s) => s.setDriftStart);
  const setDriftPath = useDriftStore((s) => s.setDriftPath);
  const driftMode = useDriftStore((s) => s.driftMode);
  const boatHeadingDeg = useDriftStore((s) => s.boatHeadingDeg);
  const boatSpeedKnots = useDriftStore((s) => s.boatSpeedKnots);
  const driftStartLat = useDriftStore((s) => s.driftStartLat);
  const driftStartLon = useDriftStore((s) => s.driftStartLon);
  const driftWaypoints = useDriftStore((s) => s.driftWaypoints);
  const addDriftWaypoint = useDriftStore((s) => s.addDriftWaypoint);
  const reverseModeActive = useDriftStore((s) => s.reverseModeActive);
  const setCatchPoint = useDriftStore((s) => s.setCatchPoint);
  const setReverseDriftPath = useDriftStore((s) => s.setReverseDriftPath);
  const boatProfileId = useDriftStore((s) => s.boatProfileId);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uFlowDir: { value: new THREE.Vector2(1, 0) },
        uWaveAmp: { value: 0.18 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 1.2, WORLD_SIZE * 1.2, 32, 32);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  useEffect(() => {
    return () => {
      material.dispose();
      geometry.dispose();
    };
  }, [material, geometry]);

  useFrame((_, delta) => {
    timeRef.current += delta;
    material.uniforms["uTime"]!.value = timeRef.current;

    if (driftConditions) {
      const cond = driftConditions[driftHour % driftConditions.length];
      if (cond) {
        const radWind = (cond.windDegrees * Math.PI) / 180;
        const radTidal = (cond.tidalDegrees * Math.PI) / 180;
        const leeway = cond.windSpeedKnots * 0.03;
        const fx = 0.7 * Math.sin(radTidal) * cond.tidalSpeedKnots + 0.3 * Math.sin(radWind) * leeway;
        const fz = 0.7 * Math.cos(radTidal) * cond.tidalSpeedKnots + 0.3 * Math.cos(radWind) * leeway;
        const len = Math.sqrt(fx * fx + fz * fz) || 1;
        (material.uniforms["uFlowDir"]!.value as THREE.Vector2).set(fx / len, fz / len);
        material.uniforms["uWaveAmp"]!.value = Math.min(0.5, 0.1 + (cond.waveHeightM ?? 0.2) * 0.3);
      }
    }
  });

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const { x: worldX, z: worldZ } = e.point;
      const { lon, lat } = worldXZToLonLat(worldX, worldZ, terrain);

      // ── Reverse drift mode ──────────────────────────────────────────────
      // When reverseModeActive, the click sets the catch location and
      // immediately computes the backwards drift path.
      if (reverseModeActive) {
        if (!driftConditions) return;
        setCatchPoint(lat, lon);
        const reversePath = reverseComputeDrift({
          conditions: driftConditions,
          endLat: lat,
          endLon: lon,
          terrain,
          lineLengthM,
          hours: 24,
          boatProfileId,
        });
        setReverseDriftPath(reversePath);
        return;
      }

      // ── Normal drift / trolling mode ────────────────────────────────────
      const inTrolling = driftMode === "trolling";
      const hasStart = driftStartLat !== null && driftStartLon !== null;
      let nextStartLat = driftStartLat;
      let nextStartLon = driftStartLon;
      let nextWaypoints = driftWaypoints;

      if (inTrolling && hasStart) {
        addDriftWaypoint({ lat, lon });
        nextWaypoints = [...driftWaypoints, { lat, lon }];
      } else {
        setDriftStart(lat, lon);
        nextStartLat = lat;
        nextStartLon = lon;
      }

      if (driftConditions && nextStartLat !== null && nextStartLon !== null) {
        // When the bathymetric currents simulation is enabled, sample the
        // flow field at the boat's current position so the drift path
        // bends with bathymetry instead of using a single ambient vector.
        const currentsEnabled = useSettingsStore.getState().currentsEnabled;
        const sampleFlowAt = currentsEnabled
          ? (lat: number, lon: number) => {
              const { x, z } = lonLatToWorldXZ(lon, lat, terrain);
              return sampleCurrentAt(x, z);
            }
          : undefined;
        const path = computeDrift({
          conditions: driftConditions,
          startLat: nextStartLat,
          startLon: nextStartLon,
          lineLengthM,
          lineWeightG,
          terrain,
          mode: driftMode,
          boatHeadingDeg,
          boatSpeedKnots,
          sampleFlowAt,
          trollWaypoints: nextWaypoints,
        });
        setDriftPath(path);
      }
    },
    [
      terrain, driftConditions, lineLengthM, lineWeightG, setDriftStart, setDriftPath,
      driftMode, boatHeadingDeg, boatSpeedKnots,
      driftStartLat, driftStartLon, driftWaypoints, addDriftWaypoint,
      reverseModeActive, setCatchPoint, setReverseDriftPath, boatProfileId,
    ],
  );

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={[0, surfaceY, 0]}
      renderOrder={3}
      onPointerDown={handlePointerDown}
    />
  );
};
