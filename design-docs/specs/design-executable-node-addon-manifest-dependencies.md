# Executable Node Add-on Manifest And Workflow Dependency Linkage

Design for executable node add-on package metadata, workflow-package dependency
linkage, and validation rules that let workflows depend on installed
container/local-command add-ons without downloading or executing packages during
workflow load.

## Overview

Rielflow already supports declarative `kind: "node-addon"` packages that install
local add-on manifests into project or user add-on roots. That first iteration
intentionally rejected scripts, Dockerfiles, lockfiles, and executable file
types.

Executable node add-ons extend that package model with explicit execution
metadata. A package can declare add-ons that resolve to `container` or `command`
node payloads, but the executable surface is visible in the manifest before
checkout, reviewed at install time, recorded in checkout provenance, and linked
from workflow packages through dependency declarations. Workflow validation stays
offline: it verifies that the authored workflow references installed add-ons
whose identity, version, digest, capabilities, and permission grant match the
workflow package's declared dependency lock.

This document covers only the manifest/schema and workflow-to-add-on dependency
linkage slice for feature
`executable-addon-manifest-dependencies`. Runtime process launch, permission
prompt UX, registry publishing UX, and end-to-end fixture execution are separate
feature slices that consume this contract.

## Feature Contract

- Feature id: `executable-addon-manifest-dependencies`
- Feature title: Executable Add-on Manifest And Workflow Dependency Linkage
- Issue reference: `workflowInput: Design executable node add-on package checkout`
- Workflow mode: `design-plan-only`
- Design document path:
  `design-docs/specs/design-executable-node-addon-manifest-dependencies.md`
- Implementation plan path:
  `impl-plans/active/executable-node-addon-manifest-dependencies.md`
- Codex-agent references:
  - `AGENTS.md`
  - `design-docs/specs/design-workflow-node-package-install.md`
  - `packages/rielflow/src/workflow/packages/manifest.ts`
  - `packages/rielflow/src/workflow/packages/dependencies.ts`
  - `packages/rielflow/src/workflow/packages/types.ts`
  - `packages/rielflow/src/workflow/addon-package-boundary.ts`

## Goals

- Allow `kind: "node-addon"` packages to declare executable add-on artifacts in
  a way that is inspectable before install.
- Let workflow packages declare required add-ons with package id, add-on
  identity, version, digest, capabilities, and permission grant linkage.
- Keep workflow load and validation deterministic and offline after package
  checkout.
- Make package dependency installation install workflow dependencies and
  required add-on packages before caller workflow validation.
- Preserve the existing add-on lookup order and project/user add-on roots.
- Prevent workflows from silently using a different executable add-on than the
  package author reviewed.

## Non-Goals

- Running containers, commands, package lifecycle scripts, or build steps during
  workflow validation.
- Designing the complete runtime executor implementation for `command` and
  `container` add-ons.
- Designing interactive permission prompts or all CLI text output details.
- Supporting npm-style dependency ranges for executable add-ons.
- Letting add-on packages provide or shadow `rielflow/*` built-ins.
- Allowing workflow bundles to vendor executable add-ons directly without a
  package checkout record.

## Manifest Model

The existing `rielflow-package.json` `kind: "node-addon"` shape remains the
package root. The `addons[]` entries gain executable metadata that is duplicated
from `addon.json` for registry indexing and early validation.

```json
{
  "kind": "node-addon",
  "name": "media/yt-dlp-addon",
  "version": "1.0.0",
  "description": "Download media into the node mailbox.",
  "tags": ["addon", "media", "yt-dlp"],
  "registry": "https://github.com/tacogips/rielflow-packages",
  "checksum": "...",
  "checksumAlgorithm": "md5",
  "integrity": {
    "digestAlgorithm": "sha256",
    "digest": "..."
  },
  "addons": [
    {
      "name": "media/yt-dlp-download",
      "version": "1",
      "sourcePath": "addons/media/yt-dlp-download/1",
      "execution": {
        "kind": "container",
        "entrypoint": "scripts/download.sh",
        "containerfilePath": "Containerfile"
      },
      "capabilities": [
        {
          "name": "network.egress",
          "required": true,
          "reason": "yt-dlp downloads media from user-provided URLs"
        },
        {
          "name": "filesystem.write",
          "scope": "mailbox.outbox",
          "required": true
        }
      ]
    }
  ]
}
```

Each executable `addons[]` entry adds:

- `execution.kind`: `declarative`, `container`, or `local-command`.
- `execution.entrypoint`: safe add-on-relative executable path for
  `container` and `local-command` add-ons.
- `execution.containerfilePath`: safe add-on-relative `Containerfile` or
  `Dockerfile` path for container builds when the add-on does not declare a
  prebuilt image in `addon.json`.
- `execution.runtimeHints`: optional non-authoritative strings such as
  `["docker", "podman"]`, `["yt-dlp"]`, or `["llama.cpp"]` for registry search.
