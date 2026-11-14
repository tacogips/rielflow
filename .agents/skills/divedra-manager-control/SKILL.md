---
name: divedra-manager-control
description: Use when implementing or issuing divedra manager control-plane actions. Applies to divedra graphql, GraphQL manager mutations, sendManagerMessage, retry-step, replay-communication, optional-step execute/skip decisions, manager session auth, idempotency keys, scoped attachments, and avoiding freeform-only privileged control.
metadata:
  short-description: Use manager GraphQL control
---

# Divedra Manager Control

Use this skill for manager-facing control actions. Prefer typed GraphQL actions over freeform prose when `divedra graphql` is available.

## Command Pattern

```bash
divedra graphql '
  mutation SendManagerMessage($input: SendManagerMessageInput!) {
    sendManagerMessage(input: $input) {
      managerMessage {
        id
        managerSessionId
        createdAt
      }
    }
  }
' --variables @variables.json
```

Read `references/manager-control.md` for auth, idempotency, attachments, and action rules.

## Rules

- Manager-scoped mutations require a manager session id and bearer auth token.
- `DIVEDRA_MANAGER_SESSION_ID` is forwarded by `divedra graphql`.
- `DIVEDRA_MANAGER_AUTH_TOKEN` is the default auth token source.
- Use idempotency keys for manager mutations.
- Do not mix GraphQL manager messages with payload `managerControl` in the same manager execution.
- Use step ids for retry and optional-step actions; node-id action aliases are removed.
