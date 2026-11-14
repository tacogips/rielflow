# Workflow Node Runtime Patches Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#workflow-node-runtime-patches`; `design-docs/specs/command.md#subcommands`; `design-docs/specs/design-workflow-node-executability-validation.md#node-and-add-on-validation-flow`; `design-docs/specs/design-workflow-json.md#executionbackend`
**Created**: 2026-05-17
**Last Updated**: 2026-05-17

---

## Design Document Reference

**Source**:

- `design-docs/specs/architecture.md:42`
- `design-docs/specs/command.md:24`
- `design-docs/specs/command.md:76`
- `design-docs/specs/command.md:161`
- `design-docs/specs/design-workflow-node-executability-validation.md:108`
- `design-docs/specs/design-workflow-node-executability-validation.md:150`
- `design-docs/specs/design-workflow-node-executability-validation.md:249`
- `design-docs/specs/design-workflow-json.md:572`

### Summary

Add invocation-scoped workflow node patch support so `workflow validate` and
`workflow run` can overlay selected node payload settings without writing
`workflow.json` or `nodes/node-*.json`. Patch input is supplied through one
CLI option, `--node-patch <value>`, where `<value>` may be inline JSON,
`@path/to/patch.json`, or an existing bare file path. Patches are keyed by
reusable workflow node id and allow only `executionBackend`, `model`, and
`effort`.

Validation, runtime readiness, and execution must consume the same patched
loaded workflow state. Codex-to-Cursor switching is permitted only when the
patched `executionBackend` and `model` pass the same validation used by
authored nodes. Unsupported effort remains a clear validation failure until a
backend exposes a concrete effort capability.

### Issue Reference

- Source workflow: `design-and-implement-review-loop`
- Workflow mode: `issue-resolution`
- Issue title: `Add workflow node patch support`
- Issue URL/repository/number: not provided

### Scope

**Included**:

- Shared node patch input model, parser, and applicator.
- `workflow validate --node-patch` for direct and scoped workflow loading.
- `workflow run --node-patch` for local and endpoint-backed GraphQL transport.
- Library and GraphQL input plumbing needed for parity with CLI execution.
- Validation errors for invalid JSON, unreadable files, non-object payloads,
  invalid node ids, non-object node values, disallowed fields, invalid backend
  values, empty models, and unsupported effort.
- Runtime/readiness execution using the accepted patched state.
- Focused tests and user-facing documentation updates.

**Excluded**:

- Separate `--node-patch-file`; file input uses `@file` and bare file path.
- A `vendor` patch key alias; `executionBackend` is canonical.
- Persistent workflow bundle mutation.
- Widening the patch surface beyond `executionBackend`, `model`, and `effort`.
- Adding Cursor effort support before the Cursor adapter exposes such a field.

### Codex Agent References

Step 2 inspected these Codex reference files:

- `/Users/taco/gits/tacogips/codex-agent/src/process/types.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/session-runner.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/model-availability.ts`

Reference use is behavioral only: preserve model/session dispatch shape and
model availability validation expectations. Do not copy Codex-specific process
options into the generic node patch schema. The accepted design explicitly
diverges by keeping `effort` capability-gated and by isolating Cursor behavior
behind divedra's Cursor adapter and readiness probe.

---

## Modules

### 1. Node Patch Types and Parser

#### `src/workflow/node-patches.ts`

**Status**: Completed

**Relevant signatures**:

```typescript
export interface WorkflowNodePatch {
  readonly executionBackend?: NodeExecutionBackend;
  readonly model?: string;
  readonly effort?: string;
}

export type WorkflowNodePatchMap = Readonly<Record<string, WorkflowNodePatch>>;

export interface ParseWorkflowNodePatchInput {
  readonly value: string;
  readonly invocationCwd: string;
  readonly optionName: "--node-patch" | "nodePatch";
}

export async function readWorkflowNodePatch(
  input: ParseWorkflowNodePatchInput,
): Promise<WorkflowNodePatchMap>;
```

**Deliverables**:

- Implement a shared parser using the same inline JSON, `@file`, and bare file
  path conventions as runtime variables.
