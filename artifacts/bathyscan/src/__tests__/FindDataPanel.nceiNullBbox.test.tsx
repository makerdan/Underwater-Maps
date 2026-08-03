/**
 * Regression tests: NceiResultCard renders without crashing when
 * `coverageBbox` is null (or other optional fields are absent).
 *
 * The NCEI API can return results with missing bbox, name, or sourceAgency.
 * Without null guards, accessing `result.coverageBbox.minLon` throws a
 * TypeError that blanks the entire results list, not just the affected card.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { fireEvent, act } from "@testing-library/react";
import React from "react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";

// ---------------------------------------------------------------------------
// Hoisted proxy factory
// ---------------------------------------------------------------------------
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isFetching: false, isLoading: false, isError: false };
  }
  function mutationHook() {
    return {
      mutate: noop,
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      isSuccess: false,
      variables: undefined,
    };
  }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally")
          return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) =>
            `/api/mock/${(a as string[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// ---------------------------------------------------------------------------
// Mutable: individual tests configure what useGetNceiSearch returns.
// ---------------------------------------------------------------------------
let nceiResults: unknown[] = [];

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetNceiSearch: () => ({
      data: nceiResults,
      isFetching: false,
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: 0,
    }),
    useGetDatasetsMySaves: () => ({
      data: [],
      isFetching: false,
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    }),
  }),
);

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setPendingExternalUserDatasetId: vi.fn(),
    setCatalogSourcedAt: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn: true, isLoaded: true }) });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQueries: ({ queries }: { queries: unknown[] }) =>
    queries.map(() => ({ data: undefined, isPending: true, error: null })),
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// NCEI result fixtures
// ---------------------------------------------------------------------------

/** A fully-populated result (positive control). */
const FULL_RESULT = {
  id: "test-ncei-001",
  name: "Test Survey",
  sourceAgency: "NOAA",
  description: "A test survey with all fields.",
  coverageBbox: { minLon: -170, minLat: 20, maxLon: -60, maxLat: 70 },
  wcsAvailable: true,
  resolutionMMin: 10,
  resolutionMMax: 50,
  modified: "2024-05-01T00:00:00Z",
  metadataUrl: "https://example.com/meta",
};

/** Minimal result — coverageBbox, name, sourceAgency all null. */
const NULL_BBOX_RESULT = {
  id: "test-ncei-002",
  name: null,
  sourceAgency: null,
  description: null,
  coverageBbox: null,
  wcsAvailable: false,
  resolutionMMin: null,
  resolutionMMax: null,
  modified: null,
  metadataUrl: null,
};

const onClose = vi.fn();

async function renderOnNceiTab() {
  const result = renderWithProviders(<FindDataPanel onClose={onClose} />);
  // Switch to the NCEI Portal tab and let the useEffect flush.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "NCEI Portal" }));
  });
  return result;
}

beforeEach(() => {
  onClose.mockClear();
  nceiResults = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NceiResultCard — null coverageBbox guard", () => {
  it("renders a result with a full bbox without crashing", async () => {
    nceiResults = [FULL_RESULT];
    await renderOnNceiTab();

    // BboxPreviewMap renders an SVG with aria-label when bbox is present.
    await waitFor(() => {
      expect(screen.getByLabelText("Coverage map")).toBeInTheDocument();
    });
    // "No location data" placeholder must NOT appear for a full result.
    expect(screen.queryByText("No location data")).not.toBeInTheDocument();
  });

  it("renders a null-coverageBbox result without throwing and shows the placeholder", async () => {
    nceiResults = [NULL_BBOX_RESULT];
    await renderOnNceiTab();

    // Must not crash — the panel should still be in the document.
    expect(screen.getByRole("dialog", { name: /find data/i })).toBeInTheDocument();

    // Wait for results to populate via useEffect.
    await waitFor(() => {
      expect(screen.getByText("No location data")).toBeInTheDocument();
    });

    // No SVG coverage map for the null-bbox result.
    expect(screen.queryByLabelText("Coverage map")).not.toBeInTheDocument();
  });

  it("falls back to 'Untitled' when result.name is null", async () => {
    nceiResults = [NULL_BBOX_RESULT];
    await renderOnNceiTab();

    await waitFor(() => {
      expect(screen.getByText("Untitled")).toBeInTheDocument();
    });
  });

  it("falls back to 'Unknown' agency when result.sourceAgency is null", async () => {
    nceiResults = [NULL_BBOX_RESULT];
    await renderOnNceiTab();

    await waitFor(() => {
      expect(screen.getByText(/bathymetry · Unknown/i)).toBeInTheDocument();
    });
  });

  it("does not crash when both a null-bbox and a full-bbox result are rendered together", async () => {
    nceiResults = [FULL_RESULT, NULL_BBOX_RESULT];
    await renderOnNceiTab();

    await waitFor(() => {
      // Full result has a map, null-bbox result shows placeholder.
      expect(screen.getByLabelText("Coverage map")).toBeInTheDocument();
      expect(screen.getByText("No location data")).toBeInTheDocument();
    });
  });
});
