import React from "react";
import { CopyButton } from "@/components/ui/CopyButton";

export const SCENE_CHUNK_RECOVERY_KEY = "bathyscan:scene-chunk-recovery";

const DYNAMIC_CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /loading chunk [\w-]+ failed/i,
];

export function isDynamicChunkError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return DYNAMIC_CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

function hasAttemptedRecovery(): boolean {
  try {
    return window.sessionStorage.getItem(SCENE_CHUNK_RECOVERY_KEY) === "1";
  } catch {
    return false;
  }
}

function markRecoveryAttempted(): void {
  try {
    window.sessionStorage.setItem(SCENE_CHUNK_RECOVERY_KEY, "1");
  } catch {
    // A storage-disabled browser still gets the contained fallback below.
  }
}

export function clearSceneChunkRecoveryAttempt(): void {
  try {
    window.sessionStorage.removeItem(SCENE_CHUNK_RECOVERY_KEY);
  } catch {
    // Ignore storage-disabled browsers.
  }
}

export async function clearDeferredAssetCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.endsWith("-app-assets"))
        .map((name) => caches.delete(name)),
    );
  } catch {
    // The reload still replaces the active shell when Cache Storage is unavailable.
  }
}

export async function recoverFromStaleSceneChunk(): Promise<boolean> {
  if (hasAttemptedRecovery()) return false;
  markRecoveryAttempted();
  await clearDeferredAssetCaches();
  return true;
}

export async function loadTourScene() {
  try {
    const module = await import("@/pages/TourScene");
    clearSceneChunkRecoveryAttempt();
    return { default: module.TourScene };
  } catch (error) {
    if (!isDynamicChunkError(error) || !(await recoverFromStaleSceneChunk())) {
      throw error;
    }

    // A fresh document gets a fresh app-shell/chunk dependency graph. The session
    // marker prevents a missing deployment asset from becoming an infinite loop.
    if (typeof window !== "undefined") window.location.reload();
    throw new Error(
      "The 3D map asset is out of date. Reload the page to try again.",
      { cause: error },
    );
  }
}

export function SceneChunkFallback(): React.JSX.Element {
  return (
    <div
      role="alert"
      data-testid="scene-chunk-fallback"
      className="absolute inset-0 flex items-center justify-center bg-[#040810] px-6 text-center text-sky-200 select-text"
    >
      <div className="max-w-md space-y-3">
        <p className="font-mono text-sm">The 3D map could not be loaded.</p>
        <p className="text-xs text-slate-400">
          The app was updated while this page was open. Reload once to get the
          current map assets.
        </p>
        <CopyButton
          text={
            "The 3D map could not be loaded.\n" +
            "The app was updated while this page was open. Reload once to get the current map assets."
          }
          className="border border-cyan-400/30 text-cyan-300 hover:bg-cyan-400/10"
        />
        <button
          type="button"
          className="rounded border border-cyan-400/50 px-3 py-1 font-mono text-xs text-cyan-300 hover:bg-cyan-400/10"
          onClick={() => {
            clearSceneChunkRecoveryAttempt();
            window.location.reload();
          }}
        >
          Reload map
        </button>
      </div>
    </div>
  );
}