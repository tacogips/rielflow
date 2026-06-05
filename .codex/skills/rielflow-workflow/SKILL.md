---
name: rielflow-workflow
description: Use when creating, modifying, reviewing, or validating rielflow workflow bundles. Applies to step-addressed workflow.json authoring, node payload files, prompt files, built-in node add-ons, cross-workflow transitions, manager/worker routing, and portable workflows under a workflow root.
metadata:
  short-description: Create rielflow workflow bundles
---

# Rielflow Workflow

Use this skill to author portable rielflow workflow bundles that validate against the current implementation.

## Required Workflow

1. Determine the workflow root and workflow name. If unspecified, use a local workflow root such as `.rielflow/workflows` or `examples` only when that matches the repository convention.
2. Create or update `<workflow-root>/<workflow-name>/workflow.json`.
3. Create `nodes/node-<id>.json` files only for file-backed nodes.
4. Put long prompts in `prompts/*.md` and reference them with `promptTemplateFile`, `systemPromptTemplateFile`, or `sessionStartPromptTemplateFile`.
5. Validate with the available rielflow command, usually `bun run src/main.ts workflow validate <workflow-name> --workflow-definition-dir <workflow-root>` inside the rielflow repo, or `rielflow workflow validate <workflow-name> --workflow-definition-dir <workflow-root>` when installed.

Read `references/workflow-format.md` when authoring anything beyond a one-step worker or when validation errors mention schema, steps, transitions, add-ons, node payloads, or legacy fields.

## Current Authored Model

Author step-addressed bundles only:

- `workflow.json.nodes[]` is a reusable node registry.
- `workflow.json.steps[]` is the executable graph.
- `entryStepId` always names a step.
- `managerStepId` is optional; when omitted and exactly one step has `role: "manager"`, the implementation infers it.
- Local routing, branching, loops, and cross-workflow calls belong in `steps[].transitions`.
- Do not author legacy top-level routing fields: `managerRuntimeId`, `managerNodeId`, `entryNodeId`, `subWorkflows`, `workflowCalls`, `subWorkflowConversations`, `edges`, `loops`, or `branching`.

## Minimal Patterns

Managed workflow:

```json
{
  "workflowId": "example-managed",
  "description": "Managed workflow with one manager and one worker step.",
  "defaults": {
    "maxLoopIterations": 3,
    "nodeTimeoutMs": 120000
  },
  "prompts": {
    "rielflowPromptTemplate": "Coordinate {{workflowId}} and route work to the worker.",
    "workerSystemPromptTemplate": "Return concise business JSON for the next step."
  },
  "managerStepId": "manager",
  "entryStepId": "manager",
  "nodes": [
    { "id": "manager", "nodeFile": "nodes/node-manager.json" },
    { "id": "worker", "nodeFile": "nodes/node-worker.json" }
  ],
  "steps": [
    {
      "id": "manager",
      "nodeId": "manager",
      "role": "manager",
      "transitions": [{ "toStepId": "worker" }]
    },
    {
      "id": "worker",
      "nodeId": "worker",
      "role": "worker"
    }
  ]
}
```

Worker-only workflow:

```json
{
  "workflowId": "example-worker-only",
  "description": "Worker-only workflow with one explicit entry step.",
  "defaults": {
    "maxLoopIterations": 3,
    "nodeTimeoutMs": 120000
  },
  "entryStepId": "main-worker",
  "nodes": [
    { "id": "main-worker", "nodeFile": "nodes/node-main-worker.json" }
  ],
  "steps": [
    { "id": "main-worker", "nodeId": "main-worker", "role": "worker" }
  ]
}
```

Agent node payload:

```json
{
  "id": "worker",
  "description": "Performs the requested worker task.",
  "executionBackend": "codex-agent",
  "model": "gpt-5.5",
  "promptTemplateFile": "prompts/worker.md",
  "variables": {}
}
```

Derived workflow variant:

