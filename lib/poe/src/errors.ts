export class PoeCreditsError extends Error {
  readonly httpStatus = 402;
  constructor(message = "Poe point balance is zero or negative — AI features unavailable") {
    super(message);
    this.name = "PoeCreditsError";
    Object.setPrototypeOf(this, PoeCreditsError.prototype);
  }
}

export class PoeRateLimitError extends Error {
  readonly httpStatus = 429;
  constructor(message = "Poe rate limit exceeded (500 req/min)") {
    super(message);
    this.name = "PoeRateLimitError";
    Object.setPrototypeOf(this, PoeRateLimitError.prototype);
  }
}

export class PoeAuthError extends Error {
  readonly httpStatus = 401;
  constructor(message = "Poe API key is invalid or missing") {
    super(message);
    this.name = "PoeAuthError";
    Object.setPrototypeOf(this, PoeAuthError.prototype);
  }
}

export class PoeInvalidRequestError extends Error {
  readonly httpStatus = 400;
  constructor(message: string) {
    super(message);
    this.name = "PoeInvalidRequestError";
    Object.setPrototypeOf(this, PoeInvalidRequestError.prototype);
  }
}

export class PoeModelUnavailableError extends Error {
  readonly httpStatus = 503;
  readonly code = "model_unavailable";
  constructor(message = "The configured Poe model is not currently available") {
    super(message);
    this.name = "PoeModelUnavailableError";
    Object.setPrototypeOf(this, PoeModelUnavailableError.prototype);
  }
}

export class PoeCapabilityError extends Error {
  readonly httpStatus = 400;
  readonly code = "unsupported_capability";
  constructor(message = "The selected Poe model does not support this request") {
    super(message);
    this.name = "PoeCapabilityError";
    Object.setPrototypeOf(this, PoeCapabilityError.prototype);
  }
}

export class PoeModelRegistryError extends Error {
  readonly httpStatus = 503;
  readonly code = "model_registry_unavailable";
  constructor(message = "Poe model verification is unavailable") {
    super(message);
    this.name = "PoeModelRegistryError";
    Object.setPrototypeOf(this, PoeModelRegistryError.prototype);
  }
}

export class ZoneParseError extends Error {
  readonly __isZoneParseError = true as const;
  constructor(message: string) {
    super(message);
    this.name = "ZoneParseError";
    Object.setPrototypeOf(this, ZoneParseError.prototype);
  }
}

export const POE_VERIFICATION_DIAGNOSTIC_TTL_MS = 15 * 60 * 1000;
export const POE_VERIFICATION_DIAGNOSTIC_MAX_ENTRIES = 12;

const POE_DIAGNOSTIC_ROUTES = [
  "classify",
  "help",
  "models",
  "query",
  "unknown",
  "upscale",
] as const;

export type PoeDiagnosticRoute = (typeof POE_DIAGNOSTIC_ROUTES)[number];
export type PoeVerificationFailureCode =
  | "model_registry_unavailable"
  | "model_unavailable";

export interface PoeVerificationDiagnostic {
  route: PoeDiagnosticRoute;
  code: PoeVerificationFailureCode;
  count: number;
  lastOccurredAt: string;
}

export interface PoeVerificationDiagnostics {
  windowMs: number;
  generatedAt: string;
  count: number;
  rows: PoeVerificationDiagnostic[];
}

interface PoeVerificationDiagnosticState {
  route: PoeDiagnosticRoute;
  code: PoeVerificationFailureCode;
  count: number;
  lastOccurredAt: number;
}

const poeVerificationDiagnostics = new Map<string, PoeVerificationDiagnosticState>();

function isPoeDiagnosticRoute(route: string): route is PoeDiagnosticRoute {
  return (POE_DIAGNOSTIC_ROUTES as readonly string[]).includes(route);
}

function pruneExpiredPoeVerificationDiagnostics(now: number): void {
  for (const [key, entry] of poeVerificationDiagnostics) {
    if (now - entry.lastOccurredAt >= POE_VERIFICATION_DIAGNOSTIC_TTL_MS) {
      poeVerificationDiagnostics.delete(key);
    }
  }
}

