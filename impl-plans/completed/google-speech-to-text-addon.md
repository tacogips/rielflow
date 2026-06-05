# Google Speech-to-Text Add-on Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#built-in-rielflowgoogle-speech-to-text`; `design-docs/specs/architecture.md#built-in-node-add-on-catalog`
**Created**: 2026-06-05
**Last Updated**: 2026-06-06

---

## Design Document Reference

**Sources**:

- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md:1289`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md:1390`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md:1414`
- `design-docs/specs/architecture.md:1256`

### Summary

Complete the built-in `rielflow/google-speech-to-text` worker add-on on the
current `feature/google-speech-to-text-addon` branch. The add-on transcribes
local audio files or `gs://` URIs through `@google-cloud/speech`, supports
Japanese-only, English-only, and mixed Japanese/English recognition, and emits
JSON, SRT, and VTT artifacts through ordinary rielflow node output.

### Scope

**Included**:

- Built-in add-on descriptor, config validation, resolver routing, and exported
  public types for `rielflow/google-speech-to-text@1`.
- Native executor support for local file `audio.content`, `gs://` `audio.uri`,
  sync and long-running recognition, response normalization, and artifact
  writes.
- Explicit credential handling for `GOOGLE_APPLICATION_CREDENTIALS` and
  kinko/direnv-friendly `GOOGLE_APPLICATION_CREDENTIALS_JSON` without tracked
  secret material.
- Deterministic unit tests plus live Google Speech-to-Text smoke coverage for
  generated Japanese-only, English-only, and mixed Japanese/English fixtures
  when ai-tools-proj credentials are available.
- README and rielflow workflow/add-on skill documentation updates.

**Excluded**:

- Provider-independent speech abstraction or alternate speech providers.
- Persisting service-account JSON in tracked files or workflow artifacts.
- Requiring live GCP credentials for deterministic CI/unit test success.
- Changing non-speech add-on semantics except shared resolver/export wiring
  needed to register this built-in add-on.

---

## Issue And Reference Traceability

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Node: `step4-impl-plan-create`
- Issue reference: runtime input, no GitHub issue URL or issue number provided
- Repository root: current project root
- Accepted design review: Step 3, `needs_revision: false`, `accepted: true`

Codex-agent references:

- `user-scope skill riel-codex-impl-workflow`
- `workflow codex-design-and-implement-review-loop`
- `user-scope skill rielflow-node-addons`
- `skill ts-coding-standards`
- `skills supply-chain-secure-install and supply-chain-secure-code`
- Brave Computer Use-created GCP service account credentials for ai-tools-proj
  live smoke only, stored through kinko and removed from plaintext local storage

Intentional divergences accepted in the design:

- No Cursor adapter behavior is added or changed.
- Google Speech-to-Text remains a native built-in add-on, not a workflow-local
  node payload or generic provider adapter.
- Mixed Japanese/English uses `ja-JP` plus `alternativeLanguageCodes: ["en-US"]`
  unless a later Google provider mode is explicitly documented.

---

## Modules

### 1. Add-on Config, Descriptor, And Type Exports

#### packages/rielflow-addons/src/node-addons/google-speech-to-text-config.ts
#### packages/rielflow-addons/src/node-addons/addon-payload-resolution.ts
#### packages/rielflow-addons/src/node-addons.ts
#### packages/rielflow/src/workflow/addon-types.ts
#### packages/rielflow-core/src/index.ts

**Status**: COMPLETED

