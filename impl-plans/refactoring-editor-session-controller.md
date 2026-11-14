# Editor Session Controller Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-session-controller.md, design-docs/specs/design-workflow-web-editor.md#migration-strategy
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

## Summary

Extract the duplicated top-level workflow-session orchestration that existed in `ui/src/App.svelte` and `ui/src/App.tsx` into a shared frontend helper so the migration could keep one selected-session polling and session-command behavior. The helper remains part of the checked-in Solid runtime after cutover.

## Scope

Included:

- design update for the shared session-controller boundary
- framework-neutral session-controller helper under `ui/src/lib/`
- Svelte and Solid app-shell adoption of the new helper
- focused unit tests for polling retry semantics and session update shaping
- repository typecheck and targeted test verification

Not included:

- final SolidJS entrypoint cutover mechanics beyond this shared helper
- moving polling timers out of the app components
- broader workflow-editing state extraction
- backend API or execution-contract changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-session-controller.md`, `design-docs/specs/design-workflow-web-editor.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the duplicated top-level session orchestration as migration drift
- [x] Define a framework-neutral session-controller boundary for both app shells

### 2. Shared Session Controller Extraction

#### `ui/src/lib/editor-session-controller.ts`, `ui/src/App.tsx`

**Status**: COMPLETED

```ts
export interface EditorSessionUpdate {
  readonly sessionPanelState: SessionPanelState;
  readonly selectedSessionPollStatus: SessionStatus | null;
  readonly infoMessage?: string;
}

export type PollSelectedSessionResult =
  | { readonly kind: "updated"; readonly update: EditorSessionUpdate }
  | { readonly kind: "stale-selection" }
  | { readonly kind: "retry"; readonly errorMessage: string };
```

**Checklist**:
- [x] Centralize session refresh/select/execute/cancel orchestration behind one helper
- [x] Keep timer ownership in the framework components
- [x] Make transient polling failures retry consistently across Svelte and Solid
- [x] Remove repeated Solid app-shell session-panel patching logic where practical

### 3. Verification

#### `ui/src/lib/editor-session-controller.test.ts`, `ui/src/App.tsx`

**Status**: COMPLETED

**Checklist**:
- [x] Add focused unit tests for the shared session-controller helper
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run `bun test ui/src/lib/editor-session-controller.test.ts ui/src/lib/editor-actions.test.ts ui/src/lib/editor-app-controller.test.ts`
- [x] Run `bun run test:ui`

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Shared session controller extraction | `refactoring-editor-action-helpers`, `refactoring-frontend-solidjs-migration:TASK-007` | COMPLETED |
| Verification | shared session controller extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for the shared session-controller slice
- [x] Session refresh/select/execute/cancel flows are shared across the two app shells
- [x] Selected-session polling retry behavior is no longer allowed to drift between Svelte and Solid
- [x] Focused session-controller tests pass
- [x] Repository typechecks pass
- [x] UI test suite passes

## Progress Log

### Session: 2026-03-09 21:20
**Tasks Completed**: Design assessment, implementation plan creation, shared session controller extraction, verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation review found that the overall architecture still matches the intended replaceable-frontend design, but the migration had one concrete behavioral drift: the staged Solid path stopped polling permanently after a transient selected-session refresh failure while the checked-in Svelte runtime retried. Added a shared `editor-session-controller.ts` seam, rewired both app shells to use it for session refresh/select/execute/cancel and polling paths, and added focused regression tests so the retry policy is now shared instead of duplicated.
