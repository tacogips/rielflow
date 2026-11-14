---
name: rielflow-troubleshooting
description: Use when diagnosing failed, paused, stalled, timed out, or surprising rielflow workflow executions. Applies to session status/progress/logs/export, runtime artifacts, node execution records, workflow validation failures, backend invocation errors, timeout failures, GraphQL inspection, event receipts, and artifact/session-store path issues.
metadata:
  short-description: Troubleshoot rielflow runs
---

# Rielflow Troubleshooting

Use this skill when a rielflow workflow does not behave as expected.

## First Commands

```bash
rielflow workflow validate <workflow-name> --workflow-definition-dir <root>
```

```bash
rielflow session status <session-id> --output json
```

```bash
rielflow session progress <session-id>
```

Read `references/troubleshooting.md` for triage by symptom.

## Rules

- Fix validation failures before diagnosing runtime behavior.
- Prefer JSON status/export for machine comparison.
- Check workflow root and scope resolution before assuming a workflow changed.
- Use mock scenarios to isolate backend failures from workflow graph failures.
- Check artifact/session roots when outputs or logs seem missing.
