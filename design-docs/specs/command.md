# Command Design

This document defines CLI interfaces for workflow and session management.

## Overview

Commands are designed around JSON workflow lifecycle operations and writing session execution.

## Sections

### Subcommands

- `cli workflow create <name>`
  - Create `<workflow-root>/<name>/` with `workflow.json`, prompt templates, and default `nodes/node-{id}.json` payload files.
  - In scoped mode, create under `<scope-root>/workflows/<name>/`.
  - Default write scope is project scope when a project `.divedra` exists, otherwise user scope; `--scope project|user` makes the destination explicit.
  - The target starter direction is a `code` manager node by default, with LLM manager authoring retained as experimental.
  - Starter templates use `workflow -> steps[] + nodes[]`, where steps are the execution addresses and `workflow.json.nodes[]` is the reusable node registry.
  - The generated `workflow.json` should contain only authored schema fields from the current model.
  - `--worker-only` switches the starter to a manager-less template whose explicit `entryStepId` points at `main-worker`.
- `cli workflow validate <name>`
  - Validate `<workflow-root>/<name>/` structure and semantic constraints.
  - Scoped catalog output includes the resolved workflow `source` scope and workflow directory so project/user shadowing is visible.
- `cli workflow inspect <name>`
  - Print workflow structure, including canonical execution units (`steps`), jump graph, timeout defaults, and reusable node references.
  - Scoped catalog output includes the resolved workflow `source` scope and workflow directory.
- `cli workflow run <name>`
  - Execute `<workflow-root>/<name>/workflow.json` and all referenced workflow-local node payload files.
  - Without a direct `--workflow-root`, resolve `<name>` from the scoped workflow catalog: project scope first, then user scope.
  - Local run output includes the resolved workflow `source` scope and workflow directory before execution/session details.
  - Accepts `--working-dir` / `--working-directory` to override the workflow execution working directory for that run.
  - Current implementation: `--auto-improve` runs the target workflow under the engine-owned phase-1 supervision loop. The CLI exposes the supervision policy surface, persists incidents/remediations on the target session, and uses an execution-scoped mutable workflow copy by default when workflow patching is required.
  - Optional nested supervision: `--nested-superviser` runs `superviserWorkflowId` as a paired nested superviser workflow while keeping the same operator-visible policy and audit surfaces.
  - When `--endpoint` is used, the GraphQL execution transport must forward the same supervision policy surface as the local engine path; remote execution must not silently drop `--auto-improve` or `--nested-superviser`.
- `session progress <session-id>`
  - Show queue, execution counts, and per-step restart/execution summary.
- `session status <session-id>`
  - Show the persisted workflow-session snapshot.
- `session resume <session-id>`
  - Continue an interrupted session from persisted state.
  - Accepts `--working-dir` / `--working-directory` to override the execution working directory used for resumed step execution.
  - The same supervision policy surface (`--auto-improve`, optional `--nested-superviser`) must work through both local and `--endpoint` GraphQL execution paths.
- `session rerun <session-id> <step-id>`
  - Start a new run from a chosen step in an existing session.
  - Accepts `--working-dir` / `--working-directory` to override the workflow execution working directory for the rerun.
  - Step ids are the only supported rerun target on active command/control surfaces; do not add node-id aliases to new APIs.
  - `--nested-superviser` is not a valid rerun flag; nested supervision is meaningful only for supervised start/resume flows.
- `session continue <source-workflow-execution-id> --start-step <step-id> --after-step-run <step-run-id>`
  - Planned history-linked continuation mode. Starts a new workflow execution from `startStepId` while importing source history through one concrete prior step run.
  - `after-step-run` is resolved against the merged step-run timeline visible from the source workflow execution, so the chosen anchor may belong to imported ancestry rather than only the source run's local rows.
- `session step-runs <workflow-execution-id>`
  - Planned operator inspection surface for the merged ordered step-run history (`timelineOrdinal`, `executionOrdinal`, `stepRunId`, `stepId`, status, imported, lineage) visible from one workflow execution.
  - Existing `session status`, `session progress`, and low-level `nodeExecutions` inspection remain local-session views unless an explicit imported-history mode is requested.
