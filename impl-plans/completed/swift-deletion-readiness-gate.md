# Swift Deletion Readiness Gate Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-swift-native-migration.md#typescript-deletion-readiness-todo-loop
**Created**: 2026-06-16
**Last Updated**: 2026-06-16

## Design Document Reference

This plan implements the first bounded slice of the TypeScript deletion-readiness
TODO loop. It creates the tracked blocked gate that proves Swift migration is
not complete enough to delete TypeScript yet, and it adds deterministic
validation so later parity slices can update evidence without weakening the
current TypeScript/Bun fallback.

**Included**: `packaging/swift-deletion-readiness.json`, a Swift deletion-gate
model and validator, focused tests for blocked-state and invalid aggregate
states, progress metadata, README plan indexing, and verification commands that
keep TypeScript baseline checks explicit.

**Excluded**: deleting TypeScript source, removing TypeScript tests, removing
Bun fallback commands, declaring full Swift migration complete, publishing a
release, changing Homebrew production cutover metadata, and implementing the
full parity proof for every deletion-readiness domain in this slice.

## References

- **Workflow ID**: `codex-design-and-implement-review-loop`
- **Workflow Mode**: `issue-resolution`
- **Issue Reference**: `Swift migration TODO loop until TypeScript can be deleted`
- **Accepted Design**:
  `design-docs/specs/design-swift-native-migration.md#typescript-deletion-readiness-todo-loop`
- **Architecture Reference**: `design-docs/specs/architecture.md`
- **User-QA Reference**: `design-docs/user-qa/qa-swift-native-migration.md`
- **Codex Agent References**:
  `packages/rielflow-adapters/src/codex.ts`,
  `packages/rielflow-adapters/src/readiness.ts`,
  `external-reference:codex-agent/src/sdk/model-availability.ts`,
  `external-reference:codex-agent/src/session/index.ts`,
  `external-reference:codex-agent/src/session/sqlite.ts`
- **Claude Code Agent References**:
  `packages/rielflow-adapters/src/claude.ts`,
  `packages/rielflow-adapters/src/readiness.ts`
- **Cursor CLI Agent References**:
  `packages/rielflow-adapters/src/cursor.ts`,
  `packages/rielflow-adapters/src/readiness.ts`

Intentional divergence accepted by the design: Swift splits
`codex-agent`, `claude-code-agent`, and `cursor-cli-agent` behavior into
`CodexAgent`, `ClaudeCodeAgent`, and `CursorCLIAgent` Swift targets while
preserving backend strings, readiness semantics, command construction contracts,
and normalized adapter envelopes.

## Modules

### 1. Deletion Readiness Gate Artifact

#### packaging/swift-deletion-readiness.json

**Status**: COMPLETED

```typescript
type SwiftDeletionReadinessStatus = "passed" | "blocked" | "stale" | "unknown";

interface SwiftDeletionReadinessDomain {
  id:
    | "package-build"
    | "cli"
    | "server"
    | "graphql"
    | "event"
    | "workflow-package"
    | "persistence"
    | "release"
    | "documentation"
    | "test"
    | "agent-codex"
    | "agent-claude-code"
    | "agent-cursor-cli";
  status: SwiftDeletionReadinessStatus;
  requiredBeforeTypeScriptDeletion: true;
  evidenceCommands: string[];
  evidenceArtifacts: string[];
  lastVerifiedAt: string | null;
  reviewDecision: "accepted" | "blocked" | "not_reviewed";
  verifiedBranch: string | null;
  verifiedCommit: string | null;
  acceptedReviewWorkflowId: string | null;
  acceptedReviewNodeId: string | null;
  acceptedReviewFindingSeverities: string[];
  notes: string;
}

interface SwiftDeletionReadinessGate {
  schemaVersion: 1;
  migrationStatus: "incomplete";
  allowsTypeScriptDeletion: false;
  productionSwiftPackagingReady: boolean;
  typeScriptSourceDeletionReady: false;
  domains: SwiftDeletionReadinessDomain[];
}
```

**Checklist**:
- [x] Add the gate artifact with every required deletion-readiness domain.
- [x] Default `allowsTypeScriptDeletion` and `typeScriptSourceDeletionReady` to
      `false`.
- [x] Mark incomplete or unevidenced domains as `blocked` or `unknown`, not
      `passed`.
- [x] State that production Swift Homebrew packaging is separate from TypeScript
      source deletion readiness.
