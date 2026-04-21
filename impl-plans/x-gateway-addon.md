# X Gateway Add-on Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#built-in-divedrax-gateway`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

## Design Summary

Add a separate built-in worker add-on, `divedra/x-gateway`, that runs the full
`x-gateway graphql query` surface inside a Docker-compatible container runner.
Unlike `divedra/x-gateway-read`, this add-on intentionally supports mutation
documents for workflows that need to post to X. It still uses explicit
`addon.env` host-env-to-addon-env bindings so multiple add-on nodes can run with
different X API credentials without forwarding the ambient host environment.

Scope:

- Built-in add-on only.
- Docker-compatible runners through existing container runtime defaults.
- Full x-gateway GraphQL document execution, including mutations.
- Explicit `addon.env` credential mapping.

Out of scope:

- Publishing or building an x-gateway container image.
- Direct local execution of x-gateway outside a container.
- Making the read-only `divedra/x-gateway-read` add-on write-capable.
- Author-controlled command or binary overrides.

## Modules

### 1. Add-on Types and Catalog

#### `src/workflow/types.ts`, `src/workflow/node-addons.ts`

**Status**: COMPLETED

```typescript
interface XGatewayAddonConfig {
  readonly documentTemplate: string;
  readonly image?: string;
  readonly runnerKind?: ContainerRunnerKind;
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}
```

**Checklist**:

- [x] Resolve `divedra/x-gateway` version `1`.
- [x] Validate full document add-on config.
- [x] Reject author-controlled command overrides.
- [x] Preserve explicit `addon.env` bindings.
- [x] Produce a native add-on payload with output contract.

### 2. Native Container Execution

#### `src/workflow/native-node-executor.ts`

**Status**: COMPLETED

```typescript
async function executeXGatewayAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedXGatewayAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput>;
```

**Checklist**:

- [x] Render `documentTemplate` with normal node template variables.
- [x] Resolve explicit add-on env bindings from the divedra runtime env.
- [x] Run `x-gateway graphql query <document> --json` in a container.
- [x] Keep `divedra/x-gateway-read` on `x-gateway-reader`.
- [x] Parse JSON stdout into node output.
- [x] Preserve stdout/stderr process logs.
- [x] Include the add-on's Docker-compatible runner in runtime readiness
      checks.

### 3. Tests and Documentation

#### `src/workflow/*.test.ts`, `design-docs/specs/*.md`

**Status**: COMPLETED

**Checklist**:

- [x] Validation accepts the write-capable x-gateway add-on and env mappings.
- [x] Validation rejects command overrides.
- [x] Execution uses the full `x-gateway` binary for mutation documents.
- [x] Execution does not leak mapped secret values into container arguments.
- [x] Runtime readiness reports required runner and env prerequisites.
- [x] Design docs distinguish `divedra/x-gateway-read` from
      `divedra/x-gateway`.
- [x] Typecheck and focused tests pass.

## Module Status

| Module           | File Path                                              | Status    | Tests    |
| ---------------- | ------------------------------------------------------ | --------- | -------- |
| Add-on types     | `src/workflow/types.ts`, `src/workflow/node-addons.ts` | COMPLETED | Targeted |
| Native execution | `src/workflow/native-node-executor.ts`                 | COMPLETED | Targeted |
| Readiness        | `src/workflow/runtime-readiness.ts`                    | COMPLETED | Targeted |
| Docs/tests       | `design-docs/specs/*.md`, `src/workflow/*.test.ts`     | COMPLETED | Targeted |

## Dependencies

| Feature             | Depends On                        | Status    |
| ------------------- | --------------------------------- | --------- |
| Add-on env mapping  | Existing x-gateway read add-on    | Available |
| X gateway execution | Existing container runner support | Available |
| Mutation capability | Full `x-gateway` container binary | Available |

## Completion Criteria

- [x] `divedra/x-gateway` add-on validates and resolves.
- [x] The add-on uses `x-gateway`, while `divedra/x-gateway-read` continues to
      use `x-gateway-reader`.
- [x] Add-on env mappings pass only configured variables.
- [x] Missing required mapped env variables are readiness prerequisites.
- [x] Focused workflow tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20

**Tasks Completed**: TASK-001 through TASK-003.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added the separate `divedra/x-gateway` add-on for intentional
x-gateway query or mutation documents, including post mutations. The existing
read-only add-on remains pinned to `x-gateway-reader`; the new add-on is pinned
to `x-gateway`, and neither add-on accepts author-controlled command overrides.
