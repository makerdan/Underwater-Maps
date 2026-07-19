import { describe, it, expect } from "vitest";
import { _testOnlyRenderInline as renderInline } from "../Markdown";

describe("renderInline — highlight does not corrupt HTML attributes", () => {
  it('searching "code" does not insert <mark> inside class attribute value', () => {
    const html = renderInline("Use `inline code` here", "code");
    expect(html).not.toMatch(/class="[^"]*<mark/);
    expect(html).not.toMatch(/<mark[^>]*>[^<]*class=/);
    expect(html).toContain('<mark class="hm-mark">code</mark>');
  });

  it('searching "link" does not insert <mark> inside class="hm-link"', () => {
    const html = renderInline("See [this link](https://example.com) here", "link");
    expect(html).not.toMatch(/class="[^"]*<mark/);
    expect(html).not.toMatch(/href="[^"]*<mark/);
    expect(html).toContain('<mark class="hm-mark">link</mark>');
  });

  it('searching "article" does not corrupt data-article-id and preserves internal link', () => {
    const html = renderInline("Read [this article](#article:first-time-guide) here", "article");
    expect(html).not.toMatch(/data-article-id="[^"]*<mark/);
    expect(html).not.toMatch(/class="[^"]*<mark/);
    expect(html).toContain('<mark class="hm-mark">article</mark>');
    expect(html).toContain('data-article-id="first-time-guide"');
    expect(html).toContain('hm-article-link');
    expect(html).not.toContain('target="_blank"');
  });

  it('searching "class" does not corrupt any attribute', () => {
    const html = renderInline("Use `class names` with **bold class**", "class");
    expect(html).not.toMatch(/class="[^"]*<mark/);
    expect(html).not.toMatch(/href="[^"]*<mark/);
  });

  it("highlights plain text correctly when no HTML tags are involved", () => {
    const html = renderInline("hello world", "world");
    expect(html).toBe('hello <mark class="hm-mark">world</mark>');
  });

  it("highlights are case-insensitive", () => {
    const html = renderInline("Hello World", "hello");
    expect(html).toContain('<mark class="hm-mark">Hello</mark>');
  });

  it("does not double-escape the highlighted text", () => {
    const html = renderInline("depth & width", "depth");
    expect(html).toContain('<mark class="hm-mark">depth</mark>');
    expect(html).toContain("&amp;");
  });

  it("renders normally when no highlight is provided", () => {
    const html = renderInline("Use `code` and **bold**");
    expect(html).toContain('<code class="hm-code-inline">code</code>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<mark");
  });
});
