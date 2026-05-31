---
id: first-time-guide
title: First-Time Guide
section: Getting Started
order: 1
showQA: true
---

# Welcome to BathyScan

BathyScan is a 3D seafloor and lake-bed explorer. You can fly over real-world bathymetry (depth) data, mark interesting spots, classify zones, run drift and trolling plans, analyse tidal currents, and ask an AI for help understanding what you are looking at.

This guide walks you through your first session step by step.

## 1. Choose your water environment

At the very top of the **Datasets** panel on the left you will find the **Environment toggle**:

- **Saltwater** — opens ocean and coastal datasets; the AI uses marine vocabulary and saltwater marker types.
- **Freshwater** — opens lake and reservoir datasets; the AI switches to freshwater species and freshwater marker types.

Switch this first — the entire dataset list, zone labels, habitat species, and marker types all update to match.

## 2. Pick a dataset

Below the environment toggle you will see **Built-in datasets** — public regions such as Thorne Bay, Monterey Canyon, and several lakes. Click one to load it.

The first time you load a dataset it will fetch a depth grid and an overview tile. You will see a small spinner while it works.

![Datasets panel with built-in regions](/help/datasets-panel.png)

## 3. Look around in orbit mode

When the scene first loads you are in **Orbit mode**. Click and drag with your mouse to swing the camera around the terrain. Scroll to zoom.

The status badge in the top-left says **◎ ORBIT**. The crosshair in the centre of the screen shows the longitude, latitude, and depth under your cursor.

## 4. Switch to fly mode

Click anywhere on the terrain to enter **Fly mode**. The badge changes to **● FLY** and your mouse is locked to the camera.

| Key | Action |
| --- | --- |
| W A S D | Move forward, back, and strafe |
| Space | Ascend |
| Shift | Descend |
| = / - | Speed tier up / down |
| Esc | Release the mouse and return to orbit |

## 5. Use the crosshair action menu

In fly mode, press **Q** (or right-click) to open the **Crosshair Action Menu** at the current terrain point. From here you can:

- **Drop GPS pin here** — opens the marker creation form at that location.
- **Measure from here** — starts a distance or depth-profile measurement.
- **Start straight-line / path profile** — begins a depth profile.
- **Set as home position** — saves this location as the default spawn for this dataset.
- **Save view as bookmark** — records the current camera state by name.
- **Copy coordinates** — copies lat, lon, depth to the clipboard.

## 6. Open the overview map

Press **O** to toggle the **Overview Map** — a top-down minimap that shows the entire dataset, your camera position, all your markers, and (when active) tidal-arrow overlays. Press **O** again to close it.

## 7. Drop a marker

In fly mode, press **G** to open the **Drop Marker** form, or use the crosshair action menu (Q → Drop GPS pin here). The current crosshair location is pre-filled. Pick a type, give it a label, and click **Save Marker**.

Markers persist between sessions and appear on the overview map as coloured dots.

## 8. Try the AI assistant

Press **`/`** to open the AI Query panel. Type something like:

> "Take me to the deepest spot in this dataset"

or

> "Where might I find rockfish habitat?"

The AI can navigate the camera, highlight zones, change colours, and answer geology questions.

## 9. Save your view

The app remembers your last dataset, camera position, and settings between sessions. Just close the tab — when you come back you will land roughly where you left off.

---

## Where to go next

- **Interface Tour** — what every panel and badge means
- **Overview Map** — opening the minimap, contour lines, and syncing with the 3D camera
- **Keyboard Shortcuts** — every key the app responds to
- **Datasets & Uploads** — upload your own bathymetry, manage folders, import GPX/KML
- **Drift Planner** — drift prediction, trolling mode, and waypoints
- **AI Assistant** — example prompts and what to expect
