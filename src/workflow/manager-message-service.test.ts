import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { MockNodeScenario } from "./adapter";
import { createCommunicationService } from "./communication-service";
import { createWorkflowTemplate } from "./create";
import { runWorkflow } from "./engine";
import {
  createManagerSessionStore,
  hashManagerAuthToken,
} from "./manager-session-store";
import { createManagerMessageService } from "./manager-message-service";
import { loadSession } from "./session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "oyakata-manager-message-service-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

function makeDefaultTemplateScenario(): MockNodeScenario {
  return {
    "oyakata-manager": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "design" },
    },
    "main-oyakata": {
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
  managerNodeId = "oyakata-manager",
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

describe("manager-message-service", () => {
  test("canonicalizes idempotent manager-message inputs before hashing", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "main-oyakata",
    );
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
        message: "  Retry the input stage after review.  ",
        actions: [{ type: "retry-node", nodeId: "workflow-input" }],
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
    expect(accepted.queuedNodeIds).toEqual(["workflow-input"]);
    expect(accepted.createdCommunicationIds).toEqual([]);
    expect(accepted.parsedIntent[0]?.kind).toBe("retry-node");

    const loaded = await loadSession(session.sessionId, options);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.status).toBe("running");
    expect(loaded.value.queue).toContain("workflow-input");

    const replayed = await service.sendManagerMessage(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        managerSessionId: "mgrsess-000001",
        message: "Retry the input stage after review.",
        actions: [{ type: "retry-node", nodeId: "workflow-input" }],
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
    expect(messages[0]?.message).toBe("Retry the input stage after review.");
  });

  test("allocates collision-safe managerMessageIds for concurrent manager notes", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "main-oyakata",
    );
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
    expect(
      new Set(messages.map((entry) => entry.managerMessageId)).size,
    ).toBe(2);
  });

  test("rejects attachments outside the current workflow execution namespace", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "main-oyakata",
    );
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
    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "main-oyakata",
    );
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

  test("rejects replay actions outside the sub-oyakata-manager owned communication scope", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "main-oyakata",
    );
    const service = createManagerMessageService({
      now: () => "2026-03-15T02:15:00.000Z",
      managerSessionStore: managerStore,
      communicationService: createCommunicationService({
        now: () => "2026-03-15T02:15:00.000Z",
        idempotencyStore: managerStore,
      }),
    });

    const rootScopedCommunication = session.communications.find(
      (entry) => entry.communicationId === "comm-000001",
    );
    expect(rootScopedCommunication).toBeDefined();
    if (rootScopedCommunication === undefined) {
      return;
    }

    const rejected = await service.sendManagerMessage(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        managerSessionId: "mgrsess-000001",
        message: "Replay the root-scoped delivery.",
        actions: [
          {
            type: "replay-communication",
            communicationId: rootScopedCommunication.communicationId,
          },
        ],
      },
      options,
    );

    expect(rejected.accepted).toBe(false);
    expect(rejected.createdCommunicationIds).toEqual([]);
    expect(rejected.rejectionReason).toContain(
      "must stay within sub-workflow 'main'",
    );
  });

  test("accepts queue-only start-sub-workflow actions without mailbox materialization", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(root, session.sessionId);
    const service = createManagerMessageService({
      now: () => "2026-03-15T02:30:00.000Z",
      managerSessionStore: managerStore,
    });

    const accepted = await service.sendManagerMessage(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        managerSessionId: "mgrsess-000001",
        message: "Re-run the main sub-workflow.",
        actions: [{ type: "start-sub-workflow", subWorkflowId: "main" }],
      },
      options,
    );

    expect(accepted.accepted).toBe(true);
    expect(accepted.createdCommunicationIds).toEqual([]);
    expect(accepted.queuedNodeIds).toEqual(["main-oyakata"]);
    expect(accepted.parsedIntent[0]?.kind).toBe("start-sub-workflow");
    expect(accepted.parsedIntent[0]?.targetId).toBe("main");

    const loaded = await loadSession(session.sessionId, options);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.status).toBe("running");
    expect(loaded.value.queue).toContain("main-oyakata");

    const messages = await managerStore.listMessages("mgrsess-000001");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.accepted).toBe(true);
  });

  test("delivers manager-authored child-input messages with durable provenance", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "main-oyakata",
    );
    const service = createManagerMessageService({
      now: () => "2026-03-15T03:00:00.000Z",
      managerSessionStore: managerStore,
    });

    await writeFile(
      path.join(root, "demo", "node-workflow-input.json"),
      `${JSON.stringify(
        {
          id: "workflow-input",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "Normalize the received sub-workflow instruction",
          variables: {},
          argumentsTemplate: { routed: { message: "" } },
          argumentBindings: [
            {
              targetPath: "routed.message",
              source: "node-output",
              sourceRef: "main-oyakata",
              sourcePath: "output.payload.message",
              required: true,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const accepted = await service.sendManagerMessage(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        managerSessionId: "mgrsess-000001",
        message: "Forward this to the child input.",
        actions: [
          { type: "deliver-to-child-input", inputNodeId: "workflow-input" },
        ],
      },
      options,
    );

    expect(accepted.accepted).toBe(true);
    expect(accepted.createdCommunicationIds).toHaveLength(1);
    expect(accepted.queuedNodeIds).toEqual(["workflow-input"]);

    const loaded = await loadSession(session.sessionId, options);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const createdCommunication = loaded.value.communications.find(
      (entry) => entry.communicationId === accepted.createdCommunicationIds[0],
    );
    expect(createdCommunication?.managerMessageId).toBe(
      accepted.managerMessageId,
    );
    expect(createdCommunication?.payloadRef.kind).toBe("manager-message");
    expect(createdCommunication?.sourceNodeExecId).toBe("exec-000001");

    const managerArtifactRaw = await Bun.file(
      path.join(
        options.artifactRoot,
        "demo",
        "executions",
        session.sessionId,
        "manager-sessions",
        "mgrsess-000001",
        "messages",
        accepted.managerMessageId,
        "message.json",
      ),
    ).text();
    expect(managerArtifactRaw).toContain('"accepted": true');
    expect(managerArtifactRaw).toContain("Forward this to the child input.");

    const messages = await managerStore.listMessages("mgrsess-000001");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.accepted).toBe(true);
  });
});
