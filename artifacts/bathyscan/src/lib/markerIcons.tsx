/**
 * markerIcons — custom SVG icon library for marker types.
 *
 * Every marker type (new four-section library + all legacy types) resolves to
 * a small stroke-style SVG icon drawn in a 24x24 viewBox. Icons are renderable
 * three ways:
 *   - <MarkerIcon>       inline SVG for React UI (picker, lists, cards)
 *   - <MarkerIconPaths>  bare path group for embedding inside an existing SVG
 *   - loadMarkerIconImage / markerIconSvgString  rasterisable form for
 *     2D-canvas layers (Minimap) and three.js canvas textures (MarkerSprite)
 *
 * Unknown types fall back to the "custom" pin so nothing ever renders blank.
 */
import React from "react";

export interface MarkerIconPath {
  d: string;
  /** true → filled shape; false/omitted → stroked outline */
  fill?: boolean;
}
export interface MarkerIconDef {
  paths: MarkerIconPath[];
}

/* Shared silhouette building blocks (24x24 viewBox) */
const FISH_BODY = "M2.5 12c2.5-3.8 6-5.7 9.5-5.7 3.2 0 5.9 1.9 7.5 5.7-1.6 3.8-4.3 5.7-7.5 5.7-3.5 0-7-1.9-9.5-5.7z";
const FISH_TAIL = "M19.5 12L23 8v8z";
const FISH_EYE = "M6.4 10.6a1 1 0 100 2 1 1 0 000-2z";
const SMALL_FISH = (dx: number, dy: number, s = 1) =>
  `M${dx} ${dy}c${1.6 * s}-${1.8 * s} ${3.6 * s}-${1.8 * s} ${5 * s} 0-${1.4 * s} ${1.8 * s}-${3.4 * s} ${1.8 * s}-${5 * s} 0z M${dx + 5 * s} ${dy}l${1.8 * s}-${1.4 * s}v${2.8 * s}z`;

