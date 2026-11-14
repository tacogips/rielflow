# Workflow Usage Discovery Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-usage-discovery.md`, `design-docs/specs/command.md`
**Created**: 2026-05-03
**Last Updated**: 2026-05-03

## Scope

Add an AI-facing workflow discovery surface that lists workflow purpose plus the
callable input/output contract plus a compact step overview, document authored
node input contracts, and teach the divedra workflow usage skill to use the new
command.

Out of scope:

- remote GraphQL parity for the first slice
- low-level graph/debugging detail such as transition lists or runtime
  readiness in the usage output
- automatic contract inference from prompts

## Modules

### 1. Input Contract Schema

#### `src/workflow/types.ts`

#### `src/workflow/validate.ts`

**Status**: COMPLETED

```typescript
export interface NodeInputContract {
  readonly description?: string;
  readonly jsonSchema?: JsonObject;
}

export interface WorkflowCallableContractSummary {
  readonly stepId: string;
  readonly role: NodeRole;
  readonly input?: NodeInputContract;
  readonly output?: NodeOutputContract;
}
```

**Checklist**:

- [x] Add node input-contract types
- [x] Validate authored `input.description` and `input.jsonSchema`
- [x] Preserve existing output-contract behavior

### 2. Usage Summary Builder

#### `src/workflow/inspect.ts`

#### `src/workflow/usage.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowUsageSummary {
  readonly workflowName: string;
  readonly workflowId: string;
  readonly description: string;
  readonly callable: WorkflowCallableContractSummary;
  readonly steps: readonly WorkflowStepSummary[];
}

export interface WorkflowUsageCatalog {
  readonly workflows: readonly WorkflowUsageSummary[];
}
```

**Checklist**:

- [x] Derive callable step from `managerStepId ?? entryStepId`
- [x] Expose callable contracts on inspection summaries
- [x] Expose compact step summaries on inspection and usage summaries
- [x] Build catalog-wide local usage summaries

### 3. CLI Surface

#### `src/cli.ts`

#### `src/cli.test.ts`

**Status**: COMPLETED

```typescript
// workflow usage [name]
```

**Checklist**:

- [x] Add `workflow usage` help and dispatch
- [x] Support list-without-target and single-workflow lookup
- [x] Add JSON and text output coverage
- [x] Reject unsupported remote endpoint usage in the first slice

### 4. Documentation And Skills

#### `README.md`

#### `.agents/skills/divedra-workflow-run/SKILL.md`

#### `.agents/skills/divedra-workflow-reference/SKILL.md`

**Status**: COMPLETED

**Checklist**:

- [x] Document `workflow usage`
- [x] Explain that LLMs should use it before choosing a workflow
- [x] Explain callable input/output contract expectations
- [x] Explain the compact step-overview field

## Module Status

| Module                   | File Path                                                                                                         | Status    | Tests  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------- | ------ |
| Input contract schema    | `src/workflow/types.ts`, `src/workflow/validate.ts`                                                               | COMPLETED | Passed |
| Usage summary builder    | `src/workflow/inspect.ts`, `src/workflow/usage.ts`                                                                | COMPLETED | Passed |
| CLI surface              | `src/cli.ts`, `src/cli.test.ts`                                                                                   | COMPLETED | Passed |
| Documentation and skills | `README.md`, `.agents/skills/divedra-workflow-run/SKILL.md`, `.agents/skills/divedra-workflow-reference/SKILL.md` | COMPLETED | Passed |

## Dependencies

| Feature               | Depends On                   | Status    |
| --------------------- | ---------------------------- | --------- |
| Usage summary builder | Input contract schema        | COMPLETED |
| CLI surface           | Usage summary builder        | COMPLETED |
| Docs and skills       | CLI surface naming finalized | COMPLETED |

## Completion Criteria

- [x] Callable node input contracts are authorable and validated
- [x] One CLI command lists workflow purpose plus callable input/output contract and compact step overview
- [x] `workflow inspect --output json` includes callable contract data and step summaries
- [x] CLI tests cover the new command and contract reporting
- [x] README and divedra workflow usage skills document the new discovery flow
- [x] Tests and type checks pass

## Progress Log

### Session: 2026-05-03 21:25 JST

**Tasks Completed**: Created design doc and implementation plan
**Tasks In Progress**: Input contract schema design and CLI surface selection
**Blockers**: None
**Notes**: Chose a dedicated `workflow usage` command so the human `workflow list` overview remains stable while LLM tooling gets a purpose-and-contract catalog.

### Session: 2026-05-03 22:03 JST

**Tasks Completed**: Input contract schema, callable summary derivation, `workflow usage` CLI, CLI regression coverage, README update, skill updates
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added node-level `input` contracts, derived callable contracts from `managerStepId ?? entryStepId`, surfaced them in `workflow inspect`, and added a local-only `workflow usage` discovery command for LLM/operator selection. Verified with `bun test src/cli.test.ts` and `bun run typecheck`. Repository-wide `bun run format:check` still reports many unrelated pre-existing formatting warnings outside this change set.

### Session: 2026-05-03 22:40 JST

**Tasks Completed**: Added compact step summaries to `workflow usage` and aligned documentation with the implemented CLI behavior
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Updated the design and operator guidance so the AI-facing discovery surface now explicitly includes workflow purpose, callable input/output contract, and a compact authored step overview without expanding into full structural inspection.
