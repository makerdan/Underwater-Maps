/**
 * AccessGate unit tests + Regression Guard.
 *
 * Covers:
 *   - Approved user: probe resolves 200 → children render, no gate screen
 *     (Regression Guard #1: approved users are never blocked by the gate).
 *   - Pending user: 403 awaiting_approval → awaiting-approval screen with the
 *     user's email, auto-check note, and Sign out button; children never
 *     render.
 *   - Banned user: 403 account_banned → suspended screen; children never
 *     render.
 *   - Network error: error screen with a working Retry button.
 *   - 5xx: error screen.
 *   - Unknown 403 code / 401: fail open (children render).
 *   - Sign out button calls Clerk's signOut().
 *   - No content flash: while the probe is unresolved only the spinner is
 *     shown, and a re-mount while pending still gates without flashing.
 *   - Polling: while an awaiting-approval or suspended screen is showing, the
 *     gate re-probes every PENDING_POLL_INTERVAL_MS and transitions to
 *     "approved" automatically when the server returns 200, without a reload.
 *
 * Regression Guard #2: AdminPanel's status === "forbidden" branch still
 * renders the forbidden card for non-admins, and UserAccessSection is NOT
 * rendered for non-admins (only when status === "ok").
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const signOutMock = vi.fn(async () => undefined);

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({
    user: {
      primaryEmailAddress: { emailAddress: "diver@example.com" },
      fullName: "Test Diver",
    },
    isLoaded: true,
    isSignedIn: true,
  }),
  useClerk: () => ({ signOut: signOutMock }),
}));

const authorizedFetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>();

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: (...args: unknown[]) => authorizedFetchMock(...args),
}));

// Stub getGetSettingsQueryKey so AccessGate can call it without the full
// api-client-react setup (no real fetch, no Orval codegen dependency).
vi.mock("@workspace/api-client-react", () => ({
  getGetSettingsQueryKey: () => ["settings"],
  getAuthToken: async () => null,
}));

// AdminPanel dependencies (for the Regression Guard tests below).
vi.mock("@/lib/blobDownload", () => ({ triggerBlobDownload: vi.fn() }));
vi.mock("@/components/admin/UserAccessSection", () => ({
  UserAccessSection: () => <div data-testid="user-access-stub" />,
}));

import { AccessGate, PENDING_POLL_INTERVAL_MS } from "@/components/AccessGate";
import { AdminPanel } from "@/components/AdminPanel";

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function renderGate() {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AccessGate>
        <div data-testid="app-content">explorer</div>
      </AccessGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // resetAllMocks clears both recorded calls AND stored implementations so
  // a mockResolvedValue() set in one test cannot bleed into the next.
  vi.resetAllMocks();
});

describe("AccessGate — approved user (Regression Guard #1)", () => {
  it("renders children once the probe resolves 200, with no gate screen", async () => {
    authorizedFetchMock.mockResolvedValue(jsonResponse(200, {}));
    renderGate();

    await waitFor(() =>
      expect(screen.getByTestId("app-content")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("access-gate-pending")).toBeNull();
    expect(screen.queryByTestId("access-gate-banned")).toBeNull();
    expect(screen.queryByTestId("access-gate-error")).toBeNull();
    expect(screen.queryByTestId("access-gate-spinner")).toBeNull();
  });

  it("probes an authenticated endpoint exactly once on mount", async () => {
    authorizedFetchMock.mockResolvedValue(jsonResponse(200, {}));
    renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("app-content")).toBeInTheDocument(),
    );
    expect(authorizedFetchMock).toHaveBeenCalledTimes(1);
    expect(String(authorizedFetchMock.mock.calls[0]?.[0])).toContain(
      "/api/settings",
    );
  });

  it("fails open on an unknown 403 error code", async () => {
    authorizedFetchMock.mockResolvedValue(
      jsonResponse(403, { error: "some_other_code" }),
    );
    renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("app-content")).toBeInTheDocument(),
    );
  });

  it("fails open on a 401 (session expiry is handled elsewhere)", async () => {
    authorizedFetchMock.mockResolvedValue(jsonResponse(401, { error: "Unauthorized" }));
    renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("app-content")).toBeInTheDocument(),
    );
  });
});

describe("AccessGate — pending user", () => {
  beforeEach(() => {
    authorizedFetchMock.mockResolvedValue(
      jsonResponse(403, { error: "awaiting_approval", details: "…" }),
    );
  });

  it("shows the awaiting-approval screen with the user's email and never renders children", async () => {
    renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("access-gate-email")).toHaveTextContent(
      "diver@example.com",
    );
    expect(
      screen.getByText(/awaiting admin approval/i),
    ).toBeInTheDocument();
    // Updated copy: automatic polling, no email notification promise.
    expect(screen.getByText(/checks automatically/i)).toBeInTheDocument();
    expect(screen.queryByTestId("app-content")).toBeNull();
  });

  it("Sign out button calls Clerk's signOut()", async () => {
    renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("access-gate-signout"));
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("re-mount while pending still shows the gate without flashing content", async () => {
    const first = renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument(),
    );
    first.unmount();

    // Second mount: before the probe resolves only the spinner is visible.
    renderGate();
    expect(screen.getByTestId("access-gate-spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("app-content")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("app-content")).toBeNull();
  });
});

describe("AccessGate — automatic polling while pending", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Helper: let the initial access probe settle (triggers the mount effect,
   * fires the fetch, and flushes the resulting state update) using fake timers.
   */
  async function drainInitialProbe() {
    // act(async) flushes the microtask queue so the mocked fetch promise and
    // its .json() parse both resolve before we assert.
    await act(async () => {});
  }

  /**
   * Helper: advance fake time by `ms` milliseconds and flush all resulting
   * microtasks so that poll callback + fetch promise + React state update all
   * settle atomically inside a single act() call.
   */
  async function advanceAndFlush(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("re-probes at PENDING_POLL_INTERVAL_MS and lets the user through when 200 is returned, without a page reload", async () => {
    vi.useFakeTimers();

    // First call: pending. Second call (from poll): approved.
    authorizedFetchMock
      .mockResolvedValueOnce(jsonResponse(403, { error: "awaiting_approval" }))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    renderGate();
    await drainInitialProbe();

    expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("app-content")).toBeNull();
    expect(authorizedFetchMock).toHaveBeenCalledTimes(1);

    // Advance the clock exactly one poll interval.
    await advanceAndFlush(PENDING_POLL_INTERVAL_MS);

    // Poll returned 200 → children should now be visible without a page reload.
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
    expect(screen.queryByTestId("access-gate-pending")).toBeNull();
    expect(authorizedFetchMock).toHaveBeenCalledTimes(2);
  });

  it("stays pending when the poll still returns 403 awaiting_approval", async () => {
    vi.useFakeTimers();

    authorizedFetchMock.mockResolvedValue(
      jsonResponse(403, { error: "awaiting_approval" }),
    );

    renderGate();
    await drainInitialProbe();

    expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument();

    // Advance through two full poll cycles.
    await advanceAndFlush(PENDING_POLL_INTERVAL_MS);
    await advanceAndFlush(PENDING_POLL_INTERVAL_MS);

    // Still pending — not approved, not crashed.
    expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("app-content")).toBeNull();
    // Initial probe + 2 poll ticks.
    expect(authorizedFetchMock).toHaveBeenCalledTimes(3);
  });

  it("transitions to banned if the poll returns 403 account_banned", async () => {
    vi.useFakeTimers();

    authorizedFetchMock
      .mockResolvedValueOnce(jsonResponse(403, { error: "awaiting_approval" }))
      .mockResolvedValueOnce(jsonResponse(403, { error: "account_banned" }));

    renderGate();
    await drainInitialProbe();

    expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument();

    await advanceAndFlush(PENDING_POLL_INTERVAL_MS);

    expect(screen.getByTestId("access-gate-banned")).toBeInTheDocument();
    expect(screen.queryByTestId("app-content")).toBeNull();
  });

  it("silently ignores network errors during polling and keeps checking", async () => {
    vi.useFakeTimers();

    authorizedFetchMock
      .mockResolvedValueOnce(jsonResponse(403, { error: "awaiting_approval" }))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    renderGate();
    await drainInitialProbe();

    expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument();

    // First poll tick: network error — pending screen must survive, not crash.
    await advanceAndFlush(PENDING_POLL_INTERVAL_MS);
    expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument();

    // Second poll tick: 200 — transitions to approved.
    await advanceAndFlush(PENDING_POLL_INTERVAL_MS);
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("stops polling after the component unmounts", async () => {
    vi.useFakeTimers();

    authorizedFetchMock.mockResolvedValue(
      jsonResponse(403, { error: "awaiting_approval" }),
    );

    const { unmount } = renderGate();
    await drainInitialProbe();

    expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument();

    const callsAfterMount = authorizedFetchMock.mock.calls.length;

    unmount();

    // Advancing after unmount should produce no additional fetch calls.
    await advanceAndFlush(PENDING_POLL_INTERVAL_MS * 3);

    expect(authorizedFetchMock).toHaveBeenCalledTimes(callsAfterMount);
  });
});

