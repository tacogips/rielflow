# Node Execution I/O Contract

This document defines the worker-facing execution contract that the runtime
materializes for every node execution.

## Overview

SQLite `workflow_messages` is the canonical workflow communication path. The
old execution-local mailbox file ABI based on `RIEL_MAILBOX_DIR`,
`inbox/input.json`, and `outbox/output.json` is removed and must not be kept as
a compatibility path for node message handoff.

Goals:

- give `agent`, `command`, `container`, and `addon` nodes one shared semantic
  input/output contract
- keep workflow message reads, replay, retry, and routing backed by
  `workflow_messages`
- keep final node artifact publication runtime-owned
- avoid worker-visible message mailbox files for structured node input or
  output
- preserve file and binary handoff only through attachment descriptors rooted at
  `RIEL_ATTACHMENT_ROOT`
- keep backend-specific transport details behind adapter or native executor
  modules

## Contract Shape

Before a node executes, the runtime resolves the execution input in memory from
workflow input, runtime variables, manager messages, and SQLite-backed upstream
communications. That resolved input has this semantic shape:

- `arguments`
- `humanInput`
- `workflowOutput`
- `runtimeVariables`
- `upstream`
- `latestOutputs`
- `managerMessage`

Rules:

- upstream payloads included here are execution-local resolved data, not
  canonical transport envelopes
- `latestOutputs` carries the latest completed node execution records available
  to the current step, including step id, node id, node execution id, status,
  artifact directory, and structured payload
- prompts may summarize large data, but user-facing prompt guidance must not
  instruct workers to read `$RIEL_MAILBOX_DIR/inbox/input.json`
- workers must not read canonical `communications/...` directories directly
- workers must not use `RIEL_MAILBOX_DIR`, `inbox/input.json`, or
  `outbox/output.json` for message input or output
- if an ingress source was semantically plain text, the runtime normalizes it
  into a `{"text":"..."}` object at the leaf payload position within the
  relevant field

The runtime may persist audit copies of requests, candidates, final
`output.json`, `meta.json`, and `handoff.json` under the node artifact
directory. Those artifacts are runtime-owned audit records, not the worker I/O
transport.

## Backend Application

All node types use the same semantic contract but may receive it through
executor-specific mechanisms:

- `agent`
  - prompt composition is derived from the resolved input object and
    SQLite-backed upstream messages
  - structured-output nodes receive the reserved `Candidate-Path` when the
    runtime needs a file handoff for the final business JSON candidate
  - `Candidate-Path` is a runtime-owned staging path and is not a mailbox
    outbox path
- `command`
  - the native executor passes resolved input to the process through a
    non-mailbox process boundary such as JSON stdin
  - stdout is the preferred structured JSON candidate output stream; stderr is
    diagnostic log output only
  - command scripts must not require `RIEL_MAILBOX_DIR`
- `container`
  - the native executor passes resolved input through JSON stdin attached to
    the container process
  - stdout is the preferred structured JSON candidate output stream; stderr is
    diagnostic log output only
  - container entrypoints must not require a `/mailbox` mount or
    `RIEL_MAILBOX_DIR`
- `addon`
  - built-in add-ons receive the resolved input object in process and return a
    candidate output object
  - add-ons must not discover input or publish output by reading/writing
    mailbox files

Normalization happens before this backend boundary. A command, container,
agent, or add-on worker sees the same JSON-compatible input semantics even if
its transport is prompt text, stdin, an adapter API, or an in-process call.

## Output Ownership

The runtime, not the worker, owns final publication.

Rules:

- workers propose a candidate payload through their backend-specific result
  channel
- the runtime validates the candidate and normalizes any accepted
  output-contract adapter envelope
- the runtime writes the canonical node `output.json` artifact
- the runtime inserts downstream communications into `workflow_messages`
- workers must not publish downstream messages by writing mailbox outbox files

For structured-output nodes, executor-specific candidate temp paths may exist
as internal runtime plumbing. They are not stable worker ABI and must not be
named `outbox/output.json`.

