import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHelpStore } from "@/lib/helpStore";
import {
  HELP_ARTICLES,
  HELP_SECTIONS,
  getArticleById,
  searchArticles,
} from "@/lib/helpContent";
import { Markdown } from "./Markdown";
import { HelpQA } from "./HelpQA";
import { useSettingsStore } from "@/lib/settingsStore";
import { flushServerSync } from "@/hooks/useServerSettingsSync";

const WINDOW_W = 880;
const WINDOW_H = 600;
const TITLEBAR_H = 36;
const MOBILE_BP = 768;

function useIsMobile(): boolean {
  const [m, setM] = useState(() => window.innerWidth < MOBILE_BP);
  useEffect(() => {
    const h = () => setM(window.innerWidth < MOBILE_BP);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return m;
}

function clampPosition(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(0, Math.min(x, vw - Math.min(w, vw))),
    y: Math.max(0, Math.min(y, vh - Math.min(h, vh))),
  };
}

/**
 * "Take the tour" button rendered at the bottom of the Help sidebar nav.
 * Resets hasSeenOnboarding so the overlay appears when the user closes Help
 * and returns to the 3D scene.
 */
function TakeTourLink({ onClose }: { onClose: () => void }) {
  const setHasSeenOnboarding = useSettingsStore((s) => s.setHasSeenOnboarding);

  const handleClick = () => {
    setHasSeenOnboarding(false);
    void flushServerSync();
    onClose();
  };

  return (
    <div
      style={{
        borderTop: "1px solid rgba(0,229,255,0.1)",
        marginTop: 12,
        paddingTop: 12,
      }}
    >
      <button
        type="button"
        className="help-toc-item"
        data-testid="help-take-tour-btn"
        onClick={handleClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "#00e5ff",
          fontWeight: 700,
          width: "100%",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 12 }}>▶</span>
        Take the tour
      </button>
    </div>
  );
}

function ContactFooter() {
  const appVersion = "1.0.0";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
  const subject = encodeURIComponent("BathyScan feedback");
  const body = encodeURIComponent(
    `\n\n---\nApp version: ${appVersion}\nBrowser: ${ua}\n`,
  );
  const href = `mailto:makerdantheman@gmail.com?subject=${subject}&body=${body}`;
  return (
    <div className="help-footer">
      Have suggestions for new features or need to report a bug? Contact the developer at:{" "}
      <a href={href} className="help-footer-link">
        makerdantheman@gmail.com
      </a>
    </div>
  );
}

