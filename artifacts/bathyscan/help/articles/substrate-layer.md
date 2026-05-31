---
id: substrate-layer
title: Substrate Layer
section: Features
order: 6.8
showQA: true
---

# Substrate Layer

The **Substrate layer** recolours the visible seafloor by classified sediment type — sand, sediment, silt, and basalt — sourced from ShoreZone coastal survey data. Unlike the [Zones & Paint Mode](#article:zones-paint-mode) AI overlay, substrate polygons are based on mapped field surveys rather than AI inference, and they represent physical sediment composition rather than habitat categories.

## Enabling the layer

In the **Overlays** panel (left sidebar), click **◼ SUBSTRATE** to toggle the layer on and off. When active, the terrain recolours to match the substrate legend:

| Colour | Substrate |
| --- | --- |
| Amber / tan | Sand |
| Slate blue | Sediment |
| Brown | Silt |
| Dark grey | Basalt |

The substrate tint applies directly to the terrain texture, not as a transparent overlay. This means it replaces the depth colourmap in areas where polygon data exists.

## Availability

Substrate polygons are sourced from **ShoreZone**, a coastal classification programme covering Pacific North America. Coverage is best along the US West Coast and Alaska. Areas outside ShoreZone coverage render with no substrate tint even when the toggle is on.

## Viewing substrate details

Click any coloured substrate polygon in the 3D scene or on the [Overview Map](#article:overview-map) to open the **Substrate Feature** card on the right side of the screen.

The card shows:

| Field | Description |
| --- | --- |
| **ShoreZone class** | The official ShoreZone classification code and label |
| **Colour** | The substrate colour swatch for this class |
| **Description** | Brief characterisation of the surface type |

Close the card by clicking **×** or pressing **Escape**.

## Relationship to the Zone overlay

The [Zones & Paint Mode](#article:zones-paint-mode) panel provides an AI-generated overlay that classifies the entire seafloor into ecological zones. The Substrate layer is separate:

- **Substrate** = physically mapped sediment type (from ShoreZone surveys; may have gaps)
- **Zone overlay** = AI-inferred ecological classification (covers the full dataset area)

Both layers can be active at the same time. In that case the zone overlay tint blends on top of the substrate recolour; reduce the **Habitat Intensity** slider in the Zone panel if the combined display is too busy.

## ShoreZone credit

Substrate data is provided by the ShoreZone programme. A credit link is shown in the [Data Provenance](#article:data-provenance) panel for datasets that include ShoreZone coverage.

## Troubleshooting

- **No colours appear** — the current dataset area may not have ShoreZone coverage. Try a nearshore Pacific coast dataset.
- **Depth colourmap disappears** — this is expected; the substrate tint replaces the depth colour. Toggle the substrate layer off to restore depth shading.
- **Click does not open a card** — you may have clicked an area without polygon data. Only mapped polygons are clickable.
