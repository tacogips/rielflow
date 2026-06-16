# Workflow Definition Inheritance Loader Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-json.md#extends`
**Created**: 2026-06-05
**Last Updated**: 2026-06-05

## Design Reference

Implement the accepted issue-resolution design for `workflow.json` `extends`
support in the Rielflow workflow loader.

The source of truth is the accepted Step 3 design review for
`design-docs/specs/design-workflow-json.md`, especially:

- Conditional top-level field requirements around lines 142-159.
- Final validation rules for ordinary and resolved derived bundles around lines
  176-207.
- `extends` schema and minimal derived workflow shape around lines 217-255.
- Load-time inheritance behavior around lines 256-277.
- Boundaries excluding arbitrary overlays and backend-specific loader branches
  around lines 278-287.

In scope:

- Keep ordinary workflows on the existing authored load path when `extends` is
  absent.
- Load and validate the base workflow by `extends.workflowId`.
- Materialize derived workflows in memory only, with derived `workflowId` and
  optional `description` overriding inherited values.
- Apply `extends.stringReplacements` for same-family workflow references and
  agent/backend labels.
- Apply `extends.agentNodePatch` only to inherited file-backed agent nodes.
- Apply explicit `extends.nodePatch` using existing node patch validation.
- Apply caller-supplied `LoadOptions.nodePatch` after inherited bundle
  resolution.
- Validate the final resolved derived bundle and fail inheritance cycles.
- Add focused loader tests for the inheritance path and regression boundaries.

Out of scope:

- Arbitrary deep merge or partial overlay semantics for derived workflows.
- Backend-specific loader behavior for Cursor CLI, Claude Code, or Codex.
- Persistent rewrites to base or derived workflow directories.
- Unrelated changes outside the workflow inheritance loader, focused loader
  tests, and plan tracking files.

## Issue Reference

- Workflow mode: `issue-resolution`
- Issue source: `runtimeVariables.workflowInput`
- Issue title: `Review and improve workflow inheritance loader implementation`
- Target feature area:
  `packages/rielflow/src/workflow/load.ts workflow definition inheritance`
- Remote issue URL: not provided
- Remote repository/issue number: not provided

## Codex Agent References

- Current branch diff:
  `packages/rielflow/src/workflow/load.ts`
- Inheritance helper:
  `packages/rielflow/src/workflow/load-inheritance.ts`
- Current branch tests:
  `packages/rielflow/src/workflow/load.test.ts`
- Behavioral package reference:
  `<rielflow-packages-repo>/packages/cursor-cli-design-and-implement-review-loop/workflows/cursor-cli-design-and-implement-review-loop/workflow.json`
- Behavioral package reference:
  `<rielflow-packages-repo>/packages/claude-code-design-and-implement-review-loop/workflows/claude-code-design-and-implement-review-loop/workflow.json`

## Modules

### 1. Extends Schema Parsing And Resolution Guardrails

#### `packages/rielflow/src/workflow/load.ts`
#### `packages/rielflow/src/workflow/load-inheritance.ts`

**Status**: COMPLETED

```typescript
interface WorkflowExtendsSpec {
  readonly workflowId: string;
  readonly agentNodePatch?: WorkflowNodePatch;
  readonly nodePatch?: WorkflowNodePatchMap;
  readonly stringReplacements?: readonly (readonly [string, string])[];
}

function parseWorkflowExtendsSpec(
  workflow: unknown,
): Result<WorkflowExtendsSpec | undefined, LoadFailure>;

async function loadWorkflowFromDiskInternal(
  workflowName: string,
  options?: LoadOptions,
  inheritanceStack?: readonly string[],
): Promise<Result<LoadedWorkflow, LoadFailure>>;

async function loadWorkflowByIdFromDiskInternal(
  workflowId: string,
  options?: LoadOptions,
  inheritanceStack?: readonly string[],
): Promise<Result<LoadedWorkflow, LoadFailure>>;
```

**Checklist**:

- [x] Validate `extends` as an object with non-empty
      `extends.workflowId`.
- [x] Normalize `extends.agentNodePatch` and `extends.nodePatch` through the
      existing node patch allowlist.
- [x] Reject invalid `extends.stringReplacements` shapes and empty source
      strings.
- [x] Route only derived workflows through inheritance internals.
- [x] Detect inheritance cycles and return a validation failure with the chain.
- [x] Preserve public `loadWorkflowFromDisk` and `loadWorkflowByIdFromDisk`
      signatures.

### 2. In-Memory Derived Bundle Materialization

#### `packages/rielflow/src/workflow/load.ts`
#### `packages/rielflow/src/workflow/load-inheritance.ts`

**Status**: COMPLETED

```typescript
function applyStringReplacements(
  value: unknown,
  replacements?: readonly (readonly [string, string])[],
): unknown;

function agentNodePatchMapForBundle(
  bundle: NormalizedWorkflowBundle,
  patch?: WorkflowNodePatch,
): WorkflowNodePatchMap | undefined;

function mergeWorkflowNodePatches(
  left?: WorkflowNodePatchMap,
  right?: WorkflowNodePatchMap,
): WorkflowNodePatchMap | undefined;

async function loadInheritedWorkflowFromDisk(input: {
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly rawText: string;
  readonly workflow: Readonly<Record<string, unknown>>;
  readonly spec: WorkflowExtendsSpec;
  readonly options: LoadOptions;
  readonly inheritanceStack: readonly string[];
}): Promise<Result<LoadedWorkflow, LoadFailure>>;
```

