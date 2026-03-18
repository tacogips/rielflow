# divedra

`divedra` is a TypeScript/Bun workflow runtime for cooperative multi-agent execution.

The current implementation executes JSON-defined workflows with:

- queue-based node scheduling
- mailbox-style communication artifacts between nodes
- runtime-owned output validation and publication
- root-manager and sub-workflow-manager control scopes
- optional conversation rounds between sub-workflows

Primary agent backends:

- `codex-agent`
- `claude-code-agent`
- `official/openai-sdk`
- `official/anthropic-sdk`

## Current Runtime Model

The source of truth is the implementation under `src/workflow/`.

The current runtime is not a purely manager-driven `call-node` orchestrator. The main `workflow run` path uses a persisted session with a deduplicated execution queue, transition communications, and runtime-owned artifact publication. Manager nodes still matter, but they operate inside that queue-based engine rather than replacing it.

## Workflow Bundle

Workflows live under `<workflow-root>/<workflow-name>/`.

Typical layout:

```text
.divedra/
  my-workflow/
    workflow.json
    workflow-vis.json
    node-divedra-manager.json
    node-main-divedra.json
    node-workflow-input.json
    node-workflow-output.json
    prompts/
      divedra-manager.md
      main-divedra.md
      workflow-input.md
      workflow-output.md
```

Files:

- `workflow.json`: canonical workflow structure and control-flow definition
- `workflow-vis.json`: browser/editor vertical ordering metadata
- `node-{id}.json`: per-node execution payload
- `prompts/*.md`: optional prompt bodies referenced by `promptTemplateFile`

Implementation note:

- `workflow-vis.json` is the canonical editor file, but the loader can synthesize a default vertical order when it is missing.

## `workflow.json`

Current top-level fields:

- `workflowId`
- `description`
- `defaults`
  - `maxLoopIterations`
  - `nodeTimeoutMs`
  - optional `containerRuntime`
- optional `prompts`
  - `divedraPromptTemplate`
  - `workerSystemPromptTemplate`
- `managerNodeId`
- `subWorkflows`
- optional `subWorkflowConversations`
- `nodes`
- `edges`
- optional `loops`
- `branching`
  - currently only `mode: "fan-out"`

Fields such as `workflowType`, `nodeGroups`, and workflow-ref child workflows are not part of the current authored schema, even though older docs mentioned them.

## Node Kinds

`workflow.json.nodes[].kind` describes a node's structural role. It is separate from `node-{id}.json.nodeType`, which describes how the node would execute.

Current kinds:

- `task`: ordinary work node
- `branch-judge`: emits booleans used by outgoing branch edges
- `loop-judge`: emits booleans used by `loops[]`
- `root-manager`: top-level workflow manager referenced by `workflow.managerNodeId`
- `sub-divedra-manager`: manager that owns one sub-workflow boundary
- `input`: normalizes inbound mailbox/runtime data for a workflow scope
- `output`: assembles the final payload for a workflow scope
- `manager`: legacy alias still accepted during transition

Practical meaning:

- `root-manager` starts the workflow run and can auto-start eligible sub-workflows.
- `sub-divedra-manager` owns one sub-workflow's internal routing and may deliver work to its child `input` node.
- `input` nodes turn mailbox/runtime input into clean scope-local payloads.
- `output` nodes publish the result of a root workflow or sub-workflow boundary.
- `branch-judge` and `loop-judge` are ordinary executed nodes whose outputs drive control flow.

## `node-{id}.json`

Current node payload fields:

- `id`
- optional `nodeType`: `agent` | `command` | `container` (`agent` by default)
- optional `executionBackend`
- optional `model`
- optional `sessionPolicy`
  - `mode: "new" | "reuse"`
- optional `promptTemplate`
- optional `promptTemplateFile`
- `variables`
- optional `command`
- optional `container`
- optional `durability`
- optional `argumentsTemplate`
- optional `argumentBindings`
- optional `templateEngine`
- optional `timeoutMs`
- optional `output`

Execution status today:

- `agent` nodes are the only executable node type in the main runtime.
- `command` and `container` shapes are validated at schema level, but `runWorkflow()` currently fails those nodes explicitly instead of executing them.
- when `promptTemplateFile` is present, the loader resolves it and injects the file contents into the effective `promptTemplate`.

## Output Contracts

`node.output` lets the runtime validate publishable business output.

Supported fields:

- `description`
- `jsonSchema`
- `maxValidationAttempts`

Runtime behavior:

1. The adapter proposes either inline JSON payload or a reserved candidate file path.
2. The runtime validates the candidate object.
3. Only after validation succeeds does the runtime write canonical `output.json`.
4. Only the runtime publishes mailbox output artifacts for downstream nodes.
5. Invalid contract output can be retried within the same node execution attempt budget.

