import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useCameraStore } from "@/lib/cameraStore";
import * as THREE from "three";
import {
  useGetDatasetsIdTerrain,
  getGetDatasetsIdTerrainQueryKey,
} from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { TerrainMesh } from "@/components/TerrainMesh";
import { EfhZoneLayer } from "@/components/EfhZoneLayer";
import { SubstrateLayer } from "@/components/SubstrateLayer";
import { IntertidalHotspotsLayer } from "@/components/IntertidalHotspotsLayer";
import { Hyd93FeaturesLayer } from "@/components/Hyd93FeaturesLayer";
import { Particles } from "@/components/Particles";
import { Caustics } from "@/components/Caustics";
import { useFlyControls } from "@/hooks/useFlyControls";
import { useGpsFollowCamera } from "@/hooks/useGpsFollowCamera";
import { registerTestThreeCamera } from "@/lib/testHelpers";
import { TidalWaterPlane } from "@/components/TidalWaterPlane";
import { TidalCurrentArrows, type DepthLayer } from "@/components/TidalCurrentArrows";
import { MarkerLayer } from "@/components/MarkerLayer";
import { TrailLayer } from "@/components/TrailLayer";
import { DepthPoleLayer, DepthPoleDomLabels } from "@/components/DepthPoleLayer";
import { GpsMarker } from "@/components/GpsMarker";
import { DepthProfileLine } from "@/components/DepthProfileLine";
import type { TidalDataResult } from "@/hooks/useTidalData";
import { INITIAL_CAMERA_POSITION, MAX_DEPTH_WORLD, WORLD_SIZE, getSeaSurfaceY, buildWaterSurface, type WaterSurface } from "@/lib/terrain";
import { useTerrainStore } from "@/lib/terrainStore";
import { useGpsStore } from "@/lib/gpsStore";
import { runFollowBoundsCheck } from "@/lib/followBoundsCheck";
import { WaterSurfacePlane } from "@/components/WaterSurfacePlane";
import { WaterTempVolumeLayer } from "@/components/WaterTempVolumeLayer";
import { LandmassMesh } from "@/components/LandmassMesh";
import type { TerrainData } from "@workspace/api-client-react";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { useDriftStore } from "@/lib/driftStore";
import { DriftWaterPlane } from "@/components/DriftWaterPlane";
import { DriftBoat } from "@/components/DriftBoat";
import { DriftPath } from "@/components/DriftPath";
import { WindArrow } from "@/components/WindArrow";
import { ConditionsOverlays } from "@/components/ConditionsOverlays";
import { CurrentsLayer } from "@/components/CurrentsLayer";
import { useCurrentsStore } from "@/lib/currentsStore";
import { useWebglContextStore } from "@/lib/webglContextStore";
import { WebglContextLostOverlay } from "@/components/WebglContextLostOverlay";
import { useLandTerrainStore } from "@/lib/landTerrainStore";
import { useLandTerrain } from "@/hooks/useLandTerrain";
import { useSatelliteTileStore } from "@/lib/satelliteTileStore";
import { useSatelliteTile } from "@/hooks/useSatelliteTile";
import { TerrainContourLines } from "@/components/TerrainContourLines";
import { useTemperatureProfile } from "@/hooks/useTemperatureProfile";
import { useWaterTempTexture, type TempSample } from "@/hooks/useWaterTempTexture";
import { sampleTemperatureProfile } from "@/lib/waterTemp";
import { ThermalCursorTracker } from "@/components/ThermalCursorTracker";

