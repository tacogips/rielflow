# Workflow Checkout GitHub Directory Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/command.md#subcommands`; `design-docs/specs/architecture.md#workflow-checkout-boundary`; `design-docs/specs/design-user-scope-workflows.md#checkout-registry`
**Created**: 2026-05-17
**Last Updated**: 2026-05-17

---

## Design Document Reference

**Source**:

- `design-docs/specs/command.md:21`
- `design-docs/specs/command.md:163`
- `design-docs/specs/architecture.md:418`
- `design-docs/specs/design-user-scope-workflows.md:281`
- `design-docs/specs/design-user-scope-workflows.md:292`

### Summary

Implement `divedra workflow checkout <url>` for installing a valid workflow
bundle from a GitHub directory URL into the scoped workflow catalog. The command
stages the remote directory, validates it before destination changes, installs
into project scope by default or user scope with `--user-scope`, rejects
duplicates unless `--overwrite` is supplied, and writes checkout provenance under
the user scope root.

### Issue Reference

- Source: `runtimeVariables.workflowInput`
- Issue title: Add workflow checkout command for GitHub workflow directories
- Issue URL: none supplied
- Fallback used: yes

### Scope

**Included**:

- GitHub web directory URL parsing and recursive directory fetch abstraction.
- Temporary staging, staged workflow validation, scoped destination resolution,
  duplicate rejection, overwrite replacement, and safe install.
- Checkout registry metadata under
  `<user-root>/workflow-registry/checkouts/<scope>-<workflow-name>.json`.
- CLI parsing and `workflow checkout` handler behavior, including text and JSON
  output.
- Focused unit and CLI tests with mocked GitHub fetch behavior.
- User-facing docs for command syntax, scope, validation, duplicate handling,
  overwrite, and registry location.

**Excluded**:

- Private GitHub authentication and non-GitHub hosts.
- Arbitrary `--workflow-definition-dir` checkout destinations.
- Changes to workflow runtime lookup, authored workflow schema, or backend
  adapter semantics.
- Codex-agent-specific or Cursor-specific checkout behavior.

### Codex Agent References

Step 1 and Step 3 reported no supplied codex-agent reference inputs. Checkout is
provider-neutral; downloaded node payloads may reference `codex-agent`,
`claude-code-agent`, or `cursor-cli-agent`, and those references must remain
validated by the existing workflow node/backend validation layers.

---

## Modules

### 1. GitHub Directory Checkout Inputs

#### `src/workflow/checkout/github-directory.ts`

**Status**: COMPLETED

**Relevant signatures**:

```typescript
export interface GitHubDirectoryUrl {
  readonly owner: string;
  readonly repository: string;
  readonly ref: string;
  readonly directoryPath: string;
  readonly workflowName: string;
}

export interface GitHubDirectoryFetch {
  readonly sourceUrl: string;
  readonly destinationDirectory: string;
  readonly fetchImpl?: typeof fetch;
}

export function parseGitHubDirectoryUrl(
  sourceUrl: string,
): Result<GitHubDirectoryUrl, WorkflowCheckoutFailure>;

export async function fetchGitHubDirectoryToStaging(
  input: GitHubDirectoryFetch,
): Promise<Result<GitHubDirectoryUrl, WorkflowCheckoutFailure>>;
```

**Deliverables**:

- Accept `https://github.com/<owner>/<repo>/tree/<ref>/<workflow-directory-path>`.
- Derive `workflowName` from the final directory segment and reuse the existing
  safe workflow-name rule.
- Avoid silently guessing ambiguous ref/path splits; use mocked GitHub metadata
  behavior in tests.
- Download all tracked files below the selected directory into staging, excluding
  git metadata and files outside the selected directory.

**Checklist**:

- [x] Supported GitHub directory URLs parse into owner, repo, ref, path, and workflow name.
- [x] Unsupported hosts and malformed URLs return checkout failures.
- [x] Unsafe workflow names are rejected before fetch/install.
- [x] Branch or tag slash ambiguity is handled by metadata resolution, not silent guessing.

