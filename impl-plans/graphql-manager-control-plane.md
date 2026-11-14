# GraphQL Manager Control Plane Foundation Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Current Plan**: `impl-plans/graphql-manager-control-plane.md`
- **Next Plan**: `impl-plans/graphql-manager-control-plane-surface.md`

## Design Document Reference

**Source**: `design-docs/specs/design-graphql-manager-control-plane.md`

### Summary

This plan implements the additive foundation required before the GraphQL schema and CLI surface can land safely:

- canonical root-data resolution with migration-safe compatibility aliases,
- communication inspection/replay/retry services over the existing mailbox artifacts,
- persisted manager-session, manager-message, and idempotency state.

### Scope

**Included**:
- root-data path resolution helpers used by artifact, session, and future attachment flows
- communication lookup/replay/retry service on top of current session/mailbox artifacts
- manager-session persistence and idempotency storage
- library exports and targeted tests for the new foundation modules

**Excluded**:
- GraphQL SDL/schema construction
- `/graphql` HTTP handler integration
- `divedra gql` CLI client and prompt/tool contract changes
- browser UI GraphQL migration

## Modules

### 1. Root Data Resolution

#### `src/workflow/types.ts`, `src/workflow/paths.ts`, `src/workflow/session-store.ts`, `src/workflow/runtime-db.ts`

**Status**: COMPLETED

```typescript
export interface LoadOptions {
  readonly workflowRoot?: string;
  readonly artifactRoot?: string;
  readonly rootDataDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}

export interface EffectiveRoots {
  readonly workflowRoot: string;
  readonly artifactRoot: string;
  readonly rootDataDir: string;
  readonly attachmentRoot: string;
}

export function resolveRootDataDir(options?: LoadOptions): string;
export function resolveAttachmentRoot(options?: LoadOptions): string;
export function resolveEffectiveRoots(options?: LoadOptions): EffectiveRoots;
```

**Checklist**:
- [x] Introduce `rootDataDir` as an explicit load option
- [x] Treat `DIVEDRA_ROOT_DATA_DIR` as canonical and `DIVEDRA_RUNTIME_ROOT` as compatibility alias
- [x] Derive artifact/session/runtime defaults from the canonical root when surface-specific overrides are absent
- [x] Cover precedence with tests

### 2. Communication Service

#### `src/workflow/communication-service.ts`

**Status**: COMPLETED

```typescript
export interface CommunicationLookupInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationId: string;
}

export interface ReplayCommunicationInput extends CommunicationLookupInput {
  readonly managerSessionId?: string;
  readonly idempotencyKey?: string;
  readonly reason?: string;
}

export interface RetryCommunicationDeliveryInput
  extends CommunicationLookupInput {
  readonly managerSessionId?: string;
  readonly idempotencyKey?: string;
  readonly reason?: string;
}

export interface CommunicationArtifactSnapshot {
  readonly messageJson: string | null;
  readonly metaJson: string | null;
  readonly outboxMessageJson: string | null;
  readonly outboxOutputRaw: string | null;
  readonly inboxMessageJson: string | null;
  readonly attemptFiles: readonly CommunicationAttemptSnapshot[];
}

export interface CommunicationGraphqlView {
  readonly record: CommunicationRecord;
  readonly sourceNodeExecution: NodeExecutionRecord | null;
  readonly consumedByNodeExecution: NodeExecutionRecord | null;
  readonly artifactSnapshot: CommunicationArtifactSnapshot;
}

export interface CommunicationService {
  getCommunication(
    input: CommunicationLookupInput,
    options?: CommunicationServiceOptions,
  ): Promise<CommunicationGraphqlView | null>;
  replayCommunication(
    input: ReplayCommunicationInput,
    options?: CommunicationServiceOptions,
  ): Promise<ReplayCommunicationResult>;
  retryCommunicationDelivery(
    input: RetryCommunicationDeliveryInput,
    options?: CommunicationServiceOptions,
  ): Promise<RetryCommunicationDeliveryResult>;
}
```

**Checklist**:
- [x] Load communication records and mailbox artifact snapshots by canonical lookup shape
- [x] Preserve retry-vs-replay semantics from the mailbox design
- [x] Persist replay supersession metadata additively on communication records
- [x] Honor stored idempotent responses when `(managerSessionId, idempotencyKey)` is provided
- [x] Cover lookup, replay, retry, and idempotency with tests

### 3. Manager Session Store

#### `src/workflow/manager-session-store.ts`

**Status**: COMPLETED

