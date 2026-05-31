# Workflow Package Checkout And Search

Design for registry-aware workflow package lookup and installation while
preserving direct GitHub workflow directory checkout.

## Overview

The package install/search feature keeps direct `rielflow workflow checkout
<github-url>` behavior separate from package identifiers resolved through Git
repository registries. A registry is a GitHub repository containing workflow
package metadata and package workflow directories. The default registry is
`https://github.com/tacogips/rielflow-packages`, with the developer-local path
`/Users/taco/gits/tacogips/rielflow-packages` used for local development and
post-implementation migration of current repository `.rielflow` content.

This feature owns CLI behavior for package install and metadata search. It
depends on the registry configuration/publish design for how registries are
registered and updated, and on the package metadata/cache design for index file
shape and checksum calculation. The current command surface exposes persistent
package lifecycle behavior under top-level `package ...` commands; workflow
checkout remains direct-URL only.

## Feature Contract

- Feature id: `package-checkout-search`
- Feature title: Package Checkout And Search
- Workflow mode: `issue-resolution`
- Issue reference: `workflowInput: Implement workflow package registry and
  package commands`
- Implementation plan target:
  `impl-plans/active/workflow-package-checkout-search.md`
- Design document path:
  `design-docs/specs/design-workflow-package-checkout-search.md`
- Fanout group: `feature-local-planning`
- Fanout feature id: `package-checkout-search`
- Branch input source: `runtimeVariables.fanout.item` and
  `runtimeVariables.workflowCall.input`
- Primary source touchpoints:
  - `packages/rielflow/src/cli/argument-parser.ts`
  - `packages/rielflow/src/cli/input-output-helpers.ts`
  - `packages/rielflow/src/cli/workflow-package-command-handler.ts`
  - `packages/rielflow/src/workflow/packages/search.ts`
  - `packages/rielflow/src/workflow/packages/checkout.ts`
  - `packages/rielflow/src/workflow/packages/cache.ts`
  - `packages/rielflow/src/workflow/packages/types.ts`
  - `packages/rielflow/src/workflow/checkout/`
  - `packages/rielflow/src/workflow/load.ts`
  - `packages/rielflow/src/workflow/validate/`

## Branch Inputs And Review State

This feature-local design is derived from the workflow call input for
`package-checkout-search`. No upstream mailbox payloads or review feedback were
attached to this execution, so the document records the feature-local design
contract and does not address reviewer-requested revisions.

The scoped writable design document path for this branch is
`design-docs/specs/design-workflow-package-checkout-search.md`. Adjacent
registry, command, publish, checkout-install, and migration documents remain
integration references rather than edit targets for this node.

## Checkout Security Issue Update

This document also covers the issue-resolution request from
`runtimeVariables.workflowInput`: "Add optional sandbox pre-install checks for
workflow package checkout." The security update is scoped to package install
and preserves the existing registry, metadata, md5 checksum, sha256 integrity,
and signature behavior described by the package registry and integrity designs.

The update uses the current branch/worktree as the implementation target and
records no remote issue URL or issue number because the workflow input did not
include one. The default Codex-reference repository path `../../codex-agent`
was checked during issue intake, but no usable local reference root was
available, so this design treats `codex-agent` as an execution backend and
workflow reference rather than a source-code behavior to copy.

## Goals

- Add registry-aware package install without removing direct GitHub directory
  checkout.
- Add an optional checkout-time pre-install security check that can reject a
  suspicious package before destination writes or checkout provenance writes.
- Default installation to project scope, with `--user-scope` continuing to
  install under `~/.rielflow`.
- Search package metadata before checkout so users can discover workflows by
  name, title, description, tags, backend, and package source.
- Keep package lookup deterministic by resolving package metadata to a concrete
  registry URL, branch/ref, workflow directory path, and checksum.
- Preserve existing md5 checksum, sha256 integrity, and signature validation
  semantics while adding content-risk scanning as a separate gate.
