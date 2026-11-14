# Inline Workflow Variables and Inspect Usage Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/command.md#cli-workflow-run-name`, `design-docs/specs/command.md#cli-workflow-inspect-name`, `design-docs/specs/notes.md`
**Created**: 2026-05-04
**Last Updated**: 2026-05-04

---

## Design Document Reference

**Source**: `design-docs/specs/command.md`, `design-docs/specs/notes.md`

### Summary

Implement the issue-resolution slice for runtime-variable input and workflow
inspect discoverability. `divedra workflow run --variables` must accept the
historical bare JSON file path, an explicit `@file` reference, and an inline
JSON object such as `{"hours":48}`. `workflow inspect` text output must show
copyable `workflow run --variables` examples when the callable step has an
authored input contract, while JSON inspect output must continue to preserve
the complete `callable.input` object including nested `jsonSchema`.

### Scope

**Included**: CLI runtime-variable source parsing, local and remote workflow
run behavior, workflow inspect text examples, JSON inspect schema retention
tests, help/error wording, and focused regression coverage.

**Excluded**: Runtime schema enforcement against `callable.input.jsonSchema`,
new upload/attachment support, changes to `divedra gql --variables`, and
changes to workflow usage semantics beyond preserving existing behavior.

---

## Codex-Agent Reference Mapping

Codex-reference behavior comes from `<reference-repository-root>` (for example
`../../codex-agent`):

- `src/cli/graphql.ts`: `parseJsonSource` accepts inline JSON, explicit `@file`,
  and readable bare file paths, then requires `--variables` to parse as an
  object.
- `src/cli/graphql.test.ts`: covers inline object variables and JSON file path
  variables.

Intentional divedra divergences accepted by the design:

- `workflow run --variables` preserves the existing bare file path behavior but
  parses inline input only when the value is syntactically a JSON object.
- Explicit `@file` is required to force file loading when a value might
  otherwise look like inline JSON.
- Arrays, scalars, malformed JSON, unreadable file references, and files
  containing non-object JSON fail before local execution or remote GraphQL
  dispatch.
- Callable input schema is discoverability metadata only; it does not become a
  validation gate in this slice.

---

## Modules

### 1. Runtime Variable Source Parser

#### `src/cli.ts`

**Status**: COMPLETED

```typescript
type RuntimeVariablesSourceKind = "inline-json" | "explicit-file" | "file-path";

interface RuntimeVariablesSource {
  readonly kind: RuntimeVariablesSourceKind;
  readonly displayValue: string;
  readonly content: string;
}
```

**Checklist**:

- [x] Replace file-only `readRuntimeVariables(pathToJson)` behavior with a
      source-aware parser for `--variables <value>`.
- [x] Preserve bare file path loading for existing invocations such as
      `--variables ./vars.json`.
- [x] Add explicit `@./vars.json` file loading.
- [x] Add inline JSON object parsing for values that trim to `{...}`.
- [x] Reject arrays, scalars, malformed inline JSON, unreadable file inputs,
      and file JSON that is not an object before execution dispatch.
- [x] Keep `divedra gql --variables` on the existing `readGraphqlVariables`
      path unless a later task deliberately refactors shared helpers.

### 2. Workflow Run Wiring and Error Text

#### `src/cli.ts`

**Status**: COMPLETED

```typescript
interface ParsedOptions {
  readonly variablesPath?: string;
}
```

**Checklist**:

- [x] Use the new parser in the `workflow run` command before local engine
      execution.
- [x] Use the same parsed runtime variables before remote GraphQL execution so
      malformed variables do not send a request.
- [x] Rename internal variables only if useful, but keep CLI flag compatibility
      and avoid changing public option names in unrelated commands.
- [x] Update failure wording from file-only wording to source-neutral wording.
- [x] Update help text to show inline JSON, explicit `@file`, and bare file
      forms.

### 3. Inspect Variable Examples

#### `src/cli.ts`

**Status**: COMPLETED

```typescript
interface WorkflowVariablesExample {
  readonly mode: "inline-json" | "explicit-file" | "file-path";
  readonly command: string;
}
```

**Checklist**:

- [x] Add a small formatter that builds a best-effort example object from
      `summary.callable.input.jsonSchema` when available.
- [x] Fall back to a conservative object such as `{"workflowInput":{}}` when no
      schema-shaped sample can be derived.
- [x] In text `workflow inspect`, print copyable examples only when
      `summary.callable.input` exists.
- [x] Include all required forms: inline JSON object, explicit `@./variables.json`,
      and historical bare `./variables.json`.
