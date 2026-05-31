# Command Design

This document defines CLI interfaces for workflow and session management.

## Overview

Commands are designed around JSON workflow lifecycle operations and writing session execution.

### Product Rename Command Surface

The primary command after the product rename is `rielflow`. Human-facing help,
errors, examples, shell snippets, generated hook snippets, workflow prompts,
release packaging scripts, package metadata, and documentation should present
`Rielflow` as the product and `rielflow` as the executable/repository/package
identifier.

Backward compatibility for the historical `rielflow` command is an explicit
product decision, not an implicit requirement of the rename. If compatibility is
retained, `rielflow` should be implemented as a thin alias that dispatches to
the same command handlers, reports deprecation consistently in text output, and
keeps JSON output parseable. If compatibility is not retained, all scripts,
workflow bundles, docs, examples, package bins, and release assets must switch
to `rielflow` with no dangling command references except historical notes.

Command examples and generated snippets should be updated as follows:

- `rielflow workflow ...` for lifecycle operations
- `rielflow session ...` for execution inspection and continuation
- `rielflow graphql ...` for manager/control-plane requests
- `rielflow serve`, `rielflow hook`, and `rielflow events ...` for server,
  backend hook, and event-source surfaces

Verification for this command-surface rename should include command help smoke
checks, JSON-output smoke checks where available, and a targeted repository
search proving that retained `rielflow` command strings are documented
compatibility or historical references rather than missed primary examples.

## Sections

### Subcommands

- `workflow create <name>`
  - Create `<workflow-definition-dir>/<name>/` with `workflow.json`, prompt templates, and default `nodes/node-{id}.json` payload files when a direct definition directory is supplied.
  - In scoped mode, create under `<scope-root>/workflows/<name>/`.
  - Default write scope is project scope when a project `.rielflow` exists, otherwise user scope; `--scope project|user` makes the destination explicit.
  - The target starter direction is a `code` manager node by default, with LLM manager authoring retained as experimental.
  - Starter templates use `workflow -> steps[] + nodes[]`, where steps are the execution addresses and `workflow.json.nodes[]` is the reusable node registry.
  - The generated `workflow.json` should contain only authored schema fields from the current model.
  - `--worker-only` switches the starter to a manager-less template whose explicit `entryStepId` points at `main-worker`.
- `workflow checkout <url>`
  - Install a workflow bundle from a GitHub directory URL, such as `https://github.com/<owner>/<repo>/tree/<ref>/.rielflow/workflows/<workflow-name>`.
  - Registry package installation is not exposed through workflow checkout. Use `package install <package-id>` for persistent package installs.
  - The command accepts GitHub web directory URLs for `github.com` repositories. The path must resolve to one workflow directory containing `workflow.json`; the installed workflow name is derived from the final remote directory segment and must pass the normal safe workflow-name rule.
  - Checkout is a scoped write command. The default destination is project scope: `<project-root>/.rielflow/workflows/<workflow-name>`. If no project scope is discovered, the command creates `<cwd>/.rielflow/workflows/<workflow-name>` rather than falling back to user scope. `--user-scope` writes to `<user-root>/workflows/<workflow-name>`.
  - `--workflow-definition-dir` installs directly under the supplied workflow definition directory instead of the project/user scope workflow root. Checkout registry metadata is still written under the resolved user root.
  - The remote bundle must be fetched into a temporary staging directory first, then loaded and validated through the same workflow bundle validation path as `workflow validate`. Invalid JSON, missing `workflow.json`, invalid step/node references, missing referenced workflow-local prompt files, unsupported authored fields, or unsafe workflow-local file paths fail before the destination directory is created or modified.
  - Package install may run an optional pre-install security check before install. `--pre-install-check` enables the built-in static scanner; `--pre-install-check-mode warn|reject` controls enforcement; `--pre-install-check-container docker|podman|auto` requests an additional no-network container check. Blocking findings in reject mode fail before destination writes or checkout registry updates.
  - The recursive download preserves all tracked files below the selected GitHub directory so workflow-local prompt, script, and supporting files remain available after install. Git metadata and files outside the selected directory are not installed.
  - Duplicate checkout is rejected by default when either the destination workflow directory exists or the matching checkout registry record exists. `--overwrite` keeps the existing destination untouched until the staged remote bundle validates, then removes only the resolved destination directory under the selected workflow root and installs the staged bundle.
  - On success, write checkout registry metadata under `<user-root>/workflow-registry/checkouts/<scope>-<workflow-name>.json`. The JSON record includes at least `workflowName`, `sourceUrl`, `scope` (`project` or `user`), `checkedOutAt`, and `destinationDirectory`.
  - Text output should identify the installed workflow name, destination scope, destination directory, and registry record path. `--output json` should emit the same fields plus validation status.
- `workflow validate <name>`
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
- `workflow manifest validate [<manifest-path>]`
  - Validate a workflow allowlist manifest without starting `rielflow serve`.
  - The manifest path can come from the positional argument,
    `--workflow-manifest`, or `RIEL_WORKFLOW_MANIFEST`; the positional
    argument is preferred when supplied.
  - The command checks manifest shape, path-object rules, duplicate manifest id
    and duplicate source/cwd constraints, manifest path resolution, and every
    referenced workflow bundle.
  - Relative `workflowDirectory` and `cwd` path fields resolve from the command
    invocation directory by default. `RIEL_WORKFLOW_MANIFEST_ROOT` overrides
    that root for both fields.
  - Disabled manifest entries are validated so re-enabling a row does not hide
    latent workflow bundle failures.
  - By default, referenced workflow validation is structural/passive. Passing
    `--executable` includes active node executability preflight using the same
    adapter-backed validation surface as `workflow validate --executable`.
  - Text output reports the resolved manifest path, relative path root, and
    each manifest entry's validation status. `--output json` emits the same
    machine-readable fields and per-entry errors.
