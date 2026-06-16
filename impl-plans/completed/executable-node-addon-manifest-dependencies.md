# Executable Node Add-on Manifest Dependencies Implementation Plan

**Status**: Completed
**Design Reference**:
`design-docs/specs/design-executable-node-addon-manifest-dependencies.md`
**Created**: 2026-06-03
**Last Updated**: 2026-06-04

## Design Document Reference

**Source**:
`design-docs/specs/design-executable-node-addon-manifest-dependencies.md`

### Summary

Complete the in-progress issue-resolution implementation for executable
`node-addon` package support. Node-addon package manifests may declare
`execution`, `capabilities`, `contentDigest`, and package `dependencies`.
Executable payload files such as `.bash` are accepted only when declared by
execution metadata, covered by add-on content digest checks, and protected by
package integrity/provenance. Workflow package dependencies can lock required
node-addon packages, and temporary direct workflows can run installed executable
add-ons only with an explicit development/test direct-run grant.

The acceptance fixture is the sibling local registry package
`<rielflow-packages-repo>/packages/greeting-node-addon`.
It must remain a `node-addon` package that installs `examples/greeting-shell@1`
and executes its packaged `greeting.bash` through a temporary workflow smoke.

### Scope

**Included**:

- Use the current uncommitted rielflow and rielflow-packages changes as the
  implementation baseline and finish gaps without reverting unrelated changes.
- Extend package manifest types, normalization, validation, search metadata, and
  checkout records for executable node-addon metadata.
- Install and preserve node-addon dependency lock metadata for both workflow
  package dependencies and node-addon package dependencies.
- Resolve installed executable local add-ons from project/user scopes to their
  packaged artifact roots and feed those paths to native command/container
  payloads only after digest/provenance checks.
- Add direct-run grant handling for temporary workflow validation and execution,
  marked as `directExecutableAddonGrant`. The concrete CLI surface for local
  temporary workflow runs is `--direct-executable-addon-grant <value>`, where
  `<value>` follows the existing `--variables` convention: inline JSON object or
  array, `@path/to/grant.json`, or an existing file path. The parsed value feeds
  `ExecutableAddonValidationOptions.directExecutableAddonGrants`.
- Make `greeting-node-addon` install from
  `<rielflow-packages-repo>` and run
  `examples/greeting-shell@1` successfully in a temp project.

**Excluded**:

- Credential-backed SDK smoke tests.
- Interactive permission prompt UX.
- npm/Bun package lifecycle hooks or registry-controlled install scripts.
- Semver/range dependency solving for executable add-ons.
- Treating `greeting-node-addon` as a workflow package.

## Codex And Review References

- Workflow ID: `codex-design-and-implement-review-loop`
- Workflow mode: `issue-resolution`
- Issue source: `runtimeVariables.workflowInput`
- Issue title: `Implement executable node-addon package support and make greeting executable add-on work`
- Accepted design review: `step3-design-review`, `exec-000008`, decision
  `accepted`
- Prior design review findings addressed by Step 2:
  - Manifest examples include required executable add-on `contentDigest`.
  - Temporary/direct workflows require an explicit direct-run grant tied to
    installed checkout provenance, verified package integrity, exact add-on
    digest, and capability grants.
- Codex-agent references:
  - `<rielflow-repo>`: current uncommitted implementation
    baseline.
  - `<rielflow-packages-repo>/packages/greeting-node-addon`:
    target executable node-addon package.
  - `<codex-agent-reference>`: behavioral process-command
    reference only; do not copy code or move Rielflow behavior into adapter
    boundaries.

## Modules

### 1. Executable Manifest And Dependency Types

#### `packages/rielflow/src/workflow/packages/types.ts`
#### `packages/rielflow-addons/src/local-node-addons.ts`

**Status**: COMPLETED

