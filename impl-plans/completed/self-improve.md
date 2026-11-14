# Dedicated Workflow Self-Improve Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-self-improve.md`, `design-docs/specs/architecture.md#self-improve`, `design-docs/specs/command.md#cli-workflow-self-improve-name`, `design-docs/specs/design-workflow-json.md#defaultsselfimprove`, `design-docs/specs/design-auto-improve-superviser-mode.md`
**Created**: 2026-05-18
**Last Updated**: 2026-05-18

---

## Design Document Reference

**Source**: `design-docs/specs/design-self-improve.md`

### Summary

Implement a dedicated retrospective workflow self-improve capability that is separate from supervisor and `workflow run --auto-improve`. The service inspects recent workflow execution results, judges whether the workflow achieved its authored purpose, writes structure and prompt reports, and optionally patches the canonical workflow bundle when `report-and-auto-improve` is enabled.

The feature is exposed through `rielflow workflow self-improve <workflow-name>`, GraphQL while `rielflow serve` is running, and public library APIs. Source runs default to runs since the previous successful self-improve marker for the resolved workflow directory, or the latest configured limit when no marker exists. The initial fallback limit is `10`, configurable through workflow defaults, environment, and command/API options.

### Scope

**Included**:

- `workflow.defaults.selfImprove` type, validation, and loaded-bundle normalization.
- Provider-neutral self-improve core service for source-run selection, report writing, marker management, backup, optional patching, validation, and git commit recording.
- CLI, GraphQL, server, and library adapter parity over the same core service.
- Report listing and report reading APIs.
- Tests for source selection, config validation, report-only execution, backup creation, patch validation/revert, git-managed commit behavior, serve read-only/no-exec rejection, and CLI/GraphQL/library parity.
- README and API documentation that keep self-improve distinct from supervisor auto-improve.

**Excluded**:

- Scheduled or automatic background self-improve execution beyond explicit CLI/GraphQL/library calls.
- Git pushes from runtime code.
- Runtime artifact mutation outside `~/.rielflow/self-improve-log/<workflow-directory-name>/<self-improve-id>/`.
- Backend-specific adapter policy changes except using existing agent execution boundaries for analysis/prompt generation.
- Cross-workflow source-run selection; explicit source ids must belong to the resolved workflow.

### Codex Reference Trace

- `/Users/taco/gits/tacogips/codex-agent/src/session/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/session/sqlite.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/session/search.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/rollout/reader.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/file-changes/service.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/file-changes/extractor.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/queue/runner.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/main.ts`

Codex-agent is a reference only for discovery, transcript parsing/search, file-change summary, queue execution, and facade export patterns. Rielflow source runs stay in rielflow session/artifact stores, and backend transcript details stay behind existing adapter boundaries.

---

## Modules

### 1. Self-Improve Types and Workflow Defaults

#### `src/workflow/types.ts`, `src/workflow/validate/workflow-normalization.ts`, `src/workflow/validate/semantic-validation-and-addons.ts`, `src/workflow/self-improve/types.ts`

**Status**: COMPLETED

```ts
export type WorkflowSelfImproveMode =
  | "report-only"
  | "report-and-auto-improve";

export interface WorkflowSelfImproveDefaults {
  readonly enabled?: boolean;
  readonly mode?: WorkflowSelfImproveMode;
  readonly defaultLogLimit?: number;
}

export interface WorkflowSelfImprovePolicy {
  readonly enabled: boolean;
  readonly mode: WorkflowSelfImproveMode;
  readonly defaultLogLimit: number;
}
```

**Checklist**:

- [x] Add `WorkflowDefaults.selfImprove`.
- [x] Reject unknown self-improve default fields and invalid modes/limits.
- [x] Resolve workflow, env, and caller override precedence.
- [x] Export public types through `packages/rielflow-core/src/index.ts`.

### 2. Source Run Selection and Marker Store

#### `src/workflow/self-improve/source-selection.ts`, `src/workflow/self-improve/marker-store.ts`, `src/workflow/self-improve/pathing.ts`

**Status**: COMPLETED

