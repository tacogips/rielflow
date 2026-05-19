# Product Code Duplicate-Scavenge Refactoring Plan

**Status**: In Progress
**Design Reference**: Workflow output from `refactoring-divide-and-conquer` step `step3-merge-review-plan`
**Created**: 2026-05-19
**Last Updated**: 2026-05-19

## Scope

Improve product-code quality by consolidating duplicated TypeScript implementations under `packages/` and `src/`.

This plan preserves public behavior and public APIs unless a task explicitly authorizes a behavior-preserving contract cleanup. Root `src` entrypoints remain compatibility surfaces until package entrypoints, tests, build output, CLI smoke checks, and library API compatibility pass.

Excluded: `.divedra`, `.agents`, `design-docs`, generated `dist`, `node_modules`, prompt cleanup, staging, commits, pushes, and any provisioning package because no concrete provisioning source surface was identified.

## Duplicate Groups

| Group | Repeated Concept | Owner Paths | Counterpart Paths | Consolidation Target | Confidence |
| --- | --- | --- | --- | --- | --- |
| DUP-001 | Built-in gateway add-on name constants | `packages/divedra-addons/src/runtime-readiness.ts` | `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts` | Reuse package-owned add-on constants | High |
| DUP-002 | Third-party node add-on definition selection and validate result attachment | `src/workflow/addon-package-boundary.ts` | `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts` | Delegate boundary registry creation to add-ons package logic | High |
| DUP-003 | Docker-compatible container runner allowlist | `packages/divedra-addons/src/native-node-executor/template-env-and-containers.ts` | `src/workflow/runtime-readiness.ts` | Package-owned runner predicate | Medium |
| DUP-004 | Resolver workflow execution and output artifact extraction | `src/events/supervisor-llm-resolver.ts` | same file resolver branches | Events-owned helper for resolver execution/output payload extraction | High |
| DUP-005 | Event/source/binding/workflowInput dotted path resolution and template rendering | `src/events/input-mapping.ts` | `src/events/supervisor-correlation.ts`, `src/events/supervisor-intent.ts`, `src/events/supervisor-llm-resolver.ts`, `src/events/task-planning.ts` | Events-owned path/template resolution helper | High |
| DUP-006 | Chat reply HTTP response parsing and dispatch result normalization | `src/events/adapters/chat-sdk/reply.ts` | `src/events/adapters/webhook.ts`, `src/events/adapters/matrix.ts` | Shared events adapter response helper | Medium |
| DUP-007 | Artifact-safe path segment normalization | `src/hook/recorder.ts` | `src/events/ledger.ts`, `src/events/supervised-runs.ts` | Shared artifact path segment sanitizer with fallback parameter | High |
| DUP-008 | JSON value SHA-256 hashing | `src/hook/recorder.ts` | `src/events/adapters/chat-sdk/normalization.ts` | Shared JSON SHA-256 helper preserving `sha256(JSON.stringify(value))` | Medium |
| DUP-009 | Workflow scope root, home expansion, configured root, and project discovery logic | `src/workflow/checkout/registry.ts` | `src/workflow/catalog.ts`, `packages/divedra-core/src/paths.ts`, `packages/divedra/src/cli/storage-and-options.ts` | Package/root workflow scope path resolver with wrapper-specific policy | High |
| DUP-010 | Validation issue and primitive field normalization helpers | `src/workflow/validate/validation-types-and-runtime-options.ts` | `packages/divedra-core/src/workflow-validation.ts` | Core validation primitive module plus root-only validators | Medium |
| DUP-011 | Sync/async step-addressed node payload building with add-on resolution | `src/workflow/validate/bundle-validation-entrypoints.ts` | same file sync/async entrypoints | Shared builder helper parameterized by add-on resolver and iteration mode | Medium |
| DUP-012 | Communication delivery artifact and record construction | `src/workflow/manager-message-service/artifacts.ts` | `src/workflow/engine/mailbox-communication-artifacts.ts`, `src/workflow/communication-service.ts` | Shared workflow communication artifact persistence helper | High |
| DUP-013 | Node output artifact publication and runtime DB node execution persistence | `src/workflow/engine/step-result-finalization.ts` | `src/workflow/call-step-impl/direct-step-helpers.ts`, `src/workflow/engine/step-input.ts` | Shared output publication helper | High |
| DUP-014 | Runtime communication id and delivery attempt id normalization | `src/workflow/communication-service.ts` | `src/workflow/manager-message-service/artifacts.ts`, `src/workflow/engine/types-and-session-state.ts`, `src/workflow/runtime-execution-contracts.ts` | Runtime execution contracts id helpers | Medium |
| DUP-015 | Official SDK request execution and output normalization | `packages/divedra-adapters/src/openai-sdk.ts` | `packages/divedra-adapters/src/anthropic-sdk.ts`, `packages/divedra-adapters/src/shared.ts` | Shared native SDK executor helper preserving provider-specific extraction | High |
| DUP-016 | CLI agent local session lifecycle execution | `packages/divedra-adapters/src/codex.ts` | `packages/divedra-adapters/src/claude.ts`, `packages/divedra-adapters/src/cursor.ts`, `packages/divedra-adapters/src/local-agent.ts` | Shared watched local-agent lifecycle helper | Medium |
| DUP-017 | Node execution backend enum, normalization, and display list | `src/workflow/backend.ts` | `packages/divedra-core/src/workflow-model.ts`, `packages/divedra-core/src/workflow-validation.ts`, `packages/divedra-adapters/src/dispatch.ts`, `src/workflow/node-patches.ts`, `src/workflow/validate/node-payload-validation.ts` | Core-owned backend constants and normalization | High |
| DUP-018 | Workflow execution option normalization and projection | `packages/divedra/src/cli/input-output-helpers.ts` | `packages/divedra/src/cli/workflow-graphql-formatters.ts`, `packages/divedra/src/lib-workflow-run-options.ts`, `packages/divedra/src/index.ts` | Package-owned execution-options projector | High |
| DUP-019 | GraphQL response error aggregation and data-object validation | `packages/divedra/src/index.ts` | `packages/divedra/src/cli/input-output-helpers.ts`, `src/graphql/client.ts` | Shared GraphQL data/error helper with operation-specific validators retained | Medium |
| DUP-020 | Workflow session state DTO definition and conversion | `packages/divedra-graphql/src/dto.ts` | `src/workflow/session.ts`, `src/graphql/control-plane-service.ts`, `src/graphql/schema/execution-resolvers.ts`, `src/graphql/types.ts` | Explicit root GraphQL projection mappers | High |
| DUP-021 | Workflow scope/status parsing and validation allowlists | `src/server/graphql-executable-schema.ts` | `src/workflow/overview.ts`, `src/workflow/catalog.ts`, `packages/divedra/src/cli/storage-and-options.ts` | Shared typed parser utilities preserving caller error wording | High |

