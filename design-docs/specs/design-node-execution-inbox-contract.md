# Node Execution Inbox Contract

This document defines the worker-facing execution contract that the runtime
materializes for every node execution.

## Overview

Canonical mailbox transport remains manager-owned and lives under
`communications/{communicationId}/...`.

That transport shape is not the primary API for worker implementations.
Instead, before a node executes, the runtime compiles workflow metadata,
resolved input, and output expectations into one execution-local inbox/outbox
contract.

Goals:

- give `agent`, `command`, and `container` nodes one shared worker-facing ABI
- remove implicit dependence on workflow graph or canonical mailbox layout
- let node implementations read one metadata file and one input payload file
- keep canonical mailbox publication, routing, and validation runtime-owned
- keep host filesystem paths out of container-facing metadata

## Execution-Local Layout

Each node execution artifact directory gains a worker-facing mailbox subtree:

```text
{artifact-root}/{workflowId}/executions/{workflowExecutionId}/nodes/{nodeId}/{nodeExecId}/
  input.json
  output.json
  meta.json
  handoff.json
  mailbox/
    inbox/
      meta.json
      input.json
      files/
    outbox/
      output.json        # worker target path; runtime-owned publication still applies
      files/
```

Rules:

- `mailbox/inbox/meta.json` is the primary worker-facing execution contract
- `mailbox/inbox/input.json` contains the resolved execution-local input payload
- `mailbox/inbox/files/` contains worker-visible input files for that execution
- `mailbox/outbox/output.json` is the preferred worker output target path
- `mailbox/outbox/files/` is the preferred worker output-files directory
- worker-facing mailbox paths are execution-local and must not be treated as the
  canonical routed mailbox store

## Path Contract

Worker-visible metadata must use mailbox-root-relative paths, not host absolute
paths.

The runtime may mount or expose the mailbox root differently per executor.

Preferred rule:

- the executor sets `DIVEDRA_MAILBOX_DIR`
- metadata paths are relative to that directory
- worker code joins `DIVEDRA_MAILBOX_DIR` with the relative paths declared in
  `mailbox/inbox/meta.json`

Example:

```json
{
  "protocolVersion": 1,
  "mailboxDirEnvVar": "DIVEDRA_MAILBOX_DIR",
  "paths": {
    "inputPath": "inbox/input.json",
    "inputFilesDir": "inbox/files",
    "outputPath": "outbox/output.json",
    "outputFilesDir": "outbox/files"
  }
}
```

This keeps host/container path differences out of the public worker contract.

## `mailbox/inbox/meta.json`

`meta.json` answers four worker questions:

1. Why is this node running?
2. What input did it receive?
3. What files are available?
4. What output should it produce and where should it write it?

Example shape:

```json
{
  "protocolVersion": 1,
  "mailboxDirEnvVar": "DIVEDRA_MAILBOX_DIR",
  "node": {
    "workflowId": "release",
    "workflowDescription": "Ship a release safely.",
    "nodeId": "implement",
    "nodeKind": "task"
  },
  "objective": {
    "reason": "Execute the assigned work step because it contributes a required intermediate result in the workflow.",
    "expectedReturn": "Return the business JSON object produced by this work step for downstream consumers.",
    "instruction": "Implement the release step."
  },
  "paths": {
    "inputPath": "inbox/input.json",
    "inputFilesDir": "inbox/files",
    "outputPath": "outbox/output.json",
    "outputFilesDir": "outbox/files"
  },
  "input": {
    "kind": "json",
    "upstreamSources": [
      {
        "fromNodeId": "workflow-input",
        "communicationId": "comm-000014",
        "transitionWhen": "always"
      }
    ]
  },
  "output": {
    "kind": "json",
    "required": true,
    "path": "outbox/output.json",
    "filesDirectory": "outbox/files"
  }
}
```

Additional optional sections may include:

- current sub-workflow scope summary
- manager-owned child catalog
- manager control guidance
- output JSON Schema hints for structured-output nodes

## `mailbox/inbox/input.json`

`input.json` carries resolved execution data rather than transport internals.

Initial fields:

- `arguments`
- `humanInput`
- `workflowOutput`
- `runtimeVariables`
- `upstream`
- `managerMessage`

Rules:

- upstream payloads included here are execution-local resolved data, not
  canonical mailbox envelopes
- the runtime may keep richer audit data in the root `input.json`, but worker
  code should not need that file
- workers must not read canonical `communications/...` directories directly

## Backend Application

All node types use the same semantic contract:

- `agent`
  - runtime compiles `mailbox/inbox/meta.json` and `mailbox/inbox/input.json`
  - prompt composition must be derived from that same compiled contract
- `command`
  - future executor should expose the same mailbox tree on disk and set
    `DIVEDRA_MAILBOX_DIR`
- `container`
  - future executor should mount the same mailbox tree and set
    `DIVEDRA_MAILBOX_DIR`

This keeps worker semantics aligned even if execution mechanisms differ.

## Output Ownership

The worker-facing mailbox does not change publication ownership:

- workers may write only to execution-local outbox targets
- runtime validates and promotes accepted output into canonical `output.json`
- runtime alone creates downstream mailbox communications
- canonical `communications/{communicationId}/...` layout remains internal

For structured-output nodes, executor-specific candidate temp paths may still
exist as internal runtime plumbing. They are not part of the stable worker ABI.

## File Handling

File transfer follows the same principle:

- input files appear under `mailbox/inbox/files/`
- output files are written under `mailbox/outbox/files/`
- metadata uses relative paths under the mailbox root
- workers do not receive host absolute file paths

Future versions may widen the manifest structure, but v1 should keep file usage
simple enough that no SDK is required for basic scripting.

## Relationship To Canonical Mailbox Transport

The execution inbox contract is not a replacement for the canonical mailbox
transport design.

The layering is:

1. managers route canonical communications under `communications/...`
2. runtime resolves those communications into one node execution
3. runtime compiles one worker-facing mailbox contract for that execution
4. worker writes an execution-local outbox result
5. runtime validates, publishes, and routes downstream

## References

- `design-docs/specs/design-node-mailbox.md`
- `design-docs/specs/design-node-output-contract.md`
- `design-docs/specs/design-container-runtime-contract.md`
