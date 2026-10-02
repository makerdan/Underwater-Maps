# Bug & Error Audit Report

**Scope:** Playwright browser specs, fixtures and setup, Vitest/Node test infrastructure, skip/reporting guards, timeout and port coordination, test dependencies, and GitHub E2E workflows. Application code was traced only where needed to classify harness behavior.
**Mode:** audit-and-fix
**Date:** 2026-10-01
**Stack:** TypeScript/React, Node.js 24, pnpm workspace, Playwright, Vitest, Node test runner, GitHub Actions. Real-Clerk browser journeys and production behavior were not exercised.

## Summary

| Severity | Confirmed | Resolved | Open |
|---|---:|---:|---:|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 19 | 19 | 0 |
| Low | 3 | 3 | 0 |

**Resolution note:** “Resolved” means a fix was applied. Any full-suite verification gap is called out explicitly below.

| # | Severity | Category | File:Line | One-line description | Status |
|---|---|---|---|---|---|
| 1 | Medium | Security | `scripts/check-audit.mjs` | An audit command failure with empty stdout is reported as a clean audit. | Resolved |
| 2 | Medium | State & data integrity | `scripts/__tests__/check-validation-baseline.test.mjs` | Historical-date tests read a newer live catalog; nine unit tests fail. | Resolved |
| 3 | Medium | Error handling | `tests/e2e/onboarding-tour.spec.ts`; `tests/e2e/location-badge.spec.ts` | Browser suites treat a missing canvas as missing auth and skip UI assertions. | Resolved |
| 4 | Medium | State & data integrity | `tests/e2e/fixtures.ts` | The settings reset fixture continues after a failed request or non-2xx response. | Resolved |
| 5 | Medium | State & data integrity | `scripts/check-e2e-runtime-skips.mjs`; `tests/e2e/runtime-skip-baseline.json` | The CI runtime skip ratchet compares suite totals, not the identities of skipped tests. | Resolved |
| 6 | Medium | State & data integrity | `scripts/check-skip-count.mjs` | Raw source matching counts comments as skip call sites. | Resolved |
| 7 | Medium | Concurrency & shared state | `scripts/run-with-timeout.mjs` | Any aggregate timeout sweeps E2E ports, including for `test-all`, which does not run E2E. | Resolved |
| 8 | Medium | Dependency hygiene | `pnpm-workspace.yaml`; `pnpm-lock.yaml` | A high-advisory `undici` version is reachable through the test-time Vitest/jsdom dependency tree. | Resolved |
| 9 | Medium | Security | `tests/e2e/dataset-folders.spec.ts` | Dataset-folder API tests omit the bypass secret required by the configured test server. | Resolved |
| 10 | Medium | State & data integrity | `tests/e2e/catch-journal.spec.ts` | Catch-journal tests post marker coordinates outside the selected dataset's coverage. | Resolved |
| 11 | Medium | State & data integrity | `tests/e2e/camera-spawn-center.spec.ts` | The saved-session fixture omits the heading convention required for restoration. | Resolved |
| 12 | Medium | State & data integrity | `tests/e2e/catalog-save-rename.spec.ts` | Global locators match duplicate SaveCard instances before rename behavior is tested. | Resolved |
| 13 | Medium | State & data integrity | `tests/e2e/dataset-folders.spec.ts` | Folder UI tests wait for a checkbox no longer rendered by the dataset row. | Resolved |
| 14 | Medium | State & data integrity | `tests/e2e/drift-planner.spec.ts` | Drift Planner tests never expand the collapsed section containing their target controls. | Resolved |
| 15 | Medium | Async & timing | `artifacts/api-server/src/domains/terrain/service.ts` | The bundled E2E server resolves its parser worker outside the emitted build directory. | Resolved |
| 16 | Medium | State & data integrity | `tests/e2e/file-upload-laz.spec.ts`; `tests/e2e/file-upload-tiff-netcdf.spec.ts` | Sparse format fixtures cause upload parser happy-path tests to skip. | Resolved |
| 17 | Medium | State & data integrity | `tests/e2e/overview-puzzle-rotation.spec.ts`; `artifacts/bathyscan/src/components/OverviewMap.tsx` | Rotation-panel tests target controls absent from the current overview-map UI. | Resolved |
| 18 | Medium | Async & timing | `tests/timeout-guard/budgets.json`; `scripts/test-heavy-serial.mjs` | The aggregate test-heavy budget expires before the full E2E step's own timeout. | Resolved |
| 19 | Medium | Async & timing | `.github/workflows/ci-e2e.yml:19` | The main GitHub E2E job cancels the suite at 45 minutes before it can emit final results. | Resolved |
| 20 | Low | Error handling | `scripts/run-with-timeout.mjs`; `scripts/test-heavy-serial.mjs` | Timeout diagnostics count detached child runners from the current serial run as concurrent load. | Resolved |
| 21 | Low | Error handling | `tests/e2e/SKIP-AUDIT.md`; `scripts/check-e2e-runtime-skips.mjs` | Skip reason documentation and reporting allowed missing reasons. | Resolved |
| 22 | Low | Error handling | `package.json`; `scripts/run-e2e.mjs` | The pnpm argument separator disables focused Playwright filters. | Resolved |