- `workflow list`
  - List catalog-visible workflows for human inspection without entering the TUI.
  - Show only compact overview data: workflow name, resolved source scope, description, aggregate workflow status, active execution count, and latest run summary.
  - Duplicate names from different scopes must remain distinct rows rather than being silently collapsed.
  - In direct `--workflow-definition-dir` mode, list only workflows in that definition directory and label their source scope as `direct`.
  - Supports `--status running|paused|completed|failed|cancelled|never-run`, `--limit <n>`, and `--output table|json`. Default `--output text` renders the same compact table as `--output table` on this command; other commands stay `text` vs `json` only.
- `workflow inspect <name>`
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
- `workflow usage [name]`
  - List AI-facing workflow purpose, compact step overview, and callable contract metadata without verbose structural detail.
  - Output includes workflow description, step summaries, plus the callable step's input/output contract derived from `managerStepId ?? entryStepId`.
  - Usage output may describe `--variables`, but `workflow inspect` remains the operator-facing place for concrete copyable run examples tied to a single workflow.
  - `workflow usage` lists all visible workflows; `workflow usage <name>` resolves one workflow through normal scope rules.
  - Initial slice is local-only and rejects `--endpoint`.
- `workflow status <name>`
  - Show the selected workflow's compact human-facing status overview rather than raw execution detail.
  - Output includes the resolved source scope, workflow directory, aggregate workflow status, active execution count, latest execution summary, and recent execution summaries.
  - Any execution reported as active (`running` or `paused`) must be loadable by `session status <workflow-execution-id>`, `session progress <workflow-execution-id>`, and `session step-runs <workflow-execution-id>` under the same runtime storage context. `workflow status` must not report stale active rows that exist only in a derived runtime database snapshot, cached overview record, or mismatched storage root.
  - If a non-terminal candidate fails direct `session status` loadability with the same `--workflow-definition-dir` and storage options, it must be excluded from `activeExecutionCount`, `newestActiveExecution`, active recent rows, and aggregate `running` or `paused` derivation.
  - Local status resolution and local session commands must share the same session-store context rules: explicit storage overrides first, then scoped project/user runtime data roots, then direct-root inference only when a direct workflow root is under a recognized scope root.
  - Bare names resolve project scope before user scope in `auto`; use `--scope project|user` to inspect a shadowed workflow explicitly.
  - In direct `--workflow-definition-dir` mode, resolve only within that definition directory and label the source scope as `direct`.
  - Supports `--limit <n>` and `--output table|json`; default `--output text` matches `--output table` for this command (compact human lines).
  - Detailed execution inspection remains on `session status`, `session progress`, and GraphQL detail queries.
- `workflow self-improve <name>`
  - Run the dedicated retrospective workflow self-improve service for the selected workflow. This command is distinct from `workflow run --auto-improve`; it analyzes existing workflow runs after the fact instead of supervising a live target run.
  - Resolves `<name>` through the same direct/project/user workflow lookup rules as `workflow status` and `workflow run`.
  - Default source selection is runs since the previous successful self-improve marker for the resolved workflow directory, or the latest `defaultLogLimit` runs when no marker exists. The initial global fallback is `10`.
  - `--limit <n>` overrides the configured default latest-run limit. `--since-last` forces marker-based selection. `--latest` forces latest-run selection. Repeated `--session <workflow-execution-id>` supplies explicit source runs.
  - `--mode report-only|report-and-auto-improve` overrides `workflow.defaults.selfImprove.mode` for this invocation. `report-only` writes reports without editing workflow files. `report-and-auto-improve` may patch the canonical workflow bundle after backup and validation.
  - `--enable-disabled` permits an explicit operator invocation even when `workflow.defaults.selfImprove.enabled` is `false`; without it, disabled workflows reject self-improve execution unless no workflow default exists and the caller supplied an explicit mode.
  - Reports are written under `<user-root>/self-improve-log/<workflow-directory-name>/<self-improve-id>/` and include purpose-achievement, workflow-structure, and prompt findings.
  - Before any workflow modification, the complete pre-change workflow directory is backed up under the self-improve execution directory. Backups are required for both git-managed and non-git-managed workflows.
  - If the workflow directory is git-managed, successful modifications must be committed locally with only the self-improve workflow-file changes staged. The command must not push.
  - `--output json` returns the self-improve id, report paths, selected source runs, findings summary, backup path, patch status, validation status, and git commit status.
