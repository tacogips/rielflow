# Swift Native Migration Questions

These decisions affect the `swift-migration` branch and the cutoff for replacing the TypeScript/Bun Rielflow runtime with Swift.

## Replacement Milestone Scope

Should the migration replacement milestone be limited to CLI/runtime parity, or should it also include a native macOS UI?

Recommended default: CLI/runtime parity only. A native UI should be designed after the Swift runtime can validate, inspect, run deterministic workflows, and pass packaging smoke tests.

## Release Cutover Threshold

What exact verification threshold is required before release packaging and Homebrew artifacts switch from the TypeScript/Bun executable to the Swift executable?

Recommended default: require fixture parity for workflow validation, inspect, deterministic run, package validation, event trigger dry-runs, GraphQL manager control, hook context parsing, adapter output normalization, SQLite-backed session/message persistence, and macOS archive smoke tests.

TASK-008 default readiness contract: keep production Homebrew on the current TypeScript/Bun archives under `dist/homebrew/rielflow-<version>-<target>.tar.gz`; stage Swift-only macOS readiness archives separately as `dist/swift-homebrew/rielflow-swift-<version>-darwin-arm64.tar.gz` and `dist/swift-homebrew/rielflow-swift-<version>-darwin-x64.tar.gz` with `bin/rielflow` inside. Do not publish those archives, commit tap formula changes, or make them the documented install path until TASK-009 adversarial review accepts the full cutover.

TASK-008 implementation default: derive the Swift release executable from
`swift build -c release --product rielflow --show-bin-path`, stage it under
`dist/swift-homebrew/work/rielflow-<version>-darwin-<arch>/bin/rielflow`, and
use `packaging/homebrew/swift-cutover-gates.json` as the blocked gate manifest.
The current Homebrew formula source remains the TypeScript/Bun archive path.

## Agent Source Strategy

Should the Swift migration vendor source from the repository-owned agent packages, or continue mapping behavior from the pinned package contracts and current TypeScript adapters until dedicated Swift references exist?

Recommended default: continue mapping behavior from pinned package contracts and TypeScript adapters until `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` Swift references are available or explicitly approved for vendoring.