- Reject non-object top-level payloads and non-object per-node values.
- Reject fields other than `executionBackend`, `model`, and `effort`.
- Normalize and validate `executionBackend` through existing backend helpers.
- Reject empty or non-string `model` and `effort` values.
- Include source, node id, field path, and accepted fields or values in errors.

**Checklist**:

- [x] Inline JSON object patch parsing works.
- [x] Explicit `@file` patch parsing works.
- [x] Bare existing file path patch parsing works.
- [x] Invalid JSON, arrays, scalars, and unreadable files fail clearly.
- [x] Disallowed fields fail before runtime execution.

### 2. Patch Application and Effective Loaded Workflow

#### `src/workflow/node-patches.ts`
#### `src/workflow/load.ts`
#### `src/workflow/types.ts`

**Status**: Completed

**Relevant signatures**:

```typescript
export interface ApplyWorkflowNodePatchInput {
  readonly bundle: NormalizedWorkflowBundle;
  readonly patch: WorkflowNodePatchMap;
  readonly sourceLabel: string;
}

export function applyWorkflowNodePatch(
  input: ApplyWorkflowNodePatchInput,
): Result<NormalizedWorkflowBundle, readonly ValidationIssue[]>;

export interface LoadOptions {
  readonly nodePatch?: WorkflowNodePatchMap;
}
```

**Deliverables**:

- Apply patches after workflow load and before structural validation, add-on
  resolution, executable preflight, runtime readiness, or execution.
- Clone/rebuild `NormalizedWorkflowBundle` node payload state instead of
  mutating shared loader output in place.
- Key lookup must use reusable node ids, not step ids.
- Unknown node ids become validation issues.
- Keep add-on and native node payload validation behavior unchanged except for
  seeing patched effective agent settings.

**Checklist**:

- [x] Patch application never writes authored workflow files.
- [x] Unknown node ids produce named validation issues.
- [x] Reused node ids affect every step referencing that node.
- [x] Validation issues point at `nodePatch.<nodeId>.<field>`.
- [x] Existing load behavior without a patch is unchanged.

### 3. Validation and Readiness Integration

#### `src/workflow/validate/node-payload-validation.ts`
#### `src/workflow/validate/node-executability-validation.ts`
#### `src/workflow/runtime-readiness.ts`
#### `src/workflow/runtime-readiness-backends.ts`

**Status**: Completed

**Relevant signatures**:

```typescript
export interface WorkflowValidationOptions {
  readonly executablePreflight?: boolean;
  readonly nodePatch?: WorkflowNodePatchMap;
}

export interface NodeValidationResult {
  readonly status: "valid" | "warning" | "invalid" | "skipped";
  readonly nodeId: string;
  readonly backend?: NodeExecutionBackend;
  readonly model?: string;
  readonly message: string;
}
```

**Deliverables**:

- Ensure passive validation and executable preflight both consume patched node
  payload values.
- Validate patched backend/model combinations with existing authored-node rules.
- Represent unsupported `effort` as an invalid node validation result unless a
  backend capability exists.
- Preserve current add-on `nodeValidationResults` aggregation.
- Confirm runtime readiness probes group and check patched backend/model values,
  including `codex-agent` to `cursor-cli-agent`.

**Checklist**:

- [x] `workflow validate --node-patch ...` reports patched-state validation.
- [x] `workflow validate --executable --node-patch ...` probes patched backend.
- [x] Unsupported effort fails clearly for Codex/Cursor until implemented.
- [x] Runtime readiness blockers reference patched backend/model values.
- [x] Add-on validation results remain present.

### 4. CLI Validate and Run Surfaces

#### `packages/divedra/src/cli/argument-parser.ts`
#### `packages/divedra/src/cli/input-output-helpers.ts`
#### `packages/divedra/src/cli/workflow-command-handler.ts`
#### `packages/divedra/src/cli/storage-and-options.ts`

**Status**: Completed

**Relevant signatures**:

```typescript
export interface ParsedCliOptions {
  readonly nodePatchPath?: string;
}

export async function readWorkflowNodePatchOption(
  value: string,
): Promise<WorkflowNodePatchMap>;
```

**Deliverables**:

- Add `--node-patch <value>` to argument parsing and help text.
- Parse `--node-patch` for `workflow validate` and `workflow run`.
- Fail before local execution or remote GraphQL dispatch if parsing fails.
- Pass parsed patches into local load/validation/run options.
- Preserve `--variables` behavior and error precedence expectations.

**Checklist**:

- [x] `workflow validate <name> --node-patch '{"worker":{"model":"..."}}'`
  reaches validation.
- [x] `workflow run <name> --node-patch @./patch.json` reaches execution.
- [x] CLI help documents inline JSON, `@file`, and bare file path forms.
- [x] Invalid patch input exits non-zero with a clear stderr message.
- [x] Existing variable parsing tests still pass.

### 5. GraphQL and Library Transport Parity

#### `packages/divedra-graphql/src/schema-contract.ts`
#### `src/graphql/types.ts`
#### `src/graphql/schema/llm-run-overrides.ts`
#### `src/graphql/schema/execution-resolvers.ts`
#### `packages/divedra/src/index.ts`
#### `packages/divedra/src/lib-workflow-run-options.ts`

**Status**: Completed

**Relevant signatures**:

```typescript
export interface ExecuteWorkflowInput {
  readonly workflowName: string;
  readonly nodePatch?: WorkflowNodePatchMap;
}

export interface ValidateWorkflowDefinitionInput {
  readonly workflowName: string;
  readonly bundle?: GraphqlWorkflowBundleInput;
  readonly executablePreflight?: boolean;
  readonly nodePatch?: WorkflowNodePatchMap;
}
```

**Deliverables**:

- Add `nodePatch` to GraphQL `ExecuteWorkflowInput` and
  `ValidateWorkflowDefinitionInput`.
- Forward remote CLI `workflow run --node-patch` through GraphQL transport.
- Apply the same patch in library `executeWorkflow` and validation helpers.
- Keep GraphQL bundle validation and named workflow validation consistent.
- Validate GraphQL-provided `nodePatch` using the same shape restrictions as CLI
  parsed patch data.

**Checklist**:

- [x] Endpoint-backed `workflow run --node-patch` sends `input.nodePatch`.
- [x] GraphQL `executeWorkflow` executes against patched state.
- [x] GraphQL `validateWorkflowDefinition` validates patched state.
- [x] Library execution accepts the same patch object.
- [x] Invalid GraphQL patch objects return validation errors, not crashes.

### 6. Tests and Documentation

#### `src/cli.test.ts`
#### `src/workflow/load.test.ts`
#### `src/workflow/validate.test.ts`
#### `src/workflow/runtime-readiness-backends.test.ts`
#### `src/workflow/adapters/dispatch.test.ts`
#### `src/graphql/schema.test.ts`
#### `README.md`
#### `design-docs/specs/command.md`

**Status**: Completed

**Deliverables**:

- Add focused unit tests for parser and patch application errors.
- Add CLI tests for validate/run inline, `@file`, bare file path, and remote
  GraphQL transport.
- Add validation/readiness tests proving patched backend/model values are used.
- Add no-write assertions around `workflow.json` and `nodes/node-*.json`.
- Add docs describing allowed fields, node-id keying, non-persistence, and
  Codex-to-Cursor switching constraints.

**Checklist**:

- [x] Tests cover invalid node ids, invalid JSON, non-object payloads, and
  disallowed fields.
- [x] Tests cover non-persistence of workflow bundle files.
- [x] Tests cover patched `cursor-cli-agent` readiness/dispatch path.
- [x] Documentation includes concrete `--node-patch` examples.
- [x] Plan progress log is updated after implementation.

---

## Task Breakdown

