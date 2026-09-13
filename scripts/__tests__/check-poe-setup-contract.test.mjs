import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  findPoeSetupContractProblems,
  POE_SETUP_SKILL_PATH,
  REQUIRED_POE_SETUP_GUIDANCE,
} from "../check-poe-setup-contract.mjs";

const canonicalSkill = readFileSync(POE_SETUP_SKILL_PATH, "utf8");
const importLine = 'import OpenAI from "openai";';

function injectAtRawSdkModuleScope(source, code) {
  return source.replace(importLine, `${importLine}\n\n${code}`);
}

function expectMutationRejected(name, source, diagnostic) {
  const problems = findPoeSetupContractProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes(diagnostic)),
    `${name} should report ${diagnostic}; got:\n${problems.join("\n")}`,
  );
}

function removeNormalizedPhrase(source, phrase) {
  const pattern = phrase
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return source.replace(new RegExp(pattern, "g"), "");
}

test("the committed Poe Setup skill satisfies the static contract", () => {
  assert.deepEqual(findPoeSetupContractProblems(canonicalSkill), []);
});

test("the approved lazy memoized getter is accepted", () => {
  const rawSdkOnly = `## 5. Raw SDK fallback
Construct it lazily and memoize it in a server-only module.
Importing the module must not read or validate optional Poe configuration,
construct a client, or throw because Poe is not configured. Fail at the
operation boundary when Poe is first used. If required, an explicit startup
preflight may call the same getter and fail startup; that preflight is an
application decision, not a module-import side effect.

\`\`\`ts
import OpenAI from "openai";
let poeClient: OpenAI | undefined;
export function getPoeClient(): OpenAI {
  if (poeClient) return poeClient;
  const apiKey = process.env.POE_API_KEY2;
  if (!apiKey) throw new Error("not configured");
  poeClient = new OpenAI({ apiKey, baseURL: "https://api.poe.com/v1" });
  return poeClient;
}
\`\`\`
## 6. Discover live model IDs and capabilities`;

  const guidance = REQUIRED_POE_SETUP_GUIDANCE.flatMap(({ phrases }) => phrases).join("\n");
  assert.deepEqual(findPoeSetupContractProblems(`${rawSdkOnly}\n${guidance}\nPOE_API_KEY2`), []);
});

test("rejects obsolete secret naming and an OpenAI /bot/ base URL", () => {
  expectMutationRejected(
    "obsolete secret",
    canonicalSkill.replace("POE_API_KEY2", "POE_API_KEY"),
    "obsolete POE_API_KEY",
  );
  expectMutationRejected(
    "bot protocol",
    canonicalSkill.replace(
      'baseURL: "https://api.poe.com/v1"',
      'baseURL: "https://api.poe.com/bot/"',
    ),
    "baseURL uses legacy /bot/",
  );
});

test("rejects plainly and differently named eager clients", () => {
  expectMutationRejected(
    "plain eager client",
    injectAtRawSdkModuleScope(
      canonicalSkill,
      'export const poe = new OpenAI({ apiKey: "fixture" });',
    ),
    "module-scope OpenAI client construction",
  );
  expectMutationRejected(
    "differently named eager client",
    injectAtRawSdkModuleScope(
      canonicalSkill,
      'const transportForVendor = new OpenAI({ apiKey: "fixture" });',
    ),
    "module-scope OpenAI client construction",
  );
});

test("rejects module-scope secret lookup and missing-secret validation", () => {
  expectMutationRejected(
    "eager secret validation",
    injectAtRawSdkModuleScope(
      canonicalSkill,
      `const configuredCredential = process.env.POE_API_KEY2;
if (!configuredCredential) throw new Error("missing");`,
    ),
    "module-scope Poe secret lookup",
  );
});

test("rejects import-triggered health, catalogue, and completion requests", () => {
  expectMutationRejected(
    "health check",
    injectAtRawSdkModuleScope(canonicalSkill, "await checkPoeHealth();"),
    "import-triggered Poe health check",
  );
  expectMutationRejected(
    "catalogue request",
    injectAtRawSdkModuleScope(
      canonicalSkill,
      'await fetch("https://api.poe.com/v1/models");',
    ),
    "import-triggered catalogue request",
  );
  expectMutationRejected(
    "completion request",
    injectAtRawSdkModuleScope(
      canonicalSkill,
      'await fetch("https://api.poe.com/v1/chat/completions");',
    ),
    "import-triggered model-completion request",
  );
});

test("rejects removal of every required operational safeguard", () => {
  for (const contract of REQUIRED_POE_SETUP_GUIDANCE) {
    for (const phrase of contract.phrases) {
      expectMutationRejected(
        `${contract.id} phrase removal`,
        removeNormalizedPhrase(canonicalSkill, phrase),
        `${contract.id}: missing required guidance`,
      );
    }
  }
});

test("non-text skill input produces an actionable diagnostic", () => {
  assert.deepEqual(
    findPoeSetupContractProblems(null),
    ["skill file: content could not be read as text"],
  );
});