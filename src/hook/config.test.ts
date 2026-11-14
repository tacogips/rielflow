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
            command: "divedra hook",
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
            command: "divedra hook",
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
            command: "divedra hook",
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
            command: "divedra hook",
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
            command: "divedra hook",
          },
        ],
      },
    ]);
  });

  test("keeps the runtime hook command stable", () => {
    expect(buildHookRuntimeCommand()).toBe("divedra hook");
    expect(buildHookRuntimeCommand(HookVendor.ClaudeCode)).toBe(
      "divedra hook --vendor claude-code",
    );
    expect(buildHookRuntimeCommand(HookVendor.Codex)).toBe(
      "divedra hook --vendor codex",
    );
    expect(buildHookRuntimeCommand(HookVendor.Gemini)).toBe(
      "divedra hook --vendor gemini",
    );
    expect(RECOMMENDED_HOOK_CONFIGURATION_EVENTS).toHaveLength(5);
  });
});
