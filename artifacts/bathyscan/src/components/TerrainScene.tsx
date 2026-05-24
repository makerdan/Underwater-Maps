import React, { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useAppState } from "@/lib/context";
import { FlyControls } from "./FlyControls";

const TerrainMesh = () => {
  const { terrain } = useAppState();
  const meshRef = useRef<THREE.Mesh>(null);

  const { geometry, material } = useMemo(() => {
    if (!terrain) return { geometry: null, material: null };

    const { resolution, depths, minDepth, maxDepth } = terrain;
    const geometry = new THREE.PlaneGeometry(2, 2, resolution - 1, resolution - 1);
    
    // Rotate to lie flat
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array as Float32Array;
    const colors = new Float32Array(positions.length);
    const color = new THREE.Color();
    const scaleZ = 0.8;

    const shallowColor = new THREE.Color("#2D6A9F");
    const midColor = new THREE.Color("#4B1E80");
    const deepColor = new THREE.Color("#050a14");

    for (let i = 0; i < depths.length; i++) {
      const depth = depths[i];
      const normalizedDepth = (depth - minDepth) / (maxDepth - minDepth || 1);
      
      // Update Y instead of Z because we rotated X by -90deg
      positions[i * 3 + 1] = normalizedDepth * -scaleZ;

      if (normalizedDepth < 0.5) {
        color.lerpColors(shallowColor, midColor, normalizedDepth * 2);
      } else {
        color.lerpColors(midColor, deepColor, (normalizedDepth - 0.5) * 2);
      }

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide
    });

    return { geometry, material };
  }, [terrain]);

  if (!geometry || !material) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} />
  );
};

const Particles = () => {
  const count = 300;
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4;
    }
    return pos;
  }, [count]);

  const ref = useRef<THREE.Points>(null);

  useFrame(() => {
    if (ref.current) {
      ref.current.rotation.y += 0.0005;
      ref.current.rotation.x += 0.0002;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial size={0.002} color="#ffffff" transparent opacity={0.3} />
    </points>
  );
};

const LightsAndFog = () => {
  const { camera } = useThree();
  const pointLightRef = useRef<THREE.PointLight>(null);

  useFrame(() => {
    if (pointLightRef.current) {
      pointLightRef.current.position.copy(camera.position);
    }
  });

  return (
    <>
      <fogExp2 args={["#060c1a", 0.3]} />
      <ambientLight intensity={0.05} />
      <directionalLight position={[-1, 1, 1]} intensity={0.2} color="#8ecaff" />
      <pointLight ref={pointLightRef} distance={80} intensity={2.5} color="#ffeedd" />
    </>
  );
};

export const TerrainScene = () => {
  return (
    <div className="w-full h-full" style={{ display: "block", width: "100vw", height: "100vh" }}>
      <Canvas
        camera={{ position: [0, 0.5, 1], fov: 45 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#060c1a"]} />
        <LightsAndFog />
        <Particles />
        <TerrainMesh />
        <FlyControls />
      </Canvas>
    </div>
  );
};