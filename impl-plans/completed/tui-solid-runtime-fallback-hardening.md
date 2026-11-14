# TUI Solid Runtime Fallback Hardening Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-tui.md`, `design-docs/specs/architecture.md`
**Created**: 2026-03-26
**Last Updated**: 2026-03-26

## Design Document Reference

**Source**: `design-docs/specs/design-tui.md`, `design-docs/specs/architecture.md`

### Summary

Harden interactive `divedra tui` fallback detection after the OpenTUI Solid migration so the CLI degrades cleanly not only when `@opentui/*` packages are missing, but also when the checked-in `.tsx` renderer cannot load its required `solid-js` runtime modules.

### Scope

**Included**:

- `src/cli.ts` fallback detection for missing OpenTUI and Solid runtime packages
- `src/cli.test.ts` coverage for `solid-js` and `solid-js/jsx-runtime` missing-package cases
- design and architecture doc updates describing the broader fallback boundary
- implementation-plan progress/index updates for this follow-up hardening

**Excluded**:

- new TUI features or navigation behavior changes
- broader runtime selection policy changes outside package-availability fallback
- dependency installation/tooling changes

## Modules

### 1. CLI Fallback Detection

#### `src/cli.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Treat missing `solid-js` package errors as OpenTUI-unavailable fallback cases
- [x] Treat missing `solid-js/jsx-runtime` module errors as OpenTUI-unavailable fallback cases
- [x] Keep unrelated package-resolution failures from silently downgrading to fallback mode

### 2. Verification and Documentation

#### `src/cli.test.ts`, `design-docs/specs/design-tui.md`, `design-docs/specs/architecture.md`

**Status**: COMPLETED

**Checklist**:

- [x] Add regression coverage for missing `solid-js` and `solid-js/jsx-runtime`
- [x] Keep non-TUI dependency failures out of the fallback allowlist
- [x] Update design text so the runtime boundary matches the migrated `.tsx` dependency graph

## Completion Criteria

- [x] Interactive TUI fallback detection covers the full checked-in OpenTUI Solid dependency boundary
- [x] Regression tests cover the new fallback cases
- [x] Design and implementation-plan records match the shipped fallback behavior

## Progress Log

### Session: 2026-03-26 20:10

**Tasks Completed**: Design/architecture mismatch review, fallback hardening patch, regression coverage, plan/index updates
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The OpenTUI Solid migration changed the interactive TUI load path from a pure `@opentui/core` boundary to a `.tsx` stack that also depends on `solid-js/jsx-runtime`. Without this hardening, a missing Solid runtime package would raise a hard error instead of following the documented readline fallback path.
