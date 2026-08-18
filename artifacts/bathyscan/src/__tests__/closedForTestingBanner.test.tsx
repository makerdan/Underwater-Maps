/**
 * closedForTestingBanner.test.tsx
 *
 * Unit tests for the VITE_SITE_STATUS "closed for private testing" gate:
 *
 *  1. isSiteClosed() — true only when VITE_SITE_STATUS === "closed".
 *  2. LandingPage — banner visible + "Create account" button omitted when
 *     closed; banner absent + button present when open or unset.
 *  3. SignUpPage — redirects to "/" (replace) and renders no sign-up widget
 *     when closed; renders the widget and does not redirect when open.
 *
 * The flag is read at call time (see src/lib/siteStatus.ts), so each test
 * just stubs the env var with vi.stubEnv — no module-registry reset needed.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  setLocation: vi.fn(),
}));

// Only useLocation is overridden (so SignUpPage's redirect is observable
// without real history navigation); everything else stays real.
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    useLocation: () => ["/sign-up", mocks.setLocation] as const,
  };
});

// Stub only the Clerk SignUp widget — mounting the real one outside a
// ClerkProvider is not supported. All other clerkCompat exports stay real.
vi.mock("@/lib/clerkCompat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clerkCompat")>();
  return {
    ...actual,
    SignUp: () => <div data-testid="clerk-signup-widget" />,
  };
});

import { LandingPage, SignUpPage } from "@/App";
import { isSiteClosed } from "@/lib/siteStatus";

const BANNER_TESTID = "closed-for-testing-banner";
const BANNER_TEXT = /currently closed for private testing/i;

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  mocks.setLocation.mockReset();
});

describe("isSiteClosed", () => {
  it("returns true when VITE_SITE_STATUS=closed", () => {
    vi.stubEnv("VITE_SITE_STATUS", "closed");
    expect(isSiteClosed()).toBe(true);
  });

  it("returns false when VITE_SITE_STATUS=open", () => {
    vi.stubEnv("VITE_SITE_STATUS", "open");
    expect(isSiteClosed()).toBe(false);
  });

  it("returns false when VITE_SITE_STATUS is unset", () => {
    expect(import.meta.env.VITE_SITE_STATUS).toBeUndefined();
    expect(isSiteClosed()).toBe(false);
  });
});

describe("LandingPage — closed state", () => {
  it("shows the closed-for-testing banner", () => {
    vi.stubEnv("VITE_SITE_STATUS", "closed");
    render(<LandingPage />);
    const banner = screen.getByTestId(BANNER_TESTID);
    expect(banner).toBeTruthy();
    expect(banner.textContent).toMatch(BANNER_TEXT);
    expect(banner.textContent).toMatch(/sign-ups are not available/i);
  });

  it("hides the Create account button entirely", () => {
    vi.stubEnv("VITE_SITE_STATUS", "closed");
    render(<LandingPage />);
    expect(screen.queryByText("Create account")).toBeNull();
  });

  it("still shows the Sign In button", () => {
    vi.stubEnv("VITE_SITE_STATUS", "closed");
    render(<LandingPage />);
    expect(screen.getByText("Sign In to Explore")).toBeTruthy();
  });

  it("banner font size follows the --bs-font-scale convention", () => {
    vi.stubEnv("VITE_SITE_STATUS", "closed");
    render(<LandingPage />);
    const banner = screen.getByTestId(BANNER_TESTID);
    expect(banner.style.fontSize).toBe("calc(15px * var(--bs-font-scale, 1))");
  });
});

describe("LandingPage — open state", () => {
  it("shows no banner and keeps Create account when VITE_SITE_STATUS=open", () => {
    vi.stubEnv("VITE_SITE_STATUS", "open");
    render(<LandingPage />);
    expect(screen.queryByTestId(BANNER_TESTID)).toBeNull();
    expect(screen.getByText("Create account")).toBeTruthy();
  });

  it("shows no banner and keeps Create account when VITE_SITE_STATUS is unset", () => {
    render(<LandingPage />);
    expect(screen.queryByTestId(BANNER_TESTID)).toBeNull();
    expect(screen.getByText("Create account")).toBeTruthy();
    expect(screen.getByText("Sign In to Explore")).toBeTruthy();
  });
});

describe("SignUpPage — closed-for-testing redirect", () => {
  it("redirects to / (replace) and renders no sign-up widget when closed", () => {
    vi.stubEnv("VITE_SITE_STATUS", "closed");
    render(<SignUpPage />);
    expect(mocks.setLocation).toHaveBeenCalledWith("/", { replace: true });
    expect(screen.queryByTestId("clerk-signup-widget")).toBeNull();
  });

  it("renders the sign-up widget and does not redirect when open", () => {
    vi.stubEnv("VITE_SITE_STATUS", "open");
    render(<SignUpPage />);
    expect(screen.getByTestId("clerk-signup-widget")).toBeTruthy();
    expect(mocks.setLocation).not.toHaveBeenCalled();
  });

  it("renders the sign-up widget and does not redirect when unset", () => {
    render(<SignUpPage />);
    expect(screen.getByTestId("clerk-signup-widget")).toBeTruthy();
    expect(mocks.setLocation).not.toHaveBeenCalled();
  });
});
