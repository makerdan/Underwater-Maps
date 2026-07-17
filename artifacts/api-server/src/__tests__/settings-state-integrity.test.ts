/**
 * settings-state-integrity.test.ts
 *
 * Verifies the three state-integrity hardening changes in
 * artifacts/api-server/src/routes/settings.ts:
 *
 *   1. Prototype pollution guard — a "__proto__" key in the stored settings
 *      row cannot mutate Object.prototype when `merged` is built with
 *      Object.create(null) + Object.assign.
 *
 *   2. Dead-delete absence — `delete extras.__updatedAt` must no longer
 *      appear in settings.ts after the extraction-loop exclusion was
 *      documented as the canonical gate.
 *
 * These are fast, isolated checks — (1) exercises the route end-to-end
 * via supertest; (2) is a static grep of the source file.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Shared mock state ────────────────────────────────────────────────────────

const integrityMocks = vi.hoisted(() => {
  const selectWhereMock = vi.fn().mockResolvedValue([]);
  const fromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue([]);
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
  return { selectWhereMock, fromMock, onConflictDoUpdateMock, valuesMock };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({ from: integrityMocks.fromMock }),
      insert: vi.fn().mockReturnValue({ values: integrityMocks.valuesMock }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => ({
    userId: req.headers["x-mock-clerk-user-id"] || null,
  })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";

const AUTH = { "x-mock-clerk-user-id": "user_integrity_test" };

afterEach(() => {
  vi.clearAllMocks();
  integrityMocks.selectWhereMock.mockResolvedValue([]);
});

// ─── 1. Prototype pollution guard ────────────────────────────────────────────

describe("PUT /api/settings — prototype pollution guard", () => {
  it("does not mutate Object.prototype when stored row contains a __proto__ key", async () => {
    // Simulate a legacy stored row that somehow has a "__proto__" key.
    // JSON.parse is the standard way to construct an object with an own
    // "__proto__" key without triggering a prototype mutation at parse time.
    const poisonedRow = JSON.parse('{"__proto__":{"polluted":true},"textureQuality":"medium"}');

    // The DB select returns this row as the existing settings.
    integrityMocks.selectWhereMock.mockResolvedValue([
      { userId: "user_integrity_test", settings: poisonedRow },
    ]);

    // Snapshot Object.prototype before the call.
    const pollutedBefore = ({} as Record<string, unknown>).polluted;

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ textureQuality: "high" });

    // The server must succeed (not crash on the poisoned stored row).
    expect(res.status).toBe(200);

    // Object.prototype must NOT have been mutated — the critical assertion.
    const pollutedAfter = ({} as Record<string, unknown>).polluted;
    expect(pollutedAfter).toBeUndefined();
    expect(pollutedAfter).toBe(pollutedBefore);
  });

  it("excludes __updatedAt from extras so the server timestamp is always authoritative", async () => {
    // A client that sends __updatedAt in the body must not be able to
    // influence the sync timestamp stored on the server.
    const futureTimestamp = "2099-01-01T00:00:00.000Z";
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ textureQuality: "low", __updatedAt: futureTimestamp });

    // The route filters __updatedAt out of extras at the extraction loop,
    // so there is no bad-key rejection — request succeeds.
    expect(res.status).toBe(200);

    // The returned __updatedAt must be the server-generated stamp (a real
    // ISO string), not the client-supplied future value.
    expect(res.body.__updatedAt).not.toBe(futureTimestamp);
    expect(typeof res.body.__updatedAt).toBe("string");
    // Sanity: the server stamp must parse as a valid date.
    expect(Number.isNaN(Date.parse(res.body.__updatedAt as string))).toBe(false);
  });
});

// ─── 2. JSON round-trip integrity of the value written to db.insert ──────────

describe("PUT /api/settings — db.insert receives a plain JSON-round-trippable object", () => {
  it("the settings value passed to db.insert deep-equals its own JSON.parse(JSON.stringify(...)) result", async () => {
    // Seed a stored row so the merge path is exercised.
    integrityMocks.selectWhereMock.mockResolvedValue([
      { userId: "user_integrity_test", settings: { textureQuality: "medium", somePrevKey: true } },
    ]);

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ textureQuality: "high", customKey: "customValue" });

    expect(res.status).toBe(200);

    // Retrieve the argument passed to .values({ userId, settings: ... }).
    const [valuesArg] = integrityMocks.valuesMock.mock.calls[0] as [
      { userId: string; settings: unknown },
    ];
    const captured = valuesArg.settings;

    // The value must JSON-round-trip cleanly: parsing the stringified form
    // must produce a deep-equal result. This ensures it is a plain object
    // (not a null-prototype object) and carries no non-serializable content.
    const roundTripped = JSON.parse(JSON.stringify(captured));
    expect(captured).toEqual(roundTripped);

    // Extra: the prototype of the captured object must be Object.prototype,
    // not null — confirming the route applied the JSON-sanitisation step.
    expect(Object.getPrototypeOf(captured as object)).toBe(Object.prototype);
  });

  it("a client-supplied __updatedAt is never stored in db.insert even when syntactically valid", async () => {
    const clientTimestamp = "2099-06-15T12:00:00.000Z";

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ textureQuality: "low", __updatedAt: clientTimestamp });

    expect(res.status).toBe(200);

    const [valuesArg] = integrityMocks.valuesMock.mock.calls[0] as [
      { userId: string; settings: Record<string, unknown> },
    ];
    const storedSettings = valuesArg.settings;

    // The stored __updatedAt must NOT match what the client sent.
    expect(storedSettings.__updatedAt).not.toBe(clientTimestamp);
    // It must still be a valid ISO date string (server-generated).
    expect(typeof storedSettings.__updatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(storedSettings.__updatedAt as string))).toBe(false);
  });
});

// ─── 3. Dead-delete absence (static) ─────────────────────────────────────────

describe("settings.ts source — dead delete statement absence", () => {
  it("does not contain 'delete extras.__updatedAt' after the extraction-loop fix", () => {
    const settingsPath = resolve(__dirname, "../routes/settings.ts");
    const source = readFileSync(settingsPath, "utf8");

    // This statement was redundant because the extraction loop already
    // filters __updatedAt at source. It must have been removed.
    const hasDeadDelete = source.includes("delete extras.__updatedAt");

    expect(hasDeadDelete, [
      "",
      "Found 'delete extras.__updatedAt' in settings.ts.",
      "This statement is unreachable — the extraction loop on the line that",
      "builds `extras` already guards `k !== '__updatedAt'` so __updatedAt",
      "is never inserted into extras in the first place.",
      "Remove the dead delete and add a comment at the extraction site instead.",
      "",
    ].join("\n")).toBe(false);
  });
});
