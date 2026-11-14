# Hook Snippet Command Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-hook-command.md#agent-backend-hook-configuration, design-docs/specs/command.md
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-hook-command.md`, `design-docs/specs/command.md`

### Summary

Add a small helper CLI command that prints paste-ready Claude Code or Codex hook configuration JSON. The generated snippet registers the existing vendor-detecting `divedra hook` runtime endpoint for the recommended lifecycle events.

### Scope

**Included**: hook configuration snippet builder, CLI subcommand wiring, help text, focused tests, plan/progress tracking

**Excluded**: mutating Claude Code or Codex configuration files, TUI integration, policy-handler changes, additional hook persistence changes

---

## Modules

### 1. Hook Configuration Snippet Builder

#### `src/hook/config.ts`

**Status**: COMPLETED

```typescript
export interface HookConfigurationSnippet {
  readonly hooks: Readonly<Record<string, readonly HookConfigurationEntry[]>>;
}

export function buildHookConfigurationSnippet(
  vendor: HookVendor,
): HookConfigurationSnippet;
```

**Checklist**:

- [x] Generate Claude Code matcher entries
- [x] Generate Codex matcher entries
- [x] Keep the generated command string as `divedra hook`
- [x] Unit tests

### 2. CLI Integration

#### `src/cli.ts`

**Status**: COMPLETED

```text
divedra hook snippet --vendor claude-code|codex
```

**Checklist**:

- [x] Accept `snippet` as the only hook subcommand
- [x] Require a valid explicit `--vendor`
- [x] Print formatted JSON to stdout
- [x] Preserve existing stdin hook behavior for `divedra hook`
- [x] CLI regression tests

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Hook configuration snippet builder | `src/hook/config.ts` | COMPLETED | Passed |
| CLI integration | `src/cli.ts`, `src/cli.test.ts` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Snippet builder | Hook command vendor types | Completed |
| CLI integration | Snippet builder | Completed |

## Completion Criteria

- [x] `divedra hook snippet --vendor claude-code` prints Claude Code JSON
- [x] `divedra hook snippet --vendor codex` prints Codex JSON
- [x] Invalid or missing vendor exits with CLI usage error
- [x] Existing `divedra hook --vendor ...` stdin behavior remains unchanged
- [x] Focused tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-04-20 16:06 JST

**Tasks Completed**: Plan creation and design update
**Tasks In Progress**: TASK-001, TASK-002
**Blockers**: None
**Notes**: Implementing as a non-mutating snippet generator to avoid overwriting user-managed hook files.

### Session: 2026-04-20 16:12 JST

**Tasks Completed**: TASK-001, TASK-002
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added a snippet builder and `divedra hook snippet --vendor ...` CLI integration. Generated snippets install vendor-detecting `divedra hook` commands while keeping `--vendor` available as an explicit runtime override. Focused tests and type checking passed.

## Related Plans

- **Previous**: `impl-plans/hook-event-recording.md`
- **Next**: None
- **Depends On**: `impl-plans/hook-event-recording.md`
