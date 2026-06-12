# Swift Native Migration TASK-009 Final Cutover Gate Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-swift-native-migration.md#task-009-final-parity-security-and-cutover-gate`
**Created**: 2026-06-12
**Last Updated**: 2026-06-12

## Related Plans

- **Parent**: `impl-plans/completed/swift-native-migration.md` (`TASK-009`)
- **Previous**: `impl-plans/completed/swift-native-migration-task-008-packaging-cutover-readiness.md`
- **Depends On**: `completed/swift-native-migration:TASK-003`
- **Depends On**: `completed/swift-native-migration:TASK-007`
- **Depends On**: `completed/swift-native-migration:TASK-008`

## Design Reference

Source of truth:

- `design-docs/specs/design-swift-native-migration.md#task-009-final-parity-security-and-cutover-gate`
- `design-docs/specs/design-swift-native-migration.md#security-and-boundary-checks`
- `design-docs/specs/design-swift-native-migration.md#task-008-packaging-and-homebrew-cutover-readiness-gates`
- `design-docs/specs/design-swift-native-migration.md#verification-gates`
- `design-docs/user-qa/qa-swift-native-migration.md`
- `packaging/homebrew/swift-cutover-gates.json`
- `packaging/homebrew/README.md`
- `impl-plans/completed/swift-native-migration.md`
- `impl-plans/completed/swift-native-migration-task-005-runtime-session.md`
- `impl-plans/completed/swift-native-migration-task-006-contracts.md`
- `impl-plans/completed/swift-native-migration-task-007-cli-parity.md`
- `impl-plans/completed/swift-native-migration-task-008-packaging-cutover-readiness.md`

TASK-009 is the final issue-resolution handoff before release packaging may
switch from TypeScript/Bun archives to Swift executable archives. It gathered
fresh deterministic evidence, hardened the GraphQL manager-control parity gap
exposed by that evidence, updated `packaging/homebrew/swift-cutover-gates.json`
only for gates proven by exact commands and local artifacts in the current
branch, and passed high-risk adversarial implementation review. Production
Homebrew remains on the TypeScript/Bun archive source until a dedicated release
cutover changes the formula and production archive source.

In scope:

- Re-run TypeScript/Bun fallback checks: typecheck, Biome lint, and
  project-scope workflow validation.
- Re-run explicit Xcode Swift toolchain checks and full `swift test`.
- Verify Swift CLI parity through archived binary smokes for `--help`,
  `workflow validate`, `workflow inspect`, and deterministic
  `workflow run --mock-scenario`.
- Add or harden deterministic Swift tests and fixtures only where evidence
  shows parity gaps in package validation, event dry-run, GraphQL
  manager-control, hook context parsing, adapter output normalization, SQLite
  persistence, or archive smoke behavior.
- Record exact gate evidence in `packaging/homebrew/swift-cutover-gates.json`
  for passed gates only.
- Leave the `task009-adversarial-review` gate blocked until Step 7 adversarial
  review accepts the implementation.

Out of scope:

- Removing the TypeScript/Bun runtime, changing `dist/homebrew` production
  archives, publishing release assets, pushing or committing tap formula
  changes, making Swift the default Homebrew source, live LLM credential tests,
  network-dependent tests, package checkout mutation, or Cursor-specific
  behavior outside `CursorCLIAgent`.

## Issue Reference

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Current workflow session:
  `riel-codex-design-and-implement-review-loop-1781261544-53db3135`
- Node: `step4-impl-plan-create`
- Repository: `tacogips/rielflow`
- Issue title:
  `Execute Swift TASK-009 final parity security and cutover gate`
- GitHub issue: none supplied by runtime input
- Target feature area: `Swift native migration TASK-009 final parity/security/cutover gate`
- Requested behavior: execute final parity, security, archive, and review
  handoff checks before switching release packaging from TypeScript/Bun to
  Swift.

## Codex Agent References

- Preferred local root `../../codex-agent`: unavailable in this checkout.
- Current Rielflow TypeScript/Bun runtime, adapter, package, event, GraphQL,
  hook, and packaging behavior is the authoritative local reference for TASK-009.
