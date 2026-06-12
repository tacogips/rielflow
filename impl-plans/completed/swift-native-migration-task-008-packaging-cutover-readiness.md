# Swift Native Migration TASK-008 Packaging Cutover Readiness Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-swift-native-migration.md#task-008-packaging-and-homebrew-cutover-readiness-gates`
**Created**: 2026-06-12
**Last Updated**: 2026-06-12

## Related Plans

- **Parent**: `impl-plans/active/swift-native-migration.md` (`TASK-008`)
- **Previous**: `impl-plans/completed/swift-native-migration-task-007-cli-parity.md`
- **Next**: `impl-plans/active/swift-native-migration.md` (`TASK-009`)
- **Depends On**: `impl-plans/completed/swift-native-migration-task-005-runtime-session.md`
- **Depends On**: `impl-plans/completed/swift-native-migration-task-006-contracts.md`

## Design Reference

Source of truth:

- `design-docs/specs/design-swift-native-migration.md#task-008-packaging-and-homebrew-cutover-readiness-gates`
- `design-docs/specs/design-swift-native-migration.md#verification-gates`
- `design-docs/specs/design-swift-native-migration.md#migration-strategy`
- `design-docs/user-qa/qa-swift-native-migration.md`
- `packaging/homebrew/README.md`
- `README.md#swift-migration-development`
- `.codex/skills/riel-codex-impl-workflow/SKILL.md`

TASK-008 defines the additive Swift executable artifact path and macOS archive
naming, then records deterministic cutover gates that keep the TypeScript/Bun
runtime as the production fallback. This plan prepares documentation, local-only
packaging readiness scripts or manifest surfaces, and deterministic checks. It
must not tag a release, upload GitHub release assets, update
`tacogips/homebrew-tap`, remove the Bun archive path, or make Swift production
by default.

In scope:

- Document the Swift release executable as the `rielflow` product built by
  Xcode SwiftPM with `swift build -c release --product rielflow --show-bin-path`.
- Document and, if scripted, stage Swift archives under
  `dist/swift-homebrew/` with names
  `rielflow-swift-<version>-darwin-arm64.tar.gz` and
  `rielflow-swift-<version>-darwin-x64.tar.gz`.
- Keep archive payload shape explicit: `bin/rielflow` plus README or release
  notes.
- Add local-only Homebrew preview/cutover gates and smoke commands that use
  `file://` archives or unpublished CI artifacts only.
- Refresh README, Homebrew packaging docs, QA docs, parent implementation plan,
  progress tracking, and workflow skill docs with the TASK-008 fallback rule.
- Add deterministic tests or validation commands for archive naming, checksum
  sidecars, dry-run behavior, and no publishing side effects.

Out of scope:

- Publishing a GitHub release, replacing current Bun release assets, rendering
  or committing the production tap formula, pushing `tacogips/homebrew-tap`,
  changing the default install path, deleting TypeScript/Bun packaging, adding
  live agent credential tests, or introducing Cursor-specific behavior outside
  `CursorCLIAgent`.

## Issue Reference

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Node: `step4-impl-plan-create`
- Repository: `tacogips/rielflow`
- Issue title: `Prepare Swift packaging and cutover readiness gates`
- GitHub issue: none supplied by runtime input
- Target feature area: `Swift native migration TASK-008 packaging and Homebrew cutover readiness`
- Requested behavior: define and document Swift executable artifact path and
  macOS archive naming while keeping TypeScript/Bun as the production fallback.

## Codex Agent References

- Preferred local root `../../codex-agent`: unavailable in this checkout.
- Adjacent reference `../codex-agent/package.json`: reference-only packaging
  pattern showing explicit `bin`, restricted package file list, and prepack
  build step.
- Rielflow TypeScript/Bun production packaging references:
  - `scripts/build-homebrew-release.sh`
  - `scripts/render-homebrew-formula.sh`
  - `packaging/homebrew/README.md`
  - `packages/rielflow/package.json`
