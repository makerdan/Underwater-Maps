---
id: zones-paint-mode
title: Zones & Paint Mode
section: Features
order: 6
---

# Zones & Paint Mode

BathyScan classifies the seafloor into **zones** so you can quickly see what kind of bottom you are flying over.

## How zones are classified

When a dataset loads, the app sends a low-resolution depth image to the AI, which returns a 32×32 grid of zone labels. The classification is cached so it only runs once per dataset.

**Saltwater zones:** sandy shelf, coarse sediment, silt plain, basalt rock, volcanic vent field, trench wall, seamount flank, coral reef potential.

**Freshwater zones:** aquatic vegetation, sandy lake bed, rocky shoreline, silt deep, gravel bed, bedrock shelf, submerged wood, clay flat.

## The Zone overlay

The **Zone overlay** panel (left side, below Datasets) toggles a coloured tint on top of the terrain that shows the AI's classification. Each zone has its own colour swatch in the panel legend.

## Paint mode (correcting the AI)

The AI is good but not perfect. Open the Zone overlay panel and click **Paint** to enter **Paint mode**:

1. Pick a target zone from the swatch list.
2. Move the cursor over the terrain — cells under the brush change colour.
3. Click and drag to repaint.
4. Use **Brush size** to adjust the radius.
5. Click **Save** to persist your corrections.

Corrections are stored per dataset and override the AI's classification for those cells.

## Substrate colour mode

The **◼ SUBSTRATE** button in the bottom-right recolours the actual terrain texture (not just an overlay) by substrate type — sand, sediment, silt, basalt. Useful for screenshots.
