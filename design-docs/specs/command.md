# Command Design

This document defines CLI interfaces for workflow and session management.

## Overview

Commands are designed around JSON workflow lifecycle operations and writing session execution.

## Sections

### Subcommands

- `cli workflow create <name>`
  - Create `<workflow-root>/<name>/` with `workflow.json`, `workflow-vis.json`, prompt templates, and default `nodes/node-{id}.json` payload files.
- `cli workflow validate <name>`
  - Validate `<workflow-root>/<name>/` structure and semantic constraints.
- `cli workflow inspect <name>`
  - Print normalized node graph, fan-out branch rules, loop defaults, timeout defaults, and node file references.
- `cli workflow run <name>`
  - Execute `<workflow-root>/<name>/workflow.json` and all referenced workflow-local node payload files.
- `session progress <session-id>`
  - Show queue, execution counts, and per-node restart/execution summary.
- `session status <session-id>`
  - Show the persisted workflow-session snapshot.
- `session resume <session-id>`
  - Continue an interrupted session from persisted state.
- `session rerun <session-id> <node-id>`
  - Start a new run from a chosen node in an existing session.
- `call-node <workflow-id> <workflow-run-id> <node-id>`
  - Execute one node directly against an existing run context for local debugging.
- `export <workflow-id> <workflow-run-id>`
  - Export the persisted workflow run logs as JSON to stdout or to a file.
- `gql <graphql-document>`
  - Execute a GraphQL query or mutation against the canonical control-plane endpoint.
  - Manager-node LLM/tool use should call GraphQL mutations such as `sendManagerMessage` through this command rather than dedicated domain subcommands.
  - When `DIVEDRA_MANAGER_SESSION_ID` is present, the CLI forwards it to `/graphql` with `X-Divedra-Manager-Session-Id` so manager-scoped mutations do not need to repeat it in GraphQL variables.
- `serve [workflow-name]`
  - Start the local HTTP control plane.
  - If `workflow-name` is provided, workflow-definition access is constrained to that workflow.
  - Exposes `/graphql` for workflow-definition, execution, communication, and manager-control operations.
  - Exposes `/healthz` for liveness checks.
  - Does not serve browser assets or workflow/session REST routes.
- `tui`
  - Start interactive terminal UI for workflow selection and execution.
  - Interactive OpenTUI mode opens the unified workspace/history/run app directly; workflow selection happens inside that workspace screen.
  - Supports runtime user input for human-input nodes during execution.

### Flags and Options

