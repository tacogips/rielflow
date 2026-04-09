# Hook Command Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-hook-command.md
**Created**: 2026-04-09
**Last Updated**: 2026-04-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-hook-command.md`

### Summary

Add a `divedra hook` CLI surface that reads a hook payload from stdin, detects the originating agent vendor, resolves the hook event, dispatches to a registered handler, and emits a JSON response. The initial delivery keeps every handler as a noop so the command is safe to adopt before policy logic is added.

### Scope

**Included**: hook types, payload parsing, vendor detection, noop dispatch registry, CLI wiring, stdin dependency injection for tests, focused regression coverage, plan/progress tracking
**Excluded**: real policy decisions, workflow-aware hook side effects, persistent hook logging, backend-specific configuration file generation

---

## Modules

### 1. Hook Pipeline

#### `src/hook/types.ts`, `src/hook/detect-vendor.ts`, `src/hook/handler.ts`, `src/hook/dispatch.ts`, `src/hook/parse.ts`, `src/hook/index.ts`

**Status**: COMPLETED

```typescript
export enum HookVendor {
  ClaudeCode = "claude-code",
  Codex = "codex",
}

export enum HookEventName {
  SessionStart = "SessionStart",
  PreToolUse = "PreToolUse",
  PostToolUse = "PostToolUse",
  UserPromptSubmit = "UserPromptSubmit",
  Stop = "Stop",
  Unknown = "Unknown",
}

export interface ParsedHookContext {
  readonly vendor: HookVendor;
  readonly eventName: HookEventName;
  readonly payload: HookInputPayload;
  readonly rawJson: Readonly<Record<string, unknown>>;
}

export interface HookCommandDependencies {
  readonly readStdin: () => Promise<string>;
}
```

**Checklist**:

- [x] Define the shared hook enums, payload types, and response envelope
- [x] Implement vendor override parsing plus heuristic detection fallback
- [x] Validate the base payload shape before dispatch
- [x] Register noop handlers for known vendor/event pairs and fall back cleanly for unknown events
- [x] Keep the command response JSON-only and backend-safe

### 2. CLI Integration

#### `src/cli.ts`

**Status**: COMPLETED

```typescript
export interface CliDependencies {
  readonly readStdin?: () => Promise<string>;
}
```

**Checklist**:

- [x] Parse `--vendor` for the `hook` command
- [x] Add a `scope === "hook"` branch
- [x] Route hook execution through the shared pipeline rather than inline CLI logic
- [x] Return protocol-appropriate exit codes for parse failures and block decisions

### 3. Regression Coverage

#### `src/hook/index.test.ts`, `src/cli.test.ts`

**Status**: COMPLETED

```typescript
declare function runHookCommand(args: {
  readonly argv: readonly string[];
  readonly stdin: string;
}): Promise<number>;
```

**Checklist**:

- [x] Cover explicit vendor override and heuristic vendor detection
- [x] Cover invalid JSON and invalid base-payload failures
- [x] Cover noop dispatch for known events and unknown-event fallback behavior
- [x] Cover the CLI `hook` entrypoint with injected stdin

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Hook pipeline | `src/hook/*.ts` | COMPLETED | Passed |
| CLI integration | `src/cli.ts` | COMPLETED | Passed |
| Regression coverage | `src/hook/index.test.ts`, `src/cli.test.ts` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Hook pipeline | Existing CLI/runtime TypeScript infrastructure | Completed |
| CLI integration | Hook pipeline | Completed |
| Regression coverage | Hook pipeline, CLI integration | Completed |

## Completion Criteria

- [x] `divedra hook` reads stdin, parses payloads, and returns a JSON response
- [x] Vendor selection works through `--vendor` override and heuristic fallback
- [x] Known events dispatch through the registry without inline CLI branching
- [x] Focused tests and relevant typecheck pass

## Progress Log

### Session: 2026-04-09 00:00 JST

**Tasks Completed**: Plan creation
**Tasks In Progress**: TASK-001 hook pipeline, TASK-002 CLI integration
**Blockers**: None
**Notes**: The repository already had the design document and command-surface edits for `divedra hook`, but not the implementation plan or the code path itself. This plan narrows the first slice to a noop-safe command so backend hook wiring can land before policy logic exists.

### Session: 2026-04-09 09:49 JST

**Tasks Completed**: TASK-001 hook pipeline, TASK-002 CLI integration, TASK-003 regression coverage
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented the `divedra hook` command as a noop-safe pipeline under `src/hook/`, added CLI `--vendor` parsing plus stdin dependency injection, and verified the slice with `bun test src/hook/index.test.ts src/cli.test.ts`, `bun run typecheck:server`, and `git diff --check`.

## Related Plans

- **Previous**: `impl-plans/v2-cutover-command-container-runtime.md`
- **Next**: None
- **Depends On**: None
