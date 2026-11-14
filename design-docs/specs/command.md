# Command Design

This document defines CLI interfaces for workflow and session management.

## Overview

Commands are designed around JSON workflow lifecycle operations and writing session execution.

## Sections

### Subcommands

- `cli workflow create <name>`
  - Create `<workflow-definition-dir>/<name>/` with `workflow.json`, prompt templates, and default `nodes/node-{id}.json` payload files when a direct definition directory is supplied.
  - In scoped mode, create under `<scope-root>/workflows/<name>/`.
  - Default write scope is project scope when a project `.divedra` exists, otherwise user scope; `--scope project|user` makes the destination explicit.
  - The target starter direction is a `code` manager node by default, with LLM manager authoring retained as experimental.
  - Starter templates use `workflow -> steps[] + nodes[]`, where steps are the execution addresses and `workflow.json.nodes[]` is the reusable node registry.
  - The generated `workflow.json` should contain only authored schema fields from the current model.
  - `--worker-only` switches the starter to a manager-less template whose explicit `entryStepId` points at `main-worker`.
- `cli workflow checkout <url>`
  - Install a workflow bundle from a GitHub directory URL, such as `https://github.com/<owner>/<repo>/tree/<ref>/.divedra/workflows/<workflow-name>`.
  - The command accepts GitHub web directory URLs for `github.com` repositories. The path must resolve to one workflow directory containing `workflow.json`; the installed workflow name is derived from the final remote directory segment and must pass the normal safe workflow-name rule.
  - Checkout is a scoped write command. The default destination is project scope: `<project-root>/.divedra/workflows/<workflow-name>`. If no project scope is discovered, the command creates `<cwd>/.divedra/workflows/<workflow-name>` rather than falling back to user scope. `--user-scope` writes to `<user-root>/workflows/<workflow-name>`.
  - Checkout does not use `--workflow-definition-dir` as a write destination. Combining `workflow checkout` with `--workflow-definition-dir` is a usage error because checkout registry metadata is scoped by project/user destination.
  - The remote bundle must be fetched into a temporary staging directory first, then loaded and validated through the same workflow bundle validation path as `workflow validate`. Invalid JSON, missing `workflow.json`, invalid step/node references, missing referenced workflow-local prompt files, unsupported authored fields, or unsafe workflow-local file paths fail before the destination directory is created or modified.
  - The recursive download preserves all tracked files below the selected GitHub directory so workflow-local prompt, script, and supporting files remain available after install. Git metadata and files outside the selected directory are not installed.
  - Duplicate checkout is rejected by default when either the destination workflow directory exists or the matching checkout registry record exists. `--overwrite` keeps the existing destination untouched until the staged remote bundle validates, then removes only the resolved destination directory under the selected workflow root and installs the staged bundle.
  - On success, write checkout registry metadata under `<user-root>/workflow-registry/checkouts/<scope>-<workflow-name>.json`. The JSON record includes at least `workflowName`, `sourceUrl`, `scope` (`project` or `user`), `checkedOutAt`, and `destinationDirectory`.
  - Text output should identify the installed workflow name, destination scope, destination directory, and registry record path. `--output json` should emit the same fields plus validation status.
- `cli workflow validate <name>`
  - Validate `<workflow-definition-dir>/<name>/` structure and semantic constraints when a direct definition directory is supplied.
  - Scoped catalog output includes the resolved workflow `source` scope and workflow directory so project/user shadowing is visible.
  - `--node-patch <value>` applies a non-persistent node settings patch before validation. The value follows the same input convention as `workflow run --variables`: inline JSON object, explicit `@path/to/patch.json`, or an existing file path.
  - Node patches are keyed by reusable workflow node id, not step id. Patch object values may contain only `executionBackend`, `model`, and `effort`; unknown node ids, malformed JSON, arrays/scalars, and any other fields are validation errors.
  - Validation must run against the patched in-memory workflow state, including `--executable` node preflight, without writing changes back to `workflow.json` or `nodes/node-*.json`.
  - By default, validation is structural/passive and does not spawn agent CLIs
    or probe model reachability.
  - `--executable` enables active node executability preflight and reports
    `NodeValidationResult` records for node payloads, add-ons, and backend
    adapters including `codex-agent`, `claude-code-agent`, and
    `cursor-cli-agent`.
  - `--output json` includes `nodeValidationResults`; text output summarizes
    invalid and warning node results after ordinary validation issues.
  - JSON validation output for both direct-directory and scoped-catalog loaded
    workflows must preserve add-on `validate` hook `nodeValidationResults`
    from detailed workflow validation before adding any active backend preflight
    results.