- Swift migration references:
  - `Package.swift`
  - `Sources/RielflowCLI/*`
  - `Tests/RielflowCLITests/*`
  - `impl-plans/completed/swift-native-migration-task-007-cli-parity.md`

Intentional divergences accepted by design:

- Swift readiness artifacts use `rielflow-swift-...` archive names before
  cutover so they cannot be mistaken for current Bun production archives.
- Swift formula preview, if rendered, is local-only and must not be committed to
  the tap or described as the default install path.
- TASK-008 may add dry-run packaging surfaces, but final Homebrew cutover waits
  for TASK-009 parity, security, and adversarial review.

## Modules

### 1. Documentation And Fallback Surfaces

#### `README.md`
#### `packaging/homebrew/README.md`
#### `design-docs/user-qa/qa-swift-native-migration.md`
#### `.codex/skills/riel-codex-impl-workflow/SKILL.md`

**Status**: COMPLETED

```typescript
type SwiftPackagingFallbackPolicy = {
  productionRuntime: "typescript-bun";
  swiftArtifactStatus: "readiness-only";
  homebrewFormulaSource: "bun-archive";
  cutoverTask: "TASK-009";
};
```

**Checklist**:

- [x] Document the Xcode SwiftPM release executable path discovery command.
- [x] Document `dist/swift-homebrew/work/rielflow-<version>-darwin-<arch>/bin/rielflow`.
- [x] Document `rielflow-swift-<version>-darwin-arm64.tar.gz` and
      `rielflow-swift-<version>-darwin-x64.tar.gz`.
- [x] State that current `dist/homebrew/rielflow-<version>-...` archives remain
      Bun production archives.
- [x] State that Homebrew stays on the Bun formula until TASK-009 is accepted.
- [x] Refresh user QA open decisions and workflow skill guidance with the same
      fallback and gate language.

### 2. Local-Only Swift Archive Builder Or Dry-Run Surface

#### `scripts/build-swift-homebrew-readiness.sh`
#### `packaging/homebrew/swift-cutover-gates.json`

**Status**: COMPLETED

```typescript
type SwiftArchivePlan = {
  version: string;
  arch: "arm64" | "x64";
  platform: "darwin";
  executableProduct: "rielflow";
  releaseBinPathCommand: string[];
  stagedBinaryPath: `dist/swift-homebrew/work/rielflow-${string}-darwin-${string}/bin/rielflow`;
  archivePath: `dist/swift-homebrew/rielflow-swift-${string}-darwin-${string}.tar.gz`;
  checksumPath: `${string}.sha256`;
  publishSideEffects: false;
};
```

**Checklist**:

- [x] If a script is added, keep it macOS-only, explicit about
      `RIEL_SWIFT_RELEASE_DIR`, and dry-run friendly.
- [x] Build with Xcode SwiftPM release product `rielflow`, then copy only the
      built executable and approved docs into the staging directory.
- [x] Generate `.sha256` sidecars with the same checksum policy as
      `scripts/build-homebrew-release.sh`.
- [x] Reject Linux targets and unsupported archive names in Swift readiness
      mode.
- [x] Do not call `gh`, `brew tap`, `git push`, or
      `scripts/render-homebrew-formula.sh` from the readiness script.

### 3. Local Homebrew Preview And Cutover Gate Manifest

#### `packaging/homebrew/README.md`
#### `packaging/homebrew/swift-cutover-gates.json`

**Status**: COMPLETED

```typescript
type SwiftHomebrewCutoverGate = {
  id: string;
  status: "blocked" | "passed";
  requiredBeforeCutover: boolean;
  verificationCommand: string;
  forbidsProductionMutation: boolean;
};
```

**Checklist**:

- [x] Record gates for Swift validate, inspect, deterministic run, package
      validation, event dry-run, GraphQL manager-control, hook context,
      adapter normalization, SQLite persistence, macOS archive smoke, and
      adversarial review.
- [x] Keep all gates blocked by default unless deterministic evidence is
      available in this repository.
- [x] Document formula preview against `file://$PWD/dist/swift-homebrew` only.
- [x] Make production tap update an explicit TASK-009 post-acceptance action,
      not a TASK-008 command.

