# Executable Node Add-on Package Support

Design for executable node add-on package metadata, workflow-package dependency
linkage, installed add-on resolution, and validation rules that let workflows
run package-owned local command add-ons without downloading or executing
packages during workflow load.

## Overview

Rielflow already supports declarative `kind: "node-addon"` packages that install
local add-on manifests into project or user add-on roots. That first iteration
intentionally rejected scripts, Dockerfiles, lockfiles, and executable file
types.

Executable node add-ons extend that package model with explicit execution
metadata. A package can declare add-ons that resolve to `container` or
`command` node payloads, but executable files such as `.bash` are allowed only
when they are named by `execution` metadata, included in the add-on
`contentDigest`, and covered by package `integrity`. The executable surface is
visible in the manifest before checkout, reviewed at install time, recorded in
checkout provenance, and linked from workflow packages through dependency
declarations. Workflow validation stays offline: it verifies that the authored
workflow references installed add-ons whose identity, version, digest,
capabilities, and permission grant match the workflow package's declared
dependency lock.

This issue-resolution slice also covers the minimal local-command runtime path
needed for `greeting-node-addon` in
`/Users/taco/gits/tacogips/rielflow-packages`: the package installs
`examples/greeting-shell@1`, the add-on resolves to its packaged
`greeting.bash`, and a temporary local workflow can run it successfully.

## Feature Contract

- Feature id: `executable-node-addon-package-support`
- Feature title: Implement executable node-addon package support and make
  greeting executable add-on work
- Issue reference: `runtimeVariables.workflowInput.issueTitle`
- Workflow mode: `issue-resolution`
- Design document path:
  `design-docs/specs/design-executable-node-addon-manifest-dependencies.md`
- Codex-agent references:
  - `/Users/taco/gits/tacogips/rielflow` current uncommitted implementation
    baseline
  - `/Users/taco/gits/tacogips/rielflow-packages/packages/greeting-node-addon`
    target registry package
  - `/Users/taco/gits/tacogips/codex-agent` process command handling is a
    behavioral reference only; Rielflow keeps add-on/package behavior in its
    own package manager, add-on resolver, and native command executor modules
  - `design-docs/specs/design-workflow-node-package-install.md`
  - `packages/rielflow/src/workflow/packages/manifest.ts`
  - `packages/rielflow/src/workflow/packages/dependencies.ts`
  - `packages/rielflow/src/workflow/packages/types.ts`
  - `packages/rielflow/src/workflow/addon-package-boundary.ts`

## Goals

- Allow `kind: "node-addon"` packages to declare executable add-on artifacts in
  a way that is inspectable before install.
- Allow package-owned `.bash` command add-ons only when the executable path is
  declared by `execution` metadata and covered by verified digest metadata.
- Let workflow packages declare required add-ons with package id, add-on
  identity, version, digest, capabilities, and permission grant linkage.
- Install node-addon package dependencies and preserve dependency lock metadata
  in package checkout provenance.
- Keep workflow load and validation deterministic and offline after package
  checkout.
- Make package dependency installation install workflow dependencies and
  required add-on packages before caller workflow validation.
- Preserve the existing add-on lookup order and project/user add-on roots.
- Prevent workflows from silently using a different executable add-on than the
  package author reviewed.
- Keep `greeting-node-addon` modeled as a node-addon package, not as a workflow
  package.

## Non-Goals

- Running containers, commands, package lifecycle scripts, or build steps during
  workflow validation.
- Credential-backed live SDK smoke tests.
- Designing interactive permission prompts or all CLI text output details.
- Supporting npm-style dependency ranges for executable add-ons.
- Letting add-on packages provide or shadow `rielflow/*` built-ins.
- Allowing workflow bundles to vendor executable add-ons directly without a
  package checkout record.
- Running package lifecycle hooks, npm/Bun package code, or registry-controlled
  install scripts.

## Manifest Model

The existing `rielflow-package.json` `kind: "node-addon"` shape remains the
package root. The `addons[]` entries gain executable metadata that is duplicated
from `addon.json` for registry indexing and early validation.

