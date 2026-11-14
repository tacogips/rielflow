# Workflow Node Executability Validation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-node-executability-validation.md`
**Created**: 2026-05-17
**Last Updated**: 2026-05-17

---

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-node-executability-validation.md`

### Summary

Add executable workflow validation for resolved workflow nodes, add-on-backed
nodes, and supported agent backends. Passive workflow validation remains the
default. Active preflight is enabled explicitly by CLI, GraphQL, or library
options and returns shared `NodeValidationResult` records without starting a
workflow session, writing node artifacts, or duplicating validation logic per
transport.

### Scope

**Included**:

- Shared `NodeValidationResult` class with stable status and message fields.
- Detailed validation output that carries `nodeValidationResults`.
- Add-on descriptor and host resolver `validate` hooks.
- Passive and active node executability collector for resolved node payloads.
- Backend-owned preflight for `codex-agent`, `claude-code-agent`, and
  `cursor-cli-agent`.
- CLI `workflow validate --executable`, GraphQL
  `executablePreflight`, and library option plumbing.
- Focused tests for success/failure paths and transport parity.

**Excluded**:

- Running workflow nodes during validation.
- Making active executable preflight the default.
- Network add-on package discovery.
- Copying code from local agent reference repositories.
- Adding generic backend-specific workflow fields without adapter-owned
  normalization.

### Issue Reference

- Source: workflow input
- Issue title: Validate workflow node executability
- Issue URL: none provided
- Repository/number: none provided
- Workflow mode: issue-resolution

### Codex Agent and Backend References

- `/Users/taco/gits/tacogips/codex-agent/src/sdk/model-availability.ts`:
  reference for Codex auth/model reachability preflight.
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`: reference for
  `codex-agent model check --model <model> --json`.
- `/Users/taco/gits/tacogips/codex-agent/src/process/types.ts`: reference for
  Codex sandbox, approval mode, and stream granularity enums.
- `/Users/taco/gits/tacogips/claude-code-agent/src/sdk/credentials/reader.ts`:
  reference for Claude credential validation.
- `/Users/taco/gits/tacogips/claude-code-agent/src/cli/commands/auth/status.ts`:
  reference for Claude auth-status CLI behavior.
- `/Users/taco/gits/tacogips/claude-code-agent/src/sdk/session-runner.ts`:
  reference for Claude `PermissionMode` values including `plan`.
- `/Users/taco/gits/tacogips/cursor-agent/src/cursor/model-availability.ts`:
  reference for Cursor model reachability and auth-unknown handling.
- `/Users/taco/gits/tacogips/cursor-agent/src/sdk/agent-runner.ts`: reference
  for Cursor mode values `default`, `plan`, and `ask`.

Intentional divergences accepted by the design:

- Cursor auth is reported as `unknown` unless a bounded probe returns an
  auth-like failure; it must not reuse Codex login wording.
- Claude model reachability is `unknown` because no stable local model probe was
  identified.
- Unsupported authored effort is `invalid`; unauthored unsupported effort is
  `valid` with a not-applicable message.

---

## Modules

### 1. Result Model and Validation Options

#### `src/workflow/validate/node-validation-result.ts`
#### `src/workflow/validate/validation-types-and-runtime-options.ts`
#### `src/workflow/validate.ts`
#### `src/lib.ts`
#### `packages/divedra-core/src/workflow-model.ts`
#### `packages/divedra-core/src/index.ts`
#### `packages/divedra/src/index.ts`

**Status**: Completed

```typescript
type NodeValidationStatus = "valid" | "warning" | "invalid" | "unknown";

class NodeValidationResult {
  readonly status: NodeValidationStatus;
  readonly message: string;
  readonly nodeId?: string;
  readonly stepIds?: readonly string[];
  readonly source?: "node" | "addon" | "agent-backend";
  readonly path?: string;
  readonly backend?: NodeExecutionBackend;
  readonly addonName?: string;
}

interface WorkflowValidationOptions {
  readonly executablePreflight?: boolean;
}

interface ValidationSuccessDetails {
  readonly nodeValidationResults: readonly NodeValidationResult[];
}
```

**Checklist**:

- [x] Define and export `NodeValidationStatus` and `NodeValidationResult`.
- [x] Add `executablePreflight?: boolean` to shared workflow validation options.
- [x] Add `nodeValidationResults` to detailed validation success output.
- [x] Keep existing structural `ValidationIssue` behavior unchanged.
- [x] Preserve package facade exports through `src/lib.ts`, `divedra-core`, and
      `divedra`.

### 2. Shared Node Executability Collector

#### `src/workflow/validate/node-executability-validation.ts`
#### `src/workflow/validate/bundle-validation-entrypoints.ts`
#### `src/workflow/validate/semantic-validation-and-addons.ts`
#### `src/workflow/types.ts`

**Status**: Completed

```typescript
interface NodeExecutabilityValidationInput {
  readonly bundle: NormalizedWorkflowBundle;
  readonly options: WorkflowValidationOptions;
}

interface AgentBackendPreflightCandidate {
  readonly backend: NodeExecutionBackend;
  readonly model: string;
  readonly nodeIds: readonly string[];
  readonly stepIds: readonly string[];
}
```

**Checklist**:

- [x] Collect resolved node payloads exactly once after add-on resolution.
- [x] Attribute results with node ids and all step ids that reference each node.
- [x] Return passive `unknown` or not-applicable results for unprobed backend
      auth/model/plan/effort checks.
- [x] Group agent nodes by backend/model for active preflight.
- [x] Convert active backend results into `NodeValidationResult` objects.
- [x] Treat `invalid` node results as blocking only when
      `executablePreflight` is true.

### 3. Add-on Validate Hook Contract

#### `src/workflow/types.ts`
#### `src/workflow/addon-package-boundary.ts`
#### `packages/divedra-addons/src/node-addons/addon-constants-and-agent-config.ts`
#### `packages/divedra-addons/src/node-addons/addon-payload-resolution.ts`
#### `packages/divedra-addons/src/local-node-addons.ts`
#### `packages/divedra-addons/src/index.ts`

**Status**: Completed

```typescript
interface NodeAddonValidateInput {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly resolvedPayload?: NodePayload;
  readonly path: string;
  readonly executablePreflight: boolean;
}

type NodeAddonValidateResult =
  | NodeValidationResult
  | readonly NodeValidationResult[];

interface NodeAddonDefinition {
  readonly validate?: (input: NodeAddonValidateInput) => Awaitable<NodeAddonValidateResult>;
}
```

**Checklist**:

- [x] Extend add-on definitions and host resolvers with optional `validate`.
- [x] Keep local manifest/template add-ons schema-only and side-effect-free.
- [x] Ensure built-in descriptors can contribute passive validation results.
- [x] Convert add-on validation output into shared `NodeValidationResult`
      records without a transport-specific path.
- [x] Ensure add-on validation results are emitted once per authored add-on node.

### 4. Agent Backend Preflight

#### `src/workflow/runtime-readiness-agent-probes.ts`
#### `src/workflow/runtime-readiness.ts`
#### `src/workflow/adapters/codex.ts`
#### `src/workflow/adapters/claude.ts`
#### `src/workflow/adapters/cursor.ts`

**Status**: Completed

```typescript
interface AgentBackendPreflightResult {
  readonly backend: NodeExecutionBackend;
  readonly nodeResults: readonly NodeValidationResult[];
}
```

**Checklist**:

- [x] Reuse bounded command execution with timeouts and secret-safe messages.
- [x] `codex-agent`: check tool availability, git availability, auth/model
      reachability when active, Codex mode enums, and unsupported effort/plan.
- [x] `claude-code-agent`: check wrapper/tool availability, auth status when
      active, `PermissionMode` values, static `plan` support, unknown model
      reachability, and unsupported effort.
- [x] `cursor-cli-agent`: check wrapper/tool availability, model reachability
      when active, auth unknown unless failure is auth-like, Cursor modes
      `default`/`plan`/`ask`, and unsupported effort.
- [x] Keep Cursor-specific interpretation inside Cursor-owned adapter/probe code.
- [x] Share probe helpers with runtime readiness instead of adding duplicate
      command implementations.

### 5. CLI, GraphQL, and Library Surfaces

