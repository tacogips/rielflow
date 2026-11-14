# Inherited Cross-Workflow Callee Validation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md`, `design-docs/specs/command.md#workflow-validate-name`, `design-docs/specs/design-workflow-json.md#extends`
**Created**: 2026-06-05
**Last Updated**: 2026-06-05

## Design Reference

Implement the accepted issue-resolution design for step-addressed
cross-workflow callee entry validation when the callee workflow is a derived
`extends` workflow.

The source of truth is the accepted Step 3 design review for:

- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/design-workflow-json.md`

In scope:

- Resolve `steps[].transitions[].toWorkflowId` callees through effective
  workflow loading before checking `managerStepId` or `entryStepId`.
- Keep direct `workflow validate` / `workflow inspect` and cross-workflow
  callee entry checks aligned for inherited workflows.
- Preserve deterministic validation and avoid recursive callee validation loops.
- Preserve sync and async validation semantics by making sync validation use an
  explicit effective-callee resolver or deterministic preloaded entry data
  instead of raw extends-only workflow JSON.
- Verify inherited workflow-local file references, especially `nodeFile`, are
  not string-replaced into missing derived files unless those files exist or the
  inherited base file provenance remains available for lookup.
- Add regression coverage for the referenced Claude Code package family and
  task-watchdog node file replacement boundary.
- Record documentation impact during implementation. The accepted design docs
  are already updated; implementation should only edit additional user-facing
  docs if CLI diagnostics, command text, or workflow authoring guidance changes.

Out of scope:

- New provider-specific behavior for `codex-agent`, `claude-code-agent`, or
  `cursor-cli-agent`.
- Arbitrary workflow inheritance overlay semantics beyond the accepted
  `extends` design.
- Package digest refreshes unless workflow, prompt, script, skill, or package
  metadata artifacts are edited.

## Issue Reference

- Workflow mode: `issue-resolution`
- Issue source: `runtimeVariables.workflowInput`
- Issue title: `Workflow inheritance is not applied when resolving cross-workflow callees during validation`
- Reference repository root: `../rielflow-packages`
- Reproduction command: `cd ../rielflow-packages && task check`

## Codex Agent References

- `../rielflow-packages Taskfile task check`
- `packages/rielflow/src/workflow/validate/output-contracts-and-callees.ts`
- `packages/rielflow/src/workflow/validate/semantic-validation-and-addons.ts`
- `packages/rielflow/src/workflow/load.ts`
- `packages/rielflow/src/workflow/load-inheritance.ts`

## Modules

### 1. Effective Callee Entry Resolver Boundary

#### `packages/rielflow/src/workflow/validate/validation-types-and-runtime-options.ts`
#### `packages/rielflow/src/workflow/validate/output-contracts-and-callees.ts`
#### `packages/rielflow/src/workflow/validate/semantic-validation-and-addons.ts`

**Status**: COMPLETED

```typescript
interface WorkflowCalleeEntryRequest {
  readonly workflowRoot: string;
  readonly workflowId: string;
}

interface WorkflowCalleeEntryResolution {
  readonly workflowId: string;
  readonly entryStepId: string;
  readonly workflowDirectory: string;
  readonly source: "effective-loader" | "preloaded-sync";
}

type WorkflowCalleeEntryResolver = (
  input: WorkflowCalleeEntryRequest,
) => Promise<
  | { readonly ok: true; readonly value: WorkflowCalleeEntryResolution }
  | { readonly ok: false; readonly message: string }
>;
```

**Checklist**:

- [x] Add a validation option for effective async callee entry resolution.
- [x] Keep the option provider-neutral and independent of agent backend names.
- [x] Cache callee entry results per validation run by workflow id.
- [x] Preserve existing diagnostic paths for invalid `toWorkflowId` and
      mismatched `toStepId`.
- [x] Remove raw extends-only workflow JSON as authoritative evidence for
      `managerStepId` / `entryStepId` when an effective resolver is available.

### 2. Loader-Supplied Effective Callee Resolution

#### `packages/rielflow/src/workflow/load.ts`
#### `packages/rielflow/src/workflow/validate/bundle-validation-entrypoints.ts`

**Status**: COMPLETED

```typescript
interface EffectiveCalleeLoadContext {
  readonly workflowRoot: string;
  readonly cwd?: string;
  readonly inheritanceStack: readonly string[];
  readonly calleeEntryStack: readonly string[];
}

function createEffectiveCalleeEntryResolver(
  context: EffectiveCalleeLoadContext,
) : WorkflowCalleeEntryResolver;
```

**Checklist**:

- [x] Pass an effective resolver from disk workflow loading into detailed async
      validation.
- [x] Resolve callees with the same workflow-id discovery and inheritance path
      as direct inspect/validate.
- [x] Load callees with nested cross-workflow entry validation disabled or
      guarded so cyclic workflow calls do not recurse indefinitely.
- [x] Return `managerStepId` first, falling back to `entryStepId`, from the
      loaded effective bundle.
- [x] Keep validation deterministic for direct `--workflow-definition-dir`,
      project scope, user scope, and package install validation roots.

### 3. Sync Validation Parity And Fallback Rules

#### `packages/rielflow/src/workflow/validate/bundle-validation-entrypoints.ts`
#### `packages/rielflow/src/workflow/validate/semantic-validation-and-addons.ts`

**Status**: COMPLETED

```typescript
interface PreloadedWorkflowCalleeEntryMap {
  readonly entries: ReadonlyMap<string, WorkflowCalleeEntryResolution>;
}

