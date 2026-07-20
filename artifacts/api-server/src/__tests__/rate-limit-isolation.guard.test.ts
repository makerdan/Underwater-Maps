/**
 * rate-limit-isolation.guard.test.ts
 *
 * STATIC ANALYSIS GUARD — enforces rate-limit reset discipline.
 *
 * Rule: every test file that imports `app.js` makes real HTTP requests through
 * the Express app, which means it exercises rate-limited routes.  Any such
 * file MUST call `__resetRateLimitMemory()` somewhere in its source so that
 * in-memory bucket state cannot bleed from one test into another.
 *
 * If this test fails, the fix is simple: add the following to the offending
 * file (typically in a `beforeEach`):
 *
 *   import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";
 *   // or the relative path appropriate for your test file's location
 *
 *   beforeEach(() => {
 *     __resetRateLimitMemory();
 *   });
 *
 * The global setup.ts already resets state between files as a fallback, but
 * per-test resets are required to prevent state from bleeding between
 * individual tests *within* the same file.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all *.test.ts paths under a directory. */
function collectTestFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Returns true if the file content contains an import of app.js.
 * Matches both:
 *   import app from "../app.js"        (src/__tests__/ depth)
 *   import app from "../../app.js"     (src/routes/__tests__/ depth)
 */
function importsApp(content: string): boolean {
  return /from\s+["'][./]*app\.js["']/.test(content);
}

/** Returns true if the file content references __resetRateLimitMemory. */
function resetsRateLimit(content: string): boolean {
  return content.includes("__resetRateLimitMemory");
}

// ---------------------------------------------------------------------------
// Guard suite
// ---------------------------------------------------------------------------

describe("rate-limit isolation guard", () => {
  it("every test file that imports app.js must also call __resetRateLimitMemory()", () => {
    const srcDir = path.resolve(__dirname, "..");
    const allTestFiles = collectTestFiles(srcDir);

    // Exclude this guard file itself — it mentions __resetRateLimitMemory in
    // comments and the self-test below, not as a real reset caller.
    const thisFile = path.resolve(__filename);
    const candidates = allTestFiles.filter((f) => f !== thisFile);

    const offenders: string[] = [];

    for (const filePath of candidates) {
      const content = fs.readFileSync(filePath, "utf8");
      if (importsApp(content) && !resetsRateLimit(content)) {
        offenders.push(filePath);
      }
    }

    if (offenders.length > 0) {
      const list = offenders.map((f) => `  - ${f}`).join("\n");
      throw new Error(
        `The following test file(s) import app.js but do not call __resetRateLimitMemory().\n` +
          `Add a beforeEach(() => { __resetRateLimitMemory(); }) to each file listed below.\n` +
          `See the comment at the top of rate-limit-isolation.guard.test.ts for details.\n\n` +
          list,
      );
    }

    expect(offenders).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Self-test: verify the detection logic itself cannot be silently broken
  //
  // This test constructs synthetic file-content strings and confirms the
  // helper functions behave correctly.  If someone accidentally breaks
  // importsApp() or resetsRateLimit() (e.g. by tightening the regex), this
  // test will fail, making the regression visible instead of silently
  // letting offending files slip through.
  // -------------------------------------------------------------------------
  describe("detection logic self-test", () => {
    it("importsApp detects ../app.js import", () => {
      expect(importsApp(`import app from "../app.js";`)).toBe(true);
    });

    it("importsApp detects ../../app.js import", () => {
      expect(importsApp(`import app from "../../app.js";`)).toBe(true);
    });

    it("importsApp does not flag files without an app import", () => {
      expect(importsApp(`import { foo } from "./foo.js";`)).toBe(false);
    });

    it("resetsRateLimit detects __resetRateLimitMemory call", () => {
      expect(
        resetsRateLimit(`beforeEach(() => { __resetRateLimitMemory(); });`),
      ).toBe(true);
    });

    it("resetsRateLimit detects __resetRateLimitMemory import", () => {
      expect(
        resetsRateLimit(
          `import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";`,
        ),
      ).toBe(true);
    });

    it("resetsRateLimit returns false when the token is absent", () => {
      expect(resetsRateLimit(`import app from "../app.js";`)).toBe(false);
    });

    it("flags a synthetic offending source (imports app, no reset)", () => {
      const fakeSource = `
        import app from "../app.js";
        import request from "supertest";
        describe("my route", () => {
          it("does something", async () => {
            await request(app).get("/api/foo").expect(200);
          });
        });
      `;
      expect(importsApp(fakeSource)).toBe(true);
      expect(resetsRateLimit(fakeSource)).toBe(false);
    });

    it("does not flag a well-formed source (imports app AND resets)", () => {
      const fakeSource = `
        import app from "../app.js";
        import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";
        beforeEach(() => { __resetRateLimitMemory(); });
      `;
      expect(importsApp(fakeSource)).toBe(true);
      expect(resetsRateLimit(fakeSource)).toBe(true);
    });
  });
});