## Findings

### Finding 1 — Empty dependency-audit output fails open
- **File and line:** `scripts/check-audit.mjs:49-63`
- **Category:** Security
- **Severity:** Medium
- **Classification:** Test-infrastructure defect.
- **Risk:** If `pnpm audit` exits unsuccessfully without JSON on stdout (for example, a registry or command failure that only writes stderr), the catch stores an empty string and the checker exits 0 with “assuming clean.” A probe using a failing fake `pnpm` with empty stdout reproduced the false pass. This is a testing/security-gate defect, not evidence that the current dependency tree is clean.
- **Recommended fix:** Treat empty or invalid audit output after a failed command as an error. Only report clean after successfully parsing an audit response that contains no disallowed advisories.

### Finding 2 — Historical-date unit tests use the live catalog
- **File and line:** `scripts/__tests__/check-validation-baseline.test.mjs:14-40`; live catalog date: `docs/validation/failure-baseline.json:3`
- **Category:** State & data integrity
- **Severity:** Medium
- **Classification:** Stale test fixture/assertion.
- **Risk:** The tests pin `asOf` to `2026-08-30` while loading the checked-in catalog dated `2026-09-28`. The validator correctly rejects a catalog dated after its evaluation date; the run produced nine failures in this test file, including downstream assertions based on historical active records. This is a stale test fixture/assertion, not a product regression. The test file and catalog were not changed by this audit; the project memory also documents this historical-snapshot constraint.
- **Recommended fix:** Use a frozen catalog fixture whose `catalogDate` and record lifecycle match the historical `asOf`. Keep the separate CLI test pointed at the live catalog with a compatible current date.

### Finding 3 — Browser suites skip required canvas checks on a broad auth gate
- **File and line:** `tests/e2e/onboarding-tour.spec.ts:104-114`; `tests/e2e/tooltips.spec.ts:88-94`; `tests/e2e/location-badge.spec.ts:32-37,444-445,470-472`; local runner: `scripts/test-heavy-serial.mjs:234-253`
- **Category:** Error handling
- **Severity:** Medium
- **Classification:** Test-harness coverage defect with an environment-limited prerequisite.
- **Risk:** The fresh GitHub palette artifact records 19 passed and 11 skipped; all 11 skips say the auth bypass was inactive, while the same job logs show the E2E and frontend development bypasses active. The helper uses canvas visibility as an auth proxy, so a missing canvas caused by rendering/startup is mislabeled as missing authentication and skips UI assertions. In the earlier full browser stream, the same proxy skipped LocationBadge cases even when their network responses were mocked. This confirms a harness coverage defect, not a product defect; the GitHub run is on a different commit from the local fixes.
- **Recommended fix:** Check the auth state separately from canvas readiness. When the test has reached the authenticated app, treat a missing required canvas as a failure or emit a narrowly justified environment skip. Run the local browser command through the same skip reporter/ratchet used in CI.

### Finding 4 — Settings reset fixture can leave shared state dirty
- **File and line:** `tests/e2e/fixtures.ts:231-247`
- **Category:** State & data integrity
- **Severity:** Medium
- **Classification:** Test-harness state-isolation defect.
- **Risk:** `request.put()` does not throw for non-2xx responses by default, and the fixture never checks the response status. Transport errors are caught and only logged; in both cases `await use()` continues. If the reset endpoint returns 401/500 or becomes unreachable during a run, later tests can operate on state left by an earlier test and produce misleading failures or passes.
- **Recommended fix:** Require a successful reset response and fail the fixture before `use()` when reset cannot be confirmed. If offline-only settings tests are needed, give them a separate fixture that explicitly does not promise server-state isolation.