- `session export <session-id>`
  - Export the persisted workflow run as JSON to stdout or to a file.
  - Includes session state, runtime step/node execution rows, runtime node logs, and communication snapshots.
- `session logs <session-id>`
  - Print runtime node logs for a persisted session.
  - Accepts `--format text|json|jsonl`; defaults to text unless `--output json` is used.
- `call-step <workflow-id> <workflow-run-id> <step-id>`
  - Execute one step directly against an existing run context for local debugging.
  - The same call contract is the target runtime primitive for cross-workflow invocation; calling another workflow means targeting that workflow's callable entry step through `call-step` semantics rather than through an authored top-level `workflow.workflowCalls` array (validation rejects that field).
  - Support explicit continuation controls such as prompt variant selection, backend-session reuse, and timeout override so the same reusable node can be revisited through a different step for flows such as self-review and timeout recovery.
  - New API work should follow the same rule: step-addressed direct execution only, with no additive `call-node`-style aliases. The legacy `call-node` command/library surface is removed rather than retained as a compatibility synonym.
- `gql <graphql-document>`
  - Execute a GraphQL query or mutation against the canonical control-plane endpoint.
  - Manager-node LLM/tool use should call GraphQL mutations such as `sendManagerMessage` through this command rather than dedicated domain subcommands.
  - When `DIVEDRA_MANAGER_SESSION_ID` is present, the CLI forwards it to `/graphql` with `X-Divedra-Manager-Session-Id` so manager-scoped mutations do not need to repeat it in GraphQL variables.
- `serve [workflow-name]`
  - Start the local HTTP control plane.
  - If `workflow-name` is provided, workflow-definition access is constrained to that workflow.
  - Exposes `/graphql` for workflow-definition, execution, communication, and manager-control operations.
  - Exposes `/healthz` for liveness checks.
- `hook [--vendor claude-code|codex|gemini]`
  - Receive agent backend hook payloads via stdin, detect vendor and event type, associate hook `session_id` with the ambient divedra workflow execution when available, record the hook event, and dispatch to registered policy handlers.
  - Claude Code, Codex, and Gemini pipe a JSON object to stdin; the command parses it, validates the shared transport fields (`session_id`, `cwd`, `hook_event_name`), resolves the vendor (from `--vendor` flag or best-effort detection), identifies the `hook_event_name`, and calls the matching handler.
  - When `DIVEDRA_WORKFLOW_EXECUTION_ID`, `DIVEDRA_WORKFLOW_ID`, and the ambient step/node execution context variables are present, hook events are persisted as runtime hook-event records keyed by workflow execution id, backend agent session id, node execution id, and optional manager session id.
  - Outside a divedra-launched agent process, the command remains pass-through by default and returns empty JSON `{}` unless a policy handler makes a decision.
  - Exit 0 with JSON on stdout for success; exit 2 with reason on stderr to block.
- `hook snippet --vendor claude-code|codex|gemini`
  - Print a paste-ready JSON hook configuration snippet for the selected backend.
  - The generated snippet registers the vendor-detecting `divedra hook` command for the recommended lifecycle events.
  - This command only prints JSON to stdout; it does not mutate Claude Code, Codex, Gemini, or project configuration files.
- `events validate [--event-root <path>]`
  - Validate external event source and binding configuration without starting listeners.
- `events emit <source-id> --event-file <path>`
  - Inject a normalized or raw fixture event for local testing of binding matching, input mapping, dedupe, and workflow dispatch.
- `events serve [--event-root <path>] [--endpoint <graphql-url>]`
  - Start cron, webhook, chat, and web-chat event listeners.
  - In local command-dispatch mode, starts workflow execution through `divedra workflow run` with a generated mapped-input JSON file.
  - In local library mode, invokes the library workflow execution client in-process.
  - With `--endpoint`, dispatches workflow execution through GraphQL and can run as a lightweight listener process.
- `events list [--source <id>] [--status <status>] [--limit <n>]`
  - Inspect persisted event receipt records.
