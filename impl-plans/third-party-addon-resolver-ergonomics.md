# Third-party Add-on Resolver Ergonomics Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

### Summary

Continuation review found that the third-party resolver runtime was already
forgiving enough to normalize omitted `issues` to an empty list, but the
package-root resolver type still required resolver packages to write
`issues: []`. Review also found that the in-process GraphQL request context
passes resolver options structurally, but its public type did not expose
`LoadOptions`.

### Scope

**Included**: Public resolver result type ergonomics, GraphQL context type
alignment, regression coverage, and progress tracking.

**Excluded**: Async resolver execution, package discovery, lockfile-backed
package loading, and third-party native `nodeType: "addon"` executor
registration.

---

## Modules

### 1. Resolver Result Type Surface

#### `src/workflow/types.ts`

**Status**: Completed

```typescript
interface NodeAddonResolveResult {
  readonly payload?: NodePayload;
  readonly issues?: readonly ValidationIssue[];
}
```

**Checklist**:

- [x] Allow handled resolver results to omit `issues`.
- [x] Preserve explicit issue reporting for invalid handled refs.
- [x] Keep `undefined` as the unhandled resolver signal.

### 2. GraphQL Context Type Alignment

#### `src/graphql/types.ts`

**Status**: Completed

```typescript
interface GraphqlRequestContext extends LoadOptions, SessionStoreOptions {}
```

**Checklist**:

- [x] Expose `nodeAddonResolvers` on typed in-process GraphQL contexts.
- [x] Preserve existing session-store and event reply context fields.

### 3. Regression Coverage

#### `src/workflow/validate.test.ts`, `src/graphql/schema.test.ts`

**Status**: Completed

**Checklist**:

- [x] Cover a resolver returning payload without `issues`.
- [x] Cover a typed GraphQL request context carrying resolver options.

---

## Module Status

| Module               | File Path                | Status    | Tests           |
| -------------------- | ------------------------ | --------- | --------------- |
| Resolver result type | `src/workflow/types.ts`  | Completed | Typecheck       |
| GraphQL context type | `src/graphql/types.ts`   | Completed | Typecheck       |
| Tests and docs       | `src/**/*.test.ts`, docs | Completed | Targeted Vitest |

## Dependencies

| Feature                   | Depends On                                    | Status    |
| ------------------------- | --------------------------------------------- | --------- |
| Third-party resolver API  | `third-party-addon-resolver-unhandled-return` | Available |
| GraphQL resolver plumbing | `third-party-addon-graphql-validation`        | Available |

## Completion Criteria

- [x] Resolver packages can return `{ payload }` without `issues: []`.
- [x] Typed GraphQL request contexts can carry `nodeAddonResolvers`.
- [x] Targeted tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20 23:38 JST

**Tasks Completed**: Resolver result type ergonomics, GraphQL context type
alignment, regression tests, design wording, and progress index update.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: This iteration improves package-author ergonomics without changing
the host-provided resolver boundary or introducing package discovery.

## Related Plans

- **Previous**: `impl-plans/third-party-addon-resolver-unhandled-return.md`
- **Depends On**: `impl-plans/third-party-addon-resolver-unhandled-return.md`, `impl-plans/third-party-addon-graphql-validation.md`
