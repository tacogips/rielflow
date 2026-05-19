# Root Src Removal Cutover Review Implementation Plan

**Status**: In Progress
**Design Reference**: design-docs/specs/architecture.md#package-boundary-architecture
**Created**: 2026-05-19
**Last Updated**: 2026-05-19

## Source Inputs

- **Workflow**: `design-and-implement-review-loop`
- **Issue Mode**: issue-resolution
- **Issue Title**: Self-review and improve root src removal package cutover
- **Requested Behavior**: Keep `./src` removed, keep runtime and tests under `packages/divedra/src`, update tooling/docs/workflow fixtures to package-local entrypoints, and keep verification green.
- **Codex References**:
  - `impl-plans/active/refactoring-duplicate-scavenge-product-code.md` (`REF-019`)
  - `design-docs/specs/architecture.md#package-boundary-architecture`

## Scope

Review and harden the current uncommitted package source ownership cutover. The implementation step should fix only issues that prevent the accepted design from being true:

- root `src/` must remain absent
- former root runtime and tests must live under `packages/divedra/src`
- executable commands in root tooling, docs, examples, and workflow fixtures must use `packages/divedra/src/bin.ts` or another package-local entrypoint
- package-boundary and verification commands must stay green

Excluded:

- reintroducing root `src` compatibility shims
- changing `codex-agent`, `claude-code-agent`, official SDK, or Cursor adapter semantics except for package-local import path cleanup required by the move
- adding automated-assistant attribution or co-authorship trailers to commit messages
- broad refactors unrelated to the root source removal cutover

## Intentional Divergences From Codex References

- `impl-plans/active/refactoring-duplicate-scavenge-product-code.md` marks `REF-019` completed; this plan is a follow-up review/hardening pass for the same cutover, not a duplicate move task.
- The accepted design keeps `codex-agent` references as behavioral examples only; implementation must not copy codex-agent internals or change Cursor adapter boundaries.
- Historical `src/...` text may remain only when clearly archived or explicitly obsolete; live commands and runnable fixtures must be package-local.

## Modules And Type Surface

No new public TypeScript types or APIs are expected. The implementation should preserve current exported contracts while updating path ownership and executable references.

| Area | Deliverable Paths | Expected Type/API Change |
| --- | --- | --- |
| Package runtime and tests | `packages/divedra/src/**` | No new public API; imports resolve package-locally or through package exports |
| Root tooling | `package.json`, `Taskfile.yml`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `biome.json` | No public API change |
| Source-check scripts | `scripts/check-source-filenames.ts`, `scripts/check-source-filenames.test.ts`, `scripts/run-bun-tests.sh`, `scripts/sync-package-declarations.ts` | No public API change |
| Docs and fixtures | `README.md`, `examples/**`, `.divedra/workflows/**`, `.divedra/README.md` | No runtime API change; command snippets and fixtures use package-local entrypoints |
| Progress tracking | `impl-plans/active/refactoring-duplicate-scavenge-product-code.md`, `impl-plans/PROGRESS.json`, this plan | Documentation/progress only |

## Task Breakdown

| Task | Status | Depends On | Parallelizable | Deliverables |
| --- | --- | --- | --- | --- |
| TASK-001 | Completed | - | No | Cutover inventory and finding list |
| TASK-002 | Completed | TASK-001 | Yes | Root tooling, Taskfile, and script path cleanup |
| TASK-003 | Completed | TASK-001 | Yes | Package-local runtime/test path and import cleanup |
| TASK-004 | Completed | TASK-001 | Yes | README, examples, and workflow fixture entrypoint cleanup |
| TASK-005 | Completed | TASK-002, TASK-003, TASK-004 | No | Boundary guard and targeted verification fixes |
| TASK-006 | Blocked | TASK-005 | No | Full verification, progress log update, and commit-message input |

### TASK-001: Inventory Cutover State

**Owned Files/Directories**: no writes expected unless documenting findings in this plan
**Depends On**: none
**Parallelizable**: No

