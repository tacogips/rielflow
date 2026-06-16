# Swift Homebrew Production Cutover Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-swift-native-migration.md#branch-production-swift-homebrew-release-cutover`
**Created**: 2026-06-12
**Last Updated**: 2026-06-12

## Related Plans

- **Previous**: `impl-plans/completed/swift-native-migration.md`
- **Previous**: `impl-plans/completed/swift-native-migration-task-009-final-cutover-gate.md`
- **Depends On**: `completed/swift-native-migration:TASK-009`
- **Depends On**: `completed/swift-native-migration-task-009-final-cutover-gate:TASK-009F`

## Design Reference

Source of truth:

- `design-docs/specs/design-swift-native-migration.md#branch-production-swift-homebrew-release-cutover`
- `design-docs/specs/design-swift-native-migration.md#verification-gates`
- `design-docs/specs/architecture.md`
- `design-docs/user-qa/qa-swift-native-migration.md#release-cutover-threshold`
- `packaging/homebrew/swift-cutover-gates.json`
- `packaging/homebrew/README.md`
- `scripts/build-homebrew-release.sh`
- `scripts/render-homebrew-formula.sh`
- `Formula/rielflow.rb`

### Summary

Switch branch-local production Homebrew packaging from Bun compiled archives to
Swift executable archives after TASK-009 acceptance. Production archives stay
under `dist/homebrew`, keep the existing archive basename convention
`rielflow-<version>-<target>.tar.gz`, and install `bin/rielflow`. The cutover
must update the formula renderer, local formula smoke path, documentation, and
`packaging/homebrew/swift-cutover-gates.json` only after replayable evidence is
recorded.

### Scope

**Included**: production Swift archive planning, production archive script
cutover, checksum sidecar portability, macOS formula rendering from
`dist/homebrew`, fail-closed Linux behavior until an explicit Swift Linux
contract exists, local formula smoke verification, cutover gate evidence, and
documentation updates.

**Excluded**: GitHub release upload, tap repository mutation, TypeScript/Bun
source removal, live LLM credential tests, native macOS UI work, and
Cursor-specific behavior outside `CursorCLIAgent`.

## Issue Reference

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Node: `step4-impl-plan-create`
- Repository: `tacogips/rielflow`
- Issue title: `Switch branch production packaging from Bun archives to Swift executable archives`
- GitHub issue: none supplied by runtime input

## Codex Agent References

- Preferred local root `../../codex-agent`: unavailable for this workflow.
- Adjacent `../codex-agent`: reference-only; no source should be copied.
- Current Rielflow packaging scripts, TASK-009 evidence, Swift runtime tests,
  and pinned package contracts remain the behavior references.
- Intentional divergence: production Homebrew packaging may now use Swift
  executable archives in `dist/homebrew`; pre-cutover readiness archives under
  `dist/swift-homebrew` remain historical evidence.

## Modules

### 1. Production Swift Archive Contract

#### `Sources/RielflowCore/SwiftPackagingReadiness.swift`
#### `Tests/RielflowCoreTests/SwiftPackagingReadinessTests.swift`

**Status**: COMPLETED

```typescript
type SwiftHomebrewProductionTarget = "darwin-arm64" | "darwin-x64";

interface SwiftHomebrewProductionArchivePlan {
  version: string;
  target: SwiftHomebrewProductionTarget;
  executableProduct: "rielflow";
  releaseDirectory: "dist/homebrew";
  stagedBinaryPath: `dist/homebrew/work/rielflow-${string}-${SwiftHomebrewProductionTarget}/bin/rielflow`;
  archivePath: `dist/homebrew/rielflow-${string}-${SwiftHomebrewProductionTarget}.tar.gz`;
  checksumPath: `${string}.sha256`;
  publishSideEffects: false;
}
```

**Checklist**:

- [x] Add a production archive plan separate from TASK-008 readiness names.
- [x] Keep supported production Swift targets macOS-only for this cutover.
- [x] Assert the production plan uses `dist/homebrew` and omits the
      `rielflow-swift-` readiness prefix.
- [x] Keep readiness archive tests intact as historical TASK-008/TASK-009
      evidence.

### 2. Production Archive Builder

