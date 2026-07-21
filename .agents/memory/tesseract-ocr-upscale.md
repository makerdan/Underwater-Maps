---
name: Tesseract OCR upscale requirement
description: Tesseract LSTM model needs images upscaled to ≥2400 px on the short side to recognise synthetic text reliably; label placement must be far from contour lines.
---

# Tesseract OCR upscale requirement

## The rule
In `raster_contour.py`, always upscale the image so the shorter dimension is at least 2400 px before calling pytesseract. The LSTM engine silently returns empty results on sub-1200 px images even when text is visually clear.

**Why:** At 600 px image height (typical synthetic fixture), tesseract LSTM returns empty output for all PSM modes. At 4× upscale (2400 px), PSM 11 and PSM 6 both find text reliably. Real scanned maps at 200–300 DPI (typically 1600–3300 px on the long side) already meet this threshold, so the upscale is a no-op for production inputs.

**How to apply:**
- `OCR_MIN_DIM = 2400` in the OCR section of `raster_contour.py`
- Coordinates returned by tesseract are in upscaled space; divide by `ocr_scale` before storing
- PSM fallback order: 11 → 6 → 7 → 4 (stop after first PSM that finds a depth label)

## Test fixture constraint
Labels in test fixtures must be placed well away from rectangle/line pixels or tesseract gets confused. Fixture `src/__tests__/fixtures/raster_contour_fixture.png` uses labels on the far right of the image (x ≥ 760) while rings end at x=700, giving ~60 px of clear whitespace.
