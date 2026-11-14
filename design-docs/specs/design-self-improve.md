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

## Issue-Resolution Hardening Criteria

The feature review for "Review and improve dedicated self-improve feature" should preserve the above boundary while closing integration and safety gaps. Implementation and review should treat the following as acceptance gates:

- every CLI, GraphQL, and library entrypoint must normalize to the same core service input, including workflow resolution, mode, source selection, limits, command/API overrides, disabled-workflow override, log root, and output shape
- endpoint-backed CLI and library calls must use the typed GraphQL self-improve mutation/query contract rather than manager-message shortcuts
- `serve --read-only` must allow report listing and reading but reject new self-improve execution because execution writes report artifacts and may mutate workflow files
- `serve --no-exec` must reject self-improve execution because analysis can invoke agent backends, even in report-only mode
- runtime validation must reject invalid public `mode`, `sourceMode`, `limit`, and explicit session inputs before any report, backup, patch, marker, or git side effect
- source-run analysis must include workflow-level status plus node execution and output-validation evidence so the purpose-achievement judgment is tied to concrete run outcomes
- `since-last-or-latest` must not reanalyze old runs when a successful marker exists but no newer runs are present; it should return an empty selected-run set for that workflow identity
- explicit source sessions must belong to the resolved workflow identity; cross-workflow analysis remains out of scope until a separate design adds it
- report-only mode must never create workflow backups, apply patches, or create git commits
- report-and-auto-improve must create a backup before the first canonical workflow write, restore from that backup after validation failure or patch-time exception, and preserve repository metadata such as `.git`
- prompt-file workflows must patch workflow-local `promptTemplateFile` targets directly instead of replacing them with large embedded prompt templates
- git commit logic must stage only files changed by the current self-improve execution, must not push, and must not add automated-assistant attribution or co-authorship trailers
- marker writes must represent successful self-improve completion for the resolved workflow identity; failed, reverted, or rejected executions must not advance the since-last boundary

## Shared Function Reuse Audit

The issue "Audit self-improve implementation for duplicated existing functionality" is an integration hardening pass, not a request to broaden the product boundary. The implementation should prefer existing divedra workflow helpers for common behavior and keep self-improve code responsible only for retrospective policy, report shape, and canonical workflow edit orchestration.

Audit decisions:

- `src/workflow/self-improve/patcher.ts` must not grow an independent workflow-edit validation model. Self-improve patch operations are intentionally different from invocation-scoped node setting overlays in `src/workflow/node-patches.ts`, because they write canonical workflow files instead of applying transient `executionBackend`/`model`/`effort` overrides. It should still reuse existing workflow-relative path validation from `src/workflow/prompt-template-file.ts` or equivalent loader helpers for workflow-local files, and post-write validation must continue through `src/workflow/load.ts` / `src/workflow/json-schema.ts` rather than a self-improve-only schema path.
- Prompt-file patching must preserve authored `promptTemplateFile` boundaries. When a finding targets a prompt file, self-improve should resolve the target through the same workflow-relative path rules used by loaders instead of replacing file-backed prompts with embedded `promptTemplate` content.
- Backup and restore in `src/workflow/self-improve/backup.ts` and `src/workflow/self-improve/patcher.ts` remain self-improve-specific because they protect the canonical workflow directory before an optional edit. They should share path-safety and artifact-root conventions with `src/workflow/paths.ts`, while deliberately writing recovery artifacts under the self-improve execution directory rather than runtime node artifact directories.
- Log and report pathing in `src/workflow/self-improve/pathing.ts` intentionally stays separate from workflow execution artifacts. Reports live under `DIVEDRA_SELF_IMPROVE_LOG_ROOT` or `<user-root>/self-improve-log/` so retrospective reports do not mutate or masquerade as session artifacts. The directory identity hash is required to avoid collisions between same-named workflows from different scopes.
- `src/workflow/self-improve/marker-store.ts` and `src/workflow/self-improve/report.ts` should use shared JSON object checks where they validate public inputs, but typed report persistence may keep direct JSON serialization as long as parsing failures are surfaced as report-read failures and not silently normalized into successful results.
- Source selection in `src/workflow/self-improve/source-selection.ts` should reuse session-store/runtime-db discovery semantics rather than introducing a separate run index. File-backed session state remains authoritative for selected source runs; runtime DB helpers such as `src/workflow/runtime-db/session-query-records.ts` are indexes and inspection accelerators. Explicit sessions must still be loaded and checked against the resolved `workflowName` and `workflowId`.
- Git commit behavior in `src/workflow/self-improve/git.ts` is policy-compatible with, but not the same executor as, native git add-ons in `src/workflow/native-node-executor/git-and-addon-execution.ts` and `packages/divedra-addons/src/native-node-executor/git-and-addon-execution.ts`. Self-improve runs outside a node artifact context, so it should not call the add-on executor directly. It should align with add-on safety rules: normalize committed paths relative to the owning repo, reject directory or escaped paths, refuse unexpected pre-staged files outside the current self-improve changed-file set, commit only when there are staged changes, never push, and persist failure status in the report.
- CLI, library, GraphQL, and server surfaces must stay adapters over the same core functions in `src/workflow/self-improve/service.ts`. Endpoint-backed CLI/library calls should use typed GraphQL fields in `src/graphql/types.ts`, `src/graphql/schema/execution-resolvers.ts`, and `src/server/graphql-executable-schema.ts`; they must not introduce manager-message shortcuts or a second execution path.

