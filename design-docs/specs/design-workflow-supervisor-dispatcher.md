# Workflow Supervisor Dispatcher Design

This document defines an additive design for a workflow supervisor that can
dispatch, stop, switch, inspect, and directly answer chat-driven requests across
multiple allowed workflows.

## Overview

The current supervised event-control design is centered on one supervised
binding and one target workflow. That model remains valid for simple
interactive automations, but a chat-facing supervisor needs a broader dispatch
role:

```text
Chat event / web chat event / library chat input
  -> external mailbox input
  -> workflow supervisor conversation
  -> deterministic command parser or command-analysis decision proposal
  -> zero, one, or many target workflow lifecycle actions
  -> external mailbox output reply
```

The workflow supervisor is represented as a normal divedra workflow identity,
but the default dispatcher is deterministic. It parses configured command
tokens, applies profile validation, and controls target runs through the
in-process runner pool. A command-analysis LLM node may be invoked only when the
first text token is not a known command or when a profile explicitly requests
LLM-backed dispatch. The LLM output is a decision proposal, not the authority
boundary. The runtime grants the supervisor only scoped system capabilities for
workflows listed in its supervisor profile, so it cannot launch or cancel
arbitrary workflows by name.

This design extends, rather than replaces:

- `design-docs/specs/design-event-supervisor-control.md`
- `design-docs/specs/design-event-external-mailbox-binding.md`
- `design-docs/specs/architecture.md` sections "Event Listener Workflow
  Triggers" and "Manager Control Architecture"

## Goals

- Define a workflow supervisor and the set of workflows it is allowed to
  manage.
- Let one supervisor conversation start multiple workflows when policy allows
  it.
- Let the supervisor decide per incoming chat event whether to stop a workflow,
  switch active workflow, start a new workflow, submit input to an existing
  workflow, answer directly, report status, or ask for clarification.
- Keep the default dispatcher deterministic, while allowing an LLM-backed
  command-analysis or dispatcher node when desired and keeping privileged
  lifecycle actions behind runtime validation.
- Preserve direct single-target supervised mode as a simpler compatibility
  shape.

## Non-Goals

- Letting an LLM directly execute privileged lifecycle actions without runtime
  validation.
- Adding managed-workflow catalogs into target workflow `workflow.json` files.
- Reintroducing structural sub-workflow ownership or top-level
  `workflow.workflowCalls`.
- Replacing step-addressed cross-workflow transitions inside ordinary workflow
  execution.
- Solving provider-specific chat UX in the workflow engine.

## Core Invariants

The following invariants are mandatory regardless of whether the packaged
default supervisor is implemented as a long-lived workflow execution or as
short decision executions:

- deterministic command parsing is the default; any LLM dispatcher or
  command-analysis node only proposes decisions and never becomes the authority
  that mutates runtime state
- every privileged lifecycle mutation is validated against one concrete
  supervisor profile revision or snapshot
- the runtime applies one decision against one conversation state revision at a
  time, so concurrent chat inputs cannot both win against stale state
- event-source delivery retries may replay the same source message, but they
  must not duplicate managed-run creation or destructive actions
- direct answers are read-only unless they dispatch into a managed workflow

## Concepts

### Workflow Supervisor

A workflow supervisor is a workflow bundle whose purpose is to own an external
conversation and make lifecycle decisions for a bounded set of managed
workflows.

Recommended default supervisor workflow id:

- `divedra-default-workflow-supervisor`

Recommended dispatcher steps:

1. `receive-external-input`
2. `load-conversation-state`
3. `resolve-dispatch-decision`
4. `validate-dispatch-decision`
5. `execute-lifecycle-actions`
6. `publish-supervisor-reply`
7. `persist-conversation-state`

`resolve-dispatch-decision` may be an LLM manager node. The node receives:

- normalized external input, usually chat text plus provider-neutral metadata
- active managed runs for the conversation
- the managed workflow catalog, including descriptions, aliases, examples, and
  input contracts
- recent supervisor decisions and replies
- scoped status summaries for managed runs

