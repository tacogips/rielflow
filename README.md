# divedra

`divedra` is a TypeScript/Bun workflow runtime for cooperative multi-agent execution.

The current codebase provides:

- file-based workflow definitions under `.divedra/` or another configured workflow root
- a queue-driven workflow engine with persisted sessions and runtime artifacts
- agent backends for `codex-agent`, `claude-code-agent`, `official/openai-sdk`, and `official/anthropic-sdk`
- a local GraphQL control plane served by Bun

## Active Design Direction

The current implementation remains the source of truth for shipped behavior, but the active design work in `design-docs/specs/` now targets:

- step-addressed workflows (`workflow.json.steps[]`) with a reusable node registry in `workflow.json.nodes[]`
- jump-driven routing via validated `next.stepId` rather than dedicated branch/loop authoring
- deterministic `code` manager behavior as the default manager mode
- explicit same-session continuation for different steps that intentionally reuse one node
- cross-workflow handoffs authored only as `steps[].transitions` with `toWorkflowId` / `resumeStepId`; validation rejects top-level `workflow.workflowCalls`; the runtime derives deterministic dispatch ids (`__cw:<callerStepId>`) and invokes the callee using the same callable entry contract as direct `call-step` execution (typically the callee manager step, or `entryStepId` for worker-only bundles)
- supervised `--auto-improve` execution (engine outer loop, persisted incidents/remediations, and patch audit; optional phase-2 nested `superviser` workflow with `--nested-superviser`; see `design-docs/specs/architecture.md` and `impl-plans/completed/auto-improve-superviser-workflow-phase-2.md`)

Those design documents describe the intended next schema and runtime direction; they are not a claim that every item is already implemented in `src/`.

## What Is Implemented Today

The source of truth is the implementation under `src/workflow/`, `src/cli.ts`,
`src/graphql/`, and `src/server/`.

Current runtime behavior:

- step-addressed bundles (`workflow.json.steps[]` + reusable `workflow.json.nodes[]`) are the authored workflow model for create, validate, inspect, load, and save
- workflows persist session state, node execution artifacts, communications, and runtime indexes
- manager nodes run inside the queue-based engine rather than replacing it with a pure external orchestrator
- authored workflows may use role-based steps (`manager` / `worker`) and may omit a manager when `entryStepId` is explicit
- manager-less workflows execute today, and the runtime treats `entryStepId` as the effective manager/entry anchor when `managerStepId` is omitted
- `call-step` is the supported direct-call surface for local debugging and step-addressed execution control
- cross-workflow execution is derived from step transitions only: validation **rejects** top-level `workflow.workflowCalls` on every load/save path, and the engine projects deterministic runtime dispatch rows (`id` `__cw:<callerStepId>`) from `steps[].transitions` with `toWorkflowId` / `resumeStepId`
- node-local `repeat` remains supported and synthesizes loop semantics from the normalized runtime node list
- `user-action` nodes are supported and pause execution until an external reply resolves the action

Current execution support by node type:

- `agent`: implemented
- `user-action`: implemented as a pause-and-resume runtime state
- `command`: implemented
- `container`: implemented
- `addon`: implemented for built-in runtime-provided worker add-ons and
  host-provided third-party addon definitions or resolvers

Cross-workflow runtime (not an authored `workflow.json` field):

- Step transitions with `toWorkflowId` / `resumeStepId` drive cross-workflow execution. The runtime exposes the handoff to callees through `runtimeVariables.workflowCall` (stable template key; name is historical): caller payload as `workflowCall.input`, and optional result delivery through a runtime-owned `workflow-call:<dispatch-id>` communication (prefix historical).

Additional node registry features:

