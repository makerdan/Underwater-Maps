/**
 * tidal-validation.test.ts — query-parameter validation regressions for the
 * tidal routes. Focuses on inputs the old bare parseFloat/parseInt handling
 * mishandled: array injection (?lat=1&lat=2), out-of-range days, and junk
 * datetime strings. All must return a structured 400 without any upstream
 * NOAA fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import tidalRouter from "../tidal";

function makeApp() {
  const app = express();
  app.use(tidalRouter);
  return app;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch") as ReturnType<typeof vi.spyOn>;
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe("array-injection rejection", () => {
  it.each([
    "/tidal?lat=55&lat=56&lon=-132",
    "/tidal/schedule?lat=55&lon=-132&lon=-133",
    "/tidal/pack?lat=55&lat=56&lon=-132",
  ])("%s → 400 without touching NOAA", async (url) => {
    const res = await request(makeApp()).get(url);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("GET /tidal", () => {
  it("rejects a junk datetime with 400", async () => {
    const res = await request(makeApp()).get("/tidal?lat=55&lon=-132&datetime=banana");
    expect(res.status).toBe(400);
    expect(res.body.details).toMatch(/datetime/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects out-of-range latitude with 400", async () => {
    const res = await request(makeApp()).get("/tidal?lat=95&lon=-132");
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("GET /tidal/pack", () => {
  it("rejects days below the minimum (3) with 400", async () => {
    const res = await request(makeApp()).get("/tidal/pack?lat=55&lon=-132&days=1");
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects days above the maximum (14) with 400", async () => {
    const res = await request(makeApp()).get("/tidal/pack?lat=55&lon=-132&days=99");
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-numeric days with 400", async () => {
    const res = await request(makeApp()).get("/tidal/pack?lat=55&lon=-132&days=week");
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
