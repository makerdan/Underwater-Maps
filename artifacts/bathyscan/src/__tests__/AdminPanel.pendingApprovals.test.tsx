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
vi.mock("@/components/admin/UserAccessSection", () => ({
  UserAccessSection: () => <div data-testid="user-access-stub" />,
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
  email: string | null;
  displayName: string | null;
  createdAt: string;
}

function makeUser(n: number): TestPendingUser {
  return {
    clerkUserId: `user_pending_${n}`,
    email: `pending${n}@example.com`,
    displayName: `Pending User ${n}`,
    createdAt: new Date().toISOString(),
  };
}

/** Route the authorizedFetch mock by URL. Approve/deny always succeed. */
function mockRoutes(pending: TestPendingUser[]) {
  authorizedFetchMock.mockImplementation(async (...args: unknown[]) => {
    const url = String(args[0]);
    if (url.includes("upscale-cache-stats")) return jsonResponse(200, STATS);
    if (url.includes("/api/admin/users?status=pending")) {
      return jsonResponse(200, { users: pending });
    }
    if (url.includes("/approve") || url.includes("/ban")) {
      return jsonResponse(200, { ok: true });
    }
    return jsonResponse(200, {});
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminPanel — pending approvals badge after batch actions", () => {
  it("shows the pending count badge with the initial number of pending users", async () => {
    mockRoutes([makeUser(1), makeUser(2), makeUser(3)]);
    render(<AdminPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("pending-approvals-count")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("pending-approvals-count")).toHaveTextContent("3");
    expect(screen.getAllByTestId("pending-user-row")).toHaveLength(3);
  });

  it("badge reads zero (is removed) after approving ALL pending users in one session", async () => {
    mockRoutes([makeUser(1), makeUser(2), makeUser(3)]);
    render(<AdminPanel />);

    await waitFor(() =>
      expect(screen.getAllByTestId("pending-user-row")).toHaveLength(3),
    );

    // Approve every user, one at a time, waiting for each row to disappear.
    for (let remaining = 3; remaining > 0; remaining--) {
      const rows = screen.getAllByTestId("pending-user-row");
      expect(rows).toHaveLength(remaining);
      fireEvent.click(within(rows[0]!).getByTestId("approve-user-btn"));
      await waitFor(() =>
        expect(screen.queryAllByTestId("pending-user-row")).toHaveLength(remaining - 1),
      );
    }

    // Badge is gone (not rendered when the list is empty) and the card shows
    // the empty state — never a stale non-zero count.
    expect(screen.queryByTestId("pending-approvals-count")).toBeNull();
    expect(screen.getByText(/no users awaiting approval/i)).toBeInTheDocument();
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