- `cli workflow list`
  - List catalog-visible workflows for human inspection without entering the TUI.
  - Show only compact overview data: workflow name, resolved source scope, description, aggregate workflow status, active execution count, and latest run summary.
  - Duplicate names from different scopes must remain distinct rows rather than being silently collapsed.
  - In direct `--workflow-definition-dir` mode, list only workflows in that definition directory and label their source scope as `direct`.
  - Supports `--status running|paused|completed|failed|cancelled|never-run`, `--limit <n>`, and `--output table|json`. Default `--output text` renders the same compact table as `--output table` on this command; other commands stay `text` vs `json` only.
- `cli workflow inspect <name>`
  - Print workflow structure, including canonical execution units (`steps`), jump graph, timeout defaults, and reusable node references.
  - Scoped catalog output includes the resolved workflow `source` scope and workflow directory.
  - `--structure` switches text output to a compact human-facing workflow structure view on the existing inspect surface instead of adding a duplicate command. This mode prints only each canonical step id and its description. Each step id is rendered on its own line at the derived structure indentation, and its description is rendered on the following line one compact indent unit deeper.
  - Compact structure mode should use step-addressed workflow order as the primary row order. Indentation should reuse the same derived visualization semantics used by workflow visualization/status surfaces, including loop-scope indentation when derivable. Linear workflows and graph shapes without a known nesting scope remain at base indentation rather than inventing hierarchy.
  - Compact structure mode must omit roles, runtime readiness, node registry ids, add-on sources, callable contracts, variable examples, transition labels, and timeout/default details. Missing or empty descriptions render as `-` on the indented description line so every logical step row keeps the same two-line `id` then `description` shape.
  - Non-json compact structure mode should derive and render rows directly from the loaded workflow bundle after load/validation succeeds. It must not require the full inspection summary or runtime readiness probes, because those surfaces are intentionally omitted from compact text output.
  - `--structure` is text-only. `--output json` remains the full machine-readable inspection summary and must not be reduced to the compact structure view. Default text inspect output also remains on the full inspection summary path.
  - When the derived callable step has an authored `input` contract, text output should also show concrete `workflow run --variables` examples so an operator can copy either inline JSON or file-based invocation without switching to `workflow usage`.
  - The examples should include inline JSON object input, explicit `@./variables.json`, and the historical bare file path form. Inline examples may be schema-shaped best-effort samples, but they are guidance only; execution still validates that `--variables` is a JSON object and does not treat the callable schema as an enforcement gate in this slice.
  - `--output json` must retain the full `callable.input` object, including nested `jsonSchema`, without stringifying or truncating it for display.
- `cli workflow usage [name]`
  - List AI-facing workflow purpose, compact step overview, and callable contract metadata without verbose structural detail.
  - Output includes workflow description, step summaries, plus the callable step's input/output contract derived from `managerStepId ?? entryStepId`.
  - Usage output may describe `--variables`, but `workflow inspect` remains the operator-facing place for concrete copyable run examples tied to a single workflow.
  - `workflow usage` lists all visible workflows; `workflow usage <name>` resolves one workflow through normal scope rules.
  - Initial slice is local-only and rejects `--endpoint`.
- `cli workflow status <name>`
  - Show the selected workflow's compact human-facing status overview rather than raw execution detail.
  - Output includes the resolved source scope, workflow directory, aggregate workflow status, active execution count, latest execution summary, and recent execution summaries.
  - Any execution reported as active (`running` or `paused`) must be loadable by `session status <workflow-execution-id>`, `session progress <workflow-execution-id>`, and `session step-runs <workflow-execution-id>` under the same runtime storage context. `workflow status` must not report stale active rows that exist only in a derived runtime database snapshot, cached overview record, or mismatched storage root.
  - If a non-terminal candidate fails direct `session status` loadability with the same `--workflow-definition-dir` and storage options, it must be excluded from `activeExecutionCount`, `newestActiveExecution`, active recent rows, and aggregate `running` or `paused` derivation.
  - Local status resolution and local session commands must share the same session-store context rules: explicit storage overrides first, then scoped project/user runtime data roots, then direct-root inference only when a direct workflow root is under a recognized scope root.
  - Bare names resolve project scope before user scope in `auto`; use `--scope project|user` to inspect a shadowed workflow explicitly.
  - In direct `--workflow-definition-dir` mode, resolve only within that definition directory and label the source scope as `direct`.
  - Supports `--limit <n>` and `--output table|json`; default `--output text` matches `--output table` for this command (compact human lines).
  - Detailed execution inspection remains on `session status`, `session progress`, and GraphQL detail queries.
