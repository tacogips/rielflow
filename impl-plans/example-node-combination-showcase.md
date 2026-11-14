# Example Node Combination Showcase Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-json.md`, `design-docs/specs/design-container-runtime-contract.md`, `design-docs/specs/architecture.md`
**Created**: 2026-03-17
**Last Updated**: 2026-03-17

## Scope

Add a compact reference example bundle under `examples/` that demonstrates the
current authored workflow structures for:

- sibling plain sub-workflows used as fan-out/concurrent-style lanes
- a loop-body sub-workflow used for repeated iteration
- `command` node payload authoring
- `container` node payload authoring

Also update example-facing documentation so users understand which example
bundles are runnable versus validation-only and that the current authored schema
does not expose a first-class `foreach` field.

Out of scope:

- runtime execution support for `command` nodes
- runtime execution support for `container` nodes
- introduction of unsupported `foreach` or legacy `nodeGroups` schema fields

## Modules

### 1. Showcase Bundle

#### `examples/node-combinations-showcase/workflow.json`

#### `examples/node-combinations-showcase/workflow-vis.json`

#### `examples/node-combinations-showcase/node-*.json`

#### `examples/node-combinations-showcase/prompts/*.md`

**Status**: COMPLETED

**Checklist**:

- [x] Add a small workflow bundle with contiguous sub-workflow groups
- [x] Show sibling plain sub-workflows for fan-out/concurrent-style structure
- [x] Show one loop-body sub-workflow for repeated iteration
- [x] Include one `command` node payload and one `container` node payload
- [x] Keep the bundle validation-friendly and inspectable without unnecessary graph complexity

### 2. Supporting Example Assets

#### `examples/node-combinations-showcase/scripts/mock-command.sh`

#### `examples/node-combinations-showcase/containers/mock-worker/Containerfile`

**Status**: COMPLETED

**Checklist**:

- [x] Add a workflow-relative command script path target
- [x] Add a workflow-relative container build context target

### 3. Documentation

#### `examples/README.md`

#### `README.md`

**Status**: COMPLETED

**Checklist**:

- [x] Document the new showcase bundle and its purpose
- [x] Clarify that `command` and `container` examples are validation-only today
- [x] Clarify that the current authored schema does not include a first-class `foreach` field

## Completion Criteria

- [x] The new example validates with the repository CLI
- [x] Example docs describe the bundle accurately
- [x] The example remains intentionally compact and readable

## Progress Log

### Session: 2026-03-17 16:55 JST

**Tasks Completed**: Showcase bundle, support assets, documentation, and validation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The repository does not currently define authored `foreach` or legacy `concurrent nodeGroups` fields. The showcase therefore demonstrates the current equivalents instead: sibling plain sub-workflows for fan-out/concurrent-style structure and a `loop-body` sub-workflow for repeated iteration, alongside explicit `command` and `container` node payloads.
