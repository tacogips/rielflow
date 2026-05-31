# Temporary Workflow Execution Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-temporary-workflow-execution.md`, `design-docs/specs/command.md#flags-and-options`, `design-docs/specs/architecture.md#runtime-state-boundary`
**Created**: 2026-05-31
**Last Updated**: 2026-05-31

## Design Reference

Issue-resolution plan for workflow
`codex-design-and-implement-review-loop`, Step 4
`step4-impl-plan-create`.

Accepted design sources:

- `design-docs/specs/design-temporary-workflow-execution.md`
- `design-docs/specs/command.md`
- `design-docs/specs/architecture.md`

Step 3 accepted the revised design with no remaining high or mid findings.
The implementation adds local temporary workflow execution from inline JSON or
a JSON file, embedded-prompt validation, temp-only payload logging, and durable
resume/rerun/continuation source reload from the persisted normalized payload.

## Scope

Included:

- Add `rielflow workflow run --workflow-json <json>` and
  `rielflow workflow run --workflow-json-file <path>`.
- Make temporary source selectors override `RIEL_WORKFLOW_DEFINITION_DIR` and
  reject only other explicit source selectors: positional target,
  `--workflow-definition-dir`, and `--from-registry`.
- Normalize temporary payloads into the same workflow bundle shape used by
  validation: `{ workflow, nodePayloads }`.
- Reject temporary payloads that require workflow-local external files:
  `promptTemplateFile`, `systemPromptTemplateFile`,
  `sessionStartPromptTemplateFile`, `steps[].stepFile`, and unresolved
  `nodes[].nodeFile` references.
- Persist `input.json`, `normalized.json`, and `metadata.json` under
  `<artifactWorkflowRoot>/<workflowExecutionId>/temporary-workflow-payload/`
  only for temporary runs.
- Use the persisted normalized payload as the source for local resume, rerun,
  and history-linked continuation of temporary sessions.
- Expose a provider-neutral local library API for parsed temporary payloads or
  inline JSON strings.
- Update user-facing README and CLI help.

Excluded:

- GraphQL remote file-path semantics.
- Installing temporary workflows into project/user scope.
- Registry temporary checkout behavior changes.
- Cursor-specific or codex-agent-specific behavior changes.
- Separate prompt files in examples, fixtures, or tests for temporary payloads.

## Codex Agent References

- Workflow ID: `codex-design-and-implement-review-loop`
- Workflow mode: `issue-resolution`
- Node ID: `step4-impl-plan-create`
- Worker backend reference: `codex-agent`
- `AGENTS.md`
- `../../codex-agent` unavailable per Step 1 and Step 3; no external
  codex-agent behavior is imported.

Intentional divergence: codex-agent remains only an execution backend string in
temporary node payloads. Temporary workflow parsing, validation, source
precedence, payload persistence, and resume/rerun loading are provider-neutral.

## Issue Reference

- Source: `runtimeVariables.workflowInput via $RIEL_MAILBOX_DIR/inbox/input.json`
- Title: `Temporary workflow execution from inline JSON or JSON file`
- Issue URL: none supplied
- Issue repository/number: none supplied

## Modules And Contracts

### `packages/rielflow-core/src/workflow-model.ts`

Expected contract:

```typescript
export type WorkflowSourceScope =
  | "direct"
  | "project"
  | "user"
  | "manifest"
  | "temporary";

export interface TemporaryWorkflowSourceMetadata {
  readonly input: "inline-json" | "json-file" | "persisted-normalized";
  readonly displayPath?: string;
  readonly payloadDirectory?: string;
  readonly normalizedPayloadPath?: string;
  readonly contentDigest?: string;
}
```

### `packages/rielflow/src/workflow/temporary-workflow.ts`

Expected contract:

```typescript
export type TemporaryWorkflowInputKind = "inline-json" | "json-file";

export interface TemporaryWorkflowPayloadInput {
  readonly kind: TemporaryWorkflowInputKind;
  readonly value: unknown;
  readonly displayPath?: string;
}

export interface LoadedTemporaryWorkflow {
  readonly loadedWorkflow: LoadedWorkflow;
  readonly inputPayload: unknown;
  readonly normalizedPayload: NormalizedWorkflowBundle;
  readonly metadata: TemporaryWorkflowSourceMetadata;
}

export function normalizeTemporaryWorkflowPayload(
  input: TemporaryWorkflowPayloadInput,
  options: LoadOptions,
): Promise<Result<LoadedTemporaryWorkflow, LoadFailure>>;
```

