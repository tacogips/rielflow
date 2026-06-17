# Native Command Bash Script Dispatch Implementation Plan

**Status**: Implemented
**Design Reference**: `design-docs/specs/architecture.md#native-command-script-dispatch`; `design-docs/specs/command.md#workflow-run-name-or-registry-target`
**Created**: 2026-06-05
**Last Updated**: 2026-06-05

## Design Document Reference

**Source**: `design-docs/specs/architecture.md:84`; `design-docs/specs/command.md:184`

### Summary

Implement issue #46 by making native `nodeType: "command"` script dispatch
select an interpreter from explicit script extension rules. Workflow-local
`.bash` scripts must run as `bash <scriptPath> ...args` even when the script is
not executable, `.sh` scripts must continue to run as
`sh <scriptPath> ...args`, and every other script path must continue to execute
directly with normal host executable-bit and shebang requirements.

### Scope

**Included**:

- Native command-node dispatch in
  `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts`.
- The re-exported runtime path in
  `packages/rielflow/src/workflow/native-node-executor/template-env-and-containers.ts`.
- Regression coverage in
  `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts`.
- Verification that package pre-install executable-file warnings remain
  separate from runtime interpreter dispatch.

**Excluded**:

- Broadening interpreter dispatch beyond `.bash` and `.sh`.
- Changing `command.argvTemplate` rendering or shell-string interpolation
  behavior.
- Changing cwd precedence:
  `node.workingDirectory ?? command.workingDirectory ?? workflowWorkingDirectory`.
- Relaxing direct execution requirements for non-`.sh` and non-`.bash`
  script paths.
- Refreshing `rielflow-package.json` digests unless workflow package scripts,
  prompts, workflow files, or skill files are edited.

## Issue Reference

- Repository: `tacogips/rielflow`
- Issue: `#46`
- Issue URL: `https://github.com/tacogips/rielflow/issues/46`
- Workflow ID: `codex-design-and-implement-review-loop`
- Node ID: `step4-impl-plan-create`
- Workflow mode: `issue-resolution`
- Accepted design review: `step3-design-review`, exec `exec-000005`,
  accepted with no high or mid findings.

## Codex Agent References

- `step1-issue-intake`, exec `exec-000002`: issue scope, acceptance signals,
  impacted areas, constraints, and verification commands.
- `step2-design-doc-update`, exec `exec-000003`: accepted design source of
  truth and decisions D1-D5.
- `step3-design-review`, exec `exec-000005`: design accepted without revision.
- `codex-agent`: workflow execution backend reference only; no codex-agent
  repository behavior is copied or required.

## Modules

### 1. Native Command Dispatch

#### packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts

**Status**: COMPLETED

```typescript
interface CommandDispatch {
  readonly command: string;
  readonly args: readonly string[];
}

type CommandScriptExtension = ".bash" | ".sh" | "direct";
```

**Checklist**:

- [x] Resolve `commandConfig.runtimeScriptPath ?? path.join(input.workflowDirectory, commandConfig.scriptPath)` exactly once.
- [x] Dispatch `.bash` as command `bash` with args `[scriptPath, ...argv]`.
- [x] Dispatch `.sh` as command `sh` with args `[scriptPath, ...argv]`.
- [x] Dispatch all other paths directly as command `scriptPath` with args `[...argv]`.
- [x] Preserve rendered argv entries without shell-string interpolation.
- [x] Preserve cwd and env construction already used by command nodes.

### 2. Native Command Re-export Boundary

#### packages/rielflow/src/workflow/native-node-executor/template-env-and-containers.ts

**Status**: COMPLETED

```typescript
export * from "../../../../rielflow-addons/src/native-node-executor/template-env-and-containers";
```

**Checklist**:

- [x] Confirm no duplicate dispatch implementation exists under `packages/rielflow/src`.
- [x] Keep the re-export boundary unchanged unless the source layout changed.

### 3. Regression Coverage

#### packages/rielflow/src/workflow/native-node-executor-gateway.test.ts

**Status**: COMPLETED

```typescript
interface BashDispatchRegressionFixture {
  readonly scriptPath: string;
  readonly mode: 0o644;
  readonly requiresBashSyntax: true;
}
```

**Checklist**:

- [x] Add or retain a non-executable `.bash` fixture with mode `0644`.
- [x] Use bash-only syntax such as arrays, `[[ ... ]]`, or `$BASH` checks so
      `/bin/sh` dispatch cannot pass accidentally.
- [x] Assert the fixture has no execute bits before execution.
- [x] Assert the command payload still reports the expected working directory.
- [x] Keep existing `.sh` and direct execution tests intact.

### 4. Package Scanner Boundary

#### packages/rielflow/src/workflow/packages/pre-install-scanner.ts

