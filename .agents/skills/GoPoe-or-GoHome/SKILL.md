---
name: GoPoe-or-GoHome
description: Structured consolidation skill for BathyScan (React+Vite / Express / Drizzle / Poe AI / Clerk). Invoke when onboarding a new session onto this project or when performing a full-project audit. Walks through eight production-readiness pillars in order, creates tasks for each, then runs a 2x task-expansion and gap-analysis pass.
---

# GoPoe-or-GoHome

A structured consolidation pass for the BathyScan pnpm monorepo. Run this skill at the start of any session that needs to assess or harden the project across all eight foundational areas. When fully executed it leaves a task backlog that is ready to be picked up pillar by pillar.

## When to Invoke

- A new agent session picks up BathyScan with no context
- A periodic audit of production-readiness is requested
- A project manager or lead wants to surface all gaps before a release

## Stack Reference

| Layer | Package / Library |
|---|---|
| Frontend | React 18 + Vite, `artifacts/bathyscan/` |
| Backend API | Express 4, `artifacts/api-server/` |
| AI | `@workspace/poe` wrapper — **always route AI through this, never call third-party APIs directly** |
| Database | Drizzle ORM + PostgreSQL, `@workspace/db` |
| Auth | Clerk (partial stub — see Pillar 3) |
| OpenAPI | `lib/api-spec/openapi.yaml`, Orval codegen |

## Table of Contents

