import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useAppState } from "@/lib/context";

const KEYS = {
  W: "KeyW",
  A: "KeyA",
  S: "KeyS",
  D: "KeyD",
  Q: "KeyQ",
  E: "KeyE",
  SPACE: "Space"
};

export const FlyControls = () => {
  const { mode, setMode, speed, setSpeed, setCameraPos } = useAppState();
  const { camera, gl } = useThree();

  const keys = useRef<{ [key: string]: boolean }>({});
  const isPointerLocked = useRef(false);
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const overviewAngle = useRef(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (e.code === KEYS.SPACE) {
        setMode(mode === "FLY" ? "OVERVIEW" : "FLY");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };

    const onMouseDown = () => {
      if (mode === "FLY") isPointerLocked.current = true;
    };
    const onMouseUp = () => {
      isPointerLocked.current = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isPointerLocked.current || mode !== "FLY") return;
      const movementX = e.movementX || 0;
      const movementY = e.movementY || 0;

      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= movementX * 0.002;
      euler.current.x -= movementY * 0.002;
      euler.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.current.x));
      camera.quaternion.setFromEuler(euler.current);
    };

    const onWheel = (e: WheelEvent) => {
      setSpeed(Math.max(0.0005, Math.min(0.05, speed - e.deltaY * 0.00005)));
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
  }, [camera, gl.domElement, mode, setMode, speed, setSpeed]);

  useFrame((_state: unknown, delta: number) => {
    if (mode === "FLY") {
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();

      if (keys.current[KEYS.W]) camera.position.addScaledVector(direction, speed);
      if (keys.current[KEYS.S]) camera.position.addScaledVector(direction, -speed);
      if (keys.current[KEYS.D]) camera.position.addScaledVector(right, -speed);
      if (keys.current[KEYS.A]) camera.position.addScaledVector(right, speed);
      if (keys.current[KEYS.E]) camera.position.y += speed;
      if (keys.current[KEYS.Q]) camera.position.y -= speed;
    } else {
      overviewAngle.current += delta * 0.1;
      const radius = 1.5;
      camera.position.set(
        Math.cos(overviewAngle.current) * radius,
        1.5,
        Math.sin(overviewAngle.current) * radius
      );
      camera.lookAt(0, 0, 0);
    }

    setCameraPos([camera.position.x, camera.position.y, camera.position.z]);
  });

  return null;
};