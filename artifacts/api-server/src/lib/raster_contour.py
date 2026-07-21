#!/usr/bin/env python3
"""
raster_contour.py — Extract depth contour polylines and labels from a raster image.

Reads raw image bytes (PNG or JPEG) from stdin, writes JSON to stdout:
  {
    "polylines": [{"pts": [[x, y], ...]}, ...],
    "labels":    [{"x": float, "y": float, "value": float, "text": str}, ...],
    "width":     int,
    "height":    int
  }

Coordinate system: origin is bottom-left, y increases upward (matching PDF user-space
convention so the output can be fed directly into pdfContoursToPoints).

Errors: non-zero exit code + message on stderr.
"""

import sys
import os
import re
import json
import numpy as np
import cv2
import pytesseract
from PIL import Image
import io

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEPTH_RE = re.compile(
    r'^\s*(\d{1,4}(?:\.\d+)?)\s*(?:ft|feet|\'|m|meters|metres)?\s*$',
    re.IGNORECASE,
)

MIN_OCR_CONFIDENCE = 20
TEXT_REGION_PADDING = 8


# ---------------------------------------------------------------------------
# Zhang-Suen thinning (vectorized NumPy)
# ---------------------------------------------------------------------------

def _zhang_suen_thin(binary_img: np.ndarray) -> np.ndarray:
    """
    Zhang-Suen thinning algorithm (vectorized).
    Input: uint8 binary image where foreground pixels == 255.
    Output: thinned skeleton as uint8 (0/255).
    """
    img = (binary_img > 0).copy()

    def _neighbors(p2, p3, p4, p5, p6, p7, p8, p9):
        return np.stack([p2, p3, p4, p5, p6, p7, p8, p9], axis=-1).astype(np.uint8)

    changed = True
    while changed:
        changed = False
        # Pad to avoid boundary issues
        skel = np.pad(img, 1, mode='constant', constant_values=False)

        p2 = skel[:-2, 1:-1]
        p3 = skel[:-2, 2:]
        p4 = skel[1:-1, 2:]
        p5 = skel[2:, 2:]
        p6 = skel[2:, 1:-1]
        p7 = skel[2:, :-2]
        p8 = skel[1:-1, :-2]
        p9 = skel[:-2, :-2]

        # Count non-zero neighbors
        nb = _neighbors(p2, p3, p4, p5, p6, p7, p8, p9)
        B = nb.sum(axis=-1)

        # Count 0→1 transitions in the circular sequence
        seq = np.stack([p2, p3, p4, p5, p6, p7, p8, p9, p2], axis=-1).astype(np.uint8)
        A = ((seq[..., :8] == 0) & (seq[..., 1:] == 1)).sum(axis=-1)

        cond_common = img & (B >= 2) & (B <= 6) & (A == 1)

        # Sub-iteration 1
        cond1 = cond_common & ~(p2.astype(bool) & p4.astype(bool) & p6.astype(bool))
        cond1 &= ~(p4.astype(bool) & p6.astype(bool) & p8.astype(bool))
        if cond1.any():
            img[cond1] = False
            changed = True

        # Recompute after first sub-iteration
        skel = np.pad(img, 1, mode='constant', constant_values=False)
        p2 = skel[:-2, 1:-1]
        p3 = skel[:-2, 2:]
        p4 = skel[1:-1, 2:]
        p5 = skel[2:, 2:]
        p6 = skel[2:, 1:-1]
        p7 = skel[2:, :-2]
        p8 = skel[1:-1, :-2]
        p9 = skel[:-2, :-2]

        nb = _neighbors(p2, p3, p4, p5, p6, p7, p8, p9)
        B = nb.sum(axis=-1)
        seq = np.stack([p2, p3, p4, p5, p6, p7, p8, p9, p2], axis=-1).astype(np.uint8)
        A = ((seq[..., :8] == 0) & (seq[..., 1:] == 1)).sum(axis=-1)

        cond_common = img & (B >= 2) & (B <= 6) & (A == 1)

        # Sub-iteration 2
        cond2 = cond_common & ~(p2.astype(bool) & p4.astype(bool) & p8.astype(bool))
        cond2 &= ~(p2.astype(bool) & p6.astype(bool) & p8.astype(bool))
        if cond2.any():
            img[cond2] = False
            changed = True

    return img.astype(np.uint8) * 255


