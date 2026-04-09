# Hook Command Hardening Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-hook-command.md
**Created**: 2026-04-09
**Last Updated**: 2026-04-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-hook-command.md`

### Summary

Harden the first `divedra hook` slice so the implementation matches the intended machine-facing contract. The follow-up keeps the noop behavior but removes stale protocol assumptions: the command should stay JSON-only, validate the stable transport fields it actually depends on, and avoid claiming exhaustive vendor payload coverage before real hook handlers exist.

### Scope

**Included**: command-surface alignment, minimal validated payload contract, quieter noop fallback behavior, payload/response type cleanup, focused regression coverage, plan/progress tracking
**Excluded**: real hook policies, vendor-specific handler implementations, full upstream schema mirroring, persistent logging or observability features

---

## Modules

### 1. Design and CLI Contract Alignment

#### `design-docs/specs/command.md`, `design-docs/specs/design-hook-command.md`, `src/cli.ts`

**Status**: COMPLETED

```typescript
interface HookCliContract {
  readonly command: "divedra hook";
  readonly vendor?: "claude-code" | "codex";
  readonly successOutput: "json";
}
```

**Checklist**:

- [x] Remove the misleading hook-specific `--output json|text` surface from docs/help
- [x] Document the hook command as JSON-only on success
- [x] Clarify that external vendor payloads are treated as extensible protocols rather than exhaustive local enums

### 2. Payload Contract Hardening

#### `src/hook/types.ts`, `src/hook/parse.ts`, `src/hook/detect-vendor.ts`, `src/hook/index.ts`

**Status**: COMPLETED

```typescript
interface HookInputPayload extends Readonly<Record<string, unknown>> {
  readonly session_id: string;
  readonly hook_event_name: string;
  readonly cwd: string;
  readonly transcript_path: string | null;
  readonly permission_mode?: string;
}

interface ParsedHookContext {
  readonly vendor: HookVendor;
  readonly eventName: HookEventName;
  readonly rawEventName: string;
  readonly payload: HookInputPayload;
}
```

**Checklist**:

- [x] Replace stale exhaustive payload typing with a validated transport-core contract
- [x] Validate `session_id`, `hook_event_name`, `cwd`, and `transcript_path`
- [x] Preserve vendor-specific fields in the payload without unsafe casts
- [x] Keep raw event names available for fallback handling

### 3. Noop Fallback and Regression Coverage

#### `src/hook/dispatch.ts`, `src/hook/index.test.ts`, `src/cli.test.ts`

**Status**: COMPLETED

```typescript
declare function dispatchHook(ctx: ParsedHookContext): Promise<HookResponse>;
```

**Checklist**:

- [x] Keep unrecognized events on the noop path without stderr noise
- [x] Add regression coverage for missing required transport fields
- [x] Update CLI and hook tests to reflect the corrected payload contract
- [x] Keep the new slice passing focused tests and typecheck

---

## Module Status

| Module                                | File Path                                                                                  | Status    | Tests  |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | --------- | ------ |
| Design/CLI contract alignment         | `design-docs/specs/command.md`, `design-docs/specs/design-hook-command.md`, `src/cli.ts`   | COMPLETED | Passed |
| Payload contract hardening            | `src/hook/types.ts`, `src/hook/parse.ts`, `src/hook/detect-vendor.ts`, `src/hook/index.ts` | COMPLETED | Passed |
| Noop fallback and regression coverage | `src/hook/dispatch.ts`, `src/hook/index.test.ts`, `src/cli.test.ts`                        | COMPLETED | Passed |

## Dependencies

| Feature                       | Depends On                    | Status    |
| ----------------------------- | ----------------------------- | --------- |
| Design/CLI contract alignment | Existing `hook-command` slice | Completed |
| Payload contract hardening    | Design/CLI contract alignment | Completed |
| Regression coverage           | Payload contract hardening    | Completed |

## Completion Criteria

- [x] Hook docs/help describe a JSON-only machine-facing contract
- [x] Parsed hook payloads satisfy their runtime TypeScript contract
- [x] Unknown/unmodeled events remain safe noop fallbacks without noisy stderr
- [x] Focused tests, typecheck, and diff hygiene pass

## Progress Log

### Session: 2026-04-09 10:31 JST

**Tasks Completed**: Plan creation, design review, implementation, regression updates
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review of the new hook slice found two concrete mismatches: the command/help surface advertised `--output` despite the hook protocol being JSON-only, and the payload types claimed required fields that the parser did not validate. This follow-up hardened the contract, simplified the payload model, and updated tests around the corrected runtime behavior.

## Related Plans

- **Previous**: `impl-plans/hook-command.md`
- **Next**: None
- **Depends On**: `hook-command.md`