```json
{
  "workflowId": "cursor-demo",
  "description": "Cursor variant of the demo workflow.",
  "extends": {
    "workflowId": "codex-demo",
    "stringReplacements": {
      "codex-demo": "cursor-demo"
    },
    "agentNodePatch": {
      "executionBackend": "cursor-cli-agent",
      "model": "claude-sonnet-4-5"
    }
  }
}
```

## Authoring Rules

- Node registry ids must match `^[a-z0-9][a-z0-9-]{1,63}$`.
- Each registry entry declares exactly one of `nodeFile` or `addon`.
- A workflow with `extends` is a sparse derived workflow: author `workflowId`
  and `extends.workflowId`; inherit the base workflow graph, prompts, node
  registry, and node payloads.
- `extends.stringReplacements` maps non-empty source strings to replacement
  strings across the inherited in-memory bundle. Use it for same-family workflow
  ids, transition targets, and labels; keep keys specific.
- `extends.agentNodePatch` applies one patch to inherited file-backed agent
  nodes only. It does not patch inline agent nodes or add-on nodes.
- `extends.nodePatch` applies explicit node-id patches after
  `agentNodePatch`; runtime `nodePatch` options still apply after inheritance.
- Derived workflow loading validates the resolved derived bundle and does not
  rewrite the base or derived workflow files on disk. Inheritance cycles fail
  validation.
- Manager steps must reference file-backed nodes; add-on-backed nodes are worker-only.
- Prefer DRY workflow composition over combined one-off nodes. If behavior can be expressed as reusable primitive nodes chained by `steps[].transitions`, author it that way; for example, model commit-and-push as a git commit step followed by a git push step instead of duplicating commit logic in a separate commit-and-push node.
- Agent nodes require `executionBackend`, backend-specific `model`, `promptTemplate` or `promptTemplateFile`, and `variables`.
- Valid `executionBackend` values include `codex-agent`, `claude-code-agent`, `cursor-cli-agent`, `official/openai-sdk`, `official/anthropic-sdk`, and `official/cursor-sdk`.
- Do not encode backend identifiers in `model`; `model` should be a provider/backend model name.
- Valid authored `nodeType` values are `agent`, `command`, `container`, and `user-action`. Do not author `nodeType: "addon"`.
- A cross-workflow transition uses `toWorkflowId`, `toStepId`, and `resumeStepId`; `resumeStepId` must name a step in the current workflow.
- A step may have at most one cross-workflow transition.

## Built-In Add-Ons

Use object form with explicit version:

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
    }
  }
}
```

Current built-ins include `rielflow/chat-reply-worker`, `rielflow/codex-worker`, `rielflow/claude-code-worker`, `rielflow/x-gateway-read`, `rielflow/x-gateway`, `rielflow/mail-gateway-read`, `rielflow/mail-gateway`, `rielflow/git-commit`, `rielflow/git-push`, and `rielflow/youtube-mp4-download`, all version `1`.

`rielflow/youtube-mp4-download` requires `addon.inputs.url`, invokes external `yt-dlp`, writes under the workflow working directory, accepts only single-video YouTube routes, rejects playlists and non-YouTube hosts, creates a fresh per-execution child directory below `outputDirectory`, and accepts optional config keys `ytDlpPath`, `outputDirectory`, `fileNameTemplate`, `formatSelector`, and `timeoutMs`. Defaults are `ytDlpPath: "yt-dlp"`, `outputDirectory: "downloads"`, `fileNameTemplate: "%(title).200B-%(id)s.%(ext)s"`, and `formatSelector: "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[ext=mp4]"`; `timeoutMs` defaults to the node execution timeout or the native executor fallback. Successful runs return provider `native-addon:youtube-mp4-download`, model `rielflow/youtube-mp4-download@1`, stdout/stderr process logs, and structured output fields for status, URL, workflow-relative output path, file name, and file size when available.

## External Portability

When creating workflows for users outside the rielflow repository:

- Avoid repo-specific absolute paths in workflow files.
- Keep node payload and prompt paths workflow-relative.
- Prefer `promptTemplateFile` for prompts users may edit.
- Include enough `description` fields for UI inspection and validation output to be understandable.
- If the rielflow CLI is not available, still produce the bundle but state that validation could not be run.
