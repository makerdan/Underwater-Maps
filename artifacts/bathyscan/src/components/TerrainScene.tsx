import React, { useMemo, useRef, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useAppState } from "@/lib/context";
import { FlyControls } from "./FlyControls";
import { FlyRouteAnimator } from "./FlyRouteAnimator";
import { useSettingsStore } from "@/lib/settingsStore";
import { useLandTerrainStore } from "@/lib/landTerrainStore";
import { useLandTerrain } from "@/hooks/useLandTerrain";
import { useSatelliteTileStore } from "@/lib/satelliteTileStore";
import { useSatelliteTile } from "@/hooks/useSatelliteTile";

/** Maximum world-Y units the highest land point is displaced above Y=0. */
const MAX_LAND_HEIGHT = 20;

const TerrainMesh = () => {
  const { terrain } = useAppState();
  const meshRef = useRef<THREE.Mesh>(null);

  const { geometry, material } = useMemo(() => {
    if (!terrain) return { geometry: null, material: null };

    const { resolution, depths, minDepth, maxDepth } = terrain;
    const geometry = new THREE.PlaneGeometry(2, 2, resolution - 1, resolution - 1);
    
    // Rotate to lie flat
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes["position"]!.array as Float32Array;
    const colors = new Float32Array(positions.length);
    const color = new THREE.Color();
    const scaleZ = 0.8;

    const shallowColor = new THREE.Color("#2D6A9F");
    const midColor = new THREE.Color("#4B1E80");
    const deepColor = new THREE.Color("#050a14");

    for (let i = 0; i < depths.length; i++) {
      const depth = depths[i] ?? 0;
      const normalizedDepth = (depth - minDepth) / (maxDepth - minDepth || 1);
      
      // Update Y instead of Z because we rotated X by -90deg
      positions[i * 3 + 1] = normalizedDepth * -scaleZ;

      if (normalizedDepth < 0.5) {
        color.lerpColors(shallowColor, midColor, normalizedDepth * 2);
      } else {
        color.lerpColors(midColor, deepColor, (normalizedDepth - 0.5) * 2);
      }

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide
    });

    return { geometry, material };
  }, [terrain]);

  if (!geometry || !material) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} />
  );
};

/**
 * Renders above-water land terrain from the Copernicus DEM 90 m land grid,
 * with an ESRI World Imagery satellite texture draped over the surface when
 * available so coastlines, islands, and headlands look photo-realistic.
 *
 * The mesh shares the exact same XZ footprint (2×2 world units, PlaneGeometry)
 * as TerrainMesh so the two surfaces meet seamlessly at Y=0 (the waterline).
 * Vertices are displaced upward (positive Y) proportional to their normalised
 * elevation within the grid's own min/max range.
 *
 * Texture behaviour:
 *   - While the satellite tile is loading, the procedural colour ramp
 *     (green→brown→grey) is shown so there is no blank flash.
 *   - Once the satellite PNG arrives it is loaded into a THREE.Texture and
 *     the material's `map` is updated; vertex colours are disabled at that
 *     point so the photo texture renders at full fidelity.
 *   - If the fetch fails (upstream 502) the procedural ramp persists silently.
 */
