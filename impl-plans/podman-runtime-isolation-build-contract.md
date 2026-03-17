# Container Runtime Contract Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-container-runtime-contract.md`
**Created**: 2026-03-16
**Last Updated**: 2026-03-17

## Scope

Implement the workflow authoring and validation slice for the container runtime
contract, including workflow-level runner defaults, node-level container
metadata, durability, legacy Podman metadata migration, and explicit runtime
rejection until a real container executor exists.

In scope:

- add typed `containerRuntime` defaults to workflow definitions
- add typed `container` and `durability` metadata to node payloads
- validate container image/build authoring rules and runner defaults
- preserve normalized metadata through workflow load/validation/save
- normalize legacy `runtimeIsolation` metadata into the newer container schema
- fail clearly if runtime execution targets a container node

Out of scope:

- command-node runtime execution
- container image build orchestration
- mailbox mount preparation inside containers

## Modules

### 1. Types and Validation

#### `src/workflow/types.ts`

**Status**: COMPLETED

```ts
export interface ContainerRuntimeDefaults {
  readonly runnerKind?: "podman" | "docker" | "nerdctl" | "apple-container";
  readonly runnerPath?: string;
}
```

**Checklist**:

- [x] Add `containerRuntime`, `container`, and `durability` types
- [x] Normalize legacy `runtimeIsolation` metadata into the container schema
- [x] Preserve additive compatibility for existing agent nodes

#### `src/workflow/validate.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Validate workflow-level container runner defaults
- [x] Validate container image/build exclusivity and workflow-relative paths
- [x] Preserve normalized container metadata in the validated node payload

### 2. Runtime Guard

#### `src/workflow/engine.ts`

#### `src/workflow/call-node.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Reject execution of container nodes with a deterministic error
- [x] Keep existing agent execution behavior unchanged

### 3. Regression Tests

#### `src/workflow/validate.test.ts`

#### `src/workflow/load.test.ts`

#### `src/workflow/engine.test.ts`

#### `src/workflow/call-node.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Accept valid container build metadata with `containerfilePath` or legacy `dockerfilePath`
- [x] Reject ambiguous or unsafe build/image configuration
- [x] Verify metadata survives workflow loading and save/reload
- [x] Verify execution fails clearly before a container executor exists

## Completion Criteria

- [x] Workflow defaults can declare container runner defaults
- [x] Node payloads can declare container image/build and durability metadata
- [x] Validation enforces exact container image/build rules
- [x] Runtime rejects unsupported container execution explicitly
- [x] Focused tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-03-16 21:40 JST

**Tasks Completed**: Types, validation, runtime guard, and focused regression tests
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Initial completion covered the smallest coherent Podman-only slice. The 2026-03-17 continuation broadened that implementation to the new container-oriented design: workflow defaults now carry container runner defaults, node payloads normalize legacy `runtimeIsolation` into `container`, save/load preserve the normalized schema, and runtime execution rejects `container` nodes explicitly until a dedicated container executor exists.