```typescript
type GoogleSpeechToTextOutputFormat = "json" | "srt" | "vtt";
type GoogleSpeechToTextRecognitionMode = "sync" | "long-running";

interface GoogleSpeechToTextAddonConfig {
  readonly audioPathTemplate?: string;
  readonly gcsUriTemplate?: string;
  readonly languageCodeTemplate: string;
  readonly alternativeLanguageCodes?: readonly string[];
  readonly encoding?: string;
  readonly sampleRateHertz?: number;
  readonly audioChannelCount?: number;
  readonly model?: string;
  readonly useEnhanced?: boolean;
  readonly enableAutomaticPunctuation?: boolean;
  readonly enableWordTimeOffsets?: boolean;
  readonly enableWordConfidence?: boolean;
  readonly profanityFilter?: boolean;
  readonly maxAlternatives?: number;
  readonly recognitionMode?: GoogleSpeechToTextRecognitionMode;
  readonly outputFormats?: readonly GoogleSpeechToTextOutputFormat[];
  readonly outputBaseNameTemplate?: string;
}

interface ResolvedGoogleSpeechToTextAddon {
  readonly name: "rielflow/google-speech-to-text";
  readonly version: "1";
  readonly config: GoogleSpeechToTextAddonConfig;
}
```

**Checklist**:

- [x] Validate exactly one of `audioPathTemplate` or `gcsUriTemplate`.
- [x] Require `languageCodeTemplate` and preserve `addon.inputs` as variables.
- [x] Accept explicit `addon.env` only for
      `GOOGLE_APPLICATION_CREDENTIALS` and `GOOGLE_APPLICATION_CREDENTIALS_JSON`.
- [x] Export config and resolved add-on types across rielflow package
      boundaries.
- [x] Keep unsupported add-on versions and unknown config keys rejected.

### 2. Native Speech Executor

#### packages/rielflow-addons/src/native-node-executor/google-speech-to-text-addon.ts
#### packages/rielflow-addons/src/native-node-executor/git-and-addon-execution.ts

**Status**: COMPLETED

```typescript
interface GoogleSpeechRecognizeRequestLike {
  readonly config: Readonly<Record<string, unknown>>;
  readonly audio: Readonly<Record<string, unknown>>;
}

interface GoogleSpeechClientLike {
  recognize(
    request: GoogleSpeechRecognizeRequestLike,
  ): Promise<readonly [GoogleSpeechRecognizeResponseLike]>;
  longRunningRecognize(
    request: GoogleSpeechRecognizeRequestLike,
  ): Promise<readonly [GoogleSpeechOperationLike]>;
}

interface NormalizedGoogleSpeechResponse {
  readonly transcript: string;
  readonly segments: readonly SubtitleSegment[];
}
```

**Checklist**:

- [x] Resolve templates and working directories using existing native add-on
      helpers.
- [x] Use local file bytes as base64 `audio.content`.
- [x] Use rendered `gs://` values as Google Speech `audio.uri`.
- [x] Default local files to `recognize` and `gs://` to
      `longRunningRecognize`, while honoring explicit `recognitionMode`.
- [x] Parse `GOOGLE_APPLICATION_CREDENTIALS_JSON` in memory without logging or
      writing raw JSON.
- [x] Return sanitized errors that do not expose credential JSON, private keys,
      client emails, or local secret paths.

### 3. Output Normalization And Artifacts

#### packages/rielflow-addons/src/native-node-executor/google-speech-to-text-addon.ts

**Status**: COMPLETED

```typescript
interface SubtitleSegment {
  readonly index: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
  readonly confidence?: number;
  readonly languageCode?: string;
  readonly words: readonly {
    readonly word: string;
    readonly startSeconds?: number;
    readonly endSeconds?: number;
    readonly confidence?: number;
  }[];
}

interface GoogleSpeechToTextOutput {
  readonly googleSpeechToText: {
    readonly transcript: string;
    readonly languageCode: string;
    readonly recognitionMode: GoogleSpeechToTextRecognitionMode;
    readonly segments: readonly SubtitleSegment[];
    readonly outputFiles: Readonly<Partial<Record<GoogleSpeechToTextOutputFormat, string>>>;
  };
  readonly transcript: string;
  readonly outputFiles: Readonly<Partial<Record<GoogleSpeechToTextOutputFormat, string>>>;
  readonly captions?: {
    readonly srt?: string;
    readonly vtt?: string;
  };
}
```

**Checklist**:

- [x] Preserve transcript, confidence, language code, word timestamps, and
      fallback timing in normalized segments.
- [x] Generate deterministic valid SRT/VTT when word timestamps are missing.
- [x] Write requested JSON/SRT/VTT files under the node artifact directory.
- [x] Return absolute artifact paths in `googleSpeechToText.outputFiles` and
      compatibility aliases.
- [x] Sanitize `outputBaseNameTemplate` to prevent path traversal.

### 4. Dependency And Supply-chain Updates

#### packages/rielflow-addons/package.json
#### package.json
#### bun.lock

**Status**: COMPLETED

```typescript
interface GoogleSpeechDependencyUpdate {
  readonly packageName: "@google-cloud/speech";
  readonly packageScope: "packages/rielflow-addons";
  readonly lockfileUpdatedByBun: true;
  readonly installScriptsReviewed: true;
}
```

**Checklist**:

- [x] Keep `@google-cloud/speech` scoped to the add-ons package unless root
      metadata requires a deterministic workspace update.
- [x] Use Bun lockfile updates generated by Bun, not ad hoc lockfile edits.
- [x] Review install output and lockfile diff for expected Google Cloud Speech,
      auth, gax, and transport transitive packages; no credential files or
      machine-local paths were added.
- [x] Avoid adding ambient credential files or machine-local paths.

### 5. Deterministic Tests

#### packages/rielflow/src/workflow/google-speech-to-text-addon.test.ts

**Status**: COMPLETED

```typescript
interface GoogleSpeechAddonTestMatrix {
  readonly resolverValidation: true;
  readonly localAudioContentRequest: true;
  readonly gcsUriRequest: true;
  readonly japaneseOnly: "ja-JP";
  readonly englishOnly: "en-US";
  readonly mixedJapaneseEnglish: {
    readonly languageCode: "ja-JP";
    readonly alternativeLanguageCodes: readonly ["en-US"];
  };
  readonly outputs: readonly ["json", "srt", "vtt"];
  readonly credentialJsonRedaction: true;
  readonly credentialFilePathRedaction: true;
}
```

**Checklist**:

- [x] Cover add-on resolver success and validation failures.
- [x] Assert local file requests use `audio.content`, not `audio.uri`.
- [x] Assert `gs://` requests use `audio.uri` and long-running mode by default.
- [x] Cover Japanese-only, English-only, and mixed Japanese/English request
      shapes.
- [x] Assert JSON, SRT, and VTT artifacts are written and referenced.
- [x] Cover credential env behavior without exposing raw secret values.

### 6. Live Smoke Setup And Evidence

#### tmp/google-speech-to-text-smoke/
#### ignored generated audio and smoke artifacts

**Status**: COMPLETED

```typescript
interface GoogleSpeechLiveSmokePlan {
  readonly projectId: "ai-tools-proj";
  readonly credentialSources: readonly [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  ];
  readonly fixtures: readonly [
    "japanese-only",
    "english-only",
    "mixed-japanese-english",
  ];
  readonly plaintextCredentialRemovedAfterKinkoStorage: true;
  readonly trackedSecretFiles: false;
}
```

**Checklist**:

- [x] Use Brave Computer Use-created service-account credential only as local
      ignored smoke material for ai-tools-proj.
- [x] Store credential JSON in kinko for direnv export and remove local
      plaintext credential after storage.
- [x] Generate test audio under ignored temp paths.
- [x] Run live smoke for Japanese-only, English-only, and mixed fixtures when
      API, IAM, billing, and network are available.
- [x] Record smoke result without secret values:
      kinko-exported `GOOGLE_APPLICATION_CREDENTIALS_JSON` succeeded for
      Japanese-only, English-only, and mixed fixtures, and each run emitted
      JSON/SRT/VTT artifacts under ignored temp paths.

### 7. Documentation And Skill Updates

#### README.md
#### .codex/skills/rielflow-workflow/SKILL.md
#### .codex/skills/rielflow-workflow/references/workflow-format.md

