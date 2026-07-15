/**
 * Custom GLSL ShaderMaterial for the seafloor terrain.
 *
 * Blends four procedural tiling textures (sand / sediment / silt / basalt)
 * using per-vertex zone weights stored in a zoneWeight vec4 attribute.
 * The depth colormap colour (vertex attribute "color") is multiplied on top
 * so the depth colour scale is preserved.  Lighting uses Blinn-Phong with a
 * directional sun + a subtle point lamp at the camera position.
 *
 * Zone overlay: when uZoneOverlay > 0 the fragment is tinted with a pastel
 * colour per texture slot, revealing the AI-classified zone map.
 */
import * as THREE from "three";
import type { TerrainTextures } from "./textures";

// ---------------------------------------------------------------------------
// Pastel zone tint colours (sRGB, normalised to [0,1])
// These match the legend swatches in ZoneOverlay.tsx.
// ---------------------------------------------------------------------------

/** Texture-slot pastel tints: sand, sediment, silt, basalt */
export const ZONE_TINT_COLORS = [
  new THREE.Color(0xf5d58a), // sand      — warm yellow
  new THREE.Color(0xc49a6c), // sediment  — earthy amber
  new THREE.Color(0x8ab4d0), // silt      — cool blue-grey
  new THREE.Color(0xb06060), // basalt    — muted terracotta
] as const;