#### `packages/divedra/src/cli/input-output-helpers.ts`
#### `packages/divedra/src/cli/workflow-command-handler.ts`
#### `src/graphql/types.ts`
#### `src/graphql/schema/llm-run-overrides.ts`
#### `packages/divedra-graphql/src/schema-contract.ts`
#### `src/server/graphql-executable-schema.ts`

**Status**: Completed

**Checklist**:

- [x] Add `workflow validate --executable` CLI parsing and help text.
- [x] Include `nodeValidationResults` in CLI JSON output.
- [x] Add concise text output for invalid/warning node validation results.
- [x] Add GraphQL `ValidateWorkflowDefinitionInput.executablePreflight`.
- [x] Add GraphQL `NodeValidationResult` payload fields with the same status
      values and messages as the library surface.
- [x] Ensure library callers can request active preflight with
      `executablePreflight: true`.

### 6. Tests for Core Validation and Add-ons

#### `src/workflow/validate.test.ts`
#### `src/workflow/runtime-readiness-backends.test.ts`
#### `packages/divedra-addons/src/**/*.test.ts`

**Status**: Completed

**Checklist**:

- [x] Existing structurally valid workflows still pass without executable
      preflight.
- [x] Add-on `validate` hooks contribute node results exactly once.
- [x] Local manifest add-ons remain schema-only and do not execute code.
- [x] Reused node payloads retain all referencing step ids in results.
- [x] Invalid executable results block only when active preflight is requested.

### 7. Tests for Backend Preflight

#### `src/workflow/runtime-readiness-backends.test.ts`
#### `src/workflow/adapters/codex.test.ts`
#### `src/workflow/adapters/claude.test.ts`
#### `src/workflow/adapters/cursor.test.ts`

**Status**: Completed

**Checklist**:

- [x] `codex-agent` reports missing auth or unreachable model as invalid under
      active preflight.
- [x] `codex-agent` reports unauthored plan/effort as not applicable and
      rejects authored unsupported plan/effort.
- [x] `claude-code-agent` reports missing or expired credentials as invalid.
- [x] `claude-code-agent` validates `default`, `acceptEdits`, `plan`, and
      `bypassPermissions` and reports live plan proof as unknown.
- [x] `cursor-cli-agent` validates `default`, `plan`, and `ask`.
- [x] `cursor-cli-agent` reports auth as unknown without a stable auth signal
      and rejects authored unsupported effort.

### 8. Transport Parity and Documentation Refresh

#### `src/cli.test.ts`
#### `src/graphql/schema.test.ts`
#### `src/server/graphql-execution-overview-and-definitions.test.ts`
#### `README.md`
#### `.agents/skills/divedra-workflow-run/SKILL.md`

**Status**: Completed

**Checklist**:

- [x] CLI JSON, GraphQL mutation, and library detailed validation expose matching
      `nodeValidationResults`.
- [x] CLI text output remains backward compatible except for additive
      executable-result summaries.
- [x] README documents `workflow validate --executable`.
- [x] Workflow-run skill documentation mentions active executable preflight for
      operator validation.

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Result model and options | `src/workflow/validate/node-validation-result.ts`, `src/workflow/validate/validation-types-and-runtime-options.ts`, package exports | NOT_STARTED | Typecheck, export tests |
| Shared collector | `src/workflow/validate/node-executability-validation.ts`, `src/workflow/validate/bundle-validation-entrypoints.ts` | NOT_STARTED | `src/workflow/validate.test.ts` |
| Add-on validate hook | `src/workflow/types.ts`, `src/workflow/addon-package-boundary.ts`, `packages/divedra-addons/src/**` | NOT_STARTED | add-on validation tests |
| Backend preflight | `src/workflow/runtime-readiness-agent-probes.ts`, `src/workflow/adapters/{codex,claude,cursor}.ts` | NOT_STARTED | backend probe tests |
| CLI/GraphQL/library surfaces | `packages/divedra/src/cli/**`, `src/graphql/**`, `packages/divedra-graphql/src/schema-contract.ts` | NOT_STARTED | CLI and GraphQL tests |
| Documentation | `README.md`, `.agents/skills/divedra-workflow-run/SKILL.md` | NOT_STARTED | Review |

---

## Task Breakdown

