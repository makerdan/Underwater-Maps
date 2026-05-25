/**
 * Custom GLSL ShaderMaterial for the seafloor terrain.
 *
 * Blends four procedural tiling textures (sand / sediment / silt / basalt)
 * using per-vertex zone weights stored in a zoneWeight vec4 attribute.
 * The depth colormap colour (vertex attribute "color") is multiplied on top
 * so the depth colour scale is preserved.  Lighting uses Blinn-Phong with a
 * directional sun + a subtle point lamp at the camera position.
 */
import * as THREE from "three";
import type { TerrainTextures } from "./textures";

// ---------------------------------------------------------------------------
// GLSL source
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `
  attribute vec4 zoneWeight;
  attribute vec3 color;

  varying vec2  vUv;
  varying vec4  vZoneWeight;
  varying vec3  vColor;
  varying vec3  vNormal;
  varying vec3  vWorldPos;

  void main() {
    vUv         = uv;
    vZoneWeight = zoneWeight;
    vColor      = color;
    vNormal     = normalize(normalMatrix * normal);

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

  varying vec2  vUv;
  varying vec4  vZoneWeight;
  varying vec3  vColor;
  varying vec3  vNormal;
  varying vec3  vWorldPos;

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

    finalColor *= (ambient + diffuse + lampDiff);

    gl_FragColor = vec4(finalColor, uOpacity);
  }
`;

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
    },
    transparent: true,
    side: THREE.DoubleSide,
  });
}
