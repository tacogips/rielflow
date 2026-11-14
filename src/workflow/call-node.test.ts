import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AdapterExecutionError,
  DeterministicNodeAdapter,
  type AdapterExecutionInput,
  type NodeAdapter,
} from "./adapter";
import { callNode } from "./call-node";
import { createSessionState } from "./session";
import { loadSession, saveSession } from "./session-store";

const tempDirs: string[] = [];
const deterministicAdapter = new DeterministicNodeAdapter();

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-call-node-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function createCallNodeFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(workflowRoot, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "call-node fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "writer",
        kind: "task",
        nodeFile: "node-writer.json",
        completion: { type: "none" },
      },
    ],
    edges: [],
    loops: [],
    branching: { mode: "fan-out" },
  });

  await writeJson(path.join(workflowDir, "workflow-vis.json"), {
    nodes: [
      { id: "divedra-manager", order: 0 },
      { id: "writer", order: 1 },
    ],
  });

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    model: "tacogips/claude-code-agent",
    promptTemplate: "manager",
    variables: {},
  });

  await writeJson(path.join(workflowDir, "node-writer.json"), {
    id: "writer",
    model: "tacogips/codex-agent",
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

async function createOptionalCallNodeFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  await createCallNodeFixture(workflowRoot, workflowName);
  const workflowDir = path.join(workflowRoot, workflowName);
  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "call-node fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "writer",
        kind: "task",
        nodeFile: "node-writer.json",
        completion: { type: "none" },
        execution: {
          mode: "optional",
          decisionBy: "owning-manager",
        },
      },
    ],
    edges: [],
    loops: [],
    branching: { mode: "fan-out" },
  });
}

async function createUserActionCallNodeFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  await createCallNodeFixture(workflowRoot, workflowName);
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

