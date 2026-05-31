import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

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
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: [
      "artifacts/bathyscan/src/**/__tests__/**/*.{ts,tsx}",
      "artifacts/bathyscan/src/**/*.test.{ts,tsx}",
      "artifacts/bathyscan/src/**/*.spec.{ts,tsx}",
    ],
    plugins: {
      local: {
        rules: {
          "no-import-original-api-client": noImportOriginalApiClientRule,
        },
      },
    },
    rules: {
      "local/no-import-original-api-client": "error",
    },
  },
];