const LandTerrainMesh = () => {
  const { terrain } = useAppState();
  const landGrid = useLandTerrainStore((s) => s.landGrid);
  const tileUrl = useSatelliteTileStore((s) => s.tileUrl);

  // Derive bbox from the primary terrain for both terrain + satellite hooks.
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
    const geom = new THREE.PlaneGeometry(2, 2, N - 1, N - 1);
    geom.rotateX(-Math.PI / 2);

    const positions = geom.attributes["position"]!.array as Float32Array;
    const colors = new Float32Array(positions.length);
    const color = new THREE.Color();

    // Scale: map the tallest cell to MAX_LAND_HEIGHT world units above Y=0.
    const scaleY = MAX_LAND_HEIGHT / 100;

    const lowColor  = new THREE.Color("#2d6a4f");  // dark forest green
    const midColor  = new THREE.Color("#8B5E3C");  // earthy brown
    const highColor = new THREE.Color("#d4d4d4");  // light grey/snow

    for (let i = 0; i < N * N; i++) {
      const elev = elevation[i] ?? 0;
      const t = elev > 0 ? Math.min(1, elev / maxElevation) : 0;

      positions[i * 3 + 1] = elev > 0 ? t * scaleY : 0;

      if (t < 0.5) {
        color.lerpColors(lowColor, midColor, t * 2);
      } else {
        color.lerpColors(midColor, highColor, (t - 0.5) * 2);
      }

      colors[i * 3]     = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    return { geometry: geom, proceduralMaterial: mat };
  }, [landGrid]);

  // Satellite texture — loaded from the object URL whenever tileUrl changes.
  // The texture is disposed when it is replaced or when the component unmounts.
  const [satelliteTexture, setSatelliteTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!tileUrl) {
      setSatelliteTexture((prev) => {
        prev?.dispose();
        return null;
      });
      return;
    }

    const loader = new THREE.TextureLoader();
    let disposed = false;
    loader.load(
      tileUrl,
      (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        // Flip the texture vertically: THREE.js loads images with Y=0 at the
        // bottom, but our PNG is top-to-bottom (north→south) so UVs need to
        // be flipped to match the PlaneGeometry UV layout.
        tex.flipY = true;
        tex.needsUpdate = true;
        setSatelliteTexture((prev) => {
          prev?.dispose();
          return tex;
        });
      },
      undefined,
      (err) => {
        if (!disposed) {
          console.warn("[LandTerrainMesh] Failed to load satellite texture:", err);
        }
      },
    );

    return () => {
      disposed = true;
    };
  }, [tileUrl]);

  // Dispose texture on unmount.
  useEffect(() => {
    return () => {
      satelliteTexture?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build the final material: use satellite texture when available, else
  // fall back to the vertex-colour procedural ramp.
  const material = useMemo(() => {
    if (!proceduralMaterial) return null;
    if (satelliteTexture) {
      return new THREE.MeshStandardMaterial({
        map: satelliteTexture,
        vertexColors: false,
        roughness: 0.85,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
    }
    return proceduralMaterial;
  }, [proceduralMaterial, satelliteTexture]);

  // Dispose the satellite material (not the procedural one — that's managed
  // by useMemo above) when it is replaced.
  const prevMaterialRef = useRef<THREE.Material | null>(null);
  useEffect(() => {
    const prev = prevMaterialRef.current;
    if (prev && prev !== proceduralMaterial && material !== prev) {
      prev.dispose();
    }
    prevMaterialRef.current = material;
  }, [material, proceduralMaterial]);

  if (!geometry || !material) return null;

  return <mesh geometry={geometry} material={material} />;
};

const Particles = () => {
  const count = 300;
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4;
    }
    return pos;
  }, [count]);

  const ref = useRef<THREE.Points>(null);

  useFrame(() => {
    if (ref.current) {
      ref.current.rotation.y += 0.0005;
      ref.current.rotation.x += 0.0002;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial size={0.002} color="#ffffff" transparent opacity={0.3} />
    </points>
  );
};

const LightsAndFog = () => {
  const { camera } = useThree();
  const pointLightRef = useRef<THREE.PointLight>(null);
  const fogDensity = useSettingsStore((s) => s.fogDensity);
  const lampIntensity = useSettingsStore((s) => s.lampIntensity);

  useFrame(() => {
    if (pointLightRef.current) {
      pointLightRef.current.position.copy(camera.position);
    }
  });

  return (
    <>
      <fogExp2 args={["#060c1a", fogDensity]} />
      <ambientLight intensity={0.05} />
      <directionalLight position={[-1, 1, 1]} intensity={0.2} color="#8ecaff" />
      <pointLight ref={pointLightRef} distance={80} intensity={lampIntensity} color="#ffeedd" />
    </>
  );
};

export const TerrainScene = () => {
  return (
    <div className="w-full h-full" style={{ display: "block", width: "100vw", height: "100vh" }}>
      <Canvas
        camera={{ position: [0, 0.5, 1], fov: 45 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#060c1a"]} />
        <LightsAndFog />
        <Particles />
        <TerrainMesh />
        <LandTerrainMesh />
        <FlyControls />
        <FlyRouteAnimator />
      </Canvas>
    </div>
  );
};