The LLM output is a decision proposal. It is not the authority boundary.
Runtime validation decides whether the proposal is executable.

### Supervisor Profile

A supervisor profile defines the authority and policy for a supervisor
workflow. It is external runtime configuration, not part of target workflow
authoring.

Recommended scoped layout:

```text
<scope-root>/
  workflows/
    divedra-default-workflow-supervisor/
    code-review/
    research-summary/
  supervisors/
    default-chat-supervisor.json
```

For standalone event-root deployments, the same profile shape may also be
accepted under:

```text
.divedra-events/
  supervisors/
    default-chat-supervisor.json
```

Event bindings and library/GraphQL callers reference the profile by
`supervisorProfileId`. The profile references the supervisor workflow by
`supervisorWorkflowName`.

Conceptual profile fields:

```typescript
interface WorkflowSupervisorProfile {
  readonly supervisorProfileId: string;
  readonly profileRevision: string;
  readonly supervisorWorkflowName: string;
  readonly description?: string;
  readonly managedWorkflows: readonly ManagedWorkflowDefinition[];
  readonly conversationPolicy?: SupervisorConversationPolicy;
  readonly directAnswerPolicy?: SupervisorDirectAnswerPolicy;
}
```

Conceptual direct-answer policy:

```typescript
interface SupervisorDirectAnswerPolicy {
  readonly enabled: boolean;
  readonly allowedDecisionKinds?: readonly (
    | "answer-directly"
    | "status"
    | "clarify"
  )[];
}
```

Rules:

- `supervisorProfileId` is the stable runtime policy id.
- `profileRevision` identifies the validated policy snapshot used for new
  supervisor conversations.
- `supervisorWorkflowName` resolves through the same workflow catalog as normal
  workflow execution.
- `managedWorkflows[]` is the complete allow-list for lifecycle actions.
- A missing or empty managed workflow catalog is valid only when the profile
  explicitly allows direct answers only.
- The profile must validate before the supervisor can accept external input.

Profile lifecycle rules:

- a supervisor conversation stores the exact `profileRevision` it was created
  with
- the runtime may store either the resolved profile snapshot or a durable hash
  plus revisioned reload contract, but decision execution must always be pinned
  to one validated policy view
- changing a profile does not silently expand authority for already-active
  conversations
- a profile revision may explicitly declare whether existing conversations may
  continue, must pause for clarification, or must refuse new destructive
  actions until migrated

### Managed Workflow Definition

A managed workflow definition describes one workflow the supervisor may use.

Conceptual fields:

```typescript
interface ManagedWorkflowDefinition {
  readonly key: string;
  readonly workflowName: string;
  readonly displayName?: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly dispatchExamples?: readonly string[];
  readonly inputContract?: Readonly<Record<string, unknown>>;
  readonly inputMapping?: EventInputMapping;
  readonly allowedActions?: readonly ManagedWorkflowAction[];
  readonly concurrency?: ManagedWorkflowConcurrencyPolicy;
  readonly lifecycle?: ManagedWorkflowLifecyclePolicy;
}
```

Rules:

- `key` is the supervisor-local stable identity used in decisions and
  persisted run records.
- `workflowName` is the executable workflow catalog name.
- `description`, `aliases`, and `dispatchExamples` are prompt material for the
  LLM dispatcher and operator inspection material for deterministic clients.
- `allowedActions` defaults to `["start", "submit-input", "status", "stop",
  "restart"]`.
- `concurrency` defines whether multiple active runs of this managed workflow
  may exist in one supervisor conversation.
- `lifecycle` defines restart budget, stop-on-switch behavior, and whether
  terminal target runs remain selectable for follow-up questions.
- `inputMapping` must be deterministic for a given external input and decision
  payload; any nondeterministic enrichment belongs in the supervisor workflow,
  not in privileged runtime validation.

Conceptual lifecycle extension:

```typescript
interface ManagedWorkflowLifecyclePolicy {
  readonly stopOnSwitch?: boolean;
  readonly startOnSwitch?: boolean;
  readonly terminalInputBehavior?: "clarify" | "restart" | "fork";
}
```

