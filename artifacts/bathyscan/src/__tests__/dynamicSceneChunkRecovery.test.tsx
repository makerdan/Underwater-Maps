import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDeferredAssetCaches,
  clearSceneChunkRecoveryAttempt,
  isDynamicChunkError,
  loadTourScene,
  recoverFromStaleSceneChunk,
  SCENE_CHUNK_RECOVERY_KEY,
} from "@/lib/dynamicSceneLoader";

describe("dynamic 3D scene chunk recovery", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("recognizes browser and bundler dynamic-import failures", () => {
    expect(isDynamicChunkError(new Error("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isDynamicChunkError(new Error("ChunkLoadError: Loading chunk TourScene failed"))).toBe(true);
    expect(isDynamicChunkError(new Error("The terrain request failed"))).toBe(false);
  });

  it("allows at most one recovery attempt per page session", async () => {
    expect(await recoverFromStaleSceneChunk()).toBe(true);
    expect(sessionStorage.getItem(SCENE_CHUNK_RECOVERY_KEY)).toBe("1");
    expect(await recoverFromStaleSceneChunk()).toBe(false);

    clearSceneChunkRecoveryAttempt();
    expect(sessionStorage.getItem(SCENE_CHUNK_RECOVERY_KEY)).toBeNull();
  });

  it("clears only deferred application-asset caches before retrying", async () => {
    const deleteCache = vi.fn(async () => true);
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => [
        "bathyscan-v-current-app-assets",
        "bathyscan-v-current-api-terrain",
        "unrelated-cache",
      ]),
      delete: deleteCache,
    });

    await clearDeferredAssetCaches();

    expect(deleteCache).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledWith("bathyscan-v-current-app-assets");
  });

  // This is a real lazy-import smoke check (not a mocked module). The scene's
  // dependency graph is large and may take longer than a normal unit assertion
  // to transform when the full suite is running concurrently.
  it("resolves the current TourScene module normally", async () => {
    const loaded = await loadTourScene();
    expect(loaded.default).toBeTypeOf("function");
    expect(sessionStorage.getItem(SCENE_CHUNK_RECOVERY_KEY)).toBeNull();
  }, 45_000);
});