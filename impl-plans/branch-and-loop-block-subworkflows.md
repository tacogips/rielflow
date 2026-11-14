# Branch And Loop Block SubWorkflows Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-workflow-json.md#sub-workflow-semantics
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-json.md`

### Summary

Align the workflow model with the intended architecture that branch-like blocks and loop bodies should be represented as ordinary sub-workflows, not as an unrelated second structural concept.

### Scope

**Included**:
- document the architectural rule that multi-node branch bodies and loop bodies should be authored as `subWorkflows`
- add canonical `subWorkflows[].block` metadata for `plain`, `branch-block`, and `loop-body`
- validate `loop-body` linkage against `workflow.loops[]`
- validate that `branch-block` and `loop-body` metadata are backed by real judge-to-manager routing edges
- make visualization prefer typed sub-workflow loop bodies over legacy inferred loop intervals

**Excluded**:
- automatic migration of existing workflow JSON files
- browser editor affordances for authoring block metadata
- execution-engine rewrites beyond existing sub-workflow entry semantics

---

## Modules

### 1. Model And Validation

#### `src/workflow/types.ts`
#### `src/workflow/validate.ts`

**Status**: COMPLETED

```ts
type SubWorkflowBlockType = "plain" | "branch-block" | "loop-body";

interface SubWorkflowBlock {
  readonly type: SubWorkflowBlockType;
  readonly loopId?: string;
}
```

**Checklist**:
- [x] Add explicit sub-workflow block typing
- [x] Parse and normalize block metadata
- [x] Validate `loop-body` to `loops[].id` linkage
- [x] Reject duplicate loop-body ownership of one loop id
- [x] Require `branch-block` and `loop-body` declarations to match real judge routing

### 2. Visualization Alignment

#### `src/workflow/visualization.ts`
#### `src/workflow/visualization.test.ts`

**Status**: COMPLETED

```ts
type DerivedColor =
  | "default"
  | `group:${string}`
  | `branch:${string}`
  | `loop:${string}`;
```

**Checklist**:
- [x] Color branch-body sub-workflows distinctly
- [x] Treat loop-body sub-workflows as canonical visual loop scopes
- [x] Preserve legacy loop visualization for workflows that do not yet declare block metadata

### 3. Migration Follow-Up

#### `design-docs/specs/design-workflow-web-editor.md`
#### `ui/src/App.svelte`
#### `src/server/api.ts`

**Status**: COMPLETED

```ts
interface FutureEditorWork {
  readonly exposeBlockMetadata: boolean;
  readonly suggestSubWorkflowBlocksForBranchAndLoopBodies: boolean;
}
```

**Checklist**:
- [x] Expose `subWorkflows[].block` in the Svelte browser/editor surface
- [x] Add Svelte authoring UX for branch-block and loop-body declaration
- [x] Align Svelte local visualization with backend block-aware scope derivation
- [x] Port the same block-aware authoring behavior to the legacy inline fallback, or remove that fallback
- [ ] Decide whether existing sample workflows should be rewritten to the new canonical pattern

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Block metadata model | `src/workflow/types.ts` | COMPLETED | `src/workflow/validate.test.ts` |
| Block validation | `src/workflow/validate.ts` | COMPLETED | `src/workflow/validate.test.ts` |
| Visualization alignment | `src/workflow/visualization.ts` | COMPLETED | `src/workflow/visualization.test.ts` |
| Design wording | `design-docs/specs/design-workflow-json.md` | COMPLETED | - |
| Editor migration | `ui/src/App.svelte`, `src/server/api.ts` | COMPLETED | `bun run typecheck:ui`, `src/server/api.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Block metadata validation | Existing sub-workflow validation | Available |
| Visualization alignment | Block metadata validation | COMPLETED |
| Editor migration | Block metadata model | READY |

## Completion Criteria

- [x] Design explicitly states that branch/loop bodies are modeled as sub-workflow scopes
- [x] Workflow validation accepts block metadata and rejects invalid loop-body linkage
- [x] Visualization recognizes branch-block and loop-body sub-workflows
- [x] Every shipped browser editor path supports the canonical block metadata directly

## Suggested Verification Commands

```bash
bun test src/workflow/validate.test.ts src/workflow/visualization.test.ts
bun test src/server/api.test.ts
bun run typecheck
bun run build:ui
```

## Progress Log

