# Inline Node Payloads And Nested Example Layout Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-simplified-workflow-json.md`, `impl-plans/simplified-workflow-json-transition-examples.md`
**Created**: 2026-03-30
**Last Updated**: 2026-03-30

## Scope

Implement two authoring improvements in the current runtime-compatible path:

- allow node payloads to be authored inline in `workflow.json.nodes[]` when
  `nodeFile` is omitted
- allow node payload files to live under `nodes/` instead of only at the
  workflow root

This plan also explores reusable child workflow authoring under `workflows/`.
At plan-creation time, executable workflow-call support was still blocked in
the runtime, so the first implementation pass focused on the inline-node and
nested-`nodes/` parts first. Subsequent role-unification work has since added
workflow-call execution, but this completed plan still covers only the
inline-node and nested-layout slice plus the `workflows/` authoring-layout
spike that was shipped in that earlier runtime phase.

## Modules

### 1. Inline node payload authoring

#### `src/workflow/load.ts`

#### `src/workflow/validate.ts`

#### `src/workflow/save.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Accept omitted `nodeFile` when an inline node payload is present
- [x] Synthesize a stable normalized node-file key for validation/runtime use
- [x] Keep prompt-template-file hydration working for inline payloads
- [x] Preserve save-path compatibility for existing workflows

### 2. Nested `nodes/` layout support

#### `src/workflow/load.ts`

#### `src/workflow/validate.ts`

#### `src/workflow/revision.ts`

#### `src/workflow/load.test.ts`

#### `src/workflow/validate.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Allow workflow-relative node payload paths such as `nodes/node-foo.json`
- [x] Require the basename to remain `node-{id}.json`
- [x] Verify revision computation and loading with nested node file paths

### 3. Example migration and reusable child-workflow spike

#### `examples/*`

**Status**: COMPLETED

**Checklist**:

- [x] Move example node files under `nodes/`
- [x] Add at least one inline-node example
- [x] Decide and document the reusable `workflows/` implementation shape
- [x] Add one reuse-oriented example if the chosen shape is executable in the current runtime phase

## Completion Criteria

- [x] Inline node payloads validate and execute from disk
- [x] Node payloads under `nodes/` validate and execute from disk
- [x] Existing workflows remain backward compatible
- [x] Example docs reflect the new layout rules

## Progress Log

### Session: 2026-03-30 11:40 JST

**Tasks Completed**: Created implementation plan after committing the
edge-less workflow authoring transition
**Tasks In Progress**: Inline node payload loader/validator/save design
**Blockers**: Reusable child workflows under `workflows/` are ambiguous between
compile-time include semantics and true runtime workflow-call semantics
**Notes**: The immediate implementation focus is the unambiguous part of the
request: inline node payloads and nested `nodes/` layout support.

### Session: 2026-03-30 11:55 JST

**Tasks Completed**: Inline node payload support, nested `nodes/` path support,
example bundle migration, and sequential verification of all bundled examples
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The shipped `workflows/` support is an authoring-layout convention
inside one workflow bundle, not executable runtime workflow-call semantics.
`first-four-arithmetic-pipeline` now demonstrates nested stage payloads under
`workflows/*/nodes/` reusing a parent-level prompt file, and
`same-node-session-echo` now demonstrates inline node authoring in a runnable
example.
