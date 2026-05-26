# Homebrew Deployment Support Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#homebrew-release-packaging`, `design-docs/specs/command.md#release-packaging-commands`
**Created**: 2026-05-20
**Last Updated**: 2026-05-20

## Design Document Reference

Implement a Homebrew deployment path that installs standalone release archives
containing a Bun-compiled `rielflow` executable. Scope is limited to archive
build tooling, formula rendering, Taskfile wrappers, and user-facing release
documentation. It does not add a runtime `rielflow --version` command, publish
GitHub release assets, or create a new external tap repository.

## Modules

### 1. Release Archive Builder

#### `scripts/build-homebrew-release.sh`

```typescript
type HomebrewReleaseTarget =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64";

interface HomebrewArchiveBuildInput {
  readonly version: string;
  readonly releaseDir: string;
  readonly targets: readonly HomebrewReleaseTarget[];
}
```

**Status**: Completed

**Checklist**:

- [x] Detect the local target when no explicit target is passed
- [x] Validate supported target names
- [x] Build `packages/rielflow/src/bin.ts` with `bun build --compile`
- [x] Stage `bin/rielflow` and documentation into a tar archive
- [x] Emit SHA-256 checksum files for formula rendering

### 2. Homebrew Formula Renderer

#### `scripts/render-homebrew-formula.sh`

```typescript
interface HomebrewFormulaRenderInput {
  readonly version: string;
  readonly releaseDir: string;
  readonly releaseBaseUrl: string;
  readonly outputFile: string;
}

interface HomebrewFormulaChecksums {
  readonly darwinArm64: string;
  readonly darwinX64: string;
  readonly linuxArm64: string;
  readonly linuxX64: string;
}
```

**Status**: Completed

**Checklist**:

- [x] Read checksums for all supported Homebrew targets
- [x] Render `Formula/rielflow.rb` with platform-specific URLs and SHA values
- [x] Support alternate release hosts through `DIVEDRA_RELEASE_BASE_URL`
- [x] Fail when required checksum files are missing

### 3. Documentation and Task Wrappers

#### `Taskfile.yml`, `README.md`, `packaging/homebrew/README.md`

```typescript
interface HomebrewPackagingDocs {
  readonly installCommand: "brew install rielflow";
  readonly buildTask: "task build:homebrew";
  readonly formulaTask: "task homebrew:formula";
  readonly tapFormulaTask: "task homebrew:tap-formula";
  readonly runtimeDependency: "embedded-bun";
}
```

**Status**: Completed

**Checklist**:

- [x] Document Homebrew install flow in the root README
- [x] Document archive build and formula rendering under `packaging/homebrew/`
- [x] Add Taskfile wrappers for archive and formula generation
- [x] Add Taskfile wrapper for rendering into the sibling `homebrew-tap`
- [x] Track resolved tap ownership and unresolved `--version` smoke-test decisions in user QA notes

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Release archive builder | `scripts/build-homebrew-release.sh` | Completed | Archive build and extracted binary smoke test |
| Formula renderer | `scripts/render-homebrew-formula.sh`, `Formula/rielflow.rb` | Completed | Formula render and Ruby syntax check |
| Documentation and wrappers | `README.md`, `Taskfile.yml`, `packaging/homebrew/README.md` | Completed | Task wrapper checks |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| TASK-001: Release archive builder | None | Completed |
| TASK-002: Homebrew formula renderer | TASK-001 | Completed |
| TASK-003: Documentation and task wrappers | TASK-001, TASK-002 | Completed |

## Tasks

### TASK-001: Release Archive Builder

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `scripts/build-homebrew-release.sh`
**Dependencies**: None

**Description**:
Create standalone Bun-compiled release archives for Homebrew-supported targets.

**Completion Criteria**:

- [x] Supported target validation
- [x] Current-platform default
- [x] Archive and checksum output
- [x] Extracted binary `--help` smoke test

### TASK-002: Homebrew Formula Renderer

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `scripts/render-homebrew-formula.sh`, `Formula/rielflow.rb`
**Dependencies**: TASK-001

**Description**:
Render a tap-ready formula from release archive checksums.

**Completion Criteria**:

- [x] All target checksums consumed
- [x] URLs use the configured release base
- [x] Formula installs `bin/rielflow`
- [x] Formula Ruby syntax passes

### TASK-003: Documentation and Task Wrappers

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `README.md`, `Taskfile.yml`, `packaging/homebrew/README.md`, `design-docs/user-qa/qa-homebrew-deployment-support.md`
**Dependencies**: TASK-001, TASK-002

**Description**:
Expose the release workflow through repository documentation and task wrappers.

**Completion Criteria**:

- [x] Root install docs mention Homebrew and embedded Bun runtime
- [x] Packaging docs describe build, upload, formula render, and local formula testing
- [x] Taskfile wrappers are listed by `task --list`
- [x] Tap ownership and remaining `--version` decision are documented

## Completion Criteria

- [x] Standalone macOS arm64 release archive builds locally
- [x] Cross-target archives build for macOS x64, Linux arm64, and Linux x64
- [x] Extracted `bin/rielflow --help` smoke test passes on the local platform
- [x] Formula renders with non-placeholder SHA-256 values
- [x] Formula Ruby syntax passes
- [x] README and packaging docs describe the Homebrew deployment path

## Progress Log

### Session: 2026-05-20 13:18

**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: Homebrew audit is blocked by local Command Line Tools support for macOS 26, not by formula syntax.
**Notes**: Built archives under ignored `dist/homebrew/`; generated `Formula/rielflow.rb` from the archive checksums. The first release slice uses `rielflow --help` as the formula test because the CLI does not currently expose `--version`.

### Session: 2026-05-21 00:00

**Tasks Completed**: TASK-003 tap integration follow-up
**Tasks In Progress**: None
**Blockers**: Publishing still requires uploading the matching GitHub release archives and committing/pushing the `tacogips/homebrew-tap` formula update.
**Notes**: Added `task homebrew:tap-formula -- <version>` to render directly into the sibling `../homebrew-tap/Formula/rielflow.rb` checkout and updated the tap README to list `rielflow` alongside the existing `chilla` cask.