- Adjacent `../codex-agent/package.json`: reference-only structural comparison
  for explicit package executable metadata; do not copy code or introduce npm
  package publishing behavior.
- Local references:
  - `packages/rielflow-core/src/render.ts`
  - `packages/rielflow/src/workflow/runtime-db/*`
  - `packages/rielflow/src/workflow/output-attempt-runner.ts`
  - `packages/rielflow/src/workflow/adapter.ts`
  - `packages/rielflow-adapters/src/*`
  - `packaging/homebrew/swift-cutover-gates.json`
  - `scripts/build-swift-homebrew-readiness.sh`
  - `Package.swift`
  - `Sources/RielflowCore/*`
  - `Sources/RielflowAddons/*`
  - `Sources/RielflowEvents/*`
  - `Sources/RielflowHook/*`
  - `Sources/RielflowGraphQL/*`
  - `Sources/RielflowCLI/*`
  - `Tests/*`

Intentional divergences accepted by design:

- SwiftPM target structure may differ from TypeScript package structure, but
  backend strings, normalized adapter envelopes, runtime-owned publication, and
  cutover gate semantics remain compatible.
- Swift readiness archives remain pre-cutover artifacts under
  `dist/swift-homebrew/` until a dedicated release cutover switches production
  Homebrew packaging to Swift archives.
- `official/cursor-sdk` remains deferred unless separately scoped and reviewed.

## Modules

### 1. Gate Evidence Manifest

#### `packaging/homebrew/swift-cutover-gates.json`
#### `packaging/homebrew/README.md`

**Status**: COMPLETED

```typescript
type SwiftCutoverGateEvidence = {
  gateId: string;
  status: "blocked" | "passed";
  requiredBeforeCutover: boolean;
  verificationCommand: string;
  artifactPaths: string[];
  result: "passed" | "blocked";
  forbidsProductionMutation: true;
};
```

**Checklist**:

- [x] Add replayable evidence fields only for gates whose commands pass.
- [x] Keep failed or unverified gates blocked with explicit reason text.
- [x] Keep `allowsProductionCutover: false` for the current documentation
      refresh; production Homebrew remains TypeScript/Bun until a dedicated
      release cutover changes the formula source.

### 2. Baseline And Swift Verification

#### `Package.swift`
#### `Sources/*`
#### `Tests/*`
#### `packages/*`

**Status**: COMPLETED

```typescript
type Task009BaselineEvidence = {
  typeScriptCommands: string[];
  swiftToolchainCommand: string;
  swiftTestCommand: string;
  result: "passed" | "blocked";
};
```

**Checklist**:

- [x] TypeScript/Bun typecheck passes.
- [x] Biome lint passes.
- [x] TypeScript/Bun project workflow validation passes.
- [x] Explicit Xcode Swift toolchain reports version.
- [x] Full Xcode `swift test` passes.

### 3. Parity Fixtures And Gap Hardening

#### `Sources/RielflowAddons/*`
#### `Sources/RielflowEvents/*`
#### `Sources/RielflowGraphQL/*`
#### `Sources/RielflowHook/*`
#### `Sources/RielflowAdapters/*`
#### `Sources/RielflowCore/*`
#### `Tests/*`

**Status**: COMPLETED

```typescript
type Task009ParityArea =
  | "package-validation"
  | "event-dry-run"
  | "graphql-manager-control"
  | "hook-context"
  | "adapter-output-normalization"
  | "sqlite-persistence";

type Task009ParityCheck = {
  area: Task009ParityArea;
  fixturePaths: string[];
  verificationCommands: string[];
  hardeningRequired: boolean;
};
```

**Checklist**:

- [x] Package manifest validation parity is replayable against local fixtures.
- [x] Event dry-run parity preserves trigger payload, runtime variables,
      mailbox bridge policy, reply dispatch descriptors, and no-side-effect
      behavior.
- [x] GraphQL manager-control DTO/mutation parity preserves session inspection,
      input shapes, idempotency, result fields, and schema descriptors without
      an HTTP server.
- [x] Hook context parity preserves session/backend metadata, raw-capture
      controls, and redaction.
- [x] Adapter output normalization parity preserves output-envelope behavior,
      invalid-output failure, candidate extraction, and redaction while leaving
      publication runtime-owned.
