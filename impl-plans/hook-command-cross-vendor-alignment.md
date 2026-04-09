# Hook Command Cross-Vendor Alignment Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-hook-command.md
**Created**: 2026-04-09
**Last Updated**: 2026-04-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-hook-command.md`

### Summary

Correct the first `divedra hook` slice so its transport contract genuinely works for both Claude Code and Codex. The review found that the current implementation treated Codex-documented fields as if they were shared across vendors and relied on a stale Codex-specific detection hint that is not part of the current documented common payload.

### Scope

**Included**: hook transport contract correction, vendor-detection heuristic alignment, focused regression coverage for Claude and Codex payload variants, design/plan/progress updates, README surface alignment
**Excluded**: non-noop policy handlers, hook configuration generation, upstream schema vendoring, persistent hook observability

---

## Modules

### 1. Design and Plan Alignment

#### `design-docs/specs/design-hook-command.md`, `design-docs/specs/command.md`, `impl-plans/hook-command-cross-vendor-alignment.md`

**Status**: COMPLETED

```typescript
interface HookTransportContract {
  readonly sharedRequiredFields: readonly ["session_id", "cwd", "hook_event_name"];
  readonly codexCommonHints: readonly ["transcript_path", "model"];
  readonly vendorDetectionMode: "explicit-first-best-effort-fallback";
}
```

**Checklist**:

- [x] Record that only the shared transport fields are required for both vendors
- [x] Document Codex common fields as optional detection hints rather than universal requirements
- [x] Replace the stale `permission_mode` heuristic in the design narrative
- [x] Track the follow-up as a completed implementation-plan slice

### 2. Hook Transport Core

#### `src/hook/types.ts`, `src/hook/parse.ts`, `src/hook/detect-vendor.ts`

**Status**: COMPLETED

```typescript
interface HookInputPayload extends Readonly<Record<string, unknown>> {
  readonly session_id: string;
  readonly cwd: string;
  readonly hook_event_name: string;
  readonly transcript_path?: string | null;
  readonly model?: string;
  readonly turn_id?: string;
}

declare function detectHookVendor(input: {
  readonly payload: HookInputPayload;
  readonly eventName: HookEventName;
  readonly explicitVendor?: HookVendor;
}): HookVendor;
```

**Checklist**:

- [x] Make Codex-only common fields optional in the shared payload type
- [x] Stop rejecting Claude payloads that omit `transcript_path`
- [x] Detect Codex shared events from current documented Codex transport hints
- [x] Remove stale or misleading payload assumptions from the first slice

### 3. Regression Coverage and Surface Review

#### `src/hook/index.test.ts`, `README.md`

**Status**: COMPLETED

```typescript
declare function parseHookPayload(rawStdin: string): {
  readonly payload: HookInputPayload;
  readonly eventName: HookEventName;
  readonly rawEventName: string;
};
```

**Checklist**:

- [x] Cover Claude payload parsing without Codex-only fields
- [x] Cover Codex SessionStart heuristic detection without `turn_id`
- [x] Cover invalid optional Codex hint types
- [x] Align the user-facing CLI surface summary with the implemented `hook` command

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Design and plan alignment | `design-docs/specs/design-hook-command.md`, `design-docs/specs/command.md`, `impl-plans/hook-command-cross-vendor-alignment.md` | COMPLETED | N/A |
| Hook transport core | `src/hook/types.ts`, `src/hook/parse.ts`, `src/hook/detect-vendor.ts` | COMPLETED | Passed |
| Regression coverage and surface review | `src/hook/index.test.ts`, `README.md` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Design and plan alignment | Existing `hook-command-hardening` slice | Completed |
| Hook transport core | Design and plan alignment | Completed |
| Regression coverage and surface review | Hook transport core | Completed |

## Completion Criteria

- [x] Claude Code hook payloads no longer fail because Codex-only fields are missing
- [x] Vendor detection uses current documented Codex transport hints rather than stale fields
- [x] Focused hook tests and server typecheck pass
- [x] Documentation and plan tracking match the corrected contract

## Progress Log

### Session: 2026-04-09 12:35 JST

**Tasks Completed**: Design correction, follow-up plan creation, hook transport fix, regression updates
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review of the uncommitted `divedra hook` work found a cross-vendor contract bug. The implementation and design treated `transcript_path` as universally required and still mentioned a `permission_mode` SessionStart hint, but current official Codex docs document `transcript_path` and `model` as Codex common fields while current Claude Code docs only rely on shared fields such as `session_id`, `cwd`, and `hook_event_name`. This follow-up narrows the required contract to the truly shared fields and updates detection/tests accordingly.

## Related Plans

- **Previous**: `impl-plans/hook-command-hardening.md`
- **Next**: None
- **Depends On**: `impl-plans/hook-command.md`, `impl-plans/hook-command-hardening.md`
