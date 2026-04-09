export enum HookVendor {
  ClaudeCode = "claude-code",
  Codex = "codex",
}

export const SUPPORTED_HOOK_VENDORS = [
  HookVendor.ClaudeCode,
  HookVendor.Codex,
] as const;

export enum HookEventName {
  SessionStart = "SessionStart",
  PreToolUse = "PreToolUse",
  PostToolUse = "PostToolUse",
  UserPromptSubmit = "UserPromptSubmit",
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
}
