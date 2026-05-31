---
id: terrain-3d-scene
title: Terrain & 3D Scene
section: Features
order: 3
---

# Terrain & 3D Scene

The 3D view is the heart of the app. It renders the active dataset as a textured, shaded mesh you can fly around, with optional landmass, water surface effects, and customisable colourmaps.

## Camera modes

BathyScan has two camera modes:

- **Orbit** — click-and-drag to swing around a target, scroll to zoom. Best for getting your bearings.
- **Fly** — first-person free-flight. Click to enter, **Esc** to exit.

The badge in the top-left always tells you which mode you are in.

## Movement (fly mode)

| Key | Action |
| --- | --- |
| W A S D | Move forward / strafe |
| Space | Ascend |
| Shift | Descend |
| Scroll | Change speed tier |
| Tab | Toggle Orbit / Fly mode |

The speed indicator (bottom-left) shows your current speed as a row of dots. Higher speeds cross the dataset quickly; lower speeds allow precise positioning.

## Heading and depth

- **HDG** in the top-left is your compass heading (0° = north, 360° wraps to north).
- **DEPTH** in the bottom-left is how far below sea level (or lake surface) the camera currently is.

## Landmass layer

When a dataset includes coastline data, BathyScan renders a **Landmass layer** — the above-water terrain around the edges of the dataset. This gives geographic context so you can relate the seafloor to nearby shores.

Toggle the landmass on or off under **Settings → Visuals → Show Landmass**.

## Satellite imagery

When the landmass layer is on, you can also enable **Satellite Imagery** under **Settings → Visuals → Satellite Imagery**. This drapes real aerial/satellite imagery over the landmass surface for a photo-realistic look. The toggle is hidden if the landmass layer is off, since satellite imagery applies only to the above-water terrain.

You can also toggle satellite imagery on and off for the overview map independently — see [Overview Map](#article:overview-map).

## Water surface animations

The animated water plane sits above the seafloor and adds realism:

- **Caustics** — shimmering light-refraction patterns on the seafloor, visible in shallow water. Toggle under **Settings → Visuals → Caustics**.
- **Marine snow** — a slow particle fall of organic particles visible in the water column. Toggle under **Settings → Visuals → Marine Snow**.
- **Water opacity** — adjust how transparent the water surface appears so you can see through to the terrain more clearly.

All three are disabled automatically when the **Quality preset** is set to Low.

## Smooth terrain spikes filter

Raw bathymetric survey data sometimes contains outlier depth readings that create sharp spikes in the mesh. Enable **Settings → Visuals → Smooth Terrain Spikes** to run a median filter that removes isolated high or low cells without blurring real features.

## Depth colormap

The terrain is shaded by depth using a colormap. Change it under **Settings → Visuals → Depth Colormap**:

| Colormap | Best for |
| --- | --- |
| Ocean | Default saltwater look — blue shades deep to shallow |
| Freshwater | Default freshwater look — green-brown palette suited to lakes |
| Thermal | Purple to white — high contrast on flat regions |
| Grayscale | Printing or measuring — no colour bias |
| Viridis | Perceptually uniform, colour-blind safe |
| Magma | Dark background, warm highlights — good for presentations |
| Colour-blind (CVD) | Optimised for common colour-vision deficiencies |
| Custom / Gradient | Define your own two-colour gradient — see below |

### Custom / gradient palette editor

Choose **Custom** to open the **Palette Editor**. You can:

1. Pick a **start colour** (shallowest depth) and an **end colour** (deepest depth).
2. Optionally add up to three **midpoint stops** and drag them along the gradient bar.
3. Click **Preview** to see the changes on the terrain without saving.
4. Click **Save Palette** to apply it permanently.

Custom palettes are stored per-account and survive reloads.

## Vertical exaggeration

Real ocean terrain is gentle — kilometres wide, only a few hundred metres deep. To make features visible, the app exaggerates depth by a factor. Adjust under **Settings → Visuals → Terrain Exaggeration**:

| Preset | Factor | When to use |
| --- | --- | --- |
| Subtle | 1.0× | Survey-grade accuracy |
| Natural | 1.5× | Good everyday default |
| Dramatic | 2.5× | Emphasises ridges and canyons |
| Extreme | 5.0× | Highlights subtle shelf features |

You can also drag the slider to set any value between 0.5× and 10×. Tweaking this switches the preset to **Custom**.

## Realistic speed mode

You can toggle a "realistic" boat-speed mode in Settings. When on, the speed indicator shows knots instead of unitless tiers — useful for planning a real-world transect or trolling run. Use the [Throttle Panel](#article:throttle) to set your exact speed when this mode is active.

## Substrate colour mode

The **◼ SUBSTRATE** button in the Overlays panel (left sidebar) recolours the actual terrain texture by substrate type — sand, sediment, silt, basalt. Useful for screenshots and habitat planning.
