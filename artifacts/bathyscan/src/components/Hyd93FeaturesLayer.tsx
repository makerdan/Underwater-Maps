/**
 * Hyd93FeaturesLayer — HYD93 cartographic annotation points in the 3D R3F scene.
 *
 * Renders kelp patches, rocks, rocky reefs, ledges, and obstructions extracted
 * from HYD93 .a93.gz files as labelled billboard sprites floating just above
 * the terrain.  Each feature code maps to a distinct color and short label.
 *
 * Feature codes:
 *   89  → Rocks       (red)
 *  103  → Kelp        (green)
 *  146  → Ledge       (yellow)
 *  530  → Rocky reef  (amber)
 *  988  → Obstruction (purple)
 *
 * Visibility is gated on `hyd93FeaturesEnabled` from uiStore.  The component
 * always mounts (so React Query can prefetch), but renders nothing when the
 * toggle is off or the dataset has no HYD93 features.
 */
import React, { useMemo, useEffect, useRef } from "react";
import * as THREE from "three";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { WORLD_SIZE } from "@/lib/terrain";
import { useTerrainStore } from "@/lib/terrainStore";
import { useGetUserDatasetsIdHyd93Features, getGetUserDatasetsIdHyd93FeaturesQueryKey } from "@workspace/api-client-react";

/** Y elevation for annotation sprites — above water surface (Y=0). */
const SPRITE_Y = 2.5;

/** Sprite size in world units. */
const SPRITE_SIZE = 4;

interface FeatureStyle {
  label: string;
  color: string;
}

const FEATURE_STYLES: Record<number, FeatureStyle> = {
  89:  { label: "Rocks",        color: "#ef4444" },
  103: { label: "Kelp",         color: "#22c55e" },
  146: { label: "Ledge",        color: "#eab308" },
  530: { label: "Rocky reef",   color: "#f97316" },
  988: { label: "Obstruction",  color: "#a855f7" },
};

function lonToWorldX(lon: number, minLon: number, lonRange: number): number {
  return ((lon - minLon) / lonRange) * WORLD_SIZE - WORLD_SIZE / 2;
}

function latToWorldZ(lat: number, minLat: number, latRange: number): number {
  return ((lat - minLat) / latRange) * WORLD_SIZE - WORLD_SIZE / 2;
}

/**
 * Build a canvas-based sprite texture for a single feature type.
 * Renders a filled circle with the feature label beneath it.
 */
function buildSpriteTexture(style: FeatureStyle): THREE.CanvasTexture {
  const SIZE = 256;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, SIZE, SIZE);

  const cx = SIZE / 2;
  const cy = SIZE * 0.38;
  const r = SIZE * 0.22;

  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = style.color;
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = `bold ${Math.round(SIZE * 0.13)}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillText(style.label.toUpperCase(), cx + 1, cy * 1.95 + 1);
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(style.label.toUpperCase(), cx, cy * 1.95);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

interface AnnotationPoint {
  lon: number;
  lat: number;
  featureCode: number;
}

interface SpriteProps {
  x: number;
  y: number;
  z: number;
  texture: THREE.CanvasTexture;
}

const AnnotationSprite: React.FC<SpriteProps> = ({ x, y, z, texture }) => {
  const ref = useRef<THREE.Sprite>(null);

  return (
    <sprite
      ref={ref}
      position={[x, y, z]}
      renderOrder={10}
      scale={[SPRITE_SIZE, SPRITE_SIZE, 1]}
    >
      <spriteMaterial
        map={texture}
        transparent
        depthWrite={false}
        sizeAttenuation
      />
    </sprite>
  );
};

export const Hyd93FeaturesLayer: React.FC = () => {
  const { terrain } = useAppState();
  const hyd93FeaturesEnabled = useUiStore((s) => s.hyd93FeaturesEnabled);
  const hyd93ActiveFeatureCodes = useUiStore((s) => s.hyd93ActiveFeatureCodes);
  const visibleDatasets = useTerrainStore((s) => s.visibleDatasets);
  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);

  const isUserDataset =
    visibleDatasets.find((v) => v.datasetId === primaryDatasetId)?.source === "user";

  const datasetId = terrain?.datasetId ?? "";

  const { data: features } = useGetUserDatasetsIdHyd93Features(
    datasetId,
    {
      query: {
        enabled: !!datasetId && isUserDataset && hyd93FeaturesEnabled,
        queryKey: getGetUserDatasetsIdHyd93FeaturesQueryKey(datasetId),
        staleTime: 10 * 60 * 1000,
      },
    },
  );

  const minLon = terrain?.minLon ?? 0;
  const maxLon = terrain?.maxLon ?? 1;
  const minLat = terrain?.minLat ?? 0;
  const maxLat = terrain?.maxLat ?? 1;
  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;

  const textures = useMemo(() => {
    const map = new Map<number, THREE.CanvasTexture>();
    for (const code of Object.keys(FEATURE_STYLES).map(Number)) {
      map.set(code, buildSpriteTexture(FEATURE_STYLES[code]!));
    }
    return map;
  }, []);

  useEffect(() => {
    return () => {
      for (const tex of textures.values()) {
        tex.dispose();
      }
    };
  }, [textures]);

  const sprites = useMemo((): Array<{ key: string; x: number; y: number; z: number; texture: THREE.CanvasTexture }> => {
    if (!features?.length || !terrain) return [];
    return (features as AnnotationPoint[])
      .filter((pt) => hyd93ActiveFeatureCodes.has(pt.featureCode))
      .map((pt, i) => {
        const x = lonToWorldX(pt.lon, minLon, lonRange);
        const z = latToWorldZ(pt.lat, minLat, latRange);
        const texture = textures.get(pt.featureCode) ?? textures.get(89)!;
        return { key: `${pt.featureCode}-${i}`, x, y: SPRITE_Y, z, texture };
      });
  }, [features, terrain, minLon, lonRange, minLat, latRange, textures, hyd93ActiveFeatureCodes]);

  if (!hyd93FeaturesEnabled || !sprites.length) return null;

  return (
    <group name="hyd93-annotation-features">
      {sprites.map((s) => (
        <AnnotationSprite
          key={s.key}
          x={s.x}
          y={s.y}
          z={s.z}
          texture={s.texture}
        />
      ))}
    </group>
  );
};
