# Workflow Registry Run Temporary Checkout Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-package-checkout.md#temporary-registry-run-checkout`, `design-docs/specs/design-workflow-package-registry.md#temporary-run-integration`, `design-docs/specs/command.md#commands`
**Created**: 2026-05-28
**Last Updated**: 2026-05-28

## Design Document Reference

**Source**:

- `design-docs/specs/design-workflow-package-checkout.md#temporary-registry-run-checkout`
- `design-docs/specs/design-workflow-package-registry.md#temporary-run-integration`
- `design-docs/specs/command.md#commands`

### Summary

Implement explicit npx-like registry workflow execution with
`workflow run --from-registry <package-id>`. The command resolves a registry
package, stages the selected workflow in a command-owned temporary
workflow-definition directory, executes through the existing local
`workflow run` path, records registry source provenance, and performs
best-effort cleanup.

### Scope

**Included**:

- Parse and validate `--from-registry`, `--registry`, and `--branch` for
  `workflow run`.
- Reject `--from-registry` with `--endpoint`.
- Reuse package registry resolution, manifest validation, checksum/integrity
  verification, workflow loading, and workflow validation.
- Stage only the selected workflow bundle as
  `<temporary-workflow-root>/<workflow-name>/workflow.json`.
- Forward normal local run options unchanged after temporary checkout.
- Record source provenance in local run output/artifacts.
- Report cleanup failures without changing the workflow execution result.
- Add focused CLI/package tests and refresh user-facing docs.

**Excluded**:

- Silent registry fallback for bare `workflow run <name>`.
- Remote GraphQL registry-backed execution.
- Persistent checkout records under
  `~/.rielflow/workflow-registry/checkouts/`.
- Project/user catalog mutation.
- Package skill installation or vendor skill projection during temporary runs.
- New registry backends beyond existing localPath-backed registry behavior.

## Codex Agent References

- `AGENTS.md`
- `packages/rielflow/src/workflow/adapters/codex.ts`
- `packages/rielflow/src/cli/workflow-command-handler.ts`
- `packages/rielflow/src/cli/argument-parser.ts`
- `packages/rielflow/src/cli/input-output-helpers.ts`
- `packages/rielflow/src/cli/storage-and-options.ts`
- `packages/rielflow/src/workflow/packages/checkout.ts`
- `packages/rielflow/src/workflow/packages/search.ts`
- `packages/rielflow/src/workflow/packages/registry-config.ts`
- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/load.ts`
- `packages/rielflow/src/workflow/validate.ts`
- `packages/rielflow/src/workflow/engine.ts`
- `packages/rielflow/src/cli.test.ts`
- `packages/rielflow/src/workflow/packages/checkout.test.ts`
- `README.md`

Codex-agent backend behavior remains adapter-owned and unchanged. This plan
uses codex-agent references only to preserve current backend execution while
changing CLI/package resolution before the existing local run path starts.

## Modules

### 1. CLI Option Surface

#### `packages/rielflow/src/cli/argument-parser.ts`
#### `packages/rielflow/src/cli/input-output-helpers.ts`

**Status**: Completed

```typescript
interface ParsedCliOptions {
  readonly fromRegistry: boolean;
  readonly registry?: string;
  readonly branch?: string;
}
```

**Checklist**:

- [x] Parse `--from-registry` as a boolean workflow-run option.
- [x] Ensure `--registry` and `--branch` remain available to package commands
      and are accepted by `workflow run --from-registry`.
- [x] Update help text with explicit `workflow run <package-id> --from-registry`
      usage.
- [x] Reject unsupported flag combinations through existing CLI validation
      patterns.

### 2. Temporary Registry Run Resolver

#### `packages/rielflow/src/workflow/packages/checkout.ts`
#### Optional: `packages/rielflow/src/workflow/packages/temp-run.ts`
#### `packages/rielflow/src/workflow/packages/index.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageTemporaryRunCheckoutInput {
  readonly packageName: string;
  readonly registry?: string;
  readonly branch?: string;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}

export interface WorkflowPackageRunProvenance {
  readonly packageId: string;
  readonly workflowName: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly sourceDirectory: string;
  readonly metadataPath: string;
  readonly checksum: string;
  readonly checksumAlgorithm: string;
  readonly temporaryWorkflowDirectory: string;
}

