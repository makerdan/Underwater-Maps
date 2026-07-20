#!/usr/bin/env node
/**
 * check-deps-suppression.mjs
 *
 * Ensures every `eslint-disable(-next-line|-line) react-hooks/exhaustive-deps`
 * suppression in the BathyScan frontend carries a rationale comment (the
 * `-- <reason>` suffix required by the project convention). A bare suppression
 * with no reason is a red flag that a stale-closure risk has been silenced
 * without review.
 *
 * Exit 1 if any bare suppressions are found; 0 otherwise.
 */

import { spawnSync } from "node:child_process";

const grep = spawnSync(
  "grep",
  [
    "-rn",
    "--include=*.tsx",
    "--include=*.ts",
    "eslint-disable.*exhaustive-deps",
    "artifacts/bathyscan/src/",
  ],
  { encoding: "utf8" },
);

const lines = (grep.stdout ?? "").split("\n").filter(Boolean);

// A suppression is "bare" when it lacks a " -- " rationale suffix.
// Exclude test files — they may contain the suppression text inside string
// literals (e.g. the appTsxDuplicateHooks guard test).
const offenders = lines.filter((line) => {
  const filePart = line.split(":")[0] ?? "";
  if (filePart.includes("__tests__")) return false;
  return !line.includes(" -- ");
});

const total = lines.filter((l) => {
  const filePart = l.split(":")[0] ?? "";
  return !filePart.includes("__tests__");
}).length;

if (offenders.length > 0) {
  console.error(
    "[check:deps-suppression] Found bare exhaustive-deps suppressions without a rationale comment.",
  );
  console.error(
    "Add ' -- reason' after the suppression, e.g.:",
  );
  console.error(
    "  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand setter is a stable ref\n",
  );
  for (const line of offenders) {
    console.error(" ", line);
  }
  process.exit(1);
}

console.log(
  `[check:deps-suppression] OK — all ${total} suppression(s) carry a rationale comment.`,
);
