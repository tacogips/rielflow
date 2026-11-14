# Node Backend/Model Separation Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-node-backend-model-separation.md, design-docs/specs/design-data-model.md#node-idjson, design-docs/specs/design-workflow-json.md#node-idjson, design-docs/specs/architecture.md#node-model
**Created**: 2026-03-07
**Last Updated**: 2026-03-07

## Summary

Make `executionBackend` and `model` the canonical separated node payload fields, while preserving read compatibility for older workflows that still encode tacogips backends in `model`.

## Scope

Included:

- Canonical design updates for backend/model separation
- Template/editor defaults updated to explicit backend selection
- Validation warnings for legacy backend-in-model encoding
- Tests covering canonical template output and legacy compatibility

Not included:

- Auto-rewriting existing workflow files
- Provider-side model name validation

## Modules

### 1. Design and Documentation

#### `design-docs/specs/design-node-backend-model-separation.md`

**Checklist**:
- [x] Define canonical `executionBackend` + `model` shape
- [x] Define legacy compatibility rule
- [x] Update core design references

### 2. Workflow Creation and Editor Defaults

#### `src/workflow/create.ts`

```ts
const TEMPLATE_EXECUTION_BACKEND = "tacogips/codex-agent";
const TEMPLATE_MODEL = "gpt-5";
```

#### `src/server/api.ts`

**Checklist**:
- [x] Create new payloads with explicit `executionBackend`
- [x] Default tacogips backends to provider model examples
- [x] Mark derive-from-model mode as legacy compatibility

### 3. Validation and Tests

#### `src/workflow/validate.ts`

```ts
function normalizeNodePayload(
  nodeId: string,
  nodeFile: string,
  payload: unknown,
  issues: ValidationIssue[],
): NodePayload | null;
```

**Checklist**:
- [x] Warn when tacogips backend is encoded in `model` without `executionBackend`
- [x] Preserve successful validation for legacy workflows
- [x] Add tests for canonical templates and compatibility behavior

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Design | `design-docs/specs/design-node-backend-model-separation.md` | COMPLETED | - |
| Defaults | `src/workflow/create.ts`, `src/server/api.ts` | COMPLETED | `src/workflow/load.test.ts`, `src/server/api.test.ts` |
| Validation | `src/workflow/validate.ts` | COMPLETED | `src/workflow/validate.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Defaults update | Design update | READY |
| Validation warning | Design update | READY |
| Tests | Defaults update, Validation warning | READY |

## Completion Criteria

- [x] Canonical docs describe `executionBackend` separately from `model`
- [x] New workflow templates write explicit `executionBackend`
- [x] Editor defaults prefer explicit backend selection
- [x] Legacy backend-in-model workflows still load
- [x] Validation surfaces the legacy encoding as non-canonical
- [x] Targeted tests pass

## Progress Log

### Session: 2026-03-07 21:15
**Tasks Completed**: Design update, implementation plan creation, defaults update, validation warning, tests
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The runtime already supported explicit backend/model separation for execution, so this iteration corrected the canonical design contract and aligned template/editor defaults with the existing adapter architecture.

### Session: 2026-03-07 21:45
**Tasks Completed**: Follow-up regression review, API/create response assertions, explicit tacogips backend routing test coverage
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added test coverage for the canonical authored shape so later iterations do not silently regress back to backend identifiers stored in `model`.

### Session: 2026-03-07 22:05
**Tasks Completed**: Validation hardening for explicit tacogips backends, regression coverage for backend/model conflation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Closed a gap where explicit `executionBackend: "tacogips/*"` still accepted legacy backend identifiers in `model`, which contradicted the canonical separation design.

### Session: 2026-03-07 22:20
**Tasks Completed**: Follow-up diff review, AGENTS overview alignment, canonical tacogips adapter test coverage, browser UI copy regression assertions
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Confirmed the runtime already separated backend selection from provider model routing; this pass removed remaining contradictory documentation and ensured low-level adapter tests now exercise explicit `executionBackend` plus provider model values as the primary path.
