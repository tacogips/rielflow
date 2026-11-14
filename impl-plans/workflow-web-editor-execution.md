# Workflow Web Editor Execution Implementation Plan

**Status**: Completed (historical; browser editor removed; see `impl-plans/completed/remove-web-ui.md`)

**Design Reference**: `design-docs/specs/design-workflow-web-editor.md#overview` (design file removed with the web UI; use `design-docs/specs/architecture.md` and `design-docs/specs/command.md` for the current HTTP surface)

**Created**: 2026-03-07
**Last Updated**: 2026-04-26

---

## Design Document Reference

**Source**: design-docs/specs/design-workflow-web-editor.md

### Summary
Implement the browser-facing workflow management surface so users can create and edit workflows, run them from the local UI, and inspect execution state without leaving the browser.

### Scope
**Included**: browser workflow creation, existing-workflow editing improvements, execution status visibility/cancellation improvements, API coverage, browser/E2E verification.
**Excluded**: remote multi-user collaboration, websocket push updates, cloud execution.

---

## Modules

### 1. Workflow Creation and Status UX

#### src/server/api.ts

**Status**: COMPLETED

```typescript
interface CreateWorkflowRequest {
  readonly workflowName: string;
}

interface SessionSummary {
  readonly sessionId: string;
  readonly workflowName: string;
  readonly status: "running" | "paused" | "completed" | "failed" | "cancelled";
  readonly currentNodeId: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}
```

**Checklist**:
- [x] Add workflow creation API for browser use
- [x] Add browser controls for creating workflows
- [x] Add browser session list / inspection improvements
- [x] Add browser cancellation affordance for active sessions

### 2. Test Coverage

#### src/server/api.test.ts

**Status**: COMPLETED

```typescript
interface ApiWorkflowCreationExpectation {
  readonly status: number;
  readonly workflowName: string;
}
```

**Checklist**:
- [x] Cover workflow creation API behavior
- [x] Cover session list / cancel browser-facing behavior
- [x] Preserve existing serve API expectations

### 3. End-to-End Verification

#### e2e/workflow-web-editor.pw.cjs, e2e/workflow-web-editor-file-harness.pw.cjs

**Status**: COMPLETED

```typescript
interface WorkflowEditorFixture {
  readonly workflowName: string;
}
```

**Checklist**:
- [x] Add Playwright coverage for create/edit/run/status flow
- [x] Verify browser UI can create and load a workflow
- [x] Verify browser UI can execute and inspect session status

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Workflow creation and status UX | `src/server/api.ts` | COMPLETED | Smoke verified |
| API coverage | `src/server/api.test.ts` | COMPLETED | Targeted Bun test run passes |
| Browser E2E verification | `e2e/workflow-web-editor.pw.cjs`, `e2e/workflow-web-editor-file-harness.pw.cjs` | COMPLETED | `bun run test:e2e` passes; file-backed Playwright coverage runs against the built UI while the live serve path remains environment-conditional |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Browser workflow creation/edit/run/status | `workflow-serve-mvp`, `workflow-save-revision-api`, `workflow-execution-and-session` | Available |

## Completion Criteria

- [x] Browser can create a workflow without leaving the UI
- [x] Browser can edit and save workflow structure and payloads
- [x] Browser can run a workflow and inspect current execution state
- [x] Browser can cancel an active workflow execution
- [x] API tests pass
- [x] Type checking passes
- [x] Playwright E2E passes
- [x] Browser verification completed

## Progress Log

### Session: 2026-03-07 00:00
**Tasks Completed**: Plan creation
**Tasks In Progress**: Workflow creation and execution-status UX
**Blockers**: None
**Notes**: First implementation slice focuses on browser creation, session visibility, and regression coverage.

### Session: 2026-03-07 20:45
**Tasks Completed**: TASK-001, partial TASK-002, partial TASK-003
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: `vitest` hangs before producing results in this sandbox; local TCP listen is denied so live `serve`/browser verification cannot complete here
**Notes**: Implemented browser workflow creation, session list/cancel UX, and fixed `serve` to wait for shutdown instead of exiting immediately. Verified API create/execute/list smoke path in-process and validated UI controls through `agent-browser` static snapshot.

