# Node Add-on Authored Payload Guard Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#authoring-model`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

## Design Summary

The add-on design makes `workflow.json.nodes[].addon` the authored surface for
built-in add-ons. The resolved `NodePayload` may use `nodeType: "addon"`, but a
workflow-local `nodes/node-*.json` file must not author that runtime-only shape.

This review found that adding `"addon"` to the runtime `NodeType` union also
made authored node payload validation accept `nodeType: "addon"` without a
resolved add-on descriptor. This plan closes that gap.

Scope:

- Reject workflow-local node payload files that author `nodeType: "addon"`.
- Add a regression test for the invalid authored payload shape.
- Update the add-on design document to call out the runtime-only payload type.

Out of scope:

- Changing resolved add-on payloads generated from `workflow.json.nodes[].addon`.
- Supporting workflow-local custom native add-on payloads.
- Changing save/edit preservation behavior for authored add-on references.

## Modules

### 1. Authored Payload Validation

#### `src/workflow/validate.ts`

**Status**: Completed

```typescript
function normalizeNodePayload(
  nodeId: string,
  nodeFile: string,
  payload: unknown,
  issues: ValidationIssue[],
): NodePayload | null;
```

**Checklist**:

- [x] Detect `nodeType: "addon"` in workflow-local node payload files.
- [x] Emit a validation error that points authors to `workflow.nodes[].addon`.
- [x] Avoid returning an invalid authored add-on payload for runtime use.

### 2. Regression Coverage

#### `src/workflow/validate.test.ts`

**Status**: Completed

```typescript
function validateWorkflowBundle(
  raw: RawBundle,
): Result<NormalizedWorkflowBundle>;
```

**Checklist**:

- [x] Add coverage for `nodes/node-*.json` with `nodeType: "addon"`.
- [x] Verify valid add-on references in `workflow.json.nodes[]` still pass.

### 3. Design Clarification

#### `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

**Status**: Completed

**Checklist**:

- [x] Document that `nodeType: "addon"` is a resolved runtime payload type.
- [x] Document that workflow-local node payload files must not author it.

## Module Status

| Module              | File Path                                                              | Status    | Tests              |
| ------------------- | ---------------------------------------------------------------------- | --------- | ------------------ |
| Payload validation  | `src/workflow/validate.ts`                                             | Completed | `validate.test.ts` |
| Regression coverage | `src/workflow/validate.test.ts`                                        | Completed | Vitest             |
| Design notes        | `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md` | Completed | Review             |

## Dependencies

| Feature             | Depends On                   | Status    |
| ------------------- | ---------------------------- | --------- |
| Authored guard      | Existing add-on type support | Available |
| Regression coverage | Validation implementation    | Available |

## Completion Criteria

- [x] Authored node payload files with `nodeType: "addon"` fail validation.
- [x] Resolved built-in add-on references continue to validate.
- [x] Focused tests pass.
- [x] Type checking passes.
- [x] Design documentation reflects the runtime-only payload boundary.

## Progress Log

### Session: 2026-04-20 21:46

**Tasks Completed**: Validation guard, regression coverage, and design
clarification.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Review found that the runtime `NodeType` union expansion had leaked
into authored node payload validation. The guard restores the intended
architecture: authors reference add-ons from `workflow.json.nodes[]`, and the
loader owns resolved add-on payload materialization.
