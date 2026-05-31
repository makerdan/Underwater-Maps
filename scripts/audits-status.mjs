/**
 * audits-status.mjs
 *
 * Prints a table showing each audit's threshold, current counter value,
 * and how many merges remain until it is next triggered.
 *
 * Usage: node scripts/audits-status.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const COUNTER_PATH = join(ROOT, '.local', 'audit-counter.json');

const AUDITS = [
  { key: 'mergesSinceValidation',  label: 'Validation Stack',       threshold: 10 },
  { key: 'mergesSinceSecurity',    label: 'Security Hardening',      threshold: 10 },
  { key: 'mergesSinceMemory',      label: 'Memory & GPU Leak',       threshold: 15 },
  { key: 'mergesSinceSchemaDrift', label: 'Schema & Migration Drift',threshold: 10 },
  { key: 'mergesSinceDeps',        label: 'Dependency Health',        threshold: 20 },
  { key: 'mergesSinceA11y',        label: 'Accessibility',            threshold: 20 },
];

const counter = existsSync(COUNTER_PATH)
  ? JSON.parse(readFileSync(COUNTER_PATH, 'utf8'))
  : {};

const COL = { label: 28, current: 9, threshold: 11, remaining: 11 };

function pad(str, len) {
  return String(str).padEnd(len);
}

const header =
  pad('Audit', COL.label) +
  pad('Current', COL.current) +
  pad('Threshold', COL.threshold) +
  pad('Remaining', COL.remaining);

const divider = '-'.repeat(COL.label + COL.current + COL.threshold + COL.remaining);

console.log('\nBathyScan Audit Scheduler Status');
console.log(divider);
console.log(header);
console.log(divider);

for (const audit of AUDITS) {
  const current = counter[audit.key] ?? 0;
  const remaining = Math.max(0, audit.threshold - current);
  const status = remaining === 0 ? ' *** DUE ***' : '';
  console.log(
    pad(audit.label, COL.label) +
    pad(current, COL.current) +
    pad(audit.threshold, COL.threshold) +
    pad(remaining, COL.remaining) +
    status,
  );
}

console.log(divider);
console.log('');
