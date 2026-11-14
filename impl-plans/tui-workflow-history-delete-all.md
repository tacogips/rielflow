# TUI Workflow History Delete-All Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-tui.md#workflow-history-screen
**Created**: 2026-03-30
**Last Updated**: 2026-03-30

---

## Design Document Reference

**Source**: design-docs/specs/design-tui.md

### Summary
Add a destructive but confirmed `workflow history delete-all` action to the workflow-history screen so operators can clear all stored history for the currently loaded workflow.

### Scope
**Included**: persistent workflow-history deletion, runtime-data cleanup, TUI confirmation popup/keybinding, focused tests, design-doc/help updates
**Excluded**: workflow-definition deletion, per-session selective deletion, non-TUI command surfaces

---

## Modules

### 1. Workflow History Deletion

#### src/workflow/history.ts

**Status**: COMPLETED

```typescript
interface DeleteWorkflowHistoryResult {
  readonly deletedSessionCount: number;
  readonly workflowId: string;
  readonly workflowName: string;
}

interface DeleteWorkflowHistoryInput extends LoadOptions, SessionStoreOptions {
  readonly workflowId: string;
  readonly workflowName: string;
}

declare function deleteWorkflowHistory(
  input: DeleteWorkflowHistoryInput,
): Promise<DeleteWorkflowHistoryResult>;
```

**Checklist**:
- [x] Delete session-store files for the target workflow
- [x] Delete runtime-db rows for the target workflow
- [x] Delete workflow artifact history for the target workflow
- [x] Reject deletion when non-terminal sessions still exist
- [x] Unit tests

### 2. TUI Confirmed Action

#### src/tui/opentui-screen/runtime.ts

**Status**: COMPLETED

```typescript
interface OpenTuiWorkflowAppOptions {
  readonly deleteWorkflowHistory: (input: {
    readonly workflowId: string;
    readonly workflowName: string;
  }) => Promise<DeleteWorkflowHistoryResult>;
}
```

**Checklist**:
- [x] Add a delete-history confirmation popup/action path
- [x] Keep popup handling aligned with existing TUI navigation rules
- [x] Refresh the history screen after deletion
- [x] Update focused tests

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| History deletion service | `src/workflow/history.ts` | COMPLETED | Passed |
| TUI delete-all action | `src/tui/opentui-screen/runtime.ts` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| History deletion service | Existing session/runtime storage modules | Available |
| TUI delete-all action | History deletion service | Completed |

## Completion Criteria

- [x] Workflow history can be deleted for the selected workflow from the history screen
- [x] Running or paused workflow sessions are not deleted
- [x] Runtime DB, session files, and workflow artifact history are removed together
- [x] Focused tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-03-30 19:00
**Tasks Completed**: Plan created
**Tasks In Progress**: Storage deletion implementation, TUI confirmation flow
**Blockers**: None
**Notes**: The current TUI exposes no delete-history action, and history persistence is split across session files, the runtime DB, and workflow artifact directories.

### Session: 2026-03-30 19:08
**Tasks Completed**: History deletion service, TUI delete-all action, focused verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added workflow-level delete-all cleanup with active-session protection, kept the existing per-run delete path intact, and documented the new `D` shortcut plus confirmation flow.

### Session: 2026-03-30 19:40
**Tasks Completed**: Follow-up cleanup hardening for workflow-history deletion
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Removed duplicated workflow-delete cleanup logic by routing delete-all through the per-session deletion service, added attachment/orphan manager-session cleanup, and aligned single-run deletion with the plan requirement that paused sessions are not deletable.

### Session: 2026-03-30 20:05
**Tasks Completed**: Workflow identity contract hardening and missing runtime-only active-session coverage
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Tightened workflow delete-all so the provided workflow id must match the loaded workflow definition instead of being ignored, and added tests covering workflow-id mismatch plus paused runtime rows that outlive their session file.

## Related Plans

- **Previous**: `impl-plans/tui-workflow-browser-and-json-input.md`
- **Next**: None
- **Depends On**: None
