import { describe, expect, test } from "vitest";
import {
  CLI_AGENT_BACKENDS,
  NODE_EXECUTION_BACKEND,
  NODE_EXECUTION_BACKENDS,
  NODE_EXECUTION_BACKEND_LIST_TEXT,
  isCliAgentBackend,
  normalizeCliAgentBackend,
  normalizeNodeExecutionBackend,
} from "./backend";

describe("workflow backend constants and normalizers", () => {
  test("normalizes every canonical node execution backend", () => {
    expect(NODE_EXECUTION_BACKEND_LIST_TEXT).toBe(
      "codex-agent, claude-code-agent, cursor-cli-agent, official/openai-sdk, official/anthropic-sdk, or official/cursor-sdk",
    );

    for (const backend of NODE_EXECUTION_BACKENDS) {
      expect(normalizeNodeExecutionBackend(backend)).toBe(backend);
    }
  });

  test("limits CLI backend normalization to CLI-backed agents", () => {
    const cliBackendSet: ReadonlySet<unknown> = new Set(CLI_AGENT_BACKENDS);
    const nonCliBackends = NODE_EXECUTION_BACKENDS.filter(
      (backend) => !cliBackendSet.has(backend),
    );

    for (const backend of CLI_AGENT_BACKENDS) {
      expect(normalizeCliAgentBackend(backend)).toBe(backend);
      expect(isCliAgentBackend(backend)).toBe(true);
    }

    expect(nonCliBackends).toEqual([
      NODE_EXECUTION_BACKEND.OFFICIAL_OPENAI_SDK,
      NODE_EXECUTION_BACKEND.OFFICIAL_ANTHROPIC_SDK,
      NODE_EXECUTION_BACKEND.OFFICIAL_CURSOR_SDK,
    ]);
    for (const backend of nonCliBackends) {
      expect(normalizeCliAgentBackend(backend)).toBeNull();
      expect(isCliAgentBackend(backend)).toBe(false);
    }
  });

  test("rejects non-canonical backend values", () => {
    for (const value of ["", "openai", "codex", null, 42, {}]) {
      expect(normalizeNodeExecutionBackend(value)).toBeNull();
    }
  });
});