- `nodes[].addon`: worker add-on references that resolve to effective node
  payloads while save/edit surfaces preserve the authored add-on reference.
  Current built-ins include `divedra/chat-reply-worker`,
  `divedra/codex-worker`, `divedra/claude-code-worker`,
  `divedra/x-gateway-read`, `divedra/x-gateway`,
  `divedra/mail-gateway-read`, and `divedra/mail-gateway`. Non-`divedra/`
  add-ons require explicit host-provided add-on definitions or resolver
  functions; workflow loading does not fetch packages or registry metadata.
  Add-on registration helpers and resolver-facing types are exported from the
  package root for host applications and third-party add-on packages. Add-on
  definitions may resolve synchronously or asynchronously when loaded through
  the normal disk/execution path.

## Quick Start

Install dependencies:

```bash
bun install
```

Validate an example workflow:

```bash
bun run src/main.ts workflow validate claude-divedra-codex-coding --workflow-root ./examples
```

Inspect the normalized workflow summary:

```bash
bun run src/main.ts workflow inspect claude-divedra-codex-coding \
  --workflow-root ./examples \
  --output json
```

Run a workflow with the bundled deterministic mock scenario:

```bash
bun run src/main.ts workflow run claude-divedra-codex-coding \
  --workflow-root ./examples \
  --mock-scenario ./examples/claude-divedra-codex-coding/mock-scenario.json \
  --output json
```

Start the local GraphQL control plane:

```bash
bun run src/main.ts serve
```

Run `divedra` directly from the flake on Linux or Darwin:

```bash
nix run github:tacogips/divedra -- --help
```

Install the flake package into your user profile:

```bash
nix profile install github:tacogips/divedra
```

The flake `default` package is a lightweight `divedra` wrapper that bootstraps a
writable Bun workspace under `~/.cache/divedra/nix/` on first launch. The full
tool bundle remains available as `.#dev-tools`, and `nix develop` still provides
the full development environment.

CLI note:

- use the direct form `bun run src/main.ts workflow ...`

## CLI Surface

Primary commands implemented in `src/cli.ts`:

- `workflow create <name>`
- `workflow validate <name>`
- `workflow inspect <name>`
- `workflow run <name>`
- `session status <session-id>`
- `session progress <session-id>`
- `session resume <session-id>`
- `session rerun <session-id> <step-id>`
- `session export <session-id>`
- `session logs <session-id>`
- `serve [workflow-name]`
- `gql <graphql-document>`
- `call-step <workflow-id> <workflow-run-id> <step-id>`
- `hook [--vendor claude-code|codex]`
- `events validate`
- `events emit <source-id> --event-file <path>`
- `events serve`
- `events list [--source <id>] [--status <status>] [--limit <n>]`
- `events replay <receipt-id>`

`workflow create <name>` scaffolds a role-based starter with a code-manager default manager node and a `codex-agent` worker node. The generated `workflow.json` prefers the authored-minimal surface and omits compatibility/default fields such as empty `subWorkflows`, synthesized `edges`, default `branching`, and node-level `completion: { "type": "none" }` unless they are needed. Pass `--worker-only` to scaffold a manager-less starter whose authored entry step points at `main-worker`.

`call-step` is the direct-call surface during the step-addressed cutover. It accepts targeted continuation controls such as `--prompt-variant <name>`, `--continue-session`, `--timeout-ms <ms>`, and `--resume-step-exec <id>` so a reusable node can be revisited through a specific step with invocation-local overrides.

`serve` starts the local Bun HTTP server. The current server surface exposes GraphQL and health checks only.

`events` commands load external event source configuration from
`.divedra-events` next to the workflow root, or from `--event-root`. `events
emit` injects fixture payloads for local testing, `events serve` starts
listener adapters, `events list` reads persisted receipt records from the
runtime database, and `events replay` re-dispatches a stored normalized event
with replay-specific event and dedupe identifiers. Event dispatch commands can
use `--mock-scenario <path>` to execute local workflows deterministically
without a GraphQL endpoint or real agent backend transports. Set
`DIVEDRA_EVENTS_READ_ONLY=true` or pass `--read-only` to validate and persist
event receipts without dispatching workflow execution. `events replay` also
accepts `--dry-run` and `--reason <text>` for operator verification and receipt
audit metadata.

Useful options:

- `--workflow-root`
- `--artifact-root`
- `--session-store`
- `--worker-only`
- `--variables <path>`
- `--mock-scenario <path>`
- `--output json`
- `--format text|json|jsonl` for `session logs`

`workflow inspect` surfaces step and node-registry identity fields plus
`crossWorkflowDispatchIds` and `counts.crossWorkflowDispatches` (derived from
`steps[].transitions`, not from authored `workflow.workflowCalls`).

- `--dry-run`
- `--max-steps <n>`
- `--max-loop-iterations <n>`
- `--default-timeout-ms <ms>`
- `--timeout-ms <ms>` for `call-step`
- `--prompt-variant <name>` for `call-step`
- `--continue-session` for `call-step`
- `--resume-step-exec <id>` for `call-step` (prior execution record id)

Remote execution support:

- `workflow run`, `session resume`, and `session rerun` can target a remote control plane with `--endpoint`
- `call-step`, `session export`, and `session logs` are local-only today
- `--mock-scenario` is local-only and cannot be combined with `--endpoint`

## GraphQL Control Plane

`serve` exposes:

- `POST /graphql`
- `GET /healthz`

Defaults:

- host: `127.0.0.1`
- port: `43173`
- default GraphQL endpoint: `http://127.0.0.1:43173/graphql`

The GraphQL schema currently includes:

- workflow-definition queries and mutations
- `createWorkflowDefinition` accepts the same starter template split as the CLI: the default managed starter or `templateMode: WORKER_ONLY`
- workflow execution queries
- execution mutations for run, resume, rerun, and cancel
- communication replay/retry operations
- manager-session and manager-message operations

Transport details:

- bearer auth is read from the `Authorization` header
- manager session scope is forwarded via `X-Divedra-Manager-Session-Id`
- HTTP requests do not inherit ambient manager auth from the server process environment

Example:

```bash
bun run src/main.ts gql '
  query {
    workflows(input: {})
  }
'
```

## Workflow Bundle Layout

Workflows live under `<workflow-root>/<workflow-name>/`.

Typical layout:

```text
.divedra/
  my-workflow/
    workflow.json
    nodes/
      node-divedra-manager.json
      node-main-worker.json
    prompts/
      divedra-manager.md
      main-worker.md
    workflows/
      review/
        nodes/
          node-review-manager.json
```

Current file roles:

- `workflow.json`: canonical workflow structure, control-flow definition, and the step graph (`steps[]` transitions); legacy bundles may still imply control flow via ordered `nodes[]` and synthesized edges
- `nodes/node-{id}.json`: default location for per-node payloads
- `workflows/*/nodes/node-{id}.json`: optional grouped-lane or nested authoring layout
- `prompts/*.md`: prompt bodies referenced by `promptTemplateFile`, `systemPromptTemplateFile`, or `sessionStartPromptTemplateFile`

Node payload paths are resolved relative to the top-level workflow directory, so nested payloads can still reuse shared prompt files or other workflow-local assets.

## `workflow.json`

Primary top-level authored fields in step-addressed bundles include:

- `workflowId`
- `description`
- `defaults`
- `prompts`
- `managerStepId`
- `entryStepId`
- `nodes`
- `steps`

Validation **rejects** top-level compatibility keys (do not author them), including:

- `managerNodeId`, `entryNodeId`
- `workflowCalls`, `branching`
- `subWorkflows`, `subWorkflowConversations`
- on step-addressed bundles, also `edges` and `loops` at the workflow level

Cross-workflow execution is expressed only through **step-addressed** `steps[].transitions` with `toWorkflowId` and `resumeStepId` (runtime projects these as synthetic call rows; they are not authored as `workflowCalls`).

Relevant current behavior:

- if `steps[]` is authored, `nodes[]` is a reusable registry rather than execution order
- if exactly one manager-role step exists, `managerStepId` may be inferred (step-addressed bundles)
- if no manager exists, `entryStepId` remains required and also acts as the effective manager/entry runtime id
- structural sub-workflow authoring (`subWorkflows` / `subWorkflowConversations`) is **removed**; use step graphs and step transitions for cross-workflow calls
- inline node payload authoring is supported through `workflow.nodes[].node` when `nodeFile` is omitted
- `workflowId` is the runtime namespace key for artifacts and session storage, so it must be filesystem-safe