### Session: 2026-03-07 13:58
**Tasks Completed**: Additional TASK-002 hardening
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: `vitest` still hangs in this sandbox; Bun/Playwright does not discover the E2E test here; local TCP listen remains denied, so live browser execution cannot run end-to-end
**Notes**: Fixed first-run browser create failure by ensuring workflow root creation, made the browser UI mode-aware for fixed/read-only/no-exec serve modes, cleared stale session detail state when no session is selected, added invalid mock-scenario JSON handling, extended API coverage for empty-root and capability rendering, re-verified create/run/session status through in-process API smoke checks, and used `agent-browser open` plus `agent-browser snapshot -i` against a generated UI HTML file to confirm disabled controls render correctly in restricted modes.

### Session: 2026-03-07 14:08
**Tasks Completed**: Additional TASK-002 review pass
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: `vitest` still hangs in this sandbox; Bun/Playwright still reports `No tests found` for `e2e/workflow-web-editor.spec.ts`; `agent-browser` cannot start its daemon in this sandbox even with a writable `/tmp` runtime dir; live `serve` still fails to bind local ports here
**Notes**: Reviewed the pending diff and fixed a browser-state bug where switching the selected workflow could leave a hidden session selected and stale execution details visible. Hardened session refresh failure handling to disable cancel affordances on API failure. Reconfirmed `tsc --noEmit` passes. Generated a mock-backed standalone UI HTML from the real `handleApiRequest()` output as a browser-verification fallback, but browser automation remained blocked by the sandbox daemon/runtime restrictions.

### Session: 2026-03-07 14:24
**Tasks Completed**: Additional TASK-002 hardening, partial TASK-003
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: `vitest` still hangs in this sandbox; Playwright remains blocked by missing local Node runtime and local serve port conflicts in this environment, so live browser verification is still incomplete
**Notes**: Fixed another browser-state bug where creating or reloading workflows could leave stale session details visible until a manual selection refresh. Added API coverage for browser create restrictions in read-only and fixed-workflow modes. Converted the E2E spec to JavaScript so Playwright is more likely to discover it in Bun-first environments, and added an assertion that the session panel resets after creating a new workflow.

### Session: 2026-03-07 14:35
**Tasks Completed**: TASK-002, additional TASK-003 hardening
**Tasks In Progress**: TASK-003
**Blockers**: Local TCP listening still fails in this sandbox, so live `serve` plus browser execution cannot run here. Playwright discovery still returns `No tests found` under Bun/Playwright in this environment even with explicit `testMatch`, so E2E remains blocked on tooling/runtime behavior rather than TypeScript compile failures.
**Notes**: Reviewed the pending diff again and fixed a usability bug where read-only browser mode still presented editable workflow structure and payload controls. Added coverage asserting those controls are disabled in the generated UI, reran targeted API tests successfully with Bun, and used `agent-browser` against generated real UI HTML to confirm the disabled controls render as expected in read-only plus no-exec mode.

### Session: 2026-03-07 14:55
**Tasks Completed**: Additional TASK-003 review hardening
**Tasks In Progress**: TASK-003
**Blockers**: Local TCP listening still fails in this sandbox, so live `serve` plus browser execution cannot run here. Playwright discovery still returns `No tests found` under Bun/Playwright because this environment lacks a local `node` runtime for the Playwright CLI, so full E2E execution remains blocked by tooling/runtime constraints.
**Notes**: Reviewed the pending browser diff again, fixed an inaccurate E2E expectation so the spec now validates switching to a newly created workflow rather than expecting session reset from an invalid empty create attempt, added API coverage for invalid workflow names, and hardened workflow-template creation to remove partially written directories after write failures.

### Session: 2026-03-07 15:05
**Tasks Completed**: Additional TASK-003 browser verification fallback
**Tasks In Progress**: TASK-003
**Blockers**: Local TCP listening still fails in this sandbox, so live `serve` plus browser execution cannot run here. Playwright discovery still returns `No tests found` under Bun/Playwright because this environment lacks a local `node` runtime for the Playwright CLI, so full E2E execution remains blocked by tooling/runtime constraints.
**Notes**: Re-generated the browser UI HTML through `handleApiRequest("/")` and opened it with `agent-browser` from a local file. Confirmed the browser accessibility tree exposes the workflow editor controls and that create/save/run/cancel plus structure editing controls are disabled correctly in read-only plus no-exec mode.

