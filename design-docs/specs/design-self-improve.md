# Dedicated Workflow Self-Improve Design

This document defines the dedicated `divedra` self-improve capability for retrospective workflow quality analysis and optional workflow-definition improvement.

## Overview

Self-improve is separate from supervisor and auto-improve execution. Supervisor and auto-improve operate during a live workflow run to keep that run moving or remediate a failure. Self-improve runs after workflow executions exist, inspects recent run results, judges whether the workflow achieved its authored purpose, writes reports about workflow structure and prompts, and may patch the canonical workflow bundle when explicitly enabled.

The feature is available through three equivalent entrypoints:

- CLI: `divedra workflow self-improve <workflow-name>`
- GraphQL while `divedra serve` is running: `executeWorkflowSelfImprove`
- library API: `executeWorkflowSelfImprove()`

All entrypoints resolve the same workflow bundle, runtime storage context, source-run selection, report schema, backup rules, validation rules, and optional patch mode.

## Product Boundary

Self-improve owns retrospective workflow learning and workflow authoring feedback. It does not own live retry, stall recovery, or target workflow lifecycle control.

Auto-improve remains tied to a specific supervised run. It may rerun, target a step, or patch an execution copy or canonical bundle during that supervised cycle according to the auto-improve policy.

Self-improve:

- reads completed and failed workflow run artifacts after the fact
- compares observed outcomes with the workflow `description`, step descriptions, output contracts, and prompt intent
- produces durable reports even when no patch is applied
- may patch the workflow bundle only when policy allows `report-and-auto-improve`
- always backs up the pre-change workflow bundle before any canonical workflow modification
- commits modifications when the workflow directory is inside a git worktree

## Workflow Configuration

Workflow bundles may declare self-improve defaults under `workflow.defaults.selfImprove`.

Shape:

```json
{
  "defaults": {
    "selfImprove": {
      "enabled": true,
      "mode": "report-only",
      "defaultLogLimit": 10
    }
  }
}
```

Fields:

- `enabled?: boolean`
  - default: `false`
  - when `false`, automatic or scheduled self-improve for that workflow is disabled
  - direct CLI, GraphQL, or library calls may still run when the caller passes an explicit override
- `mode?: "report-only" | "report-and-auto-improve"`
  - default: `report-only`
  - `report-only` writes analysis and recommendations without modifying the workflow bundle
  - `report-and-auto-improve` allows the engine to apply validated workflow edits
- `defaultLogLimit?: number`
  - default: global self-improve default, initially `10`
  - must be a positive integer
  - controls the latest-run fallback when no previous self-improve marker exists, and caps explicit latest-run selection

Validation rejects unknown `defaults.selfImprove` fields, disabled-but-invalid nested values, non-positive limits, and unsupported modes. Validation does not reject a workflow merely because self-improve is disabled.

## Source Run Selection

Self-improve reads workflow run records from the same runtime session/artifact store used by `workflow status`, `session status`, and GraphQL inspection. File artifacts remain authoritative; runtime DB rows are an index.

Default source selection is `since-last-or-latest`:

1. Resolve the target workflow and stable workflow directory identity.
2. Find the latest successful self-improve marker for that workflow directory.
3. If a marker exists, select workflow runs newer than that marker.
4. If no marker exists, select the latest `defaultLogLimit` workflow runs.

Caller options may override this with:

- `sourceMode: "since-last" | "latest" | "explicit"`
- `limit`
- explicit workflow execution ids

The CLI exposes these as `--since-last`, `--latest`, `--limit <n>`, and repeated `--session <workflow-execution-id>`. Explicit ids bypass latest/since-last discovery but still require the selected runs to belong to the resolved workflow unless `--allow-cross-workflow` is added in a future design.

## Analysis and Report

Each self-improve execution receives a generated `selfImproveId` and writes artifacts under:

```text
<user-root>/self-improve-log/<workflow-directory-name>/<self-improve-id>/
  input-runs.json
  report.json
  report.md
  backup/
  patch/
  marker.json
```

`<user-root>` defaults to `~/.divedra`. The workflow directory name is sanitized from the final workflow directory segment plus a short hash of the absolute resolved directory so same-named workflows from different scopes do not collide.

The report includes:

- workflow identity, source scope, workflow directory, and self-improve id
- selected source runs with session ids, statuses, timestamps, and artifact refs
- purpose-achievement judgment: `achieved`, `partially-achieved`, `not-achieved`, or `unknown`
- workflow problem findings with severity, evidence run ids, and affected steps/nodes/prompts
- workflow structure findings, including routing, timeout, optional-step, and output-contract issues
- prompt findings, including missing context, overbroad instructions, inconsistent output contracts, and brittle handoff text
- recommended actions
- patch summary when `report-and-auto-improve` applies changes
- validation and git/backup results

The purpose-achievement judge must cite concrete source-run evidence. If evidence is insufficient, it records `unknown` rather than inventing success or failure.

## Optional Auto-Improve

In `report-and-auto-improve` mode, self-improve may edit canonical workflow files only after report generation identifies at least one actionable workflow-definition or prompt issue.

Patch rules:

- allowed write set is the resolved workflow directory only
- patch candidates are validated before write when possible and always validated after write
- generated patches may update `workflow.json`, `steps/*.json`, `nodes/node-*.json`, and workflow-local `prompts/*.md`
- runtime session artifacts, global config, source code, and other workflows are out of scope
- if validation fails after applying a patch, restore from backup and mark the report as `patch-reverted`
- do not push git commits; commit creation is local only

Backup rules:

- create `backup/` before modifying any workflow file
- backup the complete workflow directory contents, excluding nested `.git` metadata
- backups are required for both git-managed and non-git-managed workflow directories
- for non-git-managed workflows, the backup under `<user-root>/self-improve-log/<workflow-directory-name>/<self-improve-id>/backup/` is the recovery source

Git rules:

- detect git management by running repository discovery from the resolved workflow directory
- if a git repository owns the workflow directory, commit only the workflow-file changes made by this self-improve execution
- the commit message must identify the workflow name and self-improve id without automated-assistant attribution
- do not stage unrelated repository changes
- if commit fails after files were changed and validation passed, keep the changes, record `gitCommitStatus: "failed"`, and surface the failure in the report

## Public API Contract

The provider-neutral core service is the source of truth:

- `executeWorkflowSelfImprove(input): Promise<WorkflowSelfImproveResult>`
- `getWorkflowSelfImproveReport(input): Promise<WorkflowSelfImproveReport>`
- `listWorkflowSelfImproveReports(input): Promise<WorkflowSelfImproveReportSummary[]>`

CLI and GraphQL are adapters over this service. GraphQL should expose typed input and result objects rather than a freeform manager message. The served API must respect `serve --read-only` by allowing report listing/reading but rejecting new self-improve executions that would write reports or mutate workflow bundles. `serve --no-exec` rejects self-improve execution because analysis may invoke an agent backend.

## Codex-Agent Reference Mapping

The local `codex-agent` reference is useful for structural patterns only:

- `src/session/index.ts` and `src/session/sqlite.ts`: hybrid latest-session discovery and SQLite-index fallback
- `src/session/search.ts`: transcript search with DB-first and filesystem fallback
- `src/rollout/reader.ts`: resilient JSONL transcript parsing and message extraction
- `src/file-changes/service.ts` and `src/file-changes/extractor.ts`: deriving file-change summaries from session history
- `src/queue/runner.ts`: queued prompt execution and durable progress events
- `src/main.ts`: library facade exports

Divedra must not copy Codex rollout formats into workflow self-improve. Divedra source runs come from divedra session/artifact stores, and backend-specific transcript readers stay behind existing agent adapter boundaries.

## Cursor CLI Adapter Boundary

Self-improve may report that a workflow should change model/backend settings, but backend-specific behavior stays isolated behind adapter validation. Cursor CLI auth, model probing, effort mapping, and process flags must not leak into self-improve report schema or workflow JSON beyond the existing `executionBackend`, `model`, and `effort` fields. Any Codex-to-Cursor recommendation must pass the same node validation and runtime-readiness probes as ordinary authored or `--node-patch` configuration.

## Rollout Constraints

- ship report-only first if patch safety or git commit behavior is incomplete
- keep report schema stable before enabling automated patches by default
- add tests for source-run selection, workflow config validation, backup creation, git-managed commit behavior, GraphQL read-only/no-exec rejection, and library/CLI parity
- documentation must keep self-improve distinct from `workflow run --auto-improve`