- `events replay <receipt-id> [--dry-run] [--reason <text>]`
  - Re-run mapping and dispatch for a persisted normalized event receipt using replay-specific event and dedupe identifiers.
  - `--dry-run` forwards the replay through workflow execution dry-run behavior.
  - `--reason` records operator intent in the replay receipt raw artifact.
  - Local event dispatch commands accept `--mock-scenario <path>` and reject combining it with `--endpoint`.

### Flags and Options

| Flag                    | Type          | Default                                                           | Description                                                                                                                                                |
| ----------------------- | ------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--worker-only`         | boolean       | `false`                                                           | For `workflow create`: scaffold a manager-less starter whose explicit `entryStepId` is `main-worker`                                                         |
| `--variables`           | string        | none                                                              | For `divedra gql`: inline GraphQL variables JSON or `@path/to/variables.json`                                                                                |
| `--workflow-root`       | string (path) | scoped catalog lookup                                             | Direct root directory containing workflow definitions; when supplied, bypasses project/user scope catalog lookup                                            |
| `--scope`               | string        | `auto`                                                            | Workflow scope selector for read/write commands: `auto`, `project`, or `user`                                                                              |
| `--user-root`           | string (path) | `~/.divedra`                                                      | User scope root; workflows are read from `<user-root>/workflows` unless `--workflow-root` is supplied                                                       |
| `--project-root`        | string (path) | nearest project `.divedra`                                        | Project scope root; workflows are read from `<project-root>/workflows` unless `--workflow-root` is supplied                                                 |
| `--addon-root`          | string (path) | scoped add-on catalog lookup                                      | Direct root directory containing local add-ons; during scoped catalog loading, searched before project/user add-on roots                                     |
| `--artifact-root`       | string (path) | `<scope-root>/artifacts/workflow`                                 | Root directory for execution artifacts                                                                                                                     |
| `--session-store`       | string (path) | `<scope-root>/artifacts/sessions`                                 | Root directory for persisted workflow sessions                                                                                                             |
| `--log-root`            | string (path) | `<scope-root>/logs`                                               | Root directory for operator-facing process logs and exported runtime logs                                                                                   |
| `--config`              | string (path) | `$XDG_CONFIG_HOME/divedra/config.json`                            | Bootstrap config path used to resolve user/project scope roots                                                                                             |
| `--working-dir`         | string (path) | command invocation `cwd`                                          | Workflow execution working directory override; relative values resolve from the command invocation directory                                               |
| `--mock-scenario`       | string (path) | none                                                              | Deterministic node-output fixture map for local execution/testing paths                                                                                    |
| `--max-steps`           | number        | none                                                              | Hard cap on step executions per run                                                                                                                        |
| `--default-timeout-ms`  | number        | none                                                              | Override default node timeout for this run                                                                                                                 |
| `--auto-improve`        | boolean       | `false`                                                           | Run the workflow under phase-1 `auto improve mode` using the engine-owned supervision loop                                                                 |
| `--superviser-workflow` | string        | built-in default superviser workflow id                           | Workflow id for nested superviser execution when `--nested-superviser` is enabled; persisted on supervision state                                         |
| `--monitor-interval-ms` | number        | none                                                              | For `auto improve mode`: control supervision polling / observation cadence                                                                                 |
| `--stall-timeout-ms`    | number        | none                                                              | For `auto improve mode`: mark the target workflow stalled when no progress is observed within this interval; must be greater than or equal to `--monitor-interval-ms` |
| `--max-supervised-attempts` | number    | none                                                              | For `auto improve mode`: cap total supervised target workflow attempts                                                                                     |
| `--max-workflow-patches` | number       | none                                                              | For `auto improve mode`: cap automatic workflow-definition patch attempts                                                                                  |
| `--workflow-mutation-mode` | string     | `execution-copy`                                                  | For `auto improve mode`: choose whether workflow repairs apply to an execution-scoped copy or in-place on the canonical bundle                            |
| `--no-allow-targeted-rerun` | boolean    | `false`                                                           | For `auto improve mode`: when set, disable rerun from a selected step. Deprecated alias: `--disable-targeted-rerun`.                                         |
| `--timeout-ms`          | number        | none                                                              | For targeted `call-step` / continuation flows: override timeout for that invocation                                                                        |
| `--prompt-variant`      | string        | none                                                              | For targeted `call-step` / continuation flows: select a named prompt variant on the step's resolved reusable node payload                                  |
| `--continue-session`    | boolean       | `false`                                                           | For targeted `call-step` / continuation flows: request backend-session reuse when the resolved node and backend support it                                 |
| `--resume-step-exec`    | string        | none                                                              | For targeted `call-step` / continuation flows: prior execution record id (`nodeExecId` in session state to continue from)                                     |
| `--output`              | string        | `text`                                                            | Output format (`text` or `json`) for CLI-rendered GraphQL results                                                                                          |
| `--dry-run`             | boolean       | `false`                                                           | Validate and simulate transitions without agent execution                                                                                                  |
| `--endpoint`            | string        | local serve endpoint                                              | GraphQL endpoint used by CLI commands                                                                                                                      |
| `--auth-token`          | string        | none                                                              | Explicit auth token for GraphQL manager/control-plane requests                                                                                             |
| `--auth-token-env`      | string        | `DIVEDRA_MANAGER_AUTH_TOKEN`                                      | Environment variable used to resolve GraphQL auth token                                                                                                    |
| `--message-json`        | string        | none                                                              | Inline JSON payload for `call-step`                                                                                                                        |
| `--message-file`        | string (path) | none                                                              | JSON payload file for `call-step`                                                                                                                          |
| `--file`                | string (path) | none                                                              | Output file path for `export`; when omitted, the export JSON is written to stdout                                                                          |
| `--host`                | string        | `127.0.0.1`                                                       | Bind address for `serve`                                                                                                                                   |
| `--port`                | number        | `43173`                                                           | Listen port for `serve`                                                                                                                                    |
| `--read-only`           | boolean       | `false`                                                           | Disable write/update operations in `serve` mode                                                                                                            |
| `--no-exec`             | boolean       | `false`                                                           | Parsed by `serve`; current GraphQL schema does not yet enforce execution blocking from this flag                                                           |
| `--vendor`              | string        | auto-detect                                                       | For `hook`: explicit vendor identifier (`claude-code` or `codex`); when omitted, detected heuristically from payload fields                                |
| `--event-root`          | string (path) | nearest `.divedra-events` next to the workflow root               | Root directory containing external event source and binding configuration                                                                                  |

### Environment Variables

| Variable                          | Required | Default                                                      | Description                                                                                                                                                                                                                                |
| --------------------------------- | -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DIVEDRA_ARTIFACT_ROOT`           | No       | `<scope-root>/artifacts/workflow`                            | Overrides only the workflow artifact tree root (`.../workflow`)                                                                                                                                                                            |
| `DIVEDRA_WORKFLOW_ROOT`           | No       | scoped catalog lookup                                        | Direct default workflow definition root directory; when set, bypasses project/user scope catalog lookup                                                                                                                                     |
| `DIVEDRA_WORKFLOW_SCOPE`          | No       | `auto`                                                       | Default workflow scope selector: `auto`, `project`, or `user`                                                                                                                                                                               |
| `DIVEDRA_USER_ROOT`               | No       | `~/.divedra`                                                 | User scope root; workflows default to `<user-root>/workflows`, logs to `<user-root>/logs`, and runtime data to `<user-root>/artifacts`                                                                                                      |
| `DIVEDRA_PROJECT_ROOT`            | No       | nearest project `.divedra`                                   | Project scope root override; workflows default to `<project-root>/workflows`, logs to `<project-root>/logs`, and runtime data to `<project-root>/artifacts`                                                                                 |
| `DIVEDRA_ADDON_ROOT`              | No       | scoped add-on catalog lookup                                  | Direct default local add-on root; during scoped catalog loading, searched before project/user add-on roots                                                                                                                                   |
| `DIVEDRA_LOG_ROOT`                | No       | `<scope-root>/logs`                                          | Overrides operator-facing process/runtime log output root                                                                                                                                                                                   |
| `DIVEDRA_CONFIG`                  | No       | `$XDG_CONFIG_HOME/divedra/config.json`                       | Bootstrap config path used before user scope root resolution                                                                                                                                                                                |
| `DIVEDRA_SESSION_STORE`           | No       | local file store                                             | Session state backend selector                                                                                                                                                                                                             |
| `DIVEDRA_SERVE_HOST`              | No       | `127.0.0.1`                                                  | Default bind address for `serve`                                                                                                                                                                                                           |
| `DIVEDRA_SERVE_PORT`              | No       | `43173`                                                      | Default listen port for `serve`                                                                                                                                                                                                            |
| `DIVEDRA_ARTIFACT_DIR`            | No       | `<scope-root>/artifacts`                                       | Canonical root data directory override: sessions, `workflow/`, `files/`, `divedra.db`                                                                                                                                                  |
| `DIVEDRA_GRAPHQL_ENDPOINT`        | No       | local serve endpoint                                         | Default GraphQL endpoint for CLI manager/control-plane commands                                                                                                                                                                            |
| `DIVEDRA_MANAGER_AUTH_TOKEN`      | No       | none                                                         | Manager-session auth token for `divedra gql` and GraphQL control-plane mutations                                                                                                                                                           |
| `DIVEDRA_MANAGER_SESSION_ID`      | No       | none                                                         | Ambient manager session id forwarded by `divedra gql` to `/graphql` for manager-scoped requests                                                                                                                                            |
| `DIVEDRA_WORKFLOW_ID`             | No       | none                                                         | Ambient workflow id for divedra-launched backend processes, manager tool environments, and hook event recording                                                                                                                            |
| `DIVEDRA_WORKFLOW_EXECUTION_ID`   | No       | none                                                         | Ambient workflow execution id for divedra-launched backend processes, manager tool environments, and hook event recording                                                                                                                  |
| `DIVEDRA_STEP_ID`                 | No       | none                                                         | Ambient step id for the current step invocation and hook event recording                                                                                                                                                                  |
| `DIVEDRA_NODE_ID`                 | No       | none                                                         | Ambient backing node id for the current step invocation and hook event recording                                                                                                                                                           |
| `DIVEDRA_NODE_EXEC_ID`            | No       | none                                                         | Ambient node execution id for the concrete step invocation and hook event recording                                                                                                                                                        |
| `DIVEDRA_AGENT_BACKEND`           | No       | none                                                         | Ambient backend name for divedra-launched agent processes, such as `codex-agent` or `claude-code-agent`                                                                                                                                    |
| `DIVEDRA_MANAGER_STEP_ID`         | No       | none                                                         | Ambient manager step id for manager tool environments                                                                                                                                                                                      |
| `DIVEDRA_MANAGER_STEP_ID`            | No       | none                                                         | Ambient manager step id for manager tool environments                                                                                                                                                                                      |
| `DIVEDRA_MANAGER_NODE_EXEC_ID`    | No       | none                                                         | Ambient manager node execution id for manager tool environments                                                                                                                                                                            |
| `DIVEDRA_HOOK_RECORDING`          | No       | `auto`                                                       | Hook event recording mode: `auto` records when divedra context is present, `off` disables persistence, and `required` errors when required context is missing                                                                              |
| `DIVEDRA_HOOK_STRICT`             | No       | `false`                                                      | When `true`, hook persistence failures become hook errors; when `false`, recording failures do not block the backend                                                                                                                       |
| `DIVEDRA_HOOK_CAPTURE_RAW`        | No       | `redacted`                                                   | Hook payload artifact mode: `redacted`, `metadata-only`, or `full`                                                                                                                                                                         |
| `DIVEDRA_EVENT_ROOT`              | No       | nearest `.divedra-events` next to workflow root              | Default external event source and binding configuration root                                                                                                                                                                               |
| `DIVEDRA_EVENT_ENDPOINT_BASE_URL` | No       | none                                                         | Public base URL used by webhook/chat providers when registering or displaying callback endpoints                                                                                                                                           |
| `DIVEDRA_EVENTS_HOST`             | No       | `127.0.0.1` for `events serve`                               | Bind address for event listener HTTP routes                                                                                                                                                                                                |
| `DIVEDRA_EVENTS_PORT`             | No       | `43174` for `events serve`                                   | Listen port for event listener HTTP routes                                                                                                                                                                                                 |
| `DIVEDRA_EVENTS_ENABLED`          | No       | `false` for `serve`, `true` for `events serve`               | Enables event listener routes and schedulers                                                                                                                                                                                               |
| `DIVEDRA_EVENTS_READ_ONLY`        | No       | `false`                                                      | Validates and records incoming events without dispatching workflow execution                                                                                                                                                               |

