import { describe, expect, test } from "vitest";
import {
  buildHookConfigurationSnippet,
  buildHookRuntimeCommand,
  RECOMMENDED_HOOK_CONFIGURATION_EVENTS,
} from "./config";
import { HookEventName, HookVendor } from "./types";

describe("hook configuration snippets", () => {
  test("builds the Claude Code hook snippet", () => {
    const snippet = buildHookConfigurationSnippet(HookVendor.ClaudeCode);

    expect(Object.keys(snippet.hooks)).toEqual([
      HookEventName.SessionStart,
      HookEventName.UserPromptSubmit,
      HookEventName.PreToolUse,
      HookEventName.PostToolUse,
      HookEventName.Stop,
    ]);
    expect(snippet.hooks[HookEventName.PreToolUse]).toEqual([
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: "rielflow hook",
          },
        ],
      },
    ]);
  });

  test("builds the Codex hook snippet", () => {
    const snippet = buildHookConfigurationSnippet(HookVendor.Codex);

    expect(snippet.hooks[HookEventName.PostToolUse]).toEqual([
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: "rielflow hook",
          },
        ],
      },
    ]);
  });

  test("builds the Gemini hook snippet", () => {
    const snippet = buildHookConfigurationSnippet(HookVendor.Gemini);

    expect(Object.keys(snippet.hooks)).toEqual([
      HookEventName.SessionStart,
      HookEventName.BeforeAgent,
      HookEventName.BeforeTool,
      HookEventName.AfterTool,
      HookEventName.AfterAgent,
      HookEventName.SessionEnd,
    ]);
    expect(snippet.hooks[HookEventName.SessionStart]).toEqual([
      {
        matcher: "startup",
        hooks: [
          {
            type: "command",
            command: "rielflow hook",
          },
        ],
      },
    ]);
    expect(snippet.hooks[HookEventName.BeforeTool]).toEqual([
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: "rielflow hook",
          },
        ],
      },
    ]);
    expect(snippet.hooks[HookEventName.SessionEnd]).toEqual([
      {
        matcher: "exit",
        hooks: [
          {
            type: "command",
            command: "rielflow hook",
          },
        ],
      },
    ]);
  });

  test("keeps the runtime hook command stable", () => {
    expect(buildHookRuntimeCommand()).toBe("rielflow hook");
    expect(buildHookRuntimeCommand(HookVendor.ClaudeCode)).toBe(
      "rielflow hook --vendor claude-code",
    );
    expect(buildHookRuntimeCommand(HookVendor.Codex)).toBe(
      "rielflow hook --vendor codex",
    );
    expect(buildHookRuntimeCommand(HookVendor.Gemini)).toBe(
      "rielflow hook --vendor gemini",
    );
    expect(RECOMMENDED_HOOK_CONFIGURATION_EVENTS).toHaveLength(5);
  });
});
