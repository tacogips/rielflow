# Output Contract Adapter Envelope Normalization Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-output-contract.md#output-contract-adapter-envelope-normalization`
**Created**: 2026-05-04
**Last Updated**: 2026-05-05

## Summary

Fix output-contract runtime normalization so review workers may return an
adapter-shaped envelope such as
`{"when":{"needs_revision":true},"payload":{...}}` without that envelope being
treated as the schema-validated business payload. The runtime must unwrap valid
envelopes before JSON Schema validation and before transition evaluation for
both inline adapter payloads and reserved candidate-file submissions.

## Source Trace

- Issue: `tacogips/divedra` / `Route review revisions when output-contract workers return adapter envelopes`
- Workflow: `design-and-implement-review-loop`
- Mode: `full-issue-resolution`
- Accepted design: `step3-design-review` via `comm-000008`, `codex-agent` / `gpt-5.5`
- Primary design source: `design-docs/specs/design-node-output-contract.md`
- Supporting design source: `design-docs/specs/architecture.md`

Intentional design alignment:

- Validate only the nested `payload` object when a valid envelope is present.
- Publish the nested object as `output.payload`.
- Evaluate outgoing transition labels against the normalized envelope `when`.
- Record normalized business payloads in `output-attempts/*/candidate.json`.
- Treat invalid envelope shapes as output-contract validation failures.

## Scope

Included:

- shared envelope normalization behavior for output-contract nodes
- workflow-run engine integration
- `call-step` execution integration
- regression tests for inline payloads, reserved candidate files, invalid
  envelopes, schema validation, artifacts, and routing

Not included:

- changing the published `output.json` envelope format for non-contract nodes
- allowing `candidateFilePath` for non-contract nodes
- broad transition-expression or JSON Schema changes
- mailbox/output publication ownership changes

## Tasks

### TASK-001: Shared Envelope Normalization

**Status**: Completed
**Parallelizable**: No
**Dependencies**: None
**Deliverables**:

- `src/workflow/adapter.ts`
- `src/workflow/adapter.test.ts`

**Function Contract**:

```ts
export interface OutputContractEnvelopeNormalization {
  readonly completionPassed: boolean;
  readonly when: Readonly<Record<string, boolean>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly usedEnvelope: boolean;
}

export function normalizeOutputContractEnvelope(
  value: Readonly<Record<string, unknown>>,
  source: string,
  defaults: {
    readonly completionPassed: boolean;
    readonly when: Readonly<Record<string, boolean>>;
  },
): OutputContractEnvelopeNormalization;
```

**Completion Criteria**:

- [x] object without `when` returns original object as business payload
- [x] object with boolean-map `when` and object `payload` unwraps successfully
- [x] optional `completionPassed` overrides only when boolean
- [x] invalid `when`, missing/non-object `payload`, or invalid
      `completionPassed` are rejected as `invalid_output`
- [x] helper behavior is covered by focused unit tests

### TASK-002: Workflow Run Engine Integration

**Status**: Completed
**Parallelizable**: Yes
**Dependencies**: TASK-001
**Deliverables**:

- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`

**Completion Criteria**:

- [x] normalize inline output-contract candidates before schema validation
- [x] normalize reserved candidate-file payloads before schema validation
- [x] write normalized nested payload to `output-attempts/*/candidate.json`
- [x] publish normalized `completionPassed`, `when`, and business `payload`
- [x] route `needs_revision` to the revision step and not to
      `!(needs_revision)` when the envelope says revision is needed
- [x] invalid envelope shape enters the output-contract retry/failure path

### TASK-003: Call-Step Integration

**Status**: Completed
**Parallelizable**: Yes
**Dependencies**: TASK-001
**Deliverables**:

- `src/workflow/call-step-impl.ts`
- `src/workflow/call-step-impl.test.ts`

**Completion Criteria**:

- [x] `OutputValidator` returns normalized `payload`, `when`, and
      `completionPassed` for output-contract nodes
- [x] `callStepExecution` publishes normalized envelope fields instead of the
      adapter default `when`
- [x] reserved candidate-file envelope submissions behave like inline
      submissions
- [x] invalid envelopes are retryable validation failures when attempts remain
- [x] non-contract candidate-file rejection remains unchanged

### TASK-004: Regression Verification and Plan Progress

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-002, TASK-003
**Deliverables**:

- `impl-plans/output-contract-adapter-envelope-normalization.md`
- implementation progress log updates in this plan

**Completion Criteria**:

- [x] focused tests pass
- [x] type checking passes
- [x] full test suite passes or any unrelated failure is documented
- [x] progress log records implementation session, review findings, and
      verification commands

## Dependencies

| Task     | Depends On         | Reason                                              |
| -------- | ------------------ | --------------------------------------------------- |
| TASK-001 | accepted design    | defines envelope recognition rules                  |
| TASK-002 | TASK-001           | engine should use one shared normalization contract |
| TASK-003 | TASK-001           | call-step should match workflow-run semantics       |
| TASK-004 | TASK-002, TASK-003 | final verification requires both runtime paths      |

## Parallelization

After TASK-001 lands, TASK-002 and TASK-003 may run concurrently because their
primary write scopes are disjoint:

- TASK-002: `src/workflow/engine.ts`, `src/workflow/engine.test.ts`
- TASK-003: `src/workflow/call-step-impl.ts`,
  `src/workflow/call-step-impl.test.ts`

Do not run TASK-002 and TASK-003 concurrently if either task needs to move the
shared helper or modify the same adapter-level tests.

## Verification Plan

Run, at minimum:

```bash
bun test src/workflow/adapter.test.ts src/workflow/engine.test.ts src/workflow/call-step-impl.test.ts
bun run typecheck
bun test
```

Targeted behavioral checks:

- output-contract inline envelope with `when.needs_revision: true` routes to
  revision
- output-contract reserved candidate-file envelope routes the same way
- `output-attempts/*/candidate.json` contains the nested business payload
- schema validation sees the nested business payload, not the outer envelope
- invalid envelope fields produce retry feedback and terminal
  `output_validation_failed` when attempts are exhausted

## Progress Log

### Session: 2026-05-04 00:00

**Tasks Completed**: implementation plan creation
**Tasks In Progress**: none
**Blockers**: none
**Notes**: Plan follows the accepted Step 3 design and targets both workflow-run
and call-step execution paths so output-contract adapter envelopes have one
routing and validation contract.

### Session: 2026-05-04 01:00

**Tasks Completed**: Step 5 implementation-plan review feedback addressed
**Tasks In Progress**: none
**Blockers**: none
**Notes**: Added explicit per-task dependency fields and registered the plan in
`impl-plans/PROGRESS.json` so planning automation can discover and track
TASK-001 through TASK-004.

### Session: 2026-05-05 16:40 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004
**Tasks In Progress**: none
**Blockers**: none
**Notes**: Finished the remaining envelope-normalization work by adding focused
adapter helper coverage, extending workflow-run regression coverage for reserved
candidate-file and invalid-envelope paths, and updating direct `call-step`
validation/publication to use normalized `completionPassed` and `when` fields
instead of adapter defaults.

**Verification**:

- `bun test src/workflow/adapter.test.ts`
- `bun test src/workflow/call-step-impl.test.ts`
- `bun test src/workflow/engine.test.ts -t "uses adapter envelope from output-contract payload for transitions"`
- `bun test src/workflow/engine.test.ts -t "normalizes reserved candidate-file envelopes before publishing output"`
- `bun test src/workflow/engine.test.ts -t "retries invalid output-contract envelopes before publishing output"`
- `bun run typecheck`
- `bun test src/workflow/adapter.test.ts src/workflow/engine.test.ts src/workflow/call-step-impl.test.ts`
- `bun test`
