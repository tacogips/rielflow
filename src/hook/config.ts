import { HookEventName, HookVendor } from "./types";

export interface HookConfigurationCommand {
  readonly type: "command";
  readonly command: string;
}

export interface HookConfigurationEntry {
  readonly matcher: string;
  readonly hooks: readonly HookConfigurationCommand[];
}

export interface HookConfigurationSnippet {
  readonly hooks: Readonly<Record<string, readonly HookConfigurationEntry[]>>;
}

export const RECOMMENDED_HOOK_CONFIGURATION_EVENTS = [
  HookEventName.SessionStart,
  HookEventName.UserPromptSubmit,
  HookEventName.PreToolUse,
  HookEventName.PostToolUse,
  HookEventName.Stop,
] as const;

const RECOMMENDED_GEMINI_HOOK_CONFIGURATION_EVENTS = [
  HookEventName.SessionStart,
  HookEventName.BeforeAgent,
  HookEventName.BeforeTool,
  HookEventName.AfterTool,
  HookEventName.AfterAgent,
  HookEventName.SessionEnd,
] as const;

export function buildHookRuntimeCommand(vendor?: HookVendor): string {
  if (vendor === undefined) {
    return "divedra hook";
  }
  return `divedra hook --vendor ${vendor}`;
}

function hookMatcherForVendor(vendor: HookVendor): string {
  switch (vendor) {
    case HookVendor.ClaudeCode:
      return "";
    case HookVendor.Codex:
      return "*";
    case HookVendor.Gemini:
      return "*";
  }
}

function hookMatcherForGeminiEvent(eventName: HookEventName): string {
  switch (eventName) {
    case HookEventName.SessionStart:
      return "startup";
    case HookEventName.SessionEnd:
      return "exit";
    default:
      return "*";
  }
}

function recommendedHookConfigurationEvents(
  vendor: HookVendor,
): readonly HookEventName[] {
  switch (vendor) {
    case HookVendor.ClaudeCode:
    case HookVendor.Codex:
      return RECOMMENDED_HOOK_CONFIGURATION_EVENTS;
    case HookVendor.Gemini:
      return RECOMMENDED_GEMINI_HOOK_CONFIGURATION_EVENTS;
  }
}

function hookMatcherForEvent(
  vendor: HookVendor,
  eventName: HookEventName,
): string {
  if (vendor === HookVendor.Gemini) {
    return hookMatcherForGeminiEvent(eventName);
  }
  return hookMatcherForVendor(vendor);
}

export function buildHookConfigurationSnippet(
  vendor: HookVendor,
): HookConfigurationSnippet {
  const command = buildHookRuntimeCommand();
  const hooks: Record<string, readonly HookConfigurationEntry[]> = {};

  for (const eventName of recommendedHookConfigurationEvents(vendor)) {
    hooks[eventName] = [
      {
        matcher: hookMatcherForEvent(vendor, eventName),
        hooks: [
          {
            type: "command",
            command,
          },
        ],
      },
    ];
  }

  return { hooks };
}