- `workflow run <name-or-registry-target>`
  - Execute `<workflow-definition-dir>/<name>/workflow.json` and all referenced workflow-local node payload files when a direct definition directory is supplied.
  - Without a direct `--workflow-definition-dir`, resolve `<name>` from the scoped workflow catalog: project scope first, then user scope.
  - `--from-registry` changes the positional target from a local workflow id into an online registry run target. Supported targets are existing package ids, GitHub workflow directory URLs, and registered shorthand values such as `<registry-owner>/<workflow-dir>`.
  - Existing package-id behavior remains the primary compatibility path: `workflow run <package-id> --from-registry` resolves the package through registry metadata, checks it out into a command-owned temporary workflow-definition directory, executes the selected workflow through the existing local `workflow run` path, and removes the temporary checkout after the run reaches a terminal result or fails before start.
  - GitHub directory URL targets accept canonical tree URLs such as `https://github.com/<owner>/<repo>/tree/<ref>/<workflow-dir>` and branchless directory URLs such as `https://github.com/<owner>/<repo>/<workflow-dir>`. Branchless URL targets use `--branch` when supplied, otherwise the matching registered registry default branch when the repository is registered, otherwise the repository default branch resolved from GitHub metadata. If no ref can be resolved, the command fails with a usage error before checkout staging begins.
  - Registered shorthand targets use the form `<registry-owner>/<workflow-dir>` and are resolved only through configured registries. `--registry` narrows the candidate registry set; without it, resolution must find exactly one registered registry owned by `<registry-owner>` and exactly one package whose package name, workflow name, or registry source path terminal matches `<workflow-dir>`. Missing or ambiguous shorthand resolution is a usage error.
  - Registry-backed runs are explicit to avoid collisions with project/user workflow names. A bare `workflow run <name>` must never silently fetch from a registry after local lookup fails.
  - Registry-backed runs accept `--registry <registry-url-or-id>` and `--branch <branch>` with the same meaning as package install. The temporary checkout must validate package metadata, checksum/integrity, and the workflow bundle before execution when package metadata is present. Direct GitHub workflow directory URL targets without `rielflow-package.json` run only after workflow-bundle validation and must report reduced provenance instead of pretending package integrity was verified.
  - Registry-backed runs forward ordinary run options unchanged, including `--variables`, `--node-patch`, `--mock-scenario`, `--output json`, `--artifact-root`, `--session-store`, `--working-dir` / `--working-directory`, supervision flags, timeout flags, verbose/debug flags, and node validation behavior.
  - Registry-backed runs are local-only for the first implementation and reject `--endpoint`; remote GraphQL starts should continue to require a workflow already exposed by the remote server or manifest.
  - The temporary checkout must not write normal project/user checkout provenance or install package skills. Execution metadata should record enough source provenance for audit: target kind, original target, package id when package-backed, workflow name, registry URL/id when known, GitHub repository URL, branch/ref, source directory, metadata path when present, checksum, checksum algorithm, and temporary workflow directory.
  - Cleanup must happen after the runner no longer needs workflow-local files such as prompts, scripts, add-on payloads, or container context. If cleanup fails, command output should report the temporary path and failure reason without changing the workflow execution result.
  - If a registry-backed run pauses or otherwise returns a resumable non-terminal local session, the command must retain the temporary checkout and persist registry-run provenance in runtime session metadata rather than normal checkout catalog metadata. That provenance must include the session id, package id, workflow name, registry id or URL, branch/ref, source path, checksum data, and `temporaryWorkflowDirectory`.
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
  - For local sessions created by `workflow run --from-registry`, resume must consult retained registry-run provenance when `--workflow-definition-dir` is absent. If provenance exists, resume uses the parent workflow-definition directory of `temporaryWorkflowDirectory` as the effective workflow root, reports registry source and cleanup status in JSON output, and removes the retained checkout only after the resumed session reaches a terminal status.
- `session rerun <session-id> <step-id>`
  - Start a new run from a chosen step in an existing session.
  - Accepts `--working-dir` / `--working-directory` to override the workflow execution working directory for the rerun.
  - Step ids are the only supported rerun target on active command/control surfaces; do not add node-id aliases to new APIs.
  - `--nested-superviser` is not a valid rerun flag; nested supervision is meaningful only for supervised start/resume flows.
- `session continue <source-workflow-execution-id> --start-step <step-id> --after-step-run <step-run-id>`
  - Planned history-linked continuation mode. Starts a new workflow execution from `startStepId` while importing source history through one concrete prior step run.
  - `after-step-run` is resolved against the merged step-run timeline visible from the source workflow execution, so the chosen anchor may belong to imported ancestry rather than only the source run's local rows.
  - For local source sessions created by `workflow run --from-registry`, continue must resolve retained registry-run provenance when `--workflow-definition-dir` is absent and use the retained checkout to load workflow-local files for the continued execution. Cleanup ownership transfers to the continuation command and runs only when the continued execution reaches a terminal status; another non-terminal result must keep the retained checkout available.
- `call-step <workflow-id> <workflow-run-id> <step-id>`
  - Execute one step directly against an existing run context for local debugging.
  - The same call contract is the target runtime primitive for cross-workflow invocation; calling another workflow means targeting that workflow's callable entry step through `call-step` semantics rather than through an authored top-level `workflow.workflowCalls` array (validation rejects that field).
  - Support explicit continuation controls such as prompt variant selection, backend-session reuse, and timeout override so the same reusable node can be revisited through a different step for flows such as self-review and timeout recovery.
  - New API work should follow the same rule: step-addressed direct execution only, with no additive `call-node`-style aliases. The legacy `call-node` command/library surface is removed rather than retained as a compatibility synonym.
- `graphql <graphql-document>`
  - Execute a GraphQL query or mutation against the canonical control-plane endpoint.
  - Manager-node LLM/tool use should call GraphQL mutations such as `sendManagerMessage` through this command rather than dedicated domain subcommands.
  - When `RIEL_MANAGER_SESSION_ID` is present, the CLI forwards it to `/graphql` with `X-Rielflow-Manager-Session-Id` so manager-scoped mutations do not need to repeat it in GraphQL variables.
  - Without `--endpoint`, executes in-process against local project-scoped workflow/session storage. `--endpoint` or `RIEL_GRAPHQL_ENDPOINT` selects remote HTTP transport.
