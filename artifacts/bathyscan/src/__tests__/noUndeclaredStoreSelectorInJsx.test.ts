// @vitest-environment node
/**
 * Tests for the `no-undeclared-store-selector-in-jsx` ESLint rule.
 *
 * Covers both the original simple selector pattern and the extended patterns
 * added to extractFields():
 *   - Object expression: (s) => ({ key: s.FIELD })
 *   - Nullish coalescing: (s) => s.FIELD ?? default
 *   - Logical OR / AND: (s) => s.FIELD || default, (s) => s.FIELD && expr
 *   - Unary not: (s) => !s.FIELD
 *   - Boolean() call: (s) => Boolean(s.FIELD)
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { noUndeclaredStoreSelectorInJsx } from "../../../../eslint.config.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
  },
});

describe("no-undeclared-store-selector-in-jsx — simple selector (s) => s.FIELD", () => {
  it("passes valid cases and reports invalid cases", () => {
    ruleTester.run(
      "no-undeclared-store-selector-in-jsx",
      noUndeclaredStoreSelectorInJsx,
      {
        valid: [
          {
            name: "declared const with simple selector — no error",
            code: `
              const sidebarMode = useUiStore((s) => s.sidebarMode);
              function Comp() { return <div>{sidebarMode}</div>; }
            `,
          },
          {
            name: "field only used in selector, not in JSX — no error",
            code: `
              const x = useUiStore((s) => s.sidebarMode);
              function Comp() { return <div>{x}</div>; }
            `,
          },
          {
            name: "field in JSX but not a known selector field — no error",
            code: `
              const unknownVar = 'hello';
              function Comp() { return <div>{unknownVar}</div>; }
            `,
          },
        ],
        invalid: [
          {
            name: "simple selector field referenced in JSX without const declaration",
            code: `
              useUiStore((s) => s.sidebarMode);
              function Comp() { return <div>{sidebarMode}</div>; }
            `,
            errors: [{ messageId: "missing", data: { name: "sidebarMode" } }],
          },
        ],
      },
    );
  });
});

describe("no-undeclared-store-selector-in-jsx — object expression (s) => ({ key: s.FIELD })", () => {
  it("passes valid cases and reports invalid cases", () => {
    ruleTester.run(
      "no-undeclared-store-selector-in-jsx",
      noUndeclaredStoreSelectorInJsx,
      {
        valid: [
          {
            name: "object selector with declared const — no error",
            code: `
              const sidebarMode = useUiStore((s) => ({ sidebarMode: s.sidebarMode }));
              function Comp() { return <div>{sidebarMode}</div>; }
            `,
          },
          {
            name: "multi-field object selector, both declared — no error",
            code: `
              const a = useUiStore((s) => ({ fieldA: s.fieldA, fieldB: s.fieldB }));
              const b = useUiStore((s) => s.fieldB);
              function Comp() { return <div>{a}{b}</div>; }
            `,
          },
        ],
        invalid: [
          {
            name: "object selector with undeclared field used in JSX",
            code: `
              useUiStore((s) => ({ sidebarMode: s.sidebarMode }));
              function Comp() { return <div>{sidebarMode}</div>; }
            `,
            errors: [{ messageId: "missing", data: { name: "sidebarMode" } }],
          },
          {
            name: "multi-field object selector, one undeclared field used in JSX",
            code: `
              useUiStore((s) => ({ fieldA: s.fieldA, fieldB: s.fieldB }));
              const fieldA = useUiStore((s) => s.fieldA);
              function Comp() { return <div>{fieldA}{fieldB}</div>; }
            `,
            errors: [{ messageId: "missing", data: { name: "fieldB" } }],
          },
        ],
      },
    );
  });
});

describe("no-undeclared-store-selector-in-jsx — nullish coalescing (s) => s.FIELD ?? default", () => {
  it("passes valid cases and reports invalid cases", () => {
    ruleTester.run(
      "no-undeclared-store-selector-in-jsx",
      noUndeclaredStoreSelectorInJsx,
      {
        valid: [
          {
            name: "nullish selector with declared const — no error",
            code: `
              const sidebarMode = useUiStore((s) => s.sidebarMode ?? 'explore');
              function Comp() { return <div>{sidebarMode}</div>; }
            `,
          },
        ],
        invalid: [
          {
            name: "nullish selector with undeclared field used in JSX",
            code: `
              useUiStore((s) => s.sidebarMode ?? 'explore');
              function Comp() { return <div>{sidebarMode}</div>; }
            `,
            errors: [{ messageId: "missing", data: { name: "sidebarMode" } }],
          },
        ],
      },
    );
  });
});

describe("no-undeclared-store-selector-in-jsx — logical OR/AND (s) => s.FIELD || x, (s) => s.FIELD && x", () => {
  it("passes valid cases and reports invalid cases", () => {
    ruleTester.run(
      "no-undeclared-store-selector-in-jsx",
      noUndeclaredStoreSelectorInJsx,
      {
        valid: [
          {
            name: "OR selector with declared const — no error",
            code: `
              const isOpen = useUiStore((s) => s.isOpen || false);
              function Comp() { return <div>{isOpen}</div>; }
            `,
          },
          {
            name: "AND selector with declared const — no error",
            code: `
              const isReady = useUiStore((s) => s.isReady && s.isOpen);
              function Comp() { return <div>{isReady}</div>; }
            `,
          },
        ],
        invalid: [
          {
            name: "OR selector with undeclared field used in JSX",
            code: `
              useUiStore((s) => s.isOpen || false);
              function Comp() { return <div>{isOpen}</div>; }
            `,
            errors: [{ messageId: "missing", data: { name: "isOpen" } }],
          },
        ],
      },
    );
  });
});

describe("no-undeclared-store-selector-in-jsx — unary not (s) => !s.FIELD", () => {
  it("passes valid cases and reports invalid cases", () => {
    ruleTester.run(
      "no-undeclared-store-selector-in-jsx",
      noUndeclaredStoreSelectorInJsx,
      {
        valid: [
          {
            name: "unary-not selector with declared const — no error",
            code: `
              const isHidden = useUiStore((s) => !s.isVisible);
              function Comp() { return <div>{isHidden}</div>; }
            `,
          },
        ],
        invalid: [
          {
            name: "unary-not selector with undeclared field used in JSX",
            code: `
              useUiStore((s) => !s.isVisible);
              function Comp() { return <div>{isVisible}</div>; }
            `,
            errors: [{ messageId: "missing", data: { name: "isVisible" } }],
          },
        ],
      },
    );
  });
});

describe("no-undeclared-store-selector-in-jsx — Boolean() call (s) => Boolean(s.FIELD)", () => {
  it("passes valid cases and reports invalid cases", () => {
    ruleTester.run(
      "no-undeclared-store-selector-in-jsx",
      noUndeclaredStoreSelectorInJsx,
      {
        valid: [
          {
            name: "Boolean() selector with declared const — no error",
            code: `
              const hasData = useUiStore((s) => Boolean(s.dataset));
              function Comp() { return <div>{hasData}</div>; }
            `,
          },
        ],
        invalid: [
          {
            name: "Boolean() selector with undeclared field used in JSX",
            code: `
              useUiStore((s) => Boolean(s.dataset));
              function Comp() { return <div>{dataset}</div>; }
            `,
            errors: [{ messageId: "missing", data: { name: "dataset" } }],
          },
        ],
      },
    );
  });
});

describe("no-undeclared-store-selector-in-jsx — zero false positives on mixed patterns", () => {
  it("does not flag identifiers that are fully declared even with complex selectors", () => {
    ruleTester.run(
      "no-undeclared-store-selector-in-jsx",
      noUndeclaredStoreSelectorInJsx,
      {
        valid: [
          {
            name: "mix of simple and complex selectors, all declared — no errors",
            code: `
              const sidebarMode = useUiStore((s) => s.sidebarMode ?? 'explore');
              const isVisible = useUiStore((s) => Boolean(s.isVisible));
              const isHidden = useUiStore((s) => !s.isHidden);
              const label = useUiStore((s) => ({ label: s.label }));
              function Comp() {
                return <div>{sidebarMode}{isVisible}{isHidden}{label}</div>;
              }
            `,
          },
          {
            name: "selector field only inside event handler — no error",
            code: `
              useUiStore((s) => s.sidebarMode);
              function Comp() {
                return <button onClick={() => console.log(sidebarMode)}>x</button>;
              }
            `,
          },
        ],
        invalid: [],
      },
    );
  });
});
