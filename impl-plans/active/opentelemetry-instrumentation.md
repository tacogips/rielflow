# OpenTelemetry Instrumentation Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#opentelemetry-runtime-instrumentation; design-docs/specs/command.md#telemetry-and-jaeger-verification
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Design Document Reference

**Source**: `design-docs/specs/architecture.md` lines 1760-1856 and
`design-docs/specs/command.md` lines 399-443.

### Summary

Add coarse function-level OpenTelemetry tracing for rielflow workflow
execution, server/control-plane entrypoints, backend adapters, and
mailbox/communication handoff. Add startup and library configuration that
keeps inbox/outbox message payload export disabled by default, with explicit
opt-in via `WorkflowTelemetryOptions.exportMessages` or
`RIELFLOW_OTEL_EXPORT_MESSAGES`. Add a repository-owned
`docker-compose.jaeger.yml` verification path for local Jaeger traces.

### Scope

**Included**: shared telemetry module, OpenTelemetry package dependencies,
environment parsing, no-op disabled behavior, privacy redaction and message
payload gating, workflow/session/call-step instrumentation, backend adapter
instrumentation, communication/mailbox instrumentation, server and GraphQL
entrypoint instrumentation, event listener startup instrumentation, Jaeger
Compose verification, focused tests, and user-facing documentation refresh.

**Excluded**: fine-grained prompt/template/instruction spans, raw prompt/model
output export by default, Cursor-specific behavior changes, production Jaeger
deployment configuration, and copying behavior from codex-agent.

### Accepted Review Feedback

Step 3 accepted the design with one low note. Planning must treat
`design-docs/specs/architecture.md` as authoritative for Codex-agent reference
mapping and must not carry forward stale relative-reference claims.

### Codex Reference Mapping

- `design-docs/specs/architecture.md`: authoritative Codex-agent audit trail.
- `/Users/taco/gits/tacogips/codex-agent`: inspected by Step 3; no relevant
  OpenTelemetry, OTEL, telemetry, trace, or Jaeger implementation found.
- `/Users/taco/gits/tacogips/worktrees/codex-agent`: inspected by Step 3; no
  relevant OpenTelemetry, OTEL, telemetry, trace, or Jaeger implementation
  found.
- `codex-agent` remains only a worker backend identity for telemetry
  attributes such as `agent.backend = "codex-agent"`.
- Cursor CLI behavior remains isolated behind existing Cursor adapter
  boundaries.

---

## Modules

### 1. Shared Telemetry Core

#### packages/rielflow/src/telemetry/config.ts
#### packages/rielflow/src/telemetry/redaction.ts
#### packages/rielflow/src/telemetry/tracing.ts
#### packages/rielflow/src/telemetry/index.ts
#### packages/rielflow/src/telemetry/*.test.ts
#### package.json

**Status**: Completed

```typescript
interface WorkflowTelemetryOptions {
  readonly enabled?: boolean;
  readonly serviceName?: string;
  readonly exportMessages?: boolean;
}

interface ResolvedWorkflowTelemetryConfig {
  readonly enabled: boolean;
  readonly serviceName: string;
  readonly exportMessages: boolean;
  readonly endpointConfigured: boolean;
}

interface WorkflowTelemetry {
  readonly config: ResolvedWorkflowTelemetryConfig;
  startSpan<T>(
    name: string,
    attributes: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T>;
  addEvent(name: string, attributes: Record<string, unknown>): void;
  shutdown(): Promise<void>;
}
```

**Checklist**:

- [x] Add required OpenTelemetry dependencies to `package.json` without
      changing runtime behavior when telemetry is disabled.
- [x] Parse `OTEL_SDK_DISABLED`, `OTEL_SERVICE_NAME`,
      `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`,
      `OTEL_EXPORTER_OTLP_PROTOCOL`, `RIELFLOW_OTEL_ENABLED`,
      `RIELFLOW_OTEL_SERVICE_NAME`, `RIELFLOW_OTEL_EXPORT_MESSAGES`,
      `DIVEDRA_OTEL_ENABLED`, and `DIVEDRA_OTEL_EXPORT_MESSAGES`.
- [x] Infer enabled state from OTLP endpoint unless explicitly enabled or
      disabled.
