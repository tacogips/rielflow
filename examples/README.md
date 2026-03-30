# Examples

This directory contains reference workflow bundles that can be validated or run
without copying them into `./.divedra`.

Each example directory also includes `EXPECTED_RESULTS.md`, which records the
stable assertions used for deterministic verification.

Most example bundles now use the simplified authored shape:

- ordered `nodes[]` are the canonical flow
- authored `edges` are omitted
- authored `subWorkflows` are omitted
- repeat-style examples use node-local `repeat`
- node payload files live under `nodes/` by default
- grouped lane payloads may live under `workflows/*/nodes/`
- inline node payload authoring is exercised by `same-node-session-echo`

Current exception:

- `codex-codex-euthanasia-debate` still uses the legacy sub-workflow structure
  because `subWorkflowConversations` has not yet been migrated to the
  simplified format

## Available Examples

### `subworkflow-chained-simple`

Minimal runnable reference for two sequential grouped lanes in one ordered node
list. The beta lane follows the alpha lane without authored `edges` or
`subWorkflows`, and the grouped lane payloads now live under
`workflows/alpha/` and `workflows/beta/`.

Validate it:

```bash
bun run src/main.ts cli workflow validate subworkflow-chained-simple --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts cli workflow inspect subworkflow-chained-simple --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts cli workflow run subworkflow-chained-simple \
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
bun run src/main.ts cli workflow validate claude-divedra-codex-coding --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts cli workflow inspect claude-divedra-codex-coding --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts cli workflow run claude-divedra-codex-coding \
  --workflow-root ./examples \
  --mock-scenario ./examples/claude-divedra-codex-coding/mock-scenario.json \
  --output json
```

### `node-combinations-showcase`

Validation-oriented reference bundle for the newer node authoring surface:

- ordered grouped nodes replace authored sibling sub-workflows
- a node-local `repeat` shows the repeated-iteration pattern for `foreach`
- one task uses `nodeType: "command"`
- one task uses `nodeType: "container"`
- workflow-relative support assets are included for the command script and
  container build context
- node payload files live under `nodes/`

Important current limitation:

- live `workflow run` still does not implement real `command` or `container`
  execution in the current runtime
- the bundled deterministic mock scenario can still exercise the full ordered
  workflow, including those node types, for example/demo purposes

Validate it:

```bash
bun run src/main.ts cli workflow validate node-combinations-showcase --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts cli workflow inspect node-combinations-showcase --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts cli workflow run node-combinations-showcase \
  --workflow-root ./examples \
  --mock-scenario ./examples/node-combinations-showcase/mock-scenario.json \
  --output json
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
- stage payloads live under `workflows/add`, `workflows/multiply`, and
  `workflows/divide`
- those nested stage payloads reuse the parent-level
  `prompts/subworkflow-manager.md`, which demonstrates workflow-local asset
  reuse across nested directories

Important current limitation:

- live `workflow run` still does not execute real `command` or `container`
  workers in the current runtime
- the bundled deterministic mock scenario can still exercise the authored
  command/container graph for example and verification purposes

Validate it:

```bash
bun run src/main.ts cli workflow validate first-four-arithmetic-pipeline --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts cli workflow inspect first-four-arithmetic-pipeline --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts cli workflow run first-four-arithmetic-pipeline \
  --workflow-root ./examples \
  --mock-scenario ./examples/first-four-arithmetic-pipeline/mock-scenario.json \
  --output json
```

### `claude-divedra-claude-worker`

Reference workflow for the case where a regular task node also uses
`claude-code-agent`:

- `divedra` manager nodes use `claude-code-agent`
- the task node `claude-task` also uses `claude-code-agent`
- the bundle includes a deterministic mock scenario for validate/run demos

Validate it:

```bash
bun run src/main.ts cli workflow validate claude-divedra-claude-worker --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts cli workflow inspect claude-divedra-claude-worker --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts cli workflow run claude-divedra-claude-worker \
  --workflow-root ./examples \
  --mock-scenario ./examples/claude-divedra-claude-worker/mock-scenario.json \
  --output json
```

### `same-node-session-echo`

Reference workflow for the case where one worker node should run twice:

- the same node id `echo-session` is revisited through node-local `repeat`
- `nodes/node-echo-session.json` opts into `sessionPolicy.mode = "reuse"`
- the first visit echoes the normalized request
- the second visit answers using that earlier echo
- the prompt also reads `{{inbox.latest.output.echoText}}` so the earlier echo is
  available explicitly in workflow data, not only via backend memory
- the root manager payload is authored inline in `workflow.json`

Validate it:

```bash
bun run src/main.ts cli workflow validate same-node-session-echo --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts cli workflow inspect same-node-session-echo --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts cli workflow run same-node-session-echo \
  --workflow-root ./examples \
  --mock-scenario ./examples/same-node-session-echo/mock-scenario.json \
  --output json
```

Live execution note:

- the bundled mock scenario demonstrates the repeated same-node control flow
- actual backend session continuation still depends on the configured
  `claude-code-agent` or `codex-agent` backend returning a reusable session id

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
bun run src/main.ts cli workflow validate codex-codex-euthanasia-debate --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts cli workflow inspect codex-codex-euthanasia-debate --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts cli workflow run codex-codex-euthanasia-debate \
  --workflow-root ./examples \
  --mock-scenario ./examples/codex-codex-euthanasia-debate/mock-scenario.json \
  --output json
```

Live execution note:

- this bundle depends on the configured `codex-agent` backend honoring the remote request body fields sent by this repository, including `systemPromptText`