export interface WorkflowPackageTemporaryRunCheckoutResult {
  readonly workflowName: string;
  readonly workflowDefinitionDir: string;
  readonly packageStagingDirectory: string;
  readonly provenance: WorkflowPackageRunProvenance;
  cleanup(): Promise<Result<WorkflowPackageTemporaryRunCleanupResult, WorkflowPackageFailure>>;
}
```

**Checklist**:

- [x] Resolve package id through `searchWorkflowPackages` with registry/branch
      filters and existing registry config options.
- [x] Validate manifest, safe workflow directory, checksum, integrity, and
      workflow bundle before returning a runnable checkout.
- [x] Copy package content only as needed for validation and copy only the
      selected workflow bundle to the temporary workflow-definition root.
- [x] Do not call persistent checkout destination/provenance writers.
- [x] Do not call package skill installation/projection.
- [x] Return typed package failures consistent with existing package command
      behavior.

### 3. Workflow Run Integration

#### `packages/rielflow/src/cli/workflow-command-handler.ts`
#### `packages/rielflow/src/cli/storage-and-options.ts`

**Status**: Completed

```typescript
interface RegistryBackedWorkflowRunContext {
  readonly workflowName: string;
  readonly workflowDefinitionDir: string;
  readonly provenance: WorkflowPackageRunProvenance;
  readonly cleanup: () => Promise<Result<WorkflowPackageTemporaryRunCleanupResult, WorkflowPackageFailure>>;
}
```

**Checklist**:

- [x] In `workflow run`, interpret the positional name as a package id only
      when `--from-registry` is present.
- [x] Reject `--from-registry` with `--endpoint` before registry mutation or
      staging.
- [x] Execute existing local run behavior with the temporary
      `workflowDefinitionDir`.
- [x] Forward existing run options unchanged: variables, node patch,
      mock scenario, output mode, artifact/session roots, working directory,
      supervision flags, timeout flags, verbose/debug flags, and validation
      behavior.
- [x] Ensure cleanup runs after terminal result or pre-start failure and does
      not run early while workflow-local files may still be needed.
- [x] Preserve the workflow execution result if cleanup fails.

### 4. Provenance And Output

#### `packages/rielflow/src/cli/workflow-command-handler.ts`
#### `packages/rielflow/src/cli/workflow-graphql-formatters.ts`
#### Runtime artifact writer touched by local run path, if needed

**Status**: Completed

```typescript
interface WorkflowRunRegistrySourceOutput {
  readonly source: "registry";
  readonly package: WorkflowPackageRunProvenance;
  readonly cleanup?: {
    readonly ok: boolean;
    readonly remainingPaths?: readonly string[];
    readonly error?: string;
  };
}
```

**Checklist**:

- [x] Include registry source provenance in JSON output for
      `workflow run --from-registry --output json`.
- [x] Include concise registry source and cleanup warning lines in text output.
- [x] Persist enough provenance in the workflow execution artifact/session
      metadata to audit the removed temporary path.
- [x] Report cleanup failure paths and reason without replacing the original
      run failure/success code.

### 5. Tests And Fixtures

#### `packages/rielflow/src/cli.test.ts`
#### `packages/rielflow/src/workflow/packages/checkout.test.ts`
#### Optional package fixture under existing test temp setup

**Status**: Completed

```typescript
interface RegistryRunTestFixture {
  readonly registryRoot: string;
  readonly packageId: string;
  readonly workflowName: string;
  readonly registryConfigRoot: string;
}
```

**Checklist**:

- [x] Test successful registry-backed run through temp checkout.
- [x] Test cleanup after successful run and after validation/pre-start failure.
- [x] Test invalid or ambiguous registry package fails before workflow
      execution.
- [x] Test `--endpoint` plus `--from-registry` is rejected.
- [x] Test ordinary run options are forwarded, including `--variables`,
      `--mock-scenario`, `--output json`, storage roots, and working directory.
- [x] Test no persistent checkout record, project/user catalog mutation, or
      package skill projection occurs.

### 6. User-Facing Documentation

#### `README.md`
#### `design-docs/specs/command.md` if implementation discovers a documented flag detail mismatch

**Status**: Completed

```typescript
interface DocumentationUpdate {
  readonly command: "workflow run --from-registry";
  readonly localOnly: true;
  readonly persistentCheckout: false;
}
```

**Checklist**:

- [x] Document `rielflow workflow run <package-id> --from-registry`.
- [x] Document `--registry` and `--branch` for registry-backed runs.
- [x] State local-only behavior and `--endpoint` rejection.
- [x] State that temporary runs do not install package skills or persist
      checkout records.
- [x] Include a JSON-output/provenance note.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| CLI option surface | `packages/rielflow/src/cli/argument-parser.ts`, `packages/rielflow/src/cli/input-output-helpers.ts` | Completed | `packages/rielflow/src/cli.test.ts` |
| Temporary resolver | `packages/rielflow/src/workflow/packages/checkout.ts` or `packages/rielflow/src/workflow/packages/temp-run.ts` | Completed | `packages/rielflow/src/workflow/packages/packages.test.ts` |
| Run integration | `packages/rielflow/src/cli/workflow-command-handler.ts`, `packages/rielflow/src/cli/storage-and-options.ts` | Completed | `packages/rielflow/src/cli.test.ts` |
| Provenance/output | `packages/rielflow/src/cli/workflow-command-handler.ts`, `packages/rielflow/src/cli/workflow-run-command.ts` | Completed | `packages/rielflow/src/cli.test.ts` |
| Tests and fixtures | `packages/rielflow/src/cli.test.ts`, `packages/rielflow/src/workflow/packages/packages.test.ts` | Completed | same |
| Docs | `README.md` | Completed | `git diff --check` |

## Task Breakdown

### TASK-001: Parse And Document CLI Flags

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**:

- `packages/rielflow/src/cli/argument-parser.ts`
- `packages/rielflow/src/cli/input-output-helpers.ts`

**Dependencies**: None

**Completion Criteria**:

- [x] `--from-registry` is parsed for `workflow run`.
- [x] `--registry` and `--branch` are available to registry-backed runs.
- [x] Help text includes registry-backed run syntax.

### TASK-002: Build Temporary Package Run Checkout

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/packages/checkout.ts` or
  `packages/rielflow/src/workflow/packages/temp-run.ts`
