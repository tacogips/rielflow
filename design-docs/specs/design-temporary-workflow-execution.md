# Temporary Workflow Execution

Temporary workflow execution lets a caller run a complete workflow payload from
inline JSON or a JSON file without installing the workflow into project or user
scope. The feature is a local-run convenience and an API boundary for dynamic
workflow callers; it must not change normal scoped workflow lookup or artifact
shape.

## Overview

The runtime should support a new temporary workflow source kind with two CLI
forms:

```bash
rielflow workflow run --workflow-json '{"workflow":{...},"nodePayloads":{...}}'
rielflow workflow run --workflow-json-file ./tmp/workflow.json
```

`--workflow-json` carries an inline JSON object. `--workflow-json-file` reads a
single JSON file from the caller's machine. Both options supply the workflow
definition itself, so they are mutually exclusive with a positional workflow
name, `--workflow-definition-dir`, and `--from-registry`. When
`RIEL_WORKFLOW_DEFINITION_DIR` is set, an explicit temporary workflow option
takes precedence and ignores that environment default for workflow source
resolution.

The payload format should match the normalized bundle shape accepted by the
validation boundary:

- `workflow`: the workflow JSON, including `workflowId`, `description`,
  `nodes`, `steps`, defaults, prompts, and control-flow fields
- `nodePayloads`: object keyed by node file reference or node id, containing
  node runtime payloads

The CLI may accept a backwards-compatible single-workflow object only if it can
be unambiguously normalized into that bundle shape. Ambiguous objects fail with
a validation error that points callers at the supported temporary payload
format.

## Command Behavior

Temporary workflow input is explicit. A bare positional argument still means a
catalog, direct-directory, manifest, or registry workflow target. The two new
temporary options replace the target rather than changing lookup order for
ordinary runs.

Resolution order for `workflow run` becomes:

1. `--workflow-json`
2. `--workflow-json-file`
3. `--from-registry <target>`
4. `--workflow-definition-dir` or `RIEL_WORKFLOW_DEFINITION_DIR`
5. scoped project/user catalog lookup

Only one source selector may be active. A temporary run does not create or
update checkout/package registry records and is not discoverable through
`workflow list` as an installed workflow.

JSON output for a temporary run should include a source object such as:

```json
{
  "source": {
    "scope": "temporary",
    "input": "inline-json"
  }
}
```

For file input, include a normalized absolute or cwd-relative display path, but
do not treat that path as a durable workflow source after the run has started.

## Validation Rules

Temporary workflow validation uses the same structural workflow and node
validation as ordinary loaded bundles, with stricter external-file rules:

- reject `promptTemplateFile`, `systemPromptTemplateFile`, and
  `sessionStartPromptTemplateFile`
- reject workflow `steps[].stepFile`
- reject `nodes[].nodeFile` unless the referenced payload is present in the
  same temporary payload's `nodePayloads`
- reject workflow-local relative payload references that require reading files
  outside the temporary JSON payload
- allow ordinary runtime variables, node patches, mock scenarios, dry run,
  timeout, auto-improve, and storage options

The error message should state that temporary workflows must embed prompt and
related prompt content directly in JSON. This is intentional divergence from
authored workflow bundles, where prompt files and step files remain supported.

## Runtime and Artifact Boundary

Temporary runs should be normalized into an in-memory `LoadedWorkflow` with
source scope `temporary`. They should not materialize a workflow bundle under a
project or user workflow root merely to satisfy the existing loader.

At run start, persist the submitted temporary payload under the run's existing
artifact tree in a dedicated area:

```text
<artifactWorkflowRoot>/<workflowExecutionId>/temporary-workflow-payload/
  input.json
  normalized.json
  metadata.json
```

`input.json` is the exact parsed JSON value after file read or inline parse.
`normalized.json` is the validated normalized bundle used by execution.
`metadata.json` records `sourceKind` (`inline-json` or `json-file`), optional
display path, content digest, persisted timestamp, and schema version.

This directory is created only when the loaded workflow source scope is
`temporary`. Normal scoped, direct-directory, manifest, and registry-backed runs
must not create `temporary-workflow-payload/`.

The persisted normalized payload becomes the durable source for resume, rerun,
and continuation of temporary sessions. The runtime should reload it from the
session artifact tree when a session points at a temporary source, rather than
requiring the original inline string or local file to still exist.

## API Boundary

The local library API should expose the same behavior with a provider-neutral
temporary workflow source input. File-path reading is CLI-local convenience;
library callers should pass either a parsed temporary bundle object or an inline
JSON string plus source metadata.

GraphQL remote execution should not accept `--workflow-json-file` semantics
because server-side file paths are not the caller's local file system. A future
GraphQL mutation may accept an inline temporary bundle object, but this design
keeps the first implementation focused on local CLI and library execution unless
an implementation plan explicitly includes the remote schema change.

## Codex Reference Mapping

Step 1 did not provide a reachable external Codex issue or a usable sibling
`../../codex-agent` checkout. Codex-agent is therefore only a workflow backend
identity and execution reference for this issue. No Codex source behavior is
copied into temporary workflow loading.

Temporary workflow support is provider-neutral. `codex-agent`,
`claude-code-agent`, `cursor-cli-agent`, and SDK backends appear only inside node
payloads after validation. Cursor-specific behavior remains isolated behind the
Cursor adapter; command parsing, temporary payload persistence, and validation
must not special-case Cursor.

## Verification

Implementation verification should include:

- `bun test packages/rielflow/src/cli.test.ts`
- `bun test packages/rielflow/src/workflow/load.test.ts packages/rielflow/src/workflow/validate.test.ts`
- `bun test packages/rielflow/src/workflow/session-store.test.ts packages/rielflow/src/workflow/engine.test.ts`
- `bun test packages/rielflow/src/lib-api.test.ts`
- `bun run typecheck`
- `bun run biome check .`
- `bun run packages/rielflow/src/bin.ts workflow run --help`
- `bun run packages/rielflow/src/bin.ts workflow run --workflow-json '<embedded-workflow-json>' --output json`
- `bun run packages/rielflow/src/bin.ts workflow run --workflow-json-file ./tmp/temp-workflow.json --output json`

Focused tests must prove inline JSON execution, JSON-file execution, temporary
payload persistence, resume/rerun source reload from persisted payloads, and
non-persistence for ordinary scoped workflow runs.
