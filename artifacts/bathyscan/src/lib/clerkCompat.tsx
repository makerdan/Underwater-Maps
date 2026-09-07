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
import React, { useMemo, useSyncExternalStore } from "react";
import {
  ClerkProvider as RealClerkProvider,
  SignIn as RealSignIn,
  SignUp as RealSignUp,
  Show as RealShow,
  useUser as realUseUser,
  useClerk as realUseClerk,
  useAuth as realUseAuth,
} from "@clerk/react";
import {
  DEV_AUTH_BYPASS,
  FAKE_DEV_USER,
  FAKE_DEV_USER_ID,
  getBypassUserId,
  setBypassUserId,
  subscribeToBypassAuth,
} from "./devAuth";

/**
 * Dev/test-only: when set to `true` via `setBypassSimulateSignedOut`, the
 * bypass hooks report the user as signed out.  Used by Playwright specs to
 * exercise the unauthenticated UI branch (e.g. the auth-gate warning in
 * TerrainDownloadPopover) without a real Clerk session.
 *
 * Only ever mutated in DEV_AUTH_BYPASS mode; Vite DCE removes the whole block
 * in production builds (DEV_AUTH_BYPASS is a literal `false` there).
 */
// The current bypass user is stored in devAuth so fetch headers and Clerk
// compatibility hooks observe the same account transition.

/** Toggle the dev-bypass auth simulation.  No-op in production builds. */
export function setBypassSimulateSignedOut(v: boolean): void {
  if (DEV_AUTH_BYPASS) setBypassUserId(v ? null : FAKE_DEV_USER_ID);
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
  const userId = useBypassUserId();
  if (!userId) {
    return when === "signed-out" ? <>{children}</> : null;
  }
  return when === "signed-in" ? <>{children}</> : null;
};

function useBypassUserId(): string | null {
  return useSyncExternalStore(subscribeToBypassAuth, getBypassUserId, getBypassUserId);
}

function bypassUserForId(userId: string | null) {
  return userId ? { ...FAKE_DEV_USER, id: userId } : null;
}

const useBypassUser = () => {
  const userId = useBypassUserId();
  return {
    user: bypassUserForId(userId),
    isLoaded: true,
    isSignedIn: userId !== null,
  } as unknown as ReturnType<typeof realUseUser>;
};

const useBypassClerk = () => {
  const userId = useBypassUserId();
  const user = useMemo(() => bypassUserForId(userId), [userId]);
  const session = useMemo(
    () =>
      user
        ? { id: `dev-session-${user.id}`, user, getToken: async () => null }
        : null,
    [user],
  );
  return {
    user,
    session,
    signOut: async () => {
      setBypassUserId(null);
    },
    openSignIn: () => {
      console.warn("[bathyscan dev-bypass] openSignIn() is a no-op while the bypass is on.");
    },
    addListener: (cb: (evt: { user: typeof FAKE_DEV_USER | null }) => void) => {
      try {
        cb({ user });
      } catch {
        /* ignore */
      }
      return subscribeToBypassAuth(() => cb({ user: bypassUserForId(getBypassUserId()) }));
    },
  } as unknown as ReturnType<typeof realUseClerk>;
};

const useBypassAuth = () => {
  const userId = useBypassUserId();
  return {
    isSignedIn: userId !== null,
    isLoaded: true,
    userId,
    sessionId: userId ? `dev-session-${userId}` : null,
    orgId: null,
    getToken: async () => null,
  } as unknown as ReturnType<typeof realUseAuth>;
};

export const ClerkProvider = (
  DEV_AUTH_BYPASS ? BypassClerkProvider : RealClerkProvider
) as typeof RealClerkProvider;

export const Show = (DEV_AUTH_BYPASS ? BypassShow : RealShow) as typeof RealShow;

export const SignIn = RealSignIn;
export const SignUp = RealSignUp;

export const useUser = (DEV_AUTH_BYPASS ? useBypassUser : realUseUser) as typeof realUseUser;
export const useClerk = (DEV_AUTH_BYPASS ? useBypassClerk : realUseClerk) as typeof realUseClerk;
export const useAuth = (DEV_AUTH_BYPASS ? useBypassAuth : realUseAuth) as typeof realUseAuth;