### 2. Checkout Destination and Registry

#### `src/workflow/checkout/registry.ts`
#### `src/workflow/catalog.ts`
#### `src/workflow/paths.ts`

**Status**: COMPLETED

**Relevant signatures**:

```typescript
export type WorkflowCheckoutScope = "project" | "user";

export interface WorkflowCheckoutDestination {
  readonly scope: WorkflowCheckoutScope;
  readonly scopeRoot: string;
  readonly workflowRoot: string;
  readonly workflowDirectory: string;
  readonly registryPath: string;
}

export interface WorkflowCheckoutRegistryRecord {
  readonly workflowName: string;
  readonly sourceUrl: string;
  readonly scope: WorkflowCheckoutScope;
  readonly checkedOutAt: string;
  readonly destinationDirectory: string;
}

export function resolveWorkflowCheckoutDestination(
  workflowName: string,
  options: LoadOptions & { readonly userScope?: boolean },
): Result<WorkflowCheckoutDestination, WorkflowCheckoutFailure>;
```

**Deliverables**:

- Resolve project default to discovered project `.divedra`, or
  `<cwd>/.divedra` when none exists.
- Resolve `--user-scope` to `<user-root>/workflows/<workflow-name>`.
- Reject direct root checkout destinations from `--workflow-definition-dir`.
- Build registry path as
  `<user-root>/workflow-registry/checkouts/<scope>-<workflow-name>.json`.
- Use `atomicWriteJsonFile` for registry writes.

**Checklist**:

- [x] Project checkout creates or targets `<project-root>/.divedra/workflows/<name>`.
- [x] No discovered project scope falls back to `<cwd>/.divedra/workflows/<name>`.
- [x] User checkout targets `<user-root>/workflows/<name>`.
- [x] Registry file names include scope and workflow name.
- [x] Registry record includes workflowName, sourceUrl, scope, checkedOutAt, and destinationDirectory.

### 3. Checkout Install Service

#### `src/workflow/checkout/index.ts`

**Status**: COMPLETED

**Relevant signatures**:

```typescript
export interface WorkflowCheckoutOptions extends LoadOptions {
  readonly sourceUrl: string;
  readonly userScope?: boolean;
  readonly overwrite?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export interface WorkflowCheckoutResult {
  readonly workflowName: string;
  readonly sourceUrl: string;
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory: string;
  readonly registryPath: string;
  readonly validationStatus: "valid";
  readonly overwritten: boolean;
}

export async function checkoutWorkflow(
  options: WorkflowCheckoutOptions,
): Promise<Result<WorkflowCheckoutResult, WorkflowCheckoutFailure>>;
```

**Deliverables**:

- Create a temporary staging directory outside the destination tree.
- Fetch remote files into staging and validate with the same loader/validation
  path used by `workflow validate`.
- Fail without creating or modifying the destination when JSON, bundle, path, or
  semantic validation fails.
- Treat an existing destination directory or existing registry record as a
  duplicate unless `overwrite` is true.
- For overwrite, validate the new staged bundle before removing only the
  resolved destination directory under the selected workflow root.
- Install the staged directory into the final destination atomically where the
  host filesystem permits.

**Checklist**:

- [x] Invalid remote workflow leaves destination and registry untouched.
- [x] Duplicate destination errors without overwrite.
- [x] Duplicate registry record errors without overwrite.
- [x] Overwrite validates before deleting the existing destination.
- [x] Deletion is constrained to `<scope-root>/workflows/<workflow-name>`.
- [x] Successful checkout returns result fields used by CLI text and JSON output.

### 4. CLI Integration

#### `packages/divedra/src/cli/argument-parser.ts`
#### `packages/divedra/src/cli/storage-and-options.ts`
#### `packages/divedra/src/cli/workflow-command-handler.ts`
#### `packages/divedra/src/cli/input-output-helpers.ts`

**Status**: COMPLETED

**Relevant signatures**:

```typescript
export interface ParsedOptions {
  readonly userScope: boolean;
  readonly overwrite: boolean;
}
```

**Deliverables**:

- Parse `--user-scope` and `--overwrite` as boolean options.
- Add `workflow checkout <url>` dispatch before name-based workflow commands.
- Reject missing URL, extra incompatible destination options, and
  `--workflow-definition-dir`.
- Thread `fetchImpl`, env, user root, project root, cwd, output mode, and shared
  storage options into `checkoutWorkflow`.
- Render text output with workflow name, scope, destination directory, and
  registry path; render `--output json` with the full checkout result.
- Update CLI help text.

**Checklist**:

- [x] `divedra workflow checkout <url>` routes to checkout service.
- [x] `--user-scope` and `--overwrite` parse and reach the service.
- [x] `--workflow-definition-dir` with checkout exits as usage error.
- [x] Text and JSON output expose explicit destination and registry fields.

### 5. Tests

#### `src/workflow/checkout/*.test.ts`
#### `src/cli.test.ts`

**Status**: COMPLETED

**Deliverables**:

- Unit tests for GitHub URL parsing, unsupported URL rejection, workflow-name
  validation, branch/path ambiguity, recursive fetch mapping, scoped destination
  resolution, registry record path/content, duplicate detection, overwrite
  safety, and validation-before-install behavior.
- CLI tests for project-scope checkout, user-scope checkout, invalid remote
  validation failure, duplicate rejection, overwrite reinstall, registry
  metadata, rejected `--workflow-definition-dir`, and JSON output.
- Mock `fetchImpl` and filesystem roots so tests remain offline and deterministic.

**Checklist**:

- [x] Project checkout installs under `.divedra/workflows/<workflow-name>`.
- [x] User checkout installs under `<user-root>/workflows/<workflow-name>`.
- [x] Invalid remote JSON fails before destination changes.
- [x] Duplicate checkout fails without `--overwrite`.
- [x] `--overwrite` replaces only after staged validation.
- [x] Registry JSON includes source URL, scope, checkout datetime, and destination path.

### 6. User-facing Documentation and Progress Log

#### `README.md`
#### `.agents/skills/divedra-workflow-run/SKILL.md`
#### `impl-plans/active/workflow-checkout-github-directory.md`

**Status**: COMPLETED

**Deliverables**:

- Document command syntax, accepted GitHub URL shape, default project scope,
  `--user-scope`, `--overwrite`, validation-before-install behavior, duplicate
  handling, text/JSON output, and registry location.
- Update this plan's progress log and completion criteria after implementation.

**Checklist**:

- [x] README contains checkout usage and examples.
- [x] Workflow-run skill mentions checkout operator behavior where appropriate.
- [x] Progress log records completed tasks, verification results, blockers, and residual risks.

---

## Task Breakdown

| Task | Scope | Deliverables | Dependencies | Parallelizable |
| ---- | ----- | ------------ | ------------ | -------------- |
| TASK-001 | GitHub URL parser and fetch adapter | `src/workflow/checkout/github-directory.ts`, parser/fetch tests | Accepted Step 3 design review | Yes |
| TASK-002 | Destination and registry helpers | `src/workflow/checkout/registry.ts`, scoped helper exports in `src/workflow/catalog.ts` / `src/workflow/paths.ts`, registry tests | Accepted Step 3 design review | Yes |
| TASK-003 | Checkout install service | `src/workflow/checkout/index.ts`, install/overwrite/validation tests | TASK-001, TASK-002 | No |
| TASK-004 | CLI command integration | CLI parser/types/help/handler files, CLI tests | TASK-003 | No |
| TASK-005 | Documentation refresh | `README.md`, `.agents/skills/divedra-workflow-run/SKILL.md` | TASK-004 behavior and output names | No |
| TASK-006 | Verification and progress update | This plan file | TASK-001 through TASK-005 | No |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| GitHub directory import | Existing `fetchImpl` dependency injection and mocked tests | READY |
| Staged workflow validation | `loadWorkflowFromDisk`, `validateWorkflowBundleDetailedAsync`, authored path guards | READY |
| Scoped destination resolution | Existing project/user root discovery and safe workflow-name helpers | READY |
| Atomic registry writes | `src/shared/fs.ts` `atomicWriteJsonFile` | READY |
| CLI checkout dispatch | Existing `workflow-command-handler.ts` command routing | READY |
| Backend validation | Existing node/backend validation for `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` | READY |

