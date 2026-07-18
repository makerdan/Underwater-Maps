/**
 * WakeLockManager — keeps the screen awake while the angler is on the water.
 *
 * Active whenever Live sidebar mode is on OR GPS follow mode is engaged, so
 * the display doesn't sleep mid-session in the rain with gloves on.
 * Renders nothing; mounted once in App.
 */
import React from "react";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useUiStore } from "@/lib/uiStore";
import { useCameraStore } from "@/lib/cameraStore";

export const WakeLockManager: React.FC = () => {
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const gpsFollowMode = useCameraStore((s) => s.gpsFollowMode);
  useWakeLock(sidebarMode === "live" || gpsFollowMode);
  return null;
};