```ts
export type WorkflowSelfImproveSourceMode =
  | "since-last"
  | "latest"
  | "since-last-or-latest"
  | "explicit";

export interface WorkflowSelfImproveSourceSelectionInput {
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly workflowId: string;
  readonly sourceMode: WorkflowSelfImproveSourceMode;
  readonly limit: number;
  readonly explicitSessionIds?: readonly string[];
}

export interface WorkflowSelfImproveSourceRun {
  readonly sessionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly status: string;
  readonly startedAt?: string;
  readonly updatedAt?: string;
  readonly artifactDir?: string;
}
```

**Checklist**:

- [x] Derive stable workflow-directory identity and sanitized log directory name.
- [x] Read the previous successful marker for the workflow directory.
- [x] Select runs since marker or latest `defaultLogLimit` when no marker exists.
- [x] Validate explicit source ids against the resolved workflow identity.
- [x] Write marker only after report execution succeeds.

### 3. Report Model, Analysis, and Artifact Writes

#### `src/workflow/self-improve/report.ts`, `src/workflow/self-improve/analyzer.ts`, `src/workflow/self-improve/service.ts`

**Status**: COMPLETED

```ts
export type WorkflowPurposeAchievement =
  | "achieved"
  | "partially-achieved"
  | "not-achieved"
  | "unknown";

export interface WorkflowSelfImproveFinding {
  readonly severity: "high" | "mid" | "low";
  readonly category: "purpose" | "structure" | "prompt" | "runtime";
  readonly message: string;
  readonly evidenceSessionIds: readonly string[];
  readonly stepIds?: readonly string[];
  readonly nodeIds?: readonly string[];
}

export interface WorkflowSelfImproveReport {
  readonly selfImproveId: string;
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly sourceRuns: readonly WorkflowSelfImproveSourceRun[];
  readonly purposeAchievement: WorkflowPurposeAchievement;
  readonly findings: readonly WorkflowSelfImproveFinding[];
  readonly recommendedActions: readonly string[];
}
```

**Checklist**:

- [x] Write `input-runs.json`, `report.json`, and `report.md`.
- [x] Judge purpose achievement with cited source-run evidence.
- [x] Use `unknown` when evidence is insufficient.
- [x] Include workflow structure and prompt findings.
- [x] Keep JSON report schema independent of backend-specific adapter fields.

### 4. Backup, Patch, Validation, and Git Commit Safety

#### `src/workflow/self-improve/backup.ts`, `src/workflow/self-improve/patcher.ts`, `src/workflow/self-improve/git.ts`

**Status**: COMPLETED

```ts
export interface WorkflowSelfImproveBackupResult {
  readonly backupPath: string;
  readonly copiedFileCount: number;
}

export interface WorkflowSelfImprovePatchResult {
  readonly status: "not-attempted" | "applied" | "patch-reverted" | "failed";
  readonly changedFiles: readonly string[];
  readonly validationStatus: "not-run" | "passed" | "failed";
}

export interface WorkflowSelfImproveGitCommitResult {
  readonly status: "not-git-managed" | "committed" | "failed";
  readonly commitHash?: string;
  readonly message?: string;
}
```

**Checklist**:

- [x] Create complete workflow-directory backup before any canonical modification.
- [x] Constrain writes to the resolved workflow directory.
- [x] Validate candidate patches before write when possible and after write always.
- [x] Restore from backup and mark `patch-reverted` on failed post-write validation.
- [x] Commit only files changed by this self-improve execution when git-managed.
- [x] Never stage unrelated repository changes and never push.

### 5. Public Core and Library API

#### `src/workflow/self-improve/index.ts`, `packages/rielflow-core/src/index.ts`, `packages/rielflow/src/index.ts`, `src/lib.ts`

**Status**: COMPLETED

```ts
export interface ExecuteWorkflowSelfImproveInput {
  readonly workflowName: string;
  readonly mode?: WorkflowSelfImproveMode;
  readonly sourceMode?: WorkflowSelfImproveSourceMode;
  readonly limit?: number;
  readonly sessionIds?: readonly string[];
  readonly enableDisabled?: boolean;
}

export interface WorkflowSelfImproveResult {
  readonly selfImproveId: string;
  readonly reportPath: string;
  readonly markdownReportPath: string;
  readonly backupPath?: string;
  readonly patchStatus: WorkflowSelfImprovePatchResult["status"];
  readonly gitCommitStatus: WorkflowSelfImproveGitCommitResult["status"];
}

export function executeWorkflowSelfImprove(
  input: ExecuteWorkflowSelfImproveInput,
): Promise<WorkflowSelfImproveResult>;
```

