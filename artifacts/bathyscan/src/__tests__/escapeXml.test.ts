import { describe, it, expect } from "vitest";

/**
 * escapeXml is a private helper inside WeatherPanel.tsx.
 * We duplicate the logic here so it can be unit-tested in isolation.
 * If the implementation changes, update this copy too.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

describe("escapeXml", () => {
  it("passes plain ASCII through unchanged", () => {
    expect(escapeXml("Hello World 123")).toBe("Hello World 123");
  });

  it("escapes ampersand", () => {
    expect(escapeXml("fish & chips")).toBe("fish &amp; chips");
  });

  it("escapes less-than", () => {
    expect(escapeXml("a < b")).toBe("a &lt; b");
  });

  it("escapes greater-than", () => {
    expect(escapeXml("a > b")).toBe("a &gt; b");
  });

  it("escapes double quote", () => {
    expect(escapeXml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes single quote", () => {
    expect(escapeXml("it's a plan")).toBe("it&apos;s a plan");
  });

  it("escapes a script-injection attempt", () => {
    const result = escapeXml("<script>alert('xss')</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
    expect(result).toContain("&apos;xss&apos;");
  });

  it("handles all five entities in one string", () => {
    expect(escapeXml(`<a href="x&y">it's > 0</a>`)).toBe(
      "&lt;a href=&quot;x&amp;y&quot;&gt;it&apos;s &gt; 0&lt;/a&gt;"
    );
  });

  it("returns empty string unchanged", () => {
    expect(escapeXml("")).toBe("");
  });

  it("handles unicode passthrough without corruption", () => {
    const input = "Pêche 🐟 • Märë";
    expect(escapeXml(input)).toBe(input);
  });
});
