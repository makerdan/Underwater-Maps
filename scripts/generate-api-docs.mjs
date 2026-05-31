#!/usr/bin/env node
/**
 * generate-api-docs.mjs
 *
 * Reads lib/api-spec/openapi.yaml and regenerates the "Full API Route Surface"
 * section in README.md and replit.md.
 *
 * Usage:
 *   node scripts/generate-api-docs.mjs          # write files in-place
 *   node scripts/generate-api-docs.mjs --check  # exit 1 if files would change
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CHECK_MODE = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// 1.  Parse openapi.yaml paths section
// ---------------------------------------------------------------------------

/**
 * Very small bespoke parser for the paths block of OpenAPI 3.x YAML.
 * We only need: path keys, HTTP method keys, tags[], and summary strings.
 * All are at fixed, known indentation levels so a line-scanner suffices.
 *
 * Indentation conventions in lib/api-spec/openapi.yaml:
 *   0   top-level keys (openapi, info, paths, components …)
 *   2   path entries  (/datasets, /markers …)
 *   4   HTTP method entries  (get, post, put, patch, delete)
 *   6   method fields  (tags, summary, operationId …)
 */
function parseOpenApiPaths(yamlText) {
  const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

  const routes = [];
  let inPaths = false;
  let currentPath = null;
  let currentMethod = null;
  let currentTags = [];
  let currentSummary = '';

  function flushRoute() {
    if (currentPath && currentMethod) {
      routes.push({
        method: currentMethod.toUpperCase(),
        path: currentPath,
        tags: currentTags,
        summary: currentSummary,
      });
    }
    currentMethod = null;
    currentTags = [];
    currentSummary = '';
  }

  for (const rawLine of yamlText.split('\n')) {
    // indent = number of leading spaces on the raw line
    const indent = rawLine.length - rawLine.trimStart().length;
    // content = line with both leading and trailing whitespace stripped
    const content = rawLine.trim();

    if (!content || content.startsWith('#')) continue;

    // Detect the paths: block
    if (indent === 0) {
      if (content === 'paths:') {
        inPaths = true;
        continue;
      } else if (inPaths) {
        // Another top-level key — we've left the paths block
        flushRoute();
        inPaths = false;
        continue;
      }
    }

    if (!inPaths) continue;

    if (indent === 2) {
      // New top-level path key, e.g. "/datasets:"
      flushRoute();
      const match = content.match(/^(\/[^:]+):/);
      if (match) currentPath = match[1];
      continue;
    }

    if (indent === 4) {
      // HTTP method key under the path, e.g. "get:"
      const methodKey = content.replace(/:.*$/, '').toLowerCase();
      if (HTTP_METHODS.has(methodKey)) {
        flushRoute();
        currentMethod = methodKey;
      }
      continue;
    }

    if (indent === 6 && currentMethod) {
      if (content.startsWith('tags:')) {
        // Inline array: tags: [tag1, tag2]
        const m = content.match(/\[([^\]]*)\]/);
        if (m) {
          currentTags = m[1].split(',').map((t) => t.trim()).filter(Boolean);
        }
        continue;
      }
      if (content.startsWith('summary:')) {
        currentSummary = content.replace(/^summary:\s*/, '');
        continue;
      }
    }
  }

  flushRoute();
  return routes;
}

// ---------------------------------------------------------------------------
// 2.  Section definitions — ordered display groupings
// ---------------------------------------------------------------------------

/**
 * Each section matches routes by tag and/or path prefix.
 * Routes not matched by any section fall into "Other".
 */
const SECTION_DEFS = [
  {
    heading: 'Core Datasets',
    match: (path, tags) =>
      tags.includes('datasets') &&
      /^\/datasets(\/{[^}]+}(\/terrain|\/preview|\/overview|\/zones)?)?$/.test(path),
  },
  {
    heading: 'Upload',
    match: (path, tags) =>
      tags.includes('datasets') && path.startsWith('/datasets/upload'),
  },
  {
    heading: 'Catalog & Search',
    match: (path, tags) =>
      tags.includes('datasets') &&
      (path.startsWith('/datasets/catalog') ||
        path.startsWith('/datasets/bbox-query') ||
        path.startsWith('/datasets/my-saves') ||
        path.startsWith('/ncei/')),
  },
  {
    heading: 'Habitat & Substrate',
    match: (path, tags) =>
      tags.includes('datasets') &&
      (path.startsWith('/substrate/') ||
        path === '/efh' ||
        path.startsWith('/intertidal-spots/')),
  },
  {
    heading: 'User Datasets & Folders',
    match: (_path, tags) => tags.includes('user-datasets'),
  },
  {
    heading: 'Markers',
    match: (_path, tags) => tags.includes('markers'),
  },
  {
    heading: 'Trails',
    match: (_path, tags) => tags.includes('trails'),
  },
  {
    heading: 'Trolling Presets & Folders',
    match: (_path, tags) =>
      tags.includes('trolling-presets') || tags.includes('trolling-preset-folders'),
  },
  {
    heading: 'Environment & Conditions',
    match: (_path, tags) => tags.includes('drift-planner'),
  },
  {
    heading: 'AI Assistant (Poe)',
    match: (_path, tags) => tags.includes('poe'),
  },
  {
    heading: 'Settings & System',
    match: (_path, tags) => tags.includes('settings') || tags.includes('health'),
  },
];