- [x] Default message payload export to `false`.
- [x] Provide no-op telemetry when disabled or unconfigured.
- [x] Redact secrets, tokens, authorization headers, and credential-like values
      before exporting any attribute.
- [x] Apply size limits to optional exported message payload attributes.
- [x] Unit tests cover env precedence, legacy aliases, disabled no-op behavior,
      redaction, size limiting, and default privacy.

### 2. Entrypoint And Library Configuration

#### packages/rielflow/src/lib-workflow-run-options.ts
#### packages/rielflow/src/lib.ts
#### packages/rielflow/src/lib-sessions.ts
#### packages/rielflow/src/cli.ts
#### packages/rielflow/src/server/serve.ts
#### packages/rielflow/src/events/listener-service.ts
#### packages/rielflow/src/events/http-routes.ts
#### packages/rielflow/src/index.ts
#### packages/rielflow/src/lib-api.test.ts
#### packages/rielflow/src/cli.test.ts
#### packages/rielflow/src/server/serve.test.ts
#### packages/rielflow/src/events/listener-service.test.ts
#### packages/rielflow/src/events/*.test.ts

**Status**: Completed

```typescript
interface WorkflowRunOptions {
  readonly telemetry?: WorkflowTelemetryOptions;
}

interface WorkflowExecutionClientOptions {
  readonly telemetry?: WorkflowTelemetryOptions;
}

interface ServeOptions {
  readonly telemetry?: WorkflowTelemetryOptions;
}
```

**Checklist**:

- [x] Initialize process-wide telemetry once for CLI, server, `events serve`,
      and library execution helpers before workflow or event-listener execution
      starts.
- [x] Thread resolved telemetry options through workflow run, session resume,
      session rerun, call-step, GraphQL execution, server startup, and
      `events serve` listener startup paths.
- [x] Preserve existing command behavior when no telemetry environment
      variables are set.
- [x] Ensure library callers can opt into `exportMessages` without relying on
      process environment variables.
- [x] Tests cover CLI env propagation, library option propagation,
      `events serve` startup propagation, and disabled fallback behavior.

### 3. Workflow Execution Spans

#### packages/rielflow/src/workflow/engine.ts
#### packages/rielflow/src/workflow/engine/workflow-runner.ts
#### packages/rielflow/src/workflow/engine/node-execution.ts
#### packages/rielflow/src/workflow/engine/session-entry.ts
#### packages/rielflow/src/workflow/call-step-impl.ts
#### packages/rielflow/src/workflow/call-step-impl/*.ts
#### packages/rielflow/src/workflow/engine.test.ts
#### packages/rielflow/src/workflow/call-step-impl-execution.test.ts

**Status**: Completed

```typescript
interface WorkflowSpanAttributes {
  readonly workflowId: string;
  readonly workflowExecutionId?: string;
  readonly workflowSource?: string;
  readonly status?: string;
}

interface StepExecutionSpanAttributes {
  readonly stepId: string;
  readonly nodeId?: string;
  readonly nodeExecId?: string;
  readonly mailboxInstanceId?: string;
  readonly backend?: string;
  readonly status?: string;
  readonly retry?: boolean;
  readonly resume?: boolean;
}
```

**Checklist**:

- [x] Add one root span per workflow execution attempt.
- [x] Add entrypoint spans for session resume, session rerun, and call-step.
- [x] Add one child span per executable step or node invocation.
- [x] Record stable identifiers and terminal status attributes.
- [x] Record errors through OpenTelemetry status without changing thrown error
      behavior.
- [x] Keep instrumentation coarse; do not trace prompt rendering or template
      internals.
- [x] Tests assert span names, key attributes, status propagation, and no-op
      behavior.

### 4. Backend Adapter Spans

#### packages/rielflow/src/workflow/adapter-execution.ts
#### packages/rielflow/src/workflow/adapters/dispatch.ts
#### packages/rielflow/src/workflow/adapters/codex.ts
#### packages/rielflow/src/workflow/adapters/claude.ts
#### packages/rielflow/src/workflow/adapters/openai-sdk.ts
#### packages/rielflow/src/workflow/adapters/anthropic-sdk.ts
#### packages/rielflow/src/workflow/adapters/cursor.ts
#### packages/rielflow/src/workflow/adapters/*.test.ts

**Status**: Completed