# ---------------------------------------------------------------------------
# Skeleton path tracing
# ---------------------------------------------------------------------------

def _trace_skeleton_pixels(skeleton: np.ndarray, label_map: np.ndarray, comp_id: int):
    """
    DFS/greedy trace of skeleton pixels for a single connected component.
    Returns a list of (x, y) pixel tuples forming a polyline.
    """
    ys, xs = np.where((label_map == comp_id) & (skeleton > 0))
    if len(xs) < 2:
        return []

    pts_set = set(zip(xs.tolist(), ys.tolist()))
    if not pts_set:
        return []

    # Find an endpoint (pixel with only 1 neighbor in the skeleton).
    DIRS = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]

    def count_nb(px, py):
        return sum(1 for dx, dy in DIRS if (px+dx, py+dy) in pts_set)

    start = None
    for pt in pts_set:
        if count_nb(*pt) == 1:
            start = pt
            break
    if start is None:
        start = next(iter(pts_set))

    # Greedy nearest-unvisited trace
    path = [start]
    visited = {start}
    current = start

    while True:
        px, py = current
        nxt = None
        for dx, dy in DIRS:
            nb = (px+dx, py+dy)
            if nb in pts_set and nb not in visited:
                nxt = nb
                break
        if nxt is None:
            break
        path.append(nxt)
        visited.add(nxt)
        current = nxt

    return path


# ---------------------------------------------------------------------------
# Ramer-Douglas-Peucker polyline simplification
# ---------------------------------------------------------------------------

def _rdp_simplify(points, epsilon: float = 2.0):
    """Recursive Ramer-Douglas-Peucker simplification."""
    if len(points) <= 2:
        return list(points)

    ax, ay = points[0]
    bx, by = points[-1]

    def perp_dist(px, py):
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return ((px - ax)**2 + (py - ay)**2) ** 0.5
        t = ((px - ax)*dx + (py - ay)*dy) / (dx*dx + dy*dy)
        t = max(0.0, min(1.0, t))
        return ((px - (ax + t*dx))**2 + (py - (ay + t*dy))**2) ** 0.5

    max_d, max_i = 0.0, 0
    for i, (px, py) in enumerate(points[1:-1], 1):
        d = perp_dist(px, py)
        if d > max_d:
            max_d, max_i = d, i

    if max_d > epsilon:
        left = _rdp_simplify(points[:max_i+1], epsilon)
        right = _rdp_simplify(points[max_i:], epsilon)
        return left[:-1] + right

    return [points[0], points[-1]]


# ---------------------------------------------------------------------------
# Main extraction pipeline
# ---------------------------------------------------------------------------

