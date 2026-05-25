import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useAppState, SPEEDS } from "@/lib/context";

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (e.code === "Tab") {
        e.preventDefault();
        setMode(mode === "fly" ? "orbit" : "fly");
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
      if (e.deltaY > 0) {
        setSpeedIndex(Math.min(SPEEDS.length - 1, speedIndex + 1));
      } else {
        setSpeedIndex(Math.max(0, speedIndex - 1));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    gl.domElement.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("wheel", onWheel);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      gl.domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("wheel", onWheel);
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