1. [Pillar 1 — Poe API](#pillar-1--poe-api)
2. [Pillar 2 — Validation & Regression Testing](#pillar-2--validation--regression-testing)
3. [Pillar 3 — Clerk Authentication](#pillar-3--clerk-authentication)
4. [Pillar 4 — User Settings Page](#pillar-4--user-settings-page)
5. [Pillar 5 — Security Scan](#pillar-5--security-scan)
6. [Pillar 6 — File & Folder Tree with Action Menus](#pillar-6--file--folder-tree-with-action-menus)
7. [Pillar 7 — Undo/Redo Stack](#pillar-7--undoredo-stack)
8. [Pillar 8 — 2× Task Expansion & Gap Analysis](#pillar-8--2-task-expansion--gap-analysis)

---

## Pillar 1 — Poe API

> Full API reference: `.agents/skills/GoPoe-or-GoHome/reference/poe-api.md`

### Rule: Never call third-party AI APIs directly

All AI calls in this project MUST go through `@workspace/poe`. Importing `openai`, `anthropic`, or any other AI SDK directly in route handlers or frontend code is prohibited. The wrapper provides retries, caching, usage logging, and error normalisation.

### Investigation checklist

1. Search for any `new OpenAI(` or `new Anthropic(` instantiations outside `lib/poe/src/client.ts`. If found, refactor to use `getPoeClient()`.
2. Search for direct `fetch("https://api.poe.com")` calls outside `lib/poe/`. Consolidate them.
3. Verify `POE_API_KEY` is set in Replit secrets (use the `environment-secrets` skill).
4. Confirm every new endpoint that calls the Poe API also calls `logUsage(userId, model, endpoint, promptTokens, completionTokens)` so usage is tracked in `poe_usage_log`.

### Building a new AI endpoint

```
1. Import helpers from @workspace/poe:
   { getPoeClient, poeRespond, withRetry, POE_MODELS, hashCacheKey, globalPoeCache, logUsage? }

2. Choose the right model alias from POE_MODELS (see reference/poe-api.md).

3. For structured JSON output: use poeRespond() with jsonSchema + zodSchema.
   For streaming: use poeStream() / pipeStreamToResponse() from @workspace/poe.
   For vision: wrap the base64 image with buildVisionInput().

4. Wrap the call in withRetry(fn, 3).

5. Check globalPoeCache before calling and store the result after.

6. Call logUsage() after a successful response.
```

---

## Pillar 2 — Validation & Regression Testing

### Tier selection — read this before running any validation

Always load the `.agents/skills/validation-tiers/SKILL.md` skill before choosing a validation command. The project has three tiers:

| Command | Steps | When |
|---|---|---|
| `test-fast` | typecheck + lint (~5 min, budget enforced by `tierFast`) | UI copy / style / new component only |
| `test-standard` | + unit tests + doc/catalog checks (~20 min, `tierStandard`) | bug fix, new feature on existing endpoint, new settings key |
| `test-heavy` | all 10 steps (~45 min, `aggregate`) | new route, schema migration, auth/security change, multi-package refactor |

Running `test-heavy` for a copy change wastes 45 minutes. Running `test-fast` for a schema migration misses real regressions. Use the decision table in the validation-tiers skill to pick correctly.

### Contract-first pattern

The source of truth for all request/response shapes is `lib/api-spec/openapi.yaml`. The frontend client and Zod validators are generated from it by Orval. Never hand-write types that duplicate the spec.

Workflow for adding a new endpoint:
1. Add the path, request body, and response schemas to `openapi.yaml`.
2. Run `pnpm --filter @workspace/api-spec run codegen` to regenerate the client and validators.
3. Implement the Express route, using the generated Zod schema to validate `req.body`.
4. Add a Vitest unit test in `artifacts/api-server/src/__tests__/` covering the happy path and at least one error case.
5. Add a Playwright end-to-end test in `artifacts/bathyscan/e2e/` that exercises the feature from the browser.

### Naming conventions

- Unit test files: `<feature>.test.ts`
- E2E test files: `<feature>.spec.ts`
- Validation task names in `.local/skills/validation/`: `test-unit`, `test-e2e`, `lint`, `typecheck`

### Reference tasks

- Task #10 (Terrain Spike Auto-Smoothing) shows a server-side computation with a Vitest test.
- Task #24 (end-to-end test for AI classify route) shows a full Playwright spec targeting `/api/poe/classify`.

---

## Pillar 3 — Clerk Authentication

### Current state

`artifacts/api-server/src/routes/poe.ts` has a local `requireAuth` function that:
- Reads `req.auth.userId` (set by Clerk middleware when installed)
- Falls back to the `X-Dev-User-Id` header in non-production environments (development bypass stub)
- Returns `401` in production if neither is present

Clerk middleware is **not yet installed** — the stub is ready but `clerkMiddleware` from `@clerk/express` has not been wired into `artifacts/api-server/src/index.ts`.

### Steps to fully implement

1. **Read the `clerk-auth` Replit skill** — it is the authoritative how-to for this project's managed Clerk tenant. Do not use generic Clerk documentation.
2. Install packages:
   - Backend: `@clerk/express` in `artifacts/api-server/`
   - Frontend: `@clerk/react` in `artifacts/bathyscan/`
3. Wire `clerkMiddleware()` in `artifacts/api-server/src/index.ts` **before** the route mounts.
4. The existing local `requireAuth` in `poe.ts` can then be simplified to just check `req.auth.userId` — the middleware populates it.
5. Protect every route under `/api/poe/*` except `GET /api/poe/models`.
6. Promote the first signed-in user to `admin` role via Clerk's `publicMetadata` (see clerk-auth skill for the webhook pattern).
7. Remove the `X-Dev-User-Id` bypass once Clerk is confirmed working in development.

### Rate-limit headers

After wiring Clerk, add `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers to every response from the `requireAuth` + `checkRateLimit` path in `poe.ts`.

---

## Pillar 4 — User Settings Page

### Goal

A dedicated `/settings` route in the React frontend that lets users view and change their preferences, with persistence to the database.

### Database

Add a `user_settings` table to `lib/db/src/schema/user-settings.ts`:

```ts
export const userSettingsTable = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  // --- AppState values (must all be present) ---
  mode: text("mode").notNull().default("fly"),                // AppMode ("fly" | "orbit")
  speedIndex: integer("speed_index").notNull().default(1),    // index into SPEEDS array
  lastDatasetId: text("last_dataset_id"),                     // restore active datasetId on login
  cameraX: real("camera_x").notNull().default(0),             // cameraPos[0]
  cameraY: real("camera_y").notNull().default(0),             // cameraPos[1]
  cameraZ: real("camera_z").notNull().default(0),             // cameraPos[2]
  tidalOverlay: boolean("tidal_overlay").notNull().default(false),
  // --- User profile ---
  displayName: text("display_name"),                          // editable name shown in HUD
  avatarUrl: text("avatar_url"),                              // optional profile photo URL
  emailNotifications: boolean("email_notifications").notNull().default(true),
  inAppNotifications: boolean("in_app_notifications").notNull().default(true),
  // --- Appearance ---
  theme: text("theme").notNull().default("dark"),             // "dark" | "light" | "system"
  colormap: text("colormap").notNull().default("viridis"),    // depth gradient palette
  waterType: text("water_type").notNull().default("saltwater"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

Export it from `lib/db/src/schema/index.ts`. Add the migration via `pnpm --filter @workspace/db run migrate`.

### API

Add `GET /api/settings` and `PUT /api/settings` in a new route file `artifacts/api-server/src/routes/settings.ts`. Protect both with `requireAuth`. The PUT handler validates the body with a generated Zod schema and upserts the row.

### Frontend

1. Add a `<Settings />` page at `artifacts/bathyscan/src/pages/Settings.tsx`.
2. Register it under the `/settings` path in the React Router config.
3. On mount, fetch the user's settings from `GET /api/settings` and populate the form.
4. On save, call `PUT /api/settings` and update the `AppContext` values to match.
5. **Required controls** (directly mapped to `AppState` from `artifacts/bathyscan/src/lib/context.tsx`):
   - Navigation mode — fly / orbit toggle (`mode`)
   - Speed — slider or segmented control over `SPEEDS` array (`speedIndex`)
   - Last dataset — read-only display of `datasetId` (restored on next login)
   - Camera position — read-only display of `cameraPos` [x, y, z] (restored on next login)
   - Tidal overlay — on/off toggle (`tidalOverlay`)
6. **User-profile controls** (new):
   - Display name — editable text field (`displayName`)
   - Avatar / profile photo — URL input or upload (`avatarUrl`)
7. **Notification controls** (new):
   - Email notifications toggle (`emailNotifications`)
   - In-app notifications toggle (`inAppNotifications`)
8. **Appearance controls** (new):
   - Theme — dark / light / system selector (`theme`)
   - Depth gradient colormap picker (`colormap`)
   - Water type — salt / fresh toggle (`waterType`)
9. Link to the settings page from the HUD (gear icon).

### Sync on login

Use Clerk's `useUser()` hook: when `isSignedIn` transitions to `true`, fetch settings and hydrate `AppContext`. This replaces the current `localStorage`-based persistence for `tidalOverlay`. Restoring `lastDatasetId` and `cameraPos` gives users continuity across sessions.

---

## Pillar 5 — Security Scan

### Steps

1. Read the `security_scan` Replit skill.
2. Run all three scanners via the skill's `runDependencyAudit()`, `runSastScan()`, and `runHoundDogScan()` callbacks.
3. Parse the output and sort findings by severity: **Critical → High → Medium → Low**.
4. For every Critical or High finding, create a project task with:
   - Title: `[Security] <short description>`
   - Details: finding description, affected file/package, recommended fix
   - Priority: High
5. Do NOT proceed to Pillar 6 until all Critical findings have a task created.

### Common BathyScan surface areas to watch

- `POE_API_KEY` must never appear in client-side bundles or logs.
- Path traversal in zone cache: `ZONE_CACHE_DIR` writes use `isValidGridHash` — confirm that guard is present after any refactor.
- `X-Dev-User-Id` bypass must be unreachable in production (guarded by `NODE_ENV !== "production"`).
- No user-controlled strings should reach `JSON.parse` without a try/catch (already done in `poe.ts`, verify it stays that way).

---

## Pillar 6 — File & Folder Tree with Action Menus

This applies to the dataset / marker / annotation hierarchy in BathyScan.

### Data model

```ts
interface TreeNode {
  id: string;
  parentId: string | null;
  type: "folder" | "dataset" | "marker" | "annotation";
  name: string;
  children?: TreeNode[];
  deletedAt?: Date | null;  // null = alive, date = soft-deleted
}
```

Store nodes in a `tree_nodes` Drizzle table with `id`, `parent_id`, `type`, `name`, `deleted_at`, `created_at`.

### React component

- `<TreeView nodes={roots} />` — recursive, server state via TanStack Query
- Each node renders a disclosure triangle (expand/collapse), checkbox (multi-select), and the node label
- Shift+click selects a contiguous range; Ctrl+click toggles individual nodes
- Right-click opens a `<ContextMenu>` positioned at the cursor

### Context menu actions

| Action | Behaviour |
|---|---|
| Rename | Inline text input, `PATCH /api/tree/:id` on blur/Enter |
| Move | Opens a node-picker modal, `PATCH /api/tree/:id` with new `parentId` |
| Duplicate | `POST /api/tree/:id/duplicate` — deep-copies the node and its descendants |
| Delete | Sets `deletedAt = now()` (`PATCH /api/tree/:id` with `deleted: true`) — moves to Trash |
| Restore | Clears `deletedAt` (`PATCH /api/tree/:id` with `deleted: false`) — only from Trash view |

### Trash

- A `<TrashView />` panel lists all nodes where `deletedAt IS NOT NULL`.
- "Empty Trash" calls `DELETE /api/tree/trash` which hard-deletes all soft-deleted nodes.
- Hard-deletes are permanent and should show a confirmation dialog.

### Reference tasks

- Task #2 (Right-click Action Menus) is the existing task for this pillar.

---

## Pillar 7 — Undo/Redo Stack

### Architecture

Use the **Command Pattern**: every reversible action is an object with `execute()` and `undo()` methods.

```ts
interface Command {
  label: string;        // displayed in undo/redo tooltip
  execute: () => void;
  undo: () => void;
}
```

### Hook

```ts
// artifacts/bathyscan/src/hooks/useHistory.ts
export function useHistory() {
  const past = useRef<Command[]>([]);
  const future = useRef<Command[]>([]);

  function execute(cmd: Command) {
    cmd.execute();
    past.current.push(cmd);
    future.current = [];   // clear redo stack on new action
  }

  function undo() {
    const cmd = past.current.pop();
    if (!cmd) return;
    cmd.undo();
    future.current.push(cmd);
  }

  function redo() {
    const cmd = future.current.pop();
    if (!cmd) return;
    cmd.execute();
    past.current.push(cmd);
  }

  return { execute, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
```

Expose `execute`, `undo`, and `redo` via a new `HistoryContext` so any component can dispatch commands.

### Integration points

| Area | Commands to register |
|---|---|
| Three.js camera | `MoveCameraCommand` (stores previous + next position) |
| Marker placement | `PlaceMarkerCommand` / `DeleteMarkerCommand` |
| Terrain paint (zone edits) | `PaintZoneCommand` (stores before/after cell arrays) |
| Tree node actions (Pillar 6) | `RenameCommand`, `MoveCommand`, `DeleteCommand` |

### UI

- Keyboard: `Ctrl+Z` → `undo()`, `Ctrl+Y` / `Ctrl+Shift+Z` → `redo()`
- HUD buttons: ↩ Undo and ↪ Redo with tooltip showing `cmd.label`
- Buttons are disabled when `canUndo` / `canRedo` is false

---

## Pillar 8 — 2× Task Expansion & Gap Analysis

This is the final stage and must be run after pillars 1–7 are complete (or have tasks created for them).

### Step 1 — List current tasks

Enumerate all project tasks using the `project_tasks` skill. Print the task id, title, and status.

### Step 2 — 2× expansion pass

For each task, ask: "Can this be split into two independently-deliverable sub-tasks?" Apply these heuristics:

- Any task that touches both frontend and backend → split into a backend sub-task and a frontend sub-task
- Any task that includes "add tests" as a bullet → split the implementation from the test-writing
- Any task that covers more than two distinct UI views → split by view
- Any task estimated > 4 hours of work → split by natural checkpoint

Create the sub-tasks using the `project_tasks` skill with `dependsOn` wiring where the backend sub-task must complete before the frontend sub-task.

### Step 3 — Gap analysis via code review

Read the `code_review` skill and invoke the code review subagent with this prompt:

> "Review the BathyScan pnpm monorepo focusing on production-readiness gaps. Check for: missing error boundaries in React, unhandled Promise rejections in Express routes, missing database indexes, N+1 query patterns in Drizzle, missing OpenAPI spec entries for implemented routes, accessibility issues (missing aria labels, keyboard traps), and bundle size regressions. For each gap found, describe what is missing and where. Do not implement fixes — surface them as a list."

### Step 4 — Create gap tasks

For each gap surfaced by the code review, create a project task:
- Title: `[Gap] <short description>`
- Details: file path, nature of the gap, suggested fix approach
- Skip any gap already covered by an existing task

---

## Execution Order

Run the pillars in this order to avoid blockers:

```
5 (Security) → 3 (Clerk) → 1 (Poe API) → 2 (Testing) → 4 (Settings) → 6 (Tree) → 7 (Undo/Redo) → 8 (Expansion)
```

Security first because it may surface blockers. Clerk second because auth is a prerequisite for protected routes in Settings and Tree. Poe API third because new AI endpoints depend on the auth pattern being established.
