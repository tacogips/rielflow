# Workflow Registry List Command Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-workflow-package-commands.md#registry-list-issue-addendum
**Created**: 2026-05-28
**Last Updated**: 2026-05-28

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-package-commands.md`
**Workflow Mode**: issue-resolution
**Issue Reference**: workflowInput: Support top-level workflow registry list command
**Feature ID**: workflow-registry-list-command
**Accepted Review**: Step 3 accepted the design for implementation planning with
only a low, non-blocking note about the broader Feature Contract issue wording.

### Summary

Add the documented top-level registry-list route:
`rielflow workflow registry list --output json`.

The existing compatibility route
`rielflow workflow package registry list --output json` must continue to work
unchanged. Both routes must use the same registry config loading and rendering
path so JSON fields, default registry inclusion, local-only validation, and
user/project/workflow root handling cannot drift.

### Scope

**Included**: CLI routing for `workflow registry list`, focused tests for the
new route and existing package-scoped route, help and README refresh if stale,
and verification commands.

**Excluded**: `workflow registry add`, `workflow registry remove`,
`workflow registry refresh`, registry storage redesign, package search/checkout
changes, publish behavior, and remote GraphQL support for local-only package
registry commands.

## Modules

### 1. CLI Route Adapter

#### `packages/rielflow/src/cli/workflow-command-handler.ts`
#### `packages/rielflow/src/cli/workflow-registry-command-handler.ts`

**Status**: COMPLETED

```typescript
export async function runCliWorkflowScope(
  context: RunCliScopeContext,
): Promise<number>;
```

**Deliverables**:
- Route `workflow registry list` to the existing package registry list handling
  path.
- Preserve `workflow package registry list` behavior and error messages.
- Preserve local-only `--endpoint` rejection semantics for the top-level route.
- Reject unexpected positional arguments after `workflow registry list`.
- Reject unsupported top-level registry subcommands in a narrow, explicit way
  without claiming `add`, `remove`, or `refresh` are implemented.

**Checklist**:
- [x] `workflow registry list` reaches the same registry-list renderer as
      `workflow package registry list`.
- [x] `workflow registry list --endpoint <url>` is rejected as local-only.
- [x] `workflow registry list <extra>` is rejected instead of silently ignoring
      the extra argument.
- [x] `workflow registry add|remove|refresh` are not accidentally exposed.
- [x] No package registry data reading or JSON rendering is duplicated.

### 2. CLI Tests

#### `packages/rielflow/src/cli.test.ts`

**Status**: COMPLETED

```typescript
import { runCli } from "./cli/run-cli";
```

**Deliverables**:
- Add a focused test proving `workflow registry list --output json` exits `0`.
- Assert the emitted JSON shape includes the existing registry-list fields
  emitted by the compatibility route, including `registries` and
  `defaultRegistryId`.
- Assert `workflow package registry list --output json` still exits `0` and
  emits the same relevant JSON shape.
- Add an error-path assertion for unsupported top-level registry subcommands or
  local-only remote endpoint rejection if existing test structure supports it
  cleanly.

**Checklist**:
- [x] New top-level registry-list test passes.
- [x] Compatibility package-registry list test remains explicit.
- [x] Tests use temporary `--user-root` state and do not depend on the
      developer machine registry config.
- [x] Test assertions avoid brittle full-path snapshots where temporary roots
      are enough.

### 3. User-Facing Help And Docs

#### `packages/rielflow/src/cli/input-output-helpers.ts`
#### `README.md`

**Status**: COMPLETED

**Deliverables**:
- Update CLI help to show `workflow registry list` as the registry-list
  discovery command.
- Keep the package-scoped form documented only as compatibility if README/help
  mention it.
- Avoid documenting `workflow registry add`, `workflow registry remove`, or
  `workflow registry refresh` as implemented unless the implementation step
  actually adds and tests those routes.

**Checklist**:
- [x] Help output includes `workflow registry list [--output json|text]`.
- [x] README registry-package section includes a working
      `workflow registry list --output json` example.
- [x] Documentation still preserves the existing package-scoped registry command
      where useful for compatibility.

### 4. Verification And Progress Tracking

#### `impl-plans/active/workflow-registry-list-command.md`

**Status**: COMPLETED

**Deliverables**:
- Update this plan's module statuses and checklists during implementation.
- Add dated progress-log entries after each implementation session.
- Move the plan to completed only after implementation, tests, and review pass.

**Checklist**:
- [x] Completion criteria are updated as work lands.
- [x] Progress log records commands run and any blocked verification.
- [x] Residual risks are updated before completion handoff.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| CLI route adapter | `packages/rielflow/src/cli/workflow-command-handler.ts`, `packages/rielflow/src/cli/workflow-registry-command-handler.ts` | COMPLETED | `packages/rielflow/src/cli.test.ts` |
| CLI tests | `packages/rielflow/src/cli.test.ts` | COMPLETED | `bun test packages/rielflow/src/cli.test.ts` |
| Help/docs | `packages/rielflow/src/cli/input-output-helpers.ts`, `README.md` | COMPLETED | help assertion and CLI smoke |
| Plan tracking | `impl-plans/active/workflow-registry-list-command.md` | COMPLETED | `git diff --check` |

## Dependencies

| Task | Depends On | Status |
| --- | --- | --- |
| TASK-001: CLI route adapter | Accepted design | COMPLETED |
| TASK-002: Focused CLI tests | TASK-001 | COMPLETED |
| TASK-003: Help and README refresh | Accepted design | COMPLETED |
| TASK-004: Verification and plan updates | TASK-001, TASK-002, TASK-003 | COMPLETED |

## Task Breakdown

### TASK-001: Add Top-Level Registry List Route

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:
- `packages/rielflow/src/cli/workflow-command-handler.ts`
- `packages/rielflow/src/cli/workflow-registry-command-handler.ts`

**Completion Criteria**:
- [x] `workflow registry list --output json` exits through the existing package
      registry list behavior.
- [x] Existing `workflow package registry list --output json` routing remains
      unchanged.
- [x] Unsupported `workflow registry` actions fail with a usage error rather
      than falling through to `unknown workflow command: registry`.
- [x] Unexpected positional arguments after `workflow registry list` fail with
      an arity error.

### TASK-002: Add Focused CLI Coverage

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:
- `packages/rielflow/src/cli.test.ts`

**Completion Criteria**:
- [x] Test covers the new `workflow registry list --output json` command.
- [x] Test covers or preserves explicit coverage for
      `workflow package registry list --output json`.
- [x] Tests verify local-only or unsupported-subcommand behavior without
      depending on external network state.

### TASK-003: Refresh Help And README

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**:
- `packages/rielflow/src/cli/input-output-helpers.ts`
- `README.md`

**Completion Criteria**:
- [x] Help text documents `workflow registry list`.
- [x] README includes the expected `workflow registry list --output json`
      surface.
- [x] Docs do not imply top-level registry add/remove/refresh support.

### TASK-004: Run Verification And Update Plan

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:
- `impl-plans/active/workflow-registry-list-command.md`

**Completion Criteria**:
- [x] Run `bun test packages/rielflow/src/cli.test.ts`.
- [x] Run `bun test packages/rielflow/src/workflow/packages/packages.test.ts`.
- [x] Run `bun run packages/rielflow/src/bin.ts workflow registry list --output json`.
- [x] Run `bun run packages/rielflow/src/bin.ts workflow package registry list --output json`.
- [x] Run `bun run tsc --noEmit`.
- [x] Run `git diff --check`.
- [x] Record verification results in the progress log.

## Parallelization

`TASK-003` may run in parallel with `TASK-001` because it primarily touches
help/docs files. `TASK-002` depends on the route adapter to avoid writing tests
against unavailable behavior. `TASK-004` depends on all implementation tasks.

## Verification Plan

Required commands:

```bash
bun test packages/rielflow/src/cli.test.ts
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun run packages/rielflow/src/bin.ts workflow registry list --output json
bun run packages/rielflow/src/bin.ts workflow package registry list --output json
bun run tsc --noEmit
git diff --check
```

Optional focused pre-check before implementation:

```bash
bun run packages/rielflow/src/bin.ts workflow registry list --output json
```

Expected pre-check result before the fix: usage failure containing
`unknown workflow command: registry`.

## Completion Criteria

- [x] Top-level `workflow registry list --output json` works and emits the same
      registry-list JSON shape as the compatibility route.
- [x] `workflow package registry list --output json` continues to work.
- [x] Focused CLI tests cover both route surfaces.
- [x] Help and README mention the top-level list command without claiming
      unsupported registry subcommands.
- [x] Type checking and focused tests pass.
- [x] Plan progress log is updated with implementation and verification results.

## Progress Log

### Session: 2026-05-28 04:59

**Tasks Completed**: Plan created.
**Notes**: Step 3 accepted the design with no high or mid findings. Plan scope
is limited to `workflow registry list --output json` and compatibility
preservation for `workflow package registry list --output json`.

### Session: 2026-05-28 15:23 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004.
**Verification**: Passed `bun test packages/rielflow/src/cli.test.ts`,
`bun test packages/rielflow/src/workflow/packages/packages.test.ts`,
`bun run packages/rielflow/src/bin.ts workflow registry list --output json`,
`bun run packages/rielflow/src/bin.ts workflow package registry list --output json`,
`bun run typecheck`, `bun run tsc --noEmit`, focused
`biome check packages/rielflow/src/cli/workflow-command-handler.ts packages/rielflow/src/cli/input-output-helpers.ts packages/rielflow/src/cli.test.ts README.md impl-plans/active/workflow-registry-list-command.md --diagnostic-level=warn`,
and `git diff --check`.
**Notes**: Full-repo `biome check . --diagnostic-level=warn` was also run and
failed on pre-existing unrelated formatting diagnostics in event, server,
telemetry, adapter, and communication-service files plus an existing
`noExcessiveLinesPerFile` diagnostic in
`packages/rielflow/src/workflow/validate/node-payload-validation.ts`.

### Session: 2026-05-28 16:10 JST

**Tasks Completed**: Review improvement pass.
**Verification**: Passed `bun test packages/rielflow/src/cli.test.ts`,
`bun test packages/rielflow/src/workflow/packages/packages.test.ts`,
`bun run packages/rielflow/src/bin.ts workflow registry list --output json`,
`bun run packages/rielflow/src/bin.ts workflow package registry list --output json`,
`bun run typecheck`, focused
`biome check packages/rielflow/src/cli/workflow-command-handler.ts packages/rielflow/src/cli/workflow-registry-command-handler.ts packages/rielflow/src/cli/workflow-renderers.ts packages/rielflow/src/cli.test.ts packages/rielflow/src/cli/input-output-helpers.ts packages/rielflow-adapters/src/codex.ts packages/rielflow-adapters/src/cursor.ts packages/rielflow/src/workflow/adapters/codex.test.ts packages/rielflow/src/workflow/adapters/cursor.test.ts --diagnostic-level=warn`,
and `git diff --check`. Full-repo Biome still fails on pre-existing unrelated
formatting and file-size diagnostics outside this review change.
**Notes**: Extracted the top-level registry route bridge into
`workflow-registry-command-handler.ts`, moved small rendering helpers into
`workflow-renderers.ts` to keep the touched workflow handler below the source
line limit, and added coverage for rejecting extra positional arguments.

### Session: 2026-05-29 Finalization

**Tasks Completed**: Archived completed plan after verifying current worktree state.
**Verification**: Passed `bun test packages/rielflow/src/cli.test.ts`,
`bun test packages/rielflow/src/workflow/packages/packages.test.ts`,
`bun run packages/rielflow/src/bin.ts workflow registry list --output json`,
`bun run packages/rielflow/src/bin.ts workflow package registry list --output json`,
`bun run typecheck`, focused `biome check` for the edited CLI, renderer,
adapter, and regression-test files, and `git diff --check`.
**Notes**: Full-repo `bun run lint:biome` still fails on unrelated existing
formatting diagnostics and the existing `noExcessiveLinesPerFile` diagnostic in
`packages/rielflow/src/workflow/validate/node-payload-validation.ts`.
**Unresolved TODOs**: None for this plan.

## Addressed Feedback

- Step 3 low finding: Feature Contract issue wording is broader than the
  current issue. This plan uses the addendum as the source of truth and names
  `Support top-level workflow registry list command` as the issue reference.
- Step 3 instruction: Scope is limited to `workflow registry list --output json`
  while preserving `workflow package registry list --output json`.

## Risks

- Duplicating registry-list rendering would allow output drift between the two
  command surfaces; the route must reuse existing package registry handling.
- Help/docs could imply unimplemented top-level add/remove/refresh commands; the
  documentation task must avoid that.
- CLI parser arity and table-output guards may reject nested registry routes
  before workflow command handling if changed in the wrong layer; tests must
  cover the public `runCli` entry.

## References

- `design-docs/specs/design-workflow-package-commands.md#registry-list-issue-addendum`
- `packages/rielflow/src/cli/workflow-command-handler.ts`
- `packages/rielflow/src/cli/workflow-registry-command-handler.ts`
- `packages/rielflow/src/cli/workflow-renderers.ts`
- `packages/rielflow/src/cli/workflow-package-command-handler.ts`
- `packages/rielflow/src/cli/input-output-helpers.ts`
- `packages/rielflow/src/cli.test.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`
- `README.md`