**Implementation Work**:

- Confirm `test ! -d src` passes.
- Classify live versus historical `src/...` references in root tooling, docs, examples, workflow fixtures, and implementation plans.
- Confirm former root surfaces exist under `packages/divedra/src`, including CLI, workflow, events, GraphQL, server, hook, shared, library, and tests.
- Identify any stale package-to-root imports or executable commands before editing.

**Completion Criteria**:

- [x] Root `src/` absence confirmed.
- [x] Live stale root-source references are listed with file paths.
- [x] Historical or explicitly obsolete references are separated from live executable references.
- [x] Required package-local source/test directories are present.

**Verification Commands**:

- `test ! -d src`
- `rg -n "bun run src/main\\.ts|bun test src/|find src|src/(cli|events|graphql|hook|server|shared|workflow|lib|main)\\b" package.json Taskfile.yml tsconfig.json tsconfig.build.json vitest.config.ts biome.json scripts README.md examples .divedra impl-plans/active/refactoring-duplicate-scavenge-product-code.md`
- `rg -nP "(from|import) ['\\\"](\\.\\./)*src/" packages/divedra/src packages/divedra-core/src packages/divedra-addons/src packages/divedra-events/src`

### TASK-002: Clean Root Tooling And Scripts

**Owned Files/Directories**: `package.json`, `Taskfile.yml`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `biome.json`, `scripts/check-source-filenames.ts`, `scripts/check-source-filenames.test.ts`, `scripts/run-bun-tests.sh`, `scripts/sync-package-declarations.ts`
**Depends On**: TASK-001
**Parallelizable**: Yes, if TASK-003 and TASK-004 avoid these files.

**Implementation Work**:

- Ensure build, typecheck, lint, and test config discover `packages/divedra/src` instead of root `src`.
- Ensure Taskfile tasks do not invoke removed root source entrypoints.
- Ensure source filename checks reject root `src` recreation and report package-local source paths.
- Ensure declaration sync does not rewrite paths through removed root `src`.
- Ensure shell test runners invoke package-local tests.

**Completion Criteria**:

- [x] Root tooling has no live root `src` entrypoints.
- [x] Source filename checks and tests cover package-local paths.
- [x] Declaration sync resolves package-local sources only.
- [x] Tooling changes are compatible with Bun and strict TypeScript settings.

**Verification Commands**:

- `bun test scripts/check-source-filenames.test.ts`
- `bun run typecheck`
- `bun run build`

### TASK-003: Validate Package-Local Runtime And Tests

**Owned Files/Directories**: `packages/divedra/src/**`, package-local imports required by moved files
**Depends On**: TASK-001
**Parallelizable**: Yes, if TASK-002 and TASK-004 avoid `packages/divedra/src/**`.

**Implementation Work**:

- Fix package-local imports and test references that still assume root `src`.
- Preserve public CLI and library compatibility through package-local facades.
- Keep adapter boundaries intact for `codex-agent`, `claude-code-agent`, official SDKs, and Cursor.
- Avoid creating root compatibility shims.

**Completion Criteria**:

- [x] `packages/divedra/src` contains the moved runtime and tests needed by the cutover.
- [x] No package-local code imports from removed root source paths.
- [x] CLI and library targeted tests pass from package-local paths.
- [x] Adapter behavior remains unchanged except for path ownership.

**Verification Commands**:

- `bun test packages/divedra/src/package-boundaries.test.ts`
- `bun test packages/divedra/src/workflow/addon-package-boundary.test.ts`
- `bun test packages/divedra/src/lib-api.test.ts packages/divedra/src/cli.test.ts`

### TASK-004: Clean Docs, Examples, And Workflow Fixtures

**Owned Files/Directories**: `README.md`, `examples/**`, `.divedra/README.md`, `.divedra/workflows/**`
**Depends On**: TASK-001
**Parallelizable**: Yes, if TASK-002 and TASK-003 avoid these files.

