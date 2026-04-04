# Node Backend/Model Separation Design

This document defines the canonical separation between a node's execution interface and the provider model name sent through that interface.

## Overview

`node-{id}.json` must distinguish:

- `executionBackend`: which adapter/interface `divedra` uses to execute the node
- `model`: the provider or backend-specific model name passed through that adapter

This avoids the old ambiguous encoding where `model` sometimes meant the execution interface itself.

## Canonical Node Payload Shape

Canonical node payloads use both fields:

```json
{
  "id": "implement",
  "executionBackend": "claude-code-agent",
  "model": "claude-sonnet-4-5",
  "promptTemplate": "Implement {{feature}}.",
  "variables": {
    "feature": "backend/model split"
  }
}
```

Examples:

- `executionBackend: "codex-agent"` with `model: "gpt-5"`
- `executionBackend: "claude-code-agent"` with `model: "claude-opus-4-1"`
- `executionBackend: "official/openai-sdk"` with `model: "gpt-5"`
- `executionBackend: "official/anthropic-sdk"` with `model: "claude-sonnet-4-5"`

## Compatibility Rule

Legacy workflow files remain read-compatible:

```json
{
  "id": "implement",
  "executionBackend": "claude-code-agent",
  "model": "claude-opus-4-1",
  "promptTemplate": "Implement {{feature}}.",
  "variables": {}
}
```

## Authoring Policy

- New workflow templates must write explicit `executionBackend`
- Browser/editor defaults must prefer explicit `executionBackend`
- Documentation must describe `model` as a model name, not a backend identifier
- Validation should reject backend identifiers encoded in `model`

## Non-Goals

- Provider-specific model catalog validation
- Automatic migration/rewrite of existing workflow files
- Restricting model strings to a predefined enum
