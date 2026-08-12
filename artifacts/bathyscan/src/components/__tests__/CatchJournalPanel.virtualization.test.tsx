/**
 * CatchJournalPanel — list virtualization guard.
 *
 * Asserts that with 200 mocked catch entries the panel renders substantially
 * fewer than 200 row elements in the initial DOM, proving @tanstack/react-virtual
 * is active and guards against accidental reversion to a full `.map()` render.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCatchJournalStore } from "@/lib/catchJournalStore";
import type { Marker, CatchEntry } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Fixtures — must be hoisted so the vi.mock factory can close over them
// (plain const/let declarations are in TDZ when the hoisted factory runs).
// ---------------------------------------------------------------------------

const { MOCK_ENTRIES } = vi.hoisted(() => {
  const entries: CatchEntry[] = Array.from({ length: 200 }, (_, i) => ({
    id: `catch-${i}`,
    markerId: "marker-1",
    symbol: "🐟",
    symbolName: "Fish",
    notes: null,
    photos: [],
    createdAt: new Date(2026, 0, i + 1).toISOString(),
    updatedAt: new Date(2026, 0, i + 1).toISOString(),
  }));
  return { MOCK_ENTRIES: entries };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", () => ({
  useGetMarkersMarkerIdCatches: (_id: string, _opts: unknown) => ({
    data: MOCK_ENTRIES,
    isLoading: false,
  }),
  getGetMarkersMarkerIdCatchesQueryKey: (id: string) => ["markers", id, "catches"],
  getGetCatchesQueryKey: (p: unknown) => ["catches", p],
  usePostMarkersMarkerIdCatches: () => ({ mutate: vi.fn(), isPending: false }),
  usePatchCatchesId: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCatchesId: () => ({ mutate: vi.fn(), isPending: false }),
  postCatchPhotosUploadUrl: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("@/lib/catchSymbols", () => ({
  searchCatchSymbols: () => [],
  CATCH_SYMBOL_CATEGORIES: [],
}));

// ---------------------------------------------------------------------------
// Marker fixture
// ---------------------------------------------------------------------------

const MOCK_MARKER: Marker = {
  id: "marker-1",
  label: "Test Spot",
  lat: 47.5,
  lon: -122.3,
  depth: 0,
  type: "custom" as Marker["type"],
  datasetId: "ds-1",
  createdAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderPanel() {
  useCatchJournalStore.setState({ marker: MOCK_MARKER });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={qc}>
        <PanelUnderTest />
      </QueryClientProvider>,
    );
  });
  return result;
}

let PanelUnderTest: React.FC;

// ---------------------------------------------------------------------------
// Viewport simulation for @tanstack/react-virtual
//
// jsdom reports offsetHeight/clientHeight = 0 for all elements, so the
// virtualizer calculates a 0-height viewport and renders 0 visible items.
// Giving elements a real height lets the virtualizer compute a visible window.
// ---------------------------------------------------------------------------

let savedOffsetHeight: PropertyDescriptor | undefined;
let savedClientHeight: PropertyDescriptor | undefined;
let savedResizeObserver: unknown;

// Mock `getBoundingClientRect` so that measureElement() returns ITEM_HEIGHT
// instead of 0 (jsdom default). This makes the virtualizer's size estimates
// consistent and gives a predictable row count in tests.
const VIEWPORT_HEIGHT = 600;
const ITEM_HEIGHT = 90; // matches estimateSize in the component

let getBcrSpy: ReturnType<typeof vi.spyOn> | null = null;

function installHeightMock() {
  savedOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  savedClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

  // The scroll container (outer panel div) reports VIEWPORT_HEIGHT so the
  // virtualizer knows the visible window size.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => VIEWPORT_HEIGHT,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => VIEWPORT_HEIGHT,
  });

  // Each virtual row reports ITEM_HEIGHT so measureElement() returns a
  // consistent, non-zero size and getTotalSize() = count * ITEM_HEIGHT.
  getBcrSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    height: ITEM_HEIGHT,
    width: 340,
    top: 0,
    left: 0,
    bottom: ITEM_HEIGHT,
    right: 340,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  savedResizeObserver = (global as Record<string, unknown>)["ResizeObserver"];
  // Override ResizeObserver to fire immediately so the virtualizer's internal
  // state is updated synchronously on observe().
  (global as Record<string, unknown>)["ResizeObserver"] = vi.fn(
    (cb: ResizeObserverCallback) => ({
      observe: (el: Element) => {
        cb(
          [
            {
              target: el,
              contentRect: { width: 340, height: VIEWPORT_HEIGHT },
              borderBoxSize: [{ inlineSize: 340, blockSize: VIEWPORT_HEIGHT }],
              contentBoxSize: [{ inlineSize: 340, blockSize: VIEWPORT_HEIGHT }],
              devicePixelContentBoxSize: [{ inlineSize: 340, blockSize: VIEWPORT_HEIGHT }],
            } as unknown as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
      },
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }),
  );
}

function restoreHeightMock() {
  if (savedOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", savedOffsetHeight);
  }
  if (savedClientHeight) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", savedClientHeight);
  }
  getBcrSpy?.mockRestore();
  getBcrSpy = null;
  (global as Record<string, unknown>)["ResizeObserver"] = savedResizeObserver;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CatchJournalPanel — list virtualization", () => {
  beforeEach(async () => {
    useCatchJournalStore.setState({ marker: null });
    installHeightMock();
    const mod = await import("@/components/CatchJournalPanel");
    PanelUnderTest = mod.CatchJournalPanel;
  });

  afterEach(() => {
    restoreHeightMock();
  });

  it("renders substantially fewer than 200 row elements in the initial DOM", async () => {
    const { container } = await renderPanel();

    // The virtual container must be present — proves the useVirtualizer code
    // path is taken (would be absent if entries were empty or fully .map()'d).
    const virtualWrapper = container.querySelector(
      "[data-testid='catch-entries-virtual-container']",
    );
    expect(virtualWrapper).not.toBeNull();

    // getTotalSize() = count × estimateSize = 200 × 90 = 18 000 px; must be > 0.
    const wrapperHeight = parseInt(
      (virtualWrapper as HTMLElement).style.height || "0",
      10,
    );
    expect(wrapperHeight).toBeGreaterThan(0);

    // Only a viewport-sized window of rows should be in the DOM.
    const rows = container.querySelectorAll("[data-testid^='catch-entry-row-']");
    expect(rows.length).toBeLessThan(30);
  });

  it("never renders all 200 entry cards at once (guards full-map reversion)", async () => {
    const { container } = await renderPanel();

    // With a full .map(), all 200 `[data-testid="catch-entry-catch-N"]` divs appear.
    const allEntryCards = container.querySelectorAll("[data-testid^='catch-entry-catch-']");
    expect(allEntryCards.length).toBeLessThan(200);
  });
});
