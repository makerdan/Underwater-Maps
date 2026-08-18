/**
 * Spinner — tiny CSS-animated rotating spinner used by the offline
 * save flows (OfflinePackModal, BulkOfflinePanel) in place of the static
 * ◌ glyph, so users can tell an in-progress download from a stuck one.
 *
 * The @keyframes rule is injected once into document.head, guarded by an
 * element id so repeated modal mounts never accumulate duplicate <style>
 * tags (idempotent injection).
 */

import React, { useEffect } from "react";

const STYLE_ID = "bs-spin-style";

/** Inject the bs-spin keyframes exactly once per document. */
export function ensureSpinKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    "@keyframes bs-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";
  document.head.appendChild(style);
}

export function Spinner({
  color = "#00e5ff",
  size = "0.85em",
}: {
  color?: string;
  size?: string;
}) {
  useEffect(() => {
    ensureSpinKeyframes();
  }, []);
  return (
    <span
      aria-hidden="true"
      data-testid="bs-spinner"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: `2px solid ${color}`,
        borderTopColor: "transparent",
        borderRadius: "50%",
        boxSizing: "border-box",
        verticalAlign: "-0.1em",
        animation: "bs-spin 0.9s linear infinite",
      }}
    />
  );
}
