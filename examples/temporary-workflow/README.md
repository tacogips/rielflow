# Temporary Workflow Example

This example is a temporary workflow payload, not an installed workflow bundle.
It can run directly from JSON without copying anything into project or user
workflow scope.

The payload is stored in `temp-workflow.json` and uses the temporary workflow
format:

- `workflow`: the authored step-addressed workflow definition
- `nodePayloads`: embedded node payloads keyed by the node file path referenced
  from `workflow.nodes[]`

Temporary workflow payloads must embed prompt content directly in JSON. Do not
use `promptTemplateFile`, `systemPromptTemplateFile`,
`sessionStartPromptTemplateFile`, external `stepFile`, or unresolved external
node files in a temporary workflow payload.

## Run From JSON File

Use `--dry-run` when you want to verify loading, validation, source metadata, and
payload logging without calling an agent backend:

```bash
bun run packages/rielflow/src/bin.ts workflow run \
  --workflow-json-file ./examples/temporary-workflow/temp-workflow.json \
  --dry-run \
  --output json \
  --artifact-root ./tmp/temporary-workflow-example/file-artifacts \
  --session-store ./tmp/temporary-workflow-example/file-sessions
```

Remove `--dry-run` to execute the embedded `codex-agent` worker.

## Run From Inline JSON

The same payload can be passed inline. This command reads the checked-in JSON
file into a shell variable and sends it through `--workflow-json`:

```bash
temporary_workflow_json="$(
  bun -e 'const fs = require("node:fs"); process.stdout.write(fs.readFileSync("examples/temporary-workflow/temp-workflow.json", "utf8"));'
)"

bun run packages/rielflow/src/bin.ts workflow run \
  --workflow-json "$temporary_workflow_json" \
  --dry-run \
  --output json \
  --artifact-root ./tmp/temporary-workflow-example/inline-artifacts \
  --session-store ./tmp/temporary-workflow-example/inline-sessions
```

## Inspect Payload Logs

Temporary runs persist the submitted and normalized payload under the run
artifact tree:

```bash
find ./tmp/temporary-workflow-example \
  -path '*/temporary-workflow-payload/*' \
  -type f \
  | sort
```

Expected files include:

- `temporary-workflow-payload/input.json`
- `temporary-workflow-payload/normalized.json`
- `temporary-workflow-payload/metadata.json`

Normal project, user, explicit-directory, manifest, and registry workflow runs
do not create this directory.
