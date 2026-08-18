/**
 * UserAccessSection unit tests.
 *
 * Mocks `@workspace/api-client-react` at the fetcher level (the only imports
 * `@/lib/adminUsers` takes from it) and runs the REAL React Query hooks with
 * a fresh QueryClient per test, so cache patching, tab refetches, and
 * concurrency behaviour are genuinely exercised.
 *
 * Covers (task steps 7 & 8):
 *   - list loads and renders rows (name, email, badge)
 *   - Pending tab is the default (list is fetched with status=pending)
 *   - Approve fires the mutation and the row/count update
 *   - Ban shows a confirmation (with note input) before firing
 *   - Delete requires confirmation before firing
 *   - Restore fires the mutation
 *   - empty-pending state / error card with retry / loading skeletons
 *   - Load more appends the next keyset page
 *   - double-clicking Approve fires exactly one mutation
 *   - buttons are disabled while a row's mutation is in flight
 *   - rapid tab switching never shows stale rows from the previous tab
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  adminListUsers: vi.fn(),
  adminApproveUser: vi.fn(),
  adminBanUser: vi.fn(),
  adminRestoreUser: vi.fn(),
  adminDeleteUser: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => api);

import { UserAccessSection } from "@/components/admin/UserAccessSection";
import type { AdminUserRecord } from "@/lib/adminUsers";

// ---------------------------------------------------------------------------
// Fixtures + in-memory "server"
// ---------------------------------------------------------------------------

function makeUser(
  id: string,
  status: AdminUserRecord["status"],
  overrides: Partial<AdminUserRecord> = {},
): AdminUserRecord {
  return {
    clerkUserId: id,
    status,
    email: `${id}@example.com`,
    displayName: `User ${id}`,
    adminNote: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

let serverUsers: AdminUserRecord[];

/** Keyset-paginated list implementation mirroring the real route. */
function listImpl(params?: {
  status?: AdminUserRecord["status"];
  cursor?: string;
  limit?: number;
}): Promise<{ users: AdminUserRecord[]; nextCursor: string | null }> {
  let rows = [...serverUsers].sort((a, b) =>
    a.clerkUserId.localeCompare(b.clerkUserId),
  );
  if (params?.status) rows = rows.filter((u) => u.status === params.status);
  if (params?.cursor) rows = rows.filter((u) => u.clerkUserId > params.cursor!);
  const limit = params?.limit ?? 50;
  const page = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit ? page[page.length - 1]!.clerkUserId : null;
  return Promise.resolve({ users: page, nextCursor });
}

function setStatusImpl(status: AdminUserRecord["status"]) {
  return (clerkUserId: string, body?: { note?: string }) => {
    const u = serverUsers.find((x) => x.clerkUserId === clerkUserId);
    if (!u) return Promise.reject(new Error("not_found"));
    u.status = status;
    if (body?.note !== undefined) u.adminNote = body.note;
    return Promise.resolve({ user: { ...u } });
  };
}

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <UserAccessSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serverUsers = [
    makeUser("user_1", "pending"),
    makeUser("user_2", "pending"),
    makeUser("user_3", "approved"),
    makeUser("user_4", "banned"),
  ];
  api.adminListUsers.mockImplementation(listImpl);
  api.adminApproveUser.mockImplementation(setStatusImpl("approved"));
  api.adminBanUser.mockImplementation(setStatusImpl("banned"));
  api.adminRestoreUser.mockImplementation(setStatusImpl("approved"));
  api.adminDeleteUser.mockImplementation((clerkUserId: string) => {
    serverUsers = serverUsers.filter((u) => u.clerkUserId !== clerkUserId);
    return Promise.resolve({ deleted: true as const, clerkUserId });
  });
});

// ---------------------------------------------------------------------------
// List rendering, default tab, states
// ---------------------------------------------------------------------------

