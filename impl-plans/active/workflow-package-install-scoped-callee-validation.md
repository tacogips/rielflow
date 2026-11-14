# Workflow Package Install Scoped Callee Validation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-package-checkout.md#scoped-cross-workflow-validation-during-install`, `design-docs/specs/architecture.md#workflow-checkout-boundary`
**Created**: 2026-06-01
**Last Updated**: 2026-06-01

## Design Reference

Implement the accepted issue-resolution design for package install validation of
staged workflows that call already installed cross-workflow callees.

`checkoutWorkflowPackage` currently validates package workflows through a
package-local or temporary workflow root that can hide scoped workflows already
installed in the destination runtime catalog. Package install validation must
model the post-install resolver environment: the staged workflow shadows any
installed workflow with the same id, package-local sibling workflows remain
visible, and other `steps[].transitions[].toWorkflowId` callees resolve from the
same scoped project/user/direct roots that runtime execution would use after
install.

In scope:

- Build install-time validation roots for `checkoutWorkflowPackage`.
- Preserve provider-neutral validation for packages whose node payloads use
  `codex-agent`, `claude-code-agent`, or other existing backends.
- Preserve install safety: validation, integrity checks, and optional
  pre-install checks must finish before destination mutation.
- Add focused regression tests for project scope, user scope, direct
  `--workflow-definition-dir`, staged-workflow shadowing, package-local sibling
  workflows, and missing-callee diagnostics.

Out of scope:

- Automatic workflow package dependency fetching.
- New package dependency metadata.
- Codex-agent-specific package install behavior.
- Changes to temporary package run validation unless required by shared helper
  extraction and covered by tests.

## Issue Reference

- Workflow mode: `issue-resolution`
- Issue title: `Fix package install validation for workflows with installed cross-workflow callees`
- Reproduction command:
  `bun run packages/rielflow/src/bin.ts package install codex-impl-plan-completion-loop --pre-install-check --output json`
- Expected behavior: package install validation succeeds when required
  cross-workflow callees such as `codex-design-and-implement-review-loop` or
  `codex-refactoring-slice-review` are already installed in the relevant
  project/user scope.

## Codex Agent References

- `codex-agent`: backend value inside affected package node payloads only; no
  codex-agent-specific install behavior.
- `codex-design-and-implement-review-loop`: installed callee workflow that must
  resolve through scoped install-time validation.
- `codex-impl-plan-completion-loop`, `codex-recent-change-quality-loop`,
  `codex-refactoring-divide-and-conquer`: package examples expected to install
  without vendoring all callees.

Relevant local files:

- `design-docs/specs/design-workflow-package-checkout.md`
- `design-docs/specs/architecture.md`
- `packages/rielflow/src/workflow/packages/checkout.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`
- `packages/rielflow/src/workflow/catalog.ts`
- `packages/rielflow/src/workflow/load.ts`
- `packages/rielflow/src/workflow/validate/semantic-validation-and-addons.ts`
- `packages/rielflow/src/cli/workflow-package-command-handler.ts`

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Install validation resolver | `packages/rielflow/src/workflow/packages/checkout.ts` | COMPLETED | Package checkout regression tests |
| Scoped catalog/load integration | `packages/rielflow/src/workflow/catalog.ts`, `packages/rielflow/src/workflow/load.ts` | NOT_STARTED | Loader/catalog tests if API changes |
| Cross-workflow diagnostics | `packages/rielflow/src/workflow/validate/semantic-validation-and-addons.ts` | COMPLETED | Missing-callee regression test |
| Package install tests | `packages/rielflow/src/workflow/packages/packages.test.ts` | COMPLETED | Focused install validation cases |
| CLI smoke path | `packages/rielflow/src/cli/workflow-package-command-handler.ts` | COMPLETED_WITH_ENV_BLOCKER | Manual reproduction command |

## Planned Interfaces

The implementation may keep these helpers private to package checkout unless a
catalog/load API change is clearly simpler and lower-risk.

```typescript
interface PackageInstallValidationWorkflowRootInput {
  readonly sourceDirectory: string;
  readonly sourceWorkflowRoot: string;
  readonly destinationWorkflowRoot: string;
  readonly scope: WorkflowCheckoutScope;
  readonly userRoot: string;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}

interface PackageInstallValidationWorkflowRoot {
  readonly workflowRoot: string;
  readonly searchedRoots: readonly string[];
  readonly cleanup: () => Promise<void>;
}
```

If the loader/validator path is extended instead of temporary-root composition,
the public option must remain provider-neutral and scoped narrowly to workflow
source resolution, for example:

```typescript
interface LoadOptions {
  readonly workflowRootSearchPath?: readonly string[];
}
```

Do not add backend-specific options for `codex-agent`.

## Tasks

### TASK-001: Confirm Existing Failure And Resolver Shape

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Notes in this plan progress log identifying the current failing validation
  path and chosen implementation shape.