Lifecycle rules:

- `terminalInputBehavior` defaults to `"clarify"`.
- `"clarify"` means the supervisor must ask whether to restart or start a new
  run before sending more input.
- `"restart"` means a `submit-input` proposal against a terminal selected run is
  normalized into a restart plus input delivery for the same managed workflow.
- `"fork"` means a `submit-input` proposal against a terminal selected run is
  normalized into creation of a new managed run that inherits the managed
  workflow key and fresh target execution state.

Target workflows do not grant themselves supervisor visibility. The supervisor
profile grants that visibility.

## Event Binding Extension

Single-target supervised event bindings continue to use
`execution.mode = "supervised"` with `workflowName` as the target workflow.

Multi-workflow dispatcher bindings use a new mode:

```json
{
  "id": "team-chat-dispatcher",
  "sourceId": "team-chat",
  "match": {
    "eventType": "chat.message"
  },
  "inputMapping": {
    "mode": "event-input",
    "mirrorToHumanInput": true
  },
  "execution": {
    "mode": "supervisor-dispatch",
    "async": true,
    "supervisorProfileId": "default-chat-supervisor",
    "correlationKey": "{{event.sourceId}}:{{event.conversation.id}}:{{event.conversation.threadId}}"
  }
}
```

Rules:

- `workflowName` is not required for `supervisor-dispatch` bindings because the
  target is selected from the profile's managed workflow catalog.
- `supervisorProfileId` is required.
- `supervisorWorkflowName` may be supplied as an override only when it matches
  the referenced profile or the caller has explicit configuration authority.
- `correlationKey` identifies the supervisor conversation, not a single target
  workflow run.
- Existing command-token and `llm-command` mapping remains available for
  single-target `supervised` bindings. Dispatcher mode routes all accepted chat
  input to the supervisor workflow unless deterministic pre-routing rejects it.
- `supervisor-dispatch` implies the external mailbox input consumer is the
  supervisor conversation, not a direct target workflow run.
- final reply, progress, and control output policy is still expressed through
  the external mailbox boundary; the supervisor decides what to publish, but
  provider delivery stays runtime-owned and transport-focused.

## Dispatch Decision Contract

The dispatcher node returns a structured decision proposal. The runtime parses
and validates the proposal before performing any lifecycle action.

Decision action kinds:

- `answer-directly`: publish a supervisor reply without starting or modifying a
  target workflow.
- `start-workflow`: start one managed workflow, or multiple managed workflows
  when the profile allows fanout.
- `submit-input`: deliver the new chat input to an active managed workflow run.
- `switch-workflow`: set the selected active run for future ambiguous input,
  optionally starting the target if no active run exists.
- `stop-workflow`: cancel or stop one or more active managed workflow runs.
- `restart-workflow`: cancel a non-terminal run when needed and start a new
  attempt for the same managed workflow.
- `status`: inspect one or more managed runs and publish a status reply.
- `clarify`: ask the user to choose a workflow, run, or action.
- `no-op`: record the input as acknowledged without publishing a business
  response.

Conceptual proposal shape:

```json
{
  "action": "start-workflow",
  "targets": [
    {
      "managedWorkflowKey": "code-review",
      "runAlias": "review-main",
      "input": {
        "request": "Review the latest branch changes"
      }
    }
  ],
  "reply": {
    "text": "Starting code review."
  },
  "confidence": 0.91,
  "reason": "The message asks for a code review task."
}
```

Validation requirements:

- `action` is recognized and allowed by the profile.
- Every `managedWorkflowKey` exists in the profile.
- The target workflow resolves and is runtime-ready before `start-workflow`.
- The requested lifecycle action is allowed by the managed workflow definition.
- Destructive actions against multiple active runs require either explicit user
  target selection or a profile policy that allows fanout.
- `confidence` meets the profile threshold for LLM decisions.
- `input` is a JSON object after mapping.
- The decision is idempotent for the source event id and supervisor
  conversation.