interface WorkflowValidationOptions {
  readonly preloadedWorkflowCalleeEntries?: PreloadedWorkflowCalleeEntryMap;
  readonly skipCrossWorkflowCalleeEntryValidation?: boolean;
}
```

**Checklist**:

- [x] Make sync validation use explicit preloaded effective callee entries when
      callee entry alignment is requested.
- [x] Avoid treating raw extends-only workflow JSON as final in sync validation.
- [x] Keep async disk validation as the authoritative CLI path.
- [x] Add tests proving sync and async paths report the same entry target when
      supplied the same effective callee entry data.

### 4. Inherited Workflow-Local File Reference Provenance

#### `packages/rielflow/src/workflow/load-inheritance.ts`
#### `packages/rielflow/src/workflow/load.test.ts`

**Status**: COMPLETED

```typescript
interface InheritedWorkflowFileReference {
  readonly authoredPath: string;
  readonly lookupPath: string;
  readonly sourceWorkflowDirectory: string;
  readonly derivedWorkflowDirectory: string;
}
```

**Checklist**:

- [x] Add focused tests for inherited `nodeFile` string replacement where the
      derived package does not provide the replacement file.
- [x] Verify the loader either preserves the inherited base lookup path or
      materializes node payload lookup under the replacement path without disk
      mutation.
- [x] Preserve replacement behavior for workflow ids, backend labels, prompts,
      and authored strings that are not workflow-local file lookup provenance.
- [x] Keep current behavior scoped to inherited base lookup; derived override
      file support remains outside this minimal bug fix.

### 5. Regression Tests And Package-Level Verification

#### `packages/rielflow/src/workflow/validate.test.ts`
#### `packages/rielflow/src/workflow/load.test.ts`
#### `packages/rielflow/src/workflow/packages/packages.test.ts`
#### `../rielflow-packages`
#### `design-docs/specs/command.md`
#### `design-docs/specs/design-workflow-json.md`

**Status**: COMPLETED

```typescript
test(
  "validates cross-workflow transition to inherited callee entry",
  async () => void,
): Promise<void>;

