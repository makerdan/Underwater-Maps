import React, { useCallback, useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  useGetDatasetsIdTerrain,
  getGetDatasetsIdTerrainQueryKey,
} from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { TerrainMesh } from "@/components/TerrainMesh";
import { EfhZoneLayer } from "@/components/EfhZoneLayer";
import { SubstrateLayer } from "@/components/SubstrateLayer";
import { Particles } from "@/components/Particles";
import { Caustics } from "@/components/Caustics";
import { useFlyControls } from "@/hooks/useFlyControls";
import { registerTestThreeCamera } from "@/lib/testHelpers";
import { TidalWaterPlane } from "@/components/TidalWaterPlane";
import { TidalCurrentArrows, type DepthLayer } from "@/components/TidalCurrentArrows";
import { MarkerLayer } from "@/components/MarkerLayer";
import { DepthPoleLayer, DepthPoleDomLabels } from "@/components/DepthPoleLayer";
import { GpsMarker } from "@/components/GpsMarker";
import { DepthProfileLine } from "@/components/DepthProfileLine";
import type { TidalDataResult } from "@/hooks/useTidalData";
import { MAX_DEPTH_WORLD, WORLD_SIZE } from "@/lib/terrain";
import { useTerrainStore } from "@/lib/terrainStore";
import { WaterSurfacePlane } from "@/components/WaterSurfacePlane";
import { LandmassMesh } from "@/components/LandmassMesh";
import type { TerrainData } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useDriftStore } from "@/lib/driftStore";
import { DriftWaterPlane } from "@/components/DriftWaterPlane";
import { DriftBoat } from "@/components/DriftBoat";
import { DriftPath } from "@/components/DriftPath";
import { ConditionsOverlays } from "@/components/ConditionsOverlays";
import { CurrentsLayer } from "@/components/CurrentsLayer";
import { useCurrentsStore } from "@/lib/currentsStore";
import { useWebglContextStore } from "@/lib/webglContextStore";
import { WebglContextLostOverlay } from "@/components/WebglContextLostOverlay";