```json
{
  "kind": "node-addon",
  "name": "media/yt-dlp-addon",
  "version": "1.0.0",
  "description": "Download media into the runtime attachment root.",
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
          "scope": "attachment.output",
          "required": true
        }
      ],
      "contentDigest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
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
- `contentDigest`: required package-authored add-on content digest for
  executable add-ons. Checkout recomputes this over the installed add-on version
  directory and records the verified value; mismatches fail checkout.

The path-local `addon.json` also gains an executable descriptor. The package
manifest and `addon.json` must agree on `(name, version, execution.kind,
capabilities[])` and any package-authored `contentDigest`.

```json
{
  "name": "media/yt-dlp-download",
  "version": "1",
  "description": "Download media into the runtime attachment root.",
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
- `scope`: optional constrained scope such as `attachment.input`,
  `attachment.output`, `workspace`, `durable`, `host.path`, or a named env var.
  Message input/output is not a filesystem capability scope; it is delivered
  through the runtime's resolved input object and executor result channel.
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
              "scope": "attachment.output"
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

Workflow package validation always requires a package dependency lock for
executable add-ons. Direct and temporary workflows do not have a
`rielflow-package.json`, so they may run executable add-ons only under an
explicit development/test direct-run grant. That grant is an execution or
validation option, not a silent workflow-load fallback, and it uses the same
lock shape as a workflow package dependency plus the dependency `packageId`:

```json
{
  "packageId": "greeting-node-addon",
  "addons": [
    {
      "name": "examples/greeting-shell",
      "version": "1",
      "contentDigest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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

Validation accepts the direct-run grant only when the selected project/user
scope contains matching installed checkout provenance with verified package
`integrity`, the recomputed add-on `contentDigest` matches the grant, and every
required capability is explicitly allowed. Validation and inspect output must
mark this source as `directExecutableAddonGrant` so production package flows
cannot mistake it for a package dependency lock. Missing or mismatched direct
grants reject executable add-ons even if the add-on was installed locally.

Direct workflow definition directory mode may still use explicit `--addon-root`
for declarative add-on development. Executable add-ons loaded directly from an
addon root, without package checkout provenance, are marked
`unpackagedExecutableAddon`; production package validation rejects that marker
unless a test/development option explicitly allows it.

## Local Command Add-on Resolution

Installed executable add-ons resolve through the same project/user/local add-on
lookup order as declarative add-ons. Once resolved, the add-on version directory
becomes the file root for add-on-owned template paths and command script paths.
The resolver must not reinterpret an executable add-on as workflow-local source
or allow the workflow bundle to supply a replacement script with the same name.

Local command rules:

- `addon.json.execution.kind: "local-command"` is required for command payloads
  that point at package-owned executable files.
- `execution.entrypoint` must be a safe add-on-relative path and must match, or
  be the resolved target of, the command payload's executable script path.
- `.bash` entrypoints run through the native command executor's Bash dispatch
  path, so host executable mode bits are not the source of trust.
- `.sh` entrypoints run through the POSIX shell dispatch path.
- Other entrypoints require ordinary host executability and shebang behavior.
- The native command executor receives the resolved add-on artifact path after
  digest validation; workflow-authored relative paths cannot escape the add-on
  directory.
- `addon.inputs` and `addon.config` render into the resolved node payload, while
  `addon.env` remains rejected unless the add-on declares `envSchema` and the
  dependency grant permits the relevant `env.read` capability.

`examples/greeting-shell@1` is the acceptance fixture for this boundary. Its
package manifest and `addon.json` both declare
`execution.kind: "local-command"`, `entrypoint: "greeting.bash"`, and
`process.spawn`; package install verifies the add-on `contentDigest` and
package `integrity`, then runtime executes the packaged Bash script through a
temporary workflow node that references `examples/greeting-shell@1`.

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
- `dependencies[]` normalized package dependency entries, preserving
  `kind: "node-addon"` and exact `addons[]` locks for dependency replay

Checkout records for workflow packages add:

- `dependencies[]` entries for both workflow and node-addon dependencies.
- `dependencyGraph[]` edges with `packageKind`.
- `addonDependencyLocks[]` summarizing exact add-on identities, digests, and
  grants used during validation.

## Validation Rules

Manifest normalization rejects:

- executable `addons[]` entries without `execution.kind`
- executable `addons[]` entries without `contentDigest`
- executable entries without a non-empty `capabilities[]`
- unknown `execution.kind` or capability names
- unsafe `entrypoint` or `containerfilePath` values
- `containerfilePath` outside the add-on source directory
- `.bash`, `.sh`, Dockerfile/Containerfile, or other executable artifact files
  in a node-addon package that are not reachable from declared `execution`
  metadata
- package manifest and `addon.json` disagreement
- executable add-ons that omit `integrity`
- executable add-ons whose recomputed add-on content digest differs from the
  package-authored `contentDigest`
- workflow dependencies that grant capabilities not requested by the add-on
- workflow dependencies that omit required capability grants
- workflow nodes referencing executable add-ons not present in dependency locks
  or explicit direct-run grants
- `rielflow/*` executable add-ons from package sources

Validation permits declarative node-addon packages to keep the older minimal
shape. The executable fields are required only when an add-on resolves to a
`container` or `command` node payload, includes executable files, declares an
entrypoint, or requests executable capabilities.

## Example: Greeting Shell Add-on

The local registry package
`/Users/taco/gits/tacogips/rielflow-packages/packages/greeting-node-addon` is a
node-addon package. It must not contain or install a workflow bundle. It
provides one add-on:

- package id: `greeting-node-addon`
- add-on: `examples/greeting-shell@1`
- execution: `local-command`
- entrypoint: `greeting.bash`
- required capability: `process.spawn`

The live local smoke registers `/Users/taco/gits/tacogips/rielflow-packages` as
a local package registry, installs `greeting-node-addon` into a temporary
project, passes a direct-run grant for the installed add-on's
`contentDigest` and `process.spawn` capability, and runs a temporary workflow
whose worker node references:

```json
{
  "addon": {
    "name": "examples/greeting-shell",
    "version": "1",
    "inputs": {
      "name": "Rielflow",
      "greetingIndex": "1",
      "timezone": "UTC"
    }
  }
}
```

The expected result is an accepted command node output returned through the
native executor result channel and then published by the runtime. The smoke
proves installed node-addon resolution, direct-run grant enforcement,
digest-gated executable file access, Bash dispatch, and temporary workflow
execution without requiring credential-backed SDK backends.

## Example: Download And Transcribe

The motivating workflow package depends on two add-on packages:

- `media/yt-dlp-addon` provides `media/yt-dlp-download@1`, a container add-on
  with `network.egress`, `container.build`, and `filesystem.write` to
  `attachment.output`.
- `media/local-transcriber-addon` provides `media/local-transcribe@1`, a local
  command or container add-on with `filesystem.read` from `attachment.input`,
  optional `device.gpu`, and `filesystem.write` to `attachment.output`.

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
- Local command execution can weaken package safety if any path bypasses
  execution metadata, add-on digest checks, package integrity verification, or
  safe relative path constraints.
- The greeting smoke depends on local registry setup and temporary project
  isolation; verification should not reuse persistent project/user add-on roots.

## Verification

Expected design-to-plan verification commands:

```bash
test -f design-docs/specs/design-executable-node-addon-manifest-dependencies.md
git diff --check -- design-docs/specs/design-executable-node-addon-manifest-dependencies.md design-docs/specs/architecture.md design-docs/specs/command.md design-docs/specs/notes.md
```

Expected implementation verification commands:

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun run typecheck
bun run lint
git diff --check
tmp_project="$(mktemp -d)"
bun run packages/rielflow/src/bin.ts package registry add local /Users/taco/gits/tacogips/rielflow-packages --project-root "$tmp_project"
bun run packages/rielflow/src/bin.ts package install greeting-node-addon --project-root "$tmp_project" --output json
bun run packages/rielflow/src/bin.ts workflow run --workflow-json-file <temp-greeting-workflow.json> --project-root "$tmp_project" --output json # with direct executable add-on grant for greeting-node-addon/examples/greeting-shell@1
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

Issue-resolution update decision: accepted for implementation after aligning the
earlier design-plan-only dependency design with the current executable
node-addon request. The current design includes package-owned Bash execution,
content-digest and integrity gating, node-addon dependency locks, scoped
installed add-on resolution, and the greeting-node-addon smoke path.

Independent design review revision decision: addressed two medium findings by
adding `contentDigest` to the executable node-addon manifest example and by
defining the direct/temporary workflow policy: non-package workflows need an
explicit development/test direct-run grant tied to installed checkout
provenance, verified package integrity, exact add-on content digest, and
capability grants.

## References

- `design-docs/specs/design-workflow-node-package-install.md`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `design-docs/specs/design-container-runtime-contract.md`
- `packages/rielflow/src/workflow/packages/manifest.ts`
- `packages/rielflow/src/workflow/packages/dependencies.ts`
- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/packages/checkout-node-addon.ts`
- `packages/rielflow/src/workflow/addon-package-boundary.ts`