The loader must not read prompt files, step files, or node files from disk. It
must produce validation issues that say temporary workflows must embed prompt
and related prompt content directly in JSON.

### `packages/rielflow/src/workflow/temporary-workflow-payload-log.ts`

Expected contract:

```typescript
export interface TemporaryWorkflowPayloadLogInput {
  readonly artifactWorkflowRoot: string;
  readonly workflowExecutionId: string;
  readonly inputPayload: unknown;
  readonly normalizedPayload: NormalizedWorkflowBundle;
  readonly metadata: TemporaryWorkflowSourceMetadata;
}

export interface TemporaryWorkflowPayloadLogRecord {
  readonly payloadDirectory: string;
  readonly inputPath: string;
  readonly normalizedPath: string;
  readonly metadataPath: string;
}

export function persistTemporaryWorkflowPayloadLog(
  input: TemporaryWorkflowPayloadLogInput,
): Promise<Result<TemporaryWorkflowPayloadLogRecord, SessionStoreFailure>>;

export function loadPersistedTemporaryWorkflowPayload(
  input: {
    readonly artifactWorkflowRoot: string;
    readonly workflowExecutionId: string;
  },
): Promise<Result<LoadedTemporaryWorkflow, LoadFailure>>;
```

Writes should be atomic or follow the repository's existing artifact-write
pattern where available. Normal scoped/direct/manifest/registry runs must never
call this persister.

### `packages/rielflow/src/workflow/session.ts`

Expected contract:

```typescript
export interface TemporaryWorkflowSessionSource {
  readonly scope: "temporary";
  readonly input: "inline-json" | "json-file" | "persisted-normalized";
  readonly payloadDirectory: string;
  readonly normalizedPayloadPath: string;
  readonly metadataPath: string;
}

export interface WorkflowSessionState {
  readonly temporaryWorkflowSource?: TemporaryWorkflowSessionSource;
}
```

The session marker is the durable signal used by local resume, rerun, and
continuation commands to reload the temporary workflow from the payload log.

### `packages/rielflow/src/workflow/engine/types-and-session-state.ts`

Expected contract:

```typescript
export interface WorkflowRunOptions {
  readonly temporaryWorkflow?: LoadedTemporaryWorkflow;
}
```

When `temporaryWorkflow` is present, `prepareWorkflowRun` must use that
preloaded bundle instead of `loadWorkflowFromDisk`. For resume, rerun, and
continuation, command/library code should reconstruct `temporaryWorkflow` from
the persisted normalized payload before calling `runWorkflow`.

### CLI and Library Surfaces

Expected file paths:

- `packages/rielflow/src/cli/argument-parser.ts`
- `packages/rielflow/src/cli/storage-and-options.ts`
- `packages/rielflow/src/cli/input-output-helpers.ts`
- `packages/rielflow/src/cli/workflow-run-command.ts`
- `packages/rielflow/src/cli/session-command-handler.ts`
- `packages/rielflow/src/lib-workflow-run-options.ts`
- `packages/rielflow/src/index.ts`
- `packages/rielflow/src/lib.ts`

Expected contract:

```typescript
export interface ParsedOptions {
  readonly workflowJson?: string;
  readonly workflowJsonFile?: string;
}

export interface TemporaryWorkflowRunInput {
  readonly workflowJson?: string;
  readonly workflowJsonPayload?: unknown;
  readonly workflowJsonFile?: string;
}
```

The CLI owns file-path reading for `--workflow-json-file`. Library callers pass
an inline JSON string or parsed payload; they do not inherit local file-path
semantics unless an explicit future API adds that boundary.

## Task Breakdown

### TASK-001: Temporary Source Types, Loader, And Validation

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow-core/src/workflow-model.ts`
- `packages/rielflow-core/src/workflow-validation.ts`
- `packages/rielflow/src/workflow/types.ts`
- `packages/rielflow/src/workflow/load.ts`
- `packages/rielflow/src/workflow/temporary-workflow.ts`
- `packages/rielflow/src/workflow/load.test.ts`
- `packages/rielflow/src/workflow/validate.test.ts`

**Dependencies**: None

**Completion Criteria**:

- [x] `WorkflowSourceScope` supports `temporary` without regressing existing
      direct/project/user/manifest behavior.
- [x] Temporary payloads normalize from `{ workflow, nodePayloads }`.
- [x] Ambiguous single-object payloads fail with a supported-format diagnostic.
- [x] Temporary validation rejects prompt file fields, step files, and external
      node file dependencies.
- [x] Existing authored bundle prompt-file and step-file tests still pass.

### TASK-002: CLI Source Selection And Local Run Dispatch

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/cli/argument-parser.ts`
- `packages/rielflow/src/cli/storage-and-options.ts`
- `packages/rielflow/src/cli/input-output-helpers.ts`
- `packages/rielflow/src/cli/workflow-run-command.ts`
- `packages/rielflow/src/cli/workflow-graphql-formatters.ts`
- `packages/rielflow/src/cli.test.ts`

