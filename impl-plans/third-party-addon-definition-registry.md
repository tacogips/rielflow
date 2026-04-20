# Third-party Add-on Definition Registry Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`
**Created**: 2026-04-21
**Last Updated**: 2026-04-21

---

## Summary

Add a higher-level add-on registration surface on top of the existing
third-party resolver API. Hosts should be able to register typed add-on
definitions while existing `nodeAddonResolvers` users continue to work.

## Deliverables

### TASK-001: Public Add-on Definition Types

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/workflow/types.ts`, `src/lib.ts`

**Completion Criteria**:

- [x] `NodeAddonDefinition` describes name, optional version, and resolver.
- [x] `LoadOptions` accepts `nodeAddons`.
- [x] Package root exports definition types and helper functions.

### TASK-002: Registry Helper Runtime

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/workflow/node-addons.ts`, `src/workflow/validate.ts`

**Completion Criteria**:

- [x] Definitions can be converted to the existing resolver contract.
- [x] Validation accepts `nodeAddons` alongside `nodeAddonResolvers`.
- [x] Unsupported definition versions are reported as validation issues.

### TASK-003: Regression Coverage

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/validate.test.ts`, `src/lib.test.ts`, `README.md`

**Completion Criteria**:

- [x] Validation covers definition registration.
- [x] Library execution wrappers forward definition registration.
- [x] README documents the definition/registry surface.

## Progress Log

### Session: 2026-04-21 00:00 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented an additive `nodeAddons` API and registry helpers while
preserving the existing resolver array for low-level integrations.
