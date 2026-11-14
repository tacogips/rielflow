# Runtime-Owned External Output Publication Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#output-ownership, design-docs/specs/notes.md
**Created**: 2026-03-08
**Last Updated**: 2026-04-27 (helper name in doc: `isWorkflowOutputKindNode`, not structural "root scope")

---

## Design Document Reference

**Source**: consolidated into `design-docs/specs/architecture.md` and `design-docs/specs/notes.md`

### Summary

Harden external workflow-result publication so the runtime always publishes from the latest accepted `output` **kind** node execution (`nodes[].kind === "output"`, `isWorkflowOutputKindNode`) in the current `workflowExecutionId`. This is not the removed structural sub-workflow model; it is the per-workflow output node role.

This work must preserve the existing runtime-owned mailbox boundary and explicitly reject any interpretation of "session final response" that would let a later manager turn or arbitrary last node execution override the publishable workflow result.

### Scope

**Included**:
- make the external-output publication rule explicit in runtime code
- centralize source selection for external publication behind a narrow helper
- ensure publication reads from accepted node execution artifacts only
- keep `workflowOutput` runtime variable behavior aligned with the same output-kind selection rule
- add regression tests for manager-after-output, multiple output-kind successes, no eligible output, corrupted source artifacts, and publication-write failure cases

**Excluded**:
- new workflow configuration fields
- changes to mailbox directory shape
- changes to adapter contracts
- fallback publication from manager responses or non-output nodes
- UI/editor changes

---

## Purpose For The Implementing Agent

Implement this as a boundary-hardening change, not as a behavior expansion.

The point is not to invent a new publication mechanism. The point is to make the existing intended rule impossible to accidentally regress:

- external output publication is runtime-owned
- the publication source is artifact-based
- only accepted `output` kind node executions are eligible (`isWorkflowOutputKindNode`)
- "last session response" is not an eligible source selector

When reading existing code, treat any logic that depends on execution chronology without checking node kind/scope/status as suspicious.

---

## Modules

### 1. External Output Source Selection

#### `src/workflow/engine.ts`

**Status**: COMPLETED

```ts
interface ExternalOutputPublicationCandidate {
  readonly execution: NodeExecutionRecord;
  readonly outputRef: OutputRef;
}

function isWorkflowOutputKindNode(workflow: WorkflowJson, nodeId: string): boolean;

function findLatestPublishedWorkflowResult(
  workflow: WorkflowJson,
  session: WorkflowSessionState,
): NodeExecutionRecord | undefined;

async function readOutputPayloadArtifact(
  artifactDir: string,
): Promise<Result<Readonly<Record<string, unknown>>, string>>;

async function persistExternalMailboxOutputCommunication(input: {
  readonly artifactWorkflowRoot: string;
  readonly workflow: WorkflowJson;
  readonly session: WorkflowSessionState;
  readonly execution: NodeExecutionRecord;
  readonly outputPayload: Readonly<Record<string, unknown>>;
  readonly communicationCounter: number;
  readonly createdAt: string;
}): Promise<CommunicationRecord>;
```

**Implementation instructions**:
- Audit the existing external publication path and make sure there is exactly one source-selection helper used for external publication.
- Keep source selection based on `session.nodeExecutions` ordering, filtered to `status === "succeeded"` and node refs with kind `output` (via `isWorkflowOutputKindNode`) only.
- Do not select based on the last executed node generically.
- Do not select based on manager responses, mailbox timestamps, or raw provider responses.
- Ensure publication payload is loaded from the selected execution artifact `output.json`, not from any in-memory "last response" shortcut.
- If a helper already exists and already matches the design, keep the implementation minimal and focus on making the invariant harder to bypass.

**Checklist**:
- [x] External publication uses one explicit output-kind source-selection helper
- [x] Helper filters by node kind `output` (`isWorkflowOutputKindNode`) and `succeeded` status
- [x] Publication payload is read from the selected execution artifact
- [x] No fallback to arbitrary last session response remains

---

### 2. Runtime Variable Alignment

#### `src/workflow/engine.ts`

**Status**: COMPLETED

```ts
function isWorkflowOutputKindNode(workflow: WorkflowJson, nodeId: string): boolean;
```