```typescript
export type WorkflowPackageAddonExecutionKind =
  | "declarative"
  | "container"
  | "local-command";

export type WorkflowAddonCapabilityName =
  | "network.egress"
  | "filesystem.read"
  | "filesystem.write"
  | "process.spawn"
  | "container.build"
  | "container.run"
  | "device.gpu"
  | "env.read";

export interface WorkflowAddonCapability {
  readonly name: WorkflowAddonCapabilityName;
  readonly required?: boolean;
  readonly scope?: string;
  readonly reason?: string;
  readonly defaultPolicy?: "deny" | "prompt" | "allow";
}

export interface WorkflowPackageAddonExecutionDescriptor {
  readonly kind: WorkflowPackageAddonExecutionKind;
  readonly entrypoint?: string;
  readonly containerfilePath?: string;
  readonly runtimeHints?: readonly string[];
}

export interface WorkflowPackageManifestAddonEntry {
  readonly name: string;
  readonly version: string;
  readonly sourcePath: string;
  readonly execution?: WorkflowPackageAddonExecutionDescriptor;
  readonly capabilities?: readonly WorkflowAddonCapability[];
  readonly contentDigest?: string;
}

export interface WorkflowPackageManifestAddonDependencyLock {
  readonly name: string;
  readonly version: string;
  readonly contentDigest: string;
  readonly capabilityGrant: Readonly<
    Partial<Record<WorkflowAddonCapabilityName, WorkflowPackageAddonCapabilityGrant>>
  >;
  readonly optional?: boolean;
}
```

**Checklist**:

- [ ] Reconcile current uncommitted type additions with the accepted design.
- [ ] Keep declarative node-addon manifests backward compatible.
- [ ] Use supported capability names consistently across package and local
      add-on types.
- [ ] Preserve readonly exported types through existing package boundaries.

### 2. Manifest Normalization And Executable Artifact Validation

#### `packages/rielflow/src/workflow/packages/manifest.ts`
#### `packages/rielflow/src/workflow/packages/node-addon-install.ts`
#### `packages/rielflow/src/workflow/packages/checkout-node-addon.ts`
#### `packages/rielflow-addons/src/local-node-addons.ts`

**Status**: COMPLETED

```typescript
export function validateExecutableAddonManifestAgreement(input: {
  readonly packageEntry: WorkflowPackageManifestAddonEntry;
  readonly localManifest: LocalNodeAddonManifest;
  readonly sourceDirectory: string;
}): Result<void, WorkflowPackageFailure>;

export function computeAddonContentDigest(input: {
  readonly addonDirectory: string;
  readonly digestAlgorithm: "sha256";
}): Promise<Result<string, WorkflowPackageFailure>>;
```

**Checklist**:

- [x] Reject unknown `execution.kind`, unknown capability names, unsafe
      `entrypoint` and unsafe `containerfilePath`.
- [x] Require non-empty `capabilities[]`, `contentDigest`, and sha256 package
      `integrity` for executable add-ons.
- [x] Reject executable files not reachable from declared execution metadata.
- [x] Require package manifest and `addon.json` agreement on identity,
      execution kind, capabilities, and authored content digest.
- [x] Recompute add-on directory digest during install and fail on mismatch.
- [x] Keep `rielflow/*` package-provided add-ons rejected.

### 3. Dependency Installation And Checkout Provenance

#### `packages/rielflow/src/workflow/packages/dependencies.ts`
#### `packages/rielflow/src/workflow/packages/checkout.ts`
#### `packages/rielflow/src/workflow/packages/checkout-node-addon.ts`
#### `packages/rielflow/src/workflow/packages/search.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowPackageAddonDependencyInstallResult {
  readonly packageId: string;
  readonly packageKind: "node-addon";
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly installId: string;
  readonly addons: readonly WorkflowPackageManifestAddonDependencyLock[];
  readonly checkoutRecordPath: string;
}

export interface WorkflowPackageExecutableAddonRecord {
  readonly addonName: string;
  readonly addonVersion: string;
  readonly executionKind: WorkflowPackageAddonExecutionKind;
  readonly capabilities: readonly WorkflowAddonCapability[];
  readonly contentDigest: string;
  readonly contentDigestAlgorithm: "sha256";
  readonly permissionGrant?: Readonly<Record<string, WorkflowPackageAddonCapabilityGrant>>;
}
```

**Checklist**:

- [x] Normalize object dependencies with `kind: "workflow" | "node-addon"`.
- [x] Install workflow dependencies and node-addon dependencies before caller
      workflow validation.
- [x] Preserve normalized dependency locks and add-on metadata in checkout
      records.
- [x] Include package kind in dependency graph identities and cycle checks.
- [x] Reuse rollback behavior when caller package validation fails.
- [x] Index execution kind, runtime hints, and capabilities for package search.

### 4. Installed Executable Add-on Resolution And Direct Grants

#### `packages/rielflow-addons/src/local-node-addons.ts`
#### `packages/rielflow/src/workflow/addon-source-summary.ts`
#### `packages/rielflow/src/workflow/packages/install-validation.ts`
#### `packages/rielflow/src/workflow/load.ts`
#### `packages/rielflow/src/workflow/validate.ts`
#### `packages/rielflow/src/cli/argument-parser.ts`
#### `packages/rielflow/src/cli/workflow-run-command.ts`
#### `packages/rielflow/src/cli/storage-and-options.ts`
#### `packages/rielflow/src/lib-workflow-run-options.ts`

**Status**: COMPLETED

```typescript
export interface ExecutableAddonValidationOptions {
  readonly allowUnpackagedExecutableAddons?: boolean;
  readonly directExecutableAddonGrants?: readonly WorkflowPackageManifestDependencyEntry[];
  readonly addonDependencyLocks?: readonly WorkflowPackageManifestAddonDependencyLock[];
}

