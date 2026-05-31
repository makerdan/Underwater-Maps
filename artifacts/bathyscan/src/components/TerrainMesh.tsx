import React, { useMemo, useEffect, useRef, useCallback } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { buildTerrainGeometry, buildTerrainSkirtGeometry, computeZoneWeights, computeSlopeAttribute, WORLD_SIZE } from "@/lib/terrain";
import { getTerrainTextures } from "@/lib/textures";
import { createTerrainShaderMaterial } from "@/lib/terrainShader";
import { useClassificationStore } from "@/lib/classificationStore";
import { useUiStore } from "@/lib/uiStore";
import { useZoneOverlayStore } from "@/lib/zoneOverlayStore";
import { useHighlightStore } from "@/lib/highlightStore";
import { useHabitatStore } from "@/lib/habitatStore";
import { useSettingsStore, deriveEffectiveColormapTheme } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { getColormap } from "@/lib/colormap";

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
    const brightDaylight = useSettingsStore((s) => s.brightDaylight);
    const colormapUserSet = useSettingsStore((s) => s.colormapUserSet);
    // In Bright Daylight mode, promote the terrain to grayscale — it provides
    // the strongest depth contrast in sunlight. If the user has explicitly
    // chosen a colormap (colormapUserSet === true) their choice is always
    // respected, no matter which theme they selected.
    const effectiveColormapTheme = deriveEffectiveColormapTheme(brightDaylight, colormapUserSet, colormapTheme);
    const paintMode = useUiStore((s) => s.zonePaintMode);

    // Brush radius in grid cells — user-configurable via the Paint Mode slider.
    const brushRadius = useUiStore((s) => s.zonePaintBrushRadius);

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
      const geo = buildTerrainGeometry(grid, effectiveColormapTheme);
      const weights = computeZoneWeights(grid);
      geo.setAttribute("zoneWeight", new THREE.BufferAttribute(weights, 4));
      const slopes = computeSlopeAttribute(grid);
      geo.setAttribute("slope", new THREE.BufferAttribute(slopes, 1));
      return geo;
    }, [grid, effectiveColormapTheme]);

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

    // Live-update vertex colours when the user customises the depth palette
    // (only meaningful for the "ocean" theme; other themes have fixed stops,
    // but re-running for them is harmless and keeps the code simple).
    const paletteShallow = usePaletteStore((s) => s.shallow);
    const paletteDeep = usePaletteStore((s) => s.deep);
    const customStops = usePaletteStore((s) => s.customStops);
    const bandColors = usePaletteStore((s) => s.bandColors);
    const bandBoundaries = usePaletteStore((s) => s.bandBoundaries);
    useEffect(() => {
      const { depths, minDepth, maxDepth } = grid;
      const depthRange = (maxDepth - minDepth) || 1;
      const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
      if (!colorAttr) return;
      const toColor = getColormap(effectiveColormapTheme);
      const colors = colorAttr.array as Float32Array;
      for (let i = 0; i < depths.length; i++) {
        const depth = depths[i] ?? 0;
        const t = Math.max(0, Math.min(1, (depth - minDepth) / depthRange));
        const c = toColor(t);
        colors[i * 3]     = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      colorAttr.needsUpdate = true;
    }, [paletteShallow, paletteDeep, customStops, effectiveColormapTheme, grid, geometry, bandColors, bandBoundaries]);

    // Substrate colour mode no longer recolours the mesh from slope-derived
    // heuristics. The real ShoreZone polygons are drawn as a draped overlay
    // by <SubstrateLayer> instead; the terrain mesh keeps its depth colormap.
    const terrainExaggeration = useSettingsStore((s) => s.terrainExaggeration);
    const habitatOverlayIntensity = useSettingsStore((s) => s.habitatOverlayIntensity);

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

    // Subscribe to habitat scores so the upload effect re-runs whenever the
    // active species changes or compute() finishes. Both freshwater and
    // saltwater species feed the same store.scores → same pipeline.
    const habitatScores = useHabitatStore((s) => s.scores);
    const activeSpecies = useHabitatStore((s) => s.activeSpecies);

    // Upload an N×N R8 DataTexture (Red channel = score) whenever the per-vertex
    // habitat scores change. We quantise the [0,1] Float32 scores to UnsignedByte
    // so the texture is linearly-filterable on all WebGL2 GPUs without requiring
    // the OES_texture_float_linear extension (R32F is not filterable by default).
    useEffect(() => {
      const N = grid.resolution;

      if (habitatTexRef.current) {
        habitatTexRef.current.dispose();
        habitatTexRef.current = null;
      }

      if (habitatScores && habitatScores.length === N * N) {
        const bytes = new Uint8Array(N * N);
        for (let i = 0; i < bytes.length; i++) {
          const s = habitatScores[i] ?? 0;
          const clamped = s < 0 ? 0 : s > 1 ? 1 : s;
          bytes[i] = Math.round(clamped * 255);
        }
        const tex = new THREE.DataTexture(
          bytes,
          N,
          N,
          THREE.RedFormat,
          THREE.UnsignedByteType,
        );
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        material.uniforms["uHabitatTex"]!.value = tex;
        habitatTexRef.current = tex;
      }
    }, [habitatScores, grid, material]);

    // Dispose the habitat texture on unmount to free GPU memory.
    useEffect(() => {
      return () => {
        if (habitatTexRef.current) {
          habitatTexRef.current.dispose();
          habitatTexRef.current = null;
        }
      };
    }, []);

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

      // Zone tint colours + per-slot visibility (live from zoneOverlayStore)
      if (overlayEnabled) {
        const { slots } = useZoneOverlayStore.getState();
        const tintUniforms = [
          "uZoneTint0", "uZoneTint1", "uZoneTint2", "uZoneTint3",
        ] as ["uZoneTint0", "uZoneTint1", "uZoneTint2", "uZoneTint3"];
        for (let i = 0; i < 4; i++) {
          const slot = slots[i as 0 | 1 | 2 | 3];
          const uniformName = tintUniforms[i as 0 | 1 | 2 | 3];
          if (slot && uniformName) {
            (material.uniforms[uniformName]!.value as THREE.Color).set(slot.color);
          }
        }
        const vis = material.uniforms["uZoneVisible"]!.value as THREE.Vector4;
        vis.set(
          slots[0]?.visible ? 1 : 0,
          slots[1]?.visible ? 1 : 0,
          slots[2]?.visible ? 1 : 0,
          slots[3]?.visible ? 1 : 0,
        );
      }

      // Highlight overlay (query panel)
      const { mode, params } = useHighlightStore.getState();
      const modeMap: Record<string, number> = { none: 0, depthRange: 1, slope: 2, zone: 3 };
      material.uniforms["uHighlightMode"]!.value = modeMap[mode] ?? 0;
      material.uniforms["uHighlightMin"]!.value  = params.min;
      material.uniforms["uHighlightMax"]!.value  = params.max;

      // Habitat overlay
      material.uniforms["uShowHabitat"]!.value = activeSpecies ? 1 : 0;
      material.uniforms["uHabitatIntensity"]!.value = habitatOverlayIntensity;
    });

    // Apply terrain vertical exaggeration via a group scale on Y. Wrapping
    // both the textured surface and the skirt keeps them perfectly aligned.
    // Markers / overlays that map depth→world-Y independently (e.g. fish pins)
    // intentionally remain at their true Y so absolute fishing depths are
    // unaffected by the user's visual exaggeration preference.
    const yScale = Math.max(0.1, terrainExaggeration || 1);
    return (
      <group scale={[1, yScale, 1]}>
        <mesh
          ref={ref}
          geometry={geometry}
          material={material}
          onPointerDown={paintMode ? onPointerDown : undefined}
          onPointerMove={paintMode ? onPointerMove : undefined}
          onPointerUp={paintMode ? onPointerUp : undefined}
        />
        <mesh geometry={skirtGeometry} material={skirtMaterial} raycast={() => null} />
      </group>
    );
  },
);
TerrainMesh.displayName = "TerrainMesh";