**Implementation instructions**:
- Confirm that `session.runtimeVariables.workflowOutput` is written only from successful `output` kind node executions.
- Keep its meaning aligned with external publication semantics.
- If there is duplicated output-kind detection logic, collapse it so publication and `workflowOutput` use the same predicate (`isWorkflowOutputKindNode`).

**Checklist**:
- [x] `workflowOutput` continues to reflect `output` kind node payloads only
- [x] Output-kind predicate is shared rather than re-implemented inconsistently

---

### 3. Regression Tests

#### `src/workflow/engine.test.ts`

**Status**: COMPLETED

```ts
test("publishes the latest root output node result when a manager runs again afterward", async () => {});

test("publishes the later root output node result when multiple root output executions succeed", async () => {});

test("does not publish an external output when no root output execution succeeds", async () => {});

test("fails deterministically when the selected external output artifact is corrupted", async () => {});

test("fails deterministically when external output publication cannot persist its mailbox artifacts", async () => {});
```

**Implementation instructions**:
- Keep the existing manager-after-output regression test and strengthen it if needed.
- Add a multi-root-output case proving the later successful root `output` node supersedes the earlier one.
- Add a no-root-output case proving session completion can occur without external publication.
- Add a corrupted-artifact case proving the runtime fails rather than falling back to any heuristic "last response" behavior.
- Add a mailbox-persistence-failure case proving the runtime fails rather than reporting external publication success.
- Assert not only communication metadata but also the contents of `outbox/{fromNodeId}/output.json`.

**Checklist**:
- [x] Existing manager-after-output regression remains passing
- [x] Multi-root-output precedence is covered
- [x] No-root-output no-publication behavior is covered
- [x] Corrupted selected artifact failure path is covered
- [x] External mailbox persistence failure path is covered

---

### 4. Design Consistency References

#### `design-docs/specs/architecture.md`, `design-docs/specs/notes.md`

**Status**: COMPLETED

```ts
type NoCodeChangeRequired = true;
```

**Implementation instructions**:
- No design rewrite is required unless the implementation discovers a contradiction.
- If code behavior differs from the new design, update code first and touch docs only where the implementation would otherwise remain ambiguous.
- Do not add new behavior to fit speculative future fallbacks.

**Checklist**:
- [x] Implementation remains consistent with current design docs
- [x] No undocumented fallback source is introduced

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| External publication source selection | `src/workflow/engine.ts` | COMPLETED | `src/workflow/engine.test.ts` |
| Runtime variable alignment | `src/workflow/engine.ts` | COMPLETED | `src/workflow/engine.test.ts` |
| Regression coverage | `src/workflow/engine.test.ts` | COMPLETED | target coverage |
| Design consistency check | `design-docs/specs/*.md` | COMPLETED | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| External publication hardening | Existing mailbox/output-contract runtime | Available |
| Regression tests | External publication hardening | COMPLETED |
| Optional doc touch-up | Verified runtime behavior | COMPLETED |

## Completion Criteria

- [x] External output publication is sourced only from the latest accepted root-scope `output` node execution
- [x] Publication reads from the accepted artifact `output.json`
- [x] Later manager or non-output executions do not override the external publication source
- [x] No-output workflows do not emit a fake external result
- [x] Corrupted selected artifacts cause deterministic failure rather than heuristic fallback
- [x] External mailbox persistence failures cause deterministic failure rather than partial publish success
- [x] Type checking passes
- [x] Relevant workflow engine tests pass

## Suggested Verification Commands

```bash
bun run typecheck
bun test src/workflow/engine.test.ts
```

If the implementing agent changes shared workflow helpers beyond `engine.ts`, run the full suite:

```bash
bun test
```

## Progress Log

### Session: 2026-03-08 20:45
**Tasks Completed**: Implementation plan creation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Existing code already appears close to the desired rule via `findLatestPublishedWorkflowResult(...)`. The main risk is future regression or hidden alternative publication paths, so implementation should prefer consolidation and regression coverage over large refactors.

### Session: 2026-03-08 21:10
**Tasks Completed**: External publication fallback removal, regression test additions, design consistency verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The actual runtime mismatch was a completion-time fallback to the last executed node when no root output existed. Implementation now publishes only from `findLatestPublishedWorkflowResult(...)`, preserving artifact-based semantics and allowing completed runs with no external output publication.