## File And Binary Attachments

File transfer is the only remaining file handoff surface.

Rules:

- `RIEL_ATTACHMENT_ROOT` is the root for non-message file and binary attachment
  materialization
- message rows store attachment-root-relative references, not raw file or binary
  bodies
- workers receive attachment descriptors in the resolved input object
- workers may create new file or binary outputs only through executor-approved
  attachment staging that the runtime validates and materializes under
  `RIEL_ATTACHMENT_ROOT`
- attachment staging must not reuse `RIEL_MAILBOX_DIR`, `inbox/files`, or
  `outbox/files`
- host absolute paths, traversal, symlink escapes, and cross-run attachment
  references remain invalid

## Real-Backend Artifact Audit Requirements

Issue mapping: `Verify non-mock impl-plan implementation workflow execution`.
The `design-and-implement-review-loop` workflow must be auditable when run in
`issue-resolution` workflow mode with real configured LLM backends such as
`codex-agent`, not a mock scenario.

For each runtime step, the persisted node execution artifacts must let a later
review or summary step prove:

- which execution backend and model were requested
- which resolved input object was supplied to the backend
- which prompt/request was sent to the backend for each output attempt
- which candidate payload was received or staged for each output attempt
- which validation result accepted or rejected the candidate when an output
  contract applies
- which final runtime-owned `output.json`, `meta.json`, and `handoff.json`
  records were published for the node execution
- which downstream `workflow_messages` rows were inserted after accepted output
  publication

Prompt text sent to an agent backend is an inspectable derivative of the
resolved input object, not a separate source of truth. When prompt text
summarizes large upstream payloads, downstream review steps must rely on
`latestOutputs` and SQLite-backed communication inspection rather than on
truncated prompt snippets or mailbox input files.

Mock scenarios remain valid for deterministic tests and examples, but a
non-mock audit run must not accept mock-scenario responses as evidence that
configured LLM backends were exercised. Runtime artifacts should make that
distinction explicit through provider/backend metadata and request records.

## Codex-Agent Reference Mapping

Reference lookup evidence:

- preferred local reference root: `../../codex-agent`
- inspected fallback root: `../codex-agent`
- verification command:
  `cd ../codex-agent && rg -n "RIEL_MAILBOX_DIR|inbox/input\\.json|outbox/output\\.json|mailbox|Candidate-Path" .`
- result: no file-backed mailbox ABI or Candidate-Path runtime contract matches
  were found in the inspected codex-agent checkout

Relevant reference behavior:

- codex-agent is a backend session/process adapter reference only
- rielflow owns workflow message storage, validation, routing, and final
  publication
- Cursor-specific or CLI-specific behavior must stay behind adapter modules so
  the worker-facing semantic I/O contract stays stable across `codex-agent`,
  `claude-code-agent`, SDK, command, container, and add-on execution

Intentional rielflow boundary:

- rielflow does not copy codex-agent session storage into workflow message
  persistence
- codex-agent may receive prompt/request data from rielflow, but
  `workflow_messages` remains the source of truth for workflow communication
- `Candidate-Path` is retained only for runtime-owned structured candidate
  submission; it is not a codex-agent mailbox compatibility path

## Relationship To Canonical Message Transport

The layering is:

1. managers route canonical communications through `workflow_messages`
2. runtime resolves those communications into one node execution input object
3. backend adapters or native executors pass that input through their private
   process/API boundary
4. worker returns a candidate payload through that same backend boundary
5. runtime validates, publishes node artifacts, and routes downstream by
   inserting new `workflow_messages` rows

No layer in this path uses `RIEL_MAILBOX_DIR/inbox/input.json`,
`RIEL_MAILBOX_DIR/outbox/output.json`, `RIEL_RESOLVED_INPUT_PATH`, or a mounted
native request file for message handoff.

## References

- `design-docs/specs/design-node-output-contract.md`
- `design-docs/specs/design-container-runtime-contract.md`
- `design-docs/specs/design-sqlite-message-store.md`
