# Node Add-on Worker Role Validation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#authoring-model`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

## Design Summary

The add-on catalog design says first-iteration add-ons are worker-only and must
be authored as worker nodes. The diff review found that validation rejected
`role: "manager"` add-on references, but still allowed add-on references that
omitted `role` and used legacy structural `kind` values. This plan closes that
gap by requiring authored add-on node refs to declare `role: "worker"`.

Scope:

- Add validation for add-on refs without explicit worker role.
- Add regression coverage for the missing role case.
- Align current README/design wording with the expanded built-in add-on catalog.

Out of scope:

- Changing resolved add-on payload execution behavior.
- Adding external add-on resolution.
- Supporting manager add-ons.

## Modules

### 1. Workflow Node Ref Validation

#### `src/workflow/validate.ts`

**Status**: Completed

```typescript
interface WorkflowNodeRef {
  readonly id: string;
  readonly addon?: WorkflowNodeAddonRef;
  readonly role?: "manager" | "worker";
}
```

**Checklist**:

- [x] Reject add-on node refs when `role` is omitted.
- [x] Reject add-on node refs when worker role would only be inferred from
      `kind`, `control`, or `repeat`.
- [x] Preserve the existing manager-role add-on rejection.
- [x] Keep valid `role: "worker"` add-on refs unchanged.

### 2. Regression Tests

#### `src/workflow/validate.test.ts`

**Status**: Completed

```typescript
function validateWorkflowBundle(
  raw: RawBundle,
): Result<NormalizedWorkflowBundle>;
```

**Checklist**:

- [x] Add coverage for add-on refs without explicit worker role.
- [x] Add coverage for add-on refs that infer worker role from `control`.
- [x] Keep existing add-on acceptance coverage passing.

### 3. Documentation Alignment

#### `README.md`

#### `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

**Status**: Completed

**Checklist**:

- [x] Describe `addon` as an implemented node execution type.
- [x] Update the add-on design intro so it covers the current built-in catalog,
      not only the first chat reply worker.

## Module Status

| Module               | File Path                                    | Status    | Tests              |
| -------------------- | -------------------------------------------- | --------- | ------------------ |
| Node ref validation  | `src/workflow/validate.ts`                   | Completed | `validate.test.ts` |
| Regression tests     | `src/workflow/validate.test.ts`              | Completed | Vitest             |
| Documentation update | `README.md`, `design-docs/specs/design-*.md` | Completed | Review             |

## Dependencies

| Feature                | Depends On                    | Status    |
| ---------------------- | ----------------------------- | --------- |
| Worker role validation | Existing add-on normalization | Available |
| Regression coverage    | Validation implementation     | Available |

## Completion Criteria

- [x] Add-on refs without `role: "worker"` fail validation.
- [x] Existing valid built-in add-on refs continue to pass.
- [x] Focused tests pass.
- [x] Type checking passes.
- [x] Documentation reflects the current add-on catalog.
- [x] Documentation clarifies that inferred worker role does not satisfy add-on
      authoring.

## Progress Log

### Session: 2026-04-20 21:34

**Tasks Completed**: Validation, regression test, documentation alignment.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Review found a worker-only contract hole for add-on refs authored
without `role`. Validation now requires explicit worker role while preserving
the existing manager-role rejection.

### Session: 2026-04-20 21:42

**Tasks Completed**: Review follow-up for inferred-role validation.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Tightened the check to use authored role presence rather than the
post-normalization role value, so `control` or `repeat` cannot implicitly satisfy
the add-on worker-role contract. Added regression coverage and design wording.
