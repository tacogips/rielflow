# Session Health Command Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-session-health.md`
**Created**: 2026-05-04
**Last Updated**: 2026-05-04

---

## Design Document Reference

**Source**: `design-docs/specs/design-session-health.md`

### Summary

Implement GitHub issue `tacogips/divedra#6` by adding an operator-facing
`divedra session health <session-id>` inspection command. The command assembles
persisted workflow state, runtime DB progress evidence, bounded recent logs,
artifact/candidate timestamps, optional recent LLM session messages, and
explicit live/stall uncertainty into text and JSON output.

### Scope

**Included**: local CLI health command, reusable health assembly library,
bounded artifact scanning, conservative stall classification, optional LLM
message inclusion, user docs, and focused tests.

**Excluded**: remote `--endpoint` health support, adapter-specific process
liveness probes, mutation/remediation actions, and direct reads from
`codex-agent` private rollout files.

---

## Codex-Agent Reference Mapping

The design accepts `<reference-repository-root>` (for example
`../../codex-agent`) as behavioral
guidance only:

- `src/sdk/agent-runner.ts`: normalized session event shape.
- `src/rollout/reader.ts`: displayable conversation message separation.
- `src/session/search.ts`: bounded transcript/message scanning.
- `src/server/handlers/health.ts`: compact and explicit health status output.

Divedra implementation must read provider-neutral runtime DB
`llm_session_messages` produced by the existing adapter/runtime boundary from
`impl-plans/graphql-llm-session-messages.md`; it must not read Codex rollout
files directly.

---

## Modules

### 1. Health Assembly Library

#### `src/workflow/session-health.ts`

**Status**: Completed

```typescript
type SessionHealthState = "running" | "stalled" | "terminal" | "unknown";
type HealthConfidence = "high" | "medium" | "low" | "unknown";
type LiveSignalStatus = "unknown" | "not-proven" | "active" | "inactive";
type EvidenceSourceStatus = "available" | "missing" | "partial" | "disabled";

interface BuildSessionHealthInput {
  readonly sessionId: string;
  readonly options: LoadOptions;
  readonly live: boolean;
  readonly stallTimeoutMs?: number;
  readonly logLimit: number;
  readonly includeLlmMessages: boolean;
  readonly llmLimit: number;
  readonly observedAt?: string;
}

interface SessionHealthReport {
  readonly sessionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly status: WorkflowSessionState["status"];
  readonly currentStepId: string | null;
  readonly currentNodeId: string | null;
  readonly persistedState: SessionHealthPersistedState;
  readonly health: SessionHealthSummary;
  readonly activeNode: SessionHealthActiveNode;
  readonly liveSignal: SessionHealthLiveSignal;
  readonly progressSignal: SessionHealthProgressSignal;
  readonly artifacts: SessionHealthArtifactSummary;
  readonly recentLogs: readonly RuntimeNodeLogEntry[];
  readonly recentLlmMessages: readonly RuntimeLlmSessionMessageRecord[];
  readonly evidenceCompleteness: SessionHealthEvidenceCompleteness;
}
```

**Checklist**:

- [x] Load persisted session through existing `loadSession` root resolution.
- [x] Read runtime node executions, node logs, and LLM messages as best-effort evidence.
- [x] Identify active node execution by current step/node and latest non-terminal runtime row.
- [x] Derive last progress from session updates, workflow status transitions, runtime execution ends, accepted output mail, communication consumption, logs, LLM messages, and artifacts.
- [x] Compute conservative `running`, `stalled`, `terminal`, or `unknown` state without claiming live process liveness from timestamps.
- [x] Clamp `logLimit` and `llmLimit`; return bounded arrays in reverse-recent or documented stable order.
- [x] Mark source availability in `evidenceCompleteness`.
- [x] Unit tests in `src/workflow/session-health.test.ts`.

### 2. Artifact Freshness Scanner

#### `src/workflow/session-health.ts`

**Status**: Completed

```typescript
interface SessionHealthArtifactSummary {
  readonly latestArtifactAt: string | null;
  readonly latestCandidateAt: string | null;
  readonly activeArtifactDirs: readonly string[];
  readonly recentCandidatePaths: readonly string[];
  readonly recentOutputPaths: readonly string[];
}
```

**Checklist**:

