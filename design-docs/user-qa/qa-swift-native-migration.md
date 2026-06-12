# Swift Native Migration Questions

These decisions affect the `swift-migration` branch and the cutoff for replacing the TypeScript/Bun Rielflow runtime with Swift.

## Replacement Milestone Scope

Should the migration replacement milestone be limited to CLI/runtime parity, or should it also include a native macOS UI?

Recommended default: CLI/runtime parity only. A native UI should be designed after the Swift runtime can validate, inspect, run deterministic workflows, and pass packaging smoke tests.

## Release Cutover Threshold

Status: resolved for the branch-local production packaging cutover after
TASK-009 acceptance.

The accepted threshold requires fixture parity for workflow validation, inspect,
deterministic run, package validation, event trigger dry-runs, GraphQL manager
control, hook context parsing, adapter output normalization, SQLite-backed
session/message persistence, macOS archive smoke tests, and the dedicated
production archive/formula verification described in
`design-docs/specs/design-swift-native-migration.md#branch-production-swift-homebrew-release-cutover`.

TASK-008 default readiness contract: keep pre-cutover Swift-only macOS readiness archives separate as `dist/swift-homebrew/rielflow-swift-<version>-darwin-arm64.tar.gz` and `dist/swift-homebrew/rielflow-swift-<version>-darwin-x64.tar.gz` with `bin/rielflow` inside. Do not publish those readiness archives or commit tap formula changes as part of readiness verification.

TASK-008 implementation default: derive the Swift release executable from
`swift build -c release --product rielflow --show-bin-path`, stage it under
`dist/swift-homebrew/work/rielflow-<version>-darwin-<arch>/bin/rielflow`, and
use `packaging/homebrew/swift-cutover-gates.json` as the readiness gate
manifest. After TASK-009 acceptance, the dedicated branch-local production
cutover moved macOS Homebrew archives to Swift executable archives under
`dist/homebrew`.

Dedicated production cutover result: production Swift archives now live under
`dist/homebrew`, the formula renders from those checksums, and the gate
manifest records `productionRuntime=swift-native`,
`homebrewFormulaSource=swift-executable-archive`, and
`allowsProductionCutover=true` after the production archive, checksum, formula,
local smoke, deterministic workflow, and leakage gates passed. GitHub release
upload and tap pushes remain operator actions outside the verification step.

## Agent Source Strategy

Should the Swift migration vendor source from the repository-owned agent packages, or continue mapping behavior from the pinned package contracts and current TypeScript adapters until dedicated Swift references exist?

Recommended default: continue mapping behavior from pinned package contracts and TypeScript adapters until `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` Swift references are available or explicitly approved for vendoring.