**Dependencies**: TASK-001

**Completion Criteria**:

- [x] `--workflow-json` and `--workflow-json-file` parse and appear in help.
- [x] The two temporary flags are mutually exclusive with each other.
- [x] Temporary flags reject positional target, `--workflow-definition-dir`,
      and `--from-registry`.
- [x] Temporary flags override `RIEL_WORKFLOW_DEFINITION_DIR`.
- [x] `--endpoint` rejects temporary local-only inputs in this slice.
- [x] JSON run output includes `source.scope: "temporary"` and input kind.

### TASK-003: Runtime Payload Persistence And Session Marker

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/temporary-workflow-payload-log.ts`
- `packages/rielflow/src/workflow/engine/run-setup.ts`
- `packages/rielflow/src/workflow/engine/session-entry.ts`
- `packages/rielflow/src/workflow/session.ts`
- `packages/rielflow/src/workflow/session-store.test.ts`
- `packages/rielflow/src/workflow/engine.test.ts`

**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Temporary run start writes `input.json`, `normalized.json`, and
      `metadata.json` under the run artifact tree before step execution.
- [x] Session state records `temporaryWorkflowSource` with log paths.
- [x] Normal scoped/direct/manifest/registry runs do not create
      `temporary-workflow-payload/`.
- [x] Payload metadata includes input kind, optional display path, content
      digest, persisted timestamp, and schema version.
- [x] Failed pre-execution temp validation does not create a partial temp
      payload log.

### TASK-004: Resume, Rerun, Continuation, And Library API

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/cli/session-command-handler.ts`
- `packages/rielflow/src/lib-workflow-run-options.ts`
- `packages/rielflow/src/index.ts`
- `packages/rielflow/src/lib.ts`
- `packages/rielflow/src/lib-sessions.ts`
- `packages/rielflow/src/lib-continuation.ts`
- `packages/rielflow/src/lib-api.test.ts`
- `packages/rielflow/src/graphql/schema.test.ts`

**Dependencies**: TASK-003

**Completion Criteria**:

- [x] Local `session resume` reloads temporary workflows from persisted
      `normalized.json` when the source session is temporary.
- [x] Local `session rerun` and history-linked continuation use the same
      persisted normalized source.
- [x] Library execution supports parsed payload and inline JSON temporary input.
- [x] GraphQL remote file-path behavior remains unsupported and documented by
      tests.
- [x] Existing registry-run retained checkout resume behavior still passes.

### TASK-005: Documentation And Embedded Fixtures

**Status**: Completed
**Parallelizable**: Yes, after TASK-002 flag names are stable
**Deliverables**:

- `README.md`
- `design-docs/specs/design-temporary-workflow-execution.md`
- `design-docs/specs/command.md`
- test fixtures embedded directly in test files or inline helper objects

**Dependencies**: TASK-002

**Completion Criteria**:

- [x] README documents inline JSON and JSON file examples.
- [x] Docs state temporary prompt content must be embedded in JSON.
- [x] Docs state normal scoped runs do not gain payload directories.
- [x] No temporary fixture relies on `promptTemplateFile` or separate prompt
      files.

### TASK-006: Full Verification And Plan Closure

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `impl-plans/completed/temporary-workflow-execution.md`
- `impl-plans/PROGRESS.json`
- Move plan to `impl-plans/completed/temporary-workflow-execution.md` after all
  implementation tasks complete and completion criteria pass.

**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [x] Progress log records each implementation session.
- [x] `impl-plans/PROGRESS.json` reflects final plan and task status.
- [x] All focused tests pass.
- [x] `bun run typecheck` passes.
- [x] `bun run biome check .` passes.
- [x] Manual CLI smoke checks pass for inline JSON, JSON file, and normal-run
      non-persistence.

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| TASK-001 temporary source loader | Accepted design | Completed |
| TASK-002 CLI source selection | TASK-001 | Completed |
| TASK-003 payload persistence | TASK-001 | Completed |
| TASK-004 resume/rerun/library | TASK-003 | Completed |
| TASK-005 docs | TASK-002 flag text | Completed |
| TASK-006 verification | TASK-001 through TASK-005 | Completed |

## Parallelizable Tasks

