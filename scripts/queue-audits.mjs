/**
 * queue-audits.mjs
 *
 * Reads .local/audit-counter.json, increments every merge counter by 1 (once
 * per unique merge commit), and creates project tasks for any audit whose
 * threshold has been reached.
 *
 * Idempotency guarantees:
 *   1. Per-merge retry safety: the current git HEAD SHA is stored in the
 *      counter file as `lastProcessedCommit`. If the script is run again for
 *      the same commit (e.g., a post-merge retry), the increment is skipped
 *      entirely so cadence counts remain accurate.
 *   2. Per-audit deduplication: before creating a task, the script checks
 *      whether a PROPOSED/PENDING/IN_PROGRESS task with the same title already
 *      exists (only possible in platform/code_execution context where
 *      searchProjectTasks is available).
 *
 * Execution contexts:
 *   - Platform (code_execution sandbox): `bulkCreateProjectTasks` and
 *     `searchProjectTasks` are globally available. Tasks are created directly
 *     and due counters are reset immediately after confirmed creation.
 *   - Shell (post-merge.sh): platform globals are absent. Due audits are
 *     written to .local/pending-audit-tasks.json and counters are NOT reset
 *     (they remain at or above threshold so the next platform-context run
 *     picks them up). The agent should run this script via code_execution
 *     after each post-merge setup to flush any pending tasks.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const COUNTER_PATH = join(ROOT, '.local', 'audit-counter.json');
const PENDING_PATH = join(ROOT, '.local', 'pending-audit-tasks.json');

const AUDITS = [
  {
    key: 'mergesSinceValidation',
    threshold: 10,
    title: 'Validation Stack Audit',
    templatePath: '.local/tasks/audit-validation.md',
    sourceTemplate: 'scripts/audit-templates/validation.md',
  },
  {
    key: 'mergesSinceSecurity',
    threshold: 10,
    title: 'Security Hardening Audit',
    templatePath: '.local/tasks/audit-security.md',
    sourceTemplate: 'scripts/audit-templates/security.md',
  },
  {
    key: 'mergesSinceMemory',
    threshold: 15,
    title: 'Memory & GPU Leak Audit',
    templatePath: '.local/tasks/audit-memory-gpu.md',
    sourceTemplate: 'scripts/audit-templates/memory-gpu.md',
  },
  {
    key: 'mergesSinceSchemaDrift',
    threshold: 10,
    title: 'Schema & Migration Drift Audit',
    templatePath: '.local/tasks/audit-schema-drift.md',
    sourceTemplate: 'scripts/audit-templates/schema-drift.md',
  },
  {
    key: 'mergesSinceDeps',
    threshold: 20,
    title: 'Dependency Health Audit',
    templatePath: '.local/tasks/audit-dependency-health.md',
    sourceTemplate: 'scripts/audit-templates/dependency-health.md',
  },
  {
    key: 'mergesSinceA11y',
    threshold: 20,
    title: 'Accessibility Audit',
    templatePath: '.local/tasks/audit-accessibility.md',
    sourceTemplate: 'scripts/audit-templates/accessibility.md',
  },
];

function readCounter() {
  if (!existsSync(COUNTER_PATH)) {
    return {
      mergesSinceValidation: 0,
      mergesSinceSecurity: 0,
      mergesSinceMemory: 0,
      mergesSinceSchemaDrift: 0,
      mergesSinceDeps: 0,
      mergesSinceA11y: 0,
      lastProcessedCommit: null,
    };
  }
  return JSON.parse(readFileSync(COUNTER_PATH, 'utf8'));
}

function writeCounter(counter) {
  writeFileSync(COUNTER_PATH, JSON.stringify(counter, null, 2) + '\n', 'utf8');
}

function getCurrentCommitSHA() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function copyTemplate(audit) {
  const src = join(ROOT, audit.sourceTemplate);
  const dest = join(ROOT, audit.templatePath);
  const content = readFileSync(src, 'utf8');
  writeFileSync(dest, content, 'utf8');
}

async function taskAlreadyExists(title) {
  if (typeof globalThis.searchProjectTasks !== 'function') return false;
  try {
    const results = await globalThis.searchProjectTasks({ query: `"${title}"`, limit: 5 });
    return results.some(
      (r) =>
        r.title === title &&
        (r.state === 'PROPOSED' || r.state === 'PENDING' || r.state === 'IN_PROGRESS'),
    );
  } catch {
    return false;
  }
}

async function main() {
  const counter = readCounter();
  const currentSHA = getCurrentCommitSHA();

  // --- Retry idempotency: skip increment if this commit was already processed ---
  if (currentSHA && counter.lastProcessedCommit === currentSHA) {
    console.log(
      `[queue-audits] Commit ${currentSHA.slice(0, 8)} already processed — skipping increment.`,
    );
  } else {
    // Increment every counter by 1 (one new merge).
    for (const audit of AUDITS) {
      counter[audit.key] = (counter[audit.key] ?? 0) + 1;
    }
    counter.lastProcessedCommit = currentSHA;
    console.log(`[queue-audits] Counters incremented (commit ${currentSHA ? currentSHA.slice(0, 8) : 'unknown'}).`);
  }

  // Determine which audits are due (counter >= threshold).
  const due = AUDITS.filter((a) => counter[a.key] >= a.threshold);

  if (due.length === 0) {
    console.log('[queue-audits] No audits due.');
    writeCounter(counter);
    return;
  }

  console.log(`[queue-audits] ${due.length} audit(s) due: ${due.map((a) => a.title).join(', ')}`);

  const hasPlatformAPI = typeof globalThis.bulkCreateProjectTasks === 'function';

  if (!hasPlatformAPI) {
    // Shell context: write the pending file for the agent to consume via
    // code_execution. Counters are NOT reset here — they stay elevated so
    // a subsequent platform-context run will also detect them as due and
    // create tasks even if the pending file is never manually processed.
    const pending = due.map((a) => ({
      title: a.title,
      templatePath: a.templatePath,
      sourceTemplate: a.sourceTemplate,
    }));
    writeFileSync(PENDING_PATH, JSON.stringify(pending, null, 2) + '\n', 'utf8');
    console.log(
      `[queue-audits] Shell context — platform task API not available. ` +
      `Wrote ${pending.length} pending audit(s) to .local/pending-audit-tasks.json. ` +
      `Run this script via code_execution to create the tasks.`,
    );
    // Persist incremented counters (without resetting due ones) so the next
    // platform-context run sees them as still due.
    writeCounter(counter);
    return;
  }

  // Platform (code_execution) context: create tasks, then reset due counters.
  const toCreate = [];
  for (const audit of due) {
    const alreadyExists = await taskAlreadyExists(audit.title);
    if (alreadyExists) {
      console.log(`[queue-audits] Skipping "${audit.title}" — task already proposed or in progress.`);
      counter[audit.key] = 0;
      continue;
    }
    copyTemplate(audit);
    toCreate.push({ title: audit.title, filePath: audit.templatePath });
  }

  if (toCreate.length > 0) {
    const created = await globalThis.bulkCreateProjectTasks({ tasks: toCreate });
    for (const t of created) {
      console.log(`[queue-audits] Created task ${t.taskRef}: ${t.title}`);
      // Reset the counter for this audit now that creation is confirmed.
      const audit = AUDITS.find((a) => a.title === t.title);
      if (audit) counter[audit.key] = 0;
    }
  }

  // Clean up pending file if it exists — tasks have now been handled.
  if (existsSync(PENDING_PATH)) {
    const { unlinkSync } = await import('fs');
    unlinkSync(PENDING_PATH);
  }

  writeCounter(counter);
  console.log('[queue-audits] Done.');
}

await main();
