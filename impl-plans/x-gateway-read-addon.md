# X Gateway Read Add-on Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#built-in-divedrax-gateway-read`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

## Design Summary

Add a built-in worker add-on, `divedra/x-gateway-read`, that runs the
read-only `x-gateway-reader graphql query` surface inside a Docker-compatible
container runner. The add-on must support explicit environment variable mapping
from divedra's runtime environment into the add-on container environment so
multiple add-on nodes can use different X API credentials without leaking the
whole host environment.

Scope:

- Built-in add-on only.
- Docker-compatible runners through existing container runtime defaults.
- Read-only GraphQL query execution.
- Explicit `addon.env` host-env-to-addon-env bindings.

Out of scope:

- Publishing or building an x-gateway container image.
- Direct local execution of x-gateway outside a container.
- Write/mutation support.

## Modules

### 1. Add-on Types and Validation

#### `src/workflow/types.ts`, `src/workflow/validate.ts`

**Status**: COMPLETED

```typescript
interface WorkflowNodeAddonEnvBinding {
  readonly fromEnv: string;
  readonly required?: boolean;
}

interface WorkflowNodeAddonRef {
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
}
```

**Checklist**:

- [x] Accept `addon.env` object mappings.
- [x] Support string shorthand for required source env names.
- [x] Reject invalid target/source env names.
- [x] Preserve normalized bindings in authored add-on refs.

### 2. Built-in Catalog Entry

#### `src/workflow/node-addons.ts`

**Status**: COMPLETED

```typescript
interface XGatewayReadAddonConfig {
  readonly queryTemplate: string;
  readonly image?: string;
  readonly runnerKind?: ContainerRunnerKind;
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}
```

**Checklist**:

- [x] Resolve `divedra/x-gateway-read` version `1`.
- [x] Validate add-on config.
- [x] Reject author-controlled command overrides.
- [x] Produce a native add-on payload with output contract.

### 3. Native Container Execution

#### `src/workflow/native-node-executor.ts`

**Status**: COMPLETED

```typescript
async function executeXGatewayReadAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedNodeAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput>;
```

**Checklist**:

- [x] Render `queryTemplate` with normal node template variables.
- [x] Resolve explicit add-on env bindings from the divedra runtime env.
- [x] Run `x-gateway-reader graphql query <query> --json` in a container.
- [x] Ensure the full `x-gateway` client binary is not author-selectable.
- [x] Parse JSON stdout into node output.
- [x] Preserve stdout/stderr process logs.
- [x] Include the add-on's Docker-compatible runner in runtime readiness
      checks.

### 4. Tests and Documentation

#### `src/workflow/*.test.ts`, `design-docs/specs/*.md`

**Status**: COMPLETED

**Checklist**:

- [x] Validation accepts x-gateway add-on and env mappings.
- [x] Validation rejects malformed env mappings.
- [x] Execution forwards only mapped env names to the add-on container.
- [x] Design docs describe `addon.env` and x-gateway read usage.
- [x] Runtime readiness reports unavailable or unsupported container runners for
      x-gateway read add-on nodes.
- [x] Typecheck and focused tests pass.

## Module Status

| Module           | File Path                                           | Status    | Tests    |
| ---------------- | --------------------------------------------------- | --------- | -------- |
| Add-on env types | `src/workflow/types.ts`, `src/workflow/validate.ts` | COMPLETED | Targeted |
| Catalog entry    | `src/workflow/node-addons.ts`                       | COMPLETED | Targeted |
| Native execution | `src/workflow/native-node-executor.ts`              | COMPLETED | Targeted |
| Docs/tests       | `design-docs/specs/*.md`, `src/workflow/*.test.ts`  | COMPLETED | Targeted |

## Dependencies

| Feature             | Depends On                        | Status    |
| ------------------- | --------------------------------- | --------- |
| Add-on env mapping  | Existing add-on catalog           | Available |
| X gateway execution | Existing container runner support | Available |

## Completion Criteria

- [x] `divedra/x-gateway-read` add-on validates and resolves.
- [x] Add-on env mappings pass only configured variables.
- [x] Missing required mapped env variables fail before container execution.
- [x] Focused workflow tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20

**Tasks Completed**: TASK-001 through TASK-004.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Inspected `x-gateway` and confirmed the read-only CLI surface is
`x-gateway-reader graphql query '<query>'`, with credentials/config loaded from
`X_GW_*` environment variables. Implemented `addon.env`, the `divedra/x-gateway-read` built-in add-on, native container execution, focused tests, and documentation. Verified with `bun test src/workflow/validate.test.ts src/workflow/native-node-executor.test.ts` and `bun run typecheck`.

### Session: 2026-04-20 21:05

**Tasks Completed**: Review follow-up for design/index consistency
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added the missing detailed design section for
`divedra/x-gateway-read` and clarified that `addon.env` is accepted only by
descriptors that consume explicit environment bindings.

### Session: 2026-04-20 19:40

**Tasks Completed**: Review follow-up for x-gateway runtime readiness
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Runtime readiness now treats `divedra/x-gateway-read` as a
Docker-compatible container runner requirement, including inherited
workflow-level container runtime defaults.
