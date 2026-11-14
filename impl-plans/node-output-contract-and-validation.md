# Node Output Contract And Validation Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-node-output-contract.md
**Created**: 2026-03-07
**Last Updated**: 2026-03-07

## Summary

Add optional per-node output contracts so the runtime can validate LLM-produced business payloads against JSON Schema before publishing `output.json` and before writing mailbox snapshots.

## Scope

Included:

- node payload schema support for `output.description`, `output.jsonSchema`, and `output.maxValidationAttempts`
- workflow validation for the output-contract shape and supported JSON Schema subset
- runtime output-attempt loop with retry feedback
- artifact persistence for candidate payloads and validation results
- adapter input extensions so backends receive runtime context and prior validation failures
- targeted tests for validation and engine behavior

Not included:

- remote `$ref` resolution
- schema registries
- UI/editor support for authoring schemas
- provider-specific structured-output APIs

## Modules

### 1. Workflow Types

#### `src/workflow/types.ts`

```ts
export interface JsonSchemaObject {
  readonly [key: string]: JsonSchemaValue;
}

export type JsonSchemaValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonSchemaValue[]
  | JsonSchemaObject;

export interface NodeOutputContract {
  readonly description?: string;
  readonly jsonSchema?: JsonSchemaObject;
  readonly maxValidationAttempts?: number;
}

export interface NodePayload {
  readonly id: string;
  readonly model: string;
  readonly promptTemplate: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly output?: NodeOutputContract;
}
```

**Checklist**:
- [x] Add output-contract types
- [x] Keep existing node payloads backward compatible

### 2. Workflow Validation

#### `src/workflow/validate.ts`

```ts
function normalizeNodeOutputContract(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeOutputContract | undefined;
```

#### `src/workflow/json-schema.ts`

```ts
export interface JsonSchemaValidationError {
  readonly path: string;
  readonly message: string;
}

export function validateJsonSchemaDefinition(
  schema: JsonSchemaObject,
): readonly JsonSchemaValidationError[];

export function validateJsonValueAgainstSchema(input: {
  readonly schema: JsonSchemaObject;
  readonly value: unknown;
}): readonly JsonSchemaValidationError[];
```

**Checklist**:
- [x] Reject malformed output contracts
- [x] Reject unsupported JSON Schema keywords
- [x] Validate candidate payloads against the supported subset

### 3. Adapter Input/Output Contract

#### `src/workflow/adapter.ts`

```ts
export interface AdapterOutputValidationFeedback {
  readonly attempt: number;
  readonly errors: readonly JsonSchemaValidationError[];
}

export interface AdapterOutputRuntimeContext {
  readonly artifactDir: string;
  readonly candidatePath: string;
}
```

**Checklist**:
- [x] Extend adapter input with output contract and retry feedback
- [x] Optionally accept file-based candidate output paths

### 4. Execution Engine

#### `src/workflow/engine.ts`

**Checklist**:
- [x] Append output-contract guidance to the execution prompt
- [x] Persist per-attempt candidate and validation artifacts
- [x] Retry invalid outputs up to the configured limit
- [x] Publish `output.json` only after validation succeeds
- [x] Fail the node cleanly when validation retries are exhausted

### 5. Tests

#### `src/workflow/validate.test.ts`
#### `src/workflow/engine.test.ts`
#### `src/workflow/adapters/*.test.ts`

**Checklist**:
- [x] Cover valid and invalid node output contracts
- [x] Cover successful retry after schema failure
- [x] Cover terminal failure after retry exhaustion
- [x] Cover adapter request payload extensions

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Workflow types | `src/workflow/types.ts` | COMPLETED | - |
| Workflow validation | `src/workflow/validate.ts`, `src/workflow/json-schema.ts` | COMPLETED | `src/workflow/validate.test.ts` |
| Adapter contract | `src/workflow/adapter.ts`, `src/workflow/adapters/*.ts` | COMPLETED | adapter tests |
| Execution engine | `src/workflow/engine.ts` | COMPLETED | `src/workflow/engine.test.ts` |
| Tests | `src/workflow/*.test.ts` | COMPLETED | target coverage |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Workflow validation | Workflow types | COMPLETED |
| Adapter contract | Workflow types | COMPLETED |
| Execution engine | Workflow validation, Adapter contract | COMPLETED |
| Tests | All implementation modules | COMPLETED |

