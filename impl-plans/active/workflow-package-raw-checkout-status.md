# Raw Workflow Checkout Package Status Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-package-commands.md#package-lifecycle-commands`, `design-docs/specs/design-workflow-package-checkout.md`
**Created**: 2026-06-05
**Last Updated**: 2026-06-05

## Design Reference

Implement GitHub issue #47: package commands must clearly distinguish raw
workflow checkout records created by `rielflow workflow checkout` from
registry-managed package checkout records created by `rielflow package install`.

This plan follows the accepted Step 3 design: package status resolves package
records first, then matching raw workflow checkout records, and returns a typed
read-only workflow-checkout status instead of the generic
`package checkout record not found` failure. Package list keeps `packages`
package-only and adds a separate `workflowCheckouts` collection for raw
workflow checkout records.

Out of scope:

- Registry refresh, registry search, or package-id inference for raw checkouts.
- Package update/remove ownership changes for raw checkout records.
- Adding a new `workflow status` command.
- Changing workflow checkout installation semantics.

## Issue Resolution Scope

- Workflow mode: `issue-resolution`
- Issue reference: `tacogips/rielflow#47`
- Issue URL: `https://github.com/tacogips/rielflow/issues/47`
- Accepted review decision: `step3-design-review` accepted the design with no
  high or mid findings.

## Codex Agent References

No external codex-agent behavior references were supplied. Treat this as a
rielflow CLI/package-boundary issue.

Relevant local files:

- `AGENTS.md`
- `design-docs/specs/design-workflow-package-checkout.md`
- `design-docs/specs/design-workflow-package-commands.md`
- `design-docs/specs/command.md`
- `packages/rielflow/src/workflow/packages/checkout-records.ts`
- `packages/rielflow/src/workflow/packages/status.ts`
- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/checkout/registry.ts`
- `packages/rielflow/src/cli/workflow-package-command-handler.ts`
- `packages/rielflow/src/cli/input-output-helpers.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`
- `packages/rielflow/src/cli.test.ts`
- `README.md`

## Modules

### 1. Raw Checkout Catalog Records

#### `packages/rielflow/src/workflow/packages/checkout-records.ts`
#### `packages/rielflow/src/workflow/packages/types.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowRawCheckoutInstalledRecord {
  readonly installType: "workflow-checkout";
  readonly workflowName: string;
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory: string;
  readonly sourceUrl: string;
  readonly contentDigestAlgorithm: "sha256";
  readonly contentDigest: string;
  readonly checkoutRecordPath: string;
  readonly checkedOutAt?: string;
  readonly suggestedCommands: readonly string[];
}

