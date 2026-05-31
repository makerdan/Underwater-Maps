/**
 * blobDownload.ts — shared blob-URL anchor download helper.
 *
 * Uses off-screen anchor positioning instead of `display:none` so that
 * Playwright's `page.waitForEvent("download")` can detect the click reliably.
 * The anchor stays in the DOM for 1 s (enough for the browser to register the
 * navigation) and is removed + URL revoked in a deferred callback.
 *
 * All download flows in the app must go through this utility so that
 * automated tests can observe them uniformly.
 */

/**
 * Trigger a browser file download for `blob` with the given `filename`.
 *
 * The anchor element is positioned off-screen (fixed, top:-200px) rather
 * than hidden via `display:none`. This is the minimum change required for
 * Playwright's download-event listener to fire; `display:none` elements are
 * skipped by the browser's navigation routing that Playwright hooks into.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.cssText =
    "position:fixed;top:-200px;left:-200px;width:1px;height:1px;";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}
