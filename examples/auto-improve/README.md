# Auto-improve (supervision) operator notes

`--auto-improve` runs the **target** workflow under an engine-driven supervision
loop: on terminal **failure** or **stall** (no persisted session progress within
`--stall-timeout-ms` while a step is executing), the runtime records an **incident** and
a **remediation** (plain rerun, targeted step rerun, audited `patch-workflow`
record on **repeat** the same error, or **stop** when budgets are hit). Policy
and state live on the target **session** and survive resume.

- **Execution-copy** (`--workflow-mutation-mode execution-copy`, default) copies
  the bundle under the artifact area; patch revision records for escalation live
  under `supervision/<supervisionRunId>/` in the artifact root. **In-place** is
  opt-in and mutates the source bundle directory.
- **Inspection**: library `getSupervisionSummary`, GraphQL `session.supervision`
  on workflow execution types.
- `superviserWorkflowId` (default `divedra/default-superviser`) is **reserved** for
  a future paired superviser **workflow**; the current tree runs remediation logic
  in the engine, not a separate superviser run.

See `design-docs/specs/design-auto-improve-superviser-mode.md` and
`impl-plans/completed/auto-improve-superviser-mode.md` for the full model and phasing.

## Runnable example: fail once, succeed on supervised rerun

Bundle: `../supervised-mock-retry/`. The mock scenario is a two-entry sequence
for the sole worker: the first response forces a failure, the second returns
valid output. A plain run stops at the first failure. With `--auto-improve`, the
engine records an incident, reruns the target from the same supervision cycle,
and the mock provider selects the next sequence entry (see `EXPECTED_RESULTS.md`
in that directory).

```bash
bun run src/main.ts workflow run supervised-mock-retry \
  --workflow-root ./examples \
  --mock-scenario ./examples/supervised-mock-retry/mock-scenario.json \
  --auto-improve \
  --max-supervised-attempts 3 \
  --output json
```

Generic flags (adjust paths and workflow name for your project):

```bash
divedra workflow run <workflow> --auto-improve \
  --monitor-interval-ms 5000 \
  --stall-timeout-ms 60000 \
  --max-supervised-attempts 5 \
  --max-workflow-patches 3
```