describe("AccessGate — automatic polling while banned", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-probes at PENDING_POLL_INTERVAL_MS and lets a reinstated user through without a page reload", async () => {
    vi.useFakeTimers();

    // First call: banned. Second call (from poll): reinstated/approved.
    authorizedFetchMock
      .mockResolvedValueOnce(jsonResponse(403, { error: "account_banned" }))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    renderGate();
    await act(async () => {});

    expect(screen.getByTestId("access-gate-banned")).toBeInTheDocument();
    expect(screen.queryByTestId("app-content")).toBeNull();
    expect(authorizedFetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(PENDING_POLL_INTERVAL_MS);
    });

    expect(screen.getByTestId("app-content")).toBeInTheDocument();
    expect(screen.queryByTestId("access-gate-banned")).toBeNull();
    expect(authorizedFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("AccessGate — banned user", () => {
  it("shows the suspended screen and never renders children", async () => {
    authorizedFetchMock.mockResolvedValue(
      jsonResponse(403, { error: "account_banned", details: "…" }),
    );
    renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("access-gate-banned")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/account has been suspended\. contact the site admin/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("app-content")).toBeNull();
  });
});

describe("AccessGate — errors and retry", () => {
  it("shows the error screen with Retry on network failure, and Retry re-probes", async () => {
    authorizedFetchMock.mockRejectedValueOnce(new Error("network down"));
    renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("access-gate-error")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("app-content")).toBeNull();

    authorizedFetchMock.mockResolvedValue(jsonResponse(200, {}));
    fireEvent.click(screen.getByTestId("access-gate-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("app-content")).toBeInTheDocument(),
    );
    expect(authorizedFetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the error screen on a 5xx response", async () => {
    authorizedFetchMock.mockResolvedValue(jsonResponse(503, { error: "unavailable" }));
    renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("access-gate-error")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("app-content")).toBeNull();
  });
});

