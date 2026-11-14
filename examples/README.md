# Examples

This directory contains reference workflow bundles that can be validated or run
without copying them into `./.divedra`.

Each workflow example directory also includes `EXPECTED_RESULTS.md`, which
records the stable assertions used for deterministic verification. Support
directories such as `auto-improve/`, `default-supervisor-dispatcher/`, and
`event-sources/` document cross-workflow demos and fixtures.

Shipped reference bundles use the step-addressed authored shape; repository
tests may still construct legacy fixtures under explicit non-strict validation.

- most bundles use `workflow -> steps[] + nodes[]`, where `entryStepId`
  names the authored entry step and `nodes[]` is a reusable registry
- `workflow-call-simple` is fully step-addressed; cross-workflow invocation is
  authored as a `steps[].transitions[]` entry with `toWorkflowId` and
  `resumeStepId` (executed as a derived cross-workflow dispatch at runtime; not stored on `workflow.workflowCalls`)
- shipped workflow bundles omit structural `subWorkflows` and
  `subWorkflowConversations`; multi-round demos use explicit steps (for example a
  judge step with labeled `transitions`, as in `codex-codex-topic-debate` and
  the foreach lane in `node-combinations-showcase`)
- node payload files live under `nodes/` by default
- grouped lane payloads may live under `workflows/*/nodes/`

## Available Examples

### `worker-only-single-step`

Minimal runnable reference for a manager-less workflow:

- no authored `managerStepId`
- explicit `entryStepId: "main-worker"`
- one `codex-agent` worker node runs directly from workflow start
- includes a deterministic mock scenario for validate/inspect/run demos

Validate it:

```bash
bun run packages/divedra/src/bin.ts workflow validate worker-only-single-step --workflow-definition-dir ./examples
```

Inspect it:

```bash
bun run packages/divedra/src/bin.ts workflow inspect worker-only-single-step --workflow-definition-dir ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run worker-only-single-step \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/worker-only-single-step/mock-scenario.json \
  --output json
```

### `supervised-mock-retry`

Same shape as `worker-only-single-step`, but the bundled `mock-scenario.json` is
a **two-entry sequence** for the worker: the first entry forces a failure; after
a supervised outer rerun, the second entry returns success. Use with
`--auto-improve` to exercise the failure-to-rerun path without custom adapters.
See `examples/auto-improve/README.md` and `examples/supervised-mock-retry/EXPECTED_RESULTS.md`.

### `default-superviser`

Minimal **phase-2 nested superviser** reference bundle (`workflowId`:
`divedra-default-superviser`): one step invokes `divedra/start-workflow` so a
nested superviser run can start the paired target when the engine injects
`supervisionRunId`, `targetSessionId`, and `superviserTargetWorkflowId` (see
`examples/auto-improve/README.md` and `examples/default-superviser/EXPECTED_RESULTS.md`). Not
a standalone runnable demo without a supervised target and those variables.

### `default-supervisor-dispatcher` (demo index)

Cross-cutting **supervisor-dispatch** demo documented under
`examples/default-supervisor-dispatcher/`:

- supervisor workflow `divedra-default-workflow-supervisor`
- resolver stub `dispatcher-llm-resolver-stub`
- managed catalog entry pointing at `worker-only-single-step`
- profile and binding under `examples/event-sources/.divedra-events/`

See that directory's `README.md` for `events validate` / `events emit` examples.

### `divedra-default-workflow-supervisor`

Minimal manager workflow bundle matching the design-default supervisor id. Used
by the dispatcher demo and validated like other reference workflows. Local
supervised lifecycle control is deterministic and in-process; this workflow id is
the supervisor identity, not a child `divedra` process manager:

```bash
bun run packages/divedra/src/bin.ts workflow validate divedra-default-workflow-supervisor --workflow-definition-dir ./examples
```

### `dispatcher-llm-resolver-stub`

Single-worker bundle referenced as the LLM resolver target for
`webhook-supervisor-dispatch-demo`. Pair with mock scenarios under
`default-supervisor-dispatcher/`.

### `chat-reply-webhook`

