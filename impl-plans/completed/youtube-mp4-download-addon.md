# YouTube MP4 Download Add-on Implementation Plan

**Status**: Implemented
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#built-in-rielflowyoutube-mp4-download`
**Created**: 2026-06-05
**Last Updated**: 2026-06-06

## Design Summary

Implement built-in worker-only add-on `rielflow/youtube-mp4-download@1` from
the accepted node add-on catalog design. The add-on resolves from
`workflow.json.nodes[].addon`, validates one YouTube URL, rejects `addon.env`,
invokes `yt-dlp` with argv-style spawning, confines outputs to the workflow
working directory, and returns structured download metadata with process logs.

Source of truth:

- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/notes.md`

Out of scope:

- Bundling or installing `yt-dlp`.
- Supporting playlists, non-YouTube hosts, cookies, credentials, or arbitrary
  network downloads.
- Author-facing `nodeType: "addon"` payloads.
- Manager add-on execution.

No separate Codex-agent reference repository was supplied. The implementation
should follow local Rielflow add-on resolver and native executor patterns.

## Modules

### 1. Core Add-on Types

#### `packages/rielflow/src/workflow/addon-types.ts`

**Status**: COMPLETED

```typescript
export interface YoutubeMp4DownloadAddonConfig {
  readonly ytDlpPath?: string;
  readonly outputDirectory?: string;
  readonly fileNameTemplate?: string;
  readonly formatSelector?: string;
  readonly timeoutMs?: number;
}

