/**
 * Unit tests for resolveDefaultDataset — the pure logic that picks which
 * dataset to auto-select on app start.
 *
 * Each test exercises one of the documented branches in defaultMapLoadLogic.ts
 * without mounting any React components or touching any stores.
 */
import { describe, expect, it } from "vitest";
import {
  resolveDefaultDataset,
  type ResolveDefaultDatasetArgs,
} from "@/lib/defaultMapLoadLogic";

const DS1 = { id: "ds-1", name: "Dataset One" };
const DS2 = { id: "ds-2", name: "Dataset Two" };
const UPLOAD1 = { id: "up-1", name: "My Upload" };

function args(overrides: Partial<ResolveDefaultDatasetArgs>): ResolveDefaultDatasetArgs {
  return {
    datasets: [DS1, DS2],
    defaultMapLoad: null,
    userDatasets: undefined,
    isSignedIn: false,
    urlDatasetId: undefined,
    pendingExternalUserDatasetId: null,
    cameraSpawnBehaviour: "home",
    lastSession: null,
    ...overrides,
  };
}

describe("resolveDefaultDataset", () => {
  it("null preference → first dataset selected", () => {
    const result = resolveDefaultDataset(args({ defaultMapLoad: null }));
    expect(result).toEqual({ type: "switch", datasetId: DS1.id, name: DS1.name });
  });

  it("preset kind, preferred dataset exists → preferred dataset selected", () => {
    const result = resolveDefaultDataset(
      args({ defaultMapLoad: { kind: "preset", id: DS2.id } }),
    );
    expect(result).toEqual({ type: "switch", datasetId: DS2.id, name: DS2.name });
  });

  it("preset kind, preferred dataset deleted → falls back to first available", () => {
    const result = resolveDefaultDataset(
      args({ defaultMapLoad: { kind: "preset", id: "ds-gone" } }),
    );
    expect(result).toEqual({ type: "switch", datasetId: DS1.id, name: DS1.name });
  });

  it("upload kind, upload exists → upload-pending action (no preset loaded yet)", () => {
    const result = resolveDefaultDataset(
      args({
        defaultMapLoad: { kind: "upload", id: UPLOAD1.id },
        userDatasets: [UPLOAD1],
        isSignedIn: true,
        pendingExternalUserDatasetId: null,
      }),
    );
    expect(result).toEqual({ type: "upload-pending", uploadId: UPLOAD1.id });
  });

  it("upload kind, upload deleted → first preset loaded, no pendingExternalUserDatasetId", () => {
    const result = resolveDefaultDataset(
      args({
        defaultMapLoad: { kind: "upload", id: UPLOAD1.id },
        userDatasets: [],
        isSignedIn: true,
      }),
    );
    expect(result.type).toBe("switch");
    if (result.type === "switch") {
      expect(result.datasetId).toBe(DS1.id);
    }
  });

  it("URL datasetId present → url-switch wins regardless of defaultMapLoad preference", () => {
    const result = resolveDefaultDataset(
      args({
        urlDatasetId: DS2.id,
        defaultMapLoad: { kind: "preset", id: DS1.id },
      }),
    );
    expect(result).toEqual({ type: "url-switch", datasetId: DS2.id, name: DS2.name });
  });

  it("URL datasetId + upload preference still loading → wait takes priority over URL", () => {
    // The upload existence check must resolve before we commit to anything,
    // including a URL share link, so the function returns "wait" until
    // userDatasets settles. This matches the original App.tsx behaviour.
    const result = resolveDefaultDataset(
      args({
        urlDatasetId: DS1.id,
        defaultMapLoad: { kind: "upload", id: UPLOAD1.id },
        userDatasets: undefined,
        isSignedIn: true,
      }),
    );
    expect(result).toEqual({ type: "wait" });
  });

  it("upload kind, userDatasets still loading → returns wait", () => {
    const result = resolveDefaultDataset(
      args({
        defaultMapLoad: { kind: "upload", id: UPLOAD1.id },
        userDatasets: undefined,
        isSignedIn: true,
      }),
    );
    expect(result).toEqual({ type: "wait" });
  });

  it("upload kind, not signed in → does not wait, falls back to first preset", () => {
    const result = resolveDefaultDataset(
      args({
        defaultMapLoad: { kind: "upload", id: UPLOAD1.id },
        userDatasets: undefined,
        isSignedIn: false,
      }),
    );
    expect(result).toEqual({ type: "switch", datasetId: DS1.id, name: DS1.name });
  });

  it("URL datasetId not found in datasets list → URL branch skipped, uses preference", () => {
    const result = resolveDefaultDataset(
      args({
        urlDatasetId: "ds-missing",
        defaultMapLoad: { kind: "preset", id: DS2.id },
      }),
    );
    expect(result).toEqual({ type: "switch", datasetId: DS2.id, name: DS2.name });
  });

  it("no datasets available → returns none", () => {
    const result = resolveDefaultDataset(args({ datasets: [] }));
    expect(result).toEqual({ type: "none" });
  });

  it("upload exists but pendingExternalUserDatasetId already set → falls back to first preset", () => {
    const result = resolveDefaultDataset(
      args({
        defaultMapLoad: { kind: "upload", id: UPLOAD1.id },
        userDatasets: [UPLOAD1],
        isSignedIn: true,
        pendingExternalUserDatasetId: UPLOAD1.id,
      }),
    );
    expect(result).toEqual({ type: "switch", datasetId: DS1.id, name: DS1.name });
  });
});