Minimal worker-only workflow showing the built-in node add-on catalog:

- no authored `managerStepId`
- explicit `entryStepId: "reply-to-chat"`
- `steps[]` contains one worker step that targets a reusable node-registry entry
- no workflow-local worker implementation file is needed
- `nodes[].addon.name` selects `divedra/chat-reply-worker`
- the node renders a reply from `runtimeVariables.event`
- when launched through `examples/event-sources`, the webhook source dispatches
  the reply to `DIVEDRA_EXAMPLE_REPLY_ENDPOINT`

Validate it:

```bash
bun run packages/divedra/src/bin.ts workflow validate chat-reply-webhook --workflow-definition-dir ./examples
```

Inspect it:

```bash
bun run packages/divedra/src/bin.ts workflow inspect chat-reply-webhook --workflow-definition-dir ./examples --output json
```

See `examples/event-sources/README.md` for a local webhook event and reply
endpoint demo.

### `matrix-chat-reply`

Element/Matrix worker-only workflow showing the same built-in reply add-on
through a real Matrix receive/send path:

- receives text-like Matrix `m.room.message` events from the `matrix` event
  source
- renders a reply from `runtimeVariables.event`
- sends the reply back to the configured Matrix room through a chat destination
- includes a Docker Compose Synapse harness under `local-synapse/`

Validate it:

```bash
bun run packages/divedra/src/bin.ts workflow validate matrix-chat-reply --workflow-definition-dir ./examples
```

Run the local Matrix verification:

```bash
./examples/matrix-chat-reply/local-synapse/run-local-matrix-sample.sh
```

### `chat-supervisor-collaboration`

Chat-triggered supervisor collaboration reference:

- event binding emits natural chat lifecycle replies: received, plan or clarification, then starting
- Workflow A and Workflow B brainstorm as separate personas
- Workflow C turns their outputs into a specification and requests review through chat destinations
- external event/output destinations stay separate from internal workflow mail

Validate the workflow and event binding:

```bash
bun run packages/divedra/src/bin.ts workflow validate chat-supervisor-collaboration --workflow-definition-dir ./examples
bun run packages/divedra/src/bin.ts events validate \
  --workflow-definition-dir ./examples \
  --event-root ./examples/chat-supervisor-collaboration/.divedra-events
```

Run the deterministic workflow scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run chat-supervisor-collaboration \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/chat-supervisor-collaboration/mock-scenario.json \
  --output json
```

### `workflow-call-simple`

Managed parent workflow reference for cross-workflow invocation in the
step-addressed authored shape:

- `divedra-manager` stays on `claude-code-agent`
- `draft-write` and `apply-review` stay on `codex-agent`
- explicit `managerStepId: "divedra-manager"` and `entryStepId:
"divedra-manager"` define the parent entry
- `steps[]` carries the authored manager-to-draft progression directly
- `draft-write` declares a cross-workflow transition targeting
  `workflow-call-review-target` (`toStepId: "reviewer"`) with
  `resumeStepId: "apply-review"`
- the engine executes that transition using the deterministic runtime workflow-call id
  `__cw:draft-write`; session communications use
  `transitionWhen = "workflow-call:__cw:draft-write"`
- the bundled deterministic mock scenario covers both the parent and callee
  node ids so the full call chain can be run from one command

Validate it:

```bash
bun run packages/divedra/src/bin.ts workflow validate workflow-call-simple --workflow-definition-dir ./examples
```

Inspect it:

```bash
bun run packages/divedra/src/bin.ts workflow inspect workflow-call-simple --workflow-definition-dir ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run workflow-call-simple \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/workflow-call-simple/mock-scenario.json \
  --output json
```

### `workflow-call-review-target`

Worker-only callee bundle used by `workflow-call-simple`:

- no authored `managerStepId`
- explicit `entryStepId: "reviewer"`
- returns its latest succeeded worker result to the caller workflow-call
  contract
- can also be validated, inspected, and run standalone

Validate it:

```bash
bun run packages/divedra/src/bin.ts workflow validate workflow-call-review-target --workflow-definition-dir ./examples
```

Inspect it:

```bash
bun run packages/divedra/src/bin.ts workflow inspect workflow-call-review-target --workflow-definition-dir ./examples --output json
```

Run it standalone with the bundled deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run workflow-call-review-target \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/workflow-call-review-target/mock-scenario.json \
  --output json
```

