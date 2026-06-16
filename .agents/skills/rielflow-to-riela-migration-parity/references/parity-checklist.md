# Migration Parity Checklist

Use this checklist when auditing Rielflow to Riela migrations or any source to
Swift/Riela behavior port.

## Source Inventory

- Package manifests: exports, binaries, scripts, dependencies, package metadata.
- Public API: exported functions, classes, structs, protocols, types, constants.
- CLI surface: commands, subcommands, flags, config roots, output formats.
- SDK surface: sync/async behavior, streams, events, mocks, testing exports.
- Workflow surface: workflow ids, package ids, nodes, prompts, scripts, add-ons.
- Skills: names, descriptions, resources, agent metadata.
- Persistence: files, SQLite tables, JSON schemas, migration behavior.
- Security behavior: tokens, permissions, process execution, secret handling.
- Tests: unit, integration, regression, snapshot, CLI, workflow, fixture tests.
- User-facing docs: README, design docs, runbooks, package documentation.

## Target Evidence

- Swift public API or workflow/skill equivalent exists.
- Behavior is reachable through the intended target entry point.
- Tests cover success, failure, edge cases, and compatibility semantics.
- No target code shells out to or imports the legacy source as a runtime path.
- Plan status matches reality: active means incomplete; completed means moved or
  no longer under active plan ownership.
- Package digests or generated metadata are refreshed when package/workflow/skill
  files change.

## Gap Labels

- `complete`: implementation and tests exist and pass.
- `partial`: implementation exists but behavior, reachability, persistence, or
  tests are incomplete.
- `missing`: no target behavior exists.
- `deferred`: intentionally out of scope with explicit owner, reason, and follow
  up path.

## Rielflow Handoff

Include in workflow input:

- source inventory summary;
- gap list grouped by component;
- target paths;
- active plan paths;
- constraints preventing legacy runtime dependency;
- verification commands required before commit/push/merge.
