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

function makeCodexRunnerFixture(input: {
  readonly sessionId?: string;
  readonly messages?: readonly unknown[];
  readonly success?: boolean;
  readonly exitCode?: number;
} = {}): {
  readonly createRunner: ReturnType<typeof vi.fn>;
  readonly startSession: ReturnType<typeof vi.fn>;
  readonly resumeSession: ReturnType<typeof vi.fn>;
  readonly cancel: ReturnType<typeof vi.fn>;
} {
  const sessionId = input.sessionId ?? "codex-session-1";
  const chunks =
    input.messages ??
    [
      {
        type: "session_meta",
        payload: {
          meta: { id: sessionId },
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "local codex reply" }],
        },
      },
    ];
  const cancel = vi.fn(async () => {
    return;
  });
  const session = {
    sessionId,
    async *messages(): AsyncGenerator<unknown, void, undefined> {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
    waitForCompletion: vi.fn(async () => ({
      success: input.success ?? true,
      exitCode: input.exitCode ?? 0,
      stats: {
        startedAt: "2026-03-30T00:00:00.000Z",
        completedAt: "2026-03-30T00:00:01.000Z",
        messageCount: chunks.length,
      },
    })),
    cancel,
  };

  const startSession = vi.fn(async () => session);
  const resumeSession = vi.fn(async () => session);
  const createRunner = vi.fn(() => ({
    startSession,
    resumeSession,
  }));

  return {
    createRunner,
    startSession,
    resumeSession,
    cancel,
  };
}

describe("CodexAgentAdapter", () => {
  test("runs locally by default and normalizes plain-text output", async () => {
    const fixture = makeCodexRunnerFixture();
    const adapter = new CodexAgentAdapter({
      createRunner: fixture.createRunner,
    });

    const output = await adapter.execute(
      {
        ...baseInput,
        systemPromptText: "system",
      },
      baseContext,
    );

    expect(output.provider).toBe("codex-agent");
    expect(output.model).toBe("gpt-5-nano");
    expect(output.promptText).toBe("system\n\nhello");
    expect(output.payload).toEqual({ text: "local codex reply" });
    expect(output.backendSession?.sessionId).toBe("codex-session-1");
    expect(fixture.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "system\n\nhello",
        model: "gpt-5-nano",
        streamGranularity: "event",
      }),
    );
  });

  test("reuses backend sessions for local execution", async () => {
    const fixture = makeCodexRunnerFixture({
      sessionId: "backend-codex-1",
      messages: [
        {
          type: "session_meta",
          payload: {
            meta: { id: "backend-codex-1" },
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "{\"summary\":\"ok\"}" }],
          },
        },
      ],
    });
    const adapter = new CodexAgentAdapter({
      createRunner: fixture.createRunner,
    });

    const output = await adapter.execute(
      {
        ...baseInput,
        backendSession: {
          mode: "reuse",
          sessionId: "backend-codex-1",
        },
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

    expect(fixture.resumeSession).toHaveBeenCalledWith(
      "backend-codex-1",
      "hello",
      expect.objectContaining({
        model: "gpt-5-nano",
        streamGranularity: "event",
      }),
    );
    expect(output.payload).toEqual({ summary: "ok" });
    expect(output.backendSession?.sessionId).toBe("backend-codex-1");
  });

  test("injects ambient manager env during local session startup", async () => {
    let observedGraphqlEndpoint: string | undefined;
    const fixture = makeCodexRunnerFixture();
    fixture.createRunner.mockImplementation(() => ({
      startSession: vi.fn(async () => {
        observedGraphqlEndpoint = process.env["DIVEDRA_GRAPHQL_ENDPOINT"];
        return {
          sessionId: "codex-session-ambient",
          messages: async function* () {
            yield {
              type: "session_meta",
              payload: { meta: { id: "codex-session-ambient" } },
            };
            yield {
              type: "response_item",
              payload: {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "ambient ok" }],
              },
            };
          },
          waitForCompletion: async () => ({
            success: true,
            exitCode: 0,
            stats: {
              startedAt: "2026-03-30T00:00:00.000Z",
              completedAt: "2026-03-30T00:00:01.000Z",
              messageCount: 2,
            },
          }),
          cancel: async () => {
            return;
          },
        };
      }),
      resumeSession: vi.fn(),
    }));

    const adapter = new CodexAgentAdapter({
      createRunner: fixture.createRunner,
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

    expect(observedGraphqlEndpoint).toBe("http://127.0.0.1:43173/graphql");
    expect(process.env["DIVEDRA_GRAPHQL_ENDPOINT"]).toBeUndefined();
  });

  test("maps invalid structured output to invalid_output", async () => {
    const fixture = makeCodexRunnerFixture({
      messages: [
        {
          type: "session_meta",
          payload: {
            meta: { id: "codex-session-1" },
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "not json" }],
          },
        },
      ],
    });
    const adapter = new CodexAgentAdapter({
      createRunner: fixture.createRunner,
    });

    await expect(
      adapter.execute(
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
      ),
    ).rejects.toHaveProperty("code", "invalid_output");
  });

  test("supports the legacy endpoint fallback", async () => {
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
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const adapter = new CodexAgentAdapter({
      endpoint: "http://localhost/codex",
      apiKeyEnv: "TEST_CODEX_KEY",
    });

    const output = await adapter.execute(baseInput, baseContext);
    expect(output.provider).toBe("codex-provider");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
