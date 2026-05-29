# Matrix Attachment Text Ingestion

This document defines bounded Matrix attachment text extraction for the
rielflow Matrix event source.

## Overview

Matrix `m.room.message` events can carry attachment-style `msgtype` values such
as `m.file`, `m.image`, `m.audio`, and `m.video`. The existing Matrix adapter
handled only text-like messages. This feature adds an explicit, opt-in path for
downloading text-compatible Matrix media and exposing the bounded text to
workflows.

The issue source for this design is the workflow input for "Matrix event source
attachments"; no GitHub issue URL or repository/number was provided. The local
Codex-reference files are the Matrix adapter, attachment helper, event source
types, Matrix source validation, adapter/config tests, example source config,
and README. They are used as structural and behavioral references only.

## Reference And Adapter Mapping

Codex-reference paths for this issue-resolution workflow are:

- `packages/rielflow/src/events/adapters/matrix.ts`: Matrix `/sync`
  ownership, normalized `chat.message` shape, room/thread/reply mapping, and
  diagnostic sink behavior.
- `packages/rielflow/src/events/adapters/matrix-attachments.ts`: Matrix
  attachment metadata, bounded media download, MIME/name allowlisting, and
  sanitized download failures.
- `packages/rielflow-events/src/types.ts`: `MatrixSourceConfig.attachments`
  source configuration contract.
- `packages/rielflow/src/events/validate-source-matrix.ts`: Matrix source
  validation for attachment option shape and byte bounds.
- `packages/rielflow/src/events/adapters/matrix.test.ts` and
  `packages/rielflow/src/events/config.test.ts`: mocked sync/download and
  config validation acceptance coverage.
- `examples/event-sources/.rielflow-events/sources/team-matrix.json` and
  `README.md`: operator-facing configuration examples and documented
  limitations.

There is no Cursor CLI behavior to map for this feature. Matrix media access is
isolated behind the Matrix event-source adapter and its attachment helper; agent
backend adapters such as `codex-agent`, `claude-code-agent`, or any future
Cursor adapter should only receive the provider-neutral normalized
`chat.message` input.

Intentional divergence from the reference behavior is limited to scope control:
the design treats Codex-reference files as local rielflow behavior references,
not as source code to copy into another adapter or backend. Attachment download
is Matrix-specific because it requires Matrix homeserver credentials and Matrix
media URL handling.

## Goals

- Preserve default text-only Matrix behavior unless the source opts in.
- Download unencrypted text-compatible attachments from Matrix media URLs during
  `/sync` processing.
- Add extracted text to `event.input.text` so existing prompt templates can use
  it without learning a new input path.
- Also expose structured metadata through `event.input.attachments` and the raw
  extracted text through `event.input.attachmentText`.
- Bound download size and MIME types through Matrix source config.
- Avoid storing access tokens, authorization headers, raw media responses, or
  binary content in diagnostics.

## Non-Goals

- OCR for images.
- Transcription for audio or video.
- Decrypting encrypted Matrix attachments.
- Downloading attachments from manual `events emit` normalization, where the
  adapter does not have Matrix credentials.
- Persisting full attachment blobs in chat history files.

## Source Configuration

Matrix sources may enable bounded text attachment extraction:

```json
{
  "id": "team-matrix",
  "kind": "matrix",
  "attachments": {
    "downloadText": true,
    "maxBytes": 65536,
    "allowedMimeTypes": ["text/plain", "text/markdown", "application/json"]
  }
}
```

Rules:

- `downloadText` defaults to false.
- `maxBytes` defaults to 65536 and has a hard validation maximum of 1048576
  bytes.
- `allowedMimeTypes` is optional. When omitted, the adapter allows common text
  MIME types and conservative text-like filename extensions.
- `allowedMimeTypes` entries may be exact MIME types or wildcard family entries
  such as `text/*`.
- Matrix media downloads use the configured homeserver URL and access token
  from environment variables.
- validation rejects non-object `attachments`, non-boolean `downloadText`,
  non-positive or too-large `maxBytes`, and empty or non-string MIME allowlist
  entries.

## Sync Data Flow

Attachment content is readable only during Matrix `/sync`, where the adapter
has the source config, homeserver URL, access token, fetch implementation, and
diagnostic sink. Manual raw-event normalization can still normalize attachment
metadata from the Matrix event body, but it must not download media because it
does not own Matrix credentials.

The `/sync` flow is:

1. identify `m.room.message` events in configured rooms;
2. accept text message types directly;
3. for `m.file`, `m.image`, `m.audio`, and `m.video`, read bounded metadata from
   `content.body`, `content.url`, `content.info`, and encrypted `content.file`;
4. when `attachments.downloadText` is true, the attachment is unencrypted, and
   the MIME/name allowlist permits text, download `mxc://` media through the
   Matrix media endpoint;
5. send `Range` and token-authenticated requests, cap decoded bytes at
   `maxBytes`, and mark truncation when the returned body exceeds the bound;
6. normalize the result into `chat.message` without exposing Matrix credentials
   or raw binary bytes.

## Event Contract

For a supported attachment, the Matrix adapter emits `chat.message` with:

- `input.text`: the attachment body or filename followed by extracted text when
  text was downloaded.
- `input.attachmentText`: extracted text, or an empty string when only metadata
  is available.
- `input.attachments`: bounded metadata including name, msgtype, mxc URL,
  mimetype, size, contentText when present, and truncation state.

Binary attachments can be represented as metadata when the source enables
attachments, but their binary content is not decoded into workflow prompt text.
Unsupported MIME types, malformed or non-`mxc://` media URLs, encrypted
attachments, oversized content, and HTTP/download failures are non-fatal. They
leave metadata available where possible and either omit `contentText` or attach
a sanitized `downloadError`.

## Safety

Attachment extraction must remain Matrix-adapter owned. The adapter uses range
requests and post-download truncation to enforce `maxBytes`, emits sanitized
diagnostics for HTTP/download failures, and never includes Matrix credentials in
event payloads or persisted history.

The feature intentionally excludes OCR, audio/video transcription, binary blob
storage, encrypted room support, and encrypted attachment decryption. Image,
audio, and video `msgtype` values are accepted only as containers for
text-compatible media when the MIME/name allowlist allows decoding as text.

## Rollout Constraints

- Default behavior remains unchanged because `attachments.downloadText` defaults
  to false and attachment messages are ignored unless an `attachments` object is
  configured.
- History persistence stores the normalized chat text and metadata only; it must
  remain bounded by existing chat history limits.
- Diagnostics should include source id, HTTP status when available, and error
  class only.
- README and example event source config should document the opt-in attachment
  settings and the excluded binary/OCR/transcription/decryption cases.

## Issue Mapping

- Verify readability: Matrix attachment text is readable only for unencrypted,
  text-compatible media during `/sync`.
- Expose normalized input: extracted text is present in `input.text`,
  `input.attachmentText`, and `input.attachments[].contentText`.
- Validate configuration: Matrix source validation owns `attachments` option
  shape and bounds.
- Keep out-of-scope behavior explicit: binary, OCR, transcription, and
  decryption remain unsupported.

## Verification

- `bun test packages/rielflow/src/events/adapters/matrix.test.ts`
- `bun test packages/rielflow/src/events/config.test.ts`
- `bun test`
