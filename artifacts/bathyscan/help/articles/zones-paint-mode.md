---
id: zones-paint-mode
title: Zones & Paint Mode
section: Features
order: 6.5
---

# Zones & Paint Mode

BathyScan classifies the seafloor into **zones** so you can quickly see what kind of bottom you are flying over. The zone overlay also drives the habitat scoring and the depth-profile zone strip.

## How zones are classified

When a dataset loads, the app sends a low-resolution depth image to the AI, which returns a 32×32 grid of zone labels. The classification is cached so it only runs once per dataset.

**Saltwater zones:** sandy shelf, coarse sediment, silt plain, basalt rock, volcanic vent field, trench wall, seamount flank, coral reef potential.

**Freshwater zones:** aquatic vegetation, sandy lake bed, rocky shoreline, silt deep, gravel bed, bedrock shelf, submerged wood, clay flat.

## The Zone overlay

The **Zone overlay** panel (left side, below Datasets) toggles a coloured tint on top of the terrain that shows the AI's classification. Each zone has its own colour swatch in the panel legend.

### Habitat intensity

The **Habitat Intensity** slider (inside the Zone overlay panel) controls how boldly the zone colours are rendered on the terrain:

- At **0 %** the zone overlay is invisible (but still active for habitat scoring and the depth-profile strip).
- At **50 %** (default) the zone tint blends with the depth colormap.
- At **100 %** zone colours are fully saturated and the underlying depth shading is suppressed.

Adjust intensity to balance terrain readability against zone legibility. A lower intensity is useful when you want to see fine terrain detail; a higher intensity makes zone boundaries easier to trace.

## Paint mode (correcting the AI)

The AI is good but not perfect. Open the Zone overlay panel and click **Paint** to enter **Paint mode**:

![Brush sweeping across the zone grid, repainting cells](/help/paint-mode.gif)

1. Pick a target zone from the swatch list.
2. Move the cursor over the terrain — cells under the brush highlight.
3. Click and drag to repaint cells to the chosen zone.
4. Use the **Brush size** slider to adjust the radius (1–8 cells).
5. Click **Save** to persist your corrections, or **Cancel** to discard them.

Corrections are stored per dataset and override the AI's classification for those cells. They are visible in the zone overlay, the depth-profile strip, and habitat scoring.

## Substrate colour mode

The **◼ SUBSTRATE** button in the Overlays panel (left sidebar) recolours the actual terrain texture (not just an overlay) by substrate type — sand, sediment, silt, basalt. Useful for screenshots. This is separate from the zone overlay and does not affect habitat scoring.

---

## Habitat species catalog

The Habitat Layer panel scores the seafloor against the following species. Select a water type to see what is available.

### Saltwater / Marine

| Species | Typical depth | Preferred substrate |
|---|---|---|
| Dungeness Crab | 10–120 m (optimal) | Sandy shelf, aquatic vegetation |
| Demersal Fish (General) | 30–300 m | Coral reef, silt plain, seamount flank |
| Rockfish | 50–400 m | Basalt rock, rocky shoreline, seamount |
| Halibut | 20–200 m | Silt plain, sandy shelf, clay flat |
| Salmon (Resting) | 5–50 m | Aquatic vegetation, sandy shelf, gravel |
| Chinook Salmon | 15–100 m | Sandy shelf, seamount flank, coarse sediment |
| Coho Salmon | 5–60 m | Sandy shelf, aquatic vegetation, rocky shoreline |
| Lingcod | 25–160 m | Basalt rock, bedrock shelf, seamount flank |
| Cabezon | 5–55 m | Basalt rock, coral reef, rocky shoreline |
| Pacific Herring | 5–80 m | Sandy shelf, aquatic vegetation, coarse sediment |

### Freshwater / Lake

| Species | Typical depth | Preferred substrate |
|---|---|---|
| Lake Trout | 30–100 m | Bedrock shelf, rocky shoreline, gravel bed |
| Rainbow Trout | 2–25 m | Gravel bed, rocky shoreline, bedrock shelf |
| Brown Trout | 2–18 m | Gravel bed, rocky shoreline, bedrock shelf |
| Walleye | 5–40 m | Gravel bed, sandy lake bed, rocky shoreline |
| Largemouth Bass | 1–8 m | Aquatic vegetation, submerged wood |
| Smallmouth Bass | 2–10 m | Rocky shoreline, gravel bed, bedrock shelf |
| Northern Pike | 1–6 m | Aquatic vegetation, submerged wood |
| Striped Bass | 4–28 m | Sandy lake bed, gravel bed, rocky shoreline |
| Yellow Perch | 3–20 m | Sandy lake bed, gravel bed, aquatic vegetation |
| Channel Catfish | 3–25 m | Silt deep, clay flat, submerged wood |
| Crayfish | 0.5–5 m | Rocky shoreline, gravel bed, submerged wood |

Depth ranges shown are the **optimal** band (highest suitability). Each species also tolerates a wider range at reduced scores. The scoring weights depth, substrate type, slope, structural complexity, and zone-edge proximity according to published fisheries habitat data.
