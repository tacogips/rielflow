import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import { CodexAgentAdapter } from "./codex";

const originalFetch = globalThis.fetch;

const baseInput: AdapterExecutionInput = {
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
  delete process.env["TEST_CODEX_KEY"];
});

describe("CodexAgentAdapter", () => {
  test("calls provider endpoint and normalizes output", async () => {
    process.env["TEST_CODEX_KEY"] = "secret";
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          provider: "codex-provider",
          model: "gpt-5-nano",
          promptText: "hello",
          completionPassed: true,
          when: { always: true },
          payload: { ok: true },
        }),
        { status: 200 },
      );
    });
    // explicit reassignment keeps compatibility with this vitest version
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const adapter = new CodexAgentAdapter({
      endpoint: "http://localhost/codex",
      apiKeyEnv: "TEST_CODEX_KEY",
    });

    const output = await adapter.execute(baseInput, baseContext);
    expect(output.provider).toBe("codex-provider");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = (fetchMock as { mock: { calls: unknown[][] } }).mock.calls;
    const request = calls[0]?.[1] as RequestInit | undefined;
    const headers = (request?.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret");
    const body = JSON.parse(String(request?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    expect(body["model"]).toBe("gpt-5-nano");
    expect(body["workflowExecutionId"]).toBe("sess-1");
    expect(body["nodeExecId"]).toBe("exec-1");
    expect(body["artifactDir"]).toBe("/tmp/node-1/exec-1");
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
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          provider: "codex-provider",
          model: "gpt-5-nano",
          promptText: "hello",
          completionPassed: true,
          when: { always: true },
          payload: { ok: true },
          backendSession: { sessionId: "backend-codex-1" },
        }),
        { status: 200 },
      );
    });
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const adapter = new CodexAgentAdapter({
      endpoint: "http://localhost/codex",
    });
    const output = await adapter.execute(
      {
        ...baseInput,
        backendSession: {
          mode: "reuse",
          sessionId: "backend-codex-1",
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
      sessionId: "backend-codex-1",
    });
    expect(output.backendSession?.sessionId).toBe("backend-codex-1");
  });

  test("forwards ambient manager context when provided", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          provider: "codex-provider",
          model: "gpt-5-nano",
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

    const adapter = new CodexAgentAdapter({
      endpoint: "http://localhost/codex",
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

  test("maps blocked responses to policy_blocked", async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi
      .fn(async () => {
        return new Response("blocked", { status: 403 });
      })
      .mockName("fetch-blocked") as unknown as typeof fetch;

    const adapter = new CodexAgentAdapter({
      endpoint: "http://localhost/codex",
    });
    await expect(
      adapter.execute(baseInput, baseContext),
    ).rejects.toHaveProperty("code", "policy_blocked");
  });

  test("omits artifactDir from contract-enabled requests", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          provider: "codex-provider",
          model: "gpt-5-nano",
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

    const adapter = new CodexAgentAdapter({
      endpoint: "http://localhost/codex",
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
              provider: "codex-provider",
              model: "gpt-5-nano",
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

    const adapter = new CodexAgentAdapter({
      endpoint: "http://localhost/codex",
      maxAttempts: 2,
      retryDelayMs: 0,
    });
    const result = await adapter.execute(baseInput, baseContext);
    expect(result.provider).toBe("codex-provider");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
