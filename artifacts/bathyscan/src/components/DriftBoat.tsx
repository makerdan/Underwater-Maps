/**
 * DriftBoat — R3F procedural low-poly center-console fishing boat for
 * Drift Planner mode.
 *
 * The boat sits at the current drift hour's world position on the water
 * surface, oriented bow-first along the drift heading. Click-dragging on
 * the water surface (DriftWaterPlane) repositions the start point.
 *
 * Geometry is entirely procedural (no GLTF assets):
 *   - Hull: custom indexed BufferGeometry with pointed bow, flared
 *     topsides, flat transom, chine line, and a sheer that rises toward
 *     the bow. Built as two skins (upper white topsides + lower dark
 *     bottom paint) sharing the same silhouette.
 *   - Deck: flat top mesh fused to the hull rim.
 *   - Console / windshield: trapezoidal wheelhouse with a separate
 *     tinted windshield face.
 *   - Outboard motor: cowling + shaft + skeg at the transom.
 *   - Details: bow rail (torus arc + stanchions), cleats, antenna,
 *     red/green nav lights.
 *
 * Local coordinate convention: bow points along -Z, stern along +Z,
 * starboard along +X, port along -X, up along +Y. Triangle count stays
 * in the low hundreds.
 */

import React, { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDriftStore } from "@/lib/driftStore";

const BOAT_SCALE = 0.8;

// Hull silhouette parameters (in BOAT_SCALE-relative units).
const L = 3.0;          // length overall
const BEAM = 1.05;      // max beam (amidships)
const TRANSOM_W = 0.85; // beam at the transom
const BOW_W = 0.04;     // beam at the bow (near-zero, pointed)
const DECK_Y = 0.38;    // deck height above waterline at midships
const SHEER_RISE = 0.18; // additional rise at bow (sheer line)
const TRANSOM_Y = 0.32; // deck height at the stern (slightly lower)
const KEEL_Y = -0.22;   // bottom of hull (below waterline)
const CHINE_Y = 0.05;   // chine line (where topsides meet bottom)
const STATIONS = 7;     // number of cross-sections along the length

/**
 * Build the boat hull as a tight stack of cross-sections (stations).
 * Each station has 4 ring points: deck-port, chine-port, chine-stbd,
 * deck-stbd, plus a keel point. We then triangulate adjacent rings into
 * topside strips, bottom strips, the bow point, the transom, and the
 * deck.
 *
 * Returns two geometries so the topsides and the bottom paint can use
 * different materials.
 */
