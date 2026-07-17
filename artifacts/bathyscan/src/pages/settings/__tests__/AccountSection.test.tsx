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
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

import { AccountSection } from "../AccountSection";

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