**Checklist**:

- [x] Export `executeWorkflowSelfImprove`, `getWorkflowSelfImproveReport`, and `listWorkflowSelfImproveReports`.
- [x] Keep core package free of CLI/server transport ownership.
- [x] Preserve library GraphQL client behavior for endpoint-backed calls.
- [x] Add public DTO parsing for report summaries and details.

### 6. CLI Adapter and Remote GraphQL Transport

#### `packages/rielflow/src/cli/argument-parser.ts`, `packages/rielflow/src/cli/workflow-command-handler.ts`, `packages/rielflow/src/cli/input-output-helpers.ts`, `packages/rielflow/src/cli/workflow-graphql-formatters.ts`, `src/cli.test.ts`

**Status**: COMPLETED

```ts
export interface WorkflowSelfImproveCliOptions {
  readonly sinceLast?: boolean;
  readonly latest?: boolean;
  readonly sessions?: readonly string[];
  readonly mode?: WorkflowSelfImproveMode;
  readonly enableDisabled?: boolean;
  readonly limit?: number;
  readonly output?: "text" | "json";
}
```

**Checklist**:

- [x] Parse `workflow self-improve <name>` and flags `--since-last`, `--latest`, repeated `--session`, `--mode`, `--enable-disabled`, `--limit`, and `--output json`.
- [x] Reject incompatible source-mode flag combinations.
- [x] Execute locally without `--endpoint`.
- [x] Execute through GraphQL transport when `--endpoint` is supplied.
- [x] Return JSON with self-improve id, report paths, selected source runs, findings summary, backup path, patch status, validation status, and git commit status.

### 7. GraphQL and Server API

#### `packages/rielflow-graphql/src/schema-contract.ts`, `packages/rielflow-graphql/src/dto.ts`, `src/graphql/schema/execution-resolvers.ts`, `src/graphql/types.ts`, `src/server/graphql-executable-schema.ts`, `src/server/graphql-queries-and-inspection.test.ts`, `src/graphql/schema.test.ts`

**Status**: COMPLETED

```ts
export interface ExecuteWorkflowSelfImproveGraphqlInput {
  readonly workflowName: string;
  readonly mode?: WorkflowSelfImproveMode;
  readonly sourceMode?: WorkflowSelfImproveSourceMode;
  readonly limit?: number;
  readonly sessionIds?: readonly string[];
  readonly enableDisabled?: boolean;
}
```

**Checklist**:

- [x] Add mutation `executeWorkflowSelfImprove`.
- [x] Add queries `workflowSelfImproveReport` and `workflowSelfImproveReports`.
- [x] Respect `serve --read-only` by allowing reads but rejecting self-improve execution.
- [x] Respect `serve --no-exec` by rejecting self-improve execution.
- [x] Keep GraphQL objects typed rather than freeform manager messages.

### 8. Documentation, Package Boundaries, and Regression Verification

#### `README.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json`, package-boundary tests

**Status**: COMPLETED

```ts
export interface WorkflowSelfImproveDocumentationExample {
  readonly command: string;
  readonly purpose: string;
  readonly distinctFromAutoImprove: boolean;
}
```

**Checklist**:

- [x] Document CLI, GraphQL, and library use.
- [x] Document report-only versus report-and-auto-improve behavior.
- [x] Document backup location and git commit behavior.
- [x] Keep self-improve wording distinct from supervisor auto-improve.
- [x] Update this plan's progress log after each implementation session.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Types and workflow defaults | `src/workflow/types.ts`, `src/workflow/validate/workflow-normalization.ts`, `src/workflow/validate/semantic-validation-and-addons.ts`, `src/workflow/self-improve/types.ts` | COMPLETED | `src/workflow/validate.test.ts`, `src/workflow/self-improve/config.test.ts` |
| Source selection and markers | `src/workflow/self-improve/source-selection.ts`, `src/workflow/self-improve/marker-store.ts`, `src/workflow/self-improve/pathing.ts` | COMPLETED | `src/workflow/self-improve/source-selection.test.ts` |
| Reports and analysis | `src/workflow/self-improve/report.ts`, `src/workflow/self-improve/analyzer.ts`, `src/workflow/self-improve/service.ts` | COMPLETED | `src/workflow/self-improve/report.test.ts`, `src/workflow/self-improve/service.test.ts` |
| Backup, patch, and git | `src/workflow/self-improve/backup.ts`, `src/workflow/self-improve/patcher.ts`, `src/workflow/self-improve/git.ts` | COMPLETED | `src/workflow/self-improve/backup-git.test.ts`, `src/workflow/self-improve/patcher.test.ts` |
| Public and library APIs | `packages/rielflow-core/src/index.ts`, `packages/rielflow/src/index.ts`, `src/lib.ts` | COMPLETED | `src/lib-api.test.ts` |
| CLI adapter | `packages/rielflow/src/cli/*.ts`, `src/cli.test.ts` | COMPLETED | `src/cli.test.ts` |
| GraphQL and server API | `packages/rielflow-graphql/src/*.ts`, `src/graphql/**/*.ts`, `src/server/**/*.ts` | COMPLETED | `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts` |
| Documentation and tracking | `README.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json` | COMPLETED | `git diff --check` |

## Task Breakdown

### TASK-001: Define Self-Improve Configuration and Types

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/workflow/types.ts`, `src/workflow/self-improve/types.ts`, `src/workflow/validate/workflow-normalization.ts`, `src/workflow/validate/semantic-validation-and-addons.ts`, `src/workflow/validate.test.ts`, `src/workflow/self-improve/config.test.ts`, `packages/rielflow-core/src/index.ts`
**Dependencies**: None

**Description**:
Add workflow self-improve defaults, resolved policy types, and validation for enabled state, mode, and default log limit.

**Completion Criteria**:

- [x] `workflow.defaults.selfImprove` is typed and exported.
- [x] Unknown fields, unsupported modes, and non-positive limits are rejected.
- [x] Disabled workflows may still contain valid nested values.
- [x] `DIVEDRA_SELF_IMPROVE_DEFAULT_LIMIT` participates in policy resolution.

### TASK-002: Implement Source Selection and Marker Persistence

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/self-improve/source-selection.ts`, `src/workflow/self-improve/marker-store.ts`, `src/workflow/self-improve/pathing.ts`, `src/workflow/self-improve/source-selection.test.ts`
**Dependencies**: TASK-001

**Description**:
Resolve workflow identity, self-improve log paths, previous marker state, latest/since-last source-run selection, and explicit session validation.

**Completion Criteria**:

- [x] No-marker default selects latest configured limit, initially 10.
- [x] Marker default selects only runs newer than previous successful execution.
- [x] `--limit`/API limit overrides workflow and env defaults.
- [x] Explicit ids are rejected when they do not belong to the resolved workflow.

### TASK-003: Build Report-Only Service Path

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/self-improve/analyzer.ts`, `src/workflow/self-improve/report.ts`, `src/workflow/self-improve/service.ts`, `src/workflow/self-improve/report.test.ts`, `src/workflow/self-improve/service.test.ts`
**Dependencies**: TASK-002

**Description**:
Create the core report-only service that writes source-run inputs, structured JSON report, markdown report, and successful markers.

**Completion Criteria**:

- [x] Reports include purpose achievement, findings, recommendations, selected runs, and artifact refs.
- [x] Purpose judgments cite concrete source-run evidence or return `unknown`.
- [x] Report-only mode does not modify workflow bundles.
- [x] Marker is written only after report artifacts are complete.

### TASK-004: Add Backup, Patch, Validation, and Git Commit Path

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/self-improve/backup.ts`, `src/workflow/self-improve/patcher.ts`, `src/workflow/self-improve/git.ts`, `src/workflow/self-improve/backup-git.test.ts`, `src/workflow/self-improve/patcher.test.ts`
**Dependencies**: TASK-003

**Description**:
Support `report-and-auto-improve` by creating mandatory backups, applying bounded workflow-directory patches, validating results, reverting on validation failure, and locally committing git-managed workflow changes.

**Completion Criteria**:

