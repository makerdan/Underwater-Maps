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
