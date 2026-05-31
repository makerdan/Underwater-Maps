import { describe, it, expect } from "vitest";
import { HELP_ARTICLES, HELP_SECTIONS, searchArticles } from "@/lib/helpContent";

const NEW_ARTICLE_IDS = ["overview-map", "gps-trail-recorder", "weather-stations"] as const;

describe("New help articles — sidebar presence", () => {
  it.each(NEW_ARTICLE_IDS)('article "%s" is present in HELP_ARTICLES', (id) => {
    const article = HELP_ARTICLES.find((a) => a.id === id);
    expect(article, `Expected article with id "${id}" to exist`).toBeDefined();
  });

  it.each(NEW_ARTICLE_IDS)('article "%s" has showQA: true', (id) => {
    const article = HELP_ARTICLES.find((a) => a.id === id);
    expect(article?.showQA).toBe(true);
  });

  it.each(NEW_ARTICLE_IDS)('article "%s" is in the Features section', (id) => {
    const featuresSection = HELP_SECTIONS.find((s) => s.name === "Features");
    expect(featuresSection, "Features section should exist").toBeDefined();
    const article = featuresSection?.articles.find((a) => a.id === id);
    expect(article, `Expected "${id}" to appear in the Features section`).toBeDefined();
  });

  it("all three new articles appear under Features in sidebar order", () => {
    const featuresSection = HELP_SECTIONS.find((s) => s.name === "Features");
    expect(featuresSection).toBeDefined();
    const ids = featuresSection!.articles.map((a) => a.id);
    expect(ids).toContain("overview-map");
    expect(ids).toContain("gps-trail-recorder");
    expect(ids).toContain("weather-stations");
  });

  it("new Features articles are ordered sensibly (overview-map before gps-trail-recorder before weather-stations)", () => {
    const featuresSection = HELP_SECTIONS.find((s) => s.name === "Features");
    const ids = featuresSection!.articles.map((a) => a.id);
    expect(ids.indexOf("overview-map")).toBeLessThan(ids.indexOf("gps-trail-recorder"));
    expect(ids.indexOf("gps-trail-recorder")).toBeLessThan(ids.indexOf("weather-stations"));
  });
});

describe("New help articles — search results", () => {
  it('searching "GPS track" surfaces gps-trail-recorder', () => {
    const hits = searchArticles("GPS track");
    const ids = hits.map((h) => h.article.id);
    expect(ids).toContain("gps-trail-recorder");
  });

  it('searching "record my GPS" puts gps-trail-recorder in the top 3', () => {
    const hits = searchArticles("record my GPS");
    const top = hits.slice(0, 3).map((h) => h.article.id);
    expect(top).toContain("gps-trail-recorder");
  });

  it('searching "NOAA weather stations" surfaces weather-stations', () => {
    const hits = searchArticles("NOAA weather stations");
    const ids = hits.map((h) => h.article.id);
    expect(ids).toContain("weather-stations");
  });

  it('searching "NOAA weather" puts weather-stations in the top 3', () => {
    const hits = searchArticles("NOAA weather");
    const top = hits.slice(0, 3).map((h) => h.article.id);
    expect(top).toContain("weather-stations");
  });

  it('searching "overview map minimap" surfaces overview-map', () => {
    const hits = searchArticles("overview map minimap");
    const ids = hits.map((h) => h.article.id);
    expect(ids).toContain("overview-map");
  });

  it('searching "minimap" puts overview-map in the top 3', () => {
    const hits = searchArticles("minimap");
    const top = hits.slice(0, 3).map((h) => h.article.id);
    expect(top).toContain("overview-map");
  });

  it("search snippets for the new articles are non-empty strings", () => {
    for (const id of NEW_ARTICLE_IDS) {
      const article = HELP_ARTICLES.find((a) => a.id === id)!;
      const hits = searchArticles(article.title);
      const hit = hits.find((h) => h.article.id === id);
      expect(hit, `Expected a search hit for "${id}" when querying by its own title`).toBeDefined();
      expect(typeof hit!.snippet).toBe("string");
      expect(hit!.snippet.length).toBeGreaterThan(0);
    }
  });
});
