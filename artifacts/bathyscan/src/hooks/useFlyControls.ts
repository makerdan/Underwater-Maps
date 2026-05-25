import { useEffect, useRef, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useQueryClient } from "@tanstack/react-query";
import * as THREE from "three";
import type { Marker, TerrainData } from "@workspace/api-client-react";
import {
  useDeleteMarkersId,
  getGetMarkersQueryKey,
} from "@workspace/api-client-react";
import { useAppState, SPEEDS } from "@/lib/context";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { worldXZToLonLat, worldYToMetres, lonLatToWorldXZ, MAX_DEPTH_WORLD } from "@/lib/terrain";
import { useJoystickStore } from "@/components/VirtualJoystick";
import { computeMetersPerWorldUnit, boatMphToWorldUnitsPerSecond } from "@/lib/boatSpeed";
import { markerGroupRef } from "@/components/MarkerLayer";
import { useContextMenuStore, type ContextMenuItem } from "@/lib/contextMenuStore";
import { runMarkerDelete } from "@/lib/markerActions";
import { useMeasureStore } from "@/lib/measureStore";
import { useDepthProfileStore, buildProfile } from "@/lib/depthProfileStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useMarkerDetailStore } from "@/lib/markerDetailStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { haversineDistance } from "@/lib/geo";
import { computePinchDolly, computeWheelDolly } from "@/lib/zoomMath";
import { processFlyWheel } from "@/lib/flyWheel";
import {
  applyOrbitDrag,
  applyOrbitDolly,
  ORBIT_CLICK_VS_DRAG_PX,
} from "@/lib/orbitMath";

function copyToClipboard(text: string): void {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  navigator.clipboard.writeText(text).catch(() => {
    // Best-effort; clipboard may be blocked by permissions
  });
}

function formatCoords(lon: number, lat: number, depth: number): string {
  return `lat: ${lat.toFixed(5)}, lon: ${lon.toFixed(5)}, depth: ${Math.round(depth)}m`;
}

interface FlyControlsOptions {
  terrainMeshRef: React.RefObject<THREE.Mesh | null>;
  lightRef: React.RefObject<THREE.PointLight | null>;
}

