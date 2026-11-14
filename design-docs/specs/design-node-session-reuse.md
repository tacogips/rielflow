# Node Session Reuse

This document defines backend session reuse for repeated executions of the same workflow node, including later steps that intentionally reuse one node definition.

Planned authored-direction update:

- workflows should eventually address execution through `steps` that reference reusable `node` definitions
- in that model, session reuse may occur across different steps that share the same node, not only across revisits of one direct node slot

Supporting design:
`design-docs/specs/design-workflow-steps-and-node-reuse.md`.

## Overview

Current behavior and target direction:
- keep the default behavior as fresh backend execution per node run
- allow opt-in node-local backend session reuse
- persist reusable backend session handles in workflow session state so reuse survives `session resume`
- keep the backend session handle opaque to the engine

This is implemented in the workflow runtime. A node can run multiple times within one `workflowExecutionId`, request backend-session continuation through `sessionPolicy.mode = "reuse"`, and persist the returned backend session handle for later visits of the same node id.

Under the step-addressed model, different steps may intentionally reuse the same node. Session selection therefore cannot rely on `nodeId` alone when a step explicitly asks to inherit from a prior step.

## Node Payload Contract

`node-{id}.json` may declare:

```json
{
  "sessionPolicy": {
    "mode": "reuse"
  }
}
```

Rules:
- default is `mode: "new"` when `sessionPolicy` is omitted
- explicit `mode: "new"` forwards a fresh-session hint to the adapter but does not persist a reusable backend handle afterward
- `mode: "reuse"` means repeated executions of the same node id within one `workflowExecutionId` may continue the same backend-managed session
- reuse scope is node-local and workflow-run-local
- rerun (`session rerun`) starts a fresh workflow session, so no node backend sessions are inherited

## Runtime State

Workflow session state should store reusable backend session handles as candidate records, not only as a plain `nodeId -> session` map.

Each candidate record should retain:

- node id
- source step id
- last step id that reused the handle
- resolved execution backend
- provider label
- opaque backend `sessionId`
- created / updated timestamps
- last node execution id that used the handle

The engine treats the backend session handle as opaque metadata. It does not infer transcript history itself.

### Reuse Selection

Selection rules should be:

- if a step requests `sessionPolicy.inheritFromStepId`, choose the latest compatible handle whose source provenance matches that step
- otherwise choose the latest compatible handle for the same node within the workflow execution
- compatibility still requires the same resolved execution backend
- timeout recovery may reuse only when the adapter/backend reports the prior backend session as resumable

## Adapter Contract

Adapter request input may include:

```ts
backendSession?: {
  mode: "new" | "reuse";
  sessionId?: string;
}
```

Semantics:
- `mode: "new"` asks the backend wrapper to start a new backend session if it supports sessions
- `mode: "reuse"` with `sessionId` asks the backend wrapper to continue that backend session

Adapter response may include:

```ts
backendSession?: {
  sessionId: string;
}
```

Semantics:
- when present, runtime persists the returned backend session id for future executions of that node
- for output-contract retries within the same node execution, runtime reuses the latest returned backend session id on the next retry attempt

## Failure Handling

- If `sessionPolicy.mode = "reuse"` and no stored backend session exists yet, the first execution sends `backendSession.mode = "new"`.
- If a backend does not support sessions, it may omit `backendSession` in the response; runtime then continues without creating a reusable handle.
- Stored backend session handles are reused only when the node still resolves to the same execution backend.
- If a step requested `inheritFromStepId` and no compatible handle exists from that source step, runtime falls back to a new backend session rather than silently borrowing unrelated context.
- The bundled mock-scenario path is useful for demonstrating repeated same-node control flow, but backend-session reuse itself still depends on the configured backend returning a reusable `sessionId`.

## Example

With reusable node `coder` and steps `implement` then `self-review`:

1. `implement` runs node `coder`, starts backend session `sess-coder-1`, and stores a reuse candidate with `sourceStepId = "implement"`
2. `self-review` targets the same node with `sessionPolicy = { "mode": "reuse", "inheritFromStepId": "implement" }`
3. runtime selects the compatible handle sourced from `implement`
4. `self-review` continues backend session `sess-coder-1` with the self-review prompt variant

This keeps the intended same-session context without confusing it with unrelated later uses of the same node from different steps or branches.

See also:

- `examples/same-node-session-echo/` for a concrete authored bundle that revisits one node twice, first to echo and then to answer on the next visit
- `design-docs/specs/design-workflow-steps-and-node-reuse.md`
