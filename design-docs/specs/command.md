# Command Design

This document defines CLI interfaces for workflow and session management.

## Overview

Commands are designed around JSON workflow lifecycle operations and writing session execution.

## Sections

### Subcommands

- `workflow create <name>`
  - Create `<workflow-root>/<name>/` with `workflow.json`, `workflow-vis.json`, and template `node-{id}.json`.
- `workflow validate <name>`
  - Validate `<workflow-root>/<name>/` structure and semantic constraints.
- `workflow run <name>`
  - Execute `<workflow-root>/<name>/workflow.json` and referenced `node-{id}.json` files.
- `workflow inspect <name>`
  - Print normalized node graph, fan-out branch rules, loop defaults, timeout defaults, and node file references.
- `session status <session-id>`
  - Show current node, branch state, and loop counters.
- `session resume <session-id>`
  - Continue an interrupted session from persisted state.
- `gql <graphql-document>`
  - Execute a GraphQL query or mutation against the canonical control-plane endpoint.
  - Manager-node LLM/tool use should call GraphQL mutations such as `sendManagerMessage` through this command rather than dedicated domain subcommands.
  - When `DIVEDRA_MANAGER_SESSION_ID` is present, the CLI forwards it to `/graphql` with `X-Divedra-Manager-Session-Id` so manager-scoped mutations do not need to repeat it in GraphQL variables.
- `serve [workflow-name]`
  - Start local HTTP server for browser-based workflow editing and execution.
  - If `workflow-name` is omitted, server starts in workflow selection mode.
  - Serves the built browser frontend from `ui/dist/` and the canonical GraphQL control plane.
  - Exposes `/graphql` for workflow-definition, execution, communication, and manager-control operations.
  - Keeps `/api/ui-config` as a small browser bootstrap/config endpoint; workflow/session REST routes are not served.
  - Returns an explicit UI-unavailable response when the built frontend bundle is missing.
- `tui`
  - Start interactive terminal UI for workflow selection and execution.
  - Supports selecting a workflow from `<workflow-root>`.
  - Supports runtime user input for human-input nodes during execution.

