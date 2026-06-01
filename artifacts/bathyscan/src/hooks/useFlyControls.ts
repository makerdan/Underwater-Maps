import { useEffect, useRef, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useQueryClient } from "@tanstack/react-query";
import * as THREE from "three";
import type { Marker, TerrainData } from "@workspace/api-client-react";
import {
  getGetMarkersQueryKey,
} from "@workspace/api-client-react";
import { useUndoableMarkerDelete } from "@/hooks/useUndoableMarkerDelete";
import { useAppState, SPEEDS } from "@/lib/context";
import { useDriftStore } from "@/lib/driftStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { worldXZToLonLat, worldYToMetres, lonLatToWorldXZ, MAX_DEPTH_WORLD } from "@/lib/terrain";
import { useJoystickStore } from "@/components/VirtualJoystick";
import { computeMetersPerWorldUnit, boatMphToWorldUnitsPerSecond, BOAT_MIN_MPH, BOAT_MAX_MPH } from "@/lib/boatSpeed";
import { tidalToWorldVelocity } from "@/lib/boatPhysics";
import { useDriveBoatStore } from "@/lib/driveBoatStore";
import { useCurrentsStore } from "@/lib/currentsStore";
import { markerGroupRef } from "@/components/MarkerLayer";
import { useContextMenuStore, type ContextMenuItem } from "@/lib/contextMenuStore";
import { useMarkerDetailStore } from "@/lib/markerDetailStore";
import { useMarkerEditStore } from "@/lib/markerEditStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { getBoundKey } from "@/lib/keyBindings";
import {
  buildTerrainMenuItems,
  openCrosshairContextMenu,
} from "@/lib/terrainContextMenu";
import { computePinchDolly, computeWheelDolly } from "@/lib/zoomMath";
import { processFlyWheel } from "@/lib/flyWheel";
import {
  applyOrbitDrag,
  applyOrbitDolly,
  ORBIT_CLICK_VS_DRAG_PX,
} from "@/lib/orbitMath";
import { toast } from "@/hooks/use-toast";

/** Exit GPS follow mode with a toast. No-op when already off. */
function exitFollowMode(): void {
  if (!useCameraStore.getState().gpsFollowMode) return;
  useCameraStore.getState().setGpsFollowMode(false);
  toast({
    title: "Follow mode off",
    description: "Camera control returned to you.",
    duration: 3000,
  });
}

