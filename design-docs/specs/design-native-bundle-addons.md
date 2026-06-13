# Swift Native Bundle Add-ons

Design for implementing Rielflow Swift add-on execution through trusted native
macOS bundle plugins while preserving the existing workflow add-on authoring
surface, package integrity model, and runtime-owned publication boundary.

## Overview

The current Swift runtime models add-ons as declarative contracts. It can parse
workflow package add-on metadata and resolve built-ins declaratively, but
addon-only workflow nodes are not executable by the deterministic Swift runner.
Earlier add-on designs also intentionally excluded third-party native
`nodeType: "addon"` executor registration.

Native bundle add-ons fill that gap for trusted, installed Swift plugins. A
node-addon package may declare an execution kind of `native-bundle`, identify a
signed and digest-verified `.bundle` artifact, and expose one or more add-on
entrypoints through a small C ABI that exchanges JSON strings. The Swift runtime
loads the bundle only after package/install validation succeeds, calls the
entrypoint with a runtime-built add-on input envelope, receives an add-on output
envelope, and then hands that output back to the existing runtime publication
path. Plugins never receive stores, session handles, communication ids,
candidate paths, or direct workflow mutation APIs.

## Goals

- Execute trusted installed add-on nodes in the Swift runtime without
  reintroducing TypeScript/Bun add-on execution.
- Keep authored workflow JSON unchanged: workflow nodes continue to use
  `addon: { name, version, config, env, inputs }`.
- Extend package `execution.kind` with `native-bundle` while preserving
  existing `declarative`, `container`, and `local-command` package behavior.
- Make bundle identity, ABI version, content digest, dependency closure digest,
  code-signing requirement, and capabilities visible in `rielflow-package.json`
  before install.
- Use deterministic validation and injected bundle loaders in tests so
  ordinary test runs do not load arbitrary native code.
- Preserve runtime-owned output publication, transition selection, output
  validation, and session/message mutation.
- Keep the first implementation macOS-only, matching the current SwiftPM
  platform contract.

## Non-Goals

- Loading native bundles directly from uninstalled workflow directories.
- Supporting unsigned or digest-unverified production third-party native
  plugins.
- Providing a general plugin marketplace trust policy or interactive permission
  prompt in the first iteration.
- Passing Swift protocol instances, runtime stores, database handles, file
  descriptors, or candidate paths across the plugin ABI.
- Supporting Linux native plugins before a reviewed Swift Linux build contract
  exists.
- Allowing native bundles to shadow reserved `rielflow/*` built-ins.
- Unloading plugins after use; first-version native bundles are process-lifetime
  loaded artifacts.

## Acceptance Criteria

- Authored workflow JSON using `addon: { name, version, config, env, inputs }`
  remains valid without a new native-bundle-specific node shape.
- Swift package validation accepts `execution.kind: "native-bundle"` only for
  installed `kind: "node-addon"` packages with safe bundle paths, exact add-on
  locks, verified package integrity, verified add-on content digest, verified
  Mach-O dependency closure digest, matching bundle identifier, ABI version `1`,
  and explicit capability grants.
- TypeScript/Bun package install, publish, registry, checkout, update, and
  direct-run grant parsing either accept the same native-bundle metadata and
  lock fields as Swift or reject native-bundle packages with an explicit
  version-gate diagnostic.
- Direct workflow directories, direct add-on roots, and unpackaged local test
  fixtures cannot load native bundles unless a test-only injected resolver is
  used; production CLI paths must fail closed.
- Production native bundles must be signed and must satisfy the package-declared
  macOS code-signing requirement before load. Ad-hoc or unsigned bundles are
  limited to explicit test/development fixtures that also use injected loaders.
- Passive validation and ordinary `workflow inspect` never execute plugin code.
  Descriptor loading is allowed only behind an explicit executable preflight.
- Runtime-owned publication remains unchanged: plugins return
  `AddonExecutionOutput` JSON only, and the Swift runtime owns candidate
  normalization, output-contract validation, message publication, transition
  routing, and session mutation.
- Recoverable native-bundle validation, load, descriptor, invocation, and output
  failures produce deterministic diagnostics that include the add-on identity,
  step execution identity, package/source scope, execution phase, and redacted
  failure reason without leaking environment values or runtime-internal paths.
  Process-fatal crashes and non-returning calls are explicitly outside the
  in-process recovery boundary; the runtime records best-effort pre-call audit
  state before entrypoint invocation and documents operator remediation instead
  of promising an in-process diagnostic after the host is gone or wedged.
- Test coverage can run without loading arbitrary native code by using injected
  fake bundle loaders, fake invokers, in-memory installed package records, and
  deterministic fixture manifests.

## Assumptions

- The first implementation targets macOS because the current Swift migration and
  release path are macOS-native; Linux or Windows plugin loading needs a
  separate ABI and packaging review.
- A `.bundle` is trusted only after package checkout verifies package
  integrity, add-on content digest, Mach-O dependency closure, safe paths, and
  dependency-lock grants. This is not a sandbox boundary.
- The host process may keep a loaded bundle resident for its process lifetime.
  Plugin authors must treat module globals as process-scoped state and should
  avoid depending on unload callbacks.
- Existing TypeScript package and add-on metadata remains the compatibility
  source while Swift support is additive.

## Current Behavior And Related Designs

Rielflow already has three relevant add-on surfaces:

- Authored workflows reference add-ons with `workflow.json.nodes[].addon`.
  That shape resolves built-in and installed add-ons while preserving authored
  JSON through save/edit flows.
- Node-addon packages install add-on source directories under project or user
  scope roots and preserve package integrity, add-on `contentDigest`,
  dependency-lock grants, and rollback behavior for executable package kinds
  such as `container` and `local-command`.
- The Swift runtime migration has deterministic workflow validation and runner
  publication contracts, but addon-only workflow nodes are not yet executable by
  the Swift runner through third-party native code.

The native-bundle design extends those contracts rather than replacing them.
It does not add a new workflow node shape, package root, runtime store API, or
publication path. The closest existing behavior is executable node-addon package
validation; the key new behavior is that trusted installed package metadata can
select a signed, digest-verified macOS `.bundle` and invoke it through a narrow
C ABI JSON boundary.

## Authoring And Package Model

Workflow authors keep the existing add-on reference shape:

```json
{
  "id": "summarize-media",
  "role": "worker",
  "addon": {
    "name": "media/native-summary",
    "version": "1",
    "config": {
      "mode": "brief"
    },
    "inputs": {
      "attachmentId": "{{payload.attachmentId}}"
    }
  }
}
```

The node-addon package declares the executable bundle in both the package root
manifest and path-local `addon.json`:

```json
{
  "kind": "node-addon",
  "name": "media/native-summary-addon",
  "version": "1.0.0",
  "addons": [
    {
      "name": "media/native-summary",
      "version": "1",
      "sourcePath": "addons/media/native-summary/1",
      "execution": {
        "kind": "native-bundle",
        "entrypoint": "NativeSummaryPlugin.bundle",
        "abiVersion": 1,
        "bundleIdentifier": "dev.rielflow.examples.NativeSummaryPlugin",
        "codeSignatureRequirement": "anchor apple generic and identifier \"dev.rielflow.examples.NativeSummaryPlugin\"",
        "runtimeHints": ["macos", "swift"]
      },
      "capabilities": [
        {
          "name": "attachment.read",
          "scope": "addon.inputs.attachmentId",
          "required": true,
          "reason": "Receive bounded attachment bytes for the attachment id selected by addon inputs"
        }
      ],
      "contentDigest": "sha256:...",
      "dependencyClosureDigest": "sha256:..."
    }
  ],
  "integrity": {
    "digestAlgorithm": "sha256",
    "digest": "..."
  }
}
```

`execution.entrypoint` names the bundle path relative to the add-on version
directory. The native-bundle-specific fields are:

- `addons[].execution.abiVersion`: integer, required for `native-bundle`,
  initially `1`.
- `addons[].execution.bundleIdentifier`: expected `CFBundleIdentifier`,
  required for `native-bundle`.
- `addons[].execution.codeSignatureRequirement`: required
  designated-requirement text for production `native-bundle` entries. Test and
  development fixtures may omit it only when the caller uses an explicit
  test/development grant and an injected fake loader; production runtime loading
  fails closed without it.
- `addons[].contentDigest`: required digest of the add-on source directory,
  format `sha256:<64 lowercase hex>`.
- `addons[].dependencyClosureDigest`: required for production native bundles,
  format `sha256:<64 lowercase hex>`. Dependency locks, direct-run grants,
  install snapshots, executable preflight, and runtime resolver cache keys must
  carry the same value and fail closed on any mismatch.

Manifest schema locations:

- In the package root `rielflow-package.json`, the key is
  `addons[].dependencyClosureDigest`.
- In the path-local add-on manifest at
  `addons/<namespace>/<name>/<version>/addon.json`, the key is top-level
  `dependencyClosureDigest`, sibling to `execution`, `capabilities`, and any
  package-authored `contentDigest`.
- Package root `addons[].dependencyClosureDigest` and path-local
  `dependencyClosureDigest` must match exactly after canonical digest
  normalization. Missing, malformed, or disagreeing values fail package
  validation, install, lock generation, executable preflight, and runtime
  resolution before descriptor loading.

The path-local `addon.json` carries the same native identity fields without the
package root `addons[]` wrapper:

```json
{
  "name": "media/native-summary",
  "version": "1",
  "execution": {
    "kind": "native-bundle",
    "entrypoint": "NativeSummaryPlugin.bundle",
    "abiVersion": 1,
    "bundleIdentifier": "dev.rielflow.examples.NativeSummaryPlugin",
    "codeSignatureRequirement": "anchor apple generic and identifier \"dev.rielflow.examples.NativeSummaryPlugin\""
  },
  "contentDigest": "sha256:...",
  "dependencyClosureDigest": "sha256:..."
}
```

Validation rules:

- `execution.kind: "native-bundle"` is valid only for `kind: "node-addon"`
  packages.
- `entrypoint` must be a safe package-relative path ending in `.bundle`.
- The bundle path must be under the add-on `sourcePath`.
- `abiVersion` must be exactly `1` until another ABI is designed.
- `bundleIdentifier` must be non-empty and match the loaded bundle metadata.
- `codeSignatureRequirement` must be non-empty for production packages, and the
  runtime must verify the loaded bundle's static code satisfies that requirement
  before resolving symbols.
- `contentDigest` is required and must cover the entire add-on source directory
  through the canonical node-addon content digest described below, including all
  regular files inside the `.bundle`.
- `addons[].dependencyClosureDigest` is required for production native bundles.
  It pins the validated Mach-O dependency closure described below so a
  digest-verified bundle cannot execute undeclared non-system dylibs,
  frameworks, or nested code.
- The package root and path-local `dependencyClosureDigest` fields must both be
  present for production native bundles and must agree exactly. A mismatch uses
  `native_dependency_closure_manifest_mismatch`.
- Native bundle add-ons must declare explicit capabilities. Sensitive
  capabilities still require reasons and dependency-lock grants.
- Project and user scoped installed add-on roots may provide native bundles;
  direct workflow definition directories may not.

Canonical content digest:

- Native-bundle add-ons use SHA-256 over a canonical ordered file list rooted at
  the add-on `sourcePath`. The digest format remains `sha256:<64 lowercase hex>`.
- The file list is built from a canonical digest projection of path-local
  `addon.json`, declared execution metadata, and the complete `.bundle`
  directory. Entries are sorted by bytewise UTF-8 package-relative path using
  `/` separators and no leading `./`.