**Status**: COMPLETED

```typescript
interface GoogleSpeechDocumentationUpdate {
  readonly addonName: "rielflow/google-speech-to-text";
  readonly credentialDocsCoverFileAndJsonEnv: true;
  readonly examplesCoverLocalAndGcsAudio: true;
  readonly outputDocsCoverJsonSrtVtt: true;
  readonly secretValuesIncluded: false;
}
```

**Checklist**:

- [x] Document authored `workflow.nodes[].addon` object form with explicit
      version.
- [x] Document local audio and `gs://` URI input options.
- [x] Document Japanese-only, English-only, and mixed Japanese/English language
      modes.
- [x] Document `GOOGLE_APPLICATION_CREDENTIALS` and
      `GOOGLE_APPLICATION_CREDENTIALS_JSON` without secret examples.
- [x] Refresh package digests only if workflow, prompt, script, or skill edits
      require it.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Config, descriptor, and exports | `packages/rielflow-addons/src/node-addons/google-speech-to-text-config.ts`; `packages/rielflow/src/workflow/addon-types.ts`; `packages/rielflow-core/src/index.ts` | COMPLETED | Targeted resolver tests passed |
| Native executor and dispatch | `packages/rielflow-addons/src/native-node-executor/google-speech-to-text-addon.ts`; `packages/rielflow-addons/src/native-node-executor/git-and-addon-execution.ts` | COMPLETED | Targeted fake-client tests passed |
| Output artifacts | `packages/rielflow-addons/src/native-node-executor/google-speech-to-text-addon.ts` | COMPLETED | JSON/SRT/VTT assertions passed |
| Dependency updates | `packages/rielflow-addons/package.json`; `package.json`; `bun.lock` | COMPLETED | Build/typecheck/full test passed |
| Deterministic tests | `packages/rielflow/src/workflow/google-speech-to-text-addon.test.ts` | COMPLETED | Targeted test command passed |
| Live smoke | `tmp/google-speech-to-text-smoke/` | COMPLETED | kinko-backed live smoke passed for Japanese-only, English-only, and mixed fixtures with JSON/SRT/VTT artifacts |
| Docs and skill updates | `README.md`; `.codex/skills/rielflow-workflow/SKILL.md`; `.codex/skills/rielflow-workflow/references/workflow-format.md` | COMPLETED | Doc review and digest check completed; no package digest refresh required |

## Task Breakdown

| Task | Deliverable | Dependencies | Parallelizable | Write Scope |
|------|-------------|--------------|----------------|-------------|
| TASK-001 | Finish config validation, descriptor output contract, resolver wiring, and public type exports | Accepted Step 3 design | No | add-on config, resolver, export files |
| TASK-002 | Finish native executor request construction, credential handling, recognition mode selection, and dispatch routing | TASK-001 | No | native executor and dispatch files |
| TASK-003 | Finish response normalization and JSON/SRT/VTT artifact payloads | TASK-002 | No | native executor output helpers |
| TASK-004 | Finalize Bun dependency changes for `@google-cloud/speech` and review lockfile/install surface | Accepted Step 3 design | Yes | package manifests and `bun.lock` |
| TASK-005 | Complete deterministic unit tests for validation, local audio, `gs://`, language modes, artifacts, and credential redaction | TASK-001, TASK-002, TASK-003 | No | workflow test files |
| TASK-006 | Run and record live GCP smoke with ignored generated audio and kinko/direnv credentials | TASK-002, TASK-003, TASK-004 | No | ignored tmp paths only |
| TASK-007 | Refresh README and rielflow workflow/add-on skill docs; refresh digests only if required | TASK-001, TASK-003 | Yes | documentation and skill reference files |
| TASK-008 | Run final verification, inspect git diff, and prepare implementation review evidence | TASK-001 through TASK-007 | No | no code writes expected except logs under ignored paths |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Config and exports | Accepted Step 3 design | READY |
| Native executor | Config and resolved add-on type | COMPLETED |
| Artifact output contract | Native executor response normalization | COMPLETED |
| Unit tests | Config, executor, and artifacts | COMPLETED |
| Live smoke | Executor, dependency install, credentials, API/IAM/billing/network | COMPLETED |
| Documentation | Final config and output contract | COMPLETED |
| Final review evidence | All implementation and verification tasks | COMPLETED |

