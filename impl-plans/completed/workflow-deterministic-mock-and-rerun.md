# Workflow Deterministic Mock And Rerun Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#workflow-execution, design-docs/specs/command.md#session-command
**Created**: 2026-02-24
**Last Updated**: 2026-02-24

## Scope

Add deterministic mock execution control for workflow nodes, improve progress visibility, and support rerun from an arbitrary node using an existing session as baseline.

Out of scope:
- Upstream changes in external agent repositories unless runtime integration in `divedra` is insufficient
- UI/web visualization changes

## Modules

### 1. Mockable Adapter Layer

#### src/workflow/adapter.ts

**Status**: Completed

```typescript
export interface MockNodeResponse {
  readonly provider?: string;
  readonly model?: string;
  readonly promptText?: string;
  readonly completionPassed?: boolean;
  readonly when?: Readonly<Record<string, boolean>>;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly fail?: boolean;
}

export type MockNodeScenarioEntry = MockNodeResponse | readonly MockNodeResponse[];
export type MockNodeScenario = Readonly<Record<string, MockNodeScenarioEntry>>;

export class ScenarioNodeAdapter implements NodeAdapter {
  constructor(scenario: MockNodeScenario, fallback?: NodeAdapter);
}
```

**Checklist**:
- [x] Add scenario-based mock response types
- [x] Add deterministic sequence-by-attempt behavior
- [x] Keep deterministic fallback behavior
- [x] Add tests via engine/cli/api integration

### 2. Workflow Engine Rerun Support

#### src/workflow/engine.ts

**Status**: Completed

```typescript
export interface WorkflowRunOptions {
  readonly mockScenario?: MockNodeScenario;
  readonly rerunFromSessionId?: string;
  readonly rerunFromNodeId?: string;
}
```

**Checklist**:
- [x] Wire mock scenario into default adapter selection
- [x] Support rerun from session + node with new session creation
- [x] Validate rerun node existence and workflow consistency
- [x] Cover rerun and scenario behavior with tests

### 3. CLI Enhancements

#### src/cli.ts

**Status**: Completed

```typescript
interface ParsedOptions {
  readonly mockScenarioPath?: string;
}
```

Commands:
- `workflow run ... --mock-scenario <path>`
- `session progress <session-id>`
- `session rerun <session-id> <node-id>`

**Checklist**:
- [x] Parse and validate mock scenario JSON
- [x] Add progress summary command
- [x] Add rerun command
- [x] Update CLI tests

### 4. API Enhancements

#### src/server/api.ts

**Status**: Completed

Endpoints:
- `POST /api/workflows/:workflowName/execute` supports `mockScenario`
- `POST /api/sessions/:sessionId/rerun` supports rerun from node

**Checklist**:
- [x] Accept mock scenario in execute request
- [x] Add rerun endpoint with validation
- [x] Respect `noExec` mode
- [x] Update API tests

### 5. Example Workflow Asset

#### .divedra/software-auto-pipeline/*

**Status**: Completed

**Checklist**:
- [x] Add end-to-end software lifecycle workflow example
- [x] Include deterministic mock scenario file
- [x] Demonstrate rework loop with deterministic decisions
- [x] Document usage in README

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Mock adapter | `src/workflow/adapter.ts` | COMPLETED | Covered by integration tests |
| Engine rerun | `src/workflow/engine.ts` | COMPLETED | `src/workflow/engine.test.ts` |
| CLI commands | `src/cli.ts` | COMPLETED | `src/cli.test.ts` |
| API endpoints | `src/server/api.ts` | COMPLETED | `src/server/api.test.ts` |
| Example workflow | `.divedra/software-auto-pipeline/*` | COMPLETED | Exercised via CLI/API run paths |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Scenario adapter | Existing workflow adapter interface | DONE |
| Engine rerun option | Session store load/read behavior | DONE |
| CLI/API integration | Engine option support | DONE |
| Example workflow | Validation model and edge evaluation | DONE |

## Completion Criteria

- [x] Deterministic mock scenario execution implemented
- [x] Session progress inspection command implemented
- [x] Session rerun-from-node implemented
- [x] API parity for rerun and mock execution implemented
- [x] End-to-end sample workflow committed under `.divedra/`
- [x] Tests and type checking pass

## Progress Log

### Session: 2026-02-24 11:45
**Tasks Completed**: adapter mock scenario support, engine rerun support, CLI progress/rerun/mock options, API rerun/mock support, sample workflow authoring, README updates, test updates
**Tasks In Progress**: none
**Blockers**: none
**Notes**: Upstream agent repositories are not required for deterministic mode because behavior is mocked in `divedra` adapter layer.
