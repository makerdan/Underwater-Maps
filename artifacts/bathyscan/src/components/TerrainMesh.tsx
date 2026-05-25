import React, { useMemo, useEffect, useRef, useCallback } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { buildTerrainGeometry, buildTerrainSkirtGeometry, computeZoneWeights, computeSlopeAttribute, WORLD_SIZE } from "@/lib/terrain";
import { getTerrainTextures } from "@/lib/textures";
import { createTerrainShaderMaterial } from "@/lib/terrainShader";
import { useClassificationStore } from "@/lib/classificationStore";
import { useUiStore } from "@/lib/uiStore";
import { useHighlightStore } from "@/lib/highlightStore";
import { useHabitatStore } from "@/lib/habitatStore";
import { useSettingsStore } from "@/lib/settingsStore";

/**
 * Tiling scale — number of texture tile repeats across the full WORLD_SIZE.
 * Tune via VITE_TEXTURE_TILING env var; default gives ~8 world-unit tiles.
 */
const TILING_SCALE = (() => {
  const raw = (import.meta.env as Record<string, unknown>)["VITE_TEXTURE_TILING"];
  const parsed = typeof raw === "string" ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : WORLD_SIZE / 8;
})();

interface TerrainMeshProps {
  grid: TerrainData;
}

/**
 * Renders a 3D seafloor terrain mesh from a TerrainData grid.
 *
 * - Builds BufferGeometry via buildTerrainGeometry + depth-based zone weight attribute.
 * - Adds a per-vertex `slope` attribute (degrees) for the highlight overlay.
 * - Uses a custom GLSL ShaderMaterial (terrainShader.ts) that blends four
 *   procedural tiling textures (sand/sediment/silt/basalt) by per-vertex
 *   zone weights, then tints with the depth colormap colour.
 * - When AI classification completes, the zone weights are upgraded in-place
 *   (70% AI + 30% depth) without rebuilding the full geometry.
 * - Fades in (opacity 0→1 over ~400 ms) whenever the terrain grid swaps.
 * - Updates per-frame uniforms: lamp position, zone overlay toggle, highlight mode.
 * - Disposes old geometry when the grid prop changes to prevent GPU leaks.
 * - Exposes a ref to the underlying THREE.Mesh for raycasting.
 */
