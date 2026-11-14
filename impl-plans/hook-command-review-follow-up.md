# Hook Command Review Follow-up Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-hook-command.md
**Created**: 2026-04-09
**Last Updated**: 2026-04-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-hook-command.md`

### Summary

Apply review-driven follow-up fixes to the new `rielflow hook` slice without changing its intended architecture. The command remains a noop-safe cross-vendor hook gateway, but the implementation should reduce duplication, avoid unnecessary hardcoded vendor strings, and cover block-path behavior with direct tests.

### Scope

**Included**: hook metadata DRY cleanup, CLI vendor-surface cleanup, hook dispatch dependency injection for better testability, regression coverage for explicit-vendor precedence and block exits, plan/progress tracking
**Excluded**: real hook policy handlers, protocol redesign, persistent hook logging, backend configuration generation

---

## Modules

### 1. Hook Metadata Alignment

#### `src/hook/types.ts`, `src/hook/parse.ts`, `src/hook/dispatch.ts`, `src/hook/detect-vendor.ts`

**Status**: COMPLETED

```typescript
export const SUPPORTED_HOOK_VENDORS: readonly HookVendor[];
export const KNOWN_HOOK_EVENT_NAMES: readonly Exclude<
  HookEventName,
  HookEventName.Unknown
>[];

declare function resolveHookEventName(value: string): HookEventName;
declare function parseHookVendorOption(
  value: string | undefined,
): HookVendor | undefined;
```

**Checklist**:

- [x] Derive the known-event lookup from the canonical enum rather than duplicating event names manually
- [x] Centralize supported vendor metadata for CLI/help reuse
- [x] Keep the noop dispatch registry aligned with the shared metadata
- [x] Avoid changing the external hook contract while cleaning up internals

### 2. Hook Pipeline Testability

#### `src/hook/index.ts`

**Status**: COMPLETED

```typescript
export interface HookCommandDependencies {
  readonly readStdin: () => Promise<string>;
  readonly dispatchHook?: (ctx: ParsedHookContext) => Promise<HookResponse>;
}
```

**Checklist**:

- [x] Allow the command runner to receive an injected dispatch function for focused tests
- [x] Preserve the default dispatcher for production CLI execution
- [x] Keep block-error handling in the orchestration path rather than in ad hoc test setup

### 3. Regression Coverage

#### `src/hook/index.test.ts`, `src/cli.ts`

**Status**: COMPLETED

```typescript
declare function runHookCommand(input: {
  readonly deps: HookCommandDependencies;
  readonly explicitVendor?: HookVendor;
  readonly io: HookCommandIo;
}): Promise<number>;
```

**Checklist**:

- [x] Cover explicit vendor precedence over heuristic detection
- [x] Cover exit-2 behavior for blocked hooks
- [x] Reuse centralized vendor strings in CLI help and error messages
- [x] Keep focused tests and typecheck passing

---

## Module Status

| Module                    | File Path                                                                                     | Status    | Tests  |
| ------------------------- | --------------------------------------------------------------------------------------------- | --------- | ------ |
| Hook metadata alignment   | `src/hook/types.ts`, `src/hook/parse.ts`, `src/hook/dispatch.ts`, `src/hook/detect-vendor.ts` | COMPLETED | Passed |
| Hook pipeline testability | `src/hook/index.ts`                                                                           | COMPLETED | Passed |
| Regression coverage       | `src/hook/index.test.ts`, `src/cli.ts`                                                        | COMPLETED | Passed |

## Dependencies

| Feature                   | Depends On                                           | Status    |
| ------------------------- | ---------------------------------------------------- | --------- |
| Hook metadata alignment   | Existing `hook-command-cross-vendor-alignment` slice | Completed |
| Hook pipeline testability | Hook metadata alignment                              | Completed |
| Regression coverage       | Hook metadata alignment, hook pipeline testability   | Completed |

## Completion Criteria

- [x] Hook metadata has a single canonical source for supported vendors and known events
- [x] Hook command block behavior is directly testable without mutating global registry state
- [x] CLI help/error strings avoid duplicated vendor literals
- [x] Focused hook tests, CLI tests, typecheck, and diff hygiene pass

## Progress Log

### Session: 2026-04-09 14:20 JST

**Tasks Completed**: Plan creation, review-driven cleanup, regression additions
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The review found that the new hook slice was directionally correct but still had three low-signal quality problems: duplicated event/vendor metadata that could drift, repeated vendor literals in CLI help/error strings, and no direct way to test block-path behavior or explicit-vendor precedence without relying on the global noop registry. This follow-up keeps the existing architecture but hardens the implementation around those gaps.

## Related Plans

- **Previous**: `impl-plans/hook-command-cross-vendor-alignment.md`
- **Next**: None
- **Depends On**: `impl-plans/hook-command.md`, `impl-plans/hook-command-hardening.md`, `impl-plans/hook-command-cross-vendor-alignment.md`
