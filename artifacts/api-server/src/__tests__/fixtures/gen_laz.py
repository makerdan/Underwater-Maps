#!/usr/bin/env python3
"""
gen_laz.py — Generate a genuinely compressed survey.laz fixture.

Uses laspy + lazrs to produce a real LASzip-compressed LAZ file that
laz-perf v0.0.7 can decompress without a mock.

Points mirror the buildLaz() definition in generate.mjs:
  scale XY = 1e-6 deg, Z = 0.001 m; offset X=-133, Y=55, Z=0
4096 records covering a 64×64 grid; index 10 has depth=0 (zi=0).

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
    (-132.50 + col * 0.001, 55.20 + row * 0.001, 1250 + row * 8 + col * 2)
    for row in range(64) for col in range(64)
]
RAW_PTS[10] = (-132.50 + 10 * 0.001, 55.20, 0)

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
