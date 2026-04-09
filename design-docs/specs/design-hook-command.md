# Design: `divedra hook` Command

Receive Claude Code and Codex CLI hook payloads via stdin, determine vendor and event type, and dispatch to appropriate handlers.

## Overview

Agent backends (Claude Code, Codex CLI) support lifecycle hooks -- shell commands invoked at specific points during agent execution. `divedra hook` acts as a unified entry point that both backends can call. It reads a JSON payload from stdin, identifies which vendor sent it and which event fired, then dispatches to the matching handler. All handlers are initially noop stubs that return a neutral (pass-through) JSON response.

The command validates only the stable shared transport fields it depends on (`session_id`, `hook_event_name`, `cwd`) and preserves the remaining vendor-specific fields as raw JSON. Current Codex docs also document `transcript_path` and `model` as common fields, but Claude Code payloads should not be forced to provide Codex-specific fields. External hook protocols evolve independently, so the local TypeScript model should stay open to future fields rather than claiming exhaustive coverage before real handlers need it.

## Data Flow

```
Agent Backend (Claude Code / Codex CLI)
  |
  |  stdin: JSON payload
  v
divedra hook
  |
  +-- parse JSON from stdin
  +-- detect vendor (claude-code | codex)
  +-- extract event name
  +-- dispatch to handler(vendor, event, payload)
  |      |
  |      +-- handler returns HookResponse
  |
  +-- serialize HookResponse to stdout JSON
  +-- exit with appropriate code
```

## Vendor Detection

Both Claude Code and Codex send a `hook_event_name` field in their stdin payload. The event name sets overlap significantly. Detection uses a two-step strategy:

1. **Explicit `--vendor` flag** (authoritative when present): `divedra hook --vendor claude-code` or `divedra hook --vendor codex`.
2. **Heuristic field probe** (fallback when `--vendor` is omitted): Codex payloads document `turn_id` on turn-scoped events plus common `transcript_path` and `model` fields; Claude Code payloads may carry `agent_id` or additional events (`Notification`, `SubagentStart`, etc.) that Codex does not define. The detector checks for these discriminating fields.

The recommended configuration is to always pass `--vendor` so detection is deterministic. The heuristic path is intentionally best-effort because the shared event names (`SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`) are otherwise ambiguous.

## CLI Interface

```
divedra hook [--vendor claude-code|codex]
```

Stdin: JSON payload from the hook caller.
Stdout: JSON response (when exit 0).
Stderr: error/block reason text (when exit 2).

`divedra hook` is a machine-facing command and always writes JSON on success. It does not participate in the human-oriented CLI `--output` presentation mode.

### Exit Codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| 0    | Success; stdout contains JSON response  |
| 2    | Block/deny; stderr contains reason text |
| 1    | Parse or internal error                 |

These codes align with the protocol both Claude Code and Codex expect.

## Type Definitions

The hook pipeline keeps a small explicit typed core for routing and validation while preserving vendor-specific and future fields in a generic payload record.

### Vendor Enum

```typescript
enum HookVendor {
  ClaudeCode = "claude-code",
  Codex = "codex",
}
```

### Common Hook Event Enum

Events supported by both vendors, plus vendor-specific extensions.

```typescript
enum HookEventName {
  // Shared events (both vendors)
  SessionStart = "SessionStart",
  PreToolUse = "PreToolUse",
  PostToolUse = "PostToolUse",
  UserPromptSubmit = "UserPromptSubmit",
  Stop = "Stop",

  // Claude Code only
  PostToolUseFailure = "PostToolUseFailure",
  PermissionRequest = "PermissionRequest",
  PermissionDenied = "PermissionDenied",
  SubagentStart = "SubagentStart",
  SubagentStop = "SubagentStop",
  InstructionsLoaded = "InstructionsLoaded",
  Notification = "Notification",
  TaskCreated = "TaskCreated",
  TaskCompleted = "TaskCompleted",
  ConfigChange = "ConfigChange",
  CwdChanged = "CwdChanged",
  FileChanged = "FileChanged",
  StopFailure = "StopFailure",
  Elicitation = "Elicitation",
  ElicitationResult = "ElicitationResult",
  WorktreeCreate = "WorktreeCreate",
  WorktreeRemove = "WorktreeRemove",
  PreCompact = "PreCompact",
  PostCompact = "PostCompact",
  SessionEnd = "SessionEnd",
  TeammateIdle = "TeammateIdle",
  Unknown = "Unknown",
}
```

### Input Payload Interface

```typescript
interface HookInputPayload extends Readonly<Record<string, unknown>> {
  readonly session_id: string;
  readonly cwd: string;
  readonly hook_event_name: string;
  readonly transcript_path?: string | null;
  readonly model?: string;
  readonly turn_id?: string;
  readonly source?: string;
}
```

The parser validates:

- `session_id`: non-empty string
- `hook_event_name`: non-empty string
- `cwd`: non-empty string
- `transcript_path`: optional; string or `null` when present
- `model`: optional string when present

Everything else remains in the payload unchanged for vendor-specific handlers.

### Output Response Interfaces

