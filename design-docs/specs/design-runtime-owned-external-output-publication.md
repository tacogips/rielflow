# Runtime-Owned External Output Publication

This document defines how `divedra` publishes the final workflow result to the external mailbox boundary.

## Overview

The runtime already owns mailbox writes and final `output.json` publication for node executions. This document narrows one remaining semantic gap: the source of the externally published workflow result must not be an arbitrary "last session response" or any LLM-chosen mailbox write target.

The external result published at session completion must instead be selected deterministically from accepted runtime artifacts.

## Problem Statement

The phrase "publish the session's final response" is underspecified and unsafe.

It can incorrectly mean:

- the last node that happened to execute in the session
- the last manager response, even if it was only an assessment/planning turn
- a backend-specific final text response that was never accepted as a workflow output artifact
- an LLM-directed mailbox write step

Those interpretations weaken replayability and can publish the wrong business result.

The main failure case is a root-scope `output` node succeeding, followed by a later root manager execution for reassessment or routing cleanup. In that sequence, the manager response is the session's last response, but it is not the workflow's final deliverable.

## Goals

- keep external mailbox publication fully runtime-owned
- make final result publication deterministic and replayable
- define the publication source in terms of accepted artifacts, not conversational chronology
- preserve the existing root mailbox model
- keep downstream semantics simple: published output always comes from a concrete accepted artifact

## Non-Goals

- changing normal node execution semantics
- allowing adapters or workers to write external mailbox artifacts directly
- introducing a new workflow-level "final response" artifact separate from node execution artifacts
- replacing root manager planning/assessment behavior

## Publication Authority

The runtime is the only component allowed to:

- choose whether a workflow has a publishable external result
- choose which accepted artifact becomes that result
- allocate the external mailbox `communicationId`
- write the external mailbox `message.json`, `outbox/*/message.json`, `outbox/*/output.json`, and `meta.json`

Adapters and LLMs may propose candidate business payloads for node execution, but they do not decide publication timing, target path, or publication identity.

## Source Selection Rule

At session completion, the runtime must choose the external result source using the following precedence:

1. The latest successful root-scope `output` node execution in the current `workflowExecutionId`
2. If no successful root-scope `output` node execution exists, the workflow has no publishable external result unless a separate future design introduces an explicit fallback source

This document deliberately rejects "latest session response" as a source-selection rule.

Implications:

- a later root manager execution does not supersede an earlier successful root `output` node result
- a later non-output worker execution does not supersede an earlier successful root `output` node result
- a failed or invalid root `output` execution does not become externally publishable
- only artifacts that already passed runtime acceptance may be published

## Definition of "Latest"

"Latest" means the accepted root-scope `output` node execution with the greatest execution order within the current workflow run.

The runtime may derive that ordering from existing node execution sequencing metadata. It must not infer recency from:

- filesystem modification time
- provider timestamps inside model responses
- mailbox creation timestamps
- lexical comparison of payload contents

The ordering source must already be part of deterministic workflow execution state.

## Accepted Artifact Requirement

The externally published result must be copied from a concrete accepted node execution artifact.

Required properties of the selected source artifact:

- it belongs to the current `workflowExecutionId`
- it is a root-scope node execution
- the node kind is `output`
- the node execution status is succeeded
- its `output.json` was published by the runtime
- if the node used an output contract, the payload already passed runtime validation

The runtime must never publish:

- raw adapter text that was not normalized into an accepted node artifact
- a reserved candidate file
- a retry attempt artifact under `output-attempts/`
- a manager response merely because it happened last

## External Mailbox Snapshot Rule

The external mailbox `outbox/{fromNodeId}/output.json` must be a runtime-written immutable snapshot of the selected accepted node execution `output.json`.
It must preserve the selected artifact bytes exactly rather than reparsing and reserializing equivalent JSON.

The external mailbox snapshot therefore inherits the same guarantees as the accepted node artifact:

- stable provenance
- deterministic replay
- schema-validation acceptance when applicable
- no adapter authority over final mailbox publication

## Session Completion Semantics

Session completion and external result publication are related but distinct events.

- Session completion means the workflow run reached a terminal runtime state.
- External result publication means the runtime found a publishable accepted root output artifact and emitted an external mailbox communication for it.

Therefore:

- a session may complete without external publication if no root output node succeeded
- external publication is not defined as "whatever response happened last before completion"
- the runtime may complete manager cleanup/reassessment steps after the publishable root output exists without changing the published source

## Root Manager Interaction

The root manager may still run after a root output node succeeds for reasons such as:

- readiness checks
- convergence assessment
- loop/branch control
- conversation coordination
- bookkeeping or deterministic orchestration fallback

Those executions do not change the external publication source unless they cause another root-scope `output` node execution to succeed later in the same workflow run.

This preserves the root manager's orchestration role while preventing it from accidentally overriding the workflow deliverable.

## Failure Semantics

If no successful root-scope `output` node execution exists at session completion:

- no external output communication is created
- the session result remains inspectable through normal execution/session artifacts
- this is not treated as mailbox corruption

If the selected accepted source artifact is unreadable or corrupted during publication:

- the runtime must fail deterministically
- the persisted workflow session must end in terminal `failed` state with the publication error recorded
- no substitute "last response" fallback is allowed
- the failure should identify the source node execution that could not be published

If external mailbox artifact persistence fails after the source execution has been selected:

- the runtime must fail deterministically
- the persisted workflow session must end in terminal `failed` state with the publication error recorded
- no partial success must be reported for external publication
- the failure should identify the selected source node execution whose publication could not be persisted

This preserves auditability by preferring explicit failure over implicit heuristic recovery.

## Compatibility

This design is intentionally narrow:

- existing node output contract rules remain unchanged
- existing mailbox ownership rules remain unchanged
- workflows do not need new configuration
- existing root output based workflows continue to work

What changes is the architectural rule: external publication is now explicitly defined as artifact-based source selection, not response-based selection.

## Test Expectations

The runtime test suite should cover at least these cases:

- publish the latest successful root `output` node result when it is also the last session execution
- publish the latest successful root `output` node result when a root manager runs afterward
- publish the later root `output` node result when multiple root output executions succeed
- do not publish any external output when no root output execution succeeds
- fail deterministically when the selected accepted source artifact is corrupted before publication
- fail deterministically when external mailbox artifact persistence fails for the selected source execution
- never publish from retry candidate artifacts or raw adapter response text

## References

- `design-docs/specs/design-node-mailbox.md`
- `design-docs/specs/design-node-output-contract.md`
- `design-docs/specs/design-divedra-manager-prompt-contract.md`
