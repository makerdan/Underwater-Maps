import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = path.resolve(__dirname, "../../help/articles");

type Frontmatter = {
  id?: string;
  title?: string;
  section?: string;
  order?: number;
  showQA?: boolean;
  [key: string]: unknown;
};

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 1).trim();
    if (raw === "true") fm[key] = true;
    else if (raw === "false") fm[key] = false;
    else if (/^\d+(\.\d+)?$/.test(raw)) fm[key] = parseFloat(raw);
    else fm[key] = raw;
  }
  return fm;
}

const mdFiles = fs
  .readdirSync(ARTICLES_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort();

type ArticleEntry = {
  file: string;
  slug: string;
  content: string;
  fm: Frontmatter;
};

const articles: ArticleEntry[] = mdFiles.map((file) => {
  const slug = file.replace(/\.md$/, "");
  const content = fs.readFileSync(path.join(ARTICLES_DIR, file), "utf-8");
  return { file, slug, content, fm: parseFrontmatter(content) };
});

const allIds = new Set(articles.map((a) => a.fm.id));

describe("Help articles — frontmatter integrity", () => {
  it("has exactly 27 article files", () => {
    expect(mdFiles.length).toBe(27);
  });

  for (const { file, slug, fm } of articles) {
    describe(file, () => {
      it("has a frontmatter block", () => {
        expect(Object.keys(fm).length).toBeGreaterThan(0);
      });

      it("id is present", () => {
        expect(fm.id).toBeDefined();
        expect(typeof fm.id).toBe("string");
        expect((fm.id as string).length).toBeGreaterThan(0);
      });

      it("id matches filename", () => {
        expect(fm.id).toBe(slug);
      });

      it("title is a non-empty string", () => {
        expect(typeof fm.title).toBe("string");
        expect((fm.title as string).length).toBeGreaterThan(0);
      });

      it("section is a non-empty string", () => {
        expect(typeof fm.section).toBe("string");
        expect((fm.section as string).length).toBeGreaterThan(0);
      });

      it("order is a positive number", () => {
        expect(typeof fm.order).toBe("number");
        expect(fm.order as number).toBeGreaterThan(0);
      });

      it("showQA, when present, is a boolean", () => {
        if ("showQA" in fm) {
          expect(typeof fm.showQA).toBe("boolean");
        }
      });
    });
  }
});

describe("Help articles — no duplicate ids", () => {
  it("all ids are unique", () => {
    const ids = articles.map((a) => a.fm.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });
});

describe("Help articles — cross-link integrity", () => {
  it("all #article:XXX cross-links resolve to a known article", () => {
    const broken: { file: string; target: string }[] = [];

    for (const { file, content } of articles) {
      const matches = [...content.matchAll(/#article:([a-z0-9-]+)/g)];
      for (const m of matches) {
        const target = m[1];
        if (!allIds.has(target)) {
          broken.push({ file, target });
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it("reports which files contain cross-links and all targets are valid", () => {
    const filesWithLinks = articles
      .filter(({ content }) => /#article:[a-z0-9-]+/.test(content))
      .map(({ file }) => file);

    expect(filesWithLinks.length).toBeGreaterThan(0);

    for (const { file, content } of articles) {
      const targets = [
        ...content.matchAll(/#article:([a-z0-9-]+)/g),
      ].map((m) => m[1]);
      for (const target of targets) {
        expect(allIds.has(target), `${file}: #article:${target} not found`).toBe(
          true,
        );
      }
    }
  });
});