## Completion Criteria

- [x] Nodes may declare optional output contracts in `node-{id}.json`
- [x] Invalid schema definitions are rejected at workflow validation time
- [x] Runtime retries invalid payloads with actionable feedback
- [x] Invalid candidate payloads never reach mailbox publication
- [x] Type checking passes
- [x] Targeted tests pass

## Progress Log

### Session: 2026-03-07 00:00
**Tasks Completed**: Design review and implementation plan creation
**Tasks In Progress**: Workflow types and validation design
**Blockers**: No dedicated JSON Schema validator dependency is declared, so the first cut will implement and enforce a documented supported subset locally
**Notes**: Keep the existing output envelope shape stable and apply schema validation to `output.payload` only so downstream semantics remain backward compatible.

### Session: 2026-03-07 02:00
**Tasks Completed**: Workflow types, JSON Schema subset validator, adapter contract extension, engine retry/publication flow, targeted and full test verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added audited `output-attempts/` artifacts, schema-driven retry feedback, optional candidate-file support, and completed verification with `bun run typecheck` plus full `bun test`.

### Session: 2026-03-07 04:00
**Tasks Completed**: Post-implementation design/code review, runtime boundary hardening for candidate file paths, prompt contract tightening, regression test additions
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Removed publish-path exposure from adapter prompt guidance, required file-based candidate output to use the reserved runtime candidate path, and added regression tests so runtime-owned publication remains enforceable rather than advisory.

### Session: 2026-03-07 05:00
**Tasks Completed**: Post-review adapter compatibility fix for official SDK backends, focused regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Official OpenAI/Anthropic SDK adapters now parse contract-enabled model text as a JSON object candidate instead of returning their legacy `{text,response}` wrapper, so output-contract nodes behave consistently across CLI-wrapper and SDK backends.

### Session: 2026-03-07 06:00
**Tasks Completed**: Boundary-hardening review follow-up, input artifact contract tightening, focused regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Removed final publish-path metadata from the node `input.json` output-contract block so runtime-owned publication is no longer exposed even in execution artifacts prepared before adapter invocation; kept only declarative schema guidance and candidate-path delivery inside the runtime retry loop.

### Session: 2026-03-07 07:00
**Tasks Completed**: Post-implementation review follow-up for published artifact hygiene, focused regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Stopped publishing execution-only output-contract prompt augmentation in `output.json`; candidate paths and retry feedback now remain internal to adapter execution while published output keeps the base node prompt text.

### Session: 2026-03-07 08:00
**Tasks Completed**: Review follow-up for validation diagnostics, focused regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Removed spurious parent-level JSON Schema diagnostics caused by sibling validation failures and tightened node output-contract validation so malformed `jsonSchema` no longer triggers a misleading `maxValidationAttempts requires output.jsonSchema` error.

### Session: 2026-03-07 11:10
**Tasks Completed**: Second-pass protocol review, runtime-owned publication contract hardening, regression coverage update
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Made runtime-owned `output.json`/mailbox publication explicit in adapter-facing contract and prompt guidance, documented that future `communicationId` values stay hidden until publication, and added regression tests so this boundary remains enforced for future adapter work.

### Session: 2026-03-07 12:05
**Tasks Completed**: Post-review usability hardening for reserved candidate-file submission
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The engine now pre-creates each `output-attempts/attempt-*/` directory before adapter invocation so file-based candidate submission can write directly to the reserved path without ad hoc directory creation; added a regression test covering direct write-to-candidate-path behavior.

### Session: 2026-03-07 11:17
**Tasks Completed**: Post-implementation persistence review, runtime DB/session metadata hardening, full regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Promoted `outputAttemptCount` and `outputValidationErrors` from `meta.json`-only diagnostics into persisted session/runtime-DB execution records, added SQLite schema migration coverage for existing databases, and verified with `bun run typecheck`, focused workflow adapter tests, and full `bun test`.

### Session: 2026-03-07 11:19
**Tasks Completed**: Design/code consistency review follow-up for schema root constraints
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Tightened output-contract schema validation so workflow authors cannot declare a non-object root schema that the runtime can never satisfy, and added regression coverage at both JSON-schema and workflow-validation layers.

