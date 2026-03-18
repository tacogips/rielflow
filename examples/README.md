# Examples

This directory contains reference workflow bundles that can be validated or run
without copying them into `./.divedra`.

## Available Examples

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

- this bundle is meant for `validate` and `inspect`
- `command` and `container` nodes are still rejected by `workflow run` in the
  current runtime, so this example is intentionally not documented as runnable

Validate it:

```bash
bun run src/main.ts workflow validate node-combinations-showcase --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect node-combinations-showcase --workflow-root ./examples --output json
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
