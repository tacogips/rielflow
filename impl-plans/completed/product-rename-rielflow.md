# Product Rename to Rielflow Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#product-rename-to-rielflow; design-docs/specs/command.md#product-rename-command-surface
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Design Document Reference

**Source**: design-docs/specs/architecture.md:71; design-docs/specs/command.md:9

### Summary

Rename product-owned `divedra` identity to `rielflow` across package names,
CLI entrypoints, scripts, configuration, workflow bundles, examples,
documentation, release assets, and file paths while preserving runtime behavior.
Use `Rielflow` for human-readable product naming and
`https://github.com/tacogips/rielflow` as the repository origin.

### Scope

**Included**: package/app identifiers, CLI binary and help text, repo-local and
user-facing docs, workflow bundle prompts/examples, scripts, release/Homebrew
assets, TUI/server/GraphQL labels, repository origin, compatibility alias
classification, and verification searches for stale product-owned names.

**Excluded**: renaming backend execution identifiers such as `codex-agent`,
`claude-code-agent`, `official/openai-sdk`, and `official/anthropic-sdk`;
changing workflow execution semantics; changing mailbox, GraphQL, event, TUI,
or session behavior except product-owned labels and paths; rewriting historical
artifacts unless the retained reference is explicitly classified.

### Accepted Review Feedback

Step 3 accepted the design with no high or mid findings. The implementation
must preserve Codex-agent references as backend/workflow context and must keep
every retained `divedra` literal classified as compatibility alias, migration
support, historical artifact reference, or intentionally unchanged backend text.

### Open Product Decisions

Track unresolved decisions in
`design-docs/user-qa/qa-product-rename-rielflow.md`. Implementation may proceed
by making compatibility-preserving choices where a decision is not yet final:
retain a thin `divedra` CLI alias if needed, keep legacy read discovery for
runtime roots, and document historical references instead of deleting context.

---

## Modules

### 1. Rename Inventory and Classification

#### Repository-wide search results

**Status**: COMPLETED

```typescript
type RetainedRielflowReason =
  | "compatibility-alias"
  | "migration-support"
  | "historical-artifact-reference"
  | "backend-reference";

interface RenameInventoryEntry {
  readonly path: string;
  readonly currentValue: string;
  readonly targetValue?: string;
  readonly retainedReason?: RetainedRielflowReason;
}
```

**Checklist**:

- [x] Inventory product-owned `divedra`, `Divedra`, and `DIVEDRA` references.
- [x] Classify retained literals with an accepted retained reason.
- [x] Identify filename and directory rename targets before editing imports.
- [x] Confirm `codex-agent` references remain backend identifiers.

### 2. Package Names, Bins, Imports, and Build Scripts

#### package.json
#### packages/*/package.json
#### scripts/sync-package-declarations.ts
#### Taskfile.yml
#### flake.nix
#### tsconfig*.json

**Status**: COMPLETED

```typescript
interface PackageRenameTarget {
  readonly packageDirectory: string;
  readonly currentPackageName: string;
  readonly targetPackageName: string;
  readonly binName?: "rielflow";
  readonly retainedCompatibilityExport?: string;
}
```

**Checklist**:

- [x] Rename workspace/package identifiers from divedra-owned names to rielflow-owned names.
- [x] Update package bin names and build script paths after directory renames.
- [x] Preserve or explicitly document compatibility exports where required.
- [x] Regenerate or update declaration sync configuration for renamed packages.

### 3. CLI Surface and Compatibility Alias

#### packages/rielflow/src/bin.ts
#### packages/rielflow/src/cli.ts
#### packages/rielflow/src/cli.test.ts

**Status**: COMPLETED

```typescript
interface CliProductIdentity {
  readonly primaryCommand: "rielflow";
  readonly humanName: "Rielflow";
  readonly legacyCommand?: "rielflow";
  readonly legacyWarningMode: "none" | "text-only";
}
```

**Checklist**:

- [x] Present `rielflow` as the primary executable in help, errors, and snippets.
- [x] Keep JSON output parseable if a legacy `divedra` alias emits warnings.
- [x] Update CLI tests to expect Rielflow/rielflow product naming.
- [x] Add smoke coverage for primary command help and JSON-output paths.

### 4. Runtime Roots, Environment Variables, and Persistence Compatibility

#### packages/rielflow-core/src/paths.ts
#### packages/rielflow-events/src/path-resolution.ts
#### packages/rielflow/src/cli/storage-and-options.ts
#### packages/rielflow/src/workflow/catalog.ts