**Checklist**:

- [x] Load the base workflow through workflow-id discovery without inheriting a
      root execution-copy bundle override.
- [x] Apply string replacements to the materialized base bundle in memory only.
- [x] Override the inherited `workflow.workflowId` and optional `description`
      from the derived `workflow.json`.
- [x] Apply `agentNodePatch` only to inherited file-backed agent payloads, not
      add-on-backed or non-agent nodes.
- [x] Apply explicit `extends.nodePatch` after `agentNodePatch` so named patches
      can override or complement convenience patches.
- [x] Apply caller `LoadOptions.nodePatch` after derived inheritance resolution.
- [x] Recompute artifact workflow root from the derived `workflowId`.
- [x] Validate the resolved derived bundle and return derived validation issues,
      not only base validation evidence.

### 3. Focused Loader Regression Tests

#### `packages/rielflow/src/workflow/load.test.ts`

**Status**: COMPLETED

```typescript
function writeWorkflowBundle(input: {
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly workflowId?: string;
  readonly extraWorkflowFields?: Readonly<Record<string, unknown>>;
}): void;

test(
  "loads a workflow that extends a base workflow and patches agent nodes",
  async () => void,
): Promise<void>;
```

**Checklist**:

- [x] Cover a sparse derived workflow that inherits base defaults, steps, nodes,
      node payloads, and prompt-derived data.
- [x] Cover agent backend/model patching on file-backed agent nodes.
- [x] Cover same-family workflow reference rewriting, including
      `transitions[].toWorkflowId` or another workflow-reference field.
- [x] Cover non-agent or add-on-backed nodes not receiving `agentNodePatch`.
- [x] Cover explicit `extends.nodePatch` precedence over `agentNodePatch`.
- [x] Cover `LoadOptions.nodePatch` precedence after inherited resolution.
- [x] Cover invalid `extends` validation failures and inheritance cycles.
- [x] Cover non-mutating disk behavior for both base and derived directories.
- [x] Keep existing ordinary workflow and node patch tests passing unchanged.

### 4. Verification And Handoff

#### `packages/rielflow/src/workflow/load.ts`
#### `packages/rielflow/src/workflow/load-inheritance.ts`
#### `packages/rielflow/src/workflow/load.test.ts`

**Status**: COMPLETED

```typescript
export async function loadWorkflowFromDisk(
  workflowName: string,
  options?: LoadOptions,
): Promise<Result<LoadedWorkflow, LoadFailure>>;

export async function loadWorkflowByIdFromDisk(
  workflowId: string,
  options?: LoadOptions,
): Promise<Result<LoadedWorkflow, LoadFailure>>;
```

**Checklist**:

- [x] Review the final diff for unrelated worktree changes before handoff.
- [x] Run `bun test packages/rielflow/src/workflow/load.test.ts`.
- [x] Run `bun run typecheck`.
- [x] Report verification commands and any failures exactly.

## Task Breakdown

### TASK-001: Audit Current Branch Against Accepted Design

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: Review notes in implementation handoff; no required code edits
**Dependencies**: None

**Description**:
Compare the current `load.ts` and `load.test.ts` branch diff against the
accepted design and the package reference workflows. Identify whether the
existing implementation already satisfies the design or needs focused changes.

**Completion Criteria**:

- [x] Confirm ordinary workflow behavior is unchanged.
- [x] Confirm derived workflow sparse shape aligns with conditional field rules.
- [x] Confirm patch precedence is explicit.
- [x] Confirm current tests cover all accepted residual risks or list gaps.

### TASK-002: Tighten Extends Parsing And Inheritance Control Flow

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/load.ts`,
`packages/rielflow/src/workflow/load-inheritance.ts`
**Dependencies**: TASK-001

**Description**:
Adjust `extends` parsing, workflow-id base discovery, inheritance stack handling,
and validation failure paths as needed after the audit.

**Completion Criteria**:

- [x] Invalid `extends` values fail as workflow validation errors.
- [x] `loadWorkflowByIdFromDisk` can resolve base workflows without using the
      derived execution-copy override.
- [x] Cycles fail deterministically.
- [x] Public loader APIs remain compatible.

### TASK-003: Complete Derived Transform And Patch Semantics

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/load.ts`,
`packages/rielflow/src/workflow/load-inheritance.ts`
**Dependencies**: TASK-002

**Description**:
Finalize in-memory string replacement, derived identity overrides,
agent-node-only convenience patching, explicit inherited node patches,
caller node patches, and final resolved bundle validation.

**Completion Criteria**:

- [x] Transformations do not mutate files on disk.
- [x] Add-on-backed and non-agent nodes are not patched by `agentNodePatch`.
- [x] `extends.nodePatch` can override convenience `agentNodePatch` values for
      named nodes.
