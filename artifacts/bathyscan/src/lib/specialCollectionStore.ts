/**
 * specialCollectionStore.ts — session state for the currently-active
 * "special" dataset collection (puzzle assembly with a reference image).
 *
 * Flow:
 *  - CollectionsSection calls `activateForPuzzle(collection)`; the store
 *    resolves the collection's special metadata, loads the background image
 *    (authenticated fetch via the generated client), and publishes a
 *    `pendingRestore` payload built from the active layout revision.
 *  - OverviewMap consumes `pendingRestore` in ONE effect: it enters puzzle
 *    mode and commits transforms + groups from the single payload atomically
 *    (see puzzleRestore.buildRestoredPuzzleState).
 *  - The rAF draw loop reads `active` via getState() each frame to draw the
 *    background overlay below dataset heatmaps.
 *
 * All server calls go through the generated plain functions, which attach
 * Clerk auth via customFetch — never raw fetch/<img src> (the background
 * endpoint requires the Authorization header).
 */
import { create } from "zustand";
import {
  getUserCollectionsIdBackground,
  type CollectionGeoAnchor,
  type DatasetCollection,
  type LayoutRevision,
} from "@workspace/api-client-react";
import type { RestorePayload } from "./puzzleRestore";

export interface ActiveSpecialCollection {
  collectionId: string;
  name: string;
  /** Decoded reference image, or null when none uploaded / load failed. */
  bgImage: CanvasImageSource | null;
  bgImageW: number;
  bgImageH: number;
  /** 0–1 */
  bgOpacity: number;
  bgGeoAnchors: CollectionGeoAnchor[] | null;
  layoutRevisions: LayoutRevision[];
  activeRevisionId: string | null;
}

export interface PendingRestore {
  payload: RestorePayload;
  /** Monotonic id so repeated restores of the same revision re-trigger. */
  requestId: number;
}

/**
 * Tracking state for a puzzle layout that has been applied to the 3D scene
 * (Apply-to-3D). `status` is "applied" right after a successful apply and
 * flips to "outdated" when any puzzle transform changes afterwards.
 * `datasetIds` records which datasets received corrections so the badge can
 * hide (and the state clear) once those datasets leave the scene.
 */
export interface GeoLayoutState {
  collectionId: string;
  datasetIds: string[];
  status: "applied" | "outdated";
}

interface SpecialCollectionStore {
  active: ActiveSpecialCollection | null;
  pendingRestore: PendingRestore | null;
  /** Bumped when puzzle mode should turn on even without a revision. */
  pendingPuzzleOn: number;
  /** Non-null while a puzzle layout is applied to the 3D scene. */
  geoLayout: GeoLayoutState | null;
  /** Names of collection members that had no materialized dataset at activation. */
  unresolvedMemberNames: string[];

  /** Activate a special collection for puzzle assembly. */
  activateForPuzzle: (collection: DatasetCollection, unresolvedMemberNames?: string[]) => Promise<void>;
  deactivate: () => void;
  /** Queue a layout-revision restore for OverviewMap to consume. */
  requestRestore: (payload: RestorePayload) => void;
  consumeRestore: () => void;
  /** Metadata updates (settings sheet keeps the live overlay in sync). */
  setBgOpacity: (collectionId: string, opacity: number) => void;
  setBgAnchors: (collectionId: string, anchors: CollectionGeoAnchor[] | null) => void;
  setRevisions: (collectionId: string, revisions: LayoutRevision[], activeRevisionId?: string | null) => void;
  appendRevision: (collectionId: string, revision: LayoutRevision) => void;
  removeRevision: (collectionId: string, revisionId: string) => void;
  /** Reload the background image (after upload/delete in the settings sheet). */
  reloadBgImage: (collectionId: string) => Promise<void>;
  /**
   * Sign-out isolation: drop the active collection (per-account server data,
   * including the decoded background image) and any queued restore so the
   * next account never sees the previous user's puzzle assembly.
   */
  resetForSignOut: () => void;

