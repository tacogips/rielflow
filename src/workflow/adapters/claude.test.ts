import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import { ClaudeCodeAgentAdapter } from "./claude";

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
  workingDirectory: "/tmp/project",
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
});

function makeClaudeRunnerFixture(
  input: {
    readonly sessionId?: string;
    readonly messages?: readonly object[];
    readonly success?: boolean;
  } = {},
): {
  readonly createRunner: ReturnType<typeof vi.fn>;
  readonly startSession: ReturnType<typeof vi.fn>;
  readonly resumeSession: ReturnType<typeof vi.fn>;
} {
  const sessionId = input.sessionId ?? "claude-session-1";
  const messages = input.messages ?? [
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "local claude reply" }],
      },
    },
  ];

  const session = {
    sessionId,
    async *messages(): AsyncGenerator<object, void, undefined> {
      for (const message of messages) {
        yield message;
      }
    },
    waitForCompletion: vi.fn(async () => ({
      success: input.success ?? true,
      stats: {
        startedAt: "2026-03-30T00:00:00.000Z",
        completedAt: "2026-03-30T00:00:01.000Z",
        toolCallCount: 0,
        messageCount: messages.length,
      },
    })),
    cancel: vi.fn(async () => {
      return;
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
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
  };
}

describe("ClaudeCodeAgentAdapter", () => {
  test("runs locally by default and keeps system prompt separate", async () => {
    const fixture = makeClaudeRunnerFixture();
    const adapter = new ClaudeCodeAgentAdapter({
      createRunner: fixture.createRunner,
    });

    const output = await adapter.execute(
      {
        ...baseInput,
        systemPromptText: "system",
      },
      baseContext,
    );

    expect(output.provider).toBe("claude-code-agent");
    expect(output.model).toBe("claude-opus-4-1");
    expect(output.promptText).toBe("system\n\nhello");
    expect(output.payload).toEqual({ text: "local claude reply" });
    expect(output.backendSession?.sessionId).toBe("claude-session-1");
    expect(fixture.createRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/project",
      }),
    );
    expect(fixture.startSession).toHaveBeenCalledWith({
      prompt: "hello",
      projectPath: "/tmp/project",
      systemPrompt: "system",
    });
  });

  test("reuses backend sessions for local execution", async () => {
    const fixture = makeClaudeRunnerFixture({
      sessionId: "backend-claude-1",
      messages: [
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: '{"summary":"ok"}' }],
          },
        },
      ],
    });
    const adapter = new ClaudeCodeAgentAdapter({
      createRunner: fixture.createRunner,
    });

    const output = await adapter.execute(
      {
        ...baseInput,
        backendSession: {
          mode: "reuse",
          sessionId: "backend-claude-1",
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
      "backend-claude-1",
      "hello",
      undefined,
    );
    expect(output.payload).toEqual({ summary: "ok" });
    expect(output.backendSession?.sessionId).toBe("backend-claude-1");
  });

  test("passes ambient manager env into the local runner", async () => {
    const fixture = makeClaudeRunnerFixture();
    const adapter = new ClaudeCodeAgentAdapter({
      createRunner: fixture.createRunner,
    });

    await adapter.execute(
      {
        ...baseInput,
        divedraHookContext: {
          environment: {
            DIVEDRA_WORKFLOW_ID: "wf",
            DIVEDRA_WORKFLOW_EXECUTION_ID: "sess-1",
            DIVEDRA_NODE_ID: "node-1",
            DIVEDRA_NODE_EXEC_ID: "exec-1",
            DIVEDRA_AGENT_BACKEND: "claude-code-agent",
          },
        },
        ambientManagerContext: {
          environment: {
            DIVEDRA_GRAPHQL_ENDPOINT: "http://127.0.0.1:43173/graphql",
            DIVEDRA_MANAGER_AUTH_TOKEN: "secret",
            DIVEDRA_MANAGER_SESSION_ID: "mgrsess-exec-000001",
            DIVEDRA_WORKFLOW_ID: "wf",
            DIVEDRA_WORKFLOW_EXECUTION_ID: "sess-1",
            DIVEDRA_MANAGER_STEP_ID: "node-1",
            DIVEDRA_MANAGER_NODE_EXEC_ID: "exec-1",
          },
        },
      },
      baseContext,
    );

    expect(fixture.createRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          DIVEDRA_GRAPHQL_ENDPOINT: "http://127.0.0.1:43173/graphql",
          DIVEDRA_WORKFLOW_EXECUTION_ID: "sess-1",
          DIVEDRA_NODE_EXEC_ID: "exec-1",
        }),
      }),
    );
  });

  test("maps invalid structured output to invalid_output", async () => {
    const fixture = makeClaudeRunnerFixture({
      messages: [
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "not json" }],
          },
        },
      ],
    });
    const adapter = new ClaudeCodeAgentAdapter({
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
});