### Session: 2026-03-07 11:21
**Tasks Completed**: Post-review combinator root-schema hardening, full regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Extended the top-level object admissibility guard so `anyOf`/`oneOf`/`allOf` and `const`/`enum` roots that cannot possibly yield an object are rejected at validation time, then re-ran focused schema tests, `bun run typecheck`, and full `bun test`.

### Session: 2026-03-07 12:40
**Tasks Completed**: Review follow-up for retry-attempt simulation consistency, scenario-adapter regression coverage
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The built-in deterministic scenario adapter now keys contract-enabled response sequences off `output.attempt`, so output-validation retries can be simulated without a custom adapter while preserving the existing node execution counter semantics.

### Session: 2026-03-07 13:05
**Tasks Completed**: Post-implementation usability review follow-up for contract authoring and retry prompt hygiene
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Empty `output` contracts are now rejected because they silently changed prompt/runtime behavior without declaring any useful contract, and retry feedback is now intentionally truncated so validation-repair prompts stay compact and predictable.

### Session: 2026-03-07 13:30
**Tasks Completed**: Legacy-path artifact hygiene review follow-up, non-contract candidate-file boundary tightening, regression coverage update
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Non-contract nodes no longer emit `output-attempts/*` artifacts and may not submit `candidateFilePath`; file-based candidate submission is now reserved strictly for nodes that declare `output`, keeping the runtime contract narrower and the artifact model cleaner.
**Tasks Completed**: Post-implementation review follow-up for reserved candidate staging freshness
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The runtime now deletes any pre-existing reserved candidate staging file before each adapter attempt so stale temp output from a previous run cannot be reused accidentally; added regression coverage for same-session-id reruns that reference the staging path without writing a new candidate.

### Session: 2026-03-07 13:35
**Tasks Completed**: Post-review usability wording fix for description-only contract retries, regression coverage update
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Retry prompts now distinguish schema-backed versus description-only contracts so the repair instruction does not incorrectly demand schema conformance when no schema exists.

### Session: 2026-03-07 13:40
**Tasks Completed**: Post-implementation hardening review for schema equality semantics and contract-enabled SDK parsing
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Switched JSON Schema `const`/`enum` comparison to canonical key-order-insensitive equality so object-valued contracts behave correctly, and relaxed contract-enabled SDK parsing to accept a single fenced JSON object block in addition to bare JSON so common LLM formatting does not cause needless validation retries.

### Session: 2026-03-07 13:45
**Tasks Completed**: Post-review repair-loop hardening for malformed contract submissions
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Reserved candidate-file read/parse failures now re-enter the schema-repair loop when attempts remain, matching inline invalid-output behavior; reserved-path violations remain terminal because they indicate an adapter/runtime boundary breach rather than an LLM payload mistake. Contract-enabled adapter `invalid_output` failures continue to feed the same corrective retry path, so malformed JSON/object submissions are consistently repairable until the attempt budget is exhausted.

### Session: 2026-03-07 11:37
**Tasks Completed**: Post-implementation mixed-failure review follow-up, regression coverage update
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Cleared stale validation diagnostics when a later retry ends in provider failure or timeout so session metadata and `lastError` reflect the terminal adapter failure instead of incorrectly reporting an output-validation failure; added a regression test covering schema-invalid first attempt followed by provider failure.

### Session: 2026-03-07 13:55
**Tasks Completed**: Post-review usability hardening for description-only output contracts
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Relaxed `output.maxValidationAttempts` so description-only contracts can retry malformed/non-object candidate submissions even without `jsonSchema`; kept schema validation optional and added validation/engine regression coverage for the new contract shape.

### Session: 2026-03-07 14:10
**Tasks Completed**: Post-review contract-authoring strictness hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Tightened workflow validation so `output.description` cannot be blank and unknown keys inside `node.output` are rejected, preventing typo-driven silent misconfiguration and making contract authoring failures explicit before runtime execution.

### Session: 2026-03-07 15:05
**Tasks Completed**: Post-review execution-attempt auditability hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added per-attempt `request.json` artifacts so the exact contract prompt augmentation and retry feedback sent on each validation attempt are preserved for debugging and review without leaking execution-only metadata into published `output.json` or mailbox snapshots.

