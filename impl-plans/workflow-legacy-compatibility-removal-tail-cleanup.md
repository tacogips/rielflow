# Workflow legacy compatibility removal (tail cleanup)

**Status**: Completed for nested superviser rerun parse surface (2026-04-29).

This handoff stub mirrors `impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md` for stable links.

Parent tracker:

- `impl-plans/workflow-legacy-compatibility-removal.md`

## Completion (2026-04-29 follow-up)

The remaining live residue called out in the prior snapshot is resolved: `parseRerunTargetWorkflowControlArguments` no longer contains a dedicated `rerunFromNodeId` branch. Nested `divedra/rerun-workflow` uses an **allowlist** of supported argument keys; any other key (including former node-addressed names) is rejected with a single generic error shape.

**Completed?**

- **Yes** for the current workflow-legacy cleanup target.
- No remaining live `src/` workflow runtime shim was found in this review beyond:
  authored-schema rejection lists,
  persisted SQLite migration support,
  and stable runtime/template naming kept by design.

**Intentional guards (unchanged)**:

- `src/workflow/validate.ts` / `src/workflow/save.ts`: `REJECTED_AUTHORED_*` lists reject removed top-level keys (schema boundary enforcement).
- `src/workflow/manager-session-store.ts` / migration tests: on-disk SQLite upgrades from older column names.

**Optional hygiene for later iterations** (non-blocking):

- Grep `design-docs/` for sample `workflow.json` that still show removed fields; align with `entryStepId` + `steps[]` + `nodes[]` per `design-workflow-json.md`.
- Negative-test dedup across GraphQL / CLI / validate where assertions overlap.

After substantive cleanup slices, refresh this snapshot if you use it as a handoff note again.

## Iteration note (2026-04-29 follow-up review)

- Ran full `scripts/run-bun-tests.sh` (616 pass). No further live legacy shims found in `src/` beyond intentional validation strings and DB migration tests.
- `design-docs/` and `examples/` contain no sample `workflow.json` blocks with removed top-level keys (grep for quoted legacy keys).
- Corrected `workflow-legacy-compatibility-removal.md` review-matrix row that still described a `rewriteCallStepFailureMessage` mapping table after its removal; clarified handoff stub vs completed archive paths.

## Iteration note (2026-04-29 continuity pass)

- Re-ran `scripts/run-bun-tests.sh` (616 pass) on the current `workflow` branch diff; no regressions.
- Plan grep over `src/`: remaining legacy-named strings are schema rejection (`validate.ts`, `save.ts`), migration fixtures (`manager-session-store.test.ts`, `runtime-db.test.ts`), allowlist rejection coverage (`superviser-control.test.ts` for `rerunFromNodeId`), GraphQL negative input tests, and comments that contrast step transitions with rejected authored `workflowCalls`.
- Worker-only GraphQL assertions overlap between `src/graphql/schema.test.ts` and `src/server/graphql.test.ts` by design (direct schema API vs HTTP `/graphql` handler); no dedup applied in this pass.
- `AuthoredWorkflowJson` JSDoc in `src/workflow/types.ts` clarified to describe removed authoring aliases without implying a live legacy authoring path.

## Iteration note (2026-04-29 wording pass)

- `src/workflow/engine.ts`: JSDoc on `buildCrossWorkflowCalleeRuntimeVariables` now distinguishes the stable `runtimeVariables.workflowCall` key from rejected authored `workflow.workflowCalls`, matching `design-docs/specs/architecture.md` / `design-unified-workflow-role-model.md` (avoids "template compatibility" phrasing that could read as a schema compatibility layer).