- `cli workflow run <name>`
  - Execute `<workflow-definition-dir>/<name>/workflow.json` and all referenced workflow-local node payload files when a direct definition directory is supplied.
  - Without a direct `--workflow-definition-dir`, resolve `<name>` from the scoped workflow catalog: project scope first, then user scope.
  - Local run output includes the resolved workflow `source` scope and workflow directory before execution/session details.
  - `--variables <value>` supplies workflow runtime variables. The value may be an inline JSON object such as `{"hours":48}`, an existing file path such as `./vars.json`, or an explicit file reference such as `@./vars.json`.
  - Inline JSON for `workflow run --variables` is parsed only when the supplied value is syntactically a JSON object. Existing file path usage remains valid, including paths that do not start with `@`.
  - Runtime variables must parse to a JSON object; arrays, scalars, malformed inline JSON, unreadable files, and files containing non-object JSON fail before workflow execution or remote GraphQL dispatch.
  - `--node-patch <value>` supplies the same node patch format accepted by `workflow validate`. Local and endpoint-backed runs must validate the patched state before execution, then execute with the patched node settings only for that run.
  - Patch application is non-persistent and must not update workflow bundle files. Patch keys remain node ids, so every step that references the patched reusable node observes the same patched backend/model/effort during the run.
  - Accepts `--working-dir` / `--working-directory` to override the workflow execution working directory for that run.
  - `--verbose` / `-v` prints local step-start progress to stderr as steps begin. The workflow runner emits typed workflow-run events to an in-process event sink, and the supervisor-owned progress renderer consumes those events for display. This keeps `--output json` stdout parseable while giving operators immediate progress visibility for long local runs.
  - `--debug` enables explicit local debug progress callbacks for workflow internals. Normal and verbose runs should not rely on runner-internal logging for user-visible progress.
  - Target default: `workflow run` runs the target workflow under deterministic in-process runner-pool supervision by default. The runner pool is represented by the default supervisor workflow identity and starts/tracks/cancels/resumes/reruns the target workflow asynchronously in the same process.
  - `--auto-improve` remains accepted for explicit remediation policy. `--no-auto-improve` disables workflow patching by setting the patch budget to zero, but it must not remove deterministic lifecycle supervision or stall/failure retry.
  - Optional nested / LLM-backed supervision: `--nested-superviser` or `--nested-supervisor` runs `superviserWorkflowId` as a paired nested superviser workflow while keeping the same operator-visible policy and audit surfaces. LLM command resolution remains explicit through supervisor/event configuration.
  - When `--endpoint` is used, the GraphQL execution transport must forward the same supervision policy surface as the local engine path; remote execution must not silently drop `--auto-improve`, `--no-auto-improve`, or nested-driver flags (`--nested-superviser` / `--nested-supervisor`). Remote `workflow run --no-auto-improve` must send an enabled supervision policy with `maxWorkflowPatches: 0`.
  - Local, endpoint-backed, GraphQL, and library start helpers must apply the same default-supervised decision. If no explicit `--auto-improve` policy is supplied, the effective start is supervisor-backed; if `--no-auto-improve` is present, the effective start is still supervisor-backed but lifecycle-only.
- `session progress <session-id>`
  - Show queue, execution counts, and per-step restart/execution summary.
  - For a session id reported by `workflow status` as active in the same storage context, this command must load the session instead of returning `session not found`.
- `session status <session-id>`
  - Show the persisted workflow-session snapshot.
  - This command is the minimum loadability check for active execution ids surfaced by workflow overview/status commands.
- `session step-runs <session-id>`
  - Show merged step-run history for the workflow execution.
  - For a session id reported by `workflow status` as active in the same storage context, this command must resolve the owning session before listing merged rows.
- `session inbox <session-id>`
  - Planned operator/runner-pool inspection surface for mailbox input/output artifacts associated with the active execution. Event-source supervisor commands use this or equivalent artifact inspection to answer inbox requests without invoking target workflow code.
- `session logs <session-id>`
  - Show runtime node logs for the session; supports runner-pool event replies and operator debugging.
