# Matrix Attachment Text Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-matrix-attachment-text.md#overview`; `design-docs/specs/design-matrix-attachment-text.md#source-configuration`; `design-docs/specs/design-matrix-attachment-text.md#sync-data-flow`; `design-docs/specs/design-matrix-attachment-text.md#event-contract`; `design-docs/specs/design-event-listener-workflow-trigger.md#event-runtime-boundaries`; `design-docs/specs/architecture.md#event-sources-and-attachments`
**Created**: 2026-05-29
**Last Updated**: 2026-05-29

---

## Design Document Reference

**Sources**:

- `design-docs/specs/design-matrix-attachment-text.md`
- `design-docs/specs/design-event-listener-workflow-trigger.md`
- `design-docs/specs/architecture.md`
- Step 3 review output from workflow `codex-design-and-implement-review-loop`

### Summary

Add opt-in Matrix media text extraction for unencrypted text-compatible
attachments during Matrix `/sync`. Extracted text is appended to normalized
`chat.message` `event.input.text` and also exposed through
`event.input.attachmentText` and `event.input.attachments`. Downloads are
bounded by source configuration and must not expose Matrix credentials, raw
binary content, OCR, transcription, or encrypted attachment decryption.

### Scope

**Included**: Matrix source attachment config types, validation, text-compatible
attachment metadata parsing, bounded Matrix media download during `/sync`,
normalized `chat.message` attachment fields, sanitized diagnostics, config and
adapter tests, README updates, and checked-in Matrix event source example
updates.

**Excluded**: OCR, audio/video transcription, encrypted room or encrypted
attachment decryption, manual `events emit` media downloads, binary blob
persistence, and provider-neutral or agent-backend-specific attachment
handling.

### Accepted Review Decisions

- Step 3 accepted the design for `codex-design-and-implement-review-loop` in
  `issue-resolution` mode with no high or mid findings.
- Matrix attachment content is readable only for unencrypted, text-compatible
  Matrix media during `/sync`, where the adapter owns homeserver credentials.
- Manual raw-event normalization may expose bounded attachment metadata but must
  not perform media downloads.
- Attachment extraction remains Matrix-adapter-owned; `codex-agent` and other
  backend adapters receive only provider-neutral normalized `chat.message`
  input.
- Binary, OCR, transcription, and decryption remain documented out of scope.

### Codex-Agent Reference Mapping

- `packages/rielflow/src/events/adapters/matrix.ts`: Matrix `/sync` lifecycle,
  normalized `chat.message` construction, history attachment, reply target, and
  diagnostic sink behavior.
- `packages/rielflow/src/events/adapters/matrix-attachments.ts`: new helper
  boundary for attachment metadata, allowlist checks, bounded media downloads,
  UTF-8 text decoding, truncation, and sanitized download failures.
- `packages/rielflow-events/src/types.ts`: `MatrixSourceConfig.attachments`
  source configuration contract.
- `packages/rielflow/src/events/validate-source-matrix.ts`: validation for
  `attachments.downloadText`, `attachments.maxBytes`, and
  `attachments.allowedMimeTypes`.
- `packages/rielflow/src/events/adapters/matrix.test.ts`: Matrix sync and
  normalization behavior coverage.
- `packages/rielflow/src/events/config.test.ts`: valid and malformed Matrix
  attachment configuration coverage.
- `examples/event-sources/.rielflow-events/sources/team-matrix.json` and
  `README.md`: operator-facing source configuration and documented limits.

Intentional divergences from Codex-reference inputs:

- Do not introduce a Cursor, `codex-agent`, or workflow-engine attachment path;
  this remains an event-source adapter concern.
- Do not download media in manual event normalization because that path lacks
  Matrix source credentials and sync ownership.
- Do not preserve raw media bytes or authorization headers in normalized events,
  diagnostics, history files, or artifacts.

### Repository State Note

At plan creation time, the working tree already contains draft changes in the
target Matrix attachment files. The implementation step should reconcile those
changes against this plan, complete missing coverage, and avoid duplicating
existing helper or validation work.

---

## Modules

### 1. Matrix Source Attachment Config

**File Paths**:

- `packages/rielflow-events/src/types.ts`
- `packages/rielflow/src/events/validate-source-matrix.ts`

**Status**: COMPLETED