export interface WorkflowRunDirectExecutableAddonGrantOptions {
  readonly directExecutableAddonGrants?: readonly WorkflowPackageManifestDependencyEntry[];
}

export interface WorkflowAddonDependencyLockSummary {
  readonly nodeId: string;
  readonly sourceKind: "packageDependencyLock" | "directExecutableAddonGrant";
  readonly packageId: string;
  readonly installId: string;
  readonly addonName: string;
  readonly addonVersion: string;
  readonly contentDigest: string;
  readonly capabilities: readonly WorkflowAddonCapability[];
  readonly grantedCapabilities: Readonly<Record<string, WorkflowPackageAddonCapabilityGrant>>;
}
```

**Checklist**:

- [x] Resolve executable add-ons only from installed project/user provenance or
      explicit development addon roots.
- [x] Require workflow package locks for production workflow package
      validation.
- [x] Require direct-run grants for temporary workflows; mark summaries as
      `directExecutableAddonGrant`.
- [x] Add local `workflow run --direct-executable-addon-grant <value>` and
      reject it over GraphQL/endpoint transport. `<value>` accepts inline JSON,
      `@file`, or bare file path using the same parsing convention as
      `--variables`.
- [x] Normalize the flag value into
      `ExecutableAddonValidationOptions.directExecutableAddonGrants`; accept a
      single grant object or an array of grant objects.
- [x] Reject unpackaged executable add-ons unless an explicit development/test
      option allows them.
- [x] Reject `addon.env` use unless `envSchema` and `env.read` grants match.
- [x] Include dependency/direct-grant summaries in validation and inspect JSON.

### 5. Native Command Runtime Path

#### `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts`

**Status**: COMPLETED

```typescript
export interface ResolvedExecutableAddonCommand {
  readonly addonDirectory: string;
  readonly entrypoint: string;
  readonly dispatch: "bash" | "posix-shell" | "host-executable";
}
```

**Checklist**:

- [ ] Use the resolved installed add-on directory as command working directory
      and template root for package-owned command payloads.
- [ ] Dispatch `.bash` through Bash and `.sh` through POSIX shell.
- [ ] Keep host executable mode/shebang checks for other executable files.
- [ ] Prevent workflow-authored relative paths from escaping the installed
      add-on directory.
- [ ] Ensure runtime receives only paths that passed digest/provenance checks.

### 6. Greeting Node-addon Registry Package

#### `<rielflow-packages-repo>/packages/greeting-node-addon/rielflow-package.json`
#### `<rielflow-packages-repo>/packages/greeting-node-addon/addons/examples/greeting-shell/1/addon.json`
#### `<rielflow-packages-repo>/packages/greeting-node-addon/addons/examples/greeting-shell/1/greeting.bash`

**Status**: COMPLETED

```typescript
interface GreetingNodeAddonFixture {
  readonly packageId: "greeting-node-addon";
  readonly addonName: "examples/greeting-shell";
  readonly addonVersion: "1";
  readonly executionKind: "local-command";
  readonly entrypoint: "greeting.bash";
  readonly requiredCapability: "process.spawn";
  readonly contentDigest: `sha256:${string}`;
}
```

**Checklist**:

- [ ] Keep `greeting-node-addon` as `kind: "node-addon"` with no workflow
      bundle.
- [ ] Declare matching execution, capability, and digest metadata in
      `rielflow-package.json` and `addon.json`.
- [ ] Include `greeting.bash` inside the package and ensure it is the declared
      entrypoint.
- [ ] Preserve lock/digest metadata expected by local registry checkout.
- [ ] Avoid unrelated rielflow-packages README or registry churn unless required
      for fixture correctness.

### 7. Focused Tests And Live Local Smoke

#### `packages/rielflow/src/workflow/packages/packages.test.ts`
#### `packages/rielflow/src/workflow/packages/*.test.ts`
#### `packages/rielflow-addons/src/**/*.test.ts`
#### `packages/rielflow/src/cli.test.ts`
#### `design-docs/specs/command.md`
#### `design-docs/specs/architecture.md`
#### Temporary project under `mktemp -d`

**Status**: COMPLETED

```typescript
interface ExecutableAddonVerificationCase {
  readonly packageId: string;
  readonly addonName: string;
  readonly addonVersion: string;
  readonly expectedDigest: string;
  readonly expectedRejection:
    | "missing-grant"
    | "changed-digest"
    | "unsafe-entrypoint"
    | "missing-integrity"
    | "unrequested-grant";
}
```

**Checklist**:

- [ ] Add passing package tests for executable metadata normalization,
      dependency locks, install provenance, and greeting add-on checkout.
- [ ] Add rejection tests for missing grant, changed digest, unsafe entrypoint,
      missing integrity, executable file without metadata, and unrequested
      capability grant.
- [ ] Add command runtime tests proving `.bash` dispatch uses the installed
      add-on directory.
- [ ] Add CLI parser tests for `--direct-executable-addon-grant` inline JSON,
      `@file`, bare file path, invalid JSON, missing value, and endpoint
      rejection.
- [ ] Run a temp-project local registry smoke installing `greeting-node-addon`
      and running `examples/greeting-shell@1` with
      `--direct-executable-addon-grant @<temp-grant.json>`.
- [ ] Update `design-docs/specs/command.md` with the
      `--direct-executable-addon-grant` flag, value format, local-only scope,
      endpoint rejection, and smoke example. Update architecture docs only if
      implementation changes validation/load data flow beyond the accepted
      design.
- [ ] Update this plan's progress log as implementation tasks complete.
- [ ] Run no credential-backed SDK smoke tests.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Executable manifest and dependency types | `packages/rielflow/src/workflow/packages/types.ts` | COMPLETED | Package tests |
| Local add-on manifest extension | `packages/rielflow-addons/src/local-node-addons.ts` | COMPLETED | Add-on tests |
| Manifest normalization and artifact validation | `packages/rielflow/src/workflow/packages/manifest.ts`, `node-addon-install.ts`, `checkout-node-addon.ts` | COMPLETED | Package tests |
| Dependency install and checkout provenance | `packages/rielflow/src/workflow/packages/dependencies.ts`, `checkout.ts`, `search.ts` | COMPLETED | Package tests |
| Installed executable resolution and direct grants | `packages/rielflow/src/workflow/load.ts`, `validate.ts`, `install-validation.ts`, `packages/rielflow/src/cli/argument-parser.ts`, `packages/rielflow/src/cli/workflow-run-command.ts` | COMPLETED | Workflow/package/CLI tests |
| Native command runtime path | `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts` | COMPLETED | Add-on/runtime tests |
| Greeting node-addon package | `<rielflow-packages-repo>/packages/greeting-node-addon` | COMPLETED | Live local smoke |
| Documentation and progress log | `design-docs/specs/command.md`, `design-docs/specs/architecture.md`, `impl-plans/active/executable-node-addon-manifest-dependencies.md` | COMPLETED | Diff check |

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| Manifest validation | Executable manifest and local add-on types | COMPLETED |
| Dependency lock normalization | Executable manifest and capability grant types | COMPLETED |
| Dependency checkout | Manifest validation and dependency lock normalization | COMPLETED |
| Direct grant validation | Checkout provenance and installed add-on resolution | COMPLETED |
| Native command runtime | Installed add-on resolution and digest validation | COMPLETED |
| Greeting smoke | Package install, direct grant validation, and native runtime | COMPLETED |

## Parallelizable Tasks

Tasks may be parallelized only when their write scopes remain disjoint:

- `types-and-manifest-validation`: package manager types and manifest
  normalization in `packages/rielflow/src/workflow/packages/*`.
- `local-addon-runtime-resolution`: local add-on resolver and native executor
  files under `packages/rielflow-addons/src/*`.
- `greeting-registry-package`: sibling registry files under
  `<rielflow-packages-repo>/packages/greeting-node-addon/*`.

Do not parallelize dependency checkout, direct-run grant validation, or live
smoke wiring until the type/manifest and resolver surfaces have joined.

## Completion Criteria

- [x] Node-addon manifests accept and validate `execution`, `capabilities`,
      `contentDigest`, `integrity`, and dependency lock metadata.
- [x] Executable add-on files are rejected unless reachable from declared
      execution metadata and verified by content digest and package integrity.
- [x] Workflow package dependencies and node-addon package dependencies install
      required node-addon locks and preserve lock metadata in checkout records.
- [x] Installed executable add-ons resolve from project/user scope to packaged
      artifact roots and cannot be shadowed by workflow-local paths.
- [x] Temporary workflows require explicit `directExecutableAddonGrant` metadata
      before running installed executable add-ons, supplied to local
      `workflow run` with `--direct-executable-addon-grant <value>`.
- [x] `greeting-node-addon` installs as a node-addon package and runs
      `examples/greeting-shell@1` through a temp-project workflow smoke.
- [x] Focused package tests, typecheck, lint, diff checks, and local smoke pass.
- [x] User-visible command, inspect, or install output changes are reflected in
      design/command docs or explicitly noted as not needed.
- [x] The implementation progress log records completed work, blockers, and
      verification results before handoff.
- [ ] No credential-backed live SDK smoke tests are run and no push is
      performed.

## Verification

Run during and after implementation:

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun run typecheck
bun run lint
git diff --check
```

Run the required live local smoke in an isolated temp project:

```bash
tmp_project="$(mktemp -d)"
grant_file="$tmp_project/direct-executable-addon-grant.json"
bun run packages/rielflow/src/bin.ts package registry add local <rielflow-packages-repo> --project-root "$tmp_project"
bun run packages/rielflow/src/bin.ts package install greeting-node-addon --project-root "$tmp_project" --output json
bun run packages/rielflow/src/bin.ts workflow run --workflow-json-file <temp-greeting-workflow.json> --project-root "$tmp_project" --direct-executable-addon-grant @"$grant_file" --output json
```

The grant file must contain either the single grant object below or an array of
such objects. The implementation smoke must fill `contentDigest` from the
installed checkout record for `greeting-node-addon` / `examples/greeting-shell@1`:

```json
{
  "packageId": "greeting-node-addon",
  "addons": [
    {
      "name": "examples/greeting-shell",
      "version": "1",
      "contentDigest": "sha256:<installed-addon-content-digest>",
      "capabilityGrant": {
        "process.spawn": {
          "allowed": true,
          "scope": "addon.entrypoint"
        }
      }
    }
  ]
}
```

Do not run credential-backed SDK smokes.

Plan verification for this Step 4 worker:

```bash
test -f design-docs/specs/design-executable-node-addon-manifest-dependencies.md
test -f impl-plans/active/executable-node-addon-manifest-dependencies.md
git diff --check -- design-docs/specs/design-executable-node-addon-manifest-dependencies.md impl-plans/active/executable-node-addon-manifest-dependencies.md
rg -n "directExecutableAddonGrant|greeting-node-addon|contentDigest|execution|capabilities|process.spawn" impl-plans/active/executable-node-addon-manifest-dependencies.md
rg -n -- "--direct-executable-addon-grant|directExecutableAddonGrants|temp-grant" impl-plans/active/executable-node-addon-manifest-dependencies.md
```

## Review Decisions

- Step 3 design review `exec-000008`: accepted; no high or mid findings remain.
- Step 2 design revision addressed two prior mid findings by adding required
  `contentDigest` examples and direct-run grant policy for temporary workflows.
- Current Step 4 plan revision supersedes the earlier design-plan-only plan and
  is ready for issue-resolution implementation.

## Risks

- Direct-run grants could accidentally become a production package bypass if
  not kept distinct from dependency locks in validation and inspect output.
- Digest/integrity checks must run before executable path resolution reaches the
  native command executor.
- Dependency rollback and lock preservation can regress existing workflow
  package installs if package kind is not included consistently in graph
  identity.
- The live smoke depends on temp-project isolation and the sibling local
  registry; implementation must not rely on persistent project/user add-on
  roots.

## Progress Log

### Session: 2026-06-04 17:05

**Tasks Completed**: Revised active implementation plan from the accepted
Step 3 design and current issue-resolution scope. Added direct-run grant,
greeting-node-addon, native Bash dispatch, dependency lock preservation, and
live local smoke tasks.
**Tasks In Progress**: Implementation not started by this planning worker.
**Blockers**: None.
**Notes**: Later implementation should continue from the dirty uncommitted
baseline and avoid unrelated `.rielflow` managed/provenance or
source-security-package changes unless required.

### Session: 2026-06-04 17:14

**Tasks Completed**: Self-review added explicit documentation and progress-log
tasks for any user-visible direct grant, inspect, install, or command surface
changes.
**Tasks In Progress**: None for the planning worker.
**Blockers**: None.
**Notes**: The accepted design did not require design revision; this was a
plan-only completeness improvement before independent implementation-plan
review.

### Session: 2026-06-04 17:27

**Tasks Completed**: Addressed Step 5 mid finding by choosing the concrete
direct-run grant input surface: local
`workflow run --direct-executable-addon-grant <value>`, parsed from inline JSON,
`@file`, or bare file path into
`ExecutableAddonValidationOptions.directExecutableAddonGrants`. Updated the
smoke command, grant JSON shape, CLI parser/test tasks, and command
documentation task.
**Tasks In Progress**: None for the planning worker.
**Blockers**: None.
**Notes**: The Step 5 review did not require design revision.

### Session: 2026-06-04 17:33

**Tasks Completed**: Completed executable node-addon metadata normalization,
content-digest and integrity enforcement, node-addon dependency checkout,
installed executable add-on provenance checks, local
`--direct-executable-addon-grant` parsing and endpoint rejection, native
`.bash` dispatch from package-owned add-on roots, focused tests, docs, and the
`greeting-node-addon` temp-project smoke.
**Tasks In Progress**: None.
**Blockers**: Full `bun run test` still has unrelated repository/environment
failures in package-boundary declaration expectations and Cursor SDK live smoke
dependency resolution; focused verification, lint, typecheck, and local smoke
passed.
**Notes**: The full suite unexpectedly ran credential-backed SDK live smoke
tests because SDK credentials were present in the environment; no additional
credential-backed smoke was run after that discovery, and no push was
performed.

### Session: 2026-06-04 17:58

**Tasks Completed**: Addressed Step 6 self-review mid finding by threading
package dependency locks through executable add-on validation. Workflow package
checkout now validates packaged workflows with add-on dependency locks,
preserves dependency/dependency-graph metadata in checkout records and
provenance, and catalog loading rehydrates installed workflow package add-on
locks so production package workflows can run executable add-ons without a
local direct-run grant. Added focused package coverage for an installed
workflow package using an executable node-addon dependency lock.
**Tasks In Progress**: None.
**Blockers**: Full `bun run test` remains deferred because the prior full-suite
attempt hit unrelated package-boundary failures and credential-backed Cursor
SDK live-smoke dependency resolution in the current environment.
**Notes**: Re-ran focused package and CLI tests, typecheck, lint, formatting,
and diff checks after the revision.

### Session: 2026-06-04 18:20

**Tasks Completed**: Addressed Step 7 high and mid findings. Direct add-on
roots no longer bypass executable add-on validation unless the explicit
development/test `allowUnpackagedExecutableAddons` option is set. Executable
node-addon package manifest entries now require package-authored
`contentDigest`. Node-addon checkout records now persist dependency and
dependencyGraph metadata. Split package add-on lock helpers into
`packages/rielflow/src/workflow/packages/package-addon-locks.ts` so
`checkout.ts` remains under the source line limit.
**Tasks In Progress**: None.
**Blockers**: Full `bun run test` remains deferred for the previously reported
unrelated package-boundary and credential-backed Cursor SDK environment
failures.
**Notes**: Added focused regression coverage for direct add-on root rejection,
required executable add-on `contentDigest`, and node-addon checkout-record
dependency preservation.

### Session: 2026-06-04 18:44

**Tasks Completed**: Addressed the second Step 7 review findings. Local add-on
validation now treats command/container resolution templates as executable even
when `execution` metadata is missing, rejects missing or mismatched execution
metadata before payload resolution, and recomputes installed add-on
`contentDigest` at workflow load before matching dependency locks or direct
grants. Added tamper and missing-execution regression coverage, and split
executable validation helpers into
`packages/rielflow-addons/src/local-node-addon-executable-validation.ts` to keep
`local-node-addons.ts` below the source line limit.
**Tasks In Progress**: None.
**Blockers**: Full `bun run test` remains deferred for the previously reported
unrelated package-boundary and credential-backed Cursor SDK environment
failures.
**Notes**: Re-ran focused package tests, CLI tests, typecheck, lint, and diff
checks after the revision.

### Session: 2026-06-04 19:13

**Tasks Completed**: Addressed the third Step 7 high and mid findings. Local
command executable add-ons now require `command.scriptPath` to match
`execution.entrypoint` and always overwrite package-authored
`command.workingDirectory` with the installed add-on directory. Container
executable add-ons now validate with workflow-relative build placeholders while
threading runtime-owned installed add-on build paths to the native container
executor. Added focused regressions for command working-directory redirection
and package-owned container `Containerfile` resolution.
**Tasks In Progress**: None.
**Blockers**: Full `bun run test` remains deferred for the previously reported
unrelated package-boundary and credential-backed Cursor SDK environment
failures.
**Notes**: Re-ran focused package tests, CLI tests, `bun run typecheck`,
`bun run lint`, `git diff --check`, and source line counts after the revision.

### Session: 2026-06-04 19:35

**Tasks Completed**: Addressed Step 7 exec-000028 high finding. Normal native
command nodes now keep `command.scriptPath` workflow-directory-relative even
when `command.workingDirectory` is absolute. Package-owned executable add-ons
use runtime-owned `command.runtimeScriptPath`, enabled only for resolved add-on
payload normalization, to execute verified installed entrypoints without
changing authored workflow command semantics. Added native executor regressions
for `/bin` + `sh` bypass prevention and runtime-owned add-on script execution,
and extended package coverage to assert the installed runtime script path.
**Tasks In Progress**: None.
**Blockers**: Full `bun run test` remains deferred for the previously reported
unrelated package-boundary and credential-backed Cursor SDK environment
failures.
**Notes**: Re-ran native executor command tests, focused package tests, CLI
tests, `bun run typecheck`, `bun run lint`, `git diff --check`, source line
counts, and the isolated greeting-node-addon temporary workflow smoke.

### Session: 2026-06-04 19:53

**Tasks Completed**: Addressed Step 7 exec-000031 mid findings. Executable
add-ons using `addon.env` now require the matched package dependency lock or
direct executable grant to explicitly allow `env.read`. Successful executable
add-on authorization now emits validation details that distinguish
`packageDependencyLock` from `directExecutableAddonGrant`, including package
identity, install/provenance identity, contentDigest, declared capabilities,
and granted capabilities. Inspection summaries now include node validation
results so inspect JSON surfaces the same authorization evidence. Split
authorization helpers into
`packages/rielflow-addons/src/local-node-addon-authorization.ts` to keep source
files under the line limit.
**Tasks In Progress**: None.
**Blockers**: Full `bun run test` remains deferred for the previously reported
unrelated package-boundary and credential-backed Cursor SDK environment
failures.
**Notes**: Re-ran focused package tests, native executor command tests, CLI
tests, `bun run typecheck`, `bun run lint`, `git diff --check`, source line
counts, and the isolated greeting-node-addon temporary workflow smoke.

### Session: 2026-06-04 20:05

**Tasks Completed**: Addressed Step 6 self-review exec-000033 mid finding.
Executable add-ons using `addon.env` now require the matched `env.read` grant
to be scoped to `addon.env`, and package coverage now rejects an allowed
`env.read` grant with the wrong scope.
**Tasks In Progress**: None.
**Blockers**: Full `bun run test` remains deferred for the previously reported
unrelated package-boundary and credential-backed Cursor SDK environment
failures.
**Notes**: Re-ran focused package tests, `bun run typecheck`, `bun run lint`,
and `git diff --check` after the revision.

### Session: 2026-06-04 20:24

**Tasks Completed**: Addressed Step 7 exec-000036 findings. Executable add-on
capability grants now treat omitted `required` as required by default during
authorization. Authorization summaries now include resolved add-on source
scope, optional scope root, and normalized declared capability objects instead
of only capability names. Added regression coverage for omitted `required` on
`process.spawn` and `filesystem.read`, and extended summary assertions for
source scope and declared capability details.
**Tasks In Progress**: None.
**Blockers**: Full `bun run test` remains deferred for the previously reported
unrelated package-boundary and credential-backed Cursor SDK environment
failures.
**Notes**: Re-ran focused package tests, `bun run typecheck`, `bun run lint`,
`git diff --check`, and source line counts after the revision.
