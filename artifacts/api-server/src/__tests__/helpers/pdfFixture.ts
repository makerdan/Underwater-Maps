/**
 * pdfFixture.ts — In-memory vector-PDF builders for the PDF contour-map tests.
 *
 * Builds tiny, fully deterministic PDFs (uncompressed content streams, no
 * external font files) so tests never depend on on-disk fixture binaries.
 *
 * The contour fixture draws three nested closed rectangles (depth contours)
 * with printed labels next to each ring:
 *   outer  ring → "10"    (shallowest)
 *   middle ring → "20"
 *   inner  ring → "30 ft" (deepest, includes a unit hint)
 */

/** Assembles a single-page PDF from a raw content stream string. */
function buildPdfFromContent(content: string, withFont = true): Buffer {
  const objs: string[] = [];
  objs.push(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`);
  objs.push(`2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj`);
  const resources = withFont ? `/Resources << /Font << /F1 5 0 R >> >>` : `/Resources << /XObject << /Im1 5 0 R >> >>`;
  objs.push(
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R ${resources} >> endobj`,
  );
  objs.push(`4 0 obj << /Length ${content.length} >> stream${content}endstream endobj`);
  if (withFont) {
    objs.push(`5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  } else {
    // A 1×1 grayscale image XObject — makes the page "raster-only".
    const imgData = "\xff";
    objs.push(
      `5 0 obj << /Type /XObject /Subtype /Image /Width 1 /Height 1 ` +
        `/ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${imgData.length} >> ` +
        `stream\n${imgData}\nendstream endobj`,
    );
  }
  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(pdf.length);
    pdf += o + "\n";
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += String(off).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/**
 * Vector contour map: three nested rectangular depth contours labeled
 * 10 / 20 / 30 (outer → inner), each label placed just outside its ring's
 * right edge so nearest-line association is unambiguous.
 */
export function makeContourPdf(): Buffer {
  const content = `
1 w 0 0 1 RG
50 50 m 250 50 l 250 250 l 50 250 l 50 50 l S
90 90 m 210 90 l 210 210 l 90 210 l 90 90 l S
130 130 m 170 130 l 170 170 l 130 170 l 130 130 l S
BT /F1 8 Tf 252 150 Td (10) Tj ET
BT /F1 8 Tf 212 150 Td (20) Tj ET
BT /F1 8 Tf 172 150 Td (30 ft) Tj ET
`;
  return buildPdfFromContent(content);
}

/**
 * Raster-only PDF: paints a single image XObject and draws no vector paths
 * and no text — models a scanned contour map.
 */
export function makeRasterOnlyPdf(): Buffer {
  const content = `
q 300 0 0 300 0 0 cm /Im1 Do Q
`;
  return buildPdfFromContent(content, false);
}

/**
 * Vector paths present but no numeric depth labels anywhere in the text layer.
 */
export function makeUnlabeledContourPdf(): Buffer {
  const content = `
1 w 0 0 1 RG
50 50 m 250 50 l 250 250 l 50 250 l 50 50 l S
BT /F1 8 Tf 100 270 Td (Lake Example) Tj ET
`;
  return buildPdfFromContent(content);
}

/** Not a PDF at all — arbitrary bytes with a .pdf name. */
export function makeCorruptPdf(): Buffer {
  return Buffer.from("this is definitely not a portable document format file", "utf8");
}
