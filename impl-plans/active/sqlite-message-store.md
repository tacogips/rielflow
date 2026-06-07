# SQLite Message Store Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-sqlite-message-store.md
**Created**: 2026-06-06
**Last Updated**: 2026-06-06

## Summary

Persist workflow communication handoffs in SQLite as the canonical message
transport. The SQLite model is one `workflow_messages` row per
`(workflow_execution_id, communication_id)`. File and binary handoffs are stored
under the attachment root with path references in SQLite. There is no
session/file fallback for message lookup.

## Scope

Included:

- runtime DB schema and typed records
- required message persistence writes
- attachment-root path normalization
- file handoff materialization into attachment-root scoped paths
- SQLite-only communication service reads, replay, retry, and consumption
- SQLite-only GraphQL communication lists/detail and manager mutation scope
  checks
- cleanup/delete integration
- tests and user-facing docs

Excluded:

- changing manager-owned communication id allocation
- storing binary payloads in SQLite
- introducing a new retention policy
- adding new storage environment variables beyond the accepted root contract

## Modules

### Runtime DB Message Schema

Files:

- `packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts`
- `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts`
- `packages/rielflow/src/workflow/runtime-db/session-query-records.ts`

Completed:

- added `workflow_messages` DDL and indexes
- added typed save/load/list/update row helpers
- added attachment materialization before row insertion
- added delete support for workflow message rows
- kept communication event node logs as observability records only

### Attachment Paths

Files:

- `packages/rielflow/src/workflow/message-attachment-paths.ts`
- `packages/rielflow-core/src/paths.ts`
- `packages/rielflow/src/workflow/history.ts`

Completed:

- normalized
  `{workflow_id_path_friendly}/{workflow_run_id}/messages/{communicationId}/...`
- rejected empty segments, `.`, `..`, slash-bearing identifiers, absolute new
  attachment paths, and escaped targets
- resolved persisted refs against `resolveAttachmentRoot()`
- added cleanup integration for workflow-scoped attachment roots

### Write Pipeline

Files:

- `packages/rielflow/src/workflow/engine/mailbox-communication-artifacts.ts`
- `packages/rielflow/src/workflow/manager-message-service/artifacts.ts`
- `packages/rielflow/src/workflow/engine/step-result-finalization.ts`
- `packages/rielflow/src/workflow/engine/step-input.ts`

Completed:

- made SQLite insert/update required for new communication writes
- kept binary/file payload bodies out of `payload_json`
- normalized handoff artifacts before SQLite rows are written
- routed fanout and external-input/output writers through the same persistence
  path
- avoided successful delivery when SQLite persistence fails

### Read, GraphQL, Replay, and Retry

Files:

- `packages/rielflow/src/workflow/communication-service.ts`
- `packages/rielflow/src/workflow/manager-message-service.ts`
- `packages/rielflow/src/graphql/schema/execution-resolvers.ts`

Completed:

- communication detail and list queries read from SQLite only
- GraphQL manager mutations validate communication scope from SQLite only
- replay selects the canonical SQLite source row and creates a new row
- retry updates delivery-attempt state on the existing row
- consumption status updates SQLite rows
- GraphQL snapshots are synthesized from SQLite rows

## Verification Plan

Run after implementation:

```bash
bun test packages/rielflow/src/workflow/paths.test.ts packages/rielflow/src/workflow/runtime-db.test.ts packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/graphql/schema.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts
bun run typecheck
bun run lint:biome
git diff --check
```

Focused assertions:

- default message DB path resolves to `~/.rielflow/artifacts/rielflow.db`
- `RIEL_RUNTIME_DB` overrides only the SQLite path
- `RIEL_ARTIFACT_DIR` co-locates files and the default database
- `RIEL_ATTACHMENT_ROOT` moves file/binary message refs
- new file/binary refs use
  `{workflow_id_path_friendly}/{workflow_run_id}/messages/{communicationId}/...`
- SQLite contains one row per communication id
- inbound and outbound views are query filters over that row
- replay creates a new row
- retry updates delivery-attempt state on the existing row
- failed SQLite writes block new message publication
- session-only communication records are ignored by GraphQL message lists

## Completion Criteria

- [x] New communications are durably persisted in SQLite by default.
- [x] File/binary payloads are stored on disk with only paths in SQLite.
- [x] Message reads, replay, retry, GraphQL list/detail, and manager mutation
      checks use SQLite only.
- [x] All accepted env root overrides are covered by focused tests.
- [x] User-facing docs describe defaults, overrides, and path behavior.
- [x] Plan progress log is updated with completed work and verification.

## Progress Log

| Date | Session | Status | Notes |
| ---- | ------- | ------ | ----- |
| 2026-06-06 | step4-impl-plan-create exec-000009 | Ready | Created plan from accepted design. |
| 2026-06-06 | step6-implement exec-000012..000021 | Completed | Implemented SQLite message schema, row helpers, attachment path normalization, required message writes, replay/retry/consume updates, GraphQL integration, docs, and focused tests. |
| 2026-06-06 | manual follow-up | Completed | User clarified that backward compatibility is not required. Stopped the compatibility-oriented workflow run and removed session/file fallback behavior from communication service, GraphQL, manager replay validation, docs, and tests. Focused tests passed. |