- Allow sqlite-backed search/cache as an implementation option, while keeping a
  JSON cache fallback acceptable for small registries and tests.

## Non-Goals

- Implementing registry publish, push permission checks, or PR creation.
- Owning registry configuration persistence beyond consuming registered
  registry URL, alias/id, branch, and local path records.
- Migrating current repository `.rielflow` content into the default registry.
- Replacing existing direct GitHub directory checkout behavior.
- Treating md5 checksums as a security boundary.
- Guaranteeing that heuristic prompt-injection scanning proves package safety.
- Running untrusted package content with host network or credential access.

## Command Surface

### Install

Existing direct GitHub checkout command:

```bash
rielflow workflow checkout https://github.com/<owner>/<repo>/tree/<ref>/<workflow-dir>
```

Registry-aware form:

```bash
rielflow package install <package-id> [--registry <registry-url-or-name>] [--branch <branch>] [--user-scope] [--workflow-definition-dir <path>] [--overwrite] [--yes] [--pre-install-check] [--output json|text]
```

`rielflow package install <package-id>` is the user-facing persistent package
installation command. `rielflow workflow checkout <package-id>` and
`rielflow workflow package checkout <package-id>` are unsupported compatibility
aliases.

Behavior:

- If the target parses as an HTTPS GitHub directory URL, keep the current direct
  `workflow checkout` path and destination rules.
- Package install treats the target as a package identifier and resolves it
  through the configured package registries.
- `--registry` narrows package resolution to one registered registry URL or
  local registry alias.
- `--branch` selects the registry branch/ref to resolve from; default comes from
  registry configuration, then the registry default branch.
- Project scope remains the default destination. `--user-scope` installs to the
  user scope root.
- `--workflow-definition-dir` overrides the workflow destination root for
  package install while provenance stays under the resolved user root.
- `--endpoint` remains unsupported because checkout is a local filesystem
  mutation.
- `--pre-install-check` enables the built-in static scanner and rejects packages
  with blocking findings before install.
- `--pre-install-check-mode warn|reject` controls static scanner enforcement.
  The default mode is `reject` when `--pre-install-check` is present.
- `--pre-install-check-container docker|podman|auto` adds a container-backed
  check after static scanning. `auto` prefers Docker, then Podman, and reports
  unavailable runtimes as check failures only when container mode was requested.
- `--no-pre-install-check` is accepted only to override environment or config
  defaults if later configuration enables checks by default.

Expected text output:

```text
installed package: <package-id>
workflow: <workflow-name>
scope: project|user
destination: <path>
registry: <registry-url>
checksum: md5:<hex>
```

Expected JSON output fields:

- `packageId`
- `workflowName`
- `scope`
- `destinationDirectory`
- `registryUrl`
- `registryRef`
- `sourceDirectory`
- `checksum`
- `metadataPath`
- `checkoutRecordPath`
- `preInstallCheck`, when a check was requested, including `enabled`, `mode`,
  `status`, `findings`, and optional `containerRuntime`

### Search

New command:

```bash
rielflow package search [query] [--registry <registry-url-or-name>] [--tag <tag>] [--backend <backend>] [--limit <n>] [--refresh|--no-cache] [--output table|json|text]
```

`rielflow package search` is the canonical discovery command from the package
command design. It remains a package metadata search and must not be confused
with workflow runtime session listing.

Behavior:

- Search uses package metadata, not workflow runtime session state.
- Empty query lists indexed packages with the normal limit.
- `--refresh` updates registry metadata/cache before searching.
- `--no-cache`, when accepted by the implementation route, is equivalent to a
  forced refresh for search resolution and must be reflected in JSON cache
  metadata.
- `--registry`, `--tag`, and `--backend` are filters applied before ranking.
- `--output table` is valid for search in addition to existing workflow
  list/status table support.