- `capabilities`: non-empty array for executable add-ons; omitted or empty for
  purely declarative add-ons.
- `contentDigest`: optional package-authored add-on content digest. Checkout
  recomputes this and records the verified value; mismatches fail checkout.

The path-local `addon.json` also gains an executable descriptor. The package
manifest and `addon.json` must agree on `(name, version, execution.kind,
capabilities[])` and any package-authored `contentDigest`.

```json
{
  "name": "media/yt-dlp-download",
  "version": "1",
  "description": "Download media into the node mailbox.",
  "allowedRoles": ["worker"],
  "resolution": {
    "kind": "node-payload-template",
    "nodeType": "container",
    "container": {
      "build": {
        "contextPath": ".",
        "containerfilePath": "Containerfile"
      },
      "entrypoint": ["scripts/download.sh"],
      "networkPolicy": "egress-allowed"
    }
  },
  "execution": {
    "kind": "container",
    "entrypoint": "scripts/download.sh",
    "containerfilePath": "Containerfile"
  },
  "capabilities": [
    {
      "name": "network.egress",
      "required": true,
      "reason": "download media URL"
    }
  ],
  "inputSchema": {
    "type": "object"
  }
}
```

## Capability And Permission Schema

Capabilities are request descriptors, not grants. A workflow package grants
them explicitly through its dependency lock.

Supported first-version capability names:

- `network.egress`
- `filesystem.read`
- `filesystem.write`
- `process.spawn`
- `container.build`
- `container.run`
- `device.gpu`
- `env.read`

Capability fields:

- `name`: supported capability name.
- `required`: boolean, defaults to `true`.
- `scope`: optional constrained scope such as `mailbox.inbox`,
  `mailbox.outbox`, `workspace`, `durable`, `host.path`, or a named env var.
- `reason`: required non-empty explanation for any capability that reaches
  network, host paths, environment variables, GPU devices, or process spawn.
- `defaultPolicy`: optional `deny`, `prompt`, or `allow`; registry and install
  policy may only make this stricter.

Validation rejects unknown capability names, missing reasons for sensitive
capabilities, wildcard host path scopes, ambient environment forwarding, and
capability declarations that are inconsistent with the resolved node payload.
For example, a container add-on with `networkPolicy: "egress-allowed"` must
declare `network.egress`.

## Workflow Package Dependency Linkage

Workflow package manifests keep the existing `dependencies[]` array but object
entries may now declare add-on requirements. This lets package checkout install
and verify executable add-on packages before validating the caller workflow.

```json
{
  "kind": "workflow",
  "name": "media/download-and-transcribe",
  "version": "1.0.0",
  "dependencies": [
    {
      "packageId": "media/yt-dlp-addon",
      "registry": "default",
      "branch": "main",
      "kind": "node-addon",
      "addons": [
        {
          "name": "media/yt-dlp-download",
          "version": "1",
          "contentDigest": "sha256:...",
          "capabilityGrant": {
            "network.egress": {
              "allowed": true,
              "scope": "any"
            },
            "filesystem.write": {
              "allowed": true,
              "scope": "mailbox.outbox"
            }
          }
        }
      ]
    }
  ]
}
```

Extended dependency fields:

- `kind`: optional `workflow` or `node-addon`. Omitted dependencies remain
  workflow dependencies for compatibility unless the resolved package is
  `node-addon` and `addons[]` is present.
- `addons`: required non-empty array when `kind` is `node-addon`.
- `addons[].name` and `addons[].version`: exact add-on identity expected by the
  workflow package.
- `addons[].contentDigest`: required for executable add-ons. The value uses
  `sha256:<hex>` and must match the installed add-on artifact digest recorded
  by checkout.
- `addons[].capabilityGrant`: required for executable add-ons. Every required
  add-on capability must have an explicit grant.
- `addons[].optional`: optional boolean for workflows that conditionally use an
  add-on; validation still fails if the workflow references a missing optional
  add-on node.

Node add-on packages may declare package dependencies only on other
`node-addon` packages when the dependency entries include exact add-on locks.
Cycles are rejected using the existing dependency graph identity with package
kind included in the edge.

## Workflow Authoring Link

Authored workflow nodes keep the existing `workflow.json.nodes[].addon` shape:

```json
{
  "id": "download",
  "role": "worker",
  "addon": {
    "name": "media/yt-dlp-download",
    "version": "1",
    "config": {
      "outputName": "video.mp4"
    },
    "inputs": {
      "url": "{{workflow.input.videoUrl}}"
    }
  }
}
```

Validation links the authored node to installed dependency metadata as follows:

1. Resolve the add-on through the existing lookup order.
2. Require package checkout provenance for any resolved executable add-on.
3. Match `(addonName, addonVersion, contentDigest)` against the workflow
   package dependency lock.
4. Require the grant to cover all required add-on capabilities.
5. Reject nodes that request `addon.env` bindings not declared by the add-on
   `envSchema` and not granted by `env.read`.
