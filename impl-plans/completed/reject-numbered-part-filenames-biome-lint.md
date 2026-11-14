# Reject Numbered Part Filenames in Biome Lint Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#repository-lint-policy-boundary`
**Created**: 2026-05-13
**Last Updated**: 2026-05-13

---

## Design Document Reference

**Source**: `design-docs/specs/architecture.md:400-432`

### Summary

Add repository lint enforcement that rejects TypeScript source basenames exactly
matching `part-<digits>.ts` or `part-<digits>.tsx`, integrated into the same
effective Biome lint path used by `bun run lint:biome`, `bun run lint`,
`task lint`, and `task ci`.

### Scope

**Included**: a small repository-owned filename policy check for Biome 2.3.15,
lint script/task wiring, tests that do not commit forbidden source files, and a
brief development guidance update if needed.

**Excluded**: Biome include changes, broad filename conventions, backend
adapter behavior, Codex-agent behavior, Cursor-specific behavior, or committed
forbidden fixture files under source paths.

### Issue Reference

- **Workflow mode**: `issue-resolution`
- **Issue source**: `runtimeVariables.workflowInput issueTitle/issueBody`
- **Title**: Reject numbered part filenames in Biome lint policy
- **Issue URL**: none provided
- **Issue repository/number**: none provided

### Codex-Agent References

No codex-agent reference repository, source path, or issue reference was
provided. This plan follows the accepted local divedra design only. There are no
intentional divergences from external Codex-reference behavior.

---

## Tasks

### TASK-001: Filename Policy Checker

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `scripts/check-source-filenames.ts`
**Depends On**: accepted design only

```typescript
interface FilenamePolicyViolation {
  readonly path: string;
  readonly basename: string;
}

interface FilenamePolicyCheckResult {
  readonly violations: readonly FilenamePolicyViolation[];
}

function isForbiddenSourcePartBasename(basename: string): boolean;
function checkSourceFilenames(
  rootDir: string,
): Promise<FilenamePolicyCheckResult>;
```

**Checklist**:

- [x] Inspect only paths equivalent to current Biome includes:
      `src/**/*.ts`, `src/**/*.tsx`, and `vitest.config.ts`.
- [x] Match only complete basenames `part-<digits>.ts` and
      `part-<digits>.tsx`.
- [x] Report every forbidden file path before exiting non-zero.
- [x] Keep implementation dependency-free and portable under Bun.

### TASK-002: Biome Lint Entrypoint Wiring

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `package.json`, `Taskfile.yml`
**Depends On**: TASK-001 checker command name

**Checklist**:

- [x] Make `bun run lint:biome` run Biome and the filename policy check.
- [x] Make `bun run lint` reuse `bun run lint:biome` before typecheck.
- [x] Make `task lint` use the same Biome lint path before format/typecheck.
- [x] Make `task ci` use the same Biome lint path before format/typecheck/test.
- [x] Preserve `biome check . --diagnostic-level=warn` behavior.

### TASK-003: Regression Tests

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `scripts/check-source-filenames.test.ts` or nearest existing
test location
**Depends On**: TASK-001

**Checklist**:

- [x] Cover forbidden `part-1.ts`, `part-01.ts`, `part-1.tsx`,
      and `part-01.tsx` using temporary fixture paths or pure helper tests.
- [x] Cover allowed descriptive filenames such as `workflow-loader.ts`,
      `node-output-contract.ts`, and `session-partition.ts`.
- [x] Cover exact basename behavior so non-source or substring matches are not
      rejected.
- [x] Avoid committing forbidden files under `src/`.

### TASK-004: User-Facing Guidance

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `README.md` or existing repository development guidance file
**Depends On**: TASK-001 policy names

**Checklist**:

- [x] Document that source basenames `part-<digits>.ts` and
      `part-<digits>.tsx` are rejected by the Biome lint path.
- [x] Point developers to descriptive split filenames instead.
- [x] Do not add Codex-agent, Cursor, or backend adapter instructions.

### TASK-005: Progress and Handoff Notes

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:
`impl-plans/active/reject-numbered-part-filenames-biome-lint.md`
**Depends On**: implementation verification

**Checklist**:

- [x] Update task statuses and checklists during implementation.
- [x] Record verification command outcomes in the progress log.
- [x] Record any intentional deviation from the accepted design.

---

## Module Status

| Module                     | File Path                                                        | Status    | Tests                                    |
| -------------------------- | ---------------------------------------------------------------- | --------- | ---------------------------------------- |
| Filename policy checker    | `scripts/check-source-filenames.ts`                              | COMPLETED | `scripts/check-source-filenames.test.ts` |
| Lint entrypoint wiring     | `package.json`, `Taskfile.yml`                                   | COMPLETED | command verification                     |
| Regression coverage        | `scripts/check-source-filenames.test.ts`                         | COMPLETED | `bun run test`                           |
| Developer guidance         | `README.md` or existing guidance file                            | COMPLETED | docs review                              |
| Implementation plan status | `impl-plans/active/reject-numbered-part-filenames-biome-lint.md` | COMPLETED | progress log                             |

## Dependencies

| Feature                  | Depends On             | Status    |
| ------------------------ | ---------------------- | --------- |
| Filename policy checker  | Accepted design        | COMPLETED |
| Lint entrypoint wiring   | Checker command path   | COMPLETED |
| Regression coverage      | Checker helper/CLI     | COMPLETED |
| Developer guidance       | Final policy wording   | COMPLETED |
| Handoff progress updates | Implementation results | COMPLETED |

## Parallelization

- `TASK-001`, `TASK-002`, and `TASK-004` have disjoint write scopes, but
  `TASK-002` must coordinate with the final checker command path from
  `TASK-001`.
- `TASK-003` depends on the checker surface and should run after TASK-001.
- `TASK-005` should run after implementation and verification.

## Verification Plan

- `bun run lint:biome`
- `bun run lint`
- `bun run test`
- `bun run typecheck`
- `task lint`
- `task ci`
- Targeted negative test using a temporary forbidden file path, without leaving
  committed `part-<digits>.ts` or `part-<digits>.tsx` files in the repository.

## Completion Criteria

- [x] Forbidden source basenames `part-<digits>.ts` and `part-<digits>.tsx`
      fail through the Biome lint path.
- [x] Allowed descriptive filenames continue to pass.
- [x] `package.json` and `Taskfile.yml` share the same effective Biome lint
      policy path.
- [x] Tests cover forbidden and allowed filename behavior without committed
      forbidden source fixtures.
- [x] Verification commands are run and outcomes are recorded in the progress
      log.

## Progress Log

### Session: 2026-05-13 15:17

**Tasks Completed**: Plan created from accepted Step 3 design.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Biome 2.3.15 native config was already rejected by the accepted
design because no safe exact basename rule is available in the local
CLI/config surface.

### Session: 2026-05-13 15:45

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added `scripts/check-source-filenames.ts` and tests, wired
`bun run lint:biome`, `bun run lint`, `task lint`, and `task ci` through the
same Biome-plus-filename-policy path, and documented descriptive split filename
guidance in `README.md`. No committed forbidden source fixtures were added.
Verification outcomes:

- `bun test scripts/check-source-filenames.test.ts`: passed, 3 tests.
- `bun run check:source-filenames`: passed.
- `bun run lint:biome`: passed with existing Biome warnings; filename policy
  check passed.
- Temporary negative `bun run lint:biome` with `src/part-999.ts`: failed as
  expected with `negative_lint_exit=1`, then the temporary file was removed.
- `bun run typecheck`: passed.
- `bun run lint`: passed with existing Biome warnings.
- `bun run test`: failed after 992 passing tests because two existing
  `src/workflow/engine.test.ts` tests timed out at 5000 ms:
  `nestedSuperviserDriver resume starts a new nested round when the superviser
session completed but the target is still max-steps paused` and `does not
inherit reusable node backend sessions into a rerun session`.
- `task lint`: failed in `format:check` because Prettier reported existing
  formatting drift in 51 files outside this change.
- `task ci`: failed in `format:check` for the same existing formatting drift
  before reaching typecheck/test.

## Related Plans

- **Previous**: none
- **Next**: implementation step for this issue-resolution workflow
- **Depends On**: `design-docs/specs/architecture.md#repository-lint-policy-boundary`
