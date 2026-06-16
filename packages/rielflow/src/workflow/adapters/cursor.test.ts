import { afterEach, describe, expect, test, vi } from "vitest";
import { AdapterExecutionError } from "../adapter";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import {
  CursorCliAgentAdapter,
  resolveCursorModelSlug,
  resolveCursorAgentBinary,
  resolveCursorAuthEnvironment,
} from "./cursor";
import { setCursorSdkCheckModelForTest } from "./readiness";

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
  setCursorSdkCheckModelForTest(undefined);
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

  test("does not forward effort for composer models", async () => {
    const runner = makeMockCursorRunner({});
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    const output = await adapter.execute(
      {
        ...baseInput,
        node: {
          ...baseInput.node,
          model: "composer-2.5",
          effort: "high",
        },
      },
      baseContext,
    );

    expect(output.effort).toBe("high");
    expect(runner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "composer-2.5",
      }),
    );
    expect(runner.start).not.toHaveBeenCalledWith(
      expect.objectContaining({
        effort: "high",
      }),
    );
  });

  test("resolves gpt-5.5 effort into Cursor model slug without separate effort", async () => {
    const runner = makeMockCursorRunner({});
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    await adapter.execute(
      {
        ...baseInput,
        node: {
          ...baseInput.node,
          model: "gpt-5.5",
          effort: "high",
        },
      },
      baseContext,
    );

    expect(runner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.5-high",
      }),
    );
    expect(runner.start).not.toHaveBeenCalledWith(
      expect.objectContaining({
        effort: expect.anything(),
      }),
    );
  });

  test("uses resolved gpt-5.5 slug when resuming cursor sessions", async () => {
    const sessionId = "cursor-gpt55-resume";
    const resumeSession = makeMockCursorSession({ sessionId });
    const runner = makeMockCursorRunner({ resume: resumeSession });
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    await adapter.execute(
      {
        ...baseInput,
        node: {
          ...baseInput.node,
          model: "gpt-5.5",
          effort: "high",
        },
        backendSession: { mode: "reuse", sessionId },
      },
      baseContext,
    );

    expect(runner.resume).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.5-high",
        sessionId,
      }),
    );
    expect(runner.resume).not.toHaveBeenCalledWith(
      expect.objectContaining({
        effort: expect.anything(),
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

    await expect(adapter.execute(baseInput, baseContext)).rejects.toMatchObject(
      {
        code: "provider_error",
        message: expect.stringContaining("something went wrong"),
      },
    );
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

  test("applies maximum permission defaults when no permission config is set", async () => {
    const runner = makeMockCursorRunner({});
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    await adapter.execute(baseInput, baseContext);

    expect(runner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        trust: true,
        force: true,
        yolo: true,
        sandbox: "disabled",
        approveMcps: true,
      }),
    );
  });

  test("preserves explicit false overrides for permission booleans", async () => {
    const runner = makeMockCursorRunner({});
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
      trust: false,
      force: false,
      yolo: false,
      sandbox: "enabled",
      approveMcps: false,
    });

    await adapter.execute(baseInput, baseContext);

    expect(runner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        trust: false,
        force: false,
        yolo: false,
        sandbox: "enabled",
        approveMcps: false,
      }),
    );
  });

  test("forwards permission options through resume", async () => {
    const sessionId = "cursor-perm-resume";
    const resumeSession = makeMockCursorSession({ sessionId });
    const runner = makeMockCursorRunner({ resume: resumeSession });
    const adapter = new CursorCliAgentAdapter({
      createRunner: vi.fn(() => runner),
      trust: false,
      yolo: false,
    });

    await adapter.execute(
      {
        ...baseInput,
        backendSession: { mode: "reuse", sessionId },
      },
      baseContext,
    );

    expect(runner.resume).toHaveBeenCalledWith(
      expect.objectContaining({
        trust: false,
        yolo: false,
        force: true,
        sandbox: "disabled",
        approveMcps: true,
      }),
    );
  });

  test("default preflight probes resolved gpt-5.5-high slug for gpt-5.5 + effort high", async () => {
    let capturedModel: string | undefined;
    setCursorSdkCheckModelForTest(async (_commandRunner, options) => {
      capturedModel = options.model;
      return {
        model: options.model,
        binary: {
          name: "cursor-agent",
          command: "cursor-agent",
          version: "1.0.0",
          status: "available",
          checkedAt: new Date().toISOString(),
        },
        auth: {
          status: "available",
          detail: "authenticated",
          provenance: "stable_api",
        },
        modelReachability: {
          status: "available",
          probed: true,
        },
        checkedAt: new Date().toISOString(),
      };
    });

    const runner = makeMockCursorRunner({});
    const adapter = new CursorCliAgentAdapter({
      authPreflight: true,
      createRunner: vi.fn(() => runner),
    });

    await adapter.execute(
      {
        ...baseInput,
        node: {
          ...baseInput.node,
          model: "gpt-5.5",
          effort: "high",
        },
      },
      baseContext,
    );

    expect(capturedModel).toBe("gpt-5.5-high");
  });

  test("default preflight reports auth-required probe output as authentication unavailable", async () => {
    setCursorSdkCheckModelForTest(async (_commandRunner, options) => ({
      model: options.model,
      binary: {
        name: "cursor-agent",
        command: "cursor-agent",
        version: "1.0.0",
        status: "available",
        checkedAt: new Date().toISOString(),
      },
      auth: {
        status: "unknown",
        detail: "auth not checked via probe path",
        provenance: "not_available",
      },
      modelReachability: {
        status: "unavailable",
        probed: true,
        error:
          "Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY in your environment.",
      },
      checkedAt: new Date().toISOString(),
    }));

    const runner = makeMockCursorRunner({});
    const adapter = new CursorCliAgentAdapter({
      authPreflight: true,
      createRunner: vi.fn(() => runner),
    });

    await expect(
      adapter.execute(
        {
          ...baseInput,
          node: {
            ...baseInput.node,
            model: "gpt-5.5",
            effort: "high",
          },
        },
        baseContext,
      ),
    ).rejects.toMatchObject({
      code: "policy_blocked",
      message: expect.stringContaining(
        "cursor-cli-agent authentication is unavailable",
      ),
    });
    await expect(
      adapter.execute(
        {
          ...baseInput,
          node: {
            ...baseInput.node,
            model: "gpt-5.5",
            effort: "high",
          },
        },
        baseContext,
      ),
    ).rejects.not.toMatchObject({
      message: expect.stringContaining("model"),
    });
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

  test("default execution skips preflight even when SDK would report auth required", async () => {
    setCursorSdkCheckModelForTest(async (_commandRunner, _options) => ({
      model: _options.model,
      binary: {
        name: "cursor-agent",
        command: "cursor-agent",
        version: "1.0.0",
        status: "available",
        checkedAt: new Date().toISOString(),
      },
      auth: {
        status: "unavailable",
        detail: "authentication required",
        provenance: "not_available",
      },
      modelReachability: {
        status: "unavailable",
        probed: true,
        error:
          "Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY.",
      },
      checkedAt: new Date().toISOString(),
    }));

    const runner = makeMockCursorRunner({});
    const createRunner = vi.fn(() => runner);
    const adapter = new CursorCliAgentAdapter({ createRunner });

    await expect(
      adapter.execute(baseInput, baseContext),
    ).resolves.toMatchObject({ provider: "cursor-cli-agent" });
    expect(createRunner).toHaveBeenCalledTimes(1);
  });

  test("explicit authPreflight:true fails on auth probe with unavailable auth status", async () => {
    setCursorSdkCheckModelForTest(async (_commandRunner, options) => ({
      model: options.model,
      binary: {
        name: "cursor-agent",
        command: "cursor-agent",
        version: "1.0.0",
        status: "available",
        checkedAt: new Date().toISOString(),
      },
      auth: {
        status: "unavailable",
        detail: "not authenticated",
        provenance: "not_available",
      },
      modelReachability: {
        status: "not_checked",
        probed: false,
      },
      checkedAt: new Date().toISOString(),
    }));

    const runner = makeMockCursorRunner({});
    const adapter = new CursorCliAgentAdapter({
      authPreflight: true,
      createRunner: vi.fn(() => runner),
    });

    await expect(adapter.execute(baseInput, baseContext)).rejects.toMatchObject(
      {
        code: "policy_blocked",
        message: expect.stringContaining(
          "cursor-cli-agent authentication is unavailable",
        ),
      },
    );
  });

  test("custom cursor binary from adapter config is passed to createRunner", async () => {
    const runner = makeMockCursorRunner({});
    const createRunner = vi.fn(() => runner);
    const adapter = new CursorCliAgentAdapter({
      createRunner,
      cursorBinary: "/custom/cursor-agent",
    });

    await adapter.execute(baseInput, baseContext);

    expect(createRunner).toHaveBeenCalledWith(
      expect.objectContaining({ cursorBinary: "/custom/cursor-agent" }),
    );
  });

  test("custom cursor binary from node variable is passed to createRunner", async () => {
    const runner = makeMockCursorRunner({});
    const createRunner = vi.fn(() => runner);
    const adapter = new CursorCliAgentAdapter({ createRunner });

    await adapter.execute(
      {
        ...baseInput,
        node: {
          ...baseInput.node,
          variables: { cursorBinary: "/node-var/cursor-agent" },
        },
      },
      baseContext,
    );

    expect(createRunner).toHaveBeenCalledWith(
      expect.objectContaining({ cursorBinary: "/node-var/cursor-agent" }),
    );
  });

  test("cursor binary from node cursorExecutable variable is passed to createRunner when cursorBinary is absent", async () => {
    const runner = makeMockCursorRunner({});
    const createRunner = vi.fn(() => runner);
    const adapter = new CursorCliAgentAdapter({ createRunner });

    await adapter.execute(
      {
        ...baseInput,
        node: {
          ...baseInput.node,
          variables: { cursorExecutable: "/exec-var/cursor" },
        },
      },
      baseContext,
    );

    expect(createRunner).toHaveBeenCalledWith(
      expect.objectContaining({ cursorBinary: "/exec-var/cursor" }),
    );
  });
});

