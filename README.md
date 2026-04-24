# divedra

`divedra` is a TypeScript/Bun workflow runtime for cooperative multi-agent execution.

The current codebase provides:

- file-based workflow definitions under `.divedra/` or another configured workflow root
- a queue-driven workflow engine with persisted sessions and runtime artifacts
- agent backends for `codex-agent`, `claude-code-agent`, `official/openai-sdk`, and `official/anthropic-sdk`
- a local GraphQL control plane served by Bun
- an OpenTUI-based terminal UI for browsing workflows, runs, and artifacts

## Active Design Direction

The current implementation remains the source of truth for shipped behavior, but the active design work in `design-docs/specs/` now targets:

- step-addressed workflows (`workflow.json.steps[]`) with a reusable node registry in `workflow.json.nodes[]`
- jump-driven routing via validated `next.stepId` rather than dedicated branch/loop authoring
- deterministic `code` manager behavior as the default manager mode
- explicit same-session continuation for different steps that intentionally reuse one node
- cross-workflow calls using the same execution-address contract as local step calls by targeting the callee workflow manager step
- migration toward one shared call abstraction for local and cross-workflow dispatch instead of separate long-term paths
- supervised `--auto-improve` execution as a future extension

Those design documents describe the intended next schema and runtime direction; they are not a claim that every item is already implemented in `src/`.

## What Is Implemented Today

The source of truth is the implementation under `src/workflow/`, `src/cli.ts`,
`src/graphql/`, `src/server/`, and `src/tui/`.

Current runtime behavior:

- step-addressed bundles (`workflow.json.steps[]` + reusable `workflow.json.nodes[]`) are the primary authored direction for new workflows, inspection, save/load, and most shipped examples
- ordered `workflow.json.nodes[]`, authored `edges`, and related node-addressed control fields remain available only as compatibility paths while the cutover is still incomplete
- workflows persist session state, node execution artifacts, communications, and runtime indexes
- manager nodes run inside the queue-based engine rather than replacing it with a pure external orchestrator
- authored workflows may use role-based nodes (`manager` / `worker`) and may omit a manager when the authored entry is explicit (`entryStepId` for step-addressed bundles, `entryNodeId` for legacy compatibility bundles)
- manager-less workflows execute today, but the normalized runtime still derives an internal effective manager/entry identity for compatibility
- `call-step` is the primary direct-call surface; `call-node` remains a compatibility wrapper for the older node-addressed runtime contract
- explicit `workflowCalls` still exist as a compatibility-only cross-workflow invocation path in the queue engine while step-addressed cross-workflow dispatch is being unified
- node-local `repeat` remains supported only in the simplified compatibility format and still synthesizes loop semantics
- `user-action` nodes are supported and pause execution until an external reply resolves the action

Current execution support by node type:

- `agent`: implemented
- `user-action`: implemented as a pause-and-resume runtime state
- `command`: implemented
- `container`: implemented
- `addon`: implemented for built-in runtime-provided worker add-ons and
  host-provided third-party addon definitions or resolvers

Additional authored shapes:

- `workflowCalls`: executable workflow-to-workflow invocations. The caller's business payload is exposed to the callee as `runtimeVariables.workflowCall.input`, and `resultNodeId` can receive the callee result through a runtime-owned `workflow-call:<id>` communication.
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

Launch the terminal UI:

```bash
bun run src/main.ts tui
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
- `web serve [workflow-name]`
- `gql <graphql-document>`
- `tui [workflow-name]`
- `call-step <workflow-id> <workflow-run-id> <step-id>`
- `call-node <workflow-id> <workflow-run-id> <node-id>` (compatibility)
- `hook [--vendor claude-code|codex]`
- `events validate`
- `events emit <source-id> --event-file <path>`
- `events serve`
- `events list [--source <id>] [--status <status>] [--limit <n>]`
- `events replay <receipt-id>`

`workflow create <name>` scaffolds a role-based starter with a code-manager default manager node and a `codex-agent` worker node. The generated `workflow.json` prefers the authored-minimal surface and omits compatibility/default fields such as empty `subWorkflows`, synthesized `edges`, default `branching`, and node-level `completion: { "type": "none" }` unless they are needed. Pass `--worker-only` to scaffold a manager-less starter whose authored entry step points at `main-worker`.

`call-step` is the primary direct-call surface during the step-addressed cutover. It accepts targeted continuation controls such as `--prompt-variant <name>`, `--continue-session`, `--timeout-ms <ms>`, and `--resume-node-exec <id>` so a reusable node can be revisited through a specific step with invocation-local overrides.

`call-node` remains available only for compatibility with older node-addressed runtime paths. New direct execution tooling should prefer `call-step`.

`serve` and `web serve` start the local Bun HTTP server. The root page serves a read-only Solid workflow viewer with the workflow node graph, execution run list, and selected run logs.

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

`workflow inspect` surfaces the active cross-workflow count as `workflowCalls`
and labels any remaining structural compatibility count as
`legacySubWorkflows`.

- `--dry-run`
- `--max-steps <n>`
- `--max-loop-iterations <n>`
- `--default-timeout-ms <ms>`
- `--timeout-ms <ms>` for `call-step`
- `--prompt-variant <name>` for `call-step`
- `--continue-session` for `call-step`
- `--resume-node-exec <id>` for `call-step`

Remote execution support:

- `workflow run`, `session resume`, and `session rerun` can target a remote control plane with `--endpoint`
- `call-step`, `call-node`, `session export`, and `session logs` are local-only today
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

## Terminal UI

`divedra tui` is implemented through the OpenTUI stack under `src/tui/`.

Current UI structure is centered on:

- `src/tui/opentui-screen.ts`
- `src/tui/opentui-controller.ts`
- `src/tui/opentui-solid-app.tsx`
- `src/tui/components/*.tsx`

The TUI can browse workflow definitions, workflow runs, node details, and runtime history. When OpenTUI dependencies are unavailable or the process is not running in a suitable interactive terminal mode, the CLI uses its fallback behavior instead of the full screen app.

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

- `workflow.json`: canonical workflow structure, control-flow definition, and node ordering
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

Legacy/compatibility node-addressed bundles may still include:

- `managerNodeId`
- `entryNodeId`
- `workflowCalls`
- `subWorkflows`
- `subWorkflowConversations`
- `nodes`
- `edges`
- `loops`
- `branching`

Relevant current behavior:

- if `steps[]` is authored, `nodes[]` is a reusable registry rather than execution order
- if a legacy compatibility bundle omits `edges`, sequential edges are synthesized from node order
- if exactly one manager-role node exists, `managerNodeId` may be inferred
- if no manager exists, compatibility node-addressed bundles require `entryNodeId`, while step-addressed bundles require `entryStepId`
- non-empty authored `subWorkflows` are reserved for legacy structural compatibility and should not be combined with authored role/control nodes
- non-empty authored `subWorkflowConversations` are also reserved for legacy structural compatibility and should not be combined with authored role/control nodes
- authored `subWorkflowConversations` remain legacy structural compatibility metadata and are not part of the active role-authored `workflowCalls` path
- structural boundary `kind` values `subworkflow-manager`, `input`, and `output` are reserved for legacy compatibility and should not be combined with authored role/control nodes
- inline node payload authoring is supported through `workflow.nodes[].node` when `nodeFile` is omitted
- `workflowId` is the runtime namespace key for artifacts and session storage, so it must be filesystem-safe

Step-addressed authored bundles use `entryStepId`, optional `managerStepId`, reusable `workflow.json.nodes[]`, and executable `workflow.json.steps[]`. The repository is still in a mixed transitional state, so inspection/load/save already understand both shapes while the runtime and a small set of shipped compatibility examples still retain older projections.

Important node-level fields in `workflow.json.nodes[]`:

- `id`
- `nodeFile`
- `kind`
- `role`
- `control`
- `completion`
- `execution`
- `group`
- `repeat`

Current `kind` values:

- `task`
- `branch-judge`
- `loop-judge`
- `root-manager`
- `subworkflow-manager`
- `input`
- `output`

Role-based authoring note:

- `role` is the authored direction of travel: `manager` or `worker`
- role/control-authored workflows should omit structural boundary `kind` values
- `kind` still appears in normalized runtime structures while the engine retains structural sub-workflow compatibility paths

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
9. Publishes downstream communications, advances step-addressed execution targets, still honors compatibility-authored `workflowCalls` when present, and rebuilds the queue.
10. Marks the workflow completed when the queue drains, or paused/failed/cancelled as needed.

Legacy structural conversation support:

- `subWorkflowConversations[]` can relay outputs between participant sub-workflow managers for explicitly legacy structural bundles
- turn emission is gated by newer successful outputs and conversation stop conditions

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
- `codex-codex-euthanasia-debate` (legacy structural compatibility)

Recommended starting point:

- `claude-divedra-codex-coding` shows the preferred mixed-backend split in the step-addressed authored shape, with manager nodes on `claude-code-agent` and implementation work on `codex-agent`

Workflow-call reference:

- `workflow-call-simple` shows a step-addressed managed parent that still uses the compatibility `workflowCalls` path to call a worker-only sibling workflow and resume from the returned result
- `subworkflow-chained-simple` is kept as a historical-name grouped-lane reference; it now uses explicit step-addressed transitions and does not author structural `subWorkflows`

Legacy compatibility reference:

- `codex-codex-euthanasia-debate` remains as an explicitly legacy structural example until `subWorkflowConversations` is migrated away from structural sub-workflow boundaries

Repeat-based compatibility reference:

- `node-combinations-showcase` still uses compatibility-only ordered-node authoring metadata for node-local `repeat`

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
- `callWorkflowNode()`
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
task tui
task tui-examples
```

Environment notes:

- runtime: Bun
- language: TypeScript with strict configuration
- optional shell tooling: Nix flakes + direnv

Design references and implementation notes live under `design-docs/` and `impl-plans/`.