6. Include the resolved dependency package id, install id, digest, capability
   summary, and source scope in validation/inspect JSON.

Direct workflow definition directory mode may still use explicit `--addon-root`
for development, but executable add-ons loaded that way are marked
`unpackagedExecutableAddon`. Production package validation rejects that marker
unless a test/development option explicitly allows it.

## Checkout Behavior

Package checkout installs dependencies in this order:

1. Resolve the caller package manifest.
2. Install declared workflow dependencies using existing behavior.
3. Install declared node-addon dependencies into the selected project/user add-on
   root.
4. Recompute and compare add-on content digests.
5. Record executable metadata, capabilities, grants, and dependency edges in the
   checkout record.
6. Validate the caller workflow with dependency lock awareness.
7. Roll back dependency installs if caller validation fails.

Checkout records for node-addon packages add:

- `packageKind: "node-addon"`
- `addons[].execution.kind`
- `addons[].capabilities`
- `addons[].contentDigest`
- `addons[].contentDigestAlgorithm`
- `addons[].packageDependencyKey`
- `addons[].permissionGrant`, when installed as a workflow dependency

Checkout records for workflow packages add:

- `dependencies[]` entries for both workflow and node-addon dependencies.
- `dependencyGraph[]` edges with `packageKind`.
- `addonDependencyLocks[]` summarizing exact add-on identities, digests, and
  grants used during validation.

## Validation Rules

Manifest normalization rejects:

- executable `addons[]` entries without `execution.kind`
- executable entries without a non-empty `capabilities[]`
- unknown `execution.kind` or capability names
- unsafe `entrypoint` or `containerfilePath` values
- `containerfilePath` outside the add-on source directory
- package manifest and `addon.json` disagreement
- executable add-ons that omit `integrity`
- workflow dependencies that grant capabilities not requested by the add-on
- workflow dependencies that omit required capability grants
- workflow nodes referencing executable add-ons not present in dependency locks
- `rielflow/*` executable add-ons from package sources

Validation permits declarative node-addon packages to keep the older minimal
shape. The executable fields are required only when an add-on resolves to a
`container` or `command` node payload, includes executable files, declares an
entrypoint, or requests executable capabilities.

## Example: Download And Transcribe

The motivating workflow package depends on two add-on packages:

- `media/yt-dlp-addon` provides `media/yt-dlp-download@1`, a container add-on
  with `network.egress`, `container.build`, and `filesystem.write` to
  `mailbox.outbox`.
- `media/local-transcriber-addon` provides `media/local-transcribe@1`, a local
  command or container add-on with `filesystem.read` from `mailbox.inbox`,
  optional `device.gpu`, and `filesystem.write` to `mailbox.outbox`.

The workflow package lock grants only those capabilities. If a later
`media/yt-dlp-download@1` package changes its digest or adds `env.read`, checkout
fails until the workflow package updates its dependency lock and reviewed grant.

## Risks

- Digest locks can make iteration noisy unless authoring tools regenerate them
  clearly.
- Capability names must be narrow enough to be enforceable by later runtime
  slices; overly broad names would create false confidence.
- Existing dependency code currently rejects node-addon package dependencies, so
  implementation must update dependency graph and rollback logic carefully.
- Direct add-on root development needs an explicit escape hatch without making
  production package validation permissive.

## Verification

Expected design-to-plan verification commands:

```bash
test -f design-docs/specs/design-executable-node-addon-manifest-dependencies.md
test -f impl-plans/active/executable-node-addon-manifest-dependencies.md
git diff --check -- design-docs/specs/design-executable-node-addon-manifest-dependencies.md impl-plans/active/executable-node-addon-manifest-dependencies.md
```

Expected implementation verification commands:

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun test packages/rielflow/src/workflow/addon-package-boundary.test.ts
bun test packages/rielflow/src/workflow/authored-workflow.test.ts
bun test packages/rielflow/src/cli.test.ts
bun run packages/rielflow/src/bin.ts package install media/download-and-transcribe --output json
bun run packages/rielflow/src/bin.ts workflow validate media/download-and-transcribe --output json
bun run tsc --noEmit
git diff --check
```

## Review Decisions

Design self-review decision: accepted for implementation planning after
checking the feature contract, manifest fields, dependency linkage, validation,
security constraints, and fixture implications.

Independent design review decision: accepted for implementation planning after
addressing one medium finding: the original draft allowed direct executable
add-on roots without distinguishing development from production validation. The
design now marks those resolutions as `unpackagedExecutableAddon` and requires a
test/development override for production package validation.

## References

- `design-docs/specs/design-workflow-node-package-install.md`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `design-docs/specs/design-container-runtime-contract.md`
- `packages/rielflow/src/workflow/packages/manifest.ts`
- `packages/rielflow/src/workflow/packages/dependencies.ts`
- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/packages/checkout-node-addon.ts`
- `packages/rielflow/src/workflow/addon-package-boundary.ts`