- JSON output returns stable package records and match metadata so tests and
  automation do not depend on formatted text.

Expected table columns:

```text
PACKAGE  WORKFLOW  REGISTRY  TAGS  SUMMARY
```

Expected JSON output fields:

- `query`
- `registryFilters`
- `packages`
- `cache`

## Resolver Contract

Package install and package search rendering should share a package resolver so
ambiguous results fail consistently. Resolver input:

- package install target or search query
- optional registry id, alias, or URL
- optional branch/ref
- cache backend and refresh/no-cache mode
- project root, user root, cwd, environment, and current time

Resolver output for a single package selection:

- `packageId`
- optional compatibility alias `packageName` with the same value
- `workflowName`
- `registryId`
- `registryUrl`
- `registryRef`
- `sourceDirectory`
- `sourcePath`
- `metadataPath`
- `checksum`
- `checksumAlgorithm`
- `cache`

The resolver must never choose an arbitrary package when package ids collide
across registries. It either uses an explicit registry/ref filter or returns an
ambiguous-package usage error with candidate package ids, registries, and refs.

## Package Identifier Resolution

Package identifiers should be normalized as lowercase slugs with `/`, `.`, `_`,
and `-` allowed only where they are safe for registry lookup. The package
install command must reject identifiers that would escape cache or destination
roots.
In the first release, the public package identifier maps to the package manifest
`name` field and to search index `packageName`; command JSON must expose this
identity as `packageId`. Internal service records may continue to use
`packageName`, but CLI rendering should translate it to `packageId`. If a
compatibility alias is needed, `packageName` may be included as an optional
alias with the same value, never as an alternative required by automation.

Resolution order:

1. Exact package id match in selected registry or registries.
2. Exact workflow name match when package id is absent and only one package
   matches.
3. Ambiguous or missing matches return CLI usage errors with candidate package
   ids.

Registry records must resolve to a workflow directory that can be validated by
the existing workflow loader before installation. Failed validation prevents
destination writes, matching the current staged direct checkout behavior.

## Pre-Install Security Checks

Package install has two independent safety gates:

1. Existing provenance and integrity checks validate that the selected package
   content matches declared registry metadata, sha256 integrity, and trusted
   signatures where configured.
2. The optional pre-install security check scans the staged package content for
   suspicious workflow behavior before the staged bundle is copied to project or
   user scope.

The pre-install check is opt-in for this issue so existing package install,
registry metadata, md5 checksum, sha256 integrity, and signature behavior remain
compatible. The check may later become configurable by registry policy, but the
first implementation must expose explicit CLI control and must not make existing
checkout commands fail because Docker or Podman is absent.

### Static Scanner

The built-in static scanner runs locally over the resolved staged package
directory. It must not execute package scripts, prompts, hooks, or workflow
nodes. The scanner reads only package files selected by the package resolver and
workflow loader. Findings include:

- finding id
- severity: `info`, `low`, `medium`, `high`, or `critical`
- package-relative file path
- evidence summary with no secret value expansion
- scanner rule name
- suggested remediation text

Blocking findings are `high` and `critical` by default. `medium` findings are
reported but do not block unless a later registry policy makes the threshold
stricter. Static scanner rules should cover practical prompt-injection and
malicious workflow-content patterns, including:

- prompts instructing agents to ignore system, developer, workflow, or
  repository instructions
- prompts instructing agents to exfiltrate credentials, tokens, SSH keys,
  environment variables, or hidden files
- workflow-local scripts or command templates that read common credential paths
  or upload data to remote endpoints
- node payloads that combine privileged local file access instructions with
  network transfer instructions
- unexpected executable files or shell scripts outside documented package
  support paths

Scanner output is advisory when mode is `warn` and blocking when mode is
`reject`. In `reject` mode, a blocking static finding stops checkout before
workflow install and before checkout registry mutation.

### Container Check