- `packages/rielflow/src/workflow/packages/index.ts`

**Dependencies**: Existing package registry/search/checkout modules

**Completion Criteria**:

- [x] Package resolution, validation, checksum/integrity, and workflow
      validation happen before execution.
- [x] Temporary workflow root has the existing workflow-definition-dir shape.
- [x] No persistent checkout record or skill projection is written.
- [x] Cleanup API removes package staging and workflow-definition temp roots.

### TASK-003: Integrate Temporary Checkout With Local Workflow Run

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/cli/workflow-command-handler.ts`
- `packages/rielflow/src/cli/storage-and-options.ts`

**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:

- [x] `workflow run --from-registry <package-id>` executes via existing local
      run behavior.
- [x] `--endpoint` with `--from-registry` fails as a usage error.
- [x] Existing run options are forwarded unchanged.
- [x] Cleanup runs after success, run failure, and pre-start failure.

### TASK-004: Add Provenance And Cleanup Reporting

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/cli/workflow-command-handler.ts`
- `packages/rielflow/src/cli/workflow-graphql-formatters.ts` if output
  helpers need shared formatting

**Dependencies**: TASK-002, TASK-003

**Completion Criteria**:

- [x] JSON output includes package provenance and cleanup status.
- [x] Text output includes source scope/directory and cleanup warnings.
- [x] Runtime artifacts retain package source provenance after temp removal.
- [x] Cleanup failures do not mask workflow execution results.