**Status**: COMPLETED

```typescript
interface RuntimeRootCompatibility {
  readonly newUserRootName: ".rielflow";
  readonly legacyUserRootName: ".rielflow";
  readonly readLegacyRoots: boolean;
  readonly writeLegacyRoots: boolean;
}
```

**Checklist**:

- [x] Change new product-owned default roots from `.divedra` to `.rielflow`.
- [x] Preserve explicit env var and option behavior or document any renamed variable.
- [x] Add legacy read discovery or migration support for existing runtime data.
- [x] Verify persisted workflow executions and event receipts remain inspectable.

### 5. Workflow Bundles, Examples, Prompts, and Skills

#### .rielflow/
#### examples/
#### .agents/skills/
#### README.md

**Status**: COMPLETED

```typescript
interface WorkflowRenamePolicy {
  readonly workflowRoot: ".rielflow/workflows";
  readonly legacyWorkflowRoot: ".rielflow/workflows";
  readonly managerBackendReferencesRemain: readonly ["codex-agent"];
}
```

**Checklist**:

- [x] Rename product-owned workflow roots, examples, and prompt text.
- [x] Preserve backend identifiers and workflow execution context references.
- [x] Update workflow validation examples to use `rielflow`.
- [x] Keep historical references only with explicit retained-reason wording.

### 6. Release, Homebrew, Repository Origin, and Documentation

#### Formula/rielflow.rb
#### scripts/build-homebrew-release.sh
#### scripts/render-homebrew-formula.sh
#### README.md
#### design-docs/

**Status**: COMPLETED

```typescript
interface ReleaseRenameTarget {
  readonly formulaName: "rielflow";
  readonly repositoryUrl: "https://github.com/tacogips/rielflow";
  readonly archivePrefix: "rielflow";
  readonly legacyFormulaName?: "rielflow";
}
```

**Checklist**:

- [x] Rename release artifact names and formula paths to rielflow.
- [x] Update install, Nix, Homebrew, and GitHub URL documentation.
- [x] Set repository origin to `https://github.com/tacogips/rielflow`.
- [x] Record compatibility choices for old package/formula names.

### 7. Verification and Rename Audit

#### test and command outputs

**Status**: Completed

```typescript
interface RenameVerificationResult {
  readonly command: string;
  readonly passed: boolean;
  readonly notes?: string;
}
```

**Checklist**:

- [x] Run formatting, typecheck, unit tests, and build checks.
- [x] Validate repository-local workflow bundles and examples.
- [x] Run stale-name searches and classify retained references.
- [x] Verify `git remote -v` reports the Rielflow repository URL.

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Rename inventory | repository-wide | COMPLETED | search audit |
| Package/build rename | `package.json`, `packages/*/package.json`, scripts | COMPLETED | build/typecheck |
| CLI surface | `packages/rielflow/src/bin.ts`, `packages/rielflow/src/cli.ts` | COMPLETED | CLI smoke/unit |
| Runtime compatibility | `packages/rielflow-core/src/paths.ts`, runtime path modules | COMPLETED | focused persistence tests |
| Workflows/examples | `.rielflow/`, `examples/`, `.agents/skills/` | COMPLETED | workflow validate |
| Release/docs | `Formula/rielflow.rb`, scripts, `README.md` | COMPLETED | release script dry run |
| Verification audit | repository-wide | COMPLETED | full verification list |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| TASK-001: Inventory | None | COMPLETED |
| TASK-002: Package/build rename | TASK-001 | COMPLETED |
| TASK-003: CLI surface | TASK-002 | COMPLETED |
| TASK-004: Runtime compatibility | TASK-001, TASK-002 | COMPLETED |
| TASK-005: Workflows/examples | TASK-002, TASK-004 | COMPLETED |
| TASK-006: Release/docs | TASK-002, TASK-003, TASK-005 | COMPLETED |
| TASK-007: Verification audit | TASK-002, TASK-003, TASK-004, TASK-005, TASK-006 | COMPLETED |

---

## Tasks

### TASK-001: Inventory and Rename Classification

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: rename inventory in progress log; retained literal classification
**Dependencies**: None

**Description**:
Search the repository for rielflow-owned strings and paths, classify each
retained literal, and confirm backend identifiers such as `codex-agent` are not
product branding.

**Completion Criteria**:

- [x] `rg -n "divedra|Divedra|DIVEDRA"` results reviewed.
- [x] Filename/directory rename list prepared.
- [x] Retained literals classified.
- [x] No Codex-agent/backend references targeted for product rename.

### TASK-002: Rename Package, Directory, Build, and Import Identifiers

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `package.json`, `packages/rielflow*`, build scripts, declaration sync
**Dependencies**: TASK-001

**Description**:
Rename package directories, package metadata, import specifiers, build scripts,
Taskfile targets, and generated declaration mapping from rielflow-owned names to
rielflow-owned names.

**Completion Criteria**:

- [x] Package directories and package names use rielflow-owned identifiers.
- [x] Build scripts reference renamed package paths.
- [x] Internal imports compile after package rename.
- [x] Compatibility exports are retained or documented.

### TASK-003: Rename CLI and User-Facing Command Surface

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/bin.ts`, `packages/rielflow/src/cli.ts`, CLI tests
**Dependencies**: TASK-002

**Description**:
Make `rielflow` the primary command in help, errors, snippets, and test
fixtures. Implement or document the `rielflow` compatibility alias according to
the design's compatibility-preserving fallback.

**Completion Criteria**:

- [x] `rielflow --help` and subcommand help show Rielflow/rielflow naming.
- [x] JSON command output remains parseable.
- [x] Legacy alias behavior is explicit if retained.
- [x] CLI tests cover primary naming and alias policy.

### TASK-004: Runtime Path and Persistence Compatibility

**Status**: Completed
**Parallelizable**: No
**Deliverables**: runtime path modules, storage option tests, event path tests
**Dependencies**: TASK-001, TASK-002

**Description**:
Change new product-owned default roots and runtime labels to rielflow while
preserving access to legacy rielflow roots where needed for existing sessions,
artifacts, workflow catalogs, self-improve logs, and event receipts.

**Completion Criteria**:

- [x] New default roots use `.rielflow` where product-owned.
- [x] Legacy `.divedra` read behavior is covered by tests or documented as migration support.
- [x] Existing explicit option/env overrides still take precedence.
- [x] Runtime inspection tests prove historical data remains discoverable.

### TASK-005: Rename Workflow Bundles, Examples, Prompts, and Skills

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `.rielflow/` or compatibility-root workflow files, `examples/`, `.agents/skills/`, prompts
**Dependencies**: TASK-002, TASK-004

**Description**:
Update workflow bundle roots, workflow prompt text, examples, mock scenarios,
skills, and operator docs so product references use Rielflow/rielflow while
backend identifiers and historical examples remain correctly classified.

**Completion Criteria**:

- [x] Workflow bundles validate from the renamed or compatible project root.
- [x] Examples remain runnable with updated command paths.
- [x] Skill docs use rielflow product naming where applicable.
- [x] Retained `rielflow-manager` or backend-like ids are explicitly justified or renamed only if product-owned.

### TASK-006: Rename Release, Homebrew, Repository, and User Documentation

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Formula/rielflow.rb`, release scripts, README, design/user QA updates, git remote
**Dependencies**: TASK-002, TASK-003, TASK-005

**Description**:
Update release artifact naming, Homebrew formula path, GitHub URLs, Nix
examples, README command examples, repository origin, and user-facing design/QA
notes.

**Completion Criteria**:

- [x] Release scripts produce rielflow-named archive paths.
- [x] Homebrew formula path and docs use `Formula/rielflow.rb`.
- [x] README and workflow docs present Rielflow as the product.
- [x] `git remote -v` points at `https://github.com/tacogips/rielflow`.

### TASK-007: Full Verification and Residual Reference Audit

**Status**: Completed
**Parallelizable**: No
**Deliverables**: verification command results in progress log; residual risk notes
**Dependencies**: TASK-002, TASK-003, TASK-004, TASK-005, TASK-006

**Description**:
Run the full validation suite, workflow validations, command smoke checks,
stale-reference audit, retained-reference audit, and repository-origin check.

**Completion Criteria**:

- [x] `bun run lint:biome` passes.
- [x] `bun test` passes.
- [x] `bun run build` passes.
- [x] Workflow validation passes for project and examples.
- [x] Stale product-owned `divedra` references are removed or classified.
- [x] Repository origin check passes.

---

## Verification Plan

