# Third-party Add-on Public API Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

### Summary

Review continuation of the third-party add-on resolver boundary. The previous
resolver implementation supported low-level load and validation paths, but the
package-root public API and high-level execution wrappers also need to preserve
resolver options so host applications can run third-party add-ons without
private imports or special execution paths.

### Scope

**Included**: Public type exports, library execution option propagation,
regression tests, and design wording cleanup.

**Excluded**: CLI add-on package discovery, lockfile-backed package loading,
and third-party native `nodeType: "addon"` executor registration.

---

## Modules

### 1. Public Resolver Type Surface

#### `src/lib.ts`

**Status**: Completed

```typescript
export type {
  NodeAddonPayloadResolver,
  NodeAddonResolveInput,
  NodeAddonResolveResult,
  WorkflowNodeAddonRef,
  NodePayload,
  ValidationIssue,
} from "./workflow/types";
```

**Checklist**:

- [x] Export resolver-facing types from the package root.
- [x] Avoid requiring third-party packages to deep-import private modules.

### 2. Execution Wrapper Resolver Propagation

#### `src/lib.ts`

**Status**: Completed

```typescript
interface ExecuteWorkflowInput extends DivedraOptions {
  readonly nodeAddonResolvers?: readonly NodeAddonPayloadResolver[];
}
```

**Checklist**:

- [x] Preserve `nodeAddonResolvers` in `executeWorkflow`.
- [x] Preserve `nodeAddonResolvers` in `resumeWorkflow`.
- [x] Preserve `nodeAddonResolvers` in `rerunWorkflow`.

### 3. Regression Coverage and Documentation

#### `src/lib.test.ts`, `design-docs/specs/*.md`, `README.md`

**Status**: Completed

**Checklist**:

- [x] Cover third-party add-on execution through library wrappers.
- [x] Cover resume and rerun wrapper propagation.
- [x] Remove stale built-in-only design wording.
- [x] Document package-root resolver type exports.

---

## Module Status

| Module                        | File Path                                             | Status    | Tests             |
| ----------------------------- | ----------------------------------------------------- | --------- | ----------------- |
| Public type exports           | `src/lib.ts`                                          | Completed | Typecheck         |
| Execution wrapper propagation | `src/lib.ts`                                          | Completed | `src/lib.test.ts` |
| Docs and plan index           | `design-docs/specs/*.md`, `README.md`, `impl-plans/*` | Completed | Review            |

## Dependencies

| Feature                     | Depends On                              | Status    |
| --------------------------- | --------------------------------------- | --------- |
| Public add-on resolver API  | `third-party-addon-resolution`          | Available |
| Resolver payload validation | `third-party-addon-resolver-validation` | Available |

## Completion Criteria

- [x] Host applications can type resolver exports from the package root.
- [x] Public execution wrappers preserve resolver options.
- [x] Third-party add-ons work through execute, resume, and rerun library paths.
- [x] Design wording matches the host-provided third-party resolver boundary.
- [x] Targeted tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20 23:20 JST

**Tasks Completed**: Public resolver type exports, execution wrapper resolver
propagation, library regression tests, and documentation cleanup.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Continuation review found that the architecture had the right
host-provided resolver boundary, but public execution helpers dropped
`nodeAddonResolvers` before calling the runtime. That made third-party add-ons
work in low-level load/validation tests while failing through normal library
execution. This plan closes that API gap.

## Related Plans

- **Previous**: `impl-plans/third-party-addon-resolver-validation.md`
- **Next**: Future distributed add-on package/lockfile plan
- **Depends On**: `impl-plans/third-party-addon-resolution.md`, `impl-plans/third-party-addon-resolver-validation.md`
