# Server Workflow Manifest Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-server-workflow-manifest.md; design-docs/specs/command.md#subcommands
**Created**: 2026-05-20
**Last Updated**: 2026-05-20

---

## Design Document Reference

**Source**: design-docs/specs/design-server-workflow-manifest.md

### Summary

Implement and review `divedra serve` workflow manifest support plus the
`workflow manifest validate` preflight surface. A manifest-backed server loads a
JSON allowlist of workflow entries, exposes only enabled manifest ids in server
catalog surfaces, and enforces the same allowlist for every server-backed start
path. The current follow-up reviews the uncommitted relative path root and
manifest validation CLI changes against the accepted design.

### Scope

**Included**: manifest JSON schema and loader, absolute/relative path
resolution from the current directory with `DIVEDRA_WORKFLOW_MANIFEST_ROOT`
override support, manifest id identity, enabled filtering, duplicate validation,
server startup precedence, CLI flag and environment fallback, `workflow manifest
validate`, GraphQL/catalog allowlist enforcement, request/default variable
merge, per-workflow auto-improve defaults, browser overview rows, tests, and
README documentation.

**Excluded**: adding manifest support to non-server local workflow commands,
changing workflow bundle authoring format, backend-adapter behavior changes,
and Cursor-specific readiness behavior.

### Accepted Review Feedback

Step 3 accepted the current design with one low finding:
`design-docs/specs/command.md` line 49 uses
`cli workflow manifest validate <manifest-path>` even though the manifest path
can also come from `--workflow-manifest` or `DIVEDRA_WORKFLOW_MANIFEST`.
Implementation may either update the synopsis to
`cli workflow manifest validate [<manifest-path>]` during the documentation
refresh step or leave it documented through the following bullets; this is not a
blocking design issue.

Historical design review also accepted `metadata.allowDuplicateSource` as the
only reserved metadata key that affects validation; all other metadata remains
display-only and non-semantic.

---

## Modules

### 1. Manifest Types and Loader

#### packages/divedra/src/workflow/manifest.ts

**Status**: COMPLETED

```typescript
type WorkflowManifestVersion = 1;

interface WorkflowManifestPathObject {
  readonly absolute?: string;
  readonly relative?: string;
}

interface WorkflowManifestAutoImprove {
  readonly mode: "active" | "disabled";
}

interface WorkflowManifestEntry {
  readonly id: string;
  readonly enabled?: boolean;
  readonly workflowDirectory: WorkflowManifestPathObject;
  readonly cwd?: WorkflowManifestPathObject;
  readonly autoImprove?: WorkflowManifestAutoImprove;
  readonly defaultVariables?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

interface WorkflowManifestDocument {
  readonly manifestVersion: WorkflowManifestVersion;
  readonly workflows: readonly WorkflowManifestEntry[];
}

interface ResolvedWorkflowManifestEntry {
  readonly id: string;
  readonly enabled: boolean;
  readonly workflowDirectory: string;
  readonly cwd: string;
  readonly authoredWorkflowId: string;
  readonly autoImprove?: WorkflowManifestAutoImprove;
  readonly defaultVariables: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly allowDuplicateSource: boolean;
}

interface ResolvedWorkflowManifest {
  readonly manifestPath: string;
  readonly relativePathRoot: string;
  readonly entries: readonly ResolvedWorkflowManifestEntry[];
}

async function loadWorkflowManifest(
  manifestPath: string,
  options?: WorkflowManifestLoadOptions,
): Promise<Result<ResolvedWorkflowManifest, WorkflowManifestLoadFailure>>;
```

**Checklist**:

- [x] Parse and validate manifest JSON without leaking environment secrets.
- [x] Support manifest version `1` only.
- [x] Enforce exactly one of `absolute` or `relative` for path objects.
- [x] Resolve relative paths from current directory by default, with
      `DIVEDRA_WORKFLOW_MANIFEST_ROOT` override support.
- [x] Validate workflow directories by loading or reading `workflow.json`.
- [x] Reject unsafe or duplicate ids.
- [x] Reject duplicate enabled workflowDirectory/cwd pairs unless
      `metadata.allowDuplicateSource === true`.
