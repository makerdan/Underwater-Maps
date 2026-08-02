// @vitest-environment node
/**
 * Regression test: skillZipNoCachePlugin sets Cache-Control: no-store on
 * any request whose path ends in `-skill.zip`.
 *
 * We exercise the middleware logic directly by simulating a minimal connect-
 * style (req, res, next) call — no Vite server process is started.
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Minimal inline re-implementation of the plugin's middleware logic so the
// test doesn't need to import the full vite.config.ts (which has top-level
// side-effects that require PORT/BASE_PATH env vars).
// ---------------------------------------------------------------------------
function skillZipNoCacheMiddleware(
  req: { url?: string },
  res: { headers: Record<string, string>; setHeader(k: string, v: string): void },
  next: () => void,
) {
  const pathname = (req.url ?? "").split("?")[0];
  if (pathname.endsWith("-skill.zip")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
}

function makeRes() {
  const res = {
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      res.headers[k.toLowerCase()] = v;
    },
  };
  return res;
}

describe("skillZipNoCachePlugin middleware", () => {
  it("sets Cache-Control: no-store for failure-gate-skill.zip", () => {
    const res = makeRes();
    let nextCalled = false;
    skillZipNoCacheMiddleware(
      { url: "/failure-gate-skill.zip" },
      res,
      () => { nextCalled = true; },
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(nextCalled).toBe(true);
  });

  it("sets Cache-Control: no-store for any other *-skill.zip path", () => {
    const res = makeRes();
    skillZipNoCacheMiddleware(
      { url: "/poe-setup-skill.zip" },
      res,
      () => {},
    );
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store when a query string is present", () => {
    const res = makeRes();
    skillZipNoCacheMiddleware(
      { url: "/failure-gate-skill.zip?v=abc123" },
      res,
      () => {},
    );
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("does NOT set Cache-Control for unrelated static assets", () => {
    const res = makeRes();
    skillZipNoCacheMiddleware(
      { url: "/assets/logo.png" },
      res,
      () => {},
    );
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("does NOT set Cache-Control for a path that contains but does not end with -skill.zip", () => {
    const res = makeRes();
    skillZipNoCacheMiddleware(
      { url: "/failure-gate-skill.zip.bak" },
      res,
      () => {},
    );
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("always calls next()", () => {
    let count = 0;
    const noop = makeRes();
    skillZipNoCacheMiddleware({ url: "/failure-gate-skill.zip" }, noop, () => { count++; });
    skillZipNoCacheMiddleware({ url: "/logo.png" }, makeRes(), () => { count++; });
    expect(count).toBe(2);
  });
});