### 4. Deterministic Verification Tests

#### `Tests/RielflowCLITests/*`
#### `Tests/RielflowCoreTests/*`
#### `packaging/homebrew/*`

**Status**: COMPLETED

```typescript
type SwiftPackagingReadinessCheck = {
  validatesArchiveName: boolean;
  validatesChecksumSidecar: boolean;
  validatesNoPublishingCommands: boolean;
  validatesArchivedExecutableSmokes: boolean;
};
```

**Checklist**:

- [x] Add deterministic checks for archive naming and staging path derivation.
- [x] Add deterministic checks that readiness surfaces do not contain release
      upload, tap mutation, or production formula switch commands.
- [x] Add or document archived executable smoke commands for `--help`,
      `workflow validate`, `workflow inspect`, and deterministic
      `workflow run --mock-scenario`.
- [x] Keep tests synthetic and local; no live agent binaries, credentials,
      network access, release upload, or tap mutation.

### 5. Plan And Progress Tracking

#### `impl-plans/active/swift-native-migration.md`
#### `impl-plans/completed/swift-native-migration-task-008-packaging-cutover-readiness.md`
#### `impl-plans/PROGRESS.json`

**Status**: COMPLETED

```typescript
type SwiftTask008Progress = {
  task: "TASK-008";
  status: "Ready" | "In Progress" | "Completed";
  progressLogRequired: true;
  reviewGate: "Step 7 adversarial implementation review before cutover";
};
```

**Checklist**:

- [x] Link this focused TASK-008 plan from the parent migration plan.
- [x] Track TASK-008 task status and verification evidence in `PROGRESS.json`.
- [x] Add progress-log entries for each implementation/review iteration.
- [x] Archive this plan under `impl-plans/completed/` only after TASK-008 is
      implemented and accepted.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Documentation and fallback surfaces | `README.md`, `packaging/homebrew/README.md`, `design-docs/user-qa/qa-swift-native-migration.md`, `.codex/skills/riel-codex-impl-workflow/SKILL.md` | COMPLETED | `rg` fallback/cutover checks |
| Swift archive builder or dry-run surface | `scripts/build-swift-homebrew-readiness.sh`, `packaging/homebrew/swift-cutover-gates.json` | COMPLETED | dry-run/name/checksum checks |
| Homebrew preview and gate manifest | `packaging/homebrew/README.md`, `packaging/homebrew/swift-cutover-gates.json` | COMPLETED | no-production-mutation checks |
| Deterministic verification tests | `Sources/RielflowCore/SwiftPackagingReadiness.swift`, `Tests/RielflowCoreTests/SwiftPackagingReadinessTests.swift`, `packaging/homebrew/*` | COMPLETED | Xcode SwiftPM tests and smoke docs |
| Plan and progress tracking | `impl-plans/active/swift-native-migration.md`, `impl-plans/PROGRESS.json` | COMPLETED | `jq empty impl-plans/PROGRESS.json` |

## Task Breakdown

### TASK-008A: Refresh Docs And Skill Fallback Guidance

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `README.md`, `packaging/homebrew/README.md`, `design-docs/user-qa/qa-swift-native-migration.md`, `.codex/skills/riel-codex-impl-workflow/SKILL.md`
**Dependencies**: TASK-007

**Description**:
Document the Swift executable artifact path, archive names, and blocked cutover
state while preserving TypeScript/Bun as the production fallback.

**Completion Criteria**:

- [x] Docs name the Swift executable product `rielflow` and the Xcode SwiftPM
      release bin path command.
- [x] Docs distinguish `dist/swift-homebrew/rielflow-swift-...` readiness
      archives from `dist/homebrew/rielflow-...` Bun production archives.
- [x] Docs and skill guidance state that TASK-009 gates final Homebrew cutover.

### TASK-008B: Add Local-Only Swift Readiness Packaging Surface

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `scripts/build-swift-homebrew-readiness.sh` and/or `packaging/homebrew/swift-cutover-gates.json`
**Dependencies**: TASK-008A

