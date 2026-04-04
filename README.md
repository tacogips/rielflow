# divedra

`divedra` is a TypeScript/Bun workflow runtime for cooperative multi-agent execution.

The current codebase provides:

- file-based workflow definitions under `.divedra/` or another configured workflow root
- a queue-driven workflow engine with persisted sessions and runtime artifacts
- agent backends for `codex-agent`, `claude-code-agent`, `official/openai-sdk`, and `official/anthropic-sdk`
- a local GraphQL control plane served by Bun
- an OpenTUI-based terminal UI for browsing workflows, runs, and artifacts

## What Is Implemented Today

The source of truth is the implementation under `src/workflow/`, `src/cli.ts`,
`src/graphql/`, `src/server/`, and `src/tui/`.

Current runtime behavior:

- ordered `workflow.json.nodes[]` are the canonical authored flow
- authored `edges` remain supported, but when omitted the loader synthesizes sequential edges
- workflows persist session state, node execution artifacts, communications, and runtime indexes
- manager nodes run inside the queue-based engine rather than replacing it with a pure external orchestrator
- root and sub-workflow boundaries still exist through `managerNodeId`, `subWorkflows`, and related mailbox routing
- `repeat` on a node is supported in the simplified ordered format and synthesizes loop semantics
- `user-action` nodes are supported and pause execution until an external reply resolves the action

Current execution support by node type:

- `agent`: implemented
- `user-action`: implemented as a pause-and-resume runtime state
- `command`: implemented
- `container`: implemented

Additional authored shapes that are recognized but not fully executable:

- `workflowCalls`: validated, but not executable

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
- `session rerun <session-id> <node-id>`
- `serve [workflow-name]`
- `gql <graphql-document>`
- `tui [workflow-name]`
- `call-node <workflow-id> <workflow-run-id> <node-id>`
- `export <workflow-id> <workflow-run-id>`

Useful options:

- `--workflow-root`
- `--artifact-root`
- `--session-store`
- `--variables <path>`
- `--mock-scenario <path>`
- `--output json`
- `--dry-run`
- `--max-steps <n>`
- `--max-loop-iterations <n>`
- `--default-timeout-ms <ms>`

Remote execution support:

- `workflow run`, `session resume`, and `session rerun` can target a remote control plane with `--endpoint`
- `call-node` and `export` are local-only today
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
      node-main-divedra.json
      node-workflow-input.json
      node-workflow-output.json
    prompts/
      divedra-manager.md
      main-divedra.md
      workflow-input.md
      workflow-output.md
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

Current top-level authored fields include:

- `workflowId`
- `description`
- `defaults`
- `prompts`
- `managerNodeId`
- `workflowCalls`
- `subWorkflows`
- `subWorkflowConversations`
- `nodes`
- `edges`
- `loops`
- `branching`

Relevant current behavior:

- if `edges` are omitted, sequential edges are synthesized from node order
- if exactly one manager-role node exists, `managerNodeId` may be inferred
- inline node payload authoring is supported through `workflow.nodes[].node` when `nodeFile` is omitted
- `workflowId` is the runtime namespace key for artifacts and session storage, so it must be filesystem-safe

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

## Runtime Model

The workflow engine in `src/workflow/engine.ts` currently does the following:

1. Loads and normalizes the workflow bundle from disk.
2. Creates or resumes a persisted session.
3. Seeds the execution queue from the root manager.
4. Assembles mailbox-backed input and prompt text for each node execution.
5. Persists `input.json` before execution.
6. Executes the node with timeout handling and optional backend session reuse.
7. Validates output contracts before runtime-owned publication.
8. Persists node execution artifacts and indexes runtime data in SQLite on a best-effort basis.
9. Publishes downstream communications and rebuilds the queue.
10. Marks the workflow completed when the queue drains, or paused/failed/cancelled as needed.

Conversation support:

- `subWorkflowConversations[]` can relay outputs between participant sub-workflow managers
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

- `claude-divedra-codex-coding`
- `claude-divedra-claude-worker`
- `same-node-session-echo`
- `subworkflow-chained-simple`
- `node-combinations-showcase`
- `first-four-arithmetic-pipeline`
- `codex-codex-euthanasia-debate`

Recommended starting point:

- `claude-divedra-codex-coding` shows the preferred mixed-backend split with manager nodes on `claude-code-agent` and implementation work on `codex-agent`

Examples that exercise the full node surface:

- `node-combinations-showcase`
- `first-four-arithmetic-pipeline`

Those bundles exercise authored `command` and `container` nodes directly and can also be run with deterministic mock scenarios.

## Library API

Primary exports from `src/lib.ts`:

- `inspectWorkflow()`
- `executeWorkflow()`
- `resumeWorkflow()`
- `rerunWorkflow()`
- `getSession()`
- `listSessions()`
- `getRuntimeSessionView()`
- `callWorkflowNode()`
- `createWorkflowExecutionClient()`
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