def extract_contours_from_image(img_bytes: bytes) -> dict:
    """
    Full pipeline: image bytes → {polylines, labels, width, height}.

    Coordinate system output: origin bottom-left, y-up (PDF user-space
    convention), so the TypeScript caller can pass directly to
    pdfContoursToPoints() without any flip.
    """
    # Decode image
    arr = np.frombuffer(img_bytes, np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError("Could not decode image bytes.")

    h, w = img_bgr.shape[:2]

    # ── 1. OCR ─────────────────────────────────────────────────────────────
    #
    # Tesseract needs at least ~80 px text height for LSTM mode to work
    # reliably.  Pre-upscale the image so the shorter dimension is at least
    # 2400 px (equivalent to ~4× a typical 600 px synthetic fixture, and
    # ~2× a 300 DPI scanned letter-page).
    OCR_MIN_DIM = 2400
    ocr_scale = max(1.0, OCR_MIN_DIM / min(h, w))
    if ocr_scale > 1.0:
        ow = int(round(w * ocr_scale))
        oh = int(round(h * ocr_scale))
        img_ocr = cv2.resize(img_bgr, (ow, oh), interpolation=cv2.INTER_CUBIC)
    else:
        img_ocr = img_bgr
        ow, oh = w, h

    pil_img = Image.fromarray(cv2.cvtColor(img_ocr, cv2.COLOR_BGR2RGB))

    # Try PSM 11 (sparse text) first; fall back to PSM 6 (block) if no hits.
    def _run_ocr(cfg):
        return pytesseract.image_to_data(
            pil_img, lang='eng',
            output_type=pytesseract.Output.DICT,
            config=cfg,
        )

    for tess_config in ('--psm 11 --oem 3', '--psm 6 --oem 3', '--psm 7 --oem 3', '--psm 4 --oem 3'):
        ocr_data = _run_ocr(tess_config)
        if any(DEPTH_RE.match(str(t).strip()) for t in ocr_data['text']):
            break

    labels = []
    text_rects = []

    for i, text in enumerate(ocr_data['text']):
        text = str(text).strip()
        m = DEPTH_RE.match(text)
        conf_raw = ocr_data['conf'][i]
        conf = int(conf_raw) if conf_raw not in ('', -1) else 0
        if m and conf >= MIN_OCR_CONFIDENCE:
            value = float(m.group(1))
            # Coordinates in the upscaled image — map back to original size
            x0 = int(ocr_data['left'][i]  / ocr_scale)
            y0 = int(ocr_data['top'][i]   / ocr_scale)
            tw = int(ocr_data['width'][i]  / ocr_scale)
            th = int(ocr_data['height'][i] / ocr_scale)
            cx = x0 + tw / 2.0
            cy = y0 + th / 2.0
            # Flip y: image y=0 is top; we want y=0 at bottom
            cy_flipped = h - cy
            labels.append({
                'x': float(cx),
                'y': float(cy_flipped),
                'value': value,
                'text': text,
            })
            text_rects.append((
                max(0, x0 - TEXT_REGION_PADDING),
                max(0, y0 - TEXT_REGION_PADDING),
                min(w - 1, x0 + tw + TEXT_REGION_PADDING),
                min(h - 1, y0 + th + TEXT_REGION_PADDING),
            ))

    # ── 2. Preprocessing ───────────────────────────────────────────────────
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)

    # Otsu threshold: dark lines on light background → invert so lines = 255
    _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Erase OCR text regions from binary mask so text pixels don't become
    # "contour lines".
    for (x1, y1, x2, y2) in text_rects:
        cv2.rectangle(binary, (x1, y1), (x2, y2), 0, -1)

    # Brief morphological close to reconnect slightly fragmented lines
    kernel = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)

    # ── 3. Skeletonize ─────────────────────────────────────────────────────
    skeleton = _zhang_suen_thin(binary)

    # ── 4. Connected components ────────────────────────────────────────────
    num_comps, label_map, stats, _ = cv2.connectedComponentsWithStats(skeleton)

    # Minimum area guard: at least 0.05% of the image area, or 30 pixels.
    min_area = max(30, (h * w) * 0.0005)
    # Aspect ratio guard: components that fill >50% of their bounding box
    # are likely blobs (letters, artifacts), not lines.
    MAX_EXTENT = 0.5

    polylines = []

    for comp in range(1, num_comps):
        area = int(stats[comp, cv2.CC_STAT_AREA])
        cw = int(stats[comp, cv2.CC_STAT_WIDTH])
        ch_stat = int(stats[comp, cv2.CC_STAT_HEIGHT])

        if area < min_area:
            continue
        extent = area / max(1, cw * ch_stat)
        if extent > MAX_EXTENT:
            continue

        path = _trace_skeleton_pixels(skeleton, label_map, comp)
        if len(path) < 3:
            continue

        simplified = _rdp_simplify(path, epsilon=3.0)
        if len(simplified) < 2:
            continue

        # Flip y coordinates to match bottom-left origin convention
        pts = [[float(x), float(h - y)] for x, y in simplified]
        polylines.append({'pts': pts})

    return {
        'polylines': polylines,
        'labels': labels,
        'width': w,
        'height': h,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    try:
        img_bytes = sys.stdin.buffer.read()
        if not img_bytes:
            print("raster_contour: empty input", file=sys.stderr)
            sys.exit(1)
        result = extract_contours_from_image(img_bytes)
        json.dump(result, sys.stdout)
    except Exception as exc:
        print(f"raster_contour error: {exc}", file=sys.stderr)
        sys.exit(1)
