import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DeterministicNodeAdapter } from "./adapter";
import { callStep } from "./call-step";
import { listRuntimeNodeExecutions } from "./runtime-db";
import { createSessionState } from "./session";
import { saveSession } from "./session-store";

const tempDirs: string[] = [];
const deterministicAdapter = new DeterministicNodeAdapter();

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
  const workflowDirectory = path.join(workflowRoot, workflowName);
  await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: workflowName,
    description: "call-step fixture",
    defaults: {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120_000,
    },
    managerStepId: "manager-step",
    entryStepId: "manager-step",
    nodes: [
      {
        id: "manager-node",
        nodeFile: "nodes/node-manager.json",
      },
      {
        id: "writer-node",
        nodeFile: "nodes/node-writer.json",
      },
    ],
    steps: [
      {
        id: "manager-step",
        nodeId: "manager-node",
        role: "manager",
        transitions: [{ toStepId: "writer-step" }],
      },
      {
        id: "writer-step",
        nodeId: "writer-node",
      },
    ],
  });

  await writeJson(path.join(workflowDirectory, "nodes", "node-manager.json"), {
    id: "manager-node",
    variables: {},
  });
  await writeJson(path.join(workflowDirectory, "nodes", "node-writer.json"), {
    id: "writer-node",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "base writer prompt",
    promptVariants: {
      review: {
        promptTemplate: "review writer prompt",
      },
    },
    variables: {},
    output: {
      description: "writer step output",
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

async function createInheritedSessionCallStepFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDirectory = path.join(workflowRoot, workflowName);
  await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: workflowName,
    description: "call-step inherited-session fixture",
    defaults: {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120_000,
    },
    entryStepId: "implement-step",
    nodes: [
      {
        id: "writer-node",
        nodeFile: "nodes/node-writer.json",
      },
    ],
    steps: [
      {
        id: "implement-step",
        nodeId: "writer-node",
        sessionPolicy: {
          mode: "reuse",
        },
        transitions: [{ toStepId: "review-step" }],
      },
      {
        id: "review-step",
        nodeId: "writer-node",
        promptVariant: "review",
        sessionPolicy: {
          mode: "reuse",
          inheritFromStepId: "implement-step",
        },
      },
    ],
  });

  await writeJson(path.join(workflowDirectory, "nodes", "node-writer.json"), {
    id: "writer-node",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "implement writer prompt",
    promptVariants: {
      review: {
        promptTemplate: "review writer prompt",
      },
    },
    variables: {},
    output: {
      description: "writer step output",
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

async function createInheritedSessionLineageCallStepFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDirectory = path.join(workflowRoot, workflowName);
  await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: workflowName,
    description: "call-step inherited-session lineage fixture",
    defaults: {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120_000,
    },
    entryStepId: "implement-step",
    nodes: [
      {
        id: "writer-node",
        nodeFile: "nodes/node-writer.json",
      },
    ],
    steps: [
      {
        id: "implement-step",
        nodeId: "writer-node",
        sessionPolicy: {
          mode: "reuse",
        },
        transitions: [{ toStepId: "review-step" }],
      },
      {
        id: "review-step",
        nodeId: "writer-node",
        promptVariant: "review",
        sessionPolicy: {
          mode: "reuse",
          inheritFromStepId: "implement-step",
        },
        transitions: [{ toStepId: "polish-step" }],
      },
      {
        id: "polish-step",
        nodeId: "writer-node",
        promptVariant: "polish",
        sessionPolicy: {
          mode: "reuse",
          inheritFromStepId: "implement-step",
        },
      },
    ],
  });

  await writeJson(path.join(workflowDirectory, "nodes", "node-writer.json"), {
    id: "writer-node",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "implement writer prompt",
    promptVariants: {
      review: {
        promptTemplate: "review writer prompt",
      },
      polish: {
        promptTemplate: "polish writer prompt",
      },
    },
    variables: {},
    output: {
      description: "writer step output",
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

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("callStep", () => {
  test("applies prompt, session, and timeout overrides for direct step execution", async () => {
    const root = await makeTempDir();
    const workflowName = "call-step-overrides";
    const sessionId = "sess-call-step-overrides";
    const sessionStoreRoot = path.join(root, "sessions");

    await createCallStepFixture(root, workflowName);

    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName,
          workflowId: workflowName,
          initialNodeId: "manager-step",
          runtimeVariables: {},
        }),
        nodeBackendSessions: {
          "writer-step": {
            nodeId: "writer-step",
            backend: "codex-agent",
            provider: "scenario-mock",
            sessionId: "persisted-step-session",
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:00:00.000Z",
            lastNodeExecId: "exec-previous",
          },
        },
      },
      {
        sessionStoreRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const result = await callStep({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer-step",
      mockScenario: {
        "writer-step": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "step ok" },
        },
      },
      overrides: {
        promptVariant: "review",
        sessionMode: "reuse",
        timeoutMs: 3210,
        resumeStepExecId: "exec-previous",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const inputJson = JSON.parse(
      await readFile(
        path.join(result.value.outputRef.artifactDir, "input.json"),
        "utf8",
      ),
    ) as {
      promptTemplate: string;
      backendSession?: {
        mode: string;
        sessionId?: string;
      };
      resumedFromNodeExecId?: string;
    };
    expect(inputJson.promptTemplate).toBe("review writer prompt");
    expect(inputJson.backendSession).toEqual({
      mode: "reuse",
      sessionId: "persisted-step-session",
    });
    expect(inputJson.resumedFromNodeExecId).toBe("exec-previous");
    expect(result.value.nodeExecution.stepId).toBe("writer-step");
    expect(result.value.nodeExecution.nodeRegistryId).toBe("writer-node");
    expect(result.value.nodeExecution.mailboxInstanceId).toBe(
      result.value.nodeExecution.nodeExecId,
    );
    expect(result.value.nodeExecution.promptVariant).toBe("review");
    expect(result.value.nodeExecution.timeoutMs).toBe(3210);

    const metaJson = JSON.parse(
      await readFile(
        path.join(result.value.outputRef.artifactDir, "meta.json"),
        "utf8",
      ),
    ) as {
      stepId?: string;
      nodeRegistryId?: string;
      mailboxInstanceId?: string;
      promptVariant?: string;
      timeoutMs: number;
      backendSessionMode?: string;
    };
    expect(metaJson.stepId).toBe("writer-step");
    expect(metaJson.nodeRegistryId).toBe("writer-node");
    expect(metaJson.mailboxInstanceId).toBe(
      result.value.nodeExecution.nodeExecId,
    );
    expect(metaJson.promptVariant).toBe("review");
    expect(metaJson.timeoutMs).toBe(3210);
    expect(metaJson.backendSessionMode).toBe("reuse");

    const runtimeExecutions = await listRuntimeNodeExecutions(sessionId, {
      rootDataDir: path.join(root, "data"),
    });
    expect(runtimeExecutions).toHaveLength(1);
    expect(runtimeExecutions[0]).toMatchObject({
      nodeId: "writer-step",
      stepId: "writer-step",
      nodeRegistryId: "writer-node",
      mailboxInstanceId: result.value.nodeExecution.nodeExecId,
      promptVariant: "review",
      timeoutMs: 3210,
    });
  });

  test("rejects unknown prompt variants with a step-targeted error", async () => {
    const root = await makeTempDir();
    const workflowName = "call-step-bad-variant";
    const sessionId = "sess-call-step-bad-variant";
    const sessionStoreRoot = path.join(root, "sessions");

    await createCallStepFixture(root, workflowName);

    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName,
        workflowId: workflowName,
        initialNodeId: "manager-step",
        runtimeVariables: {},
      }),
      {
        sessionStoreRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const result = await callStep({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer-step",
      overrides: {
        promptVariant: "missing-variant",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.exitCode).toBe(2);
    expect(result.error.message).toContain("step 'writer-step'");
    expect(result.error.message).not.toContain("node 'writer-step'");
    expect(result.error.message).toContain("missing-variant");
  });

  test("reports missing direct step targets with step-oriented wording", async () => {
    const root = await makeTempDir();
    const workflowName = "call-step-missing-target";
    const sessionId = "sess-call-step-missing-target";
    const sessionStoreRoot = path.join(root, "sessions");

    await createCallStepFixture(root, workflowName);

    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName,
        workflowId: workflowName,
        initialNodeId: "manager-step",
        runtimeVariables: {},
      }),
      {
        sessionStoreRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const result = await callStep({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "missing-step",
      mockScenario: {},
      dryRun: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("missing step definition");
    expect(result.error.message).toContain("'missing-step'");
    expect(result.error.message).not.toContain("missing node definition");
  });

  test("inherits reusable backend sessions from an earlier step when requested", async () => {
    const root = await makeTempDir();
    const workflowName = "call-step-inherit-session";
    const sessionId = "sess-call-step-inherit-session";
    const sessionStoreRoot = path.join(root, "sessions");

    await createInheritedSessionCallStepFixture(root, workflowName);

    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName,
          workflowId: workflowName,
          initialNodeId: "implement-step",
          runtimeVariables: {},
        }),
        nodeBackendSessions: {
          "implement-step": {
            nodeId: "implement-step",
            stepId: "implement-step",
            nodeRegistryId: "writer-node",
            backend: "codex-agent",
            provider: "scenario-mock",
            sessionId: "persisted-implement-session",
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:00:00.000Z",
            lastNodeExecId: "exec-implement-previous",
          },
        },
      },
      {
        sessionStoreRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const result = await callStep({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "review-step",
      mockScenario: {
        "review-step": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "review ok" },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const inputJson = JSON.parse(
      await readFile(
        path.join(result.value.outputRef.artifactDir, "input.json"),
        "utf8",
      ),
    ) as {
      promptTemplate: string;
      backendSession?: {
        mode: string;
        sessionId?: string;
      };
    };
    expect(inputJson.promptTemplate).toBe("review writer prompt");
    expect(inputJson.backendSession).toEqual({
      mode: "reuse",
      sessionId: "persisted-implement-session",
    });

    expect(result.value.nodeExecution.nodeId).toBe("review-step");
    expect(result.value.nodeExecution.stepId).toBe("review-step");
    expect(result.value.nodeExecution.nodeRegistryId).toBe("writer-node");
    expect(result.value.nodeExecution.backendSessionMode).toBe("reuse");
    expect(result.value.nodeExecution.backendSessionId).toBe(
      "persisted-implement-session",
    );
  });

  test("preserves inheritFromStepId when direct execution overrides request session reuse", async () => {
    const root = await makeTempDir();
    const workflowName = "call-step-inherit-session-override";
    const sessionId = "sess-call-step-inherit-session-override";
    const sessionStoreRoot = path.join(root, "sessions");

    await createInheritedSessionCallStepFixture(root, workflowName);

    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName,
          workflowId: workflowName,
          initialNodeId: "implement-step",
          runtimeVariables: {},
        }),
        nodeBackendSessions: {
          "implement-step": {
            nodeId: "implement-step",
            stepId: "implement-step",
            nodeRegistryId: "writer-node",
            sourceStepId: "implement-step",
            lastStepId: "implement-step",
            backend: "codex-agent",
            provider: "scenario-mock",
            sessionId: "persisted-implement-session",
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:00:00.000Z",
            lastNodeExecId: "exec-implement-previous",
          },
          "unrelated-step": {
            nodeId: "unrelated-step",
            stepId: "unrelated-step",
            nodeRegistryId: "writer-node",
            sourceStepId: "different-step",
            lastStepId: "unrelated-step",
            backend: "codex-agent",
            provider: "scenario-mock",
            sessionId: "persisted-unrelated-session",
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:01:00.000Z",
            lastNodeExecId: "exec-unrelated-previous",
          },
        },
      },
      {
        sessionStoreRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const result = await callStep({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "review-step",
      mockScenario: {
        "review-step": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "review ok" },
        },
      },
      overrides: {
        sessionMode: "reuse",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const inputJson = JSON.parse(
      await readFile(
        path.join(result.value.outputRef.artifactDir, "input.json"),
        "utf8",
      ),
    ) as {
      backendSession?: {
        mode: string;
        sessionId?: string;
      };
    };
    expect(inputJson.backendSession).toEqual({
      mode: "reuse",
      sessionId: "persisted-implement-session",
    });
  });

  test("prefers the latest inherited-session candidate for the requested source step", async () => {
    const root = await makeTempDir();
    const workflowName = "call-step-inherit-session-lineage";
    const sessionId = "sess-call-step-inherit-session-lineage";
    const sessionStoreRoot = path.join(root, "sessions");

    await createInheritedSessionLineageCallStepFixture(root, workflowName);

    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName,
          workflowId: workflowName,
          initialNodeId: "implement-step",
          runtimeVariables: {},
        }),
        nodeBackendSessions: {
          "implement-step": {
            nodeId: "implement-step",
            stepId: "implement-step",
            nodeRegistryId: "writer-node",
            sourceStepId: "implement-step",
            lastStepId: "implement-step",
            backend: "codex-agent",
            provider: "scenario-mock",
            sessionId: "persisted-implement-session",
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:00:00.000Z",
            lastNodeExecId: "exec-implement-previous",
          },
          "review-step": {
            nodeId: "review-step",
            stepId: "review-step",
            nodeRegistryId: "writer-node",
            sourceStepId: "implement-step",
            lastStepId: "review-step",
            backend: "codex-agent",
            provider: "scenario-mock",
            sessionId: "persisted-review-session",
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:01:00.000Z",
            lastNodeExecId: "exec-review-previous",
          },
        },
      },
      {
        sessionStoreRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const result = await callStep({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "polish-step",
      mockScenario: {
        "polish-step": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "polish ok" },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const inputJson = JSON.parse(
      await readFile(
        path.join(result.value.outputRef.artifactDir, "input.json"),
        "utf8",
      ),
    ) as {
      promptTemplate: string;
      backendSession?: {
        mode: string;
        sessionId?: string;
      };
    };
    expect(inputJson.promptTemplate).toBe("polish writer prompt");
    expect(inputJson.backendSession).toEqual({
      mode: "reuse",
      sessionId: "persisted-review-session",
    });
  });

  test("reports terminal-session direct-call failures with step-oriented wording", async () => {
    const root = await makeTempDir();
    const workflowName = "call-step-terminal-session";
    const sessionId = "sess-call-step-terminal";
    const sessionStoreRoot = path.join(root, "sessions");

    await createCallStepFixture(root, workflowName);

    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName,
          workflowId: workflowName,
          initialNodeId: "manager-step",
          runtimeVariables: {},
        }),
        status: "completed",
      },
      {
        sessionStoreRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const result = await callStep({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer-step",
      mockScenario: {},
      dryRun: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("cannot call step");
    expect(result.error.message).toContain("'writer-step'");
    expect(result.error.message).not.toContain("cannot call node");
  });

  test("surfaces step-oriented mailbox persistence errors on session lastError", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-mailbox-write-failure";
    const sessionId = "sess-call-step-mailbox-write-failure";

    await createCallStepFixture(root, workflowName);
    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName,
        workflowId: workflowName,
        initialNodeId: "manager-step",
        runtimeVariables: {},
      }),
      { sessionStoreRoot },
    );
    expect(saved.ok).toBe(true);

    const blockedMailboxPath = path.join(
      artifactsRoot,
      workflowName,
      "executions",
      sessionId,
      "nodes",
      "writer-step",
      "exec-000001",
      "mailbox",
    );
    await mkdir(path.dirname(blockedMailboxPath), { recursive: true });
    await writeFile(blockedMailboxPath, "blocked", "utf8");

    const result = await callStep(
      {
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        stepId: "writer-step",
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("execution mailbox for step");
    expect(result.error.message).not.toContain("execution mailbox at");
    expect(result.error.session.lastError).toContain(
      "execution mailbox for step",
    );
    expect(result.error.session.lastError).not.toContain(
      "execution mailbox at",
    );
  });
});
