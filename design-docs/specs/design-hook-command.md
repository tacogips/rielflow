# Design: `rielflow hook` Command

Receive Claude Code, Codex CLI, and Gemini CLI hook payloads via stdin, determine vendor and event type, associate the backend session with the active rielflow workflow execution when ambient rielflow environment is present, record the hook event, and dispatch to policy handlers.

## Overview

Agent backends (Claude Code, Codex CLI, Gemini CLI) support lifecycle hooks -- shell commands invoked at specific points during agent execution. `rielflow hook` acts as a unified entry point that these backends can call. It reads a JSON payload from stdin, identifies which vendor sent it and which event fired, resolves any rielflow workflow context from environment variables, dispatches to the matching policy handler, then records the hook event and handler result when it can be associated with a workflow execution.

The command validates only the stable shared transport fields it depends on (`session_id`, `hook_event_name`, `cwd`) and preserves the remaining vendor-specific fields as raw JSON. Current Codex docs also document `transcript_path` and `model` as common fields, but Claude Code payloads should not be forced to provide Codex-specific fields. External hook protocols evolve independently, so the local TypeScript model should stay open to future fields rather than claiming exhaustive coverage before real handlers need it.

Recording is automatic and pass-through by default. A globally configured Claude/Codex/Gemini hook may run outside rielflow; in that case the command returns the normal hook response but does not persist a rielflow event because the required workflow execution context is absent.

## Data Flow

```
Agent Backend (Claude Code / Codex CLI / Gemini CLI)
  |
  |  stdin: JSON payload
  v
rielflow hook
  |
  +-- parse JSON from stdin
  +-- detect vendor (claude-code | codex | gemini)
  +-- extract event name
  +-- resolve rielflow hook context from environment
  |      |
  |      +-- workflowExecutionId from RIEL_WORKFLOW_EXECUTION_ID
  |      +-- agentSessionId from payload.session_id
  |      +-- managerSessionId from RIEL_MANAGER_SESSION_ID, when present
  |
  +-- dispatch to handler(vendor, event, payload, rielflowContext)
  |      |
  |      +-- handler returns HookResponse
  |
  +-- record hook event and handler result when rielflowContext is present
  |
  +-- serialize HookResponse to stdout JSON
  +-- exit with appropriate code
```

## Vendor Detection

Claude Code, Codex, and Gemini send a `hook_event_name` field in their stdin payload. The event name sets overlap significantly. Detection uses a two-step strategy:

1. **Explicit `--vendor` flag** (authoritative when present): `rielflow hook --vendor claude-code`, `rielflow hook --vendor codex`, or `rielflow hook --vendor gemini`.
2. **Heuristic field probe** (fallback when `--vendor` is omitted): Gemini has Gemini-only events (`BeforeTool`, `AfterTool`, `BeforeAgent`, etc.) and documents `timestamp` in the common payload; Codex payloads document `turn_id` on turn-scoped events plus common `transcript_path` and `model` fields; Claude Code payloads may carry `agent_id` or additional events (`SubagentStart`, etc.) that the other vendors do not define. The detector checks for these discriminating fields.

The generated snippet configuration uses the vendor-detecting `rielflow hook` command. Users can still pass `--vendor` manually when they need deterministic override behavior for a custom hook shape.

## CLI Interface

```
rielflow hook [--vendor claude-code|codex|gemini]
```

Stdin: JSON payload from the hook caller.
Stdout: JSON response (when exit 0).
Stderr: error/block reason text (when exit 2).

`rielflow hook` is a machine-facing command and always writes JSON on success. It does not participate in the human-oriented CLI `--output` presentation mode.

The command has no required workflow flags. Workflow association is resolved from ambient environment variables injected into rielflow-launched agent processes.

### Ambient Workflow Context

Rielflow-launched Claude Code, Codex, and Gemini processes must receive a generic hook-recording context in their process environment:

| Variable | Required For Recording | Meaning |
| -------- | ---------------------- | ------- |
| `RIEL_WORKFLOW_ID` | Yes | Workflow definition id. |
| `RIEL_WORKFLOW_EXECUTION_ID` | Yes | Rielflow workflow run id. This is the same identifier used as the persisted workflow session id. |
| `RIEL_NODE_ID` | Yes | Workflow node currently executing the backend session. |
| `RIEL_NODE_EXEC_ID` | Yes | Runtime node execution id for this backend invocation. |
| `RIEL_AGENT_BACKEND` | No | Backend name such as `codex-agent` or `claude-code-agent`; useful for diagnostics. |
| `RIEL_MANAGER_SESSION_ID` | No | Manager control-plane session id when the hook runs inside a manager node. |
| `RIEL_MANAGER_STEP_ID` | No | Manager-specific step id. Used only when `RIEL_NODE_ID` is absent. |
| `RIEL_MANAGER_NODE_EXEC_ID` | No | Backward-compatible manager-specific node execution id. Used only when `RIEL_NODE_EXEC_ID` is absent. |