- [x] Preserve authored absolute/relative fields in validation diagnostics where useful.
- [x] Unit tests for success, path errors, malformed JSON, duplicate ids,
      duplicate source, disabled entry validation, and reserved metadata.

### 2. Catalog Source Model

#### packages/divedra/src/workflow/catalog.ts
#### packages/divedra/src/workflow/load.ts
#### packages/divedra/src/workflow/types.ts
#### packages/divedra/src/workflow/overview.ts

**Status**: COMPLETED

```typescript
type WorkflowSourceScope = "project" | "user" | "direct" | "manifest";

interface ResolvedWorkflowSource {
  readonly scope: WorkflowSourceScope;
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly cwd?: string;
  readonly manifestPath?: string;
  readonly manifestEntryId?: string;
  readonly authoredWorkflowId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly defaultVariables?: Record<string, unknown>;
  readonly manifestAutoImprove?: WorkflowManifestAutoImprove;
}

interface WorkflowCatalogOptions extends LoadOptions {
  readonly workflowManifestPath?: string;
  readonly fixedWorkflowName?: string;
}
```

**Checklist**:

- [x] Add manifest source scope while preserving existing direct/project/user behavior.
- [x] List enabled manifest entries as catalog rows keyed by manifest `id`.
- [x] Resolve `serve [workflow-name]` against enabled manifest ids.
- [x] Hide disabled entries from catalog results and reject starts by disabled ids.
- [x] Report `authoredWorkflowId`, `manifestPath`, `manifestEntryId`, and metadata.
- [x] Keep existing `--workflow-definition-dir` and scoped lookup behavior unchanged when no manifest is present.
- [x] Unit tests for manifest catalog listing, fixed-name narrowing, and fallback behavior.

### 3. CLI and Server Startup Wiring

#### packages/divedra/src/cli.ts
#### packages/divedra/src/cli/storage-and-options.ts
#### packages/divedra/src/server/serve.ts
#### packages/divedra/src/server/api.ts

**Status**: COMPLETED

```typescript
interface ParsedServeOptions {
  readonly workflowManifestPath?: string;
}

interface ServeWorkflowCatalogConfig {
  readonly workflowManifestPath?: string;
  readonly workflowRoot?: string;
  readonly fixedWorkflowName?: string;
}
```

**Checklist**:

- [x] Parse `--workflow-manifest <path>` for `divedra serve`.
- [x] Read `DIVEDRA_WORKFLOW_MANIFEST` as the environment fallback.
- [x] Apply precedence: CLI manifest, env manifest, direct definition dir, scoped catalog.
- [x] Emit a warning when manifest mode ignores `--workflow-definition-dir` for catalog selection.
- [x] Validate manifest before binding the HTTP listener.
- [x] Store resolved manifest catalog data in server context.
- [x] CLI/server tests for flag parsing, env fallback, precedence, warning, and startup validation failure.

### 4. GraphQL Allowlist Enforcement

#### packages/divedra/src/graphql/types.ts
#### packages/divedra/src/graphql/schema/llm-run-overrides.ts
#### packages/divedra/src/graphql/schema/execution-resolvers.ts
#### packages/divedra/src/server/graphql-executable-schema.ts

**Status**: COMPLETED

```typescript
interface GraphqlContext {
  readonly manifestWorkflowSources?: readonly ResolvedWorkflowSource[];
  readonly fixedWorkflowName?: string;
}

function resolveServerWorkflowSource(
  workflowName: string,
  context: GraphqlContext,
): Result<ResolvedWorkflowSource, Error>;
```

**Checklist**:

- [x] Replace single fixed-workflow-only assumptions with manifest allowlist resolution.
- [x] Reject direct GraphQL start/inspect/status requests for ids outside the enabled manifest allowlist.
- [x] Ensure `workflowCatalogOverview` returns only enabled manifest rows in manifest mode.
- [x] Preserve current fixed single-workflow behavior outside manifest mode.
- [x] Tests for GraphQL catalog, start rejection, disabled rejection, and fixed manifest narrowing.

