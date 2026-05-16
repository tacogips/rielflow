# Runtime Boundaries Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: refactoring-divide-and-conquer slice reviews, fanout `fanout-refactoring-slice-review-exec-000002`
**Created**: 2026-05-16
**Last Updated**: 2026-05-16

## Purpose

Improve divedra maintainability across workflow execution, validation IO, session persistence, backend adapters, CLI/library boundaries, packages, and local workflow bundles while preserving public APIs and runtime behavior unless an individual task explicitly justifies a compatible change.

## Scope Boundaries

- Target paths: `src/workflow`, `src/cli`, `src/lib.ts`, `packages`, `.divedra/workflows`.
- Excluded paths: `dist`, `node_modules`, `/tmp`, `impl-plans/completed`.
- Do not stage, commit, push, or revert unrelated dirty worktree changes.
- Keep each implementation pass to one bounded task and update this plan after each pass.
- Prefer focused source-level maintainability fixes with narrow tests over broad cosmetic rewrites.

## Accepted Findings

| Finding ID | Slice | Severity | Ownership Path | Task |
|------------|-------|----------|----------------|------|
| WFE-H01 | workflow-execution-engine | high | `src/workflow/call-step-impl/direct-step-helpers.ts` | REF-001 |
| WFE-M01 | workflow-execution-engine | mid | `src/workflow/call-step-impl/direct-step-execution.ts` | REF-002 |
| WFE-M02 | workflow-execution-engine | mid | `src/workflow/engine/workflow-runner-deps.ts` | REF-003 |
| WFE-M03 | workflow-execution-engine | mid | `src/workflow/engine/fanout-dispatch.ts` | REF-004 |
| WDVI-M01 | workflow-definition-validation-io | mid | `src/workflow/prompt-template-file.ts` | REF-005 |
| WDVI-M02 | workflow-definition-validation-io | mid | `src/workflow/validate/output-contracts-and-callees.ts` | REF-005 |
| WDVI-M03 | workflow-definition-validation-io | mid | `src/workflow/save.ts` | REF-006 |
| SESSION-M01 | workflow-session-supervision-communications | mid | `src/workflow/session-store.ts` | REF-007 |
| SESSION-M02 | workflow-session-supervision-communications | mid | `src/workflow/manager-session-store.ts` | REF-007 |
| SESSION-M03 | workflow-session-supervision-communications | mid | `src/workflow/communication-service.ts` | REF-008 |
| SESSION-M04 | workflow-session-supervision-communications | mid | `src/workflow/superviser-control.ts` | REF-008 |
| BACKENDS-H01 | workflow-backends-addons-adapters | high | `src/workflow/adapter-execution.ts` | REF-009 |
| BACKENDS-M01 | workflow-backends-addons-adapters | mid | `src/workflow/addon-package-boundary.ts` | REF-009 |
| BACKENDS-M02 | workflow-backends-addons-adapters | mid | `src/workflow/native-node-executor/chat-and-gateway-addons.ts` | REF-009 |
| BACKENDS-M03 | workflow-backends-addons-adapters | mid | `packages/divedra-addons/src/index.ts` | REF-010 |
| CLI-M01 | cli-lib-public-api | mid | `src/cli/session-command-handler.ts` | REF-010 |
| CLI-M02 | cli-lib-public-api | mid | `src/lib.ts` | REF-010 |
| CLI-M03 | cli-lib-public-api | mid | `src/cli/workflow-command-handler.ts` | REF-010 |
| PKG-M01 | packages-and-local-workflows | mid | `packages/divedra-core/src/index.ts` | REF-010 |
| PKG-M02 | packages-and-local-workflows | mid | `.divedra/workflows/design-and-implement-review-loop-feature-plan/nodes/node-step2-design-doc-update.json` | REF-010 |
| PKG-M03 | packages-and-local-workflows | mid | `.divedra/workflows/design-and-implement-review-loop-feature-plan/workflow.json` | REF-010 |

## Rejected Findings

No high or mid findings were rejected. Read-only review limitations and cosmetic-only opportunities remain as residual risks, not implementation tasks.

## Task DAG

| Task ID | Title | Status | Depends On | Parallelizable |
|---------|-------|--------|------------|----------------|
| REF-001 | Unify shared execution contract helpers | Completed | - | Yes |
| REF-002 | Extract shared output-attempt runner | Completed | REF-001 | No |
| REF-003 | Type one engine lifecycle phase and shrink `workflowRunnerDeps` | Completed | - | Yes |
| REF-004 | Split local fanout branch execution from result reduction | Completed | - | Yes |
| REF-005 | Consolidate workflow path and callee validation helpers | Completed | - | Yes |
| REF-006 | Extract save workflow planning from filesystem persistence | Completed | - | Yes |
| REF-007 | Decouple session stores from runtime DB connection/indexing details | Completed | - | Yes |
| REF-008 | Centralize idempotency and auto-improve policy parsing helpers | Completed | - | Yes |
| REF-009 | Deduplicate backend timeout, add-on registry, and gateway execution helpers | Completed | - | Yes |
| REF-010 | Stabilize CLI, library, package, and workflow bundle boundaries | Completed | REF-001 | No |

## Tasks

### REF-001: Unify shared execution contract helpers

**Status**: Completed
**Owned Files/Directories**: `src/workflow/engine/types-and-session-state.ts`, `src/workflow/call-step-impl/direct-step-helpers.ts`
**Excluded Files**: `src/lib.ts`, `src/cli`, package entrypoints
**Depends On**: None

**Completion Criteria**:
- [x] Extract shared runtime contract helpers for execution IDs, timeout selection, output contract prompting, candidate-path handling, validation feedback, and publication policy.
- [x] Preserve existing `runWorkflow` and `callStepExecution` output behavior.
- [x] Add or adjust focused tests for candidate-path and validation-feedback parity.