- [x] Scan only active/recent node execution artifact directories from session and runtime DB rows.
- [x] Record latest modification timestamps for output, request, validation, and candidate files.
- [x] Avoid unbounded recursive traversal; enforce small per-directory and total file limits.
- [x] Treat missing artifact directories as partial/missing evidence, not command failure.
- [x] Cover missing artifacts and candidate freshness in tests.

### 3. CLI Command Surface

#### `src/cli.ts`

**Status**: Completed

```typescript
interface ParsedOptions {
  readonly live: boolean;
  readonly stallTimeoutMs?: number;
  readonly logLimit?: number;
  readonly includeLlmMessages: boolean;
  readonly llmLimit?: number;
}
```

**Checklist**:

- [x] Add `session health <session-id>` command branch beside status/progress/logs.
- [x] Parse `--live`, `--stall-timeout-ms`, `--log-limit`, `--include-llm-messages`, `--include-llm-history`, and `--llm-limit`.
- [x] Reject `--endpoint` with a clear local-only message.
- [x] Emit full `SessionHealthReport` for `--output json`.
- [x] Emit concise text summary with state, confidence, current step/node, last progress, stall timeout, live signal, artifact freshness, recommendation, and included counts.
- [x] Update help text and command usage.
- [x] CLI tests in `src/cli.test.ts`.

### 4. Public API and Docs

#### `src/lib.ts`, `README.md`, `design-docs/specs/command.md`

**Status**: Completed

```typescript
export {
  buildSessionHealthReport,
  type SessionHealthReport,
  type BuildSessionHealthInput,
} from "./workflow/session-health";
```

**Checklist**:

- [x] Export the reusable health helper from the package library API.
- [x] Document `divedra session health` usage and output modes.
- [x] Document that `--include-llm-messages` is opt-in because it may expose conversation content.
- [x] Document `--live` as best-effort and uncertainty-preserving.
- [x] Note that remote GraphQL health support is intentionally deferred.

### 5. Verification and Review Hardening

#### `src/workflow/session-health.test.ts`, `src/cli.test.ts`

**Status**: Completed

**Checklist**:

- [x] Test healthy running session with recent progress evidence.
- [x] Test stale running session reported as stalled only when a stall timeout is known.
- [x] Test terminal session reported as terminal.
- [x] Test missing runtime DB/artifacts returns partial evidence instead of failing.
- [x] Test optional LLM messages are omitted by default and included only with the flag.
- [x] Test CLI rejects remote `--endpoint`.
- [x] Run focused tests, typecheck, and diff whitespace verification.

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Health assembly | `src/workflow/session-health.ts` | Completed | `src/workflow/session-health.test.ts` |
| Artifact freshness | `src/workflow/session-health.ts` | Completed | `src/workflow/session-health.test.ts` |
| CLI surface | `src/cli.ts` | Completed | `src/cli.test.ts` |
| Public API/docs | `src/lib.ts`, `README.md`, `design-docs/specs/command.md` | Completed | typecheck/docs review |
| Review hardening | focused tests and verification commands | Completed | command results recorded |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Health assembly | accepted design, existing session store/runtime DB helpers, completed `graphql-llm-session-messages` plan | COMPLETED |
| Artifact freshness | health assembly active/recent execution selection | COMPLETED |
| CLI surface | health assembly report type and builder | COMPLETED |
| Public API/docs | health assembly and CLI option names | COMPLETED |
| Verification | implementation modules | COMPLETED |

## Task Breakdown

