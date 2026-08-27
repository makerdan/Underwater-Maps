export function getDocumentedUploadRoutes(yamlText: string): string[];

export function assertUploadRoutesInProductionBundle(
  bundleText: string,
  routes: string[],
): void;

export function buildAll(): Promise<void>;