export const HelpWindow: React.FC = () => {
  const open = useHelpStore((s) => s.open);
  const minimized = useHelpStore((s) => s.minimized);
  const position = useHelpStore((s) => s.position);
  const currentArticleId = useHelpStore((s) => s.currentArticleId);
  const search = useHelpStore((s) => s.search);
  const closeHelp = useHelpStore((s) => s.closeHelp);
  const toggleMinimize = useHelpStore((s) => s.toggleMinimize);
  const setArticle = useHelpStore((s) => s.setArticle);
  const setPosition = useHelpStore((s) => s.setPosition);
  const setSearch = useHelpStore((s) => s.setSearch);

  const isMobile = useIsMobile();
  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const hits = useMemo(() => (search.trim() ? searchArticles(search) : []), [search]);
  const article = getArticleById(currentArticleId) ?? HELP_ARTICLES[0]!;

  // Track previously-focused element so we can restore on close
  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
    } else if (lastFocusedRef.current) {
      try {
        lastFocusedRef.current.focus();
      } catch {
        // ignore
      }
    }
  }, [open]);

  // Esc to close + focus trap
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeHelp();
        return;
      }
      if (e.key === "Tab" && windowRef.current) {
        const focusable = windowRef.current.querySelectorAll<HTMLElement>(
          'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, closeHelp]);

  // Auto-focus the search box when opened
  useEffect(() => {
    if (open && !minimized && !isMobile) {
      const t = setTimeout(() => {
        windowRef.current?.querySelector<HTMLInputElement>(".help-search-input")?.focus();
      }, 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, minimized, isMobile]);

  // Clamp position on window resize
  useEffect(() => {
    const h = () => {
      const next = clampPosition(position.x, position.y, WINDOW_W, WINDOW_H);
      if (next.x !== position.x || next.y !== position.y) setPosition(next);
    };
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [position, setPosition]);

  const onDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isMobile) return;
      const target = e.target as HTMLElement;
      if (target.closest(".help-titlebar-btn")) return;
      const rect = windowRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [isMobile],
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const next = clampPosition(
        e.clientX - dragRef.current.dx,
        e.clientY - dragRef.current.dy,
        WINDOW_W,
        minimized ? TITLEBAR_H : WINDOW_H,
      );
      setPosition(next);
    },
    [setPosition, minimized],
  );

  const onDragEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  if (!open) return null;

  const containerStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 1000,
      }
    : {
        position: "fixed",
        left: position.x,
        top: position.y,
        width: WINDOW_W,
        maxWidth: "calc(100vw - 16px)",
        height: minimized ? TITLEBAR_H : WINDOW_H,
        maxHeight: "calc(100vh - 16px)",
        zIndex: 1000,
      };

  return (
    <div
      ref={windowRef}
      className="help-window"
      role="dialog"
      aria-modal={isMobile ? "true" : "false"}
      aria-labelledby="help-window-title"
      style={containerStyle}
      data-testid="help-window"
    >
      <div
        className="help-titlebar"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        style={{ cursor: isMobile ? "default" : "move" }}
      >
        <span id="help-window-title" className="help-title">
          ◈ HELP — {article.title}
        </span>
        <div className="help-titlebar-actions">
          {!isMobile && (
            <button
              className="help-titlebar-btn"
              onClick={toggleMinimize}
              type="button"
              aria-label={minimized ? "Restore help window" : "Minimize help window"}
              title={minimized ? "Restore" : "Minimize"}
            >
              {minimized ? "▢" : "—"}
            </button>
          )}
          <button
            className="help-titlebar-btn help-titlebar-close"
            onClick={closeHelp}
            type="button"
            aria-label="Close help window"
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="help-body">
          <aside className="help-sidebar" aria-label="Help navigation">
            <input
              type="text"
              className="help-search-input"
              placeholder="Search help…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search help articles"
            />

            {search.trim() ? (
              <div className="help-search-results">
                {hits.length === 0 ? (
                  <div className="help-empty">No matches for “{search}”.</div>
                ) : (
                  hits.map((hit) => (
                    <button
                      key={hit.article.id}
                      type="button"
                      className="help-search-hit"
                      onClick={() => setArticle(hit.article.id)}
                    >
                      <div className="help-search-hit-title">{hit.article.title}</div>
                      <div className="help-search-hit-snippet">{hit.snippet}…</div>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <nav className="help-toc">
                {HELP_SECTIONS.map((section) => (
                  <div key={section.name} className="help-toc-section">
                    <div className="help-toc-section-title">{section.name}</div>
                    {section.articles.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className={`help-toc-item ${a.id === currentArticleId ? "is-active" : ""}`}
                        onClick={() => setArticle(a.id)}
                        data-testid={`help-toc-${a.id}`}
                      >
                        {a.title}
                      </button>
                    ))}
                  </div>
                ))}
                <TakeTourLink onClose={closeHelp} />
              </nav>
            )}
          </aside>

          <main
            className="help-content"
            onClick={(e) => {
              const target = (e.target as HTMLElement).closest("a[data-article-id]");
              if (target) {
                e.preventDefault();
                const id = target.getAttribute("data-article-id");
                if (id) setArticle(id);
              }
            }}
          >
            <article className="help-article">
              <Markdown source={article.body} highlight={search.trim() || undefined} />
              {article.showQA && <HelpQA />}
              <ContactFooter />
            </article>
          </main>
        </div>
      )}
    </div>
  );
};
