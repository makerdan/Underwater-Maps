---
id: essential-fish-habitat
title: Essential Fish Habitat (EFH)
section: Features
order: 5.5
showQA: true
---

# Essential Fish Habitat (EFH)

**Essential Fish Habitat** polygons delineate areas that NOAA has designated as critical for the spawning, breeding, feeding, or growth of federally managed fish species. BathyScan overlays these polygons on both the 3D scene and the [Overview Map](#article:overview-map) for supported datasets.

## Availability

EFH data is only available for marine (saltwater) datasets that include the relevant bounding box. A small **EFH** badge appears in the dataset's [data provenance](#article:data-provenance) card when EFH polygons have been loaded for the current view. Inland freshwater datasets do not have EFH overlays.

## Toggling the EFH layer

Open the **Overlays** panel (left sidebar) and click **🐟 EFH** to show or hide the polygon overlay. When enabled, coloured polygons appear on the seafloor in the 3D scene and as filled outlines on the Overview Map. Each species has its own assigned colour.

## Viewing species details

Click any EFH polygon in the 3D scene or on the Overview Map to open the **EFH Detail Card** on the right side of the screen.

The card shows:

| Field | Description |
| --- | --- |
| **Common name** | The species' plain-language name (e.g. "Pacific Halibut") |
| **Scientific name** | Genus and species in italics |
| **FMP** | The Fishery Management Plan that designated this habitat |
| **Life stage** | The life stage covered by this EFH designation (e.g. adult, juvenile, larvae) |
| **Season** | Seasonal restriction if applicable |
| **Depth range** | Min–max depth in your chosen units |
| **Habitat** | Free-text description of the preferred habitat type |
| **Source** | Regulatory source (NOAA, TPWD, etc.) |

A link at the bottom of the card opens the original NOAA EFH shapefile page or, for Texas waters, the Texas Parks & Wildlife (TPWD) lake page.

> **Note:** TPWD polygons represent priority habitat designated by Texas Parks & Wildlife, **not** federal EFH. This distinction is shown with an orange notice in the card.

## Closing the card

Click the **×** in the top-right corner of the card, or press **Escape**.

## Multiple overlapping polygons

In areas with dense designations, clicking selects one polygon at a time. Click nearby to select a different species' polygon if polygons overlap.

## Related features

- [HUD Overlay Toggles](#article:hud-overlays) — where to find the **🐟 EFH** toggle button.
- [Zones & Paint Mode](#article:zones-paint-mode) — AI-driven habitat scoring that complements the EFH regulatory layer.
- [Data Provenance](#article:data-provenance) — how to tell whether the current dataset includes EFH data.
