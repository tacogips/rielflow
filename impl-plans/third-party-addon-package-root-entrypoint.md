# Third-party Add-on Package Root Entrypoint Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`, `design-docs/specs/architecture.md#workflow-runtime`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

### Summary

Continuation review found that resolver-facing types were exported from
`src/lib.ts`, but the package root still pointed to the CLI build output. That
made the documented package-root public API unavailable to host applications and
third-party add-on packages.

### Scope

**Included**: Package export map alignment, build output for the library entry,
declaration output for resolver-facing types, bundled prompt asset availability,
and documentation updates.

**Excluded**: CLI binary packaging, package registry discovery, and native
third-party add-on executor registration.

---

## Modules

### 1. Package Export Map

#### `package.json`

**Status**: Completed

```typescript
// Package root resolves to the side-effect-free library entry.
export * from "divedra";
```

**Checklist**:

- [x] Point `main`, `module`, and root export metadata at `dist/lib.js`.
- [x] Keep CLI output addressable separately as `divedra/cli`.

### 2. Build and Type Declarations

#### `package.json`, `tsconfig.build.json`

**Status**: Completed

```typescript
// Build emits both CLI and library JavaScript plus declaration files.
```

**Checklist**:

- [x] Build both `src/main.ts` and `src/lib.ts`.
- [x] Generate `dist/lib.d.ts` for package-root resolver-facing types.
- [x] Exclude tests from declaration emission.
- [x] Copy runtime prompt assets needed by bundled imports.

### 3. Documentation and Plan Index

#### `README.md`, `design-docs/specs/*.md`, `impl-plans/*`

**Status**: Completed

**Checklist**:

- [x] Document that the package root resolves to the library entry.
- [x] Record the CLI/library entrypoint split in design docs.
- [x] Update plan progress indexes.

## Module Status

| Module             | File Path                                  | Status    | Tests     |
| ------------------ | ------------------------------------------ | --------- | --------- |
| Package export map | `package.json`                             | Completed | Build     |
| Declaration build  | `package.json`, `tsconfig.build.json`      | Completed | Typecheck |
| Prompt assets      | `src/workflow/prompts/*`, `dist/prompts/*` | Completed | Build     |
| Documentation      | `README.md`, `design-docs/specs/*.md`      | Completed | Review    |
| Plan indexes       | `impl-plans/README.md`, `PROGRESS.json`    | Completed | Review    |

## Dependencies

| Feature                      | Depends On                     | Status    |
| ---------------------------- | ------------------------------ | --------- |
| Package-root resolver types  | `third-party-addon-public-api` | Available |

## Completion Criteria

- [x] `import type { NodeAddonPayloadResolver } from "divedra"` resolves to the
      library declaration surface after build.
- [x] Importing the package root does not execute the CLI entrypoint.
- [x] Build includes both CLI and library JavaScript entries.
- [x] Built library entry can be imported without missing prompt assets.
- [x] Documentation reflects the package-root boundary.

## Progress Log

### Session: 2026-04-20 23:50 JST

**Tasks Completed**: Package export map alignment, declaration build config,
runtime prompt asset copy, documentation updates, and plan/progress index update.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: This closes the gap between the third-party add-on public API design
and the actual package entrypoint. The resolver-facing exports were present in
`src/lib.ts`, but package consumers would still have loaded the CLI output from
the root export. Verification also found that bundled imports require the
default workflow prompt assets beside the built output, so the build now copies
those assets into `dist/prompts`.

## Related Plans

- **Previous**: `impl-plans/third-party-addon-public-api.md`
- **Depends On**: `impl-plans/third-party-addon-public-api.md`