### Flags and Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--variables` | string | none | For legacy execution commands: JSON file supplying runtime prompt variables. For `divedra gql`: inline GraphQL variables JSON or `@path/to/variables.json` |
| `--workflow-root` | string (path) | `./.divedra` | Root directory containing workflow definitions |
| `--artifact-root` | string (path) | derived from `DIVEDRA_ROOT_DATA_DIR` or `./.divedra-datas/workflow` | Root directory for execution artifacts |
| `--workflow` | string | none | Workflow name for direct TUI launch (skip workflow chooser) |
| `--resume-session` | string | none | Session id to resume in TUI |
| `--tui-log-level` | string | `info` | Log verbosity in TUI panel (`error`, `warn`, `info`, `debug`) |
| `--max-steps` | number | none | Hard cap on node executions per run |
| `--max-loop-iterations` | number | `3` | Override loop budget for safety |
| `--default-timeout-ms` | number | `120000` | Override default node timeout for this run |
| `--output` | string | `text` | Output format (`text` or `json`) for CLI-rendered GraphQL results |
| `--dry-run` | boolean | `false` | Validate and simulate transitions without agent execution |
| `--endpoint` | string | local serve endpoint | GraphQL endpoint used by CLI commands |
| `--auth-token` | string | none | Explicit auth token for GraphQL manager/control-plane requests |
| `--auth-token-env` | string | `DIVEDRA_MANAGER_AUTH_TOKEN` | Environment variable used to resolve GraphQL auth token |
| `--host` | string | `127.0.0.1` | Bind address for `serve` |
| `--port` | number | `43173` | Listen port for `serve` |
| `--open` | boolean | `false` | Open browser automatically after `serve` starts |
| `--read-only` | boolean | `false` | Disable write/update operations in `serve` mode |
| `--no-exec` | boolean | `false` | Disable workflow execution endpoints in `serve` mode |

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DIVEDRA_DEFAULT_MODEL` | No | none | Default model used only by create/template flows; runtime still requires explicit node `model` |
| `DIVEDRA_ARTIFACT_ROOT` | No | derived from `DIVEDRA_ROOT_DATA_DIR` or `./.divedra-datas/workflow` | Default root directory for execution artifacts |
| `DIVEDRA_WORKFLOW_ROOT` | No | `./.divedra` | Default workflow definition root directory |
| `DIVEDRA_TUI_LOG_LEVEL` | No | `info` | Default TUI log panel verbosity |
| `DIVEDRA_SESSION_STORE` | No | local file store | Session state backend selector |
| `DIVEDRA_LOG_LEVEL` | No | `info` | Runtime logging level |
| `DIVEDRA_SERVE_HOST` | No | `127.0.0.1` | Default bind address for `serve` |
| `DIVEDRA_SERVE_PORT` | No | `43173` | Default listen port for `serve` |
| `DIVEDRA_ROOT_DATA_DIR` | No | `./.divedra-datas` | Canonical Divedra root data directory used to resolve artifact, session, and attachment file references |
| `DIVEDRA_RUNTIME_ROOT` | No | compatibility alias | Legacy compatibility alias for `DIVEDRA_ROOT_DATA_DIR` during the migration |
| `DIVEDRA_GRAPHQL_ENDPOINT` | No | local serve endpoint | Default GraphQL endpoint for CLI manager/control-plane commands |
| `DIVEDRA_MANAGER_AUTH_TOKEN` | No | none | Manager-session auth token for `divedra gql` and GraphQL control-plane mutations |
| `DIVEDRA_MANAGER_SESSION_ID` | No | none | Ambient manager session id forwarded by `divedra gql` to `/graphql` for manager-scoped requests |
| `DIVEDRA_WORKFLOW_ID` | No | none | Ambient workflow id for manager tool environments |
| `DIVEDRA_WORKFLOW_EXECUTION_ID` | No | none | Ambient workflow execution id for manager tool environments |
| `DIVEDRA_MANAGER_NODE_ID` | No | none | Ambient manager node id for manager tool environments |
| `DIVEDRA_MANAGER_NODE_EXEC_ID` | No | none | Ambient manager node execution id for manager tool environments |

Workflow root resolution order:
1. `--workflow-root`
2. `DIVEDRA_WORKFLOW_ROOT`
3. `./.divedra`

Artifact root resolution order:
1. `--artifact-root`
2. `DIVEDRA_ARTIFACT_ROOT`
3. `DIVEDRA_ROOT_DATA_DIR/workflow`
4. `./.divedra-datas/workflow`

Session store root resolution order:
1. `--session-store`
2. `DIVEDRA_SESSION_STORE`
3. `DIVEDRA_ROOT_DATA_DIR/sessions`
4. existing runtime default

GraphQL control-plane resolution order:
1. `--endpoint`
2. `DIVEDRA_GRAPHQL_ENDPOINT`
3. local `divedra serve` default (`http://127.0.0.1:43173/graphql`)

Data-root file reference rule:
1. GraphQL file/image parameters use data-root-relative paths, not host absolute paths
2. Those paths are resolved under `DIVEDRA_ROOT_DATA_DIR`
3. `sendManagerMessage.attachments` must stay within `files/{workflowId}/{workflowExecutionId}/...`
4. Attachment files must already exist before the GraphQL request; first-iteration design does not add an upload mutation

## GraphQL Canonicalization

GraphQL is the canonical domain-parameter transport during migration for:

- workflow execution requests,
- communication inspection,
- communication replay/retry,
- manager send/control-plane requests.

Compatibility rule:

- domain parameters should be modeled in GraphQL inputs,
- `divedra gql` is the thin generic GraphQL client now, and legacy execution commands may opt into GraphQL transport with `--endpoint` while the rest of the CLI migrates incrementally,
- local-only debug flags such as `--mock-scenario` are not forwarded when a legacy command is executed remotely through GraphQL,
- browser/editor workflow surfaces should use GraphQL; `/api/ui-config` remains only as bootstrap metadata rather than a parallel workflow/session transport.

Supporting design: `design-docs/specs/design-graphql-manager-control-plane.md`.

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid workflow directory or JSON |
| 3 | Completion condition not met and no fallback path |
| 4 | Loop limit exceeded |
| 5 | Agent backend invocation error |
| 6 | Node execution timeout |
| 7 | HTTP server startup failure (port bind, config, or static asset error) |
