/**
 * DirectionArrowField — reusable R3F instanced arrow field.
 *
 * Renders a grid of arrows across the dataset extent pointing in the same
 * direction with subtle along-heading drift animation. Used by Wind, Tide,
 * and Current overlays as well as the original Drift Planner current arrows.
 *
 * The arrows live on a horizontal layer at `layerY` world units and animate
 * by sliding each instance along the heading vector by an amount proportional
 * to magnitude. Instances also pulse opacity (via scale) to make direction
 * obvious at a glance even when stationary.
 */
import React, { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { WORLD_SIZE } from "@/lib/terrain";

export interface DirectionArrowFieldProps {
  /** Direction the flow points TOWARD, degrees from north, clockwise. */
  directionDeg: number;
  /** Flow magnitude (e.g. knots). Used for length scaling and drift speed. */
  magnitude: number;
  /** Reference magnitude that maps to ~1.0 visual scale. */
  referenceMagnitude?: number;
  /** Hex/css colour for the arrows. */
  color: string;
  /** World-Y position of the arrow layer. */
  layerY: number;
  /** Arrows per row (grid density). Ignored if `positions` is provided. */
  density?: number;
  /**
   * Optional explicit list of (worldX, worldZ) positions. When provided, the
   * field renders one arrow per entry instead of a uniform grid. Used by the
   * Tide overlay to constrain arrows to the shoreline / shallow-water band.
   */
  positions?: Array<[number, number]>;
  /** Base arrow size before magnitude scaling. */
  baseScale?: number;
  /** When true, arrows slide along the heading; false = static. */
  animate?: boolean;
  /** Render order for transparency stacking. */
  renderOrder?: number;
  /** Optional opacity multiplier (legend keying). */
  opacity?: number;
}

function buildArrowGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.55);
  shape.lineTo(0.22, 0.12);
  shape.lineTo(0.09, 0.12);
  shape.lineTo(0.09, -0.5);
  shape.lineTo(-0.09, -0.5);
  shape.lineTo(-0.09, 0.12);
  shape.lineTo(-0.22, 0.12);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export const DirectionArrowField: React.FC<DirectionArrowFieldProps> = ({
  directionDeg,
  magnitude,
  referenceMagnitude = 1,
  color,
  layerY,
  density = 6,
  positions,
  baseScale = 1.4,
  animate = true,
  renderOrder = 3,
  opacity = 0.85,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = positions ? positions.length : density * density;
  const progressRef = useRef<Float32Array>(new Float32Array(count));
  const basePositions = useRef<Array<[number, number]>>([]);
  const { camera } = useThree();
  const geometry = useMemo(() => buildArrowGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [color, opacity],
  );

  // Meteorological → math: bearing 0=N maps to world +Z(−), 90=E to +X(+).
  // After our rotateX setup, heading vector in XZ plane is:
  //   x = sin(bearing), z = -cos(bearing)
  const dirRad = useMemo(() => (directionDeg * Math.PI) / 180, [directionDeg]);
  const dirVec = useMemo(
    () => new THREE.Vector3(Math.sin(dirRad), 0, -Math.cos(dirRad)).normalize(),
    [dirRad],
  );

  // Build positions (X, Z) — Y comes from layerY (live, can change).
  useEffect(() => {
    if (positions && positions.length) {
      basePositions.current = positions;
    } else {
      const spacing = WORLD_SIZE / (density + 1);
      const grid: Array<[number, number]> = [];
      for (let row = 0; row < density; row++) {
        for (let col = 0; col < density; col++) {
          const x = -WORLD_SIZE / 2 + spacing * (col + 1);
          const z = -WORLD_SIZE / 2 + spacing * (row + 1);
          grid.push([x, z]);
        }
      }
      basePositions.current = grid;
    }
    progressRef.current = new Float32Array(count).map(() => Math.random());
  }, [density, count, positions]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const magScale = Math.max(0.25, Math.min(2.4, magnitude / referenceMagnitude));
    const driftSpeed = animate ? Math.min(3.0, magnitude / referenceMagnitude) : 0;

    // Zoom-aware scaling: bigger arrows when camera is far so they remain
    // readable from the OVERVIEW camera; smaller when up close so they don't
    // clobber the scene.
    const camDist = camera.position.length();
    const zoomScale = THREE.MathUtils.clamp(camDist / 60, 0.7, 2.4);

    const dummy = new THREE.Object3D();
    // Three.js rotation.y is around +Y. We want the arrow's "up" (+Z after
    // shape rotation) to align with dirVec. The default arrow points along
    // -Z (because shape moveTo(0, 0.55) puts tip at +Y in 2D, then we rotate
    // -PI/2 around X bringing +Y down to -Z). So rotate by atan2(x, -z) of
    // dirVec to align: yaw = atan2(dirVec.x, -dirVec.z) = atan2(sin, cos) = dirRad
    const yaw = dirRad;
    const step = WORLD_SIZE / density;

    for (let i = 0; i < count; i++) {
      const base = basePositions.current[i];
      if (!base) continue;

      progressRef.current[i] = ((progressRef.current[i] ?? 0) + delta * driftSpeed * 0.15) % 1;
      const t = progressRef.current[i] ?? 0;

      const travel = (t - 0.5) * step * 0.9;
      const x = base[0] + dirVec.x * travel;
      const z = base[1] + dirVec.z * travel;
      const pulse = 0.4 + 0.6 * Math.sin(t * Math.PI);
      const scale = baseScale * magScale * zoomScale * pulse;

      dummy.position.set(x, layerY, z);
      dummy.rotation.y = yaw;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      renderOrder={renderOrder}
      frustumCulled={false}
    />
  );
};
