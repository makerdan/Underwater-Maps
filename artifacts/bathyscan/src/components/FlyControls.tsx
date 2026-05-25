import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useAppState, SPEEDS } from "@/lib/context";
import { useSettingsStore } from "@/lib/settingsStore";
import { computeWheelDolly, computePinchDolly } from "@/lib/zoomMath";

/**
 * Legacy fly-control component used by TerrainScene.
 * The main app scene (TourScene) uses useFlyControls hook instead.
 */
export const FlyControls = () => {
  const { mode, setMode, speedIndex, setSpeedIndex, setCameraPos } = useAppState();
  const { camera, gl } = useThree();

  const keys = useRef<Record<string, boolean>>({});
  const isPointerLocked = useRef(false);
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const lookDir = useRef(new THREE.Vector3());
  const speedIndexRef = useRef(speedIndex);
  useEffect(() => { speedIndexRef.current = speedIndex; }, [speedIndex]);

  const mouseZoomSensitivity = useSettingsStore((s) => s.mouseZoomSensitivity);
  const touchpadZoomSensitivity = useSettingsStore((s) => s.touchpadZoomSensitivity);
  const pinchZoomSensitivity = useSettingsStore((s) => s.pinchZoomSensitivity);
  const mouseZoomSensRef = useRef(mouseZoomSensitivity);
  const touchpadZoomSensRef = useRef(touchpadZoomSensitivity);
  const pinchZoomSensRef = useRef(pinchZoomSensitivity);
  useEffect(() => { mouseZoomSensRef.current = mouseZoomSensitivity; }, [mouseZoomSensitivity]);
  useEffect(() => { touchpadZoomSensRef.current = touchpadZoomSensitivity; }, [touchpadZoomSensitivity]);
  useEffect(() => { pinchZoomSensRef.current = pinchZoomSensitivity; }, [pinchZoomSensitivity]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (e.code === "Tab") {
        e.preventDefault();
        setMode(mode === "fly" ? "orbit" : "fly");
        return;
      }
      if (mode === "fly") {
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
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };

    const onMouseDown = () => {
      if (mode === "fly") isPointerLocked.current = true;
    };
    const onMouseUp = () => {
      isPointerLocked.current = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isPointerLocked.current || mode !== "fly") return;
      const movementX = e.movementX ?? 0;
      const movementY = e.movementY ?? 0;
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= movementX * 0.002;
      euler.current.x = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, euler.current.x - movementY * 0.002),
      );
      camera.quaternion.setFromEuler(euler.current);
    };

    const onWheel = (e: WheelEvent) => {
      if (mode !== "fly") return;
      if (e.shiftKey) {
        if (e.deltaY > 0) {
          setSpeedIndex(Math.min(SPEEDS.length - 1, speedIndexRef.current + 1));
        } else {
          setSpeedIndex(Math.max(0, speedIndexRef.current - 1));
        }
        return;
      }
      const dolly = computeWheelDolly(
        e.deltaY,
        e.deltaMode,
        mouseZoomSensRef.current,
        touchpadZoomSensRef.current,
      );
      camera.getWorldDirection(lookDir.current);
      camera.position.addScaledVector(lookDir.current, dolly);
    };

    const activePointers = new Map<number, { x: number; y: number }>();
    let lastPinchDist = 0;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        lastPinchDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      }
    };
    const onPointerMove2 = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2 && mode === "fly") {
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        const delta = dist - lastPinchDist;
        lastPinchDist = dist;
        const dolly = computePinchDolly(delta, pinchZoomSensRef.current);
        camera.getWorldDirection(lookDir.current);
        camera.position.addScaledVector(lookDir.current, dolly);
      }
    };
    const onPointerUp2 = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      activePointers.delete(e.pointerId);
      lastPinchDist = 0;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    gl.domElement.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("wheel", onWheel);
    gl.domElement.addEventListener("pointerdown", onPointerDown);
    gl.domElement.addEventListener("pointermove", onPointerMove2);
    gl.domElement.addEventListener("pointerup", onPointerUp2);
    gl.domElement.addEventListener("pointercancel", onPointerUp2);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      gl.domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("wheel", onWheel);
      gl.domElement.removeEventListener("pointerdown", onPointerDown);
      gl.domElement.removeEventListener("pointermove", onPointerMove2);
      gl.domElement.removeEventListener("pointerup", onPointerUp2);
      gl.domElement.removeEventListener("pointercancel", onPointerUp2);
    };
  }, [camera, gl.domElement, mode, setMode, setSpeedIndex]);

  useFrame((_state, delta: number) => {
    const speed = SPEEDS[speedIndex] ?? 0.15;
    const scaledSpeed = speed * delta * 60;

    if (mode === "fly") {
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();

      if (keys.current["KeyW"]) camera.position.addScaledVector(direction, scaledSpeed);
      if (keys.current["KeyS"]) camera.position.addScaledVector(direction, -scaledSpeed);
      if (keys.current["KeyD"]) camera.position.addScaledVector(right, -scaledSpeed);
      if (keys.current["KeyA"]) camera.position.addScaledVector(right, scaledSpeed);
      if (keys.current["Space"]) camera.position.y += scaledSpeed;
      if (keys.current["ShiftLeft"]) camera.position.y -= scaledSpeed;
    }

    setCameraPos([camera.position.x, camera.position.y, camera.position.z]);
  });

  return null;
};