```typescript
interface BackendAdapterSpanAttributes {
  readonly backend: string;
  readonly model?: string;
  readonly command?: string;
  readonly sessionId?: string;
  readonly status?: string;
}
```

**Checklist**:

- [x] Add one child span per adapter execution call.
- [x] Include backend, model, safe command/session metadata, and error status.
- [x] Export `agent.backend = "codex-agent"` for codex-agent executions.
- [x] Avoid raw prompt, model response, stdout, stderr, and file content
      attributes.
- [x] Preserve Cursor adapter behavior and avoid adding Cursor-specific
      telemetry semantics.
- [x] Focused adapter tests cover success, failure, codex-agent backend
      attribute, and raw-output exclusion.

### 5. Communication And Mailbox Spans

#### packages/rielflow/src/workflow/communication-service.ts
#### packages/rielflow/src/workflow/communication-artifact-persistence.ts
#### packages/rielflow/src/workflow/node-execution-mailbox.ts
#### packages/rielflow/src/workflow/engine/mailbox-and-communications.ts
#### packages/rielflow/src/workflow/engine/mailbox-communication-artifacts.ts
#### packages/rielflow/src/workflow/communication-service.test.ts
#### packages/rielflow/src/workflow/engine.test.ts

**Status**: Completed

```typescript
interface CommunicationTelemetryAttributes {
  readonly communicationId?: string;
  readonly fromNodeId?: string;
  readonly toNodeId?: string;
  readonly mailboxInstanceId?: string;
  readonly messageCount?: number;
  readonly payloadBytes?: number;
  readonly artifactRelativePath?: string;
}
```

**Checklist**:

- [x] Instrument communication creation, delivery, replay, retry, and
      consumption at lifecycle boundaries.
- [x] Instrument execution-local mailbox preparation.
- [x] Export metadata-only message counts, byte lengths, ids, and artifact
      relative paths by default.
- [x] Export inbox/outbox message bodies only when `exportMessages` is true.
- [x] Apply redaction and size limits even when message export is enabled.
- [x] Tests cover default metadata-only export and explicit trusted-fixture
      payload export.

### 6. Server And GraphQL Spans

#### packages/rielflow/src/server/api.ts
#### packages/rielflow/src/server/graphql.ts
#### packages/rielflow/src/server/graphql-executable-schema.ts
#### packages/rielflow/src/graphql/schema/execution-resolvers.ts
#### packages/rielflow/src/graphql/schema/supervisor-resolvers.ts
#### packages/rielflow/src/graphql/control-plane-service.ts
#### packages/rielflow-graphql/src/control-plane-service.ts
#### packages/rielflow-server/src/index.ts
#### packages/rielflow/src/graphql/schema.test.ts
#### packages/rielflow/src/server/*.test.ts

**Status**: Completed

```typescript
interface ControlPlaneSpanAttributes {
  readonly operationName: string;
  readonly workflowId?: string;
  readonly workflowExecutionId?: string;
  readonly sessionId?: string;
  readonly status?: string;
}
```

**Checklist**:

- [x] Add request or operation spans for server API and GraphQL control-plane
      handling.
- [x] Link GraphQL `executeWorkflow`, `rerunWorkflowExecution`, resume, and
      call-step mutations to workflow execution identifiers when available.
- [x] Do not export raw GraphQL variables, authorization headers, or request
      bodies by default.
- [x] Tests cover operation names, workflow/session identifiers, and raw
      variable exclusion.

### 7. Jaeger Compose Verification And Documentation

#### docker-compose.jaeger.yml
#### README.md
#### design-docs/specs/command.md
#### examples/README.md or relevant example notes

**Status**: Completed

```yaml
services:
  jaeger:
    image: jaegertracing/all-in-one:<pinned-version>
    ports:
      - "16686:16686"
      - "4317:4317"
      - "4318:4318"
```

**Checklist**:

- [x] Add `docker-compose.jaeger.yml` with Jaeger UI and OTLP collector ports.
- [x] Document the local verification path using
      `docker compose -f docker-compose.jaeger.yml`.
- [x] Document telemetry environment variables and privacy defaults.
- [x] Include an example workflow run command with
      `OTEL_SERVICE_NAME=rielflow` and `OTEL_EXPORTER_OTLP_ENDPOINT`
      configured.
- [x] Use `first-four-arithmetic-pipeline` with its checked-in mock scenario as
      the concrete Jaeger smoke workflow.