### 5. Execution Defaults and Runtime Identity

#### packages/divedra/src/lib-workflow-run-options.ts
#### packages/divedra/src/workflow/auto-improve-policy.ts
#### packages/divedra/src/workflow/engine/auto-improve-and-runner.ts
#### packages/divedra/src/workflow/working-directory.ts

**Status**: COMPLETED

```typescript
interface ManifestRunDefaults {
  readonly servedWorkflowId: string;
  readonly authoredWorkflowId: string;
  readonly workflowDirectory: string;
  readonly cwd: string;
  readonly defaultVariables: Record<string, unknown>;
  readonly autoImprove?: AutoImprovePolicyInput;
}

function mergeManifestRunVariables(
  defaults: Record<string, unknown>,
  requestVariables: Record<string, unknown> | undefined,
): Record<string, unknown>;
```

**Checklist**:

- [x] Use manifest id as the served workflow identity for server starts and artifacts.
- [x] Preserve authored workflow id as source metadata.
- [x] Merge manifest `defaultVariables` before request variables.
- [x] Map `autoImprove.mode: "active"` to the default supervised remediation policy.
- [x] Map `autoImprove.mode: "disabled"` to lifecycle-only supervision with workflow patching disabled.
- [x] Apply manifest `cwd` as the default execution working directory.
- [x] Tests for variable precedence, auto-improve precedence, cwd use, and artifact/status identity.

### 6. Browser Overview and Documentation

#### packages/divedra/src/server/browser-overview.ts
#### packages/divedra/src/server/graphql-schema-text.ts
#### README.md

**Status**: COMPLETED

```typescript
interface WorkflowCatalogOverviewRow {
  readonly workflowName: string;
  readonly sourceScope: "manifest" | "direct" | "project" | "user";
  readonly workflowDirectory: string;
  readonly authoredWorkflowId?: string;
  readonly manifestPath?: string;
  readonly manifestEntryId?: string;
  readonly metadata?: Record<string, unknown>;
}
```

**Checklist**:

- [x] Render manifest rows in browser overview with manifest ids as public workflow names.
- [x] Extend GraphQL schema text/docs for manifest catalog fields if required by implementation.
- [x] Document `--workflow-manifest`, `DIVEDRA_WORKFLOW_MANIFEST`, path rules, precedence, and startup validation.
- [x] Document reserved `metadata.allowDuplicateSource` behavior.
- [x] Documentation diff passes whitespace checks.

### 7. Verification and Regression Coverage

#### packages/divedra/src/workflow/manifest.test.ts
#### packages/divedra/src/workflow/catalog.test.ts
#### packages/divedra/src/cli.test.ts
#### packages/divedra/src/server/serve.test.ts
#### packages/divedra/src/server/api.test.ts
#### packages/divedra/src/graphql/schema.test.ts
#### packages/divedra/src/server/graphql-queries-and-inspection.test.ts

**Status**: COMPLETED

```typescript
interface ManifestFixture {
  readonly manifestPath: string;
  readonly workflowRoot: string;
  readonly workflowIds: readonly string[];
}
```

**Checklist**:

