/**
 * AccountSection unit tests.
 *
 * Covers:
 *   - Renders without crashing (signed-in and signed-out states)
 *   - SETTINGS BACKUP card is always present
 *   - Export / Import Settings buttons are always present
 *   - Sign-out button present when user is signed in
 *   - DANGER ZONE buttons (delete markers, delete account) present
 *   - PROFILE card renders user name and email when signed in
 *   - Export All Data button only rendered when signed in
 *   - Danger Zone hidden entirely when signed out (auth guard)
 *   - Marker-deletion countdown timer: fires after 5 s, canceled on unmount,
 *     canceled by UNDO, and skipped if the user signs out mid-countdown
 *   - Sign-out button: disabled while in flight, single in-flight call,
 *     inline error on Clerk rejection
 *   - DELETE ACCOUNT split error paths: network failure, 401/403, 5xx,
 *     and delete-success + sign-out-failure with sign-out recovery
 *   - The personal Account section never renders the admin dashboard
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/clerkCompat", () => ({
  useUser: vi.fn(() => ({
    user: {
      fullName: "Test Diver",
      primaryEmailAddress: { emailAddress: "diver@example.com" },
    },
    isSignedIn: true,
  })),
  useClerk: vi.fn(() => ({
    signOut: vi.fn(),
  })),
}));

vi.mock("@workspace/api-client-react", () => ({
  useDeleteMarkersMine: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    lastSyncedAt: null,
    syncedSnapshot: null,
  });

  const useSettingsStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof state>) => T): T => sel(state()),
    {
      getState: () => ({ ...state(), setState: vi.fn() }),
      setState: vi.fn(),
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );

  return { ...actual, useSettingsStore };
});

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([]) }),
}));

vi.mock("@/lib/blobDownload", () => ({
  triggerBlobDownload: vi.fn(),
}));

vi.mock("@/hooks/useServerSettingsSync", () => ({
  flushServerSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/hooks/signoutCleanup", () => ({
  performSignOutCleanup: vi.fn(),
}));

import { AccountSection } from "../AccountSection";
import { useUser, useClerk } from "@/lib/clerkCompat";
import { useDeleteMarkersMine } from "@workspace/api-client-react";
import { authorizedFetch } from "@/lib/authorizedFetch";
import { performSignOutCleanup } from "@/hooks/signoutCleanup";

type UseUserReturn = ReturnType<typeof useUser>;
type UseClerkReturn = ReturnType<typeof useClerk>;
type UseDeleteMarkersReturn = ReturnType<typeof useDeleteMarkersMine>;

const SIGNED_IN_USER = {
  user: {
    fullName: "Test Diver",
    primaryEmailAddress: { emailAddress: "diver@example.com" },
  },
  isSignedIn: true,
} as unknown as UseUserReturn;

const SIGNED_OUT_USER = { user: null, isSignedIn: false } as unknown as UseUserReturn;

/** Restore the module-level mock factories' default behaviour. */
function restoreDefaultMocks(): void {
  vi.mocked(useUser).mockImplementation(() => SIGNED_IN_USER);
  vi.mocked(useClerk).mockImplementation(() => ({ signOut: vi.fn() }) as unknown as UseClerkReturn);
  vi.mocked(useDeleteMarkersMine).mockImplementation(
    () => ({ mutate: vi.fn(), isPending: false }) as unknown as UseDeleteMarkersReturn,
  );
  vi.mocked(authorizedFetch).mockReset();
  vi.mocked(authorizedFetch).mockResolvedValue({
    ok: true,
    blob: async () => new Blob([]),
  } as unknown as Response);
  vi.mocked(performSignOutCleanup).mockClear();
}

