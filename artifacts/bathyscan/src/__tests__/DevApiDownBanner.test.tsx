/**
 * DevApiDownBanner.test.tsx
 *
 * Regression tests for the dev-only "API server down" warning banner:
 *
 *  1. Appears when the health-poll connectivity state reports the API
 *     unreachable, and auto-dismisses when the health poll succeeds again.
 *  2. Driven by health-poll state, NOT a single query failure — a generic
 *     failed fetch (with a healthy health check) does not show the banner.
 *  3. Restart button calls the Vite dev-server restart endpoint, shows the
 *     restarting state, and the banner clears after recovery is signaled.
 *  4. Dev-only gating: the component renders nothing when not in dev mode.
 *
 * queryClient.ts has module-level mutable state, so each test obtains a
 * fresh module registry via vi.resetModules() + dynamic import (the same
 * pattern as queryClient.reconnect.test.ts). The banner component is
 * imported from the same registry so both share connectivity state.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
}));

async function freshModules() {
  vi.resetModules();
  vi.mock("@/hooks/use-toast", () => ({
    toast: vi.fn(),
    useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
  }));
  const qc = await import("@/lib/queryClient");
  const banner = await import("@/components/DevApiDownBanner");
  return { ...qc, ...banner };
}

function makeFetchResponse(ok: boolean, status = ok ? 200 : 502): Response {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("DevApiDownBanner — visibility driven by health-poll state", () => {
  it("appears when the API is reported unreachable and auto-dismisses on recovery", async () => {
    vi.useFakeTimers();
    // Health probe: first attempt fails, second succeeds.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse(false))
      .mockResolvedValue(makeFetchResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const { DevApiDownBanner, markServerUnreachable } = await freshModules();
    render(<DevApiDownBanner />);

    expect(screen.queryByTestId("dev-api-down-banner")).toBeNull();

    act(() => {
      markServerUnreachable();
    });
    expect(screen.getByTestId("dev-api-down-banner")).toBeInTheDocument();
    expect(
      screen.getByText(/API server is unreachable/i),
    ).toBeInTheDocument();

    // Probe #1 fails at 1 s, probe #2 succeeds 2 s later → banner clears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByTestId("dev-api-down-banner")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.queryByTestId("dev-api-down-banner")).toBeNull();
  });

  it("does NOT appear for a single non-network query failure", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(true)));

    const { DevApiDownBanner, queryClient } = await freshModules();
    render(<DevApiDownBanner />);

    // A generic query error (e.g. HTTP 500 mapped to Error) goes through the
    // toast path, not the connectivity path — banner must stay hidden.
    const onError = queryClient.getQueryCache().config.onError;
    act(() => {
      onError?.(new Error("boom"), {} as Parameters<NonNullable<typeof onError>>[1]);
      onError?.({ status: 404 } as unknown as Error, {} as Parameters<NonNullable<typeof onError>>[1]);
    });

    expect(screen.queryByTestId("dev-api-down-banner")).toBeNull();
  });
});

describe("DevApiDownBanner — restart button", () => {
  it("posts to the restart endpoint, shows the restarting state, and clears on recovery", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, status: 202, json: async () => ({ status: "restarting" }) } as unknown as Response;
      }
      // Health probes succeed only after the restart was requested.
      return makeFetchResponse(fetchMock.mock.calls.some(([, i]) => i?.method === "POST"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { DevApiDownBanner, markServerUnreachable, RESTART_API_ENDPOINT } =
      await freshModules();
    render(<DevApiDownBanner />);

    act(() => {
      markServerUnreachable();
    });
    const button = screen.getByTestId("button-restart-api-server");
    expect(button).toHaveTextContent("Restart API Server");

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    const postCalls = fetchMock.mock.calls.filter(([, i]) => i?.method === "POST");
    expect(postCalls).toHaveLength(1);
    expect(String(postCalls[0]?.[0])).toBe(RESTART_API_ENDPOINT);
    expect(screen.getByTestId("button-restart-api-server")).toHaveTextContent(
      "Restarting…",
    );
    expect(screen.getByText(/waiting for it to come back/i)).toBeInTheDocument();

    // Health poll succeeds → banner (and restarting state) clear.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.queryByTestId("dev-api-down-banner")).toBeNull();
  });

  it("surfaces an error and re-enables the button when the restart request fails", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: false, status: 500 } as unknown as Response;
      }
      return makeFetchResponse(false); // still down
    });
    vi.stubGlobal("fetch", fetchMock);

    const { DevApiDownBanner, markServerUnreachable } = await freshModules();
    render(<DevApiDownBanner />);

    act(() => {
      markServerUnreachable();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-restart-api-server"));
      await Promise.resolve();
    });

    expect(screen.getByText(/Restart request failed/i)).toBeInTheDocument();
    expect(screen.getByTestId("button-restart-api-server")).not.toBeDisabled();
  });
});

describe("DevApiDownBanner — dev-only gating", () => {
  it("renders nothing when import.meta.env.DEV is false, even while unreachable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(false)));
    vi.stubEnv("DEV", false);

    const { DevApiDownBanner, markServerUnreachable } = await freshModules();
    const { container } = render(<DevApiDownBanner />);

    act(() => {
      markServerUnreachable();
    });

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("dev-api-down-banner")).toBeNull();
  });
});
