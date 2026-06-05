#!/usr/bin/env python3
"""
gen_vr_bag.py — Generate a minimal VR BAG fixture with projected-CRS coordinates
but no CRS metadata, for testing the plausibility guard in parse_vr_bag.

The file has:
  - Metadata XML with a valid geographic bounding box but *no* EPSG code or WKT
  - varres_metadata: 2x2 super-grid whose sw_corner values are UTM-like
    (sw_corner_x = 500000, far outside |x| <= 180)
  - varres_refinements: one 1x1 refinement per super-cell with a valid depth

Expected parser behaviour: bag_parser.py detects sw_corner_x > 180 while
transformer is None and raises:
  "VR BAG: data appears to use a projected CRS but no usable EPSG code..."

Output: survey_vr_projected.bag (written next to this script)
"""

import os
import sys
import numpy as np
import h5py

def _default_out():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "survey_vr_projected.bag")


def _parse_args():
    import argparse
    p = argparse.ArgumentParser(description="Generate a minimal projected-CRS VR BAG fixture")
    p.add_argument("--out", default=_default_out(), help="Output file path")
    return p.parse_args()


OUT_PATH = _parse_args().out

META_XML = """\
<?xml version="1.0" encoding="UTF-8"?>
<smXML:MD_Metadata xmlns:smXML="http://metadata.dgiwg.org/smXML"
  xmlns:gmd="http://www.isotc211.org/2005/gmd">
  <gmd:identificationInfo>
    <gmd:MD_DataIdentification>
      <gmd:extent>
        <gmd:EX_Extent>
          <gmd:geographicElement>
            <gmd:EX_GeographicBoundingBox>
              <westBoundLongitude>-72.0</westBoundLongitude>
              <eastBoundLongitude>-71.0</eastBoundLongitude>
              <southBoundLatitude>41.0</southBoundLatitude>
              <northBoundLatitude>42.0</northBoundLatitude>
            </gmd:EX_GeographicBoundingBox>
          </gmd:geographicElement>
        </gmd:EX_Extent>
      </gmd:extent>
    </gmd:MD_DataIdentification>
  </gmd:identificationInfo>
</smXML:MD_Metadata>"""


def main():
    vr_meta_dtype = np.dtype([
        ("dimensions_x", np.uint32),
        ("dimensions_y", np.uint32),
        ("resolution_x", np.float32),
        ("resolution_y", np.float32),
        ("sw_corner_x",  np.float64),
        ("sw_corner_y",  np.float64),
    ])

    vr_ref_dtype = np.dtype([
        ("depth",             np.float32),
        ("depth_uncertainty", np.float32),
    ])

    SUP_ROWS = 2
    SUP_COLS = 2
    MAX_DIM  = 1

    vr_meta = np.zeros((SUP_ROWS, SUP_COLS), dtype=vr_meta_dtype)
    for r in range(SUP_ROWS):
        for c in range(SUP_COLS):
            vr_meta[r, c]["dimensions_x"] = 1
            vr_meta[r, c]["dimensions_y"] = 1
            vr_meta[r, c]["resolution_x"] = 1.0
            vr_meta[r, c]["resolution_y"] = 1.0
            vr_meta[r, c]["sw_corner_x"]  = 500_000.0 + c * 10.0
            vr_meta[r, c]["sw_corner_y"]  = 4_500_000.0 + r * 10.0

    vr_ref = np.zeros((SUP_ROWS * SUP_COLS, MAX_DIM), dtype=vr_ref_dtype)
    for i in range(SUP_ROWS * SUP_COLS):
        vr_ref[i, 0]["depth"]             = 1500.0 + i * 100.0
        vr_ref[i, 0]["depth_uncertainty"] = 0.5

    with h5py.File(OUT_PATH, "w") as f:
        bag_root = f.create_group("BAG_root")
        bag_root.create_dataset("metadata",          data=np.bytes_(META_XML))
        bag_root.create_dataset("varres_metadata",   data=vr_meta)
        bag_root.create_dataset("varres_refinements", data=vr_ref)

    print(f"Written: {OUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
