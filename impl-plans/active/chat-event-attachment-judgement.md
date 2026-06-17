# Chat Event Attachment Judgement Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-chat-sdk-event-sources.md#attachment-judgement-workflow-extension
**Created**: 2026-05-29
**Last Updated**: 2026-05-29

---

## Design Document Reference

**Source**: design-docs/specs/design-chat-sdk-event-sources.md

### Summary

Add deterministic chat event attachment handling for the Chat SDK generic
boundary and a runnable `chat-event-attachment-judgement` example workflow.
Incoming `chat.message` events may include image and PDF attachment descriptors
under `event.input.attachments[]`; the runtime must preserve safe descriptors
through normalization and event input mapping so the example workflow can judge
attachment contents without live provider credentials, remote downloads, OCR, or
PDF parsing dependencies.

### Scope

**Included**: normalized attachment descriptor types and validation behavior,
safe `contentRef` checks, inline deterministic evidence size bounds, source
redaction expectations, `mode: "event-input"` and template input mapping tests,
deterministic image/PDF/unsupported payload fixtures, event-source binding
updates, runnable example workflow bundle, expected results, README refresh, and
focused unit tests.

**Excluded**: live provider attachment downloads, OCR, PDF parsing,
provider-specific SDK integrations, direct `@chat-adapter/*` dependencies,
secret-bearing fixture data, and changes to unrelated event sources.

### Accepted Design Decisions

- `workflowMode` remains `issue-resolution`.
- Attachments stay provider-neutral under `event.input.attachments[]`.
- First pass classification uses deterministic fixture fields such as
  `textContent`, `imageDescription`, and `classificationHints`.
- Unsupported or evidence-free attachments must be classified as
  `needsManualReview: true` rather than failing the whole workflow run.
- Unknown safe attachment metadata may be preserved, but invalid attachment
  entries and unsafe refs must be rejected before receipt persistence.
- Chat SDK `mirrorToHumanInput` defaults to true for chat-sdk sources, while an
  explicit binding value must still be honored; both paths need tests.

### Codex Reference Mapping

- `AGENTS.md`: TypeScript changes require standards compliance and
  post-modification checks; commits must not include assistant attribution.
- `codex-design-and-implement-review-loop`: all implementation and review work
  happens through this workflow run.
- `examples/design-and-implement-review-loop/`: reference for Codex-agent
  review-gated workflow structure.
- `examples/discord-codex-chat/`: reference for chat workflow structure and
  chat reply worker usage.
- `packages/rielflow/src/events/adapters/chat-sdk/normalization.ts`: current
  Chat SDK normalization surface that reads `message.attachments`.
- `packages/rielflow/src/events/input-mapping.ts`: current event-to-workflow
  input mapping that must preserve attachments.

### Intentional Divergences

- Do not copy Codex- or Discord-specific chat behavior into the new classifier;
  the example must stay provider-neutral.
- Do not add live download, OCR, or PDF parsing dependencies in this issue; use
  deterministic descriptors and fixture evidence as accepted by the design.

---

## Modules

### 1. Chat SDK Attachment Descriptor Normalization

#### packages/rielflow/src/events/adapters/chat-sdk/types.ts
#### packages/rielflow/src/events/adapters/chat-sdk/normalization.ts
#### packages/rielflow/src/events/adapters/chat-sdk.test.ts

**Status**: COMPLETED
**Parallelizable**: No; shared type and normalizer surface used by later tests.

```typescript
export type ChatSdkAttachmentKind = "image" | "pdf" | "other";

export interface ChatSdkAttachmentDescriptor extends JsonObject {
  readonly id?: string;
  readonly kind?: ChatSdkAttachmentKind;
  readonly mediaType?: string;
  readonly filename?: string;
  readonly sizeBytes?: number;
  readonly source?: JsonObject | string;
  readonly contentRef?: string;
  readonly textContent?: string;
  readonly imageDescription?: string;
  readonly classificationHints?: readonly string[] | JsonObject;
}
```

