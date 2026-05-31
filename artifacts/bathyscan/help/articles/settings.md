---
id: settings
title: Settings
section: Features
order: 10
---

# Settings

Open Settings with the **Settings** link in the top bar, or by pressing **`,`** (comma) from the main view.

Settings are saved locally and synced to the server when you are signed in, so they survive reloads and device switches.

## Per-section RESET buttons

Every section has a **RESET SECTION** button in its top-right corner that restores only that section's defaults without touching the rest. There is also a global **Reset All** button at the very bottom of the Settings page.

---

## Visuals

Controls the look of the 3D scene.

| Setting | What it does |
| --- | --- |
| Quality Preset | Low / Medium / High / Ultra — adjusts all visual settings at once |
| Terrain Exaggeration | Depth multiplier from 0.5× to 10×. Presets: Subtle (1×), Natural (1.5×), Dramatic (2.5×), Extreme (5×) |
| Depth Colormap | Ocean, Freshwater, Thermal, Grayscale, Viridis, Magma, Colour-blind (CVD), Custom / Gradient |
| Custom Palette Editor | Appears when Custom is selected — pick start/end colours and up to three midpoint stops |
| Show Landmass | Renders the above-water shoreline terrain around the dataset |
| Satellite Imagery | Drapes aerial/satellite photos over the landmass. Hidden when Show Landmass is off |
| Caustics | Shimmering light patterns on the seafloor in shallow water |
| Marine Snow | Slow particle fall in the water column |
| Water Opacity | How transparent the water surface appears |
| Smooth Terrain Spikes | Median filter that removes single-point outlier spikes from the mesh |
| Contour Interval | Depth spacing between iso-depth contour lines (auto-scales by default) |

### Quality preset details

| Preset | Particle density | Textures | Antialiasing | Caustics |
| --- | --- | --- | --- | --- |
| Low | Off | Low | Off | Off |
| Medium | Sparse | Medium | Off | Off |
| High (default) | Normal | High | On | On |
| Ultra | Full | High | On | On |

Tweaking any individual visual setting switches the preset to **Custom**.

### Color-blind palette

The **Colour-blind (CVD)** colormap uses a palette designed for the most common forms of colour-vision deficiency (deuteranopia, protanopia, tritanopia). It is perceptually uniform and avoids red–green transitions.

---

## Accessibility

| Setting | What it does |
| --- | --- |
| Bright Daylight Mode | Boosts contrast and saturation for use in direct sunlight |
| Reduced Motion | Disables animated water surface, particles, and camera easing |
| High Contrast UI | Increases border and text contrast in all panels |

---

## HUD

Controls which on-screen elements are visible.

| Setting | What it does |
| --- | --- |
| Show Mode Badge | Orbit / Fly badge in the top-left |
| Show Heading | Compass heading (HDG) in the top-left |
| Show Crosshair | Reticle and coordinate readout at screen centre |
| Show Speed Indicator | Dot-row speed display in the bottom-left |
| Show Last Pin | Most recently dropped marker shown in the bottom-left |
| Show Offline Badge | OFFLINE indicator when connectivity is lost |
| HUD Opacity | Overall transparency of all HUD elements (0–100 %) |
| Units | Metric (metres, km) or Imperial (feet, nm, mph) |
| Coordinate Format | Decimal degrees (e.g. 56.1234° N) or DMS (e.g. 56° 7′ 24.24″ N) |

---

## Camera & Controls

| Setting | What it does |
| --- | --- |
| Mouse Sensitivity | How fast the camera rotates in fly mode |
| Scroll Behaviour | Whether scroll changes speed tier or zooms (orbit mode) |
| Fly-mode Speed Tiers | Adjust the speed of each dot-tier |
| Realistic Speed Mode | Shows knots in the speed indicator instead of unitless tiers |
| Joystick Mode | Touch-based virtual joystick for mobile / tablet use |
| Invert Y Axis | Invert up/down in fly mode |

---

## Side Panels

Toggle the visibility of each left-column panel individually:

- Datasets
- Zone Overlay
- Habitat Layer
- Drift Planner
- Tidal Panel
- Camera Position
- Keyboard Cheat-Sheet

---

## Tidal

| Setting | What it does |
| --- | --- |
| Auto-Load Tidal Data | Automatically activates the tidal overlay when a new dataset loads |
| Default Tidal Layer | Which current layer (Surface / Mid-col / Near-btm) is selected at start-up |

---

## GPS & Trail

| Setting | Options | What it does |
| --- | --- | --- |
| Auto-Start Trail Recording | On / Off | Automatically begins recording when a dataset loads |
| Recording Interval | 1 Hz (1 s), 0.5 Hz (2 s), 0.1 Hz (10 s) | How often a new trail point is sampled |
| Trail Colour | Colour picker | Colour of the breadcrumb trail line |
| Trail Retention | 7 days / 30 days / 90 days / Forever | How long trails are kept before automatic purge |

---

## Markers

| Setting | What it does |
| --- | --- |
| Default Marker Type | The type pre-selected in the Drop Marker form |
| Default Depth-Pole Colour | The colour pre-selected when you choose the Depth Pole type |

---

## Offline & Storage

| Setting | What it does |
| --- | --- |
| Cached Datasets | Lists each cached dataset, its tile count, and on-disk size |
| Enhanced Image Cache Size | Shows the current count and size of the AI-upscaled heatmap tile cache. Updates immediately after clearing |
| Pending Markers | Count of markers waiting to sync to the server |
| Pending Trails | Count of GPS trail segments waiting to sync |
| Clear Cached Tiles (per dataset) | Removes the tile cache for one dataset; the dataset itself is not deleted |
| Clear Enhanced Image Cache | Wipes the AI-upscaled heatmap cache; the size readout resets to 0 |
| Clear All Cached Data | Wipes the entire tile cache for all datasets |

---

## Account

| Setting | What it does |
| --- | --- |
| Email | Your account email address (display only) |
| Sign Out | Ends your session |
| Delete All My Markers | Permanently removes every marker across all your datasets (requires typed confirmation) |
