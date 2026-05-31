---
id: troubleshooting
title: Troubleshooting
section: Reference
order: 14
---

# Troubleshooting

Things that sometimes go wrong, and how to fix them.

## The terrain is blank or solid black

- Wait a few seconds — it may still be loading.
- Check the top-right for an **OFFLINE** badge. If you are offline and have never loaded this dataset before, it cannot be fetched.
- Try a different dataset to confirm the renderer is working.
- As a last resort, reload the page.

## WebGL context lost

If the 3D scene goes black and a banner reads **"WebGL context lost"**, the browser's GPU connection has dropped. This can happen when the tab is in the background for a long time, when the system GPU is under heavy load, or when GPU memory runs out.

**Recovery procedure:**

1. Click the **Restore 3D View** button that appears in the centre of the screen.
2. BathyScan will recreate the WebGL context and reload the active dataset. This usually takes 5–15 seconds.
3. Your camera position, markers, and settings are preserved.
4. If the context is lost again immediately, try switching to the **Low** quality preset (Settings → Visuals → Quality Preset) to reduce GPU memory usage.
5. If the problem persists, close other GPU-heavy tabs or applications, or reload the page.

> On low-end integrated-GPU laptops, running BathyScan on battery power sometimes triggers aggressive GPU power-gating. Plugging in can resolve repeated context-loss events.

## Mouse won't lock when I click

Some browsers block pointer lock if you have just navigated or if the tab lost focus. Click the scene again, or press **Tab** to toggle to Orbit mode and back. If a browser permission prompt appeared and you dismissed it, you may need to re-grant pointer-lock access in the browser's site settings.

## AI says "Too many requests" or rate-limit error

You have hit the per-minute usage quota. All AI features (classify, describe, query, help Q&A) share one quota per account.

- Wait **30 seconds** and try again — the quota resets automatically.
- If you see the error repeatedly, spread out your AI queries: let zone classification finish before opening the query panel.
- The quota is intentionally generous for normal use. Hitting it consistently is rare.

## AI gives a confusing or wrong answer

- Rephrase the prompt. The AI responds better to concrete questions ("Which cell is deepest?") than vague ones ("Tell me about this").
- Try pressing **Esc** to clear any active highlights, then re-ask.
- For zone corrections, use [Paint mode](#article:zones-paint-mode) instead of relying on AI re-classification.

## My upload failed

- File must be `.xyz`, `.csv`, `.xyz.gz`, or `.csv.gz`.
- Each row needs at least three numbers: longitude, latitude, depth.
- Depths should be in metres, positive down. If your data is positive-up, multiply by −1 before uploading.
- The first non-comment row may be a header — that is fine.

## Upload stopped at X% mid-transfer

A network drop interrupted the chunked transfer. The progress bar resets because mid-transfer resumption is not supported.

**Fix:** Re-upload the file. The whole transfer restarts from the beginning.

## My upload is stuck on "Processing on server…"

After all chunks arrive the server processes the file in the background. This normally takes under a minute.

If the spinner has been showing for more than a few minutes:

1. Refresh the page and check **Your saved datasets** — the dataset may have finished while you were waiting.
2. If it is not there, re-upload the file. A retry starts a fresh job.

Server restarts clear in-progress jobs. Jobs do not survive server restarts.

## A saved dataset shows "Failed to load"

Click the **Retry** button. If it keeps failing, the dataset may be corrupt — delete it from the saved list and re-upload.

## Offline sync failure — markers never appeared

- Confirm you are back online (no **OFFLINE** badge in the top-right).
- Open **Settings → Offline & Storage** and look at the **Pending Markers** count.
- Reloading the page triggers another sync attempt.
- If the count stays stuck after multiple reloads, check the browser console for a network error and report it via the contact link below.

## Offline sync failure — GPS trail not uploading

The GPS trail recorder queues segments locally while offline. If the **Pending Trails** count in Settings → Offline & Storage stays above zero after reconnecting:

1. Make sure GPS permissions are still granted in the browser.
2. Reload the page to force a sync retry.
3. If the count still does not drop, the trail data may be stored in a stale IndexedDB entry — clearing the cache (Settings → Offline & Storage → Clear All Cached Data) and reloading will clear it, but the unsynced trail data will be lost.

## The Help window keeps appearing in a wrong position

It remembers its last drag position. Drag it back, or reload the page to reset the window position to the default.

## Something else is broken

Use the contact link at the bottom of every help article and include:

- What you were trying to do
- What happened instead
- Browser and OS
- Whether it is reproducible
- Any error text visible on screen