```typescript
interface MatrixAttachmentsConfig extends JsonObject {
  readonly downloadText?: boolean;
  readonly maxBytes?: number;
  readonly allowedMimeTypes?: readonly string[];
}

interface MatrixSourceConfig extends EventSourceConfigBase {
  readonly kind: "matrix";
  readonly attachments?: MatrixAttachmentsConfig;
}
```

**Checklist**:

- [x] Add exported `MatrixAttachmentsConfig` to the Matrix source config.
- [x] Default `downloadText` to false in adapter behavior.
- [x] Default `maxBytes` to 65536 in adapter behavior.
- [x] Reject non-object `attachments` values.
- [x] Reject non-boolean `downloadText`.
- [x] Reject non-positive or greater-than-1048576 `maxBytes`.
- [x] Reject empty or non-string `allowedMimeTypes` entries.

### 2. Matrix Attachment Helper

**File Path**: `packages/rielflow/src/events/adapters/matrix-attachments.ts`

**Status**: COMPLETED

```typescript
interface MatrixAttachmentInput extends JsonObject {
  readonly name: string;
  readonly msgtype: string;
  readonly mediaUrl?: string;
  readonly mimetype?: string;
  readonly size?: number;
  readonly contentText?: string;
  readonly truncated?: boolean;
  readonly encrypted?: boolean;
  readonly downloadError?: string;
}
```

**Checklist**:

- [x] Recognize `m.file`, `m.image`, `m.audio`, and `m.video` attachment
      message types.
- [x] Read bounded metadata from `content.body`, `content.url`, `content.info`,
      and encrypted `content.file`.
- [x] Allow text-compatible MIME types and conservative text-like filename
      extensions when no explicit MIME allowlist is configured.
- [x] Support exact MIME entries and wildcard family entries such as `text/*`.
- [x] Convert valid `mxc://server/media` URLs to Matrix media download URLs.
- [x] Fetch with Matrix bearer auth and a range bounded by configured
      `maxBytes`.
- [x] Decode only bounded UTF-8 text and report truncation.
- [x] Return sanitized `downloadError` values and diagnostics without tokens or
      raw media bytes.

### 3. Matrix Sync Normalization Integration

**File Path**: `packages/rielflow/src/events/adapters/matrix.ts`

**Status**: COMPLETED

```typescript
interface MatrixAttachmentNormalizedInput extends JsonObject {
  readonly text: string;
  readonly attachmentText?: string;
  readonly attachments?: readonly MatrixAttachmentInput[];
}
```

**Checklist**:

- [x] Preserve existing text-like message handling for `m.text`, `m.notice`,
      and `m.emote`.
- [x] Accept attachment message types only when `source.attachments` is
      configured.
- [x] Download text-compatible attachment content only in `/sync`.
- [x] Append extracted text to `event.input.text` after the attachment body or
      filename.
- [x] Populate `event.input.attachmentText` with extracted text or an empty
      string when metadata is available without content text.
- [x] Populate `event.input.attachments[]` with bounded metadata and optional
      `contentText`, `truncated`, `encrypted`, or `downloadError`.
- [x] Leave unsupported MIME types, encrypted attachments, malformed media
      URLs, oversized content, and download failures non-fatal.
- [x] Ensure history persistence stores only normalized bounded text and
      metadata.

### 4. Test Coverage

**File Paths**:

- `packages/rielflow/src/events/adapters/matrix.test.ts`
- `packages/rielflow/src/events/config.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Cover current readability behavior before attachment download is enabled.
- [x] Cover successful `/sync` text attachment download and normalized
      `text`, `attachmentText`, and `attachments[]` output.
- [x] Assert Matrix media downloads use bounded range requests and bearer auth
      without leaking tokens into normalized output.
- [x] Cover download failures and non-text or encrypted attachments as
      non-fatal metadata-only results.
- [x] Cover config acceptance for valid `attachments` values.
- [x] Cover validation rejection for malformed attachment config.
- [x] Preserve existing manual raw-event normalization expectations and avoid
      media download from manual emit paths.

### 5. Examples And Documentation

**File Paths**:

- `examples/event-sources/.rielflow-events/sources/team-matrix.json`
- `examples/event-sources/README.md`
- `README.md`

**Status**: COMPLETED

**Checklist**:

- [x] Add example `attachments.downloadText`, `attachments.maxBytes`, and
      `attachments.allowedMimeTypes` configuration.
- [x] Document that attachment text extraction is opt-in and sync-only.
- [x] Document normalized `event.input.text`, `event.input.attachmentText`, and
      `event.input.attachments` behavior.
- [x] Document excluded binary, OCR, transcription, and decryption behavior.
- [x] Keep Matrix credential setup documented as env-var based.

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Config types | `packages/rielflow-events/src/types.ts` | COMPLETED | `packages/rielflow/src/events/config.test.ts` |
| Config validation | `packages/rielflow/src/events/validate-source-matrix.ts` | COMPLETED | `packages/rielflow/src/events/config.test.ts` |
| Attachment helper | `packages/rielflow/src/events/adapters/matrix-attachments.ts` | COMPLETED | `packages/rielflow/src/events/adapters/matrix.test.ts` |
| Sync integration | `packages/rielflow/src/events/adapters/matrix.ts` | COMPLETED | `packages/rielflow/src/events/adapters/matrix.test.ts` |
| Operator docs | `README.md`, `examples/event-sources/README.md` | COMPLETED | `git diff --check` |
| Source fixture | `examples/event-sources/.rielflow-events/sources/team-matrix.json` | COMPLETED | `bun test packages/rielflow/src/events/config.test.ts` |

---

## Task Breakdown

### TASK-001: Verify Existing Matrix Attachment Readability

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/events/adapters/matrix.test.ts`
**Dependencies**: accepted Step 3 design review