- [x] Add focused manifest loader fixtures with absolute and relative paths.
- [x] Add server startup fixture for manifest-only catalog exposure.
- [x] Add GraphQL execution tests that prove hidden workflows are not startable.
- [x] Add regression tests for no-manifest direct/scoped behavior.
- [x] Run targeted tests, typecheck, and whitespace checks.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Manifest types and loader | `packages/divedra/src/workflow/manifest.ts` | COMPLETED | Covered in `packages/divedra/src/workflow/manifest.test.ts` |
| Catalog source model | `packages/divedra/src/workflow/catalog.ts`, `packages/divedra/src/workflow/load.ts`, `packages/divedra/src/workflow/overview.ts` | COMPLETED | Covered in workflow manifest/catalog tests and GraphQL overview tests |
| CLI and server startup | `packages/divedra/src/cli.ts`, `packages/divedra/src/cli/storage-and-options.ts`, `packages/divedra/src/server/serve.ts`, `packages/divedra/src/server/api.ts` | COMPLETED | Covered in targeted CLI serve tests |
| GraphQL allowlist enforcement | `packages/divedra/src/graphql/types.ts`, `packages/divedra/src/graphql/schema/llm-run-overrides.ts`, `packages/divedra/src/graphql/schema/execution-resolvers.ts`, `packages/divedra/src/server/graphql-executable-schema.ts` | COMPLETED | Covered in targeted GraphQL catalog/execution tests |
| Execution defaults and identity | `packages/divedra/src/lib-workflow-run-options.ts`, `packages/divedra/src/workflow/auto-improve-policy.ts`, `packages/divedra/src/workflow/engine/auto-improve-and-runner.ts`, `packages/divedra/src/workflow/working-directory.ts` | COMPLETED | Covered by manifest/catalog tests, GraphQL execution tests, and typecheck |
| Browser overview and docs | `packages/divedra/src/server/browser-overview.ts`, `packages/divedra/src/server/graphql-schema-text.ts`, `README.md` | COMPLETED | Covered by schema text update, overview model changes, and diff checks |
| Verification coverage | listed test files | COMPLETED | Targeted commands recorded in progress log |

## Task Breakdown

### TASK-001: Manifest Loader Foundation

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `packages/divedra/src/workflow/manifest.ts`,
`packages/divedra/src/workflow/manifest.test.ts`
**Dependencies**: None

**Completion Criteria**:

- [x] Manifest version, entry shape, path object, enabled/default values, metadata, and autoImprove mode validation implemented.
- [x] Path resolution is deterministic and relative paths resolve from the current directory by default, with `DIVEDRA_WORKFLOW_MANIFEST_ROOT` override support.
- [x] Duplicate id/source validation emits actionable errors.
- [x] `metadata.allowDuplicateSource` is documented in tests as the only reserved operational metadata key.

### TASK-002: Manifest Catalog Integration

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `packages/divedra/src/workflow/catalog.ts`,
`packages/divedra/src/workflow/load.ts`, `packages/divedra/src/workflow/types.ts`,
`packages/divedra/src/workflow/overview.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Manifest entries are represented as `sourceScope: "manifest"` catalog sources.
- [x] Enabled manifest ids are the only listed and loadable workflows in manifest mode.
- [x] Fixed-name narrowing resolves against manifest id.
- [x] Existing direct/project/user catalog behavior is unchanged without a manifest.

### TASK-003: CLI and Serve Startup Configuration

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `packages/divedra/src/cli.ts`,
`packages/divedra/src/cli/storage-and-options.ts`,
`packages/divedra/src/server/serve.ts`, `packages/divedra/src/server/api.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [x] `--workflow-manifest` and `DIVEDRA_WORKFLOW_MANIFEST` are accepted for `serve`.
- [x] Manifest mode is authoritative over `--workflow-definition-dir` with a warning.
- [x] Startup validates manifest before binding the listener.
- [x] Server context carries resolved manifest catalog data.

### TASK-004: GraphQL and Server Start Enforcement

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `packages/divedra/src/graphql/types.ts`,
`packages/divedra/src/graphql/schema/llm-run-overrides.ts`,
`packages/divedra/src/graphql/schema/execution-resolvers.ts`,
`packages/divedra/src/server/graphql-executable-schema.ts`
**Dependencies**: TASK-002, TASK-003

**Completion Criteria**:

- [x] Catalog query returns only enabled manifest rows in manifest mode.
- [x] Direct GraphQL starts reject ids outside the enabled allowlist.
- [x] Disabled manifest ids are hidden and not startable.
- [x] Non-manifest fixed workflow behavior remains compatible.

### TASK-005: Manifest Execution Defaults

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-002
**Deliverables**: `packages/divedra/src/lib-workflow-run-options.ts`,
`packages/divedra/src/workflow/auto-improve-policy.ts`,
`packages/divedra/src/workflow/engine/auto-improve-and-runner.ts`,
`packages/divedra/src/workflow/working-directory.ts`
**Dependencies**: TASK-002

