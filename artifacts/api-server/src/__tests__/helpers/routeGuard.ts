/**
 * routeGuard.ts
 *
 * Shared structural guard against mis-merge corruption in Express routers.
 * A bad merge that pastes a route registration twice leaves the router with
 * the same (method, path) pair registered more than once — the second
 * registration is silently unreachable. `findDuplicateRoutes` walks a
 * router's layer stack and returns a human-readable list of duplicated
 * (method, path) pairs so a test can fail with a message naming them.
 */

interface RouteLayer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
}

interface RouterLike {
  stack?: unknown;
}

/**
 * Returns the router's layer stack, or null if Express internals changed and
 * the stack is no longer an array (callers should fail loudly on null).
 */
export function getRouterStack(router: unknown): RouteLayer[] | null {
  const stack = (router as RouterLike).stack;
  return Array.isArray(stack) ? (stack as RouteLayer[]) : null;
}

/**
 * Walks an Express router's layer stack and returns every (method, path)
 * pair registered more than once, formatted like `GET /foo (registered 2×)`.
 * An empty array means the router is clean.
 */
export function findDuplicateRoutes(router: unknown): string[] {
  const stack = getRouterStack(router);
  if (stack === null) {
    throw new Error(
      "Router has no layer stack array — Express internals changed? Update routeGuard.ts.",
    );
  }

  const seen = new Map<string, number>();
  for (const layer of stack) {
    const route = layer.route;
    if (!route) continue; // plain middleware layer
    const paths = Array.isArray(route.path) ? route.path : [route.path];
    for (const p of paths) {
      for (const method of Object.keys(route.methods).filter((m) => route.methods[m])) {
        const key = `${method.toUpperCase()} ${p}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
  }

  return [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([k, n]) => `${k} (registered ${n}×)`);
}

/**
 * Counts route-bearing layers (used as a sanity check that the router
 * actually registered something — an empty stack would make the duplicate
 * check pass vacuously).
 */
export function countRoutes(router: unknown): number {
  const stack = getRouterStack(router);
  if (stack === null) return 0;
  return stack.filter((layer) => layer.route).length;
}