**Completion Criteria**:

- [x] Add or confirm tests proving current text-like Matrix messages still
      normalize to `chat.message`.
- [x] Add or confirm tests proving attachment messages are ignored or metadata
      only when text download is not enabled.
- [x] Record the observed readability gap in the progress log before enabling
      download behavior.

### TASK-002: Add Matrix Attachment Source Contract And Validation

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `packages/rielflow-events/src/types.ts`,
`packages/rielflow/src/events/validate-source-matrix.ts`,
`packages/rielflow/src/events/config.test.ts`
**Dependencies**: accepted Step 3 design review

**Completion Criteria**:

- [x] `MatrixAttachmentsConfig` is exported and wired into
      `MatrixSourceConfig`.
- [x] Matrix source validation accepts valid attachment config.
- [x] Matrix source validation rejects malformed attachment config.
- [x] Config tests cover valid and invalid cases explicitly.

### TASK-003: Implement Bounded Matrix Attachment Text Helper

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/events/adapters/matrix-attachments.ts`,
`packages/rielflow/src/events/adapters/matrix.test.ts`
**Dependencies**: TASK-002

**Completion Criteria**:

- [x] Helper reads Matrix attachment metadata without throwing on malformed
      content.
- [x] Helper downloads only opt-in, unencrypted, text-compatible `mxc://` media.
- [x] Helper enforces configured byte bounds before exposing decoded text.
- [x] Helper reports sanitized download failures and truncation state.

