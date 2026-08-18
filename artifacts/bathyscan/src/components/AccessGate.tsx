/**
 * AccessGate — client-side approval gate for signed-in users.
 *
 * The server enforces the user-approval system via requireApproved: every
 * authenticated endpoint returns `403 { error: "awaiting_approval" }` for
 * pending users and `403 { error: "account_banned" }` for banned users.
 * Without this gate those users would land on the main explorer and see
 * cryptic failures on every data load.
 *
 * On mount the gate probes a cheap authenticated endpoint
 * (`GET /api/settings` — the same request the settings sync issues anyway)
 * and inspects the result:
 *   - 200 (or any non-403 response)      → approved, render children
 *   - 403 error "awaiting_approval"      → full-page "awaiting approval" screen
 *   - 403 error "account_banned"         → full-page "suspended" screen
 *   - network failure / 5xx              → error screen with a Retry button
 *
 * Admin users are never intercepted: requireApproved passes admins through
 * unconditionally on the server, so the probe returns 200 for them.
 *
 * Fail-open rules (deliberate): a 403 with an unknown error code, or a 401
 * (expired session — handled by the app's own session-expiry flow), renders
 * children. The gate only blocks on the two explicit approval codes so it can
 * never lock out a valid user due to an unrelated auth hiccup.
 *
 * Children are NEVER flashed before the check resolves — a spinner screen is
 * shown while the probe is in flight.
 *
 * DEV_AUTH_BYPASS: when the dev/e2e auth bypass is active the server skips
 * approval enforcement entirely (the x-e2e-user-id path returns before
 * requireApproved), so the probe would always be a meaningless 200. The gate
 * short-circuits to "approved" to avoid an extra request on every e2e load.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authorizedFetch } from "@/lib/authorizedFetch";
import { getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useUser, useClerk } from "@/lib/clerkCompat";
import { DEV_AUTH_BYPASS } from "@/lib/devAuth";

/** How often (ms) to re-probe the server while the awaiting-approval screen is showing. */
export const PENDING_POLL_INTERVAL_MS = 30_000;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type GateState = "checking" | "approved" | "pending" | "banned" | "error";

const MONO = "'JetBrains Mono', 'Fira Code', monospace";

const S = {
  page: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 2000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#040810",
    fontFamily: MONO,
    padding: 16,
  } as React.CSSProperties,

  card: {
    background: "#0f172a",
    border: "1px solid #1e3a5f",
    borderRadius: 12,
    padding: "32px 36px",
    maxWidth: 440,
    width: "100%",
    textAlign: "center" as const,
    boxShadow: "0 25px 50px -12px rgba(0,0,0,0.6)",
  } as React.CSSProperties,

  brand: {
    fontSize: "calc(11px * var(--bs-font-scale, 1))",
    letterSpacing: "0.3em",
    textTransform: "uppercase" as const,
    color: "#94a3b8",
    marginBottom: 16,
  } as React.CSSProperties,

  title: {
    fontSize: "calc(16px * var(--bs-font-scale, 1))",
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "#e2e8f0",
    marginBottom: 12,
  } as React.CSSProperties,

  text: {
    fontSize: "calc(11px * var(--bs-font-scale, 1))",
    lineHeight: 1.6,
    color: "#cbd5e1",
    marginBottom: 8,
  } as React.CSSProperties,

  email: {
    fontSize: "calc(11px * var(--bs-font-scale, 1))",
    color: "#38bdf8",
    marginBottom: 16,
    wordBreak: "break-all" as const,
  } as React.CSSProperties,

  button: {
    background: "#0369a1",
    border: "1px solid #0284c7",
    borderRadius: 6,
    color: "#ffffff",
    fontFamily: MONO,
    fontSize: "calc(10px * var(--bs-font-scale, 1))",
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "8px 20px",
    cursor: "pointer",
    marginTop: 8,
  } as React.CSSProperties,

  secondaryButton: {
    background: "transparent",
    border: "1px solid #334155",
    borderRadius: 6,
    color: "#cbd5e1",
    fontFamily: MONO,
    fontSize: "calc(10px * var(--bs-font-scale, 1))",
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "8px 20px",
    cursor: "pointer",
    marginTop: 8,
    marginLeft: 8,
  } as React.CSSProperties,

  spinnerText: {
    fontSize: "calc(11px * var(--bs-font-scale, 1))",
    letterSpacing: "0.2em",
    textTransform: "uppercase" as const,
    color: "#64748b",
    animation: "bs-access-pulse 1.2s ease-in-out infinite",
  } as React.CSSProperties,
};

