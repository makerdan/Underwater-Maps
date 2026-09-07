import { describe, it, expect, beforeEach } from "vitest";
import {
  PoeCapabilityError,
  PoeCreditsError,
  PoeModelRegistryError,
  PoeModelUnavailableError,
  PoeRateLimitError,
  PoeAuthError,
  PoeInvalidRequestError,
  ZoneParseError,
  mapHttpStatusToError,
  normalizePoeError,
  __resetPoeVerificationDiagnosticsForTests,
  getPoeVerificationDiagnostics,
  recordPoeVerificationFailure,
} from "../errors.js";

describe("PoeCreditsError", () => {
  it("has correct httpStatus and name", () => {
    const err = new PoeCreditsError();
    expect(err.httpStatus).toBe(402);
    expect(err.name).toBe("PoeCreditsError");
    expect(err instanceof Error).toBe(true);
  });
});

describe("PoeRateLimitError", () => {
  it("has correct httpStatus and name", () => {
    const err = new PoeRateLimitError();
    expect(err.httpStatus).toBe(429);
    expect(err.name).toBe("PoeRateLimitError");
  });
});

describe("PoeAuthError", () => {
  it("has correct httpStatus and name", () => {
    const err = new PoeAuthError();
    expect(err.httpStatus).toBe(401);
    expect(err.name).toBe("PoeAuthError");
  });
});

describe("PoeInvalidRequestError", () => {
  it("has correct httpStatus and name", () => {
    const err = new PoeInvalidRequestError("bad param");
    expect(err.httpStatus).toBe(400);
    expect(err.message).toBe("bad param");
  });
});

describe("ZoneParseError", () => {
  it("has correct name", () => {
    const err = new ZoneParseError("invalid zone");
    expect(err.name).toBe("ZoneParseError");
    expect(err.message).toBe("invalid zone");
  });
});

describe("mapHttpStatusToError", () => {
  it("maps 401 to PoeAuthError", () => {
    expect(mapHttpStatusToError(401, "x")).toBeInstanceOf(PoeAuthError);
  });
  it("maps 402 to PoeCreditsError", () => {
    expect(mapHttpStatusToError(402, "x")).toBeInstanceOf(PoeCreditsError);
  });
  it("maps 429 to PoeRateLimitError", () => {
    expect(mapHttpStatusToError(429, "x")).toBeInstanceOf(PoeRateLimitError);
  });
  it("maps 400 to PoeInvalidRequestError", () => {
    expect(mapHttpStatusToError(400, "bad")).toBeInstanceOf(PoeInvalidRequestError);
  });
  it("maps unknown status to generic Error", () => {
    const err = mapHttpStatusToError(503, "oops");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("503");
  });
});

describe("normalizePoeError", () => {
  it("returns stable, client-safe codes for registry failures", () => {
    expect(normalizePoeError(new PoeModelUnavailableError("retired model id"))).toEqual({
      status: 503,
      code: "model_unavailable",
      message: "The selected AI model is not currently available",
    });
    expect(normalizePoeError(new PoeCapabilityError("unsupported field"))).toEqual({
      status: 400,
      code: "unsupported_capability",
      message: "The selected AI model cannot perform this operation",
    });
    expect(normalizePoeError(new PoeModelRegistryError("upstream details"))).toEqual({
      status: 503,
      code: "model_registry_unavailable",
      message: "AI model verification is temporarily unavailable",
    });
  });

  it("does not expose arbitrary provider error messages", () => {
    expect(normalizePoeError(new Error("Bearer secret or prompt data"))).toEqual({
      status: 500,
      code: "poe_error",
      message: "AI service error",
    });
  });
});

describe("Poe verification diagnostics", () => {
  beforeEach(() => {
    __resetPoeVerificationDiagnosticsForTests();
  });

  it("counts repeated registry failures without retaining sensitive details", () => {
    recordPoeVerificationFailure(
      "query",
      new PoeModelRegistryError("prompt=secret Bearer sk-secret"),
      1_000,
    );
    recordPoeVerificationFailure(
      "query",
      new PoeModelRegistryError("provider response with tokens"),
      2_000,
    );

    expect(getPoeVerificationDiagnostics(2_000)).toEqual({
      windowMs: 15 * 60 * 1000,
      generatedAt: "1970-01-01T00:00:02.000Z",
      count: 1,
      rows: [{
        route: "query",
        code: "model_registry_unavailable",
        count: 2,
        lastOccurredAt: "1970-01-01T00:00:02.000Z",
      }],
    });
    expect(JSON.stringify(getPoeVerificationDiagnostics(2_000))).not.toMatch(
      /secret|Bearer|prompt|tokens/,
    );
  });

  it("keeps cardinality bounded and collapses unknown routes", () => {
    for (let index = 0; index < 100; index += 1) {
      recordPoeVerificationFailure(
        `untrusted-route-${index}`,
        new PoeModelUnavailableError(`retired-model-${index}`),
        index + 1,
      );
    }

    const diagnostics = getPoeVerificationDiagnostics(100);
    expect(diagnostics.count).toBe(1);
    expect(diagnostics.rows[0]).toMatchObject({
      route: "unknown",
      code: "model_unavailable",
      count: 100,
    });
  });

  it("expires old entries and supports a clean reset", () => {
    recordPoeVerificationFailure("help", new PoeModelUnavailableError(), 1_000);
    expect(getPoeVerificationDiagnostics(1_000).count).toBe(1);
    expect(getPoeVerificationDiagnostics(1_000 + 15 * 60 * 1000).count).toBe(0);

    recordPoeVerificationFailure("help", new PoeModelUnavailableError(), 2_000);
    __resetPoeVerificationDiagnosticsForTests();
    expect(getPoeVerificationDiagnostics(2_000).count).toBe(0);
  });

  it("ignores unrelated Poe failures", () => {
    recordPoeVerificationFailure("query", new PoeCapabilityError("unsupported"), 1_000);
    expect(getPoeVerificationDiagnostics(1_000).count).toBe(0);
  });
});
