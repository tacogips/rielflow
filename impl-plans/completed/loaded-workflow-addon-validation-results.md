# Loaded Workflow Add-on Validation Results Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-node-executability-validation.md#loaded-workflow-result-consistency`
**Created**: 2026-05-17
**Last Updated**: 2026-05-17

---

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-node-executability-validation.md`

### Summary

Fix loaded/catalog workflow validation so CLI `workflow validate`, GraphQL named
workflow validation, GraphQL bundle validation, and library detailed validation
all expose the same add-on `validate` hook `nodeValidationResults`. The
implementation must preserve detailed async validation results gathered during
add-on resolution, then append active backend preflight results without dropping
or duplicating add-on source records.

### Scope

**Included**:

- CLI loaded workflow validation in
  `packages/divedra/src/cli/workflow-command-handler.ts`.
- GraphQL `validateWorkflowDefinition` with `workflowName` and no submitted
  bundle in `src/graphql/schema/llm-run-overrides.ts`.
- Shared validation helper changes if needed under `src/workflow/validate/`.
- Focused CLI and GraphQL regressions for loaded workflows using add-on
  `validate` hook `nodeValidationResults`.

**Excluded**:

- New executable validation result fields.
- Changes to submitted GraphQL bundle validation behavior except parity
  assertions.
- Changes to codex-agent, claude-code-agent, or cursor-cli-agent adapter
  preflight semantics.
- Broad documentation rewrites beyond any user-facing refresh required after
  implementation.

### Issue Reference

- Workflow mode: issue-resolution
- Source workflow: `recent-change-quality-loop`
- Source node: `step3-handoff`
- Parent execution:
  `div-recent-change-quality-loop-1778956967-7b74a72d`
- Issue title: Fix inconsistent add-on nodeValidationResults in loaded workflow
  validation
- Blocking findings:
  - `packages/divedra/src/cli/workflow-command-handler.ts:423`: CLI loaded
    workflow validation omits add-on validate hook `nodeValidationResults`.
  - `src/graphql/schema/llm-run-overrides.ts:643`: GraphQL named workflow
    validation omits add-on validate hook `nodeValidationResults`.

### Codex Agent References

- `src/workflow/runtime-readiness-agent-probes.ts`: existing active backend
  preflight plumbing to preserve.
- `src/workflow/validate/node-executability-validation.ts`: merge/enrichment
  behavior for passive node, add-on, and agent-backend results.
- `src/cli.test.ts`: existing CLI executable-validation regression location.
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/model-availability.ts`:
  Codex auth/model preflight reference.
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`: Codex model check
  command reference.
- `/Users/taco/gits/tacogips/codex-agent/src/process/types.ts`: Codex process
  option reference.

Intentional design boundary:

- Preserve codex-agent adapter-owned active preflight behavior.
- Treat add-on validation result preservation as provider-neutral; do not copy
  or infer behavior from codex-agent for add-on validate hooks.
- No Cursor adapter behavior changes are part of this plan.

---

## Modules

### 1. Loaded Workflow Detailed Validation Reuse

#### `src/workflow/validate/bundle-validation-entrypoints.ts`
#### optional helper under `src/workflow/validate/`

**Status**: COMPLETED

```typescript
interface LoadedWorkflowNodeValidationInput {
  readonly bundle: NormalizedWorkflowBundle;
  readonly options: WorkflowValidationOptions;
}

