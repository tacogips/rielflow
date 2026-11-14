---
name: divedra-tui-operator
description: Use when explaining or operating the divedra terminal UI as an end user. Applies to launching the TUI/server UI, workflow overview/status browsing, pane navigation, selected workflow/session inspection, keyboard movement expectations, and operator workflows. Do not use for implementing TUI code changes; use tui-navigation-guardrails for code modifications.
metadata:
  short-description: Operate the divedra TUI
---

# Divedra TUI Operator

Use this skill for end-user TUI operation and navigation guidance. Do not use it for code changes to TUI behavior.

## Scope

- Launching and using operator-facing workflow overview/status surfaces.
- Explaining navigation expectations.
- Helping users inspect workflows and sessions from the UI.

Read `references/tui-operator.md` for navigation conventions and fallback CLI commands.

## Rules

- Only the focused pane should have active selection.
- List-like panes should support arrow keys and `j` / `k`.
- `enter` and `ctrl-m` should stay semantically aligned.
- `esc` should return from deeper detail panes to their parent pane.
- If UI detail is insufficient, fall back to `workflow status`, `session status`, `session progress`, or GraphQL detail queries.
