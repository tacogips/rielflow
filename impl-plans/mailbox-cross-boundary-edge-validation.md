# Mailbox Cross-Boundary Edge Validation Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-node-mailbox.md#Manager-scoping-rules
**Created**: 2026-03-08
**Last Updated**: 2026-03-08

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-mailbox.md`

### Summary

Enforce the mailbox design's manager-boundary routing rule at workflow validation time.

The design already says cross-boundary transport must terminate at the recipient sub-workflow manager and child-to-root returns must terminate at the root manager. The current runtime helpers classify mailbox ownership correctly, but semantic validation still allows direct edges that bypass those boundaries.

### Scope

**Included**:
- reject root-scope to child-node direct edges
- reject child-node to root worker direct edges
- reject sub-workflow to different-sub-workflow child-node direct edges
- add validation regression coverage
- clarify design wording so the validation requirement is explicit

**Excluded**:
- mailbox directory layout changes
- communication id allocation changes
- execution-time rerouting or auto-rewrite of invalid edges
- API/UI behavior changes beyond existing validation surfacing

---

## Modules

### 1. Semantic Boundary Validation

#### `src/workflow/validate.ts`

**Status**: COMPLETED

```ts
type CrossBoundaryEdgeIssue =
  | "root-to-child"
  | "child-to-root-worker"
  | "subworkflow-to-foreign-child";
```

**Checklist**:
- [x] Semantic validation detects scope-crossing edges after sub-workflow ownership is known
- [x] Root-to-sub-workflow delivery is allowed only when the recipient is that sub-workflow's manager node
- [x] Child-to-root delivery is allowed only when the recipient is the root manager node
- [x] Sub-workflow-to-different-sub-workflow delivery is allowed only when the recipient is the destination sub-workflow manager node

### 2. Regression Coverage

#### `src/workflow/validate.test.ts`

**Status**: COMPLETED

```ts
test("rejects root-to-child edges that bypass the sub-workflow manager boundary", () => {});
test("rejects child-to-root-worker edges that bypass the root manager boundary", () => {});
test("rejects cross-sub-workflow edges that bypass the recipient manager boundary", () => {});
```

**Checklist**:
- [x] Each invalid cross-boundary edge shape has a direct regression
- [x] Tests assert validation messages with the offending edge path

### 3. Design Consistency

#### `design-docs/specs/design-node-mailbox.md`
#### `design-docs/specs/architecture.md`

**Status**: COMPLETED

```ts
type NoRuntimeBehaviorExpansion = true;
```

**Checklist**:
- [x] Design states that invalid cross-boundary direct edges must be rejected during validation
- [x] Design remains aligned with the existing manager-owned mailbox architecture

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Boundary edge validation | `src/workflow/validate.ts` | COMPLETED | `src/workflow/validate.test.ts` |
| Regression coverage | `src/workflow/validate.test.ts` | COMPLETED | targeted validation tests |
| Design wording | `design-docs/specs/*.md` | COMPLETED | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Boundary edge validation | Existing sub-workflow ownership validation | Available |
| Regression tests | Boundary edge validation | COMPLETED |

## Completion Criteria

- [x] Invalid cross-boundary direct edges are rejected during workflow validation
- [x] Valid manager-boundary routing remains accepted
- [x] Regression tests cover each invalid edge family
- [x] Type checking passes

## Suggested Verification Commands

```bash
bun test src/workflow/validate.test.ts
bun run typecheck
```

## Progress Log

### Session: 2026-03-08 16:45
**Tasks Completed**: Continuation diff review, design wording clarification, validation implementation, regression tests
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The design already required manager-boundary termination for cross-scope mailbox transport, but semantic validation did not enforce it. The fix keeps runtime routing unchanged and closes the gap by rejecting invalid workflow graphs up front.
