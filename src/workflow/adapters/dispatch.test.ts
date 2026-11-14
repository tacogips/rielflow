import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import {
  DispatchingNodeAdapter,
  resolveNodeExecutionBackend,
} from "./dispatch";

const baseContext: AdapterExecutionContext = {
  timeoutMs: 1000,
  signal: new AbortController().signal,
};

afterEach(() => {
  vi.restoreAllMocks();
});

function makeCodexRunner() {
  return {
    createRunner: vi.fn(() => ({
      startSession: vi.fn(async () => ({
        sessionId: "codex-session-1",
        async *messages(): AsyncGenerator<unknown, void, undefined> {
          yield {
            type: "session_meta",
            payload: {
              meta: { id: "codex-session-1" },
            },
          };
          yield {
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: '{"ok":true}' }],
            },
          };
        },
        waitForCompletion: vi.fn(async () => ({
          success: true,
          exitCode: 0,
          stats: {
            startedAt: "2026-03-30T00:00:00.000Z",
            completedAt: "2026-03-30T00:00:01.000Z",
            messageCount: 2,
          },
        })),
        cancel: vi.fn(async () => {
          return;
        }),
      })),
      resumeSession: vi.fn(async () => {
        throw new Error("resumeSession should not be used in this test");
      }),
    })),
  };
}

function makeCursorRunnerSession() {
  return {
    sessionId: "cursor-session-1",
    messages: async function* (): AsyncGenerator<unknown, void, undefined> {
      yield {
        type: "session.started",
        sessionId: "cursor-session-1",
        cwd: "/tmp/project",
      };
      yield {
        type: "session.assistant_message",
        sessionId: "cursor-session-1",
        message: {
          role: "assistant",
          rawText: '{"ok":true}',
          displayText: '{"ok":true}',
        },
      };
    },
    waitForCompletion: vi.fn(async () => ({
      sessionId: "cursor-session-1",
      exitCode: 0,
      signal: null as null,
      stdout: "",
      stderr: "",
      events: [] as readonly unknown[],
    })),
    cancel: vi.fn(async () => {
      return;
    }),
    interrupt: vi.fn(async () => {
      return;
    }),
  };
}

function makeCursorRunner() {
  const session = makeCursorRunnerSession();
  return {
    createRunner: vi.fn(() => ({
      start: vi.fn(() => session),
      resume: vi.fn(() => {
        throw new Error("resume should not be called in this test");
      }),
    })),
  };
}

function makeClaudeRunner() {
  return {
    createRunner: vi.fn(() => ({
      startSession: vi.fn(async () => ({
        sessionId: "claude-session-1",
        async *messages(): AsyncGenerator<object, void, undefined> {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: '{"ok":true}' }],
            },
          };
        },
        waitForCompletion: vi.fn(async () => ({
          success: true,
          stats: {
            startedAt: "2026-03-30T00:00:00.000Z",
            completedAt: "2026-03-30T00:00:01.000Z",
            toolCallCount: 0,
            messageCount: 1,
          },
        })),
        cancel: vi.fn(async () => {
          return;
        }),
        on: vi.fn(),
        removeListener: vi.fn(),
      })),
      resumeSession: vi.fn(async () => {
        throw new Error("resumeSession should not be used in this test");
      }),
    })),
  };
}

describe("resolveNodeExecutionBackend", () => {
  test("requires explicit executionBackend", () => {
    expect(() =>
      resolveNodeExecutionBackend({
        id: "node-1",
        model: "gpt-5-nano",
        promptTemplate: "test",
        variables: {},
      }),
    ).toThrow("requires explicit executionBackend");
  });
});

