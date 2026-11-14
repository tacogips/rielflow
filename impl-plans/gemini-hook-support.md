# Gemini Hook Support Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-hook-command.md, design-docs/specs/command.md
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-hook-command.md`, `design-docs/specs/command.md`

### Summary

Add Gemini CLI as a first-class hook vendor. `rielflow hook` should infer Gemini payloads without `--vendor`, and `rielflow hook snippet --vendor gemini` should print a paste-ready Gemini `settings.json` hook block that uses the vendor-detecting `rielflow hook` runtime command.

### Scope

**Included**: hook vendor enum, Gemini hook event names, heuristic detection, Gemini snippet generation, CLI usage text through shared vendor list, design updates, tests

**Excluded**: a Gemini workflow execution adapter, TUI changes, direct mutation of Gemini settings files

---

## Modules

### 1. Vendor and Event Types

#### `src/hook/types.ts`

**Status**: COMPLETED

```typescript
enum HookVendor {
  Gemini = "gemini",
}

enum HookEventName {
  BeforeTool = "BeforeTool",
  AfterTool = "AfterTool",
  BeforeAgent = "BeforeAgent",
  AfterAgent = "AfterAgent",
  BeforeModel = "BeforeModel",
  BeforeToolSelection = "BeforeToolSelection",
  AfterModel = "AfterModel",
  PreCompress = "PreCompress",
}
```

**Checklist**:

- [x] Add Gemini vendor
- [x] Add Gemini hook event names
- [x] Preserve existing Claude Code and Codex behavior

### 2. Vendor Detection

#### `src/hook/detect-vendor.ts`

**Status**: COMPLETED

```typescript
function detectHookVendor(input: {
  readonly payload: HookInputPayload;
  readonly eventName: HookEventName;
  readonly explicitVendor?: HookVendor;
}): HookVendor;
```

**Checklist**:

- [x] Detect Gemini-only events
- [x] Detect Gemini common payloads with `timestamp`
- [x] Preserve explicit vendor override
- [x] Unit tests

### 3. Snippet Generation

#### `src/hook/config.ts`

**Status**: COMPLETED

```typescript
buildHookConfigurationSnippet(HookVendor.Gemini);
```

**Checklist**:

- [x] Generate Gemini settings-compatible hook entries
- [x] Use `rielflow hook` as the generated command
- [x] CLI tests

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Vendor and event types | `src/hook/types.ts` | COMPLETED | Passed |
| Vendor detection | `src/hook/detect-vendor.ts`, `src/hook/index.test.ts` | COMPLETED | Passed |
| Snippet generation | `src/hook/config.ts`, `src/hook/config.test.ts`, `src/cli.test.ts` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Vendor detection | Vendor and event types | Completed |
| Snippet generation | Vendor and event types | Completed |

## Completion Criteria

- [x] `rielflow hook` detects Gemini-only event payloads without `--vendor`
- [x] Gemini `SessionStart` payloads with `timestamp` do not get misclassified as Codex
- [x] `rielflow hook snippet --vendor gemini` prints Gemini hook JSON
- [x] Existing Claude Code and Codex tests still pass
- [x] Type checking passes

## Progress Log

### Session: 2026-04-20 16:20 JST

**Tasks Completed**: Plan creation
**Tasks In Progress**: TASK-001, TASK-002, TASK-003
**Blockers**: None
**Notes**: Gemini hook schema was checked against official Gemini CLI hook documentation before implementation.

### Session: 2026-04-20 16:28 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added Gemini vendor/event types, Gemini detection heuristics, Gemini snippet generation, design updates, and focused tests. Focused tests and type checking passed.

## Related Plans

- **Previous**: `impl-plans/hook-snippet-command.md`
- **Next**: None
- **Depends On**: `impl-plans/hook-event-recording.md`, `impl-plans/hook-snippet-command.md`