**Implementation Work**:

- Replace live `bun run src/main.ts ...` command guidance with package-local commands.
- Replace live `bun test src/...` and `find src` verification guidance with package-local equivalents.
- Keep archived mock scenario text only when clearly historical and non-executable.
- Validate affected workflow bundles through package-local CLI entrypoints.

**Completion Criteria**:

- [x] README and example commands use package-local entrypoints.
- [x] Workflow fixture commands use `bun run packages/divedra/src/bin.ts ...` or another package-local entrypoint.
- [x] Historical `src/...` text is not presented as current runnable guidance.
- [x] Reference examples remain runnable with `--workflow-definition-dir ./examples`.

**Verification Commands**:

- `bun run packages/divedra/src/bin.ts workflow validate refactoring-divide-and-conquer --workflow-definition-dir .divedra/workflows --output json`
- `bun run packages/divedra/src/bin.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows --output json`
- `rg -n "bun run src/main\\.ts|bun test src/|find src" README.md examples .divedra`

### TASK-005: Harden Boundary Guards And Targeted Verification

**Owned Files/Directories**: files touched by TASK-002 through TASK-004, plus focused tests when needed
**Depends On**: TASK-002, TASK-003, TASK-004
**Parallelizable**: No

**Implementation Work**:

- Run targeted tests and fix failures caused by the package cutover.
- Strengthen existing package-boundary coverage only if a stale root path escaped current checks.
- Keep fixes limited to cutover regressions.

**Completion Criteria**:

- [x] Package-boundary test fails on root `src` recreation and root source imports.
- [x] Targeted package-local CLI, library, workflow, and script tests pass.
- [x] No live executable root-source references remain.

**Verification Commands**:

- `bun test packages/divedra/src/package-boundaries.test.ts`
- `bun test scripts/check-source-filenames.test.ts`
- `bun test packages/divedra/src/workflow/addon-package-boundary.test.ts`
- `bun test packages/divedra/src/lib-api.test.ts packages/divedra/src/cli.test.ts`

### TASK-006: Full Verification And Progress Update

**Owned Files/Directories**: `impl-plans/active/root-src-removal-cutover-review.md`, `impl-plans/active/refactoring-duplicate-scavenge-product-code.md`, `impl-plans/PROGRESS.json`
**Depends On**: TASK-005
**Parallelizable**: No

**Implementation Work**:

- Run the full verification command set from the accepted design and intake.
- Run the accepted design's package-split compatibility validation commands,
  including Nix develop, Taskfile, Nix build, and flake app entrypoint checks.
- Update this plan's progress log with commands, results, and any residual risks.
- Update the referenced duplicate-scavenge plan only if its REF-019 verification or residual-risk notes need correction after implementation.
- Prepare a commit-message summary without automated-assistant attribution.

**Completion Criteria**:

- [x] Full verification command set passes or failures are documented with blockers.
- [x] Accepted design compatibility validation passes, or any deferred command has a concrete reason and residual risk.
- [x] Progress log records changed files, completed tasks, verification results, and residual risks.
- [x] Referenced REF-019 notes remain accurate for the final cutover state.
- [x] Commit-message input contains no automated-assistant attribution or co-authorship trailers.

**Verification Commands**:

