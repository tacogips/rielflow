# Product Code Duplicate-Scavenge Refactoring Plan

**Status**: Completed
**Design Reference**: Workflow output from `refactoring-divide-and-conquer` step `step3-merge-review-plan`; accepted boundary update in `design-docs/specs/architecture.md#product-code-duplicate-scavenge-consolidation-boundaries`
**Created**: 2026-05-19
**Last Updated**: 2026-05-20

## Scope

Improve product-code quality by consolidating duplicated TypeScript implementations under `packages/`, with the former root source tree now owned by `packages/divedra/src/`.

This plan preserves public behavior and public APIs unless a task explicitly authorizes a behavior-preserving contract cleanup. Root `src` entrypoints are removed after REF-019; active owned-file paths and verification commands use package-local `packages/divedra/src` paths.

Excluded: `.divedra`, `.agents`, `design-docs`, generated `dist`, `node_modules`, prompt cleanup, staging, commits, pushes, and any provisioning package because no concrete provisioning source surface was identified.

## Accepted Design References

- `design-docs/specs/architecture.md#product-code-duplicate-scavenge-consolidation-boundaries`: Defines the behavior-preserving boundaries for the remaining product-code duplicate-scavenge tasks.
- `design-docs/user-qa/qa-product-code-duplicate-scavenge-blockers.md`: Records the owner decisions that unblock `REF-003` and `REF-015`.
- `design-docs/user-qa/README.md`: Indexes the active blocker questions.
- Codex reference: no external `../../codex-agent` checkout was available or required for this plan. `codex-agent` remains an execution backend and adapter-behavior reference only; implementation must not copy Codex source or alter Cursor-specific adapter boundaries while sharing local-agent helpers.

## Implementation Order for Remaining Work

1. Treat `REF-007`, `REF-008`, `REF-009`, `REF-010`, `REF-011`, `REF-012`, `REF-013`, `REF-014`, `REF-016`, `REF-017`, and `REF-018` as completed by the 2026-05-19 23:08 and 23:23 JST implementation sessions.
2. Treat `REF-003` and `REF-015` as Ready because the delegated completion run supplied explicit owner decisions recorded in `design-docs/user-qa/qa-product-code-duplicate-scavenge-blockers.md`.
3. Implement `REF-003` first, then `REF-015`, so add-ons runner predicate changes are verified before backend constant normalization touches validation, dispatch, and readiness call sites.
4. Implement only each task's owned files, preserve the task-specific public-surface semantics, and run its focused verification commands plus `bun run typecheck` and `git diff --check`.
5. If a new constraint is discovered, record it as a new blocker or residual risk; do not revive the superseded public-surface questions.

## Delegated Completion Rerun State

Step 3 of `design-and-implement-review-loop` accepted the design update that supersedes the prior blocker state for `REF-003` and `REF-015`. The workflow input owner decisions approved the narrowest package-owned Docker-compatible runner predicate surface and core-owned backend constants with compatibility wrappers. Both Ready tasks are now completed and verified.

## Duplicate Groups

