# Simplified Workflow JSON Transition For Examples Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-simplified-workflow-json.md`
**Created**: 2026-03-30
**Last Updated**: 2026-03-30

## Scope

Implement a backward-compatible transition slice of the simplified
`workflow.json` design so example bundles can be authored primarily as ordered
node sequences instead of explicit edge and sub-workflow graphs.

Included:

- optional `edges` with validator-generated sequential defaults
- optional `subWorkflows` with empty default
- node-local repeat metadata for loop-style examples
- example workflow migration to the simplified authored shape where executable
  in the current runtime phase
- verification of the migrated examples with bundled mock scenarios

Excluded:

- manager-less runtime execution
- executable `workflowCalls`
- full replacement of `subWorkflowConversations`

## Modules

### 1. Transition schema normalization

#### `src/workflow/types.ts`

#### `src/workflow/validate.ts`

#### `src/workflow/load.test.ts`

#### `src/workflow/validate.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Add authored node metadata needed for simplified sequencing and repeat
- [x] Accept omitted `edges` and synthesize deterministic sequential flow
- [x] Accept omitted `subWorkflows` without changing legacy behavior
- [x] Cover the transition rules with focused validator/load tests

### 2. Runtime support for repeat-based transitions

#### `src/workflow/engine.ts`

#### `src/workflow/engine.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Ensure normalized repeat semantics execute correctly through the existing engine
- [x] Preserve legacy loop behavior
- [x] Add regression coverage for repeat exit and repeat restart targets

### 3. Example workflow migration

#### `examples/*/workflow.json`

#### `examples/*/EXPECTED_RESULTS.md`

#### `examples/README.md`

#### `README.md`

**Status**: COMPLETED

**Checklist**:

- [x] Rewrite linear/sequential examples to omit legacy `edges` and `subWorkflows`
- [x] Use node-local repeat for repeat-style examples where practical
- [x] Leave explicitly unsupported legacy examples documented if a current runtime feature still requires them
- [x] Update expected-result docs and example docs to reflect the new authored shape

## Completion Criteria

- [x] Simplified example workflows validate through the current loader
- [x] Migrated examples execute successfully with bundled mock scenarios
- [x] Legacy graph workflows remain backward compatible
- [x] Type checks and focused tests pass after TypeScript changes

## Progress Log

### Session: 2026-03-30 11:12 JST

**Tasks Completed**: Created implementation plan and scoped a transition slice
for the simplified authored format
**Tasks In Progress**: Validator/loader compatibility design and runtime impact
review
**Blockers**: `subWorkflowConversations` still depends on legacy
`subWorkflows`, so the debate example may need to remain on the legacy shape in
this transition phase
**Notes**: The intended slice keeps one executable manager node, treats node
array order as canonical when `edges` are omitted, and introduces node-local
repeat for loop-like examples instead of requiring authored back-edges.

### Session: 2026-03-30 11:27 JST

**Tasks Completed**: Added simplified sequencing and repeat normalization,
migrated six example bundles to edge-less ordered-node authoring, updated docs
and deterministic expectations, and verified legacy compatibility with the
untouched debate example
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The runtime still uses normalized edges internally, but authored
`workflow.edges` is now optional for linear and repeat-based workflows. The
debate example remains legacy because `subWorkflowConversations` still depends
on `subWorkflows`.