| Task | Scope | Deliverables | Dependencies | Parallelizable |
| ---- | ----- | ------------ | ------------ | -------------- |
| TASK-001 | Patch model, parser, and applicator | `src/workflow/node-patches.ts`, type exports | Accepted Step 3 design review | No |
| TASK-002 | Loader and validation integration | `src/workflow/load.ts`, validation modules, related types | TASK-001 | No |
| TASK-003 | Runtime readiness and execution use | runtime readiness modules, engine/call-step load paths as needed | TASK-002 | No |
| TASK-004 | CLI validate/run option support | CLI parser, helpers, command handler, help text | TASK-001, TASK-002 | No |
| TASK-005 | GraphQL and library parity | GraphQL schema/types/resolvers, library option builders | TASK-001, TASK-002 | No |
| TASK-006 | Tests and docs | focused tests, README/command docs, plan progress update | TASK-002, TASK-003, TASK-004, TASK-005 | No |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Patch parser | Existing runtime variable file/inline parsing conventions | READY |
| Patch applicator | Normalized workflow bundle and node registry ids | READY |
| Backend validation | Existing `NodeExecutionBackend`, backend normalization, and node validation | READY |
| Executable preflight | Existing node executability validation design and implementation path | READY |
| Runtime readiness | Existing backend readiness grouping/probe helpers | READY |
| Remote transport | Existing GraphQL `executeWorkflow` and `validateWorkflowDefinition` inputs | READY |

## Parallelizable Tasks

No tasks are marked parallelizable for initial implementation. The feature has
one shared patch model and must preserve identical effective workflow state
across load, validation, readiness, execution, CLI, GraphQL, and library
surfaces. Splitting before TASK-002 would risk divergent patch semantics. After
TASK-002 lands, TASK-004 and TASK-005 may be implemented by separate workers
only if both depend on the same exported `WorkflowNodePatchMap` parser and
applicator and avoid overlapping test files.

## Verification Plan

Run after implementation:

- `bun run typecheck`
- `bun run test -- src/workflow/load.test.ts src/workflow/validate.test.ts src/workflow/runtime-readiness-backends.test.ts src/workflow/adapters/dispatch.test.ts`
- `bun run test -- src/cli.test.ts src/graphql/schema.test.ts`
- `git diff --check`

Focused behavioral checks:

- `divedra workflow validate <name> --node-patch '{"worker":{"executionBackend":"cursor-cli-agent","model":"gpt-5.5"}}' --executable`
- `divedra workflow validate <name> --node-patch @./patch.json --output json`
- `divedra workflow run <name> --node-patch ./patch.json --mock-scenario ./scenario.json --output json`
- Endpoint-backed `workflow run --endpoint <url> --node-patch <value>` sends
  `ExecuteWorkflowInput.nodePatch`.
- Hash or read `workflow.json` and `nodes/node-*.json` before and after patched
  validation/run to confirm no authored file writes.

## Completion Criteria

- [x] `workflow validate` accepts `--node-patch` inline JSON, `@file`, and bare
  file path inputs.
- [x] `workflow run` accepts the same patch inputs locally and over GraphQL.
- [x] Patches are keyed by reusable node id and allow only `executionBackend`,
  `model`, and `effort`.
- [x] Invalid node ids, invalid JSON, non-object payloads, non-object node
  values, disallowed fields, invalid backend values, empty model values, and
  unsupported effort fail clearly.
- [x] Patch application does not modify workflow definition files.
- [x] Validation, executable preflight, runtime readiness, and execution consume
  the same patched loaded workflow state.
- [x] Codex-to-Cursor switching works when patched backend/model validation
  permits it.
- [x] Focused CLI, workflow, GraphQL, and readiness tests pass.
- [x] User-facing documentation is updated.
- [x] This implementation plan progress log records completed tasks, commands,
  skipped commands with reasons, blockers, and residual risks.

## Addressed Review Feedback

- Kept `--node-patch` as the only CLI option for inline JSON, `@file`, and bare
  patch file path inputs.
- Explicitly assigned endpoint-backed GraphQL run and validation transport work
  in TASK-005.
- Preserved the design requirement that patched state is non-persistent and that
  validation, readiness, and execution consume the same effective loaded
  workflow.
- Scoped Step 3's low GraphQL/library validation finding into TASK-005 and the
  verification plan.