export const TerrainMesh = React.forwardRef<THREE.Mesh, TerrainMeshProps>(
  ({ grid }, ref) => {
    const prevGeometryRef = useRef<THREE.BufferGeometry | null>(null);
    const prevSkirtGeometryRef = useRef<THREE.BufferGeometry | null>(null);
    const fadeRef = useRef({ opacity: 0, fading: false });

    // Subscribe to AI zone map (updates when classification completes)
    const zoneMap = useClassificationStore((s) => s.zoneMap);
    const colormapTheme = useSettingsStore((s) => s.colormapTheme);
    const paintMode = useUiStore((s) => s.zonePaintMode);

    // Brush radius in grid cells. Scales gently with resolution so it feels
    // consistent across 128×128 and 512×512 grids.
    const brushRadius = Math.max(2, Math.round(grid.resolution / 64));

    /**
     * Convert an R3F world-space hit point on the terrain into a (row, col)
     * grid coordinate, then dispatch a paint stroke into the classification
     * store. Used by onPointerDown / onPointerMove below.
     */
    const paintAtEvent = useCallback(
      (e: ThreeEvent<PointerEvent>) => {
        const { point } = e;
        const N = grid.resolution;
        // Plane spans [-WORLD_SIZE/2, +WORLD_SIZE/2] on X and Z; row = +Z, col = +X
        const u = (point.x + WORLD_SIZE / 2) / WORLD_SIZE;
        const v = (point.z + WORLD_SIZE / 2) / WORLD_SIZE;
        if (u < 0 || u > 1 || v < 0 || v > 1) return;
        const col = Math.round(u * (N - 1));
        const row = Math.round(v * (N - 1));
        const { zonePaintSlot } = useUiStore.getState();
        useClassificationStore.getState().paintSlot(
          row,
          col,
          brushRadius,
          zonePaintSlot,
          grid.waterType as "saltwater" | "freshwater",
          N,
        );
      },
      [grid, brushRadius],
    );

    const onPointerDown = useCallback(
      (e: ThreeEvent<PointerEvent>) => {
        if (!useUiStore.getState().zonePaintMode) return;
        e.stopPropagation();
        // Capture so subsequent moves/up are delivered even if the cursor
        // briefly leaves the mesh's intersected face.
        (e.target as Element | undefined)?.setPointerCapture?.(e.pointerId);
        paintAtEvent(e);
      },
      [paintAtEvent],
    );

    const onPointerMove = useCallback(
      (e: ThreeEvent<PointerEvent>) => {
        if (!useUiStore.getState().zonePaintMode) return;
        // Only paint while a button is held (left = bit 1)
        if ((e.buttons & 1) === 0) return;
        e.stopPropagation();
        paintAtEvent(e);
      },
      [paintAtEvent],
    );

    const onPointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
      if (!useUiStore.getState().zonePaintMode) return;
      (e.target as Element | undefined)?.releasePointerCapture?.(e.pointerId);
    }, []);

    // Textures are a lazy singleton — computed once, shared forever.
    const textures = useMemo(() => getTerrainTextures(), []);

    // Geometry rebuild whenever the grid or colormap theme changes.
    // Initial zone weights are depth-based; they'll be upgraded by the zoneMap effect below.
    // Slope attribute is computed once per grid and never changes.
    const geometry = useMemo(() => {
      const geo = buildTerrainGeometry(grid, colormapTheme);
      const weights = computeZoneWeights(grid);
      geo.setAttribute("zoneWeight", new THREE.BufferAttribute(weights, 4));
      const slopes = computeSlopeAttribute(grid);
      geo.setAttribute("slope", new THREE.BufferAttribute(slopes, 1));
      return geo;
    }, [grid, colormapTheme]);

    // Material is created once (textures never change).
    const material = useMemo(() => {
      return createTerrainShaderMaterial(textures, TILING_SCALE);
    }, [textures]);

    // Skirt (side walls + flat floor) geometry — rebuilt when grid changes so
    // its top edge exactly tracks the terrain's edge vertices.
    const skirtGeometry = useMemo(() => buildTerrainSkirtGeometry(grid), [grid]);

    // Skirt material — opaque dark "rock", visually distinct from the textured
    // top surface. Transparent so we can drive its opacity from the same fade.
    const skirtMaterial = useMemo(() => {
      return new THREE.MeshStandardMaterial({
        color: 0x2a2622,
        roughness: 0.95,
        metalness: 0.0,
        side: THREE.FrontSide,
        transparent: true,
        opacity: 0,
      });
    }, []);

    // Upgrade zone weights in-place when AI classification arrives.
    // This avoids a full geometry rebuild — only the attribute buffer is updated.
    useEffect(() => {
      if (!zoneMap || zoneMap.length !== grid.resolution * grid.resolution) return;

      const blendedWeights = computeZoneWeights(grid, zoneMap);
      const attr = geometry.getAttribute("zoneWeight") as THREE.BufferAttribute | undefined;
      if (attr) {
        (attr.array as Float32Array).set(blendedWeights);
        attr.needsUpdate = true;
      }
    }, [zoneMap, grid, geometry]);

    // Dispose old geometry to free GPU memory.
    useEffect(() => {
      const prev = prevGeometryRef.current;
      if (prev && prev !== geometry) prev.dispose();
      prevGeometryRef.current = geometry;
      return () => {
        geometry.dispose();
      };
    }, [geometry]);

    // Dispose old skirt geometry on grid change / unmount.
    useEffect(() => {
      const prev = prevSkirtGeometryRef.current;
      if (prev && prev !== skirtGeometry) prev.dispose();
      prevSkirtGeometryRef.current = skirtGeometry;
      return () => {
        skirtGeometry.dispose();
      };
    }, [skirtGeometry]);

    // Dispose material when it changes (only happens if textures change, which
    // currently never happens — but guard for future correctness).
    useEffect(() => {
      return () => {
        material.dispose();
      };
    }, [material]);

    // Dispose skirt material on unmount.
    useEffect(() => {
      return () => {
        skirtMaterial.dispose();
      };
    }, [skirtMaterial]);

    // Sync grid depth range into shader when grid changes.
    useEffect(() => {
      material.uniforms["uGridMinDepth"]!.value = grid.minDepth;
      material.uniforms["uGridMaxDepth"]!.value = grid.maxDepth;
    }, [grid, material]);

    // Trigger fade-in whenever the loaded grid changes.
    useEffect(() => {
      material.uniforms["uOpacity"]!.value = 0;
      skirtMaterial.opacity = 0;
      fadeRef.current.opacity = 0;
      fadeRef.current.fading = true;
    }, [grid, material, skirtMaterial]);

    // Track the last DataTexture we uploaded so we can dispose it when it changes.
    const habitatTexRef = useRef<THREE.DataTexture | null>(null);

    // Upload a new DataTexture whenever habitat scores change.
    useEffect(() => {
      const scores = useHabitatStore.getState().scores;
      const N = grid.resolution;

      // Dispose previous texture
      if (habitatTexRef.current) {
        habitatTexRef.current.dispose();
        habitatTexRef.current = null;
      }

      if (scores && scores.length === N * N) {
        const tex = new THREE.DataTexture(
          scores,
          N,
          N,
          THREE.RedFormat,
          THREE.FloatType,
        );
        tex.needsUpdate = true;
        material.uniforms["uHabitatTex"]!.value = tex;
        habitatTexRef.current = tex;
      }
    // We deliberately subscribe to scores via useHabitatStore state below in useFrame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Subscribe to habitat scores and re-run texture upload on change.
    const habitatScores = useHabitatStore((s) => s.scores);
    const activeSpecies = useHabitatStore((s) => s.activeSpecies);

    useEffect(() => {
      const N = grid.resolution;

      if (habitatTexRef.current) {
        habitatTexRef.current.dispose();
        habitatTexRef.current = null;
      }

      if (habitatScores && habitatScores.length === N * N) {
        const tex = new THREE.DataTexture(
          habitatScores,
          N,
          N,
          THREE.RedFormat,
          THREE.FloatType,
        );
        tex.needsUpdate = true;
        material.uniforms["uHabitatTex"]!.value = tex;
        habitatTexRef.current = tex;
      }
    }, [habitatScores, grid, material]);

    // Animate opacity 0→1 (~400 ms at 60 fps), keep lamp position in sync,
    // and reflect zone overlay + highlight + habitat state from stores.
    useFrame((state, delta) => {
      const f = fadeRef.current;
      if (f.fading) {
        f.opacity = Math.min(1, f.opacity + delta * 2.5);
        material.uniforms["uOpacity"]!.value = f.opacity;
        skirtMaterial.opacity = f.opacity;
        if (f.opacity >= 1) f.fading = false;
      }
      // Lamp = camera (submersible viewpoint)
      material.uniforms["uLampPos"]!.value.copy(state.camera.position);

      // Zone overlay toggle (read from store every frame for instant response)
      const overlayEnabled = useUiStore.getState().zoneOverlayEnabled;
      material.uniforms["uZoneOverlay"]!.value = overlayEnabled ? 1 : 0;

      // Highlight overlay (query panel)
      const { mode, params } = useHighlightStore.getState();
      const modeMap: Record<string, number> = { none: 0, depthRange: 1, slope: 2, zone: 3 };
      material.uniforms["uHighlightMode"]!.value = modeMap[mode] ?? 0;
      material.uniforms["uHighlightMin"]!.value  = params.min;
      material.uniforms["uHighlightMax"]!.value  = params.max;

      // Habitat overlay
      material.uniforms["uShowHabitat"]!.value = activeSpecies ? 1 : 0;
    });

    return (
      <>
        <mesh
          ref={ref}
          geometry={geometry}
          material={material}
          onPointerDown={paintMode ? onPointerDown : undefined}
          onPointerMove={paintMode ? onPointerMove : undefined}
          onPointerUp={paintMode ? onPointerUp : undefined}
        />
        <mesh geometry={skirtGeometry} material={skirtMaterial} raycast={() => null} />
      </>
    );
  },
);
TerrainMesh.displayName = "TerrainMesh";