### TASK-001: Result Model and Option Plumbing

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `src/workflow/validate/node-validation-result.ts`
- Updated validation option/detail types.
- Public exports through `src/workflow/validate.ts`, `src/lib.ts`,
  `packages/divedra-core/src/index.ts`, and `packages/divedra/src/index.ts`.

**Dependencies**: None

**Completion Criteria**:

- [x] `NodeValidationResult` and status type are exported.
- [x] Detailed validation returns an empty `nodeValidationResults` array before
      collector integration.
- [x] Existing validation callers compile without behavior changes.

### TASK-002: Shared Collector Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `src/workflow/validate/node-executability-validation.ts`
- Collector calls from sync and async validation entrypoints.
- Blocking behavior for active invalid executable results.

**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Every resolved node is evaluated once.
- [x] Result attribution includes node id, step ids, path, source, and backend
      where applicable.
- [x] Passive validation remains non-blocking for executable results.

### TASK-003: Add-on Validate Hook

**Status**: Completed
**Parallelizable**: Yes, after TASK-001
**Deliverables**:

- Add optional validate hook types to workflow/add-on contracts.
- Built-in add-on validate implementations or default pass-through results.
- Host resolver support for add-on validate output.

**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Built-in and third-party resolver paths can return shared node validation
      results.
- [x] Local manifest add-ons cannot execute arbitrary code during validation.
- [x] Add-on results are not duplicated by CLI, GraphQL, or library callers.

### TASK-004: Agent Backend Preflight

**Status**: Completed
**Parallelizable**: Yes, after TASK-001
**Deliverables**:

- Backend preflight helpers/results in runtime readiness probe modules or adapter
  modules.
- Capability handling for auth, model reachability, plan executability, valid
  mode, and valid effort.

**Dependencies**: TASK-001

**Completion Criteria**:

- [x] `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` implement the
      accepted design matrix.
- [x] External commands are timeout-bounded and sanitize messages.
- [x] Runtime readiness and executable validation share probe helpers.

### TASK-005: CLI, GraphQL, and Library Exposure

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- CLI `workflow validate --executable`.
- GraphQL `executablePreflight` input and `nodeValidationResults` payload.
- Matching JSON and text formatting.

**Dependencies**: TASK-002, TASK-003, TASK-004

**Completion Criteria**:

- [x] CLI JSON exposes shared node result fields.
- [x] GraphQL exposes the same statuses and messages.
- [x] Text output summarizes invalid and warning node results.

### TASK-006: Core and Add-on Tests

**Status**: Completed
**Parallelizable**: Yes, after TASK-002 and TASK-003
**Deliverables**:

- Focused workflow validation tests.
- Add-on validate hook tests.

**Dependencies**: TASK-002, TASK-003

**Completion Criteria**:

- [x] Structural validation regression coverage passes without active preflight.
- [x] Add-on validate hook success/failure paths are covered.
- [x] Multi-step node attribution is covered.

### TASK-007: Backend Preflight Tests

**Status**: Completed
**Parallelizable**: Yes, after TASK-004
**Deliverables**:

- Backend probe tests for Codex, Claude, and Cursor capability matrix behavior.

**Dependencies**: TASK-004

**Completion Criteria**:

- [x] Missing auth/model/tool paths produce expected statuses.
- [x] Unsupported authored plan/effort values are invalid.
- [x] Unknown capabilities are explicit and non-silent.

### TASK-008: Transport Parity Tests and Documentation

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- CLI and GraphQL tests.
- README and workflow-run skill updates.

**Dependencies**: TASK-005, TASK-006, TASK-007

**Completion Criteria**:

- [x] CLI, GraphQL, and library output parity is covered by tests.
- [x] Operator documentation mentions passive default and explicit active
      preflight.
- [x] No documentation implies workflow execution occurs during validation.

---

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Result model | None | COMPLETED |
| Shared collector | Result model | COMPLETED |
| Add-on validate hook | Result model | COMPLETED |
| Agent backend preflight | Result model | COMPLETED |
| CLI/GraphQL/library exposure | Collector, add-on hook, backend preflight | COMPLETED |
| Core/add-on tests | Collector and add-on hook | COMPLETED |
| Backend tests | Backend preflight | COMPLETED |
| Transport parity/docs | CLI/GraphQL/library exposure and tests | COMPLETED |

---

## Parallelization Plan

