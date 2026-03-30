# CLI Workflow Namespace Alias Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/command.md#subcommands
**Created**: 2026-03-30
**Last Updated**: 2026-03-30

---

## Design Document Reference

**Source**: `design-docs/specs/command.md`

### Summary
Accept and document `divedra cli workflow ...` as the workflow-command form while
preserving top-level `divedra gql ...`.

### Scope
**Included**: CLI positional normalization for `cli workflow`, help text,
documentation updates, and regression coverage.
**Excluded**: broader `cli` namespace migration for every other subcommand and
transport changes.

---

## Modules

### 1. Workflow Namespace Alias

#### src/cli.ts

**Status**: COMPLETED

**Checklist**:
- [x] Normalize `cli workflow ...` to the existing workflow handler
- [x] Keep `gql` top-level and unchanged
- [x] Update help text to show `divedra cli workflow ...`

#### src/cli.test.ts

**Status**: COMPLETED

**Checklist**:
- [x] Cover `cli workflow run` execution
- [x] Keep existing workflow command behavior intact

#### README.md

**Status**: COMPLETED

**Checklist**:
- [x] Update workflow command examples to `divedra cli workflow ...`

#### design-docs/specs/command.md

**Status**: COMPLETED

**Checklist**:
- [x] Document workflow commands under the `cli workflow` form

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| CLI namespace alias | `src/cli.ts` | COMPLETED | Passing |
| CLI regression tests | `src/cli.test.ts` | COMPLETED | Passing |
| README command docs | `README.md` | COMPLETED | - |
| Command design docs | `design-docs/specs/command.md` | COMPLETED | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| `cli workflow` alias | Existing workflow CLI handlers | Available |

## Completion Criteria

- [x] `divedra cli workflow run <name>` works
- [x] `divedra gql ...` remains unchanged
- [x] Focused CLI tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-03-30
**Tasks Completed**: Planned and implemented the `cli workflow` alias slice
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The alias is intentionally narrow so the parser change does not
reframe the rest of the command tree unnecessarily.

## Related Plans

- **Previous**: `impl-plans/graphql-cli-execution-transport.md`
- **Next**: (continue in this plan if a full `cli` namespace becomes necessary)
- **Depends On**: `impl-plans/graphql-cli-execution-transport.md`
