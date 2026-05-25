import { useEffect, useRef, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { useAppState, SPEEDS } from "@/lib/context";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { worldXZToLonLat, worldYToMetres, lonLatToWorldXZ, MAX_DEPTH_WORLD } from "@/lib/terrain";
import { useJoystickStore } from "@/components/VirtualJoystick";
import { computeMetersPerWorldUnit, boatMphToWorldUnitsPerSecond } from "@/lib/boatSpeed";

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
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= dx * 0.002;
      euler.current.x = Math.max(
        -Math.PI * 0.472,
        Math.min(Math.PI * 0.472, euler.current.x - dy * 0.002),
      );
      camera.quaternion.setFromEuler(euler.current);
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (realisticModeRef.current) return;
      if (e.deltaY > 0) {
        setSpeedIndex(Math.min(SPEEDS.length - 1, speedIndexRef.current + 1));
      } else {
        setSpeedIndex(Math.max(0, speedIndexRef.current - 1));
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (modeRef.current !== "fly") return;
      const gps = useCameraStore.getState().crosshairGps;
      if (gps) {
        useCameraStore.getState().setLastClickedGps(gps);
        useUiStore.getState().setMarkerFormOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    document.addEventListener("mousemove", handleMouseMove);
    gl.domElement.addEventListener("wheel", handleWheel, { passive: false });
    gl.domElement.addEventListener("contextmenu", handleContextMenu);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("mousemove", handleMouseMove);
      gl.domElement.removeEventListener("wheel", handleWheel);
      gl.domElement.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [camera, gl.domElement, setMode, setSpeedIndex, terrainMeshRef]);

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
