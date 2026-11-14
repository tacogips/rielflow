# Adapter Reused Session Prompt Splitting Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#local-agent-prompt-splitting-on-reused-sessions`
**Created**: 2026-05-28
**Last Updated**: 2026-05-28

## Design Document Reference

Implement the accepted issue-resolution design for local agent adapters that
forward a separate backend `systemPrompt` field. Reused backend sessions must
resume with the per-turn user prompt only, while keeping stable system prompt
text in backend runner options.

Source of truth:

- `design-docs/specs/architecture.md:1262`: local agent prompt splitting on reused sessions.
- Cross-workflow review handoff:
  `codex-recent-change-quality-loop/div-codex-recent-change-quality-loop-1779948622-fae615cb`.

Scope boundaries:

- Include `packages/rielflow-adapters/src/codex.ts`.
- Include `packages/rielflow-adapters/src/cursor.ts`.
- Include adapter regression tests in
  `packages/rielflow/src/workflow/adapters/codex.test.ts` and
  `packages/rielflow/src/workflow/adapters/cursor.test.ts`.
- Optionally refresh the surrounding Adapter Layer source list in
  `design-docs/specs/architecture.md` if the final documentation step has not
  already done it.
- Do not copy implementation code from `codex-agent` or `cursor-cli-agent`.
- Do not change unrelated backend behavior for Claude, SDK adapters, output
  validation, or workflow session-state persistence.

## Codex And Cursor Reference Trail

- `node_modules/codex-agent/src/process/manager.ts:293`: Codex start prompt
  assembly appends `options.systemPrompt` to the supplied prompt.
- `node_modules/codex-agent/src/process/manager.ts:309`: Codex resume prompt
  assembly appends `options.systemPrompt` to the supplied prompt.
- `node_modules/codex-agent/src/process/manager.ts:315`: Codex helper
  concatenates system prompt and prompt text.
- `node_modules/cursor-cli-agent/src/cursor/process-runner.ts:185`: Cursor
  start path applies final prompt assembly with `systemPrompt`.
- `node_modules/cursor-cli-agent/src/cursor/process-runner.ts:342`: Cursor
  resume path applies final prompt assembly with `systemPrompt`.

Intentional divergence:

- Rielflow uses these packages as behavioral references only. Each adapter keeps
  its backend-specific request translation instead of introducing a shared
  local-agent prompt helper in this issue.

## Modules

### 1. Codex Adapter Resume Prompt Split

#### `packages/rielflow-adapters/src/codex.ts`

**Status**: COMPLETED

Relevant local shape:

```typescript
function resolveLocalSessionConfig(
  config: CodexAdapterConfig,
  input: AdapterExecutionInput,
): {
  readonly promptText: string;
  readonly sessionConfig: CodexSessionConfig;
}
```

Checklist:

- [x] Preserve `sessionConfig.prompt = input.promptText` for first-turn starts.
- [x] Preserve `sessionConfig.systemPrompt = input.systemPromptText` when present.
- [x] Change backend-session reuse to call `resumeSession(sessionId, input.promptText, buildResumeSessionOptions(sessionConfig))`.
- [x] Keep `buildCombinedPromptText(input)` available for adapter output metadata or backends that lack a separate `systemPrompt`, but do not pass it as the Codex resume prompt when `systemPrompt` is forwarded separately.
- [x] Preserve stall-watch nudge resume calls so they keep using the watcher-provided nudge prompt and the existing resume options.

### 2. Cursor Adapter Resume Prompt Split

#### `packages/rielflow-adapters/src/cursor.ts`

**Status**: COMPLETED

Relevant local shape:

```typescript
function resolveLocalSessionConfig(
  config: CursorAdapterConfig,
  input: AdapterExecutionInput,
): {
  readonly promptText: string;
  readonly startRequest: CursorAgentRequest;
  readonly baseResumeRequest: Omit<CursorAgentRequest, "prompt" | "sessionId">;
}
```

Checklist:

- [x] Preserve `startRequest.prompt = input.promptText` for first-turn starts.
- [x] Preserve `baseResumeRequest.systemPrompt = input.systemPromptText` when present.
- [x] Change backend-session reuse to call `runner.resume({ ...baseResumeRequest, sessionId, prompt: input.promptText })`.
- [x] Keep Cursor-specific request translation isolated in this adapter.
- [x] Preserve any stall or interrupt behavior that uses explicit prompt arguments.

### 3. Codex Regression Coverage

#### `packages/rielflow/src/workflow/adapters/codex.test.ts`

**Status**: COMPLETED

Checklist:

- [x] Add or update a backend-session reuse test with `systemPromptText: "system"`.
- [x] Assert `resumeSession` receives prompt argument `"hello"`, not `"system\n\nhello"`.
- [x] Assert resume options still include `systemPrompt: "system"`.
- [x] Assert output `promptText` remains the combined audit value if that is the adapter contract.
- [x] Keep existing stall-watch tests asserting nudge prompts such as `"continue now"` and environment nudge prompts are passed unchanged.

### 4. Cursor Regression Coverage

#### `packages/rielflow/src/workflow/adapters/cursor.test.ts`

**Status**: COMPLETED

Checklist:

- [x] Add or update a backend-session reuse test with `systemPromptText: "system"`.
- [x] Assert `runner.resume` receives `prompt: "hello"`, not `"system\n\nhello"`.
- [x] Assert resume request still includes `systemPrompt: "system"`.
- [x] Assert output `promptText` remains the combined audit value if that is the adapter contract.

### 5. Documentation Consistency Follow-Up

#### `design-docs/specs/architecture.md`

**Status**: OPTIONAL

Checklist:

- [ ] If still stale during implementation, refresh the Adapter Layer source list
      around `design-docs/specs/architecture.md:1227` so it mentions
      `packages/rielflow-adapters/src/*` in addition to, or instead of, the
      legacy `packages/rielflow/src/workflow/adapters/*` path.
- [ ] Do not reopen the accepted design section unless implementation discovers
      a genuine contract mismatch.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Codex resume prompt split | `packages/rielflow-adapters/src/codex.ts` | COMPLETED | `packages/rielflow/src/workflow/adapters/codex.test.ts` |
| Cursor resume prompt split | `packages/rielflow-adapters/src/cursor.ts` | COMPLETED | `packages/rielflow/src/workflow/adapters/cursor.test.ts` |
| Codex regression coverage | `packages/rielflow/src/workflow/adapters/codex.test.ts` | COMPLETED | focused adapter test |
| Cursor regression coverage | `packages/rielflow/src/workflow/adapters/cursor.test.ts` | COMPLETED | focused adapter test |
| Documentation consistency | `design-docs/specs/architecture.md` | OPTIONAL | diff review |

## Task Breakdown

### TASK-001: Codex Resume Prompt Split

**Status**: COMPLETED
**Parallelizable**: Yes, only with TASK-002 and TASK-004 because write scopes are disjoint.
**Deliverables**: `packages/rielflow-adapters/src/codex.ts`
**Dependencies**: Accepted design review from Step 3.

Completion criteria:

- [x] Reused Codex sessions pass `input.promptText` as the resume prompt.
- [x] Codex resume options still forward `systemPrompt`.
- [x] Codex stall-watch nudge prompt paths remain unchanged.

### TASK-002: Cursor Resume Prompt Split

**Status**: COMPLETED
**Parallelizable**: Yes, only with TASK-001 and TASK-003 because write scopes are disjoint.
**Deliverables**: `packages/rielflow-adapters/src/cursor.ts`
**Dependencies**: Accepted design review from Step 3.

Completion criteria:

- [x] Reused Cursor sessions pass `input.promptText` as the resume prompt.
- [x] Cursor resume request still forwards `systemPrompt`.
- [x] Cursor adapter keeps backend-specific request translation local.

### TASK-003: Codex Regression Test

**Status**: COMPLETED
**Parallelizable**: Yes, only with TASK-002 because write scopes are disjoint.
**Deliverables**: `packages/rielflow/src/workflow/adapters/codex.test.ts`
**Dependencies**: TASK-001 contract.

Completion criteria:

- [x] Test fails against the duplicated-system-prompt behavior.
- [x] Test passes when Codex resume receives user prompt and system prompt separately.
- [x] Existing Codex stall nudge tests still pass.

### TASK-004: Cursor Regression Test

**Status**: COMPLETED
**Parallelizable**: Yes, only with TASK-001 because write scopes are disjoint.
**Deliverables**: `packages/rielflow/src/workflow/adapters/cursor.test.ts`
**Dependencies**: TASK-002 contract.

Completion criteria:

- [x] Test fails against the duplicated-system-prompt behavior.
- [x] Test passes when Cursor resume receives user prompt and system prompt separately.

### TASK-005: Documentation Consistency Check

**Status**: OPTIONAL
**Parallelizable**: Yes, after implementation files are settled.
**Deliverables**: `design-docs/specs/architecture.md`
**Dependencies**: Step 3 low-severity feedback.

Completion criteria:

- [ ] Adapter Layer source list no longer misleads readers about current adapter package paths.
- [ ] No accepted design requirement is weakened.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001 Codex implementation | Step 3 accepted design | READY |
| TASK-002 Cursor implementation | Step 3 accepted design | READY |
| TASK-003 Codex test | TASK-001 contract | READY |
| TASK-004 Cursor test | TASK-002 contract | READY |
| TASK-005 documentation consistency | Step 3 low feedback | OPTIONAL |

## Parallelization Rules

- TASK-001 and TASK-002 may run in parallel because they edit different adapter files.
- TASK-003 and TASK-004 may run in parallel because they edit different test files.
- TASK-003 should not run in parallel with TASK-001 if the same worker is expected
  to update Codex implementation and tests atomically.
- TASK-004 should not run in parallel with TASK-002 if the same worker is expected
  to update Cursor implementation and tests atomically.
- TASK-005 may run independently after the required behavior changes are clear.

## Verification Plan

Required commands:

```bash
bun test packages/rielflow/src/workflow/adapters/codex.test.ts packages/rielflow/src/workflow/adapters/cursor.test.ts
bun test packages/rielflow/src/workflow/adapters/claude.test.ts
bun run typecheck
git diff -- packages/rielflow-adapters/src/codex.ts packages/rielflow-adapters/src/cursor.ts packages/rielflow/src/workflow/adapters/codex.test.ts packages/rielflow/src/workflow/adapters/cursor.test.ts design-docs/specs/architecture.md
```

Recommended additional checks:

```bash
git diff --check
```

## Completion Criteria

- [x] `packages/rielflow-adapters/src/codex.ts` no longer sends combined system-plus-user text as the reused-session resume prompt when `systemPrompt` is also forwarded.
- [x] `packages/rielflow-adapters/src/cursor.ts` no longer sends combined system-plus-user text as the reused-session resume prompt when `systemPrompt` is also forwarded.
- [x] Codex regression coverage proves resume prompt and system prompt stay separate.
- [x] Cursor regression coverage proves resume prompt and system prompt stay separate.
- [x] Stall-watch nudge prompts remain explicit nudge prompts, not replaced by original node prompt text.
- [x] Required focused tests pass.
- [x] Typecheck passes.
- [x] Plan progress log is updated by the implementation step with commands run and results.

## Progress Log Expectations

Each implementation session must append a dated entry with:

- tasks completed
- files changed
- verification commands run and pass/fail results
- any accepted divergences from this plan
- any unresolved TODOs with file paths

## Progress Log

### Session: 2026-05-28

**Tasks Completed**: Plan created from accepted Step 3 design.
**Notes**: No implementation code was changed in this planning step.

### Session: 2026-05-28 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004.
**Files Changed**: `packages/rielflow-adapters/src/codex.ts`, `packages/rielflow-adapters/src/cursor.ts`, `packages/rielflow/src/workflow/adapters/codex.test.ts`, `packages/rielflow/src/workflow/adapters/cursor.test.ts`.
**Verification**: `bun test packages/rielflow/src/workflow/adapters/codex.test.ts packages/rielflow/src/workflow/adapters/cursor.test.ts` passed; `bun test packages/rielflow/src/workflow/adapters/claude.test.ts` passed; `bun run typecheck` passed; `biome check packages/rielflow-adapters/src/codex.ts packages/rielflow-adapters/src/cursor.ts packages/rielflow/src/workflow/adapters/codex.test.ts packages/rielflow/src/workflow/adapters/cursor.test.ts --diagnostic-level=warn` passed for edited files; `git diff --check` passed.
**Notes**: Reused Codex and Cursor backend sessions now pass the user prompt only while preserving `systemPrompt` in backend options. `bun run lint:biome` was also run and failed on unrelated existing formatting/file-length issues outside the edited adapter files.
**Unresolved TODOs**: None for the required issue-resolution scope.

### Session: 2026-05-29 Finalization

**Tasks Completed**: Archived completed plan after verifying current worktree state.
**Files Changed**: `impl-plans/completed/adapter-reused-session-prompt-splitting.md`, `impl-plans/README.md`.
**Verification**: Passed `bun test packages/rielflow/src/workflow/adapters/codex.test.ts packages/rielflow/src/workflow/adapters/cursor.test.ts`; passed `bun test packages/rielflow/src/workflow/adapters/claude.test.ts`; passed `bun run typecheck`; passed focused `biome check` for the edited adapter and regression-test files; passed `git diff --check`.
**Notes**: Full-repo `bun run lint:biome` still fails on unrelated existing formatting diagnostics and the existing `noExcessiveLinesPerFile` diagnostic in `packages/rielflow/src/workflow/validate/node-payload-validation.ts`.
**Unresolved TODOs**: None for this plan.
