# Node System And Session-Start Prompts Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#prompt-and-input-assembly, design-docs/specs/design-workflow-json.md#node-idjson
**Created**: 2026-03-26
**Last Updated**: 2026-03-26

## Summary

Add node-local system prompts and first-session-only prompt templates so authored workflows can pin a stable role in the backend system prompt while wrapping only the first prompt of a reused backend session.

## Scope

Included:
- Node payload schema support for `systemPromptTemplate*` and `sessionStartPromptTemplate*`
- Workflow-local file loading for the new template fields
- Prompt composition support for `prompt` / `args` template variables
- Adapter contract support for `systemPromptText`
- Example workflow showing two codex debate nodes with a 10-turn conversation cap

Not included:
- Provider-side remote wrapper changes outside this repository
- Editor-specific form controls for the new node fields

## Modules

### 1. Workflow Schema And Loading

#### `src/workflow/types.ts`

```ts
interface NodePayload {
  readonly systemPromptTemplate?: string;
  readonly systemPromptTemplateFile?: string;
  readonly sessionStartPromptTemplate?: string;
  readonly sessionStartPromptTemplateFile?: string;
}
```

**Checklist**:
- [x] Add node payload types for system and session-start templates
- [x] Load workflow-local files into the new inline template fields
- [x] Validate safe workflow-relative file paths

### 2. Prompt Composition And Adapter Wiring

#### `src/workflow/prompt-composition.ts`

```ts
interface ComposedExecutionPrompts {
  readonly systemPromptText?: string;
  readonly promptText: string;
}
```

**Checklist**:
- [x] Render `prompt` and `args` helper variables for node templates
- [x] Separate system-prompt text from normal prompt text
- [x] Include session-start text only for fresh backend-session turns
- [x] Forward system prompts through official SDK and remote adapter contracts

### 3. Example And Documentation

#### `examples/codex-codex-euthanasia-debate/`

**Checklist**:
- [x] Add a two-lane codex debate workflow on euthanasia
- [x] Configure the debate conversation with `maxTurns: 10`
- [x] Use node system/session-start prompts to pin the two speaker roles
- [x] Update examples and design documentation

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Workflow schema and loading | `src/workflow/types.ts`, `src/workflow/load.ts`, `src/workflow/validate.ts` | COMPLETED | `src/workflow/load.test.ts`, `src/workflow/validate.test.ts` |
| Prompt composition and adapters | `src/workflow/prompt-composition.ts`, `src/workflow/adapter.ts`, `src/workflow/adapters/*.ts`, `src/workflow/call-step-impl.ts`, `src/workflow/engine.ts` | COMPLETED | prompt/adapters tests, `tsc --noEmit` |
| Example and documentation | `examples/codex-codex-euthanasia-debate/`, `design-docs/specs/*.md`, `examples/README.md` | COMPLETED | workflow validate/inspect |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Prompt composition and adapters | Workflow schema and loading | READY |
| Example and documentation | Prompt composition and adapters | READY |

## Completion Criteria

- [x] Nodes can declare system prompts separately from normal prompt bodies
- [x] Nodes can declare a first-session-only prompt wrapper
- [x] Fresh backend-session turns include the session-start template and later reused turns omit it
- [x] Official SDK adapters receive system prompts through provider-native fields
- [x] Remote adapter payloads expose `systemPromptText` while preserving backward compatibility
- [x] The euthanasia debate example validates from `./examples`
- [x] Type checking passes
- [x] Targeted tests pass

## Progress Log

### Session: 2026-03-26 20:50
**Tasks Completed**: Plan creation, workflow schema/loading, prompt composition/adapters, example/docs, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added node-local `systemPromptTemplate` plus `sessionStartPromptTemplate`, rendered first-turn wrappers with `{{prompt}}` and `{{args}}`, forwarded system prompts through official SDK adapters and remote transport payloads, and added a codex-vs-codex euthanasia debate example capped at 10 turns.