**Checklist**:

- [x] Add or document a typed descriptor boundary for Chat SDK attachments.
- [x] Reject non-object entries instead of silently filtering them.
- [x] Preserve unknown safe JSON metadata fields.
- [x] Validate `contentRef` as data-root-relative and reject absolute or
      traversing paths.
- [x] Bound inline deterministic evidence fields before normalized receipt data
      is persisted.
- [x] Redact credential-bearing attachment `source` values from normalized
      output, raw artifacts, logs, receipts, and dispatch records where this
      surface stores them.
- [x] Add image, PDF, unknown metadata, invalid entry, unsafe `contentRef`, and
      oversized evidence tests.

### 2. Event Input Mapping Attachment Preservation

#### packages/rielflow/src/events/input-mapping.ts
#### packages/rielflow/src/events/input-mapping.test.ts

**Status**: COMPLETED
**Parallelizable**: No; depends on Module 1 descriptor behavior.

```typescript
interface EventMappingResult {
  readonly workflowInput: JsonObject;
  readonly runtimeVariables: JsonObject & {
    readonly event?: JsonObject;
    readonly workflowInput?: JsonObject;
    readonly humanInput?: JsonObject;
  };
}
```

**Checklist**:

- [x] Prove `mode: "event-input"` forwards `attachments[]` unchanged into
      `workflowInput` and `runtimeVariables.event.input`.
- [x] Prove template mapping can select `{{event.input.attachments}}` and array
      members without dropping descriptor fields.
- [x] Cover Chat SDK default `mirrorToHumanInput: true` behavior and explicit
      binding overrides.
- [x] Keep non-chat event mapping behavior unchanged.

### 3. Event Source Fixtures And Binding Updates

#### examples/event-sources/.rielflow-events/sources/chat-sdk-slack.json
#### examples/event-sources/.rielflow-events/bindings/chat-sdk-slack-to-workflow.json
#### examples/event-sources/.rielflow-events/destinations/chat-sdk-slack-replies.json
#### examples/event-sources/payloads/chat-sdk-slack-message.json
#### examples/event-sources/payloads/chat-sdk-attachment-judgement-message.json
#### examples/event-sources/payloads/chat-sdk-attachment-judgement-unsupported.json
#### examples/event-sources/README.md
#### packages/rielflow/src/events/adapters/chat-sdk.test.ts

**Status**: COMPLETED
**Parallelizable**: Yes; after Module 1, writes are limited to fixtures, docs,
and fixture assertions.

```typescript
interface ChatSdkAttachmentFixturePayload extends JsonObject {
  readonly provider: "slack";
  readonly eventType: "message";
  readonly message: {
    readonly text: string;
    readonly attachments: readonly ChatSdkAttachmentDescriptor[];
  };
}
```

**Checklist**:

- [x] Add one payload containing an image descriptor with deterministic
      `imageDescription` or OCR-like text.
- [x] Add one payload containing a PDF descriptor with deterministic
      `textContent`.
- [x] Add one negative payload with unsupported or evidence-free attachment
      data for manual review behavior.
- [x] Keep source and destination configs secret-free and environment-variable
      based.
- [x] Update event-source README commands to show deterministic attachment
      judgement replay.
- [x] Extend example fixture tests to validate source, binding, destination, and
      payload shape.

### 4. Attachment Judgement Workflow Example

#### examples/chat-event-attachment-judgement/workflow.json
#### examples/chat-event-attachment-judgement/nodes/node-judge-attachments.json
#### examples/chat-event-attachment-judgement/prompts/judge-attachments.md
#### examples/chat-event-attachment-judgement/EXPECTED_RESULTS.md
#### examples/chat-event-attachment-judgement/mock-scenario.json
#### examples/chat-event-attachment-judgement/mock-scenario-unsupported.json

**Status**: COMPLETED
**Parallelizable**: Yes; after Module 1, writes are isolated to the new example
workflow bundle.

