---
id: temperature-profile
title: Temperature Profile Chart
section: Features
order: 7.8
---

# Temperature Profile Chart

The **Temperature Profile Chart** shows how water temperature changes with depth at your current map location. It opens as a popover attached to the **TEMP** chip in the HUD (heads-up display).

## Opening the chart

Click the **TEMP** chip in the HUD. The chart slides in showing temperature on the X-axis and depth on the Y-axis, so warmer shallows are to the right and deeper, colder water is toward the bottom.

Close the chart by clicking the **✕** button in the chart header or by clicking the TEMP chip again.

## Reading the chart

| Axis | What it shows |
| --- | --- |
| **X (horizontal)** | Temperature in °C (or °F if you have imperial units enabled in Settings) |
| **Y (vertical)** | Depth in metres (or feet), increasing downward |

The orange line traces the temperature curve. The shaded area under the line helps you see the shape of the thermocline at a glance.

**Crosshair highlight** — when the camera crosshair is positioned over water, a cyan dot appears on the curve at the depth matching the camera's current depth. Dashed lines extend to both axes so you can read off the exact temperature and depth.

## Source badge

A small badge in the lower-left corner of the chart indicates the data source quality:

| Badge | Colour | Meaning |
| --- | --- | --- |
| **MEASURED** | Green | Profile comes from a real in-situ measurement — a CTD cast or Argo float profile — co-located with the current view |
| **LIVE SST** | Cyan | Surface temperature is from a live satellite or buoy feed; subsurface is interpolated from a reanalysis climatology |
| **EST** | Amber | Profile is estimated from NCEI reanalysis climatology for the location and month; no recent in-situ measurement was found nearby |

The source name and a link to the originating dataset appear next to the badge. If a timestamp is available it is shown below in UTC.

## Data sources

BathyScan draws temperature profiles from three sources, in order of preference:

### Argo floats

**Argo** is a global array of profiling floats that drift at depth and surface periodically to transmit temperature and salinity profiles. When an Argo float profile is available within the search radius, it is used as the primary source (MEASURED badge).

### CTD casts

**CTD** (Conductivity, Temperature, Depth) casts are direct in-water measurements collected during research cruises or monitoring programmes. Bundled CTD cast data from NOAA and partner agencies is searched for profiles near your location. CTD casts also appear with the MEASURED badge.

### NCEI reanalysis climatology

When no recent Argo or CTD profile is available, the chart falls back to the **NOAA NCEI World Ocean Atlas** monthly climatology — a gridded statistical model of typical temperature at depth for each location and calendar month. This produces the **EST** badge. Climatology profiles are smooth and represent long-term averages rather than current conditions.

## Temperature units

The chart respects the **Temperature** unit setting in **Settings → Units**. Switch between Celsius and Fahrenheit there; the chart axis labels update automatically. See [Settings](#article:settings) for details.

## Thermocline and the depth profile

The temperature profile complements the [Depth Profile](#article:depth-profile) chart: the depth profile tells you about the shape of the seafloor, while the temperature profile tells you about the water column above it. Run both together to understand the full environment — for example, a steep thermocline at 30 m combined with a ledge at that depth often indicates a productive fishing or diving area.

## Tips

- If the badge shows **EST**, the profile reflects seasonal averages — actual conditions may differ significantly, especially in upwelling zones or after storm mixing.
- In shallow nearshore areas the profile may only extend to a few tens of metres; in deep offshore areas it may reach several hundred metres.
- The crosshair highlight is most useful in the 3D fly-through view: fly down to a depth of interest and glance at the TEMP popover to read the temperature at that depth.