describe("AccessGate — no content flash while checking", () => {
  it("shows only the spinner while the probe is unresolved", () => {
    // A promise that never settles during this test.
    authorizedFetchMock.mockReturnValue(new Promise<Response>(() => {}));
    renderGate();
    expect(screen.getByTestId("access-gate-spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("app-content")).toBeNull();
    expect(screen.queryByTestId("access-gate-pending")).toBeNull();
    expect(screen.queryByTestId("access-gate-banned")).toBeNull();
  });
});

describe("AdminPanel forbidden branch (Regression Guard #2)", () => {
  it("still renders the forbidden card for non-admins and does NOT mount UserAccessSection", async () => {
    authorizedFetchMock.mockResolvedValue(
      jsonResponse(403, { error: "forbidden", details: "Admin access required" }),
    );
    render(<AdminPanel />);
    await waitFor(() =>
      expect(
        screen.getByText(/access restricted to admin users/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("user-access-stub")).toBeNull();
  });

  it("mounts UserAccessSection only when the admin stats fetch succeeds (positive control)", async () => {
    authorizedFetchMock.mockResolvedValue(
      jsonResponse(200, {
        hits: 1,
        misses: 2,
        hitRate: 0.33,
        estimatedCreditsSaved: 10,
        creditsPerCall: 5,
        generatedAt: new Date().toISOString(),
      }),
    );
    render(<AdminPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("user-access-stub")).toBeInTheDocument(),
    );
  });

  it("does not mount UserAccessSection on fetch error", async () => {
    authorizedFetchMock.mockRejectedValue(new Error("boom"));
    render(<AdminPanel />);
    await waitFor(() =>
      expect(
        screen.getByText(/failed to load admin stats/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("user-access-stub")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Denied user — the admin deny action sets status "banned"; requireApproved
// maps it to 403 { error: "account_banned" } (see requireApproved.test.ts).
// A denied user must therefore land on the SAME suspended screen a banned
// user sees — never a blank page and never the app. (Task 4219 / #4193 family)
// ---------------------------------------------------------------------------
describe("AccessGate — denied user (deny action outcome)", () => {
  it("shows the suspended screen after an admin denies the user, never a blank page", async () => {
    authorizedFetchMock.mockResolvedValue(
      jsonResponse(403, { error: "account_banned", details: "denied by admin" }),
    );
    renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("access-gate-banned")).toBeInTheDocument(),
    );
    // The blocked screen has visible copy — not a blank page.
    expect(
      screen.getByText(/account has been suspended\. contact the site admin/i),
    ).toBeInTheDocument();
    // Children (the app) never render for a denied user.
    expect(screen.queryByTestId("app-content")).toBeNull();
  });
});