### Finding 5 — CI runtime skip ratchet allows skip substitution
- **File and line:** `scripts/check-e2e-runtime-skips.mjs:79-105`; `tests/e2e/runtime-skip-baseline.json:4-14`
- **Category:** State & data integrity
- **Severity:** Medium
- **Classification:** Test-infrastructure false-green risk.
- **Risk:** The CI checker compares only `counts.skipped` with a per-suite maximum; it does not compare skipped test names or reasons even though the reporter records those details. An unexpected skip can replace a previously expected skip without increasing the total and still pass. For example, `main-full` can remain at its baseline of 44 while a newly failing test takes the place of an environment-gated test that no longer skips.
- **Recommended fix:** Ratchet the allowed skip identities (and, where useful, reasons) per suite, or otherwise reject unexpected skipped tests even when the aggregate count stays within budget.

### Finding 6 — Static skip counter counts comments as executable calls
- **File and line:** `scripts/check-skip-count.mjs:47-51,100-120`; comment match: `tests/e2e/pwa-offline.spec.ts:420-424`
- **Category:** State & data integrity
- **Severity:** Medium
- **Classification:** Test-infrastructure guard defect.
- **Risk:** The scanner applies regular expressions to unparsed source text. The current E2E scan counts 239 `test.skip(` strings, while an AST count finds 238 calls; the extra match is in a comment. If a real skip call is added while that comment reference is removed, the total stays at the baseline and the guard misses the new skip. Existing proposed task **#4779** covers this comment-counting issue; this report does not create duplicate remediation.
- **Recommended fix:** Count executable call expressions using the TypeScript parser, or at minimum strip comments before matching and add a regression case for comment-only occurrences.

### Finding 7 — Aggregate timeout can terminate an unrelated browser run
- **File and line:** `scripts/run-with-timeout.mjs:58-65,190-199`; `test-all` entry point: `package.json:72`
- **Category:** Concurrency & shared state
- **Severity:** Medium
- **Classification:** Test-runner resource-isolation defect.
- **Risk:** `isE2eRun` treats every `aggregate` layer as an E2E run and sweeps the fixed E2E ports after a timeout. The root `test-all` command also uses the aggregate layer, but its shared validation-step list does not include Playwright. If a long or stuck `test-all` run breaches its budget while a separate browser suite owns those ports, the cleanup can kill the unrelated suite.
- **Recommended fix:** Pass explicit E2E-port ownership metadata to the timeout wrapper, or determine cleanup from the child command/steps rather than from the generic aggregate budget name.

### Finding 8 — Test-time dependency tree includes vulnerable `undici`
- **File and line:** `pnpm-lock.yaml:6656,6864`
- **Category:** Dependency hygiene
- **Severity:** Medium
- **Classification:** Test-tooling dependency risk.
- **Risk:** The package audit found 11 unexempted high/critical advisory instances; dependency tracing confirmed `undici@8.10.0` is reachable through the Vitest/jsdom test dependency tree. The broader audit contained 31 package/advisory entries across 24 unique advisories. The test-only reachability limits exposure compared with a production dependency, but test processes still use the affected package. Existing proposed task **#4775** covers test-tooling security and the pinned toolchain; this report does not create duplicate dependency-remediation work.
- **Recommended fix:** Resolve the affected test dependency through a compatible patched release or scoped override, preserving the deliberately pinned toolchain and re-running the audit.

### Finding 9 — Dataset-folder API tests omit the configured bypass secret
- **File and line:** `tests/e2e/dataset-folders.spec.ts:23-27`; required header contract: `artifacts/api-server/src/middlewares/requireAuth.ts:49-65`
- **Category:** Security
- **Severity:** Medium
- **Classification:** Test-harness authentication-contract defect.
- **Risk:** The API-test helper sends `x-e2e-user-id` but omits `x-e2e-bypass-secret`, while the test server's configured bypass rejects requests without the matching secret. The full browser run repeatedly receives 401 before folder assertions execute, so these tests do not exercise folder behavior and make the suite fail for a harness setup error.
- **Recommended fix:** Use the shared E2E auth-header fixture for these API requests, including the bypass secret already required by the server contract, then verify the tests reach their intended assertions.