const DEFS: Record<string, MarkerIconDef> = {
  /* ── Generic / special ── */
  fish: { paths: [{ d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true }] },
  custom: {
    paths: [
      { d: "M12 2.5c-3.6 0-6.5 2.9-6.5 6.5 0 4.9 6.5 12 6.5 12s6.5-7.1 6.5-12c0-3.6-2.9-6.5-6.5-6.5z" },
      { d: "M12 6.8a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4z", fill: true },
    ],
  },
  depth_pole: {
    paths: [
      { d: "M12 2v20" },
      { d: "M8.5 5h7M9.5 9.5h5M8.5 14h7M9.5 18.5h5" },
    ],
  },

  /* ── Freshwater species ── */
  crappie: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M10.5 9.4a.8.8 0 100 1.6.8.8 0 000-1.6zM14 11.2a.8.8 0 100 1.6.8.8 0 000-1.6zM11 13.4a.8.8 0 100 1.6.8.8 0 000-1.6z", fill: true },
    ],
  },
  catfish: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M3.5 10.5L.8 8.6M3.5 13.5L.8 15.4" },
    ],
  },
  bass: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M4.5 12h13" },
    ],
  },
  sand_bass: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M10 8.2v7.6M13.5 8.2v7.6" },
    ],
  },
  lake_trout: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M5 13.5q2 -1.6 4 0t4 0 4 0" },
    ],
  },
  pike: {
    paths: [
      { d: "M1.5 12c1.5-1.6 6-3.4 11-3.4 3.6 0 6.4 1.2 8 3.4-1.6 2.2-4.4 3.4-8 3.4-5 0-9.5-1.8-11-3.4z" },
      { d: "M19.5 12L23 9v6z", fill: true },
      { d: "M4.6 11a.9.9 0 100 1.8.9.9 0 000-1.8z", fill: true },
    ],
  },
  walleye: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true },
      { d: "M6.6 9.7a1.9 1.9 0 100 3.8 1.9 1.9 0 000-3.8z" },
      { d: "M6.6 10.9a.7.7 0 100 1.4.7.7 0 000-1.4z", fill: true },
    ],
  },
  perch: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M9 8.5v7M12 8v8M15 8.7v6.6" },
    ],
  },
  rainbow_trout: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M4.5 13.2c3-2 9-2 13.5-.6" },
    ],
  },
  salmon: {
    paths: [
      { d: "M2.5 12c2.5-3.8 6-5.7 9.5-5.7 3.2 0 5.9 1.9 7.5 5.7-1.6 3.8-4.3 5.7-7.5 5.7-3.5 0-7-1.9-9.5-5.7z" },
      { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M3.2 11l1.6 1.6" },
      { d: "M15.5 8.2l1.2-1.6" },
    ],
  },

  /* ── Saltwater species ── */
  silver_salmon: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M15.5 8.2l1.2-1.6" },
      { d: "M11 10.8a.8.8 0 100 1.6.8.8 0 000-1.6z", fill: true },
    ],
  },
  chinook_salmon: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M15.5 8.2l1.2-1.6" },
      { d: "M20.5 10.2a.7.7 0 100 1.4.7.7 0 000-1.4zM21.2 13a.7.7 0 100 1.4.7.7 0 000-1.4z", fill: true },
    ],
  },
  pink_salmon: {
    paths: [
      { d: "M2.5 12c2-3 4.5-5.2 7-6.3 1.6-.7 3.3.2 4 1.7.5 1.1 1.7 1.7 3 2 1.4.4 2.6 1.3 3 2.6-1.6 3.8-4.3 5.7-7.5 5.7-3.5 0-7-1.9-9.5-5.7z" },
      { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
    ],
  },
  halibut: {
    paths: [
      { d: "M12 4.5c4.5 0 8.5 3.3 8.5 7.5S16.5 19.5 12 19.5 3.5 16.2 3.5 12 7.5 4.5 12 4.5z" },
      { d: "M3.5 12L1 9.5v5z", fill: true },
      { d: "M14.5 8.6a1 1 0 100 2 1 1 0 000-2zM17.5 9.6a1 1 0 100 2 1 1 0 000-2z", fill: true },
    ],
  },
  turbot: {
    paths: [
      { d: "M12 4.8c4.2 0 7.7 3.2 7.7 7.2s-3.5 7.2-7.7 7.2S4.3 16 4.3 12 7.8 4.8 12 4.8z" },
      { d: "M4.3 12L1.6 9.8v4.4z", fill: true },
      { d: "M10 8.8a.8.8 0 100 1.6.8.8 0 000-1.6zM14 13.4a.8.8 0 100 1.6.8.8 0 000-1.6zM15.2 9.2a.8.8 0 100 1.6.8.8 0 000-1.6z", fill: true },
    ],
  },
  black_rockfish: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M8 7.4l1-2 1.4 1.6 1.4-1.8 1.2 1.8" },
    ],
  },
  yelloweye_rockfish: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true },
      { d: "M8 7.4l1-2 1.4 1.6 1.4-1.8 1.2 1.8" },
      { d: "M6.6 9.9a1.7 1.7 0 100 3.4 1.7 1.7 0 000-3.4z" },
      { d: "M6.6 11.1a.6.6 0 100 1.2.6.6 0 000-1.2z", fill: true },
    ],
  },
  cod: {
    paths: [
      { d: FISH_BODY }, { d: FISH_TAIL, fill: true }, { d: FISH_EYE, fill: true },
      { d: "M4.2 14.2v2.2" },
      { d: "M8 7.2h8" },
    ],
  },
  dog_shark: {
    paths: [
      { d: "M2.5 13.5c3-2.5 7-4 11.5-4 2.8 0 5.5.8 7.5 2.5-2 2.5-4.7 3.8-7.5 3.8-4.5 0-8.5-1-11.5-2.3z" },
      { d: "M11 9.7L13.5 5l1.8 4.2" },
      { d: "M21.5 12L23.6 8.6l-1 5.6z", fill: true },
      { d: "M6 12.4a.9.9 0 100 1.8.9.9 0 000-1.8z", fill: true },
    ],
  },
  dungeness_crab: {
    paths: [
      { d: "M12 9.5c3.3 0 6 1.9 6 4.4s-2.7 4.4-6 4.4-6-1.9-6-4.4 2.7-4.4 6-4.4z" },
      { d: "M8.5 9.8L6.5 6.4M6.5 6.4l-2.2.4M6.5 6.4l.5-2.1" },
      { d: "M15.5 9.8l2-3.4M17.5 6.4l2.2.4M17.5 6.4l-.5-2.1" },
      { d: "M6.2 14.5l-3.4-.8M6.6 16.4l-3 1.4M17.8 14.5l3.4-.8M17.4 16.4l3 1.4" },
    ],
  },
  prawn_shrimp: {
    paths: [
      { d: "M17 6.5c3 1 4.5 3.5 4.5 6 0 3.6-3 6.5-6.8 6.5-3 0-5.7-1.8-6.5-4.4 1.8 1 4 1.2 5.7.2 1.8-1 2.6-3 2-4.9-.5-1.6-2-2.9-3.9-3.4" },
      { d: "M12 6.5L8.5 3.6M12 6.5L7 6M12 6.5L8.8 9.4" },
      { d: "M15.5 8.9a.9.9 0 100 1.8.9.9 0 000-1.8z", fill: true },
    ],
  },
  octopus: {
    paths: [
      { d: "M12 3.5c-3.4 0-6 2.6-6 5.8v2.2h12V9.3c0-3.2-2.6-5.8-6-5.8z" },
      { d: "M6.5 11.5c-.5 2.5-2 3.5-3.5 4.2M9.5 11.5c0 3-1 5.5-2.5 7.5M14.5 11.5c0 3 1 5.5 2.5 7.5M17.5 11.5c.5 2.5 2 3.5 3.5 4.2M12 11.5v8" },
      { d: "M9.8 7a.9.9 0 100 1.8.9.9 0 000-1.8zM14.2 7a.9.9 0 100 1.8.9.9 0 000-1.8z", fill: true },
    ],
  },
  school_salmon: {
    paths: [
      { d: SMALL_FISH(2.5, 7.5) }, { d: SMALL_FISH(12.5, 10) }, { d: SMALL_FISH(4.5, 15.5) },
    ],
  },
  school_rockfish: {
    paths: [
      { d: SMALL_FISH(2.5, 7.5) }, { d: SMALL_FISH(12.5, 10) }, { d: SMALL_FISH(4.5, 15.5) },
      { d: "M15 6.8l.8-1.4.9 1.2" },
    ],
  },
  lingcod: {
    paths: [
      { d: "M1.8 12.5c2-2.6 6.2-4.5 11-4.5 3.5 0 6.7 1.4 8.7 4-2 2.6-5.2 4-8.7 4-4.8 0-9-1.4-11-3.5z" },
      { d: "M2 12.3l3.2-1.5M2 12.3l3.2 1.7" },
      { d: "M20 12L23 9.2v5.6z", fill: true },
      { d: "M7.8 10.4a.9.9 0 100 1.8.9.9 0 000-1.8z", fill: true },
    ],
  },
  sole: {
    paths: [
      { d: "M12 6.8c5 0 9 2.3 9 5.2s-4 5.2-9 5.2-9-2.3-9-5.2 4-5.2 9-5.2z" },
      { d: "M8.2 9.8a.8.8 0 100 1.6.8.8 0 000-1.6zM10.8 9a.8.8 0 100 1.6.8.8 0 000-1.6z", fill: true },
    ],
  },

  /* ── Natural world ── */
  log: {
    paths: [
      { d: "M4 8.5h14.5M4 15.5h14.5" },
      { d: "M18.5 8.5c1.4 0 2.5 1.6 2.5 3.5s-1.1 3.5-2.5 3.5c-1.4 0-2.5-1.6-2.5-3.5s1.1-3.5 2.5-3.5z" },
      { d: "M4 8.5C2.9 8.5 2 10.1 2 12s.9 3.5 2 3.5" },
    ],
  },
  multiple_logs: {
    paths: [
      { d: "M3 7h13M3 12h13" },
      { d: "M16 7c1 0 1.9 1.1 1.9 2.5S17 12 16 12c-1 0-1.9-1.1-1.9-2.5S15 7 16 7z" },
      { d: "M6.5 14h13M6.5 19h13" },
      { d: "M19.5 14c1 0 1.9 1.1 1.9 2.5S20.5 19 19.5 19c-1 0-1.9-1.1-1.9-2.5s.9-2.5 1.9-2.5z" },
    ],
  },
  multiple_fish: {
    paths: [
      { d: SMALL_FISH(2.5, 6.5) }, { d: SMALL_FISH(12, 9.5) }, { d: SMALL_FISH(4, 13) }, { d: SMALL_FISH(11, 17) },
    ],
  },
  vegetation: {
    paths: [
      { d: "M12 21c0-6 0-10-.5-15M12 21c0-5-2.5-8-5.5-10M12 21c0-4 2.5-7.5 6-9.5" },
      { d: "M11.5 6c-1.2-1.4-1.4-2.8-1-4 1.4.6 2.2 1.8 2.4 3.4" },
    ],
  },
  submerged_rock: {
    paths: [
      { d: "M2 8q2.5-2 5 0t5 0 5 0 5 0" },
      { d: "M6.5 20l2.2-6.2 3.3-1.6 4.2 1.4 2 6.4z" },
    ],
  },
  land: {
    paths: [
      { d: "M1.5 19.5h21" },
      { d: "M4 19.5l5-9 3.5 5.2 3-4.2 4.5 8z" },
    ],
  },
  red_light: {
    paths: [
      { d: "M9 21h6M10 21l1-8h2l1 8" },
      { d: "M9.5 9.5h5l-1 3.5h-3z" },
      { d: "M12 4.5a2 2 0 100 4 2 2 0 000-4z", fill: true },
      { d: "M6.5 3.5L4.5 2M17.5 3.5l2-1.5M12 2.8V.8" },
    ],
  },
  green_light: {
    paths: [
      { d: "M9 21h6M10 21l1-8h2l1 8" },
      { d: "M8.8 9.5h6.4v3.5H8.8z" },
      { d: "M12 4.5a2 2 0 100 4 2 2 0 000-4z", fill: true },
      { d: "M6.5 3.5L4.5 2M17.5 3.5l2-1.5M12 2.8V.8" },
    ],
  },
  red_buoy: {
    paths: [
      { d: "M2.5 18.5q3-2 6 0t6 0 6 0" },
      { d: "M8.5 16.5L12 4l3.5 12.5z" },
      { d: "M10.3 10h3.4", fill: false },
    ],
  },
  green_buoy: {
    paths: [
      { d: "M2.5 18.5q3-2 6 0t6 0 6 0" },
      { d: "M8.5 16.5V6.5h7v10z" },
      { d: "M8.5 11h7" },
    ],
  },
  rock: {
    paths: [
      { d: "M4 18.5l2-7 4.5-3 6 1.5 3.5 8.5z" },
      { d: "M10.5 8.5L12 18.5" },
    ],
  },
  clam: {
    paths: [
      { d: "M12 18.5C7 18.5 3.5 15 3.5 11c0-1.6 1-3 2.6-3 1.2 0 2.2.7 2.7 1.8C9.3 8 10.5 7 12 7s2.7 1 3.2 2.8c.5-1.1 1.5-1.8 2.7-1.8 1.6 0 2.6 1.4 2.6 3 0 4-3.5 7.5-8.5 7.5z" },
      { d: "M12 18.5V9.5M8 17.4l1.5-6.9M16 17.4l-1.5-6.9" },
    ],
  },
  clam_beach: {
    paths: [
      { d: "M2 19.5h20" },
      { d: "M12 16.5c-3.3 0-5.5-2.3-5.5-5 0-1.1.7-2 1.7-2 .8 0 1.5.5 1.8 1.2C10.3 9.6 11 9 12 9s1.7.6 2 1.7c.3-.7 1-1.2 1.8-1.2 1 0 1.7.9 1.7 2 0 2.7-2.2 5-5.5 5z" },
      { d: "M12 16.5v-6" },
      { d: "M4.5 22a.8.8 0 100 1.6.8.8 0 000-1.6zM19 21.8a.8.8 0 100 1.6.8.8 0 000-1.6z", fill: true },
    ],
  },
  cool_rocks: {
    paths: [
      { d: "M2.5 19l1.8-5 3.5-1.8 3.7 1.6 1.5 5.2z" },
      { d: "M13.5 19l1.4-3.8 3-1.2 3 1.4 1 3.6z" },
      { d: "M17 5.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z", fill: true },
    ],
  },
  rock_beach: {
    paths: [
      { d: "M2 19.5h20" },
      { d: "M3.5 19.5l1.4-3.6 3-1.4 3 1.6 1.1 3.4z" },
      { d: "M13 19.5l1-2.6 2.4-1 2.4 1.2.8 2.4z" },
      { d: "M9.5 9.5q2.5-2 5 0" },
    ],
  },
  brushpile: {
    paths: [
      { d: "M2 19.5h20" },
      { d: "M5 19L9 11M15 19L10 11" },
      { d: "M13 19L17 11M19 19L15 11" },
      { d: "M7 14.5L17 12.5" },
    ],
  },

  /* ── Mariner ── */
  anchorage: {
    paths: [
      { d: "M12 6.8v13.7" },
      { d: "M12 2.5a2.1 2.1 0 100 4.2 2.1 2.1 0 000-4.2z" },
      { d: "M8 10h8" },
      { d: "M4.5 14c.5 4 3.5 6.5 7.5 6.5s7-2.5 7.5-6.5l-2.6 1.4M4.5 14l2.6 1.4" },
    ],
  },
  shipwreck: {
    paths: [
      { d: "M2 15.5q3-2 6 0t6 0 6 0" },
      { d: "M4.5 15.2l1.8-6.4 10.5 2.8-1.2 4.4" },
      { d: "M10 10.5l1.6-6 4.6 7.6" },
    ],
  },
  hazard_rock: {
    paths: [
      { d: "M12 3L22 20H2z" },
      { d: "M12 8.8v5.4" },
      { d: "M12 16.5a1 1 0 100 2 1 1 0 000-2z", fill: true },
    ],
  },
  marina: {
    paths: [
      { d: "M2.5 17.5q3-2 6 0t6 0 6 0" },
      { d: "M5.5 17.2L7 14h10l1.5 3.2" },
      { d: "M12 14V3.5M12 3.5l6 8.5h-6" },
    ],
  },
  boat_ramp: {
    paths: [
      { d: "M2 19.5L22 8" },
      { d: "M2 19.5h20" },
      { d: "M12 9.5l6-3.4 1.3 2.3-6 3.4z" },
    ],
  },
  fuel_dock: {
    paths: [
      { d: "M5 20.5V5c0-1.1.9-2 2-2h5c1.1 0 2 .9 2 2v15.5" },
      { d: "M3.5 20.5H15.5" },
      { d: "M7 6h5v4H7z" },
      { d: "M14 12h2.2c.9 0 1.6.7 1.6 1.6v3.2a1.6 1.6 0 003.2 0V8.5L18.5 6" },
    ],
  },
  diver_down: {
    paths: [
      { d: "M4.5 4.5h15v11h-15z" },
      { d: "M4.5 15.5L19.5 4.5", fill: false },
      { d: "M4.5 15.5v5" },
    ],
  },
  no_anchor: {
    paths: [
      { d: "M12 8.2v9" },
      { d: "M12 5.2a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" },
      { d: "M9.2 10.5h5.6" },
      { d: "M7 13.5c.4 2.6 2.3 4.3 5 4.3s4.6-1.7 5-4.3" },
      { d: "M12 1.5A10.5 10.5 0 1012 22.5 10.5 10.5 0 0012 1.5z" },
      { d: "M4.6 4.6l14.8 14.8" },
    ],
  },
  channel_marker: {
    paths: [
      { d: "M12 8.5v12" },
      { d: "M6 20.5h12" },
      { d: "M12 1.8l4.2 3.35L12 8.5 7.8 5.15z" },
    ],
  },
  daymark: {
    paths: [
      { d: "M12 12.5v8M7 20.5h10" },
      { d: "M12 3l5.5 9.5h-11z" },
    ],
  },

  /* ── Legacy-only silhouettes ── */
  coral: {
    paths: [
      { d: "M12 21v-8M12 13c0-3-2-4.5-4.5-5M12 13c0-3 2-4.5 4.5-5M7.5 8V5.2M16.5 8V5.2M12 11.5V6.5M9.5 16c-2.5 0-4-1.2-4.7-3M14.5 16c2.5 0 4-1.2 4.7-3" },
      { d: "M4 21h16" },
    ],
  },
  vent: {
    paths: [
      { d: "M7 21l1.5-8h7L17 21z" },
      { d: "M9.5 10q-1.4-2 0-3.6t0-3.4M14.5 10q-1.4-2 0-3.6t0-3.4M12 9q-1-1.4 0-2.6" },
    ],
  },
  sample: {
    paths: [
      { d: "M9.5 3h5M10.5 3v5.5L6 17.5c-.8 1.9.6 3.5 2.4 3.5h7.2c1.8 0 3.2-1.6 2.4-3.5L13.5 8.5V3" },
      { d: "M8 15h8" },
    ],
  },
  spring: {
    paths: [
      { d: "M12 13.5a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2z" },
      { d: "M8.5 9.5a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2zM15.5 8.5a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2zM12 4.5a.9.9 0 100 1.8.9.9 0 000-1.8z" },
      { d: "M4 20.5q4-2.5 8 0t8 0" },
    ],
  },
  lily_pad: {
    paths: [
      { d: "M12 3.5a8.5 8.5 0 108.5 8.5L12 12z" },
      { d: "M12 12l6-6" },
    ],
  },
  cattail: {
    paths: [
      { d: "M10.5 21c0-7 0-12 .5-16" },
      { d: "M11 3.2c-1 0-1.7 1.4-1.7 3.4s.7 3.4 1.7 3.4 1.7-1.4 1.7-3.4S12 3.2 11 3.2z", fill: true },
      { d: "M15.5 21c0-4.5 1-8 3.5-10.5M6.5 21c0-3.5-1-6-3-8" },
    ],
  },
  starfish: {
    paths: [
      { d: "M12 2.5l2.4 6.3 6.7.3-5.2 4.2 1.8 6.5L12 16l-5.7 3.8 1.8-6.5-5.2-4.2 6.7-.3z" },
    ],
  },
  sea_urchin: {
    paths: [
      { d: "M12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z" },
      { d: "M12 7.5V3M12 16.5V21M7.5 12H3M16.5 12H21M8.8 8.8L5.6 5.6M15.2 8.8l3.2-3.2M8.8 15.2l-3.2 3.2M15.2 15.2l3.2 3.2" },
    ],
  },
  turtle: {
    paths: [
      { d: "M12 6.5c4 0 7 2.7 7 6s-3 6-7 6-7-2.7-7-6 3-6 7-6z" },
      { d: "M19 10.5c1.6-.3 2.6.4 3 1.7-1 .8-2.2.9-3.3.3" },
      { d: "M6.8 17l-1.6 2M17.2 17l1.6 2M6.8 8.4L5.2 6.6M12 9v7M8.5 10.5l7 3M15.5 10.5l-7 3" },
    ],
  },
  jellyfish: {
    paths: [
      { d: "M12 3.5c-3.6 0-6.5 2.7-6.5 6v1.5h13V9.5c0-3.3-2.9-6-6.5-6z" },
      { d: "M8 11.5q-.6 3 .6 5.5M12 11.5q.6 3-.6 6.5M16 11.5q.6 2.6-.4 5" },
    ],
  },
  frog: {
    paths: [
      { d: "M5.5 12.5c-1.7 0-2.9-1.3-2.9-2.9S3.8 6.7 5.5 6.7s2.9 1.3 2.9 2.9M18.5 12.5c1.7 0 2.9-1.3 2.9-2.9s-1.2-2.9-2.9-2.9-2.9 1.3-2.9 2.9" },
      { d: "M5.5 9.4a.8.8 0 100 1.6.8.8 0 000-1.6zM18.5 9.4a.8.8 0 100 1.6.8.8 0 000-1.6z", fill: true },
      { d: "M4.5 12.5c0 3.6 3.3 6.5 7.5 6.5s7.5-2.9 7.5-6.5" },
    ],
  },
  panfish: {
    paths: [
      { d: "M11 5.8c4.2 0 7.6 2.8 7.6 6.2s-3.4 6.2-7.6 6.2S3.4 15.4 3.4 12 6.8 5.8 11 5.8z" },
      { d: "M18.6 12L22 8.8v6.4z", fill: true },
      { d: "M7.4 9.8a1 1 0 100 2 1 1 0 000-2z", fill: true },
    ],
  },
  swordfish: {
    paths: [
      { d: "M7 12c2-2.8 4.8-4.4 7.6-4.4 2.4 0 4.6 1.4 6 4.4-1.4 3-3.6 4.4-6 4.4-2.8 0-5.6-1.6-7.6-4.4z" },
      { d: "M7.2 11.6L1 9.8" },
      { d: "M20.6 12L23.4 9v6z", fill: true },
      { d: "M11 10.6a.8.8 0 100 1.6.8.8 0 000-1.6z", fill: true },
    ],
  },
};

