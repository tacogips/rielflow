# Third-party Add-on GraphQL Validation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

### Summary

Continuation review found that the host-provided third-party add-on resolver
boundary was preserved by load, save, and execution paths, but the in-process
GraphQL `validateWorkflowDefinition` mutation still invoked workflow validation
without the request context. Browser/editor validation therefore rejected
third-party add-ons that would later save or execute successfully.

### Scope

**Included**: GraphQL validation context propagation, a regression test for
third-party add-on validation through the schema mutation, and design wording
that identifies GraphQL validation as part of the resolver-preserving surface.

**Excluded**: Remote GraphQL serialization of resolver functions, CLI add-on
package discovery, lockfile-backed package loading, and third-party native
`nodeType: "addon"` executor registration.

---

## Modules

### 1. GraphQL Validation Context Propagation

#### `src/graphql/schema.ts`

**Status**: Completed

```typescript
validateWorkflowBundleDetailed(bundle, context);
```

**Checklist**:

- [x] Pass `GraphqlRequestContext` into `validateWorkflowBundleDetailed`.
- [x] Preserve existing validation behavior for bundles without third-party
      add-ons.

### 2. Regression Coverage

#### `src/graphql/schema.test.ts`

**Status**: Completed

```typescript
interface GraphqlExecutionOverrides extends LoadOptions {
  readonly nodeAddonResolvers?: readonly NodeAddonPayloadResolver[];
}
```

**Checklist**:

- [x] Validate a third-party add-on bundle through
      `schema.mutation.validateWorkflowDefinition`.
- [x] Confirm resolver-backed validation has no errors.

### 3. Design and Progress Tracking

#### `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`, `impl-plans/*`

**Status**: Completed

**Checklist**:

- [x] Record that in-process GraphQL validation must preserve resolver options.
- [x] Add plan/progress tracking for this continuation fix.

## Module Status

| Module                      | File Path                                                                              | Status    | Tests                |
| --------------------------- | -------------------------------------------------------------------------------------- | --------- | -------------------- |
| GraphQL validation context  | `src/graphql/schema.ts`                                                                | Completed | `schema.test.ts`     |
| Regression test             | `src/graphql/schema.test.ts`                                                           | Completed | Targeted + typecheck |
| Design and progress records | `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`, `impl-plans/*` | Completed | Review               |

## Dependencies

| Feature                         | Depends On                              | Status    |
| ------------------------------- | --------------------------------------- | --------- |
| GraphQL validation resolver use | `third-party-addon-public-api`          | Available |
| Resolver payload validation     | `third-party-addon-resolver-validation` | Available |

## Completion Criteria

- [x] GraphQL validation receives host-provided third-party add-on resolvers.
- [x] Third-party add-on workflows validate through the schema mutation.
- [x] Existing editor validation behavior remains covered.
- [x] Targeted tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20 23:59 JST

**Tasks Completed**: GraphQL validation context propagation, third-party add-on
schema validation regression test, design note, and plan/progress index update.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: The architecture/design already required resolver preservation across
validation entry points. The code gap was limited to the GraphQL validation
mutation; save and execution already passed the context through.

## Related Plans

- **Previous**: `impl-plans/third-party-addon-package-root-entrypoint.md`
- **Depends On**: `impl-plans/third-party-addon-public-api.md`, `impl-plans/third-party-addon-resolver-validation.md`
