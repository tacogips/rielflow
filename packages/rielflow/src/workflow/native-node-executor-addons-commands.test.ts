import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AdapterExecutionError } from "./adapter";
import { validateJsonValueAgainstSchema } from "./json-schema";
import { executeNativeNode } from "./native-node-executor";
import { ok } from "./result";
import { CHAT_REPLY_WORKER_OUTPUT } from "../../../rielflow-addons/src/node-addons/addon-constants-and-agent-config";
import { buildContainerEnv } from "../../../rielflow-addons/src/native-node-executor/template-env-and-containers";
import type { SuperviserRuntimeControl } from "./superviser-control";
import type { ChatReplyDispatchRequest } from "./types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-native-node-executor-test-"),
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
    ["#!/bin/sh", `printf '{"cwd":"%s"}\n' "$PWD"`, ""].join("\n"),
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

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `git ${args.join(" ")} failed with ${String(exitCode)}: ${stderr}`,
        ),
      );
    });
  });
}

async function createGitRepository(
  root: string,
): Promise<{ readonly repo: string; readonly remote: string }> {
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  await mkdir(repo, { recursive: true });
  await runGit(root, ["init", "--bare", remote]);
  await runGit(root, ["init", repo]);
  await runGit(repo, ["config", "user.name", "Rielflow Test"]);
  await runGit(repo, ["config", "user.email", "rielflow-test@example.test"]);
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
      arguments: {},
      upstream: [],
    },
  } as const;
}