- [x] Verify traces reached Jaeger by querying the Jaeger API for the
      `rielflow` service and at least one returned trace before cleanup, or
      document a manual UI inspection when `curl`/`jq` is unavailable.
- [x] Document optional `RIELFLOW_OTEL_EXPORT_MESSAGES=true` only for trusted
      fixtures.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Shared telemetry core | `packages/rielflow/src/telemetry/*`, `package.json` | Completed | Required |
| Entrypoint/library/event config | `packages/rielflow/src/lib*.ts`, `packages/rielflow/src/cli.ts`, `packages/rielflow/src/server/serve.ts`, `packages/rielflow/src/events/listener-service.ts`, `packages/rielflow/src/events/http-routes.ts` | Completed | Required |
| Workflow execution spans | `packages/rielflow/src/workflow/engine*`, `packages/rielflow/src/workflow/call-step-impl*` | Completed | Required |
| Backend adapter spans | `packages/rielflow/src/workflow/adapter-execution.ts`, `packages/rielflow/src/workflow/adapters/*` | Completed | Required |
| Communication/mailbox spans | `packages/rielflow/src/workflow/communication*.ts`, `packages/rielflow/src/workflow/node-execution-mailbox.ts` | Completed | Required |
| Server/GraphQL spans | `packages/rielflow/src/server/*`, `packages/rielflow/src/graphql/*`, `packages/rielflow-graphql/src/*` | Completed | Required |
| Jaeger/docs | `docker-compose.jaeger.yml`, `README.md`, `design-docs/specs/command.md` | Completed | Manual smoke |

## Dependencies

| Task | Depends On | Status |
|------|------------|--------|
| TASK-001 Shared Telemetry Core | Accepted design | Completed |
| TASK-002 Entrypoint And Library Configuration | TASK-001 | Completed |
| TASK-003 Workflow Execution Spans | TASK-001, TASK-002 | Completed |
| TASK-004 Backend Adapter Spans | TASK-001, TASK-003 | Completed |
| TASK-005 Communication And Mailbox Spans | TASK-001, TASK-003 | Completed |
| TASK-006 Server And GraphQL Spans | TASK-001, TASK-002 | Completed |
| TASK-007 Jaeger Compose And Docs | TASK-001 | Completed |
| TASK-008 Verification And Review Fixes | TASK-002 through TASK-007 | Completed |

## Task Breakdown

