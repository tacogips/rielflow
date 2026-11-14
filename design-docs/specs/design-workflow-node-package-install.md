# Workflow Node Package Install

Design for distributing reusable workflow node add-ons through the existing
Git-backed package registry and installing them with plugin-style project/user
scope semantics.

## Overview

Rielflow already has two related surfaces:

- workflow packages distributed through Git-backed registries and installed by
  `rielflow package install`
- workflow node add-ons referenced from `workflow.json.nodes[].addon` and loaded
  from built-in, project, user, or host resolver sources

Node packages join these surfaces. A node package is an installable package
whose primary artifact is one or more local add-on manifests under
`<scope-root>/addons/<namespace>/<name>/<version>/`. Workflow load and
validation remain local and deterministic: package install fetches, validates,
and records add-on files ahead of time; workflow loading never downloads
packages or runs package lifecycle hooks.

The model is intentionally similar to Atom or browser extensions at the user
experience level: users search a registry, install an extension-like node
package into project or user scope, then authored workflows can reference the
installed add-on by namespaced id. It is not similar at the execution trust
level: first-iteration node packages install declarative add-on manifests and
templates only, not arbitrary executable code.

## Feature Contract

- Feature id: `workflow-node-package-install`
- Feature title: Implement node package distribution and install mechanism
- Issue reference: `runtimeVariables.workflowInput.issueTitle`
- Workflow mode: `issue-resolution`
- Design document path:
  `design-docs/specs/design-workflow-node-package-install.md`
- Implementation plan target:
  `impl-plans/active/workflow-node-package-install.md`