#### `scripts/build-homebrew-release.sh`
#### `Tests/RielflowCoreTests/SwiftPackagingReadinessTests.swift`

**Status**: COMPLETED

```typescript
interface SwiftProductionArchiveBuildInput {
  version: string;
  target: "darwin-arm64" | "darwin-x64";
  releaseDirectory: string;
  swiftExecutable: string;
  developerDir: string;
  sdkroot: string;
  dryRun: boolean;
}

interface SwiftProductionArchiveBuildResult {
  archivePath: string;
  checksumPath: string;
  payload: ["./", "./bin/", "./bin/rielflow", "./README.md"];
  checksumSidecarUsesArchiveBasename: true;
  publishSideEffects: false;
}
```

**Checklist**:

- [x] Switch the production release builder from `bun build --compile` to
      Xcode SwiftPM release builds for `--product rielflow`.
- [x] Add or preserve `--dry-run` behavior for production archive planning.
- [x] Reuse the TASK-008 path safety rules for version validation, release
      directory validation, containment checks, and checksum basename output.
- [x] Reject Linux targets with an explicit fail-closed message until a Swift
      Linux build contract exists.
- [x] Do not upload releases, commit tap changes, or run Homebrew from the
      archive builder.

### 3. Formula Renderer Cutover

#### `scripts/render-homebrew-formula.sh`
#### `Formula/rielflow.rb`
#### `packaging/homebrew/README.md`

**Status**: COMPLETED

```typescript
interface SwiftHomebrewFormulaRenderInput {
  version: string;
  releaseDirectory: "dist/homebrew";
  releaseBaseUrl: string;
  targets: readonly ["darwin-arm64", "darwin-x64"];
  linuxSupport: "unsupported";
}

interface SwiftHomebrewFormulaRenderResult {
  formulaPath: string;
  descriptionMentionsSwift: true;
  macOSUrlsUseSwiftProductionArchives: true;
  linuxFailsClosed: true;
  commandName: "rielflow";
}
```

**Checklist**:

- [x] Render macOS formula URLs from `dist/homebrew` Swift archive checksums.
- [x] Stop requiring Linux checksum files for this Swift-only production
      cutover.
- [x] Make Linux behavior explicit and fail closed rather than silently
      referencing stale Bun archives.
- [x] Update formula description away from TypeScript/Bun runtime wording.
- [x] Keep `RIEL_RELEASE_BASE_URL` as the only URL-base override.

### 4. Gate Manifest Skeleton And Documentation Transition

#### `packaging/homebrew/swift-cutover-gates.json`
#### `packaging/homebrew/README.md`
#### `impl-plans/completed/swift-homebrew-production-cutover.md`
#### `impl-plans/PROGRESS.json`

**Status**: COMPLETED

```typescript
interface SwiftProductionCutoverEvidence {
  intendedProductionRuntime: "swift-native";
  intendedHomebrewFormulaSource: "swift-executable-archive";
  allowsProductionCutover: false;
  productionArchiveDirectory: "dist/homebrew";
  targetEvidence: readonly SwiftProductionCutoverTargetEvidence[];
  task009AdversarialReview: "passed";
  verificationCommands: readonly string[];
}

interface SwiftProductionCutoverTargetEvidence {
  target: "darwin-arm64" | "darwin-x64";
  archiveName: string;
  checksumName: string;
  status: "passed" | "blocked";
  blockedReason?: string;
}
```

**Checklist**:

- [x] Add a production cutover evidence block without deleting TASK-009
      readiness evidence.
- [x] Record separate `darwin-arm64` and `darwin-x64` target evidence. A
      blocked target must include a reason and must prevent top-level production
      marker transition.
- [x] Mark `task009-adversarial-review` passed based on accepted session
      `riel-codex-design-and-implement-review-loop-1781261544-53db3135`.
- [x] Record intended `productionRuntime` and `homebrewFormulaSource` values,
      but keep top-level production markers pending until TASK-005 local smoke
      and leakage verification pass.
- [x] Update packaging docs to describe Swift production archives and keep
      publication as a separate operator action.
- [x] Record progress log entries as tasks move from Ready to In Progress to
      Completed.

### 5. Local Formula Smoke And Leakage Verification