describe("AccountSection — signed in", () => {
  it("renders without crashing", () => {
    const { container } = render(<AccountSection />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the ACCOUNT heading text", () => {
    render(<AccountSection />);
    expect(screen.getByRole("heading", { name: /ACCOUNT/i })).toBeInTheDocument();
  });

  it("renders the PROFILE card header", () => {
    render(<AccountSection />);
    expect(screen.getByText("PROFILE")).toBeInTheDocument();
  });

  it("displays the user full name", () => {
    render(<AccountSection />);
    expect(screen.getByText("Test Diver")).toBeInTheDocument();
  });

  it("displays the user email", () => {
    render(<AccountSection />);
    expect(screen.getByText("diver@example.com")).toBeInTheDocument();
  });

  it("renders the sign-out button when signed in", () => {
    render(<AccountSection />);
    expect(screen.getByTestId("settings-sign-out-btn")).toBeInTheDocument();
  });

  it("renders SETTINGS BACKUP card header", () => {
    render(<AccountSection />);
    expect(screen.getByText("SETTINGS BACKUP")).toBeInTheDocument();
  });

  it("renders Export Settings button", () => {
    render(<AccountSection />);
    expect(screen.getByTestId("export-settings-btn")).toBeInTheDocument();
  });

  it("renders Export All Data button when signed in", () => {
    render(<AccountSection />);
    expect(screen.getByTestId("export-all-btn")).toBeInTheDocument();
  });

  it("renders Import Settings button", () => {
    render(<AccountSection />);
    expect(screen.getByTestId("import-settings-btn")).toBeInTheDocument();
  });

  it("renders DANGER ZONE header", () => {
    render(<AccountSection />);
    expect(screen.getByText("DANGER ZONE")).toBeInTheDocument();
  });

  it("renders Delete All My Markers button", () => {
    render(<AccountSection />);
    expect(screen.getByTestId("delete-all-markers-btn")).toBeInTheDocument();
  });

  it("renders Delete Account button", () => {
    render(<AccountSection />);
    expect(screen.getByTestId("delete-account-btn")).toBeInTheDocument();
  });
});

describe("AccountSection — signed out", () => {
  it("renders without crashing when user is null (signed out)", async () => {
    const { useUser } = await import("@/lib/clerkCompat");
    vi.mocked(useUser).mockReturnValueOnce({ user: null, isSignedIn: false } as unknown as ReturnType<typeof useUser>);
    const { container } = render(<AccountSection />);
    expect(container.firstChild).toBeTruthy();
  });

  it("does NOT render the sign-out button when signed out", async () => {
    const { useUser } = await import("@/lib/clerkCompat");
    vi.mocked(useUser).mockReturnValueOnce({ user: null, isSignedIn: false } as unknown as ReturnType<typeof useUser>);
    render(<AccountSection />);
    expect(screen.queryByTestId("settings-sign-out-btn")).not.toBeInTheDocument();
  });

  it("does NOT render Export All Data button when signed out", async () => {
    const { useUser } = await import("@/lib/clerkCompat");
    vi.mocked(useUser).mockReturnValueOnce({ user: null, isSignedIn: false } as unknown as ReturnType<typeof useUser>);
    render(<AccountSection />);
    expect(screen.queryByTestId("export-all-btn")).not.toBeInTheDocument();
  });

  it("still renders Export Settings and Import Settings buttons when signed out", async () => {
    const { useUser } = await import("@/lib/clerkCompat");
    vi.mocked(useUser).mockReturnValueOnce({ user: null, isSignedIn: false } as unknown as ReturnType<typeof useUser>);
    render(<AccountSection />);
    expect(screen.getByTestId("export-settings-btn")).toBeInTheDocument();
    expect(screen.getByTestId("import-settings-btn")).toBeInTheDocument();
  });
});

describe("AccountSection — Danger Zone auth guard", () => {
  afterEach(() => {
    restoreDefaultMocks();
  });

  it("hides the entire Danger Zone when signed out", () => {
    vi.mocked(useUser).mockImplementation(() => SIGNED_OUT_USER);
    render(<AccountSection />);
    expect(screen.queryByText("DANGER ZONE")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-all-markers-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-account-btn")).not.toBeInTheDocument();
  });

  it("shows the Danger Zone when signed in", () => {
    render(<AccountSection />);
    expect(screen.getByText("DANGER ZONE")).toBeInTheDocument();
  });
});

describe("AccountSection — marker deletion countdown timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    restoreDefaultMocks();
  });

  it("fires the mutation after 5 s when still mounted and signed in", () => {
    const mutate = vi.fn();
    vi.mocked(useDeleteMarkersMine).mockImplementation(
      () => ({ mutate, isPending: false }) as unknown as UseDeleteMarkersReturn,
    );
    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("delete-all-markers-btn"));
    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire the mutation if the component unmounts during the countdown", () => {
    const mutate = vi.fn();
    vi.mocked(useDeleteMarkersMine).mockImplementation(
      () => ({ mutate, isPending: false }) as unknown as UseDeleteMarkersReturn,
    );
    const { unmount } = render(<AccountSection />);
    fireEvent.click(screen.getByTestId("delete-all-markers-btn"));
    unmount();
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does NOT fire the mutation if UNDO is clicked during the countdown", () => {
    const mutate = vi.fn();
    vi.mocked(useDeleteMarkersMine).mockImplementation(
      () => ({ mutate, isPending: false }) as unknown as UseDeleteMarkersReturn,
    );
    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("delete-all-markers-btn"));
    fireEvent.click(screen.getByTestId("undo-delete-markers"));
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(mutate).not.toHaveBeenCalled();
    // Countdown UI is gone and the delete button is back.
    expect(screen.getByTestId("delete-all-markers-btn")).toBeInTheDocument();
  });

  it("does NOT fire the mutation if the user signs out during the countdown", () => {
    const mutate = vi.fn();
    vi.mocked(useDeleteMarkersMine).mockImplementation(
      () => ({ mutate, isPending: false }) as unknown as UseDeleteMarkersReturn,
    );
    const { rerender } = render(<AccountSection />);
    fireEvent.click(screen.getByTestId("delete-all-markers-btn"));
    vi.mocked(useUser).mockImplementation(() => SIGNED_OUT_USER);
    rerender(<AccountSection />);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("AccountSection — sign-out button hardening", () => {
  afterEach(() => {
    restoreDefaultMocks();
  });

  it("disables the button while sign-out is in flight and prevents concurrent calls", async () => {
    let resolveSignOut!: () => void;
    const pending = new Promise<void>((r) => {
      resolveSignOut = r;
    });
    const signOut = vi.fn(() => pending);
    vi.mocked(useClerk).mockImplementation(() => ({ signOut }) as unknown as UseClerkReturn);

    render(<AccountSection />);
    const btn = screen.getByTestId("settings-sign-out-btn");
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("SIGNING OUT…");

    // Further clicks while in flight must not issue another Clerk call.
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(signOut).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSignOut();
      await pending;
    });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it("shows an inline error when Clerk signOut rejects, and re-enables the button", async () => {
    const signOut = vi.fn().mockRejectedValue(new Error("clerk down"));
    vi.mocked(useClerk).mockImplementation(() => ({ signOut }) as unknown as UseClerkReturn);

    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("settings-sign-out-btn"));
    expect(await screen.findByTestId("sign-out-error")).toHaveTextContent(/sign-out failed/i);
    await waitFor(() => expect(screen.getByTestId("settings-sign-out-btn")).not.toBeDisabled());
  });
});

describe("AccountSection — DELETE ACCOUNT split error paths", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    vi.mocked(window.confirm).mockRestore();
    restoreDefaultMocks();
  });

  it("network failure: says the account was NOT deleted and retry is safe; button stays", async () => {
    vi.mocked(authorizedFetch).mockRejectedValueOnce(new Error("offline"));
    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("delete-account-btn"));
    expect(await screen.findByTestId("account-delete-msg")).toHaveTextContent(
      /Network error — your account was NOT deleted/,
    );
    expect(screen.getByTestId("delete-account-btn")).toBeEnabled();
    expect(vi.mocked(performSignOutCleanup)).not.toHaveBeenCalled();
  });

  it("401 unauthorized: says no data was deleted and session may have expired", async () => {
    vi.mocked(authorizedFetch).mockResolvedValueOnce({ ok: false, status: 401 } as Response);
    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("delete-account-btn"));
    expect(await screen.findByTestId("account-delete-msg")).toHaveTextContent(
      /Not authorized.*No data was deleted/,
    );
    expect(screen.getByTestId("delete-account-btn")).toBeEnabled();
    expect(vi.mocked(performSignOutCleanup)).not.toHaveBeenCalled();
  });

  it("5xx server error: says deletion did not complete and retry is safe", async () => {
    vi.mocked(authorizedFetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("delete-account-btn"));
    expect(await screen.findByTestId("account-delete-msg")).toHaveTextContent(
      /Server error \(500\).*safe to retry/,
    );
    expect(screen.getByTestId("delete-account-btn")).toBeEnabled();
  });

  it("delete succeeds but sign-out fails: restores sign-out recovery, removes delete button, and clears local state", async () => {
    vi.mocked(authorizedFetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    const signOut = vi.fn().mockRejectedValue(new Error("clerk down"));
    vi.mocked(useClerk).mockImplementation(() => ({ signOut }) as unknown as UseClerkReturn);

    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("delete-account-btn"));
    expect(await screen.findByTestId("account-delete-msg")).toHaveTextContent(
      /Account deleted\. Sign-out failed.*retry sign-out.*Do not retry deletion/i,
    );
    // The account is gone — no re-delete button may be offered.
    expect(screen.queryByTestId("delete-account-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("retry-sign-out-btn")).toBeEnabled();
    expect(screen.getByTestId("reload-page-link")).toHaveTextContent("Reload page");
    // Local persisted state was cleared before the sign-out attempt.
    expect(vi.mocked(performSignOutCleanup)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(performSignOutCleanup).mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("delete succeeds and sign-out succeeds: clears local state, no failure message", async () => {
    vi.mocked(authorizedFetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    const signOut = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useClerk).mockImplementation(() => ({ signOut }) as unknown as UseClerkReturn);

    render(<AccountSection />);
    fireEvent.click(screen.getByTestId("delete-account-btn"));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(vi.mocked(performSignOutCleanup)).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByTestId("delete-account-btn")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("account-delete-msg")).not.toBeInTheDocument();
  });
});

describe("AccountSection — admin dashboard separation", () => {
  afterEach(() => {
    restoreDefaultMocks();
  });

  it("does not render an admin dashboard for a regular user", () => {
    render(<AccountSection />);
    expect(screen.queryByText("Pending Approvals")).not.toBeInTheDocument();
  });

  it("does not render an admin dashboard even when the account belongs to an admin", () => {
    vi.mocked(useUser).mockImplementation(
      () =>
        ({
          user: {
            fullName: "Admin Diver",
            primaryEmailAddress: { emailAddress: "admin@example.com" },
            publicMetadata: { role: "admin" },
          },
          isSignedIn: true,
        }) as unknown as UseUserReturn,
    );
    render(<AccountSection />);
    expect(screen.queryByText("Pending Approvals")).not.toBeInTheDocument();
    expect(screen.getByText("SETTINGS BACKUP")).toBeInTheDocument();
  });
});