### TASK-005: Add Focused Tests

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/cli.test.ts`
- `packages/rielflow/src/workflow/packages/checkout.test.ts`

**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Completion Criteria**:

- [x] Success, cleanup, invalid package, endpoint rejection, option
      forwarding, and non-persistence cases are covered.
- [x] Tests use local temp registries and do not require network access.
- [x] Tests pass under targeted Bun test commands.

### TASK-006: Refresh User Documentation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**:

- `README.md`

**Dependencies**: TASK-001 for final flag wording

**Completion Criteria**:

- [x] README documents the new command and key flags.
- [x] README states local-only, temporary, non-persistent, no-skill-install
      behavior.
- [x] README mentions provenance/cleanup reporting.

## Dependencies

| Task | Depends On | Status |
|------|------------|--------|
| TASK-001 | Existing argument parser and help conventions | Completed |
| TASK-002 | Existing package registry/search/checkout validation modules | Completed |
| TASK-003 | TASK-001, TASK-002 | Completed |
| TASK-004 | TASK-002, TASK-003 | Completed |
| TASK-005 | TASK-001, TASK-002, TASK-003, TASK-004 | Completed |
| TASK-006 | TASK-001 final flag wording | Completed |

## Parallelizable Tasks

- TASK-001 and TASK-002 may begin independently because write scopes are
  disjoint.
- TASK-006 may begin after TASK-001 flag wording is confirmed; it does not
  share TypeScript write scope.
- TASK-003, TASK-004, and TASK-005 are sequential because they touch shared
  run integration/output behavior and depend on the temp checkout contract.

## Verification Plan

- `bun run typecheck`
- `bun test packages/rielflow/src/cli.test.ts packages/rielflow/src/workflow/packages/checkout.test.ts`
- `bun run packages/rielflow/src/bin.ts workflow validate worker-only-single-step --workflow-definition-dir ./examples`
- `bun run packages/rielflow/src/bin.ts workflow run <package-id> --from-registry --mock-scenario <fixture> --output json`
- `git diff --check`

## Completion Criteria

- [x] `workflow run --from-registry <package-id>` resolves and runs a registry
      package from a temporary checkout.
- [x] Bare `workflow run <name>` never fetches registry packages implicitly.
- [x] `--endpoint` with `--from-registry` is rejected before staging.
- [x] Registry-backed run forwards existing local run options unchanged.
- [x] Temporary directories are removed after terminal completion or pre-start
      failure, with cleanup failure reported non-destructively.
- [x] No persistent checkout record, catalog mutation, or skill projection is
      produced by temporary runs.
- [x] JSON/text outputs and runtime artifacts include package provenance.
- [x] Focused tests and verification commands pass.
- [x] README documents the new behavior.

## Addressed Feedback

- Step 3 design review had no high or mid findings.
- Accepted feedback requires explicit `workflow run --from-registry` behavior,
  temporary checkout, validation, option forwarding, registry metadata reuse,
  provenance, cleanup, and docs/test expectations. Each item is represented in
  TASK-001 through TASK-006.
- The plan keeps codex-agent execution unchanged and limits implementation to
  CLI/package-resolution boundaries, matching the accepted design boundary.

## Risks

- Cleanup that runs too early can break workflow-local prompt, script, add-on,
  or container file reads.
- Removed temporary workflow directories make resume/rerun diagnostics depend
  on provenance quality.
- Existing checkout helpers may assume persistent destinations; temporary run
  code must avoid provenance and skill-install side effects.
- Registry-backed execution can run remote content; the explicit
  `--from-registry` flag and validation are required to avoid surprising
  execution.
- Test fixtures must avoid default registry/network dependencies to remain
  deterministic.

## Progress Log

### Session: 2026-05-28 20:46

**Tasks Completed**: Created initial implementation plan from accepted Step 3
design.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Later TypeScript implementation steps must use the repository
ts-coding and check-and-test-after-modify requirements after any TypeScript
file changes.

### Session: 2026-05-28 21:10

**Tasks Completed**: TASK-001 through TASK-006.
**Tasks In Progress**: None.
**Blockers**: The rielflow implementation workflow dispatched design and plan
steps successfully, then stalled before recording the implementation step; the
accepted design/plan was used to complete implementation in the same feature
worktree.
**Notes**: Verified with `bun run lint:biome`, `bun run typecheck`,
`bun test packages/rielflow/src/cli.test.ts packages/rielflow/src/workflow/packages/packages.test.ts`,
and `git diff --check`.

## Related Plans

- **Depends On**: `impl-plans/active/workflow-package-registry.md`
- **Depends On**: `impl-plans/active/workflow-package-checkout.md`
- **Related**: `impl-plans/active/workflow-package-checkout-search.md`
