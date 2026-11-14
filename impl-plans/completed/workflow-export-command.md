# Workflow Export Command Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/command.md#subcommands
**Created**: 2026-03-30
**Last Updated**: 2026-03-30

---

## Design Document Reference

**Source**: design-docs/specs/command.md

### Summary
Add a CLI `export` command that accepts `workflow-id` and `workflow-run-id`,
then exports the persisted workflow run logs as JSON either to stdout or to a
user-specified file.

### Scope
**Included**: CLI parsing, export payload assembly from session/runtime stores,
JSON file writing, and regression coverage.
**Excluded**: New GraphQL export APIs, artifact format changes, and non-JSON
export formats.

---

## Modules

### 1. CLI Export Path

#### src/cli.ts

**Status**: COMPLETED

**Checklist**:
- [x] Parse `export` command arguments and `--file`
- [x] Assemble a canonical workflow-run export payload
- [x] Write JSON to stdout or a target file
- [x] Validate workflow-id and workflow-run-id pairing

#### src/cli.test.ts

**Status**: COMPLETED

**Checklist**:
- [x] Cover stdout JSON export
- [x] Cover file export
- [x] Cover workflow/run mismatch handling

#### design-docs/specs/command.md

**Status**: COMPLETED

**Checklist**:
- [x] Document `export` subcommand
- [x] Document `--file` option

#### README.md

**Status**: COMPLETED

**Checklist**:
- [x] Mention `export` in CLI overview

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Session export/logs | `src/cli.ts` | COMPLETED | Passing |
| CLI regression tests | `src/cli.test.ts` | COMPLETED | Passing |
| Command documentation | `design-docs/specs/command.md` | COMPLETED | - |
| README command list | `README.md` | COMPLETED | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Session export/logs commands | Existing session store, runtime DB, communication snapshots | Available |

## Completion Criteria

- [x] `divedra session export <session-id>` works locally
- [x] `divedra session logs <session-id> --format jsonl` works locally
- [x] `--file` writes a JSON export bundle
- [x] Regression tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-03-30
**Tasks Completed**: Planned CLI export implementation
**Tasks In Progress**: Wiring command, payload assembly, tests, and docs
**Blockers**: None
**Notes**: Reuse existing session store, runtime DB, and communication snapshot
views so the export format matches current inspection data instead of inventing a
new persistence path.

### Session: 2026-03-30 2
**Tasks Completed**: CLI export command, file output path, regression tests, and docs updates
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented local `divedra export <workflow-id> <workflow-run-id>` with `--file`, verified workflow-id/workflow-run-id matching, and exported a canonical bundle containing session state, runtime node execution rows, runtime node logs, and communication snapshots.

### Session: 2026-04-17
**Tasks Completed**: Renamed ambiguous top-level export surface to session-scoped commands
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Replaced `divedra export <workflow-id> <workflow-run-id>` with `divedra session export <session-id>` so the command reads as a workflow-run/session artifact export rather than a workflow-definition export. Added `divedra session logs <session-id> --format text|json|jsonl` for the narrower log-viewing use case.

## Related Plans

- **Previous**: `impl-plans/completed/workflow-cli-mvp.md`
- **Next**: (continue in this plan until completed)
- **Depends On**: `impl-plans/completed/workflow-execution-and-session.md`