| Task | Parallelizable | Reason |
| --- | --- | --- |
| TASK-001 | No | Establishes shared temporary source types and validation contracts. |
| TASK-002 | No | Shares CLI parsing and run dispatch files with source-selection behavior. |
| TASK-003 | No | Touches engine/session state used by later resume/rerun work. |
| TASK-004 | No | Depends on TASK-003 and touches session command/library entrypoints. |
| TASK-005 | Yes, after TASK-002 | Docs and inline fixtures are disjoint from runtime files once flag names are stable. |
| TASK-006 | No | Verification and closure depend on all implementation work. |

## Verification Plan

Focused commands:

```bash
bun test packages/rielflow/src/cli.test.ts
bun test packages/rielflow/src/workflow/load.test.ts packages/rielflow/src/workflow/validate.test.ts
bun test packages/rielflow/src/workflow/session-store.test.ts packages/rielflow/src/workflow/engine.test.ts
bun test packages/rielflow/src/lib-api.test.ts packages/rielflow/src/graphql/schema.test.ts
bun run typecheck
bun run biome check .
bun run packages/rielflow/src/bin.ts workflow run --help
bun run packages/rielflow/src/bin.ts workflow run --workflow-json '<embedded-workflow-json>' --output json
bun run packages/rielflow/src/bin.ts workflow run --workflow-json-file ./tmp/temp-workflow.json --output json
```

Required assertions:

- Inline JSON run succeeds without project/user-scope installation.
- JSON file run succeeds without project/user-scope installation.
- `RIEL_WORKFLOW_DEFINITION_DIR` is ignored when a temporary flag is present.
- Prompt-file and step-file temporary payloads fail with embedded-prompt
  diagnostics.
- Temporary runs create exactly one `temporary-workflow-payload/` directory
  under the run artifact tree.
- Normal scoped/direct/registry runs do not create
  `temporary-workflow-payload/`.
- Resume/rerun/continuation for temporary sessions load from persisted
  `normalized.json`.

## Progress Log

### Session: 2026-05-31

**Tasks Completed**: Planning only.

**Notes**:

- Created implementation plan from accepted Step 3 design review.
- No TypeScript implementation changes made in this step.

### Session: 2026-05-31 Step 5 Revision

**Tasks Completed**: Planning metadata revision.

**Notes**:

- Added `temporary-workflow-execution` to `impl-plans/PROGRESS.json` with
  TASK-001 through TASK-006 status, dependencies, and parallelizable flags.
- Updated TASK-006 closure wording to require moving the plan to
  `impl-plans/completed/temporary-workflow-execution.md` after implementation
  completion, matching repository completion conventions.

### Session: 2026-05-31 Step 6 Implementation

**Tasks Completed**: TASK-001 through TASK-006.

**Notes**:

- Added provider-neutral temporary workflow loading, embedded-content
  validation, source metadata, CLI flags, local library inputs, runtime session
  markers, and temporary payload artifact logging.
- Implemented resume/rerun/continuation source reload from persisted
  `temporary-workflow-payload/normalized.json` for temporary sessions.
- Updated CLI help, README usage, focused tests, type exports, and implementation
  plan metadata.
- Verified focused workflow, CLI, library, GraphQL, typecheck, Biome, and manual
  smoke commands listed in the Step 6 return payload.

## Addressed Feedback

- Step 3 accepted the design with no high or mid findings.
- Prior Step 3 source-selector conflict was already resolved in Step 2 by
  making explicit temporary flags override `RIEL_WORKFLOW_DEFINITION_DIR`.
- Prior low feedback for `--workflow-json-file` mutual-exclusion wording was
  already resolved in `design-docs/specs/command.md`.
- Step 5 mid finding on missing `impl-plans/PROGRESS.json` tracking was
  resolved by adding the plan entry and TASK-001 through TASK-006 metadata.
- Step 5 low finding on optional completion move wording was resolved by making
  completed-plan movement explicit in TASK-006.
- Step 6 implementation found no Step 7 rerun feedback to address.

## Risks

- `runWorkflow` currently loads from disk in `prepareWorkflowRun`; temporary
  execution must introduce a narrowly-scoped preloaded workflow path without
  weakening normal load/validation behavior.
- Session state currently does not carry general source metadata; the temporary
  marker must be backward-compatible and optional.
- Payload logging must be gated only on temporary source scope to avoid
  changing normal artifact shape.
- Resume/rerun/continuation must not depend on the original inline JSON string
  or local file path after run start.
- GraphQL remote behavior must remain clear: no client-local file semantics in
  this slice.