- [x] SQLite persistence parity proves communication ids, ordered message
      resolution, failed-write handling, and no legacy inbox/outbox path.

### 4. Archived Swift Binary Smoke

#### `scripts/build-swift-homebrew-readiness.sh`
#### `dist/swift-homebrew/*`

**Status**: COMPLETED

```typescript
type SwiftArchiveSmokeEvidence = {
  archivePath: string;
  checksumSidecar: string;
  extractedBinary: string;
  smokeCommands: string[];
  hostPathLeakCheck: string;
};
```

**Checklist**:

- [x] Build readiness archive with local-only Swift script.
- [x] Verify archive payload contains only expected files.
- [x] Verify `.sha256` sidecar from the archive directory.
- [x] Reject machine-local absolute path leakage in sidecars and payload
      metadata.
- [x] Run archived `bin/rielflow --help`.
- [x] Run archived `workflow validate`, `workflow inspect`, and deterministic
      `workflow run --mock-scenario` against repository fixtures.

### 5. Review Handoff And Progress Tracking

#### `impl-plans/completed/swift-native-migration.md`
#### `impl-plans/completed/swift-native-migration-task-009-final-cutover-gate.md`
#### `impl-plans/PROGRESS.json`

**Status**: ACCEPTED

```typescript
type Task009ReviewHandoff = {
  task: "TASK-009";
  adversarialReviewGate: "task009-adversarial-review";
  reviewDecision: "blocked" | "accepted";
  progressLogRequired: true;
};
```

**Checklist**:

- [x] Parent plan and focused plan progress logs include exact evidence
      commands and artifact paths.
- [x] `impl-plans/PROGRESS.json` tracks TASK-009 task progress.
- [x] Adversarial review decision is recorded with review decisions,
      verification commands, residual low risks, and no high or mid findings.
- [x] Step 7 adversarial review accepted TASK-009; production cutover remains
      disabled until a dedicated release cutover changes the formula source.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Gate evidence manifest | `packaging/homebrew/swift-cutover-gates.json`, `packaging/homebrew/README.md` | COMPLETED | `jq empty`, evidence `rg` checks |
| Baseline and Swift verification | `Package.swift`, `Sources/*`, `Tests/*`, `packages/*` | COMPLETED | Bun typecheck/lint/workflow validation, Xcode `swift test` |
| Parity fixtures and gap hardening | `Sources/RielflowAddons/*`, `Sources/RielflowEvents/*`, `Sources/RielflowGraphQL/*`, `Sources/RielflowHook/*`, `Sources/RielflowAdapters/*`, `Sources/RielflowCore/*`, `Tests/*` | COMPLETED | focused Swift parity tests |
| Archived Swift binary smoke | `scripts/build-swift-homebrew-readiness.sh`, `dist/swift-homebrew/*` | COMPLETED | archive, checksum, host-path, and archived CLI smokes |
| Review handoff and progress tracking | `impl-plans/completed/swift-native-migration.md`, `impl-plans/completed/swift-native-migration-task-009-final-cutover-gate.md`, `impl-plans/PROGRESS.json` | COMPLETED | `jq empty impl-plans/PROGRESS.json`, progress-log review |

## Task Breakdown

### TASK-009A: Establish Baseline Verification Evidence

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: baseline command logs, `impl-plans/completed/swift-native-migration-task-009-final-cutover-gate.md`, `impl-plans/PROGRESS.json`
**Dependencies**: completed/swift-native-migration:TASK-003, completed/swift-native-migration:TASK-007, completed/swift-native-migration:TASK-008

**Description**:
Run the required TypeScript/Bun fallback and Xcode Swift baseline commands
before opening any cutover gate.

**Completion Criteria**:

- [x] `bun run typecheck:server` passes.
- [x] `bun run lint:biome` passes.
- [x] TypeScript/Bun workflow validation passes.
- [x] Explicit Xcode `swift --version` is recorded.
- [x] Explicit Xcode `swift test` passes.