Step-addressed authored bundles use `entryStepId`, optional `managerStepId`, reusable `workflow.json.nodes[]`, and executable `workflow.json.steps[]`.

Important node-level fields in `workflow.json.nodes[]`:

- `id`
- `nodeFile`
- `addon`

Important step-level fields in `workflow.json.steps[]`:

- `id`
- `nodeId`
- `role`
- `control`
- `transitions`
- `promptVariant`
- `timeoutMs`
- `sessionPolicy`

Role-based authoring note:

- `role` is the authored direction of travel at the step layer: `manager` or `worker`
- reusable node registry entries remain payload references; execution semantics live on steps

## Node Payloads

Current node payload fields include:

- `id`
- `description`
- `nodeType`
- `executionBackend`
- `model`
- `sessionPolicy`
- `systemPromptTemplate` or `systemPromptTemplateFile`
- `promptTemplate` or `promptTemplateFile`
- `sessionStartPromptTemplate` or `sessionStartPromptTemplateFile`
- `variables`
- `argumentsTemplate`
- `argumentBindings`
- `command`
- `container`
- `durability`
- `userAction`
- `timeoutMs`
- `output`

Important current behavior:

- `promptTemplateFile`, `systemPromptTemplateFile`, and `sessionStartPromptTemplateFile` are resolved and loaded during workflow load
- `sessionPolicy.mode: "reuse"` lets compatible agent backends continue the same backend session across repeated executions
- output contracts let the runtime validate business JSON before publishing canonical artifacts and downstream mailbox messages
- `user-action` nodes write user-action request artifacts and pause the workflow until resolution
- optional nodes are scheduler-managed and managers may explicitly execute or skip them through `managerControl` decisions

## Runtime Model

The workflow engine in `src/workflow/engine.ts` currently does the following:

1. Loads and normalizes the workflow bundle from disk.
2. Creates or resumes a persisted session.
3. Seeds the execution queue from the resolved workflow entry node.
4. Assembles mailbox-backed input and prompt text for each node execution.
5. Persists `input.json` before execution.
6. Executes the node with timeout handling and optional backend session reuse.
7. Validates output contracts before runtime-owned publication.
8. Persists node execution artifacts and indexes runtime data in SQLite on a best-effort basis.
9. Publishes downstream communications, advances step-addressed execution targets, runs cross-workflow dispatches derived from step transitions when due, and rebuilds the queue.
10. Marks the workflow completed when the queue drains, or paused/failed/cancelled as needed.

## Runtime Storage

Workflow definitions default to `.divedra/` under the nearest ancestor that
already contains a `.divedra` directory. If no ancestor matches, the current
working directory is treated as the project root.

Root runtime data resolves from, in order:

- `DIVEDRA_ARTIFACT_DIR`
- otherwise `~/.divedra/project/<encoded-project-root>/divedra-artifact/`

By default, the root data directory contributes these locations:

- `workflow/` for execution artifacts
- `sessions/` for persisted session JSON files
- `files/` for attachments
- `divedra.db` for runtime indexes

These can be relocated independently with:

- `DIVEDRA_ARTIFACT_ROOT`
- `DIVEDRA_SESSION_STORE`
- `DIVEDRA_ATTACHMENT_ROOT`
- `DIVEDRA_RUNTIME_DB`

Additional environment variables used by the current codebase include:

- `DIVEDRA_WORKFLOW_ROOT`
- `DIVEDRA_ARTIFACT_ROOT`
- `DIVEDRA_SESSION_STORE`
- `DIVEDRA_ATTACHMENT_ROOT`
- `DIVEDRA_RUNTIME_DB`
- `DIVEDRA_SERVE_HOST`
- `DIVEDRA_SERVE_PORT`
- `DIVEDRA_GRAPHQL_ENDPOINT`
- `DIVEDRA_MANAGER_AUTH_TOKEN`
- `DIVEDRA_MANAGER_SESSION_ID`