Workflow lookup resolution order:

1. `--workflow-root`
2. `DIVEDRA_WORKFLOW_ROOT`
3. `--scope project|user` / `DIVEDRA_WORKFLOW_SCOPE`
4. project scope `<project-root>/workflows` when scope is `auto` or `project`
5. user scope `<user-root>/workflows` when scope is `auto` or `user`

In `auto` mode, project scope is searched before user scope. If the same name
exists in both scopes, project scope wins for bare workflow names. `--workflow-root`
and `DIVEDRA_WORKFLOW_ROOT` are direct workflow-root overrides and do not use
scope catalog lookup.

Invalid values for `--scope` or `DIVEDRA_WORKFLOW_SCOPE` are usage errors. The
CLI must fail rather than silently treating the value as `auto`.

These CLI behaviors correspond to the current step-addressed runtime in
`src/workflow/`, including jump-driven routing, timeout continuation, scoped
catalog lookup, and engine-owned auto-improve supervision.

Scope root defaults:

1. user scope root: `--user-root`, `DIVEDRA_USER_ROOT`, bootstrap config
   `userRoot`, then `~/.divedra`
2. project scope root: `--project-root`, `DIVEDRA_PROJECT_ROOT`, nearest
   project `.divedra`
3. scope subdirectories: `workflows`, `addons`, `artifacts`, and `logs` unless
   overridden by scope config

