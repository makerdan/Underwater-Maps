import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockConnect, mockRows } = vi.hoisted(() => {
  const mockRows: Array<{
    route: string;
    code: string;
    count: number;
    last_occurred_at: Date;
  }> = [];
  const mockQuery = vi.fn(async (query: string) => ({
    rows: query.includes("SELECT route, code, count, last_occurred_at")
      ? [...mockRows]
      : [],
  }));
  const client = { query: mockQuery, release: vi.fn() };
  const mockConnect = vi.fn(async () => client);
  return { mockQuery, mockConnect, mockRows };
});

vi.mock("@workspace/db", () => ({
  pool: { connect: mockConnect },
}));

import {
  __resetPoeVerificationDiagnosticsForTests,
  getPoeVerificationDiagnostics,
  PoeModelRegistryError,
  recordPoeVerificationFailure,
} from "@workspace/poe";
import "./../poeVerificationDiagnostics.js";

describe("durable Poe verification diagnostics adapter", () => {
  beforeEach(() => {
    mockRows.length = 0;
    mockQuery.mockClear();
    mockConnect.mockClear();
    __resetPoeVerificationDiagnosticsForTests();
  });

  it("commits aggregate writes under a shared lock and reads shared persisted rows", async () => {
    await recordPoeVerificationFailure(
      "query",
      new PoeModelRegistryError("sensitive provider detail"),
    );
    const statements = mockQuery.mock.calls.map(([query]) => query);
    expect(statements).toContain("BEGIN");
    expect(statements).toContain("SELECT pg_advisory_xact_lock($1::bigint)");
    expect(statements).toContainEqual(expect.stringContaining("INSERT INTO poe_verification_diagnostics"));
    expect(statements).toContainEqual(expect.stringContaining("DELETE FROM poe_verification_diagnostics"));
    expect(statements).toContain("COMMIT");

    mockRows.push({
      route: "query",
      code: "model_registry_unavailable",
      count: 7,
      last_occurred_at: new Date("2026-09-27T12:00:00.000Z"),
    });
    __resetPoeVerificationDiagnosticsForTests();
    const diagnostics = await getPoeVerificationDiagnostics(
      new Date("2026-09-27T12:01:00.000Z").getTime(),
    );

    expect(diagnostics.rows).toEqual([{
      route: "query",
      code: "model_registry_unavailable",
      count: 7,
      lastOccurredAt: "2026-09-27T12:00:00.000Z",
    }]);
    expect(mockQuery.mock.calls.map(([query]) => query)).toContainEqual(
      expect.stringContaining("LIMIT $2"),
    );
  });
});