# Chat Task Planning Lifecycle

This document defines the feature-local design for natural chat-originated task
handling and supervisor collaboration over chat destinations.

## Overview

Chat-originated tasks should produce conversational lifecycle replies before a
workflow starts, while still preserving divedra's runtime-owned event and
workflow-mail boundaries. The runtime or supervisor owns these replies as
explicit `external-output` publications. Internal workflow output mail remains
execution data only and is never treated as provider delivery.

The feature also provides a ready-to-run collaboration workflow bundle where
two persona-driven supervisors brainstorm independently, a third workflow turns
their chat discussion into specification and implementation work, and the third
workflow asks the first two supervisors for review.

## Goals

- Acknowledge accepted chat tasks with a `received` reply before planning.
- Decide whether the task is ready, needs clarification, or should not start.
- Publish either a `plan-or-question` reply or a clarification reply before
  workflow execution.
- Publish a `starting` reply only after required information is present and the
  target workflow or supervisor route has been selected.
- Let supervisors collaborate through configured chat destinations and personas.
- Ship an example bundle that validates and runs with
  `--workflow-definition-dir ./examples`.
- Preserve event input, external output, and internal workflow-mail separation.

## Non-Goals

- Provider-specific chat UI behavior beyond provider-neutral messages.
- Streaming arbitrary worker output into chat.
- Reading another workflow's internal mailbox as a collaboration channel.
- Durable long-term memory beyond the existing persona and memory contracts.
- Backward-compatible migration behavior for older implicit reply paths.

## Lifecycle Model

The lifecycle has four provider-facing states:

1. `received`: the runtime accepted and normalized the chat event.
2. `plan-or-question`: the supervisor has either a concise execution plan or a
   concrete missing-information question.
3. `clarification`: the task cannot start because required information is
   missing or ambiguous.
4. `starting`: the runtime is about to start or resume the selected workflow.

`plan-or-question` is a decision point, not a guarantee that execution will
start. When the task is incomplete, the reply text should ask for the smallest
missing piece of information and no workflow execution should be created. When
the task is complete, the reply may summarize the planned target and expected
next action, followed by `starting`.

Recommended publication order for a complete chat task:

```text
provider chat event
  -> external-input message
  -> progress external-output: received
  -> supervisor task-planning decision
  -> control-status external-output: plan-or-question
  -> progress external-output: starting
  -> target workflow execution
  -> business-final external-output
```

Recommended publication order for an incomplete chat task:

```text
provider chat event
  -> external-input message
  -> progress external-output: received
  -> supervisor task-planning decision
  -> control-status external-output: clarification
  -> no target workflow execution
```

## Task Readiness Decision

The supervisor task planner returns a structured decision before execution:

```json
{
  "status": "ready",
  "replyKind": "plan-or-question",
  "requiredInfoMissing": [],
  "planSummary": "Run the implementation workflow, then request supervisor review.",
  "targets": [
    {
      "managedWorkflowKey": "implementation",
      "input": {
        "request": "Implement the requested chat lifecycle behavior."
      }
    }
  ]
}
```

Decision statuses:

- `ready`: all required information is present; publish `plan-or-question`,
  then `starting`, then start the selected workflow route.
- `needs-clarification`: required information is missing; publish a
  clarification `control-status` reply and do not start execution.
- `refused`: the request is out of scope or disallowed; publish a
  `control-status` reply and do not start execution.

Validation rules:

- `status` must be recognized.
- `replyKind` must be one of `plan-or-question`, `clarification`, or `refusal`.
- `targets` are required only for `ready`.
- Every target must resolve through the supervisor profile or direct binding.
- `requiredInfoMissing` must be empty for `ready`.
- Runtime, not the LLM, applies idempotency and start/no-start decisions.

## External Output Boundary

Lifecycle replies are external-output messages:

- `received` and `starting` use `outputKind: "progress"`.
- `plan-or-question`, `clarification`, and `refusal` use
  `outputKind: "control-status"`.
- final accepted workflow results use `outputKind: "business-final"`.

The event adapter formats and delivers these messages through configured output
destinations. It must not read `nodes/*/mailbox/outbox`, workflow output mail,
or manager-worker communications as provider delivery requests.

## Supervisor Collaboration Over Chat

