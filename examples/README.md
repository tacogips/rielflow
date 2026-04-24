# Examples

This directory contains reference workflow bundles that can be validated or run
without copying them into `./.divedra`.

Each example directory also includes `EXPECTED_RESULTS.md`, which records the
stable assertions used for deterministic verification.

Example bundles are currently mixed while the repository completes the
step-addressed cutover:

- most bundles now use `workflow -> steps[] + nodes[]`, where `entryStepId`
  names the authored entry step and `nodes[]` is a reusable registry
- compatibility-only authored bundles are now limited to the
  node-combinations showcase that still relies on ordered-node repeat metadata
  and the explicit legacy structural debate reference
- `workflow-call-simple` is step-addressed except for its intentional
  compatibility `workflowCalls` cross-workflow invocation metadata
- authored `subWorkflows` are omitted except for the explicit legacy
  compatibility reference
- node payload files live under `nodes/` by default
- grouped lane payloads may live under `workflows/*/nodes/`

Explicit legacy-compatibility exception:

- `codex-codex-euthanasia-debate` still uses the structural sub-workflow form
  because `subWorkflowConversations` has not yet been migrated to the
  simplified format

## Available Examples

### `worker-only-single-step`

Minimal runnable reference for a manager-less workflow:

- no authored `managerNodeId`
- explicit `entryStepId: "main-worker"`
- one `codex-agent` worker node runs directly from workflow start
- includes a deterministic mock scenario for validate/inspect/run demos

Validate it:

```bash
bun run src/main.ts workflow validate worker-only-single-step --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect worker-only-single-step --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run worker-only-single-step \
  --workflow-root ./examples \
  --mock-scenario ./examples/worker-only-single-step/mock-scenario.json \
  --output json
```

### `chat-reply-webhook`

Minimal worker-only workflow showing the built-in node add-on catalog:

- no authored `managerNodeId`
- explicit `entryStepId: "reply-to-chat"`
- `steps[]` contains one worker step that targets a reusable node-registry entry
- no workflow-local worker implementation file is needed
- `nodes[].addon.name` selects `divedra/chat-reply-worker`
- the node renders a reply from `runtimeVariables.event`
- when launched through `examples/event-sources`, the webhook source dispatches
  the reply to `DIVEDRA_EXAMPLE_REPLY_ENDPOINT`

Validate it:

```bash
bun run src/main.ts workflow validate chat-reply-webhook --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect chat-reply-webhook --workflow-root ./examples --output json
```

See `examples/event-sources/README.md` for a local webhook event and reply
endpoint demo.

### `workflow-call-simple`

Managed parent workflow reference for explicit workflow invocation. This bundle
has already moved to step-addressed authoring, but it still uses the
compatibility `workflowCalls` runtime path until cross-workflow dispatch is
fully unified under `call-step` semantics:

- `divedra-manager` stays on `claude-code-agent`
- `draft-write` and `apply-review` stay on `codex-agent`
- explicit `managerStepId: "divedra-manager"` and `entryStepId:
"divedra-manager"` define the parent entry
- `steps[]` carries the authored manager-to-draft progression directly
- authored `workflowCalls` remain the only compatibility field in this example
- authored `workflowCalls` invoke the sibling workflow
  `workflow-call-review-target`
- `apply-review` runs when the workflow-call result is delivered back through
  `workflow-call:call-review`
- the bundled deterministic mock scenario covers both the parent and callee
  node ids so the full call chain can be run from one command

Validate it:

```bash
bun run src/main.ts workflow validate workflow-call-simple --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect workflow-call-simple --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run workflow-call-simple \
  --workflow-root ./examples \
  --mock-scenario ./examples/workflow-call-simple/mock-scenario.json \
  --output json
```

### `workflow-call-review-target`

Worker-only callee bundle used by `workflow-call-simple`:

- no authored `managerNodeId`
- explicit `entryStepId: "reviewer"`
- returns its latest succeeded worker result to the caller workflow-call
  contract
- can also be validated, inspected, and run standalone

Validate it:

```bash
bun run src/main.ts workflow validate workflow-call-review-target --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect workflow-call-review-target --workflow-root ./examples --output json
```

Run it standalone with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run workflow-call-review-target \
  --workflow-root ./examples \
  --mock-scenario ./examples/workflow-call-review-target/mock-scenario.json \
  --output json
```

### `subworkflow-chained-simple`

Minimal runnable reference for two sequential grouped lanes in the
step-addressed authored shape. The directory name is historical; this is not
the structural sub-workflow compatibility reference.

- explicit `managerStepId: "divedra-manager"` and `entryStepId: "divedra-manager"`
- `steps[]` carries the alpha-to-beta execution order directly
- grouped lane payloads live under `workflows/alpha/` and `workflows/beta/`

Validate it:

```bash
bun run src/main.ts workflow validate subworkflow-chained-simple --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect subworkflow-chained-simple --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run subworkflow-chained-simple \
  --workflow-root ./examples \
  --mock-scenario ./examples/subworkflow-chained-simple/mock-scenario.json \
  --output json
