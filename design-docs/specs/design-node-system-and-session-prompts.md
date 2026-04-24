# Node System And Session-Start Prompt Design

This document defines the authored node fields used to separate stable role instructions from per-turn prompts and to wrap only the first prompt in a reused backend session.

## Overview

Before this change, a node only had `promptTemplate`, so every execution prompt mixed:

- stable role instructions
- per-turn work instructions
- first-session bootstrapping text

That was not enough for debate-style or session-reuse workflows where:

- the role should live in a stable system prompt
- the first turn should be wrapped differently from later turns
- later turns should continue the same backend session without replaying the first-turn wrapper

## Node Payload Contract

`node-{id}.json` may now declare:

```json
{
  "systemPromptTemplateFile": "prompts/system.md",
  "promptTemplateFile": "prompts/body.md",
  "sessionStartPromptTemplateFile": "prompts/session-start.md"
}
```

Semantics:

- `systemPromptTemplate` is rendered for every execution and sent as the node-local system prompt
- `promptTemplate` remains the per-execution body instruction
- `sessionStartPromptTemplate` is rendered only when the runtime starts a fresh backend session for that node execution

Template rendering context includes:

- normal workflow/node/runtime variables
- inbox/mailbox variables
- `prompt`: the rendered per-turn prompt body
- `args` / `arguments`: the assembled structured arguments object or `null`

This supports authored wrappers such as:

```text
##prompt
{{prompt}}
## args
{{args}}
```

## Runtime Composition

For agent nodes, the runtime now composes prompts as:

1. workflow-level manager/worker system layer
2. node-level `systemPromptTemplate`
3. optional node-level `sessionStartPromptTemplate` on first backend-session turn only
4. mailbox/context sections

When `sessionPolicy.mode = "reuse"`:

- first visit sends the session-start wrapper
- later visits omit it

When a node does not reuse backend sessions, each execution is treated as a fresh first turn, so the session-start wrapper is included each time.

## Adapter Contract

Adapter input now carries:

```ts
interface AdapterExecutionInput {
  readonly systemPromptText?: string;
  readonly promptText: string;
}
```

Rules:

- official SDK adapters send `systemPromptText` through provider-native system/instructions fields
- remote `codex-agent` / `claude-code-agent` request bodies include `systemPromptText`
- for backward compatibility with older remote wrappers, the transport still prefixes `promptText` with `systemPromptText` when sending the remote request body

## Example Use

The `examples/codex-codex-euthanasia-debate/` bundle uses:

- a node-local system prompt to pin one debater to the affirmative position
- a node-local system prompt to pin the other debater to the negative position
- a session-start wrapper that formats the first prompt as:
  `##prompt ... ## args ...`

This lets each debater keep a stable role across turns while only bootstrapping the session once.
The workflow uses step-addressed `transitions` and a `debate-judge` step (labeled branches) to schedule rounds instead of structural `subWorkflowConversations`.