describe("resolveCursorAgentBinary", () => {
  afterEach(() => {
    for (const key of [
      "RIELFLOW_CURSOR_AGENT_BINARY",
      "CURSOR_AGENT_BINARY",
      "CURSOR_CLI_AGENT_BINARY",
    ]) {
      delete process.env[key];
    }
  });

  test("returns config cursorBinary first", () => {
    process.env["CURSOR_AGENT_BINARY"] = "/env/cursor";
    const result = resolveCursorAgentBinary({
      cursorBinary: "/config/cursor",
      nodeVariables: { cursorBinary: "/node/cursor" },
    });
    expect(result).toBe("/config/cursor");
  });

  test("returns node variable cursorBinary when config is absent", () => {
    const result = resolveCursorAgentBinary({
      nodeVariables: { cursorBinary: "/node/cursor" },
    });
    expect(result).toBe("/node/cursor");
  });

  test("returns node variable cursorExecutable when cursorBinary variable is absent", () => {
    const result = resolveCursorAgentBinary({
      nodeVariables: { cursorExecutable: "/node/cursor-exec" },
    });
    expect(result).toBe("/node/cursor-exec");
  });

  test("returns RIELFLOW_CURSOR_AGENT_BINARY env var when config and node vars absent", () => {
    process.env["RIELFLOW_CURSOR_AGENT_BINARY"] = "/rielflow-env/cursor";
    process.env["CURSOR_AGENT_BINARY"] = "/env/cursor";
    const result = resolveCursorAgentBinary({});
    expect(result).toBe("/rielflow-env/cursor");
  });

  test("returns CURSOR_AGENT_BINARY env var when RIELFLOW_CURSOR_AGENT_BINARY is absent", () => {
    process.env["CURSOR_AGENT_BINARY"] = "/env/cursor";
    process.env["CURSOR_CLI_AGENT_BINARY"] = "/cli-env/cursor";
    const result = resolveCursorAgentBinary({});
    expect(result).toBe("/env/cursor");
  });

  test("returns CURSOR_CLI_AGENT_BINARY as last env fallback", () => {
    process.env["CURSOR_CLI_AGENT_BINARY"] = "/cli-env/cursor";
    const result = resolveCursorAgentBinary({});
    expect(result).toBe("/cli-env/cursor");
  });

  test("returns undefined when nothing is configured", () => {
    const result = resolveCursorAgentBinary({});
    expect(result).toBeUndefined();
  });
});