**Completion Criteria**:

- [x] Manifest `defaultVariables` merge before request variables.
- [x] Request autoImprove overrides manifest autoImprove, then workflow defaults, then runtime fallback.
- [x] `disabled` autoImprove maps to lifecycle-only supervision with patching disabled.
- [x] Manifest `cwd` is used as the default execution working directory.
- [x] Manifest id is used as served workflow identity while authored id remains metadata.

### TASK-006: Browser Overview and User Documentation

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-002
**Deliverables**: `packages/divedra/src/server/browser-overview.ts`,
`packages/divedra/src/server/graphql-schema-text.ts`, `README.md`
**Dependencies**: TASK-002

**Completion Criteria**:

- [x] Browser overview displays manifest catalog rows by served manifest id.
- [x] Manifest metadata and authored workflow id are available where catalog detail is exposed.
- [x] README documents flag/env usage, path rules, precedence, defaults, and reserved metadata behavior.

### TASK-007: End-to-End Verification Pass

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: updated focused tests and verification results
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006

**Completion Criteria**:

- [x] Focused loader, catalog, CLI, server, GraphQL, and overview tests pass.
- [x] Type checking passes.
- [x] `git diff --check` passes.
- [x] Progress log records commands run and any residual risks.

### TASK-008: Review Manifest Loader Relative Root Semantics

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `packages/divedra/src/workflow/manifest.ts`,
`packages/divedra/src/workflow/types.ts`,
`packages/divedra/src/workflow/manifest.test.ts`
**Dependencies**: Accepted current design review

**Completion Criteria**:

- [x] Confirm manifest `relative` path fields resolve from the process current directory by default, not the manifest file directory.
- [x] Confirm `DIVEDRA_WORKFLOW_MANIFEST_ROOT` overrides the base directory for both `workflowDirectory.relative` and `cwd.relative`.
- [x] Confirm absolute path fields remain absolute and bypass the relative root.
- [x] Confirm validation diagnostics and JSON output expose the resolved manifest path and effective relative path root without leaking unrelated environment values.
- [x] Confirm disabled entries are still validated for path and referenced workflow correctness.
- [x] Add or adjust focused manifest tests for cwd default, env-root override, disabled entry validation, duplicate source/cwd behavior, and invalid path-object failures.

### TASK-009: Review Workflow Manifest Validate CLI and Server Wiring

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `packages/divedra/src/cli/workflow-command-handler.ts`,
`packages/divedra/src/cli/storage-and-options.ts`,
`packages/divedra/src/cli/input-output-helpers.ts`,
`packages/divedra/src/cli/workflow-manifest-validation.ts`,
`packages/divedra/src/cli.test.ts`,
`packages/divedra/src/server/serve.ts`,
`packages/divedra/src/workflow/catalog.ts`,
`packages/divedra/src/workflow/catalog.test.ts`,
`packages/divedra/src/server/serve.test.ts`
**Dependencies**: TASK-008

**Completion Criteria**:

- [x] Confirm path source precedence is positional argument, `--workflow-manifest`, then `DIVEDRA_WORKFLOW_MANIFEST`.
- [x] Confirm missing manifest path is a usage error and malformed/unreadable manifests produce actionable failures.
- [x] Confirm `workflow manifest validate` validates manifest shape, path resolution, duplicate constraints, disabled entries, and every referenced workflow bundle.
- [x] Confirm `--executable` extends referenced workflow validation through the same node executability preflight surface as `workflow validate --executable`.
- [x] Confirm text and JSON outputs include resolved manifest path, relative path root, entry ids, enabled state, resolved workflow directories, authored workflow ids when available, and per-entry errors.
- [x] Confirm ordinary local commands do not treat manifest entries as local catalog rows unless they explicitly use the manifest validation or server surfaces.
- [x] Confirm server startup passes the same manifest root semantics into the shared manifest loader as CLI validation.
- [x] Confirm manifest mode remains authoritative for `serve` while preserving direct/project/user lookup when no manifest is present.
- [x] Confirm `serve [workflow-name]` continues to narrow only by enabled manifest id in manifest mode.
- [x] Confirm server and catalog tests cover current-directory root, `DIVEDRA_WORKFLOW_MANIFEST_ROOT`, disabled/unlisted rejection, and no-manifest fallback behavior.

