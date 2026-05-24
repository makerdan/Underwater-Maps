import { describe, it, expect } from "vitest";
import { PoeCreditsError, PoeRateLimitError, PoeAuthError, PoeInvalidRequestError, ZoneParseError, mapHttpStatusToError, } from "../errors.js";
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
