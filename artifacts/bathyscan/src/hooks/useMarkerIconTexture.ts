/**
 * useMarkerIconTexture — loads a marker type's SVG icon as a THREE.CanvasTexture
 * for use on 3D billboard sprites.
 *
 * Returns null while the icon image is still loading (or when the type has no
 * icon / the environment lacks Image support, e.g. headless tests) so callers
 * can render a fallback. The texture is disposed on unmount / input change.
 */
import { useEffect, useState } from "react";
import * as THREE from "three";
import { loadMarkerIconImage } from "@/lib/markerIcons";

/** Raster size for sprite icon textures (px). */
const SPRITE_ICON_PX = 128;

export function useMarkerIconTexture(type: string, color: string): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    let tex: THREE.Texture | null = null;

    void loadMarkerIconImage(type, color, SPRITE_ICON_PX).then((img) => {
      if (cancelled || !img) return;
      tex = new THREE.CanvasTexture(img as unknown as HTMLCanvasElement);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      setTexture(tex);
    });

    return () => {
      cancelled = true;
      tex?.dispose();
      setTexture(null);
    };
  }, [type, color]);

  return texture;
}
