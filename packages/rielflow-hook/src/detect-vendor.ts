import {
  HookEventName,
  type HookInputPayload,
  HookVendor,
  SUPPORTED_HOOK_VENDORS,
} from "./types";

const CLAUDE_CODE_ONLY_EVENTS = new Set<HookEventName>([
  HookEventName.PostToolUseFailure,
  HookEventName.PermissionRequest,
  HookEventName.PermissionDenied,
  HookEventName.SubagentStart,
  HookEventName.SubagentStop,
  HookEventName.InstructionsLoaded,
  HookEventName.Notification,
  HookEventName.TaskCreated,
  HookEventName.TaskCompleted,
  HookEventName.ConfigChange,
  HookEventName.CwdChanged,
  HookEventName.FileChanged,
  HookEventName.StopFailure,
  HookEventName.Elicitation,
  HookEventName.ElicitationResult,
  HookEventName.WorktreeCreate,
  HookEventName.WorktreeRemove,
  HookEventName.PreCompact,
  HookEventName.PostCompact,
  HookEventName.SessionEnd,
  HookEventName.TeammateIdle,
]);

const GEMINI_ONLY_EVENTS = new Set<HookEventName>([
  HookEventName.BeforeTool,
  HookEventName.AfterTool,
  HookEventName.BeforeAgent,
  HookEventName.AfterAgent,
  HookEventName.BeforeModel,
  HookEventName.BeforeToolSelection,
  HookEventName.AfterModel,
  HookEventName.PreCompress,
]);

const GEMINI_SHARED_EVENTS = new Set<HookEventName>([
  HookEventName.SessionStart,
  HookEventName.SessionEnd,
  HookEventName.Notification,
]);

function hasStringField(payload: HookInputPayload, fieldName: string): boolean {
  return typeof payload[fieldName] === "string";
}

function hasNullableStringField(
  payload: HookInputPayload,
  fieldName: string,
): boolean {
  return (
    Object.hasOwn(payload, fieldName) &&
    (payload[fieldName] === null || typeof payload[fieldName] === "string")
  );
}

export function parseHookVendorOption(
  value: string | undefined,
): HookVendor | undefined {
  return SUPPORTED_HOOK_VENDORS.find((vendor) => vendor === value);
}

export function detectHookVendor(input: {
  readonly payload: HookInputPayload;
  readonly eventName: HookEventName;
  readonly explicitVendor?: HookVendor;
}): HookVendor {
  if (input.explicitVendor !== undefined) {
    return input.explicitVendor;
  }
  if (GEMINI_ONLY_EVENTS.has(input.eventName)) {
    return HookVendor.Gemini;
  }
  if (
    GEMINI_SHARED_EVENTS.has(input.eventName) &&
    hasStringField(input.payload, "timestamp")
  ) {
    return HookVendor.Gemini;
  }
  if (hasStringField(input.payload, "agent_id")) {
    return HookVendor.ClaudeCode;
  }
  if (CLAUDE_CODE_ONLY_EVENTS.has(input.eventName)) {
    return HookVendor.ClaudeCode;
  }
  if (hasStringField(input.payload, "turn_id")) {
    return HookVendor.Codex;
  }
  if (
    hasStringField(input.payload, "model") ||
    hasNullableStringField(input.payload, "transcript_path")
  ) {
    return HookVendor.Codex;
  }
  return HookVendor.ClaudeCode;
}
