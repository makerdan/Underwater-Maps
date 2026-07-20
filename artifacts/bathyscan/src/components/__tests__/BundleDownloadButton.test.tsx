/**
 * Tests for BundleDownloadButton — on-demand bathymetry bundle download UI.
 *
 * Covers:
 * - bundleToTerrainData: happy-path conversion and malformed-payload rejection
 * - idle → click → POST fires; 202 pending response shows queued status
 * - status polling reaching "complete" fetches the bundle and calls onLoaded
 * - status "error" surfaces the server errorMessage with a retry button
 * - POST 200 "complete" (bundle already cached) skips polling and loads directly
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DatasetMeta } from "@workspace/api-client-react";

const { mockMutate, mockGetBundle, statusState, makeApiClientMock } = vi.hoisted(() => {
  function noop() {}
  // NOTE: keep data:undefined — never use data:[] here (useEffect loop hazard).
  function queryHook() { return { data: undefined, isLoading: false, isError: false }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  const factory = (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
  return {
    mockMutate: vi.fn(),
    mockGetBundle: vi.fn(),
    statusState: { data: undefined as unknown },
    makeApiClientMock: factory,
  };
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    usePostTerrainBundles: () => ({ mutate: mockMutate }),
    useGetTerrainBundlesPresetIdStatus: () => ({ data: statusState.data }),
    getTerrainBundlesPresetId: mockGetBundle,
  }),
);

import { BundleDownloadButton, bundleToTerrainData } from "../BundleDownloadButton";

const DS: DatasetMeta = {
  id: "fw-crater-lake-or",
  name: "Crater Lake",
  description: "Deep caldera lake",
  waterType: "freshwater",
  minDepth: 0,
  maxDepth: 594,
  centerLon: -122.1,
  centerLat: 42.94,
  bbox: { minLon: -122.2, minLat: 42.9, maxLon: -122.0, maxLat: 43.0 },
  fetchStrategy: "sciencebase",
};

function makeBundle(overrides: Record<string, unknown> = {}) {
  const n = 2;
  return {
    depths: [1, 2, 3, 4],
    topography: [0, 0, 0, 0],
    hasTopography: false,
    minDepth: 1,
    maxDepth: 4,
    width: n,
    height: n,
    bbox: { minLon: -122.2, minLat: 42.9, maxLon: -122.0, maxLat: 43.0 },
    dataSource: "usgs-3dep",
    label: "USGS ScienceBase",
    creditUrl: "https://sciencebase.gov",
    ...overrides,
  };
}

describe("bundleToTerrainData", () => {
  it("converts a valid bundle into TerrainData", () => {
    const t = bundleToTerrainData(makeBundle(), DS);
    expect(t.datasetId).toBe(DS.id);
    expect(t.name).toBe(DS.name);
    expect(t.waterType).toBe("freshwater");
    expect(t.resolution).toBe(2);
    expect(t.depths).toEqual([1, 2, 3, 4]);
    expect(t.minLon).toBe(-122.2);
    expect(t.maxLat).toBe(43.0);
    expect(t.centerLon).toBeCloseTo(-122.1);
    expect(t.dataSource).toBe("usgs-3dep");
    expect(t.bathymetrySourceLabel).toBe("USGS ScienceBase");
    expect(t.hasTopography).toBe(false);
    expect(t.topography).toBeUndefined();
  });

  it("includes topography when hasTopography is true", () => {
    const t = bundleToTerrainData(makeBundle({ hasTopography: true, topography: [0, 1, 0, 2] }), DS);
    expect(t.hasTopography).toBe(true);
    expect(t.topography).toEqual([0, 1, 0, 2]);
  });

  it("throws on missing depths", () => {
    expect(() => bundleToTerrainData(makeBundle({ depths: undefined }), DS)).toThrow(/malformed/);
  });

  it("throws when depths length does not match width*height", () => {
    expect(() => bundleToTerrainData(makeBundle({ depths: [1, 2, 3] }), DS)).toThrow(/malformed/);
  });

  it("throws on missing bbox", () => {
    expect(() => bundleToTerrainData(makeBundle({ bbox: undefined }), DS)).toThrow(/malformed/);
  });
});

describe("BundleDownloadButton", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockGetBundle.mockReset();
    statusState.data = undefined;
  });

  it("renders the download button and triggers POST on click", async () => {
    const user = userEvent.setup();
    render(<BundleDownloadButton dataset={DS} onLoaded={vi.fn()} />);
    const btn = screen.getByTestId(`btn-download-bundle-${DS.id}`);
    expect(btn).toHaveTextContent(/Download bathymetry/i);
    await user.click(btn);
    expect(mockMutate).toHaveBeenCalledWith(
      { data: { presetId: DS.id } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("shows queued status after a 202 pending response, then loads on complete", async () => {
    const user = userEvent.setup();
    const onLoaded = vi.fn();
    mockGetBundle.mockResolvedValue(makeBundle());
    mockMutate.mockImplementation((_vars, opts) => {
      opts.onSuccess({ jobId: "j1", status: "pending", message: "Download started" });
    });

    const { rerender } = render(<BundleDownloadButton dataset={DS} onLoaded={onLoaded} />);
    await user.click(screen.getByTestId(`btn-download-bundle-${DS.id}`));

    expect(screen.getByTestId(`bundle-status-${DS.id}`)).toHaveTextContent(/Queued/i);

    // Poll reports running with a progress note.
    statusState.data = { jobId: "j1", status: "running", progressNote: "Fetching bathymetry data…" };
    rerender(<BundleDownloadButton dataset={DS} onLoaded={onLoaded} />);
    await waitFor(() =>
      expect(screen.getByTestId(`bundle-status-${DS.id}`)).toHaveTextContent(/Fetching bathymetry/i),
    );

    // Poll reports complete → bundle fetch + onLoaded.
    statusState.data = { jobId: "j1", status: "complete", progressNote: "Done" };
    rerender(<BundleDownloadButton dataset={DS} onLoaded={onLoaded} />);
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
    expect(mockGetBundle).toHaveBeenCalledWith(DS.id);
    const [dsArg, terrainArg] = onLoaded.mock.calls[0]!;
    expect(dsArg.id).toBe(DS.id);
    expect(terrainArg.datasetId).toBe(DS.id);
    expect(screen.getByTestId(`bundle-complete-${DS.id}`)).toBeInTheDocument();
  });

  it("surfaces a job error with retry button", async () => {
    const user = userEvent.setup();
    mockMutate.mockImplementation((_vars, opts) => {
      opts.onSuccess({ jobId: "j1", status: "pending", message: "Download started" });
    });
    const { rerender } = render(<BundleDownloadButton dataset={DS} onLoaded={vi.fn()} />);
    await user.click(screen.getByTestId(`btn-download-bundle-${DS.id}`));

    statusState.data = { jobId: "j1", status: "error", errorMessage: "Upstream WCS timed out" };
    rerender(<BundleDownloadButton dataset={DS} onLoaded={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId(`bundle-error-${DS.id}`)).toHaveTextContent("Upstream WCS timed out"),
    );
    expect(screen.getByTestId(`btn-download-bundle-${DS.id}`)).toHaveTextContent(/Retry download/i);
  });

  it("loads directly when POST reports the bundle already complete", async () => {
    const user = userEvent.setup();
    const onLoaded = vi.fn();
    mockGetBundle.mockResolvedValue(makeBundle());
    mockMutate.mockImplementation((_vars, opts) => {
      opts.onSuccess({ jobId: "j1", status: "complete", message: "Bundle already available" });
    });
    render(<BundleDownloadButton dataset={DS} onLoaded={onLoaded} />);
    await user.click(screen.getByTestId(`btn-download-bundle-${DS.id}`));
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId(`bundle-complete-${DS.id}`)).toBeInTheDocument();
  });

  it("shows a malformed-bundle error when the downloaded payload is invalid", async () => {
    const user = userEvent.setup();
    const onLoaded = vi.fn();
    mockGetBundle.mockResolvedValue({ nope: true });
    mockMutate.mockImplementation((_vars, opts) => {
      opts.onSuccess({ jobId: "j1", status: "complete", message: "Bundle already available" });
    });
    render(<BundleDownloadButton dataset={DS} onLoaded={onLoaded} />);
    await user.click(screen.getByTestId(`btn-download-bundle-${DS.id}`));
    await waitFor(() =>
      expect(screen.getByTestId(`bundle-error-${DS.id}`)).toHaveTextContent(/malformed/i),
    );
    expect(onLoaded).not.toHaveBeenCalled();
    await act(async () => {});
  });
});