### Finding 10 — Catch-journal tests use coordinates outside dataset coverage
- **File and line:** `tests/e2e/catch-journal.spec.ts:12,30-35`; server validation: `artifacts/api-server/src/routes/markers.ts:253-264`
- **Category:** State & data integrity
- **Severity:** Medium
- **Classification:** Stale test fixture/assertion.
- **Risk:** The helper posts a marker at longitude 142.5, latitude 11.35 for `thorne-bay`. The real marker API rejects this point with 422 because it is outside that dataset's coverage; the browser run repeats this result across catch-journal cases. Catch CRUD, photo, and user-isolation assertions therefore never run. This is an invalid fixture coordinate, not evidence of a catch-journal product defect.
- **Recommended fix:** Use a point inside the current `thorne-bay` coverage or a dedicated fixture dataset with known bounds, and keep the coverage precondition explicit in the test.

### Finding 11 — Camera-session fixture omits a required heading convention
- **File and line:** `tests/e2e/camera-spawn-center.spec.ts:109-119`; restore guard: `artifacts/bathyscan/src/lib/cameraSpawn.ts:65-84`
- **Category:** State & data integrity
- **Severity:** Medium
- **Classification:** Stale test fixture/assertion.
- **Risk:** The returning-session test stores coordinates without `headingConvention`, but the current restore code accepts saved positions only when that field is `north-up`. The full browser run receives longitude 0 instead of the expected 0.7 on both attempts. The fixture fails the production contract's prerequisite, so the assertion does not test restoration of a valid saved session.
- **Recommended fix:** Build the saved-session fixture through the current session schema, including its required heading convention, and keep the expected saved position distinct from the dataset centroid.

### Finding 12 — Save-card rename tests use globally ambiguous locators
- **File and line:** `tests/e2e/catalog-save-rename.spec.ts:76,145,198,246`
- **Category:** State & data integrity
- **Severity:** Medium
- **Classification:** Test-harness locator defect.
- **Risk:** Both rename tests fail in Playwright strict mode before reaching their behavior assertions because the same SaveCard test ID is rendered in both the sidebar and Find Data panel. The test opens Find Data but uses global `getByTestId` locators, so two legitimate component instances match and the browser suite reports a false failure.
- **Recommended fix:** Scope locators to the intended visible panel or card instance, and assert the target count before interacting.

### Finding 13 — Dataset-folder UI tests assert an obsolete row checkbox
- **File and line:** `tests/e2e/dataset-folders.spec.ts:333-339,371-380,437-445`; current row rendering: `artifacts/bathyscan/src/components/MySavesSection.tsx:830-842`
- **Category:** State & data integrity
- **Severity:** Medium
- **Classification:** Stale UI assertion.
- **Risk:** The route-mocked action-bar tests search dataset rows for `span[role="checkbox"]`, but the current row implementation renders a Load control rather than that checkbox. The full browser run times out in these tests before exercising the move or action-bar behavior, so their names overstate the coverage they provide.
- **Recommended fix:** Update the tests to enter selection using the current supported UI affordance, or restore the checkbox only if it remains an intended product interaction. Add a setup assertion that fails promptly when the expected row control is absent.

### Finding 14 — Drift Planner tests never open the collapsed section
- **File and line:** `tests/e2e/drift-planner.spec.ts:29-50,151-164`; related mode tests: `tests/e2e/drift-trolling-modes.spec.ts:167-256`; section composition: `artifacts/bathyscan/src/App.tsx:1731-1760`
- **Category:** State & data integrity
- **Severity:** Medium
- **Classification:** Stale UI-state assumption in the test harness.
- **Risk:** The tests select Plan mode and then look for planner controls inside a `Drift & Route` sidebar section that remains collapsed. The full browser run repeatedly times out before exercising the planner controls; page snapshots show Plan selected but the section collapsed. This does not establish a defect in drift calculations or planner behavior.
- **Recommended fix:** Expand the section explicitly in the shared test setup before asserting planner controls, and fail at setup if the section cannot be opened.

### Finding 15 — Bundled E2E server cannot resolve its parser worker
- **File and line:** `artifacts/api-server/src/domains/terrain/service.ts:60-65`; build output: `artifacts/api-server/build.mjs:163-184`; affected test: `tests/e2e/file-upload-chunked.spec.ts:145-190`
- **Category:** Async & timing
- **Severity:** Medium
- **Classification:** E2E build/runtime defect; deployment impact was not audited.
- **Risk:** The full chunked-upload browser test shows an upload error, `Cannot find module '/home/runner/workspace/artifacts/lib/parseWorker.mjs'`, instead of reaching the expected upload progress. The API build emits the worker under `artifacts/api-server/dist-e2e/lib/parseWorker.mjs`, while the bundled terrain service resolves its worker path relative to the bundle entry and lands at `artifacts/lib`. Thus the E2E server cannot start the parser worker for this flow; this is not a stale Playwright assertion. Other build/deployment layouts were not tested.
- **Recommended fix:** Make the worker reference resolve to the emitted `DIST_DIR` artifact for bundled builds, then verify the regular and E2E server builds both locate and start the worker.