### Session: 2026-03-07 15:30
**Tasks Completed**: Post-review validator feedback hardening, full regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Removed a misleading fallback validation error when `output.jsonSchema` is present but malformed, so contract authors now see only the concrete schema diagnostics instead of an additional false "missing output contract" message; re-ran `bun run typecheck` and full `bun test`.

### Session: 2026-03-07 16:05
**Tasks Completed**: Post-review reserved candidate staging isolation hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Moved the adapter-visible candidate submission path out of the final node artifact directory into dedicated temp staging so file-based structured output no longer reveals `output.json` by simple parent-directory inference; runtime still copies accepted candidates into `output-attempts/*/candidate.json` for audit history.

### Session: 2026-03-07 16:20
**Tasks Completed**: Post-review legacy SDK payload compatibility hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Removed an accidental `outputAttempt` field from the non-contract OpenAI/Anthropic SDK payload envelope so existing workflows keep the pre-contract payload shape; added regression assertions for both official SDK adapters.

### Session: 2026-03-07 16:45
**Tasks Completed**: Post-review temp-staging lifecycle hardening, regression coverage update
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Reserved candidate staging files/directories under `/tmp/divedra-output-candidates/...` are now deleted after every attempt, while the runtime-preserved audit copy remains under `output-attempts/*`; added success/failure cleanup regression coverage so temp staging cannot silently accumulate.

### Session: 2026-03-07 17:10
**Tasks Completed**: Post-review failure-semantics hardening, full regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Narrowed `output_validation_failed` classification so it only applies to contract-enabled nodes; plain adapter candidate-file failures now remain `invalid_output`, preserving clearer operational semantics. Added regression coverage for the non-contract candidate-file edge case and re-ran `bun run typecheck`, focused engine tests, and full `bun test`.

### Session: 2026-03-07 17:35
**Tasks Completed**: External-wrapper publication-boundary hardening, adapter regression coverage, design/doc consistency update
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Contract-enabled Codex/Claude wrapper requests now omit `artifactDir`, so the reserved temp candidate path remains the only adapter-visible structured-output write target for external LLM processes; added unit tests covering the redaction and updated design references to document the stricter boundary.

### Session: 2026-03-07 17:45
**Tasks Completed**: Runtime DB migration review, legacy-schema regression coverage
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added a regression test that starts from a pre-output-contract SQLite `node_executions` schema, lets `ensureSchema` migrate it in place, and verifies output-validation retry metadata persists correctly after the upgrade path.

### Session: 2026-03-07 18:05
**Tasks Completed**: Final design/code review pass, top-level documentation sync
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-verified the runtime-owned publication boundary and full regression status (`bun run typecheck`, `bun test`), then surfaced the `node.output` contract and runtime validation/publish responsibilities in `README.md` so the feature is discoverable outside the detailed design docs.

### Session: 2026-03-07 18:20
**Tasks Completed**: Final artifact-consistency review, failure-envelope auditability fix, full regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Standardized terminal failure `output.json` envelopes so they preserve the assembled base prompt text just like successful executions, improving post-mortem usability and artifact consistency without relaxing the runtime-owned mailbox/output publication boundary; re-ran `bun run typecheck`, focused workflow tests, and full `bun test`.

### Session: 2026-03-07 18:45
**Tasks Completed**: Independent design/code review pass, implementation-plan closure confirmation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-audited the current diff against `design-docs/specs/design-node-output-contract.md` and found no blocking mismatches. Verified the end-to-end contract again with `bun run typecheck`, focused workflow tests, and full `bun test`; no further runtime changes were necessary in this pass.

### Session: 2026-03-07 19:10
**Tasks Completed**: Artifact contract consistency follow-up, focused regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added explicit `workflowExecutionId` to persisted node `input.json` artifacts while retaining `sessionId` for compatibility, so artifact inspection now matches the adapter/runtime contract terminology. Re-ran `bun run typecheck` and the focused workflow/adapter test suite after the patch.

### Session: 2026-03-07 19:25
**Tasks Completed**: Retry-feedback boundary hardening, focused regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Kept full validation diagnostics in `validation.json` and terminal `output.json`, but now compact the adapter-facing/request-facing retry feedback slice before sending it through `output.validationErrors` and `output-attempts/*/request.json`. This keeps corrective prompts and external-wrapper request payloads bounded without losing audit detail. Verified with `bun run typecheck` and focused workflow/runtime validation tests.
