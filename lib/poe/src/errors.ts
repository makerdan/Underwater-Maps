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

export class ZoneParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZoneParseError";
    Object.setPrototypeOf(this, ZoneParseError.prototype);
  }
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