```

### `claude-divedra-codex-coding`

Recommended mixed-backend reference:

- explicit `managerStepId: "divedra-manager"` and `entryStepId: "divedra-manager"`
- `steps[]` expresses the execution order directly while `nodes[]` stays a reusable registry
- `divedra` manager nodes use `claude-code-agent`
- implementation planning/finalization stays on `claude-code`
- the actual coding node uses `codex-agent`
- the workflow-level `divedraPromptTemplate` explicitly prefers `divedra gql`
- node prompt templates can read upstream mailbox data through `{{inbox.*}}`
- long node prompts live in `prompts/*.md` and are referenced by
  `node-{id}.json.promptTemplateFile`

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

### `node-combinations-showcase`

Validation-oriented reference bundle for the newer node authoring surface:

- compatibility-authored ordered nodes still carry this example because
  node-local `repeat` is not yet part of the strict step-addressed schema
- a node-local `repeat` shows the repeated-iteration pattern for `foreach`
- one task uses `nodeType: "command"`
- one task uses `nodeType: "container"`
- workflow-relative support assets are included for the command script and
  container build context
- node payload files live under `nodes/`

Execution notes:

- live `workflow run` can execute the authored `command` and `container` nodes
  when the local runtime prerequisites are available
- inspect or validate the workflow first to confirm runner readiness in the
  current environment before relying on a live run
- the bundled deterministic mock scenario remains the stable demo path when you
  want reproducible results without depending on local shell or container
  tooling

Validate it:

```bash
bun run src/main.ts workflow validate node-combinations-showcase --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect node-combinations-showcase --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run node-combinations-showcase \
  --workflow-root ./examples \
  --mock-scenario ./examples/node-combinations-showcase/mock-scenario.json \
  --output json
```

### `first-four-arithmetic-pipeline`

Validation-oriented arithmetic pipeline reference:

- explicit `managerStepId: "divedra-manager"` and `entryStepId: "divedra-manager"`
- `steps[]` carries the add, multiply, and divide stages directly
- accepts a human input string containing at least four space-separated numbers
- uses only the first four numbers from that input
- stage 1 uses an `agent` worker to add the first two numbers
- stage 2 uses a `container` worker configured for `podman` to multiply the
  stage 1 result by the third number
- stage 3 uses a `command` worker to divide the stage 2 result by the fourth
  number
- managers treat each stage as an opaque grouped lane and only move scoped
  payloads forward
- stage payloads live under `workflows/add`, `workflows/multiply`, and
  `workflows/divide`
- those nested stage payloads reuse the parent-level `prompts/stage-manager.md`,
  which demonstrates workflow-local asset
  reuse across nested directories

Execution notes:

- live `workflow run` can execute the authored `command` and `container`
  workers when the required local shell and container runner tooling is
  available
- inspect or validate the workflow first to confirm runner readiness in the
  current environment before relying on a live run
- the bundled deterministic mock scenario remains the stable verification path
  when you want reproducible arithmetic results without depending on local
  toolchain availability

Validate it:

```bash
bun run src/main.ts workflow validate first-four-arithmetic-pipeline --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect first-four-arithmetic-pipeline --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run first-four-arithmetic-pipeline \
  --workflow-root ./examples \
  --mock-scenario ./examples/first-four-arithmetic-pipeline/mock-scenario.json \
  --output json
```

### `claude-divedra-claude-worker`

Reference workflow for the case where a regular task node also uses
`claude-code-agent`:

- explicit `managerStepId: "divedra-manager"` and `entryStepId: "divedra-manager"`
- `steps[]` expresses the manager-to-worker handoff directly while `nodes[]` stays reusable
- `divedra` manager nodes use `claude-code-agent`
- the task node `claude-task` also uses `claude-code-agent`
- the bundle includes a deterministic mock scenario for validate/run demos

Validate it:

```bash
bun run src/main.ts workflow validate claude-divedra-claude-worker --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect claude-divedra-claude-worker --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run claude-divedra-claude-worker \
  --workflow-root ./examples \
  --mock-scenario ./examples/claude-divedra-claude-worker/mock-scenario.json \
  --output json
```

### `same-node-session-echo`

Reference workflow for the case where one worker node should run twice:

- explicit `managerStepId: "divedra-manager"` and `entryStepId: "divedra-manager"`
- `steps[]` revisits the shared node-registry entry `echo-session` through
  two distinct steps: `echo-request` and `answer-request`
- `nodes/node-echo-session.json` opts into `sessionPolicy.mode = "reuse"`
- the `answer-request` step explicitly inherits that reusable backend session
  from `echo-request`
- the `answer-request` step also switches to the `answer` prompt variant for
  the second visit
- the first visit echoes the normalized request
- the second visit answers using that earlier echo
- the prompt also reads `{{inbox.latest.output.echoText}}` so the earlier echo is
  available explicitly in workflow data, not only via backend memory

Validate it:

```bash
bun run src/main.ts workflow validate same-node-session-echo --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect same-node-session-echo --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run same-node-session-echo \
  --workflow-root ./examples \
  --mock-scenario ./examples/same-node-session-echo/mock-scenario.json \
  --output json
```

Live execution note:

- the bundled mock scenario demonstrates the repeated same-node control flow
- actual backend session continuation still depends on the configured
  `claude-code-agent` or `codex-agent` backend returning a reusable session id

### `codex-codex-euthanasia-debate`

Legacy compatibility debate bundle for the new node-local prompt split:

- two `codex-agent` speaker nodes debate euthanasia from opposing positions
- the affirmative speaker uses a node-local `systemPromptTemplateFile`
- the negative speaker uses a different node-local `systemPromptTemplateFile`
- both speakers use `sessionStartPromptTemplateFile` with the first-turn wrapper format:
  `##prompt ... ## args ...`
- `subWorkflowConversations.maxTurns = 10` stops the debate after 10 turns

Validate it:

```bash
bun run src/main.ts workflow validate codex-codex-euthanasia-debate --workflow-root ./examples
```

Inspect it:

```bash
bun run src/main.ts workflow inspect codex-codex-euthanasia-debate --workflow-root ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run src/main.ts workflow run codex-codex-euthanasia-debate \
  --workflow-root ./examples \
  --mock-scenario ./examples/codex-codex-euthanasia-debate/mock-scenario.json \
  --output json
```

Live execution note:

- this bundle depends on the configured `codex-agent` backend honoring the remote request body fields sent by this repository, including `systemPromptText`