**Status**: COMPLETED

```typescript
interface PackageExecutableWarningBoundary {
  readonly executablePackageFilesStillWarn: true;
  readonly runtimeInterpreterDispatchIsSeparate: true;
}
```

**Checklist**:

- [x] Inspect package pre-install scanner behavior for executable-file warning scope.
- [x] Do not suppress executable-file warnings as part of this issue.
- [x] Record that no package scanner code change is required unless inspection
      proves runtime dispatch depends on scanner output.

### 5. Documentation And Progress Tracking

#### design-docs/specs/architecture.md
#### design-docs/specs/command.md
#### impl-plans/active/native-command-bash-script-dispatch.md

**Status**: COMPLETED

```typescript
interface DispatchDocumentationHandoff {
  readonly designDocsReviewed: true;
  readonly progressLogUpdated: true;
}
```

**Checklist**:

- [x] Confirm accepted design docs already document `.bash`, `.sh`, direct
      execution, argv, and cwd behavior.
- [x] Add only narrowly scoped documentation follow-up if implementation
      discovers a mismatch with the accepted design.
- [x] Update this plan's progress log during implementation handoff with tasks
      completed, verification results, blockers, and notes.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Native command dispatch | `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts` | COMPLETED | `bun test packages/rielflow/src/workflow/native-node-executor-gateway.test.ts` passed |
| Native command re-export boundary | `packages/rielflow/src/workflow/native-node-executor/template-env-and-containers.ts` | COMPLETED | Covered by gateway test |
| Regression coverage | `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts` | COMPLETED | `bun test packages/rielflow/src/workflow/native-node-executor-gateway.test.ts` passed |
| Package scanner boundary | `packages/rielflow/src/workflow/packages/pre-install-scanner.ts` | COMPLETED | Inspection confirmed unchanged scanner warning boundary |
| Documentation and progress tracking | `design-docs/specs/architecture.md`; `design-docs/specs/command.md`; `impl-plans/active/native-command-bash-script-dispatch.md` | COMPLETED | `git diff --check` passed |

## Tasks

### TASK-001: Inspect Existing Dispatch And Scanner Boundary

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Evidence of the current command/script/args selection in the native executor.
- Evidence that package executable warnings do not control runtime dispatch.

**Dependencies**: None.

**Implementation Notes**:

- Read
  `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts`
  around command-node execution.
- Read
  `packages/rielflow/src/workflow/native-node-executor/template-env-and-containers.ts`
  to confirm the re-export boundary.
- Inspect
  `packages/rielflow/src/workflow/packages/pre-install-scanner.ts` only for
  boundary verification; do not change it unless it blocks the accepted design.

**Completion Criteria**:

- [x] Implementer knows whether `.bash` dispatch is absent, incomplete, or
      already present.
- [x] Implementer records any existing local fix before changing files.
- [x] Package scanner behavior is confirmed out of scope unless proven coupled.

### TASK-002: Implement Extension-Based Bash Dispatch

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts`

**Dependencies**: TASK-001.

**Implementation Notes**:

- Compute extension with `path.extname(scriptPath)`.
- Select `bash` only for `.bash` and `sh` only for `.sh`.
- When an interpreter is selected, pass `[scriptPath, ...argv]`.
- When no interpreter is selected, pass `[...argv]` and spawn `scriptPath`
  directly.
- Keep env, timeout, process-log, mailbox, output-contract, and cwd behavior
  unchanged.

**Completion Criteria**:

- [x] Non-executable `.bash` scripts no longer fail with `EACCES`.
- [x] `.sh` behavior remains unchanged.
- [x] Other script paths still rely on direct host execution.
- [x] `argvTemplate` values remain argv entries, not a shell command string.

### TASK-003: Add Focused Regression Coverage

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts`

**Dependencies**: TASK-002.

**Implementation Notes**:

- Use a workflow-local `scripts/*.bash` fixture with mode `0o644`.
- Include bash-only syntax that fails under `/bin/sh`.
- Assert no execute bits with `stat(scriptAbsPath).mode & 0o111`.
- Assert payload cwd to ensure interpreter dispatch did not alter working
  directory resolution.

**Completion Criteria**:

- [x] Test fails against direct `posix_spawn <script>.bash` when mode is `0644`.
- [x] Test fails if `.bash` routes through `/bin/sh`.
- [x] Test passes when `.bash` routes through `bash`.

### TASK-004: Confirm Documentation And Update Progress Log

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Confirmation that accepted design docs still match implementation behavior.
- Updated progress log entry in this plan.

**Dependencies**: TASK-003.

**Implementation Notes**:

- Review `design-docs/specs/architecture.md:84` and
  `design-docs/specs/command.md:184` after implementation.
