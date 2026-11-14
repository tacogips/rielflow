# Mailbox Cross-Boundary Routing Scope Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-node-mailbox.md#Message Files
**Created**: 2026-03-08
**Last Updated**: 2026-03-08

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-mailbox.md`

### Summary

Align generic edge-delivery mailbox metadata with the mailbox design's cross-boundary semantics.

The follow-up review found that `deliveredByNodeId` ownership had been corrected, but plain edge transitions still defaulted to `routingScope = "intra-sub-workflow"` and omitted sub-workflow boundary ids even when the delivery actually crossed a workflow boundary.

### Scope

**Included**:
- infer mailbox `routingScope` from sender/recipient workflow scope for generic edge deliveries
- populate `fromSubWorkflowId` / `toSubWorkflowId` for cross-boundary and sub-workflow-local deliveries
- add regression tests for root-to-sub-manager normal edges and child-to-root-manager return edges
- clarify design wording so normal edges to sub-workflow managers are treated as cross-boundary handoffs

**Excluded**:
- mailbox directory layout changes
- communication id allocation changes
- conversation-turn semantics
- external mailbox publication semantics

---

## Modules

### 1. Boundary Classification Helper

#### `src/workflow/engine.ts`

**Status**: COMPLETED

```ts
function resolveCommunicationBoundary(input: {
  readonly workflow: WorkflowJson;
  readonly fromNodeId: string;
  readonly toNodeId: string;
}): {
  readonly routingScope: CommunicationRecord["routingScope"];
  readonly fromSubWorkflowId?: string;
  readonly toSubWorkflowId?: string;
};
```

**Checklist**:
- [x] Generic edge deliveries classify root-to-sub-manager handoffs as `parent-to-sub-workflow`
- [x] Generic edge deliveries classify child-to-root returns as `cross-sub-workflow`
- [x] Boundary metadata includes sub-workflow ids when available

### 2. Regression Coverage

#### `src/workflow/engine.test.ts`

**Status**: COMPLETED

```ts
test("does not duplicate a sub-workflow manager handoff when a normal edge already targets that manager", async () => {});
test("manager schedules sub-workflow inputs based on inputSources dependencies", async () => {});
```

**Checklist**:
- [x] Root-to-sub-manager normal edge regression expects `parent-to-sub-workflow`
- [x] Child-to-root return regression expects `cross-sub-workflow`
- [x] Boundary metadata ids are asserted in at least one regression path

### 3. Design Consistency

#### `design-docs/specs/design-node-mailbox.md`

**Status**: COMPLETED

```ts
type NoCodeBehaviorExpansion = true;
```

**Checklist**:
- [x] Design explicitly distinguishes cross-boundary manager handoffs from intra-sub-workflow child delivery
- [x] Design states when `fromSubWorkflowId` / `toSubWorkflowId` should be present

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Boundary classification helper | `src/workflow/engine.ts` | COMPLETED | `src/workflow/engine.test.ts` |
| Boundary routing regression | `src/workflow/engine.test.ts` | COMPLETED | targeted regression |
| Design clarification | `design-docs/specs/design-node-mailbox.md` | COMPLETED | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Boundary classification fix | mailbox-delivery-manager-ownership | COMPLETED |
| Regression tests | Boundary classification fix | COMPLETED |

## Completion Criteria

- [x] Generic edge transitions no longer stamp cross-boundary deliveries as `intra-sub-workflow`
- [x] Root-to-sub-manager handoffs keep root-manager ownership and boundary metadata
- [x] Sub-workflow-to-root returns record cross-boundary routing metadata
- [x] Relevant workflow engine tests pass

## Suggested Verification Commands

```bash
bun test src/workflow/engine.test.ts
bun run typecheck
```

## Progress Log

### Session: 2026-03-08 16:20
**Tasks Completed**: Follow-up diff review, boundary-classification fix, regression and design updates
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The design already implied that cross-boundary deliveries should not be labeled as intra-sub-workflow, but the generic edge path still did so. The fix centralizes boundary classification and adds coverage for both root-to-sub-manager and child-to-root mailbox paths.