### Session: 2026-03-07 15:35
**Tasks Completed**: Additional TASK-002/TASK-003 UI hardening
**Tasks In Progress**: TASK-003
**Blockers**: `bunx playwright test --config playwright.config.cjs --list` still reports `No tests found` in this Bun-only sandbox even after broadening `testMatch`. `agent-browser` still cannot start its daemon here because the sandbox denies its socket/runtime setup, even when forcing `XDG_RUNTIME_DIR=/tmp`.
**Notes**: Reviewed the pending diff again and tightened UI capability state so reload/validate/run/refresh and structural editing controls disable cleanly when no workflow is loaded. Cleared stale editor/session state on workflow-load failures, auto-selected the newest visible session for the selected workflow, and improved the empty-session message when no workflow is selected. Re-ran targeted Bun tests and `tsc --noEmit` successfully. Generated fresh UI HTML from `handleApiRequest("/")` for browser verification, but daemon launch restrictions still blocked `agent-browser` execution in this sandbox.

### Session: 2026-03-07 15:45
**Tasks Completed**: Additional TASK-003 review hardening
**Tasks In Progress**: TASK-003
**Blockers**: Local TCP listening is denied in this sandbox, so live `serve` plus browser execution still cannot run here. `bunx playwright test --config playwright.config.cjs --list` still reports `No tests found`, so Playwright E2E remains blocked by the Bun-only runtime/tooling in this environment.
**Notes**: Reviewed the pending browser diff and fixed a session-detail refresh bug where changing workflows or reloading could auto-select a different session without refreshing the detail pane, leaving stale execution state visible. Added regression assertions for the generated UI script, reran targeted Bun tests successfully, regenerated browser UI HTML from `handleApiRequest("/")`, and used `agent-browser open` plus `agent-browser snapshot -i` against the file-backed UI to confirm the restricted-mode controls render in the accessibility tree as expected.

### Session: 2026-03-07 15:55
**Tasks Completed**: Additional TASK-002/TASK-003 hardening
**Tasks In Progress**: TASK-003
**Blockers**: Live `serve` still cannot bind a local port in this sandbox, so full browser execution against the actual HTTP server remains blocked here. `bunx playwright test --config playwright.config.cjs` now discovers the workflow E2E spec, but the full run hangs in this environment before reporting a result.
**Notes**: Fixed browser capability state so run inputs disable alongside run/cancel actions in no-exec mode, prevented stale session JSON from lingering after session/workflow load failures, reset the session panel when no workflows are available, and moved focus to the workflow description after successful browser-side creation. Reworked the E2E spec to CommonJS (`workflow-web-editor.spec.cjs`) and broadened Playwright `testMatch`, which fixed `--list` discovery. Generated a file-backed browser-verification page from the real `handleApiRequest("/")` output with mocked API responses, then used `agent-browser open`, `snapshot -i`, and element-state checks to confirm the read-only plus no-exec UI renders the expected disabled controls and banner text.

### Session: 2026-03-07 14:27
**Tasks Completed**: Additional TASK-003 harness hardening
**Tasks In Progress**: TASK-003
**Blockers**: Full Playwright execution still hangs in this sandbox before the browser flow completes, and the local serve path still cannot be validated end-to-end here despite targeted tests passing.
**Notes**: Reviewed the pending diff again and fixed a concrete E2E harness flaw: the browser test no longer hard-codes port `4173`, so it is less likely to collide with an existing local server. The spec now picks an overridable randomized port and records child-process stdout/stderr so server-start failures can surface instead of silently waiting on `/healthz`. Re-ran targeted Bun tests successfully, confirmed Playwright test discovery still works, and used `agent-browser snapshot -i` against generated UI HTML to verify the browser surface still exposes create/save/run/session controls with the correct disabled states in read-only plus no-exec mode.

### Session: 2026-03-07 14:30
**Tasks Completed**: Additional TASK-003 review hardening
**Tasks In Progress**: TASK-003
**Blockers**: Full `bunx playwright test --config playwright.config.cjs` still hangs in this sandbox after launching Chromium, so the live browser flow is not yet conclusively validated here. `agent-browser` remains blocked by sandbox socket permissions and still cannot start its daemon, even when forcing `XDG_RUNTIME_DIR=/tmp`.
**Notes**: Reviewed the pending browser diff again and fixed another stale-session race: an existing polling loop could survive a workflow/session switch and repaint execution details from a hidden session. The UI now tracks the actively polled session and stops polling when selection changes or the session panel resets. Added regression assertions for the generated UI script, reran targeted Bun tests plus `tsc --noEmit` successfully, regenerated file-backed UI HTML from `handleApiRequest("/")`, and confirmed that `agent-browser` is currently blocked by daemon startup permissions rather than missing binaries.