**Verification Commands**:
- `bun test src/workflow/engine.test.ts src/workflow/call-step.test.ts src/workflow/call-step-impl-execution.test.ts src/workflow/call-step-impl-failures.test.ts`
- `git diff --check`

**Residual Risk**: Helper extraction may expose subtle formatting differences between engine and direct call-step validation feedback.

### REF-002: Extract shared output-attempt runner

**Status**: Completed
**Owned Files/Directories**: `src/workflow/engine/node-output-attempts.ts`, `src/workflow/call-step-impl/direct-step-execution.ts`
**Excluded Files**: `src/workflow/adapters`, `src/lib.ts`, `src/cli`
**Depends On**: REF-001

**Completion Criteria**:
- [x] Create a shared attempt runner for adapter/package invocation, candidate paths, validation writes, retry decisions, and final output shaping.
- [x] Keep retry count, candidate artifact, and validation output semantics unchanged.
- [x] Cover both workflow-run and direct call-step paths with focused regression tests.

**Verification Commands**:
- `bun test src/workflow/engine.test.ts src/workflow/call-step-impl-execution.test.ts src/workflow/call-step-impl-failures.test.ts`
- `git diff --check`

**Residual Risk**: Runtime-owned output publication has artifact-ordering behavior that may require scenario-level verification.

### REF-003: Type one engine lifecycle phase and shrink `workflowRunnerDeps`

**Status**: Completed
**Owned Files/Directories**: `src/workflow/engine/workflow-runner-deps.ts`, one selected file under `src/workflow/engine`
**Excluded Files**: unrelated engine phases not selected for the pass
**Depends On**: None

**Completion Criteria**:
- [x] Replace one `workflowRunnerDeps` consumer with a typed phase input interface or direct imports.
- [x] Remove `@ts-nocheck` from the selected phase if present.
- [x] Avoid changing lifecycle ordering or public behavior.

**Verification Commands**:
- `bun run typecheck:server`
- `bunx tsc --noEmit`
- `bun test src/workflow/engine.test.ts`
- `git diff --check`

**Residual Risk**: Remaining phases may still rely on the broad dependency bag until later passes.

### REF-004: Split local fanout branch execution from result reduction

**Status**: Completed
**Owned Files/Directories**: `src/workflow/engine/fanout-dispatch.ts`, `src/workflow/engine-fanout.ts`
**Excluded Files**: session store and runtime DB modules
**Depends On**: None

**Completion Criteria**:
- [x] Extract branch execution and fanout result reduction into typed helpers.
- [x] Preserve user-action pause, failure, skipped-branch, join artifact, and session mutation semantics.
- [x] Add focused tests for fanout pause/failure/result reduction where coverage is missing.

**Verification Commands**:
- `bun test src/workflow/engine-fanout.test.ts src/workflow/engine.test.ts`
- `git diff --check`

**Residual Risk**: Some fanout behavior depends on runtime session artifacts and may need integration coverage beyond unit tests.

### REF-005: Consolidate workflow path and callee validation helpers

**Status**: Completed
**Owned Files/Directories**: `src/workflow/prompt-template-file.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`, `src/workflow/validate/output-contracts-and-callees.ts`, `src/workflow/validate/semantic-validation-and-addons.ts`
**Excluded Files**: add-on registry implementation outside validation injection points
**Depends On**: None

**Completion Criteria**:
- [x] Make workflow-relative path diagnostics field-aware without coupling all callers to `promptTemplateFile` wording.
- [x] Extract shared callee resolution for sync and async validation paths behind narrow IO adapters.
- [x] Preserve workflow JSON compatibility and validation issue text where relied on by tests.

