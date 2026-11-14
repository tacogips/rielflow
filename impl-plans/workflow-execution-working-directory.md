# Workflow Execution Working Directory Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#execution-boundary`, `design-docs/specs/command.md#subcommands`
**Created**: 2026-04-12
**Last Updated**: 2026-04-12

## Summary

Add a run-scoped workflow execution working directory that defaults to the command invocation directory, allow execution-time overrides through CLI/library/GraphQL inputs, and allow each node to override the effective working directory with absolute or workflow-working-directory-relative paths.

Out of scope:

- redefining workflow/artifact/session root lookup
- persisting a workflow-level working directory in `workflow.json`
- changing container-internal `container.workingDirectory` semantics

## Modules

### 1. Working Directory Resolution

#### `src/workflow/working-directory.ts`

**Status**: Completed

```typescript
export function resolveWorkflowExecutionWorkingDirectory(input: {
  readonly cwd?: string;
  readonly workflowWorkingDirectory?: string;
}): string;

export function resolveNodeExecutionWorkingDirectory(
  workflowWorkingDirectory: string,
  nodeWorkingDirectory: string | undefined,
): string;
```

**Checklist**:

- [x] Add run-scoped working directory resolution helper
- [x] Add node-scoped working directory resolution helper
- [x] Unit tests cover default, relative, and absolute resolution

### 2. Runtime Contracts

#### `src/workflow/types.ts`

#### `src/workflow/adapter.ts`

#### `src/workflow/engine.ts`

#### `src/workflow/call-step-impl.ts`

#### `src/workflow/native-node-executor.ts`

**Status**: Completed

```typescript
export interface WorkflowRunOptions extends LoadOptions, SessionStoreOptions {
  readonly workflowWorkingDirectory?: string;
}

export interface NodePayload {
  readonly workingDirectory?: string;
}

export interface AdapterExecutionInput {
  readonly workingDirectory: string;
}
```

**Checklist**:

- [x] Add run-scoped `workflowWorkingDirectory` to execution options
- [x] Add node-level `workingDirectory` to normalized payloads
- [x] Thread resolved working directory into local agent adapters
- [x] Thread resolved working directory into native command execution
- [x] Confirm direct `call-step` execution follows the same rules

### 3. Validation and Public Surfaces

#### `src/workflow/validate.ts`

#### `src/cli.ts`

#### `src/lib.ts`

#### `src/graphql/types.ts`

#### `src/graphql/schema.ts`

#### `src/server/graphql-executable-schema.ts`

#### `src/server/api-request.ts`

#### `src/shared/ui-contract.ts`

**Status**: Completed

```typescript
interface ExecuteWorkflowInput {
  readonly workingDirectory?: string;
}
```

**Checklist**:

- [x] Allow node-level `workingDirectory` validation as a non-empty absolute-or-relative path
- [x] Preserve compatibility for `command.workingDirectory`
- [x] Normalize surrounding whitespace consistently across run-scoped and authored working-directory inputs
- [x] Add CLI `--working-dir` / `--working-directory`
- [x] Add library and GraphQL execution input fields
- [x] Verify rerun/resume behavior is intentional and documented

### 4. Regression Coverage

#### `src/workflow/working-directory.test.ts`

#### `src/workflow/native-node-executor.test.ts`

#### `src/workflow/validate.test.ts`

#### `src/workflow/adapters/*.test.ts`

#### `src/server/api-request.test.ts`

**Status**: Completed

**Checklist**:

- [x] Cover default workflow execution working directory from command invocation cwd
- [x] Cover relative workflow execution working directory override
- [x] Cover node-level relative override resolution from workflow working directory
- [x] Cover node-level absolute override resolution
- [x] Cover CLI/API request parsing for run-scoped working directory

## Dependencies

| Feature             | Depends On                            | Status    |
| ------------------- | ------------------------------------- | --------- |
| Runtime contracts   | Working directory resolution helpers  | COMPLETED |
| CLI/API surface     | Runtime contracts                     | COMPLETED |
| Regression coverage | Runtime contracts and CLI/API surface | COMPLETED |

## Completion Criteria

- [x] Workflow execution defaults to command invocation cwd when no override is provided
- [x] CLI/library/GraphQL execution requests can override the workflow working directory
- [x] Manager/agent nodes accept top-level `workingDirectory`
- [x] Command nodes resolve relative working directories from the workflow working directory
- [x] Validation and tests cover absolute and relative override paths
- [x] Targeted test suite and typecheck pass

## Progress Log

### Session: 2026-04-12

**Tasks Completed**: Initial design/spec alignment, runtime wiring, verification
**Notes**:

- Added a supporting design doc for workflow execution working-directory semantics.
- Implemented run-scoped and node-scoped working-directory resolution across engine, `call-step` implementation (`call-step-impl.ts`), adapters, native execution, CLI, library, and GraphQL surfaces.
- Added regression coverage for path resolution, native command execution cwd behavior, validation, adapter propagation, and API parsing.
- Verified with targeted `bun test` and `bun run typecheck`.

### Session: 2026-04-12 (follow-up review)

**Tasks Completed**: Contract parity fixes, normalization hardening, regression additions
**Notes**:

- Fixed the missing `workingDirectory` resume contract on the GraphQL schema and remote CLI resume path.
- Aligned local and remote execution entry points to trim and reject whitespace-only run-scoped working-directory overrides consistently.
- Added regression coverage for normalized remote client/CLI forwarding and GraphQL schema exposure of the resume input field.
- Re-verified with targeted `bun test` and `bun run typecheck`.

### Session: 2026-04-12 (review follow-up 2)

**Tasks Completed**: Authored-path normalization parity, validation cleanup, regression additions
**Notes**:

- Reused the shared working-directory normalizer for authored node `workingDirectory` and compatibility `command.workingDirectory` fields instead of validating them with a separate partial rule.
- Made node working-directory resolution trim surrounding whitespace and reject whitespace-only values consistently even for direct helper callers.
- Added regression coverage for trimmed node-level and legacy command working-directory values.