// ---------------------------------------------------------------------------
// GLSL source
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `
  attribute vec4  zoneWeight;
  attribute vec3  color;
  attribute float slope;

  varying vec2  vUv;
  varying vec4  vZoneWeight;
  varying vec3  vColor;
  varying vec3  vNormal;
  varying vec3  vWorldPos;
  varying float vSlope;

  void main() {
    vUv         = uv;
    vZoneWeight = zoneWeight;
    vColor      = color;
    vNormal     = normalize(normalMatrix * normal);
    vSlope      = slope;

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uTexSand;
  uniform sampler2D uTexSediment;
  uniform sampler2D uTexSilt;
  uniform sampler2D uTexBasalt;

  uniform sampler2D uNrmSand;
  uniform sampler2D uNrmSediment;
  uniform sampler2D uNrmSilt;
  uniform sampler2D uNrmBasalt;

  uniform float uTiling;
  uniform float uOpacity;
  uniform vec3  uSunDir;
  uniform vec3  uLampPos;

  // Zone overlay
  uniform float uZoneOverlay;
  uniform vec3  uZoneTint0;
  uniform vec3  uZoneTint1;
  uniform vec3  uZoneTint2;
  uniform vec3  uZoneTint3;
  // Per-slot visibility mask (each component 0.0=hidden or 1.0=visible)
  uniform vec4  uZoneVisible;

  // Highlight overlay
  uniform float uHighlightMode;   // 0=none 1=depthRange 2=slope 3=zone
  uniform float uHighlightMin;    // depthRange: minMetres, slope: minDeg, zone: slot
  uniform float uHighlightMax;    // depthRange: maxMetres, slope: maxDeg
  uniform float uGridMinDepth;
  uniform float uGridMaxDepth;

  // Habitat overlay
  uniform sampler2D uHabitatTex;       // Red channel = habitat score [0,1]
  uniform float     uShowHabitat;      // 0=off 1=on
  uniform float     uHabitatIntensity; // Blend strength multiplier [0,1]
  uniform vec3      uHabitatColor;     // Overlay tint colour (default amber)

  varying vec2  vUv;
  varying vec4  vZoneWeight;
  varying vec3  vColor;
  varying vec3  vNormal;
  varying vec3  vWorldPos;
  varying float vSlope;

  // Decode a normal-map sample from [0,1]^3 → [-1,1]^3
  vec3 decodeNrm(vec4 s) {
    return normalize(s.rgb * 2.0 - 1.0);
  }

  void main() {
    vec2 tuv = vUv * uTiling;

    // ── Blend colour textures ──────────────────────────────────────────────
    vec3 cSand     = texture2D(uTexSand,     tuv).rgb;
    vec3 cSediment = texture2D(uTexSediment, tuv).rgb;
    vec3 cSilt     = texture2D(uTexSilt,     tuv).rgb;
    vec3 cBasalt   = texture2D(uTexBasalt,   tuv).rgb;

    vec3 texColor = cSand     * vZoneWeight.x
                  + cSediment * vZoneWeight.y
                  + cSilt     * vZoneWeight.z
                  + cBasalt   * vZoneWeight.w;

    // ── Blend normal maps ──────────────────────────────────────────────────
    vec3 nSand     = decodeNrm(texture2D(uNrmSand,     tuv));
    vec3 nSediment = decodeNrm(texture2D(uNrmSediment, tuv));
    vec3 nSilt     = decodeNrm(texture2D(uNrmSilt,     tuv));
    vec3 nBasalt   = decodeNrm(texture2D(uNrmBasalt,   tuv));

    vec3 nrmLocal = normalize(
        nSand     * vZoneWeight.x
      + nSediment * vZoneWeight.y
      + nSilt     * vZoneWeight.z
      + nBasalt   * vZoneWeight.w
    );

    // ── Tangent-space → world-space normal perturbation ────────────────────
    // Terrain lies in XZ plane: tangent ≈ X, bitangent ≈ Z
    vec3 N = normalize(vNormal);
    vec3 T = normalize(vec3(1.0, 0.0, 0.0) - dot(vec3(1.0,0.0,0.0), N) * N);
    vec3 B = normalize(cross(N, T));
    mat3 TBN = mat3(T, B, N);
    vec3 normal = normalize(TBN * nrmLocal);

    // Correct for back-face rendering
    if (!gl_FrontFacing) normal = -normal;

    // ── Depth-colour tint ──────────────────────────────────────────────────
    // Boost factor (1.6) compensates for the deep-blue tint being dark
    vec3 finalColor = texColor * vColor * 1.6;

    // ── Blinn-Phong lighting ───────────────────────────────────────────────
    float ambient = 0.30;
    vec3  sunDir  = normalize(uSunDir);
    float diffuse = max(0.0, dot(normal, sunDir)) * 0.65;

    // Submersible lamp (camera position) — warm, attenuated point light
    vec3  lampDir  = normalize(uLampPos - vWorldPos);
    float lampDist = length(uLampPos - vWorldPos);
    float lampAtt  = 1.0 / (1.0 + 0.015 * lampDist * lampDist);
    float lampDiff = max(0.0, dot(normal, lampDir)) * lampAtt * 0.55;

    float lighting = ambient + diffuse + lampDiff;
    finalColor *= lighting;

    // ── Zone overlay tint ──────────────────────────────────────────────────
    if (uZoneOverlay > 0.0) {
      // Apply per-slot visibility mask (0.0=hidden, 1.0=visible).
      vec4 visW = vZoneWeight * uZoneVisible;
      float totalVisW = visW.x + visW.y + visW.z + visW.w;
      if (totalVisW > 0.001) {
        // Re-normalise so areas with some hidden slots don't go dark.
        vec4 normW = visW / totalVisW;
        vec3 zoneTint = uZoneTint0 * normW.x
                      + uZoneTint1 * normW.y
                      + uZoneTint2 * normW.z
                      + uZoneTint3 * normW.w;
        finalColor = mix(finalColor, zoneTint * lighting, uZoneOverlay * 0.50);
      }
    }

    // ── Query highlight overlay ────────────────────────────────────────────
    // Cells IN the highlighted range glow cyan; cells outside dim to 30%.
    if (uHighlightMode > 0.5) {
      bool inRange = false;

      if (uHighlightMode < 1.5) {
        // depthRange: reconstruct depth in metres from world Y
        float t = clamp(-vWorldPos.y / 50.0, 0.0, 1.0);
        float depthM = uGridMinDepth + t * (uGridMaxDepth - uGridMinDepth);
        inRange = (depthM >= uHighlightMin && depthM <= uHighlightMax);
      } else if (uHighlightMode < 2.5) {
        // slope: vSlope is in degrees
        inRange = (vSlope >= uHighlightMin && vSlope <= uHighlightMax);
      } else {
        // zone: dominant texture slot from vZoneWeight
        float bestW = vZoneWeight.x;
        float slot  = 0.0;
        if (vZoneWeight.y > bestW) { bestW = vZoneWeight.y; slot = 1.0; }
        if (vZoneWeight.z > bestW) { bestW = vZoneWeight.z; slot = 2.0; }
        if (vZoneWeight.w > bestW) { slot = 3.0; }
        inRange = (abs(slot - uHighlightMin) < 0.5);
      }

      if (inRange) {
        finalColor = mix(finalColor, vec3(0.0, 0.9, 1.0) * lighting, 0.60);
      } else {
        finalColor *= 0.30;
      }
    }

    // ── Habitat suitability overlay ────────────────────────────────────────
    // Samples the precomputed score texture and blends a user-chosen tint.
    if (uShowHabitat > 0.5) {
      float score = texture2D(uHabitatTex, vUv).r;
      if (score > 0.0) {
        float alpha = clamp(score * uHabitatIntensity, 0.0, 1.0);
        finalColor = mix(finalColor, uHabitatColor * lighting, alpha);
      }
    }

    gl_FragColor = vec4(finalColor, uOpacity);
  }
`;