### TASK-009B: Verify Package, Event, GraphQL, Hook, Adapter, And SQLite Parity Gates

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/*`, `Tests/*`, focused fixture evidence
**Dependencies**: TASK-009A

**Description**:
Run or add deterministic local parity fixtures for the six non-CLI cutover
areas, hardening Swift behavior only where the evidence exposes gaps.

**Completion Criteria**:

- [x] `swift-package-validation` gate has exact passing evidence.
- [x] `swift-event-dry-run` gate has exact passing evidence.
- [x] `swift-graphql-manager-control` gate has exact passing evidence.
- [x] `swift-hook-context` gate has exact passing evidence.
- [x] `swift-adapter-output-normalization` gate has exact passing evidence.
- [x] `swift-sqlite-persistence` gate has exact passing evidence.

### TASK-009C: Verify Archived Swift Binary CLI Gates

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `dist/swift-homebrew/*`, archive smoke evidence
**Dependencies**: TASK-009A, TASK-009B

**Description**:
Build the Swift readiness archive locally and prove archived binary behavior,
not only `swift run`, for help, validation, inspect, and deterministic run.

**Completion Criteria**:

- [x] Archive payload is limited to approved files.
- [x] Checksum sidecar validates from `dist/swift-homebrew`.
- [x] Host-path leakage check passes.
- [x] Archived `bin/rielflow --help` passes.
- [x] Archived `workflow validate`, `workflow inspect`, and deterministic
      `workflow run --mock-scenario` pass.

### TASK-009D: Update Cutover Gate Manifest With Passed Evidence Only

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packaging/homebrew/swift-cutover-gates.json`, `packaging/homebrew/README.md`
**Dependencies**: TASK-009B, TASK-009C

**Description**:
Update `packaging/homebrew/swift-cutover-gates.json` only for gates proven by
fresh deterministic evidence in this branch. Leave review and any unverified
gate blocked.

**Completion Criteria**:

- [x] Each passed gate records exact command, fixture/archive path, and result.
- [x] Unverified gates remain `blocked`.
- [x] `allowsProductionCutover` remains `false` for the current documentation
      refresh; production Homebrew remains TypeScript/Bun until a dedicated
      release cutover changes the formula source.
- [x] Manifest remains valid JSON.

### TASK-009E: Security Boundary Audit

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: audit notes, focused hardening changes if needed
**Dependencies**: TASK-009A

**Description**:
Audit the final cutover diff for external process execution, runtime-owned
publication, candidate-path staging, communication-id ownership, redaction,
Cursor isolation, no network dependency, and no release/tap mutation.

**Completion Criteria**:

- [x] No adapter, add-on, event, GraphQL, hook, or packaging path publishes
      workflow messages or invents communication ids.
- [x] Candidate-path staging remains runtime-owned and bounded.
- [x] External process execution remains explicit argv with injectable runners,
      deadlines, descriptor isolation, and redaction.
- [x] Cursor CLI behavior remains isolated in `CursorCLIAgent`.
- [x] No TASK-009 command mutates GitHub releases, Homebrew tap, or production
      `dist/homebrew` archives.

### TASK-009F: Review Handoff And Final Progress Alignment

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `impl-plans/completed/swift-native-migration.md`, `impl-plans/completed/swift-native-migration-task-009-final-cutover-gate.md`, `impl-plans/PROGRESS.json`
**Dependencies**: TASK-009D, TASK-009E

**Description**:
Prepare the implementation for high-risk adversarial review with explicit
evidence, residual risks, and blocked or passed gate decisions, then record the
accepted review result for documentation refresh.

**Completion Criteria**:

- [x] Parent and focused plan progress logs summarize exact evidence.
- [x] `PROGRESS.json` task status reflects implementation outcome.
- [x] `task009-adversarial-review` remained blocked before Step 7 review.
- [x] Step 7 adversarial review accepted TASK-009 with no high or mid findings.
- [x] Production cutover remains disabled until a dedicated release cutover
      changes the Homebrew formula source.

## Dependencies

| Task | Depends On | Reason |
| ---- | ---------- | ------ |
| TASK-009A | completed/swift-native-migration:TASK-003, completed/swift-native-migration:TASK-007, completed/swift-native-migration:TASK-008 | Final evidence depends on completed prompt/envelope, CLI parity, and packaging readiness. |
| TASK-009B | TASK-009A | Parity gap hardening must start from a green baseline. |
| TASK-009C | TASK-009A, TASK-009B | Archived binary smoke should use parity-hardened Swift build output. |
| TASK-009D | TASK-009B, TASK-009C | Gate manifest updates require concrete parity and archive evidence. |
| TASK-009E | TASK-009A | Security audit can run after baseline evidence and in parallel with parity hardening if write scopes stay separate. |
| TASK-009F | TASK-009D, TASK-009E | Review handoff depends on manifest decisions and security audit results. |

## Parallelization

- TASK-009A is parallelizable with no code writes, but should be run first as
  baseline evidence.
- TASK-009E may run in parallel with TASK-009B only if it records audit notes or
  touches disjoint files. If TASK-009E requires code hardening, coordinate
  before editing shared Swift targets.
- TASK-009B, TASK-009C, TASK-009D, and TASK-009F are sequential because they
  share evidence, archive outputs, gate manifest state, and review handoff.

## Verification Plan

Baseline:

- `git status --short --branch`
- `git diff --check`
- `bun run typecheck:server`
- `bun run lint:biome`
- `bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --scope project`
- `/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift --version`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test`

Parity gates:

- `rg -n "WorkflowPackageManifest|WorkflowPackageValidationIssue" Sources/RielflowAddons Tests/RielflowAddonsTests`
- `rg -n "ExternalEventEnvelope|EventDryRunRequest|ReplyDispatch" Sources/RielflowEvents Tests/RielflowEventsTests`
- `rg -n "GraphQLManager|GraphQLControlPlane|continueSession|sendManagerMessage" Sources/RielflowGraphQL Tests/RielflowGraphQLTests`
- `rg -n "HookContext|HookRecordRequest|RIEL_HOOK_CAPTURE_RAW|redact" Sources/RielflowHook Tests/RielflowHookTests`
- `rg -n "normalizeOutputContractEnvelope|parseJSONObjectCandidate|invalid_output|redact" Sources/RielflowCore Sources/RielflowAdapters Tests`
- `rg -n "WorkflowSession|WorkflowMessageRecord|SQLite|communicationId|inbox/input\\.json|outbox/output\\.json" Sources Tests`

Archive smoke:

- `RIEL_VERSION=0.0.0-task009 scripts/build-swift-homebrew-readiness.sh --dry-run darwin-arm64`
- `RIEL_VERSION=0.0.0-task009 scripts/build-swift-homebrew-readiness.sh darwin-arm64`
- `tar -tzf dist/swift-homebrew/rielflow-swift-0.0.0-task009-darwin-arm64.tar.gz`
- `(cd dist/swift-homebrew && shasum -a 256 -c rielflow-swift-0.0.0-task009-darwin-arm64.tar.gz.sha256)`
- `! rg -n "/Users/|/home/|$(pwd)" dist/swift-homebrew/rielflow-swift-0.0.0-task009-darwin-arm64.tar.gz.sha256`
- `dist/swift-homebrew/work/rielflow-0.0.0-task009-darwin-arm64/bin/rielflow --help`
- `dist/swift-homebrew/work/rielflow-0.0.0-task009-darwin-arm64/bin/rielflow workflow validate codex-design-and-implement-review-loop --scope project --output json`
- `dist/swift-homebrew/work/rielflow-0.0.0-task009-darwin-arm64/bin/rielflow workflow inspect codex-design-and-implement-review-loop --scope project --output json`
- `dist/swift-homebrew/work/rielflow-0.0.0-task009-darwin-arm64/bin/rielflow workflow run worker-only-single-step --workflow-definition-dir ./examples --mock-scenario ./examples/worker-only-single-step/mock-scenario.json --output json`

Gate manifest and safety:

- `jq empty packaging/homebrew/swift-cutover-gates.json`
- `jq '(.allowsProductionCutover, .productionRuntime), (.gates[] | select(.requiredBeforeCutover == true) | {id,status,verificationCommand})' packaging/homebrew/swift-cutover-gates.json`
- `rg -n "gh release|git push|brew tap|render-homebrew-formula|Formula/rielflow.rb" scripts/build-swift-homebrew-readiness.sh packaging/homebrew/swift-cutover-gates.json packaging/homebrew/README.md`
- `jq empty impl-plans/PROGRESS.json`

## Completion Criteria

- [x] TypeScript/Bun fallback checks pass.
- [x] Explicit Xcode Swift toolchain and full Swift test suite pass.
- [x] All required non-review gates in `swift-cutover-gates.json` have passed
      deterministic evidence or remain blocked with explicit reason.
- [x] Archived Swift binary smoke proves help, validate, inspect, and
      deterministic run from the staged archive.
- [x] No production release, tap, or `dist/homebrew` mutation occurs.
- [x] Security boundary audit passes or all blocking findings are fixed.
- [x] High-risk adversarial review accepted TASK-009 with no high or mid
      findings in workflow session
      `riel-codex-design-and-implement-review-loop-1781261544-53db3135`.
- [x] Parent plan, focused plan, and `PROGRESS.json` are updated with evidence
      and review decision.

## Progress Log

### Session: 2026-06-12 21:10

**Tasks Completed**: TASK-009 Step 7 adversarial review accepted the final
parity, security, and cutover handoff with no high or mid findings.
**Tasks In Progress**: None for TASK-009 documentation refresh.
**Blockers**: Production Homebrew remains on TypeScript/Bun until a dedicated
release cutover changes the formula source; `allowsProductionCutover` remains
`false` in the current manifest.
**Review Feedback Addressed**: Step 7 adversarial review accepted the diff and
reported only low residual risk about plan-index status alignment.
**Notes**: Refreshed README, Homebrew README, workflow skill guidance, and plan
status text to record accepted TASK-009 evidence while preserving the
TypeScript/Bun production fallback.

### Session: 2026-06-12 20:55

**Tasks Completed**: TASK-009 Step 6 implementation. TASK-009A through
TASK-009E are complete, and TASK-009F is in review pending the high-risk
adversarial review decision. The TypeScript/Bun baseline passed
`bun run typecheck:server`, `bun run lint:biome`, and project-scope workflow
validation. Xcode Swift 6.3.2 reported
`swiftlang-6.3.2.1.108 clang-2100.1.1.101`, and full `swift test` passed
211 tests with 0 failures after GraphQL manager-control hardening.
**Tasks In Progress**: TASK-009F review handoff.
**Blockers**: `task009-adversarial-review` remains blocked until Step 7
adversarial review accepts the implementation. `allowsProductionCutover`
remains `false`, `productionRuntime` remains `typescript-bun`, and no
`dist/homebrew`, release, or tap mutation occurred.
**Review Feedback Addressed**: Step 5 implementation-plan review accepted this
plan with no high or mid findings in supplied workflow input.
**Notes**: Added Swift GraphQL manager-control DTO and schema parity for
`managerSession`, `sendManagerMessage`, `replayCommunication`, and
`retryCommunicationDelivery`, including `idempotencyKey`, `managerSessionId`,
result payload fields, and no legacy `managerRuntimeId`. Updated
`packaging/homebrew/swift-cutover-gates.json` with exact commands,
fixture/archive paths, and passed evidence for every non-review gate. Archived
Swift binary evidence uses
`dist/swift-homebrew/rielflow-swift-0.0.0-task009-darwin-arm64.tar.gz`,
checksum
`722e16dd5bbea27b1e4c6d06043fb7ad32c0023967da98f32cb577c4c32bf937`,
and staged binary
`dist/swift-homebrew/work/rielflow-0.0.0-task009-darwin-arm64/bin/rielflow`.

### Session: 2026-06-12 20:40

**Tasks Completed**: TASK-009 focused implementation plan creation.
**Tasks In Progress**: None; implementation has not started.
**Blockers**: All cutover gates remain blocked until deterministic evidence is
collected in the implementation step; `task009-adversarial-review` remains
blocked until Step 7 accepts the high-risk implementation.
**Review Feedback Addressed**: Step 3 design review
`riel-codex-design-and-implement-review-loop-1781261544-53db3135` accepted the
TASK-009 design update with no high or mid findings.
**Notes**: The plan keeps TypeScript/Bun as production fallback, forbids
release/tap mutation, and requires exact command plus artifact evidence before
opening any gate in `packaging/homebrew/swift-cutover-gates.json`.
