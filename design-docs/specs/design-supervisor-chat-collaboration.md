# Supervisor Chat Collaboration Workflow

This document defines the feature-local design for persona-based supervisors that
collaborate through configured chat output destinations, plus a runnable example
bundle where two brainstorm workflows feed a coordinator workflow that produces
specification and implementation work and requests review from the original
supervisors.

## Overview

The feature turns chat destinations into addressable collaboration channels for
supervisor workflows. Workflow A and Workflow B receive the same task, respond
with different personas, and publish their brainstorm outputs to a shared chat
discussion destination. Workflow C consumes the discussion transcript, converts
it into specification and implementation-plan work, and publishes review
requests back to the A and B supervisor destinations.

This is an event/output-destination workflow pattern, not a new internal
mailbox path. Internal workflow mail remains manager-routed execution data.
Provider-visible collaboration messages are sent only as explicit
`external-output` publications through configured output destinations.

## Feature Contract

- `featureId`: `supervisor-chat-collaboration`
- `featureTitle`: `Supervisor Chat Collaboration Workflow`
- `workflowMode`: `issue-resolution`
- `issueReference`: none
- `designDocPath`: `design-docs/specs/design-supervisor-chat-collaboration.md`
- `implPlanPath`: `impl-plans/active/supervisor-chat-collaboration.md`
- `codexAgentReferences`:
  - `../../codex-agent/AGENTS.md:212`
  - `../../codex-agent/AGENTS.md:224`
  - `../../codex-agent/Taskfile.yml:81`

## Goals

- Enable supervisor workflows to collaborate over chat destinations while
  preserving persona-specific behavior.
- Provide a ready-to-run example bundle with Workflow A, Workflow B, and
  Workflow C.
- Keep outbound provider delivery explicit through `external-output` and
  `outputDestinations`.
- Keep the example runnable with `workflow validate`, mock scenarios, and
  existing event-source tooling.

## Non-Goals

- Durable long-term supervisor memory.
- Direct reads of another workflow execution's output mail.
- Provider-specific chat SDK behavior in workflow definitions.
- A new global mailbox shared across supervisors.

## Design

### Persona Supervisors

Each supervisor workflow has a persona declared in workflow-local prompts and
node variables:

- Workflow A: exploratory product strategist; prioritizes user intent, success
  criteria, and missing assumptions.
- Workflow B: systems architect; prioritizes runtime boundaries, state,
  failure modes, and verification.
- Workflow C: implementation coordinator; turns A/B discussion into design,
  implementation-plan, implementation, and review work.

Persona is prompt-level configuration. It does not grant provider access or
mailbox permissions. Runtime memory/persona contracts from
`design-docs/specs/design-output-destinations-and-supervisor-memory.md` remain
the future extension point for durable memory.

### Destination Topology

The example uses named output destinations:

- `supervisor-a-chat`: chat destination for Workflow A review requests.
- `supervisor-b-chat`: chat destination for Workflow B review requests.
- `supervisor-discussion-chat`: shared chat destination where A and B publish
  brainstorm output for Workflow C to consume.
- `coordinator-chat`: chat destination for Workflow C status and final output.

Bindings pass `eventOutputDestinations` into runtime variables. Chat fanout uses
the destination list order from the binding or supervisor command. If a binding
omits destinations, the compatibility source-backed chat fallback can still
reply to the inbound conversation, but the example must use explicit
destinations.

### Workflow A and Workflow B

Workflow A and Workflow B are small supervisor workflows:

1. Receive a chat-originated task through event input.
2. Produce a persona-specific brainstorm payload.
3. Publish a `progress` external output for "received" and "starting" when the
   chat task runner provides lifecycle replies.
4. Publish a `business-final` external output to
   `supervisor-discussion-chat`.

Their final business payload shape is provider-neutral JSON:

```json
{
  "personaId": "workflow-a",
  "summary": "Brainstorm summary",
  "recommendations": ["..."],
  "questions": ["..."],
  "risks": ["..."]
}
```

### Workflow C

Workflow C consumes the shared discussion as workflow input. In the ready-to-run
example, the transcript is supplied by a mock scenario and by event payloads so
the bundle can run without a live chat provider.

Workflow C:

1. Normalizes the A/B discussion into accepted requirements.
2. Produces a feature-local design update target.
3. Produces an implementation-plan target.
4. Runs or delegates implementation work according to the selected workflow.
5. Publishes review requests to `supervisor-a-chat` and `supervisor-b-chat`.
6. Produces a final `business-final` coordinator summary to
   `coordinator-chat`.

The review request payload is explicit external output:

```json
{
  "reviewRequest": {
    "featureId": "supervisor-chat-collaboration",
    "designDocPath": "design-docs/specs/design-supervisor-chat-collaboration.md",
    "implPlanPath": "impl-plans/active/supervisor-chat-collaboration.md",
    "requestedReviewers": ["workflow-a", "workflow-b"]
  }
}
```

### Example Bundle Paths

Implementation should add these example paths:

- `examples/supervisor-chat-collaboration/README.md`
- `examples/supervisor-chat-collaboration/EXPECTED_RESULTS.md`
- `examples/supervisor-chat-collaboration/mock-scenario.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-a/workflow.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-a/nodes/node-divedra-manager.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-a/nodes/node-brainstorm.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-a/nodes/node-output.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-a/prompts/brainstorm.md`
- `examples/supervisor-chat-collaboration/workflows/workflow-b/workflow.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-b/nodes/node-divedra-manager.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-b/nodes/node-brainstorm.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-b/nodes/node-output.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-b/prompts/brainstorm.md`
- `examples/supervisor-chat-collaboration/workflows/workflow-c/workflow.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-c/nodes/node-divedra-manager.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-c/nodes/node-synthesize.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-c/nodes/node-review-request.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-c/nodes/node-output.json`
- `examples/supervisor-chat-collaboration/workflows/workflow-c/prompts/synthesize.md`
- `examples/supervisor-chat-collaboration/.divedra-events/bindings/chat-task-to-supervisors.json`
- `examples/supervisor-chat-collaboration/.divedra-events/bindings/discussion-to-coordinator.json`
- `examples/supervisor-chat-collaboration/.divedra-events/destinations/supervisor-a-chat.json`
- `examples/supervisor-chat-collaboration/.divedra-events/destinations/supervisor-b-chat.json`
- `examples/supervisor-chat-collaboration/.divedra-events/destinations/supervisor-discussion-chat.json`
- `examples/supervisor-chat-collaboration/.divedra-events/destinations/coordinator-chat.json`

The workflows should use `promptTemplateFile` for long prompts and keep
`workflow.json` focused on graph shape, defaults, and node ordering.

### Event vs Workflow Mail Separation

This feature must preserve three boundaries:

- Chat provider input becomes a normalized event/external-input record before a
  workflow starts.
- Workflow output mail remains internal execution state and cannot be treated as
  a provider delivery queue.
- Provider-visible collaboration, progress, review, and final messages require
  explicit `external-output` publications with destination ids.

Workflow C therefore consumes A/B discussion through event payloads or mock
scenario input, not by reading Workflow A or Workflow B node artifacts.

## Review Decisions

- Keep this feature in `workflowMode: issue-resolution` because it requires
  design, plan, implementation, review, and verification work.
- Use three concrete workflows instead of one monolithic graph so destination
  collaboration exercises the external-output boundary.
- Use persona prompts as the first implementation surface; defer durable memory
  to the existing supervisor memory design.
- Require explicit destination ids in the example even though source-backed chat
  fallback exists.
- Keep Workflow C's review request as external output, not internal mailbox
  fanout to A/B artifacts.

## Open Questions

- Should Workflow C wait for A/B review responses in the first runnable example,
  or should the first bundle stop after publishing review requests?
- Should the example live entirely under
  `examples/supervisor-chat-collaboration/`, or should reusable workflows also
  be promoted to top-level `examples/workflow-a-*` directories?

## Risks

- Chat task lifecycle replies and supervisor collaboration share destination
  plumbing; tests must prove progress, review, and business-final outputs do not
  duplicate provider messages.
- A live provider run may need conversation/thread ids that mock scenarios do
  not exercise.
- If implementation shortcuts by reading workflow artifacts directly, it will
  violate the event vs workflow-mail separation.
- Review-response waiting can become a long-running orchestration feature; the
  first implementation should keep the runnable bundle bounded unless the
  implementation plan explicitly adds resume/replay behavior.

## Verification Commands

```bash
sed -n '1,260p' design-docs/specs/design-supervisor-chat-collaboration.md
test -f design-docs/specs/design-supervisor-chat-collaboration.md
rg -n "supervisor-chat-collaboration|supervisor-discussion-chat|external-output|outputDestinations" design-docs examples src -S
bun run typecheck
bun test src/events/reply-dispatcher.test.ts src/events/trigger-runner.test.ts src/workflow/native-node-executor.test.ts
```

## References

- `design-docs/specs/design-output-destinations-and-supervisor-memory.md`
- `design-docs/specs/design-event-external-mailbox-binding.md`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
