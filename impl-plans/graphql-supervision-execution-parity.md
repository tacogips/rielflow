# GraphQL Supervision Execution Parity Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/command.md`, `design-docs/specs/design-auto-improve-superviser-mode.md`
**Created**: 2026-04-26
**Last Updated**: 2026-04-26 (review follow-up: executable-schema typing aligned with shared GraphQL inputs; superviser-control parser coverage widened)

## Design Document Reference

**Source**:

- `design-docs/specs/command.md`
- `design-docs/specs/design-auto-improve-superviser-mode.md`

### Summary

The local CLI/engine path already supports supervised execution through
`--auto-improve` and optional phase-2 `--nested-superviser`, but the GraphQL
execution transport accepted those flags at the CLI and then silently dropped
them. That made remote execution diverge from the intended command and
supervision design.

This plan closes that gap by making GraphQL execution inputs carry the same
supervision policy contract for start/resume/rerun, while explicitly rejecting
`--nested-superviser` on step rerun where the engine model does not support it.

### Scope

**Included**:

- add GraphQL execution input fields for supervision policy
- normalize GraphQL `autoImprove` payloads before they reach `runWorkflow`
- forward supervision options through CLI `--endpoint` execution paths
- reject `--nested-superviser` on rerun at the CLI boundary
- add CLI, schema, and HTTP GraphQL regression coverage

**Excluded**:

- broader supervision-product redesign
- non-execution GraphQL surfaces
- phase-133 legacy-compatibility cleanup outside this parity fix

## Modules

### 1. GraphQL Execution Input Parity

#### `src/graphql/types.ts`, `src/server/graphql-executable-schema.ts`, `src/graphql/schema.ts`

**Status**: COMPLETED

```typescript
interface ExecuteWorkflowInput {
  readonly autoImprove?: AutoImprovePolicyInput;
  readonly nestedSuperviser?: boolean;
}

interface ResumeWorkflowExecutionInput {
  readonly autoImprove?: AutoImprovePolicyInput;
  readonly nestedSuperviser?: boolean;
}

interface RerunWorkflowExecutionInput {
  readonly autoImprove?: AutoImprovePolicyInput;
}
```

**Checklist**:

- [x] GraphQL schema accepts supervision policy input on execute/resume/rerun
- [x] Resolver normalizes `autoImprove` instead of trusting raw payloads
- [x] `nestedSuperviser` still requires supervised execution

### 2. CLI Remote Transport Alignment

#### `src/cli.ts`, `src/cli.test.ts`

**Status**: COMPLETED

```typescript
function buildRemoteExecutionInput(
  parsedOptions: ParsedOptions,
): Readonly<Record<string, unknown>>;
```

**Checklist**:

- [x] `workflow run --endpoint` forwards supervision options
- [x] `session resume --endpoint` forwards supervision options
- [x] `session rerun --endpoint` forwards `autoImprove`
- [x] `session rerun` rejects `--nested-superviser`

### 3. Verification

#### `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Direct schema mutation tests cover supervision forwarding
- [x] HTTP GraphQL tests prove the executable schema accepts the new fields
- [x] CLI tests cover the remote request payloads and rerun rejection

## Completion Criteria

- [x] Remote GraphQL execution no longer drops supervision flags
- [x] Nested supervision is accepted only on valid start/resume flows
- [x] Regression tests cover CLI, schema, and HTTP execution paths

## Progress Log

### Session: 2026-04-26

**Tasks Completed**: Implemented GraphQL execution parity for supervision options, added CLI rerun rejection for `--nested-superviser`, updated command/supervision design docs, and added regression coverage across CLI/schema/HTTP layers.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: This is a bounded follow-up to the supervision and GraphQL transport work. It fixes a real user-facing mismatch without expanding the phase-133 legacy-cleanup scope.

### Session: 2026-04-26 (review follow-up)

**Tasks Completed**: Removed stale inline GraphQL resolver arg shapes in `src/server/graphql-executable-schema.ts` in favor of shared schema input/query types so execute/resume supervision fields no longer depend on `as never` casts. Refactored `src/workflow/superviser-control.ts` to share target-session parsing across status/details/rerun control operations and added focused tests for previously uncovered details/load/save parser paths.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-checked the active command/supervision design during review. No design-document mismatch was found; the issue was implementation drift and test coverage, not architecture.

### Session: 2026-04-26 (review follow-up 2)

**Tasks Completed**: Replaced exception-style GraphQL supervision-input normalization in `src/graphql/schema.ts` with explicit `Result`-based validation helpers, aligned `GraphqlWorkflowBundleInput` typing with runtime validation, and added schema/HTTP regression tests for invalid `nestedSuperviser` and invalid `autoImprove` inputs so those paths fail before `runWorkflow` is invoked.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-checked the current command/supervision architecture again while reviewing this slice. The implementation still matches the intended design; the remaining issue was local code quality and uncovered invalid-input behavior, not a design mismatch requiring a new spec or plan.

### Session: 2026-04-26 (review follow-up 3)

**Tasks Completed**: Normalized whitespace-bearing control identifiers in `src/workflow/superviser-control.ts` so nested superviser auth/session/workflow ids and rerun step ids no longer fail after passing non-empty validation, trimmed GraphQL rerun `stepId` before dispatch/echo in `src/graphql/schema.ts`, and added focused regression coverage for both parser normalization and GraphQL rerun dispatch.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The branch architecture still aligns with the existing supervision/command design. This follow-up addressed a concrete parser/runtime edge case and missing tests rather than a design gap.
