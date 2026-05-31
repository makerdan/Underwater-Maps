/**
 * Auto-stubbing mock factory for `@workspace/api-client-react`.
 *
 * ## Usage
 *
 * Vitest hoists `vi.mock(...)` calls before ES imports resolve, so you cannot
 * import this helper at the top of a test file and reference it directly in a
 * `vi.mock(...)` factory.  The reliable pattern is to copy the `vi.hoisted`
 * block below into your test file — it runs before any import or mock
 * processing.
 *
 * ```ts
 * // ---- paste at the TOP of your test file (before other imports) ----
 * const makeApiClientMock = vi.hoisted(() => {
 *   function noop() {}
 *   // NOTE: keep data:undefined — never use data:[] here.
 *   // An array literal creates a new reference on every call, which causes
 *   // useEffect([data]) loops that make act() hang forever in tests.
 *   function queryHook()    { return { data: undefined, isLoading: false, isError: false }; }
 *   function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
 *   return (overrides: Record<string, unknown> = {}) =>
 *     new Proxy(overrides, {
 *       get(t, p) {
 *         if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
 *         const k = String(p);
 *         if (k in t) return t[k];
 *         if (k.startsWith("useGet")) return queryHook;
 *         if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
 *         if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
 *           const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
 *           return (...a: unknown[]) => [label, ...a];
 *         }
 *         if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
 *           return (...a: unknown[]) => `/api/mock/${a.filter(Boolean).join("/")}`;
 *         return noop;
 *       },
 *       has(_t, p) { return typeof p !== "symbol"; },
 *     });
 * });
 * // ---- end paste ----
 *
 * // Then in your test:
 * vi.mock("@workspace/api-client-react", () =>
 *   makeApiClientMock({
 *     // Only override the hooks your test actually cares about:
 *     useGetDatasets: () => ({ data: myFixture, isLoading: false }),
 *   }),
 * );
 * ```
 *
 * ## What the proxy provides by default
 *
 *   useGet*           → () => ({ data: undefined, isLoading: false, isError: false })
 *   usePost/Put/…     → () => ({ mutate: noop, isPending: false, isSuccess: false, variables: undefined })
 *   getGet*QueryKey   → (...args) => [<label>, ...args]
 *   get*Url           → (...args) => `/api/mock/${args.join("/")}`
 *   anything else     → noop function
 *
 * Any export added to the generated client in the future is auto-covered —
 * only the hooks a test genuinely exercises need to be listed in `overrides`.
 *
 * ## Lint guard
 *
 * An ESLint rule (`local/no-import-original-api-client`) in `eslint.config.mjs`
 * at the repo root will error if any test file passes `importOriginal` as a
 * parameter to a `vi.mock("@workspace/api-client-react", ...)` factory.
 * That pattern is fragile because it requires every hook to be spread
 * explicitly; this Proxy approach handles additions automatically.
 *
 * ## Why vi.hoisted?
 *
 * `vi.mock(...)` factories are hoisted to the top of the compiled file before
 * regular imports run.  If you try to call a function from an `import`ed
 * module inside that factory you get a "Cannot access X before initialization"
 * error.  `vi.hoisted(fn)` is the Vitest-provided escape hatch: its callback
 * executes during the hoisting phase, so any value it returns is available to
 * the synchronous `vi.mock(...)` factory immediately.
 */

type AnyFn = (...args: unknown[]) => unknown;
export type ApiClientOverrides = Record<string, AnyFn | unknown>;

function noop() {}

/**
 * IMPORTANT: must return `data: undefined`, never `data: []` (or any empty
 * array / object literal).
 *
 * Why: components like FindDataPanel accumulate paginated results with a
 * `useEffect([data])` that appends each new page into local state.  When
 * `data` is an array literal, every call to this function returns a *new*
 * reference, so React sees a changed dependency on every render, schedules
 * another setState, and the component re-renders forever — causing `act()`
 * in tests to hang indefinitely and never settle.
 *
 * `undefined` is a stable identity (same value every call) so the effect
 * runs exactly once (on mount), the state is never updated, and the test
 * exits cleanly.
 */
function defaultQueryHook() {
  return { data: undefined, isLoading: false, isError: false };
}

function defaultMutationHook() {
  return {
    mutate: noop,
    mutateAsync: noop,
    isPending: false,
    isSuccess: false,
    variables: undefined,
  };
}

/**
 * Returns a Proxy that stubs every export of `@workspace/api-client-react`
 * based on naming conventions.  Pass per-hook overrides for the handful of
 * hooks a particular test needs to exercise with specific data.
 *
 * NOTE: do not call this from inside a synchronous `vi.mock(...)` factory
 * unless it was obtained via `vi.hoisted(...)` — see the usage comment above.
 */
export function makeApiClientMock(
  overrides: ApiClientOverrides = {},
): Record<string, unknown> {
  return new Proxy(overrides as Record<string, unknown>, {
    get(target, prop: string | symbol) {
      // Prevent Vitest/Promise machinery from treating the mock as a thenable.
      if (
        typeof prop === "symbol" ||
        prop === "then" ||
        prop === "catch" ||
        prop === "finally"
      ) {
        return undefined;
      }

      const key = prop;

      if (key in target) return target[key];

      if (key.startsWith("useGet")) return defaultQueryHook;
      if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(key))
        return defaultMutationHook;

      if (key.startsWith("getGet") && key.endsWith("QueryKey")) {
        const label = key.replace(/^getGet/, "").replace(/QueryKey$/, "");
        return (...args: unknown[]) => [label, ...args];
      }

      if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(key)) {
        return (...args: unknown[]) =>
          `/api/mock/${args.filter(Boolean).join("/")}`;
      }

      return noop;
    },

    has(_target, prop: string | symbol) {
      return typeof prop !== "symbol";
    },
  });
}
