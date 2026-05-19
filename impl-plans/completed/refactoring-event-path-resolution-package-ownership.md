# Event Path Resolution Package Ownership Refactoring Plan

**Status**: Completed
**Design Reference**: Workflow output from `refactoring-divide-and-conquer` step `step3-merge-review-plan`
**Created**: 2026-05-19
**Last Updated**: 2026-05-19

## Scope

Move event dotted-path lookup and event template rendering ownership from root `src/events/path-resolution.ts` into the package-owned `divedra-events` surface while preserving root compatibility wrappers and current event runtime behavior.

The first implementation task is intentionally bounded to the concrete event path/template API and its direct consumers. Root `src/events/path-resolution.ts` must remain as a compatibility wrapper until package exports, build outputs, declaration sync, focused event tests, package-boundary tests, and typecheck pass.

Excluded: deleting the root compatibility wrapper, moving LLM workflow/session-store runtime behavior into `divedra-events`, consolidating event rendering with `divedra-core` prompt rendering, changing public event mapping behavior, staging, committing, pushing, generated `dist`, `node_modules`, and any provisioning package.

## Accepted Findings

| Finding | Severity | Slice IDs | Summary | Task |
| --- | --- | --- | --- | --- |
| F-001 | Mid | `divedra-events-package-api`, `root-event-mapping-and-task-planning-consumers`, `root-supervisor-control-consumers` | Event dotted-path and template runtime functions are still implemented in root `src/events/path-resolution.ts`; `divedra-events` exposes contracts and runtime ports but not the path/template API needed by root consumers. | `REF-001` |
| F-002 | Mid | `package-boundary-and-build-wiring`, `divedra-events-package-api` | `divedra-events` package exports, root `build:server`, declaration sync, and package-boundary tests do not include a `path-resolution` subpath, so source imports could pass while built package consumers fail. | `REF-001` |
| F-003 | Mid | `root-supervisor-control-consumers` | Supervisor command-map and LLM resolver text extraction duplicate default `event.input.text` setup, but preserve different trim and array traversal behavior. | `REF-002` |
| F-004 | Mid | `package-boundary-and-build-wiring` | `packages/divedra/src/cli/scoped-command-handlers.ts` still imports event types through root `src/events/types`, keeping an avoidable package-to-root type dependency. | `REF-003` |

## Rejected Or Deferred Findings

| Finding | Decision | Reason |
| --- | --- | --- |
| R-001 core-render-full-consolidation | Rejected | Event rendering preserves exact non-string template references, event root allowlists, optional array traversal, text coercion, and empty-segment controls; `divedra-core` prompt rendering always returns strings from a flat variables object. |
| R-002 required-input-presence-helper | Deferred | Task-planning, validation, schedule-registration, and reply clarification paths have different missing-value semantics; a broad helper would risk behavior changes without a dedicated design. |
| R-003 generic-package-build-abstraction | Rejected | Existing package subpath build/declaration wiring is explicit; adding a generic build abstraction is outside this bounded event API migration. |
| R-004 provisioning-package | Rejected | No concrete provisioning source surface exists in the reviewed slices. |

## Duplicate Groups

