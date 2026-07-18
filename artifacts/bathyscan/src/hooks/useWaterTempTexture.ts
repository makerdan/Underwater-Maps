/**
 * useWaterTempTexture — bake a temperature-depth profile into a THREE.DataTexture.
 *
 * Accepts an array of { depthM, celsius } samples (sorted shallow→deep) and
 * returns a 1×N RGBA DataTexture where each row encodes the thermal colour at
 * that depth.  Row 0 = shallowest (warmest), Row N-1 = deepest (coldest).
 *
 * The texture is used by WaterTempVolumeLayer's fragment shader as a 1-D
 * lookup table keyed by normalised world Y position.
 *
 * Returns null when samples is null, empty, or has fewer than 2 entries
 * (to avoid creating a degenerate texture that would crash the shader).
 * The returned texture is a stable reference — it is recreated only when
 * the samples array identity changes.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { tempToColor } from "@/lib/thermalColormap";

export interface TempSample {
  depthM: number;
  celsius: number;
}

/**
 * Convert a profile of depth+temperature samples into a 1×N RGBA DataTexture.
 * Row 0 corresponds to the shallowest sample (surface / warmest).
 * Row N-1 corresponds to the deepest sample (coldest).
 *
 * @returns DataTexture (caller must call .dispose() on cleanup), or null when
 *          samples is null / too short.
 */
export function bakeWaterTempTexture(
  samples: TempSample[] | null | undefined,
): THREE.DataTexture | null {
  if (!samples || samples.length < 2) return null;

  const N = samples.length;
  const data = new Uint8Array(N * 4);

  for (let i = 0; i < N; i++) {
    const s = samples[i]!;
    const c = tempToColor(s.celsius);
    const srgb = c.clone().convertLinearToSRGB();
    data[i * 4 + 0] = Math.round(Math.max(0, Math.min(1, srgb.r)) * 255);
    data[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, srgb.g)) * 255);
    data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, srgb.b)) * 255);
    data[i * 4 + 3] = 255;
  }

  const tex = new THREE.DataTexture(
    data,
    1,
    N,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.needsUpdate = true;
  return tex;
}

/**
 * React hook wrapper around `bakeWaterTempTexture`. Memoises the DataTexture
 * so it is only rebuilt when `samples` changes identity.
 *
 * The hook owns the texture's GPU lifetime: when a rebuild replaces the
 * texture, the previous one is disposed, and the current texture is disposed
 * on unmount. Disposal of the replaced texture happens in an effect on the
 * component calling this hook — because parent effects run after child
 * effects, any consumer component (e.g. WaterTempVolumeLayer) has already
 * rebound its uniform to the new texture by then, so the disposed texture is
 * never left bound to a live uniform (which would cause three.js to silently
 * re-upload it).
 */
export function useWaterTempTexture(
  samples: TempSample[] | null | undefined,
): THREE.DataTexture | null {
  const texture = useMemo(() => bakeWaterTempTexture(samples), [samples]);
  const prevTexRef = useRef<THREE.DataTexture | null>(null);

  useEffect(() => {
    const prev = prevTexRef.current;
    if (prev && prev !== texture) prev.dispose();
    prevTexRef.current = texture;
  }, [texture]);

  useEffect(
    () => () => {
      prevTexRef.current?.dispose();
      prevTexRef.current = null;
    },
    [],
  );

  return texture;
}