/**
 * Record only model verification failures in a bounded, short-lived counter.
 *
 * The original error is normalized only to select the stable failure code.
 * No provider message, prompt, token count, model identifier, or credential is
 * retained. Routes outside the known internal set collapse to "unknown".
 */
export function recordPoeVerificationFailure(
  route: string,
  error: unknown,
  now = Date.now(),
): void {
  const normalized = normalizePoeError(error);
  if (
    normalized.code !== "model_registry_unavailable" &&
    normalized.code !== "model_unavailable"
  ) {
    return;
  }

  pruneExpiredPoeVerificationDiagnostics(now);
  const safeRoute: PoeDiagnosticRoute = isPoeDiagnosticRoute(route) ? route : "unknown";
  const code = normalized.code as PoeVerificationFailureCode;
  const key = `${safeRoute}:${code}`;
  const existing = poeVerificationDiagnostics.get(key);

  if (existing) {
    existing.count += 1;
    existing.lastOccurredAt = now;
    return;
  }

  if (poeVerificationDiagnostics.size >= POE_VERIFICATION_DIAGNOSTIC_MAX_ENTRIES) {
    const oldest = [...poeVerificationDiagnostics.entries()]
      .sort(([, left], [, right]) => left.lastOccurredAt - right.lastOccurredAt)[0];
    if (oldest) poeVerificationDiagnostics.delete(oldest[0]);
  }

  poeVerificationDiagnostics.set(key, {
    route: safeRoute,
    code,
    count: 1,
    lastOccurredAt: now,
  });
}

export function getPoeVerificationDiagnostics(
  now = Date.now(),
): PoeVerificationDiagnostics {
  pruneExpiredPoeVerificationDiagnostics(now);
  const rows = [...poeVerificationDiagnostics.values()]
    .sort((left, right) => {
      if (right.lastOccurredAt !== left.lastOccurredAt) {
        return right.lastOccurredAt - left.lastOccurredAt;
      }
      return `${left.route}:${left.code}`.localeCompare(`${right.route}:${right.code}`);
    })
    .map((entry) => ({
      route: entry.route,
      code: entry.code,
      count: entry.count,
      lastOccurredAt: new Date(entry.lastOccurredAt).toISOString(),
    }));

  return {
    windowMs: POE_VERIFICATION_DIAGNOSTIC_TTL_MS,
    generatedAt: new Date(now).toISOString(),
    count: rows.length,
    rows,
  };
}

/** Test-only reset; production code should allow the TTL to expire naturally. */
export function __resetPoeVerificationDiagnosticsForTests(): void {
  poeVerificationDiagnostics.clear();
}

export interface NormalizedPoeError {
  status: number;
  code: string;
  message: string;
}

/**
 * Convert provider failures into a stable, client-safe error contract.
 *
 * Provider messages can contain request details or upstream response text.
 * Callers may log the original error server-side, but should return this
 * normalized value to an application client.
 */
export function normalizePoeError(error: unknown): NormalizedPoeError {
  if (error instanceof PoeCreditsError) {
    return { status: 402, code: "credits_exhausted", message: "AI credits are exhausted" };
  }
  if (error instanceof PoeRateLimitError) {
    return { status: 429, code: "rate_limit", message: "AI service rate limit reached" };
  }
  if (error instanceof PoeAuthError) {
    return { status: 401, code: "auth_error", message: "AI service authentication failed" };
  }
  if (error instanceof PoeCapabilityError) {
    return { status: 400, code: "unsupported_capability", message: "The selected AI model cannot perform this operation" };
  }
  if (error instanceof PoeModelUnavailableError) {
    return { status: 503, code: "model_unavailable", message: "The selected AI model is not currently available" };
  }
  if (error instanceof PoeModelRegistryError) {
    return { status: 503, code: "model_registry_unavailable", message: "AI model verification is temporarily unavailable" };
  }
  return { status: 500, code: "poe_error", message: "AI service error" };
}

export function mapHttpStatusToError(status: number, message: string): Error {
  switch (status) {
    case 401: return new PoeAuthError(message);
    case 402: return new PoeCreditsError(message);
    case 429: return new PoeRateLimitError(message);
    case 400: return new PoeInvalidRequestError(message);
    default: return new Error(`Poe API error ${status}: ${message}`);
  }
}
