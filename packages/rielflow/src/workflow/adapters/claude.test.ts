import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MockClaudeRunningSession,
  createMockClaudeSessionRunner,
} from "claude-code-agent/sdk/testing";
import { withProcessEnvOverride } from "../../../../rielflow-adapters/src/local-agent";
import { AdapterExecutionError } from "../adapter";
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

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-claude-adapter-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writeExecutable(filePath: string, body: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${body}\n`, { mode: 0o755 });
}

async function waitForTextFile(filePath: string): Promise<string> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  return await readFile(filePath, "utf8");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function claudeAssistantText(text: string): object {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

function makeClaudeRunnerFixture(
  input: {
    readonly sessionId?: string;
    readonly messages?: readonly object[];
    readonly success?: boolean;
  } = {},
) {
  const sessionId = input.sessionId ?? "claude-session-1";
  const messages = input.messages ?? [
    claudeAssistantText("local claude reply"),
  ];
  const session = new MockClaudeRunningSession({
    sessionId,
    messages,
    result: {
      success: input.success ?? true,
      startedAt: "2026-03-30T00:00:00.000Z",
      completedAt: "2026-03-30T00:00:01.000Z",
      toolCallCount: 0,
      messageCount: messages.length,
    },
  });
  const runner = createMockClaudeSessionRunner({
    startSessions: [session],
    resumeSessions: [session],
  });
  const startSession = vi.spyOn(runner, "startSession");
  const resumeSession = vi.spyOn(runner, "resumeSession");
  const createRunner = vi.fn(() => runner);

  return {
    createRunner,
    startSession,
    resumeSession,
  };
}

describe("ClaudeCodeAgentAdapter", () => {
  test("removes blocked worker env even without replacement env", async () => {
    const priorMailboxDir = process.env["RIEL_MAILBOX_DIR"];
    process.env["RIEL_MAILBOX_DIR"] = "/tmp/legacy-mailbox";
    let observedMailboxDir: string | undefined;
    try {
      await withProcessEnvOverride(undefined, async () => {
        observedMailboxDir = process.env["RIEL_MAILBOX_DIR"];
      });
    } finally {
      if (priorMailboxDir === undefined) {
        delete process.env["RIEL_MAILBOX_DIR"];
      } else {
        process.env["RIEL_MAILBOX_DIR"] = priorMailboxDir;
      }
    }

    expect(observedMailboxDir).toBeUndefined();
    expect(process.env["RIEL_MAILBOX_DIR"]).toBe(priorMailboxDir);
  });

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
    expect(output.llmMessages).toEqual([
      expect.objectContaining({
        ordinal: 1,
        eventType: "assistant",
        role: "assistant",
        contentText: "local claude reply",
        backendSessionId: "claude-session-1",
      }),
    ]);
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

  test("forwards node effort to the Claude runner", async () => {
    const fixture = makeClaudeRunnerFixture();
    const adapter = new ClaudeCodeAgentAdapter({
      createRunner: fixture.createRunner,
    });

    const output = await adapter.execute(
      {
        ...baseInput,
        node: {
          ...baseInput.node,
          effort: "xhigh",
        },
      },
      baseContext,
    );

    expect(output.effort).toBe("xhigh");
    expect(fixture.createRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4-1",
        effort: "xhigh",
      }),
    );
  });

  test("forwards image attachments discovered in workflow input", async () => {
    const fixture = makeClaudeRunnerFixture();
    const adapter = new ClaudeCodeAgentAdapter({
      createRunner: fixture.createRunner,
    });

    await adapter.execute(
      {
        ...baseInput,
        systemPromptText: "system",
        mergedVariables: {
          workflowInput: {
            imagePaths: ["/tmp/photo-a.png"],
            attachments: [
              {
                kind: "image",
                mediaType: "image/jpeg",
                localPath: "/tmp/photo-b.jpg",
              },
            ],
          },
        },
      },
      baseContext,
    );

    expect(fixture.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          { path: "/tmp/photo-a.png" },
          { path: "/tmp/photo-b.jpg" },
        ],
      }),
    );
  });

  test("reuses backend sessions for local execution", async () => {
    const fixture = makeClaudeRunnerFixture({
      sessionId: "backend-claude-1",
      messages: [claudeAssistantText('{"summary":"ok"}')],
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
            messageWrite: "runtime-only-after-validation",
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
      undefined,
    );
    expect(output.payload).toEqual({ summary: "ok" });
    expect(output.backendSession?.sessionId).toBe("backend-claude-1");
  });

  test("nudges and completes from a stalled SDK session", async () => {
    const primarySession = new MockClaudeRunningSession({
      sessionId: "claude-stall-1",
      autoComplete: false,
    });
    const nudgedSession = new MockClaudeRunningSession({
      sessionId: "claude-stall-1",
      messages: [claudeAssistantText("resumed claude reply")],
      result: {
        success: true,
        startedAt: "2026-03-30T00:00:01.000Z",
        completedAt: "2026-03-30T00:00:02.000Z",
        toolCallCount: 0,
        messageCount: 1,
      },
    });
    const runner = createMockClaudeSessionRunner({
      startSessions: [primarySession],
      resumeSessions: [nudgedSession],
    });
    const resumeSession = vi.spyOn(runner, "resumeSession");
    const adapter = new ClaudeCodeAgentAdapter({
      createRunner: vi.fn(() => runner),
      stallCheckIntervalMs: 5,
      stallNudgeMaxAttempts: 1,
      stallNudgePrompt: "continue now",
    });

    const output = await adapter.execute(baseInput, {
      ...baseContext,
      timeoutMs: 1000,
    });

    primarySession.complete({ success: false });
    expect(resumeSession).toHaveBeenCalledWith(
      "claude-stall-1",
      "continue now",
      undefined,
      undefined,
    );
    expect(output.payload).toEqual({ text: "resumed claude reply" });
    expect(output.processLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "claude-code-agent-stall-watch",
          text: expect.stringContaining("sending stall nudge"),
        }),
      ]),
    );
  });

  test("passes ambient manager env into the local runner", async () => {
    const fixture = makeClaudeRunnerFixture();
    const adapter = new ClaudeCodeAgentAdapter({
      createRunner: fixture.createRunner,
    });

    await adapter.execute(
      {
        ...baseInput,
        rielflowHookContext: {
          environment: {
            RIEL_WORKFLOW_ID: "wf",
            RIEL_WORKFLOW_EXECUTION_ID: "sess-1",
            RIEL_NODE_ID: "node-1",
            RIEL_NODE_EXEC_ID: "exec-1",
            RIEL_AGENT_BACKEND: "claude-code-agent",
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

    expect(fixture.createRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          RIEL_GRAPHQL_ENDPOINT: "http://127.0.0.1:43173/graphql",
          RIEL_WORKFLOW_EXECUTION_ID: "sess-1",
          RIEL_NODE_EXEC_ID: "exec-1",
        }),
      }),
    );
  });

  test("maps invalid structured output to invalid_output", async () => {
    const fixture = makeClaudeRunnerFixture({
      messages: [claudeAssistantText("not json")],
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
    const createRunner = vi.fn(() => makeClaudeRunnerFixture().createRunner());
    const checkAuthPreflight = vi.fn(async () => {
      throw new AdapterExecutionError(
        "policy_blocked",
        "claude-code-agent authentication is unavailable: login required",
      );
    });
    const adapter = new ClaudeCodeAgentAdapter({
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
    const fixture = makeClaudeRunnerFixture();
    const checkAuthPreflight = vi.fn(async () => {
      throw new AdapterExecutionError(
        "policy_blocked",
        "claude-code-agent authentication is unavailable",
      );
    });
    const adapter = new ClaudeCodeAgentAdapter({
      createRunner: fixture.createRunner,
      checkAuthPreflight,
      authPreflight: false,
    });

    await expect(
      adapter.execute(baseInput, baseContext),
    ).resolves.toMatchObject({
      provider: "claude-code-agent",
    });
    expect(checkAuthPreflight).not.toHaveBeenCalled();
    expect(fixture.createRunner).toHaveBeenCalledTimes(1);
  });

  test("default print mode forwards attachments in prompt and add-dir args", async () => {
    const root = await makeTempDir();
    const binDir = path.join(root, "bin");
    const projectDir = path.join(root, "project");
    const capturePath = path.join(root, "capture.json");
    await mkdir(projectDir, { recursive: true });
    await writeExecutable(
      path.join(binDir, "claude"),
      [
        "#!/usr/bin/env node",
        "const fs = require('fs');",
        "const args = process.argv.slice(2);",
        "const stdin = fs.readFileSync(0, 'utf8');",
        "if (args[0] === '--version') { console.log('2.1.149 (Claude Code)'); process.exit(0); }",
        "if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }",
        `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ args, cwd: process.cwd(), stdin, mailboxDir: process.env.RIEL_MAILBOX_DIR }));`,
        "console.log('print mode reply');",
      ].join("\n"),
    );

    const adapter = new ClaudeCodeAgentAdapter({
      cwd: projectDir,
      env: {
        PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      },
    });
    const priorMailboxDir = process.env["RIEL_MAILBOX_DIR"];
    process.env["RIEL_MAILBOX_DIR"] = path.join(root, "legacy-mailbox");
    let output: Awaited<ReturnType<ClaudeCodeAgentAdapter["execute"]>>;
    try {
      output = await adapter.execute(
        {
          ...baseInput,
          systemPromptText: "system",
          mergedVariables: {
            workflowInput: {
              imagePaths: [path.join(root, "photo-a.png")],
              attachments: [
                {
                  kind: "image",
                  mediaType: "image/jpeg",
                  localPath: path.join(root, "nested", "photo-b.jpg"),
                },
              ],
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

    const capture = JSON.parse(await readFile(capturePath, "utf8")) as {
      args: string[];
      cwd: string;
      stdin: string;
      mailboxDir?: string;
    };
    expect(output.payload).toEqual({ text: "print mode reply" });
    expect(capture.cwd).toBe(await realpath(projectDir));
    expect(capture.mailboxDir).toBeUndefined();
    expect(capture.args).toEqual(
      expect.arrayContaining([
        "-p",
        "--output-format",
        "text",
        "--model",
        "claude-opus-4-1",
        "--add-dir",
        root,
        "--add-dir",
        path.join(root, "nested"),
      ]),
    );
    expect(capture.args).not.toContain("hello");
    expect(capture.args).not.toContain("system");
    expect(capture.args).not.toContain("--system-prompt");
    const prompt = capture.stdin;
    expect(prompt).toContain("hello");
    expect(prompt).toContain("system");
    expect(prompt).toContain("Attached files:");
    expect(prompt).toContain(path.join(root, "photo-a.png"));
    expect(prompt).toContain(path.join(root, "nested", "photo-b.jpg"));
  });

  test("default print mode waits for aborted subprocess cleanup", async () => {
    const root = await makeTempDir();
    const binDir = path.join(root, "bin");
    const projectDir = path.join(root, "project");
    const pidPath = path.join(root, "claude.pid");
    await mkdir(projectDir, { recursive: true });
    await writeExecutable(
      path.join(binDir, "claude"),
      [
        "#!/usr/bin/env bash",
        'if [[ "$1" == "--version" ]]; then echo "2.1.149 (Claude Code)"; exit 0; fi',
        'if [[ "$1 $2" == "auth status" ]]; then echo \'{"loggedIn":true}\'; exit 0; fi',
        `echo $$ > ${JSON.stringify(pidPath)}`,
        "trap '' TERM",
        "sleep 30",
      ].join("\n"),
    );

    const controller = new AbortController();
    const adapter = new ClaudeCodeAgentAdapter({
      authPreflight: false,
      cwd: projectDir,
      env: {
        PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      },
    });
    const execution = adapter.execute(baseInput, {
      ...baseContext,
      signal: controller.signal,
    });
    const pid = Number.parseInt(await waitForTextFile(pidPath), 10);
    controller.abort();

    await expect(execution).rejects.toMatchObject({
      code: "timeout",
      message: "claude adapter aborted",
    });
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
