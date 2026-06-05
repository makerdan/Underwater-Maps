#!/usr/bin/env python3
"""
bag_parser.py — Convert a NOAA BAG (Bathymetric Attributed Grid) file to
lon,lat,depth CSV written to stdout.

Handles:
  - Standard BAG  (uniform elevation grid)
  - Variable Resolution BAG  (VR BAG, super-grid + per-cell refinements)

Both projected (UTM / State Plane) and geographic (WGS84) CRS are supported;
pyproj is used to reproject to WGS84 lon/lat.

Usage:
    python3 bag_parser.py <file.bag>

Output (stdout):
    lon,lat,depth    (CSV, no header — caller adds header if needed)

Errors to stderr; exits with code 1 on failure.
"""

import sys
import re
import os

MAX_POINTS = 2_000_000
BAG_FILL   = 1_000_000.0   # BAG nodata sentinel
NAN_TEST   = 1e9            # anything >= this is treated as nodata


# ── helpers ────────────────────────────────────────────────────────────────

def _xml_tag(xml: str, *tags: str) -> str | None:
    """Return the text content of the first matching element (any namespace)."""
    for tag in tags:
        # strip namespace prefix for matching
        bare = tag.split(":")[-1]
        m = re.search(
            rf"<(?:[^>:]+:)?{re.escape(bare)}[^>]*>\s*(.*?)\s*</(?:[^>:]+:)?{re.escape(bare)}>",
            xml, re.DOTALL | re.IGNORECASE,
        )
        if m:
            val = m.group(1).strip()
            if val:
                return val
    return None


def _floatval(xml: str, *tags: str) -> float | None:
    v = _xml_tag(xml, *tags)
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def detect_crs(xml: str):
    """
    Try to determine a pyproj-compatible CRS from the BAG metadata XML.

    Search order:
      1. WKT string inside <referenceSystemInfo> (newer BAG 2.x files)
      2. EPSG code pattern (e.g. "EPSG:32608", "32608")
      3. Give up — return None (caller will use bounding-box approximation)
    """
    from pyproj import CRS

    # 1. Grab the <referenceSystemInfo> block first to narrow the search
    rs_block = _xml_tag(xml, "referenceSystemInfo", "gmd:referenceSystemInfo")

    # 2. WKT — look for multi-line PROJCRS / GEOGCRS / PROJCS block
    search_region = rs_block if rs_block else xml
    for wkt_re in (
        r'(PROJCRS\[[\s\S]+?\]\s*\])',
        r'(GEOGCRS\[[\s\S]+?\]\s*\])',
        r'(PROJCS\[[\s\S]+?\]\s*\])',
        r'(GEOGCS\[[\s\S]+?\]\s*\])',
    ):
        m = re.search(wkt_re, search_region, re.IGNORECASE)
        if m:
            try:
                return CRS.from_wkt(m.group(1).strip())
            except Exception:
                pass

    # 3. EPSG code — look for patterns like EPSG:32608 or bare 5-digit codes
    for epsg_re in (
        r'EPSG[:\s]+(\d{4,6})',
        r'<[^>]*code[^>]*>\s*(\d{4,6})\s*</[^>]*code[^>]*>',
    ):
        for text in ([rs_block] if rs_block else []) + [xml]:
            if text is None:
                continue
            m = re.search(epsg_re, text, re.IGNORECASE)
            if m:
                code = int(m.group(1))
                if 1024 <= code <= 32767:   # plausible EPSG range
                    try:
                        return CRS.from_epsg(code)
                    except Exception:
                        pass

    return None


def make_transformer(crs):
    """Return a pyproj Transformer to WGS84, or None if crs is None/already geographic."""
    from pyproj import Transformer as T, CRS
    if crs is None:
        return None
    wgs84 = CRS.from_epsg(4326)
    if crs.equals(wgs84):
        return None
    return T.from_crs(crs, wgs84, always_xy=True)


def geographic_bounds(xml: str):
    """Extract ISO 19115 geographic bounding box (WGS84). Returns (W,E,S,N) or None."""
    w = _floatval(xml, "westBoundLongitude", "gmd:westBoundLongitude")
    e = _floatval(xml, "eastBoundLongitude", "gmd:eastBoundLongitude")
    s = _floatval(xml, "southBoundLatitude", "gmd:southBoundLatitude")
    n = _floatval(xml, "northBoundLatitude", "gmd:northBoundLatitude")
    if None not in (w, e, s, n) and -180 <= w < e <= 180 and -90 <= s < n <= 90:
        return (w, e, s, n)
    return None


