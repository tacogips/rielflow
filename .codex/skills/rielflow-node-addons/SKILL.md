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
- `rielflow/mp4-audio-extract`
- `rielflow/git-commit`
- `rielflow/git-push`

Read `references/addons-reference.md` for field contracts and resolver guidance
when that reference is present.

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

## MP4 Audio Extract Pattern

```json
{
  "id": "extract-audio",
  "addon": {
    "name": "rielflow/mp4-audio-extract",
    "version": "1",
    "config": {
      "mp4PathTemplate": "{{args.videoPath}}",
      "sampleRateHertz": 16000,
      "audioChannelCount": 1
    }
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
- `rielflow/mp4-audio-extract` requires `mp4PathTemplate`, writes
  `audio/extracted.flac`, emits `audioExtract`, and requires host `ffmpeg`
  unless `ffmpegPath` is configured.
- Executable add-ons that write mailbox JSON must use a real JSON encoder and
  declare required runtime tools in `execution.runtimeHints`.
- Use `rielflow/chat-persona-router` for provider-neutral chat persona
  selection instead of Discord-, Telegram-, or Matrix-specific routing prompts.
- Use `rielflow/chat-reply-worker` for chat replies so provider destinations own
  Discord Gateway, Telegram Gateway, Matrix, or Chat SDK send behavior.
