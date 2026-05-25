---
id: drift-planner
title: Drift Planner
section: Features
order: 8
---

# Drift Planner

The drift planner helps you predict how your boat will move when you cut the engine, given the current wind and water currents.

## Opening the planner

Look for the **Drift Planner** entry under the side pane or the Throttle / Tide group. When you enable it, an arrow appears on the overview map showing your predicted drift direction and speed.

## What it uses

- **Wind** — from the tide / weather data provider.
- **Surface current** — from the tidal overlay at the layer you have selected (surface, mid-water, or near-bottom).
- **Your fishing-line length** (optional) — to estimate where your bait will end up after drifting for N minutes.

## What to set

- **Start position** — your current GPS or a pin you dropped.
- **Drift duration** — how long you want to drift for.
- **Line length** — for fishing-line trajectory.

The planner shows a predicted ending position and a faint trail in between.

> **Heads up:** this is a simple linear model. Eddies, depth-driven currents, and shoreline effects are not modelled. Use it as a sanity check, not as a navigation source.

## Tips

- Pair the planner with a **Drift Start** marker so you can see how your real drift compared to the prediction.
- For long drifts, re-check the wind and current data — they change throughout the day.
- Heavy gear (jigs, downriggers) drifts much less than the surface — use the near-bottom current layer.
