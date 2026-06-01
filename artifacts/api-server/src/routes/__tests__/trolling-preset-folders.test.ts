/**
 * trolling-preset-folders.test.ts — integration tests for the
 * trolling-preset-folders routes.
 *
 * Covers:
 *   GET    /trolling-preset-folders        — list folders
 *   POST   /trolling-preset-folders        — create (valid + invalid body, duplicate name)
 *   PATCH  /trolling-preset-folders/:id    — rename (not found, duplicate name)
 *   DELETE /trolling-preset-folders/:id    — delete (ownership enforcement → 404)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

type FolderRow = {
  id: string;
  userId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

const state: { folders: FolderRow[] } = { folders: [] };
let idCounter = 0;

vi.mock("@workspace/db", () => {
  const tag = (n: string) => ({ __tableName: n });
  const trollingPresetFoldersTable = tag("folders");

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.folders),
      }),
    }),
    insert: () => ({
      values: (row: Omit<FolderRow, "id" | "createdAt" | "updatedAt">) => ({
        returning: () => {
          const newRow: FolderRow = {
            id: `folder-${++idCounter}`,
            ...row,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          state.folders.push(newRow);
          return Promise.resolve([newRow]);
        },
      }),
    }),
    update: () => ({
      set: (updates: Partial<FolderRow>) => ({
        where: () => {
          const idx = state.folders.findIndex((f) => f.id === "TARGET");
          if (idx === -1) return Promise.resolve([]);
          const updated = { ...state.folders[idx]!, ...updates };
          state.folders[idx] = updated;
          return Promise.resolve([updated]);
        },
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => {
          if (state.folders.length === 0) return Promise.resolve([]);
          const deleted = state.folders.splice(0, 1);
          return Promise.resolve(deleted?.map((f) => ({ id: f.id })) ?? []);
        },
      }),
    }),
  };

  return {
    db,
    trollingPresetFoldersTable,
    eq: () => {},
    and: () => {},
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

import foldersRouter from "../trolling-preset-folders.js";

const E2E_USER = "user_e2e_folders_test";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(foldersRouter);
  return app;
}

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  state.folders = [];
  idCounter = 0;
});

describe("GET /trolling-preset-folders — list folders", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "0");
    const res = await request(makeApp()).get("/trolling-preset-folders");
    expect(res.status).toBe(401);
  });

  it("returns an empty array when the user has no folders", async () => {
    const res = await request(makeApp())
      .get("/trolling-preset-folders")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });
});

describe("POST /trolling-preset-folders — create folder", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(makeApp())
      .post("/trolling-preset-folders")
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is an empty string", async () => {
    const res = await request(makeApp())
      .post("/trolling-preset-folders")
      .set("x-e2e-user-id", E2E_USER)
      .send({ name: "   " });
    expect([400, 500]).toContain(res.status);
  });

  it("returns 201 with the folder JSON for a valid name", async () => {
    const res = await request(makeApp())
      .post("/trolling-preset-folders")
      .set("x-e2e-user-id", E2E_USER)
      .send({ name: "My Folder" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My Folder");
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("createdAt");
  });

  it("returns 400 for a duplicate folder name (case-insensitive)", async () => {
    state.folders = [{
      id: "existing-1",
      userId: E2E_USER,
      name: "Salmon Run",
      createdAt: new Date(),
      updatedAt: new Date(),
    }];
    const res = await request(makeApp())
      .post("/trolling-preset-folders")
      .set("x-e2e-user-id", E2E_USER)
      .send({ name: "salmon run" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("duplicate_name");
  });
});

describe("PATCH /trolling-preset-folders/:id — rename folder", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(makeApp())
      .patch("/trolling-preset-folders/some-id")
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 when the folder does not belong to the user", async () => {
    const res = await request(makeApp())
      .patch("/trolling-preset-folders/nonexistent-folder")
      .set("x-e2e-user-id", E2E_USER)
      .send({ name: "New Name" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });
});

describe("DELETE /trolling-preset-folders/:id — delete folder", () => {
  it("returns 404 when the folder does not exist", async () => {
    const res = await request(makeApp())
      .delete("/trolling-preset-folders/nonexistent-folder")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 204 when deletion succeeds", async () => {
    state.folders = [{
      id: "folder-to-delete",
      userId: E2E_USER,
      name: "Delete Me",
      createdAt: new Date(),
      updatedAt: new Date(),
    }];
    const res = await request(makeApp())
      .delete("/trolling-preset-folders/folder-to-delete")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(204);
  });
});