```typescript
export interface ManagerSessionRecord {
  readonly managerSessionId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerRuntimeId: string;
  readonly managerNodeExecId: string;
  readonly status: "active" | "completed" | "failed" | "cancelled";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastMessageId?: string;
  readonly authTokenHash: string;
  readonly authTokenExpiresAt: string;
}

export interface ManagerMessageRecord {
  readonly managerMessageId: string;
  readonly managerSessionId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerRuntimeId: string;
  readonly managerNodeExecId: string;
  readonly message?: string;
  readonly parsedIntent: readonly ManagerIntentSummary[];
  readonly accepted: boolean;
  readonly rejectionReason?: string;
  readonly createdAt: string;
}

export interface ManagerSessionStore {
  createOrResumeSession(input: ManagerSessionRecord): Promise<ManagerSessionRecord>;
  appendMessage(input: ManagerMessageRecord): Promise<ManagerMessageRecord>;
  loadSession(managerSessionId: string): Promise<ManagerSessionRecord | null>;
  listMessages(managerSessionId: string): Promise<readonly ManagerMessageRecord[]>;
  saveIdempotentResult(
    input: IdempotentMutationRecord,
  ): Promise<IdempotentMutationRecord>;
  loadIdempotentResult(
    input: IdempotentMutationLookup,
  ): Promise<IdempotentMutationRecord | null>;
}

export interface AmbientManagerExecutionContext {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerRuntimeId: string;
  readonly managerNodeExecId: string;
  readonly managerSessionId?: string;
  readonly authToken?: string;
}

export function createManagerSessionStore(
  options?: LoadOptions,
): ManagerSessionStore;
export function resolveAmbientManagerExecutionContext(
  env?: Readonly<Record<string, string | undefined>>,
): AmbientManagerExecutionContext | null;
```

**Checklist**:
- [x] Persist manager sessions, messages, and idempotent mutation rows
- [x] Keep the store independent from workflow session snapshot files
- [x] Provide safe ambient manager-context resolution
- [x] Cover token hashing/verification and idempotency lookups with tests

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Root data resolution | `src/workflow/types.ts`, `src/workflow/paths.ts` | COMPLETED | Passing |
| Communication service | `src/workflow/communication-service.ts` | COMPLETED | Passing |
| Manager session store | `src/workflow/manager-session-store.ts` | COMPLETED | Passing |
| Library exports | `src/lib.ts` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Communication service | Root data resolution | READY |
| Manager session store | Root data resolution | READY |
| GraphQL surface follow-up | Communication service, manager session store | COMPLETED |

## Tasks

### TASK-001: Root Data Contract Alignment

**Status**: Completed
**Parallelizable**: Yes

**Deliverables**:
- `src/workflow/types.ts`
- `src/workflow/paths.ts`
- `src/workflow/session-store.ts`
- `src/workflow/runtime-db.ts`
- targeted root-resolution tests

**Completion Criteria**:
- [x] `rootDataDir` exists as an additive load option
- [x] canonical root-data precedence is implemented
- [x] compatibility alias handling is test-covered
- [x] derived artifact/session/runtime paths use the shared helpers

### TASK-002: Communication Service Foundation

**Status**: Completed
**Parallelizable**: Yes

**Deliverables**:
- `src/workflow/communication-service.ts`
- `src/workflow/communication-service.test.ts`
- `src/lib.ts`

**Completion Criteria**:
- [x] Communication lookup loads record plus artifact snapshots
- [x] Replay allocates a new `communicationId`
- [x] Delivery retry allocates a new `deliveryAttemptId`
- [x] Replay/retry can reuse persisted idempotent responses
- [x] Library exports expose the service foundation

### TASK-003: Manager Session Persistence

**Status**: Completed
**Parallelizable**: Yes

**Deliverables**:
- `src/workflow/manager-session-store.ts`
- `src/workflow/manager-session-store.test.ts`

**Completion Criteria**:
- [x] Manager session storage exists
- [x] Manager message append log exists
- [x] Ambient manager execution context resolves safely
- [x] Idempotent mutation persistence exists
- [x] Persistence and token verification tests pass

## Completion Criteria

- [x] Root-data resolution is implemented and documented for the foundation slice
- [x] Communication inspection/replay/retry services exist over current mailbox artifacts
- [x] Manager-session persistence and idempotency storage exist
- [x] Typecheck and targeted tests for the foundation slice pass
- [x] Follow-up GraphQL surface plan is complete and ready for execution

## Progress Log

### Session: 2026-03-15
**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The original GraphQL plan was too large for the repository plan constraints and mixed foundation work with schema/CLI work. This revision narrows the first executable slice to shared root-data, communication-service, and manager-session-store work so the later GraphQL surface can sit on stable primitives.
