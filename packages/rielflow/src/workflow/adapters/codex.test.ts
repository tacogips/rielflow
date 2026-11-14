import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MockCodexRunningSession,
  createMockCodexSessionRunner,
  type MockCodexSessionStreamChunk,
} from "codex-agent/sdk/testing";
import { AdapterExecutionError } from "../adapter";
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
      mailboxDirEnvVar: "RIEL_MAILBOX_DIR",
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
  "RIEL_LLM_STALL_CHECK_INTERVAL_MS",
  "RIEL_LLM_STALL_NUDGE_MAX_ATTEMPTS",
  "RIEL_LLM_STALL_NUDGE_PROMPT",
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
        prompt: "hello",
        systemPrompt: "system",
        cwd: "/tmp/project",
        model: "gpt-5-nano",
        streamGranularity: "event",
      }),
    );
  });

  test("forwards node effort as Codex reasoning effort config", async () => {
    const fixture = makeCodexRunnerFixture();
    const adapter = new CodexAgentAdapter({
      createRunner: fixture.createRunner,
    });

    const output = await adapter.execute(
      {
        ...baseInput,
        node: {
          ...baseInput.node,
          effort: "high",
        },
      },
      baseContext,
    );

    expect(output.effort).toBe("high");
    expect(fixture.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        configOverrides: ['model_reasoning_effort="high"'],
      }),
    );
  });

  test("merges node-level Codex passthrough args", async () => {
    const fixture = makeCodexRunnerFixture();
    const adapter = new CodexAgentAdapter({
      additionalArgs: ["--skip-git-repo-check"],
      createRunner: fixture.createRunner,
    });

    await adapter.execute(
      {
        ...baseInput,
        node: {
          ...baseInput.node,
          variables: {
            codexAdditionalArgs: ["--ignore-rules"],
          },
        },
      },
      baseContext,
    );

    expect(fixture.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalArgs: ["--skip-git-repo-check", "--ignore-rules"],
      }),
    );
  });

  test("forwards image attachments discovered in workflow input", async () => {
    const fixture = makeCodexRunnerFixture();
    const adapter = new CodexAgentAdapter({
      createRunner: fixture.createRunner,
    });

    await adapter.execute(
      {
        ...baseInput,
        mergedVariables: {
          workflowInput: {
            attachments: [
              {
                kind: "image",
                mediaType: "image/jpeg",
                localPath: "/tmp/telegram-photo.jpg",
              },
            ],
          },
        },
      },
      baseContext,
    );

    expect(fixture.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        images: ["/tmp/telegram-photo.jpg"],
      }),
    );
  });

  test("does not forward image attachments when node opts out", async () => {
    const fixture = makeCodexRunnerFixture();
    const adapter = new CodexAgentAdapter({
      createRunner: fixture.createRunner,
    });

    await adapter.execute(
      {
        ...baseInput,
        node: {
          ...baseInput.node,
          variables: {
            forwardImageAttachments: false,
          },
        },
        mergedVariables: {
          imagePaths: ["/tmp/router-should-not-read-image.jpg"],
        },
      },
      baseContext,
    );

    expect(fixture.startSession).toHaveBeenCalledWith(
      expect.not.objectContaining({
        images: ["/tmp/router-should-not-read-image.jpg"],
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
        systemPromptText: "system",
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
        systemPrompt: "system",
        streamGranularity: "event",
      }),
    );
    expect(output.promptText).toBe("system\n\nhello");
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
    process.env["RIEL_LLM_STALL_CHECK_INTERVAL_MS"] = "5";
    process.env["RIEL_LLM_STALL_NUDGE_MAX_ATTEMPTS"] = "1";
    process.env["RIEL_LLM_STALL_NUDGE_PROMPT"] = "continue from env";
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
      observedGraphqlEndpoint = process.env["RIEL_GRAPHQL_ENDPOINT"];
      observedWorkflowExecutionId = process.env["RIEL_WORKFLOW_EXECUTION_ID"];
      observedNodeExecId = process.env["RIEL_NODE_EXEC_ID"];
      observedMailboxDir = process.env["RIEL_MAILBOX_DIR"];
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
    const priorGraphqlEndpoint = process.env["RIEL_GRAPHQL_ENDPOINT"];
    const priorWorkflowExecutionId = process.env["RIEL_WORKFLOW_EXECUTION_ID"];
    await adapter.execute(
      {
        ...baseInput,
        rielflowHookContext: {
          environment: {
            RIEL_WORKFLOW_ID: "wf",
            RIEL_WORKFLOW_EXECUTION_ID: "sess-1",
            RIEL_NODE_ID: "node-1",
            RIEL_NODE_EXEC_ID: "exec-1",
            RIEL_MAILBOX_DIR: "/tmp/node-1/exec-1/mailbox",
            RIEL_AGENT_BACKEND: "codex-agent",
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

    expect(observedGraphqlEndpoint).toBe("http://127.0.0.1:43173/graphql");
    expect(observedWorkflowExecutionId).toBe("sess-1");
    expect(observedNodeExecId).toBe("exec-1");
    expect(observedMailboxDir).toBe("/tmp/node-1/exec-1/mailbox");
    expect(process.env["RIEL_GRAPHQL_ENDPOINT"]).toBe(priorGraphqlEndpoint);
    expect(process.env["RIEL_WORKFLOW_EXECUTION_ID"]).toBe(
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

  test("preserves non-Error startup diagnostics in provider failures", async () => {
    const adapter = new CodexAgentAdapter({
      maxAttempts: 1,
      createRunner: vi.fn(() => {
        throw {
          command: "codex exec --json",
          exitCode: 2,
          stderr: "unsupported model: gpt-5.5",
        };
      }),
    });

    await expect(adapter.execute(baseInput, baseContext)).rejects.toMatchObject(
      {
        code: "provider_error",
        message: expect.stringContaining(
          '"stderr":"unsupported model: gpt-5.5"',
        ),
      },
    );
  });

  test("fails before creating a runner when auth preflight fails", async () => {
    const createRunner = vi.fn(() => makeCodexRunnerFixture().createRunner());
    const checkAuthPreflight = vi.fn(async () => {
      throw new AdapterExecutionError(
        "policy_blocked",
        "codex-agent authentication is unavailable: login required",
      );
    });
    const adapter = new CodexAgentAdapter({
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
        timeoutMs: 5000,
      }),
    );
    expect(createRunner).not.toHaveBeenCalled();
  });

  test("allows auth preflight to be disabled", async () => {
    const fixture = makeCodexRunnerFixture();
    const checkAuthPreflight = vi.fn(async () => {
      throw new AdapterExecutionError(
        "policy_blocked",
        "codex-agent authentication is unavailable",
      );
    });
    const adapter = new CodexAgentAdapter({
      createRunner: fixture.createRunner,
      checkAuthPreflight,
      authPreflight: false,
    });

    await expect(
      adapter.execute(baseInput, baseContext),
    ).resolves.toMatchObject({
      provider: "codex-agent",
    });
    expect(checkAuthPreflight).not.toHaveBeenCalled();
    expect(fixture.createRunner).toHaveBeenCalledTimes(1);
  });
});
