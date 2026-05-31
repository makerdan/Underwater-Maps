---
id: data-provenance
title: Data Provenance
section: Features
order: 3.5
showQA: true
---

# Data Provenance

Every BathyScan dataset carries a **provenance badge** that tells you exactly where the depth data came from, how detailed it is, and who collected it. This helps you understand the reliability and appropriate use of the terrain you are exploring.

## Where to find it

The provenance card is embedded in the **Datasets** panel (left sidebar), directly below the active dataset name. Click the small **▼** or **ℹ** expander to reveal the full card if it is collapsed.

## Source badges

Each dataset displays one of the following source badges:

| Badge | Colour | Source |
| --- | --- | --- |
| **NCEI Multibeam** | Cyan | High-resolution (1–50 m) NOAA multibeam sonar surveys, delivered via the National Centers for Environmental Information BAG Mosaic. Real survey data collected by ships. |
| **GEBCO 2024** | Purple | General Bathymetric Chart of the Oceans — a ~400 m global grid compiled from satellite altimetry, ship soundings, and the SRTM15+ model. Best available data for open ocean. |
| **USGS 3DEP** | Green | USGS 3D Elevation Program — best-available digital elevation model (1 m lidar where collected, 1/3 arc-second otherwise). Used for inland reservoir pre-impoundment bathymetry. |
| **TWDB Survey** | Green | Texas Water Development Board reservoir volumetric and sedimentation surveys. Authoritative for Texas reservoirs. |
| **USACE Hydro** | Green | US Army Corps of Engineers hydrographic survey data. |
| **Simulated** | Amber | Procedurally generated terrain. The upstream real-data source (NCEI or GEBCO) was unreachable at load time. Use for orientation only — depths are not real. |

> **Important:** A **Simulated** badge means the terrain is fictional. Do not use it for navigation, safety planning, or habitat assessment. Reload the dataset when you have a stable connection to try fetching real data.

## Resolution and grid size

Below the source badge the card shows:

- **Resolution** — the horizontal spacing between depth samples (e.g. "5 m / pixel"). Smaller values mean finer detail.
- **Grid size** — total width × height of the depth grid in samples (e.g. "512 × 512").

Higher-resolution NCEI surveys resolve individual boulders and channel walls. GEBCO at ~400 m resolution smooths over features smaller than several city blocks.

## EFH availability

If the dataset includes [Essential Fish Habitat](#article:essential-fish-habitat) polygons, an **EFH** badge appears in the provenance card. Click the **🐟 EFH** toggle in the Overlays panel to display the polygons.

## Credit link

A **↗ source link** at the bottom of the card opens the official data portal for the source in a new tab. This is useful if you need to cite the data in a report or download the original files.

## Relationship to simulated data confirmation

When BathyScan cannot retrieve real bathymetry for a selected area, it shows a **Simulated Data** confirmation dialog before loading the procedural fallback. You must accept this dialog explicitly. After loading, the provenance badge confirms the simulated state at all times so you never lose track of which datasets are real vs. generated.

## Related features

- [Datasets & Uploads](#article:datasets-uploads) — loading, switching, and uploading custom terrain.
- [Essential Fish Habitat](#article:essential-fish-habitat) — the EFH polygon layer that the provenance badge links to.
- [Terrain & 3D Scene](#article:terrain-3d-scene) — how BathyScan renders the depth grid into a 3D surface.
