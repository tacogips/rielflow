# Workflow Design QA

**Status**: Confirmed (canonical decisions recorded)
**Created**: 2026-02-23

## Confirmed Decisions (from user)

1. Workflow location
- Workflows are stored under `.divedra/` in subdirectories.
- Unit path: `.divedra/<workflow-name>/`.

2. Required files per workflow
- `workflow.json`
- `workflow-vis.json`
- `node-{id}.json` (one file per node)
- optional workflow-local prompt files such as `prompts/<node-id>.md`

3. workflow.json role
- May include optional `description` describing workflow purpose.
- Defines node combinations, branching, and looping structure.

4. node-{id}.json role
- Defines runtime execution payload for each node:
  - `executionBackend`
  - `promptTemplate`
  - optional `promptTemplateFile`
  - `model`
  - `variables`

5. workflow-vis.json role
- Stores browser visualization state (e.g., node `order`).
- `indent`/`color` are derived from graph and loop/group semantics at render time.
- Updated by browser operations.

6. Branch match policy
- When multiple branch conditions are true, execute all matched branches (fan-out).

7. Loop safety default
- If loop-local limits are omitted, apply global default value.

8. Completion requirement
- Auto-complete nodes are allowed.
- Nodes without explicit success judgment are allowed by node configuration.

9. Timeout requirement
- Node execution timeout should be configurable.
- Design includes node-level timeout override plus workflow-level default timeout.
 
10. Initial default values
- `defaults.maxLoopIterations = 3`
- `defaults.nodeTimeoutMs = 120000`

## Canonical Decisions (Resolved)

1. Node payload field names
- Canonical fields are `promptTemplate` and `variables`.
- Node payloads may additionally declare `promptTemplateFile` as a workflow-local authoring pointer for long prompt text.
- For disk-backed workflows, `promptTemplateFile` may supply the prompt body and the loader resolves it into the effective `promptTemplate`.
- Legacy aliases `prompt` and `variable` are read-compatible only.
- Writers/normalizers must output canonical field names.

2. `model` requiredness
- `node-{id}.json.model` is required for validation and runtime execution.
- `node-{id}.json.executionBackend` is the canonical execution interface field for newly authored workflows.
- Existing workflows may omit `executionBackend` only when `model` is a tacogips legacy backend identifier.
- `DIVEDRA_DEFAULT_MODEL` is only for interactive/template generation convenience.
- Workflows missing `model` must fail validation.

3. Completion semantics
- Completion is optional.
- Missing `completion` or `completion.type = "none"` means auto-complete behavior.
- Explicit completion strategies (`checklist`, `score-threshold`, `validator-result`) apply quality gates.

4. Node id format
- Node id is a stable slug-like identifier, not limited to short UUID.
- Recommended validation pattern: `^[a-z0-9][a-z0-9-]{1,63}$`.
- `node-{id}.json` naming remains required.

5. Artifact root policy
- Artifact root is configurable and independent of workflow definition root.
- Resolution order:
  1. CLI `--artifact-root`
  2. `DIVEDRA_ARTIFACT_ROOT`
  3. `{DIVEDRA_ARTIFACT_DIR}/workflow` (default derived from `DIVEDRA_ARTIFACT_DIR` or `~/.divedra/project/<cwd-encoded>/divedra-artifact`)
- Artifact path format remains `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/`.

6. Prompt authoring policy
- Keep workflow structure in JSON (`workflow.json`, `node-{id}.json`).
- Prefer workflow-local prompt files such as `prompts/<node-id>.md` for long multiline prompt bodies.
- `promptTemplateFile` must resolve within the workflow directory.
- Prompt-file changes are part of the workflow-definition revision surface.
