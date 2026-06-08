# Node Execution Inbox Contract Implementation Plan

**Status**: Superseded by SQLite-only workflow message handoff
**Superseded By**: `impl-plans/active/sqlite-only-node-io-mailbox-removal.md`
**Original Created**: 2026-03-17
**Last Updated**: 2026-06-08

## Supersession Notice

This historical plan is no longer implementation guidance. Do not implement or
restore its original worker-facing file contract. Runtime communication is now
SQLite `workflow_messages` plus resolved structured input snapshots owned by
the runtime.

Current rules:

- worker message input is assembled from SQLite `workflow_messages`
- resolved input snapshots live under runtime-owned `resolved-input/`
- final workflow message publication is runtime-owned after validation
- native command and container workers receive resolved input through
  `RIEL_RESOLVED_INPUT_PATH` and stdin
- non-message attachments remain under `RIEL_ATTACHMENT_ROOT`
- legacy execution-local inbox/outbox paths and legacy mailbox environment
  variables must not be used for node message input or output

## Historical Context

The original 2026-03-17 plan introduced a worker-facing file contract for node
message input and output. That design has been replaced. The retained value of
this document is only historical: it records the older motivation for compiling
node execution context into a single runtime-owned structure.

## Replacement Implementation

The replacement implementation is tracked in
`impl-plans/active/sqlite-only-node-io-mailbox-removal.md`.

Replacement behavior:

- `packages/rielflow/src/workflow/node-execution-mailbox.ts` builds resolved
  structured node input from SQLite-backed communications and runtime state.
- `packages/rielflow/src/workflow/communication-artifact-persistence.ts`
  persists communication state through SQLite-backed message records and no
  longer materializes communication mirror files.
- `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts`
  passes native command/container input through executor-private resolved-input
  request files and stdin, and reads native candidate output from stdout JSON.
- Agent prompts and output-contract prompts describe runtime-owned workflow
  message publication and reserved Candidate-Path submission, not worker-owned
  message files.

## Completion State

- [x] Historical file-backed contract is superseded.
- [x] SQLite `workflow_messages` is the runtime communication source of truth.
- [x] Node input handoff no longer exposes the removed file contract.
- [x] Native command/container input handoff uses resolved input, not legacy
      message files.
- [x] Output publication is runtime-owned after adapter/native validation.
- [x] User-facing guidance points workers to resolved workflow message input or
      upstream payloads.

## Progress Log

### 2026-06-08

Superseded this historical plan during the SQLite-only node I/O migration. The
active implementation and verification evidence now live in
`impl-plans/active/sqlite-only-node-io-mailbox-removal.md`.