- If behavior differs from design, stop for design revision instead of editing
  docs to match unsupported architecture.
- Append a dated progress-log entry recording completed tasks, verification,
  blockers, and handoff notes.

**Completion Criteria**:

- [x] No documentation mismatch remains between implementation and accepted
      design.
- [x] This plan's progress log is current for implementation handoff.

### TASK-005: Verify Runtime And Package Workflow Behavior

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Verification command results in the implementation-step output.
- Any unavailable environment-dependent smoke command recorded with reason.

**Dependencies**: TASK-004.

**Implementation Notes**:

- Run focused test first.
- Run typecheck because the implementation and regression coverage are
  TypeScript.
- Run server build because the issue report listed it as validation.
- Run package-managed `codex-source-security-check-loop` smoke if credentials,
  package install state, and environment permit.
- Run `git diff --check` on touched files before handoff.

**Completion Criteria**:

- [x] Required focused regression test passes.
- [x] Typecheck passes or unrelated pre-existing failure is recorded with
      evidence.
- [x] Build passes or unrelated pre-existing failure is recorded with evidence.
- [x] Package-managed workflow smoke passes or is explicitly recorded as not
      available in this environment.
- [x] No unrelated dirty worktree changes are reverted or reformatted.

## Dependencies

| Task | Depends On | Write Scope | Status |
| --- | --- | --- | --- |
| TASK-001 | None | Read-only inspection | COMPLETED |
| TASK-002 | TASK-001 | `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts` | COMPLETED |
| TASK-003 | TASK-002 | `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts` | COMPLETED |
| TASK-004 | TASK-003 | `impl-plans/active/native-command-bash-script-dispatch.md`; documentation only if mismatch found | COMPLETED |
| TASK-005 | TASK-004 | Verification only | COMPLETED |

## Parallelizable Tasks

No tasks are marked parallelizable. TASK-002 and TASK-003 touch disjoint files,
but the regression fixture must be written against the exact dispatch behavior
chosen in TASK-002. TASK-004 depends on implementation and tests, and TASK-005
depends on documentation/progress-log handoff.

## Verification Plan

Required:

```bash
bun test packages/rielflow/src/workflow/native-node-executor-gateway.test.ts
bun run typecheck
bun run build:server
git diff --check -- packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts packages/rielflow/src/workflow/native-node-executor-gateway.test.ts impl-plans/active/native-command-bash-script-dispatch.md
```

Package-managed workflow smoke when available:

```bash
workflow run codex-source-security-check-loop --working-dir /Users/taco/gits/tacogips/rielflow
```

Boundary check if scanner code is touched unexpectedly:

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
```

## Completion Criteria

- [x] Issue #46 acceptance signals are met.
- [x] `.bash` scripts run through `bash` at mode `0644`.
- [x] `.sh` scripts continue to run through `sh`.
- [x] Non-shell script paths still execute directly.
- [x] Regression coverage proves bash-only semantics, not only absence of
      `EACCES`.
- [x] Package executable-file warnings remain deterministic and unchanged.
- [x] Documentation remains aligned with accepted design, or any mismatch is
      routed back as design revision.
- [x] The progress log records implementation results and blockers.
- [x] Required verification commands are run and recorded.
- [x] `rielflow-package.json` digests are refreshed only if workflow package,
      prompt, script, or skill files are edited.

## Progress Log

### Session: 2026-06-05 00:00 JST

**Tasks Completed**: Plan created after Step 3 accepted the design.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 4 observed an existing active plan,
`impl-plans/active/native-bash-dispatch-regression-test.md`, from a separate
completed cross-workflow review path. This plan is the issue #46 implementation
plan and keeps the accepted design as source of truth.

### Session: 2026-06-05 00:34 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Tasks In Progress**: None.
**Blockers**: Package-managed `codex-source-security-check-loop` smoke could
not run because scoped workflow lookup could not find
`codex-source-security-check-loop`, and package registry search/install did not
find the package despite stale checkout metadata.
**Notes**: Inspection found the native executor already implements the accepted
dispatch rule: `.bash` selects `bash`, `.sh` selects `sh`, and other paths run
directly with rendered argv preserved as process arguments. The
`packages/rielflow/src` executor file remains a re-export. The package
pre-install scanner still emits deterministic executable-file warnings
independently of runtime interpreter dispatch. No workflow package, prompt,
script, or skill files were edited, so no `rielflow-package.json` digest refresh
was required.

## Related Plans

- **Related**: `impl-plans/active/native-bash-dispatch-regression-test.md`
  covers a prior completed review finding focused on bash-only regression
  coverage.
- **Depends On**: Accepted Step 2 design update in
  `design-docs/specs/architecture.md` and `design-docs/specs/command.md`.