**Description**:
Add a deterministic local readiness surface that stages Swift macOS artifacts
without publishing or mutating Homebrew.

**Completion Criteria**:

- [x] Staging path and archive names match the accepted TASK-008 contract.
- [x] `.sha256` sidecars are produced or dry-run planned deterministically.
- [x] The surface has no `gh release`, tap commit, push, production formula
      render, or Bun archive removal side effects.

### TASK-008C: Encode Cutover Gates

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `packaging/homebrew/swift-cutover-gates.json`, `packaging/homebrew/README.md`
**Dependencies**: TASK-008A

**Description**:
Record required closed gates for Homebrew cutover, including all parity,
security, persistence, archive smoke, and adversarial-review checks.

**Completion Criteria**:

- [x] Every accepted design gate is represented explicitly.
- [x] Gates are blocked by default unless backed by deterministic evidence.
- [x] Preview formula instructions are local-only and use `file://` archives.

### TASK-008D: Add Deterministic Readiness Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Tests/RielflowCLITests/*`, `Tests/RielflowCoreTests/*`, `packaging/homebrew/*`
**Dependencies**: TASK-008B, TASK-008C

**Description**:
Add focused tests or checks proving archive naming, gate defaults, and no
publishing side effects. Document archived executable smoke commands for a
Swift-capable macOS environment.

**Completion Criteria**:

- [x] Deterministic tests cover archive names, staging paths, checksum sidecars,
      and no publishing commands.
- [x] Smoke commands exercise the archived Swift `bin/rielflow` for help,
      validate, inspect, and deterministic run.
- [x] Verification does not require live local agents, credentials, network,
      GitHub release upload, or tap mutation.

### TASK-008E: Update Parent Plan And Progress Evidence

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `impl-plans/active/swift-native-migration.md`, `impl-plans/PROGRESS.json`
**Dependencies**: TASK-008A, TASK-008B, TASK-008C, TASK-008D

**Description**:
Keep the parent plan and progress index aligned with focused TASK-008 work.

**Completion Criteria**:

- [x] Parent TASK-008 links this focused plan and records implementation
      criteria.
- [x] `impl-plans/PROGRESS.json` records the focused plan and verification
      commands.
- [x] Progress log entries identify completed tasks, blockers, review feedback,
      and verification results.

## Dependencies

| Task | Depends On | Reason |
| ---- | ---------- | ------ |
| TASK-008A | TASK-007 | Docs must start from accepted CLI parity and fallback status. |
| TASK-008B | TASK-008A | Script/dry-run surfaces must use the documented artifact contract. |
| TASK-008C | TASK-008A | Gate manifest must use the documented cutover policy. |
| TASK-008D | TASK-008B, TASK-008C | Tests depend on the readiness surface and gate manifest. |
| TASK-008E | TASK-008A, TASK-008B, TASK-008C, TASK-008D | Progress evidence follows actual implementation and verification. |

## Parallelization

TASK-008A and TASK-008C may run in parallel only if write scopes stay split:
TASK-008A owns user-facing docs and workflow skill docs, while TASK-008C owns
the gate manifest and Homebrew preview wording. TASK-008B is sequential because
it defines the archive staging contract used by tests. TASK-008D runs after
TASK-008B and TASK-008C. TASK-008E is final.

## Verification Plan

Planning and repository hygiene:

- `git status --short --branch`
- `git diff --check`
- `jq empty impl-plans/PROGRESS.json`
- `rg -n "TASK-008|rielflow-swift-|dist/swift-homebrew|TypeScript/Bun remains" impl-plans/active/swift-native-migration.md impl-plans/completed/swift-native-migration-task-008-packaging-cutover-readiness.md README.md packaging/homebrew/README.md design-docs/user-qa/qa-swift-native-migration.md .codex/skills/riel-codex-impl-workflow/SKILL.md`

TypeScript/Bun fallback:

- `bun run typecheck:server`
- `bun run lint:biome`
- `bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --scope project`

Swift deterministic checks:

- `/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift --version`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift run rielflow workflow validate codex-design-and-implement-review-loop --scope project --output json`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift run rielflow workflow inspect codex-design-and-implement-review-loop --scope project --output json`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift run rielflow workflow run worker-only-single-step --workflow-definition-dir ./examples --mock-scenario ./examples/worker-only-single-step/mock-scenario.json --output json`

Swift archive readiness, once implemented:

- `RIEL_VERSION=0.0.0-task008 scripts/build-swift-homebrew-readiness.sh --dry-run darwin-arm64`
- `RIEL_VERSION=0.0.0-task008 scripts/build-swift-homebrew-readiness.sh darwin-arm64`
- `tar -tzf dist/swift-homebrew/rielflow-swift-0.0.0-task008-darwin-arm64.tar.gz`
- `(cd dist/swift-homebrew && shasum -a 256 -c rielflow-swift-0.0.0-task008-darwin-arm64.tar.gz.sha256)`
- `! rg -n "/Users/|/home/|$(pwd)" dist/swift-homebrew/rielflow-swift-0.0.0-task008-darwin-arm64.tar.gz.sha256`
- `tmpdir="$(mktemp -d)" && tar -xzf dist/swift-homebrew/rielflow-swift-0.0.0-task008-darwin-arm64.tar.gz -C "$tmpdir" && "$tmpdir/bin/rielflow" --help`
- `tmpdir="$(mktemp -d)" && tar -xzf dist/swift-homebrew/rielflow-swift-0.0.0-task008-darwin-arm64.tar.gz -C "$tmpdir" && "$tmpdir/bin/rielflow" workflow validate codex-design-and-implement-review-loop --scope project --output json`
- `tmpdir="$(mktemp -d)" && tar -xzf dist/swift-homebrew/rielflow-swift-0.0.0-task008-darwin-arm64.tar.gz -C "$tmpdir" && "$tmpdir/bin/rielflow" workflow inspect codex-design-and-implement-review-loop --scope project --output json`
- `tmpdir="$(mktemp -d)" && tar -xzf dist/swift-homebrew/rielflow-swift-0.0.0-task008-darwin-arm64.tar.gz -C "$tmpdir" && "$tmpdir/bin/rielflow" workflow run worker-only-single-step --workflow-definition-dir ./examples --mock-scenario ./examples/worker-only-single-step/mock-scenario.json --output json`

No publishing side effects:

- `rg -n "gh release|git push|brew tap|render-homebrew-formula|Formula/rielflow.rb" scripts/build-swift-homebrew-readiness.sh packaging/homebrew/swift-cutover-gates.json packaging/homebrew/README.md`
- Confirm any matches are documentation-only preview instructions or explicit
  forbidden actions, not executed by TASK-008 scripts.

## Completion Criteria

- [x] Swift executable artifact path and macOS archive names are documented.
- [x] Swift readiness archives are distinct from Bun production archives.
- [x] TypeScript/Bun remains documented as the production runtime and Homebrew
      source.
- [x] Homebrew cutover gates remain blocked until TASK-009 parity, security,
      persistence, archive smoke, and adversarial review pass.
- [x] Deterministic checks cover archive naming, staging, checksum sidecars,
      local-only preview, and no publishing side effects.
- [x] Parent plan, `impl-plans/PROGRESS.json`, QA docs, README, Homebrew docs,
      and workflow skill docs are updated.

## Progress Log

### Session: 2026-06-12 18:35

**Tasks Completed**: Step 8 user-facing documentation refresh for accepted
TASK-008 packaging readiness.
**Tasks In Progress**: None.
**Blockers**: None for TASK-008; TASK-009 remains the final Swift Homebrew
cutover gate.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000022`
accepted the implementation after `comm-000017` checksum-sidecar remediation;
no high or mid findings remain.
**Notes**: Refreshed README, Homebrew-facing guidance, parent plan progress,
focused plan progress, and workflow skill wording to keep the shipped contract
explicit: Swift archives stay local under `dist/swift-homebrew`, checksum
sidecars are portable, and TypeScript/Bun remains production Homebrew.

