# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate codex-codex-euthanasia-debate --workflow-root ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run src/main.ts workflow run codex-codex-euthanasia-debate \
  --workflow-root ./examples \
  --mock-scenario ./examples/codex-codex-euthanasia-debate/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "codex-codex-euthanasia-debate",
  "workflowId": "codex-codex-euthanasia-debate",
  "nodeExecutions": 56,
  "transitions": 45,
  "exitCode": 0
}
```

Expected post-run session assertions:

```json
{
  "conversationTurns": 10,
  "nodeExecutionCounts": {
    "divedra-manager": 12,
    "affirmative-manager": 6,
    "affirmative-input": 6,
    "affirmative-speaker": 6,
    "affirmative-output": 6,
    "negative-manager": 5,
    "negative-input": 5,
    "negative-speaker": 5,
    "negative-output": 5
  }
}
```

Expected final output node: `affirmative-output`

Expected final output payload:

```json
{
  "stance": "affirmative",
  "turnNumber": 6,
  "argument": "The strongest ethical case remains autonomy constrained by evidence, review, and explicit voluntary consent.",
  "responseToOpponent": "No safeguard is perfect, but regulated choice can still be ethically preferable to denying relief in every case.",
  "done": true,
  "summary": "Debate reached the configured 10-turn cap with the affirmative side delivering the final published turn."
}
```