describe("UserAccessSection — list and default tab", () => {
  it("defaults to the Pending tab and renders only pending rows", async () => {
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId("ua-row-user_1")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("ua-row-user_2")).toBeInTheDocument();
    expect(screen.queryByTestId("ua-row-user_3")).toBeNull();
    expect(screen.queryByTestId("ua-row-user_4")).toBeNull();
    expect(api.adminListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
      expect.anything(),
    );
  });

  it("renders display name, email, status badge, and joined date", async () => {
    renderSection();
    const row = await screen.findByTestId("ua-row-user_1");
    expect(row).toHaveTextContent("User user_1");
    expect(row).toHaveTextContent("user_1@example.com");
    expect(row).toHaveTextContent(/pending/i);
    expect(row).toHaveTextContent("2026");
  });

  it("shows skeleton rows while the list is loading", () => {
    api.adminListUsers.mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(screen.getByTestId("ua-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("ua-empty")).toBeNull();
  });

  it("shows the empty state when the active status has no users", async () => {
    serverUsers = serverUsers.filter((u) => u.status !== "pending");
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId("ua-empty")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("ua-empty")).toHaveTextContent(
      /no users in this status/i,
    );
  });

  it("shows an error card with a working Retry on fetch failure", async () => {
    api.adminListUsers.mockRejectedValueOnce(new Error("network down"));
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId("ua-error")).toBeInTheDocument(),
    );
    // Mock impl (listImpl) is still in place for the retry call.
    fireEvent.click(screen.getByTestId("ua-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("ua-row-user_1")).toBeInTheDocument(),
    );
  });

  it("Load more appends the next keyset page", async () => {
    api.adminListUsers.mockImplementation(
      (params?: { status?: AdminUserRecord["status"]; cursor?: string }) => {
        if (!params?.cursor) {
          return Promise.resolve({
            users: [makeUser("user_1", "pending")],
            nextCursor: "user_1",
          });
        }
        return Promise.resolve({
          users: [makeUser("user_2", "pending")],
          nextCursor: null,
        });
      },
    );
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId("ua-load-more")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("ua-row-user_2")).toBeNull();
    fireEvent.click(screen.getByTestId("ua-load-more"));
    await waitFor(() =>
      expect(screen.getByTestId("ua-row-user_2")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("ua-row-user_1")).toBeInTheDocument();
    expect(screen.queryByTestId("ua-load-more")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

describe("UserAccessSection — actions", () => {
  it("Approve fires the mutation and the row leaves the Pending tab; the count badge updates", async () => {
    renderSection();
    await screen.findByTestId("ua-row-user_1");
    expect(screen.getByTestId("ua-tab-count")).toHaveTextContent("2");

    fireEvent.click(screen.getByTestId("ua-approve-user_1"));
    await waitFor(() =>
      expect(api.adminApproveUser).toHaveBeenCalledWith("user_1"),
    );
    // Row is removed from the pending list (cache patch + refetch reconcile).
    await waitFor(() =>
      expect(screen.queryByTestId("ua-row-user_1")).toBeNull(),
    );
    expect(screen.getByTestId("ua-row-user_2")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("ua-tab-count")).toHaveTextContent("1"),
    );
  });

  it("Ban shows an inline confirmation with a note input before firing", async () => {
    renderSection();
    await screen.findByTestId("ua-row-user_1");
    fireEvent.click(screen.getByTestId("ua-tab-approved"));
    await screen.findByTestId("ua-row-user_3");

    fireEvent.click(screen.getByTestId("ua-ban-user_3"));
    expect(screen.getByTestId("ua-confirm-ban-user_3")).toBeInTheDocument();
    expect(api.adminBanUser).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("ua-ban-note-user_3"), {
      target: { value: "spamming uploads" },
    });
    fireEvent.click(screen.getByTestId("ua-confirm-ban-fire-user_3"));
    await waitFor(() =>
      expect(api.adminBanUser).toHaveBeenCalledWith("user_3", {
        note: "spamming uploads",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("ua-row-user_3")).toBeNull(),
    );
  });

  it("Ban confirmation can be cancelled without firing", async () => {
    renderSection();
    await screen.findByTestId("ua-row-user_1");
    fireEvent.click(screen.getByTestId("ua-tab-approved"));
    await screen.findByTestId("ua-row-user_3");

    fireEvent.click(screen.getByTestId("ua-ban-user_3"));
    fireEvent.click(screen.getByTestId("ua-cancel-confirm-user_3"));
    expect(screen.queryByTestId("ua-confirm-ban-user_3")).toBeNull();
    expect(api.adminBanUser).not.toHaveBeenCalled();
    expect(screen.getByTestId("ua-row-user_3")).toBeInTheDocument();
  });

  it("Delete requires an inline confirmation before firing", async () => {
    renderSection();
    await screen.findByTestId("ua-row-user_1");

    fireEvent.click(screen.getByTestId("ua-delete-user_1"));
    expect(screen.getByTestId("ua-confirm-delete-user_1")).toBeInTheDocument();
    expect(api.adminDeleteUser).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("ua-confirm-delete-fire-user_1"));
    await waitFor(() =>
      expect(api.adminDeleteUser).toHaveBeenCalledWith("user_1"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("ua-row-user_1")).toBeNull(),
    );
  });

  it("Restore fires the mutation from the Banned tab", async () => {
    renderSection();
    await screen.findByTestId("ua-row-user_1");
    fireEvent.click(screen.getByTestId("ua-tab-banned"));
    await screen.findByTestId("ua-row-user_4");

    fireEvent.click(screen.getByTestId("ua-restore-user_4"));
    await waitFor(() =>
      expect(api.adminRestoreUser).toHaveBeenCalledWith("user_4"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("ua-row-user_4")).toBeNull(),
    );
  });

  it("shows an inline action error when a mutation fails, and keeps the row", async () => {
    api.adminApproveUser.mockRejectedValue(new Error("HTTP 500 boom"));
    renderSection();
    await screen.findByTestId("ua-row-user_1");
    fireEvent.click(screen.getByTestId("ua-approve-user_1"));
    await waitFor(() =>
      expect(screen.getByTestId("ua-action-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("ua-row-user_1")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Timing & concurrency
// ---------------------------------------------------------------------------

describe("UserAccessSection — timing and concurrency", () => {
  it("double-clicking Approve fires exactly one mutation", async () => {
    let release!: (v: { user: AdminUserRecord }) => void;
    api.adminApproveUser.mockImplementation(
      () =>
        new Promise<{ user: AdminUserRecord }>((resolve) => {
          release = resolve;
        }),
    );
    renderSection();
    await screen.findByTestId("ua-row-user_1");

    const btn = screen.getByTestId("ua-approve-user_1");
    fireEvent.click(btn);
    fireEvent.click(btn);
    // React Query invokes the mutationFn on a microtask; wait for the first
    // call, then verify the second click never produced another one.
    await waitFor(() => expect(api.adminApproveUser).toHaveBeenCalledTimes(1));

    await act(async () => {
      // Reflect the approval on the simulated server before releasing so the
      // post-mutation invalidation refetch reconciles with the new status.
      serverUsers.find((u) => u.clerkUserId === "user_1")!.status = "approved";
      release({ user: makeUser("user_1", "approved") });
    });
    await waitFor(() =>
      expect(screen.queryByTestId("ua-row-user_1")).toBeNull(),
    );
    expect(api.adminApproveUser).toHaveBeenCalledTimes(1);
  });

  it("disables the row's buttons while a mutation is in flight", async () => {
    let release!: (v: { user: AdminUserRecord }) => void;
    api.adminApproveUser.mockImplementation(
      () =>
        new Promise<{ user: AdminUserRecord }>((resolve) => {
          release = resolve;
        }),
    );
    renderSection();
    await screen.findByTestId("ua-row-user_1");

    fireEvent.click(screen.getByTestId("ua-approve-user_1"));
    await waitFor(() =>
      expect(screen.getByTestId("ua-approve-user_1")).toBeDisabled(),
    );
    expect(screen.getByTestId("ua-delete-user_1")).toBeDisabled();
    // Other rows stay enabled.
    expect(screen.getByTestId("ua-approve-user_2")).not.toBeDisabled();

    await act(async () => {
      // Keep the simulated server consistent so the invalidation refetch
      // doesn't resurrect the row after the cache patch removes it.
      serverUsers.find((u) => u.clerkUserId === "user_1")!.status = "approved";
      release({ user: makeUser("user_1", "approved") });
    });
    await waitFor(() =>
      expect(screen.queryByTestId("ua-row-user_1")).toBeNull(),
    );
  });

  it("rapid tab switching never shows stale rows from the previous tab", async () => {
    // Approved-tab fetches hang until released; pending resolves instantly.
    let releaseApproved!: (v: {
      users: AdminUserRecord[];
      nextCursor: string | null;
    }) => void;
    api.adminListUsers.mockImplementation(
      (params?: { status?: AdminUserRecord["status"] }) => {
        if (params?.status === "approved") {
          return new Promise<{ users: AdminUserRecord[]; nextCursor: string | null }>(
            (resolve) => {
              releaseApproved = resolve;
            },
          );
        }
        return listImpl(params);
      },
    );
    renderSection();
    await screen.findByTestId("ua-row-user_1");

    // Switch to the slow Approved tab: skeleton, never the pending rows.
    fireEvent.click(screen.getByTestId("ua-tab-approved"));
    expect(screen.getByTestId("ua-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("ua-row-user_1")).toBeNull();
    expect(screen.queryByTestId("ua-row-user_2")).toBeNull();

    // Resolve the approved fetch: only approved rows appear.
    await act(async () => {
      releaseApproved({
        users: [makeUser("user_3", "approved")],
        nextCursor: null,
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("ua-row-user_3")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("ua-row-user_1")).toBeNull();

    // Bounce back to Pending: pending rows only, no approved leftovers.
    fireEvent.click(screen.getByTestId("ua-tab-pending"));
    await waitFor(() =>
      expect(screen.getByTestId("ua-row-user_1")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("ua-row-user_3")).toBeNull();
  });
});
