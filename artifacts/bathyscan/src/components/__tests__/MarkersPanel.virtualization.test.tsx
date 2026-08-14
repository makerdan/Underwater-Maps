/**
 * MarkersPanel — list virtualization guard.
 *
 * Asserts that with 200 mocked markers the panel renders substantially
 * fewer than 200 row elements in the initial DOM, proving @tanstack/react-virtual
 * is active and guards against accidental reversion to a full `.map()` render.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Marker } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Fixtures — hoisted so vi.mock() factories can close over them
// ---------------------------------------------------------------------------

const { MOCK_MARKERS } = vi.hoisted(() => {
  const markers: Marker[] = Array.from({ length: 200 }, (_, i) => ({
    id: `marker-${i}`,
    label: `Spot ${i}`,
    lat: 47.5 + i * 0.001,
    lon: -122.3 + i * 0.001,
    depth: i * 0.5,
    type: "custom" as Marker["type"],
    datasetId: null,
    createdAt: new Date(2026, 0, i + 1).toISOString(),
  }));
  return { MOCK_MARKERS: markers };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", () => ({
  useGetMarkers: (_params: unknown, _opts: unknown) => ({
    data: MOCK_MARKERS,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  getGetMarkersQueryKey: (params: unknown) => ["markers", params],
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: null }),
}));

vi.mock("@/lib/uiStore", () => {
  const state = { setMarkersPanelOpen: vi.fn() };
  return {
    useUiStore: Object.assign(
      (sel: (s: typeof state) => unknown) => sel(state),
      { getState: () => state },
    ),
  };
});

vi.mock("@/components/GpsImportDialog", () => ({
  GpsImportDialog: () => null,
}));

vi.mock("@/components/ReassignMarkersDialog", () => ({
  ReassignMarkersDialog: () => null,
}));

// ---------------------------------------------------------------------------
// Viewport simulation for @tanstack/react-virtual
//
// jsdom reports offsetHeight/clientHeight = 0 for all elements, so the
// virtualizer calculates a 0-height viewport and renders 0 visible items.
// Giving elements a real height lets the virtualizer compute a visible window.
// ---------------------------------------------------------------------------

const VIEWPORT_HEIGHT = 600;
const ITEM_HEIGHT = 56; // matches estimateSize in MarkersPanel

let savedOffsetHeight: PropertyDescriptor | undefined;
let savedClientHeight: PropertyDescriptor | undefined;
let savedResizeObserver: unknown;
let getBcrSpy: ReturnType<typeof vi.spyOn> | null = null;

function installHeightMock() {
  savedOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  savedClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

  // The scroll container reports VIEWPORT_HEIGHT so the virtualizer knows
  // the visible window size.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => VIEWPORT_HEIGHT,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => VIEWPORT_HEIGHT,
  });

  // Each virtual row reports ITEM_HEIGHT so measureElement() returns a
  // consistent, non-zero size.
  getBcrSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    height: ITEM_HEIGHT,
    width: 300,
    top: 0,
    left: 0,
    bottom: ITEM_HEIGHT,
    right: 300,
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
              contentRect: { width: 300, height: VIEWPORT_HEIGHT },
              borderBoxSize: [{ inlineSize: 300, blockSize: VIEWPORT_HEIGHT }],
              contentBoxSize: [{ inlineSize: 300, blockSize: VIEWPORT_HEIGHT }],
              devicePixelContentBoxSize: [{ inlineSize: 300, blockSize: VIEWPORT_HEIGHT }],
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
// Helpers
// ---------------------------------------------------------------------------

async function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { MarkersPanel } = await import("@/components/MarkersPanel");
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={qc}>
        <MarkersPanel />
      </QueryClientProvider>,
    );
  });
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MarkersPanel — list virtualization", () => {
  beforeEach(() => {
    installHeightMock();
  });

  afterEach(() => {
    restoreHeightMock();
  });

  it("renders substantially fewer than 200 row elements in the initial DOM", async () => {
    const { container } = await renderPanel();

    // The virtual container must be present — proves the useVirtualizer code
    // path is taken (would be absent if markers were empty or fully .map()'d).
    const virtualWrapper = container.querySelector(
      "[data-testid='markers-virtual-container']",
    );
    expect(virtualWrapper).not.toBeNull();

    // getTotalSize() = count × estimateSize = 200 × 56 = 11 200 px; must be > 0.
    const wrapperHeight = parseInt(
      (virtualWrapper as HTMLElement).style.height || "0",
      10,
    );
    expect(wrapperHeight).toBeGreaterThan(0);

    // Only a viewport-sized window of rows should be in the DOM.
    // (32 rows is typical: ~11 visible at 56px + 5 overscan each side = ~21,
    // but the actual rendered count depends on jsdom height mocking. The key
    // invariant is that it stays far below 200.)
    const rows = container.querySelectorAll("[data-testid^='marker-row-']");
    expect(rows.length).toBeLessThan(40);
  });

  it("never renders all 200 marker rows at once (guards full-map reversion)", async () => {
    const { container } = await renderPanel();

    // With a full .map(), all 200 absolutely-positioned row divs would appear.
    const allRows = container.querySelectorAll("[data-testid^='marker-row-']");
    expect(allRows.length).toBeLessThan(200);
  });
});