- [x] Keep `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` parity as
      separate required domains.

### 2. Swift Gate Model And Validator

#### Sources/RielflowCore/SwiftDeletionReadiness.swift
#### Tests/RielflowCoreTests/SwiftDeletionReadinessTests.swift

**Status**: COMPLETED

```typescript
interface SwiftDeletionReadinessValidationResult {
  valid: boolean;
  allowsTypeScriptDeletion: boolean;
  blockingDomainIds: string[];
  diagnostics: string[];
}

interface SwiftDeletionReadinessValidator {
  validate(gate: SwiftDeletionReadinessGate): SwiftDeletionReadinessValidationResult;
}
```

**Checklist**:
- [x] Decode the tracked JSON schema without requiring release build artifacts.
- [x] Fail validation when a required domain omits status, evidence commands,
      evidence artifacts, `lastVerifiedAt`, or `reviewDecision`.
- [x] Fail validation when `allowsTypeScriptDeletion` is true while any required
      domain is not passed with accepted review evidence.
- [x] Require branch-current commit evidence, exact accepted review workflow/node
      references, and an accepted no-high-or-mid review reference before any
      domain can unlock deletion readiness.
- [x] Reject blocking, unknown, or blank accepted-review severity labels before
      any domain can unlock deletion readiness.
- [x] Require parseable ISO-8601 `lastVerifiedAt`, non-placeholder evidence
      commands, and durable command-result evidence artifacts before any domain
      can unlock deletion readiness.
- [x] Require every listed evidence command to have a matching resolved
      successful evidence artifact before any domain can unlock deletion
      readiness.
- [x] Require domain-specific Swift parity plus TypeScript/Bun, release, or
      documentation evidence-command coverage before any domain can unlock
      deletion readiness.
- [x] Preserve deterministic diagnostics for missing fields, invalid statuses,
      duplicate domain ids, missing agent domains, and blocked aggregate state.
- [x] Keep Cursor CLI behavior isolated; the validator reads domain ids and
      evidence metadata only.

### 3. Packaging Visibility

#### packaging/homebrew/swift-cutover-gates.json
#### Tests/RielflowCoreTests/SwiftPackagingReadinessTests.swift

**Status**: COMPLETED

```typescript
interface SwiftDeletionReadinessSummary {
  allowsProductionCutover: boolean;
  allowsTypeScriptDeletion: boolean;
  blockedDomainIds: string[];
  message: string;
}
```

**Checklist**:
- [x] Add deterministic packaging/test visibility through an existing readiness
      metadata surface.
- [x] Keep `packaging/homebrew/swift-cutover-gates.json` focused on production
      packaging, with a reference to the separate deletion gate only if needed.
- [x] Add tests or JSON assertions proving production Swift packaging can be
      ready while TypeScript deletion remains blocked.
- [x] Do not modify release publishing, Homebrew tap handoff, or production
      archive generation behavior.

### 4. Progress And Documentation Index

#### impl-plans/completed/swift-deletion-readiness-gate.md
#### impl-plans/README.md
#### impl-plans/PROGRESS.json

**Status**: COMPLETED

```typescript
interface SwiftDeletionReadinessProgress {
  planId: "swift-deletion-readiness-gate";
  claimsFullSwiftMigrationComplete: false;
  claimsTypeScriptDeletionReady: false;
  requiredDomains: string[];
  blockedDomains: string[];
}
```

**Checklist**:
- [x] Register this implementation plan and archive it after completion.
- [x] Record every task dependency and parallelization limit.
- [x] Make progress metadata explicit that this is the first bounded slice, not
      TypeScript deletion.
- [x] Keep existing completed Swift migration metadata intact unless a later
      implementation slice produces new evidence.

### 5. Verification And Review Handoff

#### Repository verification surface

**Status**: COMPLETED

```typescript
interface SwiftDeletionReadinessReviewHandoff {
  workflowId: "codex-design-and-implement-review-loop";
  workflowMode: "issue-resolution";
  issueReference: "Swift migration TODO loop until TypeScript can be deleted";
  requiresAdversarialReview: true;
  verificationCommands: string[];
  residualRisks: string[];
}
```