- The path-local `addon.json` digest projection is not the literal manifest
  bytes. Before hashing that record, validators parse the JSON object, remove
  digest-bearing fields that would otherwise hash themselves, and serialize the
  remaining value with the shared canonical JSON writer. For native-bundle ABI
  v1 the excluded path-local fields are `contentDigest`,
  `dependencyClosureDigest`, and any future `*.Digest` metadata explicitly
  marked as derived from this same add-on source tree. Missing, malformed, or
  disagreeing excluded digest fields still fail manifest validation; exclusion
  affects only the bytes used to compute `contentDigest`.
- The package root `rielflow-package.json` is not part of the add-on
  `contentDigest` because it contains package-level integrity and the
  registry-indexed copy of add-on digest metadata. Package root metadata must
  instead match the recomputed path-local projection digest, the path-local
  `contentDigest`, dependency locks, install snapshots, executable preflight
  records, and runtime resolver snapshots exactly.
- Each regular-file record contributes
  `relativePath`, NUL, normalized mode, NUL, byte length, NUL, base64 file
  content, NUL. The normalized mode records the executable bit as `0644` or
  `0755`; owner, group, timestamps, and platform-specific ACL metadata are not
  part of the digest.
- The bundle digest includes `Info.plist`, the bundle executable, resource
  files, and `_CodeSignature` files when present because they are ordinary
  files under the bundle directory.
- Symbolic links, hard links, sockets, devices, FIFOs, sparse placeholders, and
  paths whose resolved location escapes `sourcePath` are rejected for
  native-bundle packages. Extended attributes are ignored for digest
  reproducibility and must not be required for runtime behavior; code-signing
  validation remains the authority for macOS signature state.
- Published package metadata, checkout provenance, dependency locks, executable
  preflight, and runtime execution must all use the same non-self-referential
  digest routine. A mismatch is a validation failure before descriptor loading.

Mach-O dependency closure:

- Production native-bundle packages must be self-contained except for
  Apple/system libraries from the v1 allowlist below. Every executable Mach-O
  file under the bundle or add-on source path is scanned during install, lock
  generation, executable preflight, and immediately before runtime load.
- The v1 Apple/system allowlist accepts only dependencies that dyld resolves as
  platform-provided system libraries for the current macOS runtime:
  `/usr/lib/libSystem.B.dylib`, other `/usr/lib/*.dylib` entries that are backed
  by the system dyld shared cache, and public Apple frameworks under
  `/System/Library/Frameworks/*.framework` that are also backed by the dyld
  shared cache. The allowlist explicitly rejects dependencies under
  `/System/Library/PrivateFrameworks`, `/Library`, `/usr/local`, `/opt`,
  `/Applications`, package/user install roots, relative paths, and any path that
  only looks system-like after symlink resolution. A dependency is accepted as
  system only when the scanner records both the normalized install name and the
  dyld-cache/platform classification; otherwise it is treated as non-system and
  must resolve inside the add-on `sourcePath`.
- The system allowlist is architecture-aware but not package-pinned by OS build.
  Closure records include the scanned architecture slice and allowlist
  classification, while `dependencyClosureDigest` includes only non-system
  dependency file content and normalized loader records. A macOS update may
  change dyld-cache contents without invalidating installed native-bundle
  packages, but it must not allow a dependency path that was previously
  classified as non-system to become accepted unless it now satisfies the exact
  allowlist criteria above during the immediate pre-load scan.
- Dependency resolution uses only recorded load commands from the scanned Mach-O
  files: `LC_LOAD_DYLIB`, weak/reexport/upward dylib commands, `LC_RPATH`,
  `@loader_path`, and `@rpath`. Native-bundle ABI v1 rejects any non-system load
  command or rpath containing `@executable_path`, because dyld resolves it
  relative to the host executable rather than the bundle executable; allowing it
  would let validation and runtime loading observe different paths. Validators
  must not rewrite `@executable_path` to the selected bundle executable
  directory. The resolver must not consult `DYLD_LIBRARY_PATH`,
  `DYLD_FRAMEWORK_PATH`,
  `DYLD_FALLBACK_LIBRARY_PATH`, current working directory, shell environment, or
  process-global mutable search paths.
- Absolute dependencies outside the Apple/system allowlist are rejected.
  Relative, unresolved, escaping, symlinked, hard-linked, mutable,
  `@executable_path`-dependent, or environment-dependent loader paths are
  rejected. A dependency that resolves outside the immutable add-on `sourcePath`
  is rejected before `dlopen`.
- All non-system dependencies must resolve under the immutable source snapshot,
  be included as regular files in `contentDigest`, satisfy the same production
  code-signing requirement as the top-level bundle, and appear in the canonical
  dependency closure. ABI v1 does not support separate nested-code signing
  requirements; packages that need differently signed private dependencies must
  either sign the dependency closure under the same designated requirement or use
  a future ABI/package metadata revision that adds explicit nested requirement
  fields, lock digests, inspect output, and mismatch diagnostics.
- The closure digest is `sha256:<lowercase-hex>` over a bytewise-sorted list of
  normalized records containing dependency kind, loader file relative path,
  install name, resolved relative path, Mach-O UUID when present, architecture
  slice, file content digest for non-system files, the top-level
  code-signing-requirement digest for non-system files, and system allowlist
  classification for system files. The main bundle executable is part of the
  closure.
- Native-bundle ABI v1 treats actual dyld binding as part of dependency closure
  validation, not as an implementation detail. Before `dlopen`, the loader must
  enumerate already loaded dyld images visible to the process or preflight helper
  and fail closed if any non-system image has the same install name or normalized
  loader identity as a closure non-system dependency but a different realpath,
  content digest, architecture slice, Mach-O UUID, or signing requirement digest.
  This collision check uses `native_dependency_image_collision`.
- Non-system dependency install names must be collision-safe in ABI v1. Accepted
  non-system dependencies must resolve through snapshot-contained
  `@loader_path` or `@rpath` records to one immutable add-on source path, and the
  normalized install name plus resolved relative path must appear in the closure
  digest. Bare names, host-global aliases, ambiguous duplicate install names, and
  rpaths that can resolve to multiple package-local files are rejected with
  `native_dependency_install_name_ambiguous`.
- The production loader must request local, non-global symbol visibility where
  macOS exposes loader flags, for example `RTLD_NOW | RTLD_LOCAL`, and must not
  use `RTLD_GLOBAL` or resolve plugin entrypoints through `RTLD_DEFAULT`.
  Where available, handle-specific lookup should prefer first-image semantics
  such as `RTLD_FIRST`. These flags are defense in depth only; the pre-load and
  post-load image verification rules remain mandatory.
- After `dlopen` and before descriptor symbol lookup or descriptor execution,
  the loader must enumerate the loaded image set again and prove that the main
  bundle executable and every non-system closure dependency are present at the
  selected immutable snapshot realpath with matching content digest,
  code-signing requirement, architecture slice, Mach-O UUID when present, and
  closure record. Any additional non-system image newly loaded because of the
  bundle but absent from the closure, or any closure image bound to a different
  file than the selected snapshot, fails with
  `native_loaded_image_verification_failed`.
- A post-load verification failure may leave images resident in the host process
  because macOS does not guarantee safe bundle unload. The runtime must not call
  descriptor or execute symbols, must not cache the handle, must mark the process
  as unable to execute that native-bundle cache key until restart, and must show
  `restart_required` in inspect output for subsequent attempts in the same
  process. The preflight helper reports the same failure and exits, so its parent
  process remains untainted.
- Validation must re-run the closure scan immediately before descriptor loading
  in executable preflight and immediately before runtime `dlopen`. Any mismatch
  from package metadata, dependency lock, or resolver snapshot fails closed with
  `native_dependency_closure_mismatch`; unresolved dependencies use
  `native_dependency_unresolved`; disallowed absolute or escaping paths use
  `native_dependency_path_denied`; `@executable_path` dependencies use
  `native_dependency_executable_path_denied`; unsigned or
  requirement-mismatched nested code uses `native_dependency_signature_denied`;
  actual loaded-image mismatches use the dyld binding diagnostics above.

Signing policy:

- Production native bundles require a valid macOS code signature, a matching
  `CFBundleIdentifier`, and a package-declared designated requirement. The
  requirement is part of reviewed package metadata and participates in inspect
  output and loader cache identity.
- Ad-hoc signatures, unsigned bundles, or omitted requirements are allowed only
  in deterministic tests and local development paths that supply an explicit
  development grant plus an injected loader. Those paths must be labeled
  `developmentNativeBundle` in diagnostics and must not be accepted by package
  validation for published packages.
- Signature verification happens after digest/path/dependency-closure validation
  and before descriptor loading. A signature failure is a validation/preflight
  failure, not a plugin execution failure.

Capability authority and envelope mapping:

- Package metadata plus the exact workflow dependency lock or explicit
  direct-run development grant are the only v1 capability authority. The native
  bundle descriptor does not declare, expand, or narrow capabilities; descriptor
  metadata is limited to ABI, bundle identity, add-on identity, and execution
  mode.
- `env.read` authorizes copying named, already-resolved `addon.env` bindings into
  `nodePayload.env`. It does not protect or scrub the host process environment,
  and it does not authorize arbitrary environment lookup APIs inside in-process
  plugin code.
- `attachment.read` authorizes a bounded host-mediated attachment projection for
  an explicit `addon.inputs.<field>` value. The v1 envelope maps that field to
  attachment metadata plus inline base64 bytes only when the attachment is below
  the configured native-bundle byte cap. The envelope never contains host
  filesystem paths, file descriptors, temporary path handles, or broad
  attachment-store access.
- `filesystem.read` host-path access is not a v1 native-bundle capability. A
  package that needs path-level reads must use `container`, `local-command`, or a
  later reviewed helper-process native execution mode.
- Output capabilities are separate from input disclosure. Candidate payload and
  dispatch-intent authorization are computed by the runtime from workflow output
  contract state, package capabilities, and dependency-lock grants as described
  in the ABI section.

Resolution and conflict rules:

- Workflow package dependency locks are authoritative for executable add-ons. A
  native bundle lock must pin package id, package kind, authored source-scope
  intent, resolved source scope after checkout, add-on name/version, content
  digest, dependency closure digest, bundle identifier, ABI version, signing
  requirement digest, and capability grants.
- If project and user scopes both contain the same add-on name/version, or if
  multiple installed packages export the same exact add-on identity, validation
  fails closed unless the workflow package lock or explicit direct-run grant
  selects exactly one package id, resolved source scope, content digest, and
  dependency closure digest.
- Direct-run development grants use the same exact pinning fields. Existing
  project-before-user lookup order remains acceptable only for non-executable
  declarative add-ons that do not need a dependency lock.
- A package-provided native bundle can never shadow `rielflow/*`; such
  declarations are rejected before conflict resolution.

## Native Bundle Dependency Locks And Direct Grants

Native-bundle add-ons extend the existing executable node-addon lock shape
instead of introducing a separate workflow field. The extended workflow package
dependency entry is:

Authored workflow package dependency intent:

```json
{
  "packageId": "media/native-summary-addon",
  "registry": "default",
  "branch": "main",
  "kind": "node-addon",
  "sourceScopeIntent": "same-as-workflow-install",
  "addons": [
    {
      "name": "media/native-summary",
      "version": "1",
      "executionKind": "native-bundle",
      "contentDigest": "sha256:...",
      "dependencyClosureDigest": "sha256:...",
      "bundleIdentifier": "dev.rielflow.examples.NativeSummaryPlugin",
      "abiVersion": 1,
      "codeSignatureRequirementDigest": "sha256:...",
      "capabilityGrant": {
        "attachment.read": {
          "allowed": true,
          "scope": "addon.inputs.attachmentId"
        }
      }
    }
  ]
}
```

