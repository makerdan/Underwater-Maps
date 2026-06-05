#!/usr/bin/env python3
"""
gen_standard_bag_projected.py — Generate a minimal standard BAG fixture whose
native-CRS origin looks projected (UTM-like easting > 180) but whose metadata
XML contains no EPSG code or WKT, only a geographic bounding box.

Expected parser behaviour: parse_standard_bag detects llCornerX > 180 while
transformer is None and raises:
  "BAG: data appears to use a projected CRS but no usable EPSG code..."

Output: survey_standard_projected.bag (written next to this script)
"""

import os
import sys
import numpy as np
import h5py


def _default_out():
    return os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "survey_standard_projected.bag",
    )


META_XML = """\
<?xml version="1.0" encoding="UTF-8"?>
<smXML:MD_Metadata xmlns:smXML="http://metadata.dgiwg.org/smXML"
  xmlns:gmd="http://www.isotc211.org/2005/gmd"
  xmlns:bag="http://www.opennavsurf.org/schema/bag">
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
  <bag:BAG_DataIdentification>
    <llCornerX>300000.0</llCornerX>
    <llCornerY>4500000.0</llCornerY>
    <nodeSpacingX>10.0</nodeSpacingX>
    <nodeSpacingY>10.0</nodeSpacingY>
  </bag:BAG_DataIdentification>
</smXML:MD_Metadata>"""


def main():
    out_path = _default_out()

    ROWS = 4
    COLS = 4

    elev = np.zeros((ROWS, COLS), dtype=np.float32)
    for r in range(ROWS):
        for c in range(COLS):
            elev[r, c] = -(1000.0 + (r * COLS + c) * 50.0)

    with h5py.File(out_path, "w") as f:
        bag_root = f.create_group("BAG_root")
        bag_root.create_dataset("metadata", data=np.bytes_(META_XML))
        bag_root.create_dataset("elevation", data=elev)

    print(f"Written: {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