- TASK-003 and TASK-004 may run in parallel after TASK-001 because add-on
  contract files and backend probe/adapter files are disjoint.
- TASK-006 and TASK-007 may run in parallel after their implementation
  dependencies because their primary test write scopes are separate.
- TASK-005 and TASK-008 are not parallelizable because they integrate shared
  output shape across CLI, GraphQL, and documentation.

---

## Verification Plan

Run focused checks after each relevant task:

```bash
bun test src/workflow/validate.test.ts
bun test src/workflow/runtime-readiness-backends.test.ts
bun test src/workflow/adapters/codex.test.ts src/workflow/adapters/claude.test.ts src/workflow/adapters/cursor.test.ts
bun test src/cli.test.ts -t "workflow validate"
bun test src/graphql/schema.test.ts -t "validateWorkflowDefinition"
bun test src/server/graphql-execution-overview-and-definitions.test.ts -t "validate"
```

Run full verification before completion:

```bash
bun run typecheck
bun run test
bun run src/main.ts workflow validate design-and-implement-review-loop --workflow-definition-dir .divedra/workflows
bun run src/main.ts workflow validate design-and-implement-review-loop --workflow-definition-dir .divedra/workflows --executable --output json
```

---

## Completion Criteria

- [x] Shared `NodeValidationResult(status,message)` model is implemented and
      exported.
- [x] Add-ons can implement `validate` and feed shared node validation results.
- [x] Passive validation remains default and backward compatible.
- [x] Active executable preflight is explicitly enabled and blocking for invalid
      executable results.
- [x] `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` cover auth,
      model, plan, mode, and effort according to the accepted design matrix.
- [x] CLI, GraphQL, and library surfaces expose the same result objects.
- [x] Runtime readiness reuses backend probe helpers rather than duplicating
      checks.
- [x] Focused and full verification commands pass or have documented unrelated
      blockers.
- [x] README and workflow-run skill docs are refreshed for the new operator
      command.

---

## Progress Log Expectations

Each implementation session must append a dated entry with:

- task ids completed or advanced
- file paths changed
- verification commands run and results
- blockers or intentional deviations from this plan
- remaining unchecked completion criteria

### Session: 2026-05-17

**Tasks Completed**: TASK-001 through TASK-008 completed after workflow-driven design and implementation.
**Tasks In Progress**: None
**Blockers**: The workflow implementation step produced the patch but did not publish its final structured output; the local workflow command was stopped and verification was completed manually.
**Verification**:

- `bun run lint:biome --diagnostic-level=warn` passed with existing unrelated noExplicitAny warnings in `src/workflow/engine/*`.
- `bun run typecheck` passed.
- `bun test src/package-boundaries.test.ts src/graphql/schema.test.ts src/workflow/superviser-runtime-control-impl.test.ts --timeout 30000` passed.
- `bun test src/workflow/validate.test.ts src/workflow/runtime-readiness-backends.test.ts src/cli.test.ts --timeout 30000` passed.
- `bun run test` passed: 1129 tests.
- `bun run src/main.ts workflow validate design-and-implement-review-loop --workflow-definition-dir .divedra/workflows --executable --output json` passed with `valid: true`.

**Implementation Notes**:

- Added shared node validation result APIs, passive collection, active executable preflight, add-on validate hook plumbing, CLI/GraphQL/library surfaces, documentation, and regression tests.
- Adjusted model-check preflight timeout to account for real local `codex-agent model check` latency.
- Fixed loaded-workflow GraphQL validation to avoid revalidating normalized workflows as authored JSON.
- Fixed semantic validation for synthesized manager step ids during mutable workflow load/save.

### Original Planning Session

**Tasks Completed**: Plan created after Step 3 design acceptance.
**Tasks In Progress**: None
**Blockers**: None
**Verification**:

- `sed -n '1,220p' .agents/skills/impl-plan/SKILL.md`
- `jq '.latestOutputs[] | {nodeId, payload: .payload | {workflowMode, issueReference, designDocPaths, codexAgentReferences, accepted, needs_revision, findings, feedback, reviewedDesignDocPaths}}' "$DIVEDRA_MAILBOX_DIR/inbox/input.json"`
- `sed -n '1,340p' design-docs/specs/design-workflow-node-executability-validation.md`

