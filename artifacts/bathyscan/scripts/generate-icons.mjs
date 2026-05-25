/**
 * Generates 192×192 and 512×512 PNG icons for the BathyScan PWA manifest.
 * Run once: node artifacts/bathyscan/scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dir, "..", "public");
mkdirSync(publicDir, { recursive: true });

// Deep-sea themed icon: dark navy background + sonar ring + "BS" label
const svgTemplate = (size) => {
  const cx = size / 2;
  const cy = size / 2;
  const r1 = size * 0.36;
  const r2 = size * 0.25;
  const r3 = size * 0.14;
  const fontSize = size * 0.18;
  const fontSize2 = size * 0.10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#061a36"/>
      <stop offset="100%" stop-color="#020818"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#00e5ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- Background -->
  <rect width="${size}" height="${size}" rx="${size * 0.14}" fill="url(#bg)"/>
  <!-- Glow -->
  <circle cx="${cx}" cy="${cy}" r="${r1}" fill="url(#glow)"/>
  <!-- Sonar rings -->
  <circle cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke="#00e5ff" stroke-width="${size * 0.012}" stroke-opacity="0.5"/>
  <circle cx="${cx}" cy="${cy}" r="${r2}" fill="none" stroke="#00e5ff" stroke-width="${size * 0.008}" stroke-opacity="0.35"/>
  <circle cx="${cx}" cy="${cy}" r="${r3}" fill="none" stroke="#00e5ff" stroke-width="${size * 0.006}" stroke-opacity="0.25"/>
  <!-- Cross-hairs -->
  <line x1="${cx}" y1="${cy - r1}" x2="${cx}" y2="${cy + r1}" stroke="#00e5ff" stroke-width="${size * 0.008}" stroke-opacity="0.3"/>
  <line x1="${cx - r1}" y1="${cy}" x2="${cx + r1}" y2="${cy}" stroke="#00e5ff" stroke-width="${size * 0.008}" stroke-opacity="0.3"/>
  <!-- Text: BATHYSCAN -->
  <text x="${cx}" y="${cy - size * 0.05}" font-family="monospace" font-weight="700"
        font-size="${fontSize}" fill="#00e5ff" text-anchor="middle" opacity="0.95"
        letter-spacing="${fontSize * 0.05}">BS</text>
  <text x="${cx}" y="${cy + size * 0.11}" font-family="monospace" font-weight="400"
        font-size="${fontSize2}" fill="#38bdf8" text-anchor="middle" opacity="0.7"
        letter-spacing="${fontSize2 * 0.2}">BATHYSCAN</text>
</svg>`;
};

for (const size of [192, 512]) {
  const svg = Buffer.from(svgTemplate(size));
  await sharp(svg).png().toFile(join(publicDir, `icon-${size}.png`));
  console.log(`✓ icon-${size}.png`);
}

// Also write the SVG for browsers that support it
writeFileSync(join(publicDir, "icon.svg"), svgTemplate(512));
console.log("✓ icon.svg");
