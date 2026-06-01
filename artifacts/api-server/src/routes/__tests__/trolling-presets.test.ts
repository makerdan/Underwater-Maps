/**
 * trolling-presets.test.ts — integration tests for the trolling-presets routes.
 *
 * Covers:
 *   GET    /trolling-presets        — list presets for the authenticated user
 *   POST   /trolling-presets        — create preset (valid + invalid body)
 *   PATCH  /trolling-presets/:id    — update preset (valid + invalid body)
 *   DELETE /trolling-presets/:id    — delete preset (not found → 404)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

type Row = Record<string, unknown>;

const state: { presets: Row[]; folders: Row[] } = { presets: [], folders: [] };

vi.mock("@workspace/db", () => {
  function makeChain(rows: () => Row[]) {
    const chain = {
      where: () => chain,
      orderBy: () => Promise.resolve(rows()),
      returning: () => Promise.resolve(rows()),
      then: (resolve: (v: Row[]) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(rows()).then(resolve, reject),
    };
    return chain;
  }

  const db = {
    select: () => ({
      from: (tbl: { __name: string }) => ({
        where: () => ({
          orderBy: () => Promise.resolve(state.presets),
        }),
      }),
    }),
    insert: () => ({
      values: (row: Row) => ({
        returning: () => {
          const newRow = { id: `gen-${Date.now()}`, ...row };
          state.presets.push(newRow);
          return Promise.resolve([newRow]);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => {
            if (state.presets.length === 0) return Promise.resolve([]);
            const updated = { ...state.presets[0] };
            return Promise.resolve([updated]);
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => {
          if (state.presets.length === 0) return Promise.resolve([]);
          return Promise.resolve(state.presets.splice(0, 1));
        },
      }),
    }),
  };

  return {
    db,
    trollingPresetsTable: { __name: "presets" },
    trollingPresetFoldersTable: { __name: "folders" },
    eq: () => ({}),
    and: () => ({}),
    asc: () => ({}),
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

import trollingPresetsRouter from "../trolling-presets.js";

const E2E_USER = "user_e2e_trolling_test";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(trollingPresetsRouter);
  return app;
}

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  state.presets = [];
  state.folders = [];
});

describe("GET /trolling-presets — list presets", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "0");
    const res = await request(makeApp()).get("/trolling-presets");
    expect(res.status).toBe(401);
  });

  it("returns an empty array when user has no presets", async () => {
    const res = await request(makeApp())
      .get("/trolling-presets")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("POST /trolling-presets — create preset", () => {
  it("returns 400 when required fields are missing", async () => {
    const res = await request(makeApp())
      .post("/trolling-presets")
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when headingDeg is out of range", async () => {
    const res = await request(makeApp())
      .post("/trolling-presets")
      .set("x-e2e-user-id", E2E_USER)
      .send({ name: "Test", headingDeg: 400, speedKnots: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 201 with the created preset for a valid body", async () => {
    const res = await request(makeApp())
      .post("/trolling-presets")
      .set("x-e2e-user-id", E2E_USER)
      .send({ name: "My Preset", headingDeg: 90, speedKnots: 2.5 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My Preset");
    expect(res.body).toHaveProperty("id");
  });
});

describe("PATCH /trolling-presets/:id — update preset", () => {
  it("returns 400 when body has no updateable fields", async () => {
    const res = await request(makeApp())
      .patch("/trolling-presets/some-id")
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 404 when preset does not exist", async () => {
    const res = await request(makeApp())
      .patch("/trolling-presets/nonexistent-id")
      .set("x-e2e-user-id", E2E_USER)
      .send({ name: "New Name" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });
});

describe("DELETE /trolling-presets/:id — delete preset", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "0");
    const res = await request(makeApp())
      .delete("/trolling-presets/some-id");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the preset does not exist", async () => {
    const res = await request(makeApp())
      .delete("/trolling-presets/00000000-0000-0000-0000-000000000001")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 204 when deletion succeeds", async () => {
    state.presets = [{ id: "preset-to-delete", userId: E2E_USER, name: "Delete Me" }];
    const res = await request(makeApp())
      .delete("/trolling-presets/preset-to-delete")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(204);
  });
});