## Task DAG

| Task | Status | Duplicate Groups | Depends On | Parallelizable |
| --- | --- | --- | --- | --- |
| REF-001 | Completed | DUP-001 | - | Yes |
| REF-002 | Completed | DUP-002 | REF-001 | No |
| REF-003 | Blocked | DUP-003 | REF-001 | No |
| REF-004 | Completed | DUP-004 | - | Yes |
| REF-005 | Completed | DUP-005 | REF-004 | No |
| REF-006 | Completed | DUP-006 | - | Yes |
| REF-007 | Ready | DUP-007, DUP-008 | - | Yes |
| REF-008 | Ready | DUP-009, DUP-021 | - | No |
| REF-009 | Ready | DUP-010 | - | Yes |
| REF-010 | Ready | DUP-011 | REF-002, REF-009 | No |
| REF-011 | Ready | DUP-012, DUP-014 | - | No |
| REF-012 | Ready | DUP-013 | REF-011 | No |
| REF-013 | Ready | DUP-015 | - | Yes |
| REF-014 | Ready | DUP-016 | REF-013 | No |
| REF-015 | Blocked | DUP-017 | REF-009, REF-013 | No |
| REF-016 | Ready | DUP-018 | - | Yes |
| REF-017 | Ready | DUP-019 | REF-016 | No |
| REF-018 | Ready | DUP-020 | REF-011 | No |

### REF-001: Reuse Canonical Gateway Add-On Constants in Readiness Detection

