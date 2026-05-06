import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AdapterExecutionError } from "./adapter";
import { executeNativeNode } from "./native-node-executor";
import { ok } from "./result";
import type { SuperviserRuntimeControl } from "./superviser-control";
import type { ChatReplyDispatchRequest } from "./types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-native-node-executor-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function writeReportCwdScript(
  workflowDirectory: string,
  relativeDirectory = "scripts",
  fileName = "report-cwd.sh",
): Promise<string> {
  const scriptDirectory = path.join(workflowDirectory, relativeDirectory);
  await mkdir(scriptDirectory, { recursive: true });
  const scriptPath = path.join(scriptDirectory, fileName);
  await writeFile(
    scriptPath,
    [
      "#!/bin/sh",
      'mkdir -p "$DIVEDRA_MAILBOX_DIR/outbox"',
      `printf '{"cwd":"%s"}\n' "$PWD" > "$DIVEDRA_MAILBOX_DIR/outbox/output.json"`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );
  return path.join(relativeDirectory, fileName);
}

function readPayloadCwd(payload: Readonly<Record<string, unknown>>): string {
  const cwd = payload["cwd"];
  if (typeof cwd !== "string") {
    throw new Error("native node test payload did not include a string cwd");
  }
  return cwd;
}

async function expectPayloadCwd(
  payload: Readonly<Record<string, unknown>>,
  expectedPath: string,
): Promise<void> {
  expect(await realpath(readPayloadCwd(payload))).toBe(
    await realpath(expectedPath),
  );
}

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with ${exitCode}: ${stderr}`,
    );
  }
  return stdout;
}

async function createGitRepository(
  root: string,
): Promise<{ readonly repo: string; readonly remote: string }> {
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  await mkdir(repo, { recursive: true });
  await runGit(root, ["init", "--bare", remote]);
  await runGit(root, ["init", repo]);
  await runGit(repo, ["config", "user.name", "Divedra Test"]);
  await runGit(repo, ["config", "user.email", "divedra-test@example.test"]);
  await runGit(repo, ["remote", "add", "origin", remote]);
  await writeFile(path.join(repo, "README.md"), "initial\n", "utf8");
  await runGit(repo, ["add", "README.md"]);
  await runGit(repo, ["commit", "-m", "initial"]);
  await runGit(repo, ["push", "-u", "origin", "HEAD:main"]);
  return { repo, remote };
}

function makeExecutionMailbox() {
  return {
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
        reason: "Report cwd.",
        expectedReturn: "Return JSON.",
        instruction: "report cwd",
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
      arguments: {},
      upstream: [],
    },
  } as const;
}

describe("executeNativeNode", () => {
  test("runs built-in git commit add-on against explicit committed files", async () => {
    const workflowDirectory = await makeTempDir();
    const { repo } = await createGitRepository(workflowDirectory);
    const artifactDir = path.join(workflowDirectory, "artifacts", "git-commit");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(repo, "README.md"), "changed\n", "utf8");

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory: repo,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "git-commit",
        nodeExecId: "exec-1",
        node: {
          id: "git-commit",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "divedra/git-commit",
            version: "1",
            config: {
              commitMessageTemplate:
                "{{inbox.latest.output.payload.commitMessage}}",
              committedFilesTemplate:
                "{{inbox.latest.output.payload.committedFiles}}",
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir,
        executionMailbox: {
          ...makeExecutionMailbox(),
          input: {
            arguments: {},
            upstream: [
              {
                fromNodeId: "summary",
                transitionWhen: "always",
                communicationId: "comm-git-commit",
                output: {
                  payload: {
                    commitMessage: "test: update readme",
                    committedFiles: ["README.md"],
                  },
                },
              },
            ],
          },
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe("native-addon:git-commit");
    expect(output.when).toEqual({ always: true });
    expect(output.payload).toMatchObject({
      commitStatus: "committed",
      commitMessage: "test: update readme",
      committedFiles: ["README.md"],
      git: {
        status: "committed",
        commitMessage: "test: update readme",
        committedFiles: ["README.md"],
      },
    });
    expect(output.payload["commitHash"]).toEqual(
      (await runGit(repo, ["rev-parse", "HEAD"])).trim(),
    );
  });

  test("composes built-in git commit and git push add-ons with configured target branch", async () => {
    const workflowDirectory = await makeTempDir();
    const { repo, remote } = await createGitRepository(workflowDirectory);
    const commitArtifactDir = path.join(
      workflowDirectory,
      "artifacts",
      "git-commit-for-push",
    );
    const pushArtifactDir = path.join(workflowDirectory, "artifacts", "git-push");
    await mkdir(commitArtifactDir, { recursive: true });
    await mkdir(pushArtifactDir, { recursive: true });
    await writeFile(path.join(repo, "README.md"), "pushed\n", "utf8");

    const commitOutput = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory: repo,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "git-commit",
        nodeExecId: "exec-1",
        node: {
          id: "git-commit",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "divedra/git-commit",
            version: "1",
            config: {
              commitMessageTemplate:
                "{{inbox.latest.output.payload.commitMessage}}",
              committedFilesTemplate:
                "{{inbox.latest.output.payload.committedFiles}}",
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir: commitArtifactDir,
        executionMailbox: {
          ...makeExecutionMailbox(),
          input: {
            arguments: {},
            upstream: [
              {
                fromNodeId: "summary",
                transitionWhen: "always",
                communicationId: "comm-git-commit",
                output: {
                  payload: {
                    commitMessage: "test: push readme",
                    committedFiles: ["README.md"],
                  },
                },
              },
            ],
          },
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory: repo,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "git-push",
        nodeExecId: "exec-2",
        node: {
          id: "git-push",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "divedra/git-push",
            version: "1",
            config: {
              branchTemplate: "release/test-branch",
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir: pushArtifactDir,
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(commitOutput.provider).toBe("native-addon:git-commit");
    expect(output.provider).toBe("native-addon:git-push");
    expect(output.payload).toMatchObject({
      pushStatus: "pushed",
      pushedRemote: "origin",
      pushedBranch: "release/test-branch",
      git: {
        status: "pushed",
        pushedRemote: "origin",
        pushedBranch: "release/test-branch",
      },
    });
    expect(output.payload["commitHash"]).toEqual(
      (await runGit(repo, ["rev-parse", "HEAD"])).trim(),
    );
    expect(
      (await runGit(remote, ["rev-parse", "refs/heads/release/test-branch"]))
        .trim()
        .length,
    ).toBeGreaterThan(0);
  });

  test("renders built-in chat reply add-on output from inbox and event target", async () => {
    const workflowDirectory = await makeTempDir();
    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory: workflowDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "reply",
        nodeExecId: "exec-1",
        node: {
          id: "reply",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "divedra/chat-reply-worker",
            version: "1",
            config: {
              textTemplate: "Reply: {{inbox.latest.output.payload.text}}",
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {
          event: {
            sourceId: "web-chat",
            provider: "web-chat",
            eventId: "evt-1",
            conversation: { id: "conv-1", threadId: "thread-1" },
          },
        },
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "reply"),
        executionMailbox: {
          ...makeExecutionMailbox(),
          input: {
            arguments: {},
            upstream: [
              {
                fromNodeId: "answer",
                transitionWhen: "always",
                communicationId: "comm-1",
                output: {
                  payload: {
                    text: "done",
                  },
                },
              },
            ],
          },
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe("native-addon");
    expect(output.model).toBe("divedra/chat-reply-worker@1");
    expect(output.when).toMatchObject({ replied: true });
    expect(output.payload).toMatchObject({
      reply: {
        status: "intent-only",
        target: {
          sourceId: "web-chat",
          provider: "web-chat",
          eventId: "evt-1",
          conversationId: "conv-1",
          threadId: "thread-1",
        },
        message: {
          text: "Reply: done",
        },
        idempotencyKey: "chat-reply:wf:sess-1:reply:exec-1",
      },
    });
  });

  test("fails chat reply add-on execution when target is missing by default", async () => {
    const workflowDirectory = await makeTempDir();
    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory: workflowDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "reply",
          nodeExecId: "exec-1",
          node: {
            id: "reply",
            nodeType: "addon",
            variables: {},
            addon: {
              name: "divedra/chat-reply-worker",
              version: "1",
              config: {
                textTemplate: "Reply text",
              },
            },
          },
          workflowDefaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          runtimeVariables: {},
          mergedVariables: {},
          arguments: {},
          artifactDir: path.join(workflowDirectory, "artifacts", "reply"),
          executionMailbox: makeExecutionMailbox(),
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow(AdapterExecutionError);
  });

  test("routes nested superviser control add-ons through the native executor with a stable provider id", async () => {
    const workflowDirectory = await makeTempDir();
    const superviserControl: SuperviserRuntimeControl = {
      auth: {
        supervisionRunId: "sup-1",
        targetSessionId: "target-session-1",
      },
      startTargetWorkflow: async (input) => {
        expect(input).toEqual({
          workflowId: "target-workflow",
          runtimeVariables: { attempt: 2 },
        });
        return ok({
          sessionId: "target-session-1",
          status: "running",
        });
      },
      getWorkflowStatus: async () => {
        throw new Error("unexpected getWorkflowStatus call");
      },
      getWorkflowExecutionDetails: async () => {
        throw new Error("unexpected getWorkflowExecutionDetails call");
      },
      rerunTargetWorkflow: async () => {
        throw new Error("unexpected rerunTargetWorkflow call");
      },
      loadWorkflowDefinition: async () => {
        throw new Error("unexpected loadWorkflowDefinition call");
      },
      saveWorkflowDefinition: async () => {
        throw new Error("unexpected saveWorkflowDefinition call");
      },
    };

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory: workflowDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "superviser-wf",
        workflowDescription: "nested superviser workflow",
        workflowExecutionId: "sup-session-1",
        nodeId: "start-target",
        nodeExecId: "exec-1",
        node: {
          id: "start-target",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "divedra/start-workflow",
            version: "1",
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {
          supervisionRunId: "sup-1",
          targetSessionId: "target-session-1",
          workflowId: "target-workflow",
          runtimeVariables: { attempt: 2 },
        },
        artifactDir: path.join(workflowDirectory, "artifacts", "start-target"),
        executionMailbox: makeExecutionMailbox(),
        superviserControl,
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe(
      "native-addon:superviser-control/start-workflow",
    );
    expect(output.model).toBe("divedra/start-workflow");
    expect(output.payload).toEqual({
      superviser: {
        sessionId: "target-session-1",
        status: "running",
      },
    });
  });

  test("rejects superviser control add-ons outside nested superviser execution", async () => {
    const workflowDirectory = await makeTempDir();

    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory: workflowDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "superviser-wf",
          workflowDescription: "nested superviser workflow",
          workflowExecutionId: "sup-session-1",
          nodeId: "status-target",
          nodeExecId: "exec-1",
          node: {
            id: "status-target",
            nodeType: "addon",
            variables: {},
            addon: {
              name: "divedra/get-workflow-status",
              version: "1",
            },
          },
          workflowDefaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          runtimeVariables: {},
          mergedVariables: {},
          arguments: {
            supervisionRunId: "sup-1",
            targetSessionId: "target-session-1",
            sessionId: "target-session-1",
          },
          artifactDir: path.join(
            workflowDirectory,
            "artifacts",
            "status-target",
          ),
          executionMailbox: makeExecutionMailbox(),
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "policy_blocked",
      message: expect.stringContaining(
        "requires nested superviser runtime control",
      ),
    } satisfies Partial<AdapterExecutionError>);
  });

  test("dispatches built-in chat reply add-on when a dispatcher is available", async () => {
    const workflowDirectory = await makeTempDir();
    const dispatched: ChatReplyDispatchRequest[] = [];
    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory: workflowDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "reply",
        nodeExecId: "exec-1",
        node: {
          id: "reply",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "divedra/chat-reply-worker",
            version: "1",
            config: {
              textTemplate: "Reply text",
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {
          event: {
            sourceId: "web-chat",
            provider: "webhook",
            eventId: "evt-1",
            conversation: { id: "conv-1" },
          },
        },
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "reply"),
        executionMailbox: makeExecutionMailbox(),
        chatReplyDispatcher: {
          async dispatchChatReply(request) {
            dispatched.push(request);
            return {
              status: "sent",
              provider: "webhook",
              dispatchId: "dispatch-1",
              providerMessageId: "message-1",
            };
          },
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      target: {
        sourceId: "web-chat",
        provider: "webhook",
        eventId: "evt-1",
        conversationId: "conv-1",
      },
      message: { text: "Reply text" },
      idempotencyKey: "chat-reply:wf:sess-1:reply:exec-1",
    });
    expect(output.payload).toMatchObject({
      reply: {
        status: "sent",
        dispatch: {
          provider: "webhook",
          status: "sent",
          dispatchId: "dispatch-1",
          providerMessageId: "message-1",
        },
      },
    });
  });

  test("defaults command cwd to the workflow execution working directory", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptPath = await writeReportCwdScript(workflowDirectory);

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "node-1",
        nodeExecId: "exec-1",
        node: {
          id: "node-1",
          nodeType: "command",
          variables: {},
          command: {
            scriptPath,
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "node-1"),
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    await expectPayloadCwd(output.payload, workflowWorkingDirectory);
  });

  test("returns command stdout and stderr as process log attachments", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptDirectory = path.join(workflowDirectory, "scripts");
    await mkdir(scriptDirectory, { recursive: true });
    await writeFile(
      path.join(scriptDirectory, "write-logs.sh"),
      [
        "#!/bin/sh",
        'echo "native stdout line"',
        'echo "native stderr line" >&2',
        'mkdir -p "$DIVEDRA_MAILBOX_DIR/outbox"',
        `printf '{"summary":"done"}\n' > "$DIVEDRA_MAILBOX_DIR/outbox/output.json"`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "node-1",
        nodeExecId: "exec-1",
        node: {
          id: "node-1",
          nodeType: "command",
          variables: {},
          command: {
            scriptPath: "scripts/write-logs.sh",
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "node-1"),
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.processLogs).toEqual([
      { stream: "stdout", text: "native stdout line\n" },
      { stream: "stderr", text: "native stderr line\n" },
    ]);
  });

  test("honors adapter envelopes written by command nodes", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptDirectory = path.join(workflowDirectory, "scripts");
    await mkdir(scriptDirectory, { recursive: true });
    await writeFile(
      path.join(scriptDirectory, "write-envelope.sh"),
      [
        "#!/bin/sh",
        'mkdir -p "$DIVEDRA_MAILBOX_DIR/outbox"',
        `printf '{"completionPassed":true,"when":{"needs_item":true},"payload":{"decision":"delegate"}}\n' > "$DIVEDRA_MAILBOX_DIR/outbox/output.json"`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "node-1",
        nodeExecId: "exec-1",
        node: {
          id: "node-1",
          nodeType: "command",
          variables: {},
          command: {
            scriptPath: "scripts/write-envelope.sh",
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "node-1"),
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.completionPassed).toBe(true);
    expect(output.when).toEqual({ needs_item: true });
    expect(output.payload).toEqual({ decision: "delegate" });
  });

  test("attaches command logs to invalid mailbox output failures", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptDirectory = path.join(workflowDirectory, "scripts");
    await mkdir(scriptDirectory, { recursive: true });
    await writeFile(
      path.join(scriptDirectory, "missing-output.sh"),
      ["#!/bin/sh", 'echo "stdout before invalid output"', ""].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "node-1",
          nodeExecId: "exec-1",
          node: {
            id: "node-1",
            nodeType: "command",
            variables: {},
            command: {
              scriptPath: "scripts/missing-output.sh",
            },
          },
          workflowDefaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          runtimeVariables: {},
          mergedVariables: {},
          arguments: {},
          artifactDir: path.join(workflowDirectory, "artifacts", "node-1"),
          executionMailbox: makeExecutionMailbox(),
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "invalid_output",
      processLogs: [
        { stream: "stdout", text: "stdout before invalid output\n" },
      ],
    } satisfies Partial<AdapterExecutionError>);
  });

  test("attaches and writes command logs for non-zero exits", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "node-1");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptDirectory = path.join(workflowDirectory, "scripts");
    await mkdir(scriptDirectory, { recursive: true });
    await writeFile(
      path.join(scriptDirectory, "fail.sh"),
      [
        "#!/bin/sh",
        'echo "stdout before failure"',
        'echo "stderr before failure" >&2',
        "exit 2",
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "node-1",
          nodeExecId: "exec-1",
          node: {
            id: "node-1",
            nodeType: "command",
            variables: {},
            command: {
              scriptPath: "scripts/fail.sh",
            },
          },
          workflowDefaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          runtimeVariables: {},
          mergedVariables: {},
          arguments: {},
          artifactDir,
          executionMailbox: makeExecutionMailbox(),
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "provider_error",
      processLogs: [
        { stream: "stdout", text: "stdout before failure\n" },
        { stream: "stderr", text: "stderr before failure\n" },
      ],
    } satisfies Partial<AdapterExecutionError>);

    await expect(
      readFile(path.join(artifactDir, "stdout.log"), "utf8"),
    ).resolves.toBe("stdout before failure\n");
    await expect(
      readFile(path.join(artifactDir, "stderr.log"), "utf8"),
    ).resolves.toBe("stderr before failure\n");
  });

  test("keeps successful container build logs when the later run fails", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "node-1");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await mkdir(path.join(workflowDirectory, "container-context"), {
      recursive: true,
    });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'if [ "$1" = "build" ]; then',
        '  echo "build stdout"',
        '  echo "build stderr" >&2',
        "  exit 0",
        "fi",
        'if [ "$1" = "run" ]; then',
        '  echo "run stdout before failure"',
        '  echo "run stderr before failure" >&2',
        "  exit 2",
        "fi",
        "exit 64",
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "node-1",
          nodeExecId: "exec-1",
          node: {
            id: "node-1",
            nodeType: "container",
            variables: {},
            container: {
              runnerKind: "docker",
              runnerPath,
              build: {
                contextPath: "container-context",
              },
            },
          },
          workflowDefaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          runtimeVariables: {},
          mergedVariables: {},
          arguments: {},
          artifactDir,
          executionMailbox: makeExecutionMailbox(),
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "provider_error",
      processLogs: [
        { stream: "stdout", text: "build stdout\n", label: "build" },
        { stream: "stderr", text: "build stderr\n", label: "build" },
        { stream: "stdout", text: "run stdout before failure\n" },
        { stream: "stderr", text: "run stderr before failure\n" },
      ],
    } satisfies Partial<AdapterExecutionError>);
  });

  test("forwards only explicit workflow env into container processes", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "node-1");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    const capturedArgsPath = path.join(workflowDirectory, "runner-args.txt");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf "%s\\n" "$@" > "$CAPTURED_ARGS_PATH"',
        'mkdir -p "$DIVEDRA_TEST_MAILBOX_HOST/outbox"',
        `printf '{"summary":"done"}\n' > "$DIVEDRA_TEST_MAILBOX_HOST/outbox/output.json"`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "node-1",
        nodeExecId: "exec-1",
        node: {
          id: "node-1",
          nodeType: "container",
          variables: {
            explicitValue: "mapped",
          },
          container: {
            runnerKind: "docker",
            runnerPath,
            image: "example-image",
            envTemplate: {
              EXPLICIT_ENV: "{{explicitValue}}",
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir,
        executionMailbox: makeExecutionMailbox(),
        env: {
          CAPTURED_ARGS_PATH: capturedArgsPath,
          DIVEDRA_TEST_MAILBOX_HOST: path.join(artifactDir, "mailbox"),
          SHOULD_NOT_ENTER_CONTAINER: "host-secret",
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.payload).toEqual({ summary: "done" });
    const capturedArgs = await readFile(capturedArgsPath, "utf8");
    expect(capturedArgs).toContain("EXPLICIT_ENV=mapped");
    expect(capturedArgs).toContain("DIVEDRA_MAILBOX_DIR=/mailbox");
    expect(capturedArgs).not.toContain("SHOULD_NOT_ENTER_CONTAINER");
    expect(capturedArgs).not.toContain("host-secret");
  });

  test("runs x-gateway read add-on with mapped container env names", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "x-read");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    const capturedArgsPath = path.join(workflowDirectory, "runner-args.txt");
    const capturedEnvPath = path.join(workflowDirectory, "runner-env.txt");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf "%s\\n" "$@" > "$CAPTURED_ARGS_PATH"',
        'printf "X_GW_TOKEN=%s\\n" "$X_GW_TOKEN" > "$CAPTURED_ENV_PATH"',
        `printf '{"ok":true,"data":{"post":{"id":"123","text":"done"}}}\n'`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "x-read",
        nodeExecId: "exec-1",
        node: {
          id: "x-read",
          nodeType: "addon",
          variables: {
            postId: "123",
          },
          addon: {
            name: "divedra/x-gateway-read",
            version: "1",
            env: {
              X_GW_TOKEN: {
                fromEnv: "ACCOUNT_A_X_GW_TOKEN",
              },
              X_GW_CONFIG_MODE: {
                fromEnv: "OPTIONAL_CONFIG_MODE",
                required: false,
              },
            },
            config: {
              queryTemplate: '{ post(id: "{{postId}}") { id text } }',
              image: "example/x-gateway:latest",
              runnerKind: "docker",
              runnerPath,
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir,
        executionMailbox: makeExecutionMailbox(),
        env: {
          ACCOUNT_A_X_GW_TOKEN: "account-a-secret",
          CAPTURED_ARGS_PATH: capturedArgsPath,
          CAPTURED_ENV_PATH: capturedEnvPath,
          SHOULD_NOT_ENTER_CONTAINER: "host-secret",
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe("native-addon:x-gateway-read:docker");
    expect(output.payload).toEqual({
      xGateway: {
        ok: true,
        data: {
          post: {
            id: "123",
            text: "done",
          },
        },
      },
    });
    const capturedArgs = await readFile(capturedArgsPath, "utf8");
    expect(capturedArgs).toContain("run\n--rm\n");
    expect(capturedArgs).toContain("-e\nX_GW_TOKEN\n");
    expect(capturedArgs).toContain("example/x-gateway:latest\n");
    expect(capturedArgs).toContain('query\n{ post(id: "123") { id text } }\n');
    expect(capturedArgs).not.toContain("account-a-secret");
    expect(capturedArgs).not.toContain("SHOULD_NOT_ENTER_CONTAINER");
    const capturedEnv = await readFile(capturedEnvPath, "utf8");
    expect(capturedEnv).toBe("X_GW_TOKEN=account-a-secret\n");
  });

  test("runs x-gateway add-on with full client binary for post mutations", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "x-post");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    const capturedArgsPath = path.join(workflowDirectory, "runner-args.txt");
    const capturedEnvPath = path.join(workflowDirectory, "runner-env.txt");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf "%s\\n" "$@" > "$CAPTURED_ARGS_PATH"',
        'printf "X_GW_ACCESS_TOKEN=%s\\n" "$X_GW_ACCESS_TOKEN" > "$CAPTURED_ENV_PATH"',
        `printf '{"ok":true,"data":{"createPost":{"id":"post-1","text":"hello"}}}\n'`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "x-post",
        nodeExecId: "exec-1",
        node: {
          id: "x-post",
          nodeType: "addon",
          variables: {
            postText: "hello",
          },
          addon: {
            name: "divedra/x-gateway",
            version: "1",
            env: {
              X_GW_ACCESS_TOKEN: {
                fromEnv: "ACCOUNT_A_X_GW_ACCESS_TOKEN",
              },
            },
            config: {
              documentTemplate:
                'mutation { createPost(text: "{{postText}}") { id text } }',
              image: "example/x-gateway:latest",
              runnerKind: "docker",
              runnerPath,
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir,
        executionMailbox: makeExecutionMailbox(),
        env: {
          ACCOUNT_A_X_GW_ACCESS_TOKEN: "access-secret",
          CAPTURED_ARGS_PATH: capturedArgsPath,
          CAPTURED_ENV_PATH: capturedEnvPath,
          SHOULD_NOT_ENTER_CONTAINER: "host-secret",
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe("native-addon:x-gateway:docker");
    expect(output.payload).toEqual({
      xGateway: {
        ok: true,
        data: {
          createPost: {
            id: "post-1",
            text: "hello",
          },
        },
      },
    });
    const capturedArgs = await readFile(capturedArgsPath, "utf8");
    expect(capturedArgs).toContain("example/x-gateway:latest\nx-gateway\n");
    expect(capturedArgs).toContain(
      'query\nmutation { createPost(text: "hello") { id text } }\n',
    );
    expect(capturedArgs).not.toContain("x-gateway-reader");
    expect(capturedArgs).not.toContain("access-secret");
    expect(capturedArgs).not.toContain("SHOULD_NOT_ENTER_CONTAINER");
    const capturedEnv = await readFile(capturedEnvPath, "utf8");
    expect(capturedEnv).toBe("X_GW_ACCESS_TOKEN=access-secret\n");
  });

  test("runs mail-gateway read add-on with mapped container env names", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "mail-read");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    const capturedArgsPath = path.join(workflowDirectory, "runner-args.txt");
    const capturedEnvPath = path.join(workflowDirectory, "runner-env.txt");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf "%s\\n" "$@" > "$CAPTURED_ARGS_PATH"',
        'printf "MAIL_GATEWAY_CONFIG=%s\\n" "$MAIL_GATEWAY_CONFIG" > "$CAPTURED_ENV_PATH"',
        `printf '{"data":{"message":{"id":"msg-1","subject":"hello"}}}\n'`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "mail-read",
        nodeExecId: "exec-1",
        node: {
          id: "mail-read",
          nodeType: "addon",
          variables: {
            accountId: "work",
            messageId: "msg-1",
          },
          addon: {
            name: "divedra/mail-gateway-read",
            version: "1",
            env: {
              MAIL_GATEWAY_CONFIG: {
                fromEnv: "ACCOUNT_A_MAIL_GATEWAY_CONFIG",
              },
              MAIL_GATEWAY_LOG: {
                fromEnv: "OPTIONAL_MAIL_GATEWAY_LOG",
                required: false,
              },
            },
            config: {
              queryTemplate:
                '{ message(accountId: "{{accountId}}", messageId: "{{messageId}}") { id subject } }',
              image: "example/mail-gateway:latest",
              runnerKind: "docker",
              runnerPath,
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir,
        executionMailbox: makeExecutionMailbox(),
        env: {
          ACCOUNT_A_MAIL_GATEWAY_CONFIG: "/configs/account-a.toml",
          CAPTURED_ARGS_PATH: capturedArgsPath,
          CAPTURED_ENV_PATH: capturedEnvPath,
          SHOULD_NOT_ENTER_CONTAINER: "host-secret",
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe("native-addon:mail-gateway-read:docker");
    expect(output.payload).toEqual({
      mailGateway: {
        data: {
          message: {
            id: "msg-1",
            subject: "hello",
          },
        },
      },
    });
    const capturedArgs = await readFile(capturedArgsPath, "utf8");
    expect(capturedArgs).toContain("run\n--rm\n");
    expect(capturedArgs).toContain("-e\nMAIL_GATEWAY_CONFIG\n");
    expect(capturedArgs).toContain("example/mail-gateway:latest\n");
    expect(capturedArgs).toContain("mail-gateway-reader\ngraphql\n--query\n");
    expect(capturedArgs).toContain(
      '{ message(accountId: "work", messageId: "msg-1") { id subject } }\n',
    );
    expect(capturedArgs).not.toContain("/configs/account-a.toml");
    expect(capturedArgs).not.toContain("SHOULD_NOT_ENTER_CONTAINER");
    const capturedEnv = await readFile(capturedEnvPath, "utf8");
    expect(capturedEnv).toBe("MAIL_GATEWAY_CONFIG=/configs/account-a.toml\n");
  });

  test("runs mail-gateway add-on with full client binary for send mutations", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "mail-send");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    const capturedArgsPath = path.join(workflowDirectory, "runner-args.txt");
    const capturedEnvPath = path.join(workflowDirectory, "runner-env.txt");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf "%s\\n" "$@" > "$CAPTURED_ARGS_PATH"',
        'printf "MAIL_GATEWAY_CONFIG=%s\\n" "$MAIL_GATEWAY_CONFIG" > "$CAPTURED_ENV_PATH"',
        `printf '{"data":{"sendMessage":{"message":{"id":"sent-1","subject":"hello"}}}}\n'`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "mail-send",
        nodeExecId: "exec-1",
        node: {
          id: "mail-send",
          nodeType: "addon",
          variables: {
            accountId: "work",
            to: "person@example.test",
            subject: "hello",
            body: "body",
          },
          addon: {
            name: "divedra/mail-gateway",
            version: "1",
            env: {
              MAIL_GATEWAY_CONFIG: {
                fromEnv: "ACCOUNT_A_MAIL_GATEWAY_CONFIG",
              },
            },
            config: {
              documentTemplate:
                'mutation { sendMessage(input: { accountId: "{{accountId}}", to: ["{{to}}"], subject: "{{subject}}", textBody: "{{body}}" }) { message { id subject } } }',
              image: "example/mail-gateway:latest",
              runnerKind: "docker",
              runnerPath,
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir,
        executionMailbox: makeExecutionMailbox(),
        env: {
          ACCOUNT_A_MAIL_GATEWAY_CONFIG: "/configs/account-a.toml",
          CAPTURED_ARGS_PATH: capturedArgsPath,
          CAPTURED_ENV_PATH: capturedEnvPath,
          SHOULD_NOT_ENTER_CONTAINER: "host-secret",
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe("native-addon:mail-gateway:docker");
    expect(output.payload).toEqual({
      mailGateway: {
        data: {
          sendMessage: {
            message: {
              id: "sent-1",
              subject: "hello",
            },
          },
        },
      },
    });
    const capturedArgs = await readFile(capturedArgsPath, "utf8");
    expect(capturedArgs).toContain(
      "example/mail-gateway:latest\nmail-gateway\ngraphql\n--query\n",
    );
    expect(capturedArgs).toContain(
      'mutation { sendMessage(input: { accountId: "work", to: ["person@example.test"], subject: "hello", textBody: "body" }) { message { id subject } } }\n',
    );
    expect(capturedArgs).not.toContain("mail-gateway-reader");
    expect(capturedArgs).not.toContain("/configs/account-a.toml");
    expect(capturedArgs).not.toContain("SHOULD_NOT_ENTER_CONTAINER");
    const capturedEnv = await readFile(capturedEnvPath, "utf8");
    expect(capturedEnv).toBe("MAIL_GATEWAY_CONFIG=/configs/account-a.toml\n");
  });

  test("fails x-gateway read add-on before container execution when required mapped env is missing", async () => {
    const workflowDirectory = await makeTempDir();
    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory: workflowDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "x-read",
          nodeExecId: "exec-1",
          node: {
            id: "x-read",
            nodeType: "addon",
            variables: {},
            addon: {
              name: "divedra/x-gateway-read",
              version: "1",
              env: {
                X_GW_TOKEN: {
                  fromEnv: "MISSING_X_GW_TOKEN",
                },
              },
              config: {
                queryTemplate: "{ accountMe { id } }",
                runnerPath: "/definitely/missing/docker",
              },
            },
          },
          workflowDefaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          runtimeVariables: {},
          mergedVariables: {},
          arguments: {},
          artifactDir: path.join(workflowDirectory, "artifacts", "x-read"),
          executionMailbox: makeExecutionMailbox(),
          env: {},
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "provider_error",
      message: expect.stringContaining("MISSING_X_GW_TOKEN"),
    } satisfies Partial<AdapterExecutionError>);
  });

  test("fails x-gateway read add-on before container execution when required mapped env is empty", async () => {
    const workflowDirectory = await makeTempDir();
    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory: workflowDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "x-read",
          nodeExecId: "exec-1",
          node: {
            id: "x-read",
            nodeType: "addon",
            variables: {},
            addon: {
              name: "divedra/x-gateway-read",
              version: "1",
              env: {
                X_GW_TOKEN: {
                  fromEnv: "EMPTY_X_GW_TOKEN",
                },
              },
              config: {
                queryTemplate: "{ accountMe { id } }",
                runnerPath: "/definitely/missing/docker",
              },
            },
          },
          workflowDefaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          runtimeVariables: {},
          mergedVariables: {},
          arguments: {},
          artifactDir: path.join(workflowDirectory, "artifacts", "x-read"),
          executionMailbox: makeExecutionMailbox(),
          env: {
            EMPTY_X_GW_TOKEN: "",
          },
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "provider_error",
      message: expect.stringContaining("EMPTY_X_GW_TOKEN"),
    } satisfies Partial<AdapterExecutionError>);
  });

  test("resolves node-level relative working directory from the workflow working directory", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const nodeWorkingDirectory = path.join(
      workflowWorkingDirectory,
      "packages",
      "worker",
    );
    await mkdir(nodeWorkingDirectory, { recursive: true });
    const scriptPath = await writeReportCwdScript(workflowDirectory);

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "node-1",
        nodeExecId: "exec-1",
        node: {
          id: "node-1",
          nodeType: "command",
          workingDirectory: "packages/worker",
          variables: {},
          command: {
            scriptPath,
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "node-1"),
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    await expectPayloadCwd(output.payload, nodeWorkingDirectory);
  });

  test("honors command.workingDirectory when set on the native command", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const commandWorkingDirectory = path.join(
      workflowWorkingDirectory,
      "cmd-working-dir",
    );
    await mkdir(commandWorkingDirectory, { recursive: true });
    const scriptPath = await writeReportCwdScript(workflowDirectory);

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "node-1",
        nodeExecId: "exec-1",
        node: {
          id: "node-1",
          nodeType: "command",
          variables: {},
          command: {
            scriptPath,
            workingDirectory: "cmd-working-dir",
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "node-1"),
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    await expectPayloadCwd(output.payload, commandWorkingDirectory);
  });
});
