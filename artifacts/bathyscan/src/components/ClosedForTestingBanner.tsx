import React from "react";
import { OVERLAY_Z } from "@/lib/overlayScale";

/**
 * ClosedForTestingBanner — fixed top-of-page amber warning strip shown on the
 * signed-out landing page while the site is closed for private testing
 * (`VITE_SITE_STATUS=closed`; see `src/lib/siteStatus.ts`).
 *
 * Rendering is gated by the caller (LandingPage) — this component always
 * renders the strip when mounted. Styling follows the project's monospace /
 * dark-amber alert palette and the `--bs-font-scale` inline font convention.
 */
export function ClosedForTestingBanner() {
  return (
    <div
      role="status"
      data-testid="closed-for-testing-banner"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: OVERLAY_Z.banner,
        background: "rgba(28, 16, 8, 0.96)",
        borderBottom: "1px solid rgba(251, 191, 36, 0.5)",
        color: "#fbbf24",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "calc(15px * var(--bs-font-scale, 1))",
        letterSpacing: "0.06em",
        textAlign: "center",
        padding: "10px 16px",
        backdropFilter: "blur(6px)",
      }}
    >
      BathyScan is currently closed for private testing. Sign-ups are not
      available at this time.
    </div>
  );
}