Field rules:

- Published workflow package manifests must not hard-code a concrete
  `sourceScope` for native-bundle dependencies unless they are explicitly
  operator-local packages. They carry `sourceScopeIntent` instead. The default
  and recommended value is `same-as-workflow-install`, which means package
  checkout installs required node-addon dependencies into the same selected
  project or user scope as the workflow package install operation.
- `sourceScopeIntent` may be omitted only when older package metadata cannot
  represent it; normalization treats omission as `same-as-workflow-install` and
  emits an inspect warning until the package is republished. Explicit values are
  `same-as-workflow-install`, `project`, or `user`. Published registry packages
  should use `same-as-workflow-install`; concrete `project` or `user` intents are
  reserved for operator-local package sets whose documentation states why the
  workflow and add-on dependency must live in different scopes.
- Checkout materializes the concrete resolved scope in installed provenance and
  runtime lock records as `resolvedSourceScope`. Runtime validation, executable
  preflight, inspect, update/replay, and resolver cache keys use
  `resolvedSourceScope`, not the authored intent string. Once materialized,
  `resolvedSourceScope` is exact and is one of `project` or `user`.
- `executionKind` must be `native-bundle` and must match installed package
  metadata.
- `bundleIdentifier`, `abiVersion`, `contentDigest`,
  `dependencyClosureDigest`, and `codeSignatureRequirementDigest` must exactly
  match the installed add-on package metadata. The signing digest is the SHA-256
  digest of the normalized `codeSignatureRequirement` string, not a digest of
  the signed code.
- `capabilityGrant` must cover every required capability from the installed
  package metadata and must not grant undeclared capabilities.
- Any mismatch is a validation failure before descriptor loading; validation
  must not fall back to mutable installed metadata to fill omitted native
  identity fields.

Materialized checkout provenance/runtime lock entry for a project-scope install:

```json
{
  "packageId": "media/native-summary-addon",
  "kind": "node-addon",
  "sourceScopeIntent": "same-as-workflow-install",
  "resolvedSourceScope": "project",
  "addons": [
    {
      "name": "media/native-summary",
      "version": "1",
      "executionKind": "native-bundle",
      "contentDigest": "sha256:...",
      "dependencyClosureDigest": "sha256:...",
      "bundleIdentifier": "dev.rielflow.examples.NativeSummaryPlugin",
      "abiVersion": 1,
      "codeSignatureRequirementDigest": "sha256:...",
      "capabilityGrant": {
        "attachment.read": {
          "allowed": true,
          "scope": "addon.inputs.attachmentId"
        }
      }
    }
  ]
}
```

For a user-scope workflow package install, the same authored dependency intent
materializes as `resolvedSourceScope: "user"`. Package install, update, replay,
validation, inspect, and runtime execution must not compare that user-scoped
installed dependency against an authored project-scope lock. They compare
against the materialized runtime lock and checkout provenance.

Update and replay rules:

- Package update/replay reuses the installed workflow package's selected scope
  by default and re-materializes native-bundle dependency provenance in that
  same scope.
- Moving an installed workflow package between project and user scope is a
  reinstall or explicit migration operation, not a silent update. The migration
  must produce new `resolvedSourceScope` provenance and must revalidate every
  native-bundle dependency lock before execution.
- If project and user scopes both contain the same add-on identity, the
  materialized `resolvedSourceScope` selects exactly one source. Validation fails
  closed if the selected scope is missing, stale, digest-mismatched, or
  shadowed by a different package than the materialized provenance names. It
  does not fall back to the other scope.

Code-signing requirement canonicalization:

- The canonical digest input is the UTF-8 bytes of the exact manifest
  `codeSignatureRequirement` after trimming leading and trailing ASCII
  whitespace, converting CRLF and CR line endings to LF, collapsing each internal
  run of ASCII whitespace to one U+0020 space, and preserving quoted substrings
  byte-for-byte except for line-ending normalization before quote parsing.
- The canonical form must compile successfully through macOS `SecRequirement`
  before install, lock generation, executable preflight, or bundle load. Invalid
  requirement syntax is a validation failure and never receives a digest.
- The digest string is `sha256:<lowercase-hex>` over that canonical UTF-8 byte
  sequence. Swift and TypeScript package tooling must share fixture vectors for
  equivalent whitespace, invalid syntax, quoted identifiers, and different
  semantically meaningful requirement text.
- The loader cache key and dependency lock use this canonical digest, while CLI
  inspect may render both the digest and a redacted/summarized requirement text.
  Implementations must not use platform-specific re-rendered requirement text as
  the digest input because different Security.framework versions may render
  equivalent requirements differently.

Direct-run development grants use the same native identity fields plus package
identity, but they do not use `sourceScopeIntent`. Because no package checkout
operation materializes provenance for them, they must carry exact concrete
`sourceScope`. They are accepted only for explicit development/test execution
modes and must be reported distinctly in inspect output:

```json
{
  "packageId": "media/native-summary-addon",
  "kind": "node-addon",
  "sourceScope": "project",
  "addons": [
    {
      "name": "media/native-summary",
      "version": "1",
      "executionKind": "native-bundle",
      "contentDigest": "sha256:...",
      "dependencyClosureDigest": "sha256:...",
      "bundleIdentifier": "dev.rielflow.examples.NativeSummaryPlugin",
      "abiVersion": 1,
      "codeSignatureRequirementDigest": "sha256:...",
      "capabilityGrant": {
        "attachment.read": {
          "allowed": true,
          "scope": "addon.inputs.attachmentId"
        }
      }
    }
  ]
}
```

Direct-run grants fail closed when `sourceScope` is missing, when both project
and user scopes contain matching identities but the grant does not exactly name
one scope, or when the selected scope no longer contains the pinned package id,
content digest, dependency closure digest, signing requirement digest, and
capability grants.

The Swift and TypeScript contract surfaces that must accept and validate these
fields are:

- Swift `Sources/RielflowAddons/WorkflowPackageManifest.swift`:
  `WorkflowPackageAddonExecutionKind`,
  `WorkflowPackageAddonExecutionDescriptor`,
  `WorkflowAddonCapability`,
  `WorkflowPackageManifestAddonDependencyLock`, and dependency validation.
- TypeScript `packages/rielflow/src/workflow/packages/types.ts`:
  `WorkflowPackageAddonExecutionKind`,
  `WorkflowPackageAddonExecutionDescriptor`, and
  `WorkflowPackageManifestAddonDependencyLock`, plus
  `WorkflowAddonCapabilityName` for `attachment.read`.
- TypeScript `packages/rielflow/src/workflow/packages/manifest.ts` and
  `packages/rielflow/src/workflow/packages/addon-metadata.ts`: manifest
  normalization and unsupported-key rejection.
- TypeScript `packages/rielflow/src/workflow/packages/node-addon-install.ts`,
  `checkout-node-addon.ts`, `package-addon-locks.ts`, and
  `dependencies.ts`: install, checkout provenance, exact lock matching, and
  rollback.
- TypeScript direct-run grant parsing in
  `packages/rielflow/src/cli/workflow-run-command.ts`.

## User-Visible Flows

Package author flow:

1. Build a signed macOS `.bundle` that exports ABI v1 symbols.
2. Declare `execution.kind: "native-bundle"` in both `rielflow-package.json`
   and the path-local `addon.json`, including bundle identifier, ABI version,
   code-signing requirement, content digest, dependency closure digest, and
   explicit capabilities.
3. Publish or stage the node-addon package through normal package tooling.
4. Package validation rejects unsafe paths, reserved `rielflow/*` names,
   missing integrity, missing dependency closure metadata, unsigned production
   bundles, malformed capabilities, and manifest/addon disagreement before the
   package can be installed.

Workflow author flow:

1. Reference the add-on with the existing `addon: { name, version, config, env,
   inputs }` object.
2. Depend on the node-addon package through a workflow package dependency lock
   or use an explicit direct-run development grant for local development.
3. Run passive validation to verify metadata and lock consistency without
   loading native code.
4. Optionally run executable preflight to load the descriptor in a short-lived
   helper process before a real workflow run.
5. Run the workflow; plugin output is accepted only through existing
   runtime-owned output validation and publication.

Scope resolution examples:

- Project-scope workflow package install:
  `rielflow package install media/workflow-summary` selects project scope for
  the workflow package and materializes each
  `sourceScopeIntent: "same-as-workflow-install"` native-bundle dependency as
  `resolvedSourceScope: "project"`. Inspect output shows both the authored
  intent and resolved scope. Update/replay reinstalls or revalidates the
  dependency in project scope and fails closed if only a user-scope matching
  add-on is available.
- User-scope workflow package install:
  `rielflow package install --user-scope media/workflow-summary` selects user
  scope for the workflow package and materializes the same authored dependency
  intent as `resolvedSourceScope: "user"`. Validation, executable preflight,
  runtime execution, inspect, update, and replay use that user-scoped
  provenance. They must not compare the user install to a project-scoped lock or
  silently fall back to a project add-on with the same identity.
- Direct-run development grant:
  A local workflow run outside package checkout must provide concrete
  `sourceScope: "project"` or `"user"` plus exact package id, add-on identity,
  digests, signing requirement digest, and grants. Inspect output labels the
  source as `developmentNativeBundle`, shows the exact source scope, and reports
  no `sourceScopeIntent` because no package installer resolved it.

Operator inspection flow:

1. `workflow inspect --output json` shows the selected package, authored
   `sourceScopeIntent` when present, `resolvedSourceScope` or direct-run
   `sourceScope`, bundle identity, ABI version, digests, signing state,
   dependency closure status, capability grants, preflight status, snapshot
   retention state, and cache status.
2. Failure output uses stable diagnostic codes and redacted paths or values so
   package authors can fix manifests without exposing secrets or runtime-owned
   filesystem locations.

Operator failure flow:

- Invalid or stale native metadata fails before descriptor loading.
- Missing helper support affects executable preflight only; passive validation
  and ordinary package inspection remain available.
- A runtime process that has loaded an old snapshot reports
  `restart_required` instead of silently switching to a new package snapshot.
- A plugin crash or wedged in-process call is a trusted-code failure outside
  deterministic in-process recovery; the last pre-call audit record remains the
  diagnostic anchor for operator remediation.

## Cross-Runtime Package Metadata Compatibility

`rielflow-package.json` remains a shared product contract during the Swift
migration. Native-bundle packages are therefore not Swift-only metadata unless a
future release deliberately gates them behind a Swift-only package installer.
The first implementation should update both Swift and TypeScript/Bun package
metadata surfaces to recognize `native-bundle` before any native-bundle package
is considered installable or publishable.

Compatibility requirements:

- TypeScript package manifest types, normalizers, install validation, checkout
  records, package search/indexing, package publish validation, and package
  update/replay logic must accept `native-bundle` metadata and reject malformed
  native-bundle fields with deterministic diagnostics.
- Existing TypeScript runtime execution may still report
  `native-bundle-runtime-unsupported` when asked to execute a native-bundle
  add-on. It must not silently reinterpret it as `local-command`,
  `container`, or `declarative`.
- Swift validate/inspect/run and TypeScript package install/publish/registry
  commands must agree on the exact native-bundle lock fields, source-scope
  semantics, digest normalization, and reserved-name rejection rules.
- If an implementation cannot update TypeScript/Bun package commands in the
  same release, package install and publish must fail closed with a version-gate
  diagnostic such as `native-bundle-package-requires-swift-package-manager`,
  and registry entries must not advertise such packages as generally
  installable.
- Documentation for package authors must state the minimum Rielflow version and
  whether a native-bundle package is Swift-runtime-only for execution.

## Data Model