### Finding 16 — Sparse format fixtures skip parser success coverage
- **File and line:** `tests/e2e/file-upload-laz.spec.ts:149-176`; `tests/e2e/file-upload-tiff-netcdf.spec.ts:148-171,325-347`
- **Category:** State & data integrity
- **Severity:** Medium
- **Classification:** Test-data coverage defect.
- **Risk:** In the full browser run, the LAZ, TIFF, and NetCDF API happy-path tests were marked skipped when their sample uploads returned 422. The specs explicitly convert that response into a skip because the fixtures are sparse at resolution 64. As a result, those runs do not exercise the intended accepted-file parser and saved-dataset paths; the skip-identity gap in Finding 5 further means an equal total skip count does not guarantee the same cases ran.
- **Recommended fix:** Use representative format fixtures that meet the configured coverage threshold for success-path tests, reserve sparse inputs for rejection tests, and fail the success tests if a fixture stops reaching the expected accepted path.

### Finding 17 — Rotation-panel E2E assertions target controls absent from the current UI
- **File and line:** `tests/e2e/overview-puzzle-rotation.spec.ts:196-315`; `artifacts/bathyscan/src/components/OverviewMap.tsx:5905-5919,6598-6682`; contradictory unit contract: `artifacts/bathyscan/src/__tests__/overviewMap.puzzleFlip.test.tsx:344-350`
- **Category:** State & data integrity
- **Severity:** Medium
- **Classification:** Stale test contract; no product regression was established.
- **Risk:** The full browser run failed all three rotation-panel cases (including retries) while signed in and in puzzle mode because `overview-puzzle-rotation-panel` was not present. The current OverviewMap source renders the puzzle toggle, lock, and flip controls but not the panel/dropdown/input/reset test IDs; a unit test explicitly asserts that the panel and related controls are absent. These E2E cases therefore fail before testing their claimed rotation actions and do not provide useful coverage of the current UI contract.
- **Recommended fix:** Reconcile the E2E spec with the intended current contract: test a supported rotation interaction that exists, or restore the panel if it remains a product requirement. Remove assertions against controls that the current UI and unit tests explicitly omit.

### Finding 18 — Aggregate budget cuts off the full E2E step early
- **File and line:** `tests/timeout-guard/budgets.json:34-38,60-63`; step wrapper: `scripts/test-heavy-serial.mjs:258-268`
- **Category:** Async & timing
- **Severity:** Medium
- **Classification:** Validation-harness timeout-budget mismatch.
- **Risk:** The registered `test-heavy` command gives the entire serialized run a 3000-second aggregate budget, while its full E2E step has a separate 3600-second run budget. The preflight, unit, and palette steps consume part of the aggregate allowance first. In this audit run, the aggregate wrapper exited 124 at 3000.1 seconds while Playwright was still running around case 262; the inner E2E budget had not expired and no final Playwright summary was produced. Thus a legitimate long browser run can be forcibly cut off before the registered E2E step reaches its own timeout.
- **Recommended fix:** Reconcile the aggregate budget with the expected total duration of the serialized stages so it exceeds the E2E step's effective remaining allowance, or explicitly define and report a shorter aggregate cap as an intentional coverage limit.

### Finding 19 — GitHub main E2E job expires before Playwright finishes
- **File and line:** `.github/workflows/ci-e2e.yml:19`
- **Category:** Async & timing
- **Severity:** Medium
- **Classification:** CI test-harness timeout defect.
- **Risk:** The fresh GitHub main-full job was cancelled at its 45-minute limit (run `36949565563`, job `110659261976`). Its log reached test 169 with 57 passed results, 90 failed attempts, and 21 skips; the job ended before Playwright's final reporter and runtime-skip checker could produce `ci-playwright-results.json`. The uploaded artifact contains partial test contexts/traces but no final runtime outcome. This leaves CI with incomplete feedback and prevents a complete skip-identity comparison.
- **Recommended fix:** Give the main-full job enough time to complete the suite and its reporters when retries and slow upload cases occur. The job ceiling is now 120 minutes; the PR smoke and isolated palette jobs keep their existing limits.