Supervisor collaboration uses chat destinations as the shared transport:

- Workflow A publishes persona-specific brainstorm messages to a configured
  chat destination.
- Workflow B publishes a second persona-specific brainstorm to the same
  destination.
- Workflow C watches that destination as an external input source and converts
  the discussion into specification and implementation work.
- Workflow C publishes review requests back to the Workflow A and Workflow B
  chat destinations.
- Workflow A and Workflow B review through normal chat events and external
  outputs, not through C reading their internal workflow mail.

Personas are configured as supervisor profile or node system prompts. The
runtime passes persona and destination context as runtime variables, but
provider delivery remains owned by output destinations.

## Ready-To-Run Example Bundle

The feature should add this example bundle:

```text
examples/chat-supervisor-collaboration/
  workflow.json
  mock-scenario.json
  EXPECTED_RESULTS.md
  prompts/
    workflow-a-brainstorm.md
    workflow-b-brainstorm.md
    workflow-c-spec-and-implementation.md
    workflow-c-request-review.md
    workflow-output.md
  nodes/
    node-workflow-a-brainstorm.json
    node-workflow-b-brainstorm.json
    node-workflow-c-spec-and-implementation.json
    node-workflow-c-request-review.json
    node-workflow-output.json
  .divedra-events/
    sources/collaboration-chat.json
    destinations/workflow-a-review-chat.json
    destinations/workflow-b-review-chat.json
    destinations/shared-brainstorm-chat.json
    bindings/brainstorm-to-c.json
```

Bundle behavior:

1. Workflow A and Workflow B receive the same task input and produce distinct
   brainstorm outputs using different personas.
2. Their outputs are published as external-output chat messages to
   `shared-brainstorm-chat`.
3. Workflow C consumes the shared discussion from the mock scenario, produces a
   specification and implementation-work summary, and emits review requests to
   `workflow-a-review-chat` and `workflow-b-review-chat`.
4. The final output summarizes A/B brainstorm inputs, C's spec/implementation
   plan, review requests, destination ids, and the separation between
   external-output publications and internal workflow mail.

Validation commands for the completed bundle:

```bash
bun run src/main.ts workflow validate chat-supervisor-collaboration --workflow-definition-dir ./examples
bun run src/main.ts workflow inspect chat-supervisor-collaboration --workflow-definition-dir ./examples --output json
bun run src/main.ts workflow run chat-supervisor-collaboration --workflow-definition-dir ./examples --mock-scenario ./examples/chat-supervisor-collaboration/mock-scenario.json
```

## Implementation Decisions

- Keep `workflowMode` as `issue-resolution` for this feature branch.
- Keep the feature id `chat-task-planning-lifecycle`.
- Use concise new lifecycle planning code instead of backward-compatible
  implicit reply behavior.
- Treat clarification as a terminal pre-execution response for that source
  event; a later user reply creates a new external-input message.
- Reuse existing `progress`, `control-status`, and `business-final`
  external-output kinds instead of adding new output kinds.
- Require supervisor collaboration to use explicit chat destinations and event
  receipts.
- Use `codex-agent` as a behavioral reference for progress-event separation
  and implementation-plan discipline, not as a source of provider delivery
  semantics.

## Open Questions

- Whether the first implementation should expose task-readiness decisions as a
  dedicated helper module or keep them inside the trigger-runner reply path.
- Whether the example bundle should model A/B/C as one step-addressed workflow
  with chat destination handoff artifacts, or as three catalog workflows wired
  by event-source configuration.

## Risks

- Lifecycle reply ordering can duplicate messages on replay unless idempotency
  keys include receipt id, binding id, lifecycle state, and target destination.
- Ambiguous requests could start workflows too early if readiness validation is
  not runtime-enforced.
- The example bundle may appear to imply direct mailbox sharing unless
  destination ids and external-output records are explicit in expected results.
- Persona-driven supervisors can produce inconsistent formats unless prompt
  templates require concise structured outputs.

## References

- `design-docs/specs/design-output-destinations-and-supervisor-memory.md`
- `design-docs/specs/design-event-external-mailbox-binding.md`
- `design-docs/specs/design-workflow-supervisor-dispatcher.md`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `../../codex-agent/AGENTS.md:187`
- `../../codex-agent/impl-plans/README.md:30`
