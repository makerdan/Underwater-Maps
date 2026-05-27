/**
 * useUrlSync — throttled URL update hook for BathyScan share links.
 *
 * Watches only the camera fields that matter for the share link
 * (cameraLon, cameraLat, cameraDepth, heading + active datasetId) and
 * writes them to the browser URL via `history.replaceState` using a
 * leading+trailing throttle so the URL stays fresh under continuous
 * camera movement without hammering the history API on every frame.
 *
 * Pure debounce would be starved because `cameraStore` is updated by the
 * Three.js render loop every frame while the user is flying — the debounce
 * timer would reset indefinitely and never fire. The throttle used here
 * fires immediately on the first change, then at most once per THROTTLE_MS
 * thereafter, with a trailing fire to capture the final resting position.
 *
 * The hook is a no-op until `appReady` is true so we never write
 * partial / initialisation state into the URL.
 */
import { useEffect, useRef } from "react";
import { useCameraStore } from "@/lib/cameraStore";
import { encodeViewParams } from "@/lib/viewUrl";

const THROTTLE_MS = 800;

export function useUrlSync(datasetId: string | null, appReady: boolean): void {
  const lastFiredRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!appReady || !datasetId) return;

    function pushUrl(): void {
      lastFiredRef.current = Date.now();
      const { cameraLon, cameraLat, cameraDepth, heading } =
        useCameraStore.getState();
      if (
        cameraLon === null ||
        cameraLat === null ||
        cameraDepth === null ||
        !datasetId
      )
        return;

      const qs = encodeViewParams({
        lon: cameraLon,
        lat: cameraLat,
        depth: cameraDepth,
        heading,
        datasetId,
      });

      const newUrl = `${window.location.pathname}?${qs}${window.location.hash}`;
      try {
        history.replaceState(null, "", newUrl);
      } catch {
        // Silently ignore — replaceState can throw on sandboxed iframes.
      }
    }

    function schedule(): void {
      const elapsed = Date.now() - lastFiredRef.current;

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      if (elapsed >= THROTTLE_MS) {
        // Leading edge: enough time has passed, fire immediately.
        pushUrl();
      } else {
        // Trailing edge: fire after the remaining window expires.
        timerRef.current = setTimeout(pushUrl, THROTTLE_MS - elapsed);
      }
    }

    // Subscribe only when the fields we care about actually change.
    // `cameraStore` is also updated for crosshairGps / lastClickedGps
    // every frame; filtering here avoids unnecessary schedule() calls.
    const unsub = useCameraStore.subscribe((state, prevState) => {
      if (
        state.cameraLon !== prevState.cameraLon ||
        state.cameraLat !== prevState.cameraLat ||
        state.cameraDepth !== prevState.cameraDepth ||
        state.heading !== prevState.heading
      ) {
        schedule();
      }
    });

    // Push once immediately so the URL reflects the position as soon as
    // the app is ready, not only after the first camera move.
    pushUrl();

    return () => {
      unsub();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [datasetId, appReady]);
}