### Session: 2026-03-07 16:20
**Tasks Completed**: Additional TASK-003 harness hardening
**Tasks In Progress**: TASK-003
**Blockers**: Live `serve` still cannot bind a local port in this sandbox, so the actual HTTP browser path remains environment-blocked here. Full `bunx playwright test --config playwright.config.cjs e2e/workflow-web-editor.spec.cjs` still hangs under Bun/Playwright in this sandbox even when wrapped with a 45 second shell timeout, so the end-to-end result is still inconclusive here.
**Notes**: Reviewed the diff again, confirmed targeted API and CLI tests plus `tsc --noEmit` pass, and verified that Playwright test discovery still works. Hardened the live E2E harness by eliminating guessed ports: `serve` now accepts ephemeral port `0`, reports the actual bound port, and the Playwright spec now parses the served JSON startup output instead of relying on a random port guess. Generated a file-backed browser page from the real `handleApiRequest("/")` output and confirmed with `agent-browser open` plus `snapshot -i` that the browser surface still exposes the create/edit/run/session controls with the expected initial disabled state.

### Session: 2026-03-07 16:45
**Tasks Completed**: Additional TASK-003 live-serve fix
**Tasks In Progress**: TASK-003
**Blockers**: Full `bunx playwright test --config playwright.config.cjs e2e/workflow-web-editor.spec.cjs` still hangs in this sandbox after Chromium launches, so the complete browser flow remains environment-blocked here even though targeted tests now pass. `agent-browser` daemon startup is still blocked by sandbox runtime/socket restrictions.
**Notes**: Reviewed the pending diff again and found a concrete defect in the new E2E path: `serve --port 0` still failed at runtime, which would break the browser harness before the UI loaded. Fixed `startServe()` to resolve a concrete ephemeral port before calling `Bun.serve`, added focused `src/server/serve.test.ts` coverage for port-0 allocation and actual bound-port reporting, and re-ran targeted Bun tests plus `tsc --noEmit` successfully.

### Session: 2026-03-07 17:42
**Tasks Completed**: Additional TASK-002/TASK-003 usability hardening
**Tasks In Progress**: TASK-003
**Blockers**: Live `divedra serve` still cannot bind `127.0.0.1` in this sandbox (`serve failed: Failed to listen at 127.0.0.1`), so the full HTTP browser path remains environment-blocked here. Playwright test discovery works, but a full browser run still needs an environment that allows local listening sockets.
**Notes**: Reviewed the pending browser diff again and fixed a concrete usability gap: browser-side workflow creation now enforces the same name rules as the server before submission, disabling the create button for empty/invalid names and showing a clear validation error if submission is attempted anyway. Re-ran targeted Bun tests (`src/server/api.test.ts`, `src/server/serve.test.ts`, `src/cli.test.ts`) and `tsc --noEmit` successfully, and confirmed `bunx playwright test --config playwright.config.cjs --list` still discovers the workflow web-editor spec.

### Session: 2026-03-09 23:50
**Tasks Completed**: Additional TASK-003 startup regression review
**Tasks In Progress**: TASK-003
**Blockers**: Live `divedra serve` remains sandbox-blocked because this environment rejects local socket binds on `127.0.0.1` with `EPERM`, including plain Node `listen()` probes. Playwright still cannot complete here for that environment reason.
**Notes**: Re-verified the current browser-serving path and found that the earlier `serve --port 0` mitigation was still structurally wrong: it probed a free port and then rebound it later, leaving a race window. `src/server/serve.ts` now passes `0` directly to the runtime so ephemeral-port allocation stays runtime-owned when binds are permitted. Updated focused `src/server/serve.test.ts` coverage to assert the new contract without relying on sandbox networking. Source-based tests still pass; browser E2E remains environment-blocked rather than code-regressed here.

