/**
 * AdminPanel — Pending Approvals badge & batch-action tests (Task 4219 / #4190).
 *
 * Verifies that after ALL pending users are approved (or denied) in a single
 * session, the pending-count badge disappears and the card shows the empty
 * state — the admin is never left looking at a stale non-zero badge.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const authorizedFetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>();

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: (...args: unknown[]) => authorizedFetchMock(...args),
}));
vi.mock("@/lib/blobDownload", () => ({ triggerBlobDownload: vi.fn() }));

// Use a vi.fn() so individual tests can swap to a crashing implementation.
const UserAccessSectionImpl = vi.hoisted(() =>
  vi.fn(() => <div data-testid="user-access-stub" />),
);
vi.mock("@/components/admin/UserAccessSection", () => ({
  UserAccessSection: () => UserAccessSectionImpl(),
}));

import { AdminPanel } from "@/components/AdminPanel";

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const STATS = {
  hits: 10,
  misses: 2,
  hitRate: 0.83,
  estimatedCreditsSaved: 40,
  creditsPerCall: 4,
  generatedAt: new Date().toISOString(),
};

interface TestPendingUser {
  clerkUserId: string;
  status: "pending";
  email: string | null;
  displayName: string | null;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

function makeUser(n: number): TestPendingUser {
  return {
    clerkUserId: `user_pending_${n}`,
    status: "pending",
    email: `pending${n}@example.com`,
    displayName: `Pending User ${n}`,
    adminNote: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Route the authorizedFetch mock by URL. Approve/deny always succeed. */
function mockRoutes(pending: TestPendingUser[]) {
  authorizedFetchMock.mockImplementation(async (...args: unknown[]) => {
    const url = String(args[0]);
    if (url.includes("upscale-cache-stats")) return jsonResponse(200, STATS);
    if (url.includes("/api/admin/users/test-notification")) {
      return jsonResponse(200, { sent: true, recipientCount: 1 });
    }
    if (url.includes("/api/admin/users?status=pending")) {
      return jsonResponse(200, { users: pending, nextCursor: null });
    }
    if (url.includes("/api/admin/users/pending-count")) {
      return jsonResponse(200, { count: pending.length });
    }
    if (url.includes("/approve") || url.includes("/ban")) {
      return jsonResponse(200, { ok: true });
    }
    return jsonResponse(200, {});
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default stub in case a test swapped it to a crashing implementation.
  UserAccessSectionImpl.mockImplementation(() => <div data-testid="user-access-stub" />);
});

describe("AdminPanel — pending approvals badge after batch actions", () => {
  it("renders the consolidated user, email, cache, dataset, rate-limit, and skill tools", async () => {
    mockRoutes([]);
    render(<AdminPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("user-access-stub")).toBeInTheDocument(),
    );
    expect(screen.getByText("Email Delivery Verification")).toBeInTheDocument();
    expect(screen.getByText("Upscale Cache")).toBeInTheDocument();
    expect(screen.getByText("Dataset Bucket Status")).toBeInTheDocument();
    expect(screen.getByText("Large Dataset Changes")).toBeInTheDocument();
    expect(screen.getByText("Rate Limit Activity")).toBeInTheDocument();
    expect(screen.getByText("Skill Download")).toBeInTheDocument();
  });

  it("sends an email-delivery verification through the protected admin route", async () => {
    mockRoutes([]);
    render(<AdminPanel />);
    const button = await screen.findByTestId("admin-test-notification");
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId("admin-email-success")).toBeInTheDocument(),
    );
    expect(
      authorizedFetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/api/admin/users/test-notification") &&
          (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(true);
  });

  it("badge reads zero after a mixed approve + deny batch in one session", async () => {
    mockRoutes([makeUser(1), makeUser(2)]);
    render(<AdminPanel />);

    await waitFor(() =>
      expect(screen.getAllByTestId("pending-user-row")).toHaveLength(2),
    );

    // Approve the first user.
    fireEvent.click(
      within(screen.getAllByTestId("pending-user-row")[0]!).getByTestId("approve-user-btn"),
    );
    await waitFor(() =>
      expect(screen.queryAllByTestId("pending-user-row")).toHaveLength(1),
    );

    // Deny the second user.
    fireEvent.click(
      within(screen.getAllByTestId("pending-user-row")[0]!).getByTestId("deny-user-btn"),
    );
    await waitFor(() =>
      expect(screen.queryAllByTestId("pending-user-row")).toHaveLength(0),
    );

    expect(screen.queryByTestId("pending-approvals-count")).toBeNull();
    expect(screen.getByText(/no users awaiting approval/i)).toBeInTheDocument();

    // Both action endpoints were actually hit (deny posts to /ban).
    const calledUrls = authorizedFetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/approve"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/ban"))).toBe(true);
  });
});

describe("AdminPanel — per-card ErrorBoundary regression", () => {
  it("UserAccessSection render error shows per-card fallback without crashing other cards", async () => {
    // Suppress React 19's concurrent-rendering recovery error logs AND the
    // window-level error event that React dispatches even when an ErrorBoundary
    // has caught the original error.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const suppressWindowError = (e: Event) => { e.preventDefault(); };
    window.addEventListener("error", suppressWindowError);

    mockRoutes([]);
    // Use mockImplementation (not Once): React 19 may re-render synchronously
    // after the concurrent attempt, consuming a Once-mock before the
    // ErrorBoundary has committed its fallback.
    UserAccessSectionImpl.mockImplementation(() => {
      throw new Error("simulated UserAccessSection render crash");
    });

    render(<AdminPanel />);

    // Per-card fallback must appear once the admin status resolves.
    await waitFor(() =>
      expect(
        screen.getByText("User access table could not be loaded."),
      ).toBeInTheDocument(),
      { timeout: 3000 },
    );

    // Other cards must still be present.
    expect(screen.getByText("Email Delivery Verification")).toBeInTheDocument();
    expect(screen.getByText("Skill Download")).toBeInTheDocument();

    // Explicitly restore stub; beforeEach also resets it, but be explicit.
    UserAccessSectionImpl.mockImplementation(() => <div data-testid="user-access-stub" />);
    window.removeEventListener("error", suppressWindowError);
    consoleError.mockRestore();
  });
});
