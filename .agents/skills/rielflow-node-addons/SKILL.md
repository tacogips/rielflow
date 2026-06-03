---
name: rielflow-node-addons
description: Use when using, reviewing, or implementing rielflow node add-ons. Applies to workflow.nodes[].addon, built-in rielflow add-ons, local scoped add-ons, third-party add-on resolvers, addon.config, addon.inputs, addon.env, node add-on validation, and add-on-backed worker nodes.
metadata:
  short-description: Use rielflow node add-ons
---

# Rielflow Node Add-Ons

Use this skill for add-on-backed workflow node registry entries.

## Built-In Add-Ons

Current built-ins, version `1`:

- `rielflow/chat-reply-worker`
- `rielflow/chat-persona-router`
- `rielflow/codex-worker`
- `rielflow/claude-code-worker`
- `rielflow/workflow-package-sandbox-review`
- `rielflow/x-gateway-read`
- `rielflow/x-gateway`
- `rielflow/mail-gateway-read`
- `rielflow/mail-gateway`
- `rielflow/git-commit`
- `rielflow/git-push`

Read `references/addons-reference.md` for field contracts and resolver guidance.

## Package-Installed Add-Ons

Reusable non-built-in add-ons may be installed from Git-backed rielflow package
registries with `rielflow package install <package-id>`. These packages use
`kind: "node-addon"` in `rielflow-package.json` and install validated
`addon.json` based add-ons into project or user add-on roots. They are
declarative: package install does not run lifecycle scripts, native executor
registration, npm/Bun code, or shell hooks, and workflow load never downloads a
missing add-on package.

Use `rielflow package search --kind node-addon --output json` to discover
registry node add-on packages. Use `--user-scope` for user-wide installs and
`--overwrite` only for package-owned add-on directories.

## Authoring Pattern

```json
{
  "id": "reply",
  "addon": {
    "name": "rielflow/chat-reply-worker",
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
- `rielflow/` names are reserved for built-ins.
- `addon.inputs` becomes resolved node `variables`.
- `addon.config` is validated by the add-on descriptor.
- `addon.env` is explicit; ambient environment variables are not forwarded implicitly.
- Use `rielflow/chat-persona-router` for provider-neutral chat persona
  selection instead of Discord-, Telegram-, or Matrix-specific routing prompts.
- Use `rielflow/chat-reply-worker` for chat replies so provider destinations own
  Discord Gateway, Telegram Gateway, Matrix, or Chat SDK send behavior.
