---
id: find-data
title: Find Data
section: Features
order: 4.5
showQA: true
---

# Find Data

The **Find Data** drawer is how you discover and load new datasets — bathymetry
grids, substrate maps, habitat layers, lidar, and nautical charts — without
leaving the viewer. Open it with the `🔍 FIND DATA` button in the lower-right
corner of the HUD.

## Search tab

Type a natural-language or keyword query, e.g.

- `Thorne Bay bathymetry`
- `rockfish habitat`
- `nearshore lidar Alaska`

Results stream in as cards showing the dataset's name, source agency, resolution
range, and last-updated month. A coloured relevance bar at the bottom of each
card hints at how strong a match it is. Use the chip row to filter by data
type: bathymetry, substrate, habitat, lidar, or chart.

Each card has two action buttons:

- **Load** — opens the dataset directly in the 3D viewer. Available for built-in
  preset datasets; user-saved datasets become loadable once they finish
  processing.
- **Save** — adds the dataset to your library (the **My Saves** tab) so you can
  return to it later without searching again. Saving requires you to be signed
  in.

## My Saves tab

Lists every dataset you've saved, with a coloured status pill:

- **queued** — waiting for the processor.
- **processing** — being tiled and prepared.
- **ready** — fully processed; click **Load into viewer** to open it.
- **failed** — processing didn't complete. Re-save or contact support.

## Tips

- Saved presets can be loaded instantly because they're already tiled. Custom
  uploads go through queued → processing → ready as the server prepares them.
- The drawer remembers your last tab and filter as long as it stays open. Close
  and reopen the drawer to start fresh.
- The search is debounced by ~400 ms, so you don't need to wait between
  keystrokes.
