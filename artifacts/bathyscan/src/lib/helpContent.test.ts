import { describe, it, expect } from "vitest";
import {
  HELP_ARTICLES,
  HELP_SECTIONS,
  searchArticles,
  getArticleById,
} from "./helpContent";

const EXPECTED_IDS = [
  "ai-assistant",
  "datasets-uploads",
  "depth-profile",
  "drift-planner",
  "faq",
  "find-data",
  "first-time-guide",
  "glossary",
  "gps-trail-recorder",
  "hud-overlays",
  "interface-tour",
  "keyboard-shortcuts",
  "markers",
  "overview-map",
  "settings",
  "terrain-3d-scene",
  "throttle",
  "tidal-overlay",
  "troubleshooting",
  "weather-stations",
  "workflows-examples",
  "zones-paint-mode",
];

describe("HELP_ARTICLES — registration", () => {
  it("parses every .md file — expects 22 articles", () => {
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
    ["contour", "interface-tour"],
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