The Swift package contract adds `native-bundle` to
`WorkflowPackageAddonExecutionKind` and keeps the existing package/add-on
ownership boundaries:

- `RielflowCore` owns authored workflow node references, runtime input/output
  envelopes, output validation, publication requests, transition decisions, and
  runtime diagnostics.
- `RielflowAddons` owns package manifest projections, installed add-on metadata,
  native bundle manifest validation, capability grants, resolver protocols, and
  invocation diagnostics.
- `RielflowCLI` owns command flags and output rendering for validate, inspect,
  and run flows. It wires concrete loaders only for execution or explicit
  executable preflight.

Native-bundle-specific records:

- `NativeBundleAddonLock`: package id, package kind, authored
  `sourceScopeIntent` when produced by package checkout, concrete
  `resolvedSourceScope` for installed workflow package locks or exact
  `sourceScope` for direct-run development grants, add-on name/version,
  execution kind, content digest, bundle identifier, ABI version, dependency
  closure digest, code-signing requirement digest, and capability grants.
- `NativeBundleAddonManifest`: package name, add-on name/version, resolved
  install scope, add-on source path, bundle relative path, ABI version, expected
  bundle identifier, content digest, capabilities, code-signing requirement,
  dependency closure digest, immutable install id or metadata generation, and
  package checkout provenance.
- `NativeBundleDependencyClosure`: canonical scan result for executable Mach-O
  files and their non-system dylib/framework dependencies, including loader
  relative path, install name, resolved relative path, architecture slice, Mach-O
  UUID when present, non-system file digest, top-level code-signing requirement
  digest for non-system files, and v1 system allowlist classification. ABI v1 has
  no per-dependency nested signing-requirement field.
- `NativeBundleDescriptor`: descriptor JSON returned by
  `rielflow_plugin_descriptor_v1`, including ABI version, bundle identifier,
  exported add-on identities, and execution mode
  (`host-call-synchronous` for ABI v1).
- `NativeBundleExecutionRecord`: non-secret runtime audit projection with
  session id, step id, step execution id, attempt number, reusable node id,
  add-on identity, package name, resolved or direct-run source scope, content
  digest, bundle identifier, phase, duration, status, and redacted diagnostic
  codes.
- `NativeBundleCacheKey`: resolved or direct-run source scope, package id,
  package version or install id, add-on name/version, bundle identifier, ABI
  version, content digest, dependency closure digest, and code-signing
  requirement digest.
- `NativeBundleInstallSnapshot`: install id, metadata generation, resolved
  immutable root, package id/version, concrete source scope, add-on identity,
  canonical content digest, dependency closure digest, signing requirement
  digest, and loader-visible bundle path.

Native bundle metadata is derived from installed package records; authored
workflow JSON never carries bundle paths, host dylib paths, code-signing
requirements, or capability grants.

## Plugin ABI

Swift object protocols are not the first-version ABI. The plugin exports three C
symbols and exchanges UTF-8 JSON strings:

```swift
@_cdecl("rielflow_plugin_descriptor_v1")
func descriptor() -> UnsafeMutablePointer<CChar>?

@_cdecl("rielflow_plugin_execute_v1")
func execute(_ inputJSON: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?

@_cdecl("rielflow_plugin_free_v1")
func freePluginString(_ pointer: UnsafeMutablePointer<CChar>?)
```

The descriptor JSON identifies the bundle:

```json
{
  "abiVersion": 1,
  "bundleIdentifier": "dev.rielflow.examples.NativeSummaryPlugin",
  "addons": [
    {
      "name": "media/native-summary",
      "version": "1",
      "executionMode": "host-call-synchronous"
    }
  ]
}
```

ABI v1 execution is host-call synchronous. A plugin may perform internal async
work before returning, but the host receives exactly one returned JSON string
from `rielflow_plugin_execute_v1`; there is no task id, callback, poll handle,
stream, or late-completion channel. Any design requiring hard deadlines,
out-of-process cancellation, or detached async completion must use a future
helper-process execution kind instead of this in-process ABI.

The execution input is the existing add-on input contract plus non-secret
step-execution metadata. It intentionally excludes broad workflow variables,
message rows, runtime stores, candidate paths, communication ids, and installed
host filesystem paths:

```json
{
  "addonName": "media/native-summary",
  "version": "1",
  "stepId": "summarize-media-step",
  "stepExecutionId": "step-exec-000042",
  "attempt": 1,
  "nodeId": "summarize-media",
  "nodePayload": {
    "config": {},
    "env": {},
    "inputs": {}
  },
  "source": {
    "packageName": "media/native-summary-addon",
    "addonName": "media/native-summary",
    "provenanceId": "project:media/native-summary-addon@1.0.0:sha256:...",
    "logicalSourcePath": "addons/media/native-summary/1",
    "builtin": false
  },
  "options": {
    "executionMode": "host-call-synchronous",
    "cooperativeDeadlineSeconds": 120,
    "cancellationRequested": false,
    "allowCandidatePayload": true,
    "allowDispatchIntents": false
  }
}
```

The output JSON maps to `AddonExecutionOutput`:

```json
{
  "candidatePayload": {
    "text": "summary"
  },
  "dispatchIntents": [],
  "diagnostics": []
}
```

The plugin owns only local computation inside this envelope. Runtime message
publication, transition routing, candidate validation, and root output
selection remain in `RielflowCore`.

The native input envelope is minimum-disclosure by default:

- `nodePayload.config`, `nodePayload.env`, and `nodePayload.inputs` contain only
  the resolved add-on fields that existing workflow authoring already names.
- `stepId`, `stepExecutionId`, and `attempt` identify the concrete step
  execution for diagnostics, cancellation, retry recovery, publication
  correlation, and audit records. Publication and retry decisions are keyed by
  this step execution identity, not only by reusable `nodeId`.
- Workflow variables, resolved upstream messages, operator environment values,
  session stores, and candidate output destinations are omitted unless a future
  reviewed capability explicitly defines a specific value class, lock field,
  redaction behavior, and tests proving ungranted values are absent.

Output-control flags are deterministic runtime decisions:

- `allowCandidatePayload` is true only for runtime execution of an add-on-backed
  step whose workflow node is allowed to produce a candidate payload for the
  existing output-contract/publication path. It is false for descriptor preflight,
  validation-only calls, and any future observer-only add-on invocation. If false,
  a returned `candidatePayload` fails output validation with
  `native_candidate_payload_denied` and nothing is published.
- `allowDispatchIntents` defaults to false. It becomes true only when both the
  workflow/node output contract permits dispatch intents for the current step and
  the installed package capability grants plus dependency lock explicitly allow
  each returned `dispatch.intent.<kind>` capability for the declared target
  scope. If false, any non-empty `dispatchIntents` array fails with
  `native_dispatch_intent_denied`.
- Even when `allowDispatchIntents` is true, plugin dispatch intents are advisory
  output values. The Swift runtime still validates them against the current
  step's transition contract, output contract, and publication rules before any
  routing or message publication effect is created.

`cooperativeDeadlineSeconds` is not a hard timeout. It tells trusted plugin code
when the runtime will reject late output after control returns. Hard
preemption, killing a stuck descriptor, or killing a stuck execute call is
outside the in-process ABI and requires a future helper-process execution kind.

ABI invariants:

- ABI v1 has one synchronous host call for descriptor loading and one
  synchronous host call for execution. Descriptor metadata and invocation options
  must use `executionMode: "host-call-synchronous"`; `sync`, `async`, callback,
  polling, and detached-completion modes are invalid in v1.
- Plugin input never includes installed host filesystem paths by default.
  `source.provenanceId` is an opaque runtime-generated identity, and
  `source.logicalSourcePath` is package-relative metadata for diagnostics only.
  Attachment data may enter `nodePayload.attachments` only through the bounded
  `attachment.read` mapping; durable-root or host-path access requires a future
  explicitly reviewed filesystem capability. Otherwise plugins receive values,
  not host paths.
- Host input strings are null-terminated UTF-8 JSON and must be copied by the
  callee before returning from `execute`.
- Descriptor and execute outputs are plugin-allocated, null-terminated UTF-8 JSON
  strings. The host must release both descriptor and execute outputs exactly once
  through `rielflow_plugin_free_v1`; the plugin must tolerate `nil` passed to
  the free symbol.
- The host must convert plugin-returned pointers with a bounded NUL search
  before any string construction. For descriptor and execute outputs, scan at
  most 16 MiB plus one byte. If no NUL appears within that bound, the phase
  fails with `native_output_missing_nul`, the pointer is released exactly once,
  and no JSON decoder receives the unbounded memory region.
- If the first 16 MiB plus one byte contains a NUL after the 16 MiB payload
  limit, the phase fails with `native_output_too_large`, releases the pointer
  exactly once, and does not attempt partial JSON decoding.
- Invalid UTF-8, malformed JSON, null returned pointers, missing NUL, and
  oversized output use the same release-on-failure rule. Release happens after
  bounded pointer handling and before the diagnostic leaves
  `NativeBundlePluginInvoker`.
- Pointer faults while scanning or freeing plugin memory are process-fatal native
  code failures outside the in-process recovery boundary. The design does not
  promise deterministic recovery after such faults; helper-process execution is
  required for that guarantee.
- `rielflow_plugin_free_v1` is a required symbol. If it is missing, the loader
  fails before descriptor execution. A null descriptor or execute pointer is a
  deterministic plugin failure for that phase.
- Descriptor and execute output strings have the same maximum accepted JSON byte
  size as runtime output candidates, capped at 16 MiB for the first native ABI.
  Larger strings fail validation and are still released through the free symbol.
- The host serializes descriptor, execute, and free calls per loaded bundle in
  ABI v1. Plugins may be internally thread-safe, but the first host contract does
  not rely on concurrent entrypoint invocation.
- Missing symbols, null descriptor strings, invalid UTF-8, malformed JSON,
  unsupported ABI versions, unknown add-on identities, and mismatched bundle
  identifiers fail before execution.
- Descriptor metadata must agree with the installed package metadata. Package
  metadata remains authoritative when conflicts occur.
- Plugins must not infer runtime-owned output destinations. Candidate payloads
  are values, not file paths or publication instructions.

## Runtime Architecture

The Swift implementation adds an injected native bundle resolver under
`RielflowAddons`:

- `NativeBundleAddonManifest` is a validated projection from package metadata.
- `NativeBundlePluginLoader` performs pre-load dyld image collision checks,
  loads a bundle with local/non-global symbol visibility, verifies the actual
  post-load dyld image set against the selected immutable dependency closure,
  and only then returns handle-specific function pointers.
- `NativeBundlePluginInvoker` validates descriptor JSON, invokes the execute
  symbol, performs bounded pointer-to-JSON conversion, frees returned strings
  exactly once on success and failure, decodes output JSON, and normalizes
  failures into `AddonDiagnostic`.
- `NativeBundleAddonResolver` implements `AddonResolving` and dispatches only
  add-ons whose installed package metadata authorizes `native-bundle`.
- `NativeBundleLoadedRegistry` caches loaded handles by
  `NativeBundleCacheKey`; it must never reuse a handle for a different content
  digest, dependency closure digest, signing requirement, resolved or direct-run
  source scope, package install id, bundle identifier, or loaded-image
  verification fingerprint. A cache key that previously failed post-load image
  verification is recorded as `restart_required` for the remainder of the
  process lifetime.

Installed snapshot invariants:

- Package checkout installs native-bundle artifacts into an immutable install
  snapshot identified by a stable install id or content-addressed path. Updates
  stage into a new snapshot and atomically update installed-package metadata only
  after validation succeeds; they must never mutate bundle files in a path that a
  running process may validate, preflight, or load.
