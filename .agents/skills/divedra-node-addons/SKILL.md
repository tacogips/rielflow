---
name: divedra-node-addons
description: Use when using, reviewing, or implementing divedra node add-ons. Applies to workflow.nodes[].addon, built-in divedra add-ons, local scoped add-ons, third-party add-on resolvers, addon.config, addon.inputs, addon.env, node add-on validation, and add-on-backed worker nodes.
metadata:
  short-description: Use divedra node add-ons
---

# Divedra Node Add-Ons

Use this skill for add-on-backed workflow node registry entries.

## Built-In Add-Ons

Current built-ins, version `1`:

- `divedra/chat-reply-worker`
- `divedra/codex-worker`
- `divedra/claude-code-worker`
- `divedra/x-gateway-read`
- `divedra/x-gateway`
- `divedra/mail-gateway-read`
- `divedra/mail-gateway`
- `divedra/git-commit`
- `divedra/git-push`

Read `references/addons-reference.md` for field contracts and resolver guidance.

## Authoring Pattern

```json
{
  "id": "reply",
  "addon": {
    "name": "divedra/chat-reply-worker",
    "version": "1",
    "config": {
      "textTemplate": "Thanks {{event.actor.displayName}}.",
      "visibility": "public",
      "threadPolicy": "same-thread"
    },
    "inputs": {}
  }
}
```

## Rules

- A registry entry declares exactly one of `nodeFile` or `addon`.
- Add-on-backed nodes do not have local `nodes/node-*.json` payloads.
- Add-ons are worker-only; manager steps must reference file-backed nodes.
- Use explicit object form with `version`.
- `divedra/` names are reserved for built-ins.
- `addon.inputs` becomes resolved node `variables`.
- `addon.config` is validated by the add-on descriptor.
- `addon.env` is explicit; ambient environment variables are not forwarded implicitly.