**Verification Commands**:
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts`
- `bunx tsc --noEmit`
- `git diff --check`

**Residual Risk**: Validation diagnostics are user-visible; wording changes should be intentional and minimal.

### REF-006: Extract save workflow planning from filesystem persistence

**Status**: Completed
**Owned Files/Directories**: `src/workflow/save.ts`, `src/workflow/save-types.ts`
**Excluded Files**: workflow loader, validation internals, CLI save commands
**Depends On**: None

**Completion Criteria**:
- [x] Extract a pure save-plan builder for normalization, prompt hydration, validation decisions, revision checks, stale cleanup decisions, and revision recomputation.
- [x] Keep filesystem writes in a narrow persistence executor.
- [x] Add tests for save-plan decisions without requiring filesystem side effects where practical.

**Verification Commands**:
- `bun test src/workflow/save.test.ts src/workflow/authored-workflow.test.ts`
- `git diff --check`

**Residual Risk**: Stale-file cleanup and authored workflow compatibility require careful fixture coverage.

### REF-007: Decouple session stores from runtime DB connection/indexing details

**Status**: Completed
**Owned Files/Directories**: `src/workflow/session-store.ts`, `src/workflow/session-history.ts`, `src/workflow/manager-session-store.ts`, `src/workflow/runtime-db`
**Excluded Files**: GraphQL schema and CLI session commands
**Depends On**: None

**Completion Criteria**:
- [x] Introduce a narrow session snapshot indexing port or composition boundary for runtime DB indexing.
- [x] Centralize runtime DB connection/schema extension used by manager session tables.
- [x] Preserve session-store, manager-session-store, and runtime-db public call signatures unless a compatibility shim is included.

**Verification Commands**:
- `bun test src/workflow/session-store.test.ts src/workflow/session-history.test.ts src/workflow/runtime-db.test.ts src/workflow/manager-session-store.test.ts`
- `git diff --check`

**Residual Risk**: Runtime DB schema changes may affect existing local artifact directories if migration behavior drifts.

### REF-008: Centralize idempotency and auto-improve policy parsing helpers

**Status**: Completed
**Owned Files/Directories**: `src/workflow/communication-service.ts`, `src/workflow/manager-message-service.ts`, `src/workflow/manager-message-service/idempotency.ts`, `src/workflow/auto-improve-policy.ts`, `src/workflow/superviser-control.ts`
**Excluded Files**: supervisor clients, GraphQL schema, CLI
**Depends On**: None

**Completion Criteria**:
- [x] Reuse one idempotent mutation helper for communication-service and manager-message-service canonical hashing and conflict behavior.
- [x] Move raw auto-improve policy input parsing behind the normalization module or a dedicated parser module.
- [x] Preserve existing validation messages unless tests are intentionally updated.

**Verification Commands**:
- `bun test src/workflow/communication-service.test.ts src/workflow/manager-message-service.test.ts src/workflow/manager-session-store.test.ts src/workflow/auto-improve-policy.test.ts src/workflow/superviser-control.test.ts src/workflow/superviser-runtime-control-impl.test.ts`
- `git diff --check`

**Residual Risk**: Policy parsing changes can affect nested superviser add-ons even when engine paths still pass.

### REF-009: Deduplicate backend timeout, add-on registry, and gateway execution helpers

**Status**: Completed
**Owned Files/Directories**: `src/workflow/adapter-execution.ts`, `src/workflow/addon-package-boundary.ts`, `src/workflow/node-addons/addon-constants-and-agent-config.ts`, `src/workflow/native-node-executor/chat-and-gateway-addons.ts`
**Excluded Files**: package export facades, CLI, public library barrel
**Depends On**: None

**Completion Criteria**:
- [x] Race package-native execution against an explicit rejecting timeout promise, matching adapter timeout behavior.
- [x] Extract shared add-on definition selection helpers for package-boundary and internal registries.
- [x] Extract typed gateway helper for x-gateway and mail-gateway env resolution, command assembly, logging, JSON parsing, and output wrapping.
- [x] Preserve differing x-gateway and mail-gateway CLI argument shapes.

**Verification Commands**:
- `bun test src/workflow/adapter.test.ts src/workflow/native-node-executor-gateway.test.ts src/workflow/addon-package-boundary.test.ts src/workflow/native-node-executor-addons-commands.test.ts`
- `bun run typecheck`
- `git diff --check`

**Residual Risk**: `src/workflow/adapter-execution.ts` and `src/workflow/addon-package-boundary.ts` were already dirty before plan creation; implementation must preserve unrelated changes.

### REF-010: Stabilize CLI, library, package, and workflow bundle boundaries

**Status**: Completed
**Owned Files/Directories**: `src/cli/session-command-handler.ts`, `src/cli/workflow-command-handler.ts`, `src/cli/input-output-helpers.ts`, `src/lib.ts`, `packages/divedra-core/src/index.ts`, `packages/divedra-addons/src/index.ts`, `packages/divedra/src/index.ts`, `.divedra/workflows/design-and-implement-review-loop-feature-plan`, `.divedra/workflows/impl-plan-completion-loop`, `.divedra/workflows/refactoring-slice-review`
**Excluded Files**: workflow engine internals except explicit compatibility imports
**Depends On**: REF-001

**Completion Criteria**:
- [x] Break CLI imports from the public `../lib` barrel while preserving `src/lib.ts` public exports.
- [x] Extract a typed library workflow-run options builder for repeated public operation options.
- [x] Centralize CLI GraphQL execution payload parsing for run/resume/rerun style commands.
- [x] Align package export facades with a documented source-level public contract without narrowing published APIs accidentally.
- [x] Move feature-plan workflow prompts into `prompts/*.md` files with exact prompt text preservation.
- [x] Add minimal deterministic scenario/expected-result coverage for uncovered local workflow bundles where side effects can be mocked safely.

**Verification Commands**:
- `bun test src/cli.test.ts src/lib-api.test.ts src/lib-supervision.test.ts src/package-boundaries.test.ts`
- `bun run build:server`
- `bun run src/main.ts workflow validate design-and-implement-review-loop-feature-plan --workflow-definition-dir .divedra/workflows`
- `bun run src/main.ts workflow validate impl-plan-completion-loop --workflow-definition-dir .divedra/workflows`
- `bun run src/main.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows`
- `bun run typecheck:server`
- `git diff --check`

**Residual Risk**: Package export changes are public-API-sensitive; prompt extraction is behavior-preserving only if copied exactly before cleanup.

## Conflicts And Coordination Notes

- Shared execution helper extraction may touch dependency-boundary slices if moved outside `src/workflow`.
- Fanout refactoring mutates `WorkflowSessionState` and `FanoutGroupRunRecord`; coordinate with session persistence changes.
- Runtime DB ownership overlaps session, manager, GraphQL, and event-source query paths; keep changes limited to connection/schema helpers and table ownership boundaries.
- `src/workflow/adapter-execution.ts` and `src/workflow/addon-package-boundary.ts` are already dirty in the worktree; implementation must not revert unrelated changes.
- Package export narrowing crosses `src/lib.ts`, package facades, and package-boundary tests; preserve public API compatibility unless a separate task justifies a safe change.
- The CLI currently requires workflow names for validation; use per-workflow validate commands instead of `workflow validate --workflow-definition-dir .divedra/workflows`.

## Verification Strategy

- Run each task's narrow Bun tests first.
- Run `bunx tsc --noEmit`, `bun run typecheck`, or `bun run typecheck:server` when a task changes TypeScript boundaries or package/public API surfaces.
- Run workflow validation commands for changed workflow bundles.
- Run `git diff --check` after every implementation pass.
- Do not stage, commit, or push as part of this refactoring workflow unless a later explicit user request overrides that constraint.

## Exit Criteria

- [x] Every accepted high and mid finding maps to a completed task or a documented accepted residual risk.
- [x] Public APIs and runtime behavior are preserved, except for explicitly documented safe compatibility changes.
- [x] Each completed task has focused verification commands recorded with pass/fail status in the progress log.
- [x] Dirty pre-existing worktree changes are preserved and not reverted.
- [x] Remaining risks are low, explicitly accepted, and have ownership notes.

## Accepted Low Residual Risks

- Read-only slice reviews did not execute tests.
- Excluded test files were used for verification targeting, not full coverage review.
- Additional lower-value extraction opportunities may remain in large modules outside the accepted high/mid finding set.
- Workflow scenario coverage may require dry-run or add-on mock boundaries to avoid side effects.

## Progress Log

### Session: 2026-05-16

**Tasks Completed**: Planning only.

**Notes**: Merged six slice-review outputs into this task DAG. No source implementation, staging, commit, push, or mailbox output writes were performed.

### Session: 2026-05-16 REF-003 implementation pass

**Tasks Completed**: None.

**Tasks In Progress**: REF-003.

**Blockers**: `bunx tsc --noEmit` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/workflow/engine.test.ts`
- PASS: `bun run lint:biome`
- PASS: `git diff --check`
- BLOCKED: `bunx tsc --noEmit`

**Notes**: Replaced `src/workflow/engine/step-transition-finalization.ts` dependency-bag consumption with direct typed imports plus `FinalizeStepTransitionsInput` and `StepTransitionFinalizationResult`. Removed the selected phase's `@ts-nocheck`. Shrunk `src/workflow/engine/workflow-runner-deps.ts` by dropping fanout transition/dispatch exports no longer needed by the selected phase. Lifecycle ordering and session mutation branches were left unchanged.

### Session: 2026-05-16 REF-001 implementation pass

**Tasks Completed**: REF-001.

**Tasks In Progress**: REF-003 remains recorded as in progress from the prior accepted pass because broad typecheck is still blocked by missing adapter test SDK modules.

**Blockers**: `bunx tsc --noEmit` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/workflow/engine.test.ts src/workflow/call-step.test.ts src/workflow/call-step-impl-execution.test.ts src/workflow/call-step-impl-failures.test.ts src/workflow/runtime-execution-contracts.test.ts`
- PASS: `bun run lint:biome`
- PASS: `git diff --check`
- BLOCKED: `bunx tsc --noEmit`

**Notes**: Extracted shared runtime execution contract helpers into `src/workflow/runtime-execution-contracts.ts` and rewired engine/direct-step helper modules to re-export the shared execution IDs, timeout candidate selection, output contract prompting, candidate-path handling, validation feedback, candidate payload resolution, and publication policy helpers. Added focused parity tests proving engine and direct-step candidate-path and validation-feedback exports share the same implementation. Runtime workflow and direct call-step output behavior remained covered by the targeted regression tests.

### Session: 2026-05-16 REF-002 implementation pass

**Tasks Completed**: REF-002.

**Tasks In Progress**: REF-003 remains recorded as in progress from the prior accepted pass because broad typecheck is still blocked by missing adapter test SDK modules.

**Blockers**: `bun run typecheck` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/workflow/engine.test.ts src/workflow/call-step-impl-execution.test.ts src/workflow/call-step-impl-failures.test.ts`
- PASS: `bun run lint:biome`
- PASS: `git diff --check`
- BLOCKED: `bun run typecheck`

**Notes**: Added `src/workflow/output-attempt-runner.ts` as the shared output-attempt runner for adapter/package invocation, reserved candidate setup and cleanup, request/validation artifacts, retry decisions, backend-session carry-forward, candidate payload normalization, schema validation, and final output shaping. Rewired `src/workflow/engine/node-output-attempts.ts` and `src/workflow/call-step-impl/direct-step-execution.ts` to delegate the shared loop while keeping engine/direct dispatch details local. Preserved the existing direct-step behavior that does not clear prior validation errors on a later provider failure, and preserved engine behavior that does clear them.

### Session: 2026-05-16 REF-004 implementation pass

**Tasks Completed**: REF-004.

**Tasks In Progress**: REF-003 remains recorded as in progress from the prior accepted pass because broad typecheck is still blocked by missing adapter test SDK modules.

**Blockers**: `bun run typecheck` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/workflow/engine-fanout.test.ts src/workflow/engine.test.ts`
- PASS: `bun run lint:biome`
- PASS: `git diff --check`
- BLOCKED: `bun run typecheck`

**Notes**: Extracted local fanout branch execution into a typed `executeLocalFanoutBranch` helper inside `src/workflow/engine/fanout-dispatch.ts`, keeping the serialized parent-session mutation behavior local to dispatch. Added typed fanout group, join aggregate, and branch-result reduction helpers in `src/workflow/engine-fanout.ts`, then rewired local fanout dispatch to use the reduction outcome for paused, failed, and succeeded joins. Added `src/workflow/engine-fanout.test.ts` coverage for paused branch diagnostics, failed/cancelled branch reduction, and deterministic join aggregate shaping while preserving existing integration coverage for user-action pause, optional pause, fail-fast cancellation, join artifacts, and session mutation semantics.

### Session: 2026-05-16 REF-005 implementation pass

**Tasks Completed**: REF-005.

**Tasks In Progress**: REF-003 remains recorded as in progress from the prior accepted pass because broad typecheck is still blocked by missing adapter test SDK modules.

**Blockers**: `bunx tsc --noEmit` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts`
- PASS: `bun run lint:biome`
- PASS: `git diff --check`
- BLOCKED: `bunx tsc --noEmit`

**Notes**: Added field-aware workflow-relative path diagnostics to `resolveWorkflowRelativePath` and updated load/save/revision callers to pass the relevant authored field name where diagnostics are user-visible. Extracted shared callee entry resolution by workflow id into sync and async helper functions in `src/workflow/validate/output-contracts-and-callees.ts`, then rewired cross-workflow semantic validation to use those helpers while preserving existing issue text. Added focused regression coverage for `stepFile` path diagnostics and sync/async callee manager inference through authored `stepFile` definitions.

### Session: 2026-05-16 REF-006 implementation pass

**Tasks Completed**: REF-006.

**Tasks In Progress**: REF-003 remains recorded as in progress from the prior accepted pass because broad typecheck is still blocked by missing adapter test SDK modules.

**Blockers**: `bunx tsc --noEmit` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/workflow/save.test.ts src/workflow/authored-workflow.test.ts`
- PASS: `bun run lint:biome`
- PASS: `git diff --check`
- BLOCKED: `bunx tsc --noEmit`

**Notes**: Added `src/workflow/save-plan.ts` as the pure save planning boundary for authored workflow normalization, validation inputs, persistence decisions, stale cleanup lists, revision-file inputs, and expected-revision conflict checks. Rewired `src/workflow/save.ts` to keep filesystem work in the executor path for reading existing files, hydrating prompt template content, validating, writing workflow/step/node files, removing stale files, and recomputing the final revision. Added pure planner assertions in `src/workflow/save.test.ts` for persistence/stale cleanup decisions, missing-payload validation, and revision conflict behavior while preserving the existing save round-trip coverage. `src/workflow/save.ts` was reduced from 1000 lines to 514 lines; the new planner module is 618 lines.

### Session: 2026-05-16 REF-007 implementation pass

**Tasks Completed**: REF-007.

**Tasks In Progress**: REF-003 remains recorded as in progress from the prior accepted pass because broad typecheck is still blocked by missing adapter test SDK modules.

**Blockers**: `bun run typecheck` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/workflow/session-store.test.ts src/workflow/session-history.test.ts src/workflow/runtime-db.test.ts src/workflow/manager-session-store.test.ts`
- PASS: `bun run lint:biome`
- PASS: `git diff --check`
- BLOCKED: `bun run typecheck`

**Notes**: Added a `SessionSnapshotIndexer` composition boundary with a default runtime DB implementation, then rewired `saveSession` to depend on the injected/default indexer while preserving best-effort indexing behavior and existing save/load call signatures. Centralized manager session SQLite access through the shared runtime DB connection helper by adding a schema-extension hook to `withRuntimeDatabase`, and moved manager table creation/migration into that extension path without changing the manager store API. Added focused tests for injected indexing, swallowed indexing failures, and shared runtime database schema extension for manager tables.

### Session: 2026-05-16 REF-008 implementation pass

**Tasks Completed**: REF-008.

**Tasks In Progress**: REF-003 remains recorded as in progress from the prior accepted pass because broad typecheck is still blocked by missing adapter test SDK modules.

**Blockers**: `bun run typecheck` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/workflow/communication-service.test.ts src/workflow/manager-message-service.test.ts src/workflow/manager-session-store.test.ts src/workflow/auto-improve-policy.test.ts src/workflow/superviser-control.test.ts src/workflow/superviser-runtime-control-impl.test.ts`
- PASS: `bun run lint:biome`
- PASS: `git diff --check`
- BLOCKED: `bun run typecheck`

**Notes**: Reused the manager-message idempotent mutation helper from communication-service so replay/retry and manager-message mutations share canonical request hashing, stored response reuse, conflict errors, and manager-session scoping behavior. Moved raw auto-improve policy input parsing into `src/workflow/auto-improve-policy.ts`, leaving superviser control to authorize arguments and then call the shared parser/normalizer path. Added direct parser regression coverage while preserving existing validation messages and nested superviser behavior.

### Session: 2026-05-16 REF-009 implementation pass

**Tasks Completed**: REF-009.

**Tasks In Progress**: REF-003 remains recorded as in progress from the prior accepted pass because broad typecheck is still blocked by missing adapter test SDK modules.

**Blockers**: `bun run typecheck` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/workflow/adapter.test.ts src/workflow/native-node-executor-gateway.test.ts src/workflow/addon-package-boundary.test.ts src/workflow/native-node-executor-addons-commands.test.ts`
- PASS: `bun run lint:biome`
- PASS: `git diff --check`
- BLOCKED: `bun run typecheck`

**Notes**: Reused the boundary add-on package loader from package-native adapter execution and changed package-native execution to race package loading plus execution against an explicit rejecting timeout promise, matching adapter timeout classification. Extracted shared third-party add-on definition selection in `src/workflow/node-addons/addon-constants-and-agent-config.ts` and reused it from both internal and package-boundary registries while preserving version and async-resolver diagnostics. Consolidated x-gateway and mail-gateway native execution into a typed gateway helper for env binding, runner resolution, command assembly, log attachment, JSON parsing, and output wrapping while preserving the distinct x-gateway `graphql query <document> --json` and mail-gateway `graphql --query <document>` argument shapes. Added a package-native timeout regression in `src/workflow/adapter.test.ts`.

### Session: 2026-05-16 REF-009 self-review revision pass

**Tasks Completed**: REF-009.

**Tasks In Progress**: REF-003 remains recorded as in progress from the prior accepted pass because broad typecheck is still blocked by missing adapter test SDK modules.

**Blockers**: `bun run typecheck` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/workflow/adapter.test.ts`
- PASS: `bun test src/workflow/adapter.test.ts src/workflow/native-node-executor-gateway.test.ts src/workflow/addon-package-boundary.test.ts src/workflow/native-node-executor-addons-commands.test.ts`
- PASS: `bun run lint:biome`
- PASS: `git diff --check`
- BLOCKED: `bun run typecheck`

**Notes**: Addressed self-review finding `SELF-REF009-H01` by checking the package-native abort signal immediately after the add-on package executor loads and before invoking native execution, preventing late command/container/add-on side effects after timeout has already won. Added a deterministic regression in `src/workflow/adapter.test.ts` that delays package executor loading, asserts timeout classification, waits for the delayed loader continuation, and verifies the native executor was never called.

### Session: 2026-05-16 REF-010 implementation pass

**Tasks Completed**: None.

**Tasks In Progress**: REF-010.

**Blockers**: `bun run typecheck` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`. `bun test src/cli.test.ts -t "inspect reports step-derived cross-workflow calls in json and text output"` times out after 5000 ms with one dangling process and does not appear related to the CLI/lib import boundary changed in this pass.

**Verification**:
- PASS: `rg "from \"../lib\"|from '../lib'|from \"\\.\\./lib\"|from '\\.\\./lib'" src/cli -n` returned no matches
- PASS: `bun test src/cli.test.ts -t "local session continue forwards continuation engine options|local session step-runs lists merged timeline with import markers"`
- PASS: `bun test src/lib-api.test.ts src/lib-supervision.test.ts`
- PASS: `bun run build:server`
- PASS: `bun test src/package-boundaries.test.ts`
- PASS: `bun run src/main.ts workflow validate design-and-implement-review-loop-feature-plan --workflow-definition-dir .divedra/workflows`
- PASS: `bun run src/main.ts workflow validate impl-plan-completion-loop --workflow-definition-dir .divedra/workflows`
- PASS: `bun run src/main.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows`
- PASS: `bun run lint:biome`
- PASS: `git diff --check`
- BLOCKED: `bun run typecheck`
- BLOCKED: `bun test src/cli.test.ts -t "inspect reports step-derived cross-workflow calls in json and text output"`

**Notes**: Added `src/lib-continuation.ts` as a library-operation module for `continueWorkflowFromHistory`, re-exported the operation and input type from `src/lib.ts`, and changed `src/cli/session-command-handler.ts` to import `continueWorkflowFromHistory` and `listMergedWorkflowExecutionStepRuns` from internal operation modules instead of the public `../lib` barrel. Public library exports and package compatibility declarations were preserved by the package-boundary test after `bun run build:server`.

### Session: 2026-05-16 REF-010 library options builder pass

**Tasks Completed**: None.

**Tasks In Progress**: REF-010.

**Blockers**: `bun run typecheck` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/lib-api.test.ts -t "rerunWorkflow forwards only the authored step id|resumeWorkflow forwards autoImprove to runWorkflow|executeWorkflow forwards lifecycle-only supervision as raw input|executes a fixed workflow through the endpoint-backed library client"`
- PASS: `bun test src/lib-api.test.ts src/lib-supervision.test.ts src/package-boundaries.test.ts`
- PASS: `bun test src/cli.test.ts -t "local session continue forwards continuation engine options|local session step-runs lists merged timeline with import markers"`
- PASS: `bun run build:server`
- PASS: `bun run lint:biome`
- PASS: `git diff --check -- src/lib.ts src/lib-continuation.ts src/lib-workflow-run-options.ts impl-plans/active/refactoring-runtime-boundaries.md`
- BLOCKED: `bun run typecheck`

**Notes**: Added `src/lib-workflow-run-options.ts` as the typed internal builder for repeated public `runWorkflow` option shaping. Rewired `executeWorkflow`, `resumeWorkflow`, `rerunWorkflow`, and `continueWorkflowFromHistory` to use the builder while preserving each operation's existing forwarding surface, including execute-only workflow source options, default enabled auto-improve behavior, and optional resume/rerun/continue auto-improve forwarding.

### Session: 2026-05-16 REF-010 CLI GraphQL payload parsing pass

**Tasks Completed**: None.

**Tasks In Progress**: REF-010.

**Blockers**: `bun run typecheck` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/cli.test.ts -t "workflow run uses GraphQL transport when --endpoint is provided|session resume uses GraphQL transport when --endpoint is provided|session rerun uses GraphQL transport when --endpoint is provided"`
- PASS: `bun run lint:biome`
- PASS: `git diff --check -- src/cli/input-output-helpers.ts src/cli/session-command-handler.ts src/cli/workflow-command-handler.ts impl-plans/active/refactoring-runtime-boundaries.md`
- BLOCKED: `bun run typecheck`

**Notes**: Added `readRemoteWorkflowExecutionPayload` in `src/cli/input-output-helpers.ts` as the shared GraphQL execution payload parser for `workflow run`, `session resume`, and `session rerun` remote responses. Rewired `src/cli/workflow-command-handler.ts` and `src/cli/session-command-handler.ts` to use the helper while preserving current JSON/text output shapes and exit-code behavior. REF-010 remains in progress because package facade alignment, feature-plan prompt extraction, and local workflow scenario coverage criteria are still open.

### Session: 2026-05-16 REF-010 package facade contract pass

**Tasks Completed**: None.

**Tasks In Progress**: REF-010.

**Blockers**: `bun run typecheck:server` fails before completing because `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing` and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `bun test src/package-boundaries.test.ts -t "source package facades preserve their documented public contracts|core source facade stays within the core runtime contract"`
- PASS: `bun test src/package-boundaries.test.ts`
- PASS: `bun run build:server`
- PASS: `bun run lint:biome`
- PASS: `git diff --check -- packages/divedra-core/src/index.ts packages/divedra-addons/src/index.ts packages/divedra/src/index.ts src/package-boundaries.test.ts`
- PASS: `rg -n "[ \t]+$" impl-plans/active/refactoring-runtime-boundaries.md packages/divedra-core/src/index.ts packages/divedra-addons/src/index.ts packages/divedra/src/index.ts src/package-boundaries.test.ts` returned no matches
- BLOCKED: `bun run typecheck:server`

**Notes**: Documented source-level package facade contracts in the `divedra-core`, `divedra-addons`, and compatibility `divedra` source entrypoints. Removed the duplicated explicit add-on registry re-export from `packages/divedra-addons/src/index.ts` so the add-ons package mirrors the source `node-addons` surface once and adds only native add-on execution entrypoints. Added package-boundary regressions that compare compatibility package exports to `src/lib.ts`, compare add-ons exports to `src/workflow/node-addons.ts` plus native execution, and lock the core package to its documented runtime/supervision surface without CLI, server, GraphQL schema, or native add-on exports. REF-010 remains in progress because feature-plan prompt extraction and local workflow scenario coverage criteria are still open.

### Session: 2026-05-16 REF-010 feature-plan prompt extraction pass

**Tasks Completed**: None.

**Tasks In Progress**: REF-010.

**Blockers**: None for this bounded pass. Historical broad typecheck blockers from missing adapter test SDK modules remain unresolved outside this workflow-bundle-only change.

**Verification**:
- PASS: `bun run src/main.ts workflow validate design-and-implement-review-loop-feature-plan --workflow-definition-dir .divedra/workflows`
- PASS: `jq empty .divedra/workflows/design-and-implement-review-loop-feature-plan/workflow.json .divedra/workflows/design-and-implement-review-loop-feature-plan/nodes/*.json`
- PASS: `rg -n '"promptTemplate"' .divedra/workflows/design-and-implement-review-loop-feature-plan` returned no matches
- PASS: `git diff --check -- .divedra/workflows/design-and-implement-review-loop-feature-plan impl-plans/active/refactoring-runtime-boundaries.md`

**Notes**: Moved all embedded feature-plan node and prompt-variant prompt text into workflow-local Markdown files under `.divedra/workflows/design-and-implement-review-loop-feature-plan/prompts/`, then rewired the node payloads to use `promptTemplateFile` entries. Prompt text was copied exactly from the prior inline JSON strings. REF-010 remains in progress because minimal deterministic scenario/expected-result coverage for uncovered local workflow bundles is still open.

### Session: 2026-05-16 REF-010 self-review revision pass

**Tasks Completed**: None.

**Tasks In Progress**: REF-010.

**Blockers**: None for this bounded revision pass. Historical broad typecheck blockers from missing adapter test SDK modules remain unresolved outside this workflow-bundle-only change.

**Verification**:
- PASS: `node <<'NODE' ... NODE` exact comparison of prior inline `promptTemplate` strings from `HEAD` to current `promptTemplateFile` contents
- PASS: `bun run src/main.ts workflow validate design-and-implement-review-loop-feature-plan --workflow-definition-dir .divedra/workflows`
- PASS: `jq empty .divedra/workflows/design-and-implement-review-loop-feature-plan/workflow.json .divedra/workflows/design-and-implement-review-loop-feature-plan/nodes/*.json`
- PASS: `rg -n '"promptTemplate"' .divedra/workflows/design-and-implement-review-loop-feature-plan` returned no matches
- PASS: `git diff --check -- .divedra/workflows/design-and-implement-review-loop-feature-plan impl-plans/active/refactoring-runtime-boundaries.md`

**Notes**: Addressed self-review finding `SELF-REF010-M01` by removing the added trailing line feed from each extracted feature-plan prompt file. The extracted prompt files now compare byte-for-byte with the prior inline JSON `promptTemplate` strings while preserving the `promptTemplateFile` wiring. REF-010 remains in progress because minimal deterministic scenario/expected-result coverage for uncovered local workflow bundles is still open.

### Session: 2026-05-16 REF-010 workflow scenario coverage pass

**Tasks Completed**: REF-010.

**Tasks In Progress**: REF-003 remains recorded as in progress from the prior accepted pass because broad typecheck is still blocked by missing adapter test SDK modules.

**Blockers**: Historical broad typecheck blockers from missing adapter test SDK modules remain unresolved outside this workflow-bundle-only change.

**Verification**:
- PASS: `jq empty .divedra/workflows/refactoring-slice-review/mock-scenario.json .divedra/workflows/impl-plan-completion-loop/mock-scenario.json .divedra/workflows/design-and-implement-review-loop-feature-plan/mock-scenario.json`
- PASS: `bun run src/main.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows`
- PASS: `bun run src/main.ts workflow validate impl-plan-completion-loop --workflow-definition-dir .divedra/workflows`
- PASS: `bun run src/main.ts workflow validate design-and-implement-review-loop-feature-plan --workflow-definition-dir .divedra/workflows`
- PASS: `bun run src/main.ts workflow inspect refactoring-slice-review --workflow-definition-dir .divedra/workflows --output json`
- PASS: `bun run src/main.ts workflow inspect impl-plan-completion-loop --workflow-definition-dir .divedra/workflows --output json`
- PASS: `bun run src/main.ts workflow inspect design-and-implement-review-loop-feature-plan --workflow-definition-dir .divedra/workflows --output json`
- PASS: `bun run src/main.ts workflow run refactoring-slice-review --workflow-definition-dir .divedra/workflows --mock-scenario .divedra/workflows/refactoring-slice-review/mock-scenario.json --output json`
- PASS: `bun run src/main.ts workflow run impl-plan-completion-loop --workflow-definition-dir .divedra/workflows --mock-scenario .divedra/workflows/impl-plan-completion-loop/mock-scenario.json --output json`
- PASS: `bun run src/main.ts workflow run design-and-implement-review-loop-feature-plan --workflow-definition-dir .divedra/workflows --mock-scenario .divedra/workflows/design-and-implement-review-loop-feature-plan/mock-scenario.json --output json`
- PASS: `jq '.payload' /tmp/divedra-artifact-dev/workflow/refactoring-slice-review/executions/div-refactoring-slice-review-1778897892-68e7644a/nodes/slice-review/exec-000001/output.json`
- PASS: `jq '.payload' /tmp/divedra-artifact-dev/workflow/impl-plan-completion-loop/executions/div-impl-plan-completion-loop-1778897892-af27a467/nodes/workflow-output/exec-000004/output.json`
- PASS: `jq '.payload' /tmp/divedra-artifact-dev/workflow/design-and-implement-review-loop-feature-plan/executions/div-design-and-implement-review-loop-feature-plan-1778897892-6130808f/nodes/workflow-output/exec-000007/output.json`
- PASS: `bun run build:server`
- PASS: `git diff --check -- .divedra/workflows/refactoring-slice-review .divedra/workflows/impl-plan-completion-loop .divedra/workflows/design-and-implement-review-loop-feature-plan impl-plans/active/refactoring-runtime-boundaries.md`
- BLOCKED: `bun run typecheck:server`

**Notes**: Added minimal deterministic mock scenarios and expected-result documents for the previously uncovered local workflow bundles `refactoring-slice-review`, `impl-plan-completion-loop`, and `design-and-implement-review-loop-feature-plan`. The scenarios cover read-only slice review, completed-plan assessment/archive routing with command nodes mocked safely, and the accepted feature-local design/plan path. REF-010 is now complete; REF-003 is the only remaining incomplete task in this plan.

### Session: 2026-05-16 REF-010 status consistency revision pass

**Tasks Completed**: REF-010.

**Tasks In Progress**: REF-003 remains recorded as in progress from the prior accepted pass because broad typecheck is still blocked by missing adapter test SDK modules.

**Blockers**: Historical broad typecheck blockers from missing adapter test SDK modules remain unresolved outside this plan-status-only revision.

**Verification**:
- PASS: `rg -n -A 3 "### REF-010" impl-plans/active/refactoring-runtime-boundaries.md`
- PASS: `git diff --check -- impl-plans/active/refactoring-runtime-boundaries.md`

**Notes**: Addressed self-review finding `SELF-REF010-M02` by updating the REF-010 task-section status from `In Progress` to `Completed`, matching the task DAG, checked completion criteria, and prior scenario-coverage progress log.

### Session: 2026-05-16 REF-010 plan-state consistency revision pass

**Tasks Completed**: REF-010.

**Tasks In Progress**: REF-003 remains in progress because broad typecheck/typecheck:server verification is blocked by missing adapter test SDK modules.

**Blockers**: Historical broad verification blockers remain unresolved outside this plan-status-only revision: `src/workflow/adapters/claude.test.ts` cannot resolve `claude-code-agent/sdk/testing`, and `src/workflow/adapters/codex.test.ts` cannot resolve `codex-agent/sdk/testing`.

**Verification**:
- PASS: `rg -n "^### REF-003:|^\\*\\*Status\\*\\*:" impl-plans/active/refactoring-runtime-boundaries.md`
- PASS: `rg -n "^\\*\\*Status\\*\\*: In Progress|\\| REF-003 \\|" impl-plans/active/refactoring-runtime-boundaries.md`
- PASS: `rg -n "[ \t]+$" impl-plans/active/refactoring-runtime-boundaries.md` returned no matches
- PASS: `git diff --check -- impl-plans/active/refactoring-runtime-boundaries.md`

**Notes**: Addressed self-review finding `SELF-REF010-M03` by making REF-003's task-section status match the task DAG, plan header, routing state, and progress log. REF-010 remains complete and plan remaining stays true because REF-003 still requires unblocked broad verification before it can be completed.

### Session: 2026-05-16 dependency refresh and REF-003 completion

**Tasks Completed**: REF-003.

**Tasks In Progress**: None.

**Blockers**: None remaining for this plan. `codex-agent` was already pinned to the latest remote `main` commit `05f4e9d7f316f29e7cdf148ce3cbd970ab9fb1f7`; `cursor-cli-agent` was already pinned to the latest remote `main` commit `ba633b0081f8889c8727e324e5beb28e37966fe0`; `claude-code-agent` was updated to latest remote `main` commit `12f3af429c3230b5bc38136ef3420d7dd7c521d4`. `bun-types@1.1.37` was added explicitly because `tsconfig.json` names `bun-types` directly and the refreshed Bun install no longer exposed it through transitive hoisting.

**Verification**:
- PASS: `git ls-remote https://github.com/tacogips/codex-agent.git HEAD refs/heads/main`
- PASS: `git ls-remote https://github.com/tacogips/claude-code-agent.git HEAD refs/heads/main`
- PASS: `git ls-remote https://github.com/tacogips/cursor-cli-agent.git HEAD refs/heads/main`
- PASS: `bun install`
- PASS: `bun add --dev bun-types@1.1.37`
- PASS: `bun run typecheck:server`

**Notes**: Refreshing `claude-code-agent` restored its `./sdk/testing` export and the installed `codex-agent` package already exposes `./sdk/testing` at the latest remote pin. divedra continues to use dependency-owned adapter mocks from the agent package test SDK exports and does not define local replacement mocks for those packages. The broad TypeScript verification blocker that kept REF-003 in progress is cleared, so all accepted high and mid findings are now completed or represented by accepted low residual risks.
