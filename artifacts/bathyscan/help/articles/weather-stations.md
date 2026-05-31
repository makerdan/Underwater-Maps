---
id: weather-stations
title: Weather Stations
section: Features
order: 14
showQA: true
---

# Weather Stations

BathyScan can display aviation weather station data for the area you are exploring — useful for coastal pilots, float-plane operators, and anglers who want to check wind, visibility, and ceiling before heading out.

Weather station overlays are only available in **Saltwater** mode.

## Enabling the overlays

Both weather station types are controlled from the **Overlays panel** in the left sidebar:

- **🛩 NOAA WEATHER STATIONS** — toggles NOAA ASOS/AWOS observation station pins.
- **🌿 RAWS WEATHER STATIONS** — toggles AOOS RAWS land-based weather station pins.

Click the button again to hide the pins.

## Station pins

| Pin type | Appearance |
| --- | --- |
| NOAA ASOS/AWOS | Yellow circle labelled **W** |
| RAWS land station | Green circle labelled **R** |

Pins appear on both the 3D scene and the [Overview Map](#article:overview-map).

## What the popover shows

Click any station pin to open a detail popover. It displays:

| Field | Description |
| --- | --- |
| Station ID | ICAO identifier (e.g. KBLI) |
| Wind | Speed in knots and compass direction (e.g. NE 45° @ 12 kt) |
| Visibility | In statute miles (imperial) or km (metric) |
| Ceiling | In feet AGL, or CLEAR when skies are clear |
| Temp | In °C or °F |
| Obs time | When the observation was taken (UTC) |

A **STALE** badge appears when the app is serving the last cached observation rather than a fresh one.

The popover also includes a **FAA WeatherCams ↗** link that opens the FAA WeatherCams website for the relevant state or region in a new browser tab.

## FAA WeatherCams

BathyScan does not embed FAA camera images directly. The **📷 FAA WEATHERCAMS ↗** button in the Overlays panel and the link inside each station popover both open the FAA WeatherCams site externally — you can browse camera feeds there to get a visual on conditions at nearby passes, headlands, and airports.

## Using weather data for trip planning

- **Wind** — feeds the [Drift Planner](#article:drift-planner)'s drift calculation. A strong onshore wind will significantly affect your drift direction.
- **Ceiling and visibility** — give a rough indication of fog and low cloud. Very low ceilings often correlate with marine layer and reduced visibility on the water.
- **RAWS stations** — particularly useful for lake fishing in mountainous terrain, where land-based wind readings are more representative than coastal NOAA stations.

## Tips

- Stations fetch observations within approximately 75 miles of your current camera position. Pan to a different area to load stations for that location.
- Weather station overlays are not available in Freshwater mode.
- The STALE badge means the last known observation is being shown. Data is still useful directionally; just check the obs time to see how old it is.
