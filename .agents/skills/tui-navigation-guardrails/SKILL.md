---
name: tui-navigation-guardrails
description: Use when modifying terminal UI pane focus, keybindings, detail viewers, or selected-row rendering. Requires reviewing the repository TUI rules and design spec before changing behavior.
allowed-tools: Read, Grep, Glob
---

# TUI Navigation Guardrails

Apply this skill whenever you change terminal UI navigation, pane focus, key handling, selected-row rendering, or drill-down behavior.

## Required Reads

Before editing code, open these documents:

1. `AGENTS.md`
   Read the `TUI UX Conventions` section.
2. `design-docs/specs/design-tui.md`
   Read `Panel-interaction consistency` and `Workflow History Screen`.

## Required Invariants

- Only the focused pane may render an active selected-row state.
- `enter` and `ctrl-m` must stay aligned within the same pane unless the spec explicitly documents an exception.
- If `enter` deepens into a pane, `esc` must return from that pane to its immediate parent.
- If `l` moves rightward into a deeper pane, `h` must be the inverse move back to the immediate parent, not a broader screen escape.
- A deeper pane must not reuse reverse-navigation keys for unrelated global actions.
- Keep node-detail behavior aligned with the current spec in `design-docs/specs/design-tui.md`.

## Implementation Checklist

1. Read the required documents before changing code.
2. Update `src/tui/opentui-screen.ts` help text if any visible keybinding behavior changes.
3. Update `design-docs/specs/design-tui.md` whenever the behavior contract changes.
4. Add or update focused tests in `src/tui/opentui-screen.test.ts`.
5. Run at least:
   - `bun test src/tui/opentui-screen.test.ts`
   - `bun run typecheck`

## Scope Note

This skill does not replace the authoritative design documents. It exists to force the correct documents into the workflow before TUI navigation changes are made.