Implementation review should classify each apparent duplicate as one of:

- `reuse-required`: an existing helper already owns the behavior and self-improve should call it
- `align-required`: the behavior remains self-improve-specific but must match shared validation, path, git, or API semantics
- `intentional-divergence`: the self-improve behavior has a different lifecycle boundary and the reason is documented here

Current intentional divergences are limited to canonical workflow backup/restore, report/marker storage under the self-improve log root, and local git commit orchestration outside a workflow node artifact context.

Implementation alignment:

- Canonical workflow patching uses the shared workflow-relative prompt-template path helper for prompt files, permits only `workflow.json` and `nodes/node-*.json` as canonical definition writes, and leaves final bundle acceptance to existing workflow loading/schema validation.
- Self-improve log directories use shared scoped-path safety while keeping the separate self-improve log-root lifecycle; `selfImproveId` is a safe path segment for report reads and writes.
- Marker and report reads use the shared JSON object boundary check; direct report serialization remains typed internal JSON, and report listing skips invalid persisted entries.
- Source discovery may use runtime DB session summaries as an index when a runtime DB root is configured, but selected source runs are still hydrated and validated through file-backed `loadSession` state.
- Git commits remain self-improve-local and no-push, while matching native git add-on safety expectations for repo-relative path normalization, directory/escape rejection, unexpected pre-staged file blocking, and no empty commits.

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

These functions and their public result/input types are intentionally part of
the stable `divedra-core` facade and the compatibility `divedra` library
facade. The core package owns the provider-neutral self-improve service because
it depends on workflow loading, validation, session stores, runtime indexes,
backup/patch policy, and report persistence rather than CLI process behavior.
Removing the core exports would narrow the public API and is not the intended
package-boundary fix.

CLI and GraphQL are adapters over this service. GraphQL should expose typed input and result objects rather than a freeform manager message. The served API must respect `serve --read-only` by allowing report listing/reading but rejecting new self-improve executions that would write reports or mutate workflow bundles. `serve --no-exec` rejects self-improve execution because analysis may invoke an agent backend.

Package-boundary validation should reflect this ownership:

- `packages/divedra-core/src/index.ts` exports the self-improve service,
  policy resolver, default log limit, and public report/result/input types.
- `packages/divedra/src/index.ts` keeps the compatibility library wrappers that
  call the core service locally or route to the typed GraphQL contract when a
  server endpoint is configured.
- package CLI modules may temporarily import root `src/workflow/self-improve`
  modules for argument typing and local command execution while the CLI package
  remains a compatibility facade over root source modules.
- every temporary CLI root import must be listed in the package-boundary
  allowlist with the same rationale as other compatibility facades, and should
  be removed only after an exported package-owned CLI/self-improve adapter
  replaces the root import without changing public command behavior.

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
