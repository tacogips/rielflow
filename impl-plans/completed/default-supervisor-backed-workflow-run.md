# Default Supervisor-Backed Workflow Run Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#default-supervisor-backed-starts`; `design-docs/specs/command.md#workflow`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

## Design Reference

Step 3 accepted the design updates for default supervisor-backed workflow
starts. This plan covers the remaining candidate-patch review/fix work needed
before the workflow can accept the uncommitted patch.

Source-of-truth requirements:

- `workflow run` starts under the default auto-improve supervisor policy unless
  `--no-auto-improve` is present.
- Remote `workflow run --endpoint ... --no-auto-improve` must send
  `autoImprove: { enabled: false }` through GraphQL; omitting `autoImprove`
  is not an opt-out because GraphQL defaults omitted policy input to a
  supervisor-backed start.
- GraphQL `executeWorkflow` defaults omitted `autoImprove` to supervised
  execution and preserves explicit `autoImprove: { enabled: false }`.
- Library `executeWorkflow()` defaults to supervised starts and exposes
  `disableAutoImprove` for intentional unsupervised starts.
- Low-level `runWorkflow()`, resume, rerun, continuation, and direct
  `call-step` behavior remain outside this default-start change unless they
  explicitly pass an auto-improve policy.

Out of scope:

- Reverting or fixing unrelated dirty worktree files.
- Adding the missing `divedra-default-superviser` workflow bundle.
- Changing nested supervisor session catalog discovery.
- Changing docs beyond the accepted default-supervisor-backed start contract
  unless Step 7 review finds a direct mismatch.

## Modules

### 1. Remote CLI Opt-Out Serialization

#### `src/cli.ts`

**Status**: COMPLETED

Deliverable:

- Update the remote GraphQL workflow-run input builder so
  `workflow run --endpoint ... --no-auto-improve` sends an explicit disabled
  auto-improve policy while preserving the existing default policy when the
  flag is omitted.

Expected contract:

- `buildRemoteExecutionInput(parsedOptions, { defaultAutoImprove: true })`
  includes `autoImprove: { enabled: false }` when
  `parsedOptions.disableAutoImprove === true`.
- The same helper still includes `createDefaultAutoImprovePolicy()` when
  default supervision is enabled and no explicit opt-out is present.
- Remote resume/rerun paths are not broadened to default supervision unless
  their existing callers already request it explicitly.

Checklist:

- [x] Preserve `--auto-improve --no-auto-improve` conflict handling.
- [x] Preserve local CLI `workflow run --no-auto-improve` behavior.
- [x] Preserve remote default-supervised `workflow run --endpoint ...`
      behavior.
- [x] Preserve remote explicit `--auto-improve` and nested-superviser payloads.

### 2. Focused CLI Transport Regression Coverage

#### `src/cli.test.ts`

**Status**: COMPLETED

Deliverable:

- Add focused GraphQL transport coverage proving remote
  `workflow run --endpoint ... --no-auto-improve` forwards
  `autoImprove: { enabled: false }`.

Expected assertions:

- The captured GraphQL `executeWorkflow` variables include
  `input.autoImprove.enabled === false`.
- The captured input still includes the requested `workflowName`.
- Existing tests for default remote supervision and nested supervisor payloads
  continue to pass.

Checklist:

- [x] Add a regression test near existing remote workflow-run GraphQL tests.
- [x] Avoid broad fixture rewrites unrelated to this finding.
- [x] Keep JSON-output and fetch mock behavior consistent with neighboring
      tests.

### 3. Candidate Patch Scope And Documentation Check

#### `README.md`
#### `design-docs/specs/architecture.md`
#### `design-docs/specs/command.md`
#### `impl-plans/README.md`

**Status**: COMPLETED

Deliverable:

- Confirm docs and plan indexes describe the final behavior after the code and
  tests are updated. Make only directly required text corrections.

Checklist:

- [x] Keep accepted design references intact.
- [x] Do not mix unrelated dirty worktree files into this issue scope.
- [x] Keep `impl-plans/README.md` aligned with this active plan status.

### 4. Verification And Review Handoff

#### Verification commands

**Status**: COMPLETED

Deliverable:

- Run the required focused verification and prepare Step 7 review inputs with
  explicit changed files, unrelated dirty files, and command results.

Commands:

- `bun run typecheck`
- `bun test src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/workflow/auto-improve-policy.test.ts`
- `env -u DIVEDRA_WORKFLOW_EXECUTION_ID -u DIVEDRA_NODE_EXEC_ID -u DIVEDRA_MAILBOX_DIR -u DIVEDRA_GRAPHQL_ENDPOINT DIVEDRA_ARTIFACT_DIR=/private/tmp/divedra-review-artifacts bun run test -- src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/workflow/auto-improve-policy.test.ts`

Checklist:

- [x] Report any high or mid findings with file paths and line references.
- [x] If no high or mid findings remain, report the candidate patch as
      accepted with explicit changed files and verification.
- [x] If verification is blocked, report the blocker and whether it is
      attributable to the candidate patch.

## Module Status

| Task | File Path | Status | Tests |
| ---- | --------- | ------ | ----- |
| TASK-001 Remote CLI opt-out serialization | `src/cli.ts` | COMPLETED | `src/cli.test.ts` |
| TASK-002 CLI GraphQL transport regression | `src/cli.test.ts` | COMPLETED | `src/cli.test.ts` |
| TASK-003 Scope/docs/index check | `README.md`, `design-docs/specs/architecture.md`, `design-docs/specs/command.md`, `impl-plans/README.md` | COMPLETED | Review |
| TASK-004 Verification and handoff | command output | COMPLETED | Required focused commands |

## Dependencies

| Task | Depends On | Parallelizable | Reason |
| ---- | ---------- | -------------- | ------ |
| TASK-001 | Step 3 accepted design | No | Central behavior fix in `src/cli.ts` |
| TASK-002 | TASK-001 | No | Regression should assert final serialized payload |
| TASK-003 | TASK-001, TASK-002 | No | Documentation must match final behavior |
| TASK-004 | TASK-001, TASK-002, TASK-003 | No | Verification must run after implementation and docs |

## Completion Criteria

- [x] Remote `workflow run --endpoint ... --no-auto-improve` sends
      `autoImprove: { enabled: false }`.
- [x] Remote `workflow run --endpoint ...` without opt-out still sends the
      default supervisor policy.
- [x] Local CLI, GraphQL, and library default supervisor-backed starts remain
      preserved.
- [x] Focused CLI GraphQL transport coverage exists for the remote opt-out.
- [x] Accepted design and README text match the implemented behavior.
- [x] Required typecheck and focused tests pass, including the sanitized-env
      command.
- [x] Unrelated dirty worktree files are listed and left untouched.

## Addressed Feedback

- Step 3 accepted the design and carried forward the implementation finding:
  `src/cli.ts` remote GraphQL `--no-auto-improve` must be handled in later
  implementation/review steps.
- Prior candidate-patch review reported one mid finding at `src/cli.ts:2002`:
  remote GraphQL CLI omitted disabled `autoImprove`, so GraphQL defaults
  re-enabled supervision. TASK-001 and TASK-002 are the required response.
- Step 2 and Step 3 both found no open design questions and no required
  Codex-reference mapping.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Step 4 revised the active implementation plan after Step 3
accepted the design.

**Tasks In Progress**: None.

**Blockers**: Implementation and verification remain for later workflow steps.

**Notes**: The candidate patch remains unaccepted at this point. The worktree
contains unrelated dirty workflow/design/plan files that must be excluded from
this issue-resolution path unless later review proves a direct dependency.

### Session: 2026-05-06 18:24 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: `src/cli.ts` now serializes `autoImprove: { enabled: false }` for
remote `workflow run --endpoint ... --no-auto-improve` while preserving omitted
flag default supervision and explicit `--auto-improve` payloads. Added focused
GraphQL transport regression coverage in `src/cli.test.ts`. Documentation text
already matched the accepted design; only this plan status and
`impl-plans/README.md` status were updated. Verification passed with
`bun run typecheck`,
`bun test src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/workflow/auto-improve-policy.test.ts`,
and
`env -u DIVEDRA_WORKFLOW_EXECUTION_ID -u DIVEDRA_NODE_EXEC_ID -u DIVEDRA_MAILBOX_DIR -u DIVEDRA_GRAPHQL_ENDPOINT DIVEDRA_ARTIFACT_DIR=/private/tmp/divedra-review-artifacts bun run test -- src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/workflow/auto-improve-policy.test.ts`.