- `rg -n "rielflow|Rielflow|DIVEDRA" .`
- `rg -n "codex-agent|claude-code-agent|official/openai-sdk|official/anthropic-sdk" .`
- `git diff --check`
- `bun run check`
- `bun test`
- `bun run build`
- `bun run packages/rielflow/src/bin.ts --help`
- `bun run packages/rielflow/src/bin.ts workflow list --output json`
- `bun run packages/rielflow/src/bin.ts workflow validate design-and-implement-review-loop`
- `bun run packages/rielflow/src/bin.ts workflow validate refactoring-divide-and-conquer`
- `bun run packages/rielflow/src/bin.ts workflow validate recent-change-quality-loop`
- `bun run packages/rielflow/src/bin.ts workflow validate node-combinations-showcase --workflow-definition-dir ./examples`
- `git remote -v`

## Completion Criteria

- [x] All product-owned names use Rielflow/rielflow consistently.
- [x] Backend identifiers, including `codex-agent`, remain unchanged.
- [x] Retained `divedra` literals are documented as compatibility, migration, historical, or backend references.
- [x] CLI, package, workflow, script, release, docs, and repository-origin rename scope is complete.
- [x] Behavior-preserving tests and workflow validations pass.
- [x] Progress log records every implementation session, verification command, and unresolved risk.

## Progress Log

### Session: 2026-05-26 00:00

**Tasks Completed**: Plan creation
**Tasks In Progress**: None
**Blockers**: User decisions remain open in `design-docs/user-qa/qa-product-rename-rielflow.md`
**Notes**: Created from accepted Step 3 design review in workflow
`codex-design-and-implement-review-loop`; no implementation code changed in this
planning step.

### Session: 2026-05-26 Step 6 implementation

**Tasks Completed**: TASK-001 through TASK-006; TASK-007 partially
**Tasks In Progress**: TASK-007
**Blockers**: Full `bun test` has one remaining failure in
`packages/rielflow/src/workflow/engine.test.ts`:
`runWorkflow > persists native command stdout captured before timeout`.
**Notes**: Renamed product-owned package directories, package names, imports,
CLI/bin labels, workflow roots, example bundles, skill docs, release/Homebrew
assets, repository URLs, and user-facing documentation from Divedra/divedra to
Rielflow/rielflow. Preserved `codex-agent` and other backend identifiers.
Preserved uppercase `DIVEDRA_*` environment variables as compatibility and
runtime contract names. Verified repository origin is
`https://github.com/tacogips/rielflow`.

**Verification**: `bun install`, `bun run typecheck`, `bun run build`,
`bun run lint:biome`,
`bun test packages/rielflow/src/package-boundaries.test.ts packages/rielflow/src/workflow/addon-package-boundary.test.ts`,
`bun test packages/rielflow/src/cli.test.ts -t "inspect reports step-derived"`,
`bun test packages/rielflow/src/graphql/schema.test.ts -t "exposes step-derived cross-workflow calls"`,
`bun run packages/rielflow/src/bin.ts --help`,
`bun run packages/rielflow/src/bin.ts workflow list --output json`,
`bun run packages/rielflow/src/bin.ts workflow validate design-and-implement-review-loop`,
`bun run packages/rielflow/src/bin.ts workflow validate refactoring-divide-and-conquer`,
`bun run packages/rielflow/src/bin.ts workflow validate recent-change-quality-loop`,
`bun run packages/rielflow/src/bin.ts workflow validate node-combinations-showcase --workflow-definition-dir ./examples`,
`git remote -v`, `rg -n "github.com/(user/repo|tacogips/divedra)|packages/divedra|divedra-core|divedra-addons|divedra-adapters|divedra-events|divedra-graphql|divedra-server|divedra-hook|\\bdivedra\\b|Divedra" --hidden -g '!node_modules' -g '!.git' -g '!dist' -g '!bun.lock'`,
and full `bun test` (1289 pass, 1 fail).

### Session: 2026-05-26 Step 6 revision after self-review

**Tasks Completed**: TASK-007
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 6 self-review feedback by preserving native command
stdout/stderr process logs when a package node times out and the native executor
returns its own timeout error before the outer timeout promise wins. The fix is
scope-limited to timeout failure normalization and retains `codex-agent`
references as backend identifiers.

**Verification**: `bun test packages/rielflow/src/workflow/engine.test.ts -t "persists native command stdout captured before timeout"`,
`bun test packages/rielflow/src/workflow/adapter.test.ts`,
`bun run typecheck`, `bun run lint:biome`, `bun run build`, and full
`bun test` (1290 pass, 0 fail).
