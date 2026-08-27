export const DOCUMENTED_BUNDLE_ROUTE_EXCLUSIONS: Readonly<Record<string, string>>;

export function getDocumentedApiRoutes(yamlText: string): string[];

export function getDocumentedUploadRoutes(yamlText: string): string[];

export function openApiPathToExpressPath(openApiPath: string): string;

export function assertApiRoutesInProductionBundle(
  bundleText: string,
  routes: string[],
): void;

export function assertUploadRoutesInProductionBundle(
  bundleText: string,
  routes: string[],
): void;

export function buildAll(): Promise<void>;