**Checklist**:
- [x] Validate `packaging/swift-deletion-readiness.json` with `jq empty`.
- [x] Assert `allowsTypeScriptDeletion == false`.
- [x] Run focused Swift tests for the new validator and any CLI summary.
- [x] Run current TypeScript baseline commands before accepting the gate.
- [x] Run `git diff --check`.
- [x] Record review findings and residual risks in the progress log.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Gate artifact | `packaging/swift-deletion-readiness.json` | COMPLETED | `jq` blocked-state assertions |
| Swift gate model and validator | `Sources/RielflowCore/SwiftDeletionReadiness.swift` | COMPLETED | `Tests/RielflowCoreTests/SwiftDeletionReadinessTests.swift` |
| Packaging visibility | `packaging/homebrew/swift-cutover-gates.json` | COMPLETED | `Tests/RielflowCoreTests/SwiftPackagingReadinessTests.swift` |
| Progress metadata | `impl-plans/README.md`, `impl-plans/PROGRESS.json` | COMPLETED | `jq empty impl-plans/PROGRESS.json` |

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| TASK-001 Gate artifact | Accepted design | COMPLETED |
| TASK-002 Validator | TASK-001 | COMPLETED |
| TASK-003 Packaging visibility | TASK-001, TASK-002 | COMPLETED |
| TASK-004 Progress metadata | TASK-001 | COMPLETED |
| TASK-005 Verification handoff | TASK-001, TASK-002, TASK-003, TASK-004 | COMPLETED |

## Tasks

### TASK-001: Create The Blocked Gate Artifact

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `packaging/swift-deletion-readiness.json`
**Dependencies**: None

**Description**:
Create the machine-readable deletion-readiness record with all required parity
domains and a blocked aggregate state. Initial domain statuses must be honest:
only evidence-backed domains may be `passed`, and the aggregate must remain
blocked.

**Completion Criteria**:
- [x] Gate JSON is valid.
- [x] Every required domain is present.
- [x] `allowsTypeScriptDeletion=false`.
- [x] Agent parity domains are separate for `codex-agent`,
      `claude-code-agent`, and `cursor-cli-agent`.
- [x] No TypeScript source or test files are deleted.

### TASK-002: Add Deterministic Gate Validation

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCore/SwiftDeletionReadiness.swift`,
`Tests/RielflowCoreTests/SwiftDeletionReadinessTests.swift`
**Dependencies**: TASK-001

**Description**:
Add Swift validation for the gate schema and aggregate deletion decision. The
validator must make blocked deletion an explicit, testable state rather than an
implicit README warning.

**Completion Criteria**:
- [x] Missing required fields fail validation.
- [x] Missing required domains fail validation.
- [x] Duplicate domain ids fail validation.
- [x] `allowsTypeScriptDeletion=true` fails unless every required domain is
      passed with accepted review evidence.
- [x] Blocked aggregate state is reported deterministically.

### TASK-003: Expose Gate Status Without Changing Cutover Behavior

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `packaging/homebrew/swift-cutover-gates.json`,
`Tests/RielflowCoreTests/SwiftPackagingReadinessTests.swift`
**Dependencies**: TASK-001, TASK-002

**Description**:
Wire the gate reference into existing packaging readiness metadata and tests,
and keep production Swift packaging readiness separate from TypeScript source
deletion readiness. This slice intentionally does not add a new CLI command
surface.

**Completion Criteria**:
- [x] A packaging/test-visible status says TypeScript deletion remains
      blocked.
- [x] Production cutover metadata does not claim deletion readiness.
- [x] Tests cover production packaging ready plus TypeScript deletion blocked.
- [x] Release scripts and Homebrew publication behavior are unchanged.

### TASK-004: Update Progress Metadata

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `impl-plans/README.md`, `impl-plans/PROGRESS.json`
**Dependencies**: TASK-001

**Description**:
Register the plan and metadata so later Swift migration TODO-loop slices can
append evidence without treating this first bounded slice as full deletion
approval.

**Completion Criteria**:
- [x] `impl-plans/README.md` lists the plan as recently completed.
- [x] `impl-plans/PROGRESS.json` lists tasks and dependencies.
- [x] Metadata says `claimsFullSwiftMigrationComplete=false`.
- [x] Metadata says `claimsTypeScriptDeletionReady=false`.

### TASK-005: Verify And Prepare Review Handoff

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: verification output, progress-log update, review handoff
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Description**:
Run focused and baseline verification before implementation review. Any failed
or unavailable command must be recorded as a blocker or residual risk, not as a
passed deletion gate.

**Completion Criteria**:
- [x] `jq empty packaging/swift-deletion-readiness.json impl-plans/PROGRESS.json
      packaging/homebrew/swift-cutover-gates.json` passes.
- [x] `jq -e '.allowsTypeScriptDeletion == false'
      packaging/swift-deletion-readiness.json` passes.
- [x] Focused Swift deletion-readiness tests pass.
- [x] TypeScript baseline commands pass or a concrete blocker is recorded.
- [x] `git diff --check` passes.

## Parallelization

- TASK-001 and TASK-004 may proceed in parallel only if TASK-004 records the
  planned gate path and does not claim implemented evidence before TASK-001
  lands.
- TASK-002 is sequential after TASK-001 because it validates the actual gate
  schema.
- TASK-003 is sequential after TASK-002 because packaging visibility must
  consume validator results rather than duplicate validation.
- TASK-005 is sequential because review handoff depends on actual verification
  evidence.

## Verification Plan

- `jq empty packaging/swift-deletion-readiness.json impl-plans/PROGRESS.json packaging/homebrew/swift-cutover-gates.json`
- `jq -e '.allowsTypeScriptDeletion == false and .typeScriptSourceDeletionReady == false' packaging/swift-deletion-readiness.json`
- `jq -e '[.domains[] | select(.requiredBeforeTypeScriptDeletion == true)] | length >= 13' packaging/swift-deletion-readiness.json`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test --filter SwiftDeletionReadinessTests`
- `bun run typecheck:server`
- `bun run lint:biome`
- `bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --scope project`
- `git diff --check -- packaging/swift-deletion-readiness.json Sources/RielflowCore/SwiftDeletionReadiness.swift Tests/RielflowCoreTests/SwiftDeletionReadinessTests.swift Tests/RielflowCoreTests/SwiftPackagingReadinessTests.swift impl-plans/completed/swift-deletion-readiness-gate.md impl-plans/README.md impl-plans/PROGRESS.json packaging/homebrew/swift-cutover-gates.json`