- Resolver output includes the install id, metadata generation, canonical
  resolved root, content digest, signing requirement digest, bundle identifier,
  dependency closure digest, and ABI version. That snapshot record is the only
  source used by preflight and execution.
- The resolver either holds a package install read lock across resolve,
  validation, signature verification, and `dlopen`, or reopens the snapshot and
  rechecks metadata generation, realpath containment, canonical digest, code
  signature requirement, Mach-O dependency closure, and bundle identifier
  immediately before loading.
- If metadata generation changes, the snapshot disappears, the resolved root
  moves, or any pre-load recheck differs from the dependency lock or resolver
  snapshot, the runtime fails closed with a deterministic stale-snapshot or
  `restart_required` diagnostic. It must not retry against a different installed
  package in the same execution.
- Snapshot retention is conservative. A snapshot that has been loaded by an
  execution process or by an executable preflight helper is pinned until that
  process exits. Package update/remove marks the old snapshot
  `pending_cleanup_after_restart` instead of deleting it while any live process
  may reference its bundle image or bundle-local resources.
- Garbage collection may remove pending snapshots only when no live process lock,
  process marker, or startup-recovered loaded/preflight record references the
  snapshot. Cleanup runs at package update completion and runtime startup; stale
  markers from dead processes are cleared only after verifying the process id no
  longer exists and the marker belongs to the current machine/user scope.
- Inspect/status surfaces report `active`, `pending_cleanup_after_restart`, or
  `stale_marker_recovered` snapshot state so package updates, rollback,
  `restart_required` diagnostics, and cleanup behavior are visible.

The runner receives an optional `AddonResolving` port. When the workflow step's
registry node has an add-on and no `nodeFile`, the runner builds an
`AddonExecutionInput`, invokes the resolver, converts a resolved output into an
adapter-like accepted output candidate, and publishes through the same
`WorkflowOutputPublishing` path used for agent nodes.

The runner must pass the current step identity into the native invocation before
calling any descriptor or execute entrypoint. `stepId`, `stepExecutionId`, and
`attempt` are required on invocation records, diagnostics, cancellation checks,
retry bookkeeping, and publication correlation. Multiple steps may reuse the
same workflow node, and one step may be retried; those executions must remain
separate even when they load the same native bundle handle from cache.

The runner must fail closed when:

- no add-on resolver is injected for an executable add-on node;
- the resolver returns `failed` diagnostics;
- a plugin returns malformed JSON or output that violates add-on output rules;
- a plugin returns `candidatePayload` when `allowCandidatePayload` is false;
- a plugin tries to return dispatch intents when the invocation options deny
  them;
- multiple transitions would be publishable from the resulting candidate.

State transitions:

1. `authored`: workflow node contains an ordinary `addon` reference.
2. `resolved`: add-on lookup finds installed package provenance and normalized
   native bundle metadata that exactly matches the workflow package dependency
   lock or explicit direct-run development grant, and captures an immutable
   install snapshot or read lock.
3. `validated`: passive validation verifies package metadata, digest locks,
   dependency closure locks, capability grants, safe paths, and platform support
   without loading code.
4. `preflighted`: optional executable validation verifies code signature in a
   short-lived preflight helper process, rechecks the Mach-O dependency closure,
   loads the descriptor only in that helper, and verifies ABI, symbols, bundle
   identifier, and exported add-on identity without populating the runtime
   execution cache.
5. `loaded`: runtime execution loads or reuses the bundle through the injected
   loader after validation has succeeded.
6. `invoked`: runtime passes the resolved input envelope for one concrete step
   execution attempt and receives output JSON or failure diagnostics.
7. `normalized`: runtime validates and converts output into the existing
   candidate/publication boundary.
8. `published` or `failed`: runtime publishes through
   `WorkflowOutputPublishing` for that step execution attempt, or records
   deterministic failure without publishing downstream messages.

Preconditions:

- The selected workflow has already passed ordinary workflow validation.
- The add-on reference resolves to installed package metadata in project or user
  scope, not to files inside the direct workflow directory.
- The workflow package dependency lock or direct-run development grant includes
  native-bundle identity fields and matches installed metadata exactly.
- The current platform is macOS. Runtime execution has a concrete loader
  injected only for actual execution, while executable preflight uses the
  short-lived preflight helper contract described below.
- Capability grants are present and match the exact add-on content digest.
- The package dependency lock or direct-run development grant pins the Mach-O
  dependency closure digest, and the installed snapshot can revalidate that
  closure without consulting mutable environment search paths.

Lifecycle and rollback:

- Package checkout remains the only mutation point for native bundle artifacts.
  If checkout or caller workflow validation fails, installed package changes
  roll back using the existing package checkout rollback model.
- Runtime execution does not copy or rewrite bundle files. It validates the
  immutable snapshot selected at resolution and performs immediate pre-load
  digest/dependency-closure/signature/identifier rechecks before descriptor
  loading. A digest, dependency closure, provenance, metadata-generation, or
  realpath mismatch after checkout causes execution to fail before load.
- Process-lifetime loading means a package update cannot replace code inside an
  already-running process. If installed metadata for the selected package/add-on
  now points at a different snapshot, content digest, dependency closure digest,
  signing requirement, or bundle identifier than an already-loaded handle, the
  resolver must fail with a `restart_required` diagnostic instead of reusing
  stale code or loading the same path under new metadata.
- Failed plugin execution records remain inspectable, but no downstream
  workflow messages are published and no candidate output destination is
  committed.

## Security And Safety

Native bundles are in-process code. The first version treats them as trusted
installed code and relies on package install verification plus explicit
operator choice, not sandboxing.

Required safety boundaries:

- No runtime-mediated environment forwarding. `addon.env` remains an explicit
  mapping and native plugins receive resolved values in `nodePayload.env` only
  when package metadata plus the dependency lock or direct-run grant allow
  `env.read`. The bundle descriptor does not grant environment access.
  Operators must assume trusted in-process native bundles can read the host
  process environment through ordinary process APIs; `env.read` controls only
  what Rielflow copies into the JSON envelope. Per-plugin environment secrecy
  requires `container`, `local-command`, or a future helper-process native mode.
- No runtime internals cross the ABI. Plugins receive JSON values and return JSON
  values.
- No bundle loading during workflow validation unless an explicit executable
  preflight asks for it. Passive validation checks metadata and installed file
  provenance only.
- Bundle loading is injectable in tests; deterministic tests use fake loaders
  and invokers instead of real dynamic libraries.
- Error messages and diagnostics pass through existing redaction policy before
  becoming CLI, GraphQL, or artifact output.
- Package install and validation recompute content digests after checkout and
  dependency closure digests after checkout and reject symlink traversal or
  dynamic dependency resolution that would make a safe-looking bundle path load
  code outside the installed package root.
- Package updates stage native-bundle files into new immutable snapshots; runtime
  validation and loading must never follow a mutable installed path without a
  lock or immediate pre-load revalidation.
- In-process native bundle execution does not provide hard kill, hard timeout,
  or hard cancellation semantics. A future isolated helper process is required
  before Rielflow can enforce those guarantees for native bundles.

Permission handling:

- Capabilities are host-mediated data grants, not OS-level denials. They define
  which values Rielflow will place in the plugin input envelope and which output
  intents Rielflow will accept from the plugin.
- Native-bundle ABI v1 has no broad `variables` field. If a workflow variable is
  needed by a plugin, workflow authoring must map that value explicitly into
  `addon.inputs` or `addon.env`, where existing input/env validation,
  capability grants, dependency locks, and redaction rules can apply.
- `env.read` is granted per named environment binding; native plugins receive
  resolved values only through `nodePayload.env`. This is not a secrecy boundary
  for the ambient process environment because the plugin is trusted in-process
  code. Deployment-level environment scrubbing may reduce accidental exposure for
  the whole Rielflow process, but it is not a per-plugin authorization control.
- Dispatch intents default to denied for native bundles. A package may return a
  dispatch intent only when its manifest declares an exact
  `dispatch.intent.<kind>` capability and the workflow package dependency lock
  or direct-run grant explicitly allows that capability and scope. The runtime
  derives `allowDispatchIntents` and the allowed intent-kind set from those
  grants; authored workflow JSON cannot enable dispatch intents by itself.
- Dispatch intent scopes are reviewed strings such as `workflow.transition`,
  `chat.reply`, or `artifact.write`. The grant scope must match the declared
  capability scope, and the returned intent payload must validate against the
  runtime schema for that intent kind before any publication or side effect.
- Undeclared, ungranted, denied, malformed, mixed allowed/denied, or
  unredactable dispatch intents fail the whole add-on output before candidate
  publication. Diagnostics include the denied intent kind and redacted path but
  never publish the allowed subset from a partially denied response.
- Native-bundle ABI v1 does not support generic `filesystem.read` or
  `filesystem.write` capability grants. A native bundle receives file content
  only through the `attachment.read` host-mediated delivery contract below.
  Host absolute paths are rejected from the input envelope.
- Network or subprocess privileges are not automatically enforced by in-process
  bundles. If strict OS-level isolation is required, the package must use
  `container` or `local-command` execution instead.

Attachment delivery contract:

- `attachment.read` is a native-bundle v1 host-mediated data grant, not a
  filesystem permission. Its scope must be `addon.inputs.<fieldName>`, where
  that input field resolves to one runtime attachment id or descriptor.
- When granted, the runtime resolves the selected attachment before plugin
  execution and adds a bounded `nodePayload.attachments` object keyed by input
  field name. The plugin receives attachment values, never attachment root
  paths, runtime stores, file descriptors, or candidate paths.
- Each delivered attachment entry has this shape:

```json
{
  "nodePayload": {
    "inputs": {
      "attachmentId": "att_123"
    },
    "attachments": {
      "attachmentId": {
        "id": "att_123",
        "mediaType": "text/plain",
        "filename": "note.txt",
        "sizeBytes": 1024,
        "sha256": "sha256:...",
        "contentBase64": "..."
      }
    }
  }
}
```

- Native-bundle v1 accepts only bounded in-memory attachment delivery. The
  first-version limit is 8 MiB per attachment and 16 MiB total native input
  envelope size after JSON serialization. Larger attachments fail before
  descriptor/execute with `native_attachment_too_large`; they are not exposed as
  host paths.
- Attachment content is omitted from CLI, GraphQL, logs, diagnostics, and
  runtime artifacts by default. Inspection surfaces may show id, media type,
  filename, size, and SHA-256 only.
- Missing attachments, multiple attachments for a single-scope grant, scope
  mismatch, unsupported attachment descriptors, malformed content hashes,
  ungranted attachment inputs, and serialization over the input-envelope limit
  fail before plugin execution with deterministic redacted diagnostics.
- Future streaming, file-descriptor, durable-root, or host-path attachment
  access requires a separate reviewed capability and must not be inferred from
  `attachment.read`.

Attachment integration with existing Rielflow descriptors:

- `attachment.read` accepts existing workflow input descriptors only after the
  runtime has normalized and authorized them. The plugin-facing envelope always
  uses the single bounded shape above; provider-specific fields are never passed
  through directly.
- Accepted v1 sources are:
  - `event.input.attachments[]` entries with a safe data-root-relative
    `contentRef` produced by chat-sdk, Discord, Telegram, webhook, or other
    event adapters.
  - SQLite/message-store attachments materialized as
    `{ "pathBase": "attachment-root", "path": "<relative>" }` under
    `RIEL_ATTACHMENT_ROOT`.
  - GraphQL/manager-message `DataDirFileRef` attachments after manager auth has
    already verified the path stays within
    `files/{workflowId}/{workflowExecutionId}/...`.
  - Matrix attachment descriptors that already contain bounded `contentText`;
    these project as UTF-8 `text/plain` bytes with a generated SHA-256.
  - Inline descriptors that already contain bounded `contentBase64`,
    `mediaType`, `sizeBytes`, and `sha256`.