#### `scripts/build-homebrew-release.sh`
#### `scripts/render-homebrew-formula.sh`
#### `Formula/rielflow.rb`
#### `packaging/homebrew/swift-cutover-gates.json`

**Status**: COMPLETED

```typescript
interface SwiftProductionCutoverVerification {
  archivePayloadVerified: boolean;
  checksumVerified: boolean;
  formulaRenderedWithLocalFileBase: boolean;
  homebrewSmoke: "passed" | "blocked-homebrew-missing";
  noMachineLocalPathLeakage: boolean;
  deterministicWorkflowCommandPassed: boolean;
}
```

**Checklist**:

- [x] Verify each produced archive contains only `./`, `./bin/`,
      `./bin/rielflow`, and `./README.md`.
- [x] Validate each `.sha256` sidecar from inside `dist/homebrew`.
- [x] Search checksum files and generated formula for `/Users/`, `/home/`, and
      the current checkout path.
- [x] Render a local formula with
      `RIEL_RELEASE_BASE_URL="file://$PWD/dist/homebrew"`.
- [x] Run `brew install`, `brew test`, `rielflow --help`, and one deterministic
      workflow command when Homebrew is available.
- [x] If Homebrew is unavailable, record the smoke gate as blocked and leave
      `allowsProductionCutover=false`.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Production Swift archive contract | `Sources/RielflowCore/SwiftPackagingReadiness.swift` | COMPLETED | SwiftPackagingReadinessTests |
| Production archive builder | `scripts/build-homebrew-release.sh` | COMPLETED | SwiftPackagingReadinessTests, shell smokes |
| Formula renderer cutover | `scripts/render-homebrew-formula.sh`, `Formula/rielflow.rb` | COMPLETED | render and Homebrew smoke |
| Gate manifest and docs | `packaging/homebrew/swift-cutover-gates.json`, `packaging/homebrew/README.md` | COMPLETED | jq and rg checks |
| Local formula smoke | generated local tap formula | COMPLETED | brew install/test and CLI smoke |

## Tasks

### TASK-001: Production Swift Archive Contract

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `Sources/RielflowCore/SwiftPackagingReadiness.swift`, `Tests/RielflowCoreTests/SwiftPackagingReadinessTests.swift`
**Dependencies**: `completed/swift-native-migration:TASK-009`, `completed/swift-native-migration-task-009-final-cutover-gate:TASK-009F`

**Description**:
Add production Swift Homebrew archive planning that targets `dist/homebrew`
without reusing the readiness-only `rielflow-swift-` archive names.

**Completion Criteria**:

- [x] Production plan emits `rielflow-<version>-darwin-arm64.tar.gz` and
      `rielflow-<version>-darwin-x64.tar.gz`.
- [x] Readiness plan remains unchanged for TASK-008/TASK-009 historical
      evidence.
- [x] Swift focused tests cover production and readiness naming separation.

### TASK-002: Production Builder Swift Cutover

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `scripts/build-homebrew-release.sh`, `Tests/RielflowCoreTests/SwiftPackagingReadinessTests.swift`
**Dependencies**: TASK-001

**Description**:
Switch the production release archive builder to Swift executable archives with
dry-run support, path safety, portable checksums, and fail-closed Linux targets.

**Completion Criteria**:

- [x] Production builder stages `bin/rielflow` from Xcode SwiftPM release
      output.
- [x] Builder writes portable `.sha256` sidecars from archive basenames.
- [x] Builder rejects unsupported Linux targets without creating mixed Bun/Swift
      artifacts.
- [x] Builder has no publish, tap, or formula mutation side effects.

### TASK-003: Formula Renderer Swift Cutover

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `scripts/render-homebrew-formula.sh`, `Formula/rielflow.rb`, `packaging/homebrew/README.md`
**Dependencies**: TASK-002

**Description**:
Render the production formula from Swift macOS archive checksums, update local
formula text, and make Linux unsupported behavior explicit until a Swift Linux
contract exists.

**Completion Criteria**:

- [x] Renderer needs only macOS Swift archive checksums for this cutover.
- [x] Generated formula URLs point at production Swift archives under
      `dist/homebrew`.
- [x] Formula installs `bin/rielflow` and keeps command name `rielflow`.
- [x] Linux does not reference stale Bun archive URLs or checksums.

