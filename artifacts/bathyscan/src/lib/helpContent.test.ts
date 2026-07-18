import { describe, it, expect, vi } from "vitest";
import {
  HELP_ARTICLES,
  HELP_SECTIONS,
  searchArticles,
  getArticleById,
  buildArticles,
} from "./helpContent";

const rawModules = import.meta.glob("../../help/articles/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function extractFrontmatterId(raw: string): string {
  const match = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!match) return "";
  for (const line of match[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    if (line.slice(0, i).trim() === "id") return line.slice(i + 1).trim();
  }
  return "";
}

const EXPECTED_IDS = Object.values(rawModules)
  .map(extractFrontmatterId)
  .filter(Boolean)
  .sort();

describe("HELP_ARTICLES — registration", () => {
  it("finds .md files on disk to derive expectations from", () => {
    expect(Object.keys(rawModules).length).toBeGreaterThan(0);
    expect(EXPECTED_IDS.length).toBe(Object.keys(rawModules).length);
  });

  it("parses every .md file on disk", () => {
    expect(HELP_ARTICLES.length).toBe(EXPECTED_IDS.length);
  });

  it("contains every expected article ID", () => {
    const parsed = new Set(HELP_ARTICLES.map((a) => a.id));
    const missing = EXPECTED_IDS.filter((id) => !parsed.has(id));
    expect(missing).toEqual([]);
  });

  it("has no duplicate article IDs", () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  it("all articles have non-empty id, title, and section fields", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.id, `id missing for article at index ${HELP_ARTICLES.indexOf(article)}`).toBeTruthy();
      expect(article.title, `title missing for article "${article.id}"`).toBeTruthy();
      expect(article.section, `section missing for article "${article.id}"`).toBeTruthy();
    }
  });

  it("has no duplicate order values within the same section", () => {
    const bySection = new Map<string, number[]>();
    for (const a of HELP_ARTICLES) {
      if (!bySection.has(a.section)) bySection.set(a.section, []);
      bySection.get(a.section)!.push(a.order);
    }
    const violations: string[] = [];
    for (const [section, orders] of bySection) {
      const seen = new Set<number>();
      for (const o of orders) {
        if (seen.has(o)) violations.push(`section "${section}" has duplicate order ${o}`);
        seen.add(o);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("HELP_ARTICLES — cross-links", () => {
  it("every #article: cross-link targets an existing article ID", () => {
    const validIds = new Set(HELP_ARTICLES.map((a) => a.id));
    const broken: string[] = [];
    for (const article of HELP_ARTICLES) {
      for (const match of article.body.matchAll(/#article:([a-z0-9-]+)/g)) {
        const targetId = match[1]!;
        if (!validIds.has(targetId)) {
          broken.push(`"${article.id}" links to unknown #article:${targetId}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("searchArticles — smoke tests for new content keywords", () => {
  it.each<[string, string]>([
    ["metar", "glossary"],
    ["gps trail", "gps-trail-recorder"],
    ["weathercam", "glossary"],
    ["crosshair", "interface-tour"],
    ["trolling", "drift-planner"],
  ])('search("%s") returns article "%s" among results', (query, expectedId) => {
    const hits = searchArticles(query);
    expect(hits.length, `no results for query "${query}"`).toBeGreaterThan(0);
    const hitIds = hits.map((h) => h.article.id);
    expect(hitIds, `"${expectedId}" not found in results for "${query}"`).toContain(expectedId);
  });
});

describe("HELP_SECTIONS — grouping", () => {
  it("groups all articles — section total equals HELP_ARTICLES length", () => {
    const total = HELP_SECTIONS.reduce((sum, s) => sum + s.articles.length, 0);
    expect(total).toBe(HELP_ARTICLES.length);
  });

  it("contains Getting Started, Features, and Reference sections", () => {
    const names = HELP_SECTIONS.map((s) => s.name);
    expect(names).toContain("Getting Started");
    expect(names).toContain("Features");
    expect(names).toContain("Reference");
  });

  it("Getting Started section has exactly 2 articles", () => {
    const gs = HELP_SECTIONS.find((s) => s.name === "Getting Started");
    expect(gs?.articles.length).toBe(2);
  });

  it("sections appear in the defined SECTION_ORDER priority", () => {
    const names = HELP_SECTIONS.map((s) => s.name);
    const gettingStartedIdx = names.indexOf("Getting Started");
    const featuresIdx = names.indexOf("Features");
    const referenceIdx = names.indexOf("Reference");
    expect(gettingStartedIdx).toBeLessThan(featuresIdx);
    expect(featuresIdx).toBeLessThan(referenceIdx);
  });
});

describe("buildArticles — malformed article handling", () => {
  it("excludes an article with a missing id and warns to console", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = "---\ntitle: No ID Article\nsection: Other\norder: 1\n---\nBody text here.";
    const result = buildArticles({ "no-id.md": raw });
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("missing or empty 'id' field"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no-id.md"));
    warnSpy.mockRestore();
  });

  it("includes articles with valid ids and does not warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = "---\nid: valid-id\ntitle: Valid Article\nsection: Other\norder: 1\n---\nBody text here.";
    const result = buildArticles({ "valid.md": raw });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("valid-id");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns once per malformed article when multiple are present", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad1 = "---\ntitle: No ID 1\nsection: Other\norder: 1\n---\nBody.";
    const bad2 = "---\ntitle: No ID 2\nsection: Other\norder: 2\n---\nBody.";
    const good = "---\nid: keep-me\ntitle: Good\nsection: Other\norder: 3\n---\nBody.";
    const result = buildArticles({ "bad1.md": bad1, "bad2.md": bad2, "good.md": good });
    expect(result).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });
});

describe("getArticleById", () => {
  it("returns the correct article for a known ID", () => {
    const article = getArticleById("first-time-guide");
    expect(article?.id).toBe("first-time-guide");
    expect(article?.section).toBe("Getting Started");
  });

  it("returns undefined for an unknown ID", () => {
    expect(getArticleById("does-not-exist")).toBeUndefined();
  });

  it.each(EXPECTED_IDS)("getArticleById('%s') returns a non-null article", (id) => {
    const article = getArticleById(id);
    expect(article).toBeDefined();
    expect(article?.id).toBe(id);
  });
});