- Metadata-only descriptors are unsupported for v1 attachment projection unless
  a runtime-owned resolver has already materialized safe bytes. This includes
  provider URLs, Discord proxy URLs, Matrix `mxc`/media URLs, Telegram file ids,
  encrypted Matrix attachments, and image/PDF descriptors that have only
  metadata. The diagnostic is `native_attachment_metadata_only`.
- `localPath`, `contentRef`, `path`, `pathBase`, provider URLs, attachment root
  paths, data root paths, and manager namespace paths are host-only resolver
  inputs. They must not appear in `nodePayload.attachments`, logs, GraphQL, CLI
  inspect output, plugin diagnostics, or candidate payloads unless a future
  reviewed capability explicitly allows such disclosure.
- The Swift runtime uses an injected `AttachmentProjectionPort` owned by
  `RielflowCore`/runtime wiring to turn authorized descriptors into bounded
  inline attachment values. `RielflowAddons` validates grants and receives only
  projected values; native bundle loaders never read attachment roots directly.
- TypeScript/Bun compatibility must reuse the same descriptor acceptance matrix
  for package tests and direct-run grants. Existing event adapters and
  manager-message validation remain the owners of provider-specific attachment
  normalization and namespace checks.

Error handling:

- Validation errors use deterministic package/add-on paths and never attempt to
  repair manifests.
- Loader errors distinguish missing bundle, unsafe path, digest mismatch,
  platform unsupported, code signature unavailable, missing symbols, descriptor
  mismatch, cooperative deadline exceeded, and non-returning plugin
  limitations.
- Invocation errors include plugin failure diagnostics when valid JSON is
  returned. Crashes or process-fatal failures are outside the in-process
  recovery boundary and should be documented as a trust limitation.
- Before descriptor or execute entrypoint invocation, the runtime writes a
  best-effort pre-call execution record keyed by workflow session, step id, step
  execution id, attempt, package/add-on identity, phase, and cache key. On normal
  return the record is completed with status and redacted diagnostics. If the
  host process later restarts after a crash, inspection may report the last
  pre-call record as `unknown_host_terminated`; a wedged non-returning process
  has no in-process recovery and requires operator termination or a future
  helper-process execution mode.
- Cancellation before descriptor load or execution records a deterministic
  cancelled diagnostic and does not load or call the bundle. Cancellation after
  an in-process descriptor or execute call starts is cooperative only: the
  runtime passes a deadline/cancellation flag in the input envelope, records
  `cancellation_requested` when it regains control, and never publishes output
  from a call whose deadline was already exceeded. A non-returning plugin may
  require operator process termination.
- Output errors are normalized through existing candidate/output-contract
  validation and keep publication fail-closed.
- Dispatch intent errors are normalized before publication and distinguish
  `native_intent_undeclared`, `native_intent_ungranted`,
  `native_intent_denied`, `native_intent_malformed`, and
  `native_intent_unredactable`.

Observability:

- CLI validation and inspect JSON include authored source-scope intent,
  resolved source scope or exact direct-run source scope, package name, add-on
  identity, execution kind, ABI version, bundle identifier, content digest,
  dependency closure digest/status, actual loaded-image verification status,
  signing requirement summary, capability summary, conflict status, stale-load or
  restart-required status, snapshot retention state, dispatch intent grant
  summary, preflight helper process status, and preflight status when available.
- CLI, GraphQL, and runtime artifacts use stable redacted diagnostic codes for
  missing native output NUL, oversize native output, denied or ungranted dispatch
  intent, malformed intent payload, and unredactable intent payload failures.
- Runtime logs/spans include step id, step execution id, attempt, and phase
  timings for resolution, validation, pre-load dyld collision check, `dlopen`,
  post-load image verification, descriptor load, invocation, output
  normalization, and publication.
- Redaction applies before diagnostics reach CLI, GraphQL inspection, runtime
  artifacts, or workflow output.

## CLI And Inspection

`workflow validate` remains passive by default. It should report native bundle
metadata consistency and missing installed add-ons without loading bundles.

`workflow validate --executable` loads bundle descriptors only through a
short-lived preflight helper process. The helper verifies digest, code
signature, Mach-O dependency closure, symbols, ABI, bundle identifier, and
exported add-on identity, returns a readiness record, and exits. Its loaded
handles are never inserted into
`NativeBundleLoadedRegistry`, never reused for workflow execution, and never
make later readiness checks depend on prior in-process descriptor side effects.
If the helper cannot be started, executable preflight fails closed with a
preflight-unavailable diagnostic; passive validation remains available.

Executable preflight helper contract:

- The helper has a startup timeout, descriptor-call timeout, and shutdown
  timeout. First-version defaults are 5 seconds for startup, 10 seconds for the
  descriptor call, and 2 seconds for graceful shutdown; CLI/library options may
  make these stricter but not unbounded.
- The helper readiness record is JSON capped at 1 MiB. Output beyond that cap
  fails with `native_preflight_output_too_large`; invalid UTF-8, malformed JSON,
  and missing required readiness fields fail with deterministic preflight
  diagnostics.
- On startup timeout, descriptor timeout, invalid output, or shutdown timeout,
  the parent terminates the helper, waits for graceful exit, and then force
  kills it if it is still alive. The reported diagnostic is one of
  `native_preflight_startup_timeout`, `native_preflight_timeout`,
  `native_preflight_output_too_large`, `native_preflight_invalid_output`, or
  `native_preflight_killed`.
- The preflight helper pins its selected install snapshot with a helper marker.
  Normal helper exit releases the marker before reporting success. If the parent
  kills the helper or observes helper loss, the parent writes a redacted
  `native_preflight_cleanup_pending` diagnostic, removes the helper marker when
  the process is confirmed dead, and records stale-marker cleanup status in
  inspect output.
- Startup recovery must treat orphaned preflight helper markers as stale only
  after confirming no live process owns the marker. Stale marker cleanup never
  deletes package bytes still referenced by a live execution or another helper.
- CLI text, CLI JSON, GraphQL/server inspection, and runtime artifacts must show
  helper phase, timeout kind, exit status or signal when available, cleanup
  status, and redacted diagnostic code. They must not report readiness as
  available after any timeout, kill, invalid output, or cleanup-pending state.

Long-lived library embedders that cannot spawn the helper may use fake loaders
for deterministic tests or passive metadata validation only. They must not load
real third-party descriptors in-process for preflight and then continue as an
ordinary execution host, because descriptor code can mutate process state and
Swift cannot reliably unload the bundle.

`workflow inspect --output json` should include add-on source summaries for
native bundles:

```json
{
  "nodeId": "summarize-media",
  "addon": "media/native-summary",
  "sourceKind": "native-bundle",
  "sourceScopeIntent": "same-as-workflow-install",
  "resolvedSourceScope": "project",
  "packageName": "media/native-summary-addon",
  "bundleIdentifier": "dev.rielflow.examples.NativeSummaryPlugin",
  "abiVersion": 1,
  "contentDigest": "sha256:...",
  "dependencyClosure": {
    "digest": "sha256:...",
    "status": "verified",
    "loadedImageVerification": "not_loaded",
    "nonSystemDependencyCount": 2
  },
  "signing": {
    "required": true,
    "verified": true
  },
  "snapshotStatus": "active",
  "preflight": {
    "helperStatus": "not_run",
    "phase": "not_started",
    "diagnosticCode": null,
    "cleanupStatus": "not_needed",
    "handleReusedForExecution": false
  },
  "dispatchIntentGrants": [],
  "cacheStatus": "not_loaded"
}
```

## Cross-Feature Impacts

- Swift migration: this is an additive `RielflowAddons` and `RielflowCLI`
  capability that depends on the TASK-006 add-on contract and TASK-007
  deterministic runner wiring. It must not make Swift the only production
  runtime until the migration parity gates pass.
- Workflow package integrity: native bundles reuse node-addon package
  integrity, dependency locks, content digests, checkout provenance, and
  rollback. They also require package checkout/update to expose immutable
  install snapshots or read locks so validation and `dlopen` observe the same
  artifact state, and to validate the complete Mach-O dependency closure so
  digest-verified bundles cannot execute unpinned non-system code. They do not
  introduce a separate plugin installation root.
- TypeScript/Bun package manager: current package install, publish, registry,
  update, and direct-run grant parsing are shared compatibility surfaces and
  must either accept `native-bundle` metadata with the same validation rules or
  fail closed behind an explicit Swift-only version gate.
- Executable node add-ons: `native-bundle` joins `container` and
  `local-command` as an executable package kind, with stricter installed-only
  loading and in-process trust limits.
- Workflow validation: passive validation stays offline and deterministic.
  Executable preflight is opt-in and must not run plugin bodies.
- GraphQL/server inspection: native bundle state should surface as read-only
  projections of validation and execution records, not as mutation handles or
  loader controls.
- Runtime cancellation: native-bundle execution exposes cooperative
  cancellation only. Features that require hard kill or hard deadlines should
  route to `container`, `local-command`, or a later helper-process native
  execution design.
- Homebrew/release packaging: first-version bundle loading assumes the Swift
  executable can locate installed project/user add-on roots after Homebrew
  installation; built-in add-ons remain bundled with the executable and are not
  replaced by third-party `rielflow/*` bundles.

## Open Questions

No user decision blocks the first design slice. Deferred questions are tracked
as future design work rather than blockers:

- cross-platform native plugin support after a reviewed Swift Linux build
  contract exists;
- helper-process native execution for hard cancellation, hard deadlines,
  streaming, file-descriptor transfer, or OS-level isolation;
- a broader plugin marketplace trust policy beyond package integrity and
  registry signer configuration;
- a Swift package author SDK layered over the C ABI.

## Testing And Verification Strategy

- Manifest tests cover `native-bundle` parsing, required ABI fields, invalid
  package kinds, safe path normalization, missing digests, missing capabilities,
  missing dependency closure digests, missing production code-signing
  requirements, unsupported platform hints, reserved `rielflow/*` names, and
  package/addon metadata disagreement.
- Dependency-lock tests cover native-bundle lock fields for workflow package
  dependencies and direct-run grants, including missing `bundleIdentifier`,
  missing `abiVersion`, omitted `sourceScopeIntent` defaulting to
  `same-as-workflow-install`, invalid concrete source-scope intent in published
  registry packages, missing direct-run `sourceScope`, missing
  `dependencyClosureDigest`, signing requirement digest mismatch, dependency
  closure digest mismatch, and installed metadata mismatch.
- Package-scope integration tests cover project-scope workflow package install,
  user-scope workflow package install, package update/replay in the installed
  scope, explicit scope migration requiring new provenance, inspect rendering of
  `sourceScopeIntent` plus `resolvedSourceScope`, direct-run development grants
  with exact `sourceScope`, project/user shadowing where only the materialized
  scope is accepted, and failure when validation would otherwise fall back to the
  other scope.
- Signing canonicalization tests share Swift and TypeScript fixture vectors for
  whitespace normalization, invalid requirement syntax, quoted identifiers,
  differing meaningful requirement text, lowercase hex digest rendering, and
  cache-key equality.
- Checkout tests recompute add-on content digests, reject symlinks and path
  traversal, reject unsupported filesystem entries, include nested bundle files
  and normalized executable bits in canonical order, record native-bundle
  provenance, roll back failed dependency installs, and preserve existing
  declarative/container/local-command behavior.