```typescript
interface AttachmentJudgementResult extends JsonObject {
  readonly attachments: readonly {
    readonly id?: string;
    readonly filename?: string;
    readonly kind: "image" | "pdf" | "other";
    readonly mediaType?: string;
    readonly evidence: readonly string[];
    readonly label: string;
    readonly confidence: "high" | "medium" | "low";
    readonly rationale: string;
    readonly needsManualReview: boolean;
  }[];
}
```

**Checklist**:

- [x] Create a directly runnable workflow bundle under
      `examples/chat-event-attachment-judgement/`.
- [x] Use `promptTemplateFile` for the classifier prompt.
- [x] Reference `{{event.input.attachments}}` or workflow input attachments
      without provider-specific fields.
- [x] Emit structured judgement fields for identity, display name, kind,
      media type, evidence, label, confidence, rationale, and manual review.
- [x] Document expected deterministic outputs for image, PDF, and unsupported
      attachment cases.

### 5. Example Validation And User Documentation

#### examples/event-sources/README.md
#### README.md
#### packages/rielflow/src/events/chat-reply-example.test.ts

**Status**: COMPLETED
**Parallelizable**: Yes; after Modules 3 and 4 define final file paths and
workflow id.

**Checklist**:

- [x] Add or extend tests that validate/inspect the new example workflow from
      `./examples`.
- [x] Ensure event-source validation includes the new binding and payload
      references.
- [x] Refresh user-facing documentation only for the new deterministic example
      and commands.
- [x] Avoid changing unrelated example workflows.

### 6. Final Review Checks And Plan Progress Updates

#### impl-plans/active/chat-event-attachment-judgement.md

**Status**: COMPLETED
**Parallelizable**: No; final coordination task.

**Checklist**:

- [x] Mark completed module checkboxes during implementation.
- [x] Add progress-log entries after each implementation session.
- [x] Confirm no unresolved high or mid review findings remain.
- [x] Keep completion criteria accurate before the plan moves to completed.

---

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Attachment descriptor normalization | `packages/rielflow/src/events/adapters/chat-sdk/normalization.ts` | COMPLETED | `packages/rielflow/src/events/adapters/chat-sdk.test.ts` |
| Input mapping preservation | `packages/rielflow/src/events/input-mapping.ts` | COMPLETED | `packages/rielflow/src/events/input-mapping.test.ts` |
| Event fixtures and binding docs | `examples/event-sources/` | COMPLETED | `packages/rielflow/src/events/adapters/chat-sdk.test.ts` |
| Attachment judgement workflow | `examples/chat-event-attachment-judgement/` | COMPLETED | workflow validate/inspect commands |
| Example validation and docs | `README.md`, `examples/event-sources/README.md` | COMPLETED | `packages/rielflow/src/events/chat-reply-example.test.ts` |
| Progress and review closure | `impl-plans/active/chat-event-attachment-judgement.md` | COMPLETED | review checklist |

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| Module 1: Chat SDK attachment normalization | Accepted Step 3 design review | COMPLETED |
| Module 2: Input mapping preservation | Module 1 descriptor behavior | COMPLETED |
| Module 3: Fixtures and binding updates | Module 1 descriptor behavior | COMPLETED |
| Module 4: Example workflow | Module 1 descriptor behavior | COMPLETED |
| Module 5: Validation and docs | Modules 3 and 4 | COMPLETED |
| Module 6: Review closure | Modules 1 through 5 | COMPLETED |

## Parallelizable Tasks

| Task | Parallelizable | Reason |
| --- | --- | --- |
| Module 1 | No | It defines shared normalizer behavior and test expectations. |
| Module 2 | No | It depends on Module 1 and touches shared input mapping tests. |
| Module 3 | Yes | After Module 1, it writes fixture/config/doc files disjoint from Module 4. |
| Module 4 | Yes | After Module 1, it writes only the new workflow bundle. |
| Module 5 | Yes | After Modules 3 and 4, docs/test finalization can run alongside review prep if write scopes are coordinated. |
| Module 6 | No | It is the final coordination and progress tracking task. |