export interface WorkflowPackageListResult {
  readonly packages: readonly WorkflowPackageInstalledRecord[];
  readonly workflowCheckouts: readonly WorkflowRawCheckoutInstalledRecord[];
}
```

**Checklist**:

- [x] Add typed raw checkout record projection for catalog records whose
      `checkoutKind` is absent or not `package`.
- [x] Preserve existing package-only record reader for package-owned mutation
      paths.
- [x] Apply the same scope, project-root, and workflow-definition-dir filters
      used by package checkout records where data is available.
- [x] Generate deterministic `suggestedCommands`.

### 2. Package List Raw Checkout Visibility

#### `packages/rielflow/src/workflow/packages/checkout-records.ts`
#### `packages/rielflow/src/cli/workflow-package-command-handler.ts`

**Status**: COMPLETED

```typescript
export async function listWorkflowPackageCheckouts(input: {
  readonly scope?: WorkflowCheckoutScope;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): Promise<Result<WorkflowPackageListResult, WorkflowPackageFailure>>;
```

**Checklist**:

- [x] Keep `packages` limited to registry-managed package installs.
- [x] Add sorted `workflowCheckouts` entries for matching raw workflow checkout
      records.
- [x] Render text output with package rows first and a separate raw workflow
      checkout section.
- [x] Keep JSON output additive and backward-compatible for existing
      `packages` consumers.

### 3. Package Status Raw Checkout Fallback

#### `packages/rielflow/src/workflow/packages/checkout-records.ts`
#### `packages/rielflow/src/workflow/packages/status.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowRawCheckoutStatusResult
  extends WorkflowRawCheckoutInstalledRecord {
  readonly managedBy: "workflow checkout";
  readonly packageManaged: false;
}

export async function getWorkflowPackageCheckoutStatus(input: {
  readonly workflowName?: string;
  readonly installId?: string;
  readonly scope?: WorkflowCheckoutScope;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): Promise<
  Result<Readonly<Record<string, unknown>>, WorkflowPackageFailure>
>;
```

**Checklist**:

- [x] Preserve package-record-first status resolution.
- [x] If no package record matches and no `--install-id` selector is present,
      search raw workflow checkout records with the same selector/scope
      constraints.
- [x] Return successful `workflow-checkout` status when exactly one raw record
      matches.
- [x] Return the existing missing-package failure only when neither package nor
      raw checkout records match.
- [x] Keep ambiguous raw checkout matches as usage errors requiring an explicit
      scope or clearer selector.

### 4. CLI Messaging And Documentation

#### `packages/rielflow/src/cli/workflow-package-command-handler.ts`
#### `packages/rielflow/src/cli/input-output-helpers.ts`
#### `README.md`

**Status**: COMPLETED

```typescript
export interface WorkflowRawCheckoutTextSummary {
  readonly workflowName: string;
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory: string;
  readonly sourceUrl: string;
  readonly suggestedCommands: readonly string[];
}
```

**Checklist**:

- [x] Make text `package status` identify raw checkout status as
      `install type: workflow-checkout`.
- [x] Print `managed by: workflow checkout` and `package managed: false`.
- [x] Include `workflow usage` guidance and a package-install hint without
      claiming a package id was inferred.
- [x] Update help/docs so `package list` and `package status` state the
      package install versus raw workflow checkout boundary.

### 5. Regression Tests And Verification

#### `packages/rielflow/src/workflow/packages/packages.test.ts`
#### `packages/rielflow/src/cli.test.ts`

**Status**: COMPLETED

```typescript
interface RawCheckoutStatusTestCase {
  readonly command: string;
  readonly output: "json" | "text";
  readonly expectedInstallType: "workflow-checkout";
  readonly expectedExitCode: 0;
}
```

**Checklist**:

- [x] Add package-service tests for package list including raw checkout records
      while preserving package-only `packages`.
- [x] Add package-service tests for package status raw-checkout fallback,
      package-record precedence, missing-package behavior, and ambiguous raw
      checkout behavior.
- [x] Add CLI JSON/text tests covering user-scope raw workflow checkout
      reproduction from issue #47.
- [x] Add guard tests proving package update/remove still do not manage raw
      workflow checkout records.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Raw checkout catalog projection | `packages/rielflow/src/workflow/packages/checkout-records.ts`, `packages/rielflow/src/workflow/packages/types.ts` | COMPLETED | `packages.test.ts` |
| Package list output | `packages/rielflow/src/workflow/packages/checkout-records.ts`, `packages/rielflow/src/cli/workflow-package-command-handler.ts` | COMPLETED | `packages.test.ts`, `cli.test.ts` |
| Package status fallback | `packages/rielflow/src/workflow/packages/checkout-records.ts`, `packages/rielflow/src/workflow/packages/status.ts` | COMPLETED | `packages.test.ts`, `cli.test.ts` |
| CLI text/help/docs | `packages/rielflow/src/cli/workflow-package-command-handler.ts`, `packages/rielflow/src/cli/input-output-helpers.ts`, `README.md` | COMPLETED | CLI status tests |
| Regression verification | `packages/rielflow/src/workflow/packages/packages.test.ts`, `packages/rielflow/src/cli.test.ts` | COMPLETED | Focused test commands |

## Tasks

### TASK-001: Define Raw Workflow Checkout Projection

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**:

- `packages/rielflow/src/workflow/packages/checkout-records.ts`
- `packages/rielflow/src/workflow/packages/types.ts`

**Dependencies**: None

**Description**:
Add a typed projection for raw workflow checkout records in the checkout
catalog without changing package-owned record filtering for install/update/remove.

**Completion Criteria**:

- [x] Raw workflow checkout records can be read from
      `<user-root>/workflow-registry/checkouts/*.json`.
- [x] Projection includes install type, workflow name, scope, destination,
      source URL, digest fields, record path, timestamp, and suggested commands.
- [x] Package checkout record helpers remain package-only where mutation paths
      depend on them.

### TASK-002: Add Workflow Checkouts To Package List

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/packages/checkout-records.ts`
- `packages/rielflow/src/cli/workflow-package-command-handler.ts`

**Dependencies**: TASK-001

**Description**:
Extend package list result data with a separate `workflowCheckouts` array and
render that collection in text output separately from package rows.

**Completion Criteria**:

- [x] `package list --output json` returns `{ packages, workflowCheckouts }`.
- [x] Raw checkout entries are never mixed into `packages`.
- [x] Text output clearly labels raw workflow checkouts.
- [x] Scope filters apply consistently.

### TASK-003: Add Package Status Raw Checkout Fallback

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/packages/checkout-records.ts`
- `packages/rielflow/src/workflow/packages/status.ts`

**Dependencies**: TASK-001

**Description**:
Resolve package status against package checkout records first, then raw workflow
checkout records when no package record matches.

**Completion Criteria**:

- [x] Matching raw workflow checkouts return exit-0 structured status.
- [x] Status includes `installType`, `managedBy`, `packageManaged`, scope,
      destination, source URL, digest, checkout record path, and guidance.
- [x] Package records still take precedence over raw workflow checkout records.
- [x] Missing and ambiguous cases use specific diagnostics.

### TASK-004: Update CLI Guidance And Docs

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/cli/workflow-package-command-handler.ts`
- `packages/rielflow/src/cli/input-output-helpers.ts`
- `README.md`

**Dependencies**: TASK-002, TASK-003

**Description**:
Update human-facing text and help/docs so package commands describe raw workflow
checkouts as usable workflow installs that are not package-managed.

**Completion Criteria**:

- [x] Text status avoids printing empty package ids for raw checkout statuses.
- [x] Help/docs mention `workflow checkout` versus `package install`.
- [x] Suggested commands point to `workflow usage` for raw checkouts and
      package install only for users who want package lifecycle management.

### TASK-005: Add Focused Tests And Smoke Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/packages/packages.test.ts`
- `packages/rielflow/src/cli.test.ts`

**Dependencies**: TASK-002, TASK-003, TASK-004

**Description**:
Add focused service and CLI regression coverage for issue #47 and ensure
existing package install/list/status/update/remove semantics remain compatible.

**Completion Criteria**:

- [x] Service tests cover raw checkout list/status behavior.
- [x] CLI tests cover issue #47 user-scope reproduction.
- [x] Package update/remove tests prove raw checkout records remain
      non-package-managed.
- [x] Focused `bun test` commands pass.

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| TASK-001 raw checkout projection | Accepted Step 3 design | COMPLETED |
| TASK-002 package list visibility | TASK-001 | COMPLETED |
| TASK-003 package status fallback | TASK-001 | COMPLETED |
| TASK-004 CLI guidance/docs | TASK-002, TASK-003 | COMPLETED |
| TASK-005 tests and smoke verification | TASK-002, TASK-003, TASK-004 | COMPLETED |

## Verification Plan

- `bun test packages/rielflow/src/workflow/packages/packages.test.ts -t "package status"`
- `bun test packages/rielflow/src/workflow/packages/packages.test.ts -t "package list"`
- `bun test packages/rielflow/src/cli.test.ts -t "package status"`
- `bun test packages/rielflow/src/cli.test.ts -t "package list"`
- `USER_ROOT=$(mktemp -d); bun run packages/rielflow/src/bin.ts workflow checkout https://github.com/tacogips/rielflow-packages/tree/main/packages/codex-deepdesign/workflows/codex-deepdesign --user-scope --user-root "$USER_ROOT" --yes; bun run packages/rielflow/src/bin.ts workflow list --scope user --user-root "$USER_ROOT" --output json; bun run packages/rielflow/src/bin.ts workflow usage codex-deepdesign --scope user --user-root "$USER_ROOT"; bun run packages/rielflow/src/bin.ts package list --scope user --user-root "$USER_ROOT" --output json; bun run packages/rielflow/src/bin.ts package status codex-deepdesign --scope user --user-root "$USER_ROOT" --output json`
- `bunx tsc --noEmit`
- `bunx biome check .`
- `git diff --check`

## Completion Criteria

- [x] `package status <workflow> --scope user --output json` returns typed
      raw workflow checkout status when a user-scope raw checkout exists and no
      package record matches.
- [x] `package list --scope user --output json` includes raw workflow checkout
      entries in `workflowCheckouts` while preserving package-only `packages`.
- [x] Package install/list/status/update/remove behavior remains compatible for
      records with `checkoutKind: "package"`.
- [x] Text output and README/help docs explain the raw checkout versus package
      install distinction.
- [x] Focused service tests, CLI tests, typecheck, lint, and issue reproduction
      smoke command pass.

## Progress Log

### Session: 2026-06-05 08:00 JST

**Tasks Completed**: None
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Plan created from accepted Step 3 design for issue #47. Later
implementation sessions should update task status in this file and
`impl-plans/PROGRESS.json` before handoff.

### Session: 2026-06-05 09:00 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented raw workflow checkout projections for package list and
package status, kept package mutation paths package-only with
`NOT_PACKAGE_CHECKOUT`, added service and CLI coverage, updated README guidance,
and verified focused tests, typecheck, Biome, diff check, and issue #47 smoke
reproduction.