- `session export <session-id>`
  - Export a workflow run payload including session state, node executions, runtime logs, hook events, and artifact references.
- `session resume <session-id>`
  - Continue an interrupted session from persisted state.
  - Accepts `--working-dir` / `--working-directory` to override the execution working directory used for resumed step execution.
  - The same supervision policy surface (`--auto-improve`, optional `--nested-superviser` / `--nested-supervisor`) must work through both local and `--endpoint` GraphQL execution paths.
- `session rerun <session-id> <step-id>`
  - Start a new run from a chosen step in an existing session.
  - Accepts `--working-dir` / `--working-directory` to override the workflow execution working directory for the rerun.
  - Step ids are the only supported rerun target on active command/control surfaces; do not add node-id aliases to new APIs.
  - `--nested-superviser` is not a valid rerun flag; nested supervision is meaningful only for supervised start/resume flows.
- `session continue <source-workflow-execution-id> --start-step <step-id> --after-step-run <step-run-id>`
  - Planned history-linked continuation mode. Starts a new workflow execution from `startStepId` while importing source history through one concrete prior step run.
  - `after-step-run` is resolved against the merged step-run timeline visible from the source workflow execution, so the chosen anchor may belong to imported ancestry rather than only the source run's local rows.
- `call-step <workflow-id> <workflow-run-id> <step-id>`
  - Execute one step directly against an existing run context for local debugging.
  - The same call contract is the target runtime primitive for cross-workflow invocation; calling another workflow means targeting that workflow's callable entry step through `call-step` semantics rather than through an authored top-level `workflow.workflowCalls` array (validation rejects that field).
  - Support explicit continuation controls such as prompt variant selection, backend-session reuse, and timeout override so the same reusable node can be revisited through a different step for flows such as self-review and timeout recovery.
  - New API work should follow the same rule: step-addressed direct execution only, with no additive `call-node`-style aliases. The legacy `call-node` command/library surface is removed rather than retained as a compatibility synonym.
- `graphql <graphql-document>`
  - Execute a GraphQL query or mutation against the canonical control-plane endpoint.
  - Manager-node LLM/tool use should call GraphQL mutations such as `sendManagerMessage` through this command rather than dedicated domain subcommands.
  - When `DIVEDRA_MANAGER_SESSION_ID` is present, the CLI forwards it to `/graphql` with `X-Divedra-Manager-Session-Id` so manager-scoped mutations do not need to repeat it in GraphQL variables.
  - Without `--endpoint`, executes in-process against local project-scoped workflow/session storage. `--endpoint` or `DIVEDRA_GRAPHQL_ENDPOINT` selects remote HTTP transport.
- `serve [workflow-name]`
  - Start the local HTTP control plane.
  - If `workflow-name` is provided, workflow-definition access is constrained to that workflow.
  - Exposes `/graphql` for workflow-definition, execution, communication, and manager-control operations.
  - Human-facing browser mode should default to the overview-only workflow list and selected-workflow status surface described in `design-workflow-overview-status-surface.md`, not to node-level debugging detail.
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
  - Start cron, webhook, Matrix, chat, and web-chat event listeners.
  - In local command-dispatch mode, starts workflow execution through `divedra workflow run` with a generated mapped-input JSON file.
  - In local library mode, invokes the library workflow execution client in-process.
  - With `--endpoint`, dispatches workflow execution through GraphQL and can run as a lightweight listener process.
  - For bindings configured with `execution.mode = "supervised"`, dispatches events to the workflow supervisor control path so the same event source conversation can start, stop, restart, and inspect the active workflow.
  - In deterministic supervisor mode, the local control path persists an async command/run record and applies workflow reference, start, status, progress, inbox/read, logs, export, stop/cancel, restart/rerun, and input/submit/resume operations through the in-process runner pool.
- `events list [--source <id>] [--status <status>] [--limit <n>]`
  - Inspect persisted event receipt records.
- `events replay <receipt-id> [--dry-run] [--reason <text>]`
  - Re-run mapping and dispatch for a persisted normalized event receipt using replay-specific event and dedupe identifiers.
  - `--dry-run` forwards the replay through workflow execution dry-run behavior.
  - `--reason` records operator intent in the replay receipt raw artifact.
  - Local event dispatch commands accept `--mock-scenario <path>` and reject combining it with `--endpoint`.

### Flags and Options

