# GraphQL Manager Runtime Session Lifecycle

This document closes the remaining runtime gap between the GraphQL manager control-plane design and the current workflow engine.

## Overview

The GraphQL control-plane surface already exists:

- `/graphql` accepts manager-scoped mutations,
- `divedra gql` forwards bearer auth and ambient manager-session scope,
- manager-session persistence and auth validation exist.

What was still missing in the runtime was the lifecycle that makes those primitives usable from an actual manager-node execution:

- mint a manager-session token when a manager node execution starts,
- persist the active manager session with node-execution scope,
- pass the ambient GraphQL manager context only to manager-capable adapter executions,
- revoke or expire that token when the manager node execution finishes.

## Runtime Lifecycle

For every non-dry-run manager-node execution (`root-manager` or `subworkflow-manager`):

1. The engine allocates a new `managerSessionId` scoped to the current `nodeExecId`.
2. The engine mints a fresh bearer token and stores only its hash.
3. The engine persists the manager session in `active` status before calling the adapter.
4. The engine passes ambient GraphQL manager context to the adapter request.
5. When the manager node execution ends, the engine updates the same session row to a terminal status and expires the token immediately.

Status mapping for this slice:

- successful manager node execution -> `completed`
- failed or timed out manager node execution -> `failed`
- dry-run execution -> no manager session is minted

This keeps the token scoped to one manager step and prevents reuse after the step ends.

## Adapter Contract

The runtime-to-adapter request contract must expose manager GraphQL context only for manager nodes.

Recommended request shape:

```typescript
interface AdapterAmbientManagerContext {
  readonly environment: {
    readonly DIVEDRA_GRAPHQL_ENDPOINT: string;
    readonly DIVEDRA_MANAGER_AUTH_TOKEN: string;
    readonly DIVEDRA_MANAGER_SESSION_ID: string;
    readonly DIVEDRA_WORKFLOW_ID: string;
    readonly DIVEDRA_WORKFLOW_EXECUTION_ID: string;
    readonly DIVEDRA_MANAGER_NODE_ID: string;
    readonly DIVEDRA_MANAGER_NODE_EXEC_ID: string;
  };
}
```

Rules:

- worker/input/output/judge nodes must not receive this context
- manager auth tokens must not be written into workflow execution artifacts such as `input.json`
- CLI-capable backends such as `codex-agent` and `claude-code-agent` may translate the provided environment map into the actual tool-process environment used by `divedra gql`
- official SDK backends may ignore the field safely

## Security Notes

- The persisted manager-session row stores `authTokenHash`, never the raw token.
- The raw token may exist only in process memory and in the adapter request payload for the current manager execution.
- The adapter-facing context is additive and must not change worker execution behavior.
- Immediate post-execution expiry is sufficient for this iteration; mid-execution external cancellation still follows the existing runtime cancellation model.

## References

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/architecture.md`