| Group | Repeated Concept | Owner Paths | Counterpart Paths | Consolidation Target | Confidence |
| --- | --- | --- | --- | --- | --- |
| DUP-001 | Event-specific dotted-path lookup and `{{...}}` template rendering | `packages/divedra-events/src/path-resolution.ts`, `packages/divedra-events/src/index.ts`, `packages/divedra-events/package.json` | `src/events/path-resolution.ts`, `src/events/input-mapping.ts`, `src/events/supervisor-correlation.ts`, `src/events/supervisor-intent.ts`, `src/events/supervisor-llm-resolver.ts`, `src/events/task-planning.ts`, `packages/divedra-core/src/render.ts`, `packages/divedra-core/src/prompt-template-context.ts` | Package-owned `divedra-events/path-resolution` plus root compatibility wrapper | High |
| DUP-002 | Package subpath export, build, declaration, and boundary wiring | `package.json`, `packages/divedra-events/package.json`, `scripts/sync-package-declarations.ts`, `src/package-boundaries.test.ts` | `packages/divedra-core/package.json`, `packages/divedra-core/src/render.ts`, `scripts/sync-package-declarations.ts` | Follow existing explicit package subpath pattern for `divedra-events/path-resolution` | High |
| DUP-003 | Supervisor text resolution from binding/event/source with default `event.input.text` | `src/events/supervisor-intent.ts`, `src/events/supervisor-llm-resolver.ts` | `src/events/path-resolution.ts`, `packages/divedra-events/src/path-resolution.ts` | Narrow supervisor helper after package API migration, with caller options explicit | Medium |
| DUP-004 | Package-owned event type contracts with root compatibility wrapper | `packages/divedra-events/src/types.ts`, `packages/divedra/src/cli/scoped-command-handlers.ts`, `src/package-boundaries.test.ts` | `src/events/types.ts` | Import event type contracts from `divedra-events/types` or `divedra-events` in package consumers | High |

### DUP-001 Contract

**Behavior To Preserve**:
- Exact object-valued template references in event input mapping.
- `undefined` and `null` template interpolation as empty string.
- JSON stringification for inline object and array interpolation.
- Allowed roots per caller: `binding`, `event`, `source`, and `workflowInput`.
- Caller-specific `allowArrayTraversal`, `filterEmptySegments`, `trimExpression`, and `trimString` options.
- `resolveEventPathText` string, number, and boolean coercion only.
- `renderNamedTemplate` flat named replacement behavior for task-planning prompts.

**Known Differences Not To Collapse**:
- `divedra-core` prompt rendering always produces strings from flat variables.
- Event exact-reference rendering can return non-string values.
- Supervisor command-map text resolution allows array traversal while LLM resolver text extraction trims strings and currently does not enable array traversal.
- LLM resolver workflow execution, session-store reads, and artifact parsing remain root runtime behavior.

**Conflicts**:
- `packages/divedra-events` must not import root `src/shared/json`; use package-local guards or an approved package-owned utility.
- `src/events/path-resolution.ts` must not be deleted during the first migration.
- `package.json`, `scripts/sync-package-declarations.ts`, and `src/package-boundaries.test.ts` must be updated with the package subpath in the same task as the new export.

**Verification Commands**:
- `bun test src/events/input-mapping.test.ts src/events/supervisor-intent.test.ts src/events/supervisor-llm-intent.test.ts src/events/supervisor-llm-resolver-dispatch.test.ts`
- `bun test src/package-boundaries.test.ts`
- `bun run build:server`
- `bun run typecheck`
- `git diff --check`

## Task DAG

| Task | Status | Duplicate Groups | Depends On | Parallelizable |
| --- | --- | --- | --- | --- |
| REF-001 | Completed | DUP-001, DUP-002 | - | No |
| REF-002 | Completed | DUP-003 | REF-001 | No |
| REF-003 | Completed | DUP-004 | REF-001 | No |

### REF-001: Introduce Package-Owned Event Path Resolution and Migrate Direct Root Consumers

