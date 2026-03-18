# TUI Design

This document defines terminal UI design for workflow selection and execution in Bun.

## Overview

`divedra tui` provides:
- workflow selection from `<workflow-root>`
- interactive workflow execution
- runtime user input for `human-input` nodes
- execution trace visibility aligned with artifact outputs

The TUI uses the same workflow loader and execution engine as CLI and serve mode.

## Framework Selection

Selected framework: `neo-blessed` (Bun runtime, TypeScript integration).

Why:
- Full-screen TUI primitives (list/table/log/input/modal) needed for workflow selector + run console.
- Mature event model for keyboard-driven UX.
- Works as a Node-style terminal library that Bun can run in practice via compatibility layer.

Not selected now:
- `Ink`: strong React model, but current Bun input compatibility concerns exist in open issue tracking.
- prompt-only libraries: insufficient for multi-pane live execution/trace experience.

Selection policy:
- Keep TUI framework swappable behind a thin UI adapter.
- Re-evaluate `Ink` after Bun compatibility issue closure.

## Interaction Model

### Startup

Command:
- `divedra tui`
- `divedra tui --workflow <name>` (skip selector)
- `divedra tui --resume-session <id>`

Workflow root resolution:
1. `--workflow-root`
2. `DIVEDRA_WORKFLOW_ROOT`
3. `./.divedra`

### Main Layout

Three-pane default layout:
- Left: workflow/session list
- Center: execution timeline (node, transition, branch/loop decisions)
- Right: node details and artifact path summary

Bottom panel:
- live logs and key hints

### Human Input Handling

When the execution engine reaches `human-input`:
1. `divedra` manager pauses transition.
2. TUI opens input modal (single-line, multi-line, or select form by input schema).
3. Input is validated.
4. Resolved payload is written to execution artifact `input.json`.
5. Execution resumes.

## Data and Artifact Integration

Per-node execution output location:
- `.divedra-datas/workflow/{workflow_id}/{node}/{node-exec-id}/`

TUI behavior:
- displays active artifact directory for current node run
- allows quick jump to recent `input.json` / `output.json` / `meta.json` summaries
- never mutates historical `output.json`; only appends new runs

## Keybindings (Initial)

- `j` / `k`: move selection
- `enter`: open / execute / confirm
- `i`: open input modal (when waiting for user input)
- `r`: refresh workflow list/session state
- `l`: focus log panel
- `q`: quit (with running-session confirmation)

## Failure and Recovery

- On terminal resize: relayout without dropping execution state.
- On non-interactive terminal: fallback to plain prompt mode with same engine.
- On TUI crash: session remains recoverable through `session resume` or `divedra tui --resume-session`.

## Implementation Notes

- Runtime: Bun
- Language: TypeScript strict mode
- UI adapter boundary: isolate direct `neo-blessed` usage in one module so replacement cost is low.
- Do not duplicate workflow logic in UI; UI consumes engine events.

## References

- Bun runtime docs: https://bun.sh/docs
- neo-blessed package: https://www.npmjs.com/package/neo-blessed
- Ink package: https://www.npmjs.com/package/ink
- Bun + Ink compatibility issue: https://github.com/oven-sh/bun/issues/6862
