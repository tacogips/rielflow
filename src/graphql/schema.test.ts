import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import {
  saveEventReplyDispatchToRuntimeDb,
  saveHookEventToRuntimeDb,
} from "../workflow/runtime-db";
import type {
  NodeAddonDefinition,
  NodeAddonPayloadResolver,
  NormalizedWorkflowBundle,
} from "../workflow/types";
import { createGraphqlSchema } from "./schema";
import type { GraphqlRequestContext } from "./types";

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
    "main-worker": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "implement" },
    },
  };
}

function createThirdPartyAddonResolver(): NodeAddonPayloadResolver {
  return (input) =>
    input.addon.name === "acme/echo-worker"
      ? {
          issues: [],
          payload: {
            id: input.nodeId,
            executionBackend: "official/openai-sdk",
            model: "gpt-5-nano",
            promptTemplate: "Echo {{message}}",
            variables: input.addon.inputs ?? {},
          },
        }
      : { issues: [] };
}

function createAsyncThirdPartyAddonDefinition(): NodeAddonDefinition {
  return {
    name: "acme/echo-worker",
    version: "1",
    resolve: async (input) => ({
      payload: {
        id: input.nodeId,
        executionBackend: "official/openai-sdk",
        model: "gpt-5-nano",
        promptTemplate: "Echo {{message}}",
        variables: input.addon.inputs ?? {},
      },
    }),
  };
}