function GateScreen({
  testId,
  title,
  children,
}: {
  testId: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={S.page} data-testid={testId}>
      <div style={S.card}>
        <div style={S.brand}>BathyScan</div>
        <div style={S.title}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export function AccessGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>(
    DEV_AUTH_BYPASS ? "approved" : "checking",
  );
  const [attempt, setAttempt] = useState(0);
  const { user } = useUser();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();

  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  // Initial probe (and manual retry via `attempt`).
  useEffect(() => {
    if (DEV_AUTH_BYPASS) return;
    let cancelled = false;
    setState("checking");

    async function check(): Promise<void> {
      try {
        const res = await authorizedFetch(`${basePath}/api/settings`);
        if (cancelled) return;

        if (res.status === 403) {
          let code: string | undefined;
          try {
            code = ((await res.json()) as { error?: string }).error;
          } catch {
            // Non-JSON 403 body — treat as unknown code below.
          }
          if (cancelled) return;
          if (code === "awaiting_approval") {
            setState("pending");
            return;
          }
          if (code === "account_banned") {
            setState("banned");
            return;
          }
          // Unknown 403 code: fail open (see module docstring).
          setState("approved");
          return;
        }

        if (res.status >= 500) {
          setState("error");
          return;
        }

        // 2xx: seed the TanStack Query cache so the settings sync that runs
        // inside the now-approved children can reuse this response without
        // making a second GET /api/settings round-trip.
        if (res.status >= 200 && res.status < 300) {
          try {
            const data: unknown = await res.json();
            queryClient.setQueryData(getGetSettingsQueryKey(), data);
          } catch {
            // Body parse failed — settings sync will fetch its own copy.
          }
        }

        // 2xx, 401, 4xx-other: fail open. Session expiry and per-route
        // errors are handled by the app itself.
        setState("approved");
      } catch {
        if (!cancelled) setState("error");
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, [attempt, queryClient]);

  // Periodic re-probe while the awaiting-approval screen is showing.
  // When the admin approves the user the next poll will transition automatically
  // to "approved" without requiring a page reload.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCancelledRef = useRef(false);

  const runPoll = useCallback(async () => {
    if (pollCancelledRef.current) return;
    try {
      const res = await authorizedFetch(`${basePath}/api/settings`);
      if (pollCancelledRef.current) return;

      if (res.status === 403) {
        let code: string | undefined;
        try {
          code = ((await res.json()) as { error?: string }).error;
        } catch {
          // ignore parse error, stay pending
        }
        if (pollCancelledRef.current) return;
        if (code === "awaiting_approval") return; // still pending — do nothing
        if (code === "account_banned") {
          setState("banned");
          return;
        }
        // Unknown 403: fail open
        setState("approved");
        return;
      }

      if (res.status >= 200 && res.status < 500) {
        // Includes 2xx (approved), 4xx-other (fail open per gate contract).
        // 5xx: silently ignore and keep polling.
        setState("approved");
      }
      // 5xx: do nothing, keep polling
    } catch {
      // Network failure during a background poll — silently ignore and retry
      // on the next tick rather than crashing the pending screen.
    }
  }, []);

  useEffect(() => {
    if (state !== "pending" || DEV_AUTH_BYPASS) return;

    pollCancelledRef.current = false;
    pollRef.current = setInterval(() => {
      void runPoll();
    }, PENDING_POLL_INTERVAL_MS);

    return () => {
      pollCancelledRef.current = true;
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [state, runPoll]);

  if (state === "approved") return <>{children}</>;

  if (state === "checking") {
    return (
      <div style={S.page} data-testid="access-gate-spinner">
        <div style={S.spinnerText}>Checking access…</div>
      </div>
    );
  }

  if (state === "pending") {
    return (
      <GateScreen testId="access-gate-pending" title="Awaiting Approval">
        <div style={S.text}>Your account is awaiting admin approval.</div>
        {email && (
          <div style={S.email} data-testid="access-gate-email">
            {email}
          </div>
        )}
        <div style={S.text}>
          This page checks automatically — you will be let in the moment your
          account is approved.
        </div>
        <button
          style={S.button}
          data-testid="access-gate-signout"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </GateScreen>
    );
  }

  if (state === "banned") {
    return (
      <GateScreen testId="access-gate-banned" title="Account Suspended">
        <div style={S.text}>
          Your account has been suspended. Contact the site admin.
        </div>
        {email && (
          <div style={S.email} data-testid="access-gate-email">
            {email}
          </div>
        )}
        <button
          style={S.button}
          data-testid="access-gate-signout"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </GateScreen>
    );
  }

  // state === "error"
  return (
    <GateScreen testId="access-gate-error" title="Connection Problem">
      <div style={S.text}>
        Could not verify your account status. Check your connection and try
        again.
      </div>
      <button
        style={S.button}
        data-testid="access-gate-retry"
        onClick={() => setAttempt((a) => a + 1)}
      >
        Retry
      </button>
      <button
        style={S.secondaryButton}
        data-testid="access-gate-signout"
        onClick={() => void signOut()}
      >
        Sign out
      </button>
    </GateScreen>
  );
}
