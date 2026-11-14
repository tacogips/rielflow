# Autonomous Execution Gap Closure Design

This document defines how to close the gap between the current workflow runtime and the target state: autonomous multi-agent design, implementation, testing, review, and browser-operation loops without human intervention.

## Overview

Current implementation is a reliable deterministic workflow runner, but many autonomy-critical capabilities are still declarative-only (present in schema/docs, not in runtime behavior). This design prioritizes execution-semantic correctness first, then true agent integration, then advanced orchestration.

## Current State Assessment

### Implemented and Stable

- Workflow load/validate/save and revision conflict checks.
- Deterministic execution engine with edge fan-out and per-node artifacts.
- Session persistence (file) with runtime index (SQLite, best-effort).
- CLI/API run, resume, rerun, and simple web runner.

### Declared but Not Executed

- `subWorkflows` orchestration semantics.
- `subWorkflowConversations` semantics and policies.
- `argumentsTemplate` + `argumentBindings` runtime materialization.
- Loop-rule semantics from `workflow.loops[]` (`continueWhen`, `exitWhen`, loop-local `maxIterations`, `backoffMs`).
- Real codex/claude backend invocation.

### Semantics to Correct

- Loop budget is currently node-count based, not loop-identity based.
- Completion rule types/config are not actually evaluated.
- API cancellation can race with in-flight engine execution.

## Product Direction

### Primary Goal

Deliver a trustworthy autonomous orchestrator where behavior is:

- deterministic and replayable,
- formally evaluable at control-flow boundaries,
- safe under cancellation/restart/failure,
- adapter-pluggable for real agent execution,
- observable enough for postmortem and policy iteration.

### Non-Goal (This Design Set)

- Distributed scheduling across hosts.
- Generic third-party plugin marketplace.

## Architectural Decisions

### AD-01: Introduce Explicit Execution Semantics Layer

Add a dedicated semantics module to evaluate:

- branch conditions,
- completion conditions,
- loop conditions and loop counters,
- transition admission.

This removes implicit behavior from the engine loop and makes policy testable independently.

### AD-02: Canonical Runtime Graph Model

Normalize workflow JSON into a strongly typed runtime graph:

- typed sub-workflows,
- typed conversation definitions,
- typed node input mapping rules.

Reject partially-typed `Record<string, unknown>` for execution-critical fields after migration.

### AD-03: Two-Phase Node Input Build

For each node execution:

1. Build structured `arguments` from `argumentsTemplate` + `argumentBindings`.
2. Build `promptText` from `promptTemplate` + merged variables.

Adapters can opt into one or both fields, but input assembly is centralized and deterministic.

### AD-04: Real Adapter Contract v1

Adapter interface includes:

- cancellation signal,
- timeout budget input,
- structured output contract,
- normalized error taxonomy (`provider_error`, `timeout`, `invalid_output`, `policy_blocked`).

### AD-05: Session State Authority and Cancellation Safety

Keep file session as source-of-truth for now, but enforce:

- read-before-step cancellation check,
- compare-and-set style session transition guards,
- terminal-state immutability (do not re-open terminal sessions).

### AD-06: Spec/Code Contract Discipline

No new field is added to `workflow.json` unless:

- validator enforces it,
- runtime executes it,
- tests cover it,
- inspection output shows effective value.

## Phased Delivery

### Phase 1: Semantic Correctness Core

- Implement loop-rule aware execution.
- Implement completion rule evaluation by type/config.
- Implement cancellation-safe engine transitions.

### Phase 2: Input Assembly and Runtime Typing

- Execute `argumentsTemplate`/`argumentBindings`.
- Add typed runtime models for sub-workflow/conversation declarations.
- Add strict normalization + migration for legacy forms.

### Phase 3: Real Adapter Integration

- Implement codex/claude adapters behind unified contract.
- Add retry policy and provider error normalization.
- Add redaction-safe logs and per-node adapter diagnostics.

### Phase 4: Sub-Workflow and Conversation Execution

- Execute `subWorkflows` input/output boundaries.
- Execute `subWorkflowConversations` turn policy and stop conditions.
- Persist conversation transcript as deterministic input source.

### Phase 5: UI Alignment

- Keep naming aligned with the shipped terminal/runtime surfaces; do not assume a separate web UI exists.
- Add real graph editor milestones only when runtime parity exists.

## Acceptance Criteria

- Workflow fields that pass validation have runtime effect (no inert control fields).
- Loop and completion behavior matches spec under deterministic tests.
- Cancellation request cannot end in `completed` afterward.
- At least one real provider adapter runs end-to-end with artifact parity.
- Sub-workflow conversation replay is deterministic from artifacts/session state.

## Risks and Mitigations

- Risk: Migration churn from loose types.
  - Mitigation: staged type hardening with read-compatible normalization.
- Risk: Adapter nondeterminism.
  - Mitigation: strict output schema, retry fences, and scenario replay fixtures.
- Risk: Added complexity in one jump.
  - Mitigation: phase gating with explicit “ship criteria” per phase.

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-data-model.md`
- `impl-plans/active/autonomous-execution-gap-closure.md`