describe("DispatchingNodeAdapter", () => {
  test("routes to official openai sdk backend when explicitly selected", async () => {
    const adapter = new DispatchingNodeAdapter({
      openAiSdk: {
        clientFactory: () => ({
          responses: {
            async create() {
              return { output_text: "hello from openai" };
            },
          },
        }),
      },
    });
    process.env["OPENAI_API_KEY"] = "test-key";

    const input: AdapterExecutionInput = {
      workflowId: "wf",
      workflowExecutionId: "sess-1",
      nodeId: "node-1",
      nodeExecId: "exec-1",
      node: {
        id: "node-1",
        model: "gpt-5-nano",
        executionBackend: "official/openai-sdk",
        promptTemplate: "test",
        variables: {},
      },
      workingDirectory: "/tmp/project",
      mergedVariables: {},
      promptText: "hello",
      arguments: null,
      executionIndex: 1,
      artifactDir: "/tmp/node-1/exec-1",
      upstreamCommunicationIds: [],
    };

    const output = await adapter.execute(input, baseContext);
    expect(output.provider).toBe("official-openai-sdk");
    expect(output.payload["text"]).toBe("hello from openai");
  });

  test("routes to codex-agent backend when explicitly selected", async () => {
    const fixture = makeCodexRunner();
    const adapter = new DispatchingNodeAdapter({
      codexAgent: { createRunner: fixture.createRunner },
    });
    const input: AdapterExecutionInput = {
      workflowId: "wf",
      workflowExecutionId: "sess-1",
      nodeId: "node-1",
      nodeExecId: "exec-1",
      node: {
        id: "node-1",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "test",
        variables: {},
      },
      workingDirectory: "/tmp/project",
      mergedVariables: {},
      promptText: "hello",
      arguments: null,
      executionIndex: 1,
      artifactDir: "/tmp/node-1/exec-1",
      upstreamCommunicationIds: [],
    };

    const output = await adapter.execute(input, baseContext);
    expect(output.provider).toBe("codex-agent");
    expect(output.payload).toEqual({ text: '{"ok":true}' });
    expect(fixture.createRunner).toHaveBeenCalledTimes(1);
  });

  test("routes to cursor-cli-agent backend when explicitly selected", async () => {
    const fixture = makeCursorRunner();
    const adapter = new DispatchingNodeAdapter({
      cursorCliAgent: { createRunner: fixture.createRunner },
    });
    const input: AdapterExecutionInput = {
      workflowId: "wf",
      workflowExecutionId: "sess-1",
      nodeId: "node-1",
      nodeExecId: "exec-1",
      node: {
        id: "node-1",
        executionBackend: "cursor-cli-agent",
        model: "claude-sonnet-4-5",
        promptTemplate: "test",
        variables: {},
      },
      workingDirectory: "/tmp/project",
      mergedVariables: {},
      promptText: "hello",
      arguments: null,
      executionIndex: 1,
      artifactDir: "/tmp/node-1/exec-1",
      upstreamCommunicationIds: [],
    };

    const output = await adapter.execute(input, baseContext);
    expect(output.provider).toBe("cursor-cli-agent");
    expect(output.model).toBe("claude-sonnet-4-5");
    expect(output.payload).toEqual({ text: '{"ok":true}' });
    expect(fixture.createRunner).toHaveBeenCalledTimes(1);
  });

  test("routes to canonical claude-code-agent backend and preserves provider model", async () => {
    const fixture = makeClaudeRunner();
    const adapter = new DispatchingNodeAdapter({
      claudeCodeAgent: { createRunner: fixture.createRunner },
    });
    const input: AdapterExecutionInput = {
      workflowId: "wf",
      workflowExecutionId: "sess-1",
      nodeId: "node-1",
      nodeExecId: "exec-1",
      node: {
        id: "node-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "test",
        variables: {},
      },
      workingDirectory: "/tmp/project",
      mergedVariables: {},
      promptText: "hello",
      arguments: null,
      executionIndex: 1,
      artifactDir: "/tmp/node-1/exec-1",
      upstreamCommunicationIds: [],
    };

    const output = await adapter.execute(input, baseContext);
    expect(output.provider).toBe("claude-code-agent");
    expect(output.model).toBe("claude-opus-4-1");
    expect(output.payload).toEqual({ text: '{"ok":true}' });
    expect(fixture.createRunner).toHaveBeenCalledTimes(1);
  });
});