// One-shot WebGL availability probe. Cached at module scope so we don't
// recreate a throwaway <canvas> on every TourScene re-render. Used by the
// dev-only e2e fallback below to decide whether to mount the real R3F
// Canvas or the stub. Wrapped in try/catch because some Chromium configs
// throw synchronously from getContext('webgl2') instead of returning null
// when the GPU process can't be reached.
//
// Gated callers re-check `import.meta.env.DEV && VITE_DEV_AUTH_BYPASS`, so
// in production builds the call site (and this function) is dead-code
// eliminated by Vite and never runs.
let _hostHasWebGLCache: boolean | null = null;
function hostHasWebGL(): boolean {
  if (_hostHasWebGLCache !== null) return _hostHasWebGLCache;
  if (typeof document === "undefined") {
    _hostHasWebGLCache = false;
    return false;
  }
  try {
    const c = document.createElement("canvas");
    const gl =
      (c.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (c.getContext("webgl") as WebGLRenderingContext | null) ??
      (c.getContext(
        "experimental-webgl",
      ) as WebGLRenderingContext | null);
    _hostHasWebGLCache = !!gl;
  } catch {
    _hostHasWebGLCache = false;
  }
  return _hostHasWebGLCache;
}

// ---------------------------------------------------------------------------
// StubFollowBoundsWatcher — dev/e2e-only. When the R3F Canvas is replaced by
// the stub (no WebGL), useGpsFollowCamera never mounts, so its per-frame
// GPS-loss / out-of-bounds follow checks never run. This watcher mirrors
// them on gpsStore/cameraStore/terrainStore updates using the same shared
// runFollowBoundsCheck helper. Only mounted inside the DEV + auth-bypass
// stub branch, so it is dead-code eliminated from production builds.
const StubFollowBoundsWatcher: React.FC = () => {
  React.useEffect(() => {
    const state = { toastFired: false };
    const run = () => runFollowBoundsCheck(state);
    run();
    const unsubs = [
      useGpsStore.subscribe(run),
      useCameraStore.subscribe(run),
      useTerrainStore.subscribe(run),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);
  return null;
};

// ---------------------------------------------------------------------------
// LandTerrainMesh — above-water Copernicus DEM 90 m land terrain.
//
// Shares the exact same XZ footprint as TerrainMesh (PlaneGeometry WORLD_SIZE
// × WORLD_SIZE) so both meshes meet seamlessly at Y=0 (the waterline).
// Vertices with elevation > 0 are displaced upward; ocean cells stay at Y=0.
// Max uplift is capped at MAX_LAND_HEIGHT_WORLD (40 % of MAX_DEPTH_WORLD) so
// coastal ridges are visible without dominating the underwater scene.
//
// The fetch fires whenever the primary terrain's bbox changes; it is
// non-blocking — bathymetry renders immediately and land fades in once the
// DEM grid arrives. Skips rendering when maxElevation=0 (ocean-only datasets
// or upstream flat-plane fallback).
// ---------------------------------------------------------------------------
const MAX_LAND_HEIGHT_WORLD = MAX_DEPTH_WORLD * 0.4; // e.g. 20 world units


const LandTerrainMesh: React.FC = () => {
  const { terrain } = useAppState();
  const landGrid = useLandTerrainStore((s) => s.landGrid);
  const tileUrl = useSatelliteTileStore((s) => s.tileUrl);
  const satelliteImagery = useSettingsStore((s) => s.satelliteImagery);

  const bbox = useMemo(() => {
    if (!terrain) return null;
    return {
      minLon: terrain.minLon,
      maxLon: terrain.maxLon,
      minLat: terrain.minLat,
      maxLat: terrain.maxLat,
    };
  }, [terrain]);

  useLandTerrain(bbox);
  useSatelliteTile(bbox);

  // Build the geometry + procedural-colour material once when landGrid changes.
  // The satellite texture is applied separately so geometry reuse is preserved.
  const { geometry, proceduralMaterial } = useMemo(() => {
    if (!landGrid || landGrid.maxElevation <= 0) {
      return { geometry: null, proceduralMaterial: null };
    }

    const { elevation, width, height, maxElevation } = landGrid;
    const N = Math.min(width, height);
    const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, N - 1, N - 1);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes["position"]!.array as Float32Array;
    const colors = new Float32Array(positions.length);
    const color = new THREE.Color();

    const lowColor  = new THREE.Color("#2d6a4f"); // dark forest green
    const midColor  = new THREE.Color("#8B5E3C"); // earthy brown
    const highColor = new THREE.Color("#d4d4d4"); // light grey / snow

    for (let i = 0; i < N * N; i++) {
      const elev = elevation[i] ?? 0;
      const t = elev > 0 ? Math.min(1, elev / maxElevation) : 0;

      // Displace upward for land cells; ocean cells (elev=0) stay at Y=0.
      positions[i * 3 + 1] = elev > 0 ? t * MAX_LAND_HEIGHT_WORLD : 0;

      if (t < 0.5) {
        color.lerpColors(lowColor, midColor, t * 2);
      } else {
        color.lerpColors(midColor, highColor, (t - 0.5) * 2);
      }

      colors[i * 3]     = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const proceduralMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    return { geometry, proceduralMaterial };
  }, [landGrid]);

  // Satellite texture — loaded from the object URL whenever tileUrl changes.
  // Disposed when replaced or on unmount.
  const [satelliteTexture, setSatelliteTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!tileUrl) {
      setSatelliteTexture((prev) => { prev?.dispose(); return null; });
      return;
    }
    const loader = new THREE.TextureLoader();
    let disposed = false;
    loader.load(
      tileUrl,
      (tex) => {
        if (disposed) { tex.dispose(); return; }
        tex.flipY = true;
        tex.needsUpdate = true;
        setSatelliteTexture((prev) => { prev?.dispose(); return tex; });
      },
      undefined,
      (err) => { if (!disposed) console.warn("[LandTerrainMesh] satellite texture load failed:", err); },
    );
    return () => { disposed = true; };
  }, [tileUrl]);

  // Dispose texture on unmount.
  useEffect(() => () => { satelliteTexture?.dispose(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only cleanup; intentionally captures the texture ref at mount time to avoid re-running disposal on every texture update

  // Build the final material: satellite when enabled + available, else procedural ramp.
  const material = useMemo(() => {
    if (!proceduralMaterial) return null;
    if (satelliteImagery && satelliteTexture) {
      return new THREE.MeshStandardMaterial({
        map: satelliteTexture,
        vertexColors: false,
        roughness: 0.85,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
    }
    return proceduralMaterial;
  }, [proceduralMaterial, satelliteTexture, satelliteImagery]);

  // Dispose the satellite-textured material when it is replaced.
  const prevMaterialRef = useRef<THREE.Material | null>(null);
  useEffect(() => {
    const prev = prevMaterialRef.current;
    if (prev && prev !== proceduralMaterial && material !== prev) prev.dispose();
    prevMaterialRef.current = material;
  }, [material, proceduralMaterial]);

  if (!geometry || !material) return null;

  return <mesh geometry={geometry} material={material} />;
};

// ---------------------------------------------------------------------------
/**
 * Compute the X-axis scale for a secondary dataset mesh relative to the
 * primary dataset, correcting for latitude-dependent longitude compression.
 *
 * At high latitudes, 1° of longitude spans fewer metres than 1° of latitude.
 * A raw degree ratio (secLonRange / primaryLonRange) ignores this and produces
 * a horizontally-stretched mesh. The fix multiplies each span by
 * cos(midpointLatRad) before dividing, converting angular spans to
 * proportional linear distances at the respective midpoints.
 *
 * @param secLonRange   - Secondary dataset longitude span in degrees
 * @param secAvgLatRad  - Secondary dataset midpoint latitude in radians
 * @param primLonRange  - Primary dataset longitude span in degrees
 * @param primAvgLatRad - Primary dataset midpoint latitude in radians
 */
export function computeLatCorrectedLonScale(
  secLonRange: number,
  secAvgLatRad: number,
  primLonRange: number,
  primAvgLatRad: number,
): number {
  const denom = (primLonRange * Math.cos(primAvgLatRad)) || 1;
  return (secLonRange * Math.cos(secAvgLatRad)) / denom;
}

// NonPrimaryDatasetMeshes — renders every visible-but-not-primary dataset
// inside the primary's world coordinate system. Each non-primary mesh occupies
// world units [-WORLD_SIZE/2, WORLD_SIZE/2] in its own frame; we wrap it in
// a <group> that scales + translates that frame so its geographic footprint
// lines up with the primary's footprint.
//
// Y alignment: each TerrainMesh internally normalises its own depth range to
// [0, -MAX_DEPTH_WORLD] (sea-surface depth=minDepth at y=0, deepest at
// y=-MAX_DEPTH_WORLD). To make a non-primary mesh read at its true ocean
// depth relative to the primary, we re-scale and offset Y so equal world-Y
// distances correspond to equal meters across all datasets, and y=0 always
// represents depth=primary.minDepth.
//
//   worldY(depth) = (primary.minDepth - depth) / primaryDepthRange * MAX
//   localY(depth) = -(depth - g.minDepth)     / gDepthRange       * MAX
//
// Solving for worldY in terms of localY gives:
//   yScale  = gDepthRange / primaryDepthRange
//   yOffset = (primary.minDepth - g.minDepth) / primaryDepthRange * MAX
//
// Envelope policy: the primary mesh occupies world-Y [0, -MAX_DEPTH_WORLD],
// and a solid floor closes off everything below -MAX_DEPTH_WORLD. When a
// secondary dataset is dramatically deeper (or shallower) than the primary,
// the natural yScale/yOffset above can drive the mesh below the floor or
// above the water surface, producing a sliver-or-tower that reads as broken.
// To keep visuals legible we apply two clamps in order:
//   1. Cap yScale at 1 so the secondary's vertical extent never exceeds the
//      primary's world envelope (compressing exaggeration for very deep
//      datasets — they lose true-depth correspondence but stay readable).
//   2. Clamp yOffset so the mesh sits inside [0, -MAX_DEPTH_WORLD], moving
//      it as close to its natural position as possible. The mesh is biased
//      toward the floor when it would have extended deeper, and toward the
//      surface when it would have extended above it.
// ---------------------------------------------------------------------------
const NonPrimaryDatasetMeshes: React.FC<{
  primary: TerrainData;
  showLandmass: boolean;
  tidalDataMap?: Map<string, TidalDataResult>;
  tidalOverlay?: boolean;
  depthLayer?: DepthLayer;
  waterSurface?: WaterSurface;
}> = ({ primary, showLandmass, tidalDataMap, tidalOverlay, depthLayer = "surface", waterSurface = { visible: true, y: 0 } }) => {
  const visible = useTerrainStore((s) => s.visibleDatasets);
  const primaryId = useTerrainStore((s) => s.primaryDatasetId);
  const primaryLonRange = (primary.maxLon - primary.minLon) || 1;
  const primaryLatRange = (primary.maxLat - primary.minLat) || 1;
  const primaryDepthRange = (primary.maxDepth - primary.minDepth) || 1;
  return (
    <>
      {visible
        .filter((v) => v.datasetId !== primaryId && v.activeGrid)
        .map((v) => {
          const g = v.activeGrid as TerrainData;
          const secLonRange = (g.maxLon - g.minLon) || 1;
          const secLatRange = (g.maxLat - g.minLat) || 1;
          const secDepthRange = (g.maxDepth - g.minDepth) || 1;
          // Latitude-corrected longitude scale: degrees of longitude shrink
          // as lat increases (width ∝ cos(lat)). Multiply each dataset's lon
          // span by cos(midpoint lat) to convert from angular to proportional
          // linear distance before dividing, so secondary meshes at high
          // latitudes are not horizontally stretched.
          const primaryAvgLatRad = ((primary.minLat + primary.maxLat) / 2) * (Math.PI / 180);
          const secAvgLatRad = ((g.minLat + g.maxLat) / 2) * (Math.PI / 180);
          const xScale = computeLatCorrectedLonScale(secLonRange, secAvgLatRad, primaryLonRange, primaryAvgLatRad);
          const zScale = secLatRange / primaryLatRange;
          const naturalYScale = secDepthRange / primaryDepthRange;
          const secCenterLon = (g.minLon + g.maxLon) / 2;
          const secCenterLat = (g.minLat + g.maxLat) / 2;
          const primCenterLon = (primary.minLon + primary.maxLon) / 2;
          const primCenterLat = (primary.minLat + primary.maxLat) / 2;
          const cx = ((secCenterLon - primCenterLon) / primaryLonRange) * WORLD_SIZE;
          const cz = -((secCenterLat - primCenterLat) / primaryLatRange) * WORLD_SIZE;
          const naturalCy =
            ((primary.minDepth - g.minDepth) / primaryDepthRange) * MAX_DEPTH_WORLD;

          // Envelope clamp (see header comment): cap vertical extent to the
          // primary's world envelope, then slide the mesh into [-MAX, 0].
          const yScale = Math.min(naturalYScale, 1);
          const extent = yScale * MAX_DEPTH_WORLD;
          const cyMin = extent - MAX_DEPTH_WORLD; // lower bound: bottom rests on floor
          const cyMax = 0;                         // upper bound: top rests at surface
          const cy = Math.max(cyMin, Math.min(cyMax, naturalCy));

          // Multi-primary: tidal overlay for this secondary dataset (if data available)
          const secTidalData = tidalDataMap?.get(v.datasetId) ?? null;

          return (
            <group
              key={v.datasetId}
              position={[cx, cy, cz]}
              scale={[xScale, yScale, zScale]}
            >
              <TerrainMesh grid={g} depthBias />
              {showLandmass && <LandmassMesh grid={g} depthBias />}
              {tidalOverlay && secTidalData && (
                <TidalSceneContents
                  tidalData={secTidalData}
                  depthLayer={depthLayer}
                  terrain={g}
                  waterSurface={waterSurface}
                  depthBias
                />
              )}
            </group>
          );
        })}
    </>
  );
};

// ---------------------------------------------------------------------------
// FlyControlsScene — lives inside <Canvas>, wires up controls + lamp
// ---------------------------------------------------------------------------
interface FlyControlsSceneProps {
  terrainMeshRef: React.RefObject<THREE.Mesh | null>;
}

const FlyControlsScene: React.FC<FlyControlsSceneProps> = ({ terrainMeshRef }) => {
  const lightRef = useRef<THREE.PointLight>(null);
  useFlyControls({ terrainMeshRef, lightRef });
  useGpsFollowCamera();
  const lampIntensity = useSettingsStore((s) => s.lampIntensity);
  const lampRange = useSettingsStore((s) => s.lampRange);
  const waterType = useSettingsStore((s) => s.waterType);
  // Freshwater lakes carry less particulate than the open ocean, so the
  // submersible lamp reads cooler / less amber than the deep-sea default.
  const lampColor = waterType === "freshwater" ? "#eaffff" : "#fff8e8";

  return (
    <>
      {/* Submersible lamp — colour + intensity driven by water type / user setting */}
      <pointLight
        ref={lightRef}
        color={lampColor}
        intensity={lampIntensity}
        distance={lampRange}
        decay={2}
      />
      {/* Orbit is now a transient right-drag gesture handled inside
          useFlyControls — no MapControls instance is mounted. */}
    </>
  );
};

// ---------------------------------------------------------------------------
// Tidal 3D contents — lives inside <Canvas>.
//
// When tidal overlay is on we substitute TidalWaterPlane for the static
// WaterSurfacePlane so the surface visibly rises/falls with the tide.
// Both are gated on the WaterSurface union so disabling the toggle hides any
// water plane (useful for cross-sections / dry-bathymetry views).
// ---------------------------------------------------------------------------
interface TidalSceneContentsProps {
  tidalData: TidalDataResult | null;
  depthLayer: DepthLayer;
  terrain: TerrainData;
  waterSurface: WaterSurface;
  depthBias?: boolean;
}

const TidalSceneContents: React.FC<TidalSceneContentsProps> = ({
  tidalData,
  depthLayer,
  terrain,
  waterSurface,
  depthBias = false,
}) => {
  if (!tidalData?.available) return null;

  const surfY = getSeaSurfaceY(terrain);

  return (
    <>
      {waterSurface.visible && (
        <TidalWaterPlane tideHeight={tidalData.tideHeight} terrain={terrain} depthBias={depthBias} />
      )}
      <TidalCurrentArrows
        currentDirection={tidalData.currentDirection}
        currentSpeed={tidalData.currentSpeed}
        surfaceY={surfY + (tidalData.tideHeight / ((terrain.maxDepth - terrain.minDepth) || 1)) * MAX_DEPTH_WORLD}
        depthLayer={depthLayer}
        terrain={terrain}
        depthBias={depthBias}
        available={tidalData.currentsSource !== "estimated"}
      />
    </>
  );
};

// ---------------------------------------------------------------------------
// Water Temperature Volume — fetches the real temperature profile (or falls
// back to the exponential thermocline model) and renders a semi-transparent
// thermal gradient box spanning the full water column.
// Lives inside <Canvas> so useWaterTempTexture can dispose GPU resources.
// ---------------------------------------------------------------------------
const WaterTempSceneContents: React.FC<{ terrain: TerrainData }> = ({ terrain }) => {
  const showWaterTempLayer = useSettingsStore((s) => s.showWaterTempLayer);
  const showWaterSurface = useSettingsStore((s) => s.showWaterSurface);

  const centerLat = (terrain.minLat + terrain.maxLat) / 2;
  const centerLon = (terrain.minLon + terrain.maxLon) / 2;

  const { profile } = useTemperatureProfile(
    showWaterTempLayer ? centerLat : null,
    showWaterTempLayer ? centerLon : null,
    showWaterTempLayer,
    terrain.datasetId,
  );

  const isRealData =
    !!profile?.available &&
    Array.isArray(profile.samples) &&
    (profile.samples as unknown[]).length >= 2;

  const waterType = useSettingsStore((s) => s.waterType);
  const isFresh = waterType === "freshwater";

  const samples: TempSample[] | null = useMemo(() => {
    if (!showWaterTempLayer) return null;
    if (profile?.available && Array.isArray(profile.samples) && profile.samples.length >= 2) {
      return (profile.samples as { depthM: number; temperatureC: number }[])
        .filter(
          (s): s is { depthM: number; temperatureC: number } =>
            typeof s?.depthM === "number" &&
            Number.isFinite(s.depthM) &&
            typeof s?.temperatureC === "number" &&
            Number.isFinite(s.temperatureC),
        )
        .sort((a, b) => a.depthM - b.depthM)
        .map((s) => ({ depthM: s.depthM, celsius: s.temperatureC }));
    }
    // Freshwater with no real data: suppress the volume entirely rather than
    // showing a synthetic thermocline model that has no empirical basis.
    if (isFresh) return null;
    // Saltwater fallback: exponential thermocline model at the scene depth range.
    const maxDepthM = Math.max(20, terrain.maxDepth - terrain.minDepth);
    const thermo = sampleTemperatureProfile(maxDepthM, null, 24);
    return thermo.samples.map((s) => ({ depthM: s.depthM, celsius: s.celsius }));
  }, [showWaterTempLayer, profile, terrain, isFresh]);

  const dataTexture = useWaterTempTexture(samples);

  if (!showWaterTempLayer || !dataTexture) return null;
  // Same depth-gating as the water surface: don't show the volume when the
  // water surface is hidden (user has explicitly turned off water visuals).
  if (!showWaterSurface) return null;

  const surfY = getSeaSurfaceY(terrain);
  const seafloorY = -MAX_DEPTH_WORLD;

  return (
    <WaterTempVolumeLayer
      surfY={surfY}
      seafloorY={seafloorY}
      dataTexture={dataTexture}
      opacity={isRealData ? 0.15 : 0.07}
    />
  );
};

// ---------------------------------------------------------------------------
// Currents (Task #136) — reads runtime NOAA ambient via a hook so subscription
// triggers re-renders when the value updates.
// ---------------------------------------------------------------------------
const CurrentsSceneContents: React.FC<{ terrain: TerrainData }> = ({ terrain }) => {
  const noaaAmbient = useCurrentsStore((s) => s.noaaAmbient);
  return <CurrentsLayer terrain={terrain} noaaAmbient={noaaAmbient} />;
};

// ---------------------------------------------------------------------------
// Drift Planner 3D elements — lives inside <Canvas>
// ---------------------------------------------------------------------------
const DriftSceneContents: React.FC = () => {
  const { terrain } = useAppState();
  const driftPlannerActive = useDriftStore((s) => s.driftPlannerActive);
  const driftPath = useDriftStore((s) => s.driftPath);

  if (!driftPlannerActive || !terrain) return null;

  const surfaceY = getSeaSurfaceY(terrain);
  return (
    <>
      <DriftWaterPlane surfaceY={surfaceY} terrain={terrain} />
      {driftPath && driftPath.length > 0 && (
        <>
          <DriftBoat surfaceY={surfaceY} />
          <DriftPath surfaceY={surfaceY} />
          <WindArrow surfaceY={surfaceY} />
        </>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Inner scene — lives inside <Canvas>
// ---------------------------------------------------------------------------
interface SceneContentsProps {
  terrainMeshRef: React.RefObject<THREE.Mesh | null>;
  tidalData: TidalDataResult | null;
  /** Multi-primary: map of tidal data keyed by datasetId. */
  tidalDataMap?: Map<string, TidalDataResult>;
  tidalOverlay: boolean;
  depthLayer: DepthLayer;
}

// Dev-only: hand the live THREE.PerspectiveCamera to testHelpers so e2e
// tests can read camera.position synchronously after dispatching wheel
// events. Renders nothing in production builds.
const TestCameraBridge: React.FC = () => {
  const { camera } = useThree();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    registerTestThreeCamera(camera);
    return () => registerTestThreeCamera(null);
  }, [camera]);
  return null;
};

/**
 * Derive the effective fog/background colour for the scene.
 *
 * Freshwater mode shifts the hue toward green-teal ("#0b3a35") to evoke
 * clear lake water, but ONLY when the user has not explicitly chosen a
 * custom fog colour. If the user has overridden the factory default, their
 * choice is respected in all water-type modes.
 *
 * @param isFreshwater    - True when waterType === "freshwater"
 * @param fogColor        - The user's current fogColor setting
 * @param defaultFogColor - The factory-default fogColor (from DEFAULT_SETTINGS)
 */
export function deriveEffectiveFogColor(
  isFreshwater: boolean,
  fogColor: string,
  defaultFogColor: string,
): string {
  return isFreshwater && fogColor === defaultFogColor ? "#0b3a35" : fogColor;
}

const SceneContents: React.FC<SceneContentsProps> = ({
  terrainMeshRef,
  tidalData,
  tidalDataMap,
  tidalOverlay,
  depthLayer,
}) => {
  const { terrain } = useAppState();
  const fogDensity = useSettingsStore((s) => s.fogDensity);
  const fogColor = useSettingsStore((s) => s.fogColor);
  const ambientIntensity = useSettingsStore((s) => s.ambientLightIntensity);
  const directionalIntensity = useSettingsStore((s) => s.directionalLightIntensity);
  const waterType = useSettingsStore((s) => s.waterType);
  const showWaterSurface = useSettingsStore((s) => s.showWaterSurface);
  const showLandmass = useSettingsStore((s) => s.showLandmass);
  const brightDaylight = useSettingsStore((s) => s.brightDaylight);
  const enableMarineSnow = useSettingsStore((s) => s.enableMarineSnow);
  // True only when a Copernicus DEM grid with real elevation data is loaded.
  // Used to suppress LandmassMesh (flat silhouette fallback) once the richer
  // DEM surface is ready — prevents two land surfaces from stacking.
  const hasLandDem = useLandTerrainStore(
    (s) => s.landGrid !== null && (s.landGrid.maxElevation ?? 0) > 0,
  );

  // Freshwater environments are clearer and brighter than the open ocean —
  // shift the background/fog hue toward green-teal, thin the fog, and warm
  // the ambient/key lights so lakes don't render with deep-sea twilight.
  const isFresh = waterType === "freshwater";
  // Only apply the freshwater hue override when the user has NOT customised
  // the fog colour (i.e. it still matches the factory default). If the user
  // has explicitly chosen a colour, honour it regardless of water type.
  const effectiveFogColor = deriveEffectiveFogColor(isFresh, fogColor, DEFAULT_SETTINGS.fogColor);
  const effectiveFogDensity = isFresh ? fogDensity * 0.55 : fogDensity;
  const ambientHue = isFresh ? "#a8d8c8" : "#7aa8c8";
  const directionalHue = isFresh ? "#dfffe8" : "#d0eeff";

  // Bright Daylight mode: boost ambient/directional lighting for an
  // outdoor high-luminance scene. Colormap override is handled inside
  // TerrainMesh which reads brightDaylight directly from settingsStore.
  const effectiveAmbientIntensity = brightDaylight
    ? Math.max(ambientIntensity, 0.35)
    : ambientIntensity;
  const effectiveDirectionalIntensity = brightDaylight
    ? Math.max(directionalIntensity, 0.75)
    : directionalIntensity;

  return (
    <>
      <color attach="background" args={[effectiveFogColor]} />
      <fogExp2 args={[effectiveFogColor, effectiveFogDensity]} />

      {/* Ambient fill — hue tracks water type; boosted in Bright Daylight */}
      <ambientLight intensity={effectiveAmbientIntensity} color={ambientHue} />
      {/* Distant key light — also boosted in Bright Daylight */}
      <directionalLight position={[10, 30, 20]} intensity={effectiveDirectionalIntensity} color={directionalHue} />

      <TestCameraBridge />
      {enableMarineSnow && <Particles />}
      {terrain && <TerrainMesh ref={terrainMeshRef} grid={terrain} />}
      {terrain && <TerrainContourLines grid={terrain} />}
      {/* LandmassMesh is a flat-silhouette fallback; hidden once the richer
          Copernicus DEM surface (LandTerrainMesh) is loaded — never both. */}
      {terrain && showLandmass && !hasLandDem && <LandmassMesh grid={terrain} />}
      {showLandmass && <LandTerrainMesh />}
      {terrain && (
        <NonPrimaryDatasetMeshes
          primary={terrain}
          showLandmass={showLandmass}
          tidalDataMap={tidalDataMap}
          tidalOverlay={tidalOverlay}
          depthLayer={depthLayer}
          waterSurface={buildWaterSurface(showWaterSurface, terrain)}
        />
      )}
      <EfhZoneLayer />
      <SubstrateLayer />
      <IntertidalHotspotsLayer />
      <Hyd93FeaturesLayer />
      <Caustics />

      {tidalOverlay && terrain ? (
        <TidalSceneContents
          tidalData={tidalData}
          depthLayer={depthLayer}
          terrain={terrain}
          waterSurface={buildWaterSurface(showWaterSurface, terrain)}
        />
      ) : (
        <WaterSurfacePlane waterSurface={buildWaterSurface(showWaterSurface, terrain ?? null)} />
      )}

      {terrain && <WaterTempSceneContents terrain={terrain} />}
      {terrain && <ThermalCursorTracker terrain={terrain} terrainMeshRef={terrainMeshRef} />}
      {terrain && <CurrentsSceneContents terrain={terrain} />}
      <MarkerLayer />
      <TrailLayer />
      <DepthPoleLayer />
      <GpsMarker />
      <DepthProfileLine />
      <FlyControlsScene terrainMeshRef={terrainMeshRef} />
      <DriftSceneContents />
      <ConditionsOverlays />
    </>
  );
};

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------
const LoadingOverlay: React.FC = () => (
  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#020818]">
    <div className="font-mono text-cyan-400 text-[27px] tracking-[0.3em] uppercase animate-pulse">
      ▼ Descending...
    </div>
    <div className="font-mono text-cyan-900 text-[18px] mt-3 tracking-widest uppercase">
      Retrieving bathymetric data
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Error overlay
// ---------------------------------------------------------------------------
interface ErrorOverlayProps {
  message: string;
  onRetry: () => void;
}

const ErrorOverlay: React.FC<ErrorOverlayProps> = ({ message, onRetry }) => (
  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#020818]">
    <div className="font-mono text-red-400 text-[27px] tracking-[0.3em] uppercase mb-2">
      ⚠ Signal Lost
    </div>
    <div className="font-mono text-red-700 text-[18px] tracking-wider mb-6 max-w-xs text-center select-text">
      {message}
    </div>
    <button
      onClick={onRetry}
      className="border border-red-800 text-red-400 font-mono text-[18px] px-5 py-2 tracking-widest uppercase hover:bg-red-900/20 transition-colors"
    >
      Retry Connection
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// CanvasAriaAnnouncer — screen-reader live region for depth / coordinates
// ---------------------------------------------------------------------------
/**
 * Reads cameraLon / cameraLat / cameraDepth from cameraStore and writes a
 * short, human-readable phrase into a visually-hidden aria-live="polite" div.
 * Updates are debounced to ~1 s so the AT is not overwhelmed while flying.
 */
const CanvasAriaAnnouncer: React.FC = () => {
  const [text, setText] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = useCameraStore.subscribe((state) => {
      const { cameraLon, cameraLat, cameraDepth } = state;
      if (cameraLon === null || cameraLat === null || cameraDepth === null) return;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setText(
          `Depth ${Math.round(cameraDepth)} m, lat ${cameraLat.toFixed(4)}, lon ${cameraLon.toFixed(4)}`,
        );
      }, 1000);
    });
    return () => {
      unsubscribe();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-testid="canvas-aria-announcer"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0,0,0,0)",
        whiteSpace: "nowrap",
        border: 0,
        zIndex: -1,
      }}
    >
      {text}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TourScene — the main page
// ---------------------------------------------------------------------------
interface TourSceneProps {
  tidalData?: TidalDataResult | null;
  /** Multi-primary: map of tidal data keyed by datasetId, one entry per visible dataset. */
  tidalDataMap?: Map<string, TidalDataResult>;
  tidalOverlay?: boolean;
  depthLayer?: DepthLayer;
}

export const TourScene: React.FC<TourSceneProps> = ({
  tidalData = null,
  tidalDataMap,
  tidalOverlay = false,
  depthLayer = "surface",
}) => {
  const { datasetId, setTerrain } = useAppState();
  const terrainMeshRef = useRef<THREE.Mesh>(null);

  const { data, isLoading, isError, error, refetch } = useGetDatasetsIdTerrain(
    datasetId ?? "",
    undefined,
    {
      query: {
        enabled: !!datasetId,
        queryKey: getGetDatasetsIdTerrainQueryKey(datasetId ?? ""),
      },
    },
  );

  useEffect(() => {
    if (data) setTerrain(data);
  }, [data, setTerrain]);

  const fov = useSettingsStore((s) => s.fieldOfView);
  const renderDistance = useSettingsStore((s) => s.renderDistance);
  const antialias = useSettingsStore((s) => s.antialiasing);

  const recoveryKey = useWebglContextStore((s) => s.recoveryKey);

  // Track the canvas element + cleanup so the WebGL context lifecycle
  // listeners are removed on Canvas unmount (HMR / route changes) and don't
  // accumulate across remounts.
  const contextCleanupRef = useRef<(() => void) | null>(null);
  const handleCanvasCreated = useCallback(
    (state: { gl: THREE.WebGLRenderer }) => {
      const renderer = state.gl;
      const canvas = renderer.domElement;

      // Probe float-texture linear filtering capability once at scene init.
      // WebGL2 supports it natively; WebGL1 requires the OES_texture_float_linear
      // extension. Without it, Float32 DataTextures with linear filters return
      // garbage (black) on some Android WebViews and integrated GPU drivers.
      const supported =
        renderer.capabilities.isWebGL2 ||
        !!renderer.extensions.get("OES_texture_float_linear");
      useWebglContextStore.getState().setFloatTextureLinear(supported);

      const onLost = (e: Event) => {
        // Prevent default so the browser is willing to restore the context.
        e.preventDefault();
        useWebglContextStore.getState().markLost();
      };
      const onRestored = () => {
        // Bumps recoveryKey so SceneContents remounts and all useMemo'd
        // GPU resources (terrain mesh material/uniforms, marker layer
        // geometry, particle/arrow/streamline buffers, drift path, water
        // plane) re-upload from their CPU-side sources without a page
        // reload.
        useWebglContextStore.getState().markRestored();
      };
      canvas.addEventListener("webglcontextlost", onLost, false);
      canvas.addEventListener("webglcontextrestored", onRestored, false);
      // Replace any prior cleanup (defensive against double onCreated).
      contextCleanupRef.current?.();
      contextCleanupRef.current = () => {
        canvas.removeEventListener("webglcontextlost", onLost, false);
        canvas.removeEventListener("webglcontextrestored", onRestored, false);
      };
    },
    [],
  );
  useEffect(() => {
    return () => {
      contextCleanupRef.current?.();
      contextCleanupRef.current = null;
    };
  }, []);

  // E2E-only escape hatch: when running under the dev auth-bypass mode,
  // skip mounting the R3F Canvas and render a stub canvas in its place if
  // EITHER:
  //   (a) the URL carries `?noCanvas=1` (explicit opt-out — tests that
  //       exercise pure DOM/HUD surfaces like the dataset-upload dropzone
  //       use this so the 3D scene's WebGL init error storm doesn't starve
  //       React-Query mutations of microtasks), OR
  //   (b) the host browser cannot create a WebGL context at all (probed
  //       once at module load — see `hostHasWebGL` below). Headless
  //       Chromium on Replit-managed runners falls into this bucket: the
  //       GPU process is unavailable so swiftshader never attaches and
  //       three.js throws on every Canvas mount. The fallback renders a
  //       real <canvas data-engine="three.js stub-no-webgl"> so the
  //       `canvas[data-engine^="three.js"]` locator used by the e2e suite
  //       still matches, and the canvas-gated specs stop skipping on
  //       "Canvas not visible" — they continue to drive scene state via
  //       the dev-only `__bathyTest` helper rig (which mutates the
  //       relevant Zustand stores directly and doesn't need a live R3F
  //       raycaster).
  //
  // Gated to import.meta.env.DEV + VITE_DEV_AUTH_BYPASS so it can never
  // ship: in a production build, both guards collapse to false and Vite's
  // dead-code elimination drops the entire branch (along with the
  // `hostHasWebGL` probe).
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_DEV_AUTH_BYPASS === "1" &&
    typeof window !== "undefined"
  ) {
    const search = new URLSearchParams(window.location.search);
    const explicitOptOut = search.get("noCanvas") === "1";
    const webglUnavailable = !hostHasWebGL();
    if (explicitOptOut || webglUnavailable) {
      return (
        <div
          className="relative w-full h-full"
          data-testid="tour-scene-canvas-disabled"
        >
          {/* GPS-follow bounds watcher: the real Canvas isn't mounted here,
              so useGpsFollowCamera's per-frame out-of-bounds check never
              runs. Mirror it on GPS/store updates so follow-mode handoff
              behaviour stays testable in headless (no-WebGL) e2e runs. */}
          <StubFollowBoundsWatcher />
          {/* Stub canvas mirroring three.js's `data-engine` attribute so
              `canvas[data-engine^="three.js"]` selectors used across the
              e2e suite continue to match. Renders nothing visible — its
              only job is to satisfy DOM presence + bounding-box checks. */}
          <canvas
            data-engine="three.js stub-no-webgl"
            data-testid="tour-scene-stub-canvas"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
            }}
          />
        </div>
      );
    }
  }

  return (
    <div className="relative w-full h-full">
      {/* Screen-reader live region: announces depth and coordinates as the
          camera moves. Visually hidden but read by AT on content change. */}
      <CanvasAriaAnnouncer />

      {/* near = WORLD_SIZE / 10_000 = 0.01 world units.
          Setting an explicit near plane concentrates 24-bit depth-buffer
          precision in the range where seafloor and water surface geometry
          actually lives (within WORLD_SIZE = 100 world units). Without an
          explicit near, R3F defaults to 0.1, which wastes precision on the
          [0.1, 0.01] sub-range. polygonOffset on terrain/contour/water meshes
          still handles co-planar z-fighting for overlapping surfaces. */}
      <Canvas
        aria-label="3D seafloor terrain viewer"
        camera={{ position: INITIAL_CAMERA_POSITION, fov, near: WORLD_SIZE / 10_000, far: renderDistance }}
        gl={{
          antialias,
          // E2E-only: keep the WebGL drawing buffer so Playwright can read
          // the actual rendered frame via canvas.toDataURL() instead of a
          // cleared/blank buffer. Gated on a dev-only env flag set by
          // playwright.config.ts; has no effect in production builds.
          preserveDrawingBuffer:
            import.meta.env.DEV &&
            import.meta.env["VITE_E2E_PRESERVE_BUFFER"] === "1",
        }}
        style={{ width: "100%", height: "100%" }}
        onCreated={handleCanvasCreated}
      >
        <SceneContents
          key={recoveryKey}
          terrainMeshRef={terrainMeshRef}
          tidalData={tidalData}
          tidalDataMap={tidalDataMap}
          tidalOverlay={tidalOverlay}
          depthLayer={depthLayer}
        />
      </Canvas>

      <WebglContextLostOverlay />

      {isLoading && !data && <LoadingOverlay />}
      {isError && (
        <ErrorOverlay
          message={error instanceof Error ? error.message : "Could not load terrain"}
          onRetry={() => void refetch()}
        />
      )}

      {/* Hidden DOM labels for depth-pole markers (E2E testing + accessibility) */}
      <DepthPoleDomLabels />
    </div>
  );
};
