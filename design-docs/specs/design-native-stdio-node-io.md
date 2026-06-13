# Native Stdio Node JSONL I/O

Command and container nodes must not expose runtime message input or output
through worker-visible environment variables or mounted request files. Rielflow
owns resolved input assembly, output validation, and workflow message
publication.

## Overview

Native command and container workers use a stdio JSONL boundary:

- stdin receives exactly one UTF-8 JSON object followed by `\n`.
- stdout must contain exactly one non-empty JSONL record when the worker
  returns a workflow output.
- stdout records must be top-level JSON objects.
- stderr is diagnostic-only.
- multiple non-empty stdout records fail closed.
- invalid JSON or non-object stdout fails before publication.

The runtime must not expose `RIEL_RESOLVED_INPUT_PATH`,
`RIEL_MAILBOX_DIR`, `RIELFLOW_WORKFLOW_INPUT`,
`RIELFLOW_WORKFLOW_OUTPUT`, `/rielflow-input`, `inbox/input.json`, or
`outbox/output.json` as command/container message I/O contracts.

## TypeScript/Bun Runtime

The TypeScript native executor writes the resolved input object to an
executor-owned stdin source and launches the worker with that data connected to
fd 0. The path is not exported to the worker environment and is not mounted
into containers.

For Docker-compatible container runners, Rielflow still passes `run --rm -i`
so the container process receives the same stdin JSONL value. Explicit
workflow-authored environment variables are preserved except for reserved
worker file ABI names, which are stripped even when present in ambient or
authored environment maps.

## Swift Runtime

The Swift deterministic executor uses the same stdio JSONL behavior for command
and container nodes. See `design-docs/specs/design-swift-stdio-node-io.md` for
the Swift-specific execution envelope and verification notes.

## Compatibility

Resolved input snapshots under runtime-owned `resolved-input/` artifact
directories remain valid for inspection and replay. They are not worker-facing
ABI. Agent adapter reserved candidate paths are also separate from native
command/container message I/O and remain runtime-owned staging paths.