### TASK-004: Production Gate Manifest Skeleton And Docs

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packaging/homebrew/swift-cutover-gates.json`, `packaging/homebrew/README.md`, `impl-plans/completed/swift-homebrew-production-cutover.md`, `impl-plans/PROGRESS.json`
**Dependencies**: TASK-002, TASK-003

**Description**:
Prepare production cutover evidence and update docs after the branch-local
archive/formula gates pass. Do not finalize top-level production markers until
TASK-005 local formula smoke and leakage checks pass.

**Completion Criteria**:

- [x] `task009-adversarial-review` is no longer blocked because TASK-009 review
      accepted with no high or mid findings.
- [x] Intended `productionRuntime=swift-native` and
      `homebrewFormulaSource=swift-executable-archive` values are recorded in
      production cutover evidence.
- [x] Top-level `productionRuntime`, `homebrewFormulaSource`, and
      `allowsProductionCutover` changed only after TASK-005 final verification
      passed.
- [x] Historical TASK-009 evidence remains readable.

### TASK-005: Verification And Release Handoff

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packaging/homebrew/swift-cutover-gates.json`, `impl-plans/completed/swift-homebrew-production-cutover.md`, `impl-plans/PROGRESS.json`
**Dependencies**: TASK-004

**Description**:
Run the full production cutover verification suite, record exact commands, and
leave release upload and tap mutation as separate operator actions.

**Completion Criteria**:

- [x] Baseline TypeScript/Bun checks still pass.
- [x] Full Xcode `swift test` passes.
- [x] Production archive dry-run, build, payload, and checksum checks pass for
      both `darwin-arm64` and `darwin-x64`, or any unavailable target is
      recorded as blocked and prevents top-level production marker transition.
- [x] Payload, checksum, local path leakage, formula render, Homebrew smoke, and
      deterministic workflow command results are recorded.
- [x] `productionRuntime` becomes `swift-native`,
      `homebrewFormulaSource` becomes `swift-executable-archive`, and
      `allowsProductionCutover` becomes `true` only if all required local smoke
      and leakage gates pass.
- [x] Plan progress log and PROGRESS.json task statuses are updated.

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| TASK-001 | completed Swift TASK-009 evidence | COMPLETED |
| TASK-002 | TASK-001 | COMPLETED |
| TASK-003 | TASK-002 | COMPLETED |
| TASK-004 | TASK-002, TASK-003 | COMPLETED |
| TASK-005 | TASK-004 | COMPLETED |

## Parallelizable Tasks

- TASK-001 is parallelizable at plan start because it writes Swift planning
  types/tests only after completed cross-plan prerequisites.
- TASK-002 and TASK-003 are sequential because the builder contract determines
  the formula checksum inputs and both tasks can touch packaging documentation.
- TASK-004 and TASK-005 are sequential because they mutate the gate manifest and
  plan progress state based on verification evidence.

## Verification

Required commands:

```bash
git status --short --branch
git diff --check
jq empty impl-plans/PROGRESS.json
jq empty packaging/homebrew/swift-cutover-gates.json
bun run typecheck:server
bun run lint:biome
bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --scope project
/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift --version
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test
RIEL_VERSION=0.0.0-cutover scripts/build-homebrew-release.sh --dry-run darwin-arm64 darwin-x64
RIEL_VERSION=0.0.0-cutover scripts/build-homebrew-release.sh --dry-run linux-x64
RIEL_VERSION=0.1.15 scripts/build-homebrew-release.sh darwin-arm64 darwin-x64
tar -tzf dist/homebrew/rielflow-0.1.15-darwin-arm64.tar.gz
tar -tzf dist/homebrew/rielflow-0.1.15-darwin-x64.tar.gz
(cd dist/homebrew && shasum -a 256 -c rielflow-0.1.15-darwin-arm64.tar.gz.sha256)
(cd dist/homebrew && shasum -a 256 -c rielflow-0.1.15-darwin-x64.tar.gz.sha256)
! rg -n "/Users/|/home/|$(pwd)" dist/homebrew/*.sha256 Formula/rielflow.rb
jq '.productionCutoverEvidence.targetEvidence[] | select(.target == "darwin-arm64" or .target == "darwin-x64") | {target,status,blockedReason}' packaging/homebrew/swift-cutover-gates.json
brew tap-new local/rielflow-test
tap_root="$(brew --repository local/rielflow-test)"
RIEL_RELEASE_BASE_URL="file://$PWD/dist/homebrew" scripts/render-homebrew-formula.sh 0.1.15 "$tap_root/Formula/rielflow.rb"
brew install local/rielflow-test/rielflow
brew test local/rielflow-test/rielflow
rielflow --help
rielflow workflow validate codex-design-and-implement-review-loop --scope project --output json
brew uninstall rielflow
brew untap local/rielflow-test
```

