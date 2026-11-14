# Expected Results

Deterministic checks for the bundled mock scenario. Ignore `sessionId`, timestamps, and non-stable paths.

## Validate

Command:

```bash
bun run packages/divedra/src/bin.ts workflow validate supervised-mock-retry --workflow-definition-dir ./examples
```

Expected: workflow validates as a step-addressed bundle.

## Run without supervision (fails on first response)

Command:

```bash
bun run packages/divedra/src/bin.ts workflow run supervised-mock-retry \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/supervised-mock-retry/mock-scenario.json \
  --output json
```

Expected: the run ends in a failed state (the first mock entry throws).

## Run with auto-improve (retries, second mock entry succeeds)

Command:

```bash
bun run packages/divedra/src/bin.ts workflow run supervised-mock-retry \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/supervised-mock-retry/mock-scenario.json \
  --auto-improve \
  --max-supervised-attempts 3 \
  --output json
```

Expected stable high-level behavior:

- final session `status` is `completed` and `exitCode` is `0`
- `session.supervision` is present with `status` `succeeded`
- at least one failure-class incident and a `rerun-workflow` remediation on the first supervised attempt
- the successful worker output payload includes `summary` starting with `Recovered after supervised rerun`

Regression coverage for stall, patch escalation, and budgets lives in `packages/divedra/src/workflow/engine.test.ts` and `packages/divedra/src/workflow/superviser.test.ts`.
