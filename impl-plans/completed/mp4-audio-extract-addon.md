# MP4 Audio Extract Add-on Implementation Plan

**Status**: Completed
**Completed**: 2026-06-06
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#built-in-rielflowmp4-audio-extract`

## Scope

Add built-in `rielflow/mp4-audio-extract` version `1`. The add-on renders a
templated MP4 path, invokes `ffmpeg` with argv/no shell, and writes extracted
FLAC audio to `audio/extracted.flac` under the node artifact directory.

Google Speech-to-Text integration is intentionally out of scope for this plan.

## Completed Work

- Added resolver/config validation for `mp4PathTemplate`, optional
  `ffmpegPath`, `sampleRateHertz`, and `audioChannelCount`.
- Added native executor dispatch for `rielflow/mp4-audio-extract`.
- Added ffmpeg execution with restricted process environment and process-log
  attachments on failure.
- Added output contract under `audioExtract` with `audioPath` and
  artifact-relative metadata.
- Added deterministic resolver and native executor tests with fake `ffmpeg`.
- Updated README, node add-on skill guidance, and design documentation.

## Verification

- `bun test packages/rielflow/src/workflow/node-addons/mp4-audio-extract.test.ts`
- `bun test packages/rielflow/src/workflow/native-node-executor-mp4-audio-extract.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bun run build`
