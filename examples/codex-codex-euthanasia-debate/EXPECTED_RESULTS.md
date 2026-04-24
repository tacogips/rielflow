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
  "transitions": 55,
  "exitCode": 0
}
```

Expected post-run session assertions:

```json
{
  "conversationTurns": 0,
  "nodeExecutionCounts": {
    "divedra-manager": 1,
    "affirmative-manager": 6,
    "affirmative-input": 6,
    "affirmative-speaker": 6,
    "affirmative-output": 6,
    "negative-manager": 6,
    "negative-input": 6,
    "negative-speaker": 6,
    "negative-output": 6,
    "debate-judge": 6,
    "debate-summary": 1
  }
}
```

Expected final output node: `debate-summary`

Expected final output payload:

```json
{
  "stance": "neutral",
  "roundsCompleted": 6,
  "summary": "Debate completed six full affirmative-then-negative rounds; the affirmative side delivered the final published turn.",
  "argument": "The strongest ethical case remains autonomy constrained by evidence, review, and explicit voluntary consent.",
  "responseToOpponent": "No safeguard is perfect, but regulated choice can still be ethically preferable to denying relief in every case.",
  "done": true
}
```