**Status**: Completed
**Owned Files/Directories**: `packages/divedra-events/src/path-resolution.ts`, `packages/divedra-events/src/index.ts`, `packages/divedra-events/package.json`, `package.json`, `scripts/sync-package-declarations.ts`, `src/events/path-resolution.ts`, `src/events/input-mapping.ts`, `src/events/supervisor-correlation.ts`, `src/events/supervisor-intent.ts`, `src/events/supervisor-llm-resolver.ts`, `src/events/task-planning.ts`, `src/package-boundaries.test.ts`
**Excluded Files**: `dist`, `packages/divedra-events/dist`, `packages/divedra-core/src/render.ts`, `packages/divedra-core/src/prompt-template-context.ts`, `src/workflow/**`, `node_modules`
**Depends On**: none
**Duplicate Group IDs**: `DUP-001`, `DUP-002`
**Repeated Concept**: Event-specific dotted-path lookup and `{{...}}` template rendering with package subpath build wiring.
**Counterpart Paths**: `src/events/path-resolution.ts`, `src/events/input-mapping.ts`, `src/events/supervisor-correlation.ts`, `src/events/supervisor-intent.ts`, `src/events/supervisor-llm-resolver.ts`, `src/events/task-planning.ts`, `packages/divedra-core/src/render.ts`
**Behavior To Preserve**: Exact references, null/undefined empty rendering, JSON stringification, allowed-root filtering, caller-specific traversal/filter/trim options, primitive text coercion, named templates.
**Known Differences Not To Collapse**: Do not reuse `divedra-core` renderer for event exact references; do not move LLM resolver workflow/session-store behavior into `divedra-events`.
**Consolidation Target**: `packages/divedra-events/src/path-resolution.ts` exported as `divedra-events/path-resolution` and from `divedra-events`, with `src/events/path-resolution.ts` reduced to a root compatibility re-export.
**Conflicts**:
- Root wrapper must remain until all compatibility tests pass.
- New package file must avoid root `src/shared/json` imports.
- Build and declaration sync must include `path-resolution` before package-boundary checks can pass.
**Completion Criteria**:
- [x] `divedra-events/path-resolution` owns and exports `readDottedPath`, `resolveEventPathReference`, `resolveEventPathText`, `renderEventStringTemplate`, `renderEventTemplateValue`, `renderNamedTemplate`, and related types.
- [x] `src/events/path-resolution.ts` is a compatibility wrapper over the package-owned API.
- [x] Direct root consumers import the package-owned API without changing resolver options.
- [x] `packages/divedra-events/package.json`, root `build:server`, declaration sync, and package-boundary expectations include the new subpath.
- [x] Focused event, package-boundary, build, typecheck, and whitespace verification pass.
**Verification Commands**:
- `bun test src/events/input-mapping.test.ts src/events/supervisor-intent.test.ts src/events/supervisor-llm-intent.test.ts src/events/supervisor-llm-resolver-dispatch.test.ts`
- `bun test src/package-boundaries.test.ts`
- `bun run build:server`
- `bun run typecheck`
- `git diff --check`
**Residual Risk**: Existing consumer tests may not cover every resolver edge case; add package-level path-resolution assertions if implementation changes more than ownership and import paths.

### REF-002: Deduplicate Supervisor Text Path Setup

**Status**: Completed
**Owned Files/Directories**: `src/events/supervisor-intent.ts`, `src/events/supervisor-llm-resolver.ts`, `src/events/supervisor-intent.test.ts`, `src/events/supervisor-llm-intent.test.ts`, `src/events/supervisor-llm-resolver-dispatch.test.ts`
**Excluded Files**: `packages/divedra-events/src/path-resolution.ts`, `src/events/input-mapping.ts`, `src/events/task-planning.ts`, `dist`, `node_modules`
**Depends On**: `REF-001`
**Duplicate Group IDs**: `DUP-003`
**Repeated Concept**: Supervisor control text resolution from binding/event/source with default `event.input.text`.
**Counterpart Paths**: `src/events/supervisor-intent.ts`, `src/events/supervisor-llm-resolver.ts`, `packages/divedra-events/src/path-resolution.ts`
**Behavior To Preserve**: Command-map default path, resolver variable input path, allowed roots, fallback behavior, command-map array traversal, and LLM resolver trimming semantics.
**Known Differences Not To Collapse**: Command-map text resolution does not trim strings and allows array traversal; LLM resolver text extraction trims strings and does not currently enable array traversal.
**Consolidation Target**: Narrow root supervisor helper with explicit options.
**Conflicts**:
- Do not merge deterministic command parsing with LLM artifact parsing.
- Do not change allowed action fallback or invalid-output behavior.
**Completion Criteria**:
- [x] Shared setup removes duplicate default root/path configuration while preserving caller-specific options.
- [x] Focused supervisor tests cover whitespace, default path fallback, custom input path, and array traversal expectations.
**Verification Commands**:
- `bun test src/events/supervisor-intent.test.ts src/events/supervisor-llm-intent.test.ts src/events/supervisor-llm-resolver-dispatch.test.ts`
- `bun run typecheck`
- `git diff --check`
**Residual Risk**: This helper stays root-owned because it is supervisor workflow behavior, not an event contract utility.