| Group | Repeated Concept | Owner Paths | Counterpart Paths | Consolidation Target | Confidence |
| --- | --- | --- | --- | --- | --- |
| DUP-001 | Built-in gateway add-on name constants | `packages/divedra-addons/src/runtime-readiness.ts` | `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts` | Reuse package-owned add-on constants | High |
| DUP-002 | Third-party node add-on definition selection and validate result attachment | `packages/divedra/src/workflow/addon-package-boundary.ts` | `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts` | Delegate boundary registry creation to add-ons package logic | High |
| DUP-003 | Docker-compatible container runner allowlist | `packages/divedra-addons/src/native-node-executor/template-env-and-containers.ts` | `packages/divedra/src/workflow/runtime-readiness.ts` | Package-owned runner predicate | Medium |
| DUP-004 | Resolver workflow execution and output artifact extraction | `packages/divedra/src/events/supervisor-llm-resolver.ts` | same file resolver branches | Events-owned helper for resolver execution/output payload extraction | High |
| DUP-005 | Event/source/binding/workflowInput dotted path resolution and template rendering | `packages/divedra/src/events/input-mapping.ts` | `packages/divedra/src/events/supervisor-correlation.ts`, `packages/divedra/src/events/supervisor-intent.ts`, `packages/divedra/src/events/supervisor-llm-resolver.ts`, `packages/divedra/src/events/task-planning.ts` | Events-owned path/template resolution helper | High |
| DUP-006 | Chat reply HTTP response parsing and dispatch result normalization | `packages/divedra/src/events/adapters/chat-sdk/reply.ts` | `packages/divedra/src/events/adapters/webhook.ts`, `packages/divedra/src/events/adapters/matrix.ts` | Shared events adapter response helper | Medium |
| DUP-007 | Artifact-safe path segment normalization | `packages/divedra/src/hook/recorder.ts` | `packages/divedra/src/events/ledger.ts`, `packages/divedra/src/events/supervised-runs.ts` | Shared artifact path segment sanitizer with fallback parameter | High |
| DUP-008 | JSON value SHA-256 hashing | `packages/divedra/src/hook/recorder.ts` | `packages/divedra/src/events/adapters/chat-sdk/normalization.ts` | Shared JSON SHA-256 helper preserving `sha256(JSON.stringify(value))` | Medium |
| DUP-009 | Workflow scope root, home expansion, configured root, and project discovery logic | `packages/divedra/src/workflow/checkout/registry.ts` | `packages/divedra/src/workflow/catalog.ts`, `packages/divedra-core/src/paths.ts`, `packages/divedra/src/cli/storage-and-options.ts` | Package/root workflow scope path resolver with wrapper-specific policy | High |
| DUP-010 | Validation issue and primitive field normalization helpers | `packages/divedra/src/workflow/validate/validation-types-and-runtime-options.ts` | `packages/divedra-core/src/workflow-validation.ts` | Core validation primitive module plus root-only validators | Medium |
| DUP-011 | Sync/async step-addressed node payload building with add-on resolution | `packages/divedra/src/workflow/validate/bundle-validation-entrypoints.ts` | same file sync/async entrypoints | Shared builder helper parameterized by add-on resolver and iteration mode | Medium |
| DUP-012 | Communication delivery artifact and record construction | `packages/divedra/src/workflow/manager-message-service/artifacts.ts` | `packages/divedra/src/workflow/engine/mailbox-communication-artifacts.ts`, `packages/divedra/src/workflow/communication-service.ts` | Shared workflow communication artifact persistence helper | High |
| DUP-013 | Node output artifact publication and runtime DB node execution persistence | `packages/divedra/src/workflow/engine/step-result-finalization.ts` | `packages/divedra/src/workflow/call-step-impl/direct-step-helpers.ts`, `packages/divedra/src/workflow/engine/step-input.ts` | Shared output publication helper | High |
| DUP-014 | Runtime communication id and delivery attempt id normalization | `packages/divedra/src/workflow/communication-service.ts` | `packages/divedra/src/workflow/manager-message-service/artifacts.ts`, `packages/divedra/src/workflow/engine/types-and-session-state.ts`, `packages/divedra/src/workflow/runtime-execution-contracts.ts` | Runtime execution contracts id helpers | Medium |
| DUP-015 | Official SDK request execution and output normalization | `packages/divedra-adapters/src/openai-sdk.ts` | `packages/divedra-adapters/src/anthropic-sdk.ts`, `packages/divedra-adapters/src/shared.ts` | Shared native SDK executor helper preserving provider-specific extraction | High |
| DUP-016 | CLI agent local session lifecycle execution | `packages/divedra-adapters/src/codex.ts` | `packages/divedra-adapters/src/claude.ts`, `packages/divedra-adapters/src/cursor.ts`, `packages/divedra-adapters/src/local-agent.ts` | Shared watched local-agent lifecycle helper | Medium |
| DUP-017 | Node execution backend enum, normalization, and display list | `packages/divedra/src/workflow/backend.ts` | `packages/divedra-core/src/workflow-model.ts`, `packages/divedra-core/src/workflow-validation.ts`, `packages/divedra-adapters/src/dispatch.ts`, `packages/divedra/src/workflow/node-patches.ts`, `packages/divedra/src/workflow/validate/node-payload-validation.ts` | Core-owned backend constants and normalization | High |
| DUP-018 | Workflow execution option normalization and projection | `packages/divedra/src/cli/input-output-helpers.ts` | `packages/divedra/src/cli/workflow-graphql-formatters.ts`, `packages/divedra/src/lib-workflow-run-options.ts`, `packages/divedra/src/index.ts` | Package-owned execution-options projector | High |
| DUP-019 | GraphQL response error aggregation and data-object validation | `packages/divedra/src/index.ts` | `packages/divedra/src/cli/input-output-helpers.ts`, `packages/divedra/src/graphql/client.ts` | Shared GraphQL data/error helper with operation-specific validators retained | Medium |
| DUP-020 | Workflow session state DTO definition and conversion | `packages/divedra-graphql/src/dto.ts` | `packages/divedra/src/workflow/session.ts`, `packages/divedra/src/graphql/control-plane-service.ts`, `packages/divedra/src/graphql/schema/execution-resolvers.ts`, `packages/divedra/src/graphql/types.ts` | Explicit root GraphQL projection mappers | High |
| DUP-021 | Workflow scope/status parsing and validation allowlists | `packages/divedra/src/server/graphql-executable-schema.ts` | `packages/divedra/src/workflow/overview.ts`, `packages/divedra/src/workflow/catalog.ts`, `packages/divedra/src/cli/storage-and-options.ts` | Shared typed parser utilities preserving caller error wording | High |

## Task DAG

| Task | Status | Duplicate Groups | Depends On | Parallelizable |
| --- | --- | --- | --- | --- |
| REF-001 | Completed | DUP-001 | - | Yes |
| REF-002 | Completed | DUP-002 | REF-001 | No |
| REF-003 | Completed | DUP-003 | REF-001 | No |
| REF-004 | Completed | DUP-004 | - | Yes |
| REF-005 | Completed | DUP-005 | REF-004 | No |
| REF-006 | Completed | DUP-006 | - | Yes |
| REF-007 | Completed | DUP-007, DUP-008 | - | Yes |
| REF-008 | Completed | DUP-009, DUP-021 | - | No |
| REF-009 | Completed | DUP-010 | - | Yes |
| REF-010 | Completed | DUP-011 | REF-002, REF-009 | No |
| REF-011 | Completed | DUP-012, DUP-014 | - | No |
| REF-012 | Completed | DUP-013 | REF-011 | No |
| REF-013 | Completed | DUP-015 | - | Yes |
| REF-014 | Completed | DUP-016 | REF-013 | No |
| REF-015 | Completed | DUP-017 | REF-009, REF-013 | No |
| REF-016 | Completed | DUP-018 | - | Yes |
| REF-017 | Completed | DUP-019 | REF-016 | No |
| REF-018 | Completed | DUP-020 | REF-011 | No |
| REF-019 | Completed | package source ownership cleanup | REF-002, REF-004, REF-005, REF-006 | No |

### REF-001: Reuse Canonical Gateway Add-On Constants in Readiness Detection

