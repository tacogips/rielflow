# Mailbox Delivery Manager Ownership Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-node-mailbox.md#Write Ownership
**Created**: 2026-03-08
**Last Updated**: 2026-03-08

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-mailbox.md`

### Summary

Align mailbox `receipt.json.deliveredByNodeId` with the manager that actually owns the recipient delivery step.

The existing mailbox design already defines the intended behavior:
- root manager writes cross-boundary and root-scope deliveries
- sub-workflow managers write child deliveries inside their owned sub-workflow

This continuation closes a runtime gap where generic edge-transition persistence could still stamp intra-sub-workflow deliveries as if the root manager delivered them.

### Scope

**Included**:
- centralize mailbox delivery-manager selection in workflow runtime code
- apply the helper to normal edge transitions and manager-planned child deliveries
- add regression coverage for receipt ownership in both sub-workflow-local and root-manager deliveries

**Excluded**:
- mailbox directory layout changes
- communication id allocation changes
- API/UI changes
- external mailbox publication semantics

---

## Modules

### 1. Delivery Ownership Resolution

#### `src/workflow/engine.ts`

**Status**: COMPLETED

```ts
function findOwningSubWorkflowByNodeId(
  workflow: WorkflowJson,
  nodeId: string,
): SubWorkflowRef | undefined;

function mailboxDeliveryManagerNodeId(
  workflow: WorkflowJson,
  toNodeId: string,
): string;
```

**Checklist**:
- [x] Add one helper that maps recipient node id to the manager responsible for writing that mailbox receipt
- [x] Preserve root-manager ownership for root-scope and cross-boundary manager deliveries
- [x] Preserve sub-manager ownership for child-node deliveries inside a sub-workflow

### 2. Runtime Routing Call Sites

#### `src/workflow/engine.ts`

**Status**: COMPLETED

```ts
type DeliveredByNodeId = string;
```

**Checklist**:
- [x] Generic edge-transition persistence uses the delivery-owner helper
- [x] Root-manager planned deliveries use the same helper instead of ad hoc node ids
- [x] Sub-manager child-input forwarding uses the same helper

### 3. Regression Coverage

#### `src/workflow/engine.test.ts`

**Status**: COMPLETED

```ts
test("manager schedules sub-workflow inputs based on inputSources dependencies", async () => {});
```

**Checklist**:
- [x] Assert intra-sub-workflow child edge receipt is attributed to the sub-manager
- [x] Assert root-to-sub-manager handoff receipt remains attributed to the root manager

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Delivery ownership helper | `src/workflow/engine.ts` | COMPLETED | `src/workflow/engine.test.ts` |
| Routing call site alignment | `src/workflow/engine.ts` | COMPLETED | `src/workflow/engine.test.ts` |
| Receipt ownership regression | `src/workflow/engine.test.ts` | COMPLETED | targeted regression |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Delivery ownership fix | Existing mailbox routing runtime | Available |
| Regression test | Delivery ownership fix | COMPLETED |

## Completion Criteria

- [x] `receipt.json.deliveredByNodeId` matches recipient-scope mailbox ownership rules
- [x] Intra-sub-workflow child deliveries resolve to the sub-manager
- [x] Root-manager boundary deliveries remain owned by the root manager
- [x] Relevant workflow engine tests pass

## Suggested Verification Commands

```bash
bun test src/workflow/engine.test.ts
bun run typecheck:server
```

## Progress Log

### Session: 2026-03-08 22:05
**Tasks Completed**: Ownership audit, runtime helper implementation, regression test addition
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The design already matched the intended mailbox ownership model. The mismatch was in runtime receipt attribution for normal intra-sub-workflow edge deliveries, which could still record the root manager instead of the sub-manager.

### Session: 2026-03-08 22:20
**Tasks Completed**: Design wording alignment for `receipt.json.deliveredByNodeId`
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Clarified `design-node-mailbox.md` so receipt ownership now explicitly means the manager that owns the concrete recipient delivery attempt, not implicitly the root manager only. This matches the implemented runtime helper and regression tests.

### Session: 2026-03-08 23:20
**Tasks Completed**: Write-ownership wording alignment for manager-owned inbox artifacts
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Follow-up review found that the mailbox design's write-ownership bullets were narrower than the implemented runtime behavior. The runtime already materializes `inbox/{toNodeId}/message.json` for every recipient delivery owned by the responsible manager, including root-scope recipients and external mailbox boundary pseudo-nodes. Updated the design wording to match that existing behavior rather than changing the runtime.

### Session: 2026-03-08 23:55
**Tasks Completed**: Root-scope receipt ownership regression hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review of the in-progress diff found coverage for external, cross-boundary, and sub-workflow-local mailbox receipts, but not for the ordinary root-scope edge-delivery path. Added an explicit regression assertion in the linear workflow test so future delivery-owner refactors cannot silently regress root-managed recipient receipts.

### Session: 2026-03-08 15:53
**Tasks Completed**: Delivery-flow and write-ownership wording alignment follow-up
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation review found one remaining design mismatch after the runtime ownership fix: the mailbox spec still implied that the root manager always creates mailbox directories and writes `meta.json` for delivered communications. The runtime already lets the owning sub-workflow manager perform those writes for child deliveries, so the design was corrected to match the implemented architecture. No runtime change was required.