### Session: 2026-03-08 21:18
**Tasks Completed**: Verification commands
**Tasks In Progress**: None
**Blockers**: `bun run typecheck` still depends on `svelte-check`, which is not installed in the current shell; server-side `tsc --noEmit` passed and `bun test src/workflow/engine.test.ts` passed
**Notes**: Validation confirmed the hardened publication rule and its regressions. The repository-level UI typecheck issue is environmental and unrelated to the workflow runtime changes in this plan.

### Session: 2026-03-08 23:25
**Tasks Completed**: Design/plan alignment for publication-write failure semantics, failure-message hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Follow-up review found the runtime already treated external mailbox persistence failure as a deterministic terminal error, but the design text only documented source-artifact corruption. The spec and plan now explicitly cover mailbox write failure, and the runtime error path identifies the specific source node execution involved.

### Session: 2026-03-08 22:30
**Tasks Completed**: Final-publication failure persistence hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review of the in-progress diff found that publication-time artifact read failures returned an error without persisting a terminal failed session, leaving resumed runs in a misleading paused state. The runtime now records a failed terminal session with `lastError`, and regression coverage asserts the persisted failure state.

### Session: 2026-03-08 21:32
**Tasks Completed**: Follow-up contract hardening for output artifact reads
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Tightened `readOutputPayloadArtifact(...)` so runtime-published artifact reads reject JSON arrays in addition to primitives and `null`, matching the documented top-level object contract. Updated the corrupted-external-output regression to cover the array-shaped artifact case explicitly.

### Session: 2026-03-08 21:45
**Tasks Completed**: Mailbox receipt ownership audit fix for external input/output communications
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review of the existing diff found that external mailbox `receipt.json` files were recording pseudo mailbox/sender nodes as `deliveredByNodeId`, even though the manager owns mailbox writes. Updated the runtime to record the actual root manager node and added regression coverage for both external input and external output receipts.

### Session: 2026-03-08 22:40
**Tasks Completed**: External publication write-failure persistence hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Follow-up review found that the runtime persisted a failed terminal session when the selected source artifact could not be read, but not when the external mailbox communication itself failed to write. The completion path now saves `status: failed` with a publication-specific error before returning, and regression coverage blocks silent escape from mailbox artifact write failures.

### Session: 2026-03-08 23:45
**Tasks Completed**: Terminal-session persistence hardening review
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Follow-up review found one remaining gap between design wording and runtime enforcement: publication failure paths updated the in-memory session to `failed` but ignored `saveSession(...)` failures. The runtime now checks terminal persistence in those external-publication failure branches and reports a combined error if the failed terminal state cannot be saved.

### Session: 2026-03-08 23:50
**Tasks Completed**: External-output source-read failure message hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Follow-up review found that corrupted selected-artifact failures persisted a failed terminal session, but the error text still surfaced only the raw artifact-read message. The runtime now prefixes that branch with the selected source node id and node execution id so failure reporting matches the design requirement to identify which accepted execution could not be published.

### Session: 2026-03-08 23:55
**Tasks Completed**: Completed-session persistence hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review of the current diff found that successful external publication could still be followed by an ignored `saveSession(...)` failure for the final terminal `completed` snapshot, causing the runtime to report success even though the canonical session state was not durably persisted. The completion path now returns an explicit failure in that case, and regression coverage forces the terminal session-file write to fail only for the completed snapshot.

### Session: 2026-03-08 13:15
**Tasks Completed**: Post-completion regression hardening and runtime refactor cleanup
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation review found that the publication tests covered manager-after-output and multiple-root-output precedence, but not the case where a later successful root-scope non-output worker executes after the publishable output exists. Added a focused regression proving the runtime still publishes from the latest successful root `output` node only, and collapsed duplicated terminal publication-failure handling in `src/workflow/engine.ts` into one helper so future failure-path changes cannot drift between artifact-read and mailbox-write branches.

## Related Plans

- **Previous**: `impl-plans/node-output-contract-and-validation.md`
- **Next**: None
- **Depends On**: `impl-plans/divedra-manager-prompt-contract.md`, `impl-plans/node-output-contract-and-validation.md`
