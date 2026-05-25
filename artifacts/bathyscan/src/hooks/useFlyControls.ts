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
import { computeWheelDolly, computePinchDolly } from "@/lib/zoomMath";

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

      // Tab: toggle orbit / fly
      if (e.code === "Tab") {
        e.preventDefault();
        if (modeRef.current === "fly") {
          camera.getWorldDirection(lookDir.current);
          const mesh = terrainMeshRef.current;
          let hit = false;
          if (mesh) {
            raycaster.current.set(camera.position, lookDir.current);
            const hits = raycaster.current.intersectObject(mesh, false);
            if (hits[0]) {
              const pt = hits[0].point;
              orbitTargetArr.current = [pt.x, pt.y, pt.z];
              hit = true;
            }
          }
          if (!hit) {
            orbitTargetArr.current = [
              camera.position.x + lookDir.current.x * 20,
              camera.position.y + lookDir.current.y * 20,
              camera.position.z + lookDir.current.z * 20,
            ];
          }
          if (isLocked.current) document.exitPointerLock();
          setMode("orbit");
        } else {
          setMode("fly");
        }
        return;
      }

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

    const handleMouseMove = (e: MouseEvent) => {
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
      // Only handle wheel in fly mode; orbit mode is owned by MapControls
      // (which has its own internal wheel handler). Touching the event in
      // orbit mode would cause double-zoom and prevent MapControls from
      // processing it.
      if (modeRef.current !== "fly") return;
      e.preventDefault();
      // Shift+wheel → step speed tier (fly mode, non-realistic only)
      if (e.shiftKey) {
        if (realisticModeRef.current) return;
        if (e.deltaY > 0) {
          setSpeedIndex(Math.min(SPEEDS.length - 1, speedIndexRef.current + 1));
        } else {
          setSpeedIndex(Math.max(0, speedIndexRef.current - 1));
        }
        return;
      }
      // Plain wheel → dolly camera along view direction.
      const dolly = computeWheelDolly(
        e.deltaY,
        e.deltaMode,
        mouseZoomSensRef.current,
        touchpadZoomSensRef.current,
      );
      camera.getWorldDirection(lookDir.current);
      camera.position.addScaledVector(lookDir.current, dolly);
    };

    // ─── Pinch-to-zoom (fly mode only; orbit MapControls handles its own) ───
    const activePointers = new Map<number, { x: number; y: number }>();
    let lastPinchDist = 0;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        lastPinchDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2 && modeRef.current === "fly") {
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        const delta = dist - lastPinchDist;
        lastPinchDist = dist;
        const dolly = computePinchDolly(delta, pinchZoomSensRef.current);
        camera.getWorldDirection(lookDir.current);
        camera.position.addScaledVector(lookDir.current, dolly);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      activePointers.delete(e.pointerId);
      lastPinchDist = 0;
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

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
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

      // NDC at click position
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
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
                .show(e.clientX, e.clientY, buildMarkerMenuItems(marker));
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
              e.clientX,
              e.clientY,
              buildTerrainMenuItems(lon, lat, depth, grid.datasetId),
            );
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    document.addEventListener("mousemove", handleMouseMove);
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
      gl.domElement.removeEventListener("wheel", handleWheel);
      gl.domElement.removeEventListener("contextmenu", handleContextMenu);
      gl.domElement.removeEventListener("pointerdown", handlePointerDown);
      gl.domElement.removeEventListener("pointermove", handlePointerMove);
      gl.domElement.removeEventListener("pointerup", handlePointerUp);
      gl.domElement.removeEventListener("pointercancel", handlePointerUp);
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

    // 2. WASD movement (fly mode only)
    if (modeRef.current === "fly") {
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
