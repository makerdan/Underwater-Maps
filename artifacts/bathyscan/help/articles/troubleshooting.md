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
- Check the top-right for an **OFFLINE** badge. If you are offline and this is a dataset you have never loaded, it cannot be fetched.
- Try a different dataset to confirm the renderer is working.
- As a last resort, reload the page.

## Mouse won't lock when I click

Some browsers block pointer lock if you have just navigated. Click the scene again, or press **Tab** to switch to Orbit mode and back.

## My upload failed

- File must be `.xyz` or `.csv` and under 50 MB.
- The first non-comment row may be a header.
- Each row needs at least three numbers (longitude, latitude, depth).
- Depths should be in metres, positive down. If your data is positive-up, multiply by −1 before uploading.

## A saved dataset shows "Failed to load"

Click the **Retry** button. If it keeps failing, the dataset may be corrupt — delete it from the saved list and re-upload.

## The AI says "Too many requests"

You have hit the per-minute rate limit. Wait about 30 seconds and try again.

## Markers I dropped offline never appeared

- Confirm you are back online (no **OFFLINE** badge).
- Open Settings → Offline & Storage and look at the pending count.
- Reloading the page triggers another sync attempt.

## The Help window keeps appearing in a weird spot

It remembers its last position. Drag it back, or click **Reset** under Settings → HUD (coming soon — for now, clear your browser's local storage for this site).

## Something else is broken

Use the contact link at the bottom of every help article and include:

- What you were trying to do
- What happened instead
- Browser and OS
- Whether it is reproducible