### Finding 20 — Timeout diagnostics count the current run as concurrent load
- **File and line:** `scripts/run-with-timeout.mjs:97-120`; nested runner: `scripts/test-heavy-serial.mjs:258-268`
- **Category:** Error handling
- **Severity:** Low
- **Classification:** Timeout-harness diagnostic false positive.
- **Risk:** The required serial `test-heavy` run hit its 3000-second aggregate budget while its full Playwright child was still active. The timeout report called this “likely budget breach under load” and listed 10 “other” runners, including the current run's nested E2E timeout wrapper, Playwright CLI, web servers, and Chromium processes. `captureLoadContext` excludes the wrapper's child process group and its ancestors, but not detached descendant groups created by nested timeout wrappers; it then treats any matching process as concurrent load. The observed load average was 2.27 on 8 CPUs, below the configured load threshold. This warning can misdirect triage toward parallel-run contention even when the listed processes belong to the timed-out run.
- **Recommended fix:** Exclude all descendants of the wrapped run, including detached process groups, or tag processes with a run-scoped identifier. Add a diagnostic test with nested detached timeout wrappers so the current run is not reported as external load.

### Finding 21 — Skip audit documentation and skip reasons are stale
- **File and line:** `tests/e2e/SKIP-AUDIT.md:58-61`; bare calls include `tests/e2e/pwa-offline.spec.ts:103,126,170,199,232` and `tests/e2e/offline-help-images.spec.ts:34`; reporter fallback: `scripts/ci-playwright-reporter.mjs:17-20`
- **Category:** Error handling
- **Severity:** Low
- **Classification:** Test-documentation and reporting hygiene.
- **Risk:** The audit says each skip site has a descriptive message, but six runtime call sites use bare `test.skip()`. The reporter substitutes a generic reason, and the runtime checker accepts a non-empty generic reason. CI artifacts can therefore record a skip without enough context to triage it.
- **Recommended fix:** Add an explicit reason at each environment-gated call and make the audit/checker reject the reporter's generic fallback; otherwise correct the documentation claim.

### Finding 22 — pnpm separator disables focused Playwright filters
- **File and line:** `package.json:19`; argument normalization: `scripts/run-e2e.mjs:12-25`
- **Category:** Error handling
- **Severity:** Low
- **Classification:** Test-harness command-line forwarding defect.
- **Risk:** `pnpm run test:e2e:run -- <file> --grep ...` places pnpm's `--` separator at the start of the script arguments. The original command forwarded that token to Playwright before the selected file, so Playwright stopped parsing options and ignored the requested grep/list filter. A focused five-test request consequently ran the whole 16-test PWA spec (14 passed, 2 skipped), making focused failures harder to attribute and wasting time.
- **Recommended fix:** Normalize and remove only the leading pnpm separator before invoking Playwright, with a regression test that preserves the file, grep, project, and list arguments. The updated wrapper now lists the setup test plus exactly the five requested tests.

## Resolutions and regression evidence