## Risks

- In-place mutation of loaded bundles could leak patch state between validation
  and later unpatched runs.
- Remote GraphQL run support could silently diverge from local run if
  `nodePatch` is omitted from transport input.
- Effort validation needs a conservative capability gate to avoid accepting
  settings that no adapter can honor.
- Tests that rely on real Cursor/Codex availability must use mocks or bounded
  executable preflight expectations to avoid environment flakes.
- Node-id keyed behavior affects every step reusing that node, so docs and
  diagnostics must be explicit.

## Progress Log

### Session: 2026-05-17 09:26

**Tasks Completed**: Plan created from accepted Step 3 design review.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implementation not started in this step. Later implementation must
invoke the repository TypeScript coding flow and run check/test after TypeScript
modifications.

### Session: 2026-05-17 10:34

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Verification**:

- `bun run typecheck` passed.
- `bun run lint:biome` passed with pre-existing warnings in split engine modules
  (`src/workflow/engine/node-execution.ts`,
  `src/workflow/engine/node-output-attempts.ts`,
  `src/workflow/engine/run-setup.ts`, and
  `src/workflow/engine/session-entry.ts`).
- `bun test src/workflow/load.test.ts src/workflow/validate.test.ts src/workflow/runtime-readiness-backends.test.ts src/workflow/adapters/dispatch.test.ts src/cli.test.ts src/graphql/schema.test.ts src/package-boundaries.test.ts`
  passed.
- `git diff --check` passed.

**Notes**: Implemented invocation-scoped node patch parsing, non-persistent
patch application, loader/validation/readiness/runtime plumbing, CLI
`--node-patch`, GraphQL/library transport parity, focused tests, README
documentation, and plan progress updates. The implementation uses existing
`src/workflow/runtime-readiness.ts` and
`src/workflow/runtime-readiness-agent-probes.ts`; no new
`runtime-readiness-backends.ts` source module was needed.

### Session: 2026-05-17 10:30

**Tasks Completed**: Step 7 mid-severity revision for TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Verification**:

- `bun test src/graphql/schema.test.ts src/lib-api.test.ts` passed.
- `bun run typecheck` passed.
- `bun run lint:biome` passed with pre-existing `noExplicitAny` warnings in
  split engine modules.
- `bun test src/workflow/load.test.ts src/workflow/validate.test.ts src/workflow/runtime-readiness-backends.test.ts src/workflow/adapters/dispatch.test.ts src/cli.test.ts src/graphql/schema.test.ts src/lib-api.test.ts src/package-boundaries.test.ts`
  passed.
- `bun run build` passed.
- `git diff --check` passed.

**Notes**: Addressed Step 7 review feedback by passing `nodePatch` into the
GraphQL async `executeWorkflow` upfront load/validation path before returning
`accepted: true`. Invalid async patches now reject with the first validation
issue path/message before background dispatch, and GraphQL plus library-client
async tests cover invalid rejection and valid patch forwarding.

### Session: 2026-05-17 10:37

**Tasks Completed**: Step 7 mid-severity revision for prototype-like node patch
ids in TASK-001 and TASK-002.
**Tasks In Progress**: None.
**Blockers**: None.
**Verification**:

- `bun test src/workflow/load.test.ts` passed.
- `bun run typecheck` passed.
- `bun run lint:biome` passed with pre-existing `noExplicitAny` warnings in
  split engine modules.
- `bun test src/workflow/load.test.ts src/workflow/validate.test.ts src/workflow/runtime-readiness-backends.test.ts src/workflow/adapters/dispatch.test.ts src/cli.test.ts src/graphql/schema.test.ts src/lib-api.test.ts src/package-boundaries.test.ts`
  passed.
- `bun run build` passed.
- `git diff --check` passed.

**Notes**: Addressed Step 7 review feedback by storing normalized node patch
maps and patched payload maps in null-prototype records. Patch ids such as
`__proto__` are preserved as own keys, do not mutate object prototypes, and are
reported as `nodePatch.__proto__` unknown workflow node ids when not authored.
