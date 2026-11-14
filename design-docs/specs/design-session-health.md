# Session Health Command

Design for GitHub issue `tacogips/divedra#6`: add an operator-facing session
health command that summarizes workflow state, stall evidence, recent logs,
artifact freshness, and optional recent LLM messages.

## Overview

`session health <session-id>` is a diagnostic surface between the terse
`session status` snapshot and the detailed `session logs` / GraphQL inspection
surfaces. It answers: "Is this run making progress, stale, terminal, or
unknown?" without requiring the operator to manually correlate session JSON,
runtime DB rows, process logs, and output-attempt artifacts.

The command is intentionally conservative. It may show evidence that suggests a
stall, but it must not claim a backend process is alive or dead unless that is
proven by a supported live signal. In the first implementation slice, persisted
runtime state and artifact timestamps are authoritative; process liveness is
reported as unknown unless a later adapter-specific live check is added.

## Command Contract

Command:

```bash
divedra session health <session-id> [--live] [--output text|json] [--stall-timeout-ms <ms>] [--log-limit <n>] [--include-llm-messages] [--llm-limit <n>]
```

Behavior:

- Load the persisted workflow session using the same root resolution rules as
  `session status`.
- Reject `--endpoint` in the first slice; remote health requires a future
  GraphQL health query with the same output contract.
- Default to bounded text for humans and full bounded JSON for automation.
- Default `--include-llm-messages` to false so normal health output does not
  expose conversation content unexpectedly.
- Accept `--include-llm-history` as a temporary compatibility alias only if it
  can be implemented without ambiguity; document `--include-llm-messages` as the
  canonical flag.
- Treat `--live` as an opt-in best-effort probe. If no supported local live
  signal exists for the backend, the output must say that live state is
  `unknown` or `not-proven`; it must not infer process liveness from timestamps.
- Clamp log and LLM message limits to small, documented ranges to keep output
  stable and avoid expensive scans.

## Data Sources

The health view reads from existing local runtime surfaces first:

- session store: workflow id/name, status, queue, current step/node, counters,
  supervision state, `lastError`, `startedAt`, `endedAt`
- runtime DB sessions and node executions: `updated_at`, node execution status,
  step id, node exec id, backend session id, artifact directory, start/end
  timestamps, elapsed time, timeout budget, and restart/stall metadata when
  present
- runtime DB node logs and process logs: recent bounded execution diagnostics
- runtime DB LLM session messages: recent bounded backend messages when
  `--include-llm-messages` is set
- artifact filesystem: latest modification timestamps under active node
  execution directories and output-attempt candidate/request/validation files

Runtime DB rows remain best-effort. If the runtime DB is missing or incomplete,
the command must still return a health object with `evidenceCompleteness`
marking which sources were unavailable.

## JSON Shape

`--output json` should return one object:

```json
{
  "sessionId": "div-review-...",
  "workflowId": "review",
  "workflowName": "review",
  "status": "running",
  "currentStepId": "implement",
  "currentNodeId": "implement-worker",
  "persistedState": {
    "status": "running",
    "queue": [],
    "restartCount": 0,
    "lastCompletedStepId": "design-review",
    "lastError": null,
    "supervision": {
      "autoImprove": true,
      "nestedSuperviser": true,
      "stallTimeoutMs": 120000
    }
  },
  "health": {
    "state": "running|stalled|terminal|unknown",
    "confidence": "high|medium|low|unknown",
    "reason": "no progress evidence for 120000ms",
    "observedAt": "2026-05-04T00:00:00.000Z",
    "recommendation": "wait|inspect_logs|rerun_step|resume_session|terminate_orphan|unknown"
  },
  "activeNode": {
    "known": true,
    "stepId": "implement",
    "nodeId": "implement-worker",
    "nodeExecId": "node-exec-001",
    "backend": "codex-agent",
    "backendSessionId": "codex-session-id",
    "startedAt": "2026-05-04T00:00:00.000Z",
    "elapsedMs": 45000,
    "timeoutMs": 600000,
    "stalled": false
  },
  "liveSignal": {
    "status": "unknown|not-proven|active|inactive",
    "confidence": "unknown|low|medium|high",
    "source": "not-requested|persisted-runtime-state|adapter-live-check|process-table|not-supported",
    "requested": false
  },
  "progressSignal": {
    "lastProgressAt": "2026-05-04T00:00:00.000Z",
    "lastProgressSource": "node-execution-ended|node-log|llm-message|artifact|session-updated",
    "stallTimeoutMs": 120000,
    "stalled": false
  },
  "artifacts": {
    "latestArtifactAt": "2026-05-04T00:00:00.000Z",
    "latestCandidateAt": "2026-05-04T00:00:00.000Z",
    "activeArtifactDirs": [],
    "recentCandidatePaths": [],
    "recentOutputPaths": []
  },
  "recentLogs": [],
  "recentLlmMessages": [],
  "evidenceCompleteness": {
    "sessionStore": "available",
    "runtimeDb": "available|missing|partial",
    "artifacts": "available|missing|partial",
    "processLogs": "available|missing|partial",
    "llmMessages": "disabled|available|missing"
  }
}
```

