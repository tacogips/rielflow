# Event Source Adapter Runtime Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-event-listener-workflow-trigger.md#provider-source-types
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: design-docs/specs/design-event-listener-workflow-trigger.md

### Summary

Implement the event source runtime layer that starts, stops, verifies, and
normalizes concrete event sources before handing canonical envelopes to the
foundation trigger pipeline. This plan starts with sources that do not require
provider SDK dependencies: cron, generic webhook, and metadata-only
S3-compatible repository file-created events.

### Scope

**Included**: adapter interface/registry, `events serve` lifecycle, cron source,
generic webhook source, S3-compatible repository event receiver normalization,
source capability validation, and focused unit/integration tests.

**Excluded**: Chat SDK provider adapters, Signal, automatic provider replies,
distributed cron locking, S3 object download-to-data-root, and workflow engine
changes beyond using the foundation event trigger boundary.

### Resolved Decisions

- Foundation event types, config loading, validation, ledger, and trigger runner
  are implemented.
- Webhook-backed sources acknowledge after receipt/mapping/async dispatch and
  validation rejects unsafe synchronous webhook bindings by default.
- The first S3 repository source is metadata-only; object download remains a
  later provider slice.

---

## Modules

### 1. Event Source Adapter Registry

#### src/events/source-adapter.ts and src/events/adapter-registry.ts

**Status**: COMPLETED

```typescript
interface RawExternalEvent {
  readonly sourceId: string;
  readonly receivedAt: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly rawRef?: EventArtifactRef;
}

interface EventSourceStartInput {
  readonly source: EventSourceConfig;
  readonly dispatch: (event: ExternalEventEnvelope) => Promise<void>;
  readonly signal: AbortSignal;
  readonly now: () => Date;
}

interface EventSourceHandle {
  readonly sourceId: string;
  stop(): Promise<void>;
}

interface EventSourceAdapter {
  readonly kind: string;
  readonly capabilities: EventSourceCapabilities;
  start(input: EventSourceStartInput): Promise<EventSourceHandle>;
  normalize(input: RawExternalEvent): Promise<ExternalEventEnvelope>;
}

interface EventSourceRegistry {
  register(adapter: EventSourceAdapter): void;
  get(kind: string): EventSourceAdapter | undefined;
  list(): readonly EventSourceAdapter[];
}
```

**Checklist**:

- [x] Define source adapter lifecycle and normalization interfaces
- [x] Implement deterministic registry with duplicate kind rejection
- [x] Register built-in cron, generic webhook, and S3 repository adapters
- [x] Unit tests for lookup, duplicate registration, and capability metadata

### 2. Event Listener Service And Serve Command

#### src/events/listener-service.ts and src/cli.ts

**Status**: COMPLETED

```typescript
interface EventListenerServeOptions {
  readonly eventRoot?: string;
  readonly workflowRoot?: string;
  readonly artifactRoot?: string;
  readonly sessionStoreRoot?: string;
  readonly endpoint?: string;
  readonly readOnly?: boolean;
}

interface EventListenerService {
  start(options: EventListenerServeOptions): Promise<EventListenerHandle>;
}

interface EventListenerHandle {
  readonly sources: readonly string[];
  stop(): Promise<void>;
}
```

**Checklist**:

- [x] Add `events serve [--event-root <path>] [--endpoint <graphql-url>]`
- [x] Load source and binding config through the foundation loader
- [x] Start enabled sources and dispatch normalized events asynchronously
- [x] Stop all source handles on abort, SIGINT, and SIGTERM
- [x] Tests cover no sources, unknown kind, start failure, and graceful stop

### 3. Cron Event Source

#### src/events/adapters/cron.ts

**Status**: COMPLETED

```typescript
interface CronSourceConfig extends EventSourceConfigBase {
  readonly kind: "cron";
  readonly schedule: string;
  readonly timezone: string;
  readonly jitterMs?: number;
  readonly missedRunPolicy?: "skip" | "fire-once";
  readonly lockKey?: string;
}

interface CronEventInput {
  readonly scheduleId: string;
  readonly scheduledAt: string;
  readonly firedAt: string;
  readonly timezone: string;
  readonly missedRunCount?: number;
}
```

**Checklist**:

- [x] Validate cron schedule and timezone during config validation
- [x] Start a single-process scheduler with abort-aware timers
- [x] Normalize events to `eventType: "cron.tick"`
- [x] Generate stable dedupe keys from source id and scheduled time
- [x] Unit tests avoid wall-clock sleeps for normalization and schedule helpers

### 4. Generic Webhook Event Source

#### src/events/adapters/webhook.ts and src/server/events.ts

**Status**: COMPLETED

```typescript
interface WebhookSourceConfig extends EventSourceConfigBase {
  readonly kind: "webhook";
  readonly path: string;
  readonly signingSecretEnv?: string;
  readonly signatureHeader?: string;
  readonly timestampHeader?: string;
  readonly replayWindowMs?: number;
}

interface WebhookVerificationResult {
  readonly ok: boolean;
  readonly reason?:
    | "missing-secret"
    | "missing-signature"
    | "invalid-signature"
    | "replay";
}
```

**Checklist**:

- [x] Expose source-scoped webhook routes only from `events serve`
- [x] Verify HMAC signatures when a signing secret env var is configured
- [x] Enforce timestamp replay windows when configured
- [x] Normalize accepted payloads to provider-neutral event envelopes
- [x] Tests cover valid, duplicate, malformed, unsigned, and replayed payloads

### 5. S3-Compatible Repository File Source

#### src/events/adapters/s3-repository.ts

**Status**: COMPLETED

```typescript
interface S3RepositorySourceConfig extends EventSourceConfigBase {
  readonly kind: "s3-repository";
  readonly provider: "aws-s3" | "s3-compatible";
  readonly endpointUrlEnv?: string;
  readonly region?: string;
  readonly bucket: string;
  readonly rootPrefix?: string;
  readonly eventReceiver: S3RepositoryEventReceiverConfig;
  readonly objectAccess: { readonly mode: "metadata-only" };
  readonly filters?: { readonly suffixes?: readonly string[] };
}

interface S3RepositoryFileCreatedInput {
  readonly repository: Readonly<Record<string, unknown>>;
  readonly file: Readonly<Record<string, unknown>>;
  readonly receiver: Readonly<Record<string, unknown>>;
}
```

**Checklist**:

- [x] Reject polling receiver mode and missing explicit object access policy
- [x] Normalize object-created notifications from webhook/event bridge payloads
- [x] Enforce bucket, root prefix, and suffix allow-list checks before dispatch
- [x] Derive repository-relative paths without treating object keys as host paths
- [x] Dedupe by source, bucket, key, and version id or sequencer
- [x] Tests cover AWS-style, MinIO-style, filtered, duplicate, and unsafe keys

### 6. Integration Tests And Examples

#### src/events/\*.test.ts and examples/event-sources/

**Status**: COMPLETED

```typescript
interface EventSourceFixtureScenario {
  readonly sourceConfig: Readonly<Record<string, unknown>>;
  readonly bindingConfig: Readonly<Record<string, unknown>>;
  readonly rawEvent: Readonly<Record<string, unknown>>;
  readonly expectedRuntimeVariables: Readonly<Record<string, unknown>>;
}
```

**Checklist**:

- [x] Add fixture workflow and `.divedra-events` examples for cron and webhook
- [x] Add S3 metadata-only fixture payloads without real credentials
- [x] Verify `events serve` dispatches through local and GraphQL trigger modes
- [x] Verify source adapters do not import `src/workflow/engine.ts`

## Tasks

### TASK-001: Source Adapter Registry

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/events/source-adapter.ts`, `src/events/adapter-registry.ts`
**Dependencies**: `event-listener-workflow-trigger-foundation:TASK-001`

**Completion Criteria**:

- [x] Adapter lifecycle interfaces and capabilities are exported
- [x] Built-in adapter registration is deterministic
- [x] Registry tests pass

### TASK-002: Listener Service And CLI Serve

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/listener-service.ts`, `src/cli.ts`, `src/cli.test.ts`
**Dependencies**: TASK-001, `event-listener-workflow-trigger-foundation:TASK-004`

**Completion Criteria**:

- [x] `events serve` starts enabled sources and dispatches envelopes
- [x] Local and GraphQL dispatch modes are wired through the foundation runner
- [x] Shutdown and failed-start paths have tests