| Finding | Resolution and verification |
|---:|---|
| 1 | Dependency-audit command errors and malformed output now fail closed. `scripts/__tests__/check-audit.test.mjs` covers empty-output failures, invalid JSON, and a valid clean response. |
| 2 | Historical-date validation tests now use a matching frozen catalog fixture rather than the newer live catalog. A focused `node --test scripts/__tests__/check-validation-baseline.test.mjs` rerun passed all 15 tests; the two task-locked `test-heavy` attempts stopped before unit execution. |
| 3 | Browser helpers distinguish authenticated-shell readiness from canvas readiness; once signed in, a missing required canvas fails instead of being labeled as missing auth. The focused PWA checks passed five cases; one dataset-picker case skipped after its page closed during offline setup. |
| 4 | Settings reset now checks transport and HTTP success before allowing dependent tests to proceed. The post-fix full browser path was not exercised because both task-locked `test-heavy` attempts stopped during preflight. |
| 5 | Runtime skip outcomes now require unique test identities, reject generic/missing reasons, and compare identity sets as well as counts. The main-full baseline retains the 44 identities last observed in historical run `32204518527`; the incomplete fresh run's four additional identities were not accepted. The palette baseline remains zero despite its 11 skips. |
| 6 | The static skip ratchet parses TypeScript/JavaScript ASTs, ignores comments and strings, and fails closed on unreadable or unparseable inputs. The scanner reports 0 unit skips and 211 E2E sites; its regression suite passed. |
| 7 | Aggregate port cleanup requires explicit E2E ownership, preventing `test-all` timeout cleanup from killing another browser run. Runner/port contract tests passed. |
| 8 | The pinned Vitest family is aligned at 4.1.11 and the test-time `undici` override is 8.10.2. Vitest 4 mock/call-tuple typing was made explicit in the affected tests; both package typechecks and 82 targeted API-server/BathyScan tests pass. The remaining audit findings are unrelated `brace-expansion` and Nodemailer advisories and are listed as deferred. |
| 9 | Dataset-folder API requests now use the configured E2E bypass contract, including its secret header. The post-fix browser path was not exercised because both task-locked `test-heavy` attempts stopped during preflight. |
| 10 | Catch-journal fixtures now post coordinates inside the selected dataset bounds. The post-fix browser path was not exercised because both task-locked `test-heavy` attempts stopped during preflight. |
| 11 | Saved-session fixtures now include the required north-up heading convention and a distinct saved position. The post-fix browser path was not exercised because both task-locked `test-heavy` attempts stopped during preflight. |
| 12 | Save-card rename locators are scoped to the intended rendered card/panel. The post-fix browser path was not exercised because both task-locked `test-heavy` attempts stopped during preflight. |
| 13 | Folder UI tests use current row affordances and assert selection/setup before invoking actions. The post-fix browser path was not exercised because both task-locked `test-heavy` attempts stopped during preflight. |
| 14 | Drift Planner tests open the collapsed section before locating its controls. The post-fix browser path was not exercised because both task-locked `test-heavy` attempts stopped during preflight. |
| 15 | The parser worker path now resolves from the emitted E2E build directory; a build/runtime regression test covers the bundle. The full upload browser path was not exercised in the task-locked runs. |
| 16 | Accepted-format parser tests use representative fixtures and no longer convert rejected success-path fixtures into skips. The post-fix browser path was not exercised because both task-locked `test-heavy` attempts stopped during preflight. |
| 17 | Rotation E2E coverage now exercises the supported current interaction rather than controls the UI and unit contract omit. The post-fix browser path was not exercised because both task-locked `test-heavy` attempts stopped during preflight. |
| 18 | The aggregate budget now exceeds the serialized stage allowances and the E2E step budget. Neither task-locked `test-heavy` attempt reached the heavy stages, so completion against the updated budget remains unverified. |
| 19 | `.github/workflows/ci-e2e.yml` now allows 120 minutes for the main-full suite and final reporters; the fresh 45-minute run verified the former ceiling was insufficient. The revised ceiling awaits a future run on the updated commit. |
| 20 | Timeout diagnostics now walk descendant process trees and exclude detached nested descendants without hiding same-group siblings. Nested-run regression tests passed. |
| 21 | Runtime skips require explicit reasons and the generic reporter fallback is rejected; the skip audit now matches the executable call sites. Reporter and runtime-checker tests passed. |
| 22 | `scripts/run-e2e.mjs` removes pnpm's leading separator before forwarding arguments. The regression test passed, `--list` selected exactly five requested PWA tests plus setup, and those five tests ran with one environment-gated skip. |

## Tooling signals (Phase 0)