## Completion Criteria

- [x] The first bounded TODO-loop slice creates a tracked deletion-readiness
      gate.
- [x] TypeScript deletion remains explicitly blocked.
- [x] Full parity domains are enumerated for package, CLI, server, GraphQL,
      event, workflow package, persistence, release, documentation, test,
      `codex-agent`, `claude-code-agent`, and `cursor-cli-agent`.
- [x] Validator tests prove missing or stale evidence cannot accidentally permit
      deletion.
- [x] TypeScript baseline verification remains part of the acceptance path.
- [x] No TypeScript files, TypeScript tests, Bun commands, or fallback docs are
      removed in this slice.

## Progress Log

### Session: 2026-06-16 00:00 JST

**Tasks Completed**: Planning only
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Step 3 accepted the design with no high or mid findings. This plan
consumes the accepted design as-is and keeps concrete codex-agent,
claude-code-agent, and cursor-cli-agent references explicit.

### Session: 2026-06-16 00:25 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added `packaging/swift-deletion-readiness.json` with required
package, CLI, server, GraphQL, event, workflow package, persistence, release,
documentation, test, `codex-agent`, `claude-code-agent`, and `cursor-cli-agent`
domains. Added `SwiftDeletionReadinessValidator` and focused Swift tests proving
missing fields, duplicate domains, missing agent domains, and unsafe aggregate
deletion-ready claims fail. Added Homebrew cutover metadata pointing to the
separate deletion gate while keeping `allowsProductionCutover=true` separate
from `allowsTypeScriptDeletion=false`. TypeScript/Bun source, tests, commands,
and fallback documentation were not deleted.

### Session: 2026-06-16 00:29 JST

**Tasks Completed**: TASK-002 self-review hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Step 6 self-review found `validate(_:)` reported blocked domains but
did not mark nil evidence command/artifact metadata as invalid when callers
constructed a gate model directly. Added deterministic diagnostics for missing
evidence metadata and a focused regression. `SwiftDeletionReadinessTests` now
passes 7 tests.

### Session: 2026-06-16 00:34 JST

**Tasks Completed**: Step 7 revision fixes
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 7 findings by replacing host-local codex-agent
artifact paths with portable `external-reference:codex-agent/...` references,
correcting TASK-003 scope to packaging/test visibility instead of unchanged CLI
deliverables, and identifying pre-existing unrelated dirty worktree changes as
out of scope for this Step 6 slice.