function createThirdPartyAddonBundle(): NormalizedWorkflowBundle {
  return {
    workflow: {
      workflowId: "third-party-addon",
      description: "third-party add-on GraphQL validation fixture",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      entryNodeId: "addon-worker",
      nodes: [
        {
          id: "addon-worker",
          role: "worker",
          addon: {
            name: "acme/echo-worker",
            version: "1",
            inputs: { message: "from addon" },
          },
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    } as unknown as NormalizedWorkflowBundle["workflow"],
    nodePayloads: {},
  };
}

async function writeLocalAddonManifest(input: {
  readonly addonRoot: string;
  readonly name: string;
  readonly version: string;
  readonly prompt: string;
}): Promise<void> {
  const [namespace, addonName] = input.name.split("/");
  if (namespace === undefined || addonName === undefined) {
    throw new Error(`invalid test add-on name '${input.name}'`);
  }
  const addonDirectory = path.join(
    input.addonRoot,
    namespace,
    addonName,
    input.version,
  );
  await mkdir(path.join(addonDirectory, "prompts"), { recursive: true });
  await writeFile(
    path.join(addonDirectory, "prompts", "worker.md"),
    `${input.prompt}\n`,
    "utf8",
  );
  await writeFile(
    path.join(addonDirectory, "addon.json"),
    `${JSON.stringify(
      {
        name: input.name,
        version: input.version,
        description: "Local echo worker",
        allowedRoles: ["worker"],
        inputSchema: {
          type: "object",
          required: ["message"],
          additionalProperties: false,
          properties: {
            message: { type: "string", minLength: 1 },
          },
        },
        resolution: {
          kind: "node-payload-template",
          nodeType: "agent",
          executionBackend: "official/openai-sdk",
          model: "gpt-5-nano",
          promptTemplateFile: "prompts/worker.md",
          variables: {
            renderedMessage: "{{addon.inputs.message}}",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
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

async function createWorkerOnlyWorkflowFixture(root: string) {
  const created = await createWorkflowTemplate("solo", {
    workflowRoot: root,
    templateMode: "worker-only",
  });
  expect(created.ok).toBe(true);
  if (!created.ok) {
    throw new Error(created.error.message);
  }

  return {
    options: {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    },
  };
}

async function createWorkflowCallWorkflowFixture(root: string) {
  const workflowDir = path.join(root, "workflow-calls");
  await mkdir(path.join(workflowDir, "nodes"), { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: "workflow-calls",
        description: "workflow-call graphql schema fixture",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        managerNodeId: "divedra-manager",
        workflowCalls: [
          {
            id: "review-call",
            workflowId: "review",
            callerNodeId: "main-worker",
          },
        ],
        nodes: [
          {
            id: "divedra-manager",
            role: "manager",
            nodeFile: "nodes/node-divedra-manager.json",
          },
          {
            id: "main-worker",
            role: "worker",
            nodeFile: "nodes/node-main-worker.json",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(workflowDir, "nodes", "node-divedra-manager.json"),
    `${JSON.stringify(
      {
        id: "divedra-manager",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "manager",
        variables: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(workflowDir, "nodes", "node-main-worker.json"),
    `${JSON.stringify(
      {
        id: "main-worker",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "worker",
        variables: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const reviewDir = path.join(root, "review");
  await mkdir(path.join(reviewDir, "nodes"), { recursive: true });
  await writeFile(
    path.join(reviewDir, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: "review",
        description: "workflow-call graphql schema callee fixture",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryNodeId: "reviewer",
        nodes: [
          {
            id: "reviewer",
            role: "worker",
            nodeFile: "nodes/node-reviewer.json",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(reviewDir, "nodes", "node-reviewer.json"),
    `${JSON.stringify(
      {
        id: "reviewer",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "review",
        variables: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    options: {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    },
  };
}

function makeGroupedWorkflowScenario(): MockNodeScenario {
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

async function createCompletedGroupedWorkflowFixture(root: string) {
  const workflowDir = path.join(root, "demo");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: "demo",
        description: "grouped graphql schema fixture",
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
        loops: [],
        branching: { mode: "fan-out" },
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
    mockScenario: makeGroupedWorkflowScenario(),
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
    expect(connection.items[0]?.record.workflowExecutionId).toBe(
      session.sessionId,
    );

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

  test("exposes worker-only workflows without requiring an authored manager id", async () => {
    const root = await makeTempDir();
    const { options } = await createWorkerOnlyWorkflowFixture(root);
    const schema = createGraphqlSchema();

    const workflow = await schema.query.workflow(
      { workflowName: "solo" },
      options,
    );

    expect(workflow?.workflowName).toBe("solo");
    expect(workflow?.workflowId).toBe("solo");
    expect(workflow?.hasManagerNode).toBe(false);
    expect(workflow?.managerNodeId).toBeUndefined();
    expect(workflow?.entryNodeId).toBe("main-worker");
    expect(workflow?.counts.nodes).toBe(1);
    expect(workflow?.compatibility.usesEffectiveEntryManagerNodeId).toBe(true);
    expect(workflow?.compatibility.notes).toContain(
      "Worker-only workflows normalize entryNodeId to an internal effective managerNodeId during runtime execution.",
    );
  });

  test("exposes authored workflowCalls through workflow inspection", async () => {
    const root = await makeTempDir();
    const { options } = await createWorkflowCallWorkflowFixture(root);
    const schema = createGraphqlSchema();

    const workflow = await schema.query.workflow(
      { workflowName: "workflow-calls" },
      options,
    );

    expect(workflow?.workflowCallIds).toEqual(["review-call"]);
    expect(workflow?.counts.workflowCalls).toBe(1);
    expect(workflow?.counts.legacySubWorkflows).toBe(0);
    expect(workflow?.runtime.ready).toBe(true);
    expect(
      workflow?.compatibility.normalizesRoleAuthoredNodesToStructuralKinds,
    ).toBe(true);
    expect(workflow?.compatibility.usesLegacyStructuralSubWorkflows).toBe(
      false,
    );
    expect(workflow?.compatibility.notes).toContain(
      "Role-authored nodes still normalize to structural runtime kinds internally for execution compatibility.",
    );
  });

  test("aggregates node detail and communication snapshots by workflow execution id", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    const schema = createGraphqlSchema();
    await saveHookEventToRuntimeDb(
      {
        hookEventId: "hook-schema-1",
        workflowId: session.workflowId,
        workflowExecutionId: session.sessionId,
        nodeId: "manager",
        nodeExecId: "manager-exec-1",
        vendor: "codex",
        agentSessionId: "agent-session-schema",
        rawEventName: "PostToolUse",
        eventName: "PostToolUse",
        cwd: root,
        payloadHash: "a".repeat(64),
        status: "recorded",
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
      options,
    );
    await saveEventReplyDispatchToRuntimeDb(
      {
        idempotencyKey: "reply-schema-key",
        sourceId: "webhook",
        provider: "webhook",
        workflowId: session.workflowId,
        workflowExecutionId: session.sessionId,
        nodeId: "reply-node",
        nodeExecId: "reply-exec-1",
        eventId: "event-schema-1",
        conversationId: "conversation-schema",
        status: "sent",
        providerMessageId: "message-schema",
        requestJson: JSON.stringify({ message: { text: "hello" } }),
        responseJson: JSON.stringify({ providerMessageId: "message-schema" }),
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
      options,
    );

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
    expect(overview?.hookEvents).toHaveLength(1);
    expect(overview?.hookEvents[0]?.agentSessionId).toBe(
      "agent-session-schema",
    );
    expect(overview?.replyDispatches).toHaveLength(1);
    expect(overview?.replyDispatches[0]?.providerMessageId).toBe(
      "message-schema",
    );

    const nodeWithOutput = overview?.nodes.find((node) => node.output !== null);
    expect(nodeWithOutput?.output).toContain("stage");

    const communicationWithSnapshot = overview?.communications.items.find(
      (item) =>
        item.artifactSnapshot.outboxOutputRaw !== null &&
        item.artifactSnapshot.inboxMessageJson !== null,
    );
    expect(communicationWithSnapshot).toBeDefined();
    expect(
      communicationWithSnapshot?.artifactSnapshot.outboxOutputRaw,
    ).toContain('"payload"');
    expect(
      communicationWithSnapshot?.artifactSnapshot.inboxMessageJson,
    ).toContain('"communicationId"');
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

    const reloaded = await schema.query.workflowDefinition(
      { workflowName: "demo" },
      options,
    );
    expect(reloaded?.bundle.workflow.description).toBe(
      "Updated through GraphQL",
    );

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

  test("resolves scoped user workflows through GraphQL schema operations", async () => {
    const root = await makeTempDir();
    const userRoot = path.join(root, "user-scope");
    const created = await createWorkflowTemplate("scoped-demo", {
      cwd: root,
      workflowScope: "user",
      userRoot,
      env: {},
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const schema = createGraphqlSchema();
    const options: GraphqlRequestContext = {
      cwd: root,
      workflowScope: "user",
      userRoot,
      env: {},
    };

    const workflows = await schema.query.workflows({}, options);
    expect(workflows).toContain("scoped-demo");

    const inspection = await schema.query.workflow(
      { workflowName: "scoped-demo" },
      options,
    );
    expect(inspection?.workflowName).toBe("scoped-demo");

    const definition = await schema.query.workflowDefinition(
      { workflowName: "scoped-demo" },
      options,
    );
    expect(definition?.workflowDirectory).toBe(
      path.join(userRoot, "workflows", "scoped-demo"),
    );

    if (definition === null) {
      throw new Error("expected scoped workflow definition");
    }
    const bundle = cloneJson(definition.bundle) as typeof definition.bundle & {
      workflow: { description: string };
    };
    bundle.workflow.description = "Updated through scoped GraphQL";
    const saved = await schema.mutation.saveWorkflowDefinition(
      {
        workflowName: "scoped-demo",
        bundle,
        ...(definition.revision === null
          ? {}
          : { expectedRevision: definition.revision }),
      },
      options,
    );
    expect(saved.error).toBeUndefined();

    const payload = await schema.mutation.executeWorkflow(
      {
        workflowName: "scoped-demo",
        runtimeVariables: {
          humanInput: {
            request: "start scoped workflow",
          },
        },
        mockScenario: makeDefaultTemplateScenario(),
      },
      options,
    );
    expect(payload.status).toBe("completed");
    expect(payload.exitCode).toBe(0);
  });

  test("rejects invalid workflow scope environment values through GraphQL operations", async () => {
    const root = await makeTempDir();
    const schema = createGraphqlSchema();

    await expect(
      schema.query.workflows(
        {},
        {
          cwd: root,
          env: {
            DIVEDRA_WORKFLOW_SCOPE: "global",
          },
        },
      ),
    ).rejects.toThrow("DIVEDRA_WORKFLOW_SCOPE");
  });

  test("passes third-party add-on resolvers through GraphQL validation", async () => {
    const root = await makeTempDir();
    const schema = createGraphqlSchema();
    const options: GraphqlRequestContext = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      nodeAddonResolvers: [createThirdPartyAddonResolver()],
    };

    const validation = await schema.mutation.validateWorkflowDefinition(
      {
        workflowName: "third-party-addon",
        bundle: createThirdPartyAddonBundle(),
      },
      options,
    );

    expect(validation.valid).toBe(true);
    expect(
      validation.issues?.some((issue) => issue.severity === "error") ?? false,
    ).toBe(false);
  });

  test("passes async third-party add-on definitions through GraphQL validation", async () => {
    const root = await makeTempDir();
    const schema = createGraphqlSchema();
    const options: GraphqlRequestContext = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      nodeAddons: [createAsyncThirdPartyAddonDefinition()],
    };

    const validation = await schema.mutation.validateWorkflowDefinition(
      {
        workflowName: "third-party-addon",
        bundle: createThirdPartyAddonBundle(),
      },
      options,
    );

    expect(validation.valid).toBe(true);
    expect(
      validation.issues?.some((issue) => issue.severity === "error") ?? false,
    ).toBe(false);
  });

  test("reports scoped local add-on sources through GraphQL validation and inspection", async () => {
    const root = await makeTempDir();
    const userRoot = path.join(root, "user-scope");
    const addonName = "acme/local-echo-worker";
    const workflowName = "local-addon-graphql";
    const workflowDirectory = path.join(userRoot, "workflows", workflowName);
    await mkdir(workflowDirectory, { recursive: true });
    await writeFile(
      path.join(workflowDirectory, "workflow.json"),
      `${JSON.stringify(
        {
          ...createThirdPartyAddonBundle().workflow,
          workflowId: workflowName,
          nodes: [
            {
              id: "addon-worker",
              role: "worker",
              addon: {
                name: addonName,
                version: "1",
                inputs: { message: "from local graphql" },
              },
              completion: { type: "none" },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeLocalAddonManifest({
      addonRoot: path.join(userRoot, "addons"),
      name: addonName,
      version: "1",
      prompt: "Local GraphQL {{renderedMessage}}",
    });

    const schema = createGraphqlSchema();
    const options: GraphqlRequestContext = {
      cwd: root,
      workflowScope: "user",
      userRoot,
      env: {},
    };
    const validation = await schema.mutation.validateWorkflowDefinition(
      { workflowName },
      options,
    );
    expect(validation.valid).toBe(true);
    expect(validation.addonSources).toEqual([
      expect.objectContaining({
        nodeId: "addon-worker",
        name: addonName,
        version: "1",
        scope: "user",
        manifestPath: path.join(
          userRoot,
          "addons",
          "acme",
          "local-echo-worker",
          "1",
          "addon.json",
        ),
      }),
    ]);

    const inspection = await schema.query.workflow({ workflowName }, options);
    expect(inspection?.addonSources).toEqual(validation.addonSources);
  });

  test("computes workflow definition revisions for third-party add-on refs", async () => {
    const root = await makeTempDir();
    const workflowName = "third-party-addon";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });
    await writeFile(
      path.join(workflowDirectory, "workflow.json"),
      `${JSON.stringify(createThirdPartyAddonBundle().workflow, null, 2)}\n`,
      "utf8",
    );

    const schema = createGraphqlSchema();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      nodeAddonResolvers: [createThirdPartyAddonResolver()],
    };

    const definition = await schema.query.workflowDefinition(
      { workflowName },
      options,
    );
    expect(definition?.revision).toMatch(/^sha256:/u);
    expect(definition?.bundle.nodePayloads["addon-worker"]).toMatchObject({
      executionBackend: "official/openai-sdk",
      variables: { message: "from addon" },
    });

    const inspection = await schema.query.workflow({ workflowName }, options);
    expect(inspection?.nodeFiles).toEqual([]);
  });

  test("creates worker-only workflow definitions through the schema mutation", async () => {
    const root = await makeTempDir();
    const schema = createGraphqlSchema();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const created = await schema.mutation.createWorkflowDefinition(
      {
        workflowName: "solo",
        templateMode: "worker-only",
      },
      options,
    );
    expect(created.workflowName).toBe("solo");
    expect(created.bundle.workflow.hasManagerNode).toBe(false);
    expect(created.bundle.workflow.entryNodeId).toBe("main-worker");
    expect(created.bundle.workflow.managerNodeId).toBe("main-worker");

    const workflowJsonText = await readFile(
      path.join(root, "solo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerNodeId"');
    expect(workflowJsonText).toContain('"entryNodeId": "main-worker"');
  });

  test("keeps worker-only workflow definitions manager-less across save mutations", async () => {
    const root = await makeTempDir();
    const schema = createGraphqlSchema();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const created = await schema.mutation.createWorkflowDefinition(
      {
        workflowName: "solo",
        templateMode: "worker-only",
      },
      options,
    );

    const saved = await schema.mutation.saveWorkflowDefinition(
      {
        workflowName: "solo",
        bundle: created.bundle,
        ...(created.revision === null
          ? {}
          : { expectedRevision: created.revision }),
      },
      options,
    );
    expect(saved.error).toBeUndefined();

    const workflowJsonText = await readFile(
      path.join(root, "solo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"hasManagerNode"');
    expect(workflowJsonText).not.toContain('"managerNodeId"');
    expect(workflowJsonText).not.toContain('"kind"');
    expect(workflowJsonText).toContain('"entryNodeId": "main-worker"');
    expect(workflowJsonText).toContain('"role": "worker"');
  });

  test("allows saveWorkflowDefinition to convert an existing managed workflow to worker-only", async () => {
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
    const workerPayload = created.bundle.nodePayloads["main-worker"];
    expect(workerPayload).toBeDefined();
    if (workerPayload === undefined) {
      return;
    }
    const convertedBundle = {
      workflow: {
        ...cloneJson(created.bundle.workflow),
        hasManagerNode: false,
        entryNodeId: "main-worker",
        edges: [],
        nodes: cloneJson(created.bundle.workflow.nodes).filter(
          (node) => node.id === "main-worker",
        ),
      },
      nodePayloads: {
        "main-worker": workerPayload,
      },
    };

    const saved = await schema.mutation.saveWorkflowDefinition(
      {
        workflowName: "demo",
        bundle: convertedBundle,
      },
      options,
    );
    expect(saved.error).toBeUndefined();

    const reloaded = await schema.query.workflowDefinition(
      { workflowName: "demo" },
      options,
    );
    expect(reloaded?.bundle.workflow.hasManagerNode).toBe(false);
    expect(reloaded?.bundle.workflow.managerNodeId).toBe("main-worker");
    expect(reloaded?.bundle.workflow.entryNodeId).toBe("main-worker");
    expect(reloaded?.bundle.workflow.nodes).toHaveLength(1);

    const workflowJsonText = await readFile(
      path.join(root, "demo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerNodeId"');
    expect(workflowJsonText).toContain('"entryNodeId": "main-worker"');
    expect(workflowJsonText).not.toContain('"role": "manager"');
  });

  test("allows saveWorkflowDefinition to convert an existing managed workflow to worker-only with expectedRevision", async () => {
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
    const workerPayload = created.bundle.nodePayloads["main-worker"];
    expect(workerPayload).toBeDefined();
    if (workerPayload === undefined) {
      return;
    }
    expect(created.revision).toEqual(expect.any(String));
    if (created.revision === null) {
      return;
    }

    const convertedBundle = {
      workflow: {
        ...cloneJson(created.bundle.workflow),
        hasManagerNode: false,
        entryNodeId: "main-worker",
        edges: [],
        nodes: cloneJson(created.bundle.workflow.nodes).filter(
          (node) => node.id === "main-worker",
        ),
      },
      nodePayloads: {
        "main-worker": workerPayload,
      },
    };

    const saved = await schema.mutation.saveWorkflowDefinition(
      {
        workflowName: "demo",
        expectedRevision: created.revision,
        bundle: convertedBundle,
      },
      options,
    );
    expect(saved.error).toBeUndefined();
    expect(saved.revision).toEqual(expect.any(String));

    const reloaded = await schema.query.workflowDefinition(
      { workflowName: "demo" },
      options,
    );
    expect(reloaded?.bundle.workflow.hasManagerNode).toBe(false);
    expect(reloaded?.bundle.workflow.managerNodeId).toBe("main-worker");
    expect(reloaded?.bundle.workflow.entryNodeId).toBe("main-worker");
    expect(reloaded?.bundle.workflow.nodes).toHaveLength(1);
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
        message: "Retry the main worker node.",
        actions: [{ type: "retry-node", nodeId: "main-worker" }],
        idempotencyKey: "idem-graphql-send",
      },
      context,
    );
    expect(sent.accepted).toBe(true);
    expect(sent.managerSessionId).toBe("mgrsess-000001");
    expect(sent.queuedNodeIds).toContain("main-worker");
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
          actions: [{ type: "retry-node", nodeId: "main-worker" }],
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
    const { options, session } =
      await createCompletedGroupedWorkflowFixture(root);
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
    const subworkflowScopedCommunication = session.communications.find(
      (entry) =>
        entry.routingScope === "intra-sub-workflow" ||
        entry.routingScope === "parent-to-sub-workflow",
    );
    expect(subworkflowScopedCommunication).toBeDefined();
    if (subworkflowScopedCommunication === undefined) {
      return;
    }

    await expect(
      schema.mutation.replayCommunication(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: subworkflowScopedCommunication.communicationId,
        },
        context,
      ),
    ).rejects.toThrow("outside root-manager scope");

    await expect(
      schema.mutation.retryCommunicationDelivery(
        {
          workflowId: "demo",
          workflowExecutionId: session.sessionId,
          communicationId: subworkflowScopedCommunication.communicationId,
        },
        context,
      ),
    ).rejects.toThrow("outside root-manager scope");
  });
});