function buildHullGeometries(): {
  topsides: THREE.BufferGeometry;
  bottom: THREE.BufferGeometry;
  deck: THREE.BufferGeometry;
} {
  // Bell-curve-ish beam: max at ~0.45 from bow, narrowing to bow and stern.
  // t = 0 at bow, 1 at stern.
  const beamAt = (t: number) => {
    if (t <= 0) return BOW_W;
    if (t >= 1) return TRANSOM_W;
    // Smooth bow taper using sqrt for fine entry, blend to transom.
    const fwd = Math.sqrt(t);          // 0..1 fast rise
    const aft = 1 - (1 - t) * (1 - t); // ease-out toward stern
    const mix = t < 0.45 ? fwd : aft;
    const peak = BEAM;
    // Lerp between bow/transom widths through the peak.
    if (t < 0.45) {
      const k = t / 0.45;
      return BOW_W + (peak - BOW_W) * mix * (0.6 + 0.4 * k);
    } else {
      const k = (t - 0.45) / 0.55;
      return peak + (TRANSOM_W - peak) * k * (0.6 + 0.4 * (1 - mix));
    }
  };

  // Sheer line (deck height): bow is highest, midships normal, transom
  // slightly lower.
  const sheerAt = (t: number) => {
    const bowBoost = Math.pow(1 - t, 2) * SHEER_RISE;
    const sternFlat = THREE.MathUtils.lerp(DECK_Y, TRANSOM_Y, t);
    return sternFlat + bowBoost;
  };

  // Chine height: roughly flat, with a slight rise toward bow.
  const chineAt = (t: number) => CHINE_Y + Math.pow(1 - t, 2) * 0.08;

  // Keel depth: deepest amidships, shallower fore and aft.
  const keelAt = (t: number) => {
    const m = 1 - Math.pow((t - 0.5) * 2, 2); // 1 at mid, 0 at ends
    return KEEL_Y + (1 - m) * 0.12;
  };

  const stations: {
    z: number;
    deckPort: THREE.Vector3;
    chinePort: THREE.Vector3;
    chineStbd: THREE.Vector3;
    deckStbd: THREE.Vector3;
    keel: THREE.Vector3;
  }[] = [];

  for (let i = 0; i < STATIONS; i++) {
    const t = i / (STATIONS - 1);
    // Bow at -L/2 (z<0), stern at +L/2 (z>0).
    const z = -L / 2 + t * L;
    const beam = beamAt(t);
    const chineBeam = beam * 0.92; // chine slightly inboard of deck rail
    const sheer = sheerAt(t);
    const chineY = chineAt(t);
    const keelY = keelAt(t);
    stations.push({
      z,
      deckPort: new THREE.Vector3(-beam / 2, sheer, z),
      chinePort: new THREE.Vector3(-chineBeam / 2, chineY, z),
      chineStbd: new THREE.Vector3(chineBeam / 2, chineY, z),
      deckStbd: new THREE.Vector3(beam / 2, sheer, z),
      keel: new THREE.Vector3(0, keelY, z),
    });
  }

  // ---- Topsides (deck rail down to chine), per side ----
  const topVerts: number[] = [];
  const topIdx: number[] = [];

  const pushQuad = (
    target: number[],
    idx: number[],
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
  ) => {
    const base = target.length / 3;
    target.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    // Two triangles: a,b,c and a,c,d (CCW for outward normal depends on call order)
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let i = 0; i < stations.length - 1; i++) {
    const s0 = stations[i]!;
    const s1 = stations[i + 1]!;
    // Port topside (outward normal points -X). Wind so outside faces -X.
    pushQuad(topVerts, topIdx, s0.deckPort, s1.deckPort, s1.chinePort, s0.chinePort);
    // Starboard topside (outward normal points +X).
    pushQuad(topVerts, topIdx, s0.chineStbd, s1.chineStbd, s1.deckStbd, s0.deckStbd);
  }

  // Bow cap (the tiny triangle at the bow where deck meets keel) — close
  // off the very front so the hull doesn't look hollow.
  const bow = stations[0]!;
  const bowTip = new THREE.Vector3(0, (bow.deckPort.y + bow.keel.y) / 2, bow.z - 0.02);
  const bowBase = topVerts.length / 3;
  topVerts.push(
    bow.deckPort.x, bow.deckPort.y, bow.deckPort.z,
    bow.chinePort.x, bow.chinePort.y, bow.chinePort.z,
    bow.chineStbd.x, bow.chineStbd.y, bow.chineStbd.z,
    bow.deckStbd.x, bow.deckStbd.y, bow.deckStbd.z,
    bowTip.x, bowTip.y, bowTip.z,
  );
  topIdx.push(
    bowBase + 4, bowBase + 1, bowBase + 0,
    bowBase + 4, bowBase + 2, bowBase + 1,
    bowBase + 4, bowBase + 3, bowBase + 2,
  );

  // Transom (flat back wall, from deck rail down to keel). Outward
  // normal points +Z.
  const stern = stations[stations.length - 1]!;
  const tBase = topVerts.length / 3;
  topVerts.push(
    stern.deckPort.x, stern.deckPort.y, stern.deckPort.z,
    stern.chinePort.x, stern.chinePort.y, stern.chinePort.z,
    stern.chineStbd.x, stern.chineStbd.y, stern.chineStbd.z,
    stern.deckStbd.x, stern.deckStbd.y, stern.deckStbd.z,
  );
  topIdx.push(tBase, tBase + 1, tBase + 2, tBase, tBase + 2, tBase + 3);

  const topsides = new THREE.BufferGeometry();
  topsides.setAttribute("position", new THREE.Float32BufferAttribute(topVerts, 3));
  topsides.setIndex(topIdx);
  topsides.computeVertexNormals();

  // ---- Bottom paint (chine down to keel), per side ----
  const botVerts: number[] = [];
  const botIdx: number[] = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const s0 = stations[i]!;
    const s1 = stations[i + 1]!;
    // Port bottom (chine -> keel)
    pushQuad(botVerts, botIdx, s0.chinePort, s1.chinePort, s1.keel, s0.keel);
    // Starboard bottom (keel -> chine)
    pushQuad(botVerts, botIdx, s0.keel, s1.keel, s1.chineStbd, s0.chineStbd);
  }
  // Close bottom at bow (tri from first keel to bow tip and chines)
  const bbBase = botVerts.length / 3;
  botVerts.push(
    bow.chinePort.x, bow.chinePort.y, bow.chinePort.z,
    bow.keel.x, bow.keel.y, bow.keel.z,
    bow.chineStbd.x, bow.chineStbd.y, bow.chineStbd.z,
    bowTip.x, bowTip.y, bowTip.z,
  );
  botIdx.push(bbBase, bbBase + 1, bbBase + 3, bbBase + 1, bbBase + 2, bbBase + 3);
  // Close bottom at transom (between chines and keel)
  const tbBase = botVerts.length / 3;
  botVerts.push(
    stern.chinePort.x, stern.chinePort.y, stern.chinePort.z,
    stern.keel.x, stern.keel.y, stern.keel.z,
    stern.chineStbd.x, stern.chineStbd.y, stern.chineStbd.z,
  );
  botIdx.push(tbBase, tbBase + 2, tbBase + 1);

  const bottom = new THREE.BufferGeometry();
  bottom.setAttribute("position", new THREE.Float32BufferAttribute(botVerts, 3));
  bottom.setIndex(botIdx);
  bottom.computeVertexNormals();

  // ---- Deck (top surface, between the two deck rails) ----
  const deckVerts: number[] = [];
  const deckIdx: number[] = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const s0 = stations[i]!;
    const s1 = stations[i + 1]!;
    // Wind so normal faces +Y.
    pushQuad(deckVerts, deckIdx, s0.deckPort, s0.deckStbd, s1.deckStbd, s1.deckPort);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute("position", new THREE.Float32BufferAttribute(deckVerts, 3));
  deck.setIndex(deckIdx);
  deck.computeVertexNormals();

  return { topsides, bottom, deck };
}

