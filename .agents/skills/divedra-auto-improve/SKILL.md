---
name: divedra-auto-improve
description: Use when configuring, running, inspecting, or troubleshooting divedra auto-improve supervision. Applies to workflow run --auto-improve, nested supervisor/superviser workflows, supervision policies, stall detection, remediation budgets, workflow patch modes, targeted reruns, supervision state, nestedSuperviserDriver, and GraphQL/library parity for supervised execution.
metadata:
  short-description: Use divedra auto-improve
---

# Divedra Auto Improve

Use this skill for supervised workflow execution and remediation loops.

## Recommended Execution

For important workflow execution, prefer the supervisor-backed path:

```bash
divedra workflow run <workflow-name> \
  --workflow-root <root> \
  --auto-improve \
  --nested-supervisor \
  --max-supervised-attempts 3 \
  --workflow-mutation-mode execution-copy \
  --output json
```

This is the recommended mode when the user wants divedra to monitor the target workflow, detect terminal failure or stalls, preserve supervision audit state, and let a paired supervisor workflow drive remediation.

## CLI Pattern

```bash
divedra workflow run <workflow-name> \
  --workflow-root <root> \
  --auto-improve \
  --max-supervised-attempts 3 \
  --output json
```

Nested supervisor:

```bash
divedra workflow run <workflow-name> \
  --workflow-root <root> \
  --auto-improve \
  --nested-supervisor \
  --output json
```

Read `references/auto-improve.md` for policy options and inspection.

## Rules

- `--nested-supervisor` requires `--auto-improve`; `--nested-superviser` is a legacy alias.
- Prefer `--auto-improve --nested-supervisor` for real workflow execution where recovery matters.
- Nested supervision is meaningful for start/resume, not step rerun.
- Remote GraphQL execution must carry the same supervision policy as local execution.
- Default mutation mode should be execution-scoped copy unless the user explicitly wants in-place workflow edits.
- Inspect supervision state through session status/export or GraphQL/library supervision summaries.