**Status**: Completed
**Owned Files/Directories**: `packages/divedra-addons/src/runtime-readiness.ts`, `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts`
**Excluded Files**: `src/workflow/runtime-readiness.ts`, `dist`, `packages/divedra-addons/dist`, `node_modules`
**Depends On**: none
**Completion Criteria**:
- [x] Remove local gateway add-on name construction where canonical constants already exist.
- [x] Preserve current gateway read/write add-on string values.
- [x] Keep package boundary tests passing.
**Verification Commands**:
- `bun test src/workflow/runtime-readiness-backends.test.ts src/workflow/runtime-readiness-cross-workflow.test.ts`
- `bun test src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Constants remain package-owned; downstream runtime readiness still has separate behavior-specific reporting.

### REF-002: Consolidate Boundary Add-On Registry Helpers Behind Package-Owned Logic

**Status**: Completed
**Owned Files/Directories**: `src/workflow/addon-package-boundary.ts`, `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts`
**Excluded Files**: `src/workflow/node-addons/**`, `src/workflow/native-node-executor/**`, `dist`
**Depends On**: REF-001
**Completion Criteria**:
- [x] Delegate boundary registry creation to package-owned registry helpers or extract package-owned validate attachment helper.
- [x] Preserve sync and async validation error wording differences where tests require them.
- [x] Preserve root compatibility entrypoints.
**Verification Commands**:
- `bun test src/workflow/addon-package-boundary.test.ts src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Boundary-specific error text must be checked carefully because package helper wording currently differs.

### REF-003: Share Docker-Compatible Runner Predicate

**Status**: Blocked
**Owned Files/Directories**: `packages/divedra-addons/src/native-node-executor/template-env-and-containers.ts`, `packages/divedra-addons/src/index.ts`, `src/workflow/runtime-readiness.ts`
**Excluded Files**: `src/workflow/native-node-executor/**`, `dist`
**Depends On**: REF-001
**Blocker**: Confirm whether exporting a runner predicate from `packages/divedra-addons/src/index.ts` is an acceptable public package surface.
**Completion Criteria**:
- [ ] Use one predicate for `podman`, `docker`, and `nerdctl`.
- [ ] Preserve readiness reporting versus runtime policy error semantics.
**Verification Commands**:
- `bun test src/workflow/runtime-readiness-backends.test.ts src/workflow/native-node-executor-gateway.test.ts`
- `bun run typecheck`
**Residual Risk**: Public export surface may need a narrower internal package path instead of top-level export.

### REF-004: Consolidate Supervisor Resolver Output Artifact Extraction

**Status**: Completed
**Owned Files/Directories**: `src/events/supervisor-llm-resolver.ts`, `src/events/supervisor-llm-resolver-dispatch.test.ts`, `src/events/supervisor-llm-intent.test.ts`
**Excluded Files**: `packages/divedra-events/dist`, `dist`
**Depends On**: none
**Completion Criteria**:
- [x] Extract shared resolver workflow run/session reload/resolver-node/output payload read mechanics.
- [x] Keep chat resolver and dispatch resolver invalid-output policies separate.
- [x] Preserve current error mapping.
**Verification Commands**:
- `bun test src/events/supervisor-llm-resolver-dispatch.test.ts src/events/supervisor-llm-intent.test.ts src/events/supervisor-llm-batch.test.ts`
- `bun run typecheck`
**Residual Risk**: Existing tests may not cover every malformed resolver artifact shape.

### REF-005: Centralize Event Dotted-Path and Template Resolution Semantics

**Status**: Completed
**Owned Files/Directories**: `src/events/path-resolution.ts`, `src/events/input-mapping.ts`, `src/events/supervisor-correlation.ts`, `src/events/supervisor-intent.ts`, `src/events/supervisor-llm-resolver.ts`, `src/events/task-planning.ts`
**Excluded Files**: `packages/divedra-events/src/runtime-ports.ts`, `dist`
**Depends On**: REF-004
**Completion Criteria**:
- [x] Add explicit root policy, exact-value versus string-render modes, and primitive coercion options.
- [x] Preserve current root allowances for input mapping, correlation, intent extraction, resolver input extraction, and task planning.
**Verification Commands**:
- `bun test src/events/input-mapping.test.ts src/events/supervisor-intent.test.ts src/events/supervisor-llm-intent.test.ts`
- `bun run typecheck`
**Residual Risk**: Some correlation behavior may need additional focused tests if no existing test covers it.

### REF-006: Share Chat Reply HTTP Response Parsing Across Adapters

**Status**: Completed
**Owned Files/Directories**: `src/events/adapters/chat-reply-response.ts`, `src/events/adapters/chat-sdk/reply.ts`, `src/events/adapters/webhook.ts`, `src/events/adapters/matrix.ts`
**Excluded Files**: `src/events/reply-dispatcher.ts` unless tests require call-site type updates
**Depends On**: none
**Completion Criteria**:
- [x] Centralize safe optional JSON parsing and `202` queued mapping.
- [x] Preserve provider-specific message id keys, including Matrix `event_id`.
**Verification Commands**:
- `bun test src/events/reply-dispatcher.test.ts src/events/adapters/webhook.test.ts src/events/adapters/matrix.test.ts src/events/adapters/chat-sdk.test.ts`
- `bun run typecheck`
**Residual Risk**: Provider-specific metadata should not be over-normalized.

### REF-007: Share Artifact Segment Sanitizer and JSON Hash Helper

**Status**: Ready
**Owned Files/Directories**: `src/shared`, `src/hook/recorder.ts`, `src/events/ledger.ts`, `src/events/supervised-runs.ts`, `src/events/adapters/chat-sdk/normalization.ts`
**Excluded Files**: `packages/divedra-hook/src/redaction.ts`, `src/events/adapters/webhook.ts`
**Depends On**: none
**Completion Criteria**:
- [ ] Preserve current sanitize regex, 96-character truncation, and per-domain fallback labels.
- [ ] Preserve exact `sha256(JSON.stringify(value))` behavior.
**Verification Commands**:
- `bun test src/hook/index.test.ts`
- `bun test src/events/receipt-ops.test.ts src/events/trigger-runner-supervised.test.ts`
- `bun test src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Hash helper must not imply canonical JSON ordering.

### REF-008: Consolidate Workflow Scope Root and Scope/Status Parser Utilities

**Status**: Ready
**Owned Files/Directories**: `packages/divedra-core/src/paths.ts`, `src/workflow/catalog.ts`, `src/workflow/checkout/registry.ts`, `src/workflow/overview.ts`, `src/server/graphql-executable-schema.ts`, `packages/divedra/src/cli/storage-and-options.ts`
**Excluded Files**: public GraphQL SDL, workflow bundle files, `dist`
**Depends On**: none
**Completion Criteria**:
- [ ] Centralize shared path/scope/status allowlists while preserving caller-specific error envelopes and empty-value behavior.
- [ ] Preserve checkout direct-root policy and catalog project discovery behavior.
**Verification Commands**:
- `bun test src/workflow/checkout/checkout.test.ts src/workflow/paths.test.ts src/workflow/overview.test.ts`
- `bun test src/graphql/schema.test.ts src/cli.test.ts`
- `bun test src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: This task crosses CLI, GraphQL, and workflow ownership; implement with narrow helper functions rather than broad module moves.

### REF-009: Share Validation Primitive Helpers

**Status**: Ready
**Owned Files/Directories**: `packages/divedra-core/src/workflow-validation.ts`, `src/workflow/validate/validation-types-and-runtime-options.ts`, `src/workflow/validate.test.ts`
**Excluded Files**: `src/workflow/validate/bundle-validation-entrypoints.ts`, `dist`
**Depends On**: none
**Completion Criteria**:
- [ ] Move only shared primitive checks into core-owned helpers.
- [ ] Preserve root-only non-negative integer and working-directory helpers.
- [ ] Preserve safe-integer versus integer differences unless explicitly reconciled by tests.
**Verification Commands**:
- `bun test src/workflow/validate.test.ts`
- `bun test src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Validation issue wording and numeric edge cases are compatibility-sensitive.

### REF-010: Reduce Step-Addressed Payload Builder Duplication

**Status**: Ready
**Owned Files/Directories**: `src/workflow/validate/bundle-validation-entrypoints.ts`, `src/workflow/validate.test.ts`
**Excluded Files**: add-on package internals unless REF-002 requires a small type export
**Depends On**: REF-002, REF-009
**Completion Criteria**:
- [ ] Share non-add-on payload registration and step prompt variant application.
- [ ] Keep sync and async add-on resolver mechanics explicit.
**Verification Commands**:
- `bun test src/workflow/validate.test.ts`
- `bun run typecheck`
**Residual Risk**: Sync/async entrypoints must keep identical observable ordering.

### REF-011: Consolidate Communication Artifact and Delivery ID Helpers

**Status**: Ready
**Owned Files/Directories**: `src/workflow/runtime-execution-contracts.ts`, `src/workflow/engine/types-and-session-state.ts`, `src/workflow/engine/mailbox-communication-artifacts.ts`, `src/workflow/communication-service.ts`, `src/workflow/manager-message-service/artifacts.ts`
**Excluded Files**: runtime DB schema migrations, `dist`
**Depends On**: none
**Completion Criteria**:
- [ ] Centralize `nextCommunicationId`, initial delivery attempt id, and retry attempt id helpers.
- [ ] Extract shared communication artifact persistence while preserving replay, routing scope, manager message id, and runtime DB event differences.
**Verification Commands**:
- `bun test src/workflow/runtime-execution-contracts.test.ts src/workflow/communication-service.test.ts src/workflow/engine.test.ts src/workflow/manager-message-service.test.ts`
- `bun run typecheck`
**Residual Risk**: Replay semantics are close to normal delivery but not identical.

### REF-012: Share Node Output Artifact Publication

**Status**: Ready
**Owned Files/Directories**: `src/workflow/engine/step-result-finalization.ts`, `src/workflow/engine/step-input.ts`, `src/workflow/call-step-impl/direct-step-helpers.ts`, `src/workflow/runtime-execution-contracts.ts`
**Excluded Files**: backend adapters, `dist`
**Depends On**: REF-011
**Completion Criteria**:
- [ ] Share output file publication/runtime DB node execution persistence logic.
- [ ] Preserve normal finalization, direct call-step, sleep, and optional skip metadata differences.
**Verification Commands**:
- `bun test src/workflow/engine.test.ts src/workflow/call-step.test.ts src/workflow/call-step-impl-failures.test.ts`
- `bun test src/workflow/runtime-execution-contracts.test.ts`
- `bun run typecheck`
**Residual Risk**: This is a high-touch runtime task; keep write scope small and test before/after output snapshots.

### REF-013: Extract Shared Official SDK Adapter Executor

**Status**: Ready
**Owned Files/Directories**: `packages/divedra-adapters/src/shared.ts`, `packages/divedra-adapters/src/openai-sdk.ts`, `packages/divedra-adapters/src/anthropic-sdk.ts`, `src/workflow/adapters/openai-sdk.test.ts`, `src/workflow/adapters/anthropic-sdk.test.ts`
**Excluded Files**: CLI agent adapters, root adapter contract files
**Depends On**: none
**Completion Criteria**:
- [ ] Share request lifecycle/error wrapping where semantics match.
- [ ] Keep provider-specific request body and output text extraction separate.
**Verification Commands**:
- `bun test src/workflow/adapters/openai-sdk.test.ts src/workflow/adapters/anthropic-sdk.test.ts`
- `bun run typecheck`
**Residual Risk**: Provider SDK response surfaces differ enough that over-generalization would hide useful type checks.

### REF-014: Extract Shared Watched CLI Agent Lifecycle

**Status**: Ready
**Owned Files/Directories**: `packages/divedra-adapters/src/local-agent.ts`, `packages/divedra-adapters/src/codex.ts`, `packages/divedra-adapters/src/claude.ts`, `packages/divedra-adapters/src/cursor.ts`, `src/workflow/adapters/codex.test.ts`, `src/workflow/adapters/claude.test.ts`, `src/workflow/adapters/cursor.test.ts`
**Excluded Files**: official SDK adapters
**Depends On**: REF-013
**Completion Criteria**:
- [ ] Share watched session lifecycle mechanics.
- [ ] Preserve Codex event normalization, Claude runner error listener, and Cursor materialized session fallback differences.
**Verification Commands**:
- `bun test src/workflow/adapters/codex.test.ts src/workflow/adapters/claude.test.ts src/workflow/adapters/cursor.test.ts`
- `bun run typecheck`
**Residual Risk**: Agent SDK mocks must remain dependency-owned.

### REF-015: Centralize Node Execution Backend Constants

**Status**: Blocked
**Owned Files/Directories**: `packages/divedra-core/src/workflow-model.ts`, `src/workflow/backend.ts`, `packages/divedra-core/src/workflow-validation.ts`, `src/workflow/node-patches.ts`, `src/workflow/validate/node-payload-validation.ts`, `packages/divedra-adapters/src/dispatch.ts`
**Excluded Files**: runtime readiness unless needed for compile updates
**Depends On**: REF-009, REF-013
**Blocker**: Coordinate validation, adapter dispatch, and runtime-readiness owners before changing backend constants because this is a public workflow model surface.
**Completion Criteria**:
- [ ] Establish core-owned backend constants and normalization.
- [ ] Preserve null versus undefined caller semantics through wrappers.
**Verification Commands**:
- `bun test src/workflow/validate.test.ts src/workflow/adapters/dispatch.test.ts src/workflow/runtime-readiness-backends.test.ts src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Public workflow validation issue shapes must not drift.

### REF-016: Consolidate Workflow Execution Option Projection

**Status**: Ready
**Owned Files/Directories**: `packages/divedra/src/cli/input-output-helpers.ts`, `packages/divedra/src/cli/workflow-graphql-formatters.ts`, `packages/divedra/src/lib-workflow-run-options.ts`, `packages/divedra/src/index.ts`
**Excluded Files**: GraphQL schema/server transports
**Depends On**: none
**Completion Criteria**:
- [ ] Share option normalization/projection with typed target adapters.
- [ ] Preserve remote `workingDirectory` versus local `workflowWorkingDirectory` naming and nestedSuperviser/nestedSuperviserDriver differences.
**Verification Commands**:
- `bun test src/cli.test.ts src/lib-supervision.test.ts`
- `bun run typecheck`
**Residual Risk**: CLI defaulting and library config-controlled inclusion differ intentionally.

### REF-017: Share GraphQL Response Data Handling

**Status**: Ready
**Owned Files/Directories**: `packages/divedra/src/cli/input-output-helpers.ts`, `packages/divedra/src/index.ts`, `src/graphql/client.ts`
**Excluded Files**: scoped GraphQL passthrough command output
**Depends On**: REF-016
**Completion Criteria**:
- [ ] Share error aggregation and JSON object validation.
- [ ] Preserve operation-specific field validators and raw passthrough behavior.
**Verification Commands**:
- `bun test src/cli.test.ts src/lib-api.test.ts src/lib-supervision.test.ts`
- `bun run typecheck`
**Residual Risk**: Client and server trust boundaries remain intentionally separate.

### REF-018: Add Explicit GraphQL Session DTO Projection Mappers

**Status**: Ready
**Owned Files/Directories**: `packages/divedra-graphql/src/dto.ts`, `packages/divedra-graphql/src/control-plane-service.ts`, `src/graphql/control-plane-service.ts`, `src/graphql/schema/execution-resolvers.ts`, `src/graphql/types.ts`
**Excluded Files**: public GraphQL SDL field names unless tests require internal mapper-only updates
**Depends On**: REF-011
**Completion Criteria**:
- [ ] Replace structural double casts with named projection mapper functions.
- [ ] Document persisted `WorkflowSessionState` versus public control-plane DTO boundaries.
- [ ] Avoid data loss when saving sessions through package-owned service APIs.
**Verification Commands**:
- `bun test src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts`
- `bun test src/workflow/manager-control.test.ts src/workflow/supervisor-graphql-client.test.ts`
- `bun test src/package-boundaries.test.ts`
- `bun run typecheck`
**Residual Risk**: Public API compatibility review may be needed before expanding package DTO fields.

## Rejected Findings

- Root hook wrappers versus hook package modules: rejected as intentional compatibility re-exports, not duplicate implementations.
- Safe relative path validation across events: rejected as under-owned for this plan because path domains differ.
- External actor/conversation optional field normalization: accepted as low residual risk, too small for standalone churn.
- GraphQL JSON response and error envelope parsing across client/server/CLI: rejected for broad consolidation because trust boundaries differ.
- Browser overview HTML and CLI text overview: rejected as intentional presentation-surface split.
- Gateway read/write descriptor table unification: accepted as residual risk because payload keys, schema contracts, and CLI arguments intentionally differ.
- Provisioning package creation: rejected because no concrete provisioning source surface was identified.

## Exit Criteria

- [ ] All Ready high/mid tasks are Completed, or explicitly moved to Blocked with owner, blocker, and residual risk.
- [ ] Blocked tasks REF-003 and REF-015 are either unblocked and completed or accepted as residual risks.
- [ ] Accepted low residual risks remain documented above.
- [ ] Focused verification commands pass for every completed task.
- [ ] `bun run typecheck` passes after TypeScript source changes.
- [ ] `git diff --check` passes before handoff.
- [ ] No files are staged, committed, or pushed unless the user explicitly asks.

## Progress Log

### Session: 2026-05-19 Step 3 Merge Review Plan

**Tasks Completed**: Created this refactoring plan from concurrent slice-review outputs.

**Notes**: `REF-001` is the first implementation-ready task because it has narrow package ownership, explicit behavior to preserve, no cross-slice blocker, and focused verification.

### Session: 2026-05-19 13:25 JST Step 4 Implement Next Task

**Tasks Completed**: REF-001

**Verification**:
- `bun test src/workflow/runtime-readiness-backends.test.ts src/workflow/runtime-readiness-cross-workflow.test.ts` passed.
- `bun test src/package-boundaries.test.ts` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.

**Notes**: `packages/divedra-addons/src/runtime-readiness.ts` now imports and re-exports the canonical gateway add-on name constants from `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts`, removing local add-on name construction while preserving existing string values and compatibility exports.

### Session: 2026-05-19 13:31 JST Step 4 Implement Next Task

**Tasks Completed**: REF-002

**Verification**:
- `bun test src/workflow/addon-package-boundary.test.ts src/package-boundaries.test.ts` passed.
- `bun test src/workflow/validate.test.ts` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.
- `bun run lint:biome` completed successfully with pre-existing warnings in `src/workflow/engine/*.ts`.

**Notes**: `src/workflow/addon-package-boundary.ts` now delegates boundary third-party add-on definition registry construction to package-owned registry helpers. `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts` exposes narrow registry message options so the root compatibility boundary can preserve its sync async-validate wording while sharing selection and validate-result attachment mechanics.

### Session: 2026-05-19 13:42 JST Step 4 Implement Next Task

**Tasks Completed**: REF-004

**Verification**:
- `bun test src/events/supervisor-llm-resolver-dispatch.test.ts src/events/supervisor-llm-intent.test.ts src/events/supervisor-llm-batch.test.ts` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.
- `bun run lint:biome` completed successfully with pre-existing warnings in `src/workflow/engine/*.ts`.

**Notes**: `src/events/supervisor-llm-resolver.ts` now uses a shared helper for resolver workflow execution, session reload, succeeded resolver-node lookup, and output artifact reading. JSON parsing and payload unwrapping are centralized, while chat-command and dispatch resolver invalid-output policies remain separate.

### Session: 2026-05-19 13:47 JST Step 4 Implement Next Task

**Tasks Completed**: REF-005

**Verification**:
- `bun test src/events/input-mapping.test.ts src/events/supervisor-intent.test.ts src/events/supervisor-llm-intent.test.ts` passed.
- `bun test src/events/config.test.ts` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.
- `bun run lint:biome` completed successfully with pre-existing warnings in `src/workflow/engine/*.ts`.

**Notes**: `src/events/path-resolution.ts` now owns dotted-path lookup, explicit root allowlists, exact-reference template preservation, string rendering, primitive text coercion, and named template rendering. Input mapping, supervised correlation, supervisor intent extraction, LLM resolver input extraction, and task planning now call that helper while keeping their existing allowed roots and string handling policies.

### Session: 2026-05-19 14:02 JST Step 4 Implement Next Task

**Tasks Completed**: REF-006

**Verification**:
- `bun test src/events/reply-dispatcher.test.ts src/events/adapters/webhook.test.ts src/events/adapters/matrix.test.ts src/events/adapters/chat-sdk.test.ts` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.
- `bun run lint:biome` completed successfully with pre-existing warnings in `src/workflow/engine/*.ts`.

**Notes**: `src/events/adapters/chat-reply-response.ts` now centralizes optional reply response JSON parsing, HTTP `202` queued status mapping, and dispatch/provider message id extraction. Chat SDK and webhook reply dispatch keep the generic `providerMessageId`/`messageId`/`id` fallback order, while Matrix explicitly maps only `event_id`.