The backend hook payload supplies `session_id`; rielflow records that value as `agentSessionId`. The core association is:

```
RIEL_WORKFLOW_EXECUTION_ID + payload.session_id
  -> workflow run + backend agent session
```

When `RIEL_MANAGER_SESSION_ID` is present, records also link the backend hook event to the manager control-plane session.

### Recording Controls

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `RIEL_HOOK_RECORDING` | `auto` | `auto` records only when required rielflow context is present; `off` disables persistence; `required` treats missing context as a hook error. |
| `RIEL_HOOK_STRICT` | `false` | When `true`, persistence failures become hook errors. When `false`, persistence failures are logged to stderr and the hook remains pass-through. |
| `RIEL_HOOK_CAPTURE_RAW` | `redacted` | `redacted` writes a redacted payload artifact; `metadata-only` stores no raw payload artifact; `full` stores the full payload and should be used only in trusted environments. |

### Exit Codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| 0    | Success; stdout contains JSON response  |
| 2    | Block/deny; stderr contains reason text |
| 1    | Parse or internal error                 |

These codes align with the protocol Claude Code, Codex, and Gemini expect.

Recording failures do not block the agent by default. Blocking behavior is reserved for explicit policy handlers or for `RIEL_HOOK_STRICT=true` / `RIEL_HOOK_RECORDING=required` misconfiguration.

## Type Definitions

The hook pipeline keeps a small explicit typed core for routing and validation while preserving vendor-specific and future fields in a generic payload record.

### Vendor Enum

```typescript
enum HookVendor {
  ClaudeCode = "claude-code",
  Codex = "codex",
  Gemini = "gemini",
}
```

### Common Hook Event Enum

Events supported across vendors, plus vendor-specific extensions.

```typescript
enum HookEventName {
  // Shared or cross-vendor events
  SessionStart = "SessionStart",
  PreToolUse = "PreToolUse",
  PostToolUse = "PostToolUse",
  BeforeTool = "BeforeTool",
  AfterTool = "AfterTool",
  UserPromptSubmit = "UserPromptSubmit",
  BeforeAgent = "BeforeAgent",
  AfterAgent = "AfterAgent",
  BeforeModel = "BeforeModel",
  BeforeToolSelection = "BeforeToolSelection",
  AfterModel = "AfterModel",
  Stop = "Stop",
  Notification = "Notification",
  SessionEnd = "SessionEnd",

  // Claude Code only
  PostToolUseFailure = "PostToolUseFailure",
  PermissionRequest = "PermissionRequest",
  PermissionDenied = "PermissionDenied",
  SubagentStart = "SubagentStart",
  SubagentStop = "SubagentStop",
  InstructionsLoaded = "InstructionsLoaded",
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
  readonly rielflow?: RielflowHookContext;
}
```

### Rielflow Hook Context

```typescript
interface RielflowHookContext {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly agentSessionId: string;
  readonly managerSessionId?: string;
  readonly agentBackend?: string;
}
```

`workflowExecutionId` comes from `RIEL_WORKFLOW_EXECUTION_ID`; `agentSessionId` comes from the hook payload `session_id`. The context is absent when the hook is invoked outside a rielflow-launched agent process or when recording has been disabled.

## Dispatch Architecture

### Handler Interface

```typescript
interface HookHandler {
  handle(ctx: ParsedHookContext): Promise<HookResponse>;
}
```

### Dispatch Table

The dispatcher maps `(vendor, eventName)` pairs to handler implementations. A recording wrapper runs for every parsed hook before returning the final response. Policy handlers may still be noop, but recording is part of the default pipeline whenever `ctx.rielflow` is present.

```typescript
// Conceptual structure -- not literal code
type HandlerKey = `${HookVendor}:${HookEventName}`;
type HandlerRegistry = ReadonlyMap<HandlerKey, HookHandler>;
```

