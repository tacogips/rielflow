# Workflow Definition Alignment Follow-Up Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/command.md#subcommands`, `design-docs/specs/architecture.md#workflow-definition-boundary`
**Created**: 2026-03-30
**Last Updated**: 2026-03-30

---

## Design Document Reference

**Source**: `design-docs/specs/command.md`, `design-docs/specs/architecture.md`

### Summary
Close the follow-up gaps left after the inline-node and nested-`nodes/`
transition by making normalized bundle payload lookup consistent, ensuring
inline-authored nodes remain authoritative during save/validation, and aligning
current-design documentation with the implementation.

### Scope
**Included**: normalized bundle payload helpers, TUI/API/save-path fixes,
regression coverage, and current-architecture documentation updates.
**Excluded**: new authored schema work, runtime workflow-call support, and
further example-bundle redesign.

---

## Modules

### 1. Normalized bundle payload lookup

#### `src/workflow/types.ts`

#### `src/tui/opentui-model/input.ts`

#### `src/tui/opentui-model/workflow-rendering.ts`

#### `src/tui/opentui-detail-content.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Add a shared helper for normalized bundle payload lookup by node id
- [x] Remove node-file-key assumptions from TUI runtime/detail code
- [x] Update TUI fixture coverage to use the normalized id-keyed payload map

### 2. Inline authoring precedence and validation remapping

#### `src/workflow/save.ts`

#### `src/workflow/validate.ts`

#### `src/server/api-workflow-bundle.ts`

#### `src/workflow/save.test.ts`

#### `src/server/api-workflow-bundle.test.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Keep inline-authored payloads authoritative over stale id-keyed maps
- [x] Preserve explicit `nodeFile` alias remapping for API validation requests
- [x] Add regression coverage for stale-payload override cases

### 3. Current-design documentation alignment

#### `design-docs/specs/command.md`

#### `design-docs/specs/architecture.md`

**Status**: COMPLETED

**Checklist**:
- [x] Document default `nodes/node-{id}.json` workflow creation/output paths
- [x] Document inline node authoring and workflow-relative nested payload paths
- [x] Keep the current architecture docs consistent with the implemented loader

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Payload lookup helper | `src/workflow/types.ts` | COMPLETED | Passing |
| TUI bundle consumers | `src/tui/opentui-model/*.ts`, `src/tui/opentui-detail-content.ts` | COMPLETED | Passing |
| Save/validate/API remap | `src/workflow/save.ts`, `src/workflow/validate.ts`, `src/server/api-workflow-bundle.ts` | COMPLETED | Passing |
| Documentation alignment | `design-docs/specs/command.md`, `design-docs/specs/architecture.md` | COMPLETED | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Alignment follow-up | `impl-plans/inline-node-and-nested-example-layout.md` | Available |

## Completion Criteria

- [x] Normalized bundles are consumed consistently by node id
- [x] Inline-authored nodes win over stale external payload maps
- [x] Regression tests cover the fixed cases
- [x] Current architecture/command docs match the shipped workflow definition behavior

## Progress Log

### Session: 2026-03-30 12:40 JST
**Tasks Completed**: Reviewed the same-day workflow authoring changes, fixed normalized bundle payload lookup drift in TUI consumers, corrected inline-authoring precedence in save/validation/API remapping, added regression tests, and updated current-design docs.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The runtime architecture itself remains aligned with the intended workflow-definition transition; the follow-up work was primarily contract cleanup plus documentation alignment after the `nodes/` and inline-node rollout.

### Session: 2026-03-30 14:15 JST
**Tasks Completed**: Post-review continuation fixed direct-validator inline-authoring precedence so synthesized `nodeFile` payload entries cannot override inline-authored nodes, restored `call-node`'s specific unsupported-node error ordering ahead of runtime-readiness checks, and aligned `examples/README.md` command examples with the current `cli workflow` namespace.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: No architectural redesign was required in this continuation. The current workflow-definition/runtime design still matches the intended `nodes/` plus inline-authoring transition; this pass closed a missed consistency bug and a same-day regression surfaced only by the full test suite.

### Session: 2026-03-30 15:10 JST
**Tasks Completed**: Continued the same-day review by fixing stale payload retention in the shared inline-authoring remap helper and expanding regression coverage in API, validation, and save-path tests.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The architecture remains aligned with the intended workflow-definition transition. This iteration addressed a lower-level correctness gap where inline-authored nodes could still inherit removed fields from stale external payload maps because the remap helper merged objects instead of treating inline payloads as fully authoritative.

### Session: 2026-03-30 17:55 JST
**Tasks Completed**: Continued the same-day review by hardening workflow-relative node payload path handling in the loader and revision calculator, and added regression tests to ensure unsafe `nodeFile` paths fail validation before any external file read.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: No design change was required. The workflow-definition architecture still matches the intended inline-authoring and nested-`nodes/` transition; this pass closed an overlooked path-boundary bug that became more important once authored node payloads were allowed to live in workflow-relative nested directories.

## Related Plans

- **Previous**: `impl-plans/inline-node-and-nested-example-layout.md`
- **Next**: (add future workflow-definition simplification follow-ups only if new authored/runtime gaps are found)
- **Depends On**: `impl-plans/inline-node-and-nested-example-layout.md`