/** Legacy / shared-silhouette aliases: type value → DEFS key. */
const ALIASES: Record<string, string> = {
  tuna: "fish",
  mahi_mahi: "fish",
  grouper: "panfish",
  snapper: "panfish",
  rockfish: "black_rockfish",
  shark: "dog_shark",
  crab: "dungeness_crab",
  freshwater_crab: "dungeness_crab",
  lobster: "prawn_shrimp",
  shrimp: "prawn_shrimp",
  krill: "prawn_shrimp",
  freshwater_shrimp: "prawn_shrimp",
  crayfish: "prawn_shrimp",
  squid: "jellyfish",
  sea_turtle: "turtle",
  snapping_turtle: "turtle",
  bullfrog: "frog",
  bluegill: "panfish",
  sunfish: "panfish",
  carp: "crappie",
  yellow_perch: "perch",
  muskie: "pike",
  trout: "rainbow_trout",
  largemouth_bass: "bass",
  smallmouth_bass: "bass",
  channel_catfish: "catfish",
  beaver_dam: "multiple_logs",
  reed_bed: "vegetation",
  submerged_grass: "vegetation",
  school_herring: "multiple_fish",
  school_sardine: "multiple_fish",
  school_mackerel: "multiple_fish",
  school_tuna: "multiple_fish",
  school_anchovy: "multiple_fish",
  school_perch: "multiple_fish",
  school_bluegill: "multiple_fish",
  school_bass: "multiple_fish",
  school_crappie: "multiple_fish",
  school_carp: "multiple_fish",
};

