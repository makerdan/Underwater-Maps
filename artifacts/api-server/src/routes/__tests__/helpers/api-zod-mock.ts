/**
 * Complete @workspace/api-zod mock for route tests.
 *
 * Route tests often replace only the schemas they exercise.  Returning a plain
 * object makes every newly generated schema an eventual runtime crash when
 * app.ts mounts another router.  This proxy keeps the real export surface
 * available and supplies a safe no-op schema for exports a test does not use.
 */
type SchemaLike = {
  safeParse?: (value: unknown) => unknown;
  parse?: (value: unknown) => unknown;
};

const noErr = { issues: [] as never[] };

function fallbackSchema(name: string): SchemaLike {
  if (name.endsWith("Response") || name.endsWith("ResponseItem")) {
    return { parse: (value: unknown) => value };
  }
  return {
    safeParse: () => ({ success: false, error: noErr }),
    parse: (value: unknown) => value,
  };
}

export function createApiZodMock(
  actual: Record<string, unknown>,
  overrides: Record<string, unknown>,
) {
  const base = { ...actual, ...overrides };
  return new Proxy(base, {
    get(target, property, receiver) {
      if (typeof property !== "string") return Reflect.get(target, property, receiver);
      if (property in target) return Reflect.get(target, property, receiver);
      const fallback = fallbackSchema(property);
      target[property] = fallback;
      return fallback;
    },
  });
}

/**
 * Wrap a route test's stateful DB mock without requiring it to enumerate every
 * table export imported by app.ts. Existing entries remain authoritative; a
 * newly added table gets a harmless column proxy instead of an undefined
 * export and can be overridden only when a test actually needs its behavior.
 */
export function createCompleteDbMock<T extends Record<string, unknown>>(mock: T): T {
  return new Proxy(mock, {
    get(target, property, receiver) {
      if (typeof property !== "string") return Reflect.get(target, property, receiver);
      if (property in target) return Reflect.get(target, property, receiver);
      if (property.endsWith("Table")) {
        const tableTarget: Record<string, string> = { __tableName: property };
        const table = new Proxy(tableTarget, {
          get(tableTarget, column) {
            if (typeof column !== "string") return undefined;
            if (!(column in tableTarget)) tableTarget[column] = column;
            return tableTarget[column];
          },
        });
        Reflect.set(target, property, table);
        return table;
      }
      return undefined;
    },
  });
}