describe("resolveCursorModelSlug", () => {
  test("maps gpt-5.5 effort into Cursor model slugs", () => {
    expect(resolveCursorModelSlug("gpt-5.5", "high")).toBe("gpt-5.5-high");
    expect(resolveCursorModelSlug("gpt-5.5", "xhigh")).toBe(
      "gpt-5.5-extra-high",
    );
  });

  test("replaces existing gpt-5.5 effort token and preserves fast suffix", () => {
    expect(resolveCursorModelSlug("gpt-5.5-medium", "high")).toBe(
      "gpt-5.5-high",
    );
    expect(resolveCursorModelSlug("gpt-5.5-medium-fast", "high")).toBe(
      "gpt-5.5-high-fast",
    );
  });

  test("leaves composer and non-gpt-5.5 models for existing effort handling", () => {
    expect(resolveCursorModelSlug("composer-2.5", "high")).toBe("composer-2.5");
    expect(resolveCursorModelSlug("claude-sonnet-4-5", "high")).toBe(
      "claude-sonnet-4-5",
    );
  });
});

describe("resolveCursorAuthEnvironment", () => {
  const cursorApiKeyEnv = "CURSOR_API" + "_KEY";
  const rielflowCursorApiKeyEnv = "RIELFLOW_CURSOR_API" + "_KEY";

  test("returns empty object when no auth vars are set", () => {
    const result = resolveCursorAuthEnvironment({});
    expect(result).toEqual({});
  });

  test("picks RIELFLOW_CURSOR_API_KEY as CURSOR_API_KEY", () => {
    const result = resolveCursorAuthEnvironment({
      [rielflowCursorApiKeyEnv]: "placeholder",
    });
    expect(result.CURSOR_API_KEY).toBe("placeholder");
  });

  test("falls back to CURSOR_API_KEY when RIELFLOW_CURSOR_API_KEY is absent", () => {
    const result = resolveCursorAuthEnvironment({
      [cursorApiKeyEnv]: "placeholder",
    });
    expect(result.CURSOR_API_KEY).toBe("placeholder");
  });

  test("prefers RIELFLOW_CURSOR_API_KEY over CURSOR_API_KEY", () => {
    const result = resolveCursorAuthEnvironment({
      [rielflowCursorApiKeyEnv]: "preferred-placeholder",
      [cursorApiKeyEnv]: "ambient-placeholder",
    });
    expect(result.CURSOR_API_KEY).toBe("preferred-placeholder");
  });

  test("picks RIELFLOW_CURSOR_HOME as CURSOR_CLI_AGENT_CURSOR_HOME", () => {
    const result = resolveCursorAuthEnvironment({
      RIELFLOW_CURSOR_HOME: "/custom/cursor/home",
    });
    expect(result.CURSOR_CLI_AGENT_CURSOR_HOME).toBe("/custom/cursor/home");
  });

  test("falls back to CURSOR_CLI_AGENT_CURSOR_HOME when RIELFLOW_CURSOR_HOME is absent", () => {
    const result = resolveCursorAuthEnvironment({
      CURSOR_CLI_AGENT_CURSOR_HOME: "/ambient/cursor/home",
    });
    expect(result.CURSOR_CLI_AGENT_CURSOR_HOME).toBe("/ambient/cursor/home");
  });

  test("returns both api key and cursor home when both are set", () => {
    const result = resolveCursorAuthEnvironment({
      [rielflowCursorApiKeyEnv]: "placeholder",
      RIELFLOW_CURSOR_HOME: "/my/cursor/home",
    });
    expect(result.CURSOR_API_KEY).toBe("placeholder");
    expect(result.CURSOR_CLI_AGENT_CURSOR_HOME).toBe("/my/cursor/home");
  });

  test("omits keys when values are empty strings", () => {
    const result = resolveCursorAuthEnvironment({
      [rielflowCursorApiKeyEnv]: "",
      [cursorApiKeyEnv]: "",
      RIELFLOW_CURSOR_HOME: "",
    });
    expect(result.CURSOR_API_KEY).toBeUndefined();
    expect(result.CURSOR_CLI_AGENT_CURSOR_HOME).toBeUndefined();
  });
});