test(
  "preserves inherited nodeFile lookup when string replacement would synthesize a missing file",
  async () => void,
): Promise<void>;
```

**Checklist**:

- [x] Add a local fixture where a caller targets an `extends` callee and
      `toStepId` equals the inherited effective `managerStepId`.
- [x] Preserve existing negative entry mismatch coverage; no new duplicate
      fixture needed for this loader-level bug.
- [x] Add package validation coverage that mirrors
      `claude-code-impl-plan-completion-loop` calling
      `claude-code-design-and-implement-review-loop`.
- [x] Review documentation impact and update accepted design or user-facing
      command guidance only if implementation changes CLI diagnostics or
      workflow authoring behavior beyond the accepted design.
- [x] Run the rielflow package tests and then `task check` in
      `../rielflow-packages`.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Effective callee resolver boundary | `packages/rielflow/src/workflow/validate/*` | COMPLETED | `validate.test.ts` |
| Loader-supplied effective resolver | `packages/rielflow/src/workflow/load.ts` | COMPLETED | `load.test.ts` |
| Sync parity fallback | `packages/rielflow/src/workflow/validate/bundle-validation-entrypoints.ts` | COMPLETED | `validate.test.ts` |
| Inherited file reference provenance | `packages/rielflow/src/workflow/load-inheritance.ts` | COMPLETED | `load.test.ts` |
| Package-level regression and documentation check | `packages/rielflow/src/workflow/load.test.ts`, `../rielflow-packages`, `design-docs/specs/command.md`, `design-docs/specs/design-workflow-json.md` | COMPLETED | `task check`, docs review |

## Task Breakdown

### TASK-001: Confirm Current Failing Resolution Path

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: Short progress-log note with exact failing function path and
chosen resolver boundary.
**Dependencies**: None.

**Completion Criteria**:

- [x] `resolveCalleeWorkflowEntryByIdAsync` / sync counterpart are confirmed as
      reading raw `workflow.json` instead of effective inherited bundles.
- [x] The plan records whether the final code will pass a resolver option or
      extract a shared loader-safe callee module.

### TASK-002: Implement Effective Async Callee Entry Loading

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:
`packages/rielflow/src/workflow/load.ts`,
`packages/rielflow/src/workflow/validate/semantic-validation-and-addons.ts`,
`packages/rielflow/src/workflow/validate/output-contracts-and-callees.ts`.
**Dependencies**: TASK-001.

**Completion Criteria**:

- [x] Async validation resolves inherited callees through effective workflow
      loading.
- [x] Direct validate/inspect and cross-workflow entry validation agree on
      `managerStepId=rielflow-manager` for derived Claude Code workflows.
- [x] Recursive cross-workflow callee checks are cached or explicitly skipped
      during callee entry lookup.

### TASK-003: Preserve Sync Validation Contract

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001 if TASK-002's option names are stable.
**Deliverables**:
`packages/rielflow/src/workflow/validate/bundle-validation-entrypoints.ts`,
`packages/rielflow/src/workflow/validate/validation-types-and-runtime-options.ts`.
**Dependencies**: TASK-001.

**Completion Criteria**:

- [x] Sync validation no longer reports raw extends-only workflows as missing
      `managerStepId` / `entryStepId` when effective entries are supplied.
- [x] Existing pure structural validation callers remain deterministic.

### TASK-004: Harden Inherited File Reference Lookup

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001; coordinate final tests with TASK-002.
**Deliverables**:
`packages/rielflow/src/workflow/load-inheritance.ts`,
`packages/rielflow/src/workflow/load.test.ts`.
**Dependencies**: TASK-001.

**Completion Criteria**:

- [x] Inherited `nodes/node-adhoc-codex.json` can remain the lookup source when
      string replacement would produce missing
      `nodes/node-adhoc-claude-code.json`.
- [x] Existing string replacement behavior remains available for workflow ids
      and backend labels.

### TASK-005: Add Regression Coverage And Verify

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:
`packages/rielflow/src/workflow/validate.test.ts`,
`packages/rielflow/src/workflow/load.test.ts`,
`packages/rielflow/src/workflow/packages/packages.test.ts`,
documentation impact note or targeted design-doc update if needed,
verification command output in progress log.
**Dependencies**: TASK-002, TASK-003, TASK-004.

**Completion Criteria**:

- [x] Focused rielflow tests fail before the implementation and pass after it.
- [x] Documentation impact is recorded; any required user-facing doc changes
      are made in the existing accepted design-doc paths.
- [x] `../rielflow-packages task check` passes after
      applying the current package diff referenced by the issue.

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| Effective async callee loading | TASK-001 | COMPLETED |
| Sync parity fallback | TASK-001 | COMPLETED |
| File reference provenance hardening | TASK-001 | COMPLETED |
| Package-level verification | TASK-002, TASK-003, TASK-004 | COMPLETED |

## Parallelizable Tasks

- TASK-003 and TASK-004 may proceed in parallel after TASK-001 because their
  write scopes are disjoint once the shared option names are agreed.
- TASK-002 and TASK-004 must coordinate before final verification because both
  affect inherited workflow load behavior observed by tests.

## Verification Plan

- `bun test packages/rielflow/src/workflow/validate.test.ts`
- `bun test packages/rielflow/src/workflow/load.test.ts`
- `bun test packages/rielflow/src/workflow/packages/packages.test.ts`
- `bun run typecheck`
- `git diff --check -- packages/rielflow/src/workflow/validate.test.ts packages/rielflow/src/workflow/load.test.ts packages/rielflow/src/workflow/packages/packages.test.ts packages/rielflow/src/workflow/load.ts packages/rielflow/src/workflow/load-inheritance.ts packages/rielflow/src/workflow/validate`
- `cd ../rielflow-packages && task check`

## Completion Criteria

- [x] Cross-workflow callee validation uses effective inherited workflow data.
- [x] Raw extends-only workflow JSON no longer causes false missing
      `managerStepId` / `entryStepId` errors.
- [x] Direct inspect/validate and cross-workflow entry validation agree on
      inherited callable entry steps.
- [x] Inherited workflow-local `nodeFile` lookup remains valid under string
      replacement.
- [x] All verification commands are run and recorded with pass/fail status.
- [x] Documentation impact is explicitly recorded, including "no additional
      docs needed" when the accepted design docs remain sufficient.
- [x] Progress log includes task status changes, commands run, failures, and
      follow-up decisions.

## Progress Log

- 2026-06-05: Plan created from accepted Step 3 design review. No Step 5
  feedback exists for this first Step 4 attempt.
- 2026-06-05: Step 4 self-review added explicit documentation impact work to
  TASK-005 and the completion criteria.
- 2026-06-05: Implemented loader-supplied effective callee entry resolution,
  guarded recursive callee checks with `skipCrossWorkflowCalleeEntryValidation`,
  and preserved inherited `nodeFile` lookup during string replacement.
- 2026-06-05: Added regression coverage in `load.test.ts`; verified
  `bun test packages/rielflow/src/workflow/load.test.ts packages/rielflow/src/workflow/validate.test.ts`,
  `bun run typecheck`, and `../rielflow-packages task check`
  all pass.

## Risks

- Importing the workflow loader directly into validation can create circular
  dependencies; prefer a resolver option or extracted loader-safe boundary.
- Full recursive callee loading can loop through cross-workflow call cycles
  unless nested callee checks are guarded.
- String replacement over the entire normalized bundle can obscure file lookup
  provenance; tests must cover both missing replacement files and legitimate
  derived replacement files.
- Package-level `task check` depends on the referenced rielflow-packages diff
  being present in `../rielflow-packages`.
