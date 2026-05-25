export interface HelpArticle {
  id: string;
  title: string;
  section: string;
  order: number;
  showQA?: boolean;
  body: string;
  searchText: string;
}

export interface HelpSection {
  name: string;
  articles: HelpArticle[];
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    meta[key] = val;
  }
  return { meta, body: raw.slice(match[0].length) };
}

const modules = import.meta.glob("../../help/articles/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function buildSearchText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~|\-]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export const HELP_ARTICLES: HelpArticle[] = Object.entries(modules)
  .map(([_path, raw]) => {
    const { meta, body } = parseFrontmatter(raw);
    return {
      id: meta["id"] ?? "",
      title: meta["title"] ?? "Untitled",
      section: meta["section"] ?? "Other",
      order: Number(meta["order"] ?? 999),
      showQA: meta["showQA"] === "true",
      body,
      searchText: buildSearchText(body) + " " + (meta["title"] ?? "").toLowerCase(),
    };
  })
  .filter((a) => a.id)
  .sort((a, b) => a.order - b.order);

export const SECTION_ORDER = [
  "Getting Started",
  "Features",
  "Workflows",
  "Reference",
  "Other",
];

export const HELP_SECTIONS: HelpSection[] = (() => {
  const map = new Map<string, HelpArticle[]>();
  for (const a of HELP_ARTICLES) {
    if (!map.has(a.section)) map.set(a.section, []);
    map.get(a.section)!.push(a);
  }
  const sections: HelpSection[] = [];
  for (const name of SECTION_ORDER) {
    if (map.has(name)) sections.push({ name, articles: map.get(name)! });
  }
  for (const [name, articles] of map.entries()) {
    if (!SECTION_ORDER.includes(name)) sections.push({ name, articles });
  }
  return sections;
})();

export function getArticleById(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.id === id);
}

export interface SearchHit {
  article: HelpArticle;
  score: number;
  snippet: string;
}

function fuzzyScore(needle: string, haystack: string): { score: number; index: number } {
  if (!needle) return { score: 0, index: -1 };
  const exact = haystack.indexOf(needle);
  if (exact >= 0) {
    return { score: 100 + Math.max(0, 50 - exact / 4), index: exact };
  }
  let hi = 0;
  let score = 0;
  let firstIdx = -1;
  let consecutive = 0;
  for (let ni = 0; ni < needle.length; ni++) {
    const ch = needle[ni]!;
    let found = -1;
    while (hi < haystack.length) {
      if (haystack[hi] === ch) {
        found = hi;
        break;
      }
      hi++;
    }
    if (found === -1) return { score: 0, index: -1 };
    if (firstIdx === -1) firstIdx = found;
    score += 1 + consecutive * 2;
    consecutive = ni > 0 && haystack[found - 1] === needle[ni - 1] ? consecutive + 1 : 0;
    hi++;
  }
  return { score, index: firstIdx };
}

export function searchArticles(query: string, limit = 20): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];
  for (const article of HELP_ARTICLES) {
    let score = 0;
    let firstIdx = -1;
    const titleLower = article.title.toLowerCase();
    for (const term of terms) {
      const title = fuzzyScore(term, titleLower);
      const body = fuzzyScore(term, article.searchText);
      score += title.score * 5 + body.score;
      if (body.index >= 0 && firstIdx === -1) firstIdx = body.index;
    }
    if (score === 0) continue;
    const start = Math.max(0, firstIdx - 40);
    const snippet =
      firstIdx >= 0 ? article.searchText.slice(start, start + 140).trim() : article.title;
    hits.push({ article, score, snippet: snippet || article.title });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