| Flag                    | Type          | Default                                                           | Description                                                                                                                                                |
| ----------------------- | ------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--variables`           | string        | none                                                              | For legacy execution commands: JSON file supplying runtime prompt variables. For `divedra gql`: inline GraphQL variables JSON or `@path/to/variables.json` |
| `--workflow-root`       | string (path) | nearest ancestor `./.divedra`                                     | Root directory containing workflow definitions                                                                                                             |
| `--artifact-root`       | string (path) | derived from `DIVEDRA_ARTIFACT_DIR` (see env) / `{root}/workflow` | Root directory for execution artifacts                                                                                                                     |
| `--session-store`       | string (path) | derived from `DIVEDRA_SESSION_STORE` / `{root}/sessions`          | Root directory for persisted workflow sessions                                                                                                             |
| `--workflow`            | string        | none                                                              | Workflow name for direct TUI launch (skip workflow chooser)                                                                                                |
| `--resume-session`      | string        | none                                                              | Session id to preselect for interactive TUI resume/inspection, or to resume immediately in non-interactive fallback mode                                   |
| `--mock-scenario`       | string (path) | none                                                              | Deterministic node-output fixture map for local execution/testing paths                                                                                    |
| `--max-steps`           | number        | none                                                              | Hard cap on node executions per run                                                                                                                        |
| `--max-loop-iterations` | number        | none                                                              | Override loop budget for safety                                                                                                                            |
| `--default-timeout-ms`  | number        | none                                                              | Override default node timeout for this run                                                                                                                 |
| `--output`              | string        | `text`                                                            | Output format (`text` or `json`) for CLI-rendered GraphQL results                                                                                          |
| `--dry-run`             | boolean       | `false`                                                           | Validate and simulate transitions without agent execution                                                                                                  |
| `--endpoint`            | string        | local serve endpoint                                              | GraphQL endpoint used by CLI commands                                                                                                                      |
| `--auth-token`          | string        | none                                                              | Explicit auth token for GraphQL manager/control-plane requests                                                                                             |
| `--auth-token-env`      | string        | `DIVEDRA_MANAGER_AUTH_TOKEN`                                      | Environment variable used to resolve GraphQL auth token                                                                                                    |
| `--message-json`        | string        | none                                                              | Inline JSON payload for `call-node`                                                                                                                        |
| `--message-file`        | string (path) | none                                                              | JSON payload file for `call-node`                                                                                                                          |
| `--file`                | string (path) | none                                                              | Output file path for `export`; when omitted, the export JSON is written to stdout                                                                          |
| `--host`                | string        | `127.0.0.1`                                                       | Bind address for `serve`                                                                                                                                   |
| `--port`                | number        | `43173`                                                           | Listen port for `serve`                                                                                                                                    |
| `--read-only`           | boolean       | `false`                                                           | Disable write/update operations in `serve` mode                                                                                                            |
| `--no-exec`             | boolean       | `false`                                                           | Compatibility flag parsed by `serve`; current GraphQL schema does not yet enforce execution blocking from this flag                                        |

### Environment Variables

| Variable                        | Required | Default                                                      | Description                                                                                                                                                                                                                                |
| ------------------------------- | -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DIVEDRA_ARTIFACT_ROOT`         | No       | derived from `DIVEDRA_ARTIFACT_DIR` / `{root}/workflow`      | Overrides only the workflow artifact tree root (`.../workflow`)                                                                                                                                                                            |
| `DIVEDRA_WORKFLOW_ROOT`         | No       | nearest ancestor `./.divedra`                                | Default workflow definition root directory                                                                                                                                                                                                 |
| `DIVEDRA_SESSION_STORE`         | No       | local file store                                             | Session state backend selector                                                                                                                                                                                                             |
| `DIVEDRA_SERVE_HOST`            | No       | `127.0.0.1`                                                  | Default bind address for `serve`                                                                                                                                                                                                           |
| `DIVEDRA_SERVE_PORT`            | No       | `43173`                                                      | Default listen port for `serve`                                                                                                                                                                                                            |
| `DIVEDRA_ARTIFACT_DIR`          | No       | `~/.divedra/project/<encoded-project-root>/divedra-artifact` | Canonical root data directory: sessions, `workflow/`, `files/`, `divedra.db`; when no explicit root is set, `divedra` first walks upward to find the nearest ancestor containing `.divedra` and uses that project root for default scoping |
| `DIVEDRA_ROOT_DATA_DIR`         | No       | (unused if `DIVEDRA_ARTIFACT_DIR` set)                       | Legacy alias for `DIVEDRA_ARTIFACT_DIR`                                                                                                                                                                                                    |
| `DIVEDRA_RUNTIME_ROOT`          | No       | compatibility alias                                          | Legacy alias for `DIVEDRA_ARTIFACT_DIR`                                                                                                                                                                                                    |
| `DIVEDRA_GRAPHQL_ENDPOINT`      | No       | local serve endpoint                                         | Default GraphQL endpoint for CLI manager/control-plane commands                                                                                                                                                                            |
| `DIVEDRA_MANAGER_AUTH_TOKEN`    | No       | none                                                         | Manager-session auth token for `divedra gql` and GraphQL control-plane mutations                                                                                                                                                           |
| `DIVEDRA_MANAGER_SESSION_ID`    | No       | none                                                         | Ambient manager session id forwarded by `divedra gql` to `/graphql` for manager-scoped requests                                                                                                                                            |
| `DIVEDRA_WORKFLOW_ID`           | No       | none                                                         | Ambient workflow id for manager tool environments                                                                                                                                                                                          |
| `DIVEDRA_WORKFLOW_EXECUTION_ID` | No       | none                                                         | Ambient workflow execution id for manager tool environments                                                                                                                                                                                |
| `DIVEDRA_MANAGER_NODE_ID`       | No       | none                                                         | Ambient manager node id for manager tool environments                                                                                                                                                                                      |
| `DIVEDRA_MANAGER_NODE_EXEC_ID`  | No       | none                                                         | Ambient manager node execution id for manager tool environments                                                                                                                                                                            |

Workflow root resolution order:

1. `--workflow-root`
2. `DIVEDRA_WORKFLOW_ROOT`
3. nearest ancestor `./.divedra` discovered by walking upward from `cwd`
4. fallback to `cwd/.divedra` when no ancestor contains `.divedra`

Artifact root resolution order:

1. `--artifact-root`
2. `DIVEDRA_ARTIFACT_ROOT`
3. `DIVEDRA_ARTIFACT_DIR/workflow` (or legacy `DIVEDRA_ROOT_DATA_DIR` / `DIVEDRA_RUNTIME_ROOT`)
4. computed default: `{resolved DIVEDRA_ARTIFACT_DIR}/workflow` where `DIVEDRA_ARTIFACT_DIR` defaults to `~/.divedra/project/<encoded-project-root>/divedra-artifact`
   - the encoded project root is the nearest ancestor containing `.divedra`, otherwise the current working directory

Runtime-root co-location rule:

1. when `--artifact-root` and/or `--session-store` are supplied, `divedra` infers `rootDataDir` from those explicit roots when they provide an unambiguous parent directory
2. that inferred root keeps `divedra.db` and sibling default roots aligned with the explicit storage tree instead of an unrelated ambient `DIVEDRA_ARTIFACT_DIR`

Session store root resolution order:

1. `--session-store`
2. `DIVEDRA_SESSION_STORE`
3. `{resolved DIVEDRA_ARTIFACT_DIR}/sessions`
4. existing runtime default

GraphQL control-plane resolution order:

1. `--endpoint`
2. `DIVEDRA_GRAPHQL_ENDPOINT`
3. local `divedra serve` default (`http://127.0.0.1:43173/graphql`)

Data-root file reference rule:

1. GraphQL file/image parameters use data-root-relative paths, not host absolute paths
2. Those paths are resolved under `DIVEDRA_ARTIFACT_DIR`
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
- workflow tooling should use GraphQL rather than parallel REST transports.

Supporting design: `design-docs/specs/design-graphql-manager-control-plane.md`.

### Exit Codes

| Code | Meaning                                           |
| ---- | ------------------------------------------------- |
| 0    | Success                                           |
| 1    | General error                                     |
| 2    | Invalid workflow directory or JSON                |
| 3    | Completion condition not met and no fallback path |
| 4    | Loop limit exceeded                               |
| 5    | Agent backend invocation error                    |
| 6    | Node execution timeout                            |
| 7    | HTTP server startup failure                       |
