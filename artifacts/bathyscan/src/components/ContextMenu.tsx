/**
 * ContextMenu — a single global right-click menu rendered into document.body.
 *
 * Reads from useContextMenuStore. Dismissed by clicking outside or pressing
 * Escape. Items are keyboard accessible (Tab/Enter). Position is clamped to
 * the viewport so the menu never overflows off-screen.
 */
import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useContextMenuStore } from "@/lib/contextMenuStore";

const ITEM_HEIGHT = 30;
const MIN_WIDTH = 220;
const VIEWPORT_MARGIN = 8;

export const ContextMenu: React.FC = () => {
  const open = useContextMenuStore((s) => s.open);
  const x = useContextMenuStore((s) => s.x);
  const y = useContextMenuStore((s) => s.y);
  const items = useContextMenuStore((s) => s.items);
  const hide = useContextMenuStore((s) => s.hide);
  const ref = useRef<HTMLUListElement>(null);

  // Close the menu whenever the route changes (e.g. navigating to Settings).
  const [location] = useLocation();
  useEffect(() => {
    if (open) hide();
    // Intentionally omit `open` and `hide` — we only want to react to location changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // useLayoutEffect (not useEffect) so the listeners are registered
  // synchronously after the DOM mutation and before the browser paints.
  // This eliminates the race where a Playwright keypress fires between
  // the render and the async useEffect flush.
  useLayoutEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
        return;
      }
      if (!ref.current) return;
      if (
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp" &&
        e.key !== "Home" &&
        e.key !== "End"
      ) {
        return;
      }
      const focusable = Array.from(
        ref.current.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"])',
        ),
      );
      if (focusable.length === 0) return;
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? focusable.indexOf(active) : -1;
      let next = 0;
      if (e.key === "ArrowDown") next = idx < 0 ? 0 : (idx + 1) % focusable.length;
      else if (e.key === "ArrowUp")
        next = idx < 0 ? focusable.length - 1 : (idx - 1 + focusable.length) % focusable.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = focusable.length - 1;
      focusable[next]?.focus();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, hide]);

  // Re-clamp against the *measured* menu size after paint. The initial
  // render clamps with an estimated height (items × ITEM_HEIGHT), but the
  // real rendered height varies with font scaling and wrapped labels, so a
  // menu opened near the bottom/right edge could still overflow slightly.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - rect.height - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft));
    const top = Math.max(VIEWPORT_MARGIN, Math.min(rect.top, maxTop));
    if (left !== rect.left) el.style.left = `${left}px`;
    if (top !== rect.top) el.style.top = `${top}px`;
  }, [open, x, y, items]);

  // Auto-focus the first non-disabled, non-separator item for keyboard nav
  useEffect(() => {
    if (!open || !ref.current) return;
    const firstFocusable = ref.current.querySelector<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"])',
    );
    firstFocusable?.focus();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const estHeight = items.length * ITEM_HEIGHT + 8;
  const clampedX = Math.max(
    VIEWPORT_MARGIN,
    Math.min(x, window.innerWidth - MIN_WIDTH - VIEWPORT_MARGIN),
  );
  const clampedY = Math.max(
    VIEWPORT_MARGIN,
    Math.min(y, window.innerHeight - estHeight - VIEWPORT_MARGIN),
  );

  return createPortal(
    <ul
      ref={ref}
      role="menu"
      data-testid="context-menu"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          hide();
        }
      }}
      style={{
        position: "fixed",
        left: clampedX,
        top: clampedY,
        minWidth: MIN_WIDTH,
        background: "rgba(0,10,20,0.92)",
        border: "1px solid rgba(0,229,255,0.25)",
        borderRadius: 4,
        padding: 4,
        margin: 0,
        listStyle: "none",
        zIndex: 9999,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 16.5,
        color: "#cbd5e1",
        backdropFilter: "blur(6px)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        letterSpacing: "0.05em",
      }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return (
            <li
              key={`sep-${i}`}
              role="separator"
              style={{
                height: 1,
                background: "rgba(0,229,255,0.12)",
                margin: "4px 2px",
                listStyle: "none",
              }}
            />
          );
        }
        return (
          <li
            key={i}
            role="menuitem"
            tabIndex={item.disabled ? -1 : 0}
            aria-disabled={item.disabled || undefined}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              hide();
            }}
            onKeyDown={(e) => {
              if (item.disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                item.onClick();
                hide();
              }
            }}
            onMouseEnter={(e) => {
              if (item.disabled) return;
              e.currentTarget.style.background = "rgba(0,229,255,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            onFocus={(e) => {
              if (item.disabled) return;
              e.currentTarget.style.background = "rgba(0,229,255,0.08)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            style={{
              padding: "6px 10px",
              cursor: item.disabled ? "not-allowed" : "pointer",
              opacity: item.disabled ? 0.4 : 1,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              gap: 10,
              outline: "none",
              userSelect: "none",
            }}
          >
            {item.icon && (
              <span style={{ width: 16, textAlign: "center" }}>{item.icon}</span>
            )}
            <span>{item.label}</span>
          </li>
        );
      })}
    </ul>,
    document.body,
  );
};
