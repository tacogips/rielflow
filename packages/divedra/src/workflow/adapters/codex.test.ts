import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MockCodexRunningSession,
  createMockCodexSessionRunner,
  type MockCodexSessionStreamChunk,
} from "codex-agent/sdk/testing";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import { CodexAgentAdapter } from "./codex";

type SessionStreamChunk = MockCodexSessionStreamChunk;

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

const stallWatchEnvKeys = [
  "DIVEDRA_LLM_STALL_CHECK_INTERVAL_MS",
  "DIVEDRA_LLM_STALL_NUDGE_MAX_ATTEMPTS",
  "DIVEDRA_LLM_STALL_NUDGE_PROMPT",
] as const;
const originalStallWatchEnv = new Map<string, string | undefined>(
  stallWatchEnvKeys.map((key) => [key, process.env[key]]),
);

function codexSessionMeta(sessionId: string): SessionStreamChunk {
  return {
    type: "session_meta",
    timestamp: "2026-03-30T00:00:00.000Z",
    payload: {
      meta: {
        id: sessionId,
        timestamp: "2026-03-30T00:00:00.000Z",
        cwd: "/tmp/project",
        originator: "codex",
        cli_version: "1.0.0",
        source: "exec",
      },
    },
  };
}

function codexAssistantText(text: string): SessionStreamChunk {
  return {
    type: "response_item",
    timestamp: "2026-03-30T00:00:01.000Z",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of stallWatchEnvKeys) {
    const original = originalStallWatchEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

function makeCodexRunnerFixture(
  input: {
    readonly sessionId?: string;
    readonly messages?: readonly SessionStreamChunk[];
    readonly success?: boolean;
    readonly exitCode?: number;
  } = {},
) {
  const sessionId = input.sessionId ?? "codex-session-1";
  const chunks: readonly SessionStreamChunk[] = input.messages ?? [
    codexSessionMeta(sessionId),
    codexAssistantText("local codex reply"),
  ];
  const session = new MockCodexRunningSession({
    sessionId,
    messages: chunks,
    result: {
      success: input.success ?? true,
      exitCode: input.exitCode ?? 0,
      startedAt: "2026-03-30T00:00:00.000Z",
      completedAt: "2026-03-30T00:00:01.000Z",
      messageCount: chunks.length,
    },
  });
  const runner = createMockCodexSessionRunner({
    startSessions: [session],
    resumeSessions: [session],
  });
  const startSession = vi.spyOn(runner, "startSession");
  const resumeSession = vi.spyOn(runner, "resumeSession");
  const cancel = vi.spyOn(session, "cancel");
  const createRunner = vi.fn(() => runner);

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
    expect(output.llmMessages).toEqual([
      expect.objectContaining({
        ordinal: 1,
        eventType: "assistant.snapshot",
        role: "assistant",
        contentText: "local codex reply",
        backendSessionId: "codex-session-1",
      }),
    ]);
    expect(fixture.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "system\n\nhello",
        cwd: "/tmp/project",
        model: "gpt-5-nano",
        streamGranularity: "event",
      }),
    );
  });

  test("reuses backend sessions for local execution", async () => {
    const fixture = makeCodexRunnerFixture({
      sessionId: "backend-codex-1",
      messages: [
        codexSessionMeta("backend-codex-1"),
        codexAssistantText('{"summary":"ok"}'),
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

  test("nudges and completes from a stalled SDK session", async () => {
    const primarySession = new MockCodexRunningSession({
      sessionId: "codex-stall-1",
      messages: [codexSessionMeta("codex-stall-1")],
      autoComplete: false,
    });
    const nudgedSession = new MockCodexRunningSession({
      sessionId: "codex-stall-1",
      messages: [codexAssistantText("resumed codex reply")],
      result: {
        success: true,
        exitCode: 0,
        startedAt: "2026-03-30T00:00:01.000Z",
        completedAt: "2026-03-30T00:00:02.000Z",
        messageCount: 1,
      },
    });
    const runner = createMockCodexSessionRunner({
      startSessions: [primarySession],
      resumeSessions: [nudgedSession],
    });
    const resumeSession = vi.spyOn(runner, "resumeSession");
    const adapter = new CodexAgentAdapter({
      createRunner: vi.fn(() => runner),
      stallCheckIntervalMs: 5,
      stallNudgeMaxAttempts: 1,
      stallNudgePrompt: "continue now",
    });

    const output = await adapter.execute(baseInput, {
      ...baseContext,
      timeoutMs: 1000,
    });

    primarySession.complete({ success: false, exitCode: 1 });
    expect(resumeSession).toHaveBeenCalledWith(
      "codex-stall-1",
      "continue now",
      expect.objectContaining({
        model: "gpt-5-nano",
        streamGranularity: "event",
      }),
    );
    expect(output.payload).toEqual({ text: "resumed codex reply" });
    expect(output.processLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "codex-agent-stall-watch",
          text: expect.stringContaining("sending stall nudge"),
        }),
      ]),
    );
  });

  test("uses environment-configured stall watch settings", async () => {
    process.env["DIVEDRA_LLM_STALL_CHECK_INTERVAL_MS"] = "5";
    process.env["DIVEDRA_LLM_STALL_NUDGE_MAX_ATTEMPTS"] = "1";
    process.env["DIVEDRA_LLM_STALL_NUDGE_PROMPT"] = "continue from env";
    const primarySession = new MockCodexRunningSession({
      sessionId: "codex-env-stall-1",
      autoComplete: false,
    });
    const nudgedSession = new MockCodexRunningSession({
      sessionId: "codex-env-stall-1",
      messages: [codexAssistantText("env resumed reply")],
      result: {
        success: true,
        exitCode: 0,
        startedAt: "2026-03-30T00:00:01.000Z",
        completedAt: "2026-03-30T00:00:02.000Z",
        messageCount: 1,
      },
    });
    const runner = createMockCodexSessionRunner({
      startSessions: [primarySession],
      resumeSessions: [nudgedSession],
    });
    const resumeSession = vi.spyOn(runner, "resumeSession");
    const adapter = new CodexAgentAdapter({
      createRunner: vi.fn(() => runner),
    });

    const output = await adapter.execute(baseInput, baseContext);

    primarySession.complete({ success: false, exitCode: 1 });
    expect(resumeSession).toHaveBeenCalledWith(
      "codex-env-stall-1",
      "continue from env",
      expect.objectContaining({
        model: "gpt-5-nano",
        streamGranularity: "event",
      }),
    );
    expect(output.payload).toEqual({ text: "env resumed reply" });
    expect(output.processLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "codex-agent-stall-watch",
          text: expect.stringContaining("5ms"),
        }),
      ]),
    );
  });

  test("injects ambient manager env during local session startup", async () => {
    let observedGraphqlEndpoint: string | undefined;
    let observedWorkflowExecutionId: string | undefined;
    let observedNodeExecId: string | undefined;
    let observedMailboxDir: string | undefined;
    const fixture = makeCodexRunnerFixture();
    const ambientRunner = createMockCodexSessionRunner();
    vi.spyOn(ambientRunner, "startSession").mockImplementation(async () => {
      observedGraphqlEndpoint = process.env["DIVEDRA_GRAPHQL_ENDPOINT"];
      observedWorkflowExecutionId =
        process.env["DIVEDRA_WORKFLOW_EXECUTION_ID"];
      observedNodeExecId = process.env["DIVEDRA_NODE_EXEC_ID"];
      observedMailboxDir = process.env["DIVEDRA_MAILBOX_DIR"];
      return new MockCodexRunningSession({
        sessionId: "codex-session-ambient",
        messages: [
          codexSessionMeta("codex-session-ambient"),
          codexAssistantText("ambient ok"),
        ],
        result: {
          success: true,
          exitCode: 0,
          startedAt: "2026-03-30T00:00:00.000Z",
          completedAt: "2026-03-30T00:00:01.000Z",
          messageCount: 2,
        },
      });
    });
    fixture.createRunner.mockReturnValue(ambientRunner);

    const adapter = new CodexAgentAdapter({
      createRunner: fixture.createRunner,
    });
    const priorGraphqlEndpoint = process.env["DIVEDRA_GRAPHQL_ENDPOINT"];
    const priorWorkflowExecutionId =
      process.env["DIVEDRA_WORKFLOW_EXECUTION_ID"];
    await adapter.execute(
      {
        ...baseInput,
        divedraHookContext: {
          environment: {
            DIVEDRA_WORKFLOW_ID: "wf",
            DIVEDRA_WORKFLOW_EXECUTION_ID: "sess-1",
            DIVEDRA_NODE_ID: "node-1",
            DIVEDRA_NODE_EXEC_ID: "exec-1",
            DIVEDRA_MAILBOX_DIR: "/tmp/node-1/exec-1/mailbox",
            DIVEDRA_AGENT_BACKEND: "codex-agent",
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

    expect(observedGraphqlEndpoint).toBe("http://127.0.0.1:43173/graphql");
    expect(observedWorkflowExecutionId).toBe("sess-1");
    expect(observedNodeExecId).toBe("exec-1");
    expect(observedMailboxDir).toBe("/tmp/node-1/exec-1/mailbox");
    expect(process.env["DIVEDRA_GRAPHQL_ENDPOINT"]).toBe(priorGraphqlEndpoint);
    expect(process.env["DIVEDRA_WORKFLOW_EXECUTION_ID"]).toBe(
      priorWorkflowExecutionId,
    );
  });

  test("maps invalid structured output to invalid_output", async () => {
    const fixture = makeCodexRunnerFixture({
      messages: [
        codexSessionMeta("codex-session-1"),
        codexAssistantText("not json"),
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
});
