# Mailbox Artifact Atomic Writes Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-node-mailbox.md#Mailbox Directory Layout
**Created**: 2026-03-08
**Last Updated**: 2026-03-08

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-mailbox.md`

### Summary

Align raw runtime artifact persistence with the mailbox design's durability expectations by writing text artifacts through the same temp-file-plus-rename path already used for JSON files.

The continuation review found that mailbox `outbox/*/output.json` snapshots and some node execution text artifacts still used direct in-place `writeFile` calls. Existing tests covered content fidelity but not crash-safety, so the runtime could still leave partially written artifacts if interrupted mid-write.

### Scope

**Included**:
- route mailbox `outbox/*/output.json` persistence through the atomic raw-text helper
- route node execution `input.json`, `output.json`, and `commit-message.txt` persistence through the same helper
- clarify the mailbox design so raw text payload artifacts follow the same atomic-write rule as JSON artifacts

**Excluded**:
- mailbox schema changes
- communication id allocation changes
- API/UI changes
- broader filesystem transaction semantics beyond temp-file-plus-rename per artifact

---

## Modules

### 1. Atomic Raw Text Persistence

#### `src/workflow/engine.ts`

**Status**: COMPLETED

```ts
async function writeRawTextFile(
  filePath: string,
  content: string,
): Promise<void>;
```

**Checklist**:
- [x] Mailbox `outbox/*/output.json` uses atomic raw-text persistence
- [x] Node execution `input.json` uses atomic raw-text persistence
- [x] Node execution `output.json` uses atomic raw-text persistence
- [x] Node execution `commit-message.txt` uses atomic raw-text persistence

### 2. Design Consistency

#### `design-docs/specs/design-node-mailbox.md`

**Status**: COMPLETED

```ts
type AtomicMailboxArtifactWrites = true;
```

**Checklist**:
- [x] Design explicitly states that raw mailbox payload artifacts use temp-file-plus-rename writes
- [x] Runtime implementation matches that documented durability rule

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Atomic raw text persistence | `src/workflow/engine.ts` | COMPLETED | targeted workflow engine tests |
| Design wording | `design-docs/specs/design-node-mailbox.md` | COMPLETED | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Atomic mailbox artifact writes | Existing raw-text write helper | COMPLETED |
| Design wording | Runtime audit | COMPLETED |

## Completion Criteria

- [x] Raw mailbox output snapshots no longer use in-place `writeFile`
- [x] Node execution raw text artifacts share the same atomic-write helper
- [x] Mailbox design explicitly documents the atomic-write expectation
- [x] Relevant workflow engine and validation tests pass

## Suggested Verification Commands

```bash
bun test src/workflow/engine.test.ts
bun test src/workflow/validate.test.ts
bun run typecheck
```

## Progress Log

### Session: 2026-03-08 16:00
**Tasks Completed**: Continuation diff review, atomic raw-text write hardening, design wording update
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Snapshot-fidelity behavior was correct, but raw mailbox and node text artifacts still bypassed the temp-file-plus-rename path used for JSON persistence. The runtime now uses one atomic helper for those files as well.