**Status**: Completed
**Owned Files/Directories**: `packages/divedra-addons/src/runtime-readiness.ts`, `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts`
**Excluded Files**: `packages/divedra/src/workflow/runtime-readiness.ts`, `dist`, `packages/divedra-addons/dist`, `node_modules`
**Depends On**: none
**Completion Criteria**:
- [x] Remove local gateway add-on name construction where canonical constants already exist.
- [x] Preserve current gateway read/write add-on string values.
- [x] Keep package boundary tests passing.
**Verification Commands**:
- `bun test packages/divedra/src/workflow/runtime-readiness-backends.test.ts packages/divedra/src/workflow/runtime-readiness-cross-workflow.test.ts`
- `bun test packages/divedra/src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Constants remain package-owned; downstream runtime readiness still has separate behavior-specific reporting.

### REF-002: Consolidate Boundary Add-On Registry Helpers Behind Package-Owned Logic

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src/workflow/addon-package-boundary.ts`, `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts`
**Excluded Files**: `packages/divedra/src/workflow/node-addons/**`, `packages/divedra/src/workflow/native-node-executor/**`, `dist`
**Depends On**: REF-001
**Completion Criteria**:
- [x] Delegate boundary registry creation to package-owned registry helpers or extract package-owned validate attachment helper.
- [x] Preserve sync and async validation error wording differences where tests require them.
- [x] Preserve root compatibility entrypoints.
**Verification Commands**:
- `bun test packages/divedra/src/workflow/addon-package-boundary.test.ts packages/divedra/src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Boundary-specific error text must be checked carefully because package helper wording currently differs.

### REF-003: Share Docker-Compatible Runner Predicate

**Status**: Completed
**Owned Files/Directories**: `packages/divedra-addons/src/native-node-executor/template-env-and-containers.ts`, `packages/divedra-addons/src/index.ts`, `packages/divedra/src/workflow/runtime-readiness.ts`
**Excluded Files**: `packages/divedra/src/workflow/native-node-executor/**`, `dist`
**Depends On**: REF-001
**Owner Decision**: Approved to add or expose the narrowest appropriate package-owned Docker-compatible runner predicate surface needed to complete the task, including a top-level add-ons export if that is the existing package convention. Recorded in `design-docs/user-qa/qa-product-code-duplicate-scavenge-blockers.md#ref-003-docker-compatible-runner-predicate-export`.
**Completion Criteria**:
- [x] Use one predicate for `podman`, `docker`, and `nerdctl`.
- [x] Expose the predicate through the narrowest add-ons-owned surface that matches existing package export conventions.
- [x] Preserve readiness reporting versus runtime policy error semantics.
**Verification Commands**:
- `bun test packages/divedra/src/workflow/runtime-readiness-backends.test.ts packages/divedra/src/workflow/native-node-executor-gateway.test.ts`
- `bun run typecheck`
**Residual Risk**: Public export surface should remain narrow; choose the top-level export only if it follows existing package convention.

### REF-004: Consolidate Supervisor Resolver Output Artifact Extraction

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src/events/supervisor-llm-resolver.ts`, `packages/divedra/src/events/supervisor-llm-resolver-dispatch.test.ts`, `packages/divedra/src/events/supervisor-llm-intent.test.ts`
**Excluded Files**: `packages/divedra-events/dist`, `dist`
**Depends On**: none
**Completion Criteria**:
- [x] Extract shared resolver workflow run/session reload/resolver-node/output payload read mechanics.
- [x] Keep chat resolver and dispatch resolver invalid-output policies separate.
- [x] Preserve current error mapping.
**Verification Commands**:
- `bun test packages/divedra/src/events/supervisor-llm-resolver-dispatch.test.ts packages/divedra/src/events/supervisor-llm-intent.test.ts packages/divedra/src/events/supervisor-llm-batch.test.ts`
- `bun run typecheck`
**Residual Risk**: Existing tests may not cover every malformed resolver artifact shape.

### REF-005: Centralize Event Dotted-Path and Template Resolution Semantics

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src/events/path-resolution.ts`, `packages/divedra/src/events/input-mapping.ts`, `packages/divedra/src/events/supervisor-correlation.ts`, `packages/divedra/src/events/supervisor-intent.ts`, `packages/divedra/src/events/supervisor-llm-resolver.ts`, `packages/divedra/src/events/task-planning.ts`
**Excluded Files**: `packages/divedra-events/src/runtime-ports.ts`, `dist`
**Depends On**: REF-004
**Completion Criteria**:
- [x] Add explicit root policy, exact-value versus string-render modes, and primitive coercion options.
- [x] Preserve current root allowances for input mapping, correlation, intent extraction, resolver input extraction, and task planning.
**Verification Commands**:
- `bun test packages/divedra/src/events/input-mapping.test.ts packages/divedra/src/events/supervisor-intent.test.ts packages/divedra/src/events/supervisor-llm-intent.test.ts`
- `bun run typecheck`
**Residual Risk**: Some correlation behavior may need additional focused tests if no existing test covers it.

### REF-006: Share Chat Reply HTTP Response Parsing Across Adapters

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src/events/adapters/chat-reply-response.ts`, `packages/divedra/src/events/adapters/chat-sdk/reply.ts`, `packages/divedra/src/events/adapters/webhook.ts`, `packages/divedra/src/events/adapters/matrix.ts`
**Excluded Files**: `packages/divedra/src/events/reply-dispatcher.ts` unless tests require call-site type updates
**Depends On**: none
**Completion Criteria**:
- [x] Centralize safe optional JSON parsing and `202` queued mapping.
- [x] Preserve provider-specific message id keys, including Matrix `event_id`.
**Verification Commands**:
- `bun test packages/divedra/src/events/reply-dispatcher.test.ts packages/divedra/src/events/adapters/webhook.test.ts packages/divedra/src/events/adapters/matrix.test.ts packages/divedra/src/events/adapters/chat-sdk.test.ts`
- `bun run typecheck`
**Residual Risk**: Provider-specific metadata should not be over-normalized.

### REF-007: Share Artifact Segment Sanitizer and JSON Hash Helper

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src/shared`, `packages/divedra/src/hook/recorder.ts`, `packages/divedra/src/events/ledger.ts`, `packages/divedra/src/events/supervised-runs.ts`, `packages/divedra/src/events/adapters/chat-sdk/normalization.ts`
**Excluded Files**: `packages/divedra-hook/src/redaction.ts`, `packages/divedra/src/events/adapters/webhook.ts`
**Depends On**: none
**Completion Criteria**:
- [x] Preserve current sanitize regex, 96-character truncation, and per-domain fallback labels.
- [x] Preserve exact `sha256(JSON.stringify(value))` behavior.
**Verification Commands**:
- `bun test packages/divedra/src/hook/index.test.ts`
- `bun test packages/divedra/src/events/receipt-ops.test.ts packages/divedra/src/events/trigger-runner-supervised.test.ts`
- `bun test packages/divedra/src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Hash helper must not imply canonical JSON ordering.

### REF-008: Consolidate Workflow Scope Root and Scope/Status Parser Utilities

**Status**: Completed
**Owned Files/Directories**: `packages/divedra-core/src/paths.ts`, `packages/divedra/src/workflow/catalog.ts`, `packages/divedra/src/workflow/checkout/registry.ts`, `packages/divedra/src/workflow/overview.ts`, `packages/divedra/src/server/graphql-executable-schema.ts`, `packages/divedra/src/cli/storage-and-options.ts`
**Excluded Files**: public GraphQL SDL, workflow bundle files, `dist`
**Depends On**: none
**Completion Criteria**:
- [x] Centralize shared path/scope/status allowlists while preserving caller-specific error envelopes and empty-value behavior.
- [x] Preserve checkout direct-root policy and catalog project discovery behavior.
**Verification Commands**:
- `bun test packages/divedra/src/workflow/checkout/checkout.test.ts packages/divedra/src/workflow/paths.test.ts packages/divedra/src/workflow/overview.test.ts`
- `bun test packages/divedra/src/graphql/schema.test.ts packages/divedra/src/cli.test.ts`
- `bun test packages/divedra/src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: This task crosses CLI, GraphQL, and workflow ownership; implement with narrow helper functions rather than broad module moves.

### REF-009: Share Validation Primitive Helpers

**Status**: Completed
**Owned Files/Directories**: `packages/divedra-core/src/workflow-validation.ts`, `packages/divedra/src/workflow/validate/validation-types-and-runtime-options.ts`, `packages/divedra/src/workflow/validate.test.ts`
**Excluded Files**: `packages/divedra/src/workflow/validate/bundle-validation-entrypoints.ts`, `dist`
**Depends On**: none
**Completion Criteria**:
- [x] Move only shared primitive checks into core-owned helpers.
- [x] Preserve root-only non-negative integer and working-directory helpers.
- [x] Preserve safe-integer versus integer differences unless explicitly reconciled by tests.
**Verification Commands**:
- `bun test packages/divedra/src/workflow/validate.test.ts`
- `bun test packages/divedra/src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Validation issue wording and numeric edge cases are compatibility-sensitive.

### REF-010: Reduce Step-Addressed Payload Builder Duplication

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src/workflow/validate/bundle-validation-entrypoints.ts`, `packages/divedra/src/workflow/validate.test.ts`
**Excluded Files**: add-on package internals unless REF-002 requires a small type export
**Depends On**: REF-002, REF-009
**Completion Criteria**:
- [x] Share non-add-on payload registration and step prompt variant application.
- [x] Keep sync and async add-on resolver mechanics explicit.
**Verification Commands**:
- `bun test packages/divedra/src/workflow/validate.test.ts`
- `bun run typecheck`
**Residual Risk**: Sync/async entrypoints must keep identical observable ordering.

### REF-011: Consolidate Communication Artifact and Delivery ID Helpers

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src/workflow/runtime-execution-contracts.ts`, `packages/divedra/src/workflow/engine/types-and-session-state.ts`, `packages/divedra/src/workflow/engine/mailbox-communication-artifacts.ts`, `packages/divedra/src/workflow/communication-service.ts`, `packages/divedra/src/workflow/manager-message-service/artifacts.ts`
**Excluded Files**: runtime DB schema migrations, `dist`
**Depends On**: none
**Completion Criteria**:
- [x] Centralize `nextCommunicationId`, initial delivery attempt id, and retry attempt id helpers.
- [x] Extract shared communication artifact persistence while preserving replay, routing scope, manager message id, and runtime DB event differences.
**Verification Commands**:
- `bun test packages/divedra/src/workflow/runtime-execution-contracts.test.ts packages/divedra/src/workflow/communication-service.test.ts packages/divedra/src/workflow/engine.test.ts packages/divedra/src/workflow/manager-message-service.test.ts`
- `bun run typecheck`
**Residual Risk**: Replay semantics are close to normal delivery but not identical.

### REF-012: Share Node Output Artifact Publication

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src/workflow/engine/step-result-finalization.ts`, `packages/divedra/src/workflow/engine/step-input.ts`, `packages/divedra/src/workflow/call-step-impl/direct-step-helpers.ts`, `packages/divedra/src/workflow/runtime-execution-contracts.ts`
**Excluded Files**: backend adapters, `dist`
**Depends On**: REF-011
**Completion Criteria**:
- [x] Share output file publication/runtime DB node execution persistence logic.
- [x] Preserve normal finalization, direct call-step, sleep, and optional skip metadata differences.
**Verification Commands**:
- `bun test packages/divedra/src/workflow/engine.test.ts packages/divedra/src/workflow/call-step.test.ts packages/divedra/src/workflow/call-step-impl-failures.test.ts`
- `bun test packages/divedra/src/workflow/runtime-execution-contracts.test.ts`
- `bun run typecheck`
**Residual Risk**: This is a high-touch runtime task; keep write scope small and test before/after output snapshots.

### REF-013: Extract Shared Official SDK Adapter Executor

**Status**: Completed
**Owned Files/Directories**: `packages/divedra-adapters/src/shared.ts`, `packages/divedra-adapters/src/openai-sdk.ts`, `packages/divedra-adapters/src/anthropic-sdk.ts`, `packages/divedra/src/workflow/adapters/openai-sdk.test.ts`, `packages/divedra/src/workflow/adapters/anthropic-sdk.test.ts`
**Excluded Files**: CLI agent adapters, root adapter contract files
**Depends On**: none
**Completion Criteria**:
- [x] Share request lifecycle/error wrapping where semantics match.
- [x] Keep provider-specific request body and output text extraction separate.
**Verification Commands**:
- `bun test packages/divedra/src/workflow/adapters/openai-sdk.test.ts packages/divedra/src/workflow/adapters/anthropic-sdk.test.ts`
- `bun run typecheck`
**Residual Risk**: Provider SDK response surfaces differ enough that over-generalization would hide useful type checks.

### REF-014: Extract Shared Watched CLI Agent Lifecycle

**Status**: Completed
**Owned Files/Directories**: `packages/divedra-adapters/src/local-agent.ts`, `packages/divedra-adapters/src/codex.ts`, `packages/divedra-adapters/src/claude.ts`, `packages/divedra-adapters/src/cursor.ts`, `packages/divedra/src/workflow/adapters/codex.test.ts`, `packages/divedra/src/workflow/adapters/claude.test.ts`, `packages/divedra/src/workflow/adapters/cursor.test.ts`
**Excluded Files**: official SDK adapters
**Depends On**: REF-013
**Completion Criteria**:
- [x] Share watched session lifecycle mechanics.
- [x] Preserve Codex event normalization, Claude runner error listener, and Cursor materialized session fallback differences.
**Verification Commands**:
- `bun test packages/divedra/src/workflow/adapters/codex.test.ts packages/divedra/src/workflow/adapters/claude.test.ts packages/divedra/src/workflow/adapters/cursor.test.ts`
- `bun run typecheck`
**Residual Risk**: Agent SDK mocks must remain dependency-owned.

### REF-015: Centralize Node Execution Backend Constants

**Status**: Completed
**Owned Files/Directories**: `packages/divedra-core/src/workflow-model.ts`, `packages/divedra/src/workflow/backend.ts`, `packages/divedra-core/src/workflow-validation.ts`, `packages/divedra/src/workflow/node-patches.ts`, `packages/divedra/src/workflow/validate/node-payload-validation.ts`, `packages/divedra-adapters/src/dispatch.ts`
**Excluded Files**: runtime readiness unless needed for compile updates
**Depends On**: REF-009, REF-013
**Owner Decision**: Approved to establish core-owned backend constants and normalization while preserving existing null-versus-undefined caller semantics through wrappers or compatibility helpers. Recorded in `design-docs/user-qa/qa-product-code-duplicate-scavenge-blockers.md#ref-015-backend-constants-normalization`.
**Completion Criteria**:
- [x] Establish core-owned backend constants and normalization.
- [x] Preserve null versus undefined caller semantics through wrappers.
- [x] Preserve validation issue shapes, adapter dispatch behavior, runtime readiness behavior, and public workflow model compatibility.
**Verification Commands**:
- `bun test packages/divedra/src/workflow/validate.test.ts packages/divedra/src/workflow/adapters/dispatch.test.ts packages/divedra/src/workflow/runtime-readiness-backends.test.ts packages/divedra/src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Public workflow validation issue shapes and null-versus-undefined compatibility must not drift while constants move into core.

### REF-016: Consolidate Workflow Execution Option Projection

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src/cli/input-output-helpers.ts`, `packages/divedra/src/cli/workflow-graphql-formatters.ts`, `packages/divedra/src/lib-workflow-run-options.ts`, `packages/divedra/src/index.ts`
**Excluded Files**: GraphQL schema/server transports
**Depends On**: none
**Completion Criteria**:
- [x] Share option normalization/projection with typed target adapters.
- [x] Preserve remote `workingDirectory` versus local `workflowWorkingDirectory` naming and nestedSuperviser/nestedSuperviserDriver differences.
**Verification Commands**:
- `bun test packages/divedra/src/cli.test.ts packages/divedra/src/lib-supervision.test.ts`
- `bun run typecheck`
**Residual Risk**: CLI defaulting and library config-controlled inclusion differ intentionally.

### REF-017: Share GraphQL Response Data Handling

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src/cli/input-output-helpers.ts`, `packages/divedra/src/index.ts`, `packages/divedra/src/graphql/client.ts`
**Excluded Files**: scoped GraphQL passthrough command output
**Depends On**: REF-016
**Completion Criteria**:
- [x] Share error aggregation and JSON object validation.
- [x] Preserve operation-specific field validators and raw passthrough behavior.
**Verification Commands**:
- `bun test packages/divedra/src/cli.test.ts packages/divedra/src/lib-api.test.ts packages/divedra/src/lib-supervision.test.ts`
- `bun run typecheck`
**Residual Risk**: Client and server trust boundaries remain intentionally separate.

### REF-018: Add Explicit GraphQL Session DTO Projection Mappers

**Status**: Completed
**Owned Files/Directories**: `packages/divedra-graphql/src/dto.ts`, `packages/divedra-graphql/src/control-plane-service.ts`, `packages/divedra/src/graphql/control-plane-service.ts`, `packages/divedra/src/graphql/schema/execution-resolvers.ts`, `packages/divedra/src/graphql/types.ts`
**Excluded Files**: public GraphQL SDL field names unless tests require internal mapper-only updates
**Depends On**: REF-011
**Completion Criteria**:
- [x] Replace structural double casts with named projection mapper functions.
- [x] Document persisted `WorkflowSessionState` versus public control-plane DTO boundaries.
- [x] Avoid data loss when saving sessions through package-owned service APIs.
**Verification Commands**:
- `bun test packages/divedra/src/graphql/schema.test.ts packages/divedra/src/server/graphql-queries-and-inspection.test.ts`
- `bun test packages/divedra/src/workflow/manager-control.test.ts packages/divedra/src/workflow/supervisor-graphql-client.test.ts`
- `bun test packages/divedra/src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Public API compatibility review may be needed before expanding package DTO fields.

### REF-019: Remove Root Source Tree After Package Migration

**Status**: Completed
**Owned Files/Directories**: `packages/divedra/src`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `biome.json`, `scripts/run-bun-tests.sh`, `scripts/check-source-filenames.ts`, `scripts/sync-package-declarations.ts`, `README.md`, `examples`, `.divedra/workflows`
**Excluded Files**: generated runtime artifacts, dependency-owned agent source trees, historical completed implementation plans
**Depends On**: REF-002, REF-004, REF-005, REF-006
**Completion Criteria**:
- [x] Root `src` directory is removed.
- [x] Former root runtime, event, hook, GraphQL, server, shared, workflow, and test sources live under `packages/divedra/src`.
- [x] CLI, library, test, typecheck, lint, declaration-sync, and build tooling no longer depends on root `src`.
- [x] Package-boundary tests assert the root source tree is absent and reject package-to-root source imports.
**Verification Commands**:
- `bun run typecheck`
- `bun test packages/divedra/src/package-boundaries.test.ts`
- `bun test scripts/check-source-filenames.test.ts`
- `bun test packages/divedra/src/workflow/addon-package-boundary.test.ts`
- `bun test packages/divedra/src/lib-api.test.ts packages/divedra/src/cli.test.ts`
- `bun run build`
- `bun run lint:biome` passed with existing explicit-`any` warnings in moved `packages/divedra/src/workflow/engine/*.ts` split files.
**Residual Risk**: Some historical plan and mock-scenario text fixtures may still describe pre-migration root source paths as example payload data; executable commands and current tooling now use package-local paths.

## Rejected Findings

- Root hook wrappers versus hook package modules: rejected as intentional compatibility re-exports, not duplicate implementations.
- Safe relative path validation across events: rejected as under-owned for this plan because path domains differ.
- External actor/conversation optional field normalization: accepted as low residual risk, too small for standalone churn.
- GraphQL JSON response and error envelope parsing across client/server/CLI: rejected for broad consolidation because trust boundaries differ.
- Browser overview HTML and CLI text overview: rejected as intentional presentation-surface split.
- Gateway read/write descriptor table unification: accepted as residual risk because payload keys, schema contracts, and CLI arguments intentionally differ.
- Provisioning package creation: rejected because no concrete provisioning source surface was identified.

## Exit Criteria

- [x] All Ready high/mid tasks are Completed, or explicitly moved to Blocked with owner, blocker, and residual risk.
- [x] Ready tasks REF-003 and REF-015 are completed or any newly discovered blocker is documented with owner and residual risk.
- [x] Accepted low residual risks remain documented above.
- [x] Focused verification commands pass for every completed task.
- [x] `bun run typecheck` passes after TypeScript source changes.
- [x] `git diff --check` passes before handoff.
- [x] No files are staged, committed, or pushed unless the user explicitly asks.

## Progress Log

### Session: 2026-05-19 Step 3 Merge Review Plan

**Tasks Completed**: Created this refactoring plan from concurrent slice-review outputs.

**Notes**: `REF-001` is the first implementation-ready task because it has narrow package ownership, explicit behavior to preserve, no cross-slice blocker, and focused verification.

### Session: 2026-05-19 13:25 JST Step 4 Implement Next Task

**Tasks Completed**: REF-001

**Verification**:
- `bun test packages/divedra/src/workflow/runtime-readiness-backends.test.ts packages/divedra/src/workflow/runtime-readiness-cross-workflow.test.ts` passed.
- `bun test packages/divedra/src/package-boundaries.test.ts` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.

**Notes**: `packages/divedra-addons/src/runtime-readiness.ts` now imports and re-exports the canonical gateway add-on name constants from `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts`, removing local add-on name construction while preserving existing string values and compatibility exports.

### Session: 2026-05-19 13:31 JST Step 4 Implement Next Task

**Tasks Completed**: REF-002

**Verification**:
- `bun test packages/divedra/src/workflow/addon-package-boundary.test.ts packages/divedra/src/package-boundaries.test.ts` passed.
- `bun test packages/divedra/src/workflow/validate.test.ts` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.
- `bun run lint:biome` completed successfully with pre-existing warnings in `packages/divedra/src/workflow/engine/*.ts`.

**Notes**: `packages/divedra/src/workflow/addon-package-boundary.ts` now delegates boundary third-party add-on definition registry construction to package-owned registry helpers. `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts` exposes narrow registry message options so the root compatibility boundary can preserve its sync async-validate wording while sharing selection and validate-result attachment mechanics.

### Session: 2026-05-19 13:42 JST Step 4 Implement Next Task

**Tasks Completed**: REF-004

**Verification**:
- `bun test packages/divedra/src/events/supervisor-llm-resolver-dispatch.test.ts packages/divedra/src/events/supervisor-llm-intent.test.ts packages/divedra/src/events/supervisor-llm-batch.test.ts` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.
- `bun run lint:biome` completed successfully with pre-existing warnings in `packages/divedra/src/workflow/engine/*.ts`.

**Notes**: `packages/divedra/src/events/supervisor-llm-resolver.ts` now uses a shared helper for resolver workflow execution, session reload, succeeded resolver-node lookup, and output artifact reading. JSON parsing and payload unwrapping are centralized, while chat-command and dispatch resolver invalid-output policies remain separate.

### Session: 2026-05-19 13:47 JST Step 4 Implement Next Task

**Tasks Completed**: REF-005

**Verification**:
- `bun test packages/divedra/src/events/input-mapping.test.ts packages/divedra/src/events/supervisor-intent.test.ts packages/divedra/src/events/supervisor-llm-intent.test.ts` passed.
- `bun test packages/divedra/src/events/config.test.ts` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.
- `bun run lint:biome` completed successfully with pre-existing warnings in `packages/divedra/src/workflow/engine/*.ts`.

**Notes**: `packages/divedra/src/events/path-resolution.ts` now owns dotted-path lookup, explicit root allowlists, exact-reference template preservation, string rendering, primitive text coercion, and named template rendering. Input mapping, supervised correlation, supervisor intent extraction, LLM resolver input extraction, and task planning now call that helper while keeping their existing allowed roots and string handling policies.

### Session: 2026-05-19 14:02 JST Step 4 Implement Next Task

**Tasks Completed**: REF-006

**Verification**:
- `bun test packages/divedra/src/events/reply-dispatcher.test.ts packages/divedra/src/events/adapters/webhook.test.ts packages/divedra/src/events/adapters/matrix.test.ts packages/divedra/src/events/adapters/chat-sdk.test.ts` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.
- `bun run lint:biome` completed successfully with pre-existing warnings in `packages/divedra/src/workflow/engine/*.ts`.

**Notes**: `packages/divedra/src/events/adapters/chat-reply-response.ts` now centralizes optional reply response JSON parsing, HTTP `202` queued status mapping, and dispatch/provider message id extraction. Chat SDK and webhook reply dispatch keep the generic `providerMessageId`/`messageId`/`id` fallback order, while Matrix explicitly maps only `event_id`.

### Session: 2026-05-19 Package Source Tree Cutover

**Tasks Completed**: REF-019

**Verification**:
- `bun run typecheck` passed.
- `bun test packages/divedra/src/package-boundaries.test.ts` passed.
- `bun test scripts/check-source-filenames.test.ts` passed.
- `bun test packages/divedra/src/workflow/addon-package-boundary.test.ts` passed.
- `bun test packages/divedra/src/lib-api.test.ts packages/divedra/src/cli.test.ts` passed.
- `bun run build` passed.
- `bun run lint:biome` passed with existing explicit-`any` warnings in moved `packages/divedra/src/workflow/engine/*.ts` split files.
- `bun run packages/divedra/src/bin.ts workflow validate refactoring-divide-and-conquer --workflow-definition-dir .divedra/workflows --output json` passed.
- `bun run packages/divedra/src/bin.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows --output json` passed.

**Notes**: Removed the root `src` tree by moving the remaining root-owned source and test files into `packages/divedra/src`. Tooling now discovers, typechecks, formats, builds, and tests package-local sources. `packages/divedra/src/lib.ts` remains as a package-local compatibility facade for internal imports that previously targeted the removed root library file.

### Session: 2026-05-19 Step 6 Root Source Cutover Hardening

**Tasks Completed**: REF-019 follow-up verification and fixture hardening.

**Verification**:
- `test ! -d src` passed.
- `bun run typecheck` passed.
- `bun test scripts/check-source-filenames.test.ts packages/divedra/src/package-boundaries.test.ts` passed.
- `bun test packages/divedra/src/workflow/addon-package-boundary.test.ts packages/divedra/src/lib-api.test.ts packages/divedra/src/cli.test.ts` passed.
- `bun run lint:biome` passed with existing explicit-`any` warnings in moved `packages/divedra/src/workflow/engine/*.ts` split files.
- `bun run build` passed.
- `bun run test` passed.
- `task test` passed.
- `task build` passed.
- `bun run packages/divedra/src/bin.ts workflow validate refactoring-divide-and-conquer --workflow-definition-dir .divedra/workflows --output json` passed.
- `bun run packages/divedra/src/bin.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows --output json` passed.
- `bun run packages/divedra/src/bin.ts workflow list --workflow-definition-dir ./examples --output json` passed.
- `git diff --check` passed.

**Notes**: Follow-up review found stale live entrypoints in `flake.nix` and `.divedra/README.md`, plus first-party root-source references in deterministic workflow/example fixtures. Those now point at package-local paths. Source filename lint now also fails when the removed root source tree is recreated. Nix-specific verification is blocked in this sandbox by inaccessible Nix cache/daemon sockets; local Bun and Taskfile equivalents passed.

### Session: 2026-05-19 Step 4 Implementation Plan Revision

**Tasks Completed**: Planning revision only; no TypeScript implementation.

**Verification**:
- `git diff --check -- impl-plans/active/refactoring-duplicate-scavenge-product-code.md` passed.

**Notes**: Added accepted design references, Codex-reference decision, remaining-work order, and explicit blocker links for `REF-003` and `REF-015` after Step 3 accepted the design update.

### Session: 2026-05-19 23:08 JST Step 6 Implement

**Tasks Completed**: REF-007, REF-009, REF-013, REF-016, REF-017

**Tasks In Progress**: REF-008, REF-011

**Verification**:
- `bun test packages/divedra/src/hook/index.test.ts packages/divedra/src/events/receipt-ops.test.ts packages/divedra/src/events/trigger-runner-supervised.test.ts packages/divedra/src/package-boundaries.test.ts` passed.
- `bun test packages/divedra/src/workflow/validate.test.ts packages/divedra/src/workflow/checkout/checkout.test.ts packages/divedra/src/workflow/paths.test.ts packages/divedra/src/workflow/overview.test.ts packages/divedra/src/graphql/schema.test.ts packages/divedra/src/cli.test.ts` passed.
- `bun test packages/divedra/src/workflow/adapters/openai-sdk.test.ts packages/divedra/src/workflow/adapters/anthropic-sdk.test.ts packages/divedra/src/cli.test.ts packages/divedra/src/lib-supervision.test.ts packages/divedra/src/lib-api.test.ts` passed on serial rerun; an earlier parallel run hit a shared temp cleanup race in `cli.test.ts`.
- `bun test packages/divedra/src/workflow/runtime-execution-contracts.test.ts packages/divedra/src/workflow/communication-service.test.ts packages/divedra/src/workflow/engine.test.ts packages/divedra/src/workflow/manager-message-service.test.ts` passed.
- `bun run typecheck` passed.
- `bun run lint:biome` passed with existing explicit-`any` warnings in moved `packages/divedra/src/workflow/engine/*.ts` split files.

**Notes**: Added shared artifact helpers for path segment sanitization and JSON SHA-256 hashing. Exported core-owned validation primitive helpers while preserving root-only working-directory and non-negative integer validation. Added shared official SDK request execution and GraphQL response helpers while keeping provider and operation-specific extraction separate. Added shared local/remote workflow execution option projection helpers. Centralized communication and delivery attempt id helpers in runtime execution contracts. `REF-008` remains in progress because status parser consolidation is not complete; `REF-011` remains in progress because shared communication artifact persistence has not yet been extracted.

### Session: 2026-05-19 23:23 JST Step 6 Self-Review Revision

**Tasks Completed**: REF-008, REF-010, REF-011, REF-012, REF-014, REF-018

**Verification**:
- `bun test packages/divedra/src/workflow/runtime-execution-contracts.test.ts packages/divedra/src/workflow/communication-service.test.ts packages/divedra/src/workflow/engine.test.ts packages/divedra/src/workflow/manager-message-service.test.ts` passed.
- `bun test packages/divedra/src/workflow/validate.test.ts packages/divedra/src/workflow/checkout/checkout.test.ts packages/divedra/src/workflow/paths.test.ts packages/divedra/src/workflow/overview.test.ts packages/divedra/src/graphql/schema.test.ts packages/divedra/src/cli.test.ts packages/divedra/src/package-boundaries.test.ts` passed.
- `bun test packages/divedra/src/workflow/adapters/openai-sdk.test.ts packages/divedra/src/workflow/adapters/anthropic-sdk.test.ts packages/divedra/src/workflow/adapters/codex.test.ts packages/divedra/src/workflow/adapters/claude.test.ts packages/divedra/src/workflow/adapters/cursor.test.ts` passed.
- `bun test packages/divedra/src/workflow/call-step.test.ts packages/divedra/src/workflow/call-step-impl-failures.test.ts` passed.
- `bun test packages/divedra/src/server/graphql-queries-and-inspection.test.ts packages/divedra/src/workflow/manager-control.test.ts packages/divedra/src/workflow/supervisor-graphql-client.test.ts` passed.
- `bun run format` passed and formatted one changed file.
- `bun run typecheck` passed.
- `bun run lint:biome` passed with existing explicit-`any` warnings in moved `packages/divedra/src/workflow/engine/*.ts` split files.
- `git diff --check` passed.

**Notes**: Completed the self-review finding that all unblocked Ready/In Progress tasks must be finished before independent review. Shared workflow overview status parsing, step-addressed non-add-on payload registration, communication artifact persistence across normal delivery/manager messages/manual replay, node output publication, watched local-agent lifecycle, and GraphQL control-plane session DTO projection mappers. `REF-003` and `REF-015` remain documented blocker residual risks in `design-docs/user-qa/qa-product-code-duplicate-scavenge-blockers.md`.

### Session: 2026-05-19 Step 4 Implementation Plan Reconciliation

**Tasks Completed**: Planning reconciliation only; no TypeScript implementation.

**Verification**:
- `git diff --check -- impl-plans/active/refactoring-duplicate-scavenge-product-code.md impl-plans/PROGRESS.json impl-plans/README.md` passed.

**Notes**: Reconciled the accepted Step 3 design decision with the active plan. The plan header now remains `In Progress` because `REF-003` and `REF-015` are blocked pending owner decisions, while all other unblocked tasks are recorded as completed in the task DAG and `impl-plans/PROGRESS.json`. The completion request does not infer approval for a new add-ons public export or core-owned backend normalization.

### Session: 2026-05-19 Step 6 Implementation Blocker Recheck

**Tasks Completed**: No additional implementation; all unblocked tasks remain completed.

**Tasks Blocked**: REF-003, REF-015

**Verification**:
- `git diff --check` passed.

**Notes**: Rechecked the Step 5 accepted plan against the accepted design boundary. No owner decision was present in the workflow input to approve the `packages/divedra-addons/src/index.ts` runner predicate export, approve core-owned backend normalization, or accept either blocked task as residual risk. `REF-003` and `REF-015` therefore remain blocked and no TypeScript files were modified in this implementation step.

### Session: 2026-05-20 Step 4 Implementation Plan Update

**Tasks Completed**: Planning update only; no TypeScript implementation.

**Tasks Ready**: REF-003, REF-015

**Verification**:
- `git diff --check -- impl-plans/active/refactoring-duplicate-scavenge-product-code.md impl-plans/PROGRESS.json` passed.

**Notes**: Updated the plan after Step 3 accepted the design update and the workflow input supplied explicit owner decisions. `REF-003` is now Ready to expose the narrowest package-owned Docker-compatible runner predicate surface needed for root runtime readiness. `REF-015` is now Ready to establish core-owned backend constants and normalization while preserving null-versus-undefined caller semantics through wrappers or compatibility helpers. Later implementation should run the focused task verification commands plus `bun run typecheck` and `git diff --check`.

### Session: 2026-05-20 Step 6 Implement

**Tasks Completed**: REF-003, REF-015

**Verification**:
- `bun test packages/divedra/src/workflow/runtime-readiness-backends.test.ts packages/divedra/src/workflow/native-node-executor-gateway.test.ts` passed.
- `bun test packages/divedra/src/workflow/validate.test.ts packages/divedra/src/workflow/adapters/dispatch.test.ts packages/divedra/src/workflow/runtime-readiness-backends.test.ts packages/divedra/src/package-boundaries.test.ts` passed.
- `bun run typecheck` passed.
- `bun run lint:biome` passed with existing explicit-`any` warnings in moved `packages/divedra/src/workflow/engine/*.ts` split files.
- `git diff --check` passed.

**Notes**: Completed the owner-approved unblocked tasks. `REF-003` now reuses the add-ons-owned Docker-compatible runner predicate through the package top-level export while keeping readiness reporting separate from native executor policy errors. `REF-015` now owns backend constants and normalization in `packages/divedra-core/src/workflow-model.ts`, with root wrappers preserving existing null-return compatibility and core validation preserving undefined semantics.