## Parallelizable Tasks

- `TASK-004` can run in parallel with `TASK-001` because its write scope is
  package manifests and lockfile only.
- `TASK-007` can run in parallel after `TASK-001` and `TASK-003` because its
  write scope is documentation and skill references only.
- No executor and test tasks are marked parallelizable because they share the
  same behavior contract and test expectations.

## Verification Plan

Required commands:

- `git status --short --branch`
- `git diff --stat`
- `bun test packages/rielflow/src/workflow/google-speech-to-text-addon.test.ts`
- `bun run typecheck`
- `bun run build`
- `bun test`
- Live Google Speech-to-Text smoke using ignored generated Japanese-only,
  English-only, and mixed Japanese/English audio with credentials sourced from
  kinko/direnv as `GOOGLE_APPLICATION_CREDENTIALS_JSON` or
  `GOOGLE_APPLICATION_CREDENTIALS`

Credential safety checks:

- Confirm no tracked file contains service-account JSON, `private_key`, or
  plaintext credential paths.
- Confirm smoke artifacts and generated audio remain under ignored temp paths.
- Confirm final logs and documentation mention credential environment variable
  names only, not secret values.

## Completion Criteria

- [x] `rielflow/google-speech-to-text@1` validates through authored
      `workflow.nodes[].addon` object form.
- [x] Exactly one of `audioPathTemplate` or `gcsUriTemplate` is required, and
      `languageCodeTemplate` is required.
- [x] Local audio requests use base64 `audio.content`; `gs://` requests use
      `audio.uri`.
- [x] Japanese-only, English-only, and mixed Japanese/English language modes are
      covered by deterministic tests.
- [x] JSON, SRT, and VTT outputs are emitted under the node artifact directory
      with paths returned in the node payload.
- [x] `GOOGLE_APPLICATION_CREDENTIALS` and
      `GOOGLE_APPLICATION_CREDENTIALS_JSON` work without tracked credential
      material or secret leakage.
- [x] README and rielflow workflow/add-on skill docs describe the add-on,
      credentials, inputs, and outputs.
- [x] Required verification commands pass or any environment-gated live smoke
      limitation is recorded with concrete cause and no secret values.

## Progress Log Expectations

Each implementation session must add a dated progress entry with:

- tasks completed, tasks in progress, and blockers
- verification commands run and pass/fail results
- explicit live smoke status, including whether ai-tools-proj API/IAM/billing
  and credentials were available
- confirmation that credential values were not committed, logged, or written to
  tracked files

### Session: 2026-06-05

**Tasks Completed**: Plan created from accepted Step 3 design.
**Tasks In Progress**: TASK-001 through TASK-005 and TASK-007 have current
branch diff material and need implementation review/finalization.
**Blockers**: Live smoke depends on ai-tools-proj credentials, API, IAM,
billing, and network availability.
**Notes**: Step 3 accepted the design with no findings. Step 2 rerun already
addressed prior mid findings for local-vs-`gs://` request flow and concrete
current-branch module mapping.

