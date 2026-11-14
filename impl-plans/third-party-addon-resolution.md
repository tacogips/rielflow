# Third-party Add-on Resolution Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

### Summary

Add a host-provided resolver boundary so non-`divedra/` add-on references can be
materialized without embedding third-party package loading or arbitrary code
execution into workflow JSON.

### Scope

**Included**: Resolver types, validation/load/save option plumbing, tests, and
design updates.

**Excluded**: Package registry discovery, lockfile installation, third-party
native `nodeType: "addon"` executor registration, and CLI add-on install
commands.

---

## Modules

### 1. Resolver Type Surface

#### `src/workflow/types.ts`

**Status**: Completed

```typescript
interface NodeAddonResolveInput {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}

type NodeAddonPayloadResolver = (
  input: NodeAddonResolveInput,
) => NodeAddonResolveResult;
```

**Checklist**:

- [x] Define resolver input/result types.
- [x] Add optional `nodeAddonResolvers` to `LoadOptions`.
- [x] Keep existing built-in add-on metadata types unchanged.

### 2. Resolver Dispatch

#### `src/workflow/node-addons.ts`

**Status**: Completed

```typescript
function resolveNodeAddonPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
  readonly thirdPartyResolvers?: readonly NodeAddonPayloadResolver[];
}): NodeAddonResolveResult;
```

**Checklist**:

- [x] Reserve `divedra/` for built-in catalog resolution.
- [x] Invoke third-party resolvers only for non-`divedra/` add-ons.
- [x] Reject third-party resolver payloads with mismatched node ids.
- [x] Reject third-party resolver payloads that use runtime-native add-on
      execution.
- [x] Convert resolver exceptions into validation issues.
- [x] Report unhandled third-party add-ons as validation errors.

### 3. Validation and Loading Plumbing

#### `src/workflow/validate.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`

**Status**: Completed

```typescript
interface WorkflowValidationOptions {
  readonly nodeAddonResolvers?: readonly NodeAddonPayloadResolver[];
}
```

**Checklist**:

- [x] Pass resolver options through validation.
- [x] Pass resolver options from workflow loading.
- [x] Pass resolver options from workflow saving.
- [x] Preserve existing built-in validation behavior.

### 4. Tests and Documentation

#### `src/workflow/validate.test.ts`, `src/workflow/load.test.ts`, `design-docs/specs/*.md`, `README.md`

**Status**: Completed

**Checklist**:

- [x] Cover accepted third-party add-on resolution.
- [x] Cover unhandled third-party add-on validation errors.
- [x] Cover invalid third-party resolver output.
- [x] Cover load option resolver plumbing.
- [x] Document current resolver boundary and future distribution work.

---

## Module Status

| Module              | File Path                                             | Status    | Tests              |
| ------------------- | ----------------------------------------------------- | --------- | ------------------ |
| Resolver types      | `src/workflow/types.ts`                               | Completed | Typecheck          |
| Resolver dispatch   | `src/workflow/node-addons.ts`                         | Completed | `validate.test.ts` |
| Option plumbing     | `src/workflow/validate.ts`, `load.ts`, `save.ts`      | Completed | Targeted Vitest    |
| Docs and plan index | `design-docs/specs/*.md`, `README.md`, `impl-plans/*` | Completed | Review             |

## Dependencies

| Feature                       | Depends On                       | Status    |
| ----------------------------- | -------------------------------- | --------- |
| Third-party resolver boundary | Existing built-in add-on catalog | Available |
| Load/save option plumbing     | Existing `LoadOptions` path      | Available |

## Completion Criteria

- [x] Non-`divedra/` add-ons can resolve through explicit host resolvers.
- [x] Built-in `divedra/*` names remain owned by the runtime catalog.
- [x] Missing resolvers produce actionable validation errors.
- [x] Resolver output is constrained to the authored node id and ordinary node
      execution paths.
- [x] Existing built-in add-on behavior remains compatible.
- [x] Targeted tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20

**Tasks Completed**: Resolver type surface, dispatch boundary, validation/load/save
plumbing, tests, docs, and progress index updates.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: This iteration intentionally supports third-party add-ons by resolving
to ordinary node payloads. Distributed package acquisition and custom native
add-on executors remain separate future work.

## Related Plans

- **Previous**: `impl-plans/node-addon-chat-reply-worker.md`
- **Next**: Future distributed add-on package/lockfile plan
- **Depends On**: `impl-plans/node-addon-chat-reply-worker.md`
