# Examples

This directory contains reference workflow bundles that can be validated or run
without copying them into `./.divedra`.

## Available Examples

### `subworkflow-chained-simple`

Minimal runnable reference for **two plain sub-workflows in one bundle**, where the
second lane lists `inputSources` with `type: "sub-workflow-output"` and
`subWorkflowId` pointing at the first lane (same pattern as
`first-four-arithmetic-pipeline`, but all nodes stay on `claude-code-agent` so
`workflow run` works with the bundled mock scenario).

Validate it:

```bash
bun run src/main.ts workflow validate subworkflow-chained-simple --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect subworkflow-chained-simple --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run subworkflow-chained-simple \
  --workflow-root ./examples \
  --mock-scenario ./examples/subworkflow-chained-simple/mock-scenario.json \
  --output json
```

### `claude-divedra-codex-coding`

Recommended mixed-backend reference:

- `divedra` manager nodes use `claude-code-agent`
- implementation planning/finalization stays on `claude-code`
- the actual coding node uses `codex-agent`
- the workflow-level `divedraPromptTemplate` explicitly prefers `divedra gql`
- node prompt templates can read upstream mailbox data through `{{inbox.*}}`
- long node prompts live in `prompts/*.md` and are referenced by
  `node-{id}.json.promptTemplateFile`

Validate it:

```bash
bun run src/main.ts workflow validate claude-divedra-codex-coding --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect claude-divedra-codex-coding --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run claude-divedra-codex-coding \
  --workflow-root ./examples \
  --mock-scenario ./examples/claude-divedra-codex-coding/mock-scenario.json \
  --output json
```

### `node-combinations-showcase`

Validation-oriented reference bundle for the newer node authoring surface:

- sibling plain sub-workflows show the current fan-out/concurrent-style pattern
- a loop-body sub-workflow shows the current repeated-iteration pattern used in
  place of a first-class `foreach` field
- one task uses `nodeType: "command"`
- one task uses `nodeType: "container"`
- workflow-relative support assets are included for the command script and
  container build context

Important current limitation:

- live `workflow run` still does not implement real `command` or `container`
  execution in the current runtime
- the bundled deterministic mock scenario can still exercise the full workflow
  graph, including those node types, for example/demo purposes

Validate it:

```bash
bun run src/main.ts workflow validate node-combinations-showcase --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect node-combinations-showcase --workflow-root ./examples --output json
```

### `first-four-arithmetic-pipeline`

Validation-oriented arithmetic pipeline reference:

- accepts a human input string containing at least four space-separated numbers
- uses only the first four numbers from that input
- stage 1 uses an `agent` worker to add the first two numbers
- stage 2 uses a `container` worker configured for `podman` to multiply the
  stage 1 result by the third number
- stage 3 uses a `command` worker to divide the stage 2 result by the fourth
  number
- managers treat each stage as opaque and only move scoped payloads forward

Important current limitation:

- this bundle is meant for `validate` and `inspect`
- `command` and `container` nodes are still rejected by `workflow run` in the
  current runtime, so this example is intentionally not documented as runnable

Validate it:

```bash
bun run src/main.ts workflow validate first-four-arithmetic-pipeline --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect first-four-arithmetic-pipeline --workflow-root ./examples --output json
```

### `claude-divedra-claude-worker`

Reference workflow for the case where a regular task node also uses
`claude-code-agent`:

- `divedra` manager nodes use `claude-code-agent`
- the task node `claude-task` also uses `claude-code-agent`
- the bundle includes a deterministic mock scenario for validate/run demos

Validate it:

```bash
bun run src/main.ts workflow validate claude-divedra-claude-worker --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect claude-divedra-claude-worker --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run claude-divedra-claude-worker \
  --workflow-root ./examples \
  --mock-scenario ./examples/claude-divedra-claude-worker/mock-scenario.json \
  --output json
```

### `codex-codex-euthanasia-debate`

Reference debate bundle for the new node-local prompt split:

- two `codex-agent` speaker nodes debate euthanasia from opposing positions
- the affirmative speaker uses a node-local `systemPromptTemplateFile`
- the negative speaker uses a different node-local `systemPromptTemplateFile`
- both speakers use `sessionStartPromptTemplateFile` with the first-turn wrapper format:
  `##prompt ... ## args ...`
- `subWorkflowConversations.maxTurns = 10` stops the debate after 10 turns

Validate it:

```bash
bun run src/main.ts workflow validate codex-codex-euthanasia-debate --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect codex-codex-euthanasia-debate --workflow-root ./examples --output json
```

Live execution note:

- this bundle depends on the configured `codex-agent` backend honoring the remote request body fields sent by this repository, including `systemPromptText`
