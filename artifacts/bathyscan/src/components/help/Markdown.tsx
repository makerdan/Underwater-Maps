import React, { useState } from "react";

interface MarkdownProps {
  source: string;
  highlight?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}

const MARK_OPEN = "\x00M1\x00";
const MARK_CLOSE = "\x00M2\x00";

function stripMarkPlaceholders(s: string): string {
  return s.replaceAll(MARK_OPEN, "").replaceAll(MARK_CLOSE, "");
}

function renderInline(text: string, highlight?: string): string {
  let raw = text;
  if (highlight && highlight.trim()) {
    try {
      const escaped = highlight.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(${escaped})`, "gi");
      raw = raw.replace(re, `${MARK_OPEN}$1${MARK_CLOSE}`);
    } catch {
      // ignore bad regex
    }
  }

  let out = escapeHtml(raw);
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code class="hm-code-inline">${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label: string, href: string) => {
      const cleanHref = stripMarkPlaceholders(href);
      const articleMatch = /^#article:(.+)$/.exec(cleanHref);
      if (articleMatch) {
        const articleId = escapeHtml(articleMatch[1]!);
        return `<a href="#" data-article-id="${articleId}" class="hm-link hm-article-link">${label}</a>`;
      }
      return `<a href="${escapeHtml(cleanHref)}" target="_blank" rel="noopener noreferrer" class="hm-link">${label}</a>`;
    },
  );

  out = out.replaceAll(MARK_OPEN, '<mark class="hm-mark">');
  out = out.replaceAll(MARK_CLOSE, "</mark>");

  return out;
}

export { renderInline as _testOnlyRenderInline };

interface Block {
  type: "h1" | "h2" | "h3" | "p" | "ul" | "ol" | "code" | "callout" | "image" | "hr" | "table";
  content?: string;
  items?: string[];
  lang?: string;
  rows?: string[][];
}

function parseBlocks(src: string): Block[] {
  const lines = src.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      i++;
      const buf: string[] = [];
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        buf.push(lines[i]!);
        i++;
      }
      i++;
      blocks.push({ type: "code", content: buf.join("\n"), lang });
      continue;
    }
    if (/^#{1,3}\s/.test(trimmed)) {
      const m = /^(#{1,3})\s+(.*)$/.exec(trimmed)!;
      const level = m[1]!.length as 1 | 2 | 3;
      blocks.push({ type: `h${level}` as Block["type"], content: m[2]! });
      i++;
      continue;
    }
    if (trimmed === "---") {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) {
      blocks.push({ type: "image", content: trimmed });
      i++;
      continue;
    }
    if (trimmed.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("> ")) {
        buf.push(lines[i]!.trim().slice(2));
        i++;
      }
      blocks.push({ type: "callout", content: buf.join(" ") });
      continue;
    }
    if (/^[-*]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    if (trimmed.startsWith("|") && lines[i + 1]?.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const cells = lines[i]!.trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) {
          rows.push(cells);
        }
        i++;
      }
      blocks.push({ type: "table", rows });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^#{1,3}\s/.test(lines[i]!.trim()) &&
      !lines[i]!.trim().startsWith("```") &&
      !lines[i]!.trim().startsWith("> ") &&
      !/^[-*]\s/.test(lines[i]!.trim()) &&
      !/^\d+\.\s/.test(lines[i]!.trim()) &&
      !lines[i]!.trim().startsWith("|")
    ) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push({ type: "p", content: para.join(" ") });
  }
  return blocks;
}

interface MarkdownImageProps {
  src: string;
  alt: string;
}

const MarkdownImage: React.FC<MarkdownImageProps> = ({ src, alt }) => {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div className="hm-image-placeholder">
        <span className="hm-image-icon">🖼</span>
        <span className="hm-image-alt">{alt || "Image unavailable offline"}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="hm-image"
      onError={() => setErrored(true)}
    />
  );
};

export const Markdown: React.FC<MarkdownProps> = ({ source, highlight }) => {
  const blocks = React.useMemo(() => parseBlocks(source), [source]);
  return (
    <div className="hm-root">
      {blocks.map((b, idx) => {
        switch (b.type) {
          case "h1":
            return (
              <h1 key={idx} className="hm-h1" dangerouslySetInnerHTML={{ __html: renderInline(b.content!, highlight) }} />
            );
          case "h2":
            return (
              <h2 key={idx} className="hm-h2" dangerouslySetInnerHTML={{ __html: renderInline(b.content!, highlight) }} />
            );
          case "h3":
            return (
              <h3 key={idx} className="hm-h3" dangerouslySetInnerHTML={{ __html: renderInline(b.content!, highlight) }} />
            );
          case "p":
            return (
              <p key={idx} className="hm-p" dangerouslySetInnerHTML={{ __html: renderInline(b.content!, highlight) }} />
            );
          case "ul":
            return (
              <ul key={idx} className="hm-ul">
                {b.items!.map((it, j) => (
                  <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(it, highlight) }} />
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={idx} className="hm-ol">
                {b.items!.map((it, j) => (
                  <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(it, highlight) }} />
                ))}
              </ol>
            );
          case "code":
            return (
              <pre key={idx} className="hm-pre">
                <code>{b.content}</code>
              </pre>
            );
          case "callout":
            return (
              <div key={idx} className="hm-callout" dangerouslySetInnerHTML={{ __html: renderInline(b.content!, highlight) }} />
            );
          case "image": {
            const m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(b.content!);
            const alt = m?.[1] ?? "";
            const src = m?.[2] ?? "";
            const isAllowed =
              src.startsWith("http://") ||
              src.startsWith("https://") ||
              src.startsWith("/");
            if (src === "placeholder" || !isAllowed) {
              return (
                <div key={idx} className="hm-image-placeholder">
                  <span className="hm-image-icon">🖼</span>
                  <span className="hm-image-alt">{alt || "Screenshot coming soon"}</span>
                </div>
              );
            }
            const resolvedSrc = src.startsWith("/")
              ? `${import.meta.env.BASE_URL.replace(/\/$/, "")}${src}`
              : src;
            return <MarkdownImage key={idx} src={resolvedSrc} alt={alt} />;
          }
          case "hr":
            return <hr key={idx} className="hm-hr" />;
          case "table":
            return (
              <table key={idx} className="hm-table">
                {b.rows![0] && (
                  <thead>
                    <tr>
                      {b.rows![0].map((c, j) => (
                        <th key={j} dangerouslySetInnerHTML={{ __html: renderInline(c, highlight) }} />
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {b.rows!.slice(1).map((row, ri) => (
                    <tr key={ri}>
                      {row.map((c, ci) => (
                        <td key={ci} dangerouslySetInnerHTML={{ __html: renderInline(c, highlight) }} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          default:
            return null;
        }
      })}
    </div>
  );
};
