/**
 * apiClientMockSentinel.test.ts — mock/contract drift sentinel.
 *
 * The auto-stubbing Proxy in apiClientMock.ts classifies hooks by NAME
 * PATTERN (useGet* → query stub, usePost* → mutation stub, …). If a new
 * operation is added to the OpenAPI spec whose generated hook name does not
 * match any pattern, the mock silently returns a bare `noop` — components
 * under test then crash or, worse, render wrong states that assertions never
 * catch.
 *
 * This sentinel derives the AUTHORITATIVE classification from the real
 * generated client (`@workspace/api-client-react`):
 *   - a hook `useX` is a QUERY  iff the module also exports `getXQueryKey`
 *   - otherwise it is a MUTATION
 * and asserts the mock returns the correct stub shape for every hook export.
 *
 * WHEN THIS FAILS: a new hook name does not match the patterns in
 * apiClientMock.ts — extend the query/mutation regexes there so the new hook
 * gets the right default stub, then re-run this test.
 */
import { describe, it, expect } from "vitest";
import * as realClient from "@workspace/api-client-react";
import { makeApiClientMock } from "./apiClientMock.js";

const exportNames = Object.keys(realClient);
const hookNames = exportNames.filter(
  (n) => n.startsWith("use") && typeof (realClient as Record<string, unknown>)[n] === "function",
);

function classify(hook: string): "query" | "mutation" {
  const opName = hook.slice(3); // strip "use"
  return exportNames.includes(`get${opName}QueryKey`) ? "query" : "mutation";
}

const mock = makeApiClientMock() as Record<string, () => Record<string, unknown>>;

describe("apiClientMock ↔ generated client contract sentinel", () => {
  it("found a non-trivial number of hooks in the real client (sanity)", () => {
    expect(hookNames.length).toBeGreaterThan(20);
  });

  it("every generated hook gets the correct default stub from the mock", () => {
    const misclassified: string[] = [];

    for (const hook of hookNames) {
      const expected = classify(hook);
      const stub = mock[hook];
      const result = typeof stub === "function" ? stub() : undefined;

      const looksLikeQuery =
        !!result && typeof result === "object" && "isLoading" in result && !("mutate" in result);
      const looksLikeMutation =
        !!result && typeof result === "object" && "mutate" in result;

      if (expected === "query" && !looksLikeQuery) {
        misclassified.push(`${hook} — real client says QUERY, mock returns ${describeStub(result)}`);
      }
      if (expected === "mutation" && !looksLikeMutation) {
        misclassified.push(`${hook} — real client says MUTATION, mock returns ${describeStub(result)}`);
      }
    }

    expect(misclassified, [
      "",
      `${misclassified.length} generated hook(s) are misclassified by apiClientMock.ts:`,
      "",
      misclassified.map((m) => `  • ${m}`).join("\n"),
      "",
      "Fix: extend the query/mutation name-pattern regexes in",
      "src/__tests__/apiClientMock.ts so each hook gets the right default stub",
      "(query stub = { data, isLoading, isError }; mutation stub = { mutate, … }).",
      "",
    ].join("\n")).toEqual([]);
  });

  it("every generated *QueryKey helper is stubbed as a key factory (array)", () => {
    const broken: string[] = [];
    for (const name of exportNames) {
      if (!/^get[A-Z].*QueryKey$/.test(name)) continue;
      const stub = mock[name] as unknown as (...a: unknown[]) => unknown;
      const out = typeof stub === "function" ? stub("arg1") : undefined;
      if (!Array.isArray(out)) broken.push(name);
    }
    expect(broken, `QueryKey stubs must return arrays; broken: ${broken.join(", ")}`).toEqual([]);
  });
});

function describeStub(result: unknown): string {
  if (result === undefined) return "undefined (noop fallback — pattern miss)";
  if (result && typeof result === "object") {
    return `{ ${Object.keys(result).join(", ")} }`;
  }
  return String(result);
}