- `serve [workflow-name]`
  - Start the local HTTP control plane.
  - If `workflow-name` is provided, workflow-definition access is constrained to that workflow.
  - Accepts `--workflow-manifest <path>` to load an explicit server workflow allowlist. When present, only enabled manifest entries are exposed as startable workflows by browser and GraphQL server surfaces.
  - With `--workflow-manifest`, optional `workflow-name` narrows by manifest entry id. Existing `--workflow-definition-dir` catalog selection is ignored for served catalog exposure when a manifest is present.
  - Exposes `/graphql` for workflow-definition, execution, communication, and manager-control operations.
  - Human-facing browser mode should default to the overview-only workflow list and selected-workflow status surface described in `design-workflow-overview-status-surface.md`, not to node-level debugging detail.
  - Exposes `/healthz` for liveness checks.
- `hook [--vendor claude-code|codex|gemini]`
  - Receive agent backend hook payloads via stdin, detect vendor and event type, associate hook `session_id` with the ambient rielflow workflow execution when available, record the hook event, and dispatch to registered policy handlers.
  - Claude Code, Codex, and Gemini pipe a JSON object to stdin; the command parses it, validates the shared transport fields (`session_id`, `cwd`, `hook_event_name`), resolves the vendor (from `--vendor` flag or best-effort detection), identifies the `hook_event_name`, and calls the matching handler.
  - When `RIEL_WORKFLOW_EXECUTION_ID`, `RIEL_WORKFLOW_ID`, and the ambient step/node execution context variables are present, hook events are persisted as runtime hook-event records keyed by workflow execution id, backend agent session id, node execution id, and optional manager session id.
  - Outside a rielflow-launched agent process, the command remains pass-through by default and returns empty JSON `{}` unless a policy handler makes a decision.
  - Exit 0 with JSON on stdout for success; exit 2 with reason on stderr to block.
- `hook snippet --vendor claude-code|codex|gemini`
  - Print a paste-ready JSON hook configuration snippet for the selected backend.
  - The generated snippet registers the vendor-detecting `rielflow hook` command for the recommended lifecycle events.
  - This command only prints JSON to stdout; it does not mutate Claude Code, Codex, Gemini, or project configuration files.
- `events validate [--event-root <path>]`
  - Validate external event source and binding configuration without starting listeners.
- `events emit <source-id> --event-file <path>`
  - Inject a normalized or raw fixture event for local testing of binding matching, input mapping, dedupe, and workflow dispatch.
- `events serve [--event-root <path>] [--endpoint <graphql-url>]`
  - Start cron, webhook, Matrix, chat, web-chat, local file-change, and
    sequential-list event listeners.
  - On startup, rehydrate active persisted workflow schedules and enqueue the
    next due `workflow-schedule` occurrence through the shared scheduled event
    manager when event listeners are enabled.
  - For `sequential-list` sources, resume the durable sequence cursor for the
    current source/config revision and dispatch only the next pending list item;
    the listener must wait for the prior workflow execution or supervised run to
    reach a terminal state before dispatching another item from the same
    sequence.
  - In local command-dispatch mode, starts workflow execution through `rielflow workflow run` with a generated mapped-input JSON file.
  - In local library mode, invokes the library workflow execution client in-process.
  - With `--endpoint`, dispatches workflow execution through GraphQL and can run as a lightweight listener process.
  - For bindings configured with `execution.mode = "supervised"`, dispatches events to the workflow supervisor control path so the same event source conversation can start, stop, restart, and inspect the active workflow.
  - In deterministic supervisor mode, the local control path persists an async command/run record and applies workflow reference, start, status, progress, inbox/read, logs, export, stop/cancel, restart/rerun, and input/submit/resume operations through the in-process runner pool.
- `events list [--source <id>] [--status <status>] [--limit <n>]`
  - Inspect persisted event receipt records, including sequence metadata for
    `sequential-list` items when present.
- `events schedules list [--source <id>] [--status <status>] [--limit <n>]`
  - Inspect persisted chat-created workflow schedules without mutating them.
- `events schedules inspect <schedule-id> [--output json]`
  - Show the selected schedule record, next due occurrence, last execution
    attempt, status, and resolved workflow reference.
- `events schedules cancel <schedule-id> [--reason <text>]`
  - Cancel an active or paused workflow schedule and cancel any pending
    `workflow-schedule` event owned by that schedule.
- `events replay <receipt-id> [--dry-run] [--reason <text>]`
  - Re-run mapping and dispatch for a persisted normalized event receipt using replay-specific event and dedupe identifiers.
  - Replaying a `sequential-list` item targets that one receipt/item; it must
    not reset or re-enqueue the entire configured prompt list unless a future
    explicit sequence-reset command is added.
  - `--dry-run` forwards the replay through workflow execution dry-run behavior.
  - `--reason` records operator intent in the replay receipt raw artifact.
  - Local event dispatch commands accept `--mock-scenario <path>` and reject combining it with `--endpoint`.

### Release Packaging Commands

Release packaging is driven by repository automation rather than by a new
runtime CLI subcommand. The user-facing `rielflow` command should remain focused
on workflow, session, GraphQL, server, hook, and event operations.

The packaging command surface should include:

- `scripts/build-homebrew-release.sh`: build standalone Bun-compiled release
  archives for the current host target by default, with optional supported
  target arguments when the build environment can produce them.
- `scripts/render-homebrew-formula.sh`: render or update the Homebrew formula
  from a release version, archive URL base, and SHA-256 checksum manifest.
- `task build:homebrew`: Taskfile wrapper around the archive builder.
- `task homebrew:formula`: Taskfile wrapper around formula rendering.
- `task homebrew:tap-formula`: render the formula into the sibling
  `../homebrew-tap/Formula/rielflow.rb` checkout used by `tacogips/tap`.

Default local verification commands for this issue:

```bash
scripts/build-homebrew-release.sh
tmp_dir="$(mktemp -d)"
tar -C "$tmp_dir" -xzf dist/homebrew/rielflow-<version>-<target>.tar.gz
"$tmp_dir/bin/rielflow" --help
brew tap-new local/rielflow-test
tap_root="$(brew --repository local/rielflow-test)"
RIEL_RELEASE_BASE_URL="file://$PWD/dist/homebrew" \
  scripts/render-homebrew-formula.sh <version> "$tap_root/Formula/rielflow.rb"
brew install local/rielflow-test/rielflow
brew test local/rielflow-test/rielflow
brew uninstall rielflow
brew untap local/rielflow-test
```

`--version` is part of the preferred release smoke test after the CLI exposes a
stable version surface. The first Homebrew slice may use `--help` only when
runtime code changes are intentionally deferred.

The Homebrew formula should install from generated release archives, not from
source checkout plus `bun install`. Formula variables must make the release URL,
version, target archive names, and checksums explicit. Publish-mode formula
generation must reject placeholder URLs or checksums; local verification mode
may generate a file URL or locally patched formula for smoke testing.

### Flags and Options

| Flag                                              | Type          | Default                                             | Description                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--worker-only`                                   | boolean       | `false`                                             | For `workflow create`: scaffold a manager-less starter whose explicit `entryStepId` is `main-worker`                                                                                                                      |
| `--user-scope`                                    | boolean       | `false`                                             | For `workflow checkout`: install into the resolved user scope workflow root instead of the default project scope destination                                                                                               |
| `--overwrite`                                     | boolean       | `false`                                             | For `workflow checkout`: after staged remote validation succeeds, remove the existing destination workflow directory and replace its checkout registry record                                                               |
| `--from-registry`                                 | boolean       | `false`                                             | For `workflow run`: interpret the positional target as an online registry run target: package id, GitHub workflow directory URL, or registered shorthand; stage a temporary non-persistent checkout, run from it, then clean it up |
| `--registry`                                      | string        | default registry                                    | For package install/search and `workflow run --from-registry`: restrict package or shorthand resolution to a registry id or canonical GitHub registry URL                                                                   |
| `--branch`                                        | string        | target-dependent                                    | For package install/search and `workflow run --from-registry`: select the registry or GitHub repository branch/ref used for package metadata and content; branchless raw GitHub URLs use this before default-branch discovery |
| `--structure`                                     | boolean       | `false`                                             | For `workflow inspect`: render a compact indented text structure with each step id on its own line and the description on the next line one indent deeper                                                                 |
| `--executable`                                    | boolean       | `false`                                             | For `workflow validate` and `workflow manifest validate`: run active node executability preflight and include `NodeValidationResult` records for nodes, add-ons, and backend adapters                                     |
| `--variables`                                     | string        | none                                                | For `workflow run`: runtime variables as inline JSON object, existing file path, or `@path/to/variables.json`; for `rielflow graphql`: inline GraphQL variables JSON or `@path/to/variables.json`                          |
| `--node-patch`                                    | string        | none                                                | For `workflow validate` and `workflow run`: non-persistent node settings patch as inline JSON object, existing file path, or `@path/to/patch.json`; patch keys are node ids and values allow only `executionBackend`, `model`, and `effort` |
| `--workflow-definition-dir`                       | string (path) | scoped catalog lookup                               | Direct directory containing `<workflow-name>/workflow.json` definition bundles; when supplied, bypasses project/user scope catalog lookup and does not control logs, sessions, or artifacts                               |
| `--scope`                                         | string        | `auto`                                              | Workflow scope selector for read/write commands: `auto`, `project`, or `user`                                                                                                                                             |
| `--status`                                        | string        | none                                                | For overview/list commands: filter by aggregate status (`running`, `paused`, `completed`, `failed`, `cancelled`, or `never-run`)                                                                                          |
| `--limit`                                         | number        | command-specific                                    | Limit compact list output, such as workflow rows for `workflow list` or recent executions for `workflow status`                                                                                                           |
| `--since-last`                                    | boolean       | `false`                                             | For `workflow self-improve`: select workflow runs newer than the previous successful self-improve marker for the resolved workflow directory                                                                               |
| `--latest`                                        | boolean       | `false`                                             | For `workflow self-improve`: select the latest workflow runs, capped by `--limit` or `workflow.defaults.selfImprove.defaultLogLimit`                                                                                       |
| `--session`                                       | string        | none                                                | For `workflow self-improve`: explicit workflow execution id to include as a source run; may be repeated                                                                                                                   |
| `--mode`                                          | string        | workflow/default policy                             | For `workflow self-improve`: `report-only` or `report-and-auto-improve`                                                                                                                                                    |
| `--enable-disabled`                               | boolean       | `false`                                             | For `workflow self-improve`: allow explicit execution for a workflow whose authored self-improve config is disabled                                                                                                        |
| `--stall-timeout-ms`                              | number        | workflow/default policy                             | For `auto improve mode`: threshold used to mark no-progress evidence as stalled; overrides `workflow.defaults.supervision.stallTimeoutMs`; must be greater than or equal to `--monitor-interval-ms`                       |
| `--user-root`                                     | string (path) | `~/.rielflow`                                        | User scope root; workflows are read from `<user-root>/workflows` unless `--workflow-definition-dir` is supplied                                                                                                           |
| `--project-root`                                  | string (path) | nearest project `.rielflow`                          | Project scope root; workflows are read from `<project-root>/workflows` unless `--workflow-definition-dir` is supplied                                                                                                     |
| `--addon-root`                                    | string (path) | scoped add-on catalog lookup                        | Direct root directory containing local add-ons; during scoped catalog loading, searched before project/user add-on roots                                                                                                  |
| `--artifact-root`                                 | string (path) | resolved runtime data root + `/workflow`            | Root directory for execution artifacts                                                                                                                                                                                    |
| `--session-store`                                 | string (path) | resolved runtime data root + `/sessions`            | Root directory for persisted workflow sessions                                                                                                                                                                            |
| `--log-root`                                      | string (path) | `<scope-root>/logs`                                 | Root directory for operator-facing process logs and exported runtime logs                                                                                                                                                 |
| `--config`                                        | string (path) | `$XDG_CONFIG_HOME/rielflow/config.json`              | Bootstrap config path used to resolve user/project scope roots                                                                                                                                                            |
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
| `--auth-token-env`                                | string        | `RIEL_MANAGER_AUTH_TOKEN`                        | Environment variable used to resolve GraphQL auth token                                                                                                                                                                   |
| `--message-json`                                  | string        | none                                                | Inline JSON payload for `call-step`                                                                                                                                                                                       |
| `--message-file`                                  | string (path) | none                                                | JSON payload file for `call-step`                                                                                                                                                                                         |
| `--file`                                          | string (path) | none                                                | Output file path for `export`; when omitted, the export JSON is written to stdout                                                                                                                                         |
| `--workflow-manifest`                             | string (path) | none                                                | JSON manifest for `serve` allowlist selection or `workflow manifest validate`; in serve mode, it takes precedence over direct/scoped catalog exposure                                                                         |
| `--host`                                          | string        | `127.0.0.1`                                         | Bind address for `serve`                                                                                                                                                                                                  |
| `--port`                                          | number        | `43173`                                             | Listen port for `serve`                                                                                                                                                                                                   |
| `--read-only`                                     | boolean       | `false`                                             | Disable write/update operations in `serve` mode                                                                                                                                                                           |
| `--no-exec`                                       | boolean       | `false`                                             | Parsed by `serve`; current GraphQL schema does not yet enforce execution blocking from this flag                                                                                                                          |
| `--vendor`                                        | string        | auto-detect                                         | For `hook`: explicit vendor identifier (`claude-code` or `codex`); when omitted, detected heuristically from payload fields                                                                                               |
| `--event-root`                                    | string (path) | nearest `.rielflow-events` next to the workflow root | Root directory containing external event source and binding configuration                                                                                                                                                 |

### Environment Variables

| Variable                          | Required        | Default                                         | Description                                                                                                                                                   |
| --------------------------------- | --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RIEL_ARTIFACT_ROOT`           | No              | resolved runtime data root + `/workflow`        | Overrides only the workflow artifact tree root (`.../workflow`)                                                                                               |
| `RIEL_WORKFLOW_DEFINITION_DIR` | No              | scoped catalog lookup                           | Direct default workflow definition directory; when set, bypasses project/user scope catalog lookup and does not control runtime logs, sessions, or artifacts  |
| `RIEL_WORKFLOW_MANIFEST`       | No              | none                                            | Default manifest path for `serve`; when present, defines the complete server workflow allowlist and takes precedence over direct/scoped catalog exposure      |
| `RIEL_WORKFLOW_MANIFEST_ROOT`  | No              | current directory                               | Root directory for relative `workflowDirectory` and `cwd` paths inside workflow manifests                                                                    |
| `RIEL_WORKFLOW_SCOPE`          | No              | `auto`                                          | Default workflow scope selector: `auto`, `project`, or `user`                                                                                                 |
| `RIEL_USER_ROOT`               | No              | `~/.rielflow`                                    | User scope root; workflows default to `<user-root>/workflows`, logs to `<user-root>/logs`, and runtime data to `<user-root>/artifacts`                        |
| `RIEL_PROJECT_ROOT`            | No              | nearest project `.rielflow`                      | Project scope root override; workflows default to `<project-root>/workflows`, logs to `<project-root>/logs`, and runtime data to `<project-root>/artifacts`   |
| `RIEL_ADDON_ROOT`              | No              | scoped add-on catalog lookup                    | Direct default local add-on root; during scoped catalog loading, searched before project/user add-on roots                                                    |
| `RIEL_LOG_ROOT`                | No              | `<scope-root>/logs`                             | Overrides operator-facing process/runtime log output root                                                                                                     |
| `RIEL_CONFIG`                  | No              | `$XDG_CONFIG_HOME/rielflow/config.json`          | Bootstrap config path used before user scope root resolution                                                                                                  |
| `RIEL_SESSION_STORE`           | No              | local file store                                | Session state backend selector                                                                                                                                |
| `RIEL_SERVE_HOST`              | No              | `127.0.0.1`                                     | Default bind address for `serve`                                                                                                                              |
| `RIEL_SERVE_PORT`              | No              | `43173`                                         | Default listen port for `serve`                                                                                                                               |
| `RIEL_ARTIFACT_DIR`            | No              | owning scope artifacts root or user artifacts   | Canonical root data directory override: sessions, `workflow/`, `files/`, `rielflow.db`                                                                         |
| `RIEL_GRAPHQL_ENDPOINT`        | No              | local serve endpoint                            | Default GraphQL endpoint for CLI manager/control-plane commands                                                                                               |
| `RIEL_MANAGER_AUTH_TOKEN`      | No              | none                                            | Manager-session auth token for `rielflow graphql` and GraphQL control-plane mutations                                                                          |
| `RIEL_MANAGER_SESSION_ID`      | No              | none                                            | Ambient manager session id forwarded by `rielflow graphql` to `/graphql` for manager-scoped requests                                                           |
| `RIEL_SELF_IMPROVE_DEFAULT_LIMIT` | No            | `10`                                            | Default latest-run limit for `workflow self-improve` when no workflow `defaults.selfImprove.defaultLogLimit` or command `--limit` is supplied                 |
| `RIEL_WORKFLOW_ID`             | No              | none                                            | Ambient workflow id for rielflow-launched backend processes, manager tool environments, and hook event recording                                               |
| `RIEL_WORKFLOW_EXECUTION_ID`   | No              | none                                            | Ambient workflow execution id for rielflow-launched backend processes, manager tool environments, and hook event recording                                     |
| `RIEL_STEP_ID`                 | No              | none                                            | Ambient step id for the current step invocation and hook event recording                                                                                      |
| `RIEL_NODE_ID`                 | No              | none                                            | Ambient backing node id for the current step invocation and hook event recording                                                                              |
| `RIEL_NODE_EXEC_ID`            | No              | none                                            | Ambient node execution id for the concrete step invocation and hook event recording                                                                           |
| `RIEL_AGENT_BACKEND`           | No              | none                                            | Ambient backend name for rielflow-launched agent processes, such as `codex-agent` or `claude-code-agent`                                                       |
| `RIEL_MANAGER_STEP_ID`         | No              | none                                            | Ambient manager step id for manager tool environments                                                                                                         |
| `RIEL_MANAGER_NODE_EXEC_ID`    | No              | none                                            | Ambient manager node execution id for manager tool environments                                                                                               |
| `RIEL_HOOK_RECORDING`          | No              | `auto`                                          | Hook event recording mode: `auto` records when rielflow context is present, `off` disables persistence, and `required` errors when required context is missing |
| `RIEL_HOOK_STRICT`             | No              | `false`                                         | When `true`, hook persistence failures become hook errors; when `false`, recording failures do not block the backend                                          |
| `RIEL_HOOK_CAPTURE_RAW`        | No              | `redacted`                                      | Hook payload artifact mode: `redacted`, `metadata-only`, or `full`                                                                                            |
| `RIEL_EVENT_ROOT`              | No              | nearest `.rielflow-events` next to workflow root | Default external event source and binding configuration root                                                                                                  |
| `RIEL_EVENT_ENDPOINT_BASE_URL` | No              | none                                            | Public base URL used by webhook/chat providers when registering or displaying callback endpoints                                                              |
| `RIEL_EVENTS_HOST`             | No              | `127.0.0.1` for `events serve`                  | Bind address for event listener HTTP routes                                                                                                                   |
| `RIEL_EVENTS_PORT`             | No              | `43174` for `events serve`                      | Listen port for event listener HTTP routes                                                                                                                    |
| `RIEL_EVENTS_ENABLED`          | No              | `false` for `serve`, `true` for `events serve`  | Enables event listener routes and schedulers                                                                                                                  |
| `RIEL_EVENTS_READ_ONLY`        | No              | `false`                                         | Validates and records incoming events without dispatching workflow execution                                                                                  |
| `OTEL_SDK_DISABLED`               | No              | OpenTelemetry SDK default                       | Standard OpenTelemetry switch for disabling telemetry setup in supported entrypoints                                                                          |
| `OTEL_SERVICE_NAME`               | No              | `rielflow`                                      | Standard OpenTelemetry service name used for Rielflow process traces                                                                                          |
| `OTEL_EXPORTER_OTLP_ENDPOINT`     | No              | none                                            | Standard OTLP collector endpoint; local Jaeger verification should point this at the Docker Compose Jaeger collector                                           |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | No           | none                                            | Standard trace-specific OTLP collector endpoint; preferred over `OTEL_EXPORTER_OTLP_ENDPOINT` when both are set                                               |
| `OTEL_EXPORTER_OTLP_PROTOCOL`     | No              | SDK/exporter default                            | Standard OTLP protocol selector when the selected exporter package supports it                                                                                 |
| `RIELFLOW_OTEL_ENABLED`           | No              | inferred from OTLP endpoint                     | Rielflow-specific override for enabling or disabling workflow telemetry setup                                                                                  |
| `RIELFLOW_OTEL_SERVICE_NAME`      | No              | `rielflow`                                      | Rielflow-specific fallback service name when `OTEL_SERVICE_NAME` is unset                                                                                     |
| `RIELFLOW_OTEL_EXPORT_MESSAGES`   | No              | `false`                                        | Rielflow-specific privacy opt-in; when `true`, inbox/outbox message bodies may be exported after redaction and size limits; when unset or `false`, only metadata is exported |
| `DIVEDRA_OTEL_ENABLED`            | No              | inferred from OTLP endpoint                     | Legacy product-name alias for `RIELFLOW_OTEL_ENABLED` during the rename transition                                                                            |
| `DIVEDRA_OTEL_EXPORT_MESSAGES`    | No              | `false`                                        | Legacy product-name alias for `RIELFLOW_OTEL_EXPORT_MESSAGES` during the rename transition                                                                    |
| `RIEL_MATRIX_HOMESERVER_URL`   | Source-specific | none                                            | Example Matrix homeserver URL env var referenced by `kind: "matrix"` source config; operators may choose another env var name per source                      |
| `RIEL_MATRIX_ACCESS_TOKEN`     | Source-specific | none                                            | Example Matrix bot access token env var referenced by `kind: "matrix"` source config; token values must not appear in authored config or runtime artifacts    |