- [x] `LoadOptions.nodePatch` applies after inherited resolution.
- [x] Validation reflects the final derived bundle.

### TASK-004: Expand Focused Loader Tests

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `packages/rielflow/src/workflow/load.test.ts`
**Dependencies**: None

**Description**:
Add focused tests from the accepted design and residual review risks. Coordinate
expected assertions with `TASK-002` and `TASK-003`, but keep the write scope in
the test file.

**Completion Criteria**:

- [x] Sparse inheritance happy path is covered.
- [x] Same-family workflow-reference rewriting is covered.
- [x] `agentNodePatch`, `extends.nodePatch`, and `LoadOptions.nodePatch`
      precedence is covered.
- [x] Invalid shapes and inheritance cycles are covered.
- [x] Existing node patch tests still pass.

### TASK-005: Run Verification And Prepare Implementation Handoff

**Status**: Completed
**Parallelizable**: No
**Deliverables**: Verification output in implementation step payload
**Dependencies**: TASK-002, TASK-003, TASK-004

**Description**:
Run the required focused test and repository typecheck, then summarize changed
files, decisions, and residual risk for review.

**Completion Criteria**:

- [x] `bun test packages/rielflow/src/workflow/load.test.ts` passes or failure
      details are reported.
- [x] `bun run typecheck` passes or failure details are reported.
- [x] Handoff explicitly lists touched files and ignored unrelated changes.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Extends schema parsing and resolution guardrails | `packages/rielflow/src/workflow/load.ts`, `packages/rielflow/src/workflow/load-inheritance.ts` | COMPLETED | `packages/rielflow/src/workflow/load.test.ts` |
| In-memory derived bundle materialization | `packages/rielflow/src/workflow/load-inheritance.ts` | COMPLETED | `packages/rielflow/src/workflow/load.test.ts` |
| Focused loader regression tests | `packages/rielflow/src/workflow/load.test.ts` | COMPLETED | `bun test packages/rielflow/src/workflow/load.test.ts` |
| Verification and handoff | `packages/rielflow/src/workflow/load.ts`, `packages/rielflow/src/workflow/load-inheritance.ts`, `packages/rielflow/src/workflow/load.test.ts` | COMPLETED | `bun run typecheck` |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| TASK-001 audit | None | COMPLETED |
| TASK-002 parsing/control flow | TASK-001 | COMPLETED |
| TASK-003 transform/patch semantics | TASK-002 | COMPLETED |
| TASK-004 regression tests | None | COMPLETED |
| TASK-005 verification/handoff | TASK-002, TASK-003, TASK-004 | COMPLETED |

## Parallelization

- `TASK-001` and `TASK-004` may proceed in parallel because `TASK-001` writes no
  code and `TASK-004` is limited to `packages/rielflow/src/workflow/load.test.ts`.
- `TASK-002` and `TASK-003` share the load orchestration and inheritance helper
  boundary and must be sequenced.
- `TASK-005` must wait for implementation and tests.

## Verification Plan

- `git diff -- design-docs/specs/design-workflow-json.md packages/rielflow/src/workflow/load.ts packages/rielflow/src/workflow/load-inheritance.ts packages/rielflow/src/workflow/load.test.ts`
- `bun test packages/rielflow/src/workflow/load.test.ts`
- `bun run typecheck`

## Completion Criteria

- [x] Loader supports sparse derived `workflow.json` files with
      `extends.workflowId`.
- [x] Derived workflow transforms are in-memory only.
- [x] Agent convenience patches only apply to inherited file-backed agent nodes.
- [x] Same-family workflow references are rewritten according to
      `stringReplacements`.
- [x] Existing ordinary workflow loading and node patch behavior remain intact.
- [x] Final resolved derived bundle validation is exercised.
- [x] Focused loader tests and typecheck pass.
- [x] Implementation handoff includes explicit verification commands and
      residual risks.

## Progress Log

### Session: 2026-06-05 18:33 JST

**Tasks Completed**: None
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Plan created after Step 3 accepted the workflow-json design update.

### Session: 2026-06-05 18:42 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Tasks In Progress**: None
**Blockers**: `bun run lint:biome` could not run because `biome` is not on PATH
in this shell.
**Notes**: Implemented derived workflow inheritance hardening in
`packages/rielflow/src/workflow/load.ts` and
`packages/rielflow/src/workflow/load-inheritance.ts`; added focused regression
coverage in `packages/rielflow/src/workflow/load.test.ts`; verified
`bun test packages/rielflow/src/workflow/load.test.ts` and
`bun run typecheck` pass.

### Session: 2026-06-05 18:52 JST

**Tasks Completed**: Self-review hardening for TASK-003 and TASK-004
**Tasks In Progress**: None
**Blockers**: `bun run lint:biome` still cannot run because `biome` is not on
PATH in this shell.
**Notes**: Fixed `extends.agentNodePatch` targeting so the convenience patch
only applies to node ids authored with `nodeFile` in the base workflow JSON;
added regression coverage for inline agent nodes remaining unpatched. Verified
`bun test packages/rielflow/src/workflow/load.test.ts` passes with 25 tests and
`bun run typecheck` passes.
