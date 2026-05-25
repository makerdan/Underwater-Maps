import type { TerrainData } from "@workspace/api-client-react";
import { WORLD_SIZE } from "./terrain";

export const BOAT_MIN_MPH = 3;
export const BOAT_MAX_MPH = 55;
export const BOAT_DEFAULT_MPH = 15;

const MPH_TO_MS = 0.44704;

const DEG_TO_RAD = Math.PI / 180;

function haversineMeters(
  lon1: number, lat1: number,
  lon2: number, lat2: number,
): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeMetersPerWorldUnit(grid: TerrainData): number {
  const centerLat = (grid.minLat + grid.maxLat) / 2;
  const widthM = haversineMeters(grid.minLon, centerLat, grid.maxLon, centerLat);
  const mpu = widthM / WORLD_SIZE;
  return mpu > 0 ? mpu : 1;
}

export function boatMphToWorldUnitsPerSecond(mph: number, metersPerWorldUnit: number): number {
  const ms = mph * MPH_TO_MS;
  return ms / metersPerWorldUnit;
}

export function mphToKnots(mph: number): number {
  return mph * 0.868976;
}

export const BOAT_TICK_SPEEDS = [3, 10, 20, 30, 40, 55] as const;
