import { afterEach, describe, expect, test, vi } from "vitest";
import { AdapterExecutionError } from "../adapter";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import { CursorCliAgentAdapter } from "./cursor";

const baseInput: AdapterExecutionInput = {
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
  arguments: { key: "value" },
  executionIndex: 1,
  artifactDir: "/tmp/node-1/exec-1",
  upstreamCommunicationIds: ["comm-1"],
  executionMailbox: {
    meta: {
      protocolVersion: 1,
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
      input: {
        kind: "json",
        source: "resolved-workflow-messages",
        snapshotPath: "resolved-input/input.json",
        upstreamSources: [],
      },
      output: {
        kind: "json",
        required: true,
        publication: "runtime-owned-after-validation",
        candidateSubmission: "inline-json-or-reserved-candidate-file",
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

interface MockCursorRunResult {
  readonly sessionId: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly events: readonly unknown[];
}

function makeMockCursorSession(options: {
  readonly sessionId: string;
  readonly events?: readonly unknown[];
  readonly result?: MockCursorRunResult;
}) {
  const sessionId = options.sessionId;
  const events = options.events ?? [];
  const result: MockCursorRunResult = options.result ?? {
    sessionId,
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    events: [],
  };
  return {
    sessionId,
    async *messages(): AsyncGenerator<unknown, void, undefined> {
      for (const event of events) {
        yield event;
      }
    },
    waitForCompletion: vi.fn(async () => result),
    cancel: vi.fn(async () => {
      return;
    }),
    interrupt: vi.fn(async () => {
      return;
    }),
  };
}

function makeMockCursorRunner(sessions: {
  readonly start?: ReturnType<typeof makeMockCursorSession>;
  readonly resume?: ReturnType<typeof makeMockCursorSession>;
}) {
  const startSession =
    sessions.start ?? makeMockCursorSession({ sessionId: "cursor-session-1" });
  const resumeSession = sessions.resume ?? startSession;
  return {
    start: vi.fn(() => startSession),
    resume: vi.fn(() => resumeSession),
  };
}

describe("CursorCliAgentAdapter", () => {
  test("runs with mocked cursor runner and normalizes assistant message output", async () => {
    const sessionId = "cursor-session-abc";
    const startSession = makeMockCursorSession({
      sessionId,
      events: [
        {
          type: "session.started",
          sessionId,
          cwd: "/tmp/project",
          model: "claude-sonnet-4-5",
        },
        {
          type: "session.assistant_message",
          sessionId,
          message: {
            role: "assistant",
            rawText: "raw cursor reply",
            displayText: "display cursor reply",
          },
        },
      ],
    });
    const runner = makeMockCursorRunner({ start: startSession });
    const createRunner = vi.fn(() => runner);

    const adapter = new CursorCliAgentAdapter({ createRunner });

    const output = await adapter.execute(
      { ...baseInput, systemPromptText: "system" },
      baseContext,
    );

    expect(output.provider).toBe("cursor-cli-agent");
    expect(output.model).toBe("claude-sonnet-4-5");
    expect(output.promptText).toBe("system\n\nhello");
    expect(output.payload).toEqual({ text: "display cursor reply" });
    expect(output.backendSession?.sessionId).toBe(sessionId);
    expect(output.llmMessages).toEqual([
      expect.objectContaining({
        ordinal: 1,
        eventType: "session.assistant_message",
        role: "assistant",
        contentText: "display cursor reply",
        backendSessionId: sessionId,
      }),
    ]);
    expect(runner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "hello",
        systemPrompt: "system",
        cwd: "/tmp/project",
        model: "claude-sonnet-4-5",
        streamMode: "event",
      }),
    );
    expect(createRunner).toHaveBeenCalledTimes(1);
  });

  test("forwards node effort to the Cursor runner", async () => {
    const runner = makeMockCursorRunner({});
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    const output = await adapter.execute(
      {
        ...baseInput,
        node: {
          ...baseInput.node,
          model: "gpt-5.3-codex",
          effort: "high",
        },
      },
      baseContext,
    );

    expect(output.effort).toBe("high");
    expect(runner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.3-codex",
        effort: "high",
      }),
    );
  });

  test("injects ambient manager env without adding mailbox env to hook context", async () => {
    let observedGraphqlEndpoint: string | undefined;
    let observedWorkflowExecutionId: string | undefined;
    let observedNodeExecId: string | undefined;
    let observedMailboxDir: string | undefined;
    const sessionId = "cursor-session-ambient";
    const startSession = makeMockCursorSession({
      sessionId,
      events: [
        {
          type: "session.assistant_message",
          sessionId,
          message: {
            role: "assistant",
            rawText: "ambient cursor reply",
            displayText: "ambient cursor reply",
          },
        },
      ],
    });
    const runner = makeMockCursorRunner({ start: startSession });
    runner.start.mockImplementation(() => {
      observedGraphqlEndpoint = process.env["RIEL_GRAPHQL_ENDPOINT"];
      observedWorkflowExecutionId = process.env["RIEL_WORKFLOW_EXECUTION_ID"];
      observedNodeExecId = process.env["RIEL_NODE_EXEC_ID"];
      observedMailboxDir = process.env["RIEL_MAILBOX_DIR"];
      return startSession;
    });
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    const priorMailboxDir = process.env["RIEL_MAILBOX_DIR"];
    process.env["RIEL_MAILBOX_DIR"] = "/tmp/legacy-mailbox";
    try {
      await adapter.execute(
        {
          ...baseInput,
          rielflowHookContext: {
            environment: {
              RIEL_WORKFLOW_ID: "wf",
              RIEL_WORKFLOW_EXECUTION_ID: "sess-1",
              RIEL_NODE_ID: "node-1",
              RIEL_NODE_EXEC_ID: "exec-1",
              RIEL_AGENT_BACKEND: "cursor-cli-agent",
            },
          },
          ambientManagerContext: {
            environment: {
              RIEL_GRAPHQL_ENDPOINT: "http://127.0.0.1:43173/graphql",
              RIEL_MANAGER_AUTH_TOKEN: "secret",
              RIEL_MANAGER_SESSION_ID: "mgrsess-exec-000001",
              RIEL_WORKFLOW_ID: "wf",
              RIEL_WORKFLOW_EXECUTION_ID: "sess-1",
              RIEL_MANAGER_STEP_ID: "node-1",
              RIEL_MANAGER_NODE_EXEC_ID: "exec-1",
            },
          },
        },
        baseContext,
      );
    } finally {
      if (priorMailboxDir === undefined) {
        delete process.env["RIEL_MAILBOX_DIR"];
      } else {
        process.env["RIEL_MAILBOX_DIR"] = priorMailboxDir;
      }
    }

    expect(observedGraphqlEndpoint).toBe("http://127.0.0.1:43173/graphql");
    expect(observedWorkflowExecutionId).toBe("sess-1");
    expect(observedNodeExecId).toBe("exec-1");
    expect(observedMailboxDir).toBe("/tmp/legacy-mailbox");
    expect(process.env["RIEL_MAILBOX_DIR"]).toBe(priorMailboxDir);
  });

  test("forwards image attachments discovered in workflow input", async () => {
    const runner = makeMockCursorRunner({});
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    await adapter.execute(
      {
        ...baseInput,
        mergedVariables: {
          workflowInput: {
            attachments: [
              {
                kind: "image",
                mediaType: "image/png",
                localPath: "/tmp/rina-image.png",
              },
            ],
          },
        },
      },
      baseContext,
    );

    expect(runner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        images: ["/tmp/rina-image.png"],
      }),
    );
  });

  test("falls back to rawText when displayText is empty", async () => {
    const sessionId = "cursor-session-raw";
    const startSession = makeMockCursorSession({
      sessionId,
      events: [
        {
          type: "session.assistant_message",
          sessionId,
          message: {
            role: "assistant",
            rawText: "raw only reply",
            displayText: "",
          },
        },
      ],
    });
    const runner = makeMockCursorRunner({ start: startSession });
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    const output = await adapter.execute(baseInput, baseContext);

    expect(output.provider).toBe("cursor-cli-agent");
    expect(output.payload).toEqual({ text: "raw only reply" });
  });

  test("reuses backend session via resume when backendSession.mode is reuse", async () => {
    const sessionId = "cursor-reuse-session";
    const resumeSession = makeMockCursorSession({
      sessionId,
      events: [
        {
          type: "session.assistant_message",
          sessionId,
          message: {
            role: "assistant",
            rawText: '{"summary":"ok"}',
            displayText: '{"summary":"ok"}',
          },
        },
      ],
    });
    const runner = makeMockCursorRunner({ resume: resumeSession });
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    const output = await adapter.execute(
      {
        ...baseInput,
        systemPromptText: "system",
        backendSession: { mode: "reuse", sessionId },
        output: {
          maxValidationAttempts: 2,
          attempt: 1,
          candidatePath: "/tmp/candidate.json",
          validationErrors: [],
          publication: {
            owner: "runtime",
            finalArtifactWrite: "runtime-only",
            messageWrite: "runtime-only-after-validation",
            candidateSubmission: "inline-json-or-reserved-candidate-file",
            futureCommunicationIdsExposed: false,
          },
        },
      },
      baseContext,
    );

    expect(runner.resume).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        prompt: "hello",
        model: "claude-sonnet-4-5",
        systemPrompt: "system",
        streamMode: "event",
      }),
    );
    expect(output.promptText).toBe("system\n\nhello");
    expect(output.payload).toEqual({ summary: "ok" });
    expect(output.backendSession?.sessionId).toBe(sessionId);
  });

  test("uses session.completed result as fallback text and materialized sessionId from waitForCompletion", async () => {
    const initialSessionId = "cursor-pending-initial";
    const materializedSessionId = "cursor-materialized-session-xyz";
    const finalText = "final answer from completed session";

    const startSession = makeMockCursorSession({
      sessionId: initialSessionId,
      events: [
        {
          type: "session.pending",
          recordId: "record-001",
          cursorChatId: "chat-001",
        },
        {
          type: "session.completed",
          sessionId: initialSessionId,
          result: finalText,
        },
      ],
      result: {
        sessionId: materializedSessionId,
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: "",
        events: [],
      },
    });
    const runner = makeMockCursorRunner({ start: startSession });
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    const output = await adapter.execute(baseInput, baseContext);

    expect(output.provider).toBe("cursor-cli-agent");
    expect(output.payload).toEqual({ text: finalText });
    expect(output.backendSession?.sessionId).toBe(materializedSessionId);
  });

  test("does not replace non-empty assistant message with session.completed result", async () => {
    const sessionId = "cursor-completed-with-message";
    const assistantText = "assistant reply";
    const completedText = "completed result text";

    const startSession = makeMockCursorSession({
      sessionId,
      events: [
        {
          type: "session.assistant_message",
          sessionId,
          message: {
            role: "assistant",
            rawText: assistantText,
            displayText: assistantText,
          },
        },
        {
          type: "session.completed",
          sessionId,
          result: completedText,
        },
      ],
    });
    const runner = makeMockCursorRunner({ start: startSession });
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    const output = await adapter.execute(baseInput, baseContext);

    expect(output.payload).toEqual({ text: assistantText });
  });

  test("maps nonzero exit to provider_error", async () => {
    const sessionId = "cursor-fail-session";
    const startSession = makeMockCursorSession({
      sessionId,
      events: [],
      result: {
        sessionId,
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: "something went wrong",
        events: [],
      },
    });
    const runner = makeMockCursorRunner({ start: startSession });
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    await expect(
      adapter.execute(baseInput, baseContext),
    ).rejects.toHaveProperty("code", "provider_error");
  });

  test("maps invalid structured output to invalid_output", async () => {
    const sessionId = "cursor-invalid-output-session";
    const startSession = makeMockCursorSession({
      sessionId,
      events: [
        {
          type: "session.assistant_message",
          sessionId,
          message: {
            role: "assistant",
            rawText: "not json",
            displayText: "not json",
          },
        },
      ],
    });
    const runner = makeMockCursorRunner({ start: startSession });
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
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
              messageWrite: "runtime-only-after-validation",
              candidateSubmission: "inline-json-or-reserved-candidate-file",
              futureCommunicationIdsExposed: false,
            },
          },
        },
        baseContext,
      ),
    ).rejects.toHaveProperty("code", "invalid_output");
  });

  test("fails before creating a runner when auth preflight fails", async () => {
    const runner = makeMockCursorRunner({});
    const createRunner = vi.fn(() => runner);
    const checkAuthPreflight = vi.fn(async () => {
      throw new AdapterExecutionError(
        "policy_blocked",
        "cursor-cli-agent authentication is unavailable: login required",
      );
    });
    const adapter = new CursorCliAgentAdapter({
      createRunner,
      checkAuthPreflight,
    });

    await expect(adapter.execute(baseInput, baseContext)).rejects.toMatchObject(
      {
        code: "policy_blocked",
        message: expect.stringContaining("login required"),
      },
    );
    expect(checkAuthPreflight).toHaveBeenCalledWith(
      baseInput,
      expect.objectContaining({
        cwd: "/tmp/project",
        timeoutMs: 30000,
      }),
    );
    expect(createRunner).not.toHaveBeenCalled();
  });

  test("allows auth preflight to be disabled", async () => {
    const runner = makeMockCursorRunner({});
    const createRunner = vi.fn(() => runner);
    const checkAuthPreflight = vi.fn(async () => {
      throw new AdapterExecutionError(
        "policy_blocked",
        "cursor-cli-agent authentication is unavailable",
      );
    });
    const adapter = new CursorCliAgentAdapter({
      createRunner,
      checkAuthPreflight,
      authPreflight: false,
    });

    await expect(
      adapter.execute(baseInput, baseContext),
    ).resolves.toMatchObject({
      provider: "cursor-cli-agent",
    });
    expect(checkAuthPreflight).not.toHaveBeenCalled();
    expect(createRunner).toHaveBeenCalledTimes(1);
  });
});
