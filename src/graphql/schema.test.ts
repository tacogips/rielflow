import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { MockNodeScenario } from "../workflow/adapter";
import { createWorkflowTemplate } from "../workflow/create";
import { runWorkflow } from "../workflow/engine";
import {
  createManagerSessionStore,
  hashManagerAuthToken,
} from "../workflow/manager-session-store";
import { createGraphqlSchema } from "./schema";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-graphql-schema-test-"),
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
  managerNodeId = "main-divedra",
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

describe("createGraphqlSchema", () => {
  test("exposes workflow, workflowExecution, communication, communications, and nodeExecution views", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const schema = createGraphqlSchema();

    const workflow = await schema.query.workflow(
      { workflowName: "demo" },
      options,
    );
    expect(workflow?.workflowId).toBe("demo");

    const workflowExecution = await schema.query.workflowExecution(
      { workflowExecutionId: session.sessionId },
      options,
    );
    expect(workflowExecution?.session.sessionId).toBe(session.sessionId);
    expect(workflowExecution?.nodeExecutions.length).toBeGreaterThan(0);

    const communicationRecord = session.communications.at(-1);
    expect(communicationRecord).toBeDefined();
    if (communicationRecord === undefined) {
      return;
    }

    const communication = await schema.query.communication(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        communicationId: communicationRecord.communicationId,
      },
      options,
    );
    expect(communication?.record.communicationId).toBe(
      communicationRecord.communicationId,
    );

    const connection = await schema.query.communications(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        first: 10,
      },
      options,
    );
    expect(connection.totalCount).toBeGreaterThan(0);
    expect(connection.items[0]?.record.workflowExecutionId).toBe(session.sessionId);

    const nodeExecutionRecord = session.nodeExecutions.at(-1);
    expect(nodeExecutionRecord).toBeDefined();
    if (nodeExecutionRecord === undefined) {
      return;
    }

    const nodeExecution = await schema.query.nodeExecution(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        nodeId: nodeExecutionRecord.nodeId,
        nodeExecId: nodeExecutionRecord.nodeExecId,
      },
      options,
    );
    expect(nodeExecution?.nodeExecId).toBe(nodeExecutionRecord.nodeExecId);
    expect(nodeExecution?.output).toContain(nodeExecutionRecord.nodeId);
    expect(nodeExecution?.recentLogs.length).toBeGreaterThan(0);
  });

  test("lists workflow execution summaries for browser session views", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const schema = createGraphqlSchema();

    const connection = await schema.query.workflowExecutions(
      {
        workflowName: "demo",
        first: 10,
      },
      options,
    );

    expect(connection.totalCount).toBeGreaterThan(0);
    expect(connection.items).toContainEqual(
      expect.objectContaining({
        workflowExecutionId: session.sessionId,
        sessionId: session.sessionId,
        workflowName: "demo",
      }),
    );
  });

  test("aggregates node detail and communication snapshots by workflow execution id", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const schema = createGraphqlSchema();

    const overview = await schema.query.workflowExecutionOverview(
      {
        workflowExecutionId: session.sessionId,
        recentLogLimit: 5,
        firstCommunications: 20,
      },
      options,
    );

    expect(overview?.workflowExecutionId).toBe(session.sessionId);
    expect(overview?.workflowId).toBe("demo");
    expect(overview?.workflowName).toBe("demo");
    expect(overview?.status).toBe(session.status);
    expect(overview?.nodes.length).toBe(session.nodeExecutions.length);
    expect(overview?.communications.totalCount).toBeGreaterThan(0);
    expect(overview?.nodeLogs.length).toBeGreaterThan(0);

    const nodeWithOutput = overview?.nodes.find((node) => node.output !== null);
    expect(nodeWithOutput?.output).toContain("stage");

    const communicationWithSnapshot = overview?.communications.items.find(
      (item) =>
        item.artifactSnapshot.outboxOutputRaw !== null &&
        item.artifactSnapshot.inboxMessageJson !== null,
    );
    expect(communicationWithSnapshot).toBeDefined();
    expect(communicationWithSnapshot?.artifactSnapshot.outboxOutputRaw).toContain(
      "\"payload\"",
    );
    expect(communicationWithSnapshot?.artifactSnapshot.inboxMessageJson).toContain(
      "\"communicationId\"",
    );
  });

  test("supports async browser execution inputs over GraphQL", async () => {
    const root = await makeTempDir();
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
    const schema = createGraphqlSchema();

    const payload = await schema.mutation.executeWorkflow(
      {
        workflowName: "demo",
        async: true,
        runtimeVariables: {
          humanInput: {
            request: "start demo workflow",
          },
        },
        mockScenario: makeDefaultTemplateScenario(),
      },
      options,
    );

    expect(payload.accepted).toBe(true);
    expect(payload.status).toBe("running");
    expect(payload.workflowExecutionId).toBe(payload.sessionId);
    expect(payload.exitCode).toBeUndefined();
  });

  test("lists and mutates workflow definitions for browser editor views", async () => {
    const root = await makeTempDir();
    const schema = createGraphqlSchema();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const created = await schema.mutation.createWorkflowDefinition(
      { workflowName: "demo" },
      options,
    );
    expect(created.workflowName).toBe("demo");
    expect(created.revision).toEqual(expect.any(String));

    const workflows = await schema.query.workflows({}, options);
    expect(workflows).toContain("demo");

    const loaded = await schema.query.workflowDefinition(
      { workflowName: "demo" },
      options,
    );
    expect(loaded?.bundle.workflow.workflowId).toBe("demo");

    const validBundle = cloneJson(created.bundle) as typeof created.bundle & {
      workflow: {
        description: string;
        nodes: unknown[];
      };
    };
    validBundle.workflow.description = "Updated through GraphQL";
    const saved = await schema.mutation.saveWorkflowDefinition(
      {
        workflowName: "demo",
        bundle: validBundle,
        ...(created.revision === null
          ? {}
          : { expectedRevision: created.revision }),
      },
      options,
    );
    expect(saved.error).toBeUndefined();
    expect(saved.revision).toEqual(expect.any(String));

    const invalidBundle = cloneJson(validBundle) as typeof validBundle;
    invalidBundle.workflow.nodes = [];
    const validation = await schema.mutation.validateWorkflowDefinition(
      {
        workflowName: "demo",
        bundle: invalidBundle,
      },
      options,
    );
    expect(validation.valid).toBe(false);
    expect(validation.issues?.length ?? 0).toBeGreaterThan(0);
  });

  test("authenticates managerSession and sendManagerMessage through the shared manager services", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(root, session.sessionId);
    const schema = createGraphqlSchema({
      now: () => "2026-03-15T01:00:00.000Z",
      managerSessionStore: managerStore,
    });
    const context = {
      ...options,
      managerSessionId: "mgrsess-000001",
      authToken: "secret",
    };

    const managerSession = await schema.query.managerSession({}, context);
    expect(managerSession?.session.managerSessionId).toBe("mgrsess-000001");

    const sent = await schema.mutation.sendManagerMessage(
      {
        workflowId: "demo",
        workflowExecutionId: session.sessionId,
        message: "Retry the workflow input node.",
        actions: [{ type: "retry-node", nodeId: "workflow-input" }],
        idempotencyKey: "idem-graphql-send",
      },
      context,
    );
    expect(sent.accepted).toBe(true);
    expect(sent.managerSessionId).toBe("mgrsess-000001");
    expect(sent.queuedNodeIds).toContain("workflow-input");
  });

  test("rejects manager-scoped mutations when auth token validation fails", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(root, session.sessionId);
    const schema = createGraphqlSchema({
      now: () => "2026-03-15T01:00:00.000Z",
      managerSessionStore: managerStore,
    });

    await expect(
      schema.mutation.sendManagerMessage(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          managerSessionId: "mgrsess-000001",
          actions: [{ type: "retry-node", nodeId: "workflow-input" }],
        },
        {
          ...options,
          authToken: "wrong-secret",
        },
      ),
    ).rejects.toThrow("invalid manager auth");
  });

  test("rejects replay and retry mutations that violate root-manager communication scope", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const managerStore = await createManagerSession(
      root,
      session.sessionId,
      "divedra-manager",
    );
    const schema = createGraphqlSchema({
      now: () => "2026-03-15T01:30:00.000Z",
      managerSessionStore: managerStore,
    });
    const context = {
      ...options,
      managerSessionId: "mgrsess-000001",
      authToken: "secret",
    };

    await expect(
      schema.mutation.replayCommunication(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: "comm-000004",
        },
        context,
      ),
    ).rejects.toThrow("outside root-manager scope");

    await expect(
      schema.mutation.retryCommunicationDelivery(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: "comm-000004",
        },
        context,
      ),
    ).rejects.toThrow("outside root-manager scope");
  });
});