### Telemetry and Jaeger Verification

Telemetry startup applies to `workflow run`, `session resume`, `session rerun`,
`call-step`, `serve`, `events serve`, GraphQL execution, and library execution
helpers. Operators should use standard OpenTelemetry environment variables for
exporter selection and Rielflow-specific variables only for privacy behavior.
No CLI command should require telemetry configuration to run.

The first local verification path should be:

1. start Jaeger with Docker Compose:
   `docker compose -f compose.jaeger.yaml up -d`
2. run a workflow with `OTEL_SERVICE_NAME=rielflow` and
   `OTEL_EXPORTER_OTLP_ENDPOINT` pointing at the Compose Jaeger collector
3. keep `RIELFLOW_OTEL_EXPORT_MESSAGES` unset for the default
   privacy-preserving smoke test
4. optionally rerun with `RIELFLOW_OTEL_EXPORT_MESSAGES=true` only
   against a trusted fixture whose inbox/outbox content is intentionally safe
5. inspect Jaeger for workflow, step/node, adapter, GraphQL/server, and mailbox
   handoff spans

Verification commands for the implementation plan should include:

- `bun run typecheck`
- focused `bun test` targets for telemetry configuration, redaction, workflow
  execution instrumentation, mailbox/communication instrumentation, and CLI or
  library option propagation