#### Response Envelope

```typescript
interface HookResponse {
  readonly continue?: boolean;
  readonly stopReason?: string;
  readonly suppressOutput?: boolean;
  readonly systemMessage?: string;
  readonly decision?: "block";
  readonly reason?: string;
  readonly hookSpecificOutput?: Readonly<Record<string, unknown>> & {
    readonly hookEventName: string;
  };
}
```

## Parsed Hook Context

After JSON parsing and vendor detection, the command creates a context object passed to the dispatcher:

```typescript
interface ParsedHookContext {
  readonly vendor: HookVendor;
  readonly eventName: HookEventName;
  readonly rawEventName: string;
  readonly payload: HookInputPayload;
}
```

## Dispatch Architecture

### Handler Interface

```typescript
interface HookHandler {
  handle(ctx: ParsedHookContext): Promise<HookResponse>;
}
```

### Dispatch Table

The dispatcher maps `(vendor, eventName)` pairs to handler implementations. On startup, all slots are filled with a `NoopHookHandler` that returns an empty `HookResponse` (`{}`), which both vendors interpret as "proceed normally."

```typescript
// Conceptual structure -- not literal code
type HandlerKey = `${HookVendor}:${HookEventName}`;
type HandlerRegistry = ReadonlyMap<HandlerKey, HookHandler>;
```

For unrecognized or not-yet-modeled events, the dispatcher falls back to `NoopHookHandler` without writing stderr noise. The hook command should stay quiet unless it blocks execution or encounters a real parse/runtime error.

### Noop Handler

```typescript
class NoopHookHandler implements HookHandler {
  async handle(_ctx: ParsedHookContext): Promise<HookResponse> {
    return {};
  }
}
```

## Processing Pipeline

1. **Read stdin** -- buffer all of stdin to a string.
2. **Parse JSON** -- `JSON.parse` the string. On failure, exit 1 with stderr message.
3. **Validate transport fields** -- confirm the shared `session_id`, `hook_event_name`, and `cwd` fields have the expected shape. Validate vendor-specific detection hints only when they are present (`transcript_path` as `string | null`, `model` as `string`). On failure, exit 1.
4. **Detect vendor** -- use `--vendor` flag or heuristic probe on the parsed object.
5. **Resolve event name** -- map the `hook_event_name` string to `HookEventName` when it is currently modeled. Unknown values map to a fallback path, but the raw event string is preserved.
6. **Build `ParsedHookContext`** -- assemble vendor, normalized event, raw event name, and validated payload.
7. **Dispatch** -- look up handler from registry, call `handle(ctx)`.
8. **Respond** -- serialize the returned `HookResponse` to stdout as JSON. If the response contains `decision: "block"`, exit with code 0 (the JSON itself carries the block semantic). For future handlers that want the exit-2 protocol, the handler may throw a `HookBlockError` that the pipeline catches, writes `reason` to stderr, and exits 2.

## Vendor Heuristic Detection

When `--vendor` is not provided:

```
if payload has "turn_id" field
  -> likely codex
if payload has "model" field
  -> likely codex
if payload has "transcript_path" field
  -> likely codex
if payload has "agent_id" field
  -> likely claude-code
if hook_event_name is claude-code-only event (SubagentStart, Notification, etc.)
  -> claude-code
else
  -> default to claude-code (more event types = safer default)
```

## File Layout

```
src/
  hook/
    types.ts           # Stable hook enums and payload/response contracts
    detect-vendor.ts   # Vendor detection logic
    parse.ts           # stdin reading, JSON parsing, payload validation
    dispatch.ts        # Handler registry and dispatch table
    handler.ts         # HookHandler interface + NoopHookHandler
    index.ts           # Pipeline orchestrator (read -> parse -> detect -> dispatch -> respond)
```

The CLI entry in `src/cli.ts` adds a `scope === "hook"` branch that calls the pipeline orchestrator.

## Agent Backend Hook Configuration

### Claude Code (`settings.json` or `.claude/settings.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "divedra hook --vendor claude-code" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "divedra hook --vendor claude-code" }
        ]
      }
    ]
  }
}
```

### Codex (`hooks.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "divedra hook --vendor codex" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "divedra hook --vendor codex" }
        ]
      }
    ]
  }
}
```

## Future Extension Points

When real dispatch logic is needed, replace `NoopHookHandler` entries in the registry:

- **PreToolUse** -- intercept dangerous commands, inject divedra context, or gate permissions.
- **PostToolUse** -- capture tool outputs for session logging, artifact tracking, or inter-node communication.
- **SessionStart** -- inject divedra workflow context as `additionalContext`.
- **Stop** -- persist session checkpoints, trigger workflow transitions.
- **UserPromptSubmit** -- augment prompts with workflow state.

Each handler can be developed independently and registered into the dispatch table without changing the pipeline.

## References

- Claude Code hooks: https://code.claude.com/docs/en/hooks.md
- Codex CLI hooks: source `codex-rs/hooks/src/schema.rs` and `codex-rs/hooks/src/engine/`
- See `design-docs/references/README.md` for external references