The optional container check is an additional explicit mode, not the default
static scanner path. It may be requested with Docker, Podman, or `auto`. The
container process receives the staged package directory as a read-only mount,
uses a temporary writable work directory, and must run with:

- network disabled
- no host credential mounts
- no project root mount except the staged package directory
- no user root mount
- no inherited secret environment variables
- no privileged container mode

The container check is allowed to run a package inspection command or bundled
scanner image owned by rielflow. It must not execute workflow nodes through
their declared agent backends because package install security is a
pre-install inspection step, not a workflow run.

### Install Ordering

The checkout path must preserve this order:

1. Resolve registry/package metadata and checkout source into a temporary
   staging directory.
2. Validate md5 checksum compatibility metadata when present.
3. Validate sha256 package integrity and Ed25519 signatures according to the
   registry trust model.
4. Load and validate the workflow bundle from staging.
5. Run the optional static pre-install scanner when enabled.
6. Run the optional no-network container check when requested.
7. Copy the staged workflow bundle to the selected project or user destination.
8. Write checkout registry/provenance records.

Any failure through step 6 must leave the destination workflow directory and
checkout registry records unchanged. `--overwrite` may remove an existing
destination only after every selected pre-install check succeeds.

### Result Contract

Machine-readable checkout output should include a `preInstallCheck` object only
when a check was configured or requested. The object includes:

- `enabled`
- `mode`
- `status`: `passed`, `warned`, `failed`, or `skipped`
- `scannerVersion`
- `containerRuntime`, when used
- `findings`

Text output should summarize the check status and the number of blocking
findings. Detailed finding evidence belongs in JSON output so automation and
tests can assert stable fields.

## Metadata Fields

Each package metadata record should include:

- `packageId`
- `workflowName`
- `title`
- `description`
- `tags`
- `backends`
- `registryUrl`
- `registryRef`
- `workflowDirectory`
- `metadataPath`
- `checksum`
- `updatedAt`

The checksum is a package content checksum, initially `md5:<hex>` to satisfy the
issue requirement. The design keeps the algorithm prefix in the stored value so
the implementation can add stronger hashes later without changing command
output shape.

## Cache Design

Search and package install may use sqlite for registry/search cache when a
sqlite dependency is available and acceptable for the package. A JSON-file cache
is acceptable as a fallback and for unit tests.

Cache root:

```text
~/.rielflow/workflow-packages/cache/
```

Suggested cache entries:

- Registry URL, alias, default branch/ref, and last refresh timestamp.
- Package metadata rows keyed by registry URL, ref, and package id.
- Content checksum for the resolved workflow directory.

Cache path segments must be encoded before being written to disk. Registry ids,
registry URLs, branch names such as `feature/workflow-packages`, and package
source paths must round trip through cache metadata instead of being used as raw
filenames.

Cache invalidation:

- `--refresh` forces a registry fetch before command execution.
- Package install may use cache only when the cache entry includes registry ref and
  checksum; otherwise it refreshes selected registry metadata.
- A changed checksum is treated as a package update, not as an error.

## Checkout Records

Keep the current checkout record behavior under the user root, but extend the
record for registry packages:

```text
~/.rielflow/workflow-registry/checkouts/<scope>-<workflow-name>.json
```

Additional package fields:

- `packageId`
- `registryUrl`
- `registryRef`
- `sourceDirectory`
- `checksum`
- `metadataPath`

Direct GitHub URL checkouts may continue writing the existing record shape so
existing users and tests remain compatible.

The installed workflow directory should also carry local package provenance when
that is useful for package-local inspection, but the user-root checkout record
remains the cross-scope provenance catalog.

## Decisions

- Preserve `rielflow workflow checkout <github-url>` as the direct workflow
  checkout path and keep package ids on `rielflow package install`.
- Keep package install local-only and reject `--endpoint`.
- Keep project scope as the default installation destination.
- Add package search under `package search` because package discovery belongs
  to the package lifecycle surface.