// ---------------------------------------------------------------------------
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
}> = ({ primary, showLandmass }) => {
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
          const xScale = secLonRange / primaryLonRange;
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
          return (
            <group
              key={v.datasetId}
              position={[cx, cy, cz]}
              scale={[xScale, yScale, zScale]}
            >
              <TerrainMesh grid={g} />
              {showLandmass && <LandmassMesh grid={g} />}
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
// Helper: compute sea surface Y for a given terrain
// ---------------------------------------------------------------------------
function seaSurfaceY(terrain: TerrainData): number {
  const depthRange = (terrain.maxDepth - terrain.minDepth) || 1;
  return (terrain.minDepth / depthRange) * MAX_DEPTH_WORLD;
}

// ---------------------------------------------------------------------------
// Tidal 3D contents — lives inside <Canvas>.
//
// When tidal overlay is on we substitute TidalWaterPlane for the static
// WaterSurfacePlane so the surface visibly rises/falls with the tide.
// Both are gated on `showWaterSurface` so disabling the toggle hides any
// water plane (useful for cross-sections / dry-bathymetry views).
// ---------------------------------------------------------------------------
interface TidalSceneContentsProps {
  tidalData: TidalDataResult | null;
  depthLayer: DepthLayer;
  terrain: TerrainData;
  showWaterSurface: boolean;
}

const TidalSceneContents: React.FC<TidalSceneContentsProps> = ({
  tidalData,
  depthLayer,
  terrain,
  showWaterSurface,
}) => {
  if (!tidalData?.available) return null;

  const surfY = seaSurfaceY(terrain);

  return (
    <>
      {showWaterSurface && (
        <TidalWaterPlane tideHeight={tidalData.tideHeight} terrain={terrain} />
      )}
      <TidalCurrentArrows
        currentDirection={tidalData.currentDirection}
        currentSpeed={tidalData.currentSpeed}
        surfaceY={surfY + (tidalData.tideHeight / ((terrain.maxDepth - terrain.minDepth) || 1)) * MAX_DEPTH_WORLD}
        depthLayer={depthLayer}
        terrain={terrain}
      />
    </>
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
  const { driftPlannerActive, driftPath } = useDriftStore();

  if (!driftPlannerActive || !terrain) return null;

  const surfaceY = seaSurfaceY(terrain);
  return (
    <>
      <DriftWaterPlane surfaceY={surfaceY} terrain={terrain} />
      {driftPath && driftPath.length > 0 && (
        <>
          <DriftBoat surfaceY={surfaceY} />
          <DriftPath surfaceY={surfaceY} />
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

const SceneContents: React.FC<SceneContentsProps> = ({
  terrainMeshRef,
  tidalData,
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

  // Freshwater environments are clearer and brighter than the open ocean —
  // shift the background/fog hue toward green-teal, thin the fog, and warm
  // the ambient/key lights so lakes don't render with deep-sea twilight.
  const isFresh = waterType === "freshwater";
  const effectiveFogColor = isFresh ? "#0b3a35" : fogColor;
  const effectiveFogDensity = isFresh ? fogDensity * 0.55 : fogDensity;
  const ambientHue = isFresh ? "#a8d8c8" : "#7aa8c8";
  const directionalHue = isFresh ? "#dfffe8" : "#d0eeff";

  return (
    <>
      <color attach="background" args={[effectiveFogColor]} />
      <fogExp2 args={[effectiveFogColor, effectiveFogDensity]} />

      {/* Ambient fill — hue tracks water type */}
      <ambientLight intensity={ambientIntensity} color={ambientHue} />
      {/* Distant key light */}
      <directionalLight position={[10, 30, 20]} intensity={directionalIntensity} color={directionalHue} />

      <TestCameraBridge />
      <Particles />
      {terrain && <TerrainMesh ref={terrainMeshRef} grid={terrain} />}
      {terrain && showLandmass && <LandmassMesh grid={terrain} />}
      {terrain && <NonPrimaryDatasetMeshes primary={terrain} showLandmass={showLandmass} />}
      <EfhZoneLayer />
      <SubstrateLayer />
      <Caustics />

      {tidalOverlay && terrain ? (
        <TidalSceneContents
          tidalData={tidalData}
          depthLayer={depthLayer}
          terrain={terrain}
          showWaterSurface={showWaterSurface}
        />
      ) : (
        terrain && showWaterSurface && <WaterSurfacePlane terrain={terrain} />
      )}

      {terrain && <CurrentsSceneContents terrain={terrain} />}
      <MarkerLayer />
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
    <div className="font-mono text-cyan-400 text-lg tracking-[0.3em] uppercase animate-pulse">
      ▼ Descending...
    </div>
    <div className="font-mono text-cyan-900 text-xs mt-3 tracking-widest uppercase">
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
    <div className="font-mono text-red-400 text-lg tracking-[0.3em] uppercase mb-2">
      ⚠ Signal Lost
    </div>
    <div className="font-mono text-red-700 text-xs tracking-wider mb-6 max-w-xs text-center">
      {message}
    </div>
    <button
      onClick={onRetry}
      className="border border-red-800 text-red-400 font-mono text-xs px-5 py-2 tracking-widest uppercase hover:bg-red-900/20 transition-colors"
    >
      Retry Connection
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// TourScene — the main page
// ---------------------------------------------------------------------------
interface TourSceneProps {
  tidalData?: TidalDataResult | null;
  tidalOverlay?: boolean;
  depthLayer?: DepthLayer;
}

export const TourScene: React.FC<TourSceneProps> = ({
  tidalData = null,
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
      const canvas = state.gl.domElement;
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

  // E2E-only escape hatch: when running under the dev auth-bypass mode AND
  // the URL carries `?noCanvas=1`, skip mounting the R3F Canvas entirely.
  // Headless Chromium on this host cannot create a WebGL context (the GPU
  // process crashes before SwiftShader attaches — see playwright.config.ts),
  // so three.js throws on every Canvas mount and the resulting error storm
  // starves React-Query mutations of microtasks. Tests that exercise pure
  // DOM/HUD surfaces (e.g. the dataset-upload dropzone) opt out of the 3D
  // scene with this flag so the upload mutation can complete reliably.
  //
  // Gated to import.meta.env.DEV + VITE_DEV_AUTH_BYPASS so it can never
  // ship: in a production build, both guards collapse to false and Vite's
  // dead-code elimination drops the entire branch.
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_DEV_AUTH_BYPASS === "1" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("noCanvas") === "1"
  ) {
    return (
      <div
        className="relative w-full h-full"
        data-testid="tour-scene-canvas-disabled"
      />
    );
  }

  return (
    <div className="relative w-full h-full">
      <Canvas
        camera={{ position: [0, 20, 40], fov, far: renderDistance }}
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