| Flag                                              | Type          | Default                                             | Description                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--worker-only`                                   | boolean       | `false`                                             | For `workflow create`: scaffold a manager-less starter whose explicit `entryStepId` is `main-worker`                                                                                                                      |
| `--user-scope`                                    | boolean       | `false`                                             | For `workflow checkout`: install into the resolved user scope workflow root instead of the default project scope destination                                                                                               |
| `--overwrite`                                     | boolean       | `false`                                             | For `workflow checkout`: after staged remote validation succeeds, remove the existing destination workflow directory and replace its checkout registry record                                                               |
| `--structure`                                     | boolean       | `false`                                             | For `workflow inspect`: render a compact indented text structure with each step id on its own line and the description on the next line one indent deeper                                                                 |
| `--executable`                                    | boolean       | `false`                                             | For `workflow validate`: run active node executability preflight and include `NodeValidationResult` records for nodes, add-ons, and backend adapters                                                                       |
| `--variables`                                     | string        | none                                                | For `workflow run`: runtime variables as inline JSON object, existing file path, or `@path/to/variables.json`; for `divedra graphql`: inline GraphQL variables JSON or `@path/to/variables.json`                          |
| `--node-patch`                                    | string        | none                                                | For `workflow validate` and `workflow run`: non-persistent node settings patch as inline JSON object, existing file path, or `@path/to/patch.json`; patch keys are node ids and values allow only `executionBackend`, `model`, and `effort` |
| `--workflow-definition-dir`                       | string (path) | scoped catalog lookup                               | Direct directory containing `<workflow-name>/workflow.json` definition bundles; when supplied, bypasses project/user scope catalog lookup and does not control logs, sessions, or artifacts                               |
| `--scope`                                         | string        | `auto`                                              | Workflow scope selector for read/write commands: `auto`, `project`, or `user`                                                                                                                                             |
| `--status`                                        | string        | none                                                | For overview/list commands: filter by aggregate status (`running`, `paused`, `completed`, `failed`, `cancelled`, or `never-run`)                                                                                          |
| `--limit`                                         | number        | command-specific                                    | Limit compact list output, such as workflow rows for `workflow list` or recent executions for `workflow status`                                                                                                           |
| `--stall-timeout-ms`                              | number        | workflow/default policy                             | For `auto improve mode`: threshold used to mark no-progress evidence as stalled; overrides `workflow.defaults.supervision.stallTimeoutMs`; must be greater than or equal to `--monitor-interval-ms`                       |
| `--user-root`                                     | string (path) | `~/.divedra`                                        | User scope root; workflows are read from `<user-root>/workflows` unless `--workflow-definition-dir` is supplied                                                                                                           |
| `--project-root`                                  | string (path) | nearest project `.divedra`                          | Project scope root; workflows are read from `<project-root>/workflows` unless `--workflow-definition-dir` is supplied                                                                                                     |
| `--addon-root`                                    | string (path) | scoped add-on catalog lookup                        | Direct root directory containing local add-ons; during scoped catalog loading, searched before project/user add-on roots                                                                                                  |
| `--artifact-root`                                 | string (path) | resolved runtime data root + `/workflow`            | Root directory for execution artifacts                                                                                                                                                                                    |
| `--session-store`                                 | string (path) | resolved runtime data root + `/sessions`            | Root directory for persisted workflow sessions                                                                                                                                                                            |
| `--log-root`                                      | string (path) | `<scope-root>/logs`                                 | Root directory for operator-facing process logs and exported runtime logs                                                                                                                                                 |
| `--config`                                        | string (path) | `$XDG_CONFIG_HOME/divedra/config.json`              | Bootstrap config path used to resolve user/project scope roots                                                                                                                                                            |
| `--working-dir`                                   | string (path) | command invocation `cwd`                            | Workflow execution working directory override; relative values resolve from the command invocation directory                                                                                                              |
| `--mock-scenario`                                 | string (path) | none                                                | Deterministic node-output fixture map for local execution/testing paths                                                                                                                                                   |
| `--max-steps`                                     | number        | none                                                | Hard cap on step executions per run                                                                                                                                                                                       |
| `--default-timeout-ms`                            | number        | none                                                | Override default node timeout for this run                                                                                                                                                                                |
| `--verbose` / `-v`                                | boolean       | `false`                                             | For local workflow run/resume/rerun: render supervisor-owned step-start progress from typed workflow-run events without changing stdout output                                                                            |
| `--debug`                                         | boolean       | `false`                                             | For local workflow run debugging: enable explicit runner progress callbacks; ordinary verbose progress remains event-sink driven                                                                                          |
| `--auto-improve`                                  | boolean       | `false` for remediation                             | For `workflow run`: explicitly enable auto-improve remediation/patching policy on top of default deterministic lifecycle supervision. Omitted `--auto-improve` still keeps deterministic runner-pool supervision enabled. |
| `--no-auto-improve`                               | boolean       | `false`                                             | For `workflow run`: keep deterministic supervisor-backed lifecycle management but disable workflow patching by using `maxWorkflowPatches: 0`.                                                                             |
| `--superviser-workflow` / `--supervisor-workflow` | string        | built-in default superviser workflow id             | Workflow id for nested superviser execution when `--nested-superviser` or `--nested-supervisor` is enabled; persisted on supervision state as `superviserWorkflowId`                                                      |
| `--monitor-interval-ms`                           | number        | workflow/default policy                             | For `auto improve mode`: control supervision polling / observation cadence; overrides `workflow.defaults.supervision.monitorIntervalMs`                                                                                   |
| `--max-supervised-attempts`                       | number        | none                                                | For `auto improve mode`: cap total supervised target workflow attempts                                                                                                                                                    |
| `--max-workflow-patches`                          | number        | none                                                | For `auto improve mode`: cap automatic workflow-definition patch attempts                                                                                                                                                 |
| `--workflow-mutation-mode`                        | string        | `execution-copy`                                    | For `auto improve mode`: choose whether workflow repairs apply to an execution-scoped copy or in-place on the canonical bundle                                                                                            |
| `--no-allow-targeted-rerun`                       | boolean       | `false`                                             | For `auto improve mode`: when set, disable rerun from a selected step. Deprecated alias: `--disable-targeted-rerun`.                                                                                                      |
| `--timeout-ms`                                    | number        | none                                                | For targeted `call-step` / continuation flows: override timeout for that invocation                                                                                                                                       |
| `--prompt-variant`                                | string        | none                                                | For targeted `call-step` / continuation flows: select a named prompt variant on the step's resolved reusable node payload                                                                                                 |
| `--continue-session`                              | boolean       | `false`                                             | For targeted `call-step` / continuation flows: request backend-session reuse when the resolved node and backend support it                                                                                                |
| `--resume-step-exec`                              | string        | none                                                | For targeted `call-step` / continuation flows: prior execution record id (`nodeExecId` in session state to continue from)                                                                                                 |
| `--output`                                        | string        | `text`                                              | Output format (`text` or `json`) for CLI-rendered GraphQL results                                                                                                                                                         |
| `--dry-run`                                       | boolean       | `false`                                             | Validate and simulate transitions without agent execution                                                                                                                                                                 |
| `--endpoint`                                      | string        | local serve endpoint                                | GraphQL endpoint used by CLI commands                                                                                                                                                                                     |
| `--auth-token`                                    | string        | none                                                | Explicit auth token for GraphQL manager/control-plane requests                                                                                                                                                            |
| `--auth-token-env`                                | string        | `DIVEDRA_MANAGER_AUTH_TOKEN`                        | Environment variable used to resolve GraphQL auth token                                                                                                                                                                   |
| `--message-json`                                  | string        | none                                                | Inline JSON payload for `call-step`                                                                                                                                                                                       |
| `--message-file`                                  | string (path) | none                                                | JSON payload file for `call-step`                                                                                                                                                                                         |
| `--file`                                          | string (path) | none                                                | Output file path for `export`; when omitted, the export JSON is written to stdout                                                                                                                                         |
| `--host`                                          | string        | `127.0.0.1`                                         | Bind address for `serve`                                                                                                                                                                                                  |
| `--port`                                          | number        | `43173`                                             | Listen port for `serve`                                                                                                                                                                                                   |
| `--read-only`                                     | boolean       | `false`                                             | Disable write/update operations in `serve` mode                                                                                                                                                                           |
| `--no-exec`                                       | boolean       | `false`                                             | Parsed by `serve`; current GraphQL schema does not yet enforce execution blocking from this flag                                                                                                                          |
| `--vendor`                                        | string        | auto-detect                                         | For `hook`: explicit vendor identifier (`claude-code` or `codex`); when omitted, detected heuristically from payload fields                                                                                               |
| `--event-root`                                    | string (path) | nearest `.divedra-events` next to the workflow root | Root directory containing external event source and binding configuration                                                                                                                                                 |

### Environment Variables

| Variable                          | Required        | Default                                         | Description                                                                                                                                                   |
| --------------------------------- | --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DIVEDRA_ARTIFACT_ROOT`           | No              | resolved runtime data root + `/workflow`        | Overrides only the workflow artifact tree root (`.../workflow`)                                                                                               |
| `DIVEDRA_WORKFLOW_DEFINITION_DIR` | No              | scoped catalog lookup                           | Direct default workflow definition directory; when set, bypasses project/user scope catalog lookup and does not control runtime logs, sessions, or artifacts  |
| `DIVEDRA_WORKFLOW_SCOPE`          | No              | `auto`                                          | Default workflow scope selector: `auto`, `project`, or `user`                                                                                                 |
| `DIVEDRA_USER_ROOT`               | No              | `~/.divedra`                                    | User scope root; workflows default to `<user-root>/workflows`, logs to `<user-root>/logs`, and runtime data to `<user-root>/artifacts`                        |
| `DIVEDRA_PROJECT_ROOT`            | No              | nearest project `.divedra`                      | Project scope root override; workflows default to `<project-root>/workflows`, logs to `<project-root>/logs`, and runtime data to `<project-root>/artifacts`   |
| `DIVEDRA_ADDON_ROOT`              | No              | scoped add-on catalog lookup                    | Direct default local add-on root; during scoped catalog loading, searched before project/user add-on roots                                                    |
| `DIVEDRA_LOG_ROOT`                | No              | `<scope-root>/logs`                             | Overrides operator-facing process/runtime log output root                                                                                                     |
| `DIVEDRA_CONFIG`                  | No              | `$XDG_CONFIG_HOME/divedra/config.json`          | Bootstrap config path used before user scope root resolution                                                                                                  |
| `DIVEDRA_SESSION_STORE`           | No              | local file store                                | Session state backend selector                                                                                                                                |
| `DIVEDRA_SERVE_HOST`              | No              | `127.0.0.1`                                     | Default bind address for `serve`                                                                                                                              |
| `DIVEDRA_SERVE_PORT`              | No              | `43173`                                         | Default listen port for `serve`                                                                                                                               |
| `DIVEDRA_ARTIFACT_DIR`            | No              | owning scope artifacts root or user artifacts   | Canonical root data directory override: sessions, `workflow/`, `files/`, `divedra.db`                                                                         |
| `DIVEDRA_GRAPHQL_ENDPOINT`        | No              | local serve endpoint                            | Default GraphQL endpoint for CLI manager/control-plane commands                                                                                               |
| `DIVEDRA_MANAGER_AUTH_TOKEN`      | No              | none                                            | Manager-session auth token for `divedra graphql` and GraphQL control-plane mutations                                                                          |
| `DIVEDRA_MANAGER_SESSION_ID`      | No              | none                                            | Ambient manager session id forwarded by `divedra graphql` to `/graphql` for manager-scoped requests                                                           |
| `DIVEDRA_WORKFLOW_ID`             | No              | none                                            | Ambient workflow id for divedra-launched backend processes, manager tool environments, and hook event recording                                               |
| `DIVEDRA_WORKFLOW_EXECUTION_ID`   | No              | none                                            | Ambient workflow execution id for divedra-launched backend processes, manager tool environments, and hook event recording                                     |
| `DIVEDRA_STEP_ID`                 | No              | none                                            | Ambient step id for the current step invocation and hook event recording                                                                                      |
| `DIVEDRA_NODE_ID`                 | No              | none                                            | Ambient backing node id for the current step invocation and hook event recording                                                                              |
| `DIVEDRA_NODE_EXEC_ID`            | No              | none                                            | Ambient node execution id for the concrete step invocation and hook event recording                                                                           |
| `DIVEDRA_AGENT_BACKEND`           | No              | none                                            | Ambient backend name for divedra-launched agent processes, such as `codex-agent` or `claude-code-agent`                                                       |
| `DIVEDRA_MANAGER_STEP_ID`         | No              | none                                            | Ambient manager step id for manager tool environments                                                                                                         |
| `DIVEDRA_MANAGER_NODE_EXEC_ID`    | No              | none                                            | Ambient manager node execution id for manager tool environments                                                                                               |
| `DIVEDRA_HOOK_RECORDING`          | No              | `auto`                                          | Hook event recording mode: `auto` records when divedra context is present, `off` disables persistence, and `required` errors when required context is missing |
| `DIVEDRA_HOOK_STRICT`             | No              | `false`                                         | When `true`, hook persistence failures become hook errors; when `false`, recording failures do not block the backend                                          |
| `DIVEDRA_HOOK_CAPTURE_RAW`        | No              | `redacted`                                      | Hook payload artifact mode: `redacted`, `metadata-only`, or `full`                                                                                            |
| `DIVEDRA_EVENT_ROOT`              | No              | nearest `.divedra-events` next to workflow root | Default external event source and binding configuration root                                                                                                  |
| `DIVEDRA_EVENT_ENDPOINT_BASE_URL` | No              | none                                            | Public base URL used by webhook/chat providers when registering or displaying callback endpoints                                                              |
| `DIVEDRA_EVENTS_HOST`             | No              | `127.0.0.1` for `events serve`                  | Bind address for event listener HTTP routes                                                                                                                   |
| `DIVEDRA_EVENTS_PORT`             | No              | `43174` for `events serve`                      | Listen port for event listener HTTP routes                                                                                                                    |
| `DIVEDRA_EVENTS_ENABLED`          | No              | `false` for `serve`, `true` for `events serve`  | Enables event listener routes and schedulers                                                                                                                  |
| `DIVEDRA_EVENTS_READ_ONLY`        | No              | `false`                                         | Validates and records incoming events without dispatching workflow execution                                                                                  |
| `DIVEDRA_MATRIX_HOMESERVER_URL`   | Source-specific | none                                            | Example Matrix homeserver URL env var referenced by `kind: "matrix"` source config; operators may choose another env var name per source                      |
| `DIVEDRA_MATRIX_ACCESS_TOKEN`     | Source-specific | none                                            | Example Matrix bot access token env var referenced by `kind: "matrix"` source config; token values must not appear in authored config or runtime artifacts    |

