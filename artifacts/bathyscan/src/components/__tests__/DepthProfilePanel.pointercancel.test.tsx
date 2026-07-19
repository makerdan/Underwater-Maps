/**
 * DepthProfilePanel — pointercancel stuck-drag regression tests.
 *
 * Verifies that firing `pointercancel` on the drag handle while a drag is in
 * progress resets `isDragging` to false, so the cursor returns to "grab" and
 * the panel becomes fully interactive again.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDepthProfileStore } from "@/lib/depthProfileStore";

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = { ...actual.DEFAULT_SETTINGS };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState: (patch: Partial<typeof storeState>) => Object.assign(storeState, patch),
      subscribe: () => () => {},
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
    },
  );
  return { ...actual, useSettingsStore };
});

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ datasetId: "test-ds", terrain: null }),
}));

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({ isSignedIn: false }),
}));

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: vi.fn(),
}));

vi.mock("@/lib/blobDownload", () => ({
  triggerBlobDownload: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  usePostMarkers: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  getGetMarkersQueryKey: (p: unknown) => ["markers", p],
  MarkerInputType: { custom: "custom" },
}));

vi.mock("@/components/RoutesPanel", () => ({
  routesQueryKey: (id: string) => ["routes", id],
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

import { DepthProfilePanel } from "@/components/DepthProfilePanel";

function makeProfile() {
  return {
    at: Date.now(),
    mode: "line" as const,
    points: [
      { distanceM: 0,    depthM: 10, slot: null, lon: -122, lat: 47 },
      { distanceM: 100,  depthM: 20, slot: null, lon: -121, lat: 48 },
      { distanceM: 200,  depthM: 15, slot: null, lon: -120, lat: 49 },
    ],
    totalDistanceM: 200,
    minDepthM: 10,
    maxDepthM: 20,
    start: { lon: -122, lat: 47 },
    end:   { lon: -120, lat: 49 },
    waypoints: null,
  };
}

function withQuery(node: React.ReactElement): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, node);
}

/**
 * jsdom does not implement setPointerCapture / releasePointerCapture.
 * Stub them globally so the DepthProfilePanel drag handlers don't throw.
 */
function stubPointerCapture(el: HTMLElement) {
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
}

describe("DepthProfilePanel — drag handle onPointerCancel resets isDragging", () => {
  beforeEach(() => {
    useDepthProfileStore.setState({
      profile: makeProfile() as unknown as import("@/lib/depthProfileStore").DepthProfileResult,
      profiles: [makeProfile() as unknown as import("@/lib/depthProfileStore").DepthProfileResult],
      selectedIndex: 0,
      hoverIndex: null,
    });
  });

  it("panel is visible when a profile is set", () => {
    const { getByTestId } = render(withQuery(<DepthProfilePanel />));
    expect(getByTestId("depth-profile-panel")).toBeInTheDocument();
  });

  it("drag handle shows cursor:grab in resting state", () => {
    const { getByTestId } = render(withQuery(<DepthProfilePanel />));
    const handle = getByTestId("depth-profile-drag-handle");
    expect(handle.style.cursor).toBe("grab");
  });

  it("pointerdown on drag handle sets isDragging (cursor becomes grabbing)", async () => {
    const { getByTestId } = render(withQuery(<DepthProfilePanel />));
    const panel = getByTestId("depth-profile-panel");
    const handle = getByTestId("depth-profile-drag-handle");

    stubPointerCapture(panel as HTMLElement);
    handle.getBoundingClientRect = () =>
      ({ left: 100, top: 200, right: 600, bottom: 250, width: 500, height: 50, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect;

    await act(async () => {
      fireEvent.pointerDown(handle, { clientX: 200, clientY: 220, button: 0, pointerId: 1, pointerType: "mouse" });
    });

    expect(handle.style.cursor).toBe("grabbing");
  });

  it("pointercancel on drag handle resets isDragging (cursor returns to grab)", async () => {
    const { getByTestId } = render(withQuery(<DepthProfilePanel />));
    const panel = getByTestId("depth-profile-panel");
    const handle = getByTestId("depth-profile-drag-handle");

    stubPointerCapture(panel as HTMLElement);
    handle.getBoundingClientRect = () =>
      ({ left: 100, top: 200, right: 600, bottom: 250, width: 500, height: 50, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect;

    // Start drag.
    await act(async () => {
      fireEvent.pointerDown(handle, { clientX: 200, clientY: 220, button: 0, pointerId: 1, pointerType: "mouse" });
    });
    expect(handle.style.cursor).toBe("grabbing");

    // Cancel the pointer (system gesture / palm-rejection).
    await act(async () => {
      fireEvent.pointerCancel(handle, { pointerId: 1 });
    });

    // isDragging must be false — cursor back to "grab".
    expect(handle.style.cursor).toBe("grab");
  });

  it("panel is interactive after pointercancel: a fresh pointerdown starts a new drag", async () => {
    const { getByTestId } = render(withQuery(<DepthProfilePanel />));
    const panel = getByTestId("depth-profile-panel");
    const handle = getByTestId("depth-profile-drag-handle");

    stubPointerCapture(panel as HTMLElement);
    handle.getBoundingClientRect = () =>
      ({ left: 100, top: 200, right: 600, bottom: 250, width: 500, height: 50, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect;

    // First drag — start and cancel.
    await act(async () => {
      fireEvent.pointerDown(handle, { clientX: 200, clientY: 220, button: 0, pointerId: 1, pointerType: "mouse" });
    });
    await act(async () => {
      fireEvent.pointerCancel(handle, { pointerId: 1 });
    });
    expect(handle.style.cursor).toBe("grab");

    // Second drag — should start cleanly.
    await act(async () => {
      fireEvent.pointerDown(handle, { clientX: 300, clientY: 220, button: 0, pointerId: 2, pointerType: "mouse" });
    });
    expect(handle.style.cursor).toBe("grabbing");

    // Clean up.
    await act(async () => {
      fireEvent.pointerUp(handle, { pointerId: 2 });
    });
    expect(handle.style.cursor).toBe("grab");
  });
});
