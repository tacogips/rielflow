# Native Stdio Node JSONL I/O Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-native-stdio-node-io.md`
**Created**: 2026-06-13
**Last Updated**: 2026-06-13

## Scope

Remove the remaining TypeScript/Bun native command/container worker-facing
environment and request-file ABI. Command and container workers receive resolved
input through stdin JSONL and return candidate output through stdout JSONL.

Out of scope:

- runtime-owned resolved input snapshots used for inspection
- agent adapter reserved candidate paths
- attachment staging under `RIEL_ATTACHMENT_ROOT`

## Modules

### `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts`

**Status**: Completed

```typescript
interface NativeStdioExecution {
  stdin: string; // one JSON object plus newline
  stdout: string; // exactly one output JSONL object
}
```

Checklist:

- [x] Remove worker-visible `RIEL_RESOLVED_INPUT_PATH`
- [x] Remove container `/rielflow-input/resolved-input.json` mount
- [x] Strip reserved legacy worker file env names from ambient/authored env
- [x] Parse stdout as exactly one JSONL object
- [x] Preserve stderr as diagnostics

### Example Command Scripts

**Status**: Completed

Checklist:

- [x] Read resolved input from stdin
- [x] Stop requiring `RIEL_RESOLVED_INPUT_PATH`
- [x] Keep stdout as exactly one structured JSONL output record

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Native executor | `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts` | Completed | `native-node-executor-addons-commands.test.ts` |
| Example scripts | `examples/*/scripts/*.sh` | Completed | `examples-script-contract.test.ts` |
| Time-signal script | `examples/telegram-agent-trio-time-signal/scripts/prepare-time-signal.ts` | Completed | `chat-agent-trio-parity-example.test.ts` |
| Documentation | `README.md`, `design-docs/specs/*.md` | Completed | search gates |

## Completion Criteria

- [x] Native command workers receive non-empty resolved input through stdin
- [x] Native container runner receives non-empty resolved input through stdin
- [x] Reserved file ABI env names are stripped
- [x] Container runner args no longer include `/rielflow-input`
- [x] Multiple stdout JSONL records fail closed
- [x] Example command scripts emit one stdout JSONL record
- [x] Focused and full Bun tests pass

## Verification

- `bun test packages/rielflow/src/events/chat-agent-trio-parity-example.test.ts packages/rielflow/src/workflow/examples-script-contract.test.ts packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts`
- `bun test`
- `bun run typecheck`
- `bun run lint:biome`
- `bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --scope project`
- `bun run packages/rielflow/src/bin.ts workflow run native-stdio-smoke --workflow-definition-dir /tmp/rielflow-native-stdio-smoke.* --variables '{"name":"rielflow"}' --output json`
- smoke artifact check: `stdout.log` contained `stdinBytes: 72` and
  `leakedReservedEnv: []`
- `jq empty impl-plans/PROGRESS.json`
- `git diff --check`

## Progress Log

### Session: 2026-06-13

**Tasks Completed**: Removed TypeScript/Bun native command/container
`RIEL_RESOLVED_INPUT_PATH` handoff and container request-file mount, updated
example scripts, added regression coverage, and refreshed docs.

**Blockers**: None.