- the decision records the `profileRevision` and conversation state revision it
  was derived from.
- when a workflow allows parallel active runs, `runAlias` or an equivalent
  canonical run selector is required for `start-workflow`, `submit-input`,
  `switch-workflow`, `stop-workflow`, and `restart-workflow` unless the target
  run is otherwise unambiguous.
- runtime application uses compare-and-swap semantics on the conversation so a
  stale proposal becomes rejected or retried rather than silently overwriting a
  newer selection or run set.

Invalid proposals are recorded as rejected decisions. When the source supports
external output, the supervisor publishes a clarification or rejection reply
without executing privileged actions.

Recommended decision artifact fields:

```typescript
interface SupervisorDispatchDecisionRecord {
  readonly decisionId: string;
  readonly supervisorConversationId: string;
  readonly sourceMessageId: string;
  readonly profileRevision: string;
  readonly conversationRevision: number;
  readonly status: "proposed" | "applied" | "rejected" | "superseded";
  readonly proposal: Readonly<Record<string, unknown>>;
  readonly resultSummary?: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

## Conversation And Run State

Dispatcher mode needs one durable supervisor conversation that can own many
target runs.

Conceptual records:

```typescript
interface WorkflowSupervisorConversationRecord {
  readonly supervisorConversationId: string;
  readonly supervisorProfileId: string;
  readonly profileRevision: string;
  readonly supervisorWorkflowName: string;
  readonly supervisorExecutionId?: string;
  readonly sourceId: string;
  readonly bindingId?: string;
  readonly correlationKey: string;
  readonly selectedManagedRunId?: string;
  readonly selectedManagedRunIdsByWorkflowKey?: Readonly<Record<string, string>>;
  readonly conversationRevision: number;
  readonly status: "active" | "idle" | "stopped" | "failed";
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ManagedWorkflowRunRecord {
  readonly managedRunId: string;
  readonly supervisorConversationId: string;
  readonly managedWorkflowKey: string;
  readonly targetWorkflowName: string;
  readonly runAlias?: string;
  readonly activeTargetExecutionId?: string;
  readonly status: "starting" | "running" | "stopping" | "stopped" | "completed" | "failed";
  readonly restartCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

Relationship to existing `event_supervised_runs`:

- Existing rows can continue to represent single-target supervised mode.
- Dispatcher mode should either add `supervisorConversationId` and
  `managedWorkflowKey` columns to the same underlying table or create a new
  grouped table that preserves equivalent fields.
- `supervisorExecutionId` moves conceptually to the conversation because one
  supervisor execution may manage several target workflow runs.
- Target workflow attempts remain linked to a managed run, not directly to the
  chat event receipt.
- event receipts and external-output dispatch rows remain the transport/audit
  boundary; supervisor conversation state is the lifecycle boundary.
- `selectedManagedRunId` is the conversation-wide default target for ambiguous
  follow-up input.
- `selectedManagedRunIdsByWorkflowKey` stores the last selected run for each
  managed workflow key so `single-selected` policy has a canonical state model.
- `runAlias` is the durable human-visible identifier for parallel runs of the
  same managed workflow key.

Recommended artifact layout:

```text
{DIVEDRA_ARTIFACT_DIR}/supervisors/{supervisorConversationId}/
  conversation.json
  decisions/{eventId-or-commandId}.json
  managed-runs/{managedRunId}.json
```

Concurrency rules:

- one lock domain exists per `supervisorConversationId`
- source-message dedupe happens before privileged action execution
- decision application increments `conversationRevision`
- if two accepted inputs race, the later writer must re-read conversation state
  and either re-evaluate or persist a `superseded` decision record

## Runtime Capabilities

The supervisor workflow receives runtime-scoped capabilities equivalent to a
safe dispatcher client:

- list managed workflow catalog entries for the active profile
- read active managed run status
- start a managed workflow
- submit external input to an active managed workflow
- stop or restart a managed workflow run
- publish external output replies
- persist dispatcher decisions and selected active run

Capability scope rules:

- A capability call must include `supervisorConversationId` or equivalent
  runtime-bound identity.
- The target `managedWorkflowKey` must be in the active profile.
- The target run must belong to the active supervisor conversation.
- The runtime, not the LLM, enforces idempotency and destructive-action
  ambiguity rules.
- Ordinary workflow manager-control actions remain limited to the current
  workflow execution and do not gain cross-conversation authority.
- capability evaluation uses the conversation's pinned `profileRevision`, not a
  newly loaded broader profile.
- the dispatcher cannot target arbitrary workflow ids, step ids, or manager
  sessions outside the managed workflow abstraction.

These capabilities can be exposed as built-in `divedra/*` node add-ons,
GraphQL mutations used through manager-scoped auth, or direct runtime calls
inside the packaged default supervisor. The public contract should remain
profile and conversation oriented.

## Action Semantics

### Direct Answer

`answer-directly` is used for status questions, simple questions about the
conversation, and lightweight investigation that does not need a target
workflow. The supervisor may use available read-only context such as active run
status and recent decisions. It must not mutate target workflow lifecycle.

Default guardrails:

- direct answers may read supervisor conversation state and managed-run status
  summaries
- direct answers may not call privileged lifecycle capabilities
- tool or network access beyond runtime-owned status/context reads should be
  opt-in profile policy; otherwise the default answer path stays bounded and
  auditable

### Start Workflow

`start-workflow` creates a new managed run unless the managed workflow's
concurrency policy requires reuse or rejection.

Recommended concurrency modes:

- `single-active`: reuse or reject when a non-terminal run exists.
- `single-selected`: allow several runs across the conversation but one
  selected run per managed workflow key, persisted in
  `selectedManagedRunIdsByWorkflowKey`.
- `multiple-active`: allow several active runs only when the decision contains
  a user-visible alias or explicit run label that becomes durable `runAlias`.

### Submit Input

`submit-input` delivers the chat event to the selected managed run or to a
specified run. If no run is selected and several candidates are active, the
supervisor should clarify rather than guess.

Terminal-run rules:

- if the selected or specified run is non-terminal, input is delivered to that
  run normally
- if the selected or specified run is terminal, the runtime applies the managed
  workflow's `terminalInputBehavior`
- the default `"clarify"` behavior is conservative and prevents silent restart
  or silent fork on ambiguous follow-up chat input

### Switch Workflow

`switch-workflow` updates `selectedManagedRunId`. It may start the target
workflow if the profile allows `startOnSwitch`. It may stop the previously
selected run only when the previous managed workflow lifecycle policy enables
`stopOnSwitch`.

### Stop And Restart

`stop-workflow` and `restart-workflow` are destructive lifecycle actions. They
require an explicit target when more than one candidate run is active unless
the profile enables destructive fanout.

`restart-workflow` means start a new target execution from the target
workflow's entry or manager anchor. It is not step-level rerun.

### Status

`status` may summarize the whole supervisor conversation or a specific managed
run. Multi-target status fanout is safe by default because it is read-only.

## Default Dispatcher Policy

Recommended defaults for chat-facing supervisor profiles:

- `maxActiveManagedRunsPerConversation = 3`
- `defaultActionWhenUnclear = "clarify"`
- `allowDirectAnswer = true`
- `allowStatusFanout = true`
- `allowDestructiveFanout = false`
- `llmDecisionMinConfidence = 0.75`
- `startOnFirstTaskRequest = true`
- `stopOnSwitch = false`
- `maxRestartsOnFailure = 0` unless a managed workflow overrides it
- `autoImprove = false` unless a managed workflow explicitly enables it

These defaults keep the supervisor useful for chat while avoiding accidental
mass cancellation or unwanted workflow patching.

## Example Supervisor Profile

```json
{
  "supervisorProfileId": "default-chat-supervisor",
  "profileRevision": "2026-04-30.default-chat-supervisor.v1",
  "supervisorWorkflowName": "divedra-default-workflow-supervisor",
  "description": "Dispatches team chat requests to allowed project workflows.",
  "directAnswerPolicy": {
    "enabled": true,
    "allowedDecisionKinds": ["answer-directly", "status", "clarify"]
  },
  "conversationPolicy": {
    "maxActiveManagedRunsPerConversation": 3,
    "allowDestructiveFanout": false,
    "llmDecisionMinConfidence": 0.75
  },
  "managedWorkflows": [
    {
      "key": "code-review",
      "workflowName": "code-review",
      "aliases": ["review", "pr review"],
      "description": "Reviews code changes and reports risks, tests, and suggested fixes.",
      "dispatchExamples": [
        "review this branch",
        "check the latest diff"
      ],
      "concurrency": {
        "mode": "single-active"
      },
      "lifecycle": {
        "terminalInputBehavior": "clarify"
      }
    },
    {
      "key": "research-summary",
      "workflowName": "research-summary",
      "aliases": ["research", "investigate"],
      "description": "Runs a longer research workflow when a direct answer is not sufficient.",
      "concurrency": {
        "mode": "multiple-active",
        "requiresAliasForParallelRuns": true
      },
      "lifecycle": {
        "terminalInputBehavior": "fork"
      }
    }
  ]
}
```

## Flow Examples

### Start A Workflow

1. User sends "review this branch" to the chat thread.
2. The event binding routes the message to supervisor profile
   `default-chat-supervisor`.
3. The supervisor LLM sees `code-review` in the managed workflow catalog and
   proposes `start-workflow` for `managedWorkflowKey = "code-review"`.
4. Runtime validates that `code-review` is allowed and runtime-ready.
5. Runtime creates a managed run and starts the target workflow.
6. Supervisor publishes an external output reply with the managed run label.

### Direct Answer

1. User asks "what is running now?"
2. The supervisor proposes `status` or `answer-directly`.
3. Runtime reads the supervisor conversation's managed runs.
4. Supervisor publishes a concise status reply without starting a target
   workflow.

### Switch Active Workflow

1. Two managed runs exist: `code-review` and `research-summary`.
2. User says "send the next note to research instead."
3. Supervisor proposes `switch-workflow` targeting the research run.
4. Runtime updates `selectedManagedRunId`.
5. Later ambiguous input goes to the selected research run.

### Stop Workflow

1. User says "stop the review."
2. Supervisor maps "review" to managed workflow alias `code-review`.
3. Runtime validates the target run and cancels its active target execution.
4. The supervisor conversation remains active so future messages can start or
   control other workflows.

## Implementation Phasing

1. Add supervisor profile loading and validation.
2. Add `execution.mode = "supervisor-dispatch"` event binding validation and
   mailbox-boundary semantics.
3. Add supervisor conversation and managed-run persistence, including pinned
   `profileRevision`, `conversationRevision`, and decision records.
4. Add compare-and-swap decision application plus source-message idempotency
   for concurrent chat inputs.
5. Package or extend `divedra-default-workflow-supervisor` with an LLM
   dispatcher step and strict structured decision output.
6. Add runtime dispatcher capabilities with profile-scoped authorization.
7. Route chat/library/GraphQL inputs to dispatcher mode.
8. Add examples for direct answer, single-target start, multi-workflow status,
   switching, destructive ambiguity, and profile-revision migration behavior.

## Open Implementation Decisions

- Whether dispatcher mode should reuse `event_supervised_runs` with added
  grouping fields or introduce separate supervisor conversation tables.
- Whether the packaged default supervisor should run as a long-lived resumed
  supervisor execution per conversation or as short decision executions that
  share durable conversation state.
- Whether direct answers may use external tools beyond runtime status reads in
  the default profile, or whether such work should always dispatch to a managed
  research workflow.
- Whether profile migration should be implemented as pinned immutable snapshots,
  revisioned reload with compatibility checks, or explicit operator migration
  commands for active conversations.

## References

- `design-docs/specs/design-event-supervisor-control.md`
- `design-docs/specs/design-event-external-mailbox-binding.md`
- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/architecture.md`