// Module-level tracker: the dataset ID for which the initial camera spawn was
// last applied. Used to gate `resetCamera` so that WebGL context-recovery
// remounts (same dataset, same terrain reference) do NOT re-apply spawn and
// teleport the user back to their saved position. Reset when a genuinely new
// dataset is loaded.
let _lastSpawnedDatasetId: string | null = null;

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
    speedIndex, setSpeedIndex, terrain, setCameraPos,
    realisticMode, boatSpeedMph,
  } = useAppState();
  const driveBoatReverse = () => useDriftStore.getState().driveBoatReverse;

  const queryClient = useQueryClient();
  const requestMarkerDelete = useUndoableMarkerDelete();
  const requestMarkerDeleteRef = useRef(requestMarkerDelete);
  useEffect(() => { requestMarkerDeleteRef.current = requestMarkerDelete; }, [requestMarkerDelete]);

  // Settings: sensitivity and invert-Y for mouse look
  const mouseSensitivity = useSettingsStore((s) => s.mouseSensitivity);
  const invertMouseY = useSettingsStore((s) => s.invertMouseY);
  const mouseZoomSensitivity = useSettingsStore((s) => s.mouseZoomSensitivity);
  const touchpadZoomSensitivity = useSettingsStore((s) => s.touchpadZoomSensitivity);
  const pinchZoomSensitivity = useSettingsStore((s) => s.pinchZoomSensitivity);
  // Remappable shortcut bindings — every action is read from settings via
  // `keyBindings` so users can rebind movement, speed, drop-pin and the
  // crosshair menu independently.
  const keyBindings = useSettingsStore((s) => s.keyBindings);
  const crosshairMenuGamepadButton = useSettingsStore((s) => s.crosshairMenuGamepadButton);
  const sensitivityRef = useRef(mouseSensitivity);
  const invertMouseYRef = useRef(invertMouseY);
  const mouseZoomSensRef = useRef(mouseZoomSensitivity);
  const touchpadZoomSensRef = useRef(touchpadZoomSensitivity);
  const pinchZoomSensRef = useRef(pinchZoomSensitivity);
  const keyBindingsRef = useRef(keyBindings);
  const crosshairMenuGamepadButtonRef = useRef(crosshairMenuGamepadButton);
  useEffect(() => { sensitivityRef.current = mouseSensitivity; }, [mouseSensitivity]);
  useEffect(() => { invertMouseYRef.current = invertMouseY; }, [invertMouseY]);
  useEffect(() => { mouseZoomSensRef.current = mouseZoomSensitivity; }, [mouseZoomSensitivity]);
  useEffect(() => { touchpadZoomSensRef.current = touchpadZoomSensitivity; }, [touchpadZoomSensitivity]);
  useEffect(() => { pinchZoomSensRef.current = pinchZoomSensitivity; }, [pinchZoomSensitivity]);
  useEffect(() => { keyBindingsRef.current = keyBindings; }, [keyBindings]);
  useEffect(() => { crosshairMenuGamepadButtonRef.current = crosshairMenuGamepadButton; }, [crosshairMenuGamepadButton]);

  // Refs for event-listener / useFrame closures to stay current
  const speedIndexRef = useRef(speedIndex);
  const terrainRef = useRef<TerrainData | null>(terrain);
  const realisticModeRef = useRef(realisticMode);
  const boatSpeedMphRef = useRef(boatSpeedMph);

  useEffect(() => { speedIndexRef.current = speedIndex; }, [speedIndex]);
  useEffect(() => { terrainRef.current = terrain; }, [terrain]);
  useEffect(() => { realisticModeRef.current = realisticMode; }, [realisticMode]);
  useEffect(() => { boatSpeedMphRef.current = boatSpeedMph; }, [boatSpeedMph]);

  // ── Drive Boat inertia / heading lock / route following refs ─────────────
  // Actual (inertia-smoothed) speed that the frame loop uses for movement.
  // Lags behind boatSpeedMphRef to simulate throttle ramp.
  const actualSpeedMphRef = useRef(boatSpeedMph);
  // Heading lock state (read from driveBoatStore each frame via getState())
  const headingLockedRef = useRef(useDriveBoatStore.getState().headingLocked);
  const lockedBearingRef = useRef(useDriveBoatStore.getState().lockedBearing);
  useEffect(() =>
    useDriveBoatStore.subscribe((s) => {
      headingLockedRef.current = s.headingLocked;
      lockedBearingRef.current = s.lockedBearing;
    }),
  []);
  // Previous camera position for per-frame distance accumulation.
  const prevCamPosRef = useRef(new THREE.Vector3());
  const prevCamPosInitRef = useRef(false);

  // Sync speedIndex to cameraStore for HUD reads
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
  // Camera initialisation: place camera based on cameraSpawnBehaviour setting
  // ---------------------------------------------------------------------------
  const resetCamera = useCallback(() => {
    const grid = terrainRef.current;
    if (!grid) return;
    const { resolution: N, depths, minDepth, maxDepth } = grid;
    const depthRange = maxDepth - minDepth || 1;

    const settings = useSettingsStore.getState();
    const spawnBehaviour = settings.cameraSpawnBehaviour;

    // "last" — resume the previously saved camera position for this dataset.
    if (spawnBehaviour === "last") {
      const sess = settings.lastSession;
      if (sess && sess.datasetId === grid.datasetId) {
        const { x, z } = lonLatToWorldXZ(sess.lon, sess.lat, grid);
        const t = Math.max(0, Math.min(1, (sess.depth - minDepth) / depthRange));
        const worldY = -t * MAX_DEPTH_WORLD;
        camera.position.set(x, worldY + 10, z);
        // Restore heading: euler.y encodes the compass heading (yaw).
        // Convention from useFlyControls: yaw = heading * PI / 180 applied
        // as negative euler.y (camera looks along -Z in Three.js).
        euler.current.set(-0.25, -(sess.heading * Math.PI) / 180, 0);
        camera.quaternion.setFromEuler(euler.current);
        return;
      }
      // No saved session yet — fall through to deepest-point spawn.
    }

    // "home" — spawn at the per-dataset saved home position if one is set.
    if (spawnBehaviour === "home") {
      const home = settings.datasetHomePositions[grid.datasetId];
      if (home) {
        const { x, z } = lonLatToWorldXZ(home.lon, home.lat, grid);
        const t = (home.depth - minDepth) / depthRange;
        const surfaceY = -Math.max(0, Math.min(1, t)) * MAX_DEPTH_WORLD;
        camera.position.set(x, surfaceY + 10, z);
        euler.current.set(-0.25, 0, 0);
        camera.quaternion.setFromEuler(euler.current);
        return;
      }
      // No home set — fall through to deepest-point spawn.
    }

    // "deepest" (default fallback) — place 10 units above the deepest point.
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

  // Reset camera when a new terrain dataset is loaded for the first time.
  // We gate on _lastSpawnedDatasetId so that WebGL context-recovery remounts
  // (SceneContents re-keyed via recoveryKey) do NOT re-apply the spawn and
  // teleport the user back to their saved position mid-session. Only a genuine
  // dataset switch (new datasetId) clears the gate and triggers spawn.
  useEffect(() => {
    if (!terrain) return;
    if (_lastSpawnedDatasetId === terrain.datasetId) return;
    _lastSpawnedDatasetId = terrain.datasetId;
    resetCamera();
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
      if (!isLocked.current) {
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
      const bindings = keyBindingsRef.current;

      // Suppress all single-key action shortcuts when focus is inside a text
      // input, textarea, or contenteditable element — unless the pointer is
      // already locked (pointer lock precludes focus in any input anyway).
      const activeEl = document.activeElement as HTMLElement | null;
      const activeTag = activeEl?.tagName ?? "";
      const isEditableFocused =
        !isLocked.current &&
        (activeTag === "INPUT" ||
          activeTag === "TEXTAREA" ||
          activeEl?.isContentEditable === true);

      if (isEditableFocused) return;

      // Speed tier up / down (not in realistic mode). The NumpadAdd /
      // NumpadSubtract synonyms are always honoured in addition to the
      // user's chosen binding so a numpad keeps working out of the box.
      if (!realisticModeRef.current) {
        if (e.code === getBoundKey(bindings, "speedUp") || e.code === "NumpadAdd") {
          e.preventDefault();
          setSpeedIndex(Math.min(SPEEDS.length - 1, speedIndexRef.current + 1));
          return;
        }
        if (e.code === getBoundKey(bindings, "speedDown") || e.code === "NumpadSubtract") {
          e.preventDefault();
          setSpeedIndex(Math.max(0, speedIndexRef.current - 1));
          return;
        }
      }

      // Exit GPS follow mode on any movement key so the user isn't trapped.
      const movementCodes = [
        getBoundKey(bindings, "moveForward"),
        getBoundKey(bindings, "moveBackward"),
        getBoundKey(bindings, "strafeLeft"),
        getBoundKey(bindings, "strafeRight"),
        getBoundKey(bindings, "ascend"),
        getBoundKey(bindings, "descend"),
        "ShiftRight",
        "KeyW", "KeyA", "KeyS", "KeyD",
      ];
      if (movementCodes.includes(e.code)) exitFollowMode();

      // Drop GPS pin: open the marker form pinned at the crosshair.
      if (e.code === getBoundKey(bindings, "dropGpsPin")) {
        const gps = useCameraStore.getState().crosshairGps;
        if (gps) {
          useCameraStore.getState().setLastClickedGps(gps);
          useUiStore.getState().setMarkerFormOpen(true);
        }
      }

      // Crosshair action menu: open the terrain action menu anchored at the
      // crosshair. Works whether pointer is locked (underwater nav) or
      // unlocked, but only when the crosshair is currently on terrain.
      // Key binding is user-remappable via Settings → Shortcuts
      // (defaults to "KeyQ").
      if (e.code === getBoundKey(bindings, "crosshairMenu")) {
        const rect = gl.domElement.getBoundingClientRect();
        const opened = openCrosshairContextMenu({
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          getTerrainGrid: () => terrainRef.current,
          exitPointerLock: () => {
            if (isLocked.current) document.exitPointerLock();
          },
        });
        if (opened) e.preventDefault();
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
          exitFollowMode();
          applyOrbitDrag(camera, orbitState.current.target, dx, dy, {
            sensitivity: sensitivityRef.current,
            invertY: invertMouseYRef.current,
          });
        }
        return;
      }
      if (!isLocked.current) return;
      // Pointer-locked mouse look exits follow mode on first real movement.
      const dx = e.movementX ?? 0;
      const dy = e.movementY ?? 0;
      if ((Math.abs(dx) > 0 || Math.abs(dy) > 0) && useCameraStore.getState().gpsFollowMode) {
        exitFollowMode();
        return;
      }
      const sens = sensitivityRef.current * 0.002;
      const dyScaled = invertMouseYRef.current ? -dy : dy;
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= dx * sens;
      euler.current.x = Math.max(
        -Math.PI * 0.472,
        Math.min(Math.PI * 0.472, euler.current.x - dyScaled * sens),
      );
      camera.quaternion.setFromEuler(euler.current);
      // When heading lock is active, treat yaw input as intentional steering —
      // update lockedBearing so the autopilot adapts to the new course.
      if (dx !== 0 && headingLockedRef.current) {
        const newBearing = ((-euler.current.y * 180 / Math.PI) % 360 + 360) % 360;
        useDriveBoatStore.getState().setLockedBearing(newBearing);
      }
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
        useCameraStore.getState().setIsOrbitingTouch(true);
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
      if (activePointers.size === 2) {
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
        useCameraStore.getState().setIsOrbitingTouch(false);
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
          label: "Edit marker",
          icon: "✏️",
          onClick: () => useMarkerEditStore.getState().open(marker),
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
            requestMarkerDeleteRef.current(marker, datasetId);
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
            .show(
              x,
              y,
              buildTerrainMenuItems(
                lon,
                lat,
                depth,
                grid.datasetId,
                () => terrainRef.current,
              ),
            );
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
  }, [camera, gl.domElement, setSpeedIndex, terrainMeshRef, queryClient]);

  // ---------------------------------------------------------------------------
  // Gamepad polling — opens the crosshair action menu when the configured
  // gamepad button transitions from released → pressed. Uses the Standard
  // Gamepad mapping (button index 3 = Y/Triangle by default). Polled via
  // requestAnimationFrame because gamepads don't emit DOM events for button
  // state changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      return;
    }
    let rafId = 0;
    const prevPressed = new Map<number, boolean>();
    const poll = () => {
      const btnIdx = crosshairMenuGamepadButtonRef.current;
      if (btnIdx !== null && btnIdx >= 0) {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const pad of pads) {
          if (!pad) continue;
          const btn = pad.buttons[btnIdx];
          const pressed = !!btn?.pressed;
          const key = pad.index;
          const wasPressed = prevPressed.get(key) ?? false;
          if (pressed && !wasPressed) {
            const rect = gl.domElement.getBoundingClientRect();
            openCrosshairContextMenu({
              centerX: rect.left + rect.width / 2,
              centerY: rect.top + rect.height / 2,
              getTerrainGrid: () => terrainRef.current,
              exitPointerLock: () => {
                if (isLocked.current) document.exitPointerLock();
              },
            });
          }
          prevPressed.set(key, pressed);
        }
      }
      rafId = window.requestAnimationFrame(poll);
    };
    rafId = window.requestAnimationFrame(poll);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [gl.domElement]);

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------
  useFrame((_, delta) => {
    // 1. Drop-in receiver
    const pendingDropIn = useUiStore.getState().pendingDropIn;
    if (pendingDropIn) {
      const { worldX, worldZ, worldY, heading, headingDeg } = pendingDropIn;

      // Place camera at explicit Y when provided (bookmark or share-link);
      // otherwise raycast down to terrain and hover 3 units above.
      let targetY: number;
      if (worldY !== undefined) {
        targetY = worldY;
      } else {
        targetY = 3;
        const mesh = terrainMeshRef.current;
        if (mesh) {
          downRaycaster.current.set(
            new THREE.Vector3(worldX, 200, worldZ),
            downDir.current,
          );
          const hits = downRaycaster.current.intersectObject(mesh, false);
          if (hits[0]) targetY = hits[0].point.y + 3;
        }
      }

      camera.position.set(worldX, targetY, worldZ);
      // `heading` (bookmark): cameraStore convention → euler.y = heading * PI/180.
      // `headingDeg` (share link): share-link convention → yaw = -(deg * PI/180) + PI.
      let yaw = 0;
      if (heading !== undefined) {
        yaw = (heading * Math.PI) / 180;
      } else if (headingDeg !== undefined) {
        yaw = -(headingDeg * (Math.PI / 180)) + Math.PI;
      }
      euler.current.set(-0.2, yaw, 0);
      camera.quaternion.setFromEuler(euler.current);
      useUiStore.getState().clearPendingDropIn();
    }

    // 2a. Joystick exit-follow-mode gate — sampled before the movement guard
    // so that any non-deadzone joystick input can exit follow mode even while
    // follow mode is active (the movement gate below would otherwise prevent
    // the exitFollowMode() calls from being reached).
    const joy = useJoystickStore.getState();
    const DEAD = 0.05;
    if (
      Math.abs(joy.moveX) > DEAD || Math.abs(joy.moveY) > DEAD ||
      Math.abs(joy.lookX) > DEAD || Math.abs(joy.lookY) > DEAD
    ) {
      exitFollowMode();
    }

    // 2. WASD movement (suspended during an active orbit gesture or GPS follow mode)
    if (!orbitState.current.active && !useCameraStore.getState().gpsFollowMode) {
      const isRealistic = realisticModeRef.current && terrainRef.current !== null;
      const grid = terrainRef.current;

      // ── 2a. Throttle inertia (realistic mode only) ──────────────────────
      // Smoothly ramp actualSpeed toward target over THROTTLE_RAMP_SECONDS.
      const THROTTLE_RAMP_SECONDS = 2.5;
      if (isRealistic) {
        const targetMph = Math.max(BOAT_MIN_MPH, Math.min(BOAT_MAX_MPH, boatSpeedMphRef.current));
        const currentActual = actualSpeedMphRef.current;
        const speedRange = BOAT_MAX_MPH - BOAT_MIN_MPH;
        const maxStep = (speedRange / THROTTLE_RAMP_SECONDS) * delta;
        const diff = targetMph - currentActual;
        actualSpeedMphRef.current =
          Math.abs(diff) <= maxStep ? targetMph : currentActual + Math.sign(diff) * maxStep;
        useDriveBoatStore.getState().setActualBoatSpeedMph(actualSpeedMphRef.current);
      }

      let scaledSpeed: number;
      let mpuForFrame = 1;
      if (isRealistic && grid) {
        mpuForFrame = computeMetersPerWorldUnit(grid);
        const wups = boatMphToWorldUnitsPerSecond(actualSpeedMphRef.current, mpuForFrame);
        scaledSpeed = wups * delta;
      } else {
        const speed = SPEEDS[speedIndexRef.current] ?? 0.15;
        scaledSpeed = speed * delta * 60;
      }

      camera.getWorldDirection(moveDir.current);
      rightDir.current.crossVectors(moveDir.current, camera.up).normalize();

      // In Drive Boat mode, reverse gear negates the forward/back axes so
      // the camera moves stern-first (bow pointing in the facing direction
      // but the boat moving backwards). The backtroll drag coefficient
      // reduces the effective reverse speed in the same way as the drift
      // planner physics, so holding station against a known current is
      // consistent between the two tools.
      const reverseActive = isRealistic && driveBoatReverse();
      const reverseScale = reverseActive ? -1 : 1; // drag applied via boatSpeedMph slider by user

      // ── 2b. Route following (realistic mode) ────────────────────────────
      const driveState = useDriveBoatStore.getState();
      const driftWpts = useDriftStore.getState().driftWaypoints;
      let routeHandled = false;

      if (isRealistic && driveState.followingRoute && driftWpts.length > 0 && grid) {
        const legIndex = driveState.routeLegIndex;
        if (legIndex < driftWpts.length) {
          const target = driftWpts[legIndex]!;
          const { x: tx, z: tz } = lonLatToWorldXZ(target.lon, target.lat, grid);
          const dx = tx - camera.position.x;
          const dz = tz - camera.position.z;
          const dist2d = Math.sqrt(dx * dx + dz * dz);
          const ARRIVAL_WU = 1.5;

          if (dist2d < ARRIVAL_WU) {
            const next = legIndex + 1;
            if (next < driftWpts.length) {
              driveState.setRouteLegIndex(next);
              driveState.setDistanceToNextNm(0);
            } else {
              driveState.setFollowingRoute(false);
              driveState.setDistanceToNextNm(0);
              toast({ title: "Route complete", description: "All waypoints reached.", duration: 3500 });
            }
          } else {
            // Turn toward waypoint
            const targetBearing = Math.atan2(dx, -dz);
            const targetEulerY = -targetBearing;
            euler.current.setFromQuaternion(camera.quaternion);
            const yawDiff = targetEulerY - euler.current.y;
            const normalYaw =
              ((yawDiff + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
            const turnRate = 2.0;
            euler.current.y += Math.sign(normalYaw) * Math.min(Math.abs(normalYaw), turnRate * delta);
            camera.quaternion.setFromEuler(euler.current);

            // Advance toward waypoint
            camera.getWorldDirection(moveDir.current);
            camera.position.addScaledVector(moveDir.current, scaledSpeed);

            // Publish distance to next waypoint
            const distNm = (dist2d * mpuForFrame) / 1852;
            driveState.setDistanceToNextNm(distNm);
          }
          routeHandled = true;
        } else {
          driveState.setFollowingRoute(false);
        }
      }

      // ── 2c. Normal WASD / joystick movement ─────────────────────────────
      if (!routeHandled) {
        const bindings = keyBindingsRef.current;
        const fwd = getBoundKey(bindings, "moveForward");
        const back = getBoundKey(bindings, "moveBackward");
        const left = getBoundKey(bindings, "strafeLeft");
        const right = getBoundKey(bindings, "strafeRight");
        const up = getBoundKey(bindings, "ascend");
        const down = getBoundKey(bindings, "descend");
        if (keys.current[fwd]) camera.position.addScaledVector(moveDir.current, scaledSpeed * reverseScale);
        if (keys.current[back]) camera.position.addScaledVector(moveDir.current, -scaledSpeed * reverseScale);
        if (keys.current[left]) camera.position.addScaledVector(rightDir.current, -scaledSpeed);
        if (keys.current[right]) camera.position.addScaledVector(rightDir.current, scaledSpeed);
        if (keys.current[up]) camera.position.y += scaledSpeed;
        // ShiftRight stays as a permanent secondary "descend" so the user
        // doesn't lose a sensible default when they rebind ShiftLeft.
        if (
          keys.current[down] ||
          (down !== "ShiftRight" && keys.current["ShiftRight"])
        ) {
          camera.position.y -= scaledSpeed;
        }

        // Virtual joystick (touch devices)
        if (Math.abs(joy.moveX) > DEAD || Math.abs(joy.moveY) > DEAD) {
          camera.position.addScaledVector(rightDir.current, joy.moveX * scaledSpeed);
          camera.position.addScaledVector(moveDir.current, -joy.moveY * scaledSpeed * reverseScale);
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

      // ── 2d. Tidal current pushback (realistic mode) ──────────────────────
      // When the Drift Planner is active and has conditions, read the same
      // tidal vector that the drift physics applies at the current simulated
      // hour (driftHour) so both features always agree on environmental forces.
      // Falls back to the live NOAA ambient current otherwise.
      if (isRealistic && grid) {
        let tidalSpeedKt = 0;
        let tidalDirDeg = 0;
        let hasTidal = false;

        const driftState = useDriftStore.getState();
        if (driftState.driftPlannerActive && driftState.driftConditions) {
          const vec = driftState.getTidalVectorAtHour(driftState.driftHour);
          if (vec && vec.speedKt > 0) {
            tidalSpeedKt = vec.speedKt;
            tidalDirDeg = vec.directionDeg;
            hasTidal = true;
          }
        }

        if (!hasTidal) {
          const ambient = useCurrentsStore.getState().noaaAmbient;
          if (ambient && ambient.speedKt > 0) {
            tidalSpeedKt = ambient.speedKt;
            tidalDirDeg = ambient.directionDeg;
            hasTidal = true;
          }
        }

        if (hasTidal) {
          const { worldDX, worldDZ } = tidalToWorldVelocity(tidalSpeedKt, tidalDirDeg);
          const mpu = mpuForFrame > 0 ? mpuForFrame : computeMetersPerWorldUnit(grid);
          camera.position.x += (worldDX / mpu) * delta;
          camera.position.z += (worldDZ / mpu) * delta;
        }
      }

      // ── 2e. Heading lock autopilot (realistic mode, not route-following) ──
      // Applies a gentle corrective yaw force toward the locked bearing each
      // frame to counteract any drift. Does NOT suppress intentional steering —
      // mouse look updates lockedBearing so the user still has full control.
      if (isRealistic && headingLockedRef.current && !driveState.followingRoute) {
        euler.current.setFromQuaternion(camera.quaternion);
        const targetEulerY = -(lockedBearingRef.current * Math.PI) / 180;
        const diff = targetEulerY - euler.current.y;
        const normalized =
          ((diff + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        const CORRECTION_RATE = 3.0; // rad/s
        euler.current.y +=
          Math.sign(normalized) * Math.min(Math.abs(normalized), CORRECTION_RATE * delta);
        camera.quaternion.setFromEuler(euler.current);
      }

      // ── 2f. Distance-traveled counter (realistic mode) ───────────────────
      if (isRealistic && grid) {
        if (!prevCamPosInitRef.current) {
          prevCamPosRef.current.copy(camera.position);
          prevCamPosInitRef.current = true;
        }
        const displacement = camera.position.distanceTo(prevCamPosRef.current);
        if (displacement > 0) {
          const distNm = (displacement * mpuForFrame) / 1852;
          useDriveBoatStore.getState().addDistanceNm(distNm);
        }
        prevCamPosRef.current.copy(camera.position);
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
