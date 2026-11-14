# Remove Web UI Implementation Plan

**Status**: Completed
**Design Reference**: [design-docs/specs/command.md](../../design-docs/specs/command.md)
**Created**: 2026-03-24
**Last Updated**: 2026-03-26

---

## Design Document Reference

**Source**: `design-docs/specs/command.md`

### Summary
Remove the checked-in browser Web UI and its repository tooling while keeping the GraphQL control plane, CLI workflow commands, and TUI workflow browser intact.

### Scope
**Included**: UI source deletion, UI build/test tool deletion, `serve` route simplification, CLI/browser-open flag removal, package/task cleanup, and top-level documentation updates.
**Excluded**: GraphQL schema changes unrelated to browser removal, TUI feature changes, and workflow JSON/runtime model changes.

---

## Modules

### 1. Runtime and CLI Boundary

#### src/cli.ts

**Status**: COMPLETED

**Checklist**:
- [x] Remove `--open` parsing and help text
- [x] Keep `serve` focused on starting the local HTTP control plane
- [x] Preserve existing GraphQL and TUI command behavior

#### src/server/api.ts

**Status**: COMPLETED

**Checklist**:
- [x] Remove built-UI asset serving
- [x] Remove `/api/ui-config`
- [x] Keep `/graphql` and `/healthz`
- [x] Return explicit `404` JSON for removed UI paths

### 2. Tooling and Repository Layout

#### package.json

**Status**: COMPLETED

**Checklist**:
- [x] Remove UI build/test scripts and browser-oriented dependencies
- [x] Keep server build/typecheck/test scripts working
- [x] Update formatting and clean targets for the reduced tree

#### Taskfile.yml

**Status**: COMPLETED

**Checklist**:
- [x] Remove UI and Playwright tasks
- [x] Keep build/typecheck/test task coverage aligned with package scripts

### 3. Documentation and Verification

#### README.md

**Status**: COMPLETED

**Checklist**:
- [x] Remove Web UI references from current-product documentation
- [x] Document `serve` as GraphQL control plane only

#### AGENTS.md

**Status**: COMPLETED

**Checklist**:
- [x] Remove repository guidance that assumes a browser UI still exists
- [x] Keep development instructions aligned with the reduced repository

---

## Completion Criteria

- [x] Checked-in `ui/` sources and UI-only scripts/tests are removed
- [x] `divedra serve` no longer serves browser assets or bootstrap config
- [x] Package/task definitions no longer depend on UI build or Playwright flows
- [x] Focused typecheck/build/tests for the touched runtime paths pass
- [x] Top-level docs describe the post-Web-UI repository accurately

## Progress Log

### Session: 2026-03-24 00:00
**Tasks Completed**: Boundary analysis and removal plan creation
**Tasks In Progress**: Runtime/tooling/doc cleanup
**Blockers**: None
**Notes**: The checked-in Web UI spans `ui/`, `e2e/`, UI build wrappers, server asset serving, CLI browser-open behavior, and repository documentation. The removal will preserve GraphQL and TUI paths while deleting UI-only assets and references.

### Session: 2026-03-24 01:00
**Tasks Completed**: Web UI source/tooling deletion, `serve` simplification, CLI flag removal, dependency cleanup, doc updates, focused verification
**Tasks In Progress**: None
**Blockers**: Full `bun run test` still fails in `src/workflow/runtime-db.test.ts` with `SQLiteError: table sessions already exists`, which reproduces independently of the Web UI removal
**Notes**: Verified the removal with `bun run typecheck`, `bun run build`, `git diff --check`, and focused tests over `src/cli.test.ts`, `src/server/api.test.ts`, `src/server/serve.test.ts`, and `src/server/graphql.test.ts`.

### Session: 2026-03-26 15:20
**Tasks Completed**: Completed-plan review and archive cleanup
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the completed web-UI removal while validating the current Solid/OpenTUI architecture. Full-repository verification now passes with `bun run typecheck`, `bun run build`, and `bun test`, so the earlier unrelated `runtime-db` blocker is no longer current. Archived this completed plan under `impl-plans/completed/` so the directory layout matches the repository implementation-plan policy.

### Session: 2026-03-26 22:05
**Tasks Completed**: Progress-index synchronization
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Synced `impl-plans/PROGRESS.json` and the `impl-plans/README.md` phase mapping so the archived completed plan remains discoverable through the repository's implementation-tracking index instead of appearing as an untracked completion.

## Related Plans

- **Previous**: `impl-plans/workflow-web-editor-execution.md`
- **Next**: None
- **Depends On**: None
