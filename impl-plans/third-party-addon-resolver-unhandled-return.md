# Third-party Add-on Resolver Unhandled Return Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

### Summary

Continuation review found that the host-provided third-party resolver boundary
worked, but resolver composition was stricter than needed: a resolver that
returned `undefined` for an unhandled add-on produced a validation error instead
of allowing later resolvers to handle the reference. That makes third-party
resolver package composition brittle.

### Scope

**Included**: Public resolver return type update, unhandled-result normalization,
regression tests, and design/progress tracking.

**Excluded**: Async resolver execution, package discovery, lockfile-backed
package loading, and third-party native `nodeType: "addon"` executor
registration.

---

## Modules

### 1. Resolver Type Surface

#### `src/workflow/types.ts`

**Status**: Completed

```typescript
type NodeAddonPayloadResolver = (
  input: NodeAddonResolveInput,
) => NodeAddonResolveResult | undefined;
```

**Checklist**:

- [x] Allow resolver packages to return `undefined` for unhandled add-on refs.
- [x] Preserve the existing object result shape for handled refs.

### 2. Resolver Dispatch Normalization

#### `src/workflow/node-addons.ts`

**Status**: Completed

```typescript
function normalizeThirdPartyResolverResult(input: {
  readonly value: unknown;
}): NodeAddonResolveResult;
```

**Checklist**:

- [x] Treat `undefined` as no payload and no issues.
- [x] Continue to reject malformed non-object handled results.
- [x] Continue to the next resolver after an unhandled result.

### 3. Regression Coverage and Documentation

#### `src/workflow/validate.test.ts`, `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

**Status**: Completed

**Checklist**:

- [x] Cover an unhandled resolver followed by a handling resolver.
- [x] Keep malformed resolver result coverage using a non-object handled value.
- [x] Document `undefined` as the unhandled resolver return.

---

## Module Status

| Module                 | File Path                                                 | Status    | Tests              |
| ---------------------- | --------------------------------------------------------- | --------- | ------------------ |
| Resolver type surface  | `src/workflow/types.ts`                                   | Completed | Typecheck          |
| Resolver normalization | `src/workflow/node-addons.ts`                             | Completed | `validate.test.ts` |
| Tests and docs         | `src/workflow/validate.test.ts`, `design-docs/specs/*.md` | Completed | Targeted Vitest    |

## Dependencies

| Feature                    | Depends On                                | Status    |
| -------------------------- | ----------------------------------------- | --------- |
| Third-party resolver API   | `third-party-addon-public-api`            | Available |
| Resolver validation guard  | `third-party-addon-resolver-validation`   | Available |
| Editor/save resolver usage | `third-party-addon-graphql-validation`    | Available |

## Completion Criteria

- [x] Third-party resolver functions may return `undefined` for unhandled refs.
- [x] Resolver chains continue after an unhandled result.
- [x] Malformed handled results still become validation issues.
- [x] Targeted tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20 23:34 JST

**Tasks Completed**: Resolver return type update, unhandled-result
normalization, regression tests, design wording, and progress index update.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: This is a small continuation fix to make third-party add-on packages
easier to compose. The architecture remains host-provided and deterministic;
`undefined` is only an unhandled signal, not package discovery or code loading.

## Related Plans

- **Previous**: `impl-plans/third-party-addon-editor-revision.md`
- **Depends On**: `impl-plans/third-party-addon-public-api.md`, `impl-plans/third-party-addon-resolver-validation.md`
