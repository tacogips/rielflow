# Third-party Add-on Editor Revision Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

### Summary

Continuation review found that add-on workflows validate and execute without
authored node payload files, but GraphQL workflow-definition revision metadata
still hashed every normalized `nodeFile`. Add-on nodes receive synthetic
`nodes/node-{id}.json` values during normalization, so editor-facing workflow
definition views could return `revision: null` for otherwise valid third-party
add-on workflows.

### Scope

**Included**: A shared authored-node-file collector, GraphQL revision usage,
inspection metadata alignment, save-path consistency, regression coverage, and
design wording.

**Excluded**: Package discovery, resolver installation, and third-party native
`nodeType: "addon"` executor registration.

---

## Modules

### 1. Authored Revision Node Files

#### `src/workflow/revision.ts`

**Status**: Completed

```typescript
function collectWorkflowRevisionNodeFiles(workflow: {
  readonly nodes: readonly {
    readonly nodeFile: string;
    readonly addon?: unknown;
  }[];
}): readonly string[];
```

**Checklist**:

- [x] Return only workflow-local node payload files.
- [x] Exclude add-on nodes whose payload is materialized in memory.
- [x] Keep prompt-template file collection unchanged.

### 2. Revision and Inspection Callers

#### `src/graphql/schema.ts`, `src/workflow/save.ts`, `src/workflow/inspect.ts`

**Status**: Completed

```typescript
const nodeFiles = collectWorkflowRevisionNodeFiles(workflow);
```

**Checklist**:

- [x] GraphQL workflow-definition revisions ignore synthetic add-on node files.
- [x] Save revision computation continues to ignore add-on node files through
      the shared helper.
- [x] Inspection `nodeFiles` reports only editable workflow-local payload files.

### 3. Regression Coverage and Documentation

#### `src/graphql/schema.test.ts`, `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

**Status**: Completed

**Checklist**:

- [x] Cover a third-party add-on workflow definition with no node payload files.
- [x] Assert the workflow-definition revision is a real SHA-256 revision.
- [x] Assert inspection does not expose synthetic add-on node files.
- [x] Document the editor revision/inspection contract.

## Module Status

| Module                         | File Path                                           | Status    | Tests            |
| ------------------------------ | --------------------------------------------------- | --------- | ---------------- |
| Authored revision file helper  | `src/workflow/revision.ts`                          | Completed | Typecheck        |
| Revision and inspection usage  | `src/graphql/schema.ts`, `save.ts`, `inspect.ts`    | Completed | `schema.test.ts` |
| Regression and design tracking | `src/graphql/schema.test.ts`, `design-docs/specs/*` | Completed | Targeted Vitest  |

## Dependencies

| Feature                  | Depends On                              | Status    |
| ------------------------ | --------------------------------------- | --------- |
| Add-on save preservation | `node-addon-chat-reply-worker`          | Available |
| Third-party resolution   | `third-party-addon-graphql-validation`  | Available |

## Completion Criteria

- [x] GraphQL workflow-definition views compute revisions for third-party
      add-on workflows without authored node payload files.
- [x] Inspection metadata does not list synthetic add-on node files as editable
      payload files.
- [x] Save revision behavior remains consistent with editor revision behavior.
- [x] Targeted tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20 23:28 JST

**Tasks Completed**: Shared authored node-file collector, GraphQL revision
fix, inspection metadata alignment, save-path helper reuse, regression test, and
design update.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: The host-provided third-party resolver architecture was sound, but
editor-facing revision metadata still assumed every normalized node had a
persisted payload file. This iteration closes that continuation bug.

## Related Plans

- **Previous**: `impl-plans/third-party-addon-graphql-validation.md`
- **Depends On**: `impl-plans/third-party-addon-graphql-validation.md`
