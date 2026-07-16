import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Custom rule: catch JSX references to store-derived variables that have no
 * matching `const X = use*Store(...)` hook declaration in the file.
 *
 * This prevents the "sidebarMode incident" where JSX usages of a store field
 * were added without the corresponding hook const, causing TS2304 only at
 * build time instead of during lint/dev.
 *
 * How it works:
 *  1. Collects every `const X = use*Store((s) => s.FIELD)` declaration:
 *     - FIELD is added to `selectorFields` (we know it's a store field)
 *     - X is added to `declaredVars` (it has a hook declaration)
 *  2. Collects every store-selector call even without a const binding, so
 *     that any bare `s.FIELD` reference populates `selectorFields`.
 *  3. Collects all variable declarator IDs at any level into `declaredVars`
 *     to avoid false positives from non-hook declarations.
 *  4. Tracks Identifier nodes referenced inside JSXExpressionContainers,
 *     skipping inner function bodies (event handlers, callbacks) since those
 *     have their own scope.
 *  5. At Program:exit, reports any JSX identifier whose name is in
 *     `selectorFields` (known store field) but NOT in `declaredVars`
 *     (no hook declaration exists for it).
 *
 * Coverage: catches the "I added {newField} to JSX and also used s.newField
 * in another selector but forgot the const newField = useXxxStore(...) line."
 * TypeScript's TS2304 (run via `pnpm typecheck`) covers the complementary
 * case where the identifier is completely new with no selector reference at all.
 */
const noUndeclaredStoreSelectorInJsx = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Detect JSX identifiers that match a store selector field but have no hook declaration (const X = use*Store(...)) in the file.",
    },
    messages: {
      missing:
        "'{{name}}' is used in JSX and is a known store selector field, but " +
        "no 'const {{name}} = use*Store(...)' declaration was found. " +
        "Add the hook declaration to avoid a silent TS2304 error at build time.",
    },
    schema: [],
  },
  create(context) {
    const selectorFields = new Set();
    const declaredVars = new Set();
    const jsxIdents = [];
    let jsxExprDepth = 0;
    let innerFnDepth = 0;

    function isStoreHook(name) {
      return /^use[A-Z]\w*Store$/.test(name);
    }

    function extractSimpleField(selectorArg) {
      if (!selectorArg) return null;
      if (
        selectorArg.type !== "ArrowFunctionExpression" &&
        selectorArg.type !== "FunctionExpression"
      )
        return null;
      const body = selectorArg.body;
      if (
        body.type === "MemberExpression" &&
        !body.computed &&
        body.object.type === "Identifier" &&
        body.property.type === "Identifier"
      ) {
        return body.property.name;
      }
      return null;
    }

    function collectDeclaredIds(pattern) {
      if (!pattern) return;
      if (pattern.type === "Identifier") {
        declaredVars.add(pattern.name);
      } else if (pattern.type === "ObjectPattern") {
        for (const prop of pattern.properties ?? []) {
          if (prop.type === "RestElement") {
            collectDeclaredIds(prop.argument);
          } else {
            collectDeclaredIds(prop.value);
          }
        }
      } else if (pattern.type === "ArrayPattern") {
        for (const elem of pattern.elements ?? []) {
          if (elem) collectDeclaredIds(elem);
        }
      } else if (pattern.type === "AssignmentPattern") {
        collectDeclaredIds(pattern.left);
      } else if (pattern.type === "RestElement") {
        collectDeclaredIds(pattern.argument);
      }
    }

    return {
      VariableDeclarator(node) {
        collectDeclaredIds(node.id);
        if (
          node.init?.type === "CallExpression" &&
          node.init.callee.type === "Identifier" &&
          isStoreHook(node.init.callee.name)
        ) {
          const field = extractSimpleField(node.init.arguments[0]);
          if (field) selectorFields.add(field);
        }
      },

      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          isStoreHook(node.callee.name)
        ) {
          const field = extractSimpleField(node.arguments[0]);
          if (field) selectorFields.add(field);
        }
      },

      JSXExpressionContainer() {
        jsxExprDepth++;
      },
      "JSXExpressionContainer:exit"() {
        jsxExprDepth--;
      },

      FunctionDeclaration(node) {
        for (const p of node.params ?? []) collectDeclaredIds(p);
      },
      FunctionExpression(node) {
        for (const p of node.params ?? []) collectDeclaredIds(p);
        if (jsxExprDepth > 0) innerFnDepth++;
      },
      "FunctionExpression:exit"() {
        if (jsxExprDepth > 0) innerFnDepth--;
      },
      ArrowFunctionExpression(node) {
        for (const p of node.params ?? []) collectDeclaredIds(p);
        if (jsxExprDepth > 0) innerFnDepth++;
      },
      "ArrowFunctionExpression:exit"() {
        if (jsxExprDepth > 0) innerFnDepth--;
      },

      Identifier(node) {
        if (jsxExprDepth === 0 || innerFnDepth > 0) return;
        const parent = node.parent;
        if (
          parent?.type === "MemberExpression" &&
          parent.property === node &&
          !parent.computed
        )
          return;
        if (
          parent?.type === "Property" &&
          parent.key === node &&
          !parent.computed
        )
          return;
        if (parent?.type === "JSXAttribute") return;
        if (parent?.type === "LabeledStatement") return;
        jsxIdents.push({ name: node.name, node });
      },

      "Program:exit"() {
        for (const { name, node } of jsxIdents) {
          if (selectorFields.has(name) && !declaredVars.has(name)) {
            context.report({
              node,
              messageId: "missing",
              data: { name },
            });
          }
        }
      },
    };
  },
};