// ---------------------------------------------------------------------------
// 3.  Generate markdown table for a section
// ---------------------------------------------------------------------------

/** Convert OpenAPI path param syntax {id} → Express :id convention. */
function toExpressPath(path) {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}

function buildTableRows(routes) {
  return routes
    .map(({ method, path, summary }) => {
      const expressPath = toExpressPath(path);
      return `| ${method} | \`${expressPath}\` | ${summary} |`;
    })
    .join('\n');
}

function buildSectionMarkdown(heading, routes, headingLevel) {
  const prefix = '#'.repeat(headingLevel);
  const rows = buildTableRows(routes);
  return `${prefix} ${heading}\n\n| Method | Path | Purpose |\n|---|---|---|\n${rows}`;
}

// ---------------------------------------------------------------------------
// 4.  Assemble the full generated block
// ---------------------------------------------------------------------------

function generateRoutesBlock(routes, docType) {
  // Assign each route to a section
  const sections = SECTION_DEFS.map((def) => ({
    heading: def.heading,
    routes: [],
  }));
  const otherSection = { heading: 'Other', routes: [] };

  for (const route of routes) {
    let assigned = false;
    for (let i = 0; i < SECTION_DEFS.length; i++) {
      if (SECTION_DEFS[i].match(route.path, route.tags)) {
        sections[i].routes.push(route);
        assigned = true;
        break;
      }
    }
    if (!assigned) otherSection.routes.push(route);
  }

  if (otherSection.routes.length > 0) sections.push(otherSection);

  const activeSections = sections.filter((s) => s.routes.length > 0);

  // README uses ### for sub-sections, replit.md uses ####
  const subLevel = docType === 'readme' ? 3 : 4;

  const parts = activeSections.map((s) => buildSectionMarkdown(s.heading, s.routes, subLevel));

  // Top-level section heading
  const topHeading =
    docType === 'readme'
      ? '## 15. Full API Route Surface\n\nAll routes are served under the `/api` prefix by the Express 5 server.'
      : '### Full API Route Surface';

  return [topHeading, ...parts].join('\n\n');
}

// ---------------------------------------------------------------------------
// 5.  Update a document (replace between sentinel comments)
// ---------------------------------------------------------------------------

const SENTINEL_START = '<!-- GENERATED:API-ROUTES:START -->';
const SENTINEL_END = '<!-- GENERATED:API-ROUTES:END -->';

function updateDoc(filePath, newBlock) {
  const original = readFileSync(filePath, 'utf8');

  const startIdx = original.indexOf(SENTINEL_START);
  const endIdx = original.indexOf(SENTINEL_END);

  if (startIdx === -1 || endIdx === -1) {
    console.error(`ERROR: Sentinel comments not found in ${filePath}`);
    console.error(`  Add ${SENTINEL_START} … ${SENTINEL_END} around the API route section.`);
    process.exit(1);
  }

  const before = original.slice(0, startIdx);
  const after = original.slice(endIdx + SENTINEL_END.length);

  const updated =
    before +
    SENTINEL_START +
    '\n' +
    newBlock +
    '\n\n' +
    SENTINEL_END +
    after;

  if (updated === original) return false; // no change

  if (!CHECK_MODE) {
    writeFileSync(filePath, updated, 'utf8');
  }
  return true; // changed
}

// ---------------------------------------------------------------------------
// 6.  Main
// ---------------------------------------------------------------------------

const yamlPath = resolve(ROOT, 'lib/api-spec/openapi.yaml');
const readmePath = resolve(ROOT, 'README.md');
const replitMdPath = resolve(ROOT, 'replit.md');

const yamlText = readFileSync(yamlPath, 'utf8');
const routes = parseOpenApiPaths(yamlText);

if (routes.length === 0) {
  console.error('ERROR: No routes parsed from openapi.yaml — check the parser.');
  process.exit(1);
}

const readmeBlock = generateRoutesBlock(routes, 'readme');
const replitBlock = generateRoutesBlock(routes, 'replit');

const readmeChanged = updateDoc(readmePath, readmeBlock);
const replitChanged = updateDoc(replitMdPath, replitBlock);

if (CHECK_MODE) {
  if (readmeChanged || replitChanged) {
    const changed = [readmeChanged && 'README.md', replitChanged && 'replit.md']
      .filter(Boolean)
      .join(', ');
    console.error(
      `ERROR: API route docs are stale in: ${changed}\n` +
        `Run \`pnpm run docs\` and commit the result.`
    );
    process.exit(1);
  }
  console.log('API route docs are up to date.');
} else {
  const changed = [readmeChanged && 'README.md', replitChanged && 'replit.md']
    .filter(Boolean)
    .join(', ');
  if (changed) {
    console.log(`Updated: ${changed}`);
  } else {
    console.log('API route docs already up to date — no changes written.');
  }
}
