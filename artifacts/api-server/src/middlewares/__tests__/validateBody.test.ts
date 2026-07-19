/**
 * validateBody.test.ts
 *
 * Verifies that the validateBody middleware factory:
 *   - calls next() and populates res.locals.parsedBody for a valid body,
 *   - returns 400, does NOT call next(), and emits logger.warn for an
 *     invalid body,
 *   - never echoes raw user input (the .received field) in logs or
 *     in the 400 response issues array.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

vi.mock("../../lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { validateBody, sanitizeZodIssue } from "../validateBody.js";
import { logger } from "../../lib/logger.js";

// ─── Test schema ──────────────────────────────────────────────────────────────

const TestSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().positive(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReqResNext(body: unknown): {
  req: Request;
  res: Response;
  next: NextFunction;
} {
  const req = { body } as Request;
  const locals: Record<string, unknown> = {};
  const res = {
    locals,
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("validateBody middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls next() and sets res.locals.parsedBody for a valid body", () => {
    const { req, res, next } = makeReqResNext({ name: "Halibut spot", count: 3 });
    const middleware = validateBody(TestSchema, "POST /api/test");
    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((res.locals as Record<string, unknown>).parsedBody).toEqual({
      name: "Halibut spot",
      count: 3,
    });
    expect(logger.warn).not.toHaveBeenCalled();
    expect((res.status as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call next() for an invalid body", () => {
    const { req, res, next } = makeReqResNext({ name: "", count: -1 });
    const middleware = validateBody(TestSchema, "POST /api/test");
    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_request", details: expect.any(String) }),
    );
  });

  it("emits logger.warn with route label and sanitized issues on validation failure", () => {
    const { req, res, next } = makeReqResNext({ name: "", count: "bad" });
    const middleware = validateBody(TestSchema, "POST /api/markers");
    middleware(req, res, next);

    expect(logger.warn).toHaveBeenCalledOnce();

    const [logObj, logMsg] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(logMsg).toContain("POST /api/markers");
    expect(logObj).toHaveProperty("route", "POST /api/markers");
    expect(logObj).toHaveProperty("issues");

    // Issues in the server log must only carry path + code, never .received
    const loggedIssues = logObj["issues"] as Array<Record<string, unknown>>;
    for (const issue of loggedIssues) {
      expect(issue).not.toHaveProperty("received");
      expect(issue).toHaveProperty("path");
      expect(issue).toHaveProperty("code");
    }
  });

  it("does not echo raw user input in the 400 response issues", () => {
    const maliciousInput = "'; DROP TABLE markers; --";
    const { req, res, next } = makeReqResNext({ name: maliciousInput, count: "not-a-number" });
    const middleware = validateBody(TestSchema, "POST /api/test");
    middleware(req, res, next);

    const firstCall = (res.json as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall).toBeDefined();
    const response = firstCall![0] as {
      issues: Array<Record<string, unknown>>;
    };
    for (const issue of response.issues) {
      expect(issue).not.toHaveProperty("received");
    }
    // Raw user input must not appear in the sanitized details string either
    const details = (response as Record<string, unknown>)["details"] as string;
    expect(details).not.toContain(maliciousInput);
  });

  it("includes route label and method in the sanitized details string", () => {
    const { req, res, next } = makeReqResNext({ name: "" });
    const middleware = validateBody(TestSchema, "POST /api/catches");
    middleware(req, res, next);

    const [, logMsg] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      string,
    ];
    expect(logMsg).toContain("POST /api/catches");
  });
});

describe("sanitizeZodIssue", () => {
  it("removes the received field while preserving path, code, and message", () => {
    const issue = {
      path: ["count"],
      code: "invalid_type",
      message: "Expected number, received string",
      received: "string",
      expected: "number",
    };
    const safe = sanitizeZodIssue(issue);
    expect(safe).not.toHaveProperty("received");
    expect(safe).toHaveProperty("path", ["count"]);
    expect(safe).toHaveProperty("code", "invalid_type");
    expect(safe).toHaveProperty("message");
    expect(safe).toHaveProperty("expected", "number");
  });

  it("is a no-op when received is not present", () => {
    const issue = { path: ["name"], code: "too_small", message: "String must contain at least 1 character(s)" };
    const safe = sanitizeZodIssue(issue);
    expect(safe).toEqual(issue);
  });
});
