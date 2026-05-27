# Workflow Package Integrity

This document records the package registry integrity and impersonation controls.

## Overview

Workflow package manifests keep the existing md5 checksum for compatibility and
change tracking, but md5 is not treated as a security control. Security
validation uses a separate `integrity` block:

- `digestAlgorithm`: currently `sha256`
- `digest`: a normalized package tree digest
- `signatures`: optional Ed25519 signatures over the sha256 digest

The sha256 digest detects package tampering. Ed25519 signatures bind the package
digest to a trusted registry signer and prevent a package from being silently
replaced by an untrusted publisher.

Checkout-time pre-install security scanning is intentionally separate from this
integrity model. Integrity answers whether the staged package matches expected
registry content and trusted signatures; pre-install scanning answers whether
that expected content contains suspicious prompts, scripts, or workflow payloads.
Both gates run before destination writes, and a scanner failure must not weaken
or skip digest and signature validation.

LLM-backed package review through the
`rielflow/workflow-package-sandbox-review` node add-on is also separate from
checkout integrity. That add-on is a normal workflow worker for review and
triage workflows; it may inspect staged or fixture package content and return a
mailbox decision, but it does not replace digest/signature validation, mutate
checkout provenance, or make checkout automatically run an LLM backend.

## Trust Model

Registry config entries may define `trustedSigners` and `requireSignature`.
Trusted signer public keys live in `~/.rielflow/workflow-packages/registries.json`
or the equivalent configured user root, not inside the package itself. This keeps
the package manifest from self-authorizing its own identity.

Checkout validates sha256 integrity whenever a package declares it. Checkout
requires a trusted signature when either:

- the registry entry sets `requireSignature: true`
- the registry entry has one or more `trustedSigners`
- `RIEL_WORKFLOW_PACKAGE_REQUIRE_SIGNATURE` is `1` or `true`

Publish always writes sha256 integrity. Publish signs the package when
`RIEL_WORKFLOW_PACKAGE_SIGNER_ID` and either
`RIEL_WORKFLOW_PACKAGE_SIGNING_KEY` or
`RIEL_WORKFLOW_PACKAGE_SIGNING_KEY_FILE` are present.

## Digest Normalization

The package digest includes package-relative file paths and file contents. It
excludes `.git`, nested `.rielflow`, temporary files, and checkout provenance.
For `rielflow-package.json`, digest calculation clears legacy `checksum`,
`integrity.digest`, and `integrity.signatures` before hashing so the signed
digest can be written back into the manifest without changing the digest.

## Publish Validation

Publish requires structured workflow metadata at
`workflow.json.metadata.rielflowPackage`. The metadata is mirrored into the
package manifest and is validated before publish writes registry content.

## Checkout Pre-Install Security Boundary

Package checkout must preserve the current integrity ordering before optional
pre-install scanner execution:

1. Resolve and stage the package.
2. Validate md5 compatibility metadata where present.
3. Validate sha256 integrity and required trusted signatures.
4. Validate the workflow bundle structure.
5. Run the optional pre-install static scanner and optional no-network
   Docker/Podman container check.
6. Install into project or user scope and write checkout provenance.

The scanner may report package-relative evidence and rule ids, but it must not
store secret values in checkout records or package manifests. Scanner results
belong in command output and test assertions; package manifests remain focused
on source metadata, checksums, sha256 integrity, and signatures.

Workflows that need human or LLM-assisted package review should compose the
`rielflow/workflow-package-sandbox-review` add-on before or after checkout
staging according to their own approval flow. The package installer remains
deterministic unless an explicit future checkout policy adds an LLM review gate.
