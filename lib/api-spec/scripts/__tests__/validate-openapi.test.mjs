import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateOpenApiFile } from "../validate-openapi.mjs";

describe("validateOpenApiFile", () => {
  it("preserves an actionable duplicate-key parser diagnostic", () => {
    const directory = mkdtempSync(join(tmpdir(), "openapi-validation-"));
    const fixture = join(directory, "invalid-openapi.yaml");

    try {
      writeFileSync(fixture, "openapi: 3.1.0\ninfo:\n  title: first\ninfo:\n  title: second\n");

      assert.throws(
        () => validateOpenApiFile(fixture),
        (error) => {
          assert.match(error.message, /OpenAPI YAML validation failed/);
          assert.match(error.message, /duplicated mapping key/i);
          assert.match(error.message, /invalid-openapi\.yaml/);
          assert.match(error.message, /line 4, column 1/);
          return true;
        },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});