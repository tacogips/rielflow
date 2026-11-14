# GraphQL Manager Control Plane Surface Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Depends On**: `impl-plans/graphql-manager-control-plane.md`
- **Current Plan**: `impl-plans/graphql-manager-control-plane-surface.md`

## Design Document Reference

**Source**: `design-docs/specs/design-graphql-manager-control-plane.md`

### Summary

This plan layers the executable manager control-plane surface on top of the completed foundation services:

- transport-neutral manager-message application services
- manager-message provenance preparation for future mailbox-send actions
- GraphQL/domain schema and transport integration
- `divedra gql` CLI client and manager tool contract
- documentation and library consolidation

### Scope

**Included**:

- manager-message validation/materialization services
- queue-only and replay-based manager actions on the current runtime model
- GraphQL schema/types/server modules once the service layer is stable
- `divedra gql` transport client and variable loading
- docs updates for canonical GraphQL control-plane behavior

**Excluded**:

- browser UI migration from REST to GraphQL
- remote/distributed orchestration
- workflow-definition authoring via GraphQL

## Modules

### 1. Manager Message Service

#### `src/workflow/manager-message-service.ts`, `src/workflow/manager-control.ts`

**Status**: COMPLETED

```typescript
export interface SendManagerMessageInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerSessionId: string;
  readonly message?: string;
  readonly actions?: readonly ManagerControlAction[];
  readonly attachments?: readonly DataDirFileRef[];
  readonly idempotencyKey?: string;
}

export interface SendManagerMessageResult {
  readonly accepted: boolean;
  readonly managerMessageId: string;
  readonly parsedIntent: readonly ManagerIntentSummary[];
  readonly createdCommunicationIds: readonly string[];
  readonly queuedNodeIds: readonly string[];
  readonly rejectionReason?: string;
}

export interface ManagerMessageService {
  sendManagerMessage(
    input: SendManagerMessageInput,
    options?: SessionStoreOptions,
  ): Promise<SendManagerMessageResult>;
}
```

**Checklist**:

- [x] Typed manager actions are validated outside node-output parsing
- [x] Queue-only `start-sub-workflow` actions are materialized without mailbox provenance
- [x] Planner-note, retry-node, and replay-communication actions are materialized
- [x] Attachments use safe data-root-relative validation
- [x] Idempotent `sendManagerMessage` behavior is enforced

### 2. Manager Message Provenance Preparation

#### `src/workflow/session.ts`, `src/workflow/communication-service.ts`, `src/workflow/manager-message-service.ts`

**Status**: COMPLETED

```typescript
export type CommunicationPayloadRef = NodeOutputRef | ManagerMessagePayloadRef;

export interface NodeOutputRef {
  readonly kind: "node-output";
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly subWorkflowId?: string;
  readonly outputNodeId: string;
  readonly nodeExecId: string;
  readonly artifactDir: string;
}

export interface ManagerMessagePayloadRef {
  readonly kind: "manager-message";
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly subWorkflowId?: string;
  readonly outputNodeId: string;
  readonly nodeExecId: string;
  readonly artifactDir: string;
  readonly managerSessionId: string;
  readonly managerMessageId: string;
  readonly managerRuntimeId: string;
  readonly managerNodeExecId: string;
}
```

**Checklist**:

- [x] The provenance widening needed for manager-authored mailbox sends is designed into the types
- [x] Existing node-output-backed communications remain compatible
- [x] `sendManagerMessage` persists manager-message artifacts before mailbox materialization
- [x] `deliver-to-child-input` is accepted for the owning sub-manager with durable communication provenance

### 3. GraphQL Types and Schema

#### `src/graphql/types.ts`, `src/graphql/schema.ts`

**Status**: COMPLETED

```typescript
export interface GraphqlControlPlaneServices {
  readonly getCommunication(
    input: CommunicationLookupInput,
  ): Promise<CommunicationGraphqlView | null>;
  readonly sendManagerMessage(
    input: SendManagerMessageInput,
    context: GraphqlRequestContext,
  ): Promise<SendManagerMessageResult>;
}
```

**Checklist**:

- [x] GraphQL-facing domain types exist
- [x] Queries expose workflow execution, communication, node execution, and manager session views
- [x] Mutations expose execute/resume/rerun/cancel/send/replay/retry
- [x] Typed manager actions are enforced at the schema boundary via the manager-message service

### 4. Server Integration and CLI GraphQL Client

#### `src/server/graphql.ts`, `src/server/serve.ts`, `src/graphql/client.ts`, `src/cli.ts`

**Status**: COMPLETED

**Checklist**:

- [x] `/graphql` handler is available from `serve`
- [x] GraphQL auth context is derived from bearer tokens
- [x] data-root-relative attachment paths resolve safely
- [x] `divedra gql` exists with inline JSON and `@file.json` variables
- [x] ambient manager auth context is used by default

## Module Status

| Module                      | File Path                                                                    | Status      | Tests   |
| --------------------------- | ---------------------------------------------------------------------------- | ----------- | ------- |
| Manager message service     | `src/workflow/manager-message-service.ts`, `src/workflow/manager-control.ts` | COMPLETED   | Passing |
| Provenance preparation      | `src/workflow/session.ts`, `src/workflow/communication-service.ts`, `src/workflow/manager-message-service.ts` | COMPLETED   | Passing |
| GraphQL types/schema        | `src/graphql/types.ts`, `src/graphql/schema.ts`, `src/graphql/schema.test.ts` | COMPLETED   | Passing |
| GraphQL server + CLI        | `src/server/graphql.ts`, `src/graphql/client.ts`, `src/cli.ts`               | COMPLETED   | Passing |
| Documentation consolidation | `README.md`, `design-docs/specs/*.md`                                        | COMPLETED   | Passing |

## Dependencies

| Feature                                        | Depends On                                                     | Status  |
| ---------------------------------------------- | -------------------------------------------------------------- | ------- |
| Manager message service                        | Foundation plan                                                | READY   |
| Provenance widening for manager-authored sends | Manager message service                                        | READY   |
| GraphQL schema                                 | Manager message service, provenance widening for manager-authored sends | READY   |
| GraphQL server integration                     | GraphQL schema, provenance widening for manager-authored sends | READY   |
| CLI GraphQL client                             | GraphQL server integration                                     | COMPLETED |
| Documentation consolidation                    | Manager message service, GraphQL client                        | COMPLETED |

## Tasks

### TASK-001: Manager Message Service Foundation

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/workflow/manager-control.ts`
- `src/workflow/manager-message-service.ts`
- `src/workflow/manager-control.test.ts`
- `src/workflow/manager-message-service.test.ts`
- `src/lib.ts`

**Completion Criteria**:

- [x] Typed manager action validation is reusable outside node-output parsing
- [x] Queue-only `start-sub-workflow` actions are materialized safely without mailbox provenance
- [x] `planner-note`, `retry-node`, and `replay-communication` are materialized safely
- [x] Attachments are validated as data-root-relative file refs
- [x] `sendManagerMessage` idempotency is test-covered

### TASK-002: Manager Message Provenance Widening

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/workflow/session.ts`
- `src/workflow/communication-service.ts`
- `src/workflow/manager-message-service.ts`
- `src/workflow/manager-message-service.test.ts`
- `src/workflow/communication-service.test.ts`
- follow-up tests

**Completion Criteria**:

- [x] Communication provenance supports manager-message-originated payloads
- [x] Existing node-output communication flows remain compatible
- [x] Manager-authored mailbox-send actions can be implemented durably
- [x] `deliver-to-child-input` produces communication artifacts and queues the target input node

### TASK-003: GraphQL Types and Schema

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-002`

**Deliverables**:

- `src/graphql/types.ts`
- `src/graphql/schema.ts`
- `src/graphql/schema.test.ts`

**Completion Criteria**:

- [x] GraphQL domain types exist
- [x] Query and mutation entrypoints match the design doc
- [x] Typed manager action validation is integrated through the shared service

### TASK-004: Server GraphQL Integration and CLI GraphQL Client

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-003`
- `TASK-002`

**Deliverables**:

- `src/server/graphql.ts`
- `src/server/graphql.test.ts`
- `src/server/serve.ts`
- `src/graphql/client.ts`
- `src/cli.ts`
- `src/cli.test.ts`
- `src/workflow/prompts/divedra-role-system-prompt.md` (default manager system guidance; structural `divedra-system-prompt.md` removed as unused)

