---
name: rielflow-to-riela-migration-parity
description: Use when migrating Rielflow behavior to Riela or porting legacy implementation surfaces into the Swift/Riela codebase, especially when the user asks to verify that no features, tests, CLI commands, SDK APIs, workflows, skills, docs, package metadata, or active implementation-plan items were missed before running Rielflow implementation workflows, commits, pushes, or merges.
---

# Rielflow To Riela Migration Parity

Use this skill to prevent incomplete migrations. Treat migration completion as
evidence-driven: inventory the source behavior, map it to target code and tests,
correct plan status, then run Rielflow only with explicit gap input.

## Required Workflow

1. Define source and target.
   - Source is the behavior being migrated from.
   - Target is the Swift/Riela implementation under the current repository.
   - Do not make the source a runtime dependency of the target.

2. Inventory the source surface.
   - Enumerate package exports, binaries, public APIs, CLI commands, workflow
     ids, skill names, config files, schemas, user-facing docs, and tests.
   - For code migrations, run `rg` over source exports and tests.
   - For workflow/skill migrations, include package manifests, workflow JSON,
     prompt files, scripts, skill metadata, and digest files.

3. Inventory the target surface.
   - Enumerate Swift public APIs, CLI routes, workflow packages, skills,
     manifests, tests, and active implementation plans.
   - Inspect `impl-plans/PROGRESS.json` and every relevant file under
     `impl-plans/active`.

4. Build a parity matrix before claiming completion.
   - Mark each source feature as `complete`, `partial`, `missing`, or
     `intentionally-deferred`.
   - A feature is complete only when both implementation and target tests exist.
   - If the source has a test file and target has no equivalent behavior test,
     default to `partial` or `missing`.

5. Correct implementation-plan status.
   - Completed work must not remain in `impl-plans/active`.
   - Incomplete or partial work must remain active and must not say
     `Status: Completed`.
   - Add a latest progress-log entry explaining remaining gaps.

6. Run Rielflow with gap-specific input.
   - Prefer the active-plan completion workflow for remaining active plans:
     `codex-impl-plan-completion-review-loop`.
   - Include the parity matrix summary, target paths, and constraints.
   - Require review and verification before commit/push/merge.

7. Verify before handoff.
   - Run focused target tests and the full available test suite.
   - Re-run the surface audit and show that remaining gaps are either closed or
     explicitly deferred with rationale.
   - Do not commit, push, or merge while high-confidence parity gaps remain.

## Useful Commands

Run the bundled surface audit from the repository root:

```bash
python3 .agents/skills/rielflow-to-riela-migration-parity/scripts/audit_surface.py \
  --source /path/to/source \
  --target . \
  --output tmp/migration-parity/audit.md
```

Read `references/parity-checklist.md` when preparing Rielflow workflow input or
reviewing a migration completion claim.

## Rielflow Input Rules

When starting Rielflow, pass structured variables that include:

- `workflowInput.requestedBehavior`: close the listed migration parity gaps.
- `workflowInput.targetPaths`: relevant Swift, tests, docs, skills, and active
  plan files.
- `workflowInput.constraints`: no legacy source runtime dependency, do not
  revert unrelated dirty worktree changes, do not mark active plans completed
  until implementation and tests prove parity.
- `workflowInput.reviewMode`: `adversarial` for broad migrations.
- `workflowInput.riskLevel`: `high` when CLI, workflow execution, process
  management, package metadata, or commit/push behavior is affected.

## Completion Gate

Report migration completion only when:

- source feature/test inventory has been mapped;
- all non-deferred rows are implemented in target code;
- target tests cover every migrated behavior class;
- active plans and `PROGRESS.json` agree;
- Rielflow review has accepted the changes;
- focused and full verification commands pass.