- [x] Backup is created before any canonical workflow write for git-managed and non-git-managed workflows.
- [x] Patch writes are constrained to the resolved workflow directory.
- [x] Failed validation restores from backup and records `patch-reverted`.
- [x] Git commit stages only this execution's workflow-file changes and includes no automated-assistant attribution.

### TASK-005: Expose Library APIs

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/self-improve/index.ts`, `packages/rielflow-core/src/index.ts`, `packages/rielflow/src/index.ts`, `src/lib.ts`, `src/lib-api.test.ts`
**Dependencies**: TASK-003, TASK-004

**Description**:
Expose provider-neutral core APIs and public package/library facade methods for execution, report read, and report listing.

**Completion Criteria**:

- [x] `executeWorkflowSelfImprove` returns stable result DTOs.
- [x] `getWorkflowSelfImproveReport` reads an existing report.
- [x] `listWorkflowSelfImproveReports` returns summaries.
- [x] Endpoint-backed library calls use GraphQL transport where applicable.

### TASK-006: Add CLI Command and Remote Transport

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/cli/argument-parser.ts`, `packages/rielflow/src/cli/workflow-command-handler.ts`, `packages/rielflow/src/cli/input-output-helpers.ts`, `packages/rielflow/src/cli/workflow-graphql-formatters.ts`, `src/cli.test.ts`
**Dependencies**: TASK-005

**Description**:
Implement `rielflow workflow self-improve <workflow-name>` with source selection flags, mode override, disabled-workflow override, JSON/text output, local execution, and GraphQL endpoint execution.

**Completion Criteria**:

- [x] CLI flags match `design-docs/specs/command.md`.
- [x] Incompatible source flags fail before execution.
- [x] Local command uses the core service.
- [x] Remote command uses GraphQL mutation/query contracts.
- [x] JSON output includes report paths, selected runs, finding summary, backup, patch, validation, and git statuses.

