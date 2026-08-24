import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateOpenApiFile } from "../validate-openapi.mjs";

function withFixture(source, callback, fileName = "fixture.yaml") {
  const directory = mkdtempSync(join(tmpdir(), "openapi-validation-"));
  const fixture = join(directory, fileName);
  try {
    writeFileSync(fixture, source);
    return callback(fixture);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("validateOpenApiFile", () => {
  it("preserves an actionable duplicate-key parser diagnostic", () => {
    withFixture("openapi: 3.1.0\ninfo:\n  title: first\ninfo:\n  title: second\n", (fixture) => {
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
    }, "invalid-openapi.yaml");
  });

  it("accepts a representative valid OpenAPI document", () => {
    withFixture(`openapi: 3.1.0
info:
  title: Example
  version: 1.0.0
paths:
  /items/{id}:
    get:
      operationId: getItem
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
      responses:
        "200":
          description: An item
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Item"
components:
  schemas:
    Item:
      type: object
      required: [name]
      properties:
        name:
          type: string
`, (fixture) => assert.doesNotThrow(() => validateOpenApiFile(fixture)));
  });

  const invalidCases = [
    [
      "requires responses on every operation",
      `openapi: 3.1.0
info: {title: Example, version: 1.0.0}
paths: {/items: {get: {summary: Missing response}}}
`,
      "$.paths[\"/items\"].get.responses",
    ],
    [
      "rejects invalid path keys",
      `openapi: 3.1.0
info: {title: Example, version: 1.0.0}
paths: {items: {get: {responses: {\"200\": {description: ok}}}}}
`,
      "$.paths[\"items\"]",
    ],
    [
      "rejects unresolved local references",
      `openapi: 3.1.0
info: {title: Example, version: 1.0.0}
paths: {/items: {get: {responses: {\"200\": {description: ok, content: {application/json: {schema: {$ref: \"#/components/schemas/Missing\"}}}}}}}}
components: {schemas: {}}
`,
      "missing component",
    ],
    [
      "rejects incompatible schema shapes",
      `openapi: 3.1.0
info: {title: Example, version: 1.0.0}
paths: {/items: {get: {responses: {\"200\": {description: ok}}}}}
components: {schemas: {Broken: {type: object, items: {type: string}}}}
`,
      "$.components.schemas.Broken.items",
    ],
  ];

  for (const [name, source, expected] of invalidCases) {
    it(name, () => {
      withFixture(source, (fixture) => {
        assert.throws(
          () => validateOpenApiFile(fixture),
          (error) => {
            assert.match(error.message, /OpenAPI semantic validation failed/);
            assert.match(error.message, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
            return true;
          },
        );
      });
    });
  }
});