Text output should print the same top-level conclusions first: session id,
workflow, persisted status, health state, confidence, current step, active node
if known, elapsed time, timeout budget, last progress time, stall threshold,
live signal, latest artifact/candidate time, recommendation, and counts for
included logs and LLM messages.

## Stall Semantics

`session health` reuses the auto-improve design's preferred stall signal:

- no node execution completion,
- no accepted output mail,
- no communication consumption,
- no workflow status transition,
- and no newer artifact/log/LLM-message evidence within `stallTimeoutMs`.

The health command is observational. It does not create supervision incidents,
rerun steps, patch workflows, or mutate session state. When the session is
terminal, `health.state` is `terminal` and stall checks are informational only.

If `--stall-timeout-ms` is omitted, the command should prefer the persisted
auto-improve policy timeout when present. Otherwise it may report
`health.state = "unknown"` with `progressSignal.stallTimeoutMs = null`, because
there is no issue-provided universal default.

The `activeNode.stalled` value is separate from `health.state`. It may be
`unknown` when the runtime can identify a running node execution but cannot prove
whether the backend is still producing progress. A fresh LLM message, runtime
log, or candidate artifact can lower the likelihood of a stall but does not by
itself prove a live process.

## Operator Recommendations

Recommendations are derived from evidence and must remain conservative:

- `wait`: non-terminal session has recent progress evidence or an active node
  within timeout budget.
- `inspect_logs`: progress is old, evidence is partial, or the latest error/log
  points to a recoverable backend problem.
- `rerun_step`: a terminal failed step or exhausted output attempt is visible.
- `resume_session`: persisted state is paused or interrupted and no active live
  evidence is proven.
- `terminate_orphan`: only when `--live` proves an inactive/contradictory local
  backend process state; do not recommend termination from stale timestamps
  alone.
- `unknown`: evidence is too incomplete to suggest a next action.

## Codex-Agent Reference Mapping

The local reference repository `<reference-repository-root>` (for example
`../../codex-agent`) provides
behavioral guidance, not copy/paste implementation:

- `src/sdk/agent-runner.ts` emits normalized session events such as
  `session.started`, `assistant.snapshot`, `assistant.delta`, tool events, and
  `session.completed`.
- `src/rollout/reader.ts` maps Codex rollout records into user/assistant
  message provenance and separates framework events from displayable
  conversation messages.
- `src/session/search.ts` performs bounded transcript scanning and extracts
  searchable user/assistant text without loading unbounded history.
- `src/server/handlers/health.ts` keeps process health/status output small and
  explicit.

Divedra should use those patterns through its adapter and runtime DB boundaries:
`codex-agent` normalized events are converted to divedra
`llm_session_messages` by adapter/runtime indexing, and `session health` reads
the provider-neutral divedra index. It must not read codex-agent private rollout
files directly.

## Rollout Constraints

- Keep existing `session status`, `session progress`, and `session logs`
  behavior compatible.
- Add focused tests for healthy running, stale running, terminal, missing
  runtime DB, missing artifacts, and optional LLM message inclusion.
- Prefer a library helper that can be reused by CLI and future GraphQL rather
  than embedding health assembly only in `src/cli.ts`.
- Keep recursive artifact scanning bounded to active/recent node execution
  artifact directories.