def grid_origin_and_spacing(xml: str):
    """
    Try to extract the native-CRS grid origin and cell spacing from the XML.

    Looks for bag:BAG_DataIdentification spatial parameters:
        llCornerX / llCornerY  (lower-left corner of SW cell centre)
        nodeSpacingX / nodeSpacingY  (cell size)

    Returns (x0, y0, sx, sy) or None.
    """
    x0 = _floatval(xml, "llCornerX", "bag:llCornerX")
    y0 = _floatval(xml, "llCornerY", "bag:llCornerY")
    sx = _floatval(xml, "nodeSpacingX", "bag:nodeSpacingX",
                   "columnResolution", "bag:columnResolution")
    sy = _floatval(xml, "nodeSpacingY", "bag:nodeSpacingY",
                   "rowResolution", "bag:rowResolution")
    if None not in (x0, y0, sx, sy) and sx > 0 and sy > 0:
        return (x0, y0, sx, sy)
    return None


# ── standard BAG ───────────────────────────────────────────────────────────

def parse_standard_bag(bag, meta_xml: str, max_pts: int):
    import numpy as np

    if "elevation" not in bag:
        raise ValueError("BAG_root/elevation dataset not found.")

    elev = bag["elevation"][()]          # float32 [rows, cols]

    # Some tools (e.g. h5wasm without an explicit shape) write the elevation as
    # a 1-D flat array instead of a proper 2-D grid.  Reshape it here using the
    # bbox-derived col/row count (0.001° default resolution, same behaviour as
    # the previous h5wasm-based implementation).
    if elev.ndim == 1:
        n = int(elev.size)
        bbox = geographic_bounds(meta_xml)
        if bbox:
            w_b, e_b, s_b, n_b = bbox
            ncols_est = max(1, round((e_b - w_b) / 0.001))
            nrows_est = max(1, round((n_b - s_b) / 0.001))
            if ncols_est * nrows_est >= n:
                # Pad with fill value so the grid has the estimated dimensions
                padded = np.full(nrows_est * ncols_est, BAG_FILL, dtype=np.float32)
                padded[:n] = elev
                elev = padded.reshape(nrows_est, ncols_est)
            else:
                elev = elev.reshape(1, n)
        else:
            elev = elev.reshape(1, n)

    nrows, ncols = elev.shape

    crs         = detect_crs(meta_xml)
    transformer = make_transformer(crs)
    geo_bounds  = geographic_bounds(meta_xml)

    # Try to get native-CRS origin + spacing first
    native = grid_origin_and_spacing(meta_xml)

    if native and transformer:
        # Proper reprojection path
        x0, y0, sx, sy = native
        # Subsample step so we don't exceed MAX_POINTS
        total = nrows * ncols
        step  = max(1, int((total / max_pts) ** 0.5))

        points = []
        for ri in range(0, nrows, step):
            row = elev[ri]
            for ci in range(0, ncols, step):
                val = float(row[ci])
                if not _valid_depth(val):
                    continue
                x = x0 + ci * sx
                y = y0 + ri * sy
                lon, lat = transformer.transform(x, y)
                if not _valid_ll(lon, lat):
                    continue
                depth = abs(val)
                points.append((lon, lat, depth))
                if len(points) >= max_pts:
                    return points
        return points

    if geo_bounds:
        # Bounding-box linear-interpolation fallback (good enough for small surveys)
        w, e, s, n = geo_bounds
        total = nrows * ncols
        step  = max(1, int((total / max_pts) ** 0.5))

        points = []
        for ri in range(0, nrows, step):
            row = elev[ri]
            lat = s + (ri / max(nrows - 1, 1)) * (n - s)
            for ci in range(0, ncols, step):
                val = float(row[ci])
                if not _valid_depth(val):
                    continue
                lon = w + (ci / max(ncols - 1, 1)) * (e - w)
                depth = abs(val)
                points.append((lon, lat, depth))
                if len(points) >= max_pts:
                    return points
        return points

    raise ValueError(
        "Cannot geolocate BAG grid: no usable CRS + native origin/spacing, "
        "and no geographic bounding box found in metadata XML."
    )


# ── variable-resolution BAG ────────────────────────────────────────────────

