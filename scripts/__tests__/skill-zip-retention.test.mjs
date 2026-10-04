import test from "node:test";
import assert from "node:assert/strict";
import { RETENTION_MS, expirationFrom, isExpired } from "../skill-zip-retention.mjs";

test("skill ZIP archives expire exactly seven days after supersession", () => {
  const supersededAt = "2026-10-04T12:00:00.000Z";
  const expiresAt = expirationFrom(supersededAt);
  const expiresMs = Date.parse(expiresAt);

  assert.equal(expiresMs - Date.parse(supersededAt), RETENTION_MS);
  assert.equal(isExpired({ expiresAt }, expiresMs - 1), false);
  assert.equal(isExpired({ expiresAt }, expiresMs), true);
});

test("skill ZIP retention rejects invalid timestamps", () => {
  assert.throws(() => expirationFrom("not-a-date"), /Invalid supersededAt/);
  assert.throws(() => isExpired({ expiresAt: "not-a-date" }), /Invalid expiresAt/);
});