### REF-003: Shrink Root Event Type Compatibility Import

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src/cli/scoped-command-handlers.ts`, `src/package-boundaries.test.ts`
**Excluded Files**: `src/events/index.ts`, `src/events/manual-emit.ts`, `src/events/receipt-ops.ts`, `src/events/workflow-schedule-registry.ts`, `dist`, `node_modules`
**Depends On**: `REF-001`
**Duplicate Group IDs**: `DUP-004`
**Repeated Concept**: Package-owned event type contracts with root compatibility wrapper.
**Counterpart Paths**: `src/events/types.ts`, `packages/divedra-events/src/types.ts`, `packages/divedra/src/cli/scoped-command-handlers.ts`
**Behavior To Preserve**: `WorkflowScheduleStatus` remains type-only and resolves from the package-owned contract surface.
**Known Differences Not To Collapse**: Other runtime root event imports in `scoped-command-handlers.ts` remain intentionally allowed until their APIs migrate.
**Consolidation Target**: `divedra-events/types` or root `divedra-events` type export for package consumers.
**Conflicts**:
- Do not remove unrelated root event runtime compatibility allowlist entries in this task.
**Completion Criteria**:
- [x] CLI imports `WorkflowScheduleStatus` from package-owned `divedra-events` type surface.
- [x] `src/package-boundaries.test.ts` no longer allows `../../../../src/events/types` for `packages/divedra/src/cli/scoped-command-handlers.ts`.
- [x] Package-boundary and typecheck verification pass.
**Verification Commands**:
- `bun test src/package-boundaries.test.ts`
- `bun run typecheck`
- `git diff --check`
**Residual Risk**: This only removes the type-only root import; runtime root event imports remain as accepted compatibility debt.

## Verification Strategy

Run narrow tests for the touched event consumers first, then package-boundary checks, then build/declaration and typecheck:

```bash
bun test src/events/input-mapping.test.ts src/events/supervisor-intent.test.ts src/events/supervisor-llm-intent.test.ts src/events/supervisor-llm-resolver-dispatch.test.ts
bun test src/package-boundaries.test.ts
bun run build:server
bun run typecheck
git diff --check
```

## Exit Criteria

- [x] All high and mid accepted findings have completed tasks or documented residual-risk acceptance.
- [x] `src/events/path-resolution.ts` is no longer the implementation owner.
- [x] Direct root event consumers use the package-owned API.
- [x] Package exports, build output inputs, declaration sync, and package-boundary expectations include `divedra-events/path-resolution`.
- [x] Root compatibility wrappers remain only where explicitly tracked.
- [x] Accepted low residual risks are documented and do not block root `src` removal follow-up planning.

## Residual Risks

- Root `src/events/path-resolution.ts` remains as a compatibility wrapper until a later cleanup proves no consumers need the root path.
- Full event resolver edge coverage is currently inferred mostly from consumer tests; package-level resolver tests may be needed if implementation changes beyond relocation.
- `divedra-core` prompt rendering remains intentionally separate despite similar `{{...}}` syntax.
- Runtime root event imports in `packages/divedra/src/cli/scoped-command-handlers.ts` remain until those APIs move to package-owned surfaces.

## Progress Log

### Session: 2026-05-19 Step 3 Merge Review Plan

**Tasks Completed**: none
**Tasks Ready**: `REF-001`, `REF-002`, `REF-003`
**Notes**: Merged slice findings from `divedra-events-package-api`, `root-event-mapping-and-task-planning-consumers`, `root-supervisor-control-consumers`, and `package-boundary-and-build-wiring`. Deduplicated the package-owned path-resolution API and build/export wiring into `REF-001`; deferred broader semantic consolidations that would change event, scheduler, or core renderer behavior.

### Session: 2026-05-19 17:25 JST Step 4 Implement REF-001

**Tasks Completed**: none
**Tasks In Progress**: `REF-001`
**Blockers**: `bun test src/package-boundaries.test.ts` fails after `bun run build:server` because rebuilt `packages/divedra-core/dist/core-runtime.js` contains `divedra/x-gateway`, violating the existing unrelated core add-on ownership assertion.
**Notes**: Added package-owned `packages/divedra-events/src/path-resolution.ts`, exposed `divedra-events/path-resolution` from package manifest/index/build/declaration sync, reduced `src/events/path-resolution.ts` to a compatibility re-export, and migrated direct root event consumers to the package subpath. Focused event tests, `bun run build:server`, `bun run typecheck`, `bun run lint:biome`, and `git diff --check` passed. Initial package-boundary run before build failed only because new generated `dist/path-resolution.*` files were not yet present; rerun after build passed the new events subpath checks but hit the unrelated core build assertion.

### Session: 2026-05-19 17:33 JST Step 4 Implement REF-002

**Tasks Completed**: `REF-002`
**Verification**:
- `bun test src/events/supervisor-intent.test.ts src/events/supervisor-llm-intent.test.ts src/events/supervisor-llm-resolver-dispatch.test.ts` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.
- `bun run lint:biome` passed with existing noExplicitAny warnings in unrelated `src/workflow/engine/*` files.
**Notes**: Added the root-owned `resolveSupervisorEventText` helper in `src/events/supervisor-llm-resolver.ts` to centralize default `event.input.text`, roots, allowed roots, and empty-segment filtering. Updated command-map resolution to preserve no-trim behavior and explicit array traversal, while LLM resolver paths preserve trimming without array traversal. Added focused tests for whitespace preservation, default path fallback, custom input paths, and array traversal opt-in behavior.

### Session: 2026-05-19 17:44 JST Step 4 Implement REF-003

**Tasks Completed**: `REF-003` implementation attempted by workflow; verification blocker resolved in follow-up boundary fix.
**Tasks Blocked**: none
**Verification**:
- `bun test src/package-boundaries.test.ts` failed on the existing built-core ownership assertion because `packages/divedra-core/dist/core-runtime.js` contains `divedra/x-gateway`; the package root import allowance change itself did not introduce a new root `src/events/types` violation.
- `bun run typecheck` passed.
- `git diff --check` passed.
- `bun run lint:biome` passed with existing noExplicitAny warnings in unrelated `src/workflow/engine/*` files.
**Blockers**: none remaining after the follow-up runtime-readiness boundary fix.
**Notes**: Moved the `WorkflowScheduleStatus` type-only CLI import from the root `src/events/types` compatibility wrapper to the package-owned `divedra-events` surface. Removed the matching root import allowance for `packages/divedra/src/cli/scoped-command-handlers.ts` while leaving the task-authorized runtime root event imports unchanged.

### Session: 2026-05-19 17:49 JST Boundary Verification Fix

**Tasks Completed**: `REF-001`, `REF-003`

**Verification**:
- `bun run build:server` passed.
- `bun test src/package-boundaries.test.ts` passed.
- `bun test src/workflow/runtime-readiness-backends.test.ts src/workflow/runtime-readiness-cross-workflow.test.ts` passed.
- `bun test src/events/input-mapping.test.ts src/events/supervisor-intent.test.ts src/events/supervisor-llm-intent.test.ts src/events/supervisor-llm-resolver-dispatch.test.ts` passed.
- `bun run typecheck` passed.
- `bun run lint:biome` exited 0 with pre-existing noExplicitAny warnings in unrelated `src/workflow/engine/*` files.
- `git diff --check` passed.

**Notes**: Removed the direct root runtime-readiness import from the add-ons package implementation so rebuilt `packages/divedra-core/dist/core-runtime.js` no longer inlines add-on implementation ownership strings. The root runtime readiness predicate remains local to root workflow runtime behavior; `packages/divedra-events/src/path-resolution.ts` is now the implementation owner for event path and template resolution, and `src/events/path-resolution.ts` is only a compatibility re-export.