For unrecognized or not-yet-modeled events, the dispatcher falls back to `NoopHookHandler` without writing stderr noise, but the raw event name is still persisted. The hook command should stay quiet unless it blocks execution or encounters a real parse/runtime error.

### Default Handler

```typescript
class RecordingHookHandler implements HookHandler {
  constructor(
    private readonly policy: HookHandler,
    private readonly recorder: HookEventRecorder,
  ) {}

  async handle(ctx: ParsedHookContext): Promise<HookResponse> {
    try {
      const response = await this.policy.handle(ctx);
      await this.recorder.record(ctx, response);
      return response;
    } catch (error) {
      await this.recorder.recordFailure(ctx, error);
      throw error;
    }
  }
}
```

The default policy handler may return `{}`. The recorder must still write a hook event record when rielflow context is available.

## Hook Event Recording

### Event Record

Each persisted hook event is append-only. Updates are limited to completing the same event with a handler response or error.

```typescript
interface HookEventRecord {
  readonly hookEventId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly managerSessionId?: string;
  readonly vendor: HookVendor;
  readonly agentSessionId: string;
  readonly rawEventName: string;
  readonly eventName: HookEventName;
  readonly cwd: string;
  readonly transcriptPath?: string | null;
  readonly model?: string;
  readonly turnId?: string;
  readonly payloadHash: string;
  readonly payloadRef?: EventArtifactRef;
  readonly responseJson?: HookResponse;
  readonly status: "recorded" | "blocked" | "handler_failed" | "recording_failed";
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

`hookEventId` is generated by rielflow, for example `hook-<timestamp>-<short-uuid>`. The `payloadHash` is computed over the original parsed JSON payload before redaction so that repeated hook calls can be compared without storing full sensitive content.

### Storage

Hook events are stored in the runtime database, separate from external event listener receipts:

```sql
CREATE TABLE hook_events (
  hook_event_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workflow_execution_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_exec_id TEXT NOT NULL,
  manager_session_id TEXT,
  vendor TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  raw_event_name TEXT NOT NULL,
  event_name TEXT NOT NULL,
  cwd TEXT NOT NULL,
  transcript_path TEXT,
  model TEXT,
  turn_id TEXT,
  payload_hash TEXT NOT NULL,
  payload_ref_json TEXT,
  response_json TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Required indexes:

- `(workflow_execution_id, created_at)` for workflow run history.
- `(workflow_execution_id, agent_session_id, created_at)` for backend session timelines.
- `(manager_session_id, created_at)` for manager control-plane correlation.
- `(node_exec_id, created_at)` for node detail views.

Session export, GraphQL workflow execution detail, and TUI node-detail views should read hook events through the runtime store instead of scraping payload artifacts. Payload artifacts are supporting evidence, not the query index.

Payload artifacts live under the root data directory:

```
hooks/<workflowExecutionId>/<nodeExecId>/<agentSessionId>/<hookEventId>/payload.json
```

The artifact path is stored as `payloadRef`. The raw payload artifact is redacted by default. Redaction removes or masks keys commonly containing secrets, command outputs, tokens, API keys, authorization headers, and provider-specific sensitive fields. Full payload capture requires `RIEL_HOOK_CAPTURE_RAW=full`.

### Association Semantics

The recorder must treat identifiers as distinct:

- `workflowExecutionId`: rielflow workflow run/session id from `RIEL_WORKFLOW_EXECUTION_ID`.
- `managerSessionId`: rielflow manager control-plane id from `RIEL_MANAGER_SESSION_ID`.
- `agentSessionId`: backend agent session id from hook payload `session_id`.
- `nodeExecId`: rielflow node execution that launched the backend process.

The same `agentSessionId` may appear in multiple events and may be reused across node executions when backend session reuse is enabled. The timeline query should therefore filter by both `workflowExecutionId` and `agentSessionId`, and use `nodeExecId` to disambiguate node-level ownership.

### Missing Context

If `RIEL_HOOK_RECORDING=auto` and the required rielflow variables are missing, the hook command:

- does not write a hook event record
- still runs the policy handler with `ctx.rielflow` omitted
- returns the normal response

If `RIEL_HOOK_RECORDING=required`, missing required context is an error because the hook was expected to run inside a rielflow-managed process.

## Processing Pipeline

1. **Read stdin** -- buffer all of stdin to a string.
2. **Parse JSON** -- `JSON.parse` the string. On failure, exit 1 with stderr message.
3. **Validate transport fields** -- confirm the shared `session_id`, `hook_event_name`, and `cwd` fields have the expected shape. Validate vendor-specific detection hints only when they are present (`transcript_path` as `string | null`, `model` as `string`). On failure, exit 1.
4. **Detect vendor** -- use `--vendor` flag or heuristic probe on the parsed object.
5. **Resolve event name** -- map the `hook_event_name` string to `HookEventName` when it is currently modeled. Unknown values map to a fallback path, but the raw event string is preserved.
6. **Resolve rielflow context** -- read the ambient variables listed above. When recording is `auto`, omit rielflow context if required values are missing. When recording is `required`, fail on missing required values.
7. **Build `ParsedHookContext`** -- assemble vendor, normalized event, raw event name, validated payload, and optional rielflow context.
8. **Dispatch** -- look up handler from registry, call `handle(ctx)`.
9. **Record event** -- if `ctx.rielflow` is present, persist the hook event with the handler response. If the handler throws, best-effort record a `handler_failed` event before returning the protocol error. If a handler blocks, persist `blocked`.
10. **Respond** -- serialize the returned `HookResponse` to stdout as JSON. If the response contains `decision: "block"`, exit with code 0 (the JSON itself carries the block semantic). Handlers that want the exit-2 protocol may throw a `HookBlockError` that the pipeline catches, records, writes `reason` to stderr, and exits 2.

## Vendor Heuristic Detection

When `--vendor` is not provided:

```
if payload has "turn_id" field
  -> likely codex
if hook_event_name is gemini-only event (BeforeTool, AfterTool, BeforeAgent, etc.)
  -> gemini
if hook_event_name is shared with gemini and payload has "timestamp" field
  -> likely gemini
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
    context.ts         # Rielflow env context resolution and recording controls
    detect-vendor.ts   # Vendor detection logic
    parse.ts           # stdin reading, JSON parsing, payload validation
    dispatch.ts        # Handler registry and dispatch table
    handler.ts         # HookHandler interface + NoopHookHandler
    recorder.ts        # Hook event persistence and artifact writing
    redaction.ts       # Hook payload redaction policy
    index.ts           # Pipeline orchestrator (read -> parse -> detect -> dispatch -> respond)
```

The CLI entry in `src/cli.ts` adds a `scope === "hook"` branch that calls the pipeline orchestrator.

## Agent Backend Hook Configuration

The recommended configuration is to install `rielflow hook` in Claude Code, Codex, and Gemini for lifecycle events that define session start, user input or agent turn boundaries, tool execution, and termination. The same command can be configured globally because recording activates only when rielflow ambient context exists.

Users can generate a paste-ready configuration block instead of copying the examples manually:

```bash
rielflow hook snippet --vendor claude-code
rielflow hook snippet --vendor codex
rielflow hook snippet --vendor gemini
```

The snippet command prints JSON only. It intentionally does not edit user-level or project-level hook configuration files because those files may contain existing user policies, local paths, or secrets. The generated snippets use the vendor-detecting machine-facing endpoint:

```bash
rielflow hook
```

Users may still add `--vendor claude-code` or `--vendor codex` manually when they want an explicit override.

### Claude Code (`settings.json` or `.claude/settings.json`)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
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
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ]
  }
}
```

### Gemini (`settings.json` or `.gemini/settings.json`)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "BeforeAgent": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "BeforeTool": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "AfterTool": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "AfterAgent": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "exit",
        "hooks": [
          { "type": "command", "command": "rielflow hook" }
        ]
      }
    ]
  }
}
```

## Policy Extension Points

Recording is baseline behavior. Additional policy behavior can be added by replacing noop policy entries in the registry:

- **PreToolUse** -- intercept dangerous commands or gate permissions.
- **PostToolUse** -- derive artifact references or inter-node communication from tool outputs.
- **SessionStart** -- inject additional workflow context when the backend protocol supports it.
- **Stop** -- mark backend session checkpoints or trigger workflow-level follow-up.
- **UserPromptSubmit** -- augment prompts with workflow state when the backend protocol supports it.

Each handler can be developed independently and registered into the dispatch table without changing the pipeline.

## References

- Claude Code hooks: https://code.claude.com/docs/en/hooks.md
- Codex CLI hooks: source `codex-rs/hooks/src/schema.rs` and `codex-rs/hooks/src/engine/`
- Gemini CLI hooks reference: https://geminicli.com/docs/hooks/reference/
- Gemini CLI hook-writing guide: https://geminicli.com/docs/hooks/writing-hooks/
- See `design-docs/references/README.md` for external references
