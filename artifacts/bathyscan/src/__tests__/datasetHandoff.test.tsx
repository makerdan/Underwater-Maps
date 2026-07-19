/**
 * datasetHandoff — out-of-bounds follow-mode dataset suggestion.
 *
 * Covers:
 *  - distanceToBboxKm geometry (inside, outside, latitude correction)
 *  - preset found → "Left dataset area" toast with "Load & follow" action
 *  - toast action click → uiStore.pendingFollowHandoff is set
 *  - already-visible datasets are excluded from preset suggestions
 *  - preset not found but catalog found → "Survey available nearby" toast with
 *    "Download & follow" action
 *  - catalog download happy path: save → polling → ready → acceptFollowHandoff
 *  - catalog download auth failure → "Sign in required" toast
 *  - catalog download materialization failure → "Survey import failed" toast
 *  - nothing found / all errors → plain "Follow mode paused" toast
 *  - concurrent calls are deduped while a search is in flight
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import React from "react";

const toastSpy = vi.hoisted(() => vi.fn());
const getDatasetsMock = vi.hoisted(() => vi.fn());
const authorizedFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
}));

vi.mock("@workspace/api-client-react", () => ({
  getDatasets: (...args: unknown[]) => getDatasetsMock(...args),
}));

vi.mock("@/components/ui/toast", () => ({
  ToastAction: (props: Record<string, unknown>) =>
    React.createElement("button", props),
}));

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: (...args: unknown[]) => authorizedFetchMock(...args),
}));

import {
  distanceToBboxKm,
  findDatasetForPosition,
  findCatalogSurveyForPosition,
  handleFollowOutOfBounds,
  acceptFollowHandoff,
  startCatalogDownloadHandoff,
  __resetHandoffForTests,
} from "@/lib/datasetHandoff";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";

// bbox matches the API shape: { minLon, minLat, maxLon, maxLat }
const DATASETS = [
  { id: "ds-near", name: "Nearby Bay", bbox: { minLon: 142, minLat: 11, maxLon: 143, maxLat: 12 } },
  { id: "ds-far", name: "Farther Shelf", bbox: { minLon: 150, minLat: 20, maxLon: 151, maxLat: 21 } },
];

const CATALOG_RESULT = {
  datasets: [
    { id: "ncei-se-alaska-multibeam", name: "SE Alaska Multibeam Survey" },
  ],
};

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }));
}

function mockAuthorizedFetch(body: unknown, status = 200): void {
  authorizedFetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("distanceToBboxKm", () => {
  it("returns 0 for a point inside the bbox", () => {
    expect(distanceToBboxKm(142.5, 11.5, { minLon: 142, minLat: 11, maxLon: 143, maxLat: 12 })).toBe(0);
  });

  it("returns ~11 km for a point 0.1° of latitude south of the bbox", () => {
    const d = distanceToBboxKm(142.5, 10.9, { minLon: 142, minLat: 11, maxLon: 143, maxLat: 12 });
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(12.5);
  });

  it("shrinks longitude distance at high latitude", () => {
    const equator = distanceToBboxKm(1, 0, { minLon: 0, minLat: -1, maxLon: 0.5, maxLat: 1 });
    const arctic = distanceToBboxKm(1, 70, { minLon: 0, minLat: 69, maxLon: 0.5, maxLat: 71 });
    expect(arctic).toBeLessThan(equator);
  });
});

describe("findCatalogSurveyForPosition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the first catalog result when the point-radius search succeeds", async () => {
    mockFetch(CATALOG_RESULT);
    const result = await findCatalogSurveyForPosition(-132.45, 55.7);
    expect(result).toEqual({
      id: "ncei-se-alaska-multibeam",
      title: "SE Alaska Multibeam Survey",
    });
  });

  it("returns null when the search returns an empty dataset list", async () => {
    mockFetch({ datasets: [] });
    expect(await findCatalogSurveyForPosition(0, 0)).toBeNull();
  });

  it("returns null when the request fails (offline)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed to fetch")));
    expect(await findCatalogSurveyForPosition(0, 0)).toBeNull();
  });

  it("returns null when the server returns a non-ok status", async () => {
    mockFetch({ error: "invalid_param" }, 400);
    expect(await findCatalogSurveyForPosition(0, 0)).toBeNull();
  });
});

describe("startCatalogDownloadHandoff", () => {
  let dismissMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    authorizedFetchMock.mockReset();
    toastSpy.mockReset();
    dismissMock = vi.fn();
    toastSpy.mockReturnValue({ dismiss: dismissMock });
    useUiStore.setState({ pendingFollowHandoff: null });
  });

  it("calls acceptFollowHandoff immediately when save row is already ready", async () => {
    mockAuthorizedFetch({ id: "save-1", status: "ready", datasetId: "ds-custom-abc" });
    await startCatalogDownloadHandoff("ncei-se-alaska", "SE Alaska Survey");
    expect(useUiStore.getState().pendingFollowHandoff).toBe("ds-custom-abc");
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Downloading survey…" }),
    );
    expect(dismissMock).toHaveBeenCalled();
  });

  it("shows 'Sign in required' toast on 401", async () => {
    mockAuthorizedFetch({}, 401);
    await startCatalogDownloadHandoff("ncei-se-alaska", "SE Alaska Survey");
    expect(dismissMock).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Sign in required" }),
    );
    expect(useUiStore.getState().pendingFollowHandoff).toBeNull();
  });

  it("shows 'Survey import failed' toast on non-ok save response", async () => {
    authorizedFetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "internal error" }),
    });
    await startCatalogDownloadHandoff("ncei-se-alaska", "SE Alaska Survey");
    expect(dismissMock).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Survey import failed" }),
    );
  });

  it("polls status and calls acceptFollowHandoff when save becomes ready", async () => {
    vi.useFakeTimers();

    authorizedFetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: "save-1", status: "processing", datasetId: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: "ready", datasetId: "ds-materialized-xyz" }),
      });

    const handoff = startCatalogDownloadHandoff("ncei-se-alaska", "SE Alaska Survey");
    await vi.runAllTimersAsync();
    await handoff;

    expect(authorizedFetchMock).toHaveBeenCalledTimes(2);
    expect(dismissMock).toHaveBeenCalled();
    expect(useUiStore.getState().pendingFollowHandoff).toBe("ds-materialized-xyz");

    vi.useRealTimers();
  });

  it("shows 'Survey import failed' toast when save status becomes failed", async () => {
    vi.useFakeTimers();

    authorizedFetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: "save-1", status: "processing", datasetId: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          status: "failed",
          datasetId: null,
          errorMessage: "No NCEI coverage here",
        }),
      });

    const handoff = startCatalogDownloadHandoff("ncei-se-alaska", "SE Alaska Survey");
    await vi.runAllTimersAsync();
    await handoff;

    expect(dismissMock).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Survey import failed",
        description: "No NCEI coverage here",
      }),
    );
    expect(useUiStore.getState().pendingFollowHandoff).toBeNull();

    vi.useRealTimers();
  });
});

describe("datasetHandoff (preset path)", () => {
  beforeEach(() => {
    toastSpy.mockReset();
    getDatasetsMock.mockReset();
    authorizedFetchMock.mockReset();
    __resetHandoffForTests();
    useTerrainStore.setState({ visibleDatasets: [] });
    useUiStore.setState({ pendingFollowHandoff: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ datasets: [] }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("findDatasetForPosition returns the dataset covering the position", async () => {
    getDatasetsMock.mockResolvedValue(DATASETS);
    const hit = await findDatasetForPosition(142.5, 11.4);
    expect(hit).toEqual({ id: "ds-near", title: "Nearby Bay" });
  });

  it("returns a nearby (within 25 km) dataset when none covers the point", async () => {
    getDatasetsMock.mockResolvedValue(DATASETS);
    const hit = await findDatasetForPosition(142.5, 10.9);
    expect(hit).toEqual({ id: "ds-near", title: "Nearby Bay" });
  });

  it("excludes datasets that are already visible", async () => {
    getDatasetsMock.mockResolvedValue(DATASETS);
    useTerrainStore.setState({
      visibleDatasets: [{ datasetId: "ds-near" } as never],
    });
    const hit = await findDatasetForPosition(142.5, 11.4);
    expect(hit).toBeNull();
  });

  it("returns null when nothing is within the search radius", async () => {
    getDatasetsMock.mockResolvedValue(DATASETS);
    expect(await findDatasetForPosition(-120, -45)).toBeNull();
  });

  it("returns null when the request fails (offline)", async () => {
    getDatasetsMock.mockRejectedValue(new TypeError("failed to fetch"));
    expect(await findDatasetForPosition(142.5, 11.4)).toBeNull();
  });

  it("shows the 'Left dataset area' toast with 'Load & follow' when preset found", async () => {
    getDatasetsMock.mockResolvedValue(DATASETS);
    await handleFollowOutOfBounds(142.5, 11.4);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    const arg = toastSpy.mock.calls[0]![0] as {
      title: string;
      description: string;
      action: React.ReactElement;
    };
    expect(arg.title).toBe("Left dataset area");
    expect(arg.description).toContain("Nearby Bay");
    expect(arg.action).toBeTruthy();

    const actionProps = arg.action.props as { onClick: () => void };
    actionProps.onClick();
    expect(useUiStore.getState().pendingFollowHandoff).toBe("ds-near");
  });

  it("falls back to catalog search when preset finds nothing", async () => {
    getDatasetsMock.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(CATALOG_RESULT),
    }));
    await handleFollowOutOfBounds(0, 0);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    const arg = toastSpy.mock.calls[0]![0] as {
      title: string;
      description: string;
      action: React.ReactElement;
    };
    expect(arg.title).toBe("Survey available nearby");
    expect(arg.description).toContain("SE Alaska Multibeam Survey");
    expect(arg.action).toBeTruthy();
    const actionProps = arg.action.props as { "data-testid": string };
    expect(actionProps["data-testid"]).toBe("follow-handoff-download");
  });

  it("falls back to the plain pause toast when preset AND catalog find nothing", async () => {
    getDatasetsMock.mockResolvedValue([]);
    await handleFollowOutOfBounds(0, 0);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Follow mode paused" }),
    );
  });

  it("falls back to the pause toast when the preset search errors", async () => {
    getDatasetsMock.mockRejectedValue(new Error("500"));
    await handleFollowOutOfBounds(0, 0);

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Follow mode paused" }),
    );
  });

  it("dedupes concurrent out-of-bounds calls while a search is in flight", async () => {
    let resolveQuery!: (v: unknown) => void;
    getDatasetsMock.mockReturnValue(new Promise((r) => (resolveQuery = r)));

    const first = handleFollowOutOfBounds(0, 0);
    const second = handleFollowOutOfBounds(0, 0);
    resolveQuery([]);
    await Promise.all([first, second]);

    expect(getDatasetsMock).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it("acceptFollowHandoff sets pendingFollowHandoff", () => {
    acceptFollowHandoff("ds-x");
    expect(useUiStore.getState().pendingFollowHandoff).toBe("ds-x");
  });
});