Add-on lookup resolution order:

1. built-in runtime catalog for `divedra/*`
2. explicit direct add-on root override from `--addon-root` or
   `DIVEDRA_ADDON_ROOT`, when supplied
3. project scope `<project-root>/addons`, when present
4. user scope `<user-root>/addons`
5. host-provided resolver functions

`--addon-root` and `DIVEDRA_ADDON_ROOT` are direct add-on-root overrides. They
point at a directory containing `<namespace>/<addon-name>/<version>/addon.json`
and do not point at a scope root. For scoped catalog loading they are prepended
to the scoped candidates and do not suppress project/user fallback when the
direct root does not contain the requested `(name, version)`.

Artifact root resolution order:

1. `--artifact-root`
2. `DIVEDRA_ARTIFACT_ROOT`
3. `DIVEDRA_ARTIFACT_DIR/workflow` when `DIVEDRA_ARTIFACT_DIR` is set
4. owning scope default: `<scope-root>/artifacts/workflow`
5. `{resolved DIVEDRA_ARTIFACT_DIR}/workflow` when `DIVEDRA_ARTIFACT_DIR` is set

Runtime-root co-location rule:

1. when `--artifact-root` and/or `--session-store` are supplied, `divedra` infers `rootDataDir` from those explicit roots when they provide an unambiguous parent directory
2. that inferred root keeps `divedra.db` and sibling default roots aligned with the explicit storage tree instead of an unrelated ambient `DIVEDRA_ARTIFACT_DIR`

Session store root resolution order:

1. `--session-store`
2. `DIVEDRA_SESSION_STORE`
3. owning scope default: `<scope-root>/artifacts/sessions`
4. `{resolved DIVEDRA_ARTIFACT_DIR}/sessions` when `DIVEDRA_ARTIFACT_DIR` is set

Log root resolution order:

1. `--log-root`
2. `DIVEDRA_LOG_ROOT`
3. scope config `logSubdir`
4. owning scope default: `<scope-root>/logs`

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

GraphQL is the canonical domain-parameter transport for:

- workflow execution requests,
- communication inspection,
- communication replay/retry,
- manager send/control-plane requests.

- domain parameters should be modeled in GraphQL inputs,
- `divedra gql` is the thin generic GraphQL client surface,
- local-only debug flags such as `--mock-scenario` are not forwarded when a command is executed remotely through GraphQL,
- workflow tooling should use GraphQL rather than parallel REST transports.

The canonical transport is the current GraphQL schema and server implementation
under `src/graphql/` and `src/server/`.

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