  /** Record a successful Apply-to-3D (no-op when datasetIds is empty). */
  markGeoLayoutApplied: (collectionId: string, datasetIds: string[]) => void;
  /**
   * Flip an applied layout to "outdated" (puzzle transforms changed after
   * apply). No-op when nothing is applied — safe to call unconditionally.
   */
  markGeoLayoutOutdated: () => void;
  /** Drop the applied-layout tracking (scene cleared / datasets switched). */
  clearGeoLayout: () => void;
}

/** Decode the authed background-image blob into a drawable source. */
async function loadBgImage(
  collectionId: string,
): Promise<{ img: CanvasImageSource; w: number; h: number } | null> {
  try {
    const blob = await getUserCollectionsIdBackground(collectionId);
    if (!(blob instanceof Blob) || blob.size === 0) return null;
    if (typeof createImageBitmap === "function") {
      try {
        const bmp = await createImageBitmap(blob);
        return { img: bmp, w: bmp.width, h: bmp.height };
      } catch {
        // Some otherwise-capable browsers reject specific image decodes via
        // createImageBitmap (notably in constrained/headless renderers).
        // Continue to the HTMLImageElement path below before declaring the
        // saved reference unusable.
      }
    }
    // jsdom / older browsers: HTMLImageElement + object URL.
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const ok = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    // Always release the object URL — the browser has decoded the image data
    // into the HTMLImageElement by this point and no longer needs the blob ref.
    URL.revokeObjectURL(url);
    if (!ok) {
      return null;
    }
    return { img, w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null; // no image uploaded yet, or fetch failed — overlay just stays off
  }
}

function revisionToPayload(rev: LayoutRevision): RestorePayload {
  return {
    tiles: rev.tiles.map((t) => ({
      datasetId: t.datasetId,
      tx: t.tx,
      ty: t.ty,
      angleDeg: t.angleDeg,
      locked: t.locked,
      annotation: t.annotation ?? undefined,
    })),
    groups: rev.groups.map((g) => [...g.datasetIds]),
  };
}

let restoreCounter = 0;

/**
 * Activation generation counter. Incremented on every activation AND on
 * deactivate/resetForSignOut. An in-flight activateForPuzzle() captures the
 * generation before awaiting the authenticated background-image fetch and
 * discards its continuation if the generation has moved on — otherwise a
 * sign-out (or a rapid switch to another collection) during the fetch would
 * let the stale continuation repopulate the previous account's reference
 * image, metadata, and queued layout restore (cross-account disclosure).
 */
let activationGen = 0;

/** Test-only: read the current activation generation. */
export function __getActivationGen(): number {
  return activationGen;
}

export const useSpecialCollectionStore = create<SpecialCollectionStore>((set, get) => ({
  active: null,
  pendingRestore: null,
  pendingPuzzleOn: 0,
  geoLayout: null,
  unresolvedMemberNames: [],

  activateForPuzzle: async (collection, unresolvedMemberNames = []) => {
    const gen = ++activationGen;
    const meta = collection.specialMeta;
    const loaded = meta?.bgImageKey ? await loadBgImage(collection.id) : null;
    // Stale continuation: a sign-out, deactivate, or newer activation happened
    // while the image request was in flight. Drop everything.
    if (gen !== activationGen) return;
    set({ unresolvedMemberNames: [...unresolvedMemberNames] });
    const revisions = meta?.layoutRevisions ?? [];
    const activeRevisionId = meta?.activeRevisionId ?? null;

    set({
      active: {
        collectionId: collection.id,
        name: collection.name,
        bgImage: loaded?.img ?? null,
        bgImageW: loaded?.w ?? 0,
        bgImageH: loaded?.h ?? 0,
        bgOpacity: meta?.bgOpacity ?? 0.5,
        bgGeoAnchors: (meta?.bgGeoAnchors as CollectionGeoAnchor[] | null) ?? null,
        layoutRevisions: revisions,
        activeRevisionId,
      },
    });

    const activeRev =
      revisions.find((r) => r.id === activeRevisionId) ??
      // fall back to most recently saved revision
      [...revisions].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))[0] ??
      null;

    if (activeRev) {
      get().requestRestore(revisionToPayload(activeRev));
    } else {
      set((s) => ({ pendingPuzzleOn: s.pendingPuzzleOn + 1 }));
    }
  },

  deactivate: () => {
    activationGen++; // invalidate any in-flight activation
    set({ active: null, pendingRestore: null, geoLayout: null, unresolvedMemberNames: [] });
  },

  resetForSignOut: () => {
    activationGen++; // invalidate any in-flight activation (sign-out race)
    set({ active: null, pendingRestore: null, pendingPuzzleOn: 0, geoLayout: null, unresolvedMemberNames: [] });
  },

  markGeoLayoutApplied: (collectionId, datasetIds) => {
    if (datasetIds.length === 0) return;
    set({ geoLayout: { collectionId, datasetIds: [...datasetIds], status: "applied" } });
  },

  markGeoLayoutOutdated: () =>
    set((s) =>
      s.geoLayout && s.geoLayout.status === "applied"
        ? { geoLayout: { ...s.geoLayout, status: "outdated" } }
        : {},
    ),

  clearGeoLayout: () => set((s) => (s.geoLayout ? { geoLayout: null } : {})),

  requestRestore: (payload) =>
    set({ pendingRestore: { payload, requestId: ++restoreCounter } }),

  consumeRestore: () => set({ pendingRestore: null }),

  setBgOpacity: (collectionId, opacity) =>
    set((s) =>
      s.active?.collectionId === collectionId
        ? { active: { ...s.active, bgOpacity: opacity } }
        : {},
    ),

  setBgAnchors: (collectionId, anchors) =>
    set((s) =>
      s.active?.collectionId === collectionId
        ? { active: { ...s.active, bgGeoAnchors: anchors } }
        : {},
    ),

  setRevisions: (collectionId, revisions, activeRevisionId) =>
    set((s) =>
      s.active?.collectionId === collectionId
        ? {
            active: {
              ...s.active,
              layoutRevisions: revisions,
              ...(activeRevisionId !== undefined ? { activeRevisionId } : {}),
            },
          }
        : {},
    ),

  appendRevision: (collectionId, revision) =>
    set((s) => {
      if (s.active?.collectionId !== collectionId) return {};
      const others = s.active.layoutRevisions.filter(
        (r) => r.name.toLowerCase() !== revision.name.toLowerCase(),
      );
      return {
        active: {
          ...s.active,
          layoutRevisions: [...others, revision],
          activeRevisionId: revision.id,
        },
      };
    }),

  removeRevision: (collectionId, revisionId) =>
    set((s) =>
      s.active?.collectionId === collectionId
        ? {
            active: {
              ...s.active,
              layoutRevisions: s.active.layoutRevisions.filter((r) => r.id !== revisionId),
              activeRevisionId:
                s.active.activeRevisionId === revisionId ? null : s.active.activeRevisionId,
            },
          }
        : {},
    ),

  reloadBgImage: async (collectionId) => {
    const gen = activationGen;
    const loaded = await loadBgImage(collectionId);
    // Discard if sign-out/deactivate/re-activation happened mid-fetch; the
    // collectionId match below additionally scopes the update to the still-
    // active collection.
    if (gen !== activationGen) return;
    set((s) =>
      s.active?.collectionId === collectionId
        ? {
            active: {
              ...s.active,
              bgImage: loaded?.img ?? null,
              bgImageW: loaded?.w ?? 0,
              bgImageH: loaded?.h ?? 0,
            },
          }
        : {},
    );
  },
}));
