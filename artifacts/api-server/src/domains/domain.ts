import type { IRouter } from "express";

/**
 * A mounted domain is the composition boundary for one API capability.
 *
 * Route files remain independently testable during the migration. New work
 * should depend on this contract instead of importing the application
 * bootstrap or another domain's router.
 */
export interface ApiDomain {
  readonly name: string;
  readonly router: IRouter;
}

export interface DomainMount {
  readonly router: IRouter;
  readonly prefix?: string;
}

export function createDomain(
  name: string,
  router: IRouter,
): ApiDomain {
  return Object.freeze({ name, router });
}