- No production code changes required for this task unless a tiny test fixture
  helper extraction is needed.

**Dependencies**: None.

**Implementation Notes**:

- Run or simulate the reproduction command from the issue when local package
  registry data is available.
- Inspect current `checkoutWorkflowPackage` validation setup and confirm whether
  the fix should adjust the existing temporary validation root composition or add
  an ordered root search path to the loader/validator.
- Preserve package-local sibling workflow visibility and staged-workflow
  shadowing in the chosen shape.

**Completion Criteria**:

- [x] Failing or currently risky code path is identified with file/function
      references.
- [x] Implementation shape is recorded in the progress log.
- [x] No destination mutation is required to reproduce or analyze the failure.

### TASK-002: Implement Scoped Install-Time Validation Resolution

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/packages/checkout.ts`
- Optional scoped helper additions in `packages/rielflow/src/workflow/catalog.ts`
  or `packages/rielflow/src/workflow/load.ts` only if temporary-root composition
  cannot safely preserve precedence.

**Dependencies**: TASK-001.

**Implementation Notes**:

- Validation roots must be ordered as staged package workflow root, destination
  workflow root, then remaining runtime-visible scoped roots for the same command
  context.
- For default project-scope install, project scope must be searched before user
  scope.
- For `--user-scope`, do not silently depend on project-local callees that may
  not be visible during later user-scope execution outside the project.
- For `--workflow-definition-dir`, include that direct destination root while
  preserving existing destination override rules.
- Ensure staged workflow content shadows installed workflows with the same
  workflow id.
- Always clean temporary validation roots on success and failure.

**Completion Criteria**:

- [x] `checkoutWorkflowPackage` validates cross-workflow callees against the
      post-install scoped resolver model.
- [x] Package-local sibling workflows remain visible during validation.
- [x] Missing callees still fail before mutation.
- [x] Temporary validation state is removed on all validation outcomes.

### TASK-003: Improve Missing-Callee Diagnostics

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001 only if TASK-002 chooses a stable
diagnostic surface before this task starts.
**Deliverables**:

- `packages/rielflow/src/workflow/packages/checkout.ts`
- Optional `packages/rielflow/src/workflow/validate/semantic-validation-and-addons.ts`
  changes if searched roots must be propagated through validation issues.

**Dependencies**: TASK-001; coordinate with TASK-002.

**Implementation Notes**:

- Error output for unresolved `toWorkflowId` must include the caller workflow,
  the unresolved callee id, the transition path, and searched roots.
- Preserve current `WorkflowPackageFailure` result shape unless a typed addition
  already exists locally.
- Keep diagnostics useful in `--output json` and normal CLI output.

**Completion Criteria**:

- [x] Missing-callee package install fails with a clear `VALIDATION` failure.
- [x] Diagnostic text names the unresolved callee and searched roots.
- [x] Existing validation messages outside package install remain stable unless
      tests are intentionally updated.

### TASK-004: Add Package Install Regression Tests

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/packages/packages.test.ts`
- Optional fixture helpers in the same test file.

**Dependencies**: TASK-002, TASK-003.

**Implementation Notes**:

- Add a project-scope test where the staged package workflow calls an already
  installed project-scope callee.
- Add a user-scope test where the staged package workflow calls an already
  installed user-scope callee and does not depend on project-only callees.
- Add a direct `workflowRoot` override test for `--workflow-definition-dir`
  behavior.
- Add a staged shadowing test proving the candidate workflow wins over an
  installed workflow with the same id.
- Add a package-local sibling test proving siblings inside the package source
  remain visible.
- Add a missing-callee failure test that verifies diagnostics and no destination
  mutation.

**Completion Criteria**:

- [x] Tests fail against the pre-fix behavior where applicable.
- [x] Tests pass after TASK-002 and TASK-003.
- [x] Tests assert both success paths and mutation safety on failure.

### TASK-005: Verify CLI Reproduction And Type Safety

**Status**: COMPLETED_WITH_ENV_BLOCKER
**Parallelizable**: No
**Deliverables**:

- Progress log entry with verification command results.
- No source changes unless CLI output loses required diagnostic context.

**Dependencies**: TASK-004.

**Implementation Notes**:

- Run focused tests before broader test/typecheck commands.
- Run the issue reproduction command from `/Users/taco/gits/tacogips/rielflow`
  when the local registry/package data exists.
- If the reproduction command cannot run because registry data is missing,
  record the exact blocker and rely on deterministic local fixture tests.

**Completion Criteria**:

- [x] Focused package checkout tests pass.
- [x] Relevant loader/validator tests pass if shared APIs changed.
- [x] `bun run typecheck` passes.
- [x] Reproduction command succeeds or a concrete environment blocker is logged.

## Dependencies

| Task | Depends On | Status |
| --- | --- | --- |
| TASK-001 | None | COMPLETED |
| TASK-002 | TASK-001 | COMPLETED |
| TASK-003 | TASK-001, coordination with TASK-002 | COMPLETED |
| TASK-004 | TASK-002, TASK-003 | COMPLETED |
| TASK-005 | TASK-004 | COMPLETED_WITH_ENV_BLOCKER |