describe("executeNativeNode", () => {
  test("preserves explicitly rendered container env names", () => {
    const env = buildContainerEnv({
      renderedEnv: {
        EXPLICIT_ENV: "mapped",
        RIEL_MAILBOX_DIR: "/mailbox",
      },
      workflowId: "wf",
      workflowExecutionId: "sess-1",
      nodeId: "node-1",
      nodeExecId: "exec-1",
    });

    expect(env).toMatchObject({
      EXPLICIT_ENV: "mapped",
      RIEL_WORKFLOW_ID: "wf",
      RIEL_WORKFLOW_EXECUTION_ID: "sess-1",
      RIEL_NODE_ID: "node-1",
      RIEL_NODE_EXEC_ID: "exec-1",
      RIEL_MAILBOX_DIR: "/mailbox",
    });
  });

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
            name: "rielflow/git-commit",
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
    expect(output.payload["commitHash"]).toMatch(/^[0-9a-f]{40}$/);
  });

  test("resolves archived implementation plan paths before git commit", async () => {
    const workflowDirectory = await makeTempDir();
    const { repo } = await createGitRepository(workflowDirectory);
    const artifactDir = path.join(
      workflowDirectory,
      "artifacts",
      "git-commit-archived-plan",
    );
    await mkdir(path.join(repo, "impl-plans", "completed"), {
      recursive: true,
    });
    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      path.join(repo, "impl-plans", "completed", "fix-plan.md"),
      "# Fix Plan\n",
      "utf8",
    );

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
            name: "rielflow/git-commit",
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
                    commitMessage: "test: archive plan",
                    committedFiles: ["impl-plans/active/fix-plan.md"],
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

    expect(output.payload).toMatchObject({
      commitStatus: "committed",
      commitMessage: "test: archive plan",
      committedFiles: ["impl-plans/completed/fix-plan.md"],
    });
    await runGit(repo, [
      "cat-file",
      "-e",
      "HEAD:impl-plans/completed/fix-plan.md",
    ]);
  });

  test("rejects unresolved missing committed file paths before git add", async () => {
    const workflowDirectory = await makeTempDir();
    const { repo } = await createGitRepository(workflowDirectory);
    const artifactDir = path.join(
      workflowDirectory,
      "artifacts",
      "git-commit-ambiguous-path",
    );
    await mkdir(path.join(repo, "docs"), { recursive: true });
    await mkdir(path.join(repo, "notes"), { recursive: true });
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(repo, "docs", "fix-plan.md"), "docs\n", "utf8");
    await writeFile(path.join(repo, "notes", "fix-plan.md"), "notes\n", "utf8");

    await expect(
      executeNativeNode(
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
              name: "rielflow/git-commit",
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
                      commitMessage: "test: ambiguous plan",
                      committedFiles: ["plans/fix-plan.md"],
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
      ),
    ).rejects.toThrow(
      "could not resolve missing committedFiles path 'plans/fix-plan.md' to an existing, dirty, or tracked git path",
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
    const pushArtifactDir = path.join(
      workflowDirectory,
      "artifacts",
      "git-push",
    );
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
            name: "rielflow/git-commit",
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
            name: "rielflow/git-push",
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
    expect(output.payload["commitHash"]).toMatch(/^[0-9a-f]{40}$/);
    await runGit(remote, [
      "cat-file",
      "-e",
      "refs/heads/release/test-branch^{commit}",
    ]);
  });

  test("routes chat personas with provider-neutral built-in router", async () => {
    const workflowDirectory = await makeTempDir();
    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory: workflowDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "route",
        nodeExecId: "exec-1",
        node: {
          id: "route",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "rielflow/chat-persona-router",
            version: "1",
            config: {
              defaultPersonaId: "yui",
              personas: [
                { id: "yui", name: "Yui Codex", aliases: ["codex"] },
                { id: "mika", name: "Mika Trend", aliases: ["gyaru"] },
                { id: "rina", name: "Rina Cursor", aliases: ["cursor"] },
              ],
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {
          event: {
            provider: "telegram",
            input: {
              text: "Yui, give your view and ask Mika too",
            },
          },
        },
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "route"),
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe("native-addon");
    expect(output.model).toBe("rielflow/chat-persona-router@1");
    expect(output.when).toMatchObject({
      target_yui: true,
      target_mika: false,
      target_rina: false,
    });
    expect(output.payload).toMatchObject({
      target: "yui",
      target_yui: true,
      target_mika: false,
      target_rina: false,
    });
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
            name: "rielflow/chat-reply-worker",
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
    expect(output.model).toBe("rielflow/chat-reply-worker@1");
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

  test("renders built-in chat reply add-on output from event input replyTarget", async () => {
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
            name: "rielflow/chat-reply-worker",
            version: "1",
            config: {
              textTemplate: "Scheduled: {{workflowInput.replyText}}",
              replyAsTemplate: "yui",
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {
          workflowInput: {
            replyText: "19:05",
          },
          event: {
            sourceId: "time-signal-cron",
            provider: "cron",
            eventId: "tick-1",
            input: {
              replyTarget: {
                sourceId: "telegram-gateway-personas",
                provider: "telegram",
                eventId: "tick-1",
                conversationId: "-1001234567890",
              },
            },
          },
        },
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "reply"),
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.payload).toMatchObject({
      reply: {
        target: {
          sourceId: "telegram-gateway-personas",
          provider: "telegram",
          eventId: "tick-1",
          conversationId: "-1001234567890",
        },
        message: {
          text: "Scheduled: 19:05",
          replyAs: "yui",
        },
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
              name: "rielflow/chat-reply-worker",
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
            name: "rielflow/start-workflow",
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
    expect(output.model).toBe("rielflow/start-workflow");
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
              name: "rielflow/get-workflow-status",
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
            name: "rielflow/chat-reply-worker",
            version: "1",
            config: {
              textTemplate: "Reply text",
              replyAsTemplate: "{{event.input.persona}}",
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
            input: { persona: "mika" },
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
      message: { text: "Reply text", replyAs: "mika" },
      idempotencyKey: "chat-reply:wf:sess-1:reply:exec-1",
    });
    expect(output.payload).toMatchObject({
      reply: {
        status: "sent",
        message: { text: "Reply text", replyAs: "mika" },
        dispatch: {
          provider: "webhook",
          status: "sent",
          dispatchId: "dispatch-1",
          providerMessageId: "message-1",
        },
      },
    });
    expect(
      validateJsonValueAgainstSchema({
        schema: CHAT_REPLY_WORKER_OUTPUT.jsonSchema ?? {},
        value: output.payload,
      }),
    ).toEqual([]);
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

  test("passes resolved input JSON to command stdin", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const scriptDirectory = path.join(workflowDirectory, "scripts");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await mkdir(scriptDirectory, { recursive: true });
    const capturedStdinPath = path.join(
      workflowDirectory,
      "command-stdin.json",
    );
    await writeFile(
      path.join(scriptDirectory, "read-stdin.sh"),
      [
        "#!/bin/sh",
        'cat "$RIEL_RESOLVED_INPUT_PATH" > "$CAPTURED_STDIN_PATH"',
        `printf '{"summary":"done","resolvedInputPath":"%s"}\n' "$RIEL_RESOLVED_INPUT_PATH"`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const executionMailbox = {
      ...makeExecutionMailbox(),
      input: {
        arguments: { request: "from-arguments" },
        upstream: [
          {
            fromNodeId: "previous",
            transitionWhen: "always",
            communicationId: "comm-000001",
            output: { value: "from-upstream" },
          },
        ],
        latestOutputs: [
          {
            nodeId: "previous",
            nodeExecId: "exec-previous",
            status: "succeeded",
            artifactDir: "/tmp/previous",
            payload: { summary: "from-latest" },
          },
        ],
      },
    } as const;

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
            scriptPath: "scripts/read-stdin.sh",
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
        executionMailbox,
        env: {
          CAPTURED_STDIN_PATH: capturedStdinPath,
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.payload).toMatchObject({
      summary: "done",
    });
    expect(output.payload["resolvedInputPath"]).toEqual(
      expect.stringContaining("resolved-input/native-request.json"),
    );
    expect(output.payload["resolvedInputPath"]).not.toEqual(
      expect.stringContaining("inbox/input.json"),
    );
    const capturedInput = JSON.parse(
      await readFile(capturedStdinPath, "utf8"),
    ) as {
      readonly arguments: { readonly request: string };
      readonly upstream: readonly [
        { readonly output: { readonly value: string } },
      ];
      readonly latestOutputs: readonly [
        { readonly payload: { readonly summary: string } },
      ];
    };
    expect(capturedInput.arguments.request).toBe("from-arguments");
    expect(capturedInput.upstream[0].output.value).toBe("from-upstream");
    expect(capturedInput.latestOutputs[0].payload.summary).toBe("from-latest");
  });

  test("keeps command scriptPath workflow-relative with absolute command workingDirectory", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "node-1");
    await mkdir(workflowWorkingDirectory, { recursive: true });

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
              scriptPath: "sh",
              workingDirectory: "/bin",
              argvTemplate: ["-c", "printf '{\"bypassed\":true}\\n'"],
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
    } satisfies Partial<AdapterExecutionError>);
    await expect(
      readFile(path.join(artifactDir, "mailbox", "outbox", "output.json")),
    ).rejects.toThrow();
  });

  test("runs runtime-owned command script paths for executable add-ons", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const addonDirectory = await makeTempDir();
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptPath = await writeReportCwdScript(
      addonDirectory,
      ".",
      "greeting.bash",
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
            scriptPath,
            runtimeScriptPath: path.join(addonDirectory, scriptPath),
            workingDirectory: addonDirectory,
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

    await expectPayloadCwd(output.payload, addonDirectory);
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
        'echo "native diagnostic line" >&2',
        'echo "native stderr line" >&2',
        `printf '{"summary":"done"}\n'`,
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
      { stream: "stdout", text: '{"summary":"done"}\n' },
      {
        stream: "stderr",
        text: "native diagnostic line\nnative stderr line\n",
      },
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
        `printf '{"completionPassed":true,"when":{"needs_item":true},"payload":{"decision":"delegate"}}\n'`,
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

  test("accepts pretty-printed JSON stdout from command nodes", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptDirectory = path.join(workflowDirectory, "scripts");
    await mkdir(scriptDirectory, { recursive: true });
    await writeFile(
      path.join(scriptDirectory, "write-pretty-json.sh"),
      [
        "#!/bin/sh",
        "cat <<'JSON'",
        "{",
        '  "summary": "done",',
        '  "nested": {',
        '    "ok": true',
        "  }",
        "}",
        "JSON",
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
            scriptPath: "scripts/write-pretty-json.sh",
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

    expect(output.payload).toEqual({
      summary: "done",
      nested: { ok: true },
    });
  });

  test("rejects command stdout diagnostic preamble before JSON output", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptDirectory = path.join(workflowDirectory, "scripts");
    await mkdir(scriptDirectory, { recursive: true });
    await writeFile(
      path.join(scriptDirectory, "missing-output.sh"),
      [
        "#!/bin/sh",
        'echo "stdout diagnostic before invalid output"',
        'printf \'{"summary":"done"}\\n\'',
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
        {
          stream: "stdout",
          text: 'stdout diagnostic before invalid output\n{"summary":"done"}\n',
        },
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

  test("forwards only explicit workflow env into container run args", async () => {
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
        `printf '{"summary":"done"}\n'`,
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
              RIEL_MAILBOX_DIR: "{{explicitValue}}",
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
    expect(capturedArgs).toContain("RIEL_MAILBOX_DIR=mapped");
    expect(capturedArgs).not.toContain("/mailbox");
    expect(capturedArgs).not.toContain("SHOULD_NOT_ENTER_CONTAINER");
    expect(capturedArgs).not.toContain("host-secret");
  });

  test("passes resolved input JSON to container private request file", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "node-1");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    const capturedArgsPath = path.join(workflowDirectory, "runner-args.txt");
    const capturedStdinPath = path.join(workflowDirectory, "runner-stdin.json");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf "%s\\n" "$@" > "$CAPTURED_ARGS_PATH"',
        "resolved_input_path=",
        `for arg in "$@"; do case "$arg" in *:/rielflow-input/resolved-input.json:ro) resolved_input_path="\${arg%%:/rielflow-input/resolved-input.json:ro}" ;; esac; done`,
        'if [ -n "$resolved_input_path" ] && [ -f "$resolved_input_path" ]; then cat "$resolved_input_path" > "$CAPTURED_STDIN_PATH"; else printf "{}\\n" > "$CAPTURED_STDIN_PATH"; fi',
        `printf '{"summary":"done","resolvedInputPath":"%s","resolvedInputPathExists":%s}\n' "$resolved_input_path" "$([ -f "$resolved_input_path" ] && printf true || printf false)"`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const executionMailbox = {
      ...makeExecutionMailbox(),
      input: {
        arguments: { request: "from-container-arguments" },
        upstream: [
          {
            fromNodeId: "previous",
            transitionWhen: "always",
            communicationId: "comm-000001",
            output: { value: "from-container-upstream" },
          },
        ],
        latestOutputs: [
          {
            nodeId: "previous",
            nodeExecId: "exec-previous",
            status: "succeeded",
            artifactDir: "/tmp/previous",
            payload: { summary: "from-container-latest" },
          },
        ],
      },
    } as const;

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
          variables: {},
          container: {
            runnerKind: "docker",
            runnerPath,
            image: "example-image",
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
        executionMailbox,
        env: {
          CAPTURED_ARGS_PATH: capturedArgsPath,
          CAPTURED_STDIN_PATH: capturedStdinPath,
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.payload).toMatchObject({
      summary: "done",
      resolvedInputPathExists: true,
    });
    expect(output.payload["resolvedInputPath"]).toEqual(
      expect.stringContaining("resolved-input/native-request.json"),
    );
    const capturedArgs = await readFile(capturedArgsPath, "utf8");
    expect(capturedArgs.split("\n")).toContain("-i");
    expect(capturedArgs).toContain(":/rielflow-input/resolved-input.json:ro");
    expect(capturedArgs).toContain(
      "RIEL_RESOLVED_INPUT_PATH=/rielflow-input/resolved-input.json",
    );
    const capturedInput = JSON.parse(
      await readFile(capturedStdinPath, "utf8"),
    ) as {
      readonly arguments: { readonly request: string };
      readonly upstream: readonly [
        { readonly output: { readonly value: string } },
      ];
      readonly latestOutputs: readonly [
        { readonly payload: { readonly summary: string } },
      ];
    };
    expect(capturedInput.arguments.request).toBe("from-container-arguments");
    expect(capturedInput.upstream[0].output.value).toBe(
      "from-container-upstream",
    );
    expect(capturedInput.latestOutputs[0].payload.summary).toBe(
      "from-container-latest",
    );
  });
});