// ---------------------------------------------------------------------------
// Module-level singletons (allocated once, shared across all material instances)
// ---------------------------------------------------------------------------

/**
 * Placeholder 1×1 habitat texture used before real scores arrive.
 * Allocated once at module load so switching datasets does not leak a new
 * DataTexture into GPU memory on every call to createTerrainShaderMaterial.
 * UnsignedByteType is universally filterable without OES_texture_float_linear.
 */
const PLACEHOLDER_HABITAT_TEXTURE = new THREE.DataTexture(
  new Uint8Array([0]),
  1,
  1,
  THREE.RedFormat,
  THREE.UnsignedByteType,
);

/**
 * Shared 1×1 zero-score placeholder for the `uHabitatTex` uniform.
 *
 * Callers that dispose a per-grid habitat DataTexture MUST reset the uniform
 * back to this placeholder. Leaving a disposed texture bound to the uniform
 * makes three.js silently re-upload it the next time the shader samples it
 * (e.g. while new scores are still computing), and that resurrected GPU
 * allocation is never disposed again.
 */
export function getPlaceholderHabitatTexture(): THREE.DataTexture {
  return PLACEHOLDER_HABITAT_TEXTURE;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new ShaderMaterial for the terrain.
 * The caller is responsible for disposing the returned material when it is
 * no longer needed.
 *
 * @param textures  — colour + normal map textures from getTerrainTextures()
 * @param tiling    — UV tiling scale (higher = more repeats = smaller tiles)
 */
export function createTerrainShaderMaterial(
  textures: TerrainTextures,
  tiling: number,
): THREE.ShaderMaterial {
  const { colorTextures, normalMaps } = textures;
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTexSand:     { value: colorTextures[0] },
      uTexSediment: { value: colorTextures[1] },
      uTexSilt:     { value: colorTextures[2] },
      uTexBasalt:   { value: colorTextures[3] },
      uNrmSand:     { value: normalMaps[0] },
      uNrmSediment: { value: normalMaps[1] },
      uNrmSilt:     { value: normalMaps[2] },
      uNrmBasalt:   { value: normalMaps[3] },
      uTiling:      { value: tiling },
      uOpacity:     { value: 0 },
      uSunDir:      { value: new THREE.Vector3(0.5, 1.0, 0.7).normalize() },
      uLampPos:     { value: new THREE.Vector3(0, 20, 40) },
      // Zone overlay
      uZoneOverlay: { value: 0 },
      uZoneTint0:   { value: ZONE_TINT_COLORS[0] },
      uZoneTint1:   { value: ZONE_TINT_COLORS[1] },
      uZoneTint2:   { value: ZONE_TINT_COLORS[2] },
      uZoneTint3:   { value: ZONE_TINT_COLORS[3] },
      // All slots visible by default (vec4: x=slot0, y=slot1, z=slot2, w=slot3)
      uZoneVisible: { value: new THREE.Vector4(1, 1, 1, 1) },
      // Query highlight overlay
      uHighlightMode:  { value: 0 },
      uHighlightMin:   { value: 0 },
      uHighlightMax:   { value: 0 },
      uGridMinDepth:   { value: 0 },
      uGridMaxDepth:   { value: 1000 },
      // Habitat suitability overlay — shared singleton placeholder until scores arrive.
      uHabitatTex:       { value: PLACEHOLDER_HABITAT_TEXTURE },
      uShowHabitat:      { value: 0 },
      uHabitatIntensity: { value: 0.4 },
      uHabitatColor:     { value: new THREE.Color(1.0, 0.6, 0.1) }, // default amber
    },
    transparent: true,
    side: THREE.DoubleSide,
  });
}
