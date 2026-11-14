# Session Command Project Scope Implementation Plan

**Status**: Completed
**Created**: 2026-05-05
**Last Updated**: 2026-05-05
**Design Reference**: `design-docs/specs/design-user-scope-workflows.md`

## Goal

Make local `divedra session ...` commands discover project-scoped session state
without requiring operators to pass `--user-root <project>/.divedra`.

## Scope

Included:

- project `.divedra/artifacts/sessions` discovery from the current working
  directory for local session commands
- preservation of explicit storage overrides such as `--session-store`,
  `--artifact-root`, `--user-root`, and matching environment variables
- regression coverage for `session status`

Excluded:

- removing the public `--user-root` option in this patch
- changing remote GraphQL session commands
- changing workflow catalog discovery semantics

## Deliverables

- `src/cli.ts`: infer project-scoped root data for session commands when no
  explicit storage override is provided.
- `src/cli.test.ts`: verify `session status` loads a project-local session from
  `.divedra/artifacts/sessions` by current working directory alone.

## Completion Criteria

- [x] Project-local session status works without `--user-root`.
- [x] Explicit storage options still take precedence.
- [x] Targeted CLI regression test passes.
- [x] Type checking passes.

## Progress Log

### Session: 2026-05-05

**Tasks completed**: Added project-scope discovery for local session commands,
updated all local session subcommands to share the inferred storage options, and
added regression coverage.

**Verification**:

- `bun test src/cli.test.ts -t "session status discovers project-local session store from cwd"`
- `bun run typecheck`
- `bun run divedra/src/main.ts session status div-design-and-implement-review-loop-1777949666-19515852 --output json`

### Session: 2026-05-05 (follow-up review)

**Tasks completed**: Extended session-store inference to treat an explicit
project workflow definition directory as a project-scope hint, which keeps
`session status` working when operators invoke the CLI from outside the project
tree. Isolated the session inference regressions from ambient `DIVEDRA_*`
storage environment variables, and kept explicit `--project-root` /
`DIVEDRA_PROJECT_ROOT` compatibility for workflow catalog commands so
out-of-tree automation still has a stable project-scope override.

**Verification**:

- `bun test src/cli.test.ts -t "session status discovers project-local session store from workflow definition dir outside the project cwd"`
- `bun test src/cli.test.ts -t "workflow commands resolve explicit project scope root"`
- `bun test src/cli.test.ts -t "workflow list uses DIVEDRA_PROJECT_ROOT outside the project cwd"`
- `bun run typecheck`
