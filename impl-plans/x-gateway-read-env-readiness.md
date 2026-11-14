# X Gateway Read Env Readiness Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#built-in-rielflowx-gateway-read`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

## Design Summary

Runtime readiness must represent all prerequisites that can make a workflow fail
before useful node execution begins. `rielflow/x-gateway-read` already validates
and resolves explicit `addon.env` mappings, but readiness previously reported
only the Docker-compatible container runner. This plan adds readiness coverage
for required mapped source environment variables.

Scope:

- Required non-empty `addon.env` source variables for `rielflow/x-gateway-read`.
- Optional bindings with `required: false` remain non-blocking.
- Readiness output must not expose environment variable values.

Out of scope:

- Environment readiness for add-ons that do not support `addon.env`.
- Secret validation beyond presence/non-empty checks.
- Container image probing.

## Modules

### 1. Runtime Requirement Type

#### `src/workflow/runtime-readiness.ts`

**Status**: Completed

```typescript
interface WorkflowRuntimeRequirement {
  readonly kind:
    | "agent-backend"
    | "container-runner"
    | "environment-variable"
    | "node-executor"
    | "workflow-feature";
}
```

**Checklist**:

- [x] Add an environment-variable requirement kind.
- [x] Keep existing agent, runner, executor, and workflow feature readiness.

### 2. Add-on Env Collection

#### `src/workflow/runtime-readiness.ts`

**Status**: Completed

```typescript
interface AddonEnvRequirementCandidate {
  readonly envName: string;
  readonly addonEnvNames: readonly string[];
  readonly sourceNodeIds: readonly string[];
}
```

**Checklist**:

- [x] Collect required x-gateway add-on env source names.
- [x] Skip bindings with `required: false`.
- [x] Group duplicate source names across nodes without leaking values.

### 3. Tests and Documentation

#### `src/workflow/runtime-readiness.test.ts`

#### `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

#### `design-docs/specs/design-workflow-json.md`

**Status**: Completed

**Checklist**:

- [x] Add test coverage for missing required add-on env sources.
- [x] Verify optional bindings do not produce blockers.
- [x] Document readiness behavior for required `addon.env` sources.

## Module Status

| Module                | File Path                                      | Status    | Tests     |
| --------------------- | ---------------------------------------------- | --------- | --------- |
| Requirement type      | `src/workflow/runtime-readiness.ts`            | Completed | Typecheck |
| Add-on env collection | `src/workflow/runtime-readiness.ts`            | Completed | Targeted  |
| Tests and docs        | `src/workflow/runtime-readiness.test.ts`, docs | Completed | Vitest    |

## Dependencies

| Feature              | Depends On             | Status    |
| -------------------- | ---------------------- | --------- |
| Add-on env readiness | `x-gateway-read-addon` | Available |

## Completion Criteria

- [x] Runtime readiness reports missing or empty required x-gateway add-on env
      sources.
- [x] Runtime readiness ignores optional x-gateway add-on env sources.
- [x] Requirement details reveal names but never values.
- [x] Targeted tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20

**Tasks Completed**: TASK-001 through TASK-003.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added environment-variable readiness requirements for required
`rielflow/x-gateway-read` add-on env sources, plus targeted coverage and design
updates.

### Session: 2026-04-20 21:30

**Tasks Completed**: Review follow-up for empty required environment sources.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Aligned native execution with readiness so empty required mapped
environment variables fail before container execution; optional empty mappings
remain skipped.