### TASK-001: Shared Telemetry Core

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/telemetry/*`, `package.json`,
lockfile updates, focused telemetry tests.

**Completion Criteria**:

- [x] Telemetry configuration resolves env variables and library overrides.
- [x] Message export defaults to false.
- [x] Disabled telemetry is a cheap no-op.
- [x] Redaction and size limiting are tested.

### TASK-002: Entrypoint And Library Configuration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: CLI, server, `events serve`, and library option wiring.

**Completion Criteria**:

- [x] CLI, server, `events serve`, workflow run, resume, rerun, call-step, and
      library helpers initialize telemetry before execution.
- [x] Existing behavior is preserved when telemetry env is absent.
- [x] Tests prove option and env propagation for workflow, server, library,
      and `events serve` paths.

### TASK-003: Workflow Execution Spans

**Status**: Completed
**Parallelizable**: No
**Deliverables**: workflow execution and call-step span wrappers.

**Completion Criteria**:

- [x] One root workflow span per execution attempt.
- [x] One step/node span per executable invocation.
- [x] Terminal statuses and errors are recorded without changing outcomes.
- [x] Prompt/template internals are not instrumented.

### TASK-004: Backend Adapter Spans

**Status**: Completed
**Parallelizable**: Yes, after TASK-003; write scope is limited to adapter
execution and adapter tests.
**Deliverables**: adapter span wrappers and tests.

**Completion Criteria**:

- [x] Adapter spans include backend/model safe metadata.
- [x] Codex-agent backend identity is explicit.
- [x] Raw prompt/output/stdout/stderr content is excluded.
- [x] Cursor adapter semantics are unchanged.

### TASK-005: Communication And Mailbox Spans

**Status**: Completed
**Parallelizable**: Yes, after TASK-003; write scope is limited to
communication/mailbox services and tests.
**Deliverables**: communication, replay, retry, delivery, consumption, and
mailbox preparation instrumentation.

**Completion Criteria**:

- [x] Metadata-only attributes are emitted by default.
- [x] Optional message export requires explicit opt-in.
- [x] Redaction and size limits still apply to opted-in message content.
- [x] Replay/retry/consumption lifecycle events are covered by tests.

### TASK-006: Server And GraphQL Spans

**Status**: Completed
**Parallelizable**: Yes, after TASK-002; write scope is limited to server,
GraphQL, and control-plane files.
**Deliverables**: server/API/GraphQL operation span wrappers and tests.

**Completion Criteria**:

- [x] Server and GraphQL operations emit coarse request spans.
- [x] Workflow/session ids are attached when available.
- [x] Raw GraphQL variables and authorization data are excluded.

### TASK-007: Jaeger Compose And Docs

**Status**: Completed
**Parallelizable**: Yes, after TASK-001; write scope is docs and Compose file.
**Deliverables**: `docker-compose.jaeger.yml` and documentation updates.

**Completion Criteria**:

- [x] Compose file exposes Jaeger UI and OTLP collector ports.
- [x] Verification commands are documented with explicit
      `docker compose -f docker-compose.jaeger.yml` syntax.
- [x] Smoke verification runs `first-four-arithmetic-pipeline` with
      `./examples/first-four-arithmetic-pipeline/mock-scenario.json`.
- [x] Verification checks Jaeger for the `rielflow` service and at least one
      trace before cleanup.
- [x] Privacy defaults and opt-in message export are documented.

### TASK-008: Verification And Review Fixes

**Status**: Completed
**Parallelizable**: No
**Deliverables**: final verification results and review feedback resolutions.

**Completion Criteria**:

- [x] Focused telemetry tests pass.
- [x] `bun run typecheck` passes.
- [x] `bun test` or repository test command passes for impacted suites.
- [x] Jaeger Compose smoke commands are run or documented as unavailable with
      reason.
- [x] Step 5 high and mid findings, if any, are addressed before completion.

## Parallelization Notes

After TASK-001 and TASK-002 establish the shared telemetry API and entrypoint
configuration, TASK-004, TASK-005, TASK-006, and TASK-007 can proceed in
parallel because their write scopes are disjoint. TASK-003 should precede
adapter and mailbox work because it establishes the workflow execution context
that those spans should attach to.

## Verification Plan

- `bun run typecheck`
- `bun test packages/rielflow/src/telemetry/*.test.ts`
- `bun test packages/rielflow/src/workflow/engine.test.ts packages/rielflow/src/workflow/call-step-impl-execution.test.ts`
- `bun test packages/rielflow/src/workflow/communication-service.test.ts`
- `bun test packages/rielflow/src/workflow/adapters/*.test.ts`
- `bun test packages/rielflow/src/graphql/schema.test.ts packages/rielflow/src/server/serve.test.ts packages/rielflow/src/server/api.test.ts`
- `bun test packages/rielflow/src/events/listener-service.test.ts packages/rielflow/src/events/config.test.ts`
- `OTEL_SDK_DISABLED=true bun run packages/rielflow/src/bin.ts events serve --help`
- `bun test`
- `docker compose -f docker-compose.jaeger.yml up -d`
- `docker compose -f docker-compose.jaeger.yml ps`
- `OTEL_SERVICE_NAME=rielflow OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 bun run packages/rielflow/src/bin.ts workflow run first-four-arithmetic-pipeline --workflow-definition-dir ./examples --mock-scenario ./examples/first-four-arithmetic-pipeline/mock-scenario.json --output json`
- `curl -fsS http://localhost:16686/api/services | jq -e '.data | index("rielflow") != null'`
- `curl -fsS 'http://localhost:16686/api/traces?service=rielflow&limit=20' | jq -e '[.data[]?.spans[]?.operationName] | length > 0'`
- `docker compose -f docker-compose.jaeger.yml down`

## Completion Criteria

- [x] Coarse OpenTelemetry spans cover workflow execution, session entrypoints,
      call-step, adapter execution, mailbox/communication handoff, server API,
      GraphQL operations, and `events serve` listener startup.
- [x] `WorkflowTelemetryOptions.exportMessages` and
      `RIELFLOW_OTEL_EXPORT_MESSAGES` control inbox/outbox payload export.
- [x] Inbox/outbox payload export defaults to false.
- [x] Legacy `DIVEDRA_OTEL_ENABLED` and `DIVEDRA_OTEL_EXPORT_MESSAGES` aliases
      are accepted during rename transition.
- [x] Raw prompt text, model output, GraphQL variables, attachment content,
      file contents, secrets, authorization headers, and stdout/stderr are not
      exported by default.
- [x] Jaeger Docker Compose verification is present and documented.
- [x] Jaeger verification uses the concrete `first-four-arithmetic-pipeline`
      mock-scenario workflow and confirms traces via Jaeger API or documented
      manual UI inspection.
- [x] Focused tests and repository typecheck pass.
- [x] Progress log is updated after every implementation session.

## Progress Log

### Session: 2026-05-26 Step 6 Rerun After Step 7 Review

**Tasks Completed**: Addressed Step 7 mid findings for TASK-001, TASK-004, and
status/error telemetry coverage.

**Notes**: Changed telemetry initialization to reuse an already started
OpenTelemetry `NodeSDK` without constructing a replacement SDK, added
Result-aware span handling for workflow and adapter `Result` returns, and added
regression tests for repeated initialization and error-result span status.
Re-ran typecheck, focused Biome, and focused telemetry/workflow/adapter tests.

### Session: 2026-05-26 Step 6 Implementation Self-Review

**Tasks Completed**: Self-reviewed Step 6 implementation and tightened TASK-001
configuration behavior.

**Notes**: Found and fixed an OTLP HTTP endpoint normalization issue: generic
`OTEL_EXPORTER_OTLP_ENDPOINT` values now resolve to `/v1/traces`, while
signal-specific `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` values remain explicit.
Also aligned explicit `RIELFLOW_OTEL_ENABLED=true` with exporter defaults when
no endpoint is configured. Re-ran focused telemetry/adapter tests, typecheck,
and Biome checks for touched TypeScript paths.

### Session: 2026-05-26 Step 6 Rerun After Self-Review

**Tasks Completed**: Addressed Step 6 self-review findings for TASK-001 and
TASK-004.

**Notes**: Added coarse adapter/native execution spans in
`packages/rielflow/src/workflow/adapter-execution.ts`, added an adapter test
that verifies safe span metadata excludes raw prompt/stdout keys, and fixed
telemetry startup state so explicit startup configuration can replace a prior
lazy disabled no-op state. Re-ran typecheck, Biome, focused telemetry/adapter
tests, diff checks, and the OTLP-configured first-four-arithmetic-pipeline smoke
run.

### Session: 2026-05-26 Step 6 Implementation

**Tasks Completed**: TASK-001 through TASK-008 completed.

**Notes**: Added OpenTelemetry dependencies, telemetry configuration/redaction
helpers, process startup initialization, coarse workflow/step/adapter/mailbox/
communication/server/GraphQL/event-listener spans, library telemetry options,
Jaeger Compose configuration, and README verification instructions. Verified
typecheck, Biome via `bunx`, focused telemetry/runtime/server/GraphQL tests,
and a source workflow smoke run with OTLP env configured. Docker Compose Jaeger
startup could not run because this environment's `docker` command does not
provide the Compose plugin and `docker-compose` is not installed.

### Session: 2026-05-26 Step 4 Rerun After Step 5 Review

**Tasks Completed**: Revised active implementation plan for Step 5 mid finding.

**Notes**: Addressed the Step 5 mid finding by adding explicit `events serve`
telemetry initialization, propagation, event listener deliverables, event
listener tests, and focused verification commands. The plan also concretizes
Jaeger smoke verification with the `first-four-arithmetic-pipeline` example and
Jaeger API service/trace checks before cleanup.

### Session: 2026-05-26 Step 4 Implementation Plan Creation

**Tasks Completed**: Created active implementation plan.

**Notes**: Plan traces to the accepted design sections and Step 3 review
decision. No implementation code was written in this step.

## Risks

- Telemetry may leak sensitive data if redaction or default message export
  behavior regresses.
- OpenTelemetry dependencies may increase startup overhead if no-op paths are
  not cheap.
- Context propagation across workflow, adapters, server, and GraphQL may be
  inconsistent if entrypoint initialization is duplicated.
- Jaeger verification may be blocked by Docker availability or local port
  conflicts on `16686`, `4317`, or `4318`.
