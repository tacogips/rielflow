# Third-party Add-on Resolver Validation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

### Summary

Harden the third-party add-on resolver boundary so resolver output is treated as
runtime input, converted to validation issues when malformed, and normalized
through the ordinary node payload validator before becoming part of a normalized
workflow bundle.

### Scope

**Included**: Resolver result shape validation, third-party payload
normalization, runtime add-on metadata rejection, and targeted regression tests.

**Excluded**: Package discovery, resolver package installation, and custom
third-party native `nodeType: "addon"` executor registration.

---

## Modules

### 1. Resolver Result Guard

#### `src/workflow/node-addons.ts`

**Status**: Completed

```typescript
function normalizeThirdPartyResolverResult(input: {
  readonly addonName: string;
  readonly path: string;
  readonly value: unknown;
}): NodeAddonResolveResult;
```

**Checklist**:

- [x] Convert non-object resolver returns into validation issues.
- [x] Validate resolver `issues` arrays before they are consumed.
- [x] Keep resolver exceptions converted into validation issues.

### 2. Third-party Payload Normalization

#### `src/workflow/validate.ts`

**Status**: Completed

```typescript
function normalizeNodePayload(input: {
  readonly nodeId: string;
  readonly nodeFile: string;
  readonly payload: unknown;
  readonly issues: ValidationIssue[];
  readonly path?: string;
}): NodePayload | null;
```

**Checklist**:

- [x] Reuse ordinary node payload validation for third-party resolver payloads.
- [x] Reject third-party resolver payloads with `nodeType: "addon"`.
- [x] Reject third-party resolver payloads that return runtime add-on metadata.
- [x] Preserve built-in `rielflow/*` add-on resolution behavior.

### 3. Tests and Documentation

#### `src/workflow/validate.test.ts`, `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

**Status**: Completed

**Checklist**:

- [x] Cover third-party resolver payloads that fail ordinary payload validation.
- [x] Cover malformed third-party resolver result objects.
- [x] Cover runtime add-on metadata spoofing rejection.
- [x] Document resolver output normalization and failure handling.

---

## Module Status

| Module                        | File Path                                                 | Status    | Tests              |
| ----------------------------- | --------------------------------------------------------- | --------- | ------------------ |
| Resolver result guard         | `src/workflow/node-addons.ts`                             | Completed | `validate.test.ts` |
| Third-party payload validator | `src/workflow/validate.ts`                                | Completed | `validate.test.ts` |
| Tests and docs                | `src/workflow/validate.test.ts`, `design-docs/specs/*.md` | Completed | Targeted Vitest    |

## Dependencies

| Feature                         | Depends On                        | Status    |
| ------------------------------- | --------------------------------- | --------- |
| Resolver payload hardening      | `third-party-addon-resolution`    | Available |
| Ordinary node payload validator | Existing workflow validation path | Available |

## Completion Criteria

- [x] Malformed resolver results become validation issues.
- [x] Third-party resolver payloads are normalized as ordinary node payloads.
- [x] Third-party resolver payloads cannot use runtime-owned add-on execution.
- [x] Built-in add-on behavior remains unchanged.
- [x] Targeted tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20 23:24 JST

**Tasks Completed**: Resolver payload diagnostic path correction and focused
regression expectation updates.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Continuation review found that third-party resolver payload id and
runtime-owned `nodeType` provenance errors pointed at the authored add-on object
instead of the resolver payload fields. Validation now reports
`addon.payload.id` and `addon.payload.nodeType`, matching the payload
normalization diagnostics used elsewhere.

### Session: 2026-04-20 22:53 JST

**Tasks Completed**: Resolver result guard, third-party payload normalization,
runtime add-on metadata rejection, regression tests, and design update.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Continuation review found that the third-party resolver boundary was
present but accepted resolver payloads after only id and native-addon checks.
This iteration routes third-party payloads through ordinary node payload
validation so third-party add-ons stay easy to host while preserving the same
validation standards as workflow-local node files.

## Related Plans

- **Previous**: `impl-plans/third-party-addon-resolution.md`
- **Next**: Future distributed add-on package/lockfile plan
- **Depends On**: `impl-plans/third-party-addon-resolution.md`
