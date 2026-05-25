---
id: terrain-3d-scene
title: Terrain & 3D Scene
section: Features
order: 3
---

# Terrain & 3D Scene

The 3D view is the heart of the app. It renders the active dataset as a textured, shaded mesh you can fly around.

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
| Tab | Toggle orbit / fly |

The speed indicator (bottom-left) shows your current speed as a row of dots. Higher speeds let you cross the dataset quickly; lower speeds make precise positioning easier.

## Heading and depth

- **HDG** in the top-left is your compass heading (0° = north).
- **DEPTH** in the bottom-left is how far below sea level (or lake surface) the camera currently is.

## Realistic mode

You can toggle a "realistic" boat-speed mode in Settings. When on, the speed indicator shows miles per hour and knots instead of unitless tiers — useful for planning a real-world transect.

## Coloured terrain

The terrain is shaded by depth using a colormap. The default palette is **Ocean**, but you can change it under **Settings → Visuals → Depth Colormap**:

- **Ocean** — blue-shaded, the default for saltwater
- **Thermal** — purple to white, good contrast on flat regions
- **Grayscale** — for printing or measuring
- **Viridis** — perceptually uniform, colour-blind friendly

You can also recolour the surface by substrate type with the **◼ SUBSTRATE** button in the bottom-right.

## Vertical exaggeration

Real ocean terrain is gentle — kilometres wide, only a few hundred metres deep. To make features visible, the app exaggerates depth by a small factor. Adjust this under **Settings → Visuals → Terrain Exaggeration**. Values around 1.5–2.5× look natural; higher values turn small ridges into dramatic cliffs.