- `docker compose -f compose.jaeger.yaml up -d`
- `docker compose -f compose.jaeger.yaml ps`
- an example `bun run packages/rielflow/src/bin.ts workflow run ...` invocation
  with `OTEL_EXPORTER_OTLP_ENDPOINT` configured
- `docker compose -f compose.jaeger.yaml down`

Workflow lookup resolution order:

1. `--workflow-manifest` for `serve`
2. `RIEL_WORKFLOW_MANIFEST` for `serve`
3. `--workflow-definition-dir`
4. `RIEL_WORKFLOW_DEFINITION_DIR`
5. `--scope project|user` / `RIEL_WORKFLOW_SCOPE`
6. project scope `<project-root>/workflows` when scope is `auto` or `project`
7. user scope `<user-root>/workflows` when scope is `auto` or `user`

In `auto` mode, project scope is searched before user scope. If the same name
exists in both scopes, project scope wins for bare workflow names.
`--workflow-definition-dir` and `RIEL_WORKFLOW_DEFINITION_DIR` are direct
workflow definition directory overrides and do not use scope catalog lookup.
For `serve`, `--workflow-manifest` and `RIEL_WORKFLOW_MANIFEST` are
authoritative allowlist inputs and prevent additional direct or scoped catalog
workflows from being exposed by that server.
For manifest path fields, `relative` resolves from the current directory unless
`RIEL_WORKFLOW_MANIFEST_ROOT` supplies an explicit root. Use
`workflow manifest validate <manifest-path>` to validate manifest shape, path
resolution, duplicate constraints, and every referenced workflow bundle.