### TASK-007: Add GraphQL and Server Contracts

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow-graphql/src/schema-contract.ts`, `packages/rielflow-graphql/src/dto.ts`, `src/graphql/schema/execution-resolvers.ts`, `src/graphql/types.ts`, `src/server/graphql-executable-schema.ts`, `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts`
**Dependencies**: TASK-005

**Description**:
Add typed GraphQL mutation/query contracts and server resolver enforcement for read-only and no-exec modes.

**Completion Criteria**:

- [x] `executeWorkflowSelfImprove` mutation is typed and tested.
- [x] Report read/list queries are typed and tested.
- [x] `serve --read-only` rejects execution but permits read/list.
- [x] `serve --no-exec` rejects execution.
- [x] CLI remote transport and library endpoint transport share DTO expectations.

### TASK-008: Update Documentation and Tracking

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `README.md`, `impl-plans/README.md`, `impl-plans/active/self-improve.md`, `impl-plans/PROGRESS.json`
**Dependencies**: TASK-006, TASK-007

**Description**:
Document self-improve usage and update implementation progress tracking after implementation.

**Completion Criteria**:

- [x] README distinguishes `workflow self-improve` from `workflow run --auto-improve`.
- [x] CLI, GraphQL, and library examples are documented.
- [x] Backup and git commit behavior are documented.
- [x] Progress log records implemented tasks, blockers, and verification commands.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Types and config | None | COMPLETED |
| Source selection and markers | TASK-001 | COMPLETED |
| Report-only service | TASK-002 | COMPLETED |
| Backup/patch/git path | TASK-003 | COMPLETED |
| Library APIs | TASK-003, TASK-004 | COMPLETED |
| CLI adapter | TASK-005 | COMPLETED |
| GraphQL/server API | TASK-005 | COMPLETED |
| Documentation/tracking | TASK-006, TASK-007 | COMPLETED |

## Parallelization Notes

- TASK-001 is parallelizable because it owns type/config/validation files and has no dependencies.
- TASK-006 and TASK-007 are not marked parallelizable even though their adapter files differ because both depend on the public API DTO shape from TASK-005 and must remain transport-compatible.
- No patch/git work should start before the report-only service path exists because backup and marker behavior must attach to a complete self-improve execution record.

## Verification Plan

- `bun test src/workflow/validate.test.ts src/workflow/self-improve/config.test.ts`
- `bun test src/workflow/self-improve/source-selection.test.ts src/workflow/self-improve/report.test.ts src/workflow/self-improve/service.test.ts`
- `bun test src/workflow/self-improve/backup-git.test.ts src/workflow/self-improve/patcher.test.ts`
- `bun test src/lib-api.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts`
- `bun run typecheck`
- `bun run build`
- `git diff --check`

## Completion Criteria

- [x] CLI, GraphQL, and library self-improve entrypoints all use the same core service.
- [x] Source selection defaults to since-last marker or latest configured limit.
- [x] Report-only mode writes durable JSON and markdown reports without workflow modification.
- [x] Report-and-auto-improve mode backs up before modification, validates, reverts failed patches, and records git status.
- [x] Git-managed workflows are committed locally after successful self-improve modifications without staging unrelated changes.
- [x] Non-git-managed workflows have recoverable backups under `~/.rielflow/self-improve-log/<workflow-directory-name>/<self-improve-id>/backup/`.
- [x] Server read-only/no-exec behavior matches the design.
- [x] Documentation and tests keep self-improve separate from supervisor/auto-improve.

## Progress Log

### Session: 2026-05-18 20:00

**Tasks Completed**: Implementation plan created.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan created after Step 3 accepted the design with no high or mid findings.
**Verification**: Pending implementation step.

### Session: 2026-05-18 20:45

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented workflow defaults validation, self-improve source selection and marker persistence, report writing, backup/patch/git primitives, CLI local and GraphQL transport, GraphQL/server schema and resolvers, public package/library exports, README documentation, and progress tracking. `report-and-auto-improve` currently applies bounded deterministic prompt patches for weak prompt findings.
**Verification**: `bun run lint:biome`; `bun run typecheck`; `bun test src/workflow/self-improve/config.test.ts src/workflow/self-improve/source-selection.test.ts src/workflow/self-improve/service.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts`; `bun run build`; `git diff --check`.

### Session: 2026-05-18 21:05

**Tasks Completed**: TASK-002 self-review correction.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Corrected `since-last-or-latest` source selection so an existing marker with no newer runs returns an empty source set instead of falling back to latest historical runs.
**Verification**: `bun run typecheck`; `bun test src/workflow/self-improve/source-selection.test.ts src/workflow/self-improve/service.test.ts`; `git diff --check`.

### Session: 2026-05-18 21:30

**Tasks Completed**: Step 7 revision for TASK-002, TASK-004, TASK-005, TASK-006, TASK-007.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed all Step 7 mid findings by adding node-execution and output-validation evidence to source-run analysis, patching `promptTemplateFile` targets directly during auto-improve, runtime-validating public `mode` and `sourceMode` overrides, adding endpoint-backed library self-improve transport, extending GraphQL DTOs for source-run node evidence, and adding CLI/library/GraphQL/server coverage including read-only/no-exec behavior.
**Verification**: `bun run typecheck`; `bun test src/workflow/self-improve/config.test.ts src/workflow/self-improve/source-selection.test.ts src/workflow/self-improve/service.test.ts src/lib-api.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts`.

### Session: 2026-05-18 21:45

**Tasks Completed**: Step 6 self-review correction for TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Corrected endpoint-backed library report query selection so `workflowSelfImproveReport` requests nested GraphQL object fields for source runs and findings instead of scalar-style object selections.
**Verification**: `bun run typecheck`; `bun test src/lib-api.test.ts -t "endpoint-backed GraphQL transport for self-improve"`; `bun test src/workflow/self-improve/config.test.ts src/workflow/self-improve/source-selection.test.ts src/workflow/self-improve/service.test.ts src/lib-api.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts`; `bun run lint:biome`; `bun run build`; `git diff --check`; `jq '.' impl-plans/PROGRESS.json >/dev/null`.

### Session: 2026-05-18 22:00

**Tasks Completed**: Step 7 revision for TASK-004.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Restored backup contents after validation failures and post-write patch exceptions, preserving `.git` while removing non-backup workflow files. Added focused patcher rollback tests and git commit safety coverage for staging only self-improve changed files without assistant attribution.
**Verification**: `bun test src/workflow/self-improve/patcher.test.ts src/workflow/self-improve/backup-git.test.ts`.
