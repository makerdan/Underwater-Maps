import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOMAINS_DIR = join(__dirname, "..", "domains");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("API domain boundaries", () => {
  it("does not allow domains to import application bootstrap internals", () => {
    const violations = sourceFiles(DOMAINS_DIR).flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return /from\s+["'][^"']*\/app(?:\.js)?["']/.test(source)
        ? [filePath]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("keeps domain names unique and explicit", async () => {
    const { API_DOMAINS } = await import("../routes/index.js");
    const names = API_DOMAINS.map(({ name }) => name);
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(new Set(names).size).toBe(names.length);
  });
});