## Branch, Loop, and Completion Semantics

Branch expressions and loop expressions are evaluated from node output using:

- identifiers such as `needs_review`
- `always`, `never`, `true`, `false`
- `!`, `&&`, `||`, and parentheses

Lookup order:

- first `output.when.<name>`
- then top-level `output.<name> === true`

Completion rules:

- `none`
- `checklist` with `config.required`
- `score-threshold` with `config.threshold`
- `validator-result` with optional `config.resultField`

Loop rules:

- `judgeNodeId`
- `continueWhen`
- `exitWhen`
- optional `maxIterations`
- optional `backoffMs` in schema, although the current engine does not sleep on loop rules directly

When a `loop-judge` runs, the engine resolves `continue` or `exit` using the loop rule and falls back to other matched edges only when neither loop condition applies.

## Sub-Workflows

`subWorkflows[]` is the current structural boundary model. Each sub-workflow declares:

- `id`
- `description`
- `managerNodeId`
- `inputNodeId`
- `outputNodeId`
- `nodeIds`
- `inputSources`
- optional `block`
  - `type: "plain" | "branch-block" | "loop-body"`
  - optional `loopId` for loop bodies

Current behavior:

- `plain` sub-workflows can be auto-started by the root manager when their `inputSources` are satisfied.
- `branch-block` sub-workflows are structural branch bodies and must be entered from a `branch-judge`.
- `loop-body` sub-workflows are structural loop bodies and must align with a `loops[].id`.
- cross-scope edges must target the recipient manager boundary, not arbitrary internal child nodes.

Supported `inputSources[].type` values:

- `human-input`
- `workflow-output`
- `node-output`
- `sub-workflow-output`

## Conversation Rounds

`subWorkflowConversations[]` lets the runtime relay outputs between sub-workflow managers after manager-node execution.

Current implementation behavior:

- participants are listed by sub-workflow id
- turn order is round-robin by participant order
- the runtime sends at most one new turn per conversation-round evaluation
- a new turn is emitted only when the sender has a newer succeeded `outputNodeId` result that has not already been sent
- `stopWhen` is evaluated against a small runtime context such as `turns_exhausted`

## Execution Sequence

This is the current `workflow run` sequence in `src/workflow/engine.ts`.

1. The loader resolves `workflow.json`, `workflow-vis.json`, all `node-{id}.json` files, and any `promptTemplateFile` references.
2. A session is created with the initial queue entry set to `workflow.managerNodeId`.
3. If `runtimeVariables.humanInput` is present, the runtime writes an external-mailbox input artifact and delivers it to the root manager as the first communication.
4. The engine pops the next node id from the queue, loads upstream communications for that node, assembles input bindings, and composes the final prompt text.
5. The runtime writes `input.json` before execution.
6. Manager nodes receive a scoped manager session and ambient GraphQL control-plane environment for that node execution only.
7. The adapter executes the node with timeout handling and optional backend-session reuse.
8. If the node declares an output contract, the runtime validates candidate output, records retry artifacts, and retries invalid output when attempts remain.
9. The runtime writes `output.json`, `meta.json`, `handoff.json`, and `commit-message.txt`, and indexes the execution in SQLite on a best-effort basis.
10. Completion rules are checked. Failure here terminates the workflow run.
11. Upstream communications consumed by the node are marked as consumed.
12. All matched outgoing edges publish mailbox communications for their recipients.
13. If the node is a manager, the runtime may:
    - auto-start eligible sub-workflows
    - deliver payloads to child input nodes
    - honor validated `managerControl.actions`
    - generate conversation-turn deliveries
14. The queue is rebuilt from:
    - remaining queued nodes
    - matched edge targets
    - manager-planned child inputs
    - conversation-planned manager nodes
    - manager-requested retry targets
15. The queue is deduplicated and the updated session is persisted.
16. When the queue becomes empty, the session is marked `completed` and the latest succeeded root-scope `output` node is published to the external workflow-output mailbox.

Failure and retry behavior:

- timed-out nodes can be restarted automatically as "stuck" retries
- invalid output-contract payloads can be retried within `maxValidationAttempts`
- failed completion rules or failed manager-control validation terminate the session

## Mailbox and Runtime Artifacts

Default runtime roots:

- workflow definitions: `.divedra/`
- runtime data root: `.divedra-datas/`
- execution artifacts: `.divedra-datas/workflow/`
- session store: `.divedra-datas/sessions/`
- runtime DB: `.divedra-datas/divedra.db`

Per-node execution artifacts:

- `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{nodeId}/{nodeExecId}/input.json`
- `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{nodeId}/{nodeExecId}/output.json`
- `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{nodeId}/{nodeExecId}/meta.json`
- optional `output-attempts/`
- `handoff.json`
- `commit-message.txt`

Per-communication artifacts:

- `message.json`
- `outbox/<fromNodeId>/message.json`
- `outbox/<fromNodeId>/output.json`
- `inbox/<toNodeId>/message.json`
- `attempts/<deliveryAttemptId>/attempt.json`
- `attempts/<deliveryAttemptId>/receipt.json`
- `meta.json`

Communication routing scopes:

- `external-mailbox`
- `parent-to-sub-workflow`
- `intra-sub-workflow`
- `cross-sub-workflow`

## Example Bundles

The repository includes multiple reference bundles under `examples/`.

Runnable mixed-backend reference:

- `examples/claude-divedra-codex-coding/workflow.json`
- `examples/claude-divedra-codex-coding/workflow-vis.json`
- `examples/claude-divedra-codex-coding/node-*.json`
- `examples/claude-divedra-codex-coding/mock-scenario.json`

This bundle shows the recommended split:

- manager nodes on `claude-code-agent`
- coding work on `codex-agent`
- prompt bodies stored in `prompts/*.md`
- mailbox-driven handoff between `input`, `task`, and `output` nodes

Validate it:

```bash
bun run src/main.ts workflow validate claude-divedra-codex-coding --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect claude-divedra-codex-coding --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run claude-divedra-codex-coding \
  --workflow-root ./examples \
  --mock-scenario ./examples/claude-divedra-codex-coding/mock-scenario.json \
  --output json
```

Validation-oriented node-authoring showcase:

- `examples/node-combinations-showcase/workflow.json`
- `examples/node-combinations-showcase/workflow-vis.json`
- `examples/node-combinations-showcase/node-*.json`
- `examples/node-combinations-showcase/prompts/*.md`

This bundle keeps the graph small while showing:

- sibling plain sub-workflows as the current fan-out/concurrent-style pattern
- a `loop-body` sub-workflow as the current repeated-iteration pattern used in
  place of a first-class `foreach` field
- one `command` node payload
- one `container` node payload with workflow-level `containerRuntime`

Current limitation:

- `command` and `container` nodes are authorable and validatable
- `runWorkflow()` still rejects them explicitly, so this showcase is intended
  for `workflow validate` and `workflow inspect`, not for end-to-end execution

Validate it:

```bash
bun run src/main.ts workflow validate node-combinations-showcase --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect node-combinations-showcase --workflow-root ./examples --output json
```

## Interfaces

- `divedra workflow run <workflow-name>`
  - queue-based workflow execution
- `divedra session progress <session-id>`
  - inspect persisted session state
- `divedra session resume <session-id>`
  - resume a paused session
- `divedra session rerun <session-id> <node-id>`
  - start a new session from a chosen node
- `divedra call-node <workflow-id> <workflow-run-id> <node-id>`
  - local direct node execution path for an existing workflow run
- `divedra serve`
  - browser UI + local GraphQL control plane
- `divedra gql "<document>"`
  - GraphQL client for local manager/control-plane operations
- `divedra tui`
  - terminal UI over the same workflow runtime

## GraphQL and Browser UI

The local server serves the browser app and exposes `/graphql`.

Important transport rules:

- `divedra gql` forwards `DIVEDRA_MANAGER_SESSION_ID` as `X-Divedra-Manager-Session-Id`
- manager auth is established from HTTP transport metadata, not from the server process environment
- `/api/ui-config` remains a small bootstrap endpoint for the browser, while workflow/session domain operations use GraphQL

Frontend tooling:

- `bun run ui:framework`
- `bun run typecheck:ui`
- `bun run test:ui`
- `bun run check:ui`
- `bun run build:ui`

## Library API

Primary exports from `src/lib.ts`:

- `inspectWorkflow(workflowName, options)`
- `executeWorkflow({ workflowName, ...options })`
- `resumeWorkflow({ sessionId, ...options })`
- `rerunWorkflow({ sourceSessionId, fromNodeId, ...options })`
- `getSession(sessionId, options)`
- `listSessions(options)`
- `getRuntimeSessionView(sessionId, options)`

Minimal example:

```ts
import { executeWorkflow, getRuntimeSessionView } from "divedra";

const run = await executeWorkflow({
  workflowName: "claude-divedra-codex-coding",
  workflowRoot: "./examples",
  artifactRoot: "./.divedra-datas/workflow",
  runtimeVariables: { humanInput: "Implement the requested change" },
});

const runtime = await getRuntimeSessionView(run.sessionId, {
  cwd: process.cwd(),
});

console.log(
  runtime.session.status,
  runtime.nodeExecutions.length,
  runtime.nodeLogs.length,
);
```

## Design Documents

- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-data-model.md`
- `design-docs/specs/design-tui.md`

## Development Environment

- runtime: Bun
- language: TypeScript with strict configuration
- optional environment tooling: Nix flakes + direnv
