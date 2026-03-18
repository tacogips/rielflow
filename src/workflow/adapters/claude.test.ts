import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import { ClaudeCodeAgentAdapter } from "./claude";

const originalFetch = globalThis.fetch;

const baseInput: AdapterExecutionInput = {
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
  arguments: { key: "value" },
  executionIndex: 1,
  artifactDir: "/tmp/node-1/exec-1",
  upstreamCommunicationIds: ["comm-1"],
  executionMailbox: {
    meta: {
      protocolVersion: 1,
      mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR",
      node: {
        workflowId: "wf",
        workflowDescription: "demo workflow",
        nodeId: "node-1",
        nodeKind: "task",
      },
      objective: {
        reason: "Do the work.",
        expectedReturn: "Return JSON.",
        instruction: "test",
      },
      paths: {
        inputPath: "inbox/input.json",
        inputFilesDir: "inbox/files",
        outputPath: "outbox/output.json",
        outputFilesDir: "outbox/files",
      },
      input: {
        kind: "json",
        upstreamSources: [],
      },
      output: {
        kind: "json",
        required: true,
        path: "outbox/output.json",
        filesDirectory: "outbox/files",
      },
    },
    input: {
      arguments: { key: "value" },
      upstream: [],
    },
  },
};

const baseContext: AdapterExecutionContext = {
  timeoutMs: 1000,
  signal: new AbortController().signal,
};

afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

describe("ClaudeCodeAgentAdapter", () => {
  test("normalizes successful provider response", async () => {
    const fetchMock = vi
      .fn(async () => {
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
      })
      .mockName("fetch-claude-ok");
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const adapter = new ClaudeCodeAgentAdapter({
      endpoint: "http://localhost/claude",
    });
    const output = await adapter.execute(baseInput, baseContext);
    expect(output.provider).toBe("claude-provider");
    expect(output.model).toBe("claude-opus-4-1");
    const calls = (fetchMock as { mock: { calls: unknown[][] } }).mock.calls;
    const request = calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(request?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    expect(body["model"]).toBe("claude-opus-4-1");
    expect(body["workflowExecutionId"]).toBe("sess-1");
    expect(body["nodeExecId"]).toBe("exec-1");
    expect(body["executionMailbox"]).toMatchObject({
      meta: {
        mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR",
        paths: {
          inputPath: "inbox/input.json",
          outputPath: "outbox/output.json",
        },
      },
    });
  });

  test("passes backend session hints through the provider contract", async () => {
    const fetchMock = vi
      .fn(async () => {
        return new Response(
          JSON.stringify({
            provider: "claude-provider",
            promptText: "hello",
            completionPassed: true,
            when: { always: true },
            payload: { ok: true },
            backendSession: { sessionId: "backend-claude-1" },
          }),
          { status: 200 },
        );
      })
      .mockName("fetch-claude-backend-session");
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const adapter = new ClaudeCodeAgentAdapter({
      endpoint: "http://localhost/claude",
    });
    const output = await adapter.execute(
      {
        ...baseInput,
        backendSession: {
          mode: "reuse",
          sessionId: "backend-claude-1",
        },
      },
      baseContext,
    );

    const calls = (fetchMock as { mock: { calls: unknown[][] } }).mock.calls;
    const request = calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(request?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    expect(body["backendSession"]).toEqual({
      mode: "reuse",
      sessionId: "backend-claude-1",
    });
    expect(output.backendSession?.sessionId).toBe("backend-claude-1");
  });

  test("forwards ambient manager context when provided", async () => {
    const fetchMock = vi
      .fn(async () => {
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
      })
      .mockName("fetch-claude-manager-context");
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const adapter = new ClaudeCodeAgentAdapter({
      endpoint: "http://localhost/claude",
    });
    await adapter.execute(
      {
        ...baseInput,
        ambientManagerContext: {
          environment: {
            DIVEDRA_GRAPHQL_ENDPOINT: "http://127.0.0.1:43173/graphql",
            DIVEDRA_MANAGER_AUTH_TOKEN: "secret",
            DIVEDRA_MANAGER_SESSION_ID: "mgrsess-exec-000001",
            DIVEDRA_WORKFLOW_ID: "wf",
            DIVEDRA_WORKFLOW_EXECUTION_ID: "sess-1",
            DIVEDRA_MANAGER_NODE_ID: "node-1",
            DIVEDRA_MANAGER_NODE_EXEC_ID: "exec-1",
          },
        },
      },
      baseContext,
    );

    const calls = (fetchMock as { mock: { calls: unknown[][] } }).mock.calls;
    const request = calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(request?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    expect(body["ambientManagerContext"]).toEqual({
      environment: {
        DIVEDRA_GRAPHQL_ENDPOINT: "http://127.0.0.1:43173/graphql",
        DIVEDRA_MANAGER_AUTH_TOKEN: "secret",
        DIVEDRA_MANAGER_SESSION_ID: "mgrsess-exec-000001",
        DIVEDRA_WORKFLOW_ID: "wf",
        DIVEDRA_WORKFLOW_EXECUTION_ID: "sess-1",
        DIVEDRA_MANAGER_NODE_ID: "node-1",
        DIVEDRA_MANAGER_NODE_EXEC_ID: "exec-1",
      },
    });
  });

  test("maps invalid response body to invalid_output", async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi
      .fn(async () => {
        return new Response(JSON.stringify({ provider: "claude-provider" }), {
          status: 200,
        });
      })
      .mockName("fetch-claude-invalid") as unknown as typeof fetch;

    const adapter = new ClaudeCodeAgentAdapter({
      endpoint: "http://localhost/claude",
    });
    await expect(
      adapter.execute(baseInput, baseContext),
    ).rejects.toHaveProperty("code", "invalid_output");
  });

  test("omits artifactDir from contract-enabled requests", async () => {
    const fetchMock = vi
      .fn(async () => {
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
      })
      .mockName("fetch-claude-contract");
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const adapter = new ClaudeCodeAgentAdapter({
      endpoint: "http://localhost/claude",
    });
    await adapter.execute(
      {
        ...baseInput,
        output: {
          maxValidationAttempts: 2,
          attempt: 1,
          candidatePath: "/tmp/candidate.json",
          validationErrors: [],
          publication: {
            owner: "runtime",
            finalArtifactWrite: "runtime-only",
            mailboxWrite: "runtime-only-after-validation",
            candidateSubmission: "inline-json-or-reserved-candidate-file",
            futureCommunicationIdsExposed: false,
          },
        },
      },
      baseContext,
    );

    const calls = (fetchMock as { mock: { calls: unknown[][] } }).mock.calls;
    const request = calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(request?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    expect(body["artifactDir"]).toBeUndefined();
    expect(body["output"]).toBeDefined();
  });

  test("retries transient provider failures with bounded attempts", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async () => new Response("temporary failure", { status: 500 }),
      )
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              provider: "claude-provider",
              promptText: "hello",
              completionPassed: true,
              when: { always: true },
              payload: { ok: true },
            }),
            { status: 200 },
          ),
      );
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const adapter = new ClaudeCodeAgentAdapter({
      endpoint: "http://localhost/claude",
      maxAttempts: 2,
      retryDelayMs: 0,
    });
    const result = await adapter.execute(baseInput, baseContext);
    expect(result.provider).toBe("claude-provider");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