export function useFlyControls({ terrainMeshRef, lightRef }: FlyControlsOptions) {
  const { camera, gl } = useThree();
  const {
    mode, setMode, speedIndex, setSpeedIndex, terrain, setCameraPos,
    realisticMode, boatSpeedMph,
  } = useAppState();

  const queryClient = useQueryClient();
  const deleteMarker = useDeleteMarkersId();
  const deleteMarkerRef = useRef(deleteMarker);
  useEffect(() => { deleteMarkerRef.current = deleteMarker; }, [deleteMarker]);

  // Settings: sensitivity and invert-Y for mouse look
  const mouseSensitivity = useSettingsStore((s) => s.mouseSensitivity);
  const invertMouseY = useSettingsStore((s) => s.invertMouseY);
  const mouseZoomSensitivity = useSettingsStore((s) => s.mouseZoomSensitivity);
  const touchpadZoomSensitivity = useSettingsStore((s) => s.touchpadZoomSensitivity);
  const pinchZoomSensitivity = useSettingsStore((s) => s.pinchZoomSensitivity);
  const sensitivityRef = useRef(mouseSensitivity);
  const invertMouseYRef = useRef(invertMouseY);
  const mouseZoomSensRef = useRef(mouseZoomSensitivity);
  const touchpadZoomSensRef = useRef(touchpadZoomSensitivity);
  const pinchZoomSensRef = useRef(pinchZoomSensitivity);
  useEffect(() => { sensitivityRef.current = mouseSensitivity; }, [mouseSensitivity]);
  useEffect(() => { invertMouseYRef.current = invertMouseY; }, [invertMouseY]);
  useEffect(() => { mouseZoomSensRef.current = mouseZoomSensitivity; }, [mouseZoomSensitivity]);
  useEffect(() => { touchpadZoomSensRef.current = touchpadZoomSensitivity; }, [touchpadZoomSensitivity]);
  useEffect(() => { pinchZoomSensRef.current = pinchZoomSensitivity; }, [pinchZoomSensitivity]);

  // Refs for event-listener / useFrame closures to stay current
  const modeRef = useRef(mode);
  const speedIndexRef = useRef(speedIndex);
  const terrainRef = useRef<TerrainData | null>(terrain);
  const realisticModeRef = useRef(realisticMode);
  const boatSpeedMphRef = useRef(boatSpeedMph);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { speedIndexRef.current = speedIndex; }, [speedIndex]);
  useEffect(() => { terrainRef.current = terrain; }, [terrain]);
  useEffect(() => { realisticModeRef.current = realisticMode; }, [realisticMode]);
  useEffect(() => { boatSpeedMphRef.current = boatSpeedMph; }, [boatSpeedMph]);

  // Sync mode and speedIndex to cameraStore for HUD reads
  useEffect(() => { useCameraStore.getState().setMode(mode); }, [mode]);
  useEffect(() => { useCameraStore.getState().setSpeedIndex(speedIndex); }, [speedIndex]);

  const keys = useRef<Record<string, boolean>>({});
  const isLocked = useRef(false);
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const raycaster = useRef(new THREE.Raycaster());
  const downRaycaster = useRef(new THREE.Raycaster());
  const downDir = useRef(new THREE.Vector3(0, -1, 0));
  const ndcCenter = useRef(new THREE.Vector2(0, 0));
  const lookDir = useRef(new THREE.Vector3());
  const moveDir = useRef(new THREE.Vector3());
  const rightDir = useRef(new THREE.Vector3());
  const lightPos = useRef(new THREE.Vector3());
  const orbitTargetArr = useRef<[number, number, number]>([0, -10, 0]);

  // Transient right-drag / Ctrl-left-drag orbit gesture. Independent of the
  // app-state `mode` field (which now stays at "fly" forever). While
  // `active` is true, WASD movement, mouse-look, and wheel-along-view are
  // suspended in favour of orbiting around `target`.
  const orbitState = useRef({
    active: false,
    candidate: false,
    button: 0,
    totalDist: 0,
    target: new THREE.Vector3(),
  });
  // Right-button releases that *did* orbit should not pop the context menu
  // (which fires as a follow-up `contextmenu` event). Same for the click
  // event that would otherwise re-enter pointer lock after a Ctrl-left
  // orbit gesture.
  const suppressNextContextMenu = useRef(false);
  const suppressNextClick = useRef(false);

  // ---------------------------------------------------------------------------
  // Camera initialisation: place 10 units above deepest terrain point
  // ---------------------------------------------------------------------------
  const resetCamera = useCallback(() => {
    const grid = terrainRef.current;
    if (!grid) return;
    const { resolution: N, depths, minDepth, maxDepth } = grid;
    const depthRange = maxDepth - minDepth || 1;

    // If user has set a "home position" for this dataset via the context menu,
    // spawn there instead of at the deepest point.
    const home = useSettingsStore.getState().datasetHomePositions[grid.datasetId];
    if (home) {
      const { x, z } = lonLatToWorldXZ(home.lon, home.lat, grid);
      const t = (home.depth - minDepth) / depthRange;
      const surfaceY = -Math.max(0, Math.min(1, t)) * MAX_DEPTH_WORLD;
      camera.position.set(x, surfaceY + 10, z);
      euler.current.set(-0.25, 0, 0);
      camera.quaternion.setFromEuler(euler.current);
      return;
    }

    let maxIdx = 0;
    for (let i = 1; i < depths.length; i++) {
      if ((depths[i] ?? 0) > (depths[maxIdx] ?? 0)) maxIdx = i;
    }

    const col = maxIdx % N;
    const row = Math.floor(maxIdx / N);
    const lon = grid.minLon + (col / Math.max(1, N - 1)) * (grid.maxLon - grid.minLon);
    const lat = grid.minLat + (row / Math.max(1, N - 1)) * (grid.maxLat - grid.minLat);
    const { x, z } = lonLatToWorldXZ(lon, lat, grid);
    const t = ((depths[maxIdx] ?? 0) - minDepth) / depthRange;
    const surfaceY = -Math.max(0, Math.min(1, t)) * MAX_DEPTH_WORLD;

    camera.position.set(x, surfaceY + 10, z);
    euler.current.set(-0.25, 0, 0);
    camera.quaternion.setFromEuler(euler.current);
  }, [camera]);

  // Reset camera each time a new terrain dataset is loaded
  useEffect(() => {
    if (terrain) resetCamera();
  }, [terrain, resetCamera]);

  // ---------------------------------------------------------------------------
  // Pointer lock (desktop only — touch devices use VirtualJoystick instead)
  // ---------------------------------------------------------------------------
  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

  useEffect(() => {
    if (isTouchDevice) return; // no pointer lock on mobile

    const canvas = gl.domElement;

    const handleClick = () => {
      // Don't re-enter pointer lock immediately after an orbit gesture —
      // the click event fires after mouseup, and we want the cursor to
      // stay visible so the user knows the gesture ended.
      if (suppressNextClick.current) {
        suppressNextClick.current = false;
        return;
      }
      if (modeRef.current === "fly" && !isLocked.current) {
        canvas.requestPointerLock();
      }
    };

    const handlePointerLockChange = () => {
      isLocked.current = document.pointerLockElement === canvas;
    };

    canvas.addEventListener("click", handleClick);
    document.addEventListener("pointerlockchange", handlePointerLockChange);

    return () => {
      canvas.removeEventListener("click", handleClick);
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
    };
  }, [gl.domElement, isTouchDevice]);

  // ---------------------------------------------------------------------------
  // Keyboard / mouse / wheel listeners
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true;

      // +/= : speed tier up, -/_ : speed tier down (fly mode, not realistic)
      if (modeRef.current === "fly" && !realisticModeRef.current) {
        if (e.code === "Equal" || e.code === "NumpadAdd") {
          e.preventDefault();
          setSpeedIndex(Math.min(SPEEDS.length - 1, speedIndexRef.current + 1));
          return;
        }
        if (e.code === "Minus" || e.code === "NumpadSubtract") {
          e.preventDefault();
          setSpeedIndex(Math.max(0, speedIndexRef.current - 1));
          return;
        }
      }

      // G: pin GPS and open marker form
      if (e.code === "KeyG") {
        const gps = useCameraStore.getState().crosshairGps;
        if (gps) {
          useCameraStore.getState().setLastClickedGps(gps);
          useUiStore.getState().setMarkerFormOpen(true);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };

    // ─── Right-drag / Ctrl-left-drag orbit gesture ───────────────────────
    // Raycast a viewport point against the terrain; fall back to a point
    // along the view direction if the ray misses (lets the gesture work
    // even when aimed at the sky).
    const computeOrbitTargetAt = (clientX: number, clientY: number): THREE.Vector3 => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.current.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const mesh = terrainMeshRef.current;
      if (mesh) {
        const hits = raycaster.current.intersectObject(mesh, false);
        if (hits[0]) return hits[0].point.clone();
      }
      // Fallback: 20 units along the view direction
      camera.getWorldDirection(lookDir.current);
      return new THREE.Vector3()
        .copy(camera.position)
        .addScaledVector(lookDir.current, 20);
    };

    const handleMouseDown = (e: MouseEvent) => {
      const isOrbitButton = e.button === 2 || (e.button === 0 && e.ctrlKey);
      if (!isOrbitButton) return;
      // Begin orbit candidate. Don't commit until movement exceeds threshold —
      // that way a quick right-click without drag still pops the context menu.
      orbitState.current.candidate = true;
      orbitState.current.active = false;
      orbitState.current.button = e.button;
      orbitState.current.totalDist = 0;
      orbitState.current.target.copy(
        computeOrbitTargetAt(e.clientX, e.clientY),
      );
      orbitTargetArr.current = [
        orbitState.current.target.x,
        orbitState.current.target.y,
        orbitState.current.target.z,
      ];
      // Release pointer lock so the cursor reappears for the drag.
      if (isLocked.current) document.exitPointerLock();
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!orbitState.current.candidate && !orbitState.current.active) return;
      if (e.button !== orbitState.current.button) return;
      const wasActive = orbitState.current.active;
      orbitState.current.candidate = false;
      orbitState.current.active = false;
      orbitState.current.totalDist = 0;
      if (wasActive) {
        // Drag committed → swallow the follow-up contextmenu / click event
        // so we don't pop the menu or re-enter pointer lock by accident.
        if (e.button === 2) suppressNextContextMenu.current = true;
        if (e.button === 0) suppressNextClick.current = true;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      // Orbit drag has priority over fly-mode look.
      if (orbitState.current.candidate || orbitState.current.active) {
        const dx = e.movementX ?? 0;
        const dy = e.movementY ?? 0;
        orbitState.current.totalDist += Math.abs(dx) + Math.abs(dy);
        if (
          !orbitState.current.active &&
          orbitState.current.totalDist > ORBIT_CLICK_VS_DRAG_PX
        ) {
          orbitState.current.active = true;
        }
        if (orbitState.current.active) {
          applyOrbitDrag(camera, orbitState.current.target, dx, dy, {
            sensitivity: sensitivityRef.current,
            invertY: invertMouseYRef.current,
          });
        }
        return;
      }
      if (!isLocked.current || modeRef.current !== "fly") return;
      const dx = e.movementX ?? 0;
      const dy = e.movementY ?? 0;
      const sens = sensitivityRef.current * 0.002;
      const dyScaled = invertMouseYRef.current ? -dy : dy;
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= dx * sens;
      euler.current.x = Math.max(
        -Math.PI * 0.472,
        Math.min(Math.PI * 0.472, euler.current.x - dyScaled * sens),
      );
      camera.quaternion.setFromEuler(euler.current);
    };

    const handleWheel = (e: WheelEvent) => {
      // While orbiting, wheel dollies toward/away from the orbit target,
      // not along the view direction.
      if (orbitState.current.active) {
        e.preventDefault();
        const dolly = computeWheelDolly(
          e.deltaY,
          e.deltaMode,
          mouseZoomSensRef.current,
          touchpadZoomSensRef.current,
        );
        // computeWheelDolly returns world-units; convert to a fractional
        // dolly relative to current distance so the gesture feels right
        // at any scale. ~2 units / scroll notch at a distance of 20 units
        // ≈ 10% closer per notch.
        const offset = new THREE.Vector3().subVectors(
          camera.position,
          orbitState.current.target,
        );
        const dist = offset.length() || 1;
        applyOrbitDolly(camera, orbitState.current.target, dolly / dist);
        return;
      }
      if (modeRef.current !== "fly") return;
      e.preventDefault();
      const result = processFlyWheel(camera, e, speedIndexRef.current, {
        mouseZoomSensitivity: mouseZoomSensRef.current,
        touchpadZoomSensitivity: touchpadZoomSensRef.current,
        realisticMode: realisticModeRef.current,
      });
      if (result.newSpeedIndex !== null) {
        setSpeedIndex(result.newSpeedIndex);
      }
    };

    // ─── Two-finger pinch-zoom + orbit (touch) ───
    const activePointers = new Map<number, { x: number; y: number }>();
    let lastPinchDist = 0;
    // Midpoint of the two fingers at the previous move event. Used as the
    // baseline for the two-finger orbit gesture.
    let lastPinchMid: { x: number; y: number } | null = null;
    const touchOrbitTarget = new THREE.Vector3();
    let touchOrbitActive = false;

    // ─── Long-press → context menu for touch users ───
    // Mirrors the desktop right-click menu: ~500ms hold with minimal movement
    // opens the same menu against the touch point.
    const LONG_PRESS_MS = 500;
    const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
    let longPressTimer: number | null = null;
    let longPressStart: { x: number; y: number; pointerId: number } | null = null;
    let longPressFired = false;

    const cancelLongPress = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPressStart = null;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        lastPinchDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        const midX = (pts[0]!.x + pts[1]!.x) / 2;
        const midY = (pts[0]!.y + pts[1]!.y) / 2;
        lastPinchMid = { x: midX, y: midY };
        touchOrbitTarget.copy(computeOrbitTargetAt(midX, midY));
        touchOrbitActive = true;
        // Second finger down → no longer a long-press candidate
        cancelLongPress();
        return;
      }
      // Single-finger touch: arm long-press timer. Works in fly or orbit mode.
      if (activePointers.size === 1) {
        longPressFired = false;
        longPressStart = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
        longPressTimer = window.setTimeout(() => {
          longPressTimer = null;
          if (!longPressStart) return;
          const { x, y } = longPressStart;
          longPressStart = null;
          longPressFired = true;
          showContextMenuAt(x, y);
        }, LONG_PRESS_MS);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Cancel long-press if finger moves too far before timer fires
      if (longPressStart && e.pointerId === longPressStart.pointerId) {
        const dx = e.clientX - longPressStart.x;
        const dy = e.clientY - longPressStart.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) {
          cancelLongPress();
        }
      }
      if (activePointers.size === 2 && modeRef.current === "fly") {
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        const midX = (pts[0]!.x + pts[1]!.x) / 2;
        const midY = (pts[0]!.y + pts[1]!.y) / 2;

        // Pinch dolly toward/away from the orbit target.
        const pinchDelta = dist - lastPinchDist;
        lastPinchDist = dist;
        if (touchOrbitActive) {
          const dolly = computePinchDolly(pinchDelta, pinchZoomSensRef.current);
          const offset = new THREE.Vector3().subVectors(
            camera.position,
            touchOrbitTarget,
          );
          const distToTarget = offset.length() || 1;
          applyOrbitDolly(camera, touchOrbitTarget, dolly / distToTarget);
        } else {
          const dolly = computePinchDolly(pinchDelta, pinchZoomSensRef.current);
          camera.getWorldDirection(lookDir.current);
          camera.position.addScaledVector(lookDir.current, dolly);
        }

        // Midpoint drag → orbit around the touch target.
        if (touchOrbitActive && lastPinchMid) {
          const dxMid = midX - lastPinchMid.x;
          const dyMid = midY - lastPinchMid.y;
          if (dxMid !== 0 || dyMid !== 0) {
            applyOrbitDrag(camera, touchOrbitTarget, dxMid, dyMid, {
              sensitivity: sensitivityRef.current,
              invertY: invertMouseYRef.current,
            });
          }
        }
        lastPinchMid = { x: midX, y: midY };
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      activePointers.delete(e.pointerId);
      lastPinchDist = 0;
      if (activePointers.size < 2) {
        touchOrbitActive = false;
        lastPinchMid = null;
      }
      if (longPressStart && e.pointerId === longPressStart.pointerId) {
        cancelLongPress();
      }
      // If the long-press menu just fired, swallow the subsequent click so it
      // doesn't immediately dismiss the menu or trigger marker interaction.
      if (longPressFired) {
        longPressFired = false;
        e.preventDefault();
      }
    };

    const buildTerrainMenuItems = (
      lon: number,
      lat: number,
      depth: number,
      datasetId: string,
    ): ContextMenuItem[] => {
      const measureAnchor = useMeasureStore.getState().anchorGps;
      const profileAnchor = useDepthProfileStore.getState().anchor;
      const items: ContextMenuItem[] = [
        {
          label: "Drop GPS pin here",
          icon: "📍",
          onClick: () => {
            useCameraStore.getState().setLastClickedGps({ lon, lat, depth });
            useUiStore.getState().setMarkerFormOpen(true);
          },
        },
        {
          label: measureAnchor ? "Measure to here" : "Measure from here",
          icon: "📏",
          onClick: () => {
            const ms = useMeasureStore.getState();
            if (ms.anchorGps) {
              const distanceKm = haversineDistance(
                { lon: ms.anchorGps.lon, lat: ms.anchorGps.lat },
                { lon, lat },
              );
              const depthDeltaM = depth - ms.anchorGps.depth;
              ms.setResult(distanceKm, depthDeltaM);
            } else {
              ms.setAnchor({ lon, lat, depth });
            }
          },
        },
        {
          label: "Set as home position",
          icon: "🏠",
          onClick: () => {
            if (datasetId) {
              useSettingsStore
                .getState()
                .setDatasetHome(datasetId, { lon, lat, depth });
            }
          },
          disabled: !datasetId,
        },
        {
          label: profileAnchor ? "End depth profile here" : "Start depth profile here",
          icon: "📈",
          onClick: () => {
            const store = useDepthProfileStore.getState();
            const grid = terrainRef.current;
            if (store.anchor && grid) {
              const zoneMap = useClassificationStore.getState().zoneMap;
              const result = buildProfile(
                grid,
                store.anchor,
                { lon, lat, depth },
                zoneMap,
              );
              store.setProfile(result);
            } else {
              store.setAnchor({ lon, lat, depth });
            }
          },
        },
        ...(profileAnchor
          ? [{
              label: "Cancel depth profile",
              icon: "✖",
              onClick: () => useDepthProfileStore.getState().clearAnchor(),
            } as ContextMenuItem]
          : []),
        { label: "", onClick: () => {}, separator: true },
        {
          label: "Copy coordinates",
          icon: "📋",
          onClick: () => copyToClipboard(formatCoords(lon, lat, depth)),
        },
      ];
      return items;
    };

    const buildMarkerMenuItems = (marker: Marker): ContextMenuItem[] => {
      const grid = terrainRef.current;
      const items: ContextMenuItem[] = [
        {
          label: "Fly to marker",
          icon: "✈️",
          onClick: () => {
            if (!grid) return;
            const { x, z } = lonLatToWorldXZ(marker.lon, marker.lat, grid);
            useUiStore.getState().setPendingDropIn({ worldX: x, worldZ: z });
          },
          disabled: !grid,
        },
        {
          label: "View details",
          icon: "ℹ️",
          onClick: () => useMarkerDetailStore.getState().show(marker),
        },
        {
          label: "Copy coordinates",
          icon: "📋",
          onClick: () =>
            copyToClipboard(formatCoords(marker.lon, marker.lat, marker.depth)),
        },
        { label: "", onClick: () => {}, separator: true },
        {
          label: "Delete marker",
          icon: "🗑️",
          onClick: () => {
            // Capture datasetId at action time so a mid-flight dataset switch
            // doesn't cause us to invalidate the wrong query key.
            const datasetId = terrainRef.current?.datasetId ?? "";
            runMarkerDelete({
              marker,
              datasetId,
              queryClient,
              mutation: deleteMarkerRef.current,
            });
          },
        },
      ];
      return items;
    };

    const findMarkerById = (id: string): Marker | undefined => {
      const datasetId = terrainRef.current?.datasetId ?? "";
      if (!datasetId) return undefined;
      const markers = queryClient.getQueryData<Marker[]>(
        getGetMarkersQueryKey({ datasetId }),
      );
      return markers?.find((m) => m.id === id);
    };

    // Shared menu-showing logic used by both the desktop right-click handler
    // and the touch long-press timer. (x, y) are viewport coords.
    const showContextMenuAt = (x: number, y: number) => {
      if (modeRef.current !== "fly" && modeRef.current !== "orbit") return;

      // NDC at click position
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((x - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((y - rect.top) / rect.height) * 2 - 1);
      const ndc = new THREE.Vector2(ndcX, ndcY);
      raycaster.current.setFromCamera(ndc, camera);

      // 1. Raycast against marker sprites first
      const markerGroup = markerGroupRef.current;
      if (markerGroup) {
        const markerHits = raycaster.current.intersectObject(markerGroup, true);
        if (markerHits[0]) {
          let node: THREE.Object3D | null = markerHits[0].object;
          while (node && node.userData["markerId"] === undefined) node = node.parent;
          const markerId = node?.userData["markerId"] as string | undefined;
          if (markerId) {
            const marker = findMarkerById(markerId);
            if (marker) {
              useContextMenuStore
                .getState()
                .show(x, y, buildMarkerMenuItems(marker));
              return;
            }
          }
        }
      }

      // 2. Fall through to terrain raycast
      const mesh = terrainMeshRef.current;
      const grid = terrainRef.current;
      if (mesh && grid) {
        const hits = raycaster.current.intersectObject(mesh, false);
        if (hits[0]) {
          const pt = hits[0].point;
          const { lon, lat } = worldXZToLonLat(pt.x, pt.z, grid);
          const depth = worldYToMetres(pt.y, grid);
          useContextMenuStore
            .getState()
            .show(x, y, buildTerrainMenuItems(lon, lat, depth, grid.datasetId));
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      // Right-drag orbit just ended → swallow the menu so it doesn't pop
      // up over where the user was orbiting.
      if (suppressNextContextMenu.current) {
        suppressNextContextMenu.current = false;
        return;
      }
      if (modeRef.current !== "fly") return;

      // Pointer locked → no menu (cursor not visible). Use crosshair GPS pin shortcut.
      if (isLocked.current) {
        const gps = useCameraStore.getState().crosshairGps;
        if (gps) {
          useCameraStore.getState().setLastClickedGps(gps);
          useUiStore.getState().setMarkerFormOpen(true);
        }
        return;
      }

      showContextMenuAt(e.clientX, e.clientY);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    document.addEventListener("mousemove", handleMouseMove);
    gl.domElement.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    gl.domElement.addEventListener("wheel", handleWheel, { passive: false });
    gl.domElement.addEventListener("contextmenu", handleContextMenu);
    gl.domElement.addEventListener("pointerdown", handlePointerDown);
    gl.domElement.addEventListener("pointermove", handlePointerMove);
    gl.domElement.addEventListener("pointerup", handlePointerUp);
    gl.domElement.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("mousemove", handleMouseMove);
      gl.domElement.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      gl.domElement.removeEventListener("wheel", handleWheel);
      gl.domElement.removeEventListener("contextmenu", handleContextMenu);
      gl.domElement.removeEventListener("pointerdown", handlePointerDown);
      gl.domElement.removeEventListener("pointermove", handlePointerMove);
      gl.domElement.removeEventListener("pointerup", handlePointerUp);
      gl.domElement.removeEventListener("pointercancel", handlePointerUp);
      cancelLongPress();
    };
  }, [camera, gl.domElement, setMode, setSpeedIndex, terrainMeshRef, queryClient]);

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------
  useFrame((_, delta) => {
    // 1. Drop-in receiver
    const pendingDropIn = useUiStore.getState().pendingDropIn;
    if (pendingDropIn) {
      const { worldX, worldZ } = pendingDropIn;
      let surfaceY = 3;
      const mesh = terrainMeshRef.current;
      if (mesh) {
        downRaycaster.current.set(
          new THREE.Vector3(worldX, 200, worldZ),
          downDir.current,
        );
        const hits = downRaycaster.current.intersectObject(mesh, false);
        if (hits[0]) surfaceY = hits[0].point.y + 3;
      }
      camera.position.set(worldX, surfaceY, worldZ);
      euler.current.set(-0.2, 0, 0);
      camera.quaternion.setFromEuler(euler.current);
      useUiStore.getState().clearPendingDropIn();
    }

    // 2. WASD movement (fly mode only, suspended during an active orbit gesture)
    if (modeRef.current === "fly" && !orbitState.current.active) {
      let scaledSpeed: number;
      if (realisticModeRef.current && terrainRef.current) {
        const mpu = computeMetersPerWorldUnit(terrainRef.current);
        const wups = boatMphToWorldUnitsPerSecond(boatSpeedMphRef.current, mpu);
        scaledSpeed = wups * delta;
      } else {
        const speed = SPEEDS[speedIndexRef.current] ?? 0.15;
        scaledSpeed = speed * delta * 60;
      }

      camera.getWorldDirection(moveDir.current);
      rightDir.current.crossVectors(moveDir.current, camera.up).normalize();

      if (keys.current["KeyW"]) camera.position.addScaledVector(moveDir.current, scaledSpeed);
      if (keys.current["KeyS"]) camera.position.addScaledVector(moveDir.current, -scaledSpeed);
      if (keys.current["KeyA"]) camera.position.addScaledVector(rightDir.current, -scaledSpeed);
      if (keys.current["KeyD"]) camera.position.addScaledVector(rightDir.current, scaledSpeed);
      if (keys.current["Space"]) camera.position.y += scaledSpeed;
      if (keys.current["ShiftLeft"] || keys.current["ShiftRight"]) {
        camera.position.y -= scaledSpeed;
      }

      // 2b. Virtual joystick (touch devices)
      const joy = useJoystickStore.getState();
      const DEAD = 0.05;
      if (Math.abs(joy.moveX) > DEAD || Math.abs(joy.moveY) > DEAD) {
        camera.position.addScaledVector(rightDir.current, joy.moveX * scaledSpeed);
        camera.position.addScaledVector(moveDir.current, -joy.moveY * scaledSpeed);
      }
      if (Math.abs(joy.lookX) > DEAD || Math.abs(joy.lookY) > DEAD) {
        euler.current.setFromQuaternion(camera.quaternion);
        euler.current.y -= joy.lookX * 0.03;
        euler.current.x = Math.max(
          -Math.PI / 2,
          Math.min(Math.PI / 2, euler.current.x - joy.lookY * 0.03),
        );
        camera.quaternion.setFromEuler(euler.current);
      }
    }

    // 3. GPS raycaster — fires from camera centre against terrain
    const mesh = terrainMeshRef.current;
    const grid = terrainRef.current;
    if (mesh && grid) {
      raycaster.current.setFromCamera(ndcCenter.current, camera);
      const hits = raycaster.current.intersectObject(mesh, false);
      if (hits[0]) {
        const pt = hits[0].point;
        const { lon, lat } = worldXZToLonLat(pt.x, pt.z, grid);
        const depth = worldYToMetres(pt.y, grid);
        useCameraStore.getState().setCrosshairGps({ lon, lat, depth });
      } else {
        useCameraStore.getState().setCrosshairGps(null);
      }
    }

    // 3b. Camera geographic position + heading → cameraStore
    if (grid) {
      camera.getWorldDirection(lookDir.current);
      const { lon: camLon, lat: camLat } = worldXZToLonLat(
        camera.position.x,
        camera.position.z,
        grid,
      );
      const camDepth = worldYToMetres(camera.position.y, grid);
      const heading =
        (Math.atan2(lookDir.current.x, -lookDir.current.z) * 180 / Math.PI + 360) % 360;
      useCameraStore.getState().setCameraGeo({ lon: camLon, lat: camLat, depth: camDepth, heading });
    }

    // 4. Submersible lamp follows camera
    if (lightRef.current) {
      camera.getWorldDirection(lightPos.current);
      lightRef.current.position
        .copy(camera.position)
        .addScaledVector(lightPos.current, 2);
    }

    // 5. Sync camera position to context for legacy reads
    setCameraPos([camera.position.x, camera.position.y, camera.position.z]);
  });

  return { orbitTargetArr, resetCamera };
}