## Parallelizable Tasks

- TASK-001 and TASK-002 are parallelizable because their initial write scopes are
  disjoint: GitHub parsing/fetch files versus scoped destination/registry files.
- TASK-003 is not parallelizable with TASK-001 or TASK-002 because it consumes
  both contracts.
- TASK-004 through TASK-006 should run serially after service behavior stabilizes.

## Verification Plan

Run after implementation:

- `bun test src/workflow/checkout/*.test.ts src/cli.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `git diff --check`

Focused behavioral checks:

- `divedra workflow checkout <mocked-github-url>` installs a valid staged bundle
  into project scope and writes a project registry record.
- `divedra workflow checkout <mocked-github-url> --user-scope` installs into
  user scope and writes a user registry record.
- Invalid remote JSON or missing workflow-local files fail before destination or
  registry changes.
- Duplicate destination or registry record fails without `--overwrite`.
- `--overwrite` validates the new staged bundle before replacing the old
  destination and registry record.
- `--workflow-definition-dir` with checkout returns a usage error.

## Completion Criteria

- [x] `divedra workflow checkout <url>` accepts supported GitHub directory URLs and rejects unsupported inputs.
- [x] Remote workflow bundles are fetched into staging and validated before destination mutation.
- [x] Project-scope default and `--user-scope` destination behavior match the accepted design.
- [x] Duplicate checkout and `--overwrite` behavior match the accepted design.
- [x] Registry metadata is written atomically under `<user-root>/workflow-registry/checkouts/<scope>-<workflow-name>.json`.
- [x] Text and JSON CLI outputs expose workflowName, sourceUrl, scope, destinationDirectory, registryPath, validationStatus, and overwritten.
- [x] Tests cover parser, fetch abstraction, staged validation, install, registry, duplicate, overwrite, and CLI behavior.
- [x] README and workflow-run skill docs describe the checkout command and registry behavior.
- [x] `bun test src/workflow/checkout/*.test.ts src/cli.test.ts` passes.
- [x] `bun run typecheck` passes.
- [x] `bun run lint:biome` passes.
- [x] `git diff --check` passes.

## Progress Log

### Session: 2026-05-17 13:36 +0900

**Tasks Completed**: Implementation plan created after Step 3 accepted the
design.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: No Step 5 review feedback is present. Implementation must preserve
provider-neutral checkout behavior and keep `codex-agent` handling inside the
existing node/backend validation path.

### Session: 2026-05-17 15:10 +0900

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, focused tests,
README documentation, workflow-run skill documentation, and verification
commands.

**Tasks In Progress**: None.

**Blockers**: The workflow runner stalled during Step 6 before publishing the
implementation handoff. Manual follow-through completed the remaining
documentation update and verification.

**Notes**: Added provider-neutral GitHub directory checkout parsing/fetching,
staged validation, scoped project/user install destinations, duplicate and
overwrite handling, registry writes under user root, CLI text/JSON output, and
offline tests with mocked GitHub responses. Verification passed:
`bun test src/workflow/checkout/*.test.ts src/cli.test.ts`,
`bun run typecheck`, `bun run lint:biome`, and `git diff --check`. Biome
reported existing warnings in unrelated `src/workflow/engine/*` files while
exiting successfully.

## Related Plans

- **Previous**: none
- **Next**: none
- **Depends On**: Accepted design updates in `design-docs/specs/command.md`,
  `design-docs/specs/architecture.md`, and
  `design-docs/specs/design-user-scope-workflows.md`