## Parallelization

- TASK-001, TASK-002, TASK-004, and TASK-005 are sequential because they share
  `packages/rielflow/src/workflow/packages/checkout.ts` behavior and tests.
- TASK-003 can run in parallel with TASK-002 only after TASK-001 establishes the
  diagnostic surface and the implementers coordinate the shared checkout and
  validation files. Otherwise, keep it sequential.

## Verification Plan

Run these commands from `/Users/taco/gits/tacogips/rielflow`:

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun test packages/rielflow/src/workflow/load.test.ts packages/rielflow/src/workflow/validate.test.ts
bun run typecheck
bun run packages/rielflow/src/bin.ts package install codex-impl-plan-completion-loop --pre-install-check --output json
```

If shared catalog or loader APIs are changed, also run:

```bash
bun test packages/rielflow/src/workflow/catalog.test.ts packages/rielflow/src/workflow/runtime-readiness-backends.test.ts
```

## Completion Criteria

- [x] Package install validation uses post-install scoped workflow resolution
      for `toWorkflowId` callees.
- [x] Staged package workflow content shadows installed workflow content with
      the same workflow id.
- [x] Package-local sibling workflows remain visible during validation.
- [x] Project-scope, user-scope, and direct workflow-root override behavior are
      covered by tests.
- [x] Missing callees fail before mutation with searched-root diagnostics.
- [x] No codex-agent-specific package install behavior is introduced.
- [x] Focused tests and typecheck pass.
- [x] The plan progress log is updated after each implementation session.

## Progress Log

### Session: 2026-06-01 00:00

**Tasks Completed**: Plan creation only.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Created from accepted Step 3 design review for
`codex-design-and-implement-review-loop` node `step4-impl-plan-create`.

### Session: 2026-06-01 17:21 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Tasks In Progress**: None.
**Blockers**: Exact CLI reproduction command reached package lookup but failed
before install with `package checksum mismatch for
'codex-impl-plan-completion-loop'`, indicating local registry/package metadata
is stale relative to the package contents.
**Notes**: Implemented package install validation with a temporary composite
workflow root ordered as package source root, destination workflow root, then
user workflow root only when runtime-visible. Package-local workflows now shadow
installed workflows with the same id, the primary staged workflow is recopied
last for deterministic shadowing, and temporary validation roots are cleaned up
through `finally`. Package validation failures now include validation issue
details and searched roots. Added deterministic checkout regression coverage for
installed project-scope callees, user-scope callees and project-only isolation,
direct workflow definition roots, package-local sibling callees, staged
shadowing, and missing callee mutation safety.

### Session: 2026-06-01 17:21 JST Follow-up

**Tasks Completed**: TASK-002, TASK-004 follow-up.
**Tasks In Progress**: None.
**Blockers**: Exact CLI reproduction remains blocked by the local package
checksum mismatch for `codex-impl-plan-completion-loop`.
**Notes**: Initial follow-up explored dependency cleanup, but Step 7 later
rejected automatic manifest dependency checkout as out of scope for this issue.
That dependency work was removed in the Step 7 remediation session. The scoped
validation fix and missing-callee mutation safety remained in scope.

### Session: 2026-06-01 17:21 JST Self-review Remediation

**Tasks Completed**: TASK-002, TASK-004, TASK-005 follow-up.
**Tasks In Progress**: None.
**Blockers**: Exact CLI reproduction remains blocked by the local package
checksum mismatch for `codex-impl-plan-completion-loop`.
**Notes**: Addressed Step 6 self-review findings before independent review.
Direct `--workflow-definition-dir` validation no longer includes user-scope
workflow roots, matching direct runtime visibility. Added regression coverage
for direct workflow-root rejection of user-only callees. The dependency cleanup
work from the prior follow-up was removed after Step 7 ruled it out of scope.
Re-ran full Biome, focused package tests, loader/validator tests, and typecheck
successfully; exact package reproduction is still blocked by stale checksum
metadata.

### Session: 2026-06-01 17:21 JST Step 7 Remediation

**Tasks Completed**: TASK-002, TASK-004, TASK-005 follow-up.
**Tasks In Progress**: None.
**Blockers**: Exact CLI reproduction remains blocked by the local package
checksum mismatch for `codex-impl-plan-completion-loop`.
**Notes**: Addressed Step 7 mid finding by removing automatic manifest
dependency parsing, recursive dependency checkout, dependency cleanup code, and
tests that asserted automatic dependency installation. Kept the implementation
scoped to composite install-time validation roots for already installed callees,
package-local sibling visibility, staged workflow shadowing, direct root
visibility, missing-callee diagnostics, and mutation safety before destination
writes. Re-ran full Biome, focused package checkout tests, loader/validator
tests, typecheck, and diff whitespace checks successfully.
