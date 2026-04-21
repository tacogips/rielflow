import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { MockNodeScenario } from "./adapter";
import { createWorkflowTemplate } from "./create";
import { runWorkflow } from "./engine";
import { createCommunicationService } from "./communication-service";
import {
  createManagerSessionStore,
  hashManagerAuthToken,
} from "./manager-session-store";
import { createManagerMessageService } from "./manager-message-service";
import { loadSession } from "./session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-communication-service-test-"),
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
    "main-divedra": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "dispatch" },
    },
    "workflow-input": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "implement" },
    },
    "workflow-output": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "review" },
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

async function createCompletedSubworkflowFixture(root: string) {
  const workflowDir = path.join(root, "demo");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: "demo",
        description: "subworkflow communication fixture",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        prompts: {
          divedraPromptTemplate: "Coordinate {{workflowId}}",
          workerSystemPromptTemplate:
            "Work only on the current node responsibility.",
        },
        managerNodeId: "divedra-manager",
        subWorkflows: [
          {
            id: "main",
            description: "Main sub-workflow",
            managerNodeId: "main-divedra",
            inputNodeId: "workflow-input",
            outputNodeId: "workflow-output",
            nodeIds: ["main-divedra", "workflow-input", "workflow-output"],
            inputSources: [{ type: "human-input" }],
            block: { type: "plain" },
          },
        ],
        nodes: [
          {
            id: "divedra-manager",
            kind: "root-manager",
            nodeFile: "node-divedra-manager.json",
          },
          {
            id: "main-divedra",
            kind: "subworkflow-manager",
            nodeFile: "node-main-divedra.json",
          },
          {
            id: "workflow-input",
            kind: "input",
            nodeFile: "node-workflow-input.json",
          },
          {
            id: "workflow-output",
            kind: "output",
            nodeFile: "node-workflow-output.json",
          },
        ],
        edges: [
          { from: "workflow-input", to: "workflow-output", when: "always" },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const nodePayloads = {
    "node-divedra-manager.json": {
      id: "divedra-manager",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "manager",
      variables: {},
    },
    "node-main-divedra.json": {
      id: "main-divedra",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "sub manager",
      variables: {},
    },
    "node-workflow-input.json": {
      id: "workflow-input",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "input",
      variables: {},
    },
    "node-workflow-output.json": {
      id: "workflow-output",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "output",
      variables: {},
    },
  } as const;

  await Promise.all(
    Object.entries(nodePayloads).map(([fileName, payload]) =>
      writeFile(
        path.join(workflowDir, fileName),
        `${JSON.stringify(payload, null, 2)}\n`,
        "utf8",
      ),
    ),
  );

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
  managerNodeId = "divedra-manager",
) {
  const store = createManagerSessionStore({
    cwd: root,
    rootDataDir: path.join(root, "data"),
  });
  await store.createOrResumeSession({
    managerSessionId: "mgrsess-000001",
    workflowId: "demo",
    workflowExecutionId,
    managerNodeId,
    managerNodeExecId: "exec-000001",
    status: "active",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    authTokenHash: hashManagerAuthToken("secret"),
    authTokenExpiresAt: "2026-03-16T00:00:00.000Z",
  });
  return store;
}

describe("communication-service", () => {
  test("loads a communication view with artifact snapshots", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const communication = session.communications.at(-1);
    expect(communication).toBeDefined();
    if (communication === undefined) {
      return;
    }

    const service = createCommunicationService();
    const view = await service.getCommunication(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: communication.communicationId,
      },
      options,
    );

    expect(view?.record.communicationId).toBe(communication.communicationId);
    expect(view?.sourceNodeExecution?.nodeExecId).toBe(
      communication.sourceNodeExecId,
    );
    expect(view?.artifactSnapshot.metaJson).toContain(
      communication.communicationId,
    );
    expect(view?.artifactSnapshot.attemptFiles).toHaveLength(1);
    expect(view?.artifactSnapshot.attemptFiles[0]?.attemptJson).toContain(
      communication.communicationId,
    );
  });

  test("replays a communication with idempotent reuse and conflict detection", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const sourceCommunication = session.communications.at(-1);
    expect(sourceCommunication).toBeDefined();
    if (sourceCommunication === undefined) {
      return;
    }

    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "main-divedra",
    );
    const service = createCommunicationService({
      idempotencyStore: managerStore,
    });

    const replayed = await service.replayCommunication(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: sourceCommunication.communicationId,
        managerSessionId: "mgrsess-000001",
        idempotencyKey: "idem-replay",
        reason: "retry after review",
      },
      options,
    );
    expect(replayed.replayedCommunicationId).not.toBe(
      sourceCommunication.communicationId,
    );

    const loadedAfterReplay = await loadSession(session.sessionId, options);
    expect(loadedAfterReplay.ok).toBe(true);
    if (!loadedAfterReplay.ok) {
      return;
    }
    const updatedSource = loadedAfterReplay.value.communications.find(
      (entry) => entry.communicationId === sourceCommunication.communicationId,
    );
    const replayedRecord = loadedAfterReplay.value.communications.find(
      (entry) => entry.communicationId === replayed.replayedCommunicationId,
    );
    expect(updatedSource?.status).toBe("superseded");
    expect(updatedSource?.supersededByCommunicationId).toBe(
      replayed.replayedCommunicationId,
    );
    expect(replayedRecord?.replayedFromCommunicationId).toBe(
      sourceCommunication.communicationId,
    );

    const replayedAgain = await service.replayCommunication(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: sourceCommunication.communicationId,
        managerSessionId: "mgrsess-000001",
        idempotencyKey: "idem-replay",
        reason: "retry after review",
      },
      options,
    );
    expect(replayedAgain).toEqual(replayed);

    const loadedAfterSecondCall = await loadSession(session.sessionId, options);
    expect(loadedAfterSecondCall.ok).toBe(true);
    if (!loadedAfterSecondCall.ok) {
      return;
    }
    expect(loadedAfterSecondCall.value.communicationCounter).toBe(
      loadedAfterReplay.value.communicationCounter,
    );

    await expect(
      service.replayCommunication(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: sourceCommunication.communicationId,
          managerSessionId: "mgrsess-000001",
          idempotencyKey: "idem-replay",
          reason: "changed reason",
        },
        options,
      ),
    ).rejects.toThrow("idempotency conflict");
  });

  test("retries communication delivery with a new delivery attempt id", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const sourceCommunication = session.communications.at(-1);
    expect(sourceCommunication).toBeDefined();
    if (sourceCommunication === undefined) {
      return;
    }

    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "main-divedra",
    );
    const service = createCommunicationService({
      idempotencyStore: managerStore,
    });

    const replayed = await service.replayCommunication(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: sourceCommunication.communicationId,
        managerSessionId: "mgrsess-000001",
        reason: "create retryable communication",
      },
      options,
    );

    const retried = await service.retryCommunicationDelivery(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: replayed.replayedCommunicationId,
        managerSessionId: "mgrsess-000001",
        idempotencyKey: "idem-retry",
        reason: "re-deliver for inspection",
      },
      options,
    );
    expect(retried.activeDeliveryAttemptId).toBe("attempt-000002");

    const loadedAfterRetry = await loadSession(session.sessionId, options);
    expect(loadedAfterRetry.ok).toBe(true);
    if (!loadedAfterRetry.ok) {
      return;
    }
    const updatedCommunication = loadedAfterRetry.value.communications.find(
      (entry) => entry.communicationId === replayed.replayedCommunicationId,
    );
    expect(updatedCommunication?.deliveryAttemptIds).toEqual([
      "attempt-000001",
      "attempt-000002",
    ]);

    const retriedAgain = await service.retryCommunicationDelivery(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: replayed.replayedCommunicationId,
        managerSessionId: "mgrsess-000001",
        idempotencyKey: "idem-retry",
        reason: "re-deliver for inspection",
      },
      options,
    );
    expect(retriedAgain).toEqual(retried);

    await expect(
      service.retryCommunicationDelivery(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: replayed.replayedCommunicationId,
          managerSessionId: "mgrsess-000001",
          idempotencyKey: "idem-retry",
          reason: "different retry reason",
        },
        options,
      ),
    ).rejects.toThrow("idempotency conflict");
  });

  test("replays a manager-message-originated communication", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedSubworkflowFixture(root);
    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "main-divedra",
    );
    const managerMessageService = createManagerMessageService({
      now: () => "2026-03-15T04:00:00.000Z",
      managerSessionStore: managerStore,
    });
    const service = createCommunicationService({
      now: () => "2026-03-15T04:05:00.000Z",
      idempotencyStore: managerStore,
    });

    const sent = await managerMessageService.sendManagerMessage(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        managerSessionId: "mgrsess-000001",
        message: "Deliver this updated brief.",
        actions: [
          { type: "deliver-to-child-input", inputNodeId: "workflow-input" },
        ],
      },
      options,
    );
    expect(sent.accepted).toBe(true);
    const sourceCommunicationId = sent.createdCommunicationIds[0];
    expect(sourceCommunicationId).toBeDefined();
    if (sourceCommunicationId === undefined) {
      return;
    }

    const replayed = await service.replayCommunication(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: sourceCommunicationId,
        managerSessionId: "mgrsess-000001",
        idempotencyKey: "idem-manager-replay",
        reason: "inspect manager-originated replay",
      },
      options,
    );

    const loadedAfterReplay = await loadSession(session.sessionId, options);
    expect(loadedAfterReplay.ok).toBe(true);
    if (!loadedAfterReplay.ok) {
      return;
    }
    const replayedRecord = loadedAfterReplay.value.communications.find(
      (entry) => entry.communicationId === replayed.replayedCommunicationId,
    );
    expect(replayedRecord?.payloadRef.kind).toBe("manager-message");
    expect(replayedRecord?.replayedFromCommunicationId).toBe(
      sourceCommunicationId,
    );
  });
});