### TASK-010: Documentation, Progress, and Final Verification

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `README.md`,
`design-docs/specs/command.md`,
`design-docs/specs/design-server-workflow-manifest.md`,
`impl-plans/active/server-workflow-manifest.md`, focused verification results
**Dependencies**: TASK-009

**Completion Criteria**:

- [x] Keep README aligned with `DIVEDRA_WORKFLOW_MANIFEST_ROOT`, current-directory default relative root, and `workflow manifest validate` usage.
- [x] Address the accepted low Step 3 feedback by updating or intentionally retaining the command synopsis with surrounding bullets.
- [x] Ensure design docs and implementation plan agree on path precedence, validation scope, disabled entry validation, and `--executable` behavior.
- [x] Record implementation-step progress and verification results in this plan after code review and fixes.
- [x] Focused manifest, catalog, CLI, and server tests pass.
- [x] `bun run typecheck` passes.
- [x] `bun run lint:biome` passes.
- [x] `git diff --check` passes.
- [x] Any implementation review findings are either fixed or recorded with explicit residual risk.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001 Manifest loader foundation | Accepted design document | COMPLETED |
| TASK-002 Manifest catalog integration | TASK-001 | COMPLETED |
| TASK-003 CLI and serve startup configuration | TASK-001 | COMPLETED |
| TASK-004 GraphQL and server start enforcement | TASK-002, TASK-003 | COMPLETED |
| TASK-005 Manifest execution defaults | TASK-002 | COMPLETED |
| TASK-006 Browser overview and user documentation | TASK-002 | COMPLETED |
| TASK-007 End-to-end verification pass | TASK-001 through TASK-006 | COMPLETED |
| TASK-008 Review manifest loader relative root semantics | Accepted current design review | COMPLETED |
| TASK-009 Review workflow manifest validate CLI and server wiring | TASK-008 | COMPLETED |
| TASK-010 Documentation, progress, and final verification | TASK-009 | COMPLETED |

## Parallelizable Tasks

- TASK-002 and TASK-003 can run concurrently after TASK-001 because their write
  scopes are catalog modules versus CLI/server startup modules.
- TASK-005 and TASK-006 can run concurrently after TASK-002 because their write
  scopes are runtime defaults versus browser/docs surfaces.
- TASK-004 and TASK-007 are not parallelizable because they integrate and verify
  behavior across the prior work.
- The current follow-up tasks are intentionally sequential: TASK-008 establishes
  loader semantics, TASK-009 reviews each consumer of those semantics, and
  TASK-010 verifies and records the integrated result.

## Verification Plan