### TASK-001: Health Assembly and Stall Semantics

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/session-health.ts`,
`src/workflow/session-health.test.ts`

**Completion Criteria**:

- [x] `buildSessionHealthReport` returns the accepted JSON shape.
- [x] Last-progress and stall classification include accepted output mail, communication consumption, and workflow status transition evidence.
- [x] Terminal sessions bypass stall classification.
- [x] Unknown live state remains `unknown` or `not-proven` unless a supported probe proves otherwise.
- [x] Missing runtime DB evidence is surfaced through `evidenceCompleteness`.

### TASK-002: Bounded Artifact and Candidate Freshness

**Status**: Completed
**Parallelizable**: No
**Depends On**: TASK-001
**Deliverables**: `src/workflow/session-health.ts`,
`src/workflow/session-health.test.ts`

**Completion Criteria**:

- [x] Artifact scanning is bounded to active/recent execution directories.
- [x] Latest artifact and candidate timestamps are included when present.
- [x] Missing artifact paths degrade to partial/missing evidence.

### TASK-003: CLI Parser and Output Formatting

**Status**: Completed
**Parallelizable**: No
**Depends On**: TASK-001, TASK-002
**Deliverables**: `src/cli.ts`, `src/cli.test.ts`

**Completion Criteria**:

- [x] `divedra session health <session-id>` supports documented options.
- [x] `--output json` emits the full report.
- [x] Text output is bounded and operator-facing.
- [x] Remote `--endpoint` is rejected in the first implementation slice.

### TASK-004: API Export and Documentation

**Status**: Completed
**Parallelizable**: No
**Depends On**: TASK-001
**Deliverables**: `src/lib.ts`, `README.md`, `design-docs/specs/command.md`

**Completion Criteria**:

- [x] Health builder/types are exported from `src/lib.ts`.
- [x] CLI docs cover flags, uncertainty, and privacy of LLM messages.
- [x] Documentation preserves compatibility of existing session commands.

### TASK-005: Final Verification

**Status**: Completed
**Parallelizable**: No
**Depends On**: TASK-001, TASK-002, TASK-003, TASK-004
**Deliverables**: verification results in this plan's progress log

**Completion Criteria**:

- [x] `bun test src/workflow/session-health.test.ts src/cli.test.ts`
- [x] `bun run typecheck`
- [x] `git diff --check`
- [x] Progress log updated with completed tasks and residual risks.

## Parallelizable Tasks

| Task | Parallelizable | Reason |
| ---- | -------------- | ------ |
| TASK-001 | No | Establishes shared report contract and core semantics. |
| TASK-002 | No | Modifies the same health module as TASK-001 and depends on execution selection. |
| TASK-003 | No | Depends on the report builder and modifies shared CLI parser/dispatch. |
| TASK-004 | No | Depends on TASK-001 for stable exported names and report semantics, though write scope is disjoint from CLI formatting. |
| TASK-005 | No | Requires all implementation work. |

## Verification Plan

- `bun test src/workflow/session-health.test.ts`
- `bun test src/cli.test.ts`
- `bun test src/workflow/session-health.test.ts src/cli.test.ts`
- `bun run typecheck`
- `git diff --check`

## Completion Criteria

- [x] Issue `tacogips/divedra#6` has an active implementation plan linked to the accepted design.
- [x] CLI health command produces conservative text and JSON output.
- [x] Health report includes persisted state, live signal, progress signal, artifacts, logs, optional LLM messages, and evidence completeness.
- [x] The implementation does not read `codex-agent` private rollout files.
- [x] Existing `session status`, `session progress`, and `session logs` behavior remains compatible.
- [x] Focused tests and typecheck pass.

## Progress Log

### Session: 2026-05-04

**Tasks Completed**: Created active implementation plan for GitHub issue #6 after design review acceptance.
**Tasks In Progress**: None; implementation is ready for a later step.
**Blockers**: None.
**Notes**: Plan traces optional LLM message behavior to completed `graphql-llm-session-messages` runtime indexing and keeps live state conservative until explicit probes exist.

### Session: 2026-05-04 Step 5 Review Revision

**Tasks Completed**: Addressed Step 5 mid finding from `comm-000008` by adding accepted output mail, communication consumption, and workflow status transitions to TASK-001 last-progress and stall-classification evidence.
**Tasks In Progress**: None; implementation remains ready for the next workflow step.
**Blockers**: None.
**Notes**: Preserved the provider-neutral `llm_session_messages` boundary and the prohibition on direct `codex-agent` rollout-file reads.

### Session: 2026-05-04 12:04 JST Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented the local `session health` report builder, bounded artifact freshness scanning, CLI parser/output surface, package exports, docs, and focused tests. Verified with `bun test src/workflow/session-health.test.ts`, `bun test src/cli.test.ts -t "session health"`, `HOME=/private/tmp/divedra-test-home bun test src/workflow/session-health.test.ts src/cli.test.ts`, `bun run typecheck`, and `git diff --check`. The unscoped combined test command needs a writable HOME in this sandbox because the unrelated hook test writes to the user runtime root.

## Related Plans

- **Depends On**: `impl-plans/graphql-llm-session-messages.md`
- **Related**: `impl-plans/completed/auto-improve-superviser-mode.md`
- **Related**: `impl-plans/completed/workflow-overview-status-surface.md`