- `bun run typecheck`
- `bun test packages/divedra/src/package-boundaries.test.ts`
- `bun test scripts/check-source-filenames.test.ts`
- `bun test packages/divedra/src/workflow/addon-package-boundary.test.ts`
- `bun test packages/divedra/src/lib-api.test.ts packages/divedra/src/cli.test.ts`
- `bun run build`
- `bun run lint:biome`
- `bun run packages/divedra/src/bin.ts workflow validate refactoring-divide-and-conquer --workflow-definition-dir .divedra/workflows --output json`
- `bun run packages/divedra/src/bin.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows --output json`
- `nix develop --command bun install --frozen-lockfile`
- `nix develop --command bun run typecheck`
- `nix develop --command bun test`
- `nix develop --command task test`
- `nix develop --command task build`
- `nix build .#default`
- `nix run . -- workflow list --workflow-definition-dir ./examples`
- `git diff --check`

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| TASK-001 inventory | none | Completed |
| TASK-002 tooling/scripts | TASK-001 | Completed |
| TASK-003 package runtime/tests | TASK-001 | Completed |
| TASK-004 docs/fixtures | TASK-001 | Completed |
| TASK-005 boundary hardening | TASK-002, TASK-003, TASK-004 | Completed |
| TASK-006 final verification/progress | TASK-005 | Blocked |

## Parallel Execution Guidance

After TASK-001, TASK-002, TASK-003, and TASK-004 may run concurrently only if their write scopes remain disjoint:

- TASK-002 owns root configs and scripts.
- TASK-003 owns `packages/divedra/src/**`.
- TASK-004 owns README, examples, and `.divedra` workflow fixtures.

TASK-005 and TASK-006 must be serialized because they integrate findings, run verification, and update plan/progress records.

## Completion Criteria

- [x] `./src` remains removed.
- [x] Runtime and tests live under `packages/divedra/src`.
- [x] Root tooling and scripts resolve package-local source paths only.
- [x] README, examples, and workflow fixtures use package-local executable entrypoints for live commands.
- [x] `packages/divedra/src/package-boundaries.test.ts` guards root source absence and package-to-root import rejection.
- [ ] Full verification command set passes; local Bun and Taskfile checks pass, while required Nix checks are sandbox-blocked.
- [ ] Accepted design compatibility validation fully passes; Nix develop, Nix build, and flake app entrypoint checks remain deferred because the sandbox cannot access the Nix daemon socket.
- [x] Progress logs and referenced plan notes are updated.
- [x] Commit-message input contains no automated-assistant attribution or co-authorship trailers.

## Progress Log

### Session: 2026-05-19 Step 4 Implementation Plan Creation

**Tasks Completed**: Created plan for the accepted package-boundary design update.

**Verification**:

- `test ! -d src` expected as implementation verification.
- Full command set listed under TASK-006, including Step 5 requested compatibility validation from `design-docs/specs/architecture.md`.

**Notes**:

- Step 3 design review accepted `design-docs/specs/architecture.md#package-boundary-architecture` with no high or mid findings.
- Step 5 rerun feedback required adding package-split compatibility validation commands from `design-docs/specs/architecture.md`; TASK-006 now includes those commands.
- Later implementation must update this log with actual commands and outcomes.

### Session: 2026-05-19 Step 6 Implementation

**Tasks Completed**: TASK-001 through TASK-005; TASK-006 local verification/progress completed with required Nix checks blocked.

**Changed Files**:

- `flake.nix`
- `.divedra/README.md`
- `.divedra/workflows/design-and-implement-review-loop/EXPECTED_RESULTS.md`
- `.divedra/workflows/design-and-implement-review-loop/mock-scenario.json`
- `.divedra/workflows/design-and-implement-review-loop/mock-scenario-planning-only.json`
- `.divedra/workflows/refactoring-divide-and-conquer/mock-scenario.json`
- `.divedra/workflows/refactoring-slice-review/EXPECTED_RESULTS.md`
- `.divedra/workflows/refactoring-slice-review/mock-scenario.json`
- `examples/design-and-implement-review-loop/EXPECTED_RESULTS.md`
- `examples/design-and-implement-review-loop/mock-scenario.json`
- `examples/design-and-implement-review-loop/mock-scenario-planning-only.json`
- `examples/supervised-mock-retry/EXPECTED_RESULTS.md`
- `scripts/check-source-filenames.ts`
- `scripts/check-source-filenames.test.ts`
- `impl-plans/active/root-src-removal-cutover-review.md`
- `impl-plans/active/refactoring-duplicate-scavenge-product-code.md`
- `impl-plans/PROGRESS.json`