- Codex-agent references:
  - `AGENTS.md`
  - `design-docs/specs/design-workflow-package-registry.md`
  - `design-docs/specs/design-workflow-package-commands.md`
  - `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
  - `packages/rielflow/src/workflow/packages/`
  - `packages/rielflow/src/workflow/node-addons.ts`
  - `packages/rielflow/src/workflow/local-node-addons.ts`
  - `packages/rielflow/src/workflow/addon-package-boundary.ts`
  - `packages/rielflow/src/cli.ts`
  - `README.md`

## Goals

- let registry packages distribute reusable workflow node add-ons
- reuse registry configuration, package search, staging, integrity validation,
  and install provenance instead of creating a second downloader
- install node packages into project or user add-on roots with explicit package
  ownership records
- keep workflow validation deterministic and offline after install
- expose package kind and installed add-on ids in JSON output for automation
- keep Codex, Claude, Cursor, and SDK backend behavior behind adapter modules

## Non-Goals

- downloading add-ons during workflow load, validation, or execution
- executing npm, Bun, shell, TypeScript, or package lifecycle code during install
- allowing installed packages to override built-in `rielflow/*` add-ons
- adding Cursor-specific or codex-agent-specific package install behavior
- replacing host-provided resolver functions for trusted in-process extension
  integrations
- designing auto-update, uninstall garbage collection, or package signing policy
  beyond reusing existing workflow package integrity controls

## Package Model

The registry keeps using `rielflow-package.json` as the package manifest file.
Existing workflow package manifests without a `kind` field are treated as:

```json
{
  "kind": "workflow"
}
```

Node package manifests set:

```json
{
  "kind": "node-addon",
  "name": "team/release-note-node",
  "version": "1.0.0",
  "description": "Reusable release-note worker node.",
  "tags": ["addon", "node", "release"],
  "registry": "https://github.com/tacogips/rielflow-packages",
  "checksum": "...",
  "checksumAlgorithm": "md5",
  "addons": [
    {
      "name": "team/release-note",
      "version": "1",
      "sourcePath": "addons/team/release-note/1"
    }
  ]
}
```

Required node package fields:

- `kind`: `node-addon`
- `name`: safe package id, using the existing package-name validation
- `version`: package version for search, install, update, and provenance
- `description`: searchable summary
- `tags`: searchable keyword array
- `registry`: source registry URL at publish time
- `checksum` and `checksumAlgorithm`: existing compatibility checksum fields
- `addons`: non-empty array of add-on artifacts

Each `addons[]` entry requires:

- `name`: namespaced add-on id, for example `team/release-note`
- `version`: add-on descriptor version, not the package version
- `sourcePath`: safe package-relative directory containing `addon.json`

Optional node package fields:

- `title`
- `authors`
- `license`
- `homepage`
- `repository`
- `examples`
- `minimumRielflowVersion`
- `dependencies` (normalized for manifest compatibility; checkout rejects
  node add-on packages with non-empty dependencies in this first iteration)
- `integrity`

Validation must reject absolute paths, parent traversal, empty add-on arrays,
duplicate `(name, version)` entries in the same package, `rielflow/*` add-on
names, add-on names that do not match the path-local `addon.json`, and
manifest shapes that mix `kind: "node-addon"` with workflow-only fields such as
required `workflow` metadata.

## Add-on Artifact Contract

Every `addons[].sourcePath` directory must contain one local add-on manifest
that already satisfies the local add-on contract in
`design-node-addon-catalog-and-chat-reply-worker.md`.

Node package install validates the staged add-on directory before writing it:

1. load package manifest
2. verify checksum and sha256 integrity/signature policy when configured
3. validate each add-on source path stays inside the package root
4. load `addon.json`
5. validate the add-on name and version match the package manifest entry
6. validate the add-on is manifest/template based
7. reject arbitrary executable code, package lifecycle hooks, and native
   executor registration
8. run the same structural add-on manifest validation used by workflow
   validation
9. copy only allowed add-on files into the selected add-on root

Allowed copied files are `addon.json`, descriptor-referenced templates, prompt
files, schemas, README-like documentation, examples, and other data files that
the local manifest references by safe relative path. Generated runtime
artifacts, `.git`, nested `.rielflow`, lockfiles intended for executable
package code, package manager scripts, and package-local credential files are
not installed.

## Install Destinations

Project scope is the default destination, matching workflow package install.

Destination layout:

```text
<project>/.rielflow/addons/<namespace>/<addon-name>/<version>/
~/.rielflow/addons/<namespace>/<addon-name>/<version>/
```

`--user-scope` selects the user add-on root. `--workflow-definition-dir` remains
a workflow destination override for workflow packages and does not redirect
node package add-on projection; node package install uses the current project
root for project scope and the configured user root for user scope.

Duplicate handling:

- installing over an existing add-on version fails by default
- `--overwrite` may replace only package-owned add-on directories after staged
  validation succeeds
- `--yes` bypasses interactive confirmation for automation
- built-in `rielflow/*` add-ons are never overwritten or shadowed by packages

Package install writes checkout records under the same package checkout catalog
used by workflow packages, but records `packageKind: "node-addon"` and each
installed add-on artifact.

Required installed artifact fields:

- `addonName`
- `addonVersion`
- `scope`
- `destinationDirectory`
- `manifestPath`
- `sourcePath`
- `contentDigest`
- `contentDigestAlgorithm`

## Registry And Search

Registry config, cache root, cache backends, package identity, branch/ref
selection, and refresh behavior are shared with workflow packages.

Search records gain a package kind:

- `kind: "workflow"` for existing workflow packages
- `kind: "node-addon"` for node packages

Node package search indexes:

- package name, title, description, tags, and authors
- add-on names and versions
- add-on descriptions from `addon.json`
- add-on resolution kind such as `node-payload-template`
- supported execution backend from the resolved node payload template when it
  can be derived without executing code

`rielflow package search` should include both kinds by default and support
future `--kind workflow|node-addon` filtering. JSON output must always include
`kind` so automation can select the correct install expectations even before a
filter flag exists.

## CLI Behavior

The canonical install command remains:

```bash
rielflow package install <package-id> [--registry <registry-url-or-id>] [--branch <branch>] [--user-scope] [--overwrite] [--yes] [--output json|text]
```

For node packages, successful text output names the installed add-ons and
destination scope. JSON output includes:

- `packageKind: "node-addon"`
- `packageId`
- `packageName`
- `packageVersion`
- `registryUrl`
- `registryRef`
- `installId`
- `scope`
- `addons`
- `checkoutRecordPath`
- `checksum`
- `checksumAlgorithm`
- `integrityDigest`

`rielflow package list` includes node package installs alongside workflow
package installs and exposes `packageKind`. `rielflow package remove` removes
package-owned add-on directories when the selected install record has
`packageKind: "node-addon"`. Ambiguous selectors still require `--install-id`.

No new `node package ...`, `workflow node install ...`, or
`workflow package ...` command tree is introduced in the first iteration. The
top-level `package` lifecycle remains the single user-facing package manager.

## Loader And Runtime Boundary

After install, workflow authors reference installed node packages through the
existing add-on authoring surface:

```json
{
  "id": "release-note",
  "role": "worker",
  "addon": {
    "name": "team/release-note",
    "version": "1",
    "config": {}
  }
}
```

The loader reads from scoped add-on roots using existing precedence:

1. built-in runtime catalog for `rielflow/*`
2. explicit direct add-on root override
3. project scope add-on root
4. user scope add-on root
5. host-provided resolver functions

Package install does not change that lookup order. It only materializes
validated add-on manifests into those roots and records provenance for list,
remove, update, and audit operations.

## Security And Integrity

Node packages reuse the workflow package integrity model:

- md5 checksum remains compatibility/change-tracking metadata
- sha256 `integrity` is the tamper-detection boundary
- registry trusted signers and `requireSignature` apply equally to node
  packages
- optional pre-install static scanning may inspect add-on manifests, templates,
  prompts, and examples before writes

Additional node-package controls:

- reject `rielflow/*` package-provided add-ons
- reject executable lifecycle scripts and native executor registration
- reject add-on manifests that request undeclared environment forwarding
- copy only files reachable through validated manifest/template references
- keep credential material out of package manifests, checkout records, and scan
  output

## Intentional Divergences

- Atom/browser plugin systems often download and activate executable extension
  code; rielflow node packages install declarative add-on manifests first.
- Workflow load remains offline and deterministic rather than resolving missing
  packages on demand.
- Codex-agent and Cursor CLI behavior is not part of package resolution.
  Backend-specific execution remains isolated behind adapter modules after an
  installed add-on resolves to an ordinary node payload.

## Risks

- Package kind expansion can regress existing workflow package parsing unless
  omitted `kind` defaults to `workflow`.
- Add-on install and workflow package install share catalog records, so remove
  and list commands need package-kind-aware tests.
- Users may expect executable plugin behavior from the Atom/browser analogy; the
  first release must document that installed node packages are declarative.
- Project/user add-on shadowing can surprise authors unless search, install,
  inspect, and validation output show resolved add-on source paths.

## Verification

Expected focused verification commands:

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun test packages/rielflow/src/workflow/addon-package-boundary.test.ts
bun test packages/rielflow/src/workflow/authored-workflow.test.ts
bun test packages/rielflow/src/cli.test.ts
bun run packages/rielflow/src/bin.ts package search --output json
bun run packages/rielflow/src/bin.ts package install <node-package-id> --output json
bun run packages/rielflow/src/bin.ts package list --output json
bun run tsc --noEmit
git diff --check
```

## References

- `design-docs/specs/design-workflow-package-registry.md`
- `design-docs/specs/design-workflow-package-commands.md`
- `design-docs/specs/design-workflow-package-integrity.md`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/packages/manifest.ts`
- `packages/rielflow/src/workflow/packages/checkout.ts`
- `packages/rielflow/src/workflow/node-addons.ts`
- `packages/rielflow/src/workflow/local-node-addons.ts`