/** Console / windshield as a trapezoidal prism. Center positioned at
 * provided (x, baseY, z), with `forward` along -Z. */
function buildConsoleGeometry(): THREE.BufferGeometry {
  const w = 0.55 * BOAT_SCALE;
  const wTop = 0.42 * BOAT_SCALE;
  const lBot = 0.65 * BOAT_SCALE;
  const lTop = 0.45 * BOAT_SCALE;
  const h = 0.55 * BOAT_SCALE;
  // Front of console slopes back (windshield rake): top is shifted +Z
  // (toward stern) relative to bottom.
  const rake = 0.12 * BOAT_SCALE;

  // 8 corners (bottom 4 then top 4). Forward (bow) is -Z.
  const v = [
    // bottom
    -w / 2, 0, -lBot / 2,  // 0 fl
     w / 2, 0, -lBot / 2,  // 1 fr
     w / 2, 0,  lBot / 2,  // 2 rr
    -w / 2, 0,  lBot / 2,  // 3 rl
    // top (narrower + raked back)
    -wTop / 2, h, -lTop / 2 + rake, // 4 fl
     wTop / 2, h, -lTop / 2 + rake, // 5 fr
     wTop / 2, h,  lTop / 2 + rake, // 6 rr
    -wTop / 2, h,  lTop / 2 + rake, // 7 rl
  ];
  const idx = [
    // bottom (down)
    0, 2, 1,  0, 3, 2,
    // top (up)
    4, 5, 6,  4, 6, 7,
    // front (windshield side, -Z) — replaced by separate windshield mesh,
    // but keep an opaque backer so the interior isn't visible
    0, 1, 5,  0, 5, 4,
    // back
    2, 3, 7,  2, 7, 6,
    // left
    3, 0, 4,  3, 4, 7,
    // right
    1, 2, 6,  1, 6, 5,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Windshield: a single raked quad sitting on the front of the console. */
function buildWindshieldGeometry(): THREE.BufferGeometry {
  const wBot = 0.55 * BOAT_SCALE;
  const wTop = 0.42 * BOAT_SCALE;
  const h = 0.55 * BOAT_SCALE;
  const lBot = 0.65 * BOAT_SCALE;
  const lTop = 0.45 * BOAT_SCALE;
  const rake = 0.12 * BOAT_SCALE;
  const v = [
    -wBot / 2, 0.001, -lBot / 2,
     wBot / 2, 0.001, -lBot / 2,
     wTop / 2, h,     -lTop / 2 + rake,
    -wTop / 2, h,     -lTop / 2 + rake,
  ];
  const idx = [0, 1, 2, 0, 2, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export const DriftBoat: React.FC<{ surfaceY: number }> = ({ surfaceY }) => {
  const groupRef = useRef<THREE.Group>(null);
  const rockRef = useRef(0);

  const { driftPath, driftHour, driftConditions } = useDriftStore();

  const { topsides, bottom, deck } = useMemo(() => buildHullGeometries(), []);
  const consoleGeo = useMemo(() => buildConsoleGeometry(), []);
  const windshieldGeo = useMemo(() => buildWindshieldGeometry(), []);

  // Dispose all procedural geometries when the component unmounts so we
  // don't leak GPU buffers on HMR or scene teardown.
  useEffect(() => {
    return () => {
      topsides.dispose();
      bottom.dispose();
      deck.dispose();
      consoleGeo.dispose();
      windshieldGeo.dispose();
    };
  }, [topsides, bottom, deck, consoleGeo, windshieldGeo]);

  const topsidesMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xf2f0e6, // off-white topsides
        roughness: 0.55,
        metalness: 0.05,
      }),
    [],
  );
  const bottomMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x2b2f3a, // dark bottom paint
        roughness: 0.75,
        metalness: 0.05,
      }),
    [],
  );
  const deckMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xb6a682, // teak-toned deck
        roughness: 0.85,
        metalness: 0.0,
      }),
    [],
  );
  const consoleMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x3b4250, // grey console
        roughness: 0.6,
        metalness: 0.2,
      }),
    [],
  );
  const windshieldMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x0e1622,
        roughness: 0.2,
        metalness: 0.4,
        transparent: true,
        opacity: 0.55,
      }),
    [],
  );
  const blackMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x111418,
        roughness: 0.5,
        metalness: 0.3,
      }),
    [],
  );
  const railMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xd9d9dc,
        roughness: 0.3,
        metalness: 0.85,
      }),
    [],
  );

  useFrame((_, delta) => {
    rockRef.current += delta;
    if (!groupRef.current) return;

    const waveH = driftConditions?.[driftHour]?.waveHeightM ?? 0.1;
    const rockAmp = Math.min(0.08, waveH * 0.04);
    groupRef.current.rotation.z = Math.sin(rockRef.current * 0.9) * rockAmp;
    groupRef.current.rotation.x = Math.sin(rockRef.current * 0.7 + 1.2) * rockAmp * 0.6;

    const wp = driftPath?.[driftHour];
    if (wp) {
      groupRef.current.position.set(wp.worldX, surfaceY + 0.16, wp.worldZ);
      groupRef.current.rotation.y = -(wp.headingDeg * Math.PI) / 180;
    }
  });

  const wp0 = driftPath?.[0];
  if (!wp0) return null;

  // Layout constants (in local hull coords). Bow = -Z.
  const consoleZ = 0.25 * BOAT_SCALE;       // slightly aft of midships
  const consoleY = DECK_Y * BOAT_SCALE;     // sits on deck
  const sternZ = (L / 2) * BOAT_SCALE;
  const bowZ = -(L / 2) * BOAT_SCALE;
  const railY = (DECK_Y + 0.02) * BOAT_SCALE;
  const navLightZ = -0.6 * BOAT_SCALE;
  const navLightX = 0.42 * BOAT_SCALE;

  return (
    <group
      ref={groupRef}
      position={[wp0.worldX, surfaceY + 0.16, wp0.worldZ]}
      scale={BOAT_SCALE}
    >
      {/* Hull — topsides + bottom + deck */}
      <mesh geometry={topsides} material={topsidesMat} castShadow receiveShadow />
      <mesh geometry={bottom} material={bottomMat} castShadow />
      <mesh geometry={deck} material={deckMat} receiveShadow />

      {/* Console / wheelhouse */}
      <group position={[0, consoleY, consoleZ]}>
        <mesh geometry={consoleGeo} material={consoleMat} castShadow />
        <mesh geometry={windshieldGeo} material={windshieldMat} />
      </group>

      {/* Bow rail — a half-torus stanchion-style rail around the bow deck */}
      <group position={[0, railY + 0.18, bowZ + 0.45]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.42, 0.018, 6, 12, Math.PI]} />
          <primitive object={railMat} attach="material" />
        </mesh>
        {/* Stanchions */}
        {[-0.4, 0, 0.4].map((x, i) => (
          <mesh key={i} position={[x, -0.09, 0]}>
            <cylinderGeometry args={[0.018, 0.018, 0.22, 6]} />
            <primitive object={railMat} attach="material" />
          </mesh>
        ))}
      </group>

      {/* Cleats — two on each gunwale */}
      {[
        [-0.42, -0.5],
        [0.42, -0.5],
        [-0.42, 0.7],
        [0.42, 0.7],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x!, railY + 0.04, z!]} castShadow>
          <boxGeometry args={[0.06, 0.05, 0.12]} />
          <primitive object={railMat} attach="material" />
        </mesh>
      ))}

      {/* Antenna on the console roof */}
      <mesh position={[0.15, consoleY + 0.55 * BOAT_SCALE + 0.35, consoleZ + 0.15]}>
        <cylinderGeometry args={[0.012, 0.012, 0.7, 6]} />
        <meshStandardMaterial color={0x111418} roughness={0.6} />
      </mesh>

      {/* Outboard motor at the stern */}
      <group position={[0, railY - 0.05, sternZ + 0.12]}>
        {/* Cowling */}
        <mesh castShadow>
          <boxGeometry args={[0.32, 0.36, 0.36]} />
          <primitive object={blackMat} attach="material" />
        </mesh>
        {/* Shaft */}
        <mesh position={[0, -0.42, -0.04]}>
          <cylinderGeometry args={[0.06, 0.06, 0.55, 8]} />
          <primitive object={blackMat} attach="material" />
        </mesh>
        {/* Skeg / lower unit */}
        <mesh position={[0, -0.78, 0.0]}>
          <boxGeometry args={[0.09, 0.16, 0.32]} />
          <primitive object={blackMat} attach="material" />
        </mesh>
        {/* Prop housing tip */}
        <mesh position={[0, -0.78, -0.14]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.1, 10]} />
          <primitive object={blackMat} attach="material" />
        </mesh>
      </group>

      {/* Navigation lights — red port, green starboard, mounted on the
          console roof corners near the bow side */}
      <mesh position={[-navLightX, consoleY + 0.55 * BOAT_SCALE + 0.04, consoleZ - 0.32]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color={0xff2222} emissive={0xff0000} emissiveIntensity={0.9} />
      </mesh>
      <mesh position={[navLightX, consoleY + 0.55 * BOAT_SCALE + 0.04, consoleZ - 0.32]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color={0x22ff44} emissive={0x00ff44} emissiveIntensity={0.9} />
      </mesh>

      {/* Bow nav light (all-around white) for good measure */}
      <mesh position={[0, railY + 0.12, bowZ + 0.55]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color={0xffffff} emissive={0xffffff} emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
};
