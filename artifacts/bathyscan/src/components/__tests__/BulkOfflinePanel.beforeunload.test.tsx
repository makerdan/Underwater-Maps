/**
 * BulkOfflinePanel — beforeunload guard tests
 *
 * Confirms that a `beforeunload` handler is registered while the batch phase
 * is "running" and removed for every other phase (idle, paused, done,
 * cancelled, preflight-error).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import { BulkOfflinePanel } from "@/components/BulkOfflinePanel";
import type { UseBulkOfflinePackResult } from "@/hooks/useBulkOfflinePack";

// ── Hoisted mock control ──────────────────────────────────────────────────────

const { mockPhase } = vi.hoisted(() => {
  return { mockPhase: { value: "idle" as UseBulkOfflinePackResult["phase"] } };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/useBulkOfflinePack", () => {
  const makeResult = (): UseBulkOfflinePackResult => ({
    rows: [],
    phase: mockPhase.value,
    preflightError: null,
    quotaWarning: null,
    storageQuota: null,
    forceUpdateIds: new Set(),
    toggleForceUpdate: vi.fn(),
    days: 7,
    setDays: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    refreshQuota: vi.fn().mockResolvedValue(undefined),
  });
  return { useBulkOfflinePack: () => makeResult() };
});

vi.mock("@/lib/offlinePackStore", () => ({
  listOfflinePacks: vi.fn().mockResolvedValue([]),
  deleteOfflinePack: vi.fn().mockResolvedValue(undefined),
  isPackExpired: vi.fn().mockReturnValue(false),
}));

vi.mock("@/hooks/useReturnFocus", () => ({ useReturnFocus: vi.fn() }));

// ── Helpers ───────────────────────────────────────────────────────────────────

const DATASET = { id: "ds-1", name: "Test Dataset" };

function renderPanel() {
  const onClose = vi.fn();
  const utils = render(
    <BulkOfflinePanel datasets={[DATASET]} onClose={onClose} />,
  );
  return { ...utils, onClose };
}

function countBeforeUnloadListeners(): number {
  // Spy on addEventListener/removeEventListener to count active registrations.
  // We track this via the spy captured in beforeEach.
  return addCalls - removeCalls;
}

let addCalls = 0;
let removeCalls = 0;
let origAdd: typeof window.addEventListener;
let origRemove: typeof window.removeEventListener;

beforeEach(() => {
  addCalls = 0;
  removeCalls = 0;
  origAdd = window.addEventListener.bind(window);
  origRemove = window.removeEventListener.bind(window);

  vi.spyOn(window, "addEventListener").mockImplementation(
    (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type === "beforeunload") addCalls++;
      origAdd(type, listener, options);
    },
  );
  vi.spyOn(window, "removeEventListener").mockImplementation(
    (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
      if (type === "beforeunload") removeCalls++;
      origRemove(type, listener, options);
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BulkOfflinePanel — beforeunload guard", () => {
  it("registers the handler when phase is 'running'", () => {
    mockPhase.value = "running";
    const { unmount } = renderPanel();

    expect(addCalls).toBe(1);
    expect(removeCalls).toBe(0);

    unmount();
  });

  it("removes the handler on unmount when phase was 'running'", () => {
    mockPhase.value = "running";
    const { unmount } = renderPanel();

    expect(addCalls).toBe(1);

    act(() => { unmount(); });

    expect(removeCalls).toBe(1);
  });

  it.each([
    "idle",
    "paused",
    "done",
    "cancelled",
    "preflight-error",
  ] as UseBulkOfflinePackResult["phase"][])(
    "does NOT register the handler when phase is '%s'",
    (phase) => {
      mockPhase.value = phase;
      const { unmount } = renderPanel();

      expect(addCalls).toBe(0);

      unmount();
    },
  );

  it("sets returnValue on the beforeunload event with the expected message", () => {
    mockPhase.value = "running";
    renderPanel();

    const event = new Event("beforeunload") as BeforeUnloadEvent;
    Object.defineProperty(event, "returnValue", { writable: true, value: "" });
    const prevented = vi.fn();
    event.preventDefault = prevented;

    window.dispatchEvent(event);

    expect(prevented).toHaveBeenCalled();
    expect((event as BeforeUnloadEvent).returnValue).toBe(
      "A save is in progress — leaving will not cancel saved packs but the batch will stop.",
    );
  });
});
