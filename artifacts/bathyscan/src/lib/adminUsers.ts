/**
 * adminUsers — typed React Query hooks for the admin user-approval endpoints.
 *
 * Wraps the generated fetchers from `@workspace/api-client-react` (which
 * attach the Clerk Bearer token via customFetch) with:
 *   - an infinite list query (`useAdminUsersList`) using keyset pagination
 *     (`nextCursor` from GET /api/admin/users), and
 *   - mutation hooks (approve / ban / restore / delete) that patch every
 *     admin-users list cache on success so rows update immediately, then
 *     invalidate so the next refetch reconciles with the server.
 *
 * Co-located here (rather than inline in UserAccessSection) so both the UI
 * component and its unit tests import the same hook surface.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import {
  adminListUsers,
  adminApproveUser,
  adminBanUser,
  adminRestoreUser,
  adminDeleteUser,
  type AdminListUsers200,
  type UserAccessRecord,
  type UserAccessRecordStatus,
} from "@workspace/api-client-react";

export type AdminUserRecord = UserAccessRecord;
export type AdminUserStatus = UserAccessRecordStatus;

/** Page size for the admin user list (server max is 200, default 50). */
export const ADMIN_USERS_PAGE_SIZE = 50;

/** Root query key shared by every admin-users list query. */
export const ADMIN_USERS_ROOT_KEY = ["admin-users"] as const;

export function adminUsersListQueryKey(
  status?: AdminUserStatus,
): readonly [string, string] {
  return [ADMIN_USERS_ROOT_KEY[0], status ?? "all"] as const;
}

/**
 * Infinite list of user-access rows, optionally filtered by status.
 * `pageParam` is the keyset cursor (Clerk user ID of the last row of the
 * previous page); `null` means "first page".
 */
export function useAdminUsersList(status?: AdminUserStatus) {
  return useInfiniteQuery({
    queryKey: adminUsersListQueryKey(status),
    queryFn: ({ pageParam, signal }) =>
      adminListUsers(
        {
          ...(status !== undefined ? { status } : {}),
          limit: ADMIN_USERS_PAGE_SIZE,
          ...(pageParam !== null ? { cursor: pageParam } : {}),
        },
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

type ListCache = InfiniteData<AdminListUsers200, string | null>;

const ALL_LIST_FILTERS: (AdminUserStatus | undefined)[] = [
  undefined,
  "pending",
  "approved",
  "banned",
];

/**
 * Replace a user row in every cached list page. Rows whose new status no
 * longer matches a status-filtered cache are dropped from that cache (e.g.
 * an approved user disappears from the "pending" list immediately).
 * Insertion into newly-matching caches is left to the invalidation refetch.
 */
function patchUserInListCaches(qc: QueryClient, user: AdminUserRecord): void {
  for (const filter of ALL_LIST_FILTERS) {
    qc.setQueryData<ListCache>(adminUsersListQueryKey(filter), (old) =>
      old === undefined
        ? undefined
        : {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              users: page.users
                .map((u) => (u.clerkUserId === user.clerkUserId ? user : u))
                .filter((u) => (filter === undefined ? true : u.status === filter)),
            })),
          },
    );
  }
}

/** Drop a deleted user's row from every cached list page. */
function removeUserFromListCaches(qc: QueryClient, clerkUserId: string): void {
  for (const filter of ALL_LIST_FILTERS) {
    qc.setQueryData<ListCache>(adminUsersListQueryKey(filter), (old) =>
      old === undefined
        ? undefined
        : {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              users: page.users.filter((u) => u.clerkUserId !== clerkUserId),
            })),
          },
    );
  }
}

/** Refetch every admin-users list so counts and rows reconcile with the server. */
function refreshLists(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ADMIN_USERS_ROOT_KEY });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** pending → approved */
export function useApproveAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clerkUserId }: { clerkUserId: string }) =>
      adminApproveUser(clerkUserId),
    onSuccess: (res) => {
      patchUserInListCaches(qc, res.user);
      refreshLists(qc);
    },
  });
}

/** approved → banned (with optional admin note) */
export function useBanAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clerkUserId, note }: { clerkUserId: string; note?: string }) =>
      adminBanUser(clerkUserId, note !== undefined && note !== "" ? { note } : undefined),
    onSuccess: (res) => {
      patchUserInListCaches(qc, res.user);
      refreshLists(qc);
    },
  });
}

/** banned → approved */
export function useRestoreAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clerkUserId }: { clerkUserId: string }) =>
      adminRestoreUser(clerkUserId),
    onSuccess: (res) => {
      patchUserInListCaches(qc, res.user);
      refreshLists(qc);
    },
  });
}

/** Hard-delete the row (user returns to pending on next login). */
export function useDeleteAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clerkUserId }: { clerkUserId: string }) =>
      adminDeleteUser(clerkUserId),
    onSuccess: (res) => {
      removeUserFromListCaches(qc, res.clerkUserId);
      refreshLists(qc);
    },
  });
}
