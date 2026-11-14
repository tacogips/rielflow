import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  DeterministicNodeAdapter,
  type AdapterExecutionInput,
  type NodeAdapter,
} from "./adapter";
import { callStepExecution } from "./call-step-impl";
import { listRuntimeNodeLogs } from "./runtime-db";
import { createSessionState } from "./session";
import { loadSession, saveSession } from "./session-store";

const tempDirs: string[] = [];
const deterministicAdapter = new DeterministicNodeAdapter();

/** Shared workflow-load options for call-step test fixtures. */
const workflowLoadOpts = {} as const;

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-call-step-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function createCallStepFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(workflowRoot, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "call-step fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "divedra-manager",
    entryStepId: "divedra-manager",
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
      },
      {
        id: "writer",
        nodeFile: "node-writer.json",
      },
    ],
    steps: [
      {
        id: "divedra-manager",
        nodeId: "divedra-manager",
        role: "manager",
        transitions: [{ toStepId: "writer", label: "always" }],
      },
      {
        id: "writer",
        nodeId: "writer",
        role: "worker",
      },
    ],
  });

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    promptTemplate: "manager",
    variables: {},
  });

  await writeJson(path.join(workflowDir, "node-writer.json"), {
    id: "writer",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "write a structured review",
    variables: {},
    output: {
      description: "writer output",
      maxValidationAttempts: 2,
      jsonSchema: {
        type: "object",
        required: ["summary"],
        properties: {
          summary: { type: "string" },
        },
      },
    },
  });
}

async function createOptionalCallStepFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  await createCallStepFixture(workflowRoot, workflowName);
  const workflowDir = path.join(workflowRoot, workflowName);
  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "call-step fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "divedra-manager",
    entryStepId: "divedra-manager",
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
      },
      {
        id: "writer",
        nodeFile: "node-writer.json",
        execution: {
          mode: "optional",
          decisionBy: "owning-manager",
        },
      },
    ],
    steps: [
      {
        id: "divedra-manager",
        nodeId: "divedra-manager",
        role: "manager",
        transitions: [{ toStepId: "writer", label: "always" }],
      },
      {
        id: "writer",
        nodeId: "writer",
        role: "worker",
      },
    ],
  });
}

async function createUserActionCallStepFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  await createCallStepFixture(workflowRoot, workflowName);
  const workflowDir = path.join(workflowRoot, workflowName);
  await writeJson(path.join(workflowDir, "node-writer.json"), {
    id: "writer",
    nodeType: "user-action",
    promptTemplate: "ask the reviewer for approval",
    variables: {},
    userAction: {
      messageToolIds: ["matrix-primary"],
      replyPolicy: "first-valid-reply-wins",
    },
  });
}

async function createStepIdMismatchContainerFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(workflowRoot, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "call-step step/node mismatch fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "manager-step",
    entryStepId: "manager-step",
    nodes: [
      {
        id: "manager-node",
        nodeFile: "node-manager-node.json",
      },
      {
        id: "writer-node",
        nodeFile: "node-writer-node.json",
      },
    ],
    steps: [
      {
        id: "manager-step",
        nodeId: "manager-node",
        role: "manager",
        transitions: [{ toStepId: "writer-step", label: "always" }],
      },
      {
        id: "writer-step",
        nodeId: "writer-node",
        role: "worker",
      },
    ],
  });

  await writeJson(path.join(workflowDir, "node-manager-node.json"), {
    id: "manager-node",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    promptTemplate: "manager",
    variables: {},
  });

  await writeJson(path.join(workflowDir, "node-writer-node.json"), {
    id: "writer-node",
    nodeType: "container",
    variables: {},
    container: {
      runnerKind: "podman",
      runnerPath: "/definitely/missing/podman",
      build: {
        contextPath: "containers/writer",
        containerfilePath: "containers/writer/Containerfile",
      },
    },
  });
}