- `bun test packages/divedra/src/workflow/manifest.test.ts packages/divedra/src/workflow/catalog.test.ts packages/divedra/src/workflow/overview.test.ts`
- `bun test packages/divedra/src/cli.test.ts -t "workflow manifest validate|serve command|workflow list ignores"`
- `bun test packages/divedra/src/server/serve.test.ts -t "manifest|overview"`
- `bun test packages/divedra/src/server/api.test.ts`
- `bun test packages/divedra/src/graphql/schema.test.ts packages/divedra/src/server/graphql-queries-and-inspection.test.ts -t "workflowCatalogOverview|manifest|autoImprove"`
- `bun test packages/divedra/src/workflow/auto-improve-policy.test.ts packages/divedra/src/workflow/working-directory.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `git diff --check`

## Completion Criteria

- [x] `divedra serve --workflow-manifest <path>` loads manifest version `1`.
- [x] `DIVEDRA_WORKFLOW_MANIFEST` works when the flag is absent.
- [x] Manifest mode exposes only enabled manifest ids in browser and GraphQL catalog surfaces.
- [x] Direct server-backed starts reject ids outside the enabled manifest allowlist.
- [x] Manifest entries preserve separate absolute/relative authored fields and deterministic resolved paths.
- [x] `workflow manifest validate` checks manifest shape, path resolution, and
      each referenced workflow bundle.
- [x] Manifest `cwd`, `defaultVariables`, and `autoImprove` defaults apply with documented request override precedence.
- [x] Duplicate id, unsafe id, invalid path, unsupported version, malformed JSON, and duplicate source errors are tested.
- [x] Existing no-manifest `--workflow-definition-dir` and scoped lookup behavior remains covered.
- [x] README and schema-facing documentation are updated.
- [x] Targeted tests, typecheck, and whitespace checks pass.
- [x] Current review confirms or fixes manifest relative root behavior:
      current directory by default and `DIVEDRA_WORKFLOW_MANIFEST_ROOT` override.
- [x] Current review confirms or fixes `workflow manifest validate` path
      precedence, referenced workflow validation, disabled entry validation,
      JSON/text report fields, and `--executable` behavior.
- [x] Current review confirms ordinary local workflow lookup does not consume
      manifest entries outside explicit manifest validation and server surfaces.
- [x] Current review runs the requested focused tests, typecheck, Biome lint,
      and whitespace checks.

## Progress Log

### Session: 2026-05-20 07:37

**Tasks Completed**: Created implementation plan from accepted Step 3 design.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan intentionally treats codex-agent as an execution backend only;
no codex-agent behavioral reference was provided. Later implementation sessions
must update this log after each task and record verification commands/results.

### Session: 2026-05-20 07:49

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006,
TASK-007.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented manifest version 1 loading and validation,
manifest-backed catalog sources, serve flag/env wiring, startup validation,
fixed manifest narrowing, GraphQL allowlist resolution, manifest variable/cwd
and autoImprove defaults, overview/schema fields, README documentation, and
focused regression tests. Verification passed:
`bun test packages/divedra/src/workflow/manifest.test.ts packages/divedra/src/workflow/catalog.test.ts`;
`bun test packages/divedra/src/cli.test.ts -t "serve command"`;
`bun test packages/divedra/src/graphql/schema.test.ts -t "workflowCatalogOverview|executeWorkflow"`;
`bun run typecheck`; `bun run lint:biome`; `git diff --check`.
Residual risk: full server HTTP API integration coverage remains focused
through shared server context and GraphQL resolver tests rather than a new
end-to-end HTTP test fixture.

### Session: 2026-05-20 07:58

**Tasks Completed**: Self-review fix for TASK-001 duplicate-source validation.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Tightened duplicate source validation so every enabled duplicate
workflowDirectory/cwd entry must set `metadata.allowDuplicateSource: true`, and
added focused regression coverage. Re-ran verification:
`bun test packages/divedra/src/workflow/manifest.test.ts packages/divedra/src/workflow/catalog.test.ts`;
`bun test packages/divedra/src/cli.test.ts -t "serve command"`;
`bun test packages/divedra/src/graphql/schema.test.ts -t "workflowCatalogOverview|executeWorkflow"`;
`bun run typecheck`; `bun run lint:biome`; `git diff --check`.

### Session: 2026-05-20 08:04

**Tasks Completed**: Step 7 revision for TASK-002, TASK-003, TASK-004,
TASK-005, and TASK-007.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 7 mid findings by gating manifest catalog resolution
behind server contexts, keeping local workflow commands on direct/project/user
catalog behavior even when `--workflow-manifest` or
`DIVEDRA_WORKFLOW_MANIFEST` is present, and adding manifest-backed GraphQL and
server startup tests for allowlist catalog rows, disabled/unlisted rejection,
default variable merge precedence, manifest cwd propagation, and autoImprove
disabled/request override mapping. Re-ran verification:
`bun test packages/divedra/src/workflow/manifest.test.ts packages/divedra/src/workflow/catalog.test.ts`;
`bun test packages/divedra/src/cli.test.ts -t "workflow list ignores|serve command"`;
`bun test packages/divedra/src/graphql/schema.test.ts -t "manifest|workflowCatalogOverview|executeWorkflow"`;
`bun test packages/divedra/src/server/serve.test.ts -t "manifest|overview"`;
`bun run typecheck`; `bun run lint:biome`; `jq empty impl-plans/PROGRESS.json`;
`git diff --check`.

### Session: 2026-05-20 19:30

**Tasks Completed**: Manifest relative-path root revision and CLI validation
follow-up for TASK-001, TASK-003, and TASK-007.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Changed manifest `relative` path fields to resolve from the current
directory by default, added `DIVEDRA_WORKFLOW_MANIFEST_ROOT` for explicit
relative-root selection, and added `workflow manifest validate` to validate the
manifest plus every referenced workflow bundle. Documentation and focused
manifest/CLI tests were updated for the new behavior. Verification passed:
`bun test packages/divedra/src/workflow/manifest.test.ts packages/divedra/src/workflow/catalog.test.ts`;
`bun test packages/divedra/src/cli.test.ts -t "workflow manifest validate|serve command|workflow list ignores"`;
`bun test packages/divedra/src/server/serve.test.ts -t "manifest|overview"`;
`bun run typecheck`; `bun run lint:biome`; `git diff --check`.

### Session: 2026-05-20 19:46

**Tasks Completed**: Step 4 implementation-plan revision for current manifest
relative-root and validation CLI review.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Reopened the active plan as ready follow-up work while preserving the
completed baseline implementation history. Added TASK-008 through TASK-010 for
reviewing manifest loader root semantics, `workflow manifest validate`, server
and catalog root wiring, documentation alignment, and final verification.
Explicitly tracked Step 3's accepted low command-synopsis feedback for the
documentation refresh step.

### Session: 2026-05-20 19:55

**Tasks Completed**: Step 4 self-review plan cleanup.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Consolidated follow-up tasks so the plan remains within the
implementation-plan task limit while retaining explicit deliverables,
dependencies, completion criteria, progress tracking, and verification
commands.

### Session: 2026-05-20 10:07

**Tasks Completed**: TASK-008, TASK-009, TASK-010.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Reviewed the uncommitted manifest relative-root and
`workflow manifest validate` implementation against the accepted design and
plan. Confirmed current-directory default resolution, the
`DIVEDRA_WORKFLOW_MANIFEST_ROOT` override, disabled-entry validation, ordinary
local catalog isolation, manifest-backed serve narrowing, and referenced
workflow bundle validation. Addressed the accepted low Step 3 documentation
finding by changing the command synopsis to
`workflow manifest validate [<manifest-path>]` and aligning CLI help and README
usage with `--workflow-manifest` and `DIVEDRA_WORKFLOW_MANIFEST`. Verification
passed: `bun test packages/divedra/src/workflow/manifest.test.ts packages/divedra/src/workflow/catalog.test.ts packages/divedra/src/workflow/overview.test.ts`;
`bun test packages/divedra/src/cli.test.ts -t "workflow manifest validate|serve command|workflow list ignores"`;
`bun test packages/divedra/src/server/serve.test.ts -t "manifest|overview"`;
`bun test packages/divedra/src/server/api.test.ts`;
`bun test packages/divedra/src/graphql/schema.test.ts packages/divedra/src/server/graphql-queries-and-inspection.test.ts -t "workflowCatalogOverview|manifest|autoImprove"`;
`bun test packages/divedra/src/workflow/auto-improve-policy.test.ts packages/divedra/src/workflow/working-directory.test.ts`;
`bun run typecheck`; `bun run lint:biome`; `git diff --check`.
Residual risk: none identified in this implementation step.

## Related Plans

- **Previous**: `impl-plans/completed/workflow-serve-mvp.md`,
  `impl-plans/scoped-workflow-catalog.md`,
  `impl-plans/completed/scoped-workflow-graphql-server.md`
- **Next**: None
- **Depends On**: `design-docs/specs/design-server-workflow-manifest.md`
