# Third-party Add-on Payload Shape Guard Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

### Summary

Continuation review found that third-party resolver output was documented as
untrusted runtime input, but validation still read fields from the resolver
payload before confirming that the payload was an object. This plan closes that
crash path while preserving the host-provided resolver architecture.

### Scope

**Included**: Payload shape guard before add-on provenance checks and a
regression test for non-object resolver payloads.

**Excluded**: Package discovery, resolver installation, and third-party native
add-on executor registration.

---

## Modules

### 1. Resolver Payload Shape Guard

#### `src/workflow/validate.ts`

**Status**: Completed

```typescript
function validateResolvedAddonPayload(input: {
  readonly payload: unknown;
  readonly issues: ValidationIssue[];
}): boolean;
```

**Checklist**:

- [x] Treat resolver payloads as unknown before reading payload fields.
- [x] Convert non-object payloads into validation issues.
- [x] Preserve existing built-in add-on behavior.

### 2. Regression Coverage

#### `src/workflow/validate.test.ts`

**Status**: Completed

**Checklist**:

- [x] Cover a resolver that returns `payload: null`.
- [x] Verify validation reports the issue instead of throwing.

---

## Module Status

| Module              | File Path                       | Status    | Tests              |
| ------------------- | ------------------------------- | --------- | ------------------ |
| Payload shape guard | `src/workflow/validate.ts`      | Completed | `validate.test.ts` |
| Regression test     | `src/workflow/validate.test.ts` | Completed | Targeted Vitest    |

## Dependencies

| Feature                | Depends On                              | Status    |
| ---------------------- | --------------------------------------- | --------- |
| Payload shape guard    | `third-party-addon-resolver-validation` | Available |
| Public resolver option | `third-party-addon-public-api`          | Available |

## Completion Criteria

- [x] Non-object third-party resolver payloads become validation issues.
- [x] Resolver output remains normalized through ordinary node payload
      validation after the shape guard.
- [x] Targeted tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20 23:45 JST

**Tasks Completed**: Payload shape guard, null-payload regression test, and
plan/progress index update.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: This is a continuation fix from reviewing the existing third-party
add-on diff. The architecture matched the intended host resolver boundary, but
the implementation needed one more guard before field-level provenance checks.

## Related Plans

- **Previous**: `impl-plans/third-party-addon-public-api.md`
- **Depends On**: `impl-plans/third-party-addon-resolver-validation.md`, `impl-plans/third-party-addon-public-api.md`