## Verification Plan

Run focused checks after each implementation module and the full set before
handoff:

```bash
rg -n "chat-sdk|chat\\.message|attachments|attachment judgement|outputDestinations" design-docs examples packages/rielflow/src README.md
bun test packages/rielflow/src/events/adapters/chat-sdk.test.ts packages/rielflow/src/events/input-mapping.test.ts packages/rielflow/src/events/chat-reply-example.test.ts
bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
bun run packages/rielflow/src/bin.ts workflow validate chat-event-attachment-judgement --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts workflow inspect chat-event-attachment-judgement --workflow-definition-dir ./examples --output json
bun run typecheck
```

If shared event-source behavior changes, also run:

```bash
bun test packages/rielflow/src/events/adapter-registry.test.ts packages/rielflow/src/events/config.test.ts packages/rielflow/src/events/listener-service.test.ts packages/rielflow/src/events/manual-emit.test.ts packages/rielflow/src/events/reply-dispatcher.test.ts
```

## Completion Criteria

- [x] Chat SDK normalization preserves valid deterministic image/PDF attachment
      descriptors and rejects invalid attachment entries.
- [x] Unsafe `contentRef` values and oversized inline evidence are rejected
      before receipt persistence.
- [x] Attachment source values that may contain credentials are redacted in
      persisted or logged normalized data.
- [x] Event input mapping preserves `attachments[]` in workflow input and
      runtime variables for `mode: "event-input"` and template mappings.
- [x] Chat SDK input mapping mirrors to human input by default and honors
      explicit binding overrides.
- [x] `examples/chat-event-attachment-judgement/` validates and inspects from
      `./examples`.
- [x] Deterministic image, PDF, and unsupported/manual-review payloads exist
      under `examples/event-sources/payloads/`.
- [x] Focused unit tests and example validation commands pass.
- [x] `bun run typecheck` passes after TypeScript changes.
- [x] User-facing documentation lists the deterministic commands without
      requiring live Chat SDK credentials.
- [x] Progress log is updated before handoff and any Step 5 review feedback is
      addressed.

## Progress Log

### Session: 2026-05-29 09:18

**Tasks Completed**: Plan created from accepted Step 3 design review.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implementation has not started. The later implementation step must
use the TypeScript coding standards and run post-modification checks required by
AGENTS.md.

### Session: 2026-05-29 09:35

**Tasks Completed**: Modules 1, 2, 3, 4, 5, and 6.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented typed Chat SDK attachment descriptors, strict attachment
normalization, safe `contentRef` validation, inline evidence bounds, normalized
source redaction, Chat SDK default human-input mirroring, deterministic
image/PDF/unsupported fixtures, the `chat-event-attachment-judgement` workflow
bundle, focused tests, README updates, and final plan progress tracking.
Step 5 had no high or mid findings to address.

### Session: 2026-05-29 09:42

**Tasks Completed**: Step 6 self-review follow-up.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Self-review tightened attachment string field validation so known
descriptor fields such as `filename` and `contentRef` cannot retain invalid
non-string values through preserved metadata. Focused tests, typecheck, Biome,
event validation, workflow validation, and `git diff --check` passed after the
follow-up.

### Session: 2026-05-29 10:05

**Tasks Completed**: Step 7 high findings addressed.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added Chat SDK raw payload redaction before manual emit and HTTP
listener dispatch persist raw receipt artifacts. Regression tests now prove
attachment source secrets, signed URLs, private bucket refs, and bearer
authorization data do not appear in raw, normalized, workflow-input, dispatch,
or HTTP response surfaces. Re-ran the Step 7 requested test, typecheck, Biome,
event validation, workflow validation, and `git diff --check` commands.

## Related Plans

- **Previous**: `impl-plans/completed/chat-sdk-event-sources.md`
- **Depends On**: accepted design update in
  `design-docs/specs/design-chat-sdk-event-sources.md`
- **Next**: none
