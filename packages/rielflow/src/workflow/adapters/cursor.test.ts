import { afterEach, describe, expect, test, vi } from "vitest";
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
        prompt: "system\n\nhello",
        cwd: "/tmp/project",
        model: "claude-sonnet-4-5",
        streamMode: "event",
      }),
    );
    expect(createRunner).toHaveBeenCalledTimes(1);
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
        backendSession: { mode: "reuse", sessionId },
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

    expect(runner.resume).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        prompt: "hello",
        model: "claude-sonnet-4-5",
        streamMode: "event",
      }),
    );
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