interface LoadedWorkflowNodeValidationOutput {
  readonly nodeValidationResults: readonly NodeValidationResult[];
  readonly issues: readonly ValidationIssue[];
}
```

**Deliverables**:

- Provide one reusable path for loaded workflow callers to obtain
  `nodeValidationResults` that include add-on validation results from detailed
  async bundle validation.
- Ensure the helper either preserves loader-produced detailed results or reruns
  `validateWorkflowBundleDetailedAsync` with the same workflow, add-on resolver,
  scoped-root, resolved-source, and `executablePreflight` options.
- Keep executable invalidity based on the final merged
  `nodeValidationResults`.

**Checklist**:

- [x] Add-on `source: "addon"` records are retained for loaded workflows.
- [x] Active agent-backend preflight results remain present when
      `executablePreflight` is true.
- [x] Passive node results are not duplicated after preserving detailed results.
- [x] Structural validation issues continue to use the existing
      `ValidationIssue` contract.

### 2. CLI Loaded Workflow Validation

#### `packages/divedra/src/cli/workflow-command-handler.ts`

**Status**: COMPLETED

**Deliverables**:

- Replace the loaded-validation call that only invokes
  `collectNodeExecutabilityValidation` with the shared detailed-result path.
- Preserve JSON fields: `workflowName`, `workflowId`, `source`, `addonSources`,
  `nodeValidationResults`, and `valid`.
- Preserve text output behavior while summarizing the merged node validation
  results.

**Checklist**:

- [x] `divedra workflow validate <name> --output json` includes add-on validate
      hook results for direct-directory loaded workflows.
- [x] Scoped catalog validation uses the same result preservation behavior.
- [x] `--executable` still returns nonzero when merged node results include
      invalid executable results.

### 3. GraphQL Named Workflow Validation

#### `src/graphql/schema/llm-run-overrides.ts`

**Status**: COMPLETED

**Deliverables**:

- Route `validateWorkflowDefinition` with `workflowName` and no `bundle` through
  the same detailed-result path used by submitted bundle validation.
- Preserve response fields: `valid`, `workflowId`, `addonSources`,
  `nodeValidationResults`, `warnings`, and `issues` where applicable.
- Keep submitted bundle validation behavior intact.

**Checklist**:

- [x] Named validation returns the same add-on hook result records as equivalent
      submitted bundle validation.
- [x] `warnings` and `issues` remain compatible with the existing GraphQL schema
      response contract.
- [x] `executablePreflight` invalidity checks use merged results.

### 4. CLI Regression Coverage

#### `src/cli.test.ts`

**Status**: COMPLETED

**Deliverables**:

- Add or revise a CLI test fixture where a loaded workflow uses a third-party or
  locally registered add-on validate hook that emits a warning/invalid
  `NodeValidationResult`.
- Assert `workflow validate --output json` contains the add-on result for the
  loaded workflow.
- Assert existing CLI bundle/direct validation cases still pass.

**Checklist**:

- [x] Regression fails on the current loaded-path collector-only behavior.
- [x] Assertion includes add-on source, status, message, and node attribution.
- [x] Test remains deterministic and does not require external agent CLIs.

### 5. GraphQL Regression Coverage

#### `src/graphql/schema.test.ts`

**Status**: COMPLETED

**Deliverables**:

- Add or revise a GraphQL regression for `validateWorkflowDefinition` with
  `workflowName` and no `bundle` using an async add-on definition validate hook.
- Compare named-workflow output against submitted-bundle output for the relevant
  add-on `nodeValidationResults`.

**Checklist**:

- [x] Named validation includes add-on validate hook results.
- [x] Submitted bundle validation remains unchanged and serves as the parity
      baseline.
- [x] Test avoids live backend preflight unless explicitly mocked.

### 6. Documentation Refresh Assessment

#### `README.md`
#### `design-docs/specs/command.md`
#### `.agents/skills/divedra-workflow-run/SKILL.md`

**Status**: COMPLETED

**Deliverables**:

- Check whether implementation changes alter user-facing validation output
  beyond the already accepted design update.
- Update only user-facing docs that would otherwise be stale.

**Checklist**:

- [x] Existing design references remain accurate after implementation.
- [x] Any changed CLI or GraphQL output wording is documented.
- [x] No docs imply validation starts workflow execution.

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Loaded detailed-result path | `src/workflow/validate/**` | COMPLETED | `src/workflow/validate.test.ts` if helper behavior is extracted |
| CLI loaded validation | `packages/divedra/src/cli/workflow-command-handler.ts` | COMPLETED | `src/cli.test.ts` |
| GraphQL named validation | `src/graphql/schema/llm-run-overrides.ts` | COMPLETED | `src/graphql/schema.test.ts` |
| CLI regression | `src/cli.test.ts` | COMPLETED | Focused CLI command test |
| GraphQL regression | `src/graphql/schema.test.ts` | COMPLETED | Focused GraphQL mutation test |
| Docs assessment | `README.md`, `design-docs/specs/command.md`, `.agents/skills/divedra-workflow-run/SKILL.md` | COMPLETED | Review |

---

## Task Breakdown

### TASK-001: Shared Loaded Validation Result Path

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Shared helper or entrypoint adjustment under `src/workflow/validate/`.
- Clear option propagation for workflow context, add-on resolvers, scoped root,
  resolved workflow source, and `executablePreflight`.

**Dependencies**: None

**Completion Criteria**:

- [x] Add-on validation results from detailed async validation are included in
      loaded workflow `nodeValidationResults`.
- [x] Active backend preflight still appends agent-backend results when enabled.
- [x] No duplicate passive node result records are introduced.

### TASK-002: CLI Loaded Workflow Integration

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- `packages/divedra/src/cli/workflow-command-handler.ts`

**Dependencies**: TASK-001

**Completion Criteria**:

- [x] CLI JSON output includes add-on hook results for loaded workflows.
- [x] CLI text output continues to summarize invalid and warning node results.
- [x] CLI exit code semantics remain based on merged executable invalidity.

### TASK-003: GraphQL Named Workflow Integration

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- `src/graphql/schema/llm-run-overrides.ts`

**Dependencies**: TASK-001

**Completion Criteria**:

- [x] `validateWorkflowDefinition(workflowName: ...)` includes add-on hook
      results for loaded workflows.
- [x] Named workflow validation matches submitted bundle validation for add-on
      result records.
- [x] Existing GraphQL response contract remains backward compatible.

### TASK-004: CLI Regression Test

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-002
**Deliverables**:

- `src/cli.test.ts`

**Dependencies**: TASK-002

**Completion Criteria**:

- [x] Test covers direct-directory or scoped-catalog loaded validation with an
      add-on validate hook result.
- [x] Test asserts `source: "addon"` result preservation.

### TASK-005: GraphQL Regression Test

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-003
**Deliverables**:

- `src/graphql/schema.test.ts`

**Dependencies**: TASK-003

**Completion Criteria**:

- [x] Test covers named workflow validation with no bundle.
- [x] Test compares add-on result parity with submitted bundle validation.

### TASK-006: Verification and Documentation Refresh

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Focused verification command results.
- Minimal docs updates only if implementation changes user-facing behavior not
  already captured by the design.

**Dependencies**: TASK-004, TASK-005

**Completion Criteria**:

- [x] `bun run typecheck` passes.
- [x] Focused validation, CLI, GraphQL, and package-boundary tests pass.
- [x] User-facing docs are either confirmed current or updated.

---

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Shared loaded validation result path | None | COMPLETED |
| CLI loaded workflow integration | Shared path | COMPLETED |
| GraphQL named workflow integration | Shared path | COMPLETED |
| CLI regression test | CLI integration | COMPLETED |
| GraphQL regression test | GraphQL integration | COMPLETED |
| Verification and docs refresh | CLI and GraphQL tests | COMPLETED |

---

## Parallelization Plan

- TASK-004 and TASK-005 may run in parallel after their respective integration
  tasks because their write scopes are disjoint: `src/cli.test.ts` and
  `src/graphql/schema.test.ts`.
- TASK-002 and TASK-003 should not run in parallel unless TASK-001 exposes a
  stable helper first; both need the same loaded validation semantics.
- TASK-006 is serial because it validates the integrated behavior and decides
  whether documentation needs refreshing.

---

## Verification Plan

Run focused checks during implementation:

```bash
bun run test -- src/workflow/validate.test.ts
bun run test -- src/cli.test.ts -t "workflow validate"
bun run test -- src/graphql/schema.test.ts -t "validateWorkflowDefinition"
```

Run final checks before completion:

```bash
bun run typecheck
bun run test -- src/workflow/validate.test.ts src/cli.test.ts src/graphql/schema.test.ts src/package-boundaries.test.ts
```

Manual/parity checks to keep explicit:

- CLI `workflow validate --output json` loaded workflow output contains add-on
  `nodeValidationResults`.
- GraphQL `validateWorkflowDefinition` with `workflowName` and no `bundle`
  contains the same add-on `nodeValidationResults` as equivalent submitted
  bundle validation.
- Existing submitted-bundle GraphQL validation behavior remains intact.

---

## Completion Criteria

- [x] Both recent-change mid findings are fixed:
  - [x] `packages/divedra/src/cli/workflow-command-handler.ts:423`
  - [x] `src/graphql/schema/llm-run-overrides.ts:643`
- [x] CLI, GraphQL named workflow validation, GraphQL bundle validation, and
      library detailed validation preserve add-on validate hook
      `nodeValidationResults`.
- [x] No duplicate passive node results are emitted by loaded workflow paths.
- [x] `executablePreflight` invalidity semantics use merged results.
- [x] Focused tests and typecheck pass.
- [x] Progress log is updated after the implementation session and any review
      feedback cycle.

---

## Addressed Design Review Feedback

- Step 3 accepted the design with no high or mid findings.
- Step 3 confirmed the design covers CLI loaded workflow validation and GraphQL
  named workflow validation consistency.
- Step 3 confirmed no `design-docs/user-qa/` file is required because remaining
  choices are implementation details.
- Step 3 confirmed Codex-agent references are explicit and adapter boundaries
  are preserved.

---

## Risks

- Rerunning detailed validation with different options could produce results
  that do not match the loader path.
- Preserving detailed results and then running active preflight can duplicate
  passive node results if merge logic is not centralized.
- GraphQL named workflow warnings/issues could diverge from submitted bundle
  validation if only `nodeValidationResults` are copied.
- Regression fixtures must avoid live backend preflight so tests remain
  deterministic.

---

## Progress Log

### Session: 2026-05-17

**Tasks Completed**: Plan created after Step 3 design acceptance.

**Notes**:

- Scope is intentionally narrower than the completed broad
  `impl-plans/completed/workflow-node-executability-validation.md` plan.
- Implementation should use TypeScript coding standards and run the repository's
  required post-modification check/test flow after TypeScript edits.

### Session: 2026-05-17 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006

**Blockers**: None.

**Verification**:

- `bun run lint:biome` passed with pre-existing warnings outside touched files.
- `bun run typecheck` passed.
- `bun run test -- src/workflow/validate.test.ts` passed.
- `bun run test -- src/cli.test.ts -t "workflow validate"` passed.
- `bun run test -- src/graphql/schema.test.ts -t "validateWorkflowDefinition"` passed.
- `bun run test -- src/workflow/validate.test.ts src/cli.test.ts src/graphql/schema.test.ts src/package-boundaries.test.ts` passed.

**Notes**:

- `loadWorkflowFromDisk` now preserves detailed async validation issues and
  `nodeValidationResults` on `LoadedWorkflow`.
- CLI loaded validation and GraphQL named validation now consume the loaded
  detailed result instead of replacing it with a collector-only result.
- CLI and GraphQL regressions cover loaded add-on validate hook result
  preservation; GraphQL also compares named validation with submitted-bundle
  validation.
- No additional user-facing documentation refresh was required beyond the
  accepted design and command design updates already made in prior steps.

### Session: 2026-05-17 Step 7 Review Follow-up

**Tasks Completed**: Plan archival and progress index updates.

**Blockers**: None.

**Notes**:

- Addressed Step 7 mid-severity progress-tracking finding by moving this
  completed plan from `impl-plans/active/` to `impl-plans/completed/`.
- Updated `impl-plans/README.md` and `impl-plans/PROGRESS.json` so the
  completed plan is indexed outside the active plan set.
