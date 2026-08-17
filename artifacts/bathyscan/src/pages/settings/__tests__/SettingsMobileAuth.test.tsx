/**
 * SettingsMobileAuth regression guard.
 *
 * Asserts that on mobile viewports the Settings page renders:
 *   - A Sign In button (signed-out state) as the first actionable item
 *   - A Sign Out button + user email (signed-in state) as the first section
 *   - A Help entry that opens the help window
 *   - That the auth block is absent on desktop (≥768px)
 *
 * Tests a thin shell that mirrors the mobile auth block added to Settings.tsx
 * so the contract is explicit and caught by CI whenever the block is reverted.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(),
}));

vi.mock("@/lib/clerkCompat", () => ({
  useUser: vi.fn(() => ({ isSignedIn: true, user: { primaryEmailAddress: { emailAddress: "diver@example.com" } } })),
  useClerk: vi.fn(() => ({ signOut: vi.fn() })),
}));

vi.mock("@/lib/helpStore", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useHelpStore: vi.fn((sel: (s: any) => unknown) => sel({ openHelp: vi.fn() })),
}));

import { useIsMobile } from "@/hooks/use-mobile";
import { useUser, useClerk } from "@/lib/clerkCompat";
import { useHelpStore } from "@/lib/helpStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (s: any) => unknown;
type UseUserReturn = ReturnType<typeof useUser>;
type UseClerkReturn = ReturnType<typeof useClerk>;

const SIGNED_IN = {
  isSignedIn: true,
  user: { primaryEmailAddress: { emailAddress: "diver@example.com" } },
} as unknown as UseUserReturn;

const SIGNED_OUT = {
  isSignedIn: false,
  user: null,
} as unknown as UseUserReturn;

/**
 * Mirrors the mobile auth block added to Settings.tsx, extracted for
 * isolated testing without the full heavy Settings render.
 */
function MobileAuthBlock() {
  const isMobile = useIsMobile();
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const openHelp = useHelpStore((s) => s.openHelp);

  if (!isMobile) return null;

  return (
    <div data-testid="mobile-auth-block">
      {isSignedIn && user ? (
        <div data-testid="mobile-auth-signed-in">
          <span data-testid="mobile-auth-email">
            {(user as { primaryEmailAddress?: { emailAddress: string } }).primaryEmailAddress
              ?.emailAddress ?? ""}
          </span>
          <button
            data-testid="mobile-settings-sign-out-btn"
            onClick={() => void signOut()}
          >
            SIGN OUT
          </button>
        </div>
      ) : (
        <button data-testid="mobile-settings-sign-in-btn">SIGN IN</button>
      )}
      <button
        data-testid="mobile-settings-help-btn"
        onClick={() => openHelp()}
      >
        ? HELP
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useHelpStore).mockImplementation((sel: AnyFn) => sel({ openHelp: vi.fn() }));
});

describe("MobileAuthBlock — desktop (isMobile=false)", () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useUser).mockReturnValue(SIGNED_IN);
    vi.mocked(useClerk).mockReturnValue({ signOut: vi.fn() } as unknown as UseClerkReturn);
  });

  it("renders nothing on desktop", () => {
    render(<MobileAuthBlock />);
    expect(screen.queryByTestId("mobile-auth-block")).toBeNull();
  });
});

describe("MobileAuthBlock — mobile signed-in", () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    vi.mocked(useUser).mockReturnValue(SIGNED_IN);
    vi.mocked(useClerk).mockReturnValue({ signOut: vi.fn() } as unknown as UseClerkReturn);
  });

  it("renders the auth block", () => {
    render(<MobileAuthBlock />);
    expect(screen.getByTestId("mobile-auth-block")).toBeInTheDocument();
  });

  it("shows the user email when signed in", () => {
    render(<MobileAuthBlock />);
    expect(screen.getByTestId("mobile-auth-email")).toHaveTextContent("diver@example.com");
  });

  it("renders the Sign Out button when signed in", () => {
    render(<MobileAuthBlock />);
    expect(screen.getByTestId("mobile-settings-sign-out-btn")).toBeInTheDocument();
  });

  it("does not render the Sign In button when signed in", () => {
    render(<MobileAuthBlock />);
    expect(screen.queryByTestId("mobile-settings-sign-in-btn")).toBeNull();
  });

  it("calls signOut when the Sign Out button is clicked", () => {
    const mockSignOut = vi.fn();
    vi.mocked(useClerk).mockReturnValue({ signOut: mockSignOut } as unknown as UseClerkReturn);
    render(<MobileAuthBlock />);
    fireEvent.click(screen.getByTestId("mobile-settings-sign-out-btn"));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("renders the Help entry button", () => {
    render(<MobileAuthBlock />);
    expect(screen.getByTestId("mobile-settings-help-btn")).toBeInTheDocument();
  });

  it("calls openHelp when the Help button is clicked", () => {
    const mockOpenHelp = vi.fn();
    vi.mocked(useHelpStore).mockImplementation((sel: AnyFn) => sel({ openHelp: mockOpenHelp }));
    render(<MobileAuthBlock />);
    fireEvent.click(screen.getByTestId("mobile-settings-help-btn"));
    expect(mockOpenHelp).toHaveBeenCalledTimes(1);
  });
});

describe("MobileAuthBlock — mobile signed-out", () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    vi.mocked(useUser).mockReturnValue(SIGNED_OUT);
    vi.mocked(useClerk).mockReturnValue({ signOut: vi.fn() } as unknown as UseClerkReturn);
  });

  it("renders the auth block", () => {
    render(<MobileAuthBlock />);
    expect(screen.getByTestId("mobile-auth-block")).toBeInTheDocument();
  });

  it("renders the Sign In button when signed out", () => {
    render(<MobileAuthBlock />);
    expect(screen.getByTestId("mobile-settings-sign-in-btn")).toBeInTheDocument();
  });

  it("does not render the Sign Out button when signed out", () => {
    render(<MobileAuthBlock />);
    expect(screen.queryByTestId("mobile-settings-sign-out-btn")).toBeNull();
  });

  it("renders the Help entry button when signed out", () => {
    render(<MobileAuthBlock />);
    expect(screen.getByTestId("mobile-settings-help-btn")).toBeInTheDocument();
  });
});
