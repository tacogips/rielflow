# Native Bash Dispatch Regression Test Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#native-command-script-dispatch`
**Created**: 2026-06-04
**Last Updated**: 2026-06-04

## Design Reference

Implement the accepted issue-resolution design for native command script
dispatch regression coverage. The source of truth is
`design-docs/specs/architecture.md:84`, with package skill projection safety
kept as context in
`design-docs/specs/design-workflow-package-skills.md#security-and-validation`.

The design requires `.bash` workflow scripts to launch through `bash`, `.sh`
scripts to launch through `sh`, and other scripts to launch directly. The
regression test must prove that a non-executable `.bash` script still runs
through bash-specific semantics, not merely through a POSIX-compatible shell
path.

## Issue Reference

- Type: `cross-workflow-review-finding`
- Workflow ID: `codex-recent-change-quality-loop`
- Workflow execution ID: `riel-codex-recent-change-quality-loop-1780538341-81478d08`
- Caller node ID: `step3-handoff`
- Review finding: mid severity at
  `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts:684`
- Review decision: `step3-design-review` accepted the design with
  `reviewDecision: accept-design`, `needs_revision: false`, and no findings.

## Codex Agent References

- `codex-design-and-implement-review-loop` `step1-issue-intake`: source of
  truth for the narrowed issue-resolution scope and acceptance signals.
- `codex-recent-change-quality-loop`
  `riel-codex-recent-change-quality-loop-1780538341-81478d08`
  `step3-handoff`: delegated review finding that blocks handoff.
- `codex-agent` provider reference: runtime worker reference only; no
  codex-agent repository behavior is required or copied.

## Scope

In scope:

- Update only
  `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts`.
- Keep the `.bash` fixture mode at `0644`.
- Make the `.bash` fixture use bash-only syntax such as arrays or `[[ ... ]]`
  so `/bin/sh` dispatch fails.
- Keep the assertion tied to the native command payload behavior already under
  test, including working-directory reporting.

Out of scope:

- Changing native executor dispatch implementation in
  `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts`
  unless focused verification proves the existing `.bash` dispatch is broken.
- Changing package skill projection code or tests in
  `packages/rielflow/src/workflow/packages/skill-install.ts` or
  `packages/rielflow/src/workflow/packages/packages.test.ts`.
- Reverting or formatting unrelated dirty worktree changes.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Native `.bash` regression fixture | `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts` | COMPLETED | `bun test packages/rielflow/src/workflow/native-node-executor-gateway.test.ts` |

## Tasks

### TASK-001: Inspect Current Fixture Shape

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Confirm whether the current `writeReportCwdScript` helper is POSIX-only and
  whether the `.bash` test should use a dedicated helper or an explicit inline
  fixture writer.

**Dependencies**: None.

**Implementation Notes**:

- Read around
  `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts:33`
  and `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts:684`.
- Preserve existing helper behavior for `.sh` and direct script tests unless a
  narrow helper parameter makes the `.bash` test clearer without affecting
  other call sites.

**Completion Criteria**:

- [x] The implementer has chosen a narrowly scoped fixture update path.
- [x] No unrelated tests or helpers are rewritten.

### TASK-002: Add Bash-Only Non-Executable Fixture

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts`

**Dependencies**: TASK-001.

**Implementation Notes**:

- Keep the fixture path ending in `.bash`.
- Keep the fixture write mode at `0o644`.
- Use bash-only semantics that `/bin/sh` rejects, for example an array
  assignment plus `[[ ... ]]` guard, before writing the JSON payload.
- Continue asserting the payload `cwd` matches the workflow working directory.
- Do not rely on a shebang to select bash; the regression must prove the
  executor's extension dispatch chooses `bash`.

**Completion Criteria**:

- [x] The `.bash` regression script contains syntax that fails under
      `/bin/sh`.
- [x] The `.bash` regression script remains non-executable mode `0644`.
- [x] The test would fail if `.bash` dispatch used `sh <scriptPath>`.
- [x] Existing native command working-directory assertions remain intact.

### TASK-003: Verify Focused Behavior And Handoff Readiness

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Verification command results for the implementation step handoff.

**Dependencies**: TASK-002.

**Implementation Notes**:

- Run the targeted native executor gateway test first.
- Run typecheck because the touched test file is TypeScript.
- Consider package tests only as context if implementation touched package
  paths, which this plan does not require.

**Completion Criteria**:

- [x] `bun test packages/rielflow/src/workflow/native-node-executor-gateway.test.ts`
      passes.
- [x] `bun run typecheck` passes or any pre-existing unrelated failure is
      explicitly recorded with evidence.
- [x] Optional `bun run lint:biome` is run before final handoff when time
      allows.

## Dependencies

| Task | Depends On | Write Scope | Status |
| --- | --- | --- | --- |
| TASK-001 | None | Read-only inspection | COMPLETED |
| TASK-002 | TASK-001 | `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts` | COMPLETED |
| TASK-003 | TASK-002 | Verification only | COMPLETED |

No task is parallelizable because the only implementation write scope is a
single test file and verification depends on that edit.

## Verification Plan

Required:

```bash
bun test packages/rielflow/src/workflow/native-node-executor-gateway.test.ts
bun run typecheck
```

Optional before final handoff:

```bash
bun run lint:biome
```

Context-only if implementation unexpectedly touches package skill projection:

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
```

## Completion Criteria

- [x] The delegated mid-severity finding is closed by a bash-only `.bash`
      regression fixture.
- [x] The fixture remains non-executable at mode `0644`.
- [x] No package skill projection behavior is changed for this issue.
- [x] No unrelated dirty worktree changes are reverted or reformatted.
- [x] Required verification commands are run and recorded in the implementation
      step result.

## Progress Log

### Session: 2026-06-04 00:00

**Tasks Completed**: Plan created after Step 3 accepted the design.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implementation should update only the delegated native executor
gateway test path unless verification proves another path is directly required.

### Session: 2026-06-04 11:12 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added a dedicated non-executable `.bash` fixture writer using bash
array, `[[ ... ]]`, and `BASH` interpreter-name checks, asserted the fixture has
no execute bits, and kept the native command working-directory payload assertion
intact. Verification passed for the focused native executor gateway test,
typecheck, and Biome lint through `nix develop`.