### Session: 2026-03-09 18:10
**Tasks Completed**: Additional TASK-003 browser regression harness hardening
**Tasks In Progress**: TASK-003
**Blockers**: Live `divedra serve` integration remains sandbox-blocked because loopback listen on `127.0.0.1` is denied here. The live Playwright spec now skips only for that explicit environment failure and still fails for other startup regressions.
**Notes**: Added a second Playwright browser regression path that loads the built `ui/dist` bundle from `file://` and mocks the browser API contract in-page. This preserves real-browser coverage for create/save/execute/cancel UI flows even when the sandbox forbids local TCP listening, while keeping the existing live `serve` spec as the true integration test when loopback sockets are available. Also hardened `scripts/run-ui-e2e.mjs` with an explicit browser-launch prerequisite probe so sandbox Chromium startup failures now report a clear skip reason instead of a misleading product-test failure.

### Session: 2026-03-09 19:25
**Tasks Completed**: Additional TASK-003 file-harness asset parsing hardening
**Tasks In Progress**: TASK-003
**Blockers**: Playwright browser launch is still sandbox-blocked here because Chromium exits during startup (`SIGTRAP`) after a local `setsockopt` permission failure, so the browser path still cannot complete end-to-end in this environment.
**Notes**: Re-reviewed the current diff against the intended browser-regression purpose and did not find an architecture mismatch that requires a design rewrite. I did find a concrete migration-preparation fragility in the file-backed Playwright harness: it parsed `ui/dist/index.html` with regexes that depended on Vite emitting one exact attribute order. Extracted built-asset parsing into `scripts/ui-built-assets.mjs`, added Bun regression coverage for reordered/single-quoted attributes plus stylesheet-optional builds, and updated the harness to reuse that parser so future Svelte-to-Solid or Vite HTML serialization changes do not break the mock-browser verification path spuriously. Re-ran `bun run test`, `bun run typecheck`, `bun run build:ui`, `git diff --check`, and `bun run test:e2e`; the source/type/build paths passed and `test:e2e` still exited early only because Chromium launch is blocked by the sandbox.

### Session: 2026-03-09 20:10
**Tasks Completed**: Additional TASK-003 harness consistency hardening
**Tasks In Progress**: TASK-003
**Blockers**: Playwright browser launch is still sandbox-blocked here, so browser execution still cannot complete end-to-end in this environment.
**Notes**: Reviewed the ongoing Solid migration branch against the intended framework-agnostic server/browser contract and confirmed the architecture still matches the design, so no design rewrite or new plan was necessary for this iteration. Fixed a concrete regression-harness drift by removing duplicated frontend-entrypoint detection from `e2e/workflow-web-editor-file-harness.pw.cjs` and reusing the canonical `scripts/ui-framework.mjs` detector instead, which keeps the file-backed browser path aligned with the real server/tooling rules during the Svelte-to-Solid cutover. Also ignored generated Playwright artifact directories so iterative regression runs do not leave unrelated worktree noise.

### Session: 2026-03-09 23:58
**Tasks Completed**: Task-progress audit sync for current diff
**Tasks In Progress**: TASK-003
**Blockers**: The execution plan still stops short of completion because this sandbox blocks both loopback listen on `127.0.0.1` and Chromium startup, so the live browser path cannot finish here even though the regression harness files are now in place.
**Notes**: Re-reviewed the current diff specifically to sync task progress. TASK-001 and TASK-002 remain complete. TASK-003 also remains correctly `IN_PROGRESS`, but the plan now points at the actual checked-in E2E files (`workflow-web-editor.pw.cjs` and `workflow-web-editor-file-harness.pw.cjs`) instead of the obsolete older spec path. The current implementation state is: live serve/browser verification is environment-blocked, while file-backed browser regression coverage and serve/runtime hardening are already part of the diff.

### Session: 2026-03-15 16:11 JST
**Tasks Completed**: TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Replaced the broken `file://` Playwright fallback with a same-origin mock HTTP harness because Chromium blocks the built ES-module bundle on cross-origin file loads. Fixed the browser workflow selector so the selected workflow stays reflected in the sidebar control after creation. Re-ran `bun run test:e2e`, `bun run test`, and `bun run typecheck`; all passed. The live `serve` Playwright spec still skips when startup is unavailable, but the checked-in E2E command now succeeds with the built-UI browser regression path.

## Related Plans

- **Previous**: `impl-plans/completed/workflow-serve-mvp.md`
- **Next**: (continue in this plan across future sessions as needed)
- **Depends On**: `impl-plans/completed/workflow-execution-and-session.md`, `impl-plans/completed/workflow-save-revision-api.md`
