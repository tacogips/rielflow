# GraphQL Manager Idempotency Canonicalization Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md#idempotency-contract
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-control-plane-surface.md`
- **Previous**: `impl-plans/graphql-manager-message-id-collision-safety.md`
- **Current Plan**: `impl-plans/graphql-manager-idempotency-canonicalization.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`

### Summary

Review of the current dirty GraphQL manager-control implementation found one remaining idempotency drift:

- `sendManagerMessage` persisted a "normalized request fingerprint",
- but the hash was built from raw input before message trimming, attachment path normalization, and action-shape canonicalization,
- so semantically identical retries could conflict or re-execute unnecessarily.

### Scope

**Included**:

- explicit design clarification for canonicalized `sendManagerMessage` idempotency
- canonical request normalization in `ManagerMessageService`
- targeted regression coverage for equivalent retries

**Excluded**:

- new GraphQL schema fields
- replay/retry mutation behavior changes beyond the existing idempotency contract
- browser/editor GraphQL migration

## Modules

### 1. Canonical `sendManagerMessage` Fingerprint

#### `src/workflow/manager-control.ts`, `src/workflow/manager-message-service.ts`

**Status**: COMPLETED

```typescript
export function parseManagerControlActionInput(
  value: unknown,
): ManagerControlAction;

export interface ManagerMessageService {
  sendManagerMessage(
    input: SendManagerMessageInput,
    options?: SessionStoreOptions,
  ): Promise<SendManagerMessageResult>;
}
```

**Checklist**:

- [x] message text is trimmed before fingerprinting
- [x] attachment paths are normalized before fingerprinting
- [x] action payloads are canonicalized before fingerprinting
- [x] execution behavior stays unchanged for non-idempotent calls

### 2. Regression Coverage

#### `src/workflow/manager-message-service.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] equivalent trimmed-vs-untrimmed manager messages reuse the stored response
- [x] equivalent attachment paths reuse the stored response
- [x] equivalent action payloads reuse the stored response

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Canonical fingerprinting | `src/workflow/manager-control.ts`, `src/workflow/manager-message-service.ts` | COMPLETED | Passing |
| Regression coverage | `src/workflow/manager-message-service.test.ts` | COMPLETED | Passing |
| Design alignment | `design-docs/specs/design-graphql-manager-control-plane.md` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Canonical manager-message fingerprint | `graphql-manager-control-plane-surface` | READY |
| Regression coverage | Canonical manager-message fingerprint | READY |

## Tasks

### TASK-001: Canonicalize `sendManagerMessage` Idempotency Inputs

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `graphql-manager-control-plane-surface:TASK-001`

**Deliverables**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `src/workflow/manager-control.ts`
- `src/workflow/manager-message-service.ts`
- `src/workflow/manager-message-service.test.ts`

**Completion Criteria**:

- [x] semantically identical retries hash to the same fingerprint
- [x] the normalization rules match the executed/persisted manager-message shape
- [x] targeted typecheck/tests pass

## Completion Criteria

- [x] `sendManagerMessage` idempotency now matches the design's normalized-request requirement
- [x] equivalent retries no longer conflict because of whitespace, path-shape, or empty optional action fields
- [x] targeted verification passes

## Progress Log

### Session: 2026-03-15 17:35 JST
**Tasks Completed**: TASK-001
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The control-plane architecture remained correct overall. The corrective work was to move `sendManagerMessage` idempotency onto the same canonical message/action/attachment shapes that the service already persists and executes.