- [x] Do not add the examples to JSON output unless the implementation step
      explicitly chooses a backward-compatible additive field; JSON output must
      at minimum retain `callable.input` as structured data.

### 4. Tests and Fixture Coverage

#### `src/cli.test.ts`

**Status**: COMPLETED

```typescript
interface WorkflowInspectCallableInputJson {
  readonly callable: {
    readonly input?: {
      readonly description?: string;
      readonly jsonSchema?: Readonly<Record<string, unknown>>;
    };
  };
}
```

**Checklist**:

- [x] Add `workflow run --variables '{"hours":48}'` coverage for local execution.
- [x] Add `workflow run --variables @./vars.json` coverage.
- [x] Preserve existing bare file path coverage and add an assertion that it
      still reaches runtime variables unchanged.
- [x] Cover malformed inline object, inline array/scalar, unreadable explicit
      file, unreadable bare file input, and non-object file JSON failures.
- [x] Cover the remote GraphQL workflow-run path so inline variables are parsed
      and forwarded as `runtimeVariables` before transport.
- [x] Cover text `workflow inspect` examples for a workflow with callable input.
- [x] Cover JSON `workflow inspect --output json` retaining nested
      `callable.input.jsonSchema`.

### 5. Documentation and Verification Tracking

#### `README.md`, `design-docs/specs/command.md`, `design-docs/specs/notes.md`

**Status**: COMPLETED

**Checklist**:

- [x] Update README runtime-variable examples if they still imply file-only
      input.
- [x] Keep accepted design docs aligned if implementation chooses different
      operator-facing wording.
- [x] Record verification commands and outcomes in this plan's progress log.

---

## Module Status

| Module                  | File Path                                                                 | Status    | Tests             |
| ----------------------- | ------------------------------------------------------------------------- | --------- | ----------------- |
| Runtime variable parser | `src/cli.ts`                                                              | COMPLETED | `src/cli.test.ts` |
| Workflow run wiring     | `src/cli.ts`                                                              | COMPLETED | `src/cli.test.ts` |
| Inspect examples        | `src/cli.ts`                                                              | COMPLETED | `src/cli.test.ts` |
| Documentation           | `README.md`, `design-docs/specs/command.md`, `design-docs/specs/notes.md` | COMPLETED | docs review       |
| Verification tracking   | this plan                                                                 | COMPLETED | command log       |

## Dependencies

| Feature                 | Depends On                                                                                       | Status    |
| ----------------------- | ------------------------------------------------------------------------------------------------ | --------- |
| Runtime variable parser | Accepted design in `design-docs/specs/command.md` and existing `workflow run --variables` parser | AVAILABLE |
| Workflow run wiring     | Runtime variable parser                                                                          | AVAILABLE |
| Inspect examples        | Existing `WorkflowInspectionSummary.callable.input` from `src/workflow/inspect.ts`               | AVAILABLE |
| Tests                   | Runtime parser, run wiring, and inspect formatter                                                | AVAILABLE |
| Documentation           | Final CLI wording and examples                                                                   | AVAILABLE |

## Task Breakdown

### TASK-001: Runtime Variable Source Parser

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/cli.ts`, focused parser tests in `src/cli.test.ts`
**Dependencies**: accepted design

**Completion Criteria**:

- [x] Inline object JSON parses to runtime variables.
- [x] Explicit `@file` parses to runtime variables.
- [x] Historical bare file path behavior remains unchanged.
- [x] Invalid source forms fail before execution or transport.

### TASK-002: Workflow Run Integration

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/cli.ts`, local and remote workflow-run tests in
`src/cli.test.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Local workflow run receives parsed inline and file variables.
- [x] Remote GraphQL workflow run receives parsed `runtimeVariables`.
- [x] Error messages are source-neutral and operator-actionable.

### TASK-003: Inspect Copyable Variable Examples

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/cli.ts`, inspect text/JSON tests in `src/cli.test.ts`
**Dependencies**: existing inspection summary callable metadata

**Completion Criteria**:

- [x] Text inspect shows inline JSON, explicit `@file`, and bare file examples
      when callable input exists.
- [x] Text inspect omits variable examples when no callable input exists.
- [x] JSON inspect keeps nested `callable.input.jsonSchema` structured.

### TASK-004: Documentation and Review Hardening

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `README.md`, optional design-doc wording alignment, this plan
progress log
**Dependencies**: TASK-001, TASK-002, TASK-003

**Completion Criteria**:

- [x] README examples describe inline, explicit `@file`, and bare file inputs.
- [x] Progress log records verification commands and any residual risk.
- [x] No implementation code is added to design docs or this plan.

## Parallelizable Tasks

| Task     | Parallelizable | Reason                                                                                            |
| -------- | -------------- | ------------------------------------------------------------------------------------------------- |
| TASK-001 | No             | Shared parser in `src/cli.ts` blocks run integration.                                             |
| TASK-002 | No             | Depends on TASK-001 and touches the same workflow-run branch.                                     |
| TASK-003 | No             | Inspect formatter writes overlap `src/cli.ts`, so this should be sequenced with parser/run edits. |
| TASK-004 | No             | Depends on final operator-facing wording from implementation.                                     |

## Verification

- `bun test src/cli.test.ts`
- `bun run typecheck`
- `git diff --check`
- Manual local smoke, if needed:
  `bun run src/main.ts workflow run recent-change-quality-loop --workflow-root ./examples --variables '{"hours":48}' --dry-run`
- Manual inspect smoke, if needed:
  `bun run src/main.ts workflow inspect recent-change-quality-loop --workflow-root ./examples`
- Manual JSON inspect smoke, if needed:
  `bun run src/main.ts workflow inspect recent-change-quality-loop --workflow-root ./examples --output json`

## Completion Criteria

- [x] `workflow run --variables '{"hours":48}'` works for object JSON input.
- [x] `workflow run --variables @./vars.json` works.
- [x] Existing `workflow run --variables ./vars.json` behavior is preserved.
- [x] Arrays, scalars, malformed JSON, unreadable files, and non-object file
      JSON are rejected before local execution or remote GraphQL dispatch.
- [x] Text `workflow inspect` shows concrete variable examples from callable
      input metadata.
- [x] JSON `workflow inspect` retains `callable.input.jsonSchema` as structured
      JSON.
- [x] Focused tests, typecheck, and diff whitespace checks pass.

## Progress Log

### Session: 2026-05-04 00:00

**Tasks Completed**: Plan created for Step 4 after accepted design references.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan incorporates Step 5 revision concerns available from the
workflow context by making local and remote run behavior explicit, preserving
legacy bare file input, retaining JSON inspect schema shape, and documenting
Codex-reference divergences.

### Session: 2026-05-04 15:01 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented source-aware `workflow run --variables` parsing for
inline JSON objects, explicit `@file`, and historical bare file paths; rejected
arrays, scalars, malformed JSON, unreadable files, and non-object files before
local execution or remote GraphQL transport. Added text `workflow inspect`
variable examples gated on callable input metadata while leaving JSON inspect
focused on the existing structured `callable.input` contract. Updated README
runtime-variable examples. Verification: `DIVEDRA_ARTIFACT_DIR=/private/tmp/divedra-cli-test-artifacts bun test src/cli.test.ts`
passed (102 tests), `bun run typecheck` passed, and `git diff --check` passed.
Manual smoke `DIVEDRA_ARTIFACT_DIR=/private/tmp/divedra-cli-smoke-artifacts bun run src/main.ts workflow run worker-only-single-step --workflow-definition-dir ./examples --variables '{"hours":48}' --dry-run --output json`
passed, and `bun run src/main.ts workflow inspect worker-only-single-step --workflow-definition-dir ./examples`
passed.
An initial `bun test src/cli.test.ts` without `DIVEDRA_ARTIFACT_DIR` failed only
because the sandbox denied hook recording under `$HOME/.divedra`; rerun
with a writable runtime root passed.

### Session: 2026-05-04 15:18 JST

**Tasks Completed**: Step 7 review rerun hardening for TASK-001.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Aligned the runtime-variable source parser with the Codex-agent
reference behavior by checking readable bare file paths before falling back to
inline JSON parsing, preserving legacy file-path behavior even for filenames
that look like JSON scalar literals. Added regression coverage for a bare file
named `48` while retaining the invalid inline scalar rejection when no readable
file exists. Verification rerun: focused CLI variable/inspect tests passed,
full `src/cli.test.ts` passed, `bun run typecheck` passed, `git diff --check`
passed, and targeted Prettier for issue-touched files passed. Repository-wide
`bun run format:check` still reports unrelated pre-existing warnings in 72
files outside this issue slice.

## Related Plans

- **Previous**: `impl-plans/workflow-usage-discovery.md`
- **Next**: none
- **Depends On**: accepted design updates in `design-docs/specs/command.md` and
  `design-docs/specs/notes.md`
