import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
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
import {
  listWorkflowMessagesFromRuntimeDb,
  loadWorkflowMessageFromRuntimeDb,
  workflowMessageRecordToCommunication,
} from "./runtime-db";
import { loadSession, saveSession } from "./session-store";
import type { WorkflowSessionState } from "./session";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-communication-service-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

function makeDefaultTemplateScenario(): MockNodeScenario {
  return {
    "rielflow-manager": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "design" },
    },
    "main-rielflow": {
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
  managerStepId = "rielflow-manager",
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

  test("prefers sqlite message rows when session communications are missing", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const communication = session.communications.at(-1);
    expect(communication).toBeDefined();
    if (communication === undefined) {
      return;
    }
    const stripped: WorkflowSessionState = {
      ...session,
      communications: session.communications.filter(
        (entry) => entry.communicationId !== communication.communicationId,
      ),
    };
    const saved = await saveSession(stripped, options);
    expect(saved.ok).toBe(true);

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
    expect(view?.artifactSnapshot.messageJson).toContain(
      communication.communicationId,
    );
  });

  test("no legacy file fallback and no session array fallback: ignores communication without a sqlite row", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const communication = session.communications.at(-1);
    expect(communication).toBeDefined();
    if (communication === undefined) {
      return;
    }
    await mkdir(communication.artifactDir, { recursive: true });
    await writeFile(
      path.join(communication.artifactDir, "message.json"),
      `${JSON.stringify({ communicationId: communication.communicationId })}\n`,
      "utf8",
    );
    const saved = await saveSession(session, options);
    expect(saved.ok).toBe(true);

    const db = new Database(path.join(options.rootDataDir, "rielflow.db"));
    try {
      db.query(
        "DELETE FROM workflow_messages WHERE workflow_execution_id = ? AND communication_id = ?",
      ).run(session.sessionId, communication.communicationId);
    } finally {
      db.close();
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

    expect(view).toBeNull();
  });

  test("replays a sqlite-backed communication when session communications are missing", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const communication = session.communications.at(-1);
    expect(communication).toBeDefined();
    if (communication === undefined) {
      return;
    }
    const stripped: WorkflowSessionState = {
      ...session,
      communications: session.communications.filter(
        (entry) => entry.communicationId !== communication.communicationId,
      ),
    };
    const saved = await saveSession(stripped, options);
    expect(saved.ok).toBe(true);

    const service = createCommunicationService();
    const replayed = await service.replayCommunication(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: communication.communicationId,
        reason: "sqlite-backed replay",
      },
      options,
    );

    expect(replayed.sourceCommunicationId).toBe(communication.communicationId);
    const sqliteSource = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: session.sessionId,
        communicationId: communication.communicationId,
      },
      options,
    );
    expect(sqliteSource?.status).toBe("superseded");
    expect(sqliteSource?.supersededByCommunicationId).toBe(
      replayed.replayedCommunicationId,
    );
    const sqliteReplay = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: session.sessionId,
        communicationId: replayed.replayedCommunicationId,
      },
      options,
    );
    expect(sqliteReplay?.replayedFromCommunicationId).toBe(
      communication.communicationId,
    );
    const reloaded = await loadSession(session.sessionId, options);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }
    expect(
      reloaded.value.communications.some(
        (entry) => entry.communicationId === replayed.replayedCommunicationId,
      ),
    ).toBe(true);
  });

  test("replays with stale session communication counter without overwriting sqlite source row", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const communication = session.communications.at(0);
    expect(communication).toBeDefined();
    if (communication === undefined) {
      return;
    }
    const stripped: WorkflowSessionState = {
      ...session,
      communications: [],
      communicationCounter: 0,
    };
    const saved = await saveSession(stripped, options);
    expect(saved.ok).toBe(true);

    const service = createCommunicationService();
    const replayed = await service.replayCommunication(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: communication.communicationId,
        reason: "stale counter sqlite-backed replay",
      },
      options,
    );

    expect(replayed.replayedCommunicationId).not.toBe(
      communication.communicationId,
    );
    const sqliteSource = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: session.sessionId,
        communicationId: communication.communicationId,
      },
      options,
    );
    expect(sqliteSource?.status).toBe("superseded");
    expect(sqliteSource?.supersededByCommunicationId).toBe(
      replayed.replayedCommunicationId,
    );
    const sqliteReplay = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: session.sessionId,
        communicationId: replayed.replayedCommunicationId,
      },
      options,
    );
    expect(sqliteReplay?.replayedFromCommunicationId).toBe(
      communication.communicationId,
    );
    const sqliteMessages = await listWorkflowMessagesFromRuntimeDb(
      { workflowExecutionId: session.sessionId },
      options,
    );
    expect(sqliteMessages.map((message) => message.communicationId)).toEqual(
      expect.arrayContaining([
        communication.communicationId,
        replayed.replayedCommunicationId,
      ]),
    );
    const reloaded = await loadSession(session.sessionId, options);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }
    expect(reloaded.value.communicationCounter).toBeGreaterThan(0);
  });

  test("concurrent replays allocate distinct sqlite communication ids", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const sourceCommunications = session.communications.slice(0, 2);
    expect(sourceCommunications).toHaveLength(2);
    const [firstSource, secondSource] = sourceCommunications;
    if (firstSource === undefined || secondSource === undefined) {
      return;
    }
    const stripped: WorkflowSessionState = {
      ...session,
      communications: [],
      communicationCounter: 0,
    };
    const saved = await saveSession(stripped, options);
    expect(saved.ok).toBe(true);

    const service = createCommunicationService();
    const [firstReplay, secondReplay] = await Promise.all([
      service.replayCommunication(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: firstSource.communicationId,
          reason: "first concurrent replay",
        },
        options,
      ),
      service.replayCommunication(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: secondSource.communicationId,
          reason: "second concurrent replay",
        },
        options,
      ),
    ]);

    expect(firstReplay.replayedCommunicationId).not.toBe(
      secondReplay.replayedCommunicationId,
    );
    const sqliteMessages = await listWorkflowMessagesFromRuntimeDb(
      { workflowExecutionId: session.sessionId },
      options,
    );
    expect(sqliteMessages.map((message) => message.communicationId)).toEqual(
      expect.arrayContaining([
        firstSource.communicationId,
        secondSource.communicationId,
        firstReplay.replayedCommunicationId,
        secondReplay.replayedCommunicationId,
      ]),
    );
    expect(
      sqliteMessages.find(
        (message) => message.communicationId === firstSource.communicationId,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "superseded",
        supersededByCommunicationId: firstReplay.replayedCommunicationId,
      }),
    );
    expect(
      sqliteMessages.find(
        (message) => message.communicationId === secondSource.communicationId,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "superseded",
        supersededByCommunicationId: secondReplay.replayedCommunicationId,
      }),
    );
    const replayMessages = sqliteMessages.filter((message) =>
      [
        firstReplay.replayedCommunicationId,
        secondReplay.replayedCommunicationId,
      ].includes(message.communicationId),
    );
    expect(replayMessages).toHaveLength(2);

    const reloaded = await loadSession(session.sessionId, options);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }
    expect(
      reloaded.value.communications.map(
        (communication) => communication.communicationId,
      ),
    ).toEqual(
      expect.arrayContaining([
        firstReplay.replayedCommunicationId,
        secondReplay.replayedCommunicationId,
      ]),
    );
  });

  test("failed replay save leaves source sqlite message delivered", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const sourceCommunication = session.communications.at(0);
    expect(sourceCommunication).toBeDefined();
    if (sourceCommunication === undefined) {
      return;
    }
    const db = new Database(path.join(options.rootDataDir, "rielflow.db"));
    try {
      db.query(
        [
          "UPDATE workflow_messages",
          "SET status = 'delivered', consumed_by_node_exec_id = NULL, consumed_at = NULL, payload_json = ?",
          "WHERE workflow_execution_id = ? AND communication_id = ?",
        ].join(" "),
      ).run(
        JSON.stringify({
          payload: {
            attachments: [
              {
                pathBase: "root-data",
                path: "missing-replay-source.txt",
              },
            ],
          },
        }),
        session.sessionId,
        sourceCommunication.communicationId,
      );
    } finally {
      db.close();
    }

    const service = createCommunicationService();
    await expect(
      service.replayCommunication(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: sourceCommunication.communicationId,
          reason: "force replay save failure",
        },
        options,
      ),
    ).rejects.toThrow("ENOENT");

    const sqliteSource = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: session.sessionId,
        communicationId: sourceCommunication.communicationId,
      },
      options,
    );
    expect(sqliteSource).toEqual(
      expect.objectContaining({
        status: "delivered",
        supersededByCommunicationId: null,
      }),
    );
    const sqliteMessages = await listWorkflowMessagesFromRuntimeDb(
      { workflowExecutionId: session.sessionId },
      options,
    );
    expect(
      sqliteMessages.some(
        (message) =>
          message.replayedFromCommunicationId ===
          sourceCommunication.communicationId,
      ),
    ).toBe(false);
  });

  test("retries a sqlite-backed communication when session communications are missing", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const sourceCommunication = session.communications.at(-1);
    expect(sourceCommunication).toBeDefined();
    if (sourceCommunication === undefined) {
      return;
    }
    const service = createCommunicationService();
    const replayed = await service.replayCommunication(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: sourceCommunication.communicationId,
        reason: "create sqlite-backed retry target",
      },
      options,
    );
    const replayedSqliteRecord = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: session.sessionId,
        communicationId: replayed.replayedCommunicationId,
      },
      options,
    );
    expect(replayedSqliteRecord).not.toBeNull();
    if (replayedSqliteRecord === null) {
      return;
    }
    const replayedCommunication =
      workflowMessageRecordToCommunication(replayedSqliteRecord);
    const stripped: WorkflowSessionState = {
      ...session,
      communications: session.communications.filter(
        (entry) =>
          entry.communicationId !== replayedCommunication.communicationId,
      ),
    };
    const saved = await saveSession(stripped, options);
    expect(saved.ok).toBe(true);

    const retried = await service.retryCommunicationDelivery(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: replayedCommunication.communicationId,
        reason: "sqlite-backed retry",
      },
      options,
    );

    expect(retried.communicationId).toBe(replayedCommunication.communicationId);
    expect(retried.activeDeliveryAttemptId).not.toBe(
      replayedCommunication.activeDeliveryAttemptId,
    );
    const sqliteMessage = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: session.sessionId,
        communicationId: replayedCommunication.communicationId,
      },
      options,
    );
    expect(sqliteMessage?.activeDeliveryAttemptId).toBe(
      retried.activeDeliveryAttemptId,
    );
    expect(sqliteMessage?.activeDeliveryAttemptId).toBe(
      retried.activeDeliveryAttemptId,
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
      "main-rielflow",
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

    const sqliteSource = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: session.sessionId,
        communicationId: sourceCommunication.communicationId,
      },
      options,
    );
    const sqliteReplay = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: session.sessionId,
        communicationId: replayed.replayedCommunicationId,
      },
      options,
    );
    expect(sqliteSource?.status).toBe("superseded");
    expect(sqliteSource?.supersededByCommunicationId).toBe(
      replayed.replayedCommunicationId,
    );
    expect(sqliteReplay?.replayedFromCommunicationId).toBe(
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
      session.communicationCounter + 1,
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

  test("concurrent same-key replays reuse one durable communication side effect", async () => {
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
      "main-rielflow",
    );
    const service = createCommunicationService({
      idempotencyStore: managerStore,
    });

    const [first, second] = await Promise.all([
      service.replayCommunication(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: sourceCommunication.communicationId,
          managerSessionId: "mgrsess-000001",
          idempotencyKey: "idem-concurrent-replay",
          reason: "same concurrent replay",
        },
        options,
      ),
      service.replayCommunication(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: sourceCommunication.communicationId,
          managerSessionId: "mgrsess-000001",
          idempotencyKey: "idem-concurrent-replay",
          reason: "same concurrent replay",
        },
        options,
      ),
    ]);

    expect(second).toEqual(first);
    const sqliteMessages = await listWorkflowMessagesFromRuntimeDb(
      { workflowExecutionId: session.sessionId },
      options,
    );
    expect(
      sqliteMessages.filter(
        (message) =>
          message.replayedFromCommunicationId ===
          sourceCommunication.communicationId,
      ),
    ).toHaveLength(1);

    const loadedAfterSecondCall = await loadSession(session.sessionId, options);
    expect(loadedAfterSecondCall.ok).toBe(true);
    if (!loadedAfterSecondCall.ok) {
      return;
    }
    expect(loadedAfterSecondCall.value.communicationCounter).toBe(
      session.communicationCounter + 1,
    );

    await expect(
      service.replayCommunication(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: sourceCommunication.communicationId,
          managerSessionId: "mgrsess-000001",
          idempotencyKey: "idem-concurrent-replay",
          reason: "changed concurrent replay",
        },
        options,
      ),
    ).rejects.toThrow("idempotency conflict");
  });

  test("failed same-key replays reuse the stored failure without stale pending timeout", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "main-rielflow",
    );
    const service = createCommunicationService({
      idempotencyStore: managerStore,
    });
    const beforeMessages = await listWorkflowMessagesFromRuntimeDb(
      { workflowExecutionId: session.sessionId },
      options,
    );
    const input = {
      workflowId: "demo",
      workflowExecutionId: session.sessionId,
      communicationId: "comm-missing",
      managerSessionId: "mgrsess-000001",
      idempotencyKey: "idem-failed-replay",
      reason: "missing communication",
    } as const;

    await expect(service.replayCommunication(input, options)).rejects.toThrow(
      "communication 'comm-missing' was not found",
    );
    await expect(service.replayCommunication(input, options)).rejects.toThrow(
      "communication 'comm-missing' was not found",
    );
    const afterMessages = await listWorkflowMessagesFromRuntimeDb(
      { workflowExecutionId: session.sessionId },
      options,
    );
    expect(afterMessages).toHaveLength(beforeMessages.length);
    const idempotent = await managerStore.loadIdempotentResult({
      mutationName: "replayCommunication",
      managerSessionId: "mgrsess-000001",
      idempotencyKey: "idem-failed-replay",
    });
    expect(idempotent).toMatchObject({
      status: "failed",
      normalizedRequestHash: expect.stringMatching(/^sha256:/),
    });
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
      "main-rielflow",
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

    const sqliteMessage = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: session.sessionId,
        communicationId: replayed.replayedCommunicationId,
      },
      options,
    );
    expect(sqliteMessage?.activeDeliveryAttemptId).toBe("attempt-000002");
    expect(sqliteMessage?.deliveryAttemptIdsJson).toBe(
      JSON.stringify(["attempt-000001", "attempt-000002"]),
    );

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
      "rielflow-manager",
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
      managerStepId: "rielflow-manager",
      managerNodeExecId: "exec-000001",
      message: "Deliver this updated brief.",
      attachments: [],
      actions: [],
    });
    const communication = await persistManagerMessageCommunication({
      artifactWorkflowRoot: loadedWf.value.artifactWorkflowRoot,
      workflowId: "demo",
      workflowExecutionId: session.sessionId,
      communicationCounter: 0,
      managerMessageId,
      managerStepId: "rielflow-manager",
      managerNodeExecId: "exec-000001",
      targetNodeId: "main-worker",
      payloadRef: artifacts.payloadRef,
      outputRaw: artifacts.outputRaw,
      createdAt: "2026-03-15T04:00:00.000Z",
      runtimeLogOptions: options,
    });
    expect(
      session.communications.some(
        (entry) => entry.communicationId === communication.communicationId,
      ),
    ).toBe(false);
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

    const replayedRecord = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: session.sessionId,
        communicationId: replayed.replayedCommunicationId,
      },
      options,
    );
    expect(replayedRecord).not.toBeNull();
    const replayedCommunication =
      replayedRecord === null
        ? null
        : workflowMessageRecordToCommunication(replayedRecord);
    expect(replayedCommunication?.payloadRef.kind).toBe("manager-message");
    expect(replayedCommunication?.replayedFromCommunicationId).toBe(
      sourceCommunicationId,
    );
  });
});
