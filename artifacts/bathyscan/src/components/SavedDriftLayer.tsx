import React, { useMemo } from "react";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { Marker, TerrainData } from "@workspace/api-client-react";
import { lonLatToWorldXZ } from "@/lib/terrain";
import { isDriftMarker, sampleDriftWaypoints } from "@/lib/driftMarker";
import { useMarkerDetailStore } from "@/lib/markerDetailStore";

const SavedDrift: React.FC<{ marker: Marker; terrain: TerrainData; surfaceY: number }> = ({ marker, terrain, surfaceY }) => {
  const show = useMarkerDetailStore((s) => s.show);
  const geometry = isDriftMarker(marker) ? marker.geometry : null;
  const points = useMemo(
    () => geometry ? sampleDriftWaypoints(geometry, 48).map((p) => {
      const { x, z } = lonLatToWorldXZ(p.lon, p.lat, terrain);
      return new THREE.Vector3(x, surfaceY + 0.3, z);
    }) : [],
    [geometry, terrain, surfaceY],
  );
  if (!geometry || points.length < 2) return null;
  const highlight = marker.type === "chinook_salmon" || marker.type === "silver_salmon" ||
    marker.type === "pink_salmon" || marker.type === "school_salmon";
  const color = highlight ? "#fb923c" : "#a78bfa";
  return (
    <group userData={{ markerId: marker.id, savedDrift: true }}>
      <Line points={points} color={color} lineWidth={3} dashed dashSize={0.35} gapSize={0.18} />
      {points.map((p, i) => (
        <mesh
          key={`${marker.id}-${i}`}
          position={p}
          onClick={(e) => { e.stopPropagation(); show(marker); }}
        >
          <sphereGeometry args={[i === 0 || i === points.length - 1 ? 0.22 : 0.1, 8, 6]} />
          <meshBasicMaterial color={i === 0 ? "#22d3ee" : i === points.length - 1 ? "#f43f5e" : color} />
        </mesh>
      ))}
      <mesh position={points[0]} onClick={(e) => { e.stopPropagation(); show(marker); }}>
        <ringGeometry args={[0.28, 0.4, 16]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {geometry.waypoints.some((p) => p.depth >= geometry.summary.maxDepth * 0.95) && (
        <Line points={points.slice(0, Math.max(2, Math.ceil(points.length / 3)))} color="#fbbf24" lineWidth={5} transparent opacity={0.75} />
      )}
    </group>
  );
};

export const SavedDriftLayer: React.FC<{ markers: Marker[]; terrain: TerrainData; surfaceY: number }> = ({ markers, terrain, surfaceY }) => (
  <group name="saved-drift-markers">
    {markers.filter(isDriftMarker).map((marker) => <SavedDrift key={marker.id} marker={marker} terrain={terrain} surfaceY={surfaceY} />)}
  </group>
);