**Verification**:

- `test ! -d src` passed.
- `bun run typecheck` passed.
- `bun test scripts/check-source-filenames.test.ts packages/divedra/src/package-boundaries.test.ts` passed.
- `bun test packages/divedra/src/workflow/addon-package-boundary.test.ts packages/divedra/src/lib-api.test.ts packages/divedra/src/cli.test.ts` passed.
- `bun run lint:biome` passed with existing explicit-`any` warnings in moved `packages/divedra/src/workflow/engine/*.ts` split files.
- `bun run build` passed.
- `bun run test` passed.
- `task test` passed.
- `task build` passed.
- `bun run packages/divedra/src/bin.ts workflow validate refactoring-divide-and-conquer --workflow-definition-dir .divedra/workflows --output json` passed.
- `bun run packages/divedra/src/bin.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows --output json` passed.
- `bun run packages/divedra/src/bin.ts workflow list --workflow-definition-dir ./examples --output json` passed.
- `git diff --check` passed.
- `nix develop --command bun install --frozen-lockfile` blocked by sandboxed access to `/Users/taco/.cache/nix/fetcher-cache-v4.sqlite`.
- `XDG_CACHE_HOME=/private/tmp/divedra-nix-cache nix develop --command bun install --frozen-lockfile` blocked by sandboxed access to `/nix/var/nix/daemon-socket/socket`; the same sandbox limitation blocks `nix develop`, `nix build .#default`, and `nix run . -- ...` verification here.

**Notes**:

- Fixed the Nix app wrapper to execute `packages/divedra/src/bin.ts` from the copied runtime source instead of removed `src/main.ts`.
- Updated project-local workflow documentation and deterministic workflow/example fixtures so live commands and first-party changed-file paths use package-local paths while codex-agent reference paths remain explicit.
- Hardened `scripts/check-source-filenames.ts` so lint detects a recreated root `src/` directory in addition to numbered source part filenames.
- REF-019 remains accurate after the hardening pass; the remaining compatibility gap is environmental Nix execution in this sandbox, not repository source ownership.

### Session: 2026-05-19 Step 6 Rerun After Step 7 Review

**Tasks Completed**: Addressed Step 7 mid-severity feedback for TASK-006 progress accuracy and the active REF-019 codex-agent reference plan.

**Changed Files**:

- `impl-plans/active/refactoring-duplicate-scavenge-product-code.md`
- `impl-plans/active/root-src-removal-cutover-review.md`
- `impl-plans/PROGRESS.json`

**Verification**:

- `test ! -d src` passed.
- `bun run typecheck` passed.
- `bun test scripts/check-source-filenames.test.ts packages/divedra/src/package-boundaries.test.ts` passed.
- `bun test packages/divedra/src/workflow/addon-package-boundary.test.ts packages/divedra/src/lib-api.test.ts packages/divedra/src/cli.test.ts` passed.
- `bun run build` passed.
- `bun run lint:biome` passed with existing explicit-`any` warnings in moved `packages/divedra/src/workflow/engine/*.ts` split files.
- `bun run packages/divedra/src/bin.ts workflow validate refactoring-divide-and-conquer --workflow-definition-dir .divedra/workflows --output json` passed.
- `bun run packages/divedra/src/bin.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows --output json` passed.
- `jq empty impl-plans/PROGRESS.json` passed.
- `git diff --check` passed.
- Nix develop, Nix build, and flake app entrypoint checks remain blocked by sandboxed Nix daemon access.

**Notes**:

- Rewrote live active `src/...` owned files, excluded files, verification commands, and progress notes in `impl-plans/active/refactoring-duplicate-scavenge-product-code.md` to package-local `packages/divedra/src/...` paths.
- Corrected this plan and `impl-plans/PROGRESS.json` so TASK-006 is blocked by deferred Nix verification rather than represented as an unqualified full verification pass.