async function createCallNodeSession(input: {
  readonly workflowName: string;
  readonly sessionId: string;
  readonly sessionStoreRoot: string;
}): Promise<void> {
  const saved = await saveSession(
    createSessionState({
      sessionId: input.sessionId,
      workflowName: input.workflowName,
      workflowId: input.workflowName,
      initialNodeId: "divedra-manager",
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

describe("callNode", () => {
  test("retries invalid output in the same node session and publishes accepted output", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-node-demo";
    const sessionId = "sess-call-node-demo";

    await createCallNodeFixture(root, workflowName);
    await createCallNodeSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    class RepairingAdapter implements NodeAdapter {
      readonly calls: AdapterExecutionInput[] = [];

      async execute(input: AdapterExecutionInput) {
        this.calls.push(input);
        const attempt = this.calls.length;
        return {
          provider: "repairing-adapter",
          model: input.node.model,
          promptText: input.promptText,
          completionPassed: true,
          when: { always: true },
          payload:
            attempt === 1 ? { wrong: true } : { summary: "fixed on retry" },
          ...(attempt === 1
            ? { backendSession: { sessionId: "node-session-1" } }
            : {}),
        };
      }
    }

    const adapter = new RepairingAdapter();
    const result = await callNode(
      {
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        nodeId: "writer",
        message: { instruction: "produce review json" },
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[1]?.backendSession).toEqual({
      mode: "reuse",
      sessionId: "node-session-1",
    });
    expect(result.value.output["payload"]).toEqual({
      summary: "fixed on retry",
    });
    expect(result.value.nodeExecution.outputAttemptCount).toBe(2);

    const outputJson = JSON.parse(
      await readFile(
        path.join(result.value.outputRef.artifactDir, "output.json"),
        "utf8",
      ),
    ) as { payload: { summary: string } };
    expect(outputJson.payload.summary).toBe("fixed on retry");

    const inputJson = JSON.parse(
      await readFile(
        path.join(result.value.outputRef.artifactDir, "input.json"),
        "utf8",
      ),
    ) as {
      managerMessage?: { instruction?: string };
      executionMailbox?: {
        readonly meta: {
          readonly mailboxDirEnvVar: string;
          readonly paths: {
            readonly inputPath: string;
            readonly outputPath: string;
          };
        };
      };
    };
    expect(inputJson.managerMessage?.instruction).toBe("produce review json");
    expect(inputJson.executionMailbox).toMatchObject({
      meta: {
        mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR",
        paths: {
          inputPath: "inbox/input.json",
          outputPath: "outbox/output.json",
        },
      },
    });

    const mailboxMeta = JSON.parse(
      await readFile(
        path.join(result.value.outputRef.artifactDir, "mailbox", "inbox", "meta.json"),
        "utf8",
      ),
    ) as {
      readonly objective: { readonly instruction: string };
      readonly paths: { readonly outputPath: string };
    };
    const mailboxInput = JSON.parse(
      await readFile(
        path.join(result.value.outputRef.artifactDir, "mailbox", "inbox", "input.json"),
        "utf8",
      ),
    ) as {
      readonly managerMessage?: { readonly instruction?: string };
    };
    expect(mailboxMeta.objective.instruction).toBe("write a structured review");
    expect(mailboxMeta.paths.outputPath).toBe("outbox/output.json");
    expect(mailboxInput.managerMessage?.instruction).toBe("produce review json");

    const firstAttemptDir = path.join(
      result.value.outputRef.artifactDir,
      "output-attempts",
      "attempt-000001",
    );
    const secondAttemptDir = path.join(
      result.value.outputRef.artifactDir,
      "output-attempts",
      "attempt-000002",
    );
    const firstRequest = JSON.parse(
      await readFile(path.join(firstAttemptDir, "request.json"), "utf8"),
    ) as { validationErrors: readonly unknown[] };
    const firstCandidate = JSON.parse(
      await readFile(path.join(firstAttemptDir, "candidate.json"), "utf8"),
    ) as { wrong: boolean };
    const firstValidation = JSON.parse(
      await readFile(path.join(firstAttemptDir, "validation.json"), "utf8"),
    ) as { valid: boolean; errors: readonly { path: string }[] };
    const secondRequest = JSON.parse(
      await readFile(path.join(secondAttemptDir, "request.json"), "utf8"),
    ) as { validationErrors: readonly { path: string }[] };
    const secondValidation = JSON.parse(
      await readFile(path.join(secondAttemptDir, "validation.json"), "utf8"),
    ) as { valid: boolean };

    expect(firstRequest.validationErrors).toEqual([]);
    expect(firstCandidate.wrong).toBe(true);
    expect(firstValidation.valid).toBe(false);
    expect(firstValidation.errors[0]?.path).toBe("$.summary");
    expect(secondRequest.validationErrors[0]?.path).toBe("$.summary");
    expect(secondValidation.valid).toBe(true);
  });

  test("retries adapter invalid_output failures for structured-output nodes", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-node-retry-invalid-output";
    const sessionId = "sess-call-node-retry-invalid-output";

    await createCallNodeFixture(root, workflowName);
    await createCallNodeSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    class InvalidThenFixedAdapter implements NodeAdapter {
      calls = 0;

      async execute(input: AdapterExecutionInput) {
        this.calls += 1;
        if (this.calls === 1) {
          throw new AdapterExecutionError(
            "invalid_output",
            "writer must return a JSON object",
          );
        }
        return {
          provider: "repairing-adapter",
          model: input.node.model,
          promptText: input.promptText,
          completionPassed: true,
          when: { always: true },
          payload: { summary: "fixed after invalid output" },
          backendSession: { sessionId: "node-session-2" },
        };
      }
    }

    const adapter = new InvalidThenFixedAdapter();
    const result = await callNode(
      {
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        nodeId: "writer",
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(adapter.calls).toBe(2);
    expect(result.value.nodeExecution.outputAttemptCount).toBe(2);
    expect(result.value.output["payload"]).toEqual({
      summary: "fixed after invalid output",
    });

    const firstValidation = JSON.parse(
      await readFile(
        path.join(
          result.value.outputRef.artifactDir,
          "output-attempts",
          "attempt-000001",
          "validation.json",
        ),
        "utf8",
      ),
    ) as { valid: boolean; errors: readonly { message: string }[] };
    expect(firstValidation.valid).toBe(false);
    expect(firstValidation.errors[0]?.message).toContain(
      "writer must return a JSON object",
    );
  });

  test("rejects direct node calls for completed sessions", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-node-terminal-session";
    const sessionId = "sess-call-node-terminal-session";

    await createCallNodeFixture(root, workflowName);
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

    const result = await callNode({
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      nodeId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("terminal session");
    expect(result.error.message).toContain("completed");
  });

  test("rejects direct node calls for optional workflow nodes", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-node-optional";
    const sessionId = "sess-call-node-optional";

    await createOptionalCallNodeFixture(root, workflowName);
    await createCallNodeSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callNode({
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      nodeId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("is optional");
    expect(result.error.message).toContain("workflow scheduler");
  });

  test("rejects direct node calls for user-action nodes", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-node-user-action";
    const sessionId = "sess-call-node-user-action";

    await createUserActionCallNodeFixture(root, workflowName);
    await createCallNodeSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callNode({
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      nodeId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("nodeType='user-action'");
    expect(result.error.message).toContain("direct call-node execution is not supported");
  });

  test("fails deterministically when execution mailbox artifacts cannot be persisted", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-node-mailbox-write-failure";
    const sessionId = "sess-call-node-mailbox-write-failure";

    await createCallNodeFixture(root, workflowName);
    await createCallNodeSession({
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

    const result = await callNode(
      {
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        nodeId: "writer",
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

  test("rejects podman-isolated nodes until Podman execution is implemented", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-node-podman";
    const sessionId = "sess-call-node-podman";

    await createCallNodeFixture(root, workflowName);
    await writeJson(path.join(root, workflowName, "node-writer.json"), {
      id: "writer",
      model: "tacogips/codex-agent",
      promptTemplate: "write a structured review",
      variables: {},
      runtimeIsolation: {
        mode: "podman",
        build: {
          contextPath: "containers/writer",
          dockerfilePath: "containers/writer/Dockerfile",
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
    await createCallNodeSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callNode({
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      nodeId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("nodeType='container'");
    expect(result.error.message).toContain("not implemented yet");
  });

  test("normalizes plain-text manager messages in mailbox input artifacts", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-node-plain-message";
    const sessionId = "sess-call-node-plain-message";

    await createCallNodeFixture(root, workflowName);
    await createCallNodeSession({
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

    const result = await callNode(
      {
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        nodeId: "writer",
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
        path.join(result.value.outputRef.artifactDir, "mailbox", "inbox", "input.json"),
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
