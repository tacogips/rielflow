# Mail Gateway Add-ons Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#built-in-rielflowmail-gateway-read`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

## Design Summary

Add two built-in worker add-ons for `tacogips/mail-gateway`:

- `rielflow/mail-gateway-read` runs the read-only `mail-gateway-reader graphql
--query` surface.
- `rielflow/mail-gateway` runs the full `mail-gateway graphql --query` surface,
  including intentional send mutations such as `sendMessage`.

Both add-ons run through Docker-compatible container runners and use explicit
`addon.env` mappings so workflows can choose which rielflow-side environment
variables are forwarded into each add-on container.

Scope:

- Built-in add-ons only.
- Docker-compatible runners through existing container runtime defaults.
- Read-only and send-capable mail-gateway GraphQL document execution.
- Explicit `addon.env` credential/config path mapping.

Out of scope:

- Publishing or building a mail-gateway container image.
- Direct local execution of mail-gateway outside a container.
- Making `rielflow/mail-gateway-read` send-capable.
- Author-controlled command or binary overrides.

## Modules

### 1. Add-on Types and Catalog

#### `src/workflow/types.ts`, `src/workflow/node-addons.ts`

**Status**: COMPLETED

```typescript
interface MailGatewayReadAddonConfig {
  readonly queryTemplate: string;
  readonly image?: string;
  readonly runnerKind?: ContainerRunnerKind;
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}

interface MailGatewayAddonConfig {
  readonly documentTemplate: string;
  readonly image?: string;
  readonly runnerKind?: ContainerRunnerKind;
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}
```

**Checklist**:

- [x] Resolve `rielflow/mail-gateway-read` version `1`.
- [x] Resolve `rielflow/mail-gateway` version `1`.
- [x] Validate read and send-capable configs.
- [x] Reject author-controlled command overrides.
- [x] Preserve explicit `addon.env` bindings.
- [x] Produce native add-on payloads with output contracts.

### 2. Native Container Execution

#### `src/workflow/native-node-executor.ts`

**Status**: COMPLETED

```typescript
async function executeMailGatewayReadAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedMailGatewayReadAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput>;

async function executeMailGatewayAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedMailGatewayAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput>;
```

**Checklist**:

- [x] Render query/document templates with normal node template variables.
- [x] Resolve explicit add-on env bindings from the rielflow runtime env.
- [x] Run `mail-gateway-reader graphql --query <query>` for read-only nodes.
- [x] Run `mail-gateway graphql --query <document>` for send-capable nodes.
- [x] Parse JSON stdout into node output.
- [x] Preserve stdout/stderr process logs.
- [x] Include both add-ons in runtime readiness checks.

### 3. Tests and Documentation

#### `src/workflow/*.test.ts`, `design-docs/specs/*.md`

**Status**: COMPLETED

**Checklist**:

- [x] Validation accepts both mail-gateway add-ons and env mappings.
- [x] Validation rejects command overrides.
- [x] Execution uses `mail-gateway-reader` for read-only queries.
- [x] Execution uses `mail-gateway` for send mutations.
- [x] Execution does not leak mapped secret/config values into container
      arguments.
- [x] Runtime readiness reports required runner and env prerequisites.
- [x] Design docs distinguish read-only and send-capable mail-gateway add-ons.
- [x] Typecheck and focused tests pass.

## Module Status

| Module           | File Path                                              | Status    | Tests    |
| ---------------- | ------------------------------------------------------ | --------- | -------- |
| Add-on types     | `src/workflow/types.ts`, `src/workflow/node-addons.ts` | COMPLETED | Targeted |
| Native execution | `src/workflow/native-node-executor.ts`                 | COMPLETED | Targeted |
| Readiness        | `src/workflow/runtime-readiness.ts`                    | COMPLETED | Targeted |
| Docs/tests       | `design-docs/specs/*.md`, `src/workflow/*.test.ts`     | COMPLETED | Targeted |

## Dependencies

| Feature                  | Depends On                           | Status    |
| ------------------------ | ------------------------------------ | --------- |
| Add-on env mapping       | Existing gateway add-on env model    | Available |
| Mail gateway execution   | Existing container runner support    | Available |
| Send mutation capability | Full `mail-gateway` container binary | Available |

## Completion Criteria

- [x] `rielflow/mail-gateway-read` and `rielflow/mail-gateway` validate and
      resolve.
- [x] The read add-on uses `mail-gateway-reader`, while the send-capable add-on
      uses `mail-gateway`.
- [x] Add-on env mappings pass only configured variables.
- [x] Missing required mapped env variables are readiness prerequisites.
- [x] Focused workflow tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20

**Tasks Completed**: TASK-001 through TASK-003.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Inspected `tacogips/mail-gateway` and mirrored the x-gateway split:
the read add-on is pinned to `mail-gateway-reader`, the send-capable add-on is
pinned to `mail-gateway`, and neither accepts author-controlled command
overrides.