### Session: 2026-06-12 18:22

**Tasks Completed**: TASK-008 Step 7 adversarial review revision for portable
checksum sidecars.
**Tasks In Progress**: None for TASK-008 implementation; Step 7 re-review is
next.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000017`
reported one mid finding: generated `.sha256` sidecars recorded absolute host
archive paths, leaking machine-local paths and making checksum verification
nonportable after relocation.
**Notes**: The readiness script now writes checksum sidecars from the archive
directory using the archive basename for both `shasum` and `sha256sum`. Added
deterministic Swift coverage for portable sidecar generation and shell checks
that verify the sidecar from `dist/swift-homebrew` and reject `/Users/`,
`/home/`, and repository-absolute paths.

### Session: 2026-06-12 18:05

**Tasks Completed**: TASK-008 Step 7 review revision for unsafe
`RIEL_VERSION` path construction.
**Tasks In Progress**: None for TASK-008 implementation; Step 7 re-review is
next.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000012` reported one mid
finding: `scripts/build-swift-homebrew-readiness.sh` interpolated
`RIEL_VERSION` into work/archive paths before destructive `rm -rf` without
version validation or release-directory containment checks.
**Notes**: The readiness script now rejects non-semver-like versions, rejects
parent traversal, converts `RIEL_SWIFT_RELEASE_DIR` to an absolute repository
path when relative, asserts work/archive paths remain under the release
directory before dry-run output or writes, rejects `.` and `..` release-dir
components, and has deterministic Swift coverage plus shell checks for unsafe
versions and release directories.

### Session: 2026-06-12 17:55

**Tasks Completed**: TASK-008 self-review status alignment.
**Tasks In Progress**: None for TASK-008 implementation; Step 7 review remains
the next workflow gate.
**Blockers**: None.
**Review Feedback Addressed**: Self-review found stale TASK-008 status rows in
the parent plan module table and `impl-plans/README.md`; both now show
`In Review` instead of pre-implementation `Ready`.
**Notes**: Re-ran deterministic verification after the status-only fixes.

### Session: 2026-06-12 17:45

**Tasks Completed**: TASK-008A, TASK-008B, TASK-008C, TASK-008D, and
TASK-008E implementation. Added `scripts/build-swift-homebrew-readiness.sh`,
`packaging/homebrew/swift-cutover-gates.json`,
`Sources/RielflowCore/SwiftPackagingReadiness.swift`,
`Tests/RielflowCoreTests/SwiftPackagingReadinessTests.swift`, and top-level
Swift CLI `--help` smoke support; refreshed README, Homebrew docs, QA docs,
design verification gates, workflow skill guidance, parent plan, focused plan,
and `impl-plans/PROGRESS.json`.
**Tasks In Progress**: None for TASK-008 implementation; Step 7 review remains
the next workflow gate.
**Blockers**: Final Homebrew cutover remains blocked until TASK-009 accepts
Swift parity, security, SQLite persistence, macOS archive smoke, and
adversarial review.
**Review Feedback Addressed**: Step 5 implementation-plan review accepted
TASK-008 with no high or mid findings in the supplied workflow input.
**Notes**: The readiness script supports dry-run planning, macOS-only Swift
release builds, `RIEL_SWIFT_RELEASE_DIR`, `.sha256` sidecars, and distinct
`rielflow-swift-<version>-darwin-<arch>.tar.gz` archive names. It does not
publish release assets, mutate the tap, render production formulas, or replace
the TypeScript/Bun production archive path.

### Session: 2026-06-12 17:10

**Tasks Completed**: TASK-008 focused implementation plan creation and parent
plan/progress alignment.
**Tasks In Progress**: None.
**Blockers**: None for planning. Implementation must still preserve the
TypeScript/Bun production fallback and avoid release/tap mutation.
**Review Feedback Addressed**: Step 3 design review accepted TASK-008 design
with no high or mid findings in the supplied workflow input. No Step 5
implementation-plan feedback was present for this first TASK-008 planning
attempt.