export function getMarkerIconDef(type: string): MarkerIconDef {
  return DEFS[type] ?? DEFS[ALIASES[type] ?? ""] ?? DEFS.custom!;
}

/** True when the type has a purpose-drawn (or aliased) icon, i.e. not the pin fallback. */
export function hasMarkerIcon(type: string): boolean {
  return type in DEFS || type in ALIASES;
}

const STROKE_W = 1.6;

/**
 * Bare path group for embedding inside an existing <svg> (OverviewMap).
 * Colour comes from CSS `currentColor` — set `color` on an ancestor.
 */
export const MarkerIconPaths: React.FC<{ type: string }> = ({ type }) => {
  const def = getMarkerIconDef(type);
  return (
    <>
      {def.paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.fill ? "currentColor" : "none"}
          stroke={p.fill ? "none" : "currentColor"}
          strokeWidth={STROKE_W}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
};

/** Inline SVG icon for React UI. */
export const MarkerIcon: React.FC<{
  type: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  title?: string;
}> = ({ type, size = 16, color, style, title }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    style={{ color, flexShrink: 0, verticalAlign: "-0.15em", ...style }}
    aria-hidden={title ? undefined : true}
    role={title ? "img" : undefined}
    data-marker-icon={type}
  >
    {title && <title>{title}</title>}
    <MarkerIconPaths type={type} />
  </svg>
);

/** Standalone SVG document string for rasterisation. */
export function markerIconSvgString(type: string, color: string, size = 64): string {
  const def = getMarkerIconDef(type);
  const paths = def.paths
    .map(
      (p) =>
        `<path d="${p.d}" fill="${p.fill ? color : "none"}" stroke="${p.fill ? "none" : color}" stroke-width="${STROKE_W}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${paths}</svg>`;
}

/* ── Rasterised image cache for 2D-canvas layers ── */

interface CacheEntry {
  img: HTMLImageElement;
  ready: boolean;
  promise: Promise<HTMLImageElement | null>;
}
const imageCache = new Map<string, CacheEntry>();

/**
 * Load (and cache) a rasterisable Image for a marker icon. Returns a promise
 * resolving to the image once decodable, or null in non-DOM environments.
 */
export function loadMarkerIconImage(
  type: string,
  color: string,
  size = 64,
): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  const key = `${type}|${color}|${size}`;
  const hit = imageCache.get(key);
  if (hit) return hit.promise;
  const img = new Image(size, size);
  const entry: CacheEntry = {
    img,
    ready: false,
    promise: new Promise((resolve) => {
      img.onload = () => {
        entry.ready = true;
        resolve(img);
      };
      img.onerror = () => resolve(null);
    }),
  };
  imageCache.set(key, entry);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markerIconSvgString(type, color, size))}`;
  return entry.promise;
}

/** Synchronously return the cached image if it has finished loading, else null. */
export function peekMarkerIconImage(type: string, color: string, size = 64): HTMLImageElement | null {
  const entry = imageCache.get(`${type}|${color}|${size}`);
  return entry?.ready ? entry.img : null;
}