### TASK-003: Cron Adapter

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/events/adapters/cron.ts`
**Dependencies**: TASK-001, `event-listener-workflow-trigger-foundation:TASK-002`

**Completion Criteria**:

- [x] Cron source validates schedule and timezone
- [x] Scheduler emits canonical `cron.tick` envelopes
- [x] Tests cover dedupe key and schedule behavior without wall-clock sleeps

### TASK-004: Generic Webhook Adapter

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/events/adapters/webhook.ts`, `src/server/events.ts`
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:

- [x] Source-scoped webhook routes are only active under `events serve`
- [x] Signature and replay-window verification are tested
- [x] Webhook acknowledgement does not wait for workflow completion

### TASK-005: S3 Repository Metadata Adapter

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/events/adapters/s3-repository.ts`
**Dependencies**: TASK-001, TASK-004

**Completion Criteria**:

- [x] S3-compatible object-created payloads normalize to `repository.file.created`
- [x] Bucket, prefix, suffix, and unsafe key checks are enforced
- [x] Metadata-only runtime input fixtures match the design examples

### TASK-006: Event Source Fixtures And End-To-End Coverage

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/*.test.ts`, `examples/event-sources/`
**Dependencies**: TASK-002, TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [x] Cron, webhook, and S3 fixtures are documented and runnable
- [x] Local and GraphQL dispatch integration tests pass
- [x] Provider SDKs remain absent from `src/workflow/`

## Module Status

| Module              | File Path                              | Status | Tests |
| ------------------- | -------------------------------------- | ------ | ----- |
| Adapter registry    | `src/events/source-adapter.ts`         | DONE   | Yes   |
| Listener service    | `src/events/listener-service.ts`       | DONE   | Yes   |
| Cron adapter        | `src/events/adapters/cron.ts`          | DONE   | Yes   |
| Webhook adapter     | `src/events/adapters/webhook.ts`       | DONE   | Yes   |
| S3 repository input | `src/events/adapters/s3-repository.ts` | DONE   | Yes   |
| Fixtures/examples   | `examples/event-sources/`              | DONE   | Yes   |

## Dependencies

| Feature          | Depends On                                  | Status |
| ---------------- | ------------------------------------------- | ------ |
| Source adapters  | Event foundation types and config loader    | DONE   |
| Listener service | Foundation trigger runner and ledger        | DONE   |
| Cron source      | Source registry and validation              | DONE   |
| Webhook source   | Listener service and async policy decision  | DONE   |
| S3 source        | Webhook receiver and metadata-only decision | DONE   |

## Completion Criteria

- [x] `events serve` can run source adapters without importing provider logic into `src/workflow/`
- [x] Cron, generic webhook, and S3 metadata-only sources normalize canonical envelopes
- [x] Webhook acknowledgement stays asynchronous by default
- [x] Source adapter validation catches unsupported kinds and unsafe source config
- [x] Event source fixtures demonstrate runnable operator configuration
- [x] Type checking passes
- [x] Focused tests pass

## Progress Log

### Session: 2026-04-20 14:00

**Tasks Completed**: Plan created
**Tasks In Progress**: None
**Blockers**: Event listener foundation plan and unresolved event-trigger QA decisions
**Notes**: Split concrete event source runtime work from the existing foundation
plan so source adapters can be implemented after config, ledger, mapping, and
dispatch primitives are available.

### Session: 2026-04-20 15:10

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented the adapter registry, `events serve`, cron scheduling,
generic webhook verification/normalization, S3-compatible metadata-only
normalization, and runnable event-source fixtures. Verified with `bun run
typecheck`, focused event/CLI tests, example event validation, and the full
`bun test` suite.

### Session: 2026-04-20 15:55

**Tasks Completed**: Testability hardening for TASK-001, TASK-002, TASK-003,
TASK-004, TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added explicit mock-based unit coverage for adapter registry
injection, chat-shaped webhook dispatch through an injected listener runtime,
cron schedule/normalization helpers without wall-clock sleeps, and provider-free
S3 metadata normalization. The chat-shaped test uses a mocked GraphQL fetch and
does not connect to Slack, Discord, Telegram, or another chat API.

## Related Plans

- **Previous**: `impl-plans/event-listener-workflow-trigger-foundation.md`
- **Next**: Chat SDK provider adapter plan after source runtime completion
- **Depends On**:
  `impl-plans/event-listener-workflow-trigger-foundation.md`