export interface ResolvedYoutubeMp4DownloadAddon {
  readonly name: "rielflow/youtube-mp4-download";
  readonly version: "1";
  readonly config: NormalizedYoutubeMp4DownloadConfig;
  readonly inputs: Readonly<{ url: string }>;
}
```

**Checklist**:

- [x] Add authoring and resolved types for the add-on.
- [x] Export the types through `packages/rielflow-core/src/index.ts`.
- [x] Keep the type surface worker-only; do not add manager support.

### 2. Resolver Constants and Validation

#### `packages/rielflow-addons/src/node-addons/addon-constants-and-agent-config.ts`
#### `packages/rielflow-addons/src/node-addons/youtube-mp4-download-config.ts`
#### `packages/rielflow-addons/src/node-addons/addon-payload-resolution.ts`
#### `packages/rielflow/src/workflow/node-addons/*.ts`

**Status**: COMPLETED

```typescript
export const YOUTUBE_MP4_DOWNLOAD_ADDON_NAME =
  "rielflow/youtube-mp4-download";
export const YOUTUBE_MP4_DOWNLOAD_ADDON_VERSION = "1";

export interface NormalizedYoutubeMp4DownloadConfig {
  readonly ytDlpPath: string;
  readonly outputDirectory: string;
  readonly fileNameTemplate: string;
  readonly formatSelector: string;
  readonly timeoutMs?: number;
}
```

**Checklist**:

- [x] Add constants and an output contract for `youtubeMp4Download`.
- [x] Validate `version`, object-shaped `config` and `inputs`, required
      non-empty `inputs.url`, supported config keys, and rejected `addon.env`.
- [x] Reject control characters in `ytDlpPath`, `outputDirectory`,
      `fileNameTemplate`, and `formatSelector`.
- [x] Reject absolute or escaping `outputDirectory` values.
- [x] Reject `fileNameTemplate` path separators, absolute paths, and `..`
      segments.
- [x] Validate `timeoutMs` as a positive integer.
- [x] Resolve to `nodeType: "addon"` with descriptor output metadata.
- [x] Insert resolver dispatch before unknown built-in rejection.

### 3. Native yt-dlp Executor

#### `packages/rielflow-addons/src/native-node-executor/youtube-mp4-download.ts`
#### `packages/rielflow-addons/src/native-node-executor/git-and-addon-execution.ts`
#### `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts`

**Status**: COMPLETED

```typescript
export interface YoutubeMp4DownloadResult {
  readonly status: "downloaded";
  readonly url: string;
  readonly outputPath: string;
  readonly fileName: string;
  readonly fileSize?: number;
}

export async function executeYoutubeMp4DownloadAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedYoutubeMp4DownloadAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput>;
```

**Checklist**:

- [x] Render `inputs.url` from normal node template variables.
- [x] Re-run URL, path, and filename checks after rendering.
- [x] Allow only `http:` or `https:` hosts `youtube.com`, `www.youtube.com`,
      `m.youtube.com`, `music.youtube.com`, and `youtu.be`.
- [x] Reject playlist expansion before spawning by passing `--no-playlist` and
      rejecting playlist-shaped rendered URLs.
- [x] Resolve and create the output directory under the workflow working
      directory; reject symlinks or real paths escaping that root.
- [x] Spawn `yt-dlp` with command plus argv only; never use shell execution.
- [x] Include `--ignore-config`, `--no-playlist`, `--merge-output-format mp4`,
      `--remux-video mp4`, `--paths`, `--output`, `--format`, and the URL.
- [x] Use a minimized env helper that preserves path lookup and platform
      essentials but omits ambient credentials and provider/package tokens.
- [x] Use configured `timeoutMs`, otherwise the node execution context timeout,
      otherwise a conservative fixed fallback.
- [x] Capture stdout/stderr as process logs.
- [x] Resolve exactly one final MP4 from the confined output directory scan.
- [x] Return provider `native-addon:youtube-mp4-download`, model
      `rielflow/youtube-mp4-download@1`, structured payload, and residual risks.

### 4. Package Boundary and Exports

#### `packages/rielflow-addons/src/node-addons.ts`
#### `packages/rielflow-addons/src/index.ts`
#### `packages/rielflow/src/workflow/node-addons.ts`
#### `packages/rielflow/src/workflow/native-node-executor.ts`
#### `packages/rielflow/src/package-boundaries.test.ts`

**Status**: COMPLETED

```typescript
export * from "./node-addons/youtube-mp4-download-config";
```

**Checklist**:

- [x] Export new resolver/config helpers through package entry points.
- [x] Ensure the Rielflow package mirror re-exports the new add-on helpers.
- [x] Update package boundary allowlists for new emitted declaration paths.
- [x] Avoid introducing core-to-addons imports.

### 5. Focused Tests

#### `packages/rielflow/src/workflow/node-addons/*.test.ts`
#### `packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts`
#### `packages/rielflow/src/workflow/addon-package-boundary.test.ts`
#### `packages/rielflow/src/package-boundaries.test.ts`

**Status**: COMPLETED

```typescript
interface FakeYtDlpInvocation {
  readonly argv: readonly string[];
  readonly envKeys: readonly string[];
  readonly cwd: string;
}
```

**Checklist**:

- [x] Add resolver acceptance for valid `rielflow/youtube-mp4-download@1`.
- [x] Add resolver rejection cases for unsupported version, missing URL,
      non-object config/inputs, unsupported config key, `addon.env`, unsafe
      paths/templates, invalid URL schemes, non-YouTube hosts, and playlists.
- [x] Add fake `yt-dlp` binary tests with no network dependency.
- [x] Assert argv-style execution and absence of shell interpolation.
- [x] Assert minimized env excludes representative credential variables.
- [x] Assert output path confinement, file-size output,
      provider/model metadata, and stdout/stderr process logs.
- [x] Assert failures include logs for non-zero fake binary exit.

### 6. User-facing Documentation and Skills

#### `README.md`
#### `.codex/skills/rielflow-workflow/SKILL.md`
#### `.codex/skills/rielflow-workflow/references/workflow-format.md`

**Status**: COMPLETED

**Checklist**:

- [x] Add the built-in add-on name and version to existing add-on lists.
- [x] Document required `addon.inputs.url`.
- [x] Document supported config keys and defaults.
- [x] Document YouTube-only, no-playlist, path-confinement, and external
      `yt-dlp` prerequisite behavior.
- [x] If any workflow package, prompt, script, or skill-package metadata is
      edited, refresh package digests according to repository package rules.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Core add-on types | `packages/rielflow/src/workflow/addon-types.ts`, `packages/rielflow-core/src/index.ts` | COMPLETED | Typecheck |
| Resolver validation | `packages/rielflow-addons/src/node-addons/*` | COMPLETED | Node add-on resolver tests |
| Native executor | `packages/rielflow-addons/src/native-node-executor/*` | COMPLETED | Fake `yt-dlp` executor tests |
| Exports and boundaries | `packages/rielflow-addons/src/index.ts`, `packages/rielflow/src/workflow/*.ts`, `packages/rielflow/src/package-boundaries.test.ts` | COMPLETED | Package boundary tests |
| Documentation and skills | `README.md`, `.codex/skills/rielflow-workflow/*` | COMPLETED | Review plus format |

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| Resolver validation | Core add-on types and constants | COMPLETED |
| Native executor dispatch | Resolved add-on type and normalized config | COMPLETED |
| Fake binary tests | Resolver and native executor entry point | COMPLETED |
| Documentation and skills | Final config/output contract | COMPLETED |

## Parallelization

Tasks may run in parallel only when write scopes are disjoint:

- Module 1 can run before all others and should complete first.
- Module 2 and Module 3 should not run in parallel because they share resolved
  add-on contracts.
- Module 5 may start test scaffolding in parallel with Module 3 only if it
  writes tests without changing executor implementation files.
- Module 6 can run in parallel with Module 3 after Module 2 finalizes the
  public config and add-on name/version.

## Verification Plan

Run focused checks first:

```bash
bun test packages/rielflow/src/workflow/node-addons/*.test.ts packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts
bun test packages/rielflow-addons/src/**/*.test.ts packages/rielflow/src/workflow/addon-package-boundary.test.ts packages/rielflow/src/package-boundaries.test.ts
```

Then run repository-wide checks:

```bash
bun run typecheck
bun run format
```

Use fake `yt-dlp` binaries only in tests. Do not perform network downloads.

## Completion Criteria

- [x] `workflow.json.nodes[].addon` resolves `rielflow/youtube-mp4-download`
      version `1`.
- [x] Manager/add-on misuse remains rejected by existing worker-only validation.
- [x] Config and input validation matches the accepted design.
- [x] `addon.env` is rejected for this add-on.
- [x] Rendered URL validation allows only supported single-video YouTube routes
      and rejects playlists.
- [x] Subprocess execution uses argv spawning without shell execution.
- [x] Output directories and returned output paths stay inside the workflow
      working directory.
- [x] Process env minimization excludes representative credential and provider
      variables in tests.
- [x] Output payload includes status, URL, relative output path, file name,
      optional file size, residual risks, provider, model, and process logs.
- [x] User-facing docs and rielflow workflow skill references include the add-on.
- [x] Focused tests, typecheck, and format pass.

## Progress Log

### Session: 2026-06-05

**Tasks Completed**: Implementation plan created from accepted design.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 3 requested explicit playlist rejection and exact docs/skill
target paths; both are captured above.

### Session: 2026-06-05 Step 6

**Tasks Completed**: Implemented resolver validation, native argv-based
`yt-dlp` execution, package exports, fake-binary tests, README updates, and
rielflow workflow skill reference updates. No `rielflow-package.json` exists in
this checkout, so no package digest refresh was available.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: `bun run lint:biome`, `bun run typecheck`, `bun run build`,
focused add-on tests, package-boundary tests, and `bun run test` pass.

### Session: 2026-06-06 Step 6 Rerun

**Tasks Completed**: Addressed Step 7 mid findings by restricting accepted
YouTube URLs to single-video routes and downloading into a fresh per-execution
child directory under the configured output directory so stale MP4 files cannot
be returned.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added resolver coverage for accepted video-shaped URLs and rejected
channel/search/home/playlist URLs; updated fake `yt-dlp` native executor
coverage with a preexisting stale MP4 in the configured output directory.
`bun run lint:biome`, `bun run typecheck`, `bun run build`, focused add-on
tests, package-boundary tests, and `bun run test` pass after the rerun fixes.
