import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { MockNodeScenario } from "./scenario-adapter";
import { createWorkflowTemplate } from "./create";
import { runWorkflow } from "./engine";
import { createCommunicationService } from "./communication-service";
import {
  createManagerSessionStore,
  hashManagerAuthToken,
} from "./manager-session-store";
import {
  mergeLoadOptionsForSessionMutableBundle,
  loadWorkflowFromDisk,
} from "./load";
import { createManagerMessageId } from "./manager-message-service/idempotency";
import {
  prepareManagerMessageArtifacts,
  persistManagerMessageCommunication,
} from "./manager-message-service/artifacts";
import { loadSession, saveSession } from "./session-store";
import type { WorkflowSessionState } from "./session";

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

async function createManagerSession(
  root: string,
  workflowExecutionId: string,
  managerStepId = "divedra-manager",
) {
  const store = createManagerSessionStore({
    cwd: root,
    rootDataDir: path.join(root, "data"),
  });
  await store.createOrResumeSession({
    managerSessionId: "mgrsess-000001",
    workflowId: "demo",
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
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "divedra-manager",
    );
    const service = createCommunicationService({
      now: () => "2026-03-15T04:05:00.000Z",
      idempotencyStore: managerStore,
    });

    const loadedWf = await loadWorkflowFromDisk(
      "demo",
      mergeLoadOptionsForSessionMutableBundle(options, session),
    );
    if (!loadedWf.ok) {
      throw new Error(loadedWf.error.message);
    }
    const managerMessageId = createManagerMessageId();
    const artifacts = await prepareManagerMessageArtifacts({
      artifactWorkflowRoot: loadedWf.value.artifactWorkflowRoot,
      workflowId: "demo",
      workflowExecutionId: session.sessionId,
      managerSessionId: "mgrsess-000001",
      managerMessageId,
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      message: "Deliver this updated brief.",
      attachments: [],
      actions: [],
    });
    const communication = await persistManagerMessageCommunication({
      artifactWorkflowRoot: loadedWf.value.artifactWorkflowRoot,
      workflowId: "demo",
      workflowExecutionId: session.sessionId,
      communicationCounter: session.communicationCounter,
      managerMessageId,
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      targetNodeId: "main-worker",
      payloadRef: artifacts.payloadRef,
      outputRaw: artifacts.outputRaw,
      createdAt: "2026-03-15T04:00:00.000Z",
    });
    const seeded: WorkflowSessionState = {
      ...session,
      communications: [...session.communications, communication],
      communicationCounter: session.communicationCounter + 1,
    };
    const saveResult = await saveSession(seeded, options);
    expect(saveResult.ok).toBe(true);

    const sourceCommunicationId = communication.communicationId;

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
