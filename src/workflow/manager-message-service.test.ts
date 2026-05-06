import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { MockNodeScenario } from "./scenario-adapter";
import { createCommunicationService } from "./communication-service";
import { createWorkflowTemplate } from "./create";
import { runWorkflow } from "./engine";
import {
  createManagerSessionStore,
  hashManagerAuthToken,
} from "./manager-session-store";
import { createManagerMessageService } from "./manager-message-service";
import { createSessionState, type WorkflowSessionState } from "./session";
import { loadSession, saveSession } from "./session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-manager-message-service-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

function makeDefaultTemplateScenario(): MockNodeScenario {
  return {
    "divedra-manager": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "design" },
    },
    "main-worker": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "implement" },
    },
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createCompletedWorkflowFixture(root: string) {
  const created = await createWorkflowTemplate("demo", {
    workflowRoot: root,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) {
    throw new Error(created.error.message);
  }

  const options = {
    workflowRoot: root,
    artifactRoot: path.join(root, "artifacts"),
    rootDataDir: path.join(root, "data"),
    cwd: root,
  };
  const result = await runWorkflow("demo", {
    ...options,
    runtimeVariables: {
      humanInput: {
        request: "start demo workflow",
      },
    },
    mockScenario: makeDefaultTemplateScenario(),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return { options, session: result.value.session };
}

async function createManagerSession(
  root: string,
  workflowExecutionId: string,
  managerStepId = "divedra-manager",
  workflowId = "demo",
) {
  const store = createManagerSessionStore({
    cwd: root,
    rootDataDir: path.join(root, "data"),
  });
  await store.createOrResumeSession({
    managerSessionId: "mgrsess-000001",
    workflowId,
    workflowExecutionId,
    managerStepId,
    managerNodeExecId: "exec-000001",
    status: "active",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    authTokenHash: hashManagerAuthToken("secret"),
    authTokenExpiresAt: "2026-03-16T00:00:00.000Z",
  });
  return store;
}

async function createOptionalDecisionWorkflowFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeFile(
    path.join(workflowDir, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: workflowName,
        description: "optional manager-message fixture",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        managerStepId: "divedra-manager",
        entryStepId: "divedra-manager",
        nodes: [
          {
            id: "divedra-manager",
            nodeFile: "node-divedra-manager.json",
          },
          {
            id: "step-1",
            nodeFile: "node-step-1.json",
            execution: {
              mode: "optional",
              decisionBy: "owning-manager",
            },
          },
          {
            id: "step-2",
            nodeFile: "node-step-2.json",
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
          },
          {
            id: "step-1",
            nodeId: "step-1",
            role: "worker",
          },
          {
            id: "step-2",
            nodeId: "step-2",
            role: "worker",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  for (const node of [
    {
      file: "node-divedra-manager.json",
      payload: {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
    },
    {
      file: "node-step-1.json",
      payload: {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "optional step 1",
        variables: {},
      },
    },
    {
      file: "node-step-2.json",
      payload: {
        id: "step-2",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "optional step 2",
        variables: {},
      },
    },
  ]) {
    await writeFile(
      path.join(workflowDir, node.file),
      `${JSON.stringify(node.payload, null, 2)}\n`,
      "utf8",
    );
  }
}

async function createPendingOptionalDecisionSession(input: {
  readonly root: string;
  readonly workflowName: string;
  readonly sessionId: string;
}): Promise<WorkflowSessionState> {
  const baseSession = createSessionState({
    sessionId: input.sessionId,
    workflowName: input.workflowName,
    workflowId: input.workflowName,
    initialNodeId: "divedra-manager",
    runtimeVariables: {},
  });
  const session: WorkflowSessionState = {
    ...baseSession,
    status: "running",
    queue: [],
    currentNodeId: "divedra-manager",
    pendingOptionalNodeDecisions: [
      {
        nodeId: "step-1",
        owningManagerStepId: "divedra-manager",
        requestedAt: "2026-03-15T04:00:00.000Z",
        status: "pending",
      },
      {
        nodeId: "step-2",
        owningManagerStepId: "divedra-manager",
        requestedAt: "2026-03-15T04:00:00.000Z",
        status: "pending",
      },
    ],
  };
  const saved = await saveSession(session, {
    workflowRoot: input.root,
    artifactRoot: path.join(input.root, "artifacts"),
    rootDataDir: path.join(input.root, "data"),
    cwd: input.root,
  });
  expect(saved.ok).toBe(true);
  if (!saved.ok) {
    throw new Error(saved.error.message);
  }
  return session;
}

describe("manager-message-service", () => {
  test("canonicalizes idempotent manager-message inputs before hashing", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(root, session.sessionId);
    const service = createManagerMessageService({
      now: () => "2026-03-15T01:00:00.000Z",
      managerSessionStore: managerStore,
      communicationService: createCommunicationService({
        now: () => "2026-03-15T01:00:00.000Z",
        idempotencyStore: managerStore,
      }),
    });

    const attachmentDir = path.join(
      options.rootDataDir,
      "files",
      "demo",
      session.sessionId,
      "attachments",
    );
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(path.join(attachmentDir, "brief.txt"), "brief", "utf8");

    const accepted = await service.sendManagerMessage(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        managerSessionId: "mgrsess-000001",
        message: "  Retry the worker stage after review.  ",
        actions: [{ type: "retry-step", stepId: "main-worker" }],
        attachments: [
          {
            path: `files/demo/${session.sessionId}/attachments/./brief.txt`,
            mediaType: "text/plain",
          },
        ],
        idempotencyKey: "idem-note-retry",
      },
      options,
    );

    expect(accepted.accepted).toBe(true);
    expect(accepted.queuedNodeIds).toEqual(["main-worker"]);
    expect(accepted.createdCommunicationIds).toEqual([]);
    expect(accepted.parsedIntent[0]?.kind).toBe("retry-step");

    const loaded = await loadSession(session.sessionId, options);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.status).toBe("running");
    expect(loaded.value.queue).toContain("main-worker");

    const replayed = await service.sendManagerMessage(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        managerSessionId: "mgrsess-000001",
        message: "Retry the worker stage after review.",
        actions: [{ type: "retry-step", stepId: "main-worker" }],
        attachments: [
          {
            path: `files/demo/${session.sessionId}/attachments/brief.txt`,
            mediaType: "text/plain",
          },
        ],
        idempotencyKey: "idem-note-retry",
      },
      options,
    );
    expect(replayed).toEqual(accepted);

    const messages = await managerStore.listMessages("mgrsess-000001");
    expect(messages).toHaveLength(1);
    const persistedSession = await managerStore.loadSession("mgrsess-000001");
    expect(persistedSession?.controlMode).toBe("graphql-manager-message");
    expect(messages[0]?.message).toBe("Retry the worker stage after review.");
  });

  test("allocates collision-safe managerMessageIds for concurrent manager notes", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(root, session.sessionId);
    const service = createManagerMessageService({
      now: () => "2026-03-15T01:30:00.000Z",
      managerSessionStore: managerStore,
      communicationService: createCommunicationService({
        now: () => "2026-03-15T01:30:00.000Z",
        idempotencyStore: managerStore,
      }),
    });

    const [first, second] = await Promise.all([
      service.sendManagerMessage(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          managerSessionId: "mgrsess-000001",
          message: "First concurrent note.",
        },
        options,
      ),
      service.sendManagerMessage(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          managerSessionId: "mgrsess-000001",
          message: "Second concurrent note.",
        },
        options,
      ),
    ]);

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(first.managerMessageId).not.toBe(second.managerMessageId);

    const messages = await managerStore.listMessages("mgrsess-000001");
    expect(messages).toHaveLength(2);
    expect(new Set(messages.map((entry) => entry.managerMessageId)).size).toBe(
      2,
    );
  });

  test("rejects attachments outside the current workflow execution namespace", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(root, session.sessionId);
    const service = createManagerMessageService({
      now: () => "2026-03-15T01:45:00.000Z",
      managerSessionStore: managerStore,
      communicationService: createCommunicationService({
        now: () => "2026-03-15T01:45:00.000Z",
        idempotencyStore: managerStore,
      }),
    });

    const foreignAttachmentDir = path.join(
      options.rootDataDir,
      "files",
      "demo",
      "wfexec-foreign",
      "attachments",
    );
    await mkdir(foreignAttachmentDir, { recursive: true });
    await writeFile(
      path.join(foreignAttachmentDir, "foreign.txt"),
      "foreign",
      "utf8",
    );

    await expect(
      service.sendManagerMessage(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          managerSessionId: "mgrsess-000001",
          message: "Inspect the unrelated file.",
          attachments: [
            {
              path: "files/demo/wfexec-foreign/attachments/foreign.txt",
              mediaType: "text/plain",
            },
          ],
        },
        options,
      ),
    ).rejects.toThrow(
      `attachment path must stay within files/demo/${session.sessionId}/`,
    );
  });

  test("replays a communication from a manager message with canonicalized action idempotency", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(root, session.sessionId);
    const service = createManagerMessageService({
      now: () => "2026-03-15T02:00:00.000Z",
      managerSessionStore: managerStore,
      communicationService: createCommunicationService({
        now: () => "2026-03-15T02:00:00.000Z",
        idempotencyStore: managerStore,
      }),
    });

    const sourceCommunication = session.communications.at(-1);
    expect(sourceCommunication).toBeDefined();
    if (sourceCommunication === undefined) {
      return;
    }

    const result = await service.sendManagerMessage(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        managerSessionId: "mgrsess-000001",
        message: "Replay the last delivery.",
        actions: [
          {
            type: "replay-communication",
            communicationId: sourceCommunication.communicationId,
            reason: "",
          },
        ],
        idempotencyKey: "idem-replay-last-delivery",
      },
      options,
    );

    expect(result.accepted).toBe(true);
    expect(result.createdCommunicationIds).toHaveLength(1);
    expect(result.parsedIntent[0]?.kind).toBe("replay-communication");

    const loaded = await loadSession(session.sessionId, options);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(
      loaded.value.communications.some(
        (entry) =>
          entry.communicationId === result.createdCommunicationIds[0] &&
          entry.replayedFromCommunicationId ===
            sourceCommunication.communicationId,
      ),
    ).toBe(true);

    const replayed = await service.sendManagerMessage(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        managerSessionId: "mgrsess-000001",
        message: "Replay the last delivery.",
        actions: [
          {
            type: "replay-communication",
            communicationId: sourceCommunication.communicationId,
          },
        ],
        idempotencyKey: "idem-replay-last-delivery",
      },
      options,
    );

    expect(replayed).toEqual(result);
  });

  test("applies optional-node execute/skip actions through manager messages", async () => {
    const root = await makeTempDir();
    const workflowName = "optional-manager-message";
    const sessionId = "wfexec-optional-manager-message";
    await createOptionalDecisionWorkflowFixture(root, workflowName);
    await createPendingOptionalDecisionSession({
      root,
      workflowName,
      sessionId,
    });

    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const managerStore = await createManagerSession(
      root,
      sessionId,
      "divedra-manager",
      workflowName,
    );
    const service = createManagerMessageService({
      now: () => "2026-03-15T04:15:00.000Z",
      managerSessionStore: managerStore,
    });

    const accepted = await service.sendManagerMessage(
      {
        workflowId: workflowName,
        workflowExecutionId: sessionId,
        managerSessionId: "mgrsess-000001",
        message: "Execute step-1 and skip step-2.",
        actions: [
          { type: "execute-optional-step", stepId: "step-1" },
          {
            type: "skip-optional-step",
            stepId: "step-2",
            reason: "already covered by another branch",
          },
        ],
      },
      options,
    );

    expect(accepted.accepted).toBe(true);
    expect(accepted.queuedNodeIds).toEqual(["step-1", "step-2"]);
    expect(accepted.parsedIntent).toEqual([
      { kind: "execute-optional-step", targetId: "step-1" },
      {
        kind: "skip-optional-step",
        targetId: "step-2",
        reason: "already covered by another branch",
      },
    ]);

    const loaded = await loadSession(sessionId, options);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    expect(loaded.value.queue).toEqual(["step-1", "step-2"]);
    expect(loaded.value.pendingOptionalNodeDecisions).toEqual([
      {
        nodeId: "step-1",
        owningManagerStepId: "divedra-manager",
        requestedAt: "2026-03-15T04:00:00.000Z",
        status: "execute",
        decidedAt: "2026-03-15T04:15:00.000Z",
        decidedByNodeExecId: "exec-000001",
      },
      {
        nodeId: "step-2",
        owningManagerStepId: "divedra-manager",
        requestedAt: "2026-03-15T04:00:00.000Z",
        status: "skip",
        reason: "already covered by another branch",
        decidedAt: "2026-03-15T04:15:00.000Z",
        decidedByNodeExecId: "exec-000001",
      },
    ]);
  });
});