- Native-bundle content-digest fixture vectors are shared by Swift and
  TypeScript and must prove identical results for: a package root
  `rielflow-package.json` that carries registry/index digest metadata, a
  path-local `addon.json` that carries `contentDigest` and
  `dependencyClosureDigest`, the canonical path-local `addon.json` digest
  projection with those self-referential fields removed, dependency-lock
  generation, installed snapshot records, executable preflight revalidation,
  and runtime resolver revalidation. Negative fixtures include a literal
  `addon.json` byte-hash implementation, mismatched root/path-local digest
  fields, malformed excluded digest fields, added non-digest metadata that must
  change `contentDigest`, and changed digest-only metadata that must not change
  the recomputed source digest but must still pass exact manifest/lock matching.
- Mach-O dependency-closure tests share Swift and TypeScript fixtures for
  accepted `@rpath`/`@loader_path` bundle-local dependencies and rejected
  `@executable_path`, absolute dylibs outside the system allowlist, private
  frameworks, `/Library`, `/usr/local`, `/opt`, `/Applications`, package/user
  root escapes, nested frameworks, weak/reexport/upward dependencies, unresolved
  install names, DYLD-environment-dependent paths, unsigned nested code,
  dependency files that escape `sourcePath`, dependencies signed under a
  different requirement than the top-level bundle, and malicious dependency swaps
  between install/preflight and runtime load. They must also cover non-system
  install-name collisions with an already loaded image, ambiguous duplicate
  package-local install names, attempted `RTLD_DEFAULT` or global symbol lookup,
  post-load dyld image enumeration where the loaded realpath/digest/signature/
  architecture/UUID differs from the selected closure, extra non-system images
  absent from the closure, and host-process `restart_required` behavior after
  post-load verification fails. Positive cases include only
  dyld-cache-backed `/usr/lib/*.dylib` or
  `/System/Library/Frameworks/*.framework` public Apple dependencies plus
  bundle-local dependencies signed under the same package-declared requirement,
  included in `contentDigest`, matching `dependencyClosureDigest`, and confirmed
  by post-load dyld image verification before descriptor execution.
- TypeScript package-manager tests cover manifest normalization, package
  install/publish validation, registry indexing, update/replay, unsupported
  runtime execution diagnostics, and fail-closed version-gate diagnostics when
  native-bundle support is not available.
- Resolver tests use in-memory installed package records to prove direct
  workflow directories and unpackaged add-on roots fail closed, duplicate
  project/user add-on identities fail without an exact lock, and exact package
  locks select one installed source deterministically. Snapshot tests simulate a
  concurrent package update between resolve and load and require stale-snapshot
  or `restart_required` diagnostics rather than loading the changed path.
- Snapshot-retention tests cover update, rollback, remove, runtime startup GC,
  live process markers, stale marker recovery, `pending_cleanup_after_restart`,
  and loaded/preflight-loaded snapshots that must remain pinned until no live
  process can reference them.
- Loader/invoker tests use fake loaders for missing symbols, malformed
  descriptors, mismatched identifiers, signing failures, stale loaded digest,
  dependency-closure mismatch, invalid async/polling descriptor claims,
  malformed output, denied dispatch intents, descriptor/execute output freeing,
  oversize JSON rejection, serialized call behavior, cooperative cancellation
  diagnostics, pre-call records for crashes or wedged calls, and valid output
  conversion.
- Bounded output tests use fake returned pointers for descriptor and execute
  outputs with missing NUL, NUL after the 16 MiB payload limit, invalid UTF-8,
  malformed JSON, null pointers, and free-on-failure paths. Each returned
  pointer must be released exactly once through the fake free symbol.
- Dispatch-intent tests prove native bundles default to denied and that
  undeclared, ungranted, denied, malformed, mixed allowed/denied, and
  unredactable intents fail closed before publication. Positive cases require
  matching manifest capability, dependency lock or direct-run grant, scope, and
  payload schema.
- Output-control tests prove `allowCandidatePayload` and `allowDispatchIntents`
  are computed from workflow output contracts, package capabilities, dependency
  locks, direct-run grants, and step state; denied candidate payloads and denied
  dispatch intents fail before publication or routing effects.
- Runner tests prove add-on output flows through the existing runtime-owned
  publication path, output-contract validation, transition routing, and
  no-publication failure path. They must include repeated visits to the same
  reusable node, multiple steps sharing one node, retry attempts, and
  cancellation recovery to prove publication, diagnostics, and audit records are
  keyed by step execution identity.
- Input-envelope tests prove native plugins receive only resolved
  `addon.config`, granted `addon.env`, resolved `addon.inputs`, and non-secret
  step/source/options metadata; ungranted workflow variables, upstream messages,
  communication ids, runtime stores, candidate paths, and host filesystem paths
  are omitted.
- Environment-boundary tests prove `env.read` controls only `nodePayload.env`
  envelope contents and that docs, inspect output, and diagnostics state trusted
  in-process bundles may read the ambient process environment unless the caller
  chooses an isolated execution kind.
- Attachment-envelope tests prove `attachment.read` delivers only bounded
  metadata and base64 content for the exact granted `addon.inputs.<field>`; they
  must cover missing attachments, ungranted attachment inputs, multiple
  attachments for one single-value grant, oversized content, malformed hashes,
  serialization over the input-envelope limit, redacted inspect output, and
  rejection of generic `filesystem.read` or host-path grants for native-bundle
  ABI v1.
- Attachment integration tests cover chat-sdk, Discord, Telegram, webhook,
  Matrix, SQLite/message-store, and GraphQL/manager-message descriptor shapes:
  safe `contentRef`, `pathBase: "attachment-root"`, manager
  `DataDirFileRef`, Matrix `contentText`, inline `contentBase64`, and
  metadata-only unsupported descriptors. Tests must prove `contentRef`,
  `localPath`, provider URLs, attachment roots, data roots, and runtime stores
  never reach the plugin envelope.
- CLI tests verify passive `workflow validate`, executable preflight
  `workflow validate --executable`, `workflow inspect --output json`, redacted
  diagnostics, helper-process preflight isolation, no reuse of preflight-loaded
  handles in execution caches, preflight-unavailable failures, startup timeout,
  descriptor timeout, oversized readiness output, invalid readiness output,
  killed helper cleanup, stale helper marker recovery, GraphQL/CLI status
  rendering, and deterministic behavior without arbitrary native code in
  ordinary tests.
- Compatibility tests keep existing authored workflow add-on JSON and existing
  node-addon package fixtures valid.

## Implementation Status

This design run is documentation and implementation planning only. The current
worktree may contain partial manifest-surface edits, such as decoding
`execution.kind: "native-bundle"` and basic bundle metadata fields, but this
document does not cite a completed implementation commit as evidence for the
full manifest, dependency-lock, signature, dependency-closure, loader, resolver,
runner, or CLI behavior. Implementation must still complete `TASK-001` and
`TASK-002` in `impl-plans/swift-native-bundle-addons.md` before resolver,
runner, or CLI work can rely on native-bundle metadata or C ABI contracts.

The first implementation slice must add manifest and dependency-lock foundation:
`execution.kind: "native-bundle"`, ABI version `1`, bundle identifier,
production code-signing requirement, explicit capabilities, package integrity,
add-on content digest, safe `.bundle` entrypoints, dependency-lock identity
fields, signing requirement digests, dependency closure digests, immutable
installed snapshot metadata, and reserved `rielflow/*` rejection. The contract
slice must then define the C ABI pointer/free boundary, bounded C-string copy
rules, fake-loadable test hooks, descriptor/output validation, and deterministic
diagnostics. Only after those tasks are complete should resolver, runner
publication wiring, CLI inspect/preflight output, stale loaded-handle cache
behavior, attachment projection, and dispatch-intent gates be implemented.

## Implementation Planning Alignment

The implementation plan should stay derived from this design after review
acceptance.

Blocking plan-alignment gate before implementation:

- If `impl-plans/swift-native-bundle-addons.md` still contains pseudocode or
  task text that treats native bundle handles as Swift closures returning
  `String`, implementation must replace that with the C ABI pointer/free
  contract, bounded NUL scanning, UTF-8/JSON limits, and exactly-once release
  behavior from this design before coding `TASK-002`.
- If any task model omits `dependencyClosureDigest`,
  `codeSignatureRequirementDigest`, immutable install snapshot identity,
  authored `sourceScopeIntent`, materialized `resolvedSourceScope`, direct-run
  exact `sourceScope`, ABI version, bundle identifier, or exact capability
  grants from manifest, lock, direct-run grant, resolver, cache-key, or inspect
  records, implementation must update the plan before coding `TASK-001`,
  `TASK-003`, or `TASK-005`.
- If any package install, update, replay, validation, or inspect task compares a
  published workflow package's authored native-bundle dependency directly
  against a hard-coded project or user scope, implementation must replace that
  with checkout materialization: the `sourceScopeIntent` value
  `"same-as-workflow-install"` resolves to the selected workflow package install
  scope, writes exact `resolvedSourceScope` provenance, and never falls back to
  the other scope when project/user add-on identities shadow each other.
- If any task computes native-bundle `contentDigest` from literal path-local
  `addon.json` bytes, or includes path-local `contentDigest` or
  `dependencyClosureDigest` in the hashed JSON projection, implementation must
  replace it with the non-self-referential canonical projection defined here and
  add shared Swift/TypeScript fixture vectors before coding package validation,
  lock generation, install snapshots, preflight, or runtime resolver cache keys.
- If any loader, resolver, preflight, or cache task validates only scanned Mach-O
  load commands before `dlopen`, implementation must add the actual dyld binding
  invariant first: pre-load already-loaded image collision checks, local
  non-global loading, handle-specific symbol lookup, post-load image enumeration
  against the immutable dependency closure, failure diagnostics, and
  `restart_required` behavior for tainted host processes.
- If executable preflight is described as ordinary in-process or injected-loader
  descriptor loading, implementation must update it to the helper-process model:
  startup/descriptor/shutdown timeouts, bounded readiness JSON, kill/cleanup,
  stale-marker recovery, no execution-cache handle reuse, and CLI/GraphQL
  timeout diagnostics.
- If runner or resolver tasks omit `AttachmentProjectionPort`,
  `attachment.read` bounded value projection, dispatch-intent default-deny
  gates, candidate-payload denial, ambient-environment trust warnings, or
  step-execution identity, implementation must align those tasks before runtime
  wiring begins.

This design document is authoritative when the implementation plan and design
diverge. Because this workflow run is design-documentation-only, plan-file edits
are intentionally deferred; implementers must treat any stale plan pseudocode as
non-binding until it is reconciled with this section.

The planned slices are:

The current broad review feedback is addressed by separating authored dependency
scope intent from resolved install scope: published workflow packages use
`sourceScopeIntent: "same-as-workflow-install"` by default, checkout materializes
exact `resolvedSourceScope` provenance for project or user installs, update and
replay reuse that installed scope, direct-run development grants keep exact
`sourceScope`, inspect renders both authored and resolved scope, and
project/user shadowing never falls back to the unselected scope. The current deep
review feedback is addressed by requiring actual dyld image
binding verification before descriptor execution: non-system install names must
be collision-safe, pre-load checks fail on conflicting already-loaded images,
the loader uses local/non-global visibility and handle-specific lookup, post-load
enumeration proves realpath/digest/signature/architecture/UUID closure matches,
and post-load failures taint the host process for that native-bundle cache key
until restart. Earlier deep review feedback is addressed by defining native-bundle
`contentDigest` as a non-self-referential canonical source digest: path-local
`addon.json` is parsed, digest-bearing fields such as `contentDigest` and
`dependencyClosureDigest` are excluded from the hashed projection, package root
metadata remains outside the add-on source digest, and shared Swift/TypeScript
fixture vectors must prove identical digest results across package root
metadata, path-local manifests, locks, install snapshots, executable preflight,
and runtime revalidation. Earlier deep review feedback is also addressed by rejecting
`@executable_path`-dependent load commands in native-bundle ABI v1 instead of
rewriting them to the bundle executable directory, by adding the
`native_dependency_executable_path_denied` diagnostic, and by making
`dependencyClosureDigest` placement explicit in both package root
`addons[].dependencyClosureDigest` and path-local `addon.json`
`dependencyClosureDigest`.