**Completion Criteria**:

- [x] `/graphql` is served
- [x] auth context and file-reference resolution are enforced
- [x] `divedra gql` sends documents and variables
- [x] bearer-token auth is used automatically when available

### TASK-005: Documentation Consolidation

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`
- `TASK-003`
- `TASK-004`

**Deliverables**:

- `src/lib.ts`
- `README.md`
- `design-docs/specs/command.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/notes.md`

**Completion Criteria**:

- [x] public library and docs describe GraphQL as canonical during migration
- [x] REST coexistence is documented accurately
- [x] root-data-dir precedence remains consistent with the foundation implementation

## Completion Criteria

- [x] manager-message service exists and is tested
- [x] manager-authored mailbox-send provenance is designed and implemented
- [x] `/graphql` exists and is tested
- [x] `divedra gql` works end-to-end
- [x] manager auth/idempotency behavior is enforced through the GraphQL surface
- [x] docs reflect the implemented migration state

## Progress Log

### Session: 2026-03-15

**Tasks Completed**: Plan creation only
**Tasks In Progress**: None
**Blockers**: Depends on the foundation plan
**Notes**: This follow-up plan intentionally starts after the root-data, communication-service, and manager-session primitives are in place.

### Session: 2026-03-15 2

**Tasks Completed**: Plan rescope only
**Tasks In Progress**: TASK-001
**Blockers**: The current mailbox persistence model is still node-output-centric, so manager-authored mailbox-send actions need a provenance widening step before full GraphQL transport work can finish.
**Notes**: The next executable slice is the transport-neutral manager-message application service. GraphQL transport remains the long-term surface, but it now depends on a concrete service layer and the provenance follow-up.

### Session: 2026-03-15 3

**Tasks Completed**: TASK-001
**Tasks In Progress**: None
**Blockers**: TASK-002 remains blocked on widening communication provenance beyond node-output-backed payload references.
**Notes**: Added a transport-neutral `ManagerMessageService`, extended typed manager action validation to cover planner-note and replay-communication, enforced attachment path safety under `DIVEDRA_ROOT_DATA_DIR`, and covered the slice with targeted tests and server typecheck.

### Session: 2026-03-15 4

**Tasks Completed**: TASK-001 follow-up alignment
**Tasks In Progress**: TASK-002
**Blockers**: `deliver-to-child-input` and mailbox-backed manager-originated sends still require widened payload provenance.
**Notes**: Aligned the service behavior with the design by allowing queue-only `start-sub-workflow` materialization through `sendManagerMessage` while keeping manager-authored mailbox-send variants rejected until discriminated communication payload provenance lands.

### Session: 2026-03-15 5

**Tasks Completed**: TASK-002 design clarification
**Tasks In Progress**: TASK-002
**Blockers**: None
**Notes**: Locked the concrete provenance shape to a discriminated `payloadRef` union plus workflow-artifact-tree manager-message artifacts so the next code slice can enable durable `deliver-to-child-input` delivery without regressing replay/retry compatibility.

### Session: 2026-03-15 6

**Tasks Completed**: TASK-002
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented discriminated communication payload provenance, persisted manager-message audit and payload artifacts under the workflow execution tree, enabled `deliver-to-child-input` for the owning sub-manager, and verified replay compatibility with targeted workflow tests plus server typecheck. TASK-003 is now the next unblocked slice.

### Session: 2026-03-15 7

**Tasks Completed**: TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added a transport-neutral GraphQL schema layer under `src/graphql/` with typed query/mutation contracts, communication/node/session inspection views, manager-session-authenticated manager mutations, and targeted tests. TASK-004 is now the next unblocked slice for `/graphql` transport wiring and the `divedra gql` client.

### Session: 2026-03-15 8

**Tasks Completed**: TASK-004, TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added `/graphql` transport handling to the shared server router, implemented a minimal GraphQL document executor plus HTTP client, wired `divedra gql` with inline and `@file` variable loading plus ambient bearer-token auth, exported the GraphQL surface from `src/lib.ts`, and aligned the README and design docs with the implemented transport and default endpoint behavior.