### Session: 2026-06-16 00:47 JST

**Tasks Completed**: Adversarial review fixes
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed adversarial review findings by requiring branch-current
`verifiedBranch`/`verifiedCommit` context, accepted review workflow/node
references, and absence of high/mid accepted-review severities before
`allowsTypeScriptDeletion` can become true. The tracked gate test now validates
the raw JSON through `decodeAndValidate(_:)`, and regressions cover missing
`lastVerifiedAt`/`notes`, stale commit evidence, and high/mid review findings.
Focused `SwiftDeletionReadinessTests` now pass 11 tests.

### Session: 2026-06-16 01:03 JST

**Tasks Completed**: Step 7 revision fixes
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed the latest Step 7 findings by requiring
`diagnostics.isEmpty` before `allowsTypeScriptDeletion` can be true and adding
duplicate-domain plus missing-structural-field deletion-ready regressions.
Restored tracked out-of-scope skill, CLI, GraphQL, design, flake, script, and
test changes to HEAD; removed untracked out-of-scope session-indexing files; and
cleaned plan metadata so this worktree diff remains scoped to the deletion gate.
Focused `SwiftDeletionReadinessTests` now pass 13 tests.

### Session: 2026-06-16 01:13 JST

**Tasks Completed**: Adversarial review fixes
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed the latest adversarial review finding by extending
`SwiftDeletionReadinessValidationContext` with expected accepted review
workflow/node ids, requiring exact matches before deletion readiness can unlock,
and adding bogus workflow/node regressions. TypeScript deletion remains blocked.

### Session: 2026-06-16 01:26 JST

**Tasks Completed**: Adversarial review fixes
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed the latest adversarial review finding by allowing only
explicit non-blocking accepted-review severity labels and treating `medium`,
`critical`, `blocker`, unknown labels, and blank labels as deletion-blocking
evidence. Added regression coverage for each reviewed severity bypass case.

### Session: 2026-06-16 01:36 JST

**Tasks Completed**: Adversarial review fixes
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed the latest adversarial review finding by requiring
parseable ISO-8601 `lastVerifiedAt`, rejecting placeholder evidence commands,
rejecting source-only/non-durable evidence artifacts, and requiring explicit
non-blocking accepted-review severity evidence before deletion readiness can
unlock. Added regressions for placeholder commands, source-only artifacts,
malformed timestamps, and empty severity evidence.

### Session: 2026-06-16 01:48 JST

**Tasks Completed**: Adversarial review fixes
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed the latest adversarial review findings by requiring
deletion-ready evidence artifacts to resolve to successful command-result
metadata bound to domain id, command, branch, commit, workflow id, and review
node id. Also required `migrationStatus=deletion_ready` when both deletion flags
are true. Added regressions for unresolved evidence artifacts, failed command
evidence, and contradictory incomplete migration status.

### Session: 2026-06-16 01:57 JST

**Tasks Completed**: Step 7 revision fixes
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 7 design-reference finding by adding the accepted
TypeScript deletion-readiness TODO loop section to
`design-docs/specs/design-swift-native-migration.md`, including
`swift-deletion-readiness.json`, blocked deletion flags, full required parity
domains, `codex-agent` reference-only handling, and durable accepted-evidence
requirements.

### Session: 2026-06-16 02:07 JST

**Tasks Completed**: Adversarial review fixes
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed the latest adversarial review finding by requiring every
listed deletion-ready evidence command to have at least one resolved successful
evidence artifact for the same domain, branch, commit, workflow id, and review
node id. Added a regression where a deletion-ready domain lists both
`SwiftDeletionReadinessTests` and `bun run typecheck:server` but resolves only
one command artifact; focused `SwiftDeletionReadinessTests` now pass 24 tests.

### Session: 2026-06-16 02:17 JST

**Tasks Completed**: Adversarial review fixes
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed the latest adversarial review finding by adding
domain-specific deletion-ready evidence command requirements for package, CLI,
server, GraphQL, event, workflow package, persistence, release, documentation,
test, `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` domains. The
positive deletion-ready fixture now uses domain-specific Swift and
TypeScript/Bun/release/documentation commands, and a regression proves a narrow
validator-only command cannot unlock deletion readiness; focused
`SwiftDeletionReadinessTests` now pass 25 tests.
