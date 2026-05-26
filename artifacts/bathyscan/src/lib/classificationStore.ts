/**
 * classificationStore.ts — Zustand store for AI seafloor zone classification.
 *
 * Check order (fastest → most expensive):
 *   1. sessionStorage cache (keyed by gridHash — instant)
 *   2. Server zone cache via GET /api/datasets/:id/zones?h=<gridHash> (fast, no AI cost)
 *   3. Poe AI classify endpoint (3–8 s)
 *
 * The gridHash (FNV-1a 32-bit of depths[]) is the primary cache key everywhere.
 * This prevents collisions when datasetId is reused (e.g. all anonymous uploads
 * share the synthetic id "upload"). Different grid content → different hash →
 * separate cache entries, both in sessionStorage and on the server.
 *
 * Single-flight deduplication:
 *   inFlight: Map<gridHash, Promise<void>> ensures parallel callers
 *   (DatasetPanel + App.tsx catch-all) share one fetch and one AI call.
 *
 * Dataset guard:
 *   currentDatasetId tracks the in-progress dataset. Every async checkpoint
 *   re-checks it before writing state so stale responses silently drop.
 */
import { create } from "zustand";
import { poeClassify } from "@workspace/api-client-react";
import type { TerrainData, PoeClassifyRequest } from "@workspace/api-client-react";
import { gridToBase64Png } from "./gridToImage";
import type { ClassifyResultSource } from "@workspace/api-client-react";
import { parseAndUpsampleZones, zoneMapToStorage, zoneMapFromStorage } from "./zoneMap";

// ---------------------------------------------------------------------------
// Error categorisation
// ---------------------------------------------------------------------------

/** Coarse category for a failed AI-classification call. */
export type ClassificationErrorCategory =
  | "missing_key"
  | "unauthorized"
  | "rate_limited"
  | "other";

/** Structured error surfaced to the UI in place of a single string. */
export interface ClassificationError {
  category: ClassificationErrorCategory;
  /** Short, single-line copy ready to render in the panel. */
  reason: string;
  /** Original message from the thrown error, kept for console/debug. */
  detail: string;
}

/**
 * Map a thrown error from the AI classification call into a small set of
 * categories with user-friendly copy. Looks at common shapes:
 *   • ApiError from the generated client (has `.status` and `.data.message`)
 *   • Plain Error whose `.message` contains "POE_API_KEY environment variable"
 *
 * Pure / sync / no DOM access so it can be unit-tested directly.
 */
export function categorizeClassificationError(err: unknown): ClassificationError {
  const e = err as { status?: number; data?: { message?: string; error?: string }; message?: string };
  const status = typeof e?.status === "number" ? e.status : undefined;
  const serverMessage =
    (typeof e?.data?.message === "string" && e.data.message) ||
    (typeof e?.message === "string" && e.message) ||
    "Classification failed";

  // missing_key — server's getPoeClient() throws when POE_API_KEY is unset,
  // which handlePoeError wraps as 500 { error: "poe_error", message: "POE_API_KEY environment variable is not set. ..." }
  if (/POE_API_KEY/i.test(serverMessage) || /api[_ ]key/i.test(serverMessage) && /not set|missing/i.test(serverMessage)) {
    return {
      category: "missing_key",
      reason: "AI classifier not configured. Add `POE_API_KEY` in Secrets and restart the API.",
      detail: serverMessage,
    };
  }

  if (status === 401 || e?.data?.error === "auth_error") {
    return {
      category: "unauthorized",
      reason: "AI classifier unauthorized — check `POE_API_KEY`.",
      detail: serverMessage,
    };
  }

  if (status === 429 || e?.data?.error === "rate_limit") {
    return {
      category: "rate_limited",
      reason: "AI classifier rate-limited — try again in a moment.",
      detail: serverMessage,
    };
  }

  // Generic fallback — truncate to one line.
  const short = serverMessage.split(/\r?\n/)[0]?.slice(0, 140) ?? "Classification failed";
  return {
    category: "other",
    reason: `Classification unavailable — ${short}`,
    detail: serverMessage,
  };
}

// ---------------------------------------------------------------------------
// Grid hash — FNV-1a 32-bit over the depths float array.
// This is the primary content-addressable key used by both client + server.
// ---------------------------------------------------------------------------

/**
 * Downsample a depth grid to a 1024-length (32×32 row-major) array using
 * nearest-neighbour sampling. Sent to the server alongside the PNG so the
 * server-side heuristic fallback has the raw numbers to band into zones when
 * the AI call fails.
 */
