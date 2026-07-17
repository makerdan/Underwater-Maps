---
id: analyze-mode
title: Analyze Mode Walkthrough
section: Workflows
order: 3
---

# Analyze Mode Walkthrough

The **Analyze tab** is where you interpret what the 3D scene is telling you — correcting AI zone classifications, scoring habitat quality for a target species, measuring depth profiles, and querying the AI assistant about specific features. Switch to it by clicking **Analyze** at the top of the left sidebar.

## Zone Overlay

The **Zone Overlay** panel shows AI-generated terrain zone classifications overlaid on the seafloor.

### Viewing classifications

Toggle **Zone Overlay** on to colour the terrain by zone type (e.g. Flat Sand, Rocky Reef, Deep Mud). A legend at the bottom of the panel identifies each colour.

### Entering Paint mode

The AI is a starting point, not a ground truth. If you know a zone is wrong:

1. Click **Enter Paint mode** in the Zone Overlay panel.
2. Select the zone type you want to apply from the palette.
3. Click or drag across the terrain in the 3D scene to repaint cells.
4. Click **Exit Paint mode** when done. Your corrections are saved per-dataset.

Repainted zones affect Habitat Layer scores for that area — correcting misclassified reef to rocky substrate, for example, raises the score for species that prefer rocky bottom.

## Habitat Layer

The **Habitat Layer** panel scores the visible seafloor for a selected target species.

### Selecting a species

Click the **species selector** dropdown and choose your target (e.g. Pacific Halibut, Lingcod, Brown Trout). The terrain recolours to a hotspot score map — warmer colours indicate higher habitat suitability based on depth, slope, substrate, and zone classification.

### Reading hotspot scores

Hover any point on the terrain (in orbit or fly mode) to see the habitat score and the primary contributing factors in a tooltip. A score of **0.8–1.0** is high-quality habitat; below **0.4** is marginal.

## Depth Profile

The **Depth Profile** tool measures the seafloor elevation along a line or path.

### Starting a measurement

**Straight-line profile:**
1. Press **Q** (or right-click) on the terrain at your start point.
2. Choose **Start straight-line profile**.
3. Press **Q** again at the end point and choose **Finish path here**.

**Multi-waypoint path profile:**
1. Press **Q** at the start and choose **Start path profile**.
2. Press **Q** at each intermediate point and choose **Add waypoint here**.
3. Press **Q** at the final point and choose **Finish path here**.

The profile chart appears along the bottom of the screen showing depth on the Y-axis and distance on the X-axis.

### Exporting the profile

Click **Export** in the profile panel and choose:

- **PNG** — saves the chart as an image.
- **CSV** — downloads columns: `distance_m`, `depth_m`, `slot`, `lon`, `lat`.

## AI Query panel

The **AI Query panel** lets you ask free-form questions about the terrain, zone classifications, habitat suitability, and data sources.

### Opening the panel

Press **/** (forward slash) or click the query icon in the Analyze tab to open the AI Query panel.

### Example prompts

- *"What substrate types are in this dataset?"*
- *"Why does this area score low for Lingcod?"*
- *"What is the deepest point visible and where is it?"*
- *"Summarise the zone distribution in the current view."*

### What the AI can and cannot do

| Can do | Cannot do |
| --- | --- |
| Describe zone and habitat patterns visible in the scene | Access real-time external data (weather, tides) |
| Explain why a habitat score is high or low | Make decisions about regulatory compliance or safety |
| Suggest what to look for given your target species | Replace survey-grade measurements |
| Answer questions about BathyScan features | Guarantee accuracy of AI zone classifications |

The AI shares a rate-limit quota with other AI features. If you hit the limit, wait ~30 seconds and try again.

## Tips

- Paint mode corrections persist across sessions and travel with your account — you only need to correct a dataset once.
- Run a depth profile along a ridge or channel edge to find the depth at which a target species concentrates.
- Use the AI Query panel to quickly orient yourself to a new dataset before spending time in Paint mode.
- Habitat scores update in real time when you switch species — flipping between two species quickly shows which areas are dual-habitat.