Earlier deep review feedback is also addressed here by adding step-execution identity
to inputs and audit records, removing broad workflow
variables from the ABI, making ABI v1 host-call synchronous, aligning
recoverable diagnostics with crash/non-return limitations, and defining
deterministic code-signing requirement canonicalization. The latest bounded
C-string feedback is addressed by requiring descriptor and execute output
pointers to be copied with a bounded NUL search of at most 16 MiB plus one byte,
to fail deterministically on missing NUL or oversize output, and to free
returned pointers exactly once on every success and failure path. Earlier
deep/broad review feedback remains preserved through immutable install snapshot
semantics, canonical native-bundle content digest rules, minimum-disclosure
plugin source metadata, explicit C ABI ownership, size-limit, serialized-call
rules, dependency lock/direct-run grant schema, and TypeScript/Bun package
metadata compatibility/version-gating. The latest dispatch-intent feedback is
addressed by default-denying native-bundle dispatch intents unless exact
manifest `dispatch.intent.<kind>` capabilities and dependency-lock or direct-run
grant scopes authorize them, and by requiring whole-output fail-closed behavior
for undeclared, ungranted, denied, malformed, mixed, or unredactable intents.
The latest attachment/filesystem feedback is addressed by rejecting generic
`filesystem.read`/`filesystem.write` grants for native-bundle ABI v1 and
defining `attachment.read` as a bounded host-mediated value projection with no
host paths, descriptors, stores, or runtime APIs in the plugin envelope. The
latest cross-feature attachment feedback is addressed by mapping
`attachment.read` to existing event, SQLite/message-store, Matrix text,
GraphQL/manager, and inline attachment descriptor shapes, and by making
metadata-only provider descriptors explicitly unsupported until a runtime-owned
resolver materializes safe bytes.
The latest capability/envelope, output-control, ambient environment, snapshot
retention, and preflight isolation feedback is addressed by making package
metadata plus exact locks the only v1 capability authority, defining
`allowCandidatePayload` and `allowDispatchIntents` derivation and denial
behavior, documenting ambient process environment access as an accepted
in-process trust limitation, pinning loaded/preflight snapshots until no live
process can reference them, and requiring executable preflight to use a
short-lived helper whose handles never populate execution caches.
The latest preflight helper feedback is addressed by specifying startup,
descriptor-call, shutdown, and readiness-output limits; helper kill and cleanup
behavior; stale-marker recovery; deterministic diagnostics; and CLI/GraphQL
status rendering for timed-out or killed helpers.
The latest adversarial dependency-closure feedback is addressed by requiring
production native-bundle packages to validate a self-contained Mach-O dependency
closure during install, lock generation, executable preflight, and immediately
before runtime load; rejecting absolute, escaping, unresolved,
DYLD-environment-dependent, unsigned, mutable, or non-digested dependencies; and
pinning `dependencyClosureDigest` in package metadata, dependency locks, direct
run grants, install snapshots, and loader cache identity.
The latest deep dependency-closure feedback is addressed by defining the ABI v1
Apple/system allowlist as dyld-cache-backed `/usr/lib/*.dylib` and public
`/System/Library/Frameworks/*.framework` dependencies only, explicitly rejecting
private frameworks and mutable/user-controlled roots, and by choosing the
conservative v1 nested signing rule that every non-system dependency must satisfy
the same package-declared top-level code-signing requirement instead of adding
underspecified per-dependency signing metadata.

- `TASK-001` implements shared manifest native-bundle metadata in Swift
  `WorkflowPackageManifest.swift` and TypeScript package manifest/type
  normalizers: decode/encode `native-bundle`, require `abiVersion == 1`, a
  non-empty `bundleIdentifier`, a production `codeSignatureRequirement`, safe
  `.bundle` `entrypoint` paths under `sourcePath`, explicit capabilities,
  `attachment.read` capability validation, rejection of generic filesystem
  grants for native-bundle v1, package integrity, canonical native-bundle add-on
  `contentDigest`, Mach-O dependency closure validation and
  `dependencyClosureDigest`, immutable install snapshot metadata, and reject
  non-`node-addon` packages plus third-party declarations for reserved
  `rielflow/*` names.
- `TASK-002` implements native bundle plugin contracts in
  `NativeBundleAddonContracts.swift`: descriptor/export models, fake-loadable
  handle protocols, descriptor JSON decoding, host-call synchronous execution
  mode validation, minimal input-envelope encoding with step execution identity,
  ABI/add-on matching, and deterministic diagnostics for malformed descriptors,
  malformed output, ABI mismatch, invalid async/polling claims, missing exports,
  missing free symbol, missing NUL, invalid UTF-8, oversize JSON, descriptor and
  execute output ownership, exactly-once free-on-failure behavior, signature
  failures, stale cache state, cooperative cancellation, pre-call crash records,
  and loader failures.
- `TASK-003` implements the native bundle resolver over installed package
  registrations. It must enforce exact package/source/digest locks for
  executable add-ons, capture an immutable install snapshot or package read
  lock, perform immediate pre-load digest/dependency-closure/signature/
  identifier revalidation, reject already-loaded non-system image collisions,
  require post-load dyld image verification before descriptor execution, pin
  loaded and preflight-loaded snapshots until process exit or verified stale
  marker cleanup, fail closed on duplicate project/user identities without such a
  lock, and stay behind injected `NativeBundlePluginLoading` plus fake loaders in
  ordinary tests.
- `TASK-003A` implements native-bundle dependency lock and direct-run grant
  validation in Swift and TypeScript: published workflow package dependencies
  carry authored `sourceScopeIntent`, checkout materializes exact
  `resolvedSourceScope`, direct-run development grants carry exact
  `sourceScope`, and `executionKind`, `bundleIdentifier`, `abiVersion`,
  canonical `codeSignatureRequirementDigest`, `dependencyClosureDigest`, package
  id/kind, content digest, dispatch-intent capabilities, and capability grants
  must match installed metadata exactly before execution or descriptor preflight.
- `TASK-004` wires add-on-only workflow nodes into the Swift runner while
  preserving step-execution identity, runtime-owned publication, output
  validation, candidate-payload denial, dispatch-intent default-deny enforcement,
  transition routing, root output selection, cooperative cancellation handling,
  attachment projection through an injected runtime-owned
  `AttachmentProjectionPort`, ambient-environment trust warnings, and failure
  publication behavior.
- `TASK-005` exposes native bundle metadata and executable readiness through
  CLI inspect/validate surfaces without loading bundles during passive
  validation. Executable preflight must run real descriptor loading in a
  short-lived helper process, enforce startup/descriptor/shutdown timeouts,
  bound readiness output, perform the same pre-load collision and post-load
  dyld image verification as runtime execution, kill and clean up wedged helpers,
  recover stale helper markers, report helper status in CLI/GraphQL, and never
  reuse preflight-loaded handles for runtime execution.
- `TASK-005A` updates TypeScript/Bun package install, publish, registry,
  checkout, update/replay, and direct-run grant parsing to recognize
  native-bundle metadata. If that cannot ship with Swift support, those commands
  must reject native-bundle packages with an explicit Swift-only version-gate
  diagnostic.
- `TASK-006` keeps architecture/design/progress documentation aligned, refreshes
  package digests when package workflow or skill files change, and runs
  deterministic validation.

Implementation must not begin by adding a direct bundle loader to workflow
directory resolution. The first concrete code slice should add shared manifest
fields and validation errors across `RielflowAddons` and the TypeScript package
manager; only after that deterministic model exists should the resolver,
runner, and CLI execution surfaces be wired.

Reference behavior from agent process integrations is boundary guidance only,
not a plugin-loading template:

- `../codex-agent/src/process/types.ts` exposes bounded process options such as
  `cwd`, sandbox mode, approval mode, stream granularity, and explicit
  environment variables.
- `../codex-agent/src/process/manager.ts` owns subprocess spawning and argument
  construction behind a manager boundary.
- `../codex-agent/src/sdk/session-runner.ts` owns session lifecycle, resume,
  event streaming, completion, cancellation, and environment forwarding through
  structured session options.

Rielflow intentionally diverges from subprocess references for native bundle
add-ons. Native bundles are not Codex subprocesses, do not receive Codex session
handles, and do not inherit process-manager behavior. The mapping to keep is the
boundary style: callers pass structured options, the runtime owns lifecycle and
publication, and tests use injectable fakes. Cursor CLI and Codex-agent-specific
behavior must remain behind existing adapter modules and CLI wiring; native
bundle contracts live in `RielflowAddons` and return only
`AddonExecutionOutput` JSON to `RielflowCore`.

## Provisional Decisions

- First version is macOS-only.
  User confirmation would normally be needed for cross-platform native plugin
  support. The current Swift package and Homebrew release are macOS-only, so
  this keeps the implementation aligned with production reality. If Linux
  Swift support is later approved, add a separate ABI and package validation
  slice.
- Native bundles are trusted installed code, not sandboxed code.
  User confirmation would normally be needed for the threat model. This choice
  is preferable because macOS in-process bundles cannot provide strong
  sandboxing after load; capability grants only control values Rielflow
  mediates through the ABI. If stronger isolation, hard cancellation, or
  OS-level filesystem/network/process denial is required, use the existing
  `container` or `local-command` add-on execution kinds, or design a future
  helper-process native execution mode, instead of `native-bundle`.
- Production bundles require a package-declared macOS code-signing requirement.
  User confirmation would normally be needed for exact trust policy. This
  conservative choice avoids loading unsigned in-process code in production.
  If users later want unsigned local plugins, keep them behind explicit
  development grants and injected loaders rather than production package
  validation.
- The ABI uses C symbols and JSON strings.
  User confirmation would normally be needed for plugin author ergonomics. This
  choice avoids Swift ABI/protocol object instability across plugin builds. If a
  stable Swift package plugin SDK is later required, it should wrap this ABI
  rather than replace the host boundary.
- Executable preflight uses a short-lived helper process rather than loading
  real descriptors into the long-lived host.
  User confirmation would normally be needed for validation speed versus
  isolation. This choice prevents descriptor side effects from contaminating
  later workflow execution and gives the parent process a bounded timeout and
  kill boundary for preflight. If users later require in-process descriptor
  checks for embedded runtimes, those checks must be limited to fake loaders or
  trusted first-party bundles and must not be advertised as third-party
  executable preflight.
- Native-bundle v1 accepts bounded inline attachment bytes but no host paths or
  generic filesystem grants.
  User confirmation would normally be needed for large-media plugin ergonomics.
  This choice avoids leaking runtime stores, data roots, or candidate paths
  across the ABI. If large attachment streaming is later required, add a
  separate reviewed capability with explicit redaction, lock fields, and
  helper-process or brokered I/O semantics.

## References

- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `design-docs/specs/design-executable-node-addon-manifest-dependencies.md`
- `design-docs/specs/design-swift-native-migration.md`
- `Sources/RielflowAddons/AddonExecutionContracts.swift`
- `Sources/RielflowAddons/WorkflowPackageManifest.swift`
- `Sources/RielflowCore/DeterministicWorkflowRunner.swift`
- `Sources/RielflowCLI/WorkflowResolution.swift`