### Session: 2026-06-05 23:43 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005,
TASK-007, TASK-008.
**Tasks In Progress**: None.
**Blockers**: At this point TASK-006 live GCP smoke was blocked by environment:
Step 6 preflight found no `GOOGLE_APPLICATION_CREDENTIALS` or
`GOOGLE_APPLICATION_CREDENTIALS_JSON` exported, so ai-tools-proj API/IAM/billing
access could not be exercised without writing or requesting credential material.
This was resolved in the 2026-06-06 00:36 JST follow-up smoke.
**Notes**: Finalized built-in resolver/config validation, explicit Google
credential env mapping, native local-file and `gs://` request construction,
sync/long-running dispatch, JSON/SRT/VTT artifact output, credential error
redaction, package-boundary declaration expectations, docs, and deterministic
tests. Secret-pattern review found only environment variable names, synthetic
redaction fixtures, and existing unrelated repository path references; no real
service-account JSON or plaintext credential path was added.
**Verification**: Passed targeted Google Speech tests, package-boundary tests,
`bun run lint:biome`, `bun run typecheck`, `bun run build`, and `bun test`
with 1531 pass, 3 skipped, 0 fail.

### Session: 2026-06-06 00:21 JST

**Tasks Completed**: Step 7 rerun feedback addressed for TASK-002, TASK-005,
TASK-007, and TASK-008.
**Tasks In Progress**: None.
**Blockers**: At this point TASK-006 live GCP smoke was blocked by environment:
no `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_APPLICATION_CREDENTIALS_JSON`
export was available for a credential-backed ai-tools-proj smoke. This was
resolved in the 2026-06-06 00:36 JST follow-up smoke.
**Notes**: Wrapped Google Speech client initialization and provider calls in
the same credential redaction path, redacted configured credential file paths
and credential-like absolute JSON paths, added provider error regression
coverage for `GOOGLE_APPLICATION_CREDENTIALS` keyFilename paths, and expanded
README plus workflow skill docs with `GOOGLE_APPLICATION_CREDENTIALS_JSON`
`addon.env` guidance. No credential values were committed, logged, or written
to tracked files.
**Verification**: Passed targeted Google Speech tests, `bun run lint:biome`,
`bun run typecheck`, `bun run build`, and `bun test`.

### Session: 2026-06-06 00:43 JST

**Tasks Completed**: Step 7 rerun feedback from exec-000017 addressed for
TASK-002, TASK-005, and TASK-008.
**Tasks In Progress**: None.
**Blockers**: At this point TASK-006 live GCP smoke was blocked by environment:
no `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_APPLICATION_CREDENTIALS_JSON`
export was available for a credential-backed ai-tools-proj smoke. This was
resolved in the 2026-06-06 00:36 JST follow-up smoke.
**Notes**: Added source environment fallback for
`GOOGLE_APPLICATION_CREDENTIALS` and `GOOGLE_APPLICATION_CREDENTIALS_JSON` when
`addon.env` is omitted, included those fallback values in the Google Speech
client/provider redaction set, and added regression coverage for ambient JSON
credentials plus ambient credential-path redaction. No credential values were
committed, logged, or written to tracked files.
**Verification**: Passed targeted Google Speech tests, `bun run lint:biome`,
`bun run typecheck`, `bun run build`, and `bun test`.

### Session: 2026-06-06 00:36 JST

**Tasks Completed**: TASK-006 live GCP smoke completed after storing the
Brave-created ai-tools-proj service-account JSON in kinko as
`GOOGLE_APPLICATION_CREDENTIALS_JSON` and deleting the ignored plaintext
credential file.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Live smoke used ignored generated audio under
`tmp/google-stt-live/audio` and wrote ignored artifacts under
`tmp/google-stt-live/artifacts/kinko-*`. No credential values were printed,
tracked, or written into this plan.
**Verification**: kinko-backed live smoke passed for Japanese-only,
English-only, and mixed fixtures. Recognized transcript summaries were
Japanese-only: `こんにちは。世界、これは日本語だけのテストです。`;
English-only: `Hello world. This is an english-only test.`; mixed:
`こんにちは。ワールド、これはミックストランゲージテストです。`. Each run emitted
JSON, SRT, and VTT artifacts.

## Related Plans

- **Previous**: `impl-plans/node-addon-chat-reply-worker.md`
- **Depends On**:
  `impl-plans/active/executable-node-addon-manifest-dependencies.md`,
  `impl-plans/active/sdk-node-addons-review-improvements.md`
