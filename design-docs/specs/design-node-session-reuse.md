# Node Session Reuse

This document defines node-local backend session reuse for repeated executions of the same workflow node.

## Overview

Current behavior:
- keep the default behavior as fresh backend execution per node run
- allow opt-in node-local backend session reuse
- persist reusable backend session handles in workflow session state so reuse survives `session resume`
- keep the backend session handle opaque to the engine

This is implemented in the workflow runtime. A node can run multiple times within one `workflowExecutionId`, request backend-session continuation through `sessionPolicy.mode = "reuse"`, and persist the returned backend session handle for later visits of the same node id.

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

Workflow session state stores reusable backend session handles keyed by node id:

- node id
- resolved execution backend
- provider label
- opaque backend `sessionId`
- created / updated timestamps
- last node execution id that used the handle

The engine treats the backend session handle as opaque metadata. It does not infer transcript history itself.

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
- The bundled mock-scenario path is useful for demonstrating repeated same-node control flow, but backend-session reuse itself still depends on the configured backend returning a reusable `sessionId`.

## Example

With node `b` configured as `sessionPolicy.mode = "reuse"`:

1. `a` produces `2`
2. first `b` execution receives `2`, starts backend session `sess-b-1`, and stores it
3. `c` produces `3`
4. second `b` execution receives `3` and continues backend session `sess-b-1`

This enables node `b` to remember the prior `2` and respond with the accumulated result `5`, assuming the backend wrapper implements that continuation behavior.

See also:

- `examples/same-node-session-echo/` for a concrete authored bundle that revisits one node twice, first to echo and then to answer on the next visit