def parse_vr_bag(bag, meta_xml: str, max_pts: int):
    """
    VR BAG layout (ONS spec §8):

      varres_metadata  — compound[nrows, ncols]
          .dimensions_x / .dimensions_y   number of refinement cells in X / Y
          .resolution_x / .resolution_y   size of one refinement cell (native CRS)
          .sw_corner_x  / .sw_corner_y    SW corner of this super-grid cell (native CRS)

      varres_refinements — compound[nrows * ncols, max_dim]
          .depth              depth (fill = BAG_FILL)
          .depth_uncertainty  uncertainty (unused here)

    Each refinement cell at local index (ri, ci) within super-cell (row, col):
        x = sw_corner_x + (ci + 0.5) * resolution_x
        y = sw_corner_y + (ri + 0.5) * resolution_y
    """
    import numpy as np

    vr_meta = bag["varres_metadata"][()]       # structured array [nrows, ncols]
    vr_ref  = bag["varres_refinements"][()]    # structured array [nrows*ncols, max_dim]

    sup_nrows, sup_ncols = vr_meta.shape
    max_ref_dim = vr_ref.shape[1] if vr_ref.ndim == 2 else 1

    crs         = detect_crs(meta_xml)
    transformer = make_transformer(crs)
    geo_bounds  = geographic_bounds(meta_xml)

    if transformer is None and geo_bounds is None:
        raise ValueError(
            "VR BAG: cannot geolocate data — no CRS found and no geographic "
            "bounding box in metadata XML."
        )

    # Count total valid refinements for step calculation
    depth_field = vr_ref["depth"] if "depth" in vr_ref.dtype.names else vr_ref[vr_ref.dtype.names[0]]
    total_valid = int(np.sum((depth_field < NAN_TEST) & (depth_field != BAG_FILL)))
    step = max(1, total_valid // max_pts)

    points = []
    skip_counter = 0

    for row in range(sup_nrows):
        for col in range(sup_ncols):
            meta = vr_meta[row, col]
            try:
                dim_x = int(meta["dimensions_x"])
                dim_y = int(meta["dimensions_y"])
                res_x = float(meta["resolution_x"])
                res_y = float(meta["resolution_y"])
                sw_x  = float(meta["sw_corner_x"])
                sw_y  = float(meta["sw_corner_y"])
            except (ValueError, KeyError, TypeError):
                continue

            if dim_x <= 0 or dim_y <= 0 or res_x <= 0 or res_y <= 0:
                continue

            flat_idx = row * sup_ncols + col
            if flat_idx >= vr_ref.shape[0]:
                continue

            cell_refs = vr_ref[flat_idx]  # [max_ref_dim] structured

            ref_idx = 0
            for ri in range(dim_y):
                for ci in range(dim_x):
                    if ref_idx >= max_ref_dim:
                        break
                    depth_val = float(cell_refs[ref_idx]["depth"])
                    ref_idx += 1

                    if not _valid_depth(depth_val):
                        continue

                    skip_counter += 1
                    if skip_counter % step != 0:
                        continue

                    # Native CRS position (cell centre)
                    x = sw_x + (ci + 0.5) * res_x
                    y = sw_y + (ri + 0.5) * res_y

                    if transformer:
                        lon, lat = transformer.transform(x, y)
                    elif geo_bounds:
                        # Approximate: treat native coords as geographic if close
                        # to valid range (some files are already in WGS84 degrees)
                        lon, lat = x, y
                    else:
                        continue

                    if not _valid_ll(lon, lat):
                        continue

                    points.append((lon, lat, abs(depth_val)))
                    if len(points) >= max_pts:
                        return points

    return points


# ── validators ─────────────────────────────────────────────────────────────

def _valid_depth(v: float) -> bool:
    av = abs(v)
    return (
        isinstance(v, (int, float))
        and v == v           # not NaN
        and av < NAN_TEST
        and av != BAG_FILL   # BAG nodata sentinel (1 000 000)
        and av > 0.0         # surface points not useful
    )


def _valid_ll(lon: float, lat: float) -> bool:
    return -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0


# ── main ───────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: bag_parser.py <file.bag>", file=sys.stderr)
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.isfile(path):
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(1)

    try:
        import h5py
        import numpy as np
    except ImportError as e:
        print(f"Missing Python dependency: {e}. "
              "Run: PYTHONUSERBASE=.pythonlibs pip install h5py numpy pyproj --user",
              file=sys.stderr)
        sys.exit(1)

    try:
        with h5py.File(path, "r") as f:
            if "BAG_root" not in f:
                raise ValueError("Not a valid BAG file: missing BAG_root group")

            bag = f["BAG_root"]

            # Read metadata XML
            meta_xml = ""
            if "metadata" in bag:
                raw = bag["metadata"][()]
                if isinstance(raw, bytes):
                    meta_xml = raw.decode("utf-8", errors="replace")
                elif hasattr(raw, "dtype") and raw.dtype.kind in ("S", "U", "O"):
                    # Array of characters or strings
                    if raw.dtype.kind == "S":
                        meta_xml = b"".join(raw.flat).decode("utf-8", errors="replace")
                    else:
                        meta_xml = "".join(str(c) for c in raw.flat)
                else:
                    meta_xml = str(raw)

            # Detect VR BAG
            is_vr = ("varres_refinements" in bag and "varres_metadata" in bag)

            if is_vr:
                points = parse_vr_bag(bag, meta_xml, MAX_POINTS)
            else:
                points = parse_standard_bag(bag, meta_xml, MAX_POINTS)

        if not points:
            print("BAG file produced no valid depth points.", file=sys.stderr)
            sys.exit(1)

        # CSV output — no header (Node caller handles it)
        for lon, lat, depth in points:
            sys.stdout.write(f"{lon:.8f},{lat:.8f},{depth:.4f}\n")

    except Exception as exc:
        import traceback
        # Node caller prepends "BAG parse error:" so just emit the raw message.
        print(str(exc), file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