export function downsampleDepths32(grid: TerrainData): number[] {
  const SIZE = 32;
  const out = new Array<number>(SIZE * SIZE);
  const W = grid.width;
  const H = grid.height;
  const minDepth = grid.minDepth;
  for (let row = 0; row < SIZE; row++) {
    const srcRow = Math.round((row / (SIZE - 1)) * (H - 1));
    for (let col = 0; col < SIZE; col++) {
      const srcCol = Math.round((col / (SIZE - 1)) * (W - 1));
      out[row * SIZE + col] = grid.depths[srcRow * W + srcCol] ?? minDepth;
    }
  }
  return out;
}

/**
 * Strong, collision-resistant fingerprint of a depth grid.
 *
 * Uses SHA-256 via SubtleCrypto over a canonical byte representation of the
 * depths (rounded to mm precision, little-endian Int32). The previous
 * implementation was a 32-bit FNV-1a, whose 8-char hex collisions could let
 * the server-side zone cache return another grid's labels — see task #307
 * for the threat model. Returning the full 64-char sha256 hex makes the
 * (gridHash, waterType) key effectively unique even before the server's
 * own sha256 namespacing layer.
 */
export async function hashGrid(depths: number[]): Promise<string> {
  const buf = new ArrayBuffer(depths.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < depths.length; i++) {
    view.setInt32(i * 4, Math.round((depths[i] ?? 0) * 1000) | 0, true);
  }
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

// Cache keys are bumped (v2) to invalidate any entries written before the
// classifier started grounding its output in ShoreZone + ENC substrate data.
// The substrate fingerprint is appended to each entry's key so a change in
// surveyed substrate coverage invalidates stale cached classifications
// without breaking content addressing on the gridHash.
const SESSION_KEY_PREFIX = "bszone2-";
const SESSION_AI_KEY_PREFIX = "bszone2-ai-";
const SUBSTRATE_FP_PREFIX = "bs-subfp-";
const NO_SUBSTRATE_FP = "00000000";

function readKnownSubstrateFp(datasetId: string): string {
  try {
    return sessionStorage.getItem(`${SUBSTRATE_FP_PREFIX}${datasetId}`) ?? NO_SUBSTRATE_FP;
  } catch {
    return NO_SUBSTRATE_FP;
  }
}

function writeKnownSubstrateFp(datasetId: string, fp: string): void {
  try {
    sessionStorage.setItem(`${SUBSTRATE_FP_PREFIX}${datasetId}`, fp);
  } catch {
    // sessionStorage unavailable / quota exceeded
  }
}

function sessionZoneKey(gridHash: string, fp: string): string {
  return `${SESSION_KEY_PREFIX}${gridHash}-${fp}`;
}
function sessionAiKey(gridHash: string, fp: string): string {
  return `${SESSION_AI_KEY_PREFIX}${gridHash}-${fp}`;
}

/**
 * Representative zone index for each texture slot (0–3).
 * When the user paints a slot, the zoneMap pixel is set to this zone index so
 * the shader's zoneToSlot lookup re-derives the same slot consistently.
 */
const SLOT_TO_ZONE_SALTWATER: readonly number[] = [0, 1, 2, 3]; // sandy_shelf, coarse_sediment, silt_plain, basalt_rock
const SLOT_TO_ZONE_FRESHWATER: readonly number[] = [0, 4, 3, 2]; // aquatic_vegetation, gravel_bed, silt_deep, rocky_shoreline

// Module-level single-flight map — keyed by gridHash
const inFlight = new Map<string, Promise<void>>();

function u8Equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface ClassificationState {
  zoneMap: Uint8Array | null;
  /** Unedited AI baseline — preserved so Reset to AI works after painting. */
  aiZoneMap: Uint8Array | null;
  /** True when the current zoneMap contains manual paint edits. */
  hasEdits: boolean;
  loading: boolean;
  error: ClassificationError | null;
  /** Hash of the grid currently being classified (or last successfully classified). */
  currentGridHash: string | null;
  /**
   * Substrate fingerprint reported by the server for the current dataset, used
   * as part of the sessionStorage cache key so a change in surveyed substrate
   * coverage invalidates stale cached classifications. `null` before the first
   * server response.
   */
  currentSubstrateFp: string | null;
  /**
   * Provenance of the current zoneMap.
   *  - "ai":        labels from the Poe AI classifier (live or cached).
   *  - "heuristic": labels estimated from depth percentiles when AI was unavailable.
   *  - null:        no zoneMap loaded yet.
   */
  source: "ai" | "heuristic" | "partial" | null;

  classify: (grid: TerrainData) => Promise<void>;
  clearZoneMap: () => void;
  /**
   * Paint a circular brush of `slot` (0–3) centred at terrain grid cell
   * (row, col) with the given pixel radius. The current waterType determines
   * which representative zone index is stored. Persists to sessionStorage.
   */
  paintSlot: (
    row: number,
    col: number,
    radius: number,
    slot: 0 | 1 | 2 | 3,
    waterType: "saltwater" | "freshwater",
    resolution: number,
  ) => void;
  /** Revert zoneMap to the AI baseline and clear the edited sessionStorage entry. */
  resetToAi: () => void;
}

export const useClassificationStore = create<ClassificationState>((set, get) => ({
  zoneMap: null,
  aiZoneMap: null,
  hasEdits: false,
  loading: false,
  error: null,
  currentGridHash: null,
  currentSubstrateFp: null,
  source: null,

  clearZoneMap: () =>
    set({ zoneMap: null, aiZoneMap: null, hasEdits: false, error: null, currentGridHash: null, currentSubstrateFp: null, source: null }),

  paintSlot: (row, col, radius, slot, waterType, resolution) => {
    const { zoneMap, currentGridHash } = get();
    if (!zoneMap || zoneMap.length !== resolution * resolution) return;

    const slotToZone =
      waterType === "freshwater" ? SLOT_TO_ZONE_FRESHWATER : SLOT_TO_ZONE_SALTWATER;
    const zoneIndex = slotToZone[slot] ?? 0;

    // Copy so the React-attached reference changes (forces TerrainMesh useEffect)
    const next = new Uint8Array(zoneMap);
    const r2 = radius * radius;
    const rMin = Math.max(0, row - radius);
    const rMax = Math.min(resolution - 1, row + radius);
    const cMin = Math.max(0, col - radius);
    const cMax = Math.min(resolution - 1, col + radius);
    let changed = false;
    for (let r = rMin; r <= rMax; r++) {
      const dr = r - row;
      for (let c = cMin; c <= cMax; c++) {
        const dc = c - col;
        if (dr * dr + dc * dc > r2) continue;
        const idx = r * resolution + c;
        if (next[idx] !== zoneIndex) {
          next[idx] = zoneIndex;
          changed = true;
        }
      }
    }
    if (!changed) return;

    if (currentGridHash) {
      try {
        sessionStorage.setItem(
          sessionZoneKey(currentGridHash, get().currentSubstrateFp ?? NO_SUBSTRATE_FP),
          zoneMapToStorage(next),
        );
      } catch {
        // sessionStorage unavailable / quota exceeded — keep in-memory edits anyway
      }
    }
    set({ zoneMap: next, hasEdits: true });
  },

  resetToAi: () => {
    const { aiZoneMap, currentGridHash, currentSubstrateFp } = get();
    if (!aiZoneMap) return;
    const restored = new Uint8Array(aiZoneMap);
    if (currentGridHash) {
      try {
        sessionStorage.setItem(
          sessionZoneKey(currentGridHash, currentSubstrateFp ?? NO_SUBSTRATE_FP),
          zoneMapToStorage(restored),
        );
      } catch {
        // ignore
      }
    }
    set({ zoneMap: restored, hasEdits: false });
  },

  classify: async (grid: TerrainData): Promise<void> => {
    const { datasetId, waterType } = grid;
    const targetN = grid.resolution ?? grid.width ?? 256;
    const wt = waterType as "saltwater" | "freshwater";
    const gridHash = await hashGrid(grid.depths);
    // Substrate fingerprint forms part of every cache key. The first time we
    // see a dataset we use the "no coverage" sentinel; on every successful
    // server response we update the per-dataset fp so subsequent lookups land
    // on the canonical (gridHash, fp) entry. This means a change in surveyed
    // substrate coverage server-side invalidates stale session entries on the
    // next round-trip without requiring a manual clear.
    const knownFp = readKnownSubstrateFp(datasetId);
    const sessionKey = sessionZoneKey(gridHash, knownFp);
    const aiSessionKey = sessionAiKey(gridHash, knownFp);

    // 1. sessionStorage — synchronous, keyed by content hash + substrate fp.
    //    The AI baseline is stored under a separate key so paint edits don't
    //    overwrite it (enables Reset to AI even after reload). Cache hits are
    //    always "ai" — heuristic results are never persisted.
    try {
      const stored = sessionStorage.getItem(sessionKey);
      const storedAi = sessionStorage.getItem(aiSessionKey);
      if (stored) {
        const zoneMap = zoneMapFromStorage(stored);
        const ai = storedAi ? zoneMapFromStorage(storedAi) : new Uint8Array(zoneMap);
        const hasEdits = !!storedAi && !u8Equal(zoneMap, ai);
        set({ zoneMap, aiZoneMap: ai, hasEdits, loading: false, error: null, currentGridHash: gridHash, currentSubstrateFp: knownFp, source: "ai" });
        return Promise.resolve();
      }
    } catch {
      // sessionStorage unavailable
    }

    // 2+3. Async path — deduplicate by gridHash
    const existing = inFlight.get(gridHash);
    if (existing) return existing;

    set({ loading: true, error: null, zoneMap: null, aiZoneMap: null, hasEdits: false, currentGridHash: gridHash, currentSubstrateFp: null, source: null });

    const commitFresh = (zoneMap: Uint8Array, source: ClassifyResultSource, fp: string) => {
      writeKnownSubstrateFp(datasetId, fp);
      // Heuristic results are intentionally NOT persisted to sessionStorage so
      // a later AI success on the same grid can take over without being masked
      // by a stale cache entry.
      if (source === "ai") {
        try {
          const k = sessionZoneKey(gridHash, fp);
          const kAi = sessionAiKey(gridHash, fp);
          sessionStorage.setItem(k, zoneMapToStorage(zoneMap));
          sessionStorage.setItem(kAi, zoneMapToStorage(zoneMap));
        } catch {
          // ignore
        }
      }
      set({
        zoneMap,
        // Preserve aiZoneMap only for true AI results; heuristic shouldn't be
        // treated as the "reset target" since it's a guess, not a baseline.
        aiZoneMap: source === "ai" ? new Uint8Array(zoneMap) : null,
        hasEdits: false,
        loading: false,
        error: null,
        currentSubstrateFp: fp,
        source,
      });
    };

    const work = (async () => {
      try {
        // 2. Server zone cache (memory + disk, keyed by gridHash + fp) — AI-only
        try {
          // Namespace the lookup by waterType — the server keys its zone
          // cache by (gridHash, waterType) so a saltwater entry can never
          // satisfy a freshwater request (and vice versa).
          const url = `/api/datasets/${encodeURIComponent(datasetId)}/zones?h=${gridHash}&w=${encodeURIComponent(wt)}`;
          const resp = await fetch(url, { credentials: "include" });
          if (resp.ok) {
            const data = (await resp.json()) as {
              zones: string[];
              waterType: string;
              source?: ClassifyResultSource;
              substrateFp?: string;
              coarseWidth?: number;
              coarseHeight?: number;
            };
            if (get().currentGridHash !== gridHash) return;
            commitFresh(
              parseAndUpsampleZones(
                data.zones,
                wt,
                targetN,
                data.coarseWidth ?? 32,
                data.coarseHeight ?? 32,
              ),
              data.source ?? "ai",
              data.substrateFp ?? NO_SUBSTRATE_FP,
            );
            return;
          }
        } catch {
          // Server cache miss — fall through to AI
        }

        if (get().currentGridHash !== gridHash) return;

        // 3. Poe AI — include gridHash and a 32×32 depth downsample so the
        // server can fall back to a depth-based heuristic when the AI call
        // fails (missing key, rate-limited, malformed response, …).
        const gridBase64 = gridToBase64Png(grid);
        const depths32 = downsampleDepths32(grid);
        // Send the full-resolution depth grid so the server can split it into
        // overlapping tiles and classify each at native LLM resolution. This is
        // a no-op for small grids (the server's tile planner falls through to
        // the single-tile path when K=1) so legacy clients/datasets behave
        // exactly as before.
        const result = await poeClassify(
          {
            gridBase64,
            waterType: wt,
            datasetId,
            gridHash,
            depths32,
            depthsFull: grid.depths as unknown as number[],
            widthFull: grid.width,
            heightFull: grid.height,
          } as PoeClassifyRequest,
        );

        if (get().currentGridHash !== gridHash) return;
        const resultFp = (result as { substrateFp?: string }).substrateFp ?? NO_SUBSTRATE_FP;
        commitFresh(
          parseAndUpsampleZones(
            result.zones,
            wt,
            targetN,
            result.coarseWidth ?? 32,
            result.coarseHeight ?? 32,
          ),
          result.source ?? "ai",
          resultFp,
        );
      } catch (err) {
        if (get().currentGridHash !== gridHash) return;
        const categorized = categorizeClassificationError(err);
        console.warn("[BathyScan] AI classification failed:", categorized.detail);
        set({ loading: false, error: categorized, zoneMap: null, aiZoneMap: null, hasEdits: false, source: null });
      }
    })();

    inFlight.set(gridHash, work);
    void work.finally(() => inFlight.delete(gridHash));
    return work;
  },
}));