Workflow lookup resolution order:

1. `--workflow-definition-dir`
2. `DIVEDRA_WORKFLOW_DEFINITION_DIR`
3. `--scope project|user` / `DIVEDRA_WORKFLOW_SCOPE`
4. project scope `<project-root>/workflows` when scope is `auto` or `project`
5. user scope `<user-root>/workflows` when scope is `auto` or `user`

In `auto` mode, project scope is searched before user scope. If the same name
exists in both scopes, project scope wins for bare workflow names.
`--workflow-definition-dir` and `DIVEDRA_WORKFLOW_DEFINITION_DIR` are direct
workflow definition directory overrides and do not use scope catalog lookup.

Invalid values for `--scope` or `DIVEDRA_WORKFLOW_SCOPE` are usage errors. The
CLI must fail rather than silently treating the value as `auto`.

These CLI behaviors correspond to the current step-addressed runtime in
`src/workflow/`, including jump-driven routing, timeout continuation, scoped
catalog lookup, and engine-owned auto-improve supervision.

The supervised event control direction is tracked separately in
`design-docs/specs/design-event-supervisor-control.md`. That design adds a
workflow-supervisor-backed path for event sources without changing the default
direct trigger behavior.

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
5. non-scoped default: `<user-root>/artifacts/workflow`

Runtime-root co-location rule:

1. when `--artifact-root` and/or `--session-store` are supplied, `divedra` infers `rootDataDir` from those explicit roots when they provide an unambiguous parent directory
2. that inferred root keeps `divedra.db` and sibling default roots aligned with the explicit storage tree instead of an unrelated ambient `DIVEDRA_ARTIFACT_DIR`

Session store root resolution order:

1. `--session-store`
2. `DIVEDRA_SESSION_STORE`
3. `DIVEDRA_ARTIFACT_DIR/sessions` when `DIVEDRA_ARTIFACT_DIR` is set
4. owning scope default: `<scope-root>/artifacts/sessions`
5. non-scoped default: `<user-root>/artifacts/sessions`

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
- workflow overview summary queries,
- communication inspection,
- communication replay/retry,
- manager send/control-plane requests.

- domain parameters should be modeled in GraphQL inputs,
- `divedra graphql` is the thin generic GraphQL client surface,
- local-only debug flags such as `--mock-scenario` are not forwarded when a command is executed remotely through GraphQL,
- `workflow list` and `workflow status` should consume compact overview summary queries rather than low-level node, communication, hook-event, or log detail queries,
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
