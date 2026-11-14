# Async Third-party Resolver Validation Error Handling Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#node-add-on-catalog`; `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`
**Created**: 2026-05-17
**Last Updated**: 2026-05-17

---

## Design Document Reference

**Source**:

- `design-docs/specs/architecture.md:748`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md:375`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md:423`

### Summary

Fix the async third-party add-on resolver validation boundary so
`validateWorkflowBundleDetailedAsync` converts throwing resolvers, rejected
resolver promises, and malformed async resolver return values into
`ValidationIssue` records instead of letting them escape validation. Valid
resolver-provided `nodeValidationResults` must remain additive metadata on the
resolved node payload.

### Issue Reference

- Source workflow: `recent-change-quality-loop`
- Source execution:
  `div-recent-change-quality-loop-1778956967-7b74a72d`
- Source node: `step3-handoff`
- Blocking finding: `src/workflow/addon-package-boundary.ts:248` invokes async
  third-party resolvers before package-boundary normalization/error handling, so
  throwing resolvers escape `validateWorkflowBundleDetailedAsync`.

### Scope

**Included**:

- Async third-party resolver invocation behavior in
  `src/workflow/addon-package-boundary.ts`.
- Alignment with the existing normalization and error-handling contract in
  `packages/divedra-addons/src/node-addons/addon-payload-resolution.ts`.
- Focused regression coverage for throwing async resolvers, malformed async
  resolver output, and valid `nodeValidationResults` preservation.
- Verification across workflow validation, CLI, GraphQL, package-boundary tests,
  type checking, and whitespace checks.

**Excluded**:

- The unrelated low finding in
  `src/workflow/validate/node-executability-validation.ts`.
- New resolver package discovery, network/package installation behavior, or
  third-party native `nodeType: "addon"` execution.
- Any change to Codex or Cursor backend adapter behavior.

### Codex Agent References

No codex-agent reference input was provided by Step 1. This plan references
only repository-local behavior. The existing `codex-agent` backend adapter path
must remain unaffected.

---

## Modules

### 1. Boundary Async Resolver Invocation

#### `src/workflow/addon-package-boundary.ts`

**Status**: COMPLETED

**Relevant signatures**:

```typescript
export async function resolveBoundaryNodeAddonPayloadAsync(
  input: BoundaryAsyncNodeAddonResolveInput,
): Promise<NodeAddonResolveResult>;
```

**Deliverables**:

- Remove or replace the pre-package async third-party resolver loop that calls
  `await resolver(input)` without normalization or error conversion.
- Route async third-party resolver results through the same handled contract used
  by package-owned async resolution:
  `normalizeThirdPartyResolverResult`, resolver exception conversion, local
  source fallback ordering, and `NodeAddonResolveResult` output.
- Preserve the current sync resolver behavior for callers of the synchronous
  validation API.

**Checklist**:

- [x] Throwing async third-party resolvers become `ValidationIssue` records.
- [x] Rejected async third-party resolver promises become `ValidationIssue`
  records.
- [x] Malformed async resolver return values become `ValidationIssue` records.
- [x] Valid async resolver results continue to resolve payloads.
- [x] Valid resolver-provided `nodeValidationResults` remain preserved.

### 2. Workflow Validation Regression Tests

#### `src/workflow/validate.test.ts`

**Status**: COMPLETED

**Deliverables**:

- Add a focused `validateWorkflowBundleDetailedAsync` test where an
  `asyncNodeAddonResolver` throws and validation returns an error result with a
  `ValidationIssue` instead of throwing.
- Add a focused test where an async resolver returns a malformed value and
  validation returns a normalized validation issue.
- Add or extend a focused test proving valid async resolver
  `nodeValidationResults` are preserved in detailed validation output.

**Checklist**:

- [x] Tests fail on the current escaping behavior.
- [x] Tests assert returned validation issues, not uncaught exceptions.
- [x] Tests assert authored add-on path attribution for resolver failures.
- [x] Tests assert `nodeValidationResults` content is still present for valid
  resolver output.

### 3. Package Boundary Regression Coverage

#### `src/package-boundaries.test.ts`
#### `packages/divedra-addons/src/node-addons/addon-payload-resolution.ts`

**Status**: COMPLETED

**Deliverables**:

- Add or adjust package-boundary regression coverage so `divedra-core` does not
  reintroduce an unnormalized async third-party resolver loop outside the
  add-ons package boundary.
- Keep any `packages/divedra-addons` changes limited to exporting or reusing the
  existing normalization/error-handling path if the core boundary needs a helper.

**Checklist**:

- [x] Boundary test detects direct async third-party resolver calls in
  `src/workflow/addon-package-boundary.ts` that bypass normalization.
