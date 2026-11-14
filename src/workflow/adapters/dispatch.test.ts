import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import {
  DispatchingNodeAdapter,
  resolveNodeExecutionBackend,
} from "./dispatch";

const originalFetch = globalThis.fetch;

const baseContext: AdapterExecutionContext = {
  timeoutMs: 1000,
  signal: new AbortController().signal,
};

afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

describe("resolveNodeExecutionBackend", () => {
  test("derives canonical short backend from legacy model alias when executionBackend is omitted", () => {
    expect(
      resolveNodeExecutionBackend({
        id: "node-1",
        model: "tacogips/codex-agent",
        promptTemplate: "test",
        variables: {},
      }),
    ).toBe("codex-agent");
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

  test("routes to codex-agent backend from legacy model alias when executionBackend is omitted", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          provider: "codex-provider",
          promptText: "hello",
          completionPassed: true,
          when: { always: true },
          payload: { ok: true },
        }),
        { status: 200 },
      );
    });
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const adapter = new DispatchingNodeAdapter({
      codexAgent: { endpoint: "http://localhost/codex" },
    });
    const input: AdapterExecutionInput = {
      workflowId: "wf",
      workflowExecutionId: "sess-1",
      nodeId: "node-1",
      nodeExecId: "exec-1",
      node: {
        id: "node-1",
        model: "tacogips/codex-agent",
        promptTemplate: "test",
        variables: {},
      },
      mergedVariables: {},
      promptText: "hello",
      arguments: null,
      executionIndex: 1,
      artifactDir: "/tmp/node-1/exec-1",
      upstreamCommunicationIds: [],
    };

    const output = await adapter.execute(input, baseContext);
    expect(output.provider).toBe("codex-provider");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("routes to canonical claude-code-agent backend and preserves provider model", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          provider: "claude-provider",
          promptText: "hello",
          completionPassed: true,
          when: { always: true },
          payload: { ok: true },
        }),
        { status: 200 },
      );
    });
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const adapter = new DispatchingNodeAdapter({
      claudeCodeAgent: { endpoint: "http://localhost/claude" },
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
      mergedVariables: {},
      promptText: "hello",
      arguments: null,
      executionIndex: 1,
      artifactDir: "/tmp/node-1/exec-1",
      upstreamCommunicationIds: [],
    };

    const output = await adapter.execute(input, baseContext);
    expect(output.provider).toBe("claude-provider");
    expect(output.model).toBe("claude-opus-4-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = (fetchMock as { mock: { calls: unknown[][] } }).mock.calls;
    const request = calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(request?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    expect(body["model"]).toBe("claude-opus-4-1");
  });
});