async function createCallStepSession(input: {
  readonly workflowName: string;
  readonly sessionId: string;
  readonly sessionStoreRoot: string;
  readonly initialNodeId?: string;
}): Promise<void> {
  const saved = await saveSession(
    createSessionState({
      sessionId: input.sessionId,
      workflowName: input.workflowName,
      workflowId: input.workflowName,
      initialNodeId: input.initialNodeId ?? "divedra-manager",
      runtimeVariables: {},
    }),
    {
      sessionStoreRoot: input.sessionStoreRoot,
    },
  );
  expect(saved.ok).toBe(true);
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("callStepExecution", () => {
  test("rejects direct step calls for completed sessions", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-terminal-session";
    const sessionId = "sess-call-step-terminal-session";

    await createCallStepFixture(root, workflowName);
    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName,
          workflowId: workflowName,
          initialNodeId: "divedra-manager",
          runtimeVariables: {},
        }),
        status: "completed",
        endedAt: "2026-03-16T00:00:00.000Z",
      },
      {
        sessionStoreRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("terminal session");
    expect(result.error.message).toContain("completed");
  });

  test("rejects direct step calls for optional workflow nodes", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-optional";
    const sessionId = "sess-call-step-optional";

    await createOptionalCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("is optional");
    expect(result.error.message).toContain("workflow scheduler");
  });

  test("rejects direct step calls for user-action nodes", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-user-action";
    const sessionId = "sess-call-step-user-action";

    await createUserActionCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("nodeType='user-action'");
    expect(result.error.message).toContain(
      "direct step execution is not supported",
    );
  });

  test("persists native command process logs for direct step calls", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const rootDataDir = path.join(root, "data");
    const workflowName = "call-step-command-logs";
    const sessionId = "sess-call-step-command-logs";

    await createCallStepFixture(root, workflowName);
    const scriptsDir = path.join(root, workflowName, "scripts");
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(
      path.join(scriptsDir, "write-output.sh"),
      [
        "#!/bin/sh",
        'echo "call-step command stdout"',
        'mkdir -p "$DIVEDRA_MAILBOX_DIR/outbox"',
        `printf '{"summary":"done"}\n' > "$DIVEDRA_MAILBOX_DIR/outbox/output.json"`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );
    await writeJson(path.join(root, workflowName, "node-writer.json"), {
      id: "writer",
      nodeType: "command",
      variables: {},
      command: {
        scriptPath: "scripts/write-output.sh",
      },
    });
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      rootDataDir,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const logs = await listRuntimeNodeLogs(sessionId, {
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      rootDataDir,
    });
    expect(
      logs.some(
        (entry) =>
          entry.nodeId === "writer" &&
          entry.message.includes("stdout") &&
          entry.message.includes("call-step command stdout"),
      ),
    ).toBe(true);
  });

  test("fails deterministically when execution mailbox artifacts cannot be persisted", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-mailbox-write-failure";
    const sessionId = "sess-call-step-mailbox-write-failure";

    await createCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const blockedMailboxPath = path.join(
      artifactsRoot,
      workflowName,
      "executions",
      sessionId,
      "nodes",
      "writer",
      "exec-000001",
      "mailbox",
    );
    await mkdir(path.dirname(blockedMailboxPath), { recursive: true });
    await writeFile(blockedMailboxPath, "blocked", "utf8");

    const result = await callStepExecution(
      {
        ...workflowLoadOpts,
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        stepId: "writer",
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.exitCode).toBe(1);
    expect(result.error.message).toContain(
      "failed to persist execution mailbox",
    );

    const persisted = await loadSession(sessionId, { sessionStoreRoot });
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) {
      return;
    }
    expect(persisted.value.status).toBe("failed");
    expect(persisted.value.lastError).toContain(
      "failed to persist execution mailbox",
    );
  });

  test("fails container node execution when the configured runner is unavailable", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-podman";
    const sessionId = "sess-call-step-podman";

    await createCallStepFixture(root, workflowName);
    await writeJson(path.join(root, workflowName, "node-writer.json"), {
      id: "writer",
      nodeType: "container",
      variables: {},
      container: {
        runnerKind: "podman",
        runnerPath: "/definitely/missing/podman",
        build: {
          contextPath: "containers/writer",
          containerfilePath: "containers/writer/Containerfile",
        },
      },
      output: {
        description: "writer output",
        maxValidationAttempts: 2,
        jsonSchema: {
          type: "object",
          required: ["summary"],
          properties: {
            summary: { type: "string" },
          },
        },
      },
    });
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("workflow runtime readiness failed");
  });

  test("fails readiness for a direct step when the step id differs from its node registry id", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-step-node-mismatch";
    const sessionId = "sess-call-step-step-node-mismatch";

    await createStepIdMismatchContainerFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
      initialNodeId: "manager-step",
    });

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer-step",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("workflow runtime readiness failed");
  });

  test("normalizes plain-text manager messages in mailbox input artifacts", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-plain-message";
    const sessionId = "sess-call-step-plain-message";

    await createCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    class PlainMessageAdapter implements NodeAdapter {
      async execute(input: AdapterExecutionInput) {
        return {
          provider: "plain-message-adapter",
          model: input.node.model,
          promptText: input.promptText,
          completionPassed: true,
          when: { always: true },
          payload: { summary: "ok" },
        };
      }
    }

    const result = await callStepExecution(
      {
        ...workflowLoadOpts,
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        stepId: "writer",
        message: "review this change",
      },
      new PlainMessageAdapter(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const mailboxInput = JSON.parse(
      await readFile(
        path.join(
          result.value.outputRef.artifactDir,
          "mailbox",
          "inbox",
          "input.json",
        ),
        "utf8",
      ),
    ) as {
      readonly managerMessage?: {
        readonly payload?: { readonly text?: string };
      };
    };
    expect(mailboxInput.managerMessage?.payload).toEqual({
      text: "review this change",
    });
  });
});