- [x] Add-ons package remains the owner of third-party resolver normalization.
- [x] No unrelated package split or import-boundary refactor is introduced.

### 4. Verification and Plan Progress Update

#### `impl-plans/active/async-third-party-resolver-validation-error-handling.md`

**Status**: COMPLETED

**Deliverables**:

- Update this progress log after implementation with completed tasks,
  verification results, blockers, and any residual risk.
- Preserve the issue-resolution handoff trail back to the recent-change
  blocking finding.

**Checklist**:

- [x] Progress log lists implemented task ids and verification outcomes.
- [x] Any skipped command is documented with a concrete reason.
- [x] No unresolved high or mid issue remains for the delegated finding.

---

## Task Breakdown

| Task | Scope | Deliverables | Dependencies | Parallelizable |
| ---- | ----- | ------------ | ------------ | -------------- |
| TASK-001 | Async resolver boundary fix | `src/workflow/addon-package-boundary.ts` | Accepted Step 3 design review | No |
| TASK-002 | Validation regression tests | `src/workflow/validate.test.ts` | TASK-001 behavior target; may be written before fix but shares validation fixtures | No |
| TASK-003 | Package-boundary regression | `src/package-boundaries.test.ts`, optional helper export reuse in `packages/divedra-addons/src/node-addons/addon-payload-resolution.ts` | TASK-001 | No |
| TASK-004 | Verification and progress log | This plan file | TASK-001, TASK-002, TASK-003 | No |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Async resolver error conversion | Accepted design and existing `normalizeThirdPartyResolverResult` contract | READY |
| Malformed resolver output diagnostics | Existing resolver result normalization in `packages/divedra-addons` | READY |
| `nodeValidationResults` preservation | Existing `NodeValidationResult` aggregation in validation output | READY |
| CLI/GraphQL validation parity | Shared workflow validation entrypoints | READY |

## Parallelizable Tasks

No tasks are marked parallelizable. The implementation touches shared resolver
boundary behavior and tests whose expected outputs depend on the same
validation flow.

## Verification Plan

Run after implementation:

- `bun run typecheck`
- `bun run test -- src/workflow/validate.test.ts src/cli.test.ts src/graphql/schema.test.ts src/package-boundaries.test.ts`
- `git diff --check`

Focused behavioral checks:

- Re-run the previous throwing async resolver reproduction and confirm it
  returns validation issues instead of printing `THREW:boom`.
- Confirm malformed async resolver output is reported as `ValidationIssue`
  output from `validateWorkflowBundleDetailedAsync`.
- Confirm valid async resolver `nodeValidationResults` are present in detailed
  validation output.

## Completion Criteria

- [x] `validateWorkflowBundleDetailedAsync` does not throw for throwing or
  rejected async third-party resolvers.
- [x] Malformed async resolver return values become validation issues.
- [x] Existing valid resolver `nodeValidationResults` behavior remains
  preserved.
- [x] Focused workflow validation tests cover the regression cases.
- [x] CLI, GraphQL, and package-boundary focused tests pass.
- [x] `bun run typecheck` passes.
- [x] `git diff --check` passes.
- [x] This plan's progress log is updated with final task and verification
  status.

## Progress Log

### Session: 2026-05-17 13:45 JST

**Tasks Completed**: Plan created from accepted Step 3 design review.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 3 accepted the design update with no high or mid findings. The
next implementation step should keep scope limited to the recent-change
blocking finding in `src/workflow/addon-package-boundary.ts:248` and must not
address the unrelated low finding in
`src/workflow/validate/node-executability-validation.ts:109`.

### Session: 2026-05-17 14:35 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004.
**Tasks In Progress**: None.
**Blockers**: None.
**Verification**:

- `bun run lint:biome` passed with existing unrelated warnings in
  `src/workflow/engine/*.ts`.
- `bun run typecheck` passed.
- `bun run test -- src/workflow/validate.test.ts src/cli.test.ts src/graphql/schema.test.ts src/package-boundaries.test.ts`
  passed: 1135 tests, 0 failed.
- `git diff --check` passed.

**Notes**: Removed the async pre-package third-party resolver loop from
`src/workflow/addon-package-boundary.ts` and delegated async add-on resolution
to the add-ons package export. Added regression coverage for throwing async
resolvers, malformed async resolver output, preservation of
`nodeValidationResults`, and package-boundary ownership. No high or mid issue
remains for the delegated recent-change finding.

## Related Plans

- **Depends On**: `impl-plans/third-party-addon-async-resolution.md`
- **Depends On**: `impl-plans/third-party-addon-resolver-validation.md`
- **Related**: `impl-plans/active/package-boundary-architecture.md`