If either macOS target cannot be built on the current host or supported builder,
record it as blocked with host-target evidence and leave
`productionRuntime=typescript-bun`, `homebrewFormulaSource=bun-archive`, and
`allowsProductionCutover=false`.

## Completion Criteria

- [x] Production Homebrew archive script builds Swift executable archives under
      `dist/homebrew`.
- [x] Generated formula uses Swift macOS archives and no stale Bun Linux URLs.
- [x] `packaging/homebrew/swift-cutover-gates.json` records passed production
      archive, checksum, formula, local smoke, and leakage evidence before
      enabling production cutover.
- [x] Both `darwin-arm64` and `darwin-x64` have passed evidence, or a blocked
      target record keeps production marker transition disabled.
- [x] GitHub release upload and tap mutation are not performed by verification.
- [x] Plan progress log and `impl-plans/PROGRESS.json` reflect final task
      statuses and review findings.

## Progress Log

### Session: 2026-06-12 21:20

**Tasks Completed**: None
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Created branch-local production cutover plan from accepted Step 3
design review. Implementation must keep publication side effects outside
verification.

### Session: 2026-06-12 21:20 Self-Review

**Tasks Completed**: None
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Fixed plan-only sequencing before Step 5 review. TASK-004 now
prepares evidence and docs without finalizing top-level production markers;
TASK-005 owns final production marker transition after local Homebrew smoke and
leakage checks pass. Verification commands now follow the documented local tap
smoke flow.

### Session: 2026-06-12 21:20 Step 5 Review Fix

**Tasks Completed**: None
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 5 plan review. TASK-005 now requires explicit
`darwin-arm64` and `darwin-x64` archive dry-run, build, payload, checksum, and
gate-manifest evidence, or a blocked target record that prevents Swift
production marker transition. Parallelization guidance now matches task
metadata by keeping TASK-002 and TASK-003 sequential.

### Session: 2026-06-12 21:20 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added production Swift archive planning, switched
`scripts/build-homebrew-release.sh` from Bun compile archives to Xcode SwiftPM
macOS archives under `dist/homebrew`, updated formula rendering to use only
Swift macOS checksums, made Linux fail closed, rendered `Formula/rielflow.rb`
for version `0.1.15`, recorded production cutover evidence, and set
`productionRuntime=swift-native`,
`homebrewFormulaSource=swift-executable-archive`, and
`allowsProductionCutover=true` after local Homebrew smoke and leakage checks
passed. Release upload and `tacogips/homebrew-tap` mutation were not performed.

### Session: 2026-06-12 21:20 Step 7 Review Fix

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 7 review `comm-000015` mid findings by updating
Swift CLI help text and its regression test from stale TypeScript/Bun
production-fallback wording to the post-cutover Swift production Homebrew
runtime message. Also aligned per-module status sections and checklists with
the completed task table and PROGRESS.json state.

### Session: 2026-06-12 21:20 Step 7 Adversarial Review Fix

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 7 adversarial review `comm-000020` mid findings by
adding Swift CLI `workflow usage` parser and dispatch support, restoring the
Homebrew formula test to create and inspect a built-in add-on smoke workflow,
aligning `--version` and help text with the production Homebrew runtime, and
rebuilding both macOS Swift archives with refreshed formula and gate evidence.

### Session: 2026-06-12 21:20 Step 7 Review Fix `comm-000024`

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 7 review `comm-000024` by confirming the generated
Formula and renderer both use an escaped-slash-tolerant
`rielflow/chat-reply-worker` assertion, rerunning the local Homebrew
install/test plus `workflow usage` smoke, and refreshing gate and progress
evidence only after the smoke passed.
