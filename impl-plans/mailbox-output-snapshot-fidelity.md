# Mailbox Output Snapshot Fidelity Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-node-mailbox.md#messagejson
**Created**: 2026-03-08
**Last Updated**: 2026-03-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-mailbox.md`

### Summary

Preserve mailbox `outbox/{fromNodeId}/output.json` as a byte-for-byte snapshot of the routed sender artifact instead of reconstructing it from parsed JSON values.

### Scope

**Included**:
- preserve raw `output.json` text through runtime mailbox persistence
- keep external mailbox publication aligned with the same byte-preserving rule
- add regression tests that compare source artifact bytes with mailbox snapshot bytes

**Excluded**:
- mailbox envelope schema changes
- communication id allocation changes
- API/UI changes

---

## Modules

### 1. Raw Output Snapshot Propagation

#### `src/workflow/engine.ts`

**Status**: COMPLETED

```ts
interface UpstreamInput extends UpstreamOutputRef {
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputRaw: string;
}

interface ForwardedManagerPayload {
  readonly payloadRef: OutputRef;
  readonly outputRaw: string;
}

interface CreateCommunicationInput {
  readonly outputRaw: string;
}
```

**Checklist**:
- [x] Mailbox persistence writes raw `output.json` bytes instead of reserializing objects
- [x] Forwarded manager deliveries preserve raw payload text from upstream artifacts
- [x] External mailbox publication uses the same byte-preserving snapshot rule

### 2. Regression Coverage

#### `src/workflow/engine.test.ts`

**Status**: COMPLETED

```ts
test("executes linear workflow and writes artifacts", async () => {});
test("delivers root human input through an external mailbox communication", async () => {});
test("publishes the completed workflow result to an external mailbox", async () => {});
```

**Checklist**:
- [x] Intra-workflow mailbox snapshot bytes match the sender execution artifact
- [x] External input mailbox snapshot bytes match the staged external artifact
- [x] External mailbox snapshot bytes match the published root output artifact

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Raw snapshot propagation | `src/workflow/engine.ts` | COMPLETED | `src/workflow/engine.test.ts` |
| Regression coverage | `src/workflow/engine.test.ts` | COMPLETED | targeted engine tests |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Mailbox snapshot fidelity | Existing mailbox runtime | Available |
| Regression tests | Snapshot fidelity implementation | COMPLETED |

## Completion Criteria

- [x] Mailbox `outbox/*/output.json` preserves source artifact bytes
- [x] External output publication preserves selected artifact bytes
- [x] Relevant workflow engine tests pass
- [x] Server type checking passes

## Suggested Verification Commands

```bash
bun test src/workflow/engine.test.ts
bun run typecheck:server
```

## Progress Log

### Session: 2026-03-08 23:58
**Tasks Completed**: Mailbox snapshot fidelity audit, runtime raw-output propagation, regression test hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Follow-up review found that mailbox outbox snapshots were being reconstructed from parsed JSON objects in several paths. That preserved value semantics but not the design's byte-match guarantee. The runtime now carries raw artifact text through mailbox persistence so filesystem inspection sees the exact routed payload bytes.

### Session: 2026-03-09 00:20
**Tasks Completed**: Follow-up review fix for resumed external-output publication and conversation-turn raw snapshot propagation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: A continuation review found one remaining gap: external output publication still reparsed and reserialized the selected artifact during final publication, and conversation-turn mailbox writes still did the same. The runtime now reuses raw artifact bytes for both paths, and regression coverage rewrites a valid `output.json` with non-canonical formatting before resume to prove the external mailbox snapshot preserves exact bytes.

### Session: 2026-03-09 00:35
**Tasks Completed**: Follow-up review hardening for external-input snapshot source-of-truth
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Another continuation review found that external mailbox input staging still produced the source artifact and outbox snapshot through two separate serialization calls. They matched today, but the design requires the mailbox snapshot to be copied from the exact staged artifact bytes. The runtime now writes the staged external-input `output.json` from the same raw string that is forwarded into `outbox/__workflow-input-mailbox__/output.json`.
