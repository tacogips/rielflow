export enum HookVendor {
  ClaudeCode = "claude-code",
  Codex = "codex",
  Gemini = "gemini",
}

export const SUPPORTED_HOOK_VENDORS = [
  HookVendor.ClaudeCode,
  HookVendor.Codex,
  HookVendor.Gemini,
] as const;

export enum HookEventName {
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
  PreCompress = "PreCompress",
  PreCompact = "PreCompact",
  PostCompact = "PostCompact",
  SessionEnd = "SessionEnd",
  TeammateIdle = "TeammateIdle",
  Unknown = "Unknown",
}

export const KNOWN_HOOK_EVENT_NAMES = Object.values(HookEventName).filter(
  (eventName): eventName is Exclude<HookEventName, HookEventName.Unknown> =>
    eventName !== HookEventName.Unknown,
);

export interface HookInputPayload extends Readonly<Record<string, unknown>> {
  readonly session_id: string;
  readonly cwd: string;
  readonly hook_event_name: string;
  readonly transcript_path?: string | null;
  readonly model?: string;
  readonly turn_id?: string;
  readonly source?: string;
}

export interface HookSpecificOutput extends Readonly<Record<string, unknown>> {
  readonly hookEventName: string;
}

export interface HookResponse {
  readonly continue?: boolean;
  readonly stopReason?: string;
  readonly suppressOutput?: boolean;
  readonly systemMessage?: string;
  readonly decision?: "block";
  readonly reason?: string;
  readonly hookSpecificOutput?: HookSpecificOutput;
}

export interface ParsedHookContext {
  readonly vendor: HookVendor;
  readonly eventName: HookEventName;
  readonly rawEventName: string;
  readonly payload: HookInputPayload;
  readonly divedra?: DivedraHookContext;
}

export interface DivedraHookContext {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly agentSessionId: string;
  readonly managerSessionId?: string;
  readonly agentBackend?: string;
}

export type HookRecordingMode = "auto" | "off" | "required";
export type HookPayloadCaptureMode = "redacted" | "metadata-only" | "full";
