/**
 * Clerk compatibility shim.
 *
 * In normal builds this is a transparent re-export of `@clerk/react`. When
 * the dev-only auth bypass is on (see `./devAuth.ts`), the hooks and gate
 * components are replaced with stubs that report a fake "Dev User" as
 * signed in. Tree-shaking removes the bypass branches in production
 * because `DEV_AUTH_BYPASS` is a literal `false` there.
 *
 * Only the subset of Clerk's surface that BathyScan actually consumes is
 * shimmed: `ClerkProvider`, `Show`, `SignIn`, `SignUp`, `useUser`,
 * `useClerk`, `useAuth`.
 */
import React from "react";
import {
  ClerkProvider as RealClerkProvider,
  SignIn as RealSignIn,
  SignUp as RealSignUp,
  Show as RealShow,
  useUser as realUseUser,
  useClerk as realUseClerk,
  useAuth as realUseAuth,
} from "@clerk/react";
import { DEV_AUTH_BYPASS, FAKE_DEV_USER, FAKE_DEV_USER_ID } from "./devAuth";

/**
 * Dev/test-only: when set to `true` via `setBypassSimulateSignedOut`, the
 * bypass hooks report the user as signed out.  Used by Playwright specs to
 * exercise the unauthenticated UI branch (e.g. the auth-gate warning in
 * TerrainDownloadPopover) without a real Clerk session.
 *
 * Only ever mutated in DEV_AUTH_BYPASS mode; Vite DCE removes the whole block
 * in production builds (DEV_AUTH_BYPASS is a literal `false` there).
 */
let _bypassSimulateSignedOut = false;

/** Toggle the dev-bypass auth simulation.  No-op in production builds. */
export function setBypassSimulateSignedOut(v: boolean): void {
  if (DEV_AUTH_BYPASS) _bypassSimulateSignedOut = v;
}

type ClerkProviderProps = React.ComponentProps<typeof RealClerkProvider>;

const BypassClerkProvider: React.FC<ClerkProviderProps> = ({ children }) => (
  <>{children}</>
);

type ShowProps = {
  when: "signed-in" | "signed-out";
  children?: React.ReactNode;
};

const BypassShow: React.FC<ShowProps> = ({ when, children }) => {
  if (_bypassSimulateSignedOut) {
    return when === "signed-out" ? <>{children}</> : null;
  }
  return when === "signed-in" ? <>{children}</> : null;
};

const bypassUseUser = () =>
  ({
    user: _bypassSimulateSignedOut ? null : FAKE_DEV_USER,
    isLoaded: true,
    isSignedIn: !_bypassSimulateSignedOut,
  }) as unknown as ReturnType<typeof realUseUser>;

const bypassUseClerk = () =>
  ({
    user: FAKE_DEV_USER,
    session: { id: "dev-session", user: FAKE_DEV_USER, getToken: async () => null },
    signOut: async () => {
      console.warn("[bathyscan dev-bypass] signOut() is a no-op while the bypass is on.");
    },
    addListener: (cb: (evt: { user: typeof FAKE_DEV_USER }) => void) => {
      try {
        cb({ user: FAKE_DEV_USER });
      } catch {
        /* ignore */
      }
      return () => {};
    },
  }) as unknown as ReturnType<typeof realUseClerk>;

const bypassUseAuth = () =>
  ({
    isSignedIn: !_bypassSimulateSignedOut,
    isLoaded: true,
    userId: _bypassSimulateSignedOut ? null : FAKE_DEV_USER_ID,
    sessionId: _bypassSimulateSignedOut ? null : "dev-session",
    orgId: null,
    getToken: async () => null,
  }) as unknown as ReturnType<typeof realUseAuth>;

export const ClerkProvider = (
  DEV_AUTH_BYPASS ? BypassClerkProvider : RealClerkProvider
) as typeof RealClerkProvider;

export const Show = (DEV_AUTH_BYPASS ? BypassShow : RealShow) as typeof RealShow;

export const SignIn = RealSignIn;
export const SignUp = RealSignUp;

export const useUser = (DEV_AUTH_BYPASS ? bypassUseUser : realUseUser) as typeof realUseUser;
export const useClerk = (DEV_AUTH_BYPASS ? bypassUseClerk : realUseClerk) as typeof realUseClerk;
export const useAuth = (DEV_AUTH_BYPASS ? bypassUseAuth : realUseAuth) as typeof realUseAuth;
