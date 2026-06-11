# Swift Native Migration Questions

These decisions affect the `swift-migration` branch and the cutoff for replacing the TypeScript/Bun Rielflow runtime with Swift.

## Replacement Milestone Scope

Should the migration replacement milestone be limited to CLI/runtime parity, or should it also include a native macOS UI?

Recommended default: CLI/runtime parity only. A native UI should be designed after the Swift runtime can validate, inspect, run deterministic workflows, and pass packaging smoke tests.

## Release Cutover Threshold

What exact verification threshold is required before release packaging and Homebrew artifacts switch from the TypeScript/Bun executable to the Swift executable?

Recommended default: require fixture parity for workflow validation, inspect, deterministic run, package validation, event trigger dry-runs, GraphQL manager control, hook context parsing, adapter output normalization, and macOS archive smoke tests.

## Agent Source Strategy

Should the Swift migration vendor source from the repository-owned agent packages, or continue mapping behavior from the pinned package contracts and current TypeScript adapters until dedicated Swift references exist?

Recommended default: continue mapping behavior from pinned package contracts and TypeScript adapters until `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` Swift references are available or explicitly approved for vendoring.
