# Expected Results

Stable assertions for deterministic verification with the bundled mock
scenario. Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run packages/divedra/src/bin.ts workflow validate scheduled-sleep --workflow-definition-dir ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run packages/divedra/src/bin.ts workflow run scheduled-sleep \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/scheduled-sleep/mock-scenario.json \
  --output json
```

Expected stable facts:

- The workflow starts at `wait`.
- The `wait` step uses a sleep node with `durationMs: 1000`.
- After the scheduled sleep resumes, the workflow runs `worker`.
- The mocked `worker` payload includes
  `summary: "Scheduled sleep completed and worker resumed."`.
