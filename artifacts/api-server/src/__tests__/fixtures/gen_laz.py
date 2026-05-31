#!/usr/bin/env python3
"""
gen_laz.py — Generate a genuinely compressed survey.laz fixture.

Uses laspy + lazrs to produce a real LASzip-compressed LAZ file that
laz-perf v0.0.7 can decompress without a mock.

Points mirror the buildLaz() definition in generate.mjs:
  scale XY = 1e-6 deg, Z = 0.001 m; offset X=-133, Y=55, Z=0
  15 records; index 10 has depth=0 (zi=0) — parseLasLaz must skip it.

Run:  python3 artifacts/api-server/src/__tests__/fixtures/gen_laz.py
"""

import pathlib
import numpy as np
import laspy

OUT = pathlib.Path(__file__).parent / "survey.laz"

SCALE_XY = 0.000001
SCALE_Z  = 0.001
OFFSET_X = -133.0
OFFSET_Y =  55.0
OFFSET_Z =  0.0

RAW_PTS = [
    (-132.500000, 55.200000, 1250),
    (-132.500100, 55.200100, 1300),
    (-132.500200, 55.200200, 1420),
    (-132.500300, 55.200300, 1380),
    (-132.500400, 55.200400, 1500),
    (-132.500500, 55.200500, 1600),
    (-132.500600, 55.200600, 1750),
    (-132.500700, 55.200700, 1800),
    (-132.500800, 55.200800, 1900),
    (-132.500900, 55.200900, 2000),
    (-132.501000, 55.201000,    0),  # depth=0 -> zi=0 -> skipped by parseLasLaz
    (-132.501100, 55.201100, 2100),
    (-132.501200, 55.201200, 2200),
    (-132.501300, 55.201300, 2300),
    (-132.501400, 55.201400, 2400),
]

header = laspy.LasHeader(point_format=0, version="1.2")
header.offsets   = np.array([OFFSET_X, OFFSET_Y, OFFSET_Z])
header.scales    = np.array([SCALE_XY, SCALE_XY, SCALE_Z])

las = laspy.LasData(header=header)

xs = np.array([p[0] for p in RAW_PTS])
ys = np.array([p[1] for p in RAW_PTS])
# Positive-up convention: depth below sea -> negative Z in LAS
zs = np.array([-p[2] for p in RAW_PTS], dtype=float)

las.x = xs
las.y = ys
las.z = zs

# Write as a genuine LASzip-compressed LAZ file
# laspy.LasWriter requires a file-like object, not a Path, in some versions
with open(OUT, "wb") as fh:
    with laspy.LasWriter(fh, header=las.header, do_compress=True) as writer:
        writer.write_points(las.points)

print(f"Written {OUT}  ({OUT.stat().st_size} bytes, {len(RAW_PTS)} points)")