### `design-and-implement-review-loop`

Real development workflow sample adapted from the project-local workflow catalog:

- starts with issue intake and design-document update
- can call `design-and-implement-review-loop-feature-plan` for bounded
  feature-plan fanout
- runs self-review and independent review gates before implementation
- creates and reviews an implementation plan before coding
- delegates implementation to `codex-agent`
- refreshes documentation, prepares a commit message, then uses the built-in
  `divedra/git-commit` and `divedra/git-push` add-ons
- includes deterministic mock scenarios for full issue resolution and
  planning-only execution

Validate it:

```bash
bun run packages/divedra/src/bin.ts workflow validate design-and-implement-review-loop --workflow-definition-dir ./examples
```

Run the full deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run design-and-implement-review-loop \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/design-and-implement-review-loop/mock-scenario.json \
  --output json
```

Live execution note:

- this workflow can create commits and push them when run with live backends;
  use the bundled mock scenarios for deterministic sample verification

### `design-and-implement-review-loop-feature-plan`

Worker-only companion workflow used by the bounded fanout path in
`design-and-implement-review-loop`:

- no authored manager step
- starts at `step2-design-doc-update`
- loops through design self-review, independent design review, implementation
  plan creation, plan self-review, and independent plan review
- returns a feature-local design and implementation-plan result to the caller

Validate it:

```bash
bun run packages/divedra/src/bin.ts workflow validate design-and-implement-review-loop-feature-plan --workflow-definition-dir ./examples
```

### `recent-change-quality-loop`

Real development workflow sample for reviewing recent repository changes:

- reviews committed changes from a configurable recent time window plus
  uncommitted changes
- routes through an exit gate that detects high or mid severity findings
- delegates blocking findings to `design-and-implement-review-loop` through a
  cross-workflow transition
- resumes after the delegated fix, then re-runs review until no blocking
  finding remains

Validate it:

```bash
bun run packages/divedra/src/bin.ts workflow validate recent-change-quality-loop --workflow-definition-dir ./examples
```

Run it with the bundled deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run recent-change-quality-loop \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/recent-change-quality-loop/mock-scenario.json \
  --output json
```

Live execution note:

- because this workflow delegates to `design-and-implement-review-loop`, live
  execution can also create commits and push them through that delegated
  workflow

### `subworkflow-chained-simple`

Minimal runnable reference for two sequential grouped lanes in the
step-addressed authored shape. The directory name is historical; this is not
the structural sub-workflow compatibility reference.

- explicit `managerStepId: "divedra-manager"` and `entryStepId: "divedra-manager"`
- `steps[]` carries the alpha-to-beta execution order directly
- grouped lane payloads live under `workflows/alpha/` and `workflows/beta/`

Validate it:

```bash
bun run packages/divedra/src/bin.ts workflow validate subworkflow-chained-simple --workflow-definition-dir ./examples
```

Inspect it:

```bash
bun run packages/divedra/src/bin.ts workflow inspect subworkflow-chained-simple --workflow-definition-dir ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run subworkflow-chained-simple \
  --workflow-definition-dir ./examples \
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
- the workflow-level `divedraPromptTemplate` explicitly prefers `divedra graphql`
- node prompt templates can read upstream mailbox data through `{{inbox.*}}`
- long node prompts live in `prompts/*.md` and are referenced by
  `node-{id}.json.promptTemplateFile`

Validate it:

```bash
bun run packages/divedra/src/bin.ts workflow validate claude-divedra-codex-coding --workflow-definition-dir ./examples
```

Inspect it:

```bash
bun run packages/divedra/src/bin.ts workflow inspect claude-divedra-codex-coding --workflow-definition-dir ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run claude-divedra-codex-coding \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/claude-divedra-codex-coding/mock-scenario.json \
  --output json
```

### `node-combinations-showcase`

Validation-oriented reference bundle in the step-addressed authored shape:

- `managerStepId` / `entryStepId` plus explicit `steps[]` transitions (the
  foreach lane uses two labeled transitions from the judge step:
  `continue_items` back to `foreach-manager` and `!(continue_items)` forward to
  `foreach-output`, matching the former repeat-edge semantics)
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
bun run packages/divedra/src/bin.ts workflow validate node-combinations-showcase --workflow-definition-dir ./examples
```

Inspect it:

```bash
bun run packages/divedra/src/bin.ts workflow inspect node-combinations-showcase --workflow-definition-dir ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run node-combinations-showcase \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/node-combinations-showcase/mock-scenario.json \
  --output json
```

### `scheduled-sleep`

Minimal scheduled continuation workflow:

- `wait` uses `nodeType: "sleep"` with `sleep.durationMs`
- the runtime records a pending `workflow-sleep` scheduled event and returns
  while the workflow session is paused
- when the shared scheduled event manager fires the event, the session resumes
  and runs `worker`
- cancellation only applies to pending scheduled events, so firing, fired,
  failed, and already-cancelled event states remain visible for inspection

Run it with the bundled deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run scheduled-sleep \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/scheduled-sleep/mock-scenario.json \
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
bun run packages/divedra/src/bin.ts workflow validate first-four-arithmetic-pipeline --workflow-definition-dir ./examples
```

Inspect it:

```bash
bun run packages/divedra/src/bin.ts workflow inspect first-four-arithmetic-pipeline --workflow-definition-dir ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run first-four-arithmetic-pipeline \
  --workflow-definition-dir ./examples \
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
bun run packages/divedra/src/bin.ts workflow validate claude-divedra-claude-worker --workflow-definition-dir ./examples
```

Inspect it:

```bash
bun run packages/divedra/src/bin.ts workflow inspect claude-divedra-claude-worker --workflow-definition-dir ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run claude-divedra-claude-worker \
  --workflow-definition-dir ./examples \
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
bun run packages/divedra/src/bin.ts workflow validate same-node-session-echo --workflow-definition-dir ./examples
```

Inspect it:

```bash
bun run packages/divedra/src/bin.ts workflow inspect same-node-session-echo --workflow-definition-dir ./examples --output json
```

Run it with the bundled deterministic scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run same-node-session-echo \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/same-node-session-echo/mock-scenario.json \
  --output json
```

Live execution note:

- the bundled mock scenario demonstrates the repeated same-node control flow
- actual backend session continuation still depends on the configured
  `claude-code-agent` or `codex-agent` backend returning a reusable session id

### `codex-codex-topic-debate`

Live-agent topic debate bundle for runtime-provided debate prompts. This is the
canonical debate example and replaces the older hard-coded topic variant:

- two `codex-agent` speaker lanes use `gpt-5.3-codex-spark`
- the topic comes from `runtimeVariables.humanInput.request`
- the speaker lanes remain grouped under `workflows/*/nodes/`
- speaker nodes bind `arguments.topic` from the normalized input step
- speakers use node-local `systemPromptTemplateFile` and
  `sessionStartPromptTemplateFile` prompt assets
- output contracts force debate handoff payloads into structured JSON
- `debate-judge` returns business JSON with `continue_debate`; branch routing
  falls back to payload booleans when no adapter `when` flag is present

Validate it:

```bash
bun run packages/divedra/src/bin.ts workflow validate codex-codex-topic-debate --workflow-definition-dir ./examples
```

Run it with live backend execution:

```bash
bun run packages/divedra/src/bin.ts workflow run codex-codex-topic-debate \
  --workflow-definition-dir ./examples \
  --variables '{"humanInput":{"request":"Debate immigration policy. The affirmative side should argue for more open immigration with managed legal pathways, and the negative side should argue for stricter border and asylum controls."}}' \
  --output json
```

Live execution note:

- this bundle depends on the configured `codex-agent` backend honoring the remote request body fields sent by this repository, including `systemPromptText`