### Session: 2026-03-09 11:35
**Tasks Completed**: TASK-001 equivalent model/design alignment, TASK-002 equivalent validation/visualization support with judge-routing enforcement
**Tasks In Progress**: Migration follow-up for browser/editor authoring
**Blockers**: None
**Notes**: Reviewed the repository state and continued the in-progress diff rather than starting a fresh design. The runtime already allowed branch and loop bodies to be entered as sub-workflows through manager-boundary routing, but the design and tooling did not state or represent that pattern explicitly enough. This iteration adds canonical metadata, validation, and visualization support, and now also rejects decorative block metadata that is not backed by real branch/loop judge routing.

### Session: 2026-03-09 12:20
**Tasks Completed**: Svelte editor block metadata authoring and local visualization alignment
**Tasks In Progress**: Legacy inline fallback parity review
**Blockers**: None
**Notes**: Added `subWorkflows[].block` typing and controls to the Svelte editor so authors can mark ordinary groups, branch blocks, and loop bodies directly. The editor now mirrors backend visualization semantics by coloring branch blocks distinctly and by preferring declared loop-body sub-workflows over inferred loop intervals.

### Session: 2026-03-09 13:05
**Tasks Completed**: Legacy inline fallback parity, canonical template default metadata, plan completion review
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The repository still ships the inline server-rendered editor whenever `ui/dist/` is absent, so leaving that path without `subWorkflows[].block` support would have kept the architecture inconsistent. Added matching block-type controls and block-aware visualization there, set newly created template sub-workflows to explicit `plain`, and closed the remaining editor-parity gap.

### Session: 2026-03-09 14:05
**Tasks Completed**: Continuation review, targeted regression checks, plan verification command correction
**Tasks In Progress**: None
**Blockers**: Browser verification via `agent-browser` could not be completed in the current sandbox because the local serve step could not bind a verification port
**Notes**: Reviewed the existing diff as a continuation rather than starting over. Confirmed the validator, visualization layer, API fallback UI, and Svelte editor changes are coherent through targeted tests plus full server/UI typecheck. Corrected the plan's UI verification command to the actual repo scripts. Attempted the mandatory browser-verify step for the UI change, but local serving failed in this environment with bind/listen errors, so only automated verification could be completed in this iteration.

### Session: 2026-03-09 15:10
**Tasks Completed**: Runtime continuation review, eager-start execution fix for typed structural sub-workflows
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The partial implementation correctly modeled and validated `branch-block` and `loop-body`, but root-manager generic sub-workflow planning still auto-started any ready sub-workflow regardless of block type. Tightened runtime planning so only untyped/`plain` sub-workflows are eligible for eager start; branch and loop structural blocks now require their control-plane entry path or explicit manager-control start. Added regression tests for both cases and updated the design text to state that execution rule explicitly.

### Session: 2026-03-09 15:45
**Tasks Completed**: Detailed design example alignment review
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The architecture and implementation were already aligned in code, but the long-form JSON design examples still showed loop judges re-entering worker nodes directly. Updated the design examples to state the canonical normalized form explicitly: repeated bodies should be typed `loop-body` sub-workflows whose manager boundary is the continue-edge target.

### Session: 2026-03-09 16:10
**Tasks Completed**: Continuation diff review follow-up, structural scope visualization precedence fix
**Tasks In Progress**: None
**Blockers**: `bun run build:ui` produced `ui/dist/` but did not terminate cleanly in the current sandbox, so production-build verification remains partially environment-limited
**Notes**: Found a real regression risk in the in-progress diff: once loop bodies and branch bodies are rendered as typed sub-workflow scopes, nested plain groups could incorrectly steal their color because visualization chose the innermost group interval. Updated backend derivation plus both browser editor paths to keep `loop-body` precedence first, `branch-block` second, and plain groups last, then added regression coverage for nested-loop and nested-branch cases.

### Session: 2026-03-09 16:30
**Tasks Completed**: Continuation review follow-up, Svelte sub-workflow manager-boundary authoring fix
**Tasks In Progress**: None
**Blockers**: `bun run build:ui` still does not return promptly in this sandbox after emitting its build banner, so production-build verification remains environment-limited
**Notes**: Found a remaining architecture mismatch in the Svelte editor path: `Add Sub-Workflow` could fall back to a non-`sub-manager` node for `managerNodeId`, creating an invalid structural scope even though the design and validator require a dedicated sub-manager boundary. Tightened authoring to require a real `sub-manager` candidate, matching the inline fallback editor and the documented sub-workflow boundary rule.

## Related Plans

- **Previous**: `impl-plans/mailbox-cross-boundary-edge-validation.md`
- **Next**: editor/API follow-up can be split out if needed
- **Depends On**: existing workflow core and validation infrastructure