### TASK-004: Wire Attachments Into Matrix Sync Normalization

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/events/adapters/matrix.ts`,
`packages/rielflow/src/events/adapters/matrix.test.ts`
**Dependencies**: TASK-002, TASK-003

**Completion Criteria**:

- [x] `/sync` passes Matrix homeserver URL, access token, fetch, and diagnostic
      sink to the helper.
- [x] Normalized `chat.message` includes extracted text in `input.text`.
- [x] Normalized `chat.message` includes `input.attachmentText` and
      `input.attachments`.
- [x] Manual raw-event normalization does not perform media downloads.
- [x] Existing history, reply target, and own-message filtering behavior remains
      unchanged.

### TASK-005: Update Examples And Operator Documentation

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `examples/event-sources/.rielflow-events/sources/team-matrix.json`,
`examples/event-sources/README.md`, `README.md`
**Dependencies**: TASK-002, TASK-004

**Completion Criteria**:

- [x] Matrix source fixture shows opt-in bounded text attachment settings.
- [x] README documents sync-only text-compatible attachment extraction.
- [x] Example README documents env requirements and explicit non-goals.
- [x] Documentation avoids implying OCR, transcription, binary parsing, or
      decryption support.

### TASK-006: Final Verification And Plan Progress Update

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: this plan progress log, implementation verification output
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [x] Run focused Matrix adapter tests.
- [x] Run focused event configuration tests.
- [x] Run TypeScript type checking.
- [x] Run full test suite or record why it was not run.
- [x] Run `git diff --check` over changed files.
- [x] Update this plan's task status and progress log with verification
      results.

---

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| TASK-001 readability verification | accepted Step 3 design review | COMPLETED |
| TASK-002 config contract and validation | accepted Step 3 design review | COMPLETED |
| TASK-003 attachment helper | TASK-002 | COMPLETED |
| TASK-004 sync normalization | TASK-002, TASK-003 | COMPLETED |
| TASK-005 examples and docs | TASK-002, TASK-004 | COMPLETED |
| TASK-006 verification | TASK-001 through TASK-005 | COMPLETED |

## Parallelizable Tasks

- TASK-002 may run in parallel with TASK-001 only if TASK-001 limits writes to
  Matrix adapter tests and does not edit config tests.
- TASK-005 may run in parallel with late verification only after TASK-002 and
  TASK-004 stabilize the public config and normalized event contract.

All other tasks share Matrix adapter or Matrix adapter test write scopes and
should run sequentially.

## Verification

- `git diff --check -- packages/rielflow-events/src/types.ts packages/rielflow/src/events/validate-source-matrix.ts packages/rielflow/src/events/adapters/matrix-attachments.ts packages/rielflow/src/events/adapters/matrix.ts packages/rielflow/src/events/adapters/matrix.test.ts packages/rielflow/src/events/config.test.ts examples/event-sources/.rielflow-events/sources/team-matrix.json examples/event-sources/README.md README.md`
- `bun test packages/rielflow/src/events/adapters/matrix.test.ts`
- `bun test packages/rielflow/src/events/config.test.ts`
- `bun run typecheck`
- `bun test`

## Completion Criteria

- [x] Matrix attachment text extraction is opt-in and defaults off.
- [x] Unencrypted text-compatible Matrix media can be downloaded during `/sync`
      with byte bounds.
- [x] Extracted text is exposed on `event.input.text`,
      `event.input.attachmentText`, and `event.input.attachments`.
- [x] Unsupported, encrypted, malformed, oversized, and failed downloads are
      non-fatal and sanitized.
- [x] Manual event normalization does not perform Matrix media downloads.
- [x] Matrix source config validation rejects unbounded or malformed attachment
      settings.
- [x] README and example source configuration document the source settings and
      out-of-scope behavior.
- [x] Focused tests, typecheck, and full verification commands are run or
      explicitly documented as not run.

## Progress Log

### Session: 2026-05-29 Step 4 Implementation Planning

**Tasks Completed**: Plan created after accepted Step 3 design review.

**Notes**:

- Issue reference came from `runtimeVariables.workflowInput`; no GitHub issue
  URL, issue number, or repository was provided.
- Later implementation sessions must update task statuses, module statuses, and
  completion checkboxes as work lands.
- The implementation step must reconcile any existing working-tree Matrix
  attachment draft changes against this plan before marking tasks complete.

### Session: 2026-05-29 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005,
TASK-006

**Blockers**: None

**Notes**:

- Confirmed accepted Step 5 implementation-plan review in workflow
  `codex-design-and-implement-review-loop`, `issue-resolution` mode, with no
  high or mid findings requiring rerun remediation.
- Existing Matrix attachment support already covered the core source type,
  validation, helper, sync normalization, fixture, and docs paths. Step 6
  reconciled the remaining gaps against the accepted design.
- Tightened Matrix media `Range` requests to `bytes=0-(maxBytes - 1)`, retained
  encrypted `content.file.url` as metadata without decryption, and added
  sanitized `MatrixAttachmentInvalidMediaUrl` metadata/diagnostics for malformed
  media URLs.
- Added Matrix adapter tests for manual normalization metadata-only behavior and
  non-fatal failed downloads, encrypted attachments, binary MIME attachments,
  and malformed media URLs without credential/body leakage.
- Added Matrix config validation coverage for non-object `attachments` and
  refreshed README/example wording to make sync-only attachment text extraction
  explicit.

**Verification**:

- `bun test packages/rielflow/src/events/adapters/matrix.test.ts` - passed, 13
  tests.
- `bun test packages/rielflow/src/events/config.test.ts` - passed, 40 tests.
- `bun run lint:biome` - passed.
- `bun run typecheck` - passed.
- `bun test` - passed, 1398 tests.
- `git diff --check -- packages/rielflow-events/src/types.ts packages/rielflow/src/events/validate-source-matrix.ts packages/rielflow/src/events/adapters/matrix-attachments.ts packages/rielflow/src/events/adapters/matrix.ts packages/rielflow/src/events/adapters/matrix.test.ts packages/rielflow/src/events/config.test.ts examples/event-sources/.rielflow-events/sources/team-matrix.json examples/event-sources/README.md README.md impl-plans/active/matrix-attachment-text.md impl-plans/README.md` -
  passed.