- Treat manifest `name`, search index `packageName`, and command-level
  `packageId` as the same package identity for the initial release.
- Make `packageId` the stable CLI JSON field; `packageName` is an internal
  service field or optional compatibility alias with the same value.
- Use algorithm-prefixed checksums such as `md5:<hex>` in metadata and command
  output.
- Keep checkout pre-install security checks optional and explicitly requested
  for the first release.
- Use static scanning as the built-in baseline and no-network Docker/Podman
  container checks as an additional requested mode.
- Reject before destination copy and checkout registry writes when
  `--pre-install-check` runs in reject mode and finds high or critical issues.
- Permit sqlite cache but do not require it for correctness; command behavior
  must be testable through an injectable cache/fetch abstraction.
- Use `~/.rielflow/workflow-packages/cache/` as the cache root to align with
  registry configuration under `~/.rielflow/workflow-packages/`.

## Open Questions

- Whether registry aliases are user-defined strings only or should also be
  derived automatically from GitHub owner/repository names.
- Whether `package search --output text` should be a compact list or share the
  table renderer used by `--output table`.
- Whether package install should support an explicit `--package-version` later
  or rely on branch/ref plus checksum for the first release.
- Whether registry-level policy should later enable pre-install checks by
  default for selected registries or trusted-signer configurations.

## Risks

- Package identifiers and workflow names can diverge; ambiguous resolution must
  fail loudly to avoid installing the wrong workflow.
- Registry caches can become stale; checkout must include registry ref and
  checksum in outputs and records so stale cache behavior is diagnosable.
- Adding `--output table` to search requires updating the global output guard in
  CLI dispatch, not only the workflow command handler.
- The default registry local path is machine-specific and should be used only
  for development/migration workflows, not stored as the canonical public
  registry location.
- Branch names and registry URLs are unsafe as raw cache filenames; cache lookup
  must use canonical logical keys and encoded path segments.
- Direct URL checkout and package install share destination/provenance
  behavior; implementation drift between `workflow/checkout` and
  `workflow/packages/checkout` could create inconsistent overwrite semantics.
- The current package command handler exposes `packageName` in several service
  results; the command JSON contract must normalize this to `packageId` before
  external automation relies on it.
- `package search` and install-time package resolution can diverge if they are
  wired separately; both should delegate to the same package metadata services.
- Static scanner findings are heuristic and may produce false positives or miss
  malicious content.
- Container checks add host runtime variability; Docker/Podman absence must not
  break static-only checks.
- Running any inspection against untrusted content risks credential exposure if
  mounts, network, or environment filtering are implemented too loosely.

## Verification Commands

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun test packages/rielflow/src/workflow/packages
bun test packages/rielflow/src/workflow/checkout/checkout.test.ts
bun test packages/rielflow/src/cli.test.ts
bun run packages/rielflow/src/bin.ts package search --registry default --output json
bun run packages/rielflow/src/bin.ts package install <package-id> --registry default --output json
bun run packages/rielflow/src/bin.ts package install <package-id> --help
bun run packages/rielflow/src/bin.ts package install <package-id> --pre-install-check
bun run tsc --noEmit
git diff --check
```

## References

- `packages/rielflow/src/cli/argument-parser.ts`
- `packages/rielflow/src/cli/input-output-helpers.ts`
- `packages/rielflow/src/cli/workflow-package-command-handler.ts`
- `packages/rielflow/src/workflow/checkout/index.ts`
- `packages/rielflow/src/workflow/checkout/github-directory.ts`
- `packages/rielflow/src/workflow/checkout/registry.ts`
- `packages/rielflow/src/workflow/packages/search.ts`
- `packages/rielflow/src/workflow/packages/checkout.ts`
- `packages/rielflow/src/workflow/packages/cache.ts`
- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/checkout/checkout.test.ts`
- `packages/rielflow/src/cli.test.ts`