Invalid values for `--scope` or `RIEL_WORKFLOW_SCOPE` are usage errors. The
CLI must fail rather than silently treating the value as `auto`.

These CLI behaviors correspond to the current step-addressed runtime in
`src/workflow/`, including jump-driven routing, timeout continuation, scoped
catalog lookup, and engine-owned auto-improve supervision.

The supervised event control direction is tracked separately in
`design-docs/specs/design-event-supervisor-control.md`. That design adds a
workflow-supervisor-backed path for event sources without changing the default
direct trigger behavior.

Scope root defaults:

1. user scope root: `--user-root`, `RIEL_USER_ROOT`, bootstrap config
   `userRoot`, then `~/.rielflow`
2. project scope root: `--project-root`, `RIEL_PROJECT_ROOT`, nearest
   project `.rielflow`
3. scope subdirectories: `workflows`, `addons`, `artifacts`, and `logs` unless
   overridden by scope config

Add-on lookup resolution order:

1. built-in runtime catalog for `rielflow/*`
2. explicit direct add-on root override from `--addon-root` or
   `RIEL_ADDON_ROOT`, when supplied
3. project scope `<project-root>/addons`, when present
4. user scope `<user-root>/addons`
5. host-provided resolver functions

`--addon-root` and `RIEL_ADDON_ROOT` are direct add-on-root overrides. They
point at a directory containing `<namespace>/<addon-name>/<version>/addon.json`
and do not point at a scope root. For scoped catalog loading they are prepended
to the scoped candidates and do not suppress project/user fallback when the
direct root does not contain the requested `(name, version)`.

Artifact root resolution order:

1. `--artifact-root`
2. `RIEL_ARTIFACT_ROOT`
3. `RIEL_ARTIFACT_DIR/workflow` when `RIEL_ARTIFACT_DIR` is set
4. owning scope default: `<scope-root>/artifacts/workflow`
5. non-scoped default: `<user-root>/artifacts/workflow`

Runtime-root co-location rule:

1. when `--artifact-root` and/or `--session-store` are supplied, `rielflow` infers `rootDataDir` from those explicit roots when they provide an unambiguous parent directory
2. that inferred root keeps `rielflow.db` and sibling default roots aligned with the explicit storage tree instead of an unrelated ambient `RIEL_ARTIFACT_DIR`

Session store root resolution order:

1. `--session-store`
2. `RIEL_SESSION_STORE`
3. `RIEL_ARTIFACT_DIR/sessions` when `RIEL_ARTIFACT_DIR` is set
4. owning scope default: `<scope-root>/artifacts/sessions`
5. non-scoped default: `<user-root>/artifacts/sessions`

Log root resolution order:

1. `--log-root`
2. `RIEL_LOG_ROOT`
3. scope config `logSubdir`
4. owning scope default: `<scope-root>/logs`

GraphQL control-plane resolution order:

1. `--endpoint`
2. `RIEL_GRAPHQL_ENDPOINT`
3. local `rielflow serve` default (`http://127.0.0.1:43173/graphql`)

Data-root file reference rule:

1. GraphQL file/image parameters use data-root-relative paths, not host absolute paths
2. Those paths are resolved under `RIEL_ARTIFACT_DIR`
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
- `rielflow graphql` is the thin generic GraphQL client surface,
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