- **Typecheck and lint before remediation:** The original registered `test-heavy` preflight passed typecheck and reported 0 lint errors with 6 warnings.
- **Tests before remediation:** The original task-locked `test-heavy` unit step failed 9/15 tests in `scripts/__tests__/check-validation-baseline.test.mjs` (Finding 2); three isolated reruns reproduced the same historical-catalog failure. Its palette step had 14 passed and 11 skips. The original full Playwright step was terminated by the 3000-second aggregate budget around case 262; before termination it had 107 passed results, 44 failed attempts, and 73 skips, with no final Playwright summary (Finding 18).
- **Task-locked `test-heavy` attempts after fixes:** Both authorized invocations exited during preflight typecheck, before lint, unit, palette, or full Playwright stages. The first exposed implicit-any fetch-spy call arguments in API-server tests after the Vitest 4 update; explicit call-tuple typing fixed those errors. The second exposed untyped `vi.fn()` callbacks in three BathyScan tests; explicit mock function implementations fixed those errors. No full unit or browser-suite result is available from these attempts.
- **Focused checks after those fixes:** API-server and BathyScan package typechecks passed. `pnpm run lint` passed with 0 errors and 6 warnings (2 existing unused-disable warnings in `MarkerLayer.tsx`, 4 unused-disable warnings in `pwa-offline.spec.ts`). The affected API-server tests passed 56/56, the affected BathyScan tests passed 26/26, and the validation-baseline Node test file passed 15/15.
- **Focused post-fix probe:** The repaired package command listed setup plus the five requested PWA tests; those tests produced 5 passed and 1 skip when the dataset-picker page closed during offline setup. The skip is documented as an environment-flake gate in `tests/e2e/SKIP-AUDIT.md`; this run alone does not establish a product defect.
- **GitHub run:** Run [36949565563](https://github.com/makerdan/Underwater-Maps/actions/runs/36949565563), commit `3a5a7f6a112a552cb8cb960cc3a41175819f9fe6`, differs from this checkout's `031b61f1e682a9b58ea08696fd14bc183669fae6`. Its palette job completed with 19 passed, 0 failed, and 11 skips; the runtime-skip check failed against the zero-skip baseline, which was not raised. The main-full job was cancelled after 45 minutes with 57 passed results, 90 failed attempts, and 21 skips at test 169; it emitted no final reporter JSON. Four of those partial skip identities were not in the prior 44-identity baseline, so they were not accepted. The baseline keeps the last available 44 identities from run `32204518527` (2026-08-19); that run also hit the 45-minute limit, so the exact set should be refreshed from a complete run on the updated commit.
- **Dependency audit:** The fresh `pnpm run check:audit` exits nonzero with eight unexempted high findings: six `brace-expansion` instances and two Nodemailer advisories. The test-time override now resolves `undici` to patched `8.10.2` (Finding 8); the remaining advisories are unrelated to this task's approved scope. An empty-output command-failure probe confirmed the original fail-open behavior (Finding 1).

## Audited-clean areas

- The database Vitest project loads `lib/db/src/__tests__/setup.ts`, which installs the configured per-file timeout guard. The earlier candidate finding about this guard was not confirmed and is excluded from the verified findings.
- The CI E2E workflows configure suite-specific reporting, run the runtime-skip checker even after a failed browser step, and upload reports with `if: always()`. The main-full job's former 45-minute ceiling was insufficient and is now 120 minutes (Finding 19).
- The E2E setup includes health checks and stale-port cleanup before Playwright web-server startup. Port ownership and the serial heavy-runner structure were inspected; no additional port-cleanup defect was verified beyond Finding 7.
- The E2E main job in GitHub run `36949565563` ended cancelled at 45 minutes. Its partial log records 21 skips (including four identities not in the prior baseline) and no final reporter JSON; no new main-full skip identity was added. The separate palette job completed with 19 passed, 0 failed, and 11 canvas/auth-gated skips against a zero-skip baseline; that baseline was not increased.
- Focused local PWA selection was checked through the repaired package command: the list contained the setup test and exactly five requested tests. The run passed five and skipped one after the dataset-picker page closed during offline setup.
- TypeScript, React, and Vitest/Node test surfaces are present and were included in scope. No application behavior was audited beyond the fixture and render preconditions needed to classify test skips.

## Suggested follow-up order

1. Obtain authorization for another task-locked `test-heavy` run after the type fixes. Both allowed invocations stopped in preflight, so full unit, palette, and browser outcomes remain unverified.
2. Re-run the GitHub E2E workflow against the task's updated commit after merge. The main job now has a 120-minute ceiling; refresh its exact runtime-skip identities from a complete outcome. Run `36949565563` used `3a5a7f6a112a552cb8cb960cc3a41175819f9fe6`, not this checkout's `031b61f1e682a9b58ea08696fd14bc183669fae6`.
3. Track the remaining eight unrelated high dependency advisories separately (six `brace-expansion`, two Nodemailer); they were outside the approved dependency scope.
4. Run the real-Clerk browser journey only in an authorized environment that has the required external authentication setup.
5. The approved scopes of proposed work **#4775** (test toolchain/security) and **#4779** (static skip counting) were completed here; do not create duplicate remediation.

## Deferred / not audited

- Real-Clerk and other externally authenticated browser journeys were not run; this audit did not request or access credentials.
- Both task-locked `test-heavy` attempts stopped during preflight typecheck. Focused typechecks and selected unit tests passed after fixes, but the full unit, palette, and Playwright stages were not executed.
- The fresh GitHub `main-full` run was cancelled by its 45-minute limit before the reporters finished. Its partial 21-skip list is not a complete baseline; the report preserves the last available 44-identity set and records the four new partial identities as unaccepted.
- The Canvas design artifact and application behavior outside the minimum read-only traces were excluded.
- The eight unrelated dependency advisories remain outside this task's approved scope.
- No production database or deployment data was queried.