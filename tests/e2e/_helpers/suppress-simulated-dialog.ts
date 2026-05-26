import type { Page } from "@playwright/test";

/**
 * Prevents the SimulatedDataConfirmDialog from appearing during tests by
 * setting the session-storage suppress flag before any navigation.
 *
 * Must be called BEFORE page.goto() — addInitScript registers a script that
 * runs on every navigation, so calling it in beforeEach (before goto) means
 * every navigation in that test starts with the flag already set.
 *
 * Without this, the dialog appears when the app auto-loads the default
 * dataset and the /api/datasets/:id/preview endpoint returns
 * dataSource="unknown"/"synthetic". The dialog:
 *   - auto-focuses its Cancel button (stealing focus from other elements)
 *   - intercepts Escape via a capture-phase listener with stopPropagation
 *   - blocks pointer events to elements below its overlay
 */
export async function suppressSimulatedDataDialog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
    } catch {
      // sessionStorage may be unavailable in sandboxed iframes — ignore.
    }
  });
}
