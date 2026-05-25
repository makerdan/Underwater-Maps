---
id: settings
title: Settings
section: Features
order: 10
---

# Settings

Open settings with the **Settings** link in the top bar, or by pressing **`,`** (comma) in the main view.

Settings are saved locally (and synced to the server when you are signed in) so they survive reloads and device switches.

## Sections

The settings page has a left-side navigator. The main groups are:

### Visuals & Performance
Quality preset (Low → Ultra), terrain exaggeration, marine snow, caustics, colour palette, advanced rendering knobs.

### HUD
Which on-screen badges to show or hide, opacity, units (metric / imperial), coordinate format (decimal degrees or DMS).

### Camera & Controls
Mouse sensitivity, scroll behaviour, fly-mode speed tiers, joystick mode for mobile.

### Side Panels
Toggle visibility of every left-column panel (Datasets, Tide, Habitat, Query, etc.).

### Data Loading
Auto-load tidal overlay, default tidal depth layer, water type default.

### Markers
Default marker type, default depth-pole colour.

### Offline & Storage
List of cached datasets and their sizes, count of pending markers and trails waiting to sync, "clear cache" controls.

### Account
Email, sign-out, delete-all-my-markers control.

## Reset

Each section has a small **RESET SECTION** button in the top-right that restores its defaults without touching the others. There is also a global "Reset all" at the bottom of the page.

## Quality preset

The **Quality preset** dropdown is the fastest way to adapt to your hardware:

- **Low** — turn off particles, caustics, antialiasing. Best for older laptops.
- **Medium** — sparse particles, low textures.
- **High** — the default.
- **Ultra** — full particle density, high-resolution textures.

Tweaking any individual visual setting switches the preset to **Custom**.