## Example Workflows

The current example bundles live under `examples/`. See `examples/README.md` for the full catalog.

Available examples:

- `chat-reply-webhook`
- `worker-only-single-step`
- `workflow-call-simple`
- `workflow-call-review-target`
- `claude-divedra-codex-coding`
- `claude-divedra-claude-worker`
- `same-node-session-echo`
- `subworkflow-chained-simple` (historical name; now a step-addressed grouped-lane example without structural `subWorkflows`)
- `node-combinations-showcase`
- `first-four-arithmetic-pipeline`
- `codex-codex-euthanasia-debate` (step-addressed multi-round debate demo)

Recommended starting point:

- `claude-divedra-codex-coding` shows the preferred mixed-backend split in the step-addressed authored shape, with manager nodes on `claude-code-agent` and implementation work on `codex-agent`

Workflow-call reference:

- `workflow-call-simple` shows a step-addressed managed parent that invokes a worker-only sibling workflow through a cross-workflow step transition (`toWorkflowId` + `resumeStepId`); the engine uses the same cross-workflow dispatch path (deterministic id `__cw:<callerStepId>`) without merging authored call records into the normalized bundle
- `subworkflow-chained-simple` is kept as a historical-name grouped-lane reference; it now uses explicit step-addressed transitions and does not author structural `subWorkflows`

Examples that exercise the full node surface:

- `node-combinations-showcase`
- `first-four-arithmetic-pipeline`

Those bundles exercise authored `command` and `container` nodes directly and can also be run with deterministic mock scenarios.

## Library API

The package root (`import ... from "divedra"`) resolves to the library entry
implemented by `src/lib.ts`. The CLI entry remains available in source form via
`bun run src/main.ts ...` and as the build subpath `divedra/cli`.

Primary package-root exports:

- `inspectWorkflow()`
- `executeWorkflow()`
- `resumeWorkflow()`
- `rerunWorkflow()`
- `getSession()`
- `listSessions()`
- `getRuntimeSessionView()`
- `callWorkflowStep()`
- `createWorkflowExecutionClient()`
- `createNodeAddonPayloadResolver()`
- `createNodeAddonRegistry()`
- `createAsyncNodeAddonPayloadResolver()`
- `createAsyncNodeAddonRegistry()`
- `NodeAddonDefinition`
- `AsyncNodeAddonPayloadResolver`
- `NodeAddonPayloadResolver`
- `NodeAddonResolveInput`
- `NodeAddonResolveResult`
- `WorkflowNodeAddonRef`
- `NodePayload`
- `ValidationIssue`
- `runCli()`
- `startServe()`
- `handleApiRequest()`
- `handleGraphqlRequest()`
- `executeGraphqlDocument()`
- `createGraphqlSchema()`
- `executeGraphqlRequest()`
- `loadWorkflowFromDisk()`
- `deriveWorkflowVisualization()`
- `createCommunicationService()`
- `createManagerSessionStore()`
- `createManagerMessageService()`

Minimal example:

```ts
import { executeWorkflow, getRuntimeSessionView } from "divedra";

const run = await executeWorkflow({
  workflowName: "claude-divedra-codex-coding",
  workflowRoot: "./examples",
  env: process.env,
  runtimeVariables: {
    humanInput: {
      request: "Implement the requested change",
    },
  },
});

const runtime = await getRuntimeSessionView(run.sessionId, {
  cwd: process.cwd(),
  env: process.env,
});

console.log(
  runtime.session.status,
  runtime.nodeExecutions.length,
  runtime.nodeLogs.length,
);
```

## Development

Common commands:

```bash
bun run build
bun run test
bun run typecheck
bun run format:check
```

Environment notes:

- runtime: Bun
- language: TypeScript with strict configuration
- optional shell tooling: Nix flakes + direnv

Design references and implementation notes live under `design-docs/` and `impl-plans/`.