/**
 * Custom rule: forbid `importOriginal` inside vi.mock("@workspace/api-client-react")
 * factories.  Use makeApiClientMock() from src/__tests__/apiClientMock.ts instead —
 * the Proxy-based helper automatically covers every hook without needing to spread
 * the real module.
 *
 * See: artifacts/bathyscan/src/__tests__/apiClientMock.ts
 */
const noImportOriginalApiClientRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importOriginal inside vi.mock('@workspace/api-client-react') factories.",
    },
    messages: {
      forbidden:
        "Do not pass importOriginal to a vi.mock('@workspace/api-client-react') factory. " +
        "Use makeApiClientMock() from src/__tests__/apiClientMock.ts instead — " +
        "the Proxy covers every hook automatically and never breaks when new hooks are added.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee, arguments: args } = node;

        // Must be vi.mock(...)
        if (
          callee.type !== "MemberExpression" ||
          callee.object.type !== "Identifier" ||
          callee.object.name !== "vi" ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "mock"
        ) {
          return;
        }

        const [moduleArg, factoryArg] = args;

        // First argument must be the literal "@workspace/api-client-react"
        if (
          !moduleArg ||
          moduleArg.type !== "Literal" ||
          moduleArg.value !== "@workspace/api-client-react"
        ) {
          return;
        }

        // Factory arg must exist and be a function
        if (
          !factoryArg ||
          (factoryArg.type !== "ArrowFunctionExpression" &&
            factoryArg.type !== "FunctionExpression")
        ) {
          return;
        }

        // Flag if any parameter is named "importOriginal"
        const hasImportOriginal = (factoryArg.params ?? []).some(
          (p) => p.type === "Identifier" && p.name === "importOriginal",
        );

        if (hasImportOriginal) {
          context.report({ node: factoryArg, messageId: "forbidden" });
        }
      },
    };
  },
};

const localPlugin = {
  rules: {
    "no-import-original-api-client": noImportOriginalApiClientRule,
    "no-undeclared-store-selector-in-jsx": noUndeclaredStoreSelectorInJsx,
  },
};

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/generated/**",
      "**/.vite/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["tests/e2e/**/*.spec.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              message:
                "Import `test` and `expect` from './fixtures' instead of '@playwright/test' so the auto-reset fixture is always active.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["artifacts/bathyscan/src/**/*.{ts,tsx}", "artifacts/api-server/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-redeclare": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["artifacts/bathyscan/src/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: { local: localPlugin },
    rules: {
      "local/no-undeclared-store-selector-in-jsx": "error",
    },
  },
  {
    files: [
      "artifacts/bathyscan/src/**/__tests__/**/*.{ts,tsx}",
      "artifacts/bathyscan/src/**/*.test.{ts,tsx}",
      "artifacts/bathyscan/src/**/*.spec.{ts,tsx}",
    ],
    plugins: { local: localPlugin },
    rules: {
      "local/no-import-original-api-client": "error",
    },
  },
];
