import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MockNodeScenario } from "../workflow/scenario-adapter";
import { createWorkflowTemplate } from "../workflow/create";
import { runWorkflow } from "../workflow/engine";
import * as workflowEngine from "../workflow/engine";
import {
  createManagerSessionStore,
  hashManagerAuthToken,
} from "../workflow/manager-session-store";
import {
  saveEventReplyDispatchToRuntimeDb,
  saveHookEventToRuntimeDb,
  saveNodeExecutionToRuntimeDb,
  type RuntimeLlmSessionMessageRecord,
} from "../workflow/runtime-db";
import { createSessionState } from "../workflow/session";
import { saveSession } from "../workflow/session-store";
import type {
  NodeAddonDefinition,
  NodeAddonPayloadResolver,
  NormalizedWorkflowBundle,
  ResolvedWorkflowSource,
} from "../workflow/types";
import * as dispatchResolver from "../events/supervisor-llm-resolver";
import type { EventBinding } from "../events/types";
import { atomicWriteJsonFile as writeJson } from "../shared/fs";
import { withResolvedWorkflowSourceOptions } from "../workflow/catalog";
import { createGraphqlSchema, selectGraphqlLlmSessionMessages } from "./schema";
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
  vi.restoreAllMocks();
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
      entryStepId: "addon-worker",
      nodes: [
        {
          id: "addon-worker",
          addon: {
            name: "acme/echo-worker",
            version: "1",
            inputs: { message: "from addon" },
          },
        },
      ],
      steps: [
        {
          id: "addon-worker",
          nodeId: "addon-worker",
          role: "worker",
        },
      ],
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
        managerStepId: "divedra-manager",
        entryStepId: "divedra-manager",
        nodes: [
          {
            id: "divedra-manager",
            nodeFile: "nodes/node-divedra-manager.json",
          },
          {
            id: "main-worker",
            nodeFile: "nodes/node-main-worker.json",
          },
        ],
        steps: [
          {
            id: "divedra-manager",
            nodeId: "divedra-manager",
            role: "manager",
            transitions: [{ toStepId: "main-worker" }],
          },
          {
            id: "main-worker",
            nodeId: "main-worker",
            role: "worker",
            transitions: [
              {
                toStepId: "reviewer",
                toWorkflowId: "review",
                resumeStepId: "main-worker",
              },
            ],
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
        entryStepId: "reviewer",
        nodes: [
          {
            id: "reviewer",
            nodeFile: "nodes/node-reviewer.json",
          },
        ],
        steps: [
          {
            id: "reviewer",
            nodeId: "reviewer",
            role: "worker",
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

describe("createGraphqlSchema", () => {
  test("selects LLM session messages with default latest, enum order, and limit", () => {
    const makeMessage = (
      id: number,
      nodeExecId: string,
      contentText: string,
    ): RuntimeLlmSessionMessageRecord => ({
      id,
      sessionId: "sess-selection",
      nodeExecId,
      nodeId: "worker",
      provider: "codex-agent",
      model: "gpt-5.5",
      backendSessionId: "backend-selection",
      ordinal: id,
      role: "assistant",
      eventType: "assistant.snapshot",
      contentText,
      rawMessageJson: null,
      at: `2026-05-04T00:00:0${id}.000Z`,
    });
    const messages = [
      makeMessage(1, "exec-1", "first"),
      makeMessage(2, "exec-1", "second"),
      makeMessage(3, "exec-2", "third"),
    ];

    expect(
      selectGraphqlLlmSessionMessages(messages).map(
        (message) => message.contentText,
      ),
    ).toEqual(["third"]);
    expect(
      selectGraphqlLlmSessionMessages(messages, {
        order: "ASC",
        limit: 2,
      }).map((message) => message.contentText),
    ).toEqual(["first", "second"]);
    expect(
      selectGraphqlLlmSessionMessages(messages, {
        order: "DESC",
        limit: 2,
      }).map((message) => message.contentText),
    ).toEqual(["third", "second"]);
    expect(
      selectGraphqlLlmSessionMessages(messages, {
        limit: null,
      }).map((message) => message.contentText),
    ).toEqual(["third"]);
    expect(
      selectGraphqlLlmSessionMessages(messages, {
        order: "ASC",
        limit: null,
      }).map((message) => message.contentText),
    ).toEqual(["first"]);
    expect(
      selectGraphqlLlmSessionMessages(messages, {
        order: "ASC",
        limit: 0,
      }),
    ).toEqual([]);
    expect(
      selectGraphqlLlmSessionMessages(
        messages.filter((message) => message.nodeExecId === "exec-1"),
        { order: "ASC", limit: 2 },
      ).map((message) => message.contentText),
    ).toEqual(["first", "second"]);
  });

  test("workflowExecution.session exposes supervision when stored on the session", async () => {
    const root = await makeTempDir();
    const sessionRoot = path.join(root, "sessions");
    const policy = {
      enabled: true as const,
      monitorIntervalMs: 5000,
      stallTimeoutMs: 60_000,
      maxSupervisedAttempts: 5,
      maxWorkflowPatches: 3,
      workflowMutationMode: "execution-copy" as const,
    };
    const session = {
      ...createSessionState({
        sessionId: "sess-supervision-graphql",
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "manager",
        runtimeVariables: {},
      }),
      supervision: {
        supervisionRunId: "sr-gql",
        targetWorkflowId: "demo",
        superviserWorkflowId: "sup",
        status: "running" as const,
        attemptCount: 1,
        workflowPatchCount: 0,
        nestedSuperviserSessionId: "sess-nested-superviser",
        policy,
        incidents: [],
        remediations: [
          {
            remediationId: "rem-1",
            incidentId: "inc-1",
            decidedAt: "2026-04-25T00:00:00.000Z",
            action: "rerun-workflow" as const,
            reason: "transient",
          },
        ],
      },
    };

    const save = await saveSession(session, { sessionStoreRoot: sessionRoot });
    expect(save.ok).toBe(true);

    const schema = createGraphqlSchema();
    const ctx: GraphqlRequestContext = {
      cwd: root,
      sessionStoreRoot: sessionRoot,
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
    };

    const execution = await schema.query.workflowExecution(
      { workflowExecutionId: session.sessionId },
      ctx,
    );
    expect(execution?.session.supervision?.supervisionRunId).toBe("sr-gql");
    expect(execution?.session.supervision?.nestedSuperviserSessionId).toBe(
      "sess-nested-superviser",
    );
    expect(execution?.session.supervision?.policy?.monitorIntervalMs).toBe(
      5000,
    );
    expect(execution?.session.supervision?.remediations?.length).toBe(1);
    expect(execution?.session.supervision?.remediations?.[0]?.action).toBe(
      "rerun-workflow",
    );
  });

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

  test("exposes workflowCatalogOverview with never-run aggregate and scoped rows", async () => {
    const root = await makeTempDir();
    const schema = createGraphqlSchema();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const created = await createWorkflowTemplate("demo", options);
    expect(created.ok).toBe(true);
    const createdOther = await createWorkflowTemplate("solo", {
      ...options,
      templateMode: "worker-only",
    });
    expect(createdOther.ok).toBe(true);

    const catalog = await schema.query.workflowCatalogOverview({}, options);
    expect(catalog.workflows.length).toBe(2);
    const demoRow = catalog.workflows.find((w) => w.workflowName === "demo");
    expect(demoRow).toMatchObject({
      workflowName: "demo",
      sourceScope: "direct",
      aggregateStatus: "never-run",
      activeExecutionCount: 0,
      latestExecution: null,
    });

    const filtered = await schema.query.workflowCatalogOverview(
      { status: "never-run" },
      options,
    );
    expect(filtered.workflows.map((w) => w.workflowName).sort()).toEqual([
      "demo",
      "solo",
    ]);

    const fixed = await schema.query.workflowCatalogOverview(
      {},
      { ...options, fixedWorkflowName: "demo" },
    );
    expect(fixed.workflows.map((w) => w.workflowName)).toEqual(["demo"]);

    const statusOverview = await schema.query.workflowStatusOverview(
      { workflowName: "demo" },
      options,
    );
    expect(statusOverview).toMatchObject({
      workflowName: "demo",
      sourceScope: "direct",
      aggregateStatus: "never-run",
      recentExecutions: [],
      newestActiveExecution: null,
    });

    const missing = await schema.query.workflowStatusOverview(
      { workflowName: "nope" },
      options,
    );
    expect(missing).toBeNull();
  });

  test("fixed resolved workflow source pins scoped duplicate overview rows", async () => {
    const base = await makeTempDir();
    const workspace = path.join(base, "projtree");
    const projectScopeRoot = path.join(workspace, ".divedra");
    const projectWorkflowRoot = path.join(projectScopeRoot, "workflows");
    const userScopeRoot = path.join(base, "userhome", ".divedra");
    const userWorkflowRoot = path.join(userScopeRoot, "workflows");

    async function overviewBundle(
      workflowDirectory: string,
      workflowId: string,
      description: string,
    ): Promise<void> {
      await mkdir(workflowDirectory, { recursive: true });
      await writeJson(path.join(workflowDirectory, "workflow.json"), {
        workflowId,
        description,
      });
    }

    await overviewBundle(
      path.join(projectWorkflowRoot, "dup"),
      "project-dup",
      "from project",
    );
    await overviewBundle(
      path.join(userWorkflowRoot, "dup"),
      "user-dup",
      "from user",
    );

    const baseOpts: GraphqlRequestContext = {
      cwd: workspace,
      projectRoot: projectScopeRoot,
      userRoot: userScopeRoot,
    };

    const projectSource: ResolvedWorkflowSource = {
      scope: "project",
      workflowRoot: projectWorkflowRoot,
      workflowName: "dup",
      workflowDirectory: path.join(projectWorkflowRoot, "dup"),
      scopeRoot: projectScopeRoot,
    };
    const userSource: ResolvedWorkflowSource = {
      scope: "user",
      workflowRoot: userWorkflowRoot,
      workflowName: "dup",
      workflowDirectory: path.join(userWorkflowRoot, "dup"),
      scopeRoot: userScopeRoot,
    };

    await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-proj",
          workflowName: "dup",
          workflowId: "project-dup",
          initialNodeId: "step",
          runtimeVariables: {},
        }),
        startedAt: "2026-05-02T09:00:00.000Z",
        status: "completed",
        endedAt: "2026-05-02T09:05:00.000Z",
      },
      withResolvedWorkflowSourceOptions(projectSource, baseOpts),
    );
    await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-user",
          workflowName: "dup",
          workflowId: "user-dup",
          initialNodeId: "step",
          runtimeVariables: {},
        }),
        startedAt: "2026-05-02T08:00:00.000Z",
        status: "running",
      },
      withResolvedWorkflowSourceOptions(userSource, baseOpts),
    );

    const schema = createGraphqlSchema();
    const nameOnlyDup = await schema.query.workflowCatalogOverview(
      { workflowScope: "auto" },
      { ...baseOpts, fixedWorkflowName: "dup" },
    );
    expect(nameOnlyDup.workflows).toHaveLength(2);

    const pinnedDup = await schema.query.workflowCatalogOverview(
      { workflowScope: "auto" },
      {
        ...baseOpts,
        fixedWorkflowName: "dup",
        fixedResolvedWorkflowSource: projectSource,
      },
    );
    expect(pinnedDup.workflows).toHaveLength(1);
    expect(pinnedDup.workflows[0]?.sourceScope).toBe("project");

    const statusPinned = await schema.query.workflowStatusOverview(
      {
        workflowName: "dup",
        workflowScope: "user",
        limit: 5,
      },
      {
        ...baseOpts,
        fixedWorkflowName: "dup",
        fixedResolvedWorkflowSource: projectSource,
      },
    );
    expect(statusPinned).toMatchObject({
      sourceScope: "project",
      aggregateStatus: "completed",
      description: "from project",
      newestActiveExecution: null,
      recentExecutions: [
        expect.objectContaining({
          workflowExecutionId: "sess-proj",
          sessionId: "sess-proj",
        }),
      ],
    });
  });

  test("derives currentStepId in workflow execution summaries from step-addressed session records", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const sessionId = "sess-schema-step-summary";
    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName: "demo",
          workflowId: "demo",
          initialNodeId: "writer-node",
          runtimeVariables: {},
        }),
        status: "paused" as const,
        currentNodeId: "writer-node",
        queue: ["writer-node"],
        nodeExecutionCounter: 1,
        nodeExecutionCounts: {
          "writer-node": 1,
        },
        nodeExecutions: [
          {
            nodeId: "writer-node",
            stepId: "writer-step",
            nodeRegistryId: "writer-node",
            nodeExecId: "exec-writer-1",
            mailboxInstanceId: "exec-writer-1",
            status: "succeeded" as const,
            artifactDir: path.join(
              options.artifactRoot,
              "demo",
              sessionId,
              "exec-writer-1",
            ),
            startedAt: "2026-04-24T05:00:00.000Z",
            endedAt: "2026-04-24T05:00:10.000Z",
          },
        ],
      },
      options,
    );
    expect(saved.ok).toBe(true);

    const schema = createGraphqlSchema();
    const connection = await schema.query.workflowExecutions(
      {
        workflowName: "demo",
        first: 10,
      },
      options,
    );

    expect(connection.items).toContainEqual(
      expect.objectContaining({
        workflowExecutionId: sessionId,
        sessionId,
        workflowName: "demo",
        currentNodeId: "writer-node",
        currentStepId: "writer-step",
      }),
    );
  });

  test("exposes currentStepId on workflowExecution.session and workflowExecutionOverview.session", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const sessionId = "sess-schema-step-session-view";
    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName: "demo",
          workflowId: "demo",
          initialNodeId: "writer-node",
          runtimeVariables: {},
        }),
        status: "paused" as const,
        currentNodeId: "writer-node",
        queue: ["writer-node"],
        nodeExecutionCounter: 1,
        nodeExecutionCounts: {
          "writer-node": 1,
        },
        nodeExecutions: [
          {
            nodeId: "writer-node",
            stepId: "writer-step",
            nodeRegistryId: "writer-node",
            nodeExecId: "exec-writer-1",
            mailboxInstanceId: "exec-writer-1",
            status: "succeeded" as const,
            artifactDir: path.join(
              options.artifactRoot,
              "demo",
              sessionId,
              "exec-writer-1",
            ),
            startedAt: "2026-04-24T05:00:00.000Z",
            endedAt: "2026-04-24T05:00:10.000Z",
          },
        ],
      },
      options,
    );
    expect(saved.ok).toBe(true);

    const schema = createGraphqlSchema();
    const workflowExecution = await schema.query.workflowExecution(
      { workflowExecutionId: sessionId },
      options,
    );
    expect(workflowExecution?.session.currentStepId).toBe("writer-step");

    const overview = await schema.query.workflowExecutionOverview(
      { workflowExecutionId: sessionId },
      options,
    );
    expect(overview?.session.currentStepId).toBe("writer-step");
  });

  test("exposes fanout summary branch details on workflow execution views", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const sessionId = "sess-schema-fanout-summary";
    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName: "demo",
          workflowId: "demo",
          initialNodeId: "writer-step",
          runtimeVariables: {},
        }),
        fanoutGroups: [
          {
            fanoutGroupRunId: "fanout-local-exec-1",
            groupId: "local-reviews",
            sourceStepId: "writer-step",
            sourceNodeExecId: "exec-writer-1",
            targetStepId: "reviewer-step",
            joinStepId: "join-step",
            concurrency: 2,
            failurePolicy: "collect-all" as const,
            resultOrder: "input" as const,
            branches: [
              {
                branchIndex: 0,
                item: { id: "feature-a" },
                status: "succeeded" as const,
                workItemId: "fanout-local-exec-1:0",
                nodeExecIds: ["exec-reviewer-1"],
                outputRef: {
                  kind: "node-output" as const,
                  workflowExecutionId: sessionId,
                  workflowId: "demo",
                  outputNodeId: "reviewer-node",
                  outputStepId: "reviewer-step",
                  nodeRegistryId: "reviewer-node",
                  nodeExecId: "exec-reviewer-1",
                  artifactDir: path.join(
                    options.artifactRoot,
                    "demo",
                    sessionId,
                    "exec-reviewer-1",
                  ),
                },
                workspaceRoot: "/tmp/divedra/fanout/new",
                supersededWorkspaceRoot: "/tmp/divedra/fanout/old",
              },
              {
                branchIndex: 1,
                item: { id: "feature-b" },
                status: "failed" as const,
                workItemId: "fanout-local-exec-1:1",
                error: "review failed",
              },
            ],
          },
        ],
      },
      options,
    );
    expect(saved.ok).toBe(true);

    const schema = createGraphqlSchema();
    const workflowExecution = await schema.query.workflowExecution(
      { workflowExecutionId: sessionId },
      options,
    );

    const summary = workflowExecution?.session.fanoutSummaries[0];
    expect(summary).toMatchObject({
      fanoutGroupRunId: "fanout-local-exec-1",
      groupId: "local-reviews",
      sourceStepId: "writer-step",
      sourceNodeExecId: "exec-writer-1",
      targetStepId: "reviewer-step",
      joinStepId: "join-step",
      concurrency: 2,
      failurePolicy: "collect-all",
      resultOrder: "input",
      branchCounts: {
        succeeded: 1,
        failed: 1,
      },
      firstFailure: "branch 1: review failed",
    });
    expect(summary?.branches[0]).toMatchObject({
      branchIndex: 0,
      status: "succeeded",
      workItemId: "fanout-local-exec-1:0",
      nodeExecIds: ["exec-reviewer-1"],
      workspaceRoot: "/tmp/divedra/fanout/new",
      supersededWorkspaceRoot: "/tmp/divedra/fanout/old",
    });
    expect(summary?.branches[0]?.outputRef?.nodeExecId).toBe("exec-reviewer-1");
    expect(summary?.branches[1]).toMatchObject({
      branchIndex: 1,
      status: "failed",
      error: "review failed",
    });
  });

  test("derives currentStepId from authored workflow state before the first execution record exists", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const sessionId = "sess-schema-current-target";
    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName: "demo",
          workflowId: "demo",
          initialNodeId: "divedra-manager",
          runtimeVariables: {},
        }),
        status: "paused" as const,
        currentNodeId: "main-worker",
        queue: ["main-worker"],
      },
      options,
    );
    expect(saved.ok).toBe(true);

    const schema = createGraphqlSchema();
    const connection = await schema.query.workflowExecutions(
      {
        workflowName: "demo",
        first: 10,
      },
      options,
    );
    expect(connection.items).toContainEqual(
      expect.objectContaining({
        workflowExecutionId: sessionId,
        currentNodeId: "main-worker",
        currentStepId: "main-worker",
      }),
    );

    const workflowExecution = await schema.query.workflowExecution(
      { workflowExecutionId: sessionId },
      options,
    );
    expect(workflowExecution?.session.currentNodeId).toBe("main-worker");
    expect(workflowExecution?.session.currentStepId).toBe("main-worker");
  });

  test("accepts stepId on rerunWorkflowExecution and lowers it into the current rerun runtime", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const sessionId = "sess-schema-rerun-step";
    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      options,
    );
    expect(saved.ok).toBe(true);

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId: "sess-schema-rerun-step-2",
              workflowName: "demo",
              workflowId: "demo",
              initialNodeId: "main-worker",
              runtimeVariables: {},
            }),
            status: "running" as const,
          },
          exitCode: 0,
        },
      });

    const schema = createGraphqlSchema();
    const payload = await schema.mutation.rerunWorkflowExecution(
      {
        workflowExecutionId: sessionId,
        stepId: "main-worker",
        workingDirectory: " apps/reviewer ",
        dryRun: true,
        maxSteps: 3,
      },
      options,
    );

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        rerunFromSessionId: sessionId,
        rerunFromStepId: "main-worker",
        workflowWorkingDirectory: "apps/reviewer",
        dryRun: true,
        maxSteps: 3,
      }),
    );
    expect(payload).toMatchObject({
      workflowExecutionId: "sess-schema-rerun-step-2",
      sessionId: "sess-schema-rerun-step-2",
      status: "running",
      rerunFromStepId: "main-worker",
      exitCode: 0,
    });
  });

  test("continueWorkflowExecution forwards continuation anchor into runWorkflow", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const sessionId = "sess-schema-continue-hist";
    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "step-1",
        runtimeVariables: {},
      }),
      options,
    );
    expect(saved.ok).toBe(true);

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId: "sess-schema-continue-hist-2",
              workflowName: "demo",
              workflowId: "demo",
              initialNodeId: "step-2",
              runtimeVariables: {},
            }),
            status: "completed" as const,
          },
          exitCode: 0,
        },
      });

    const schema = createGraphqlSchema();
    const payload = await schema.mutation.continueWorkflowExecution(
      {
        sourceWorkflowExecutionId: sessionId,
        startStepId: "step-2",
        afterStepRunId: "ne-anchor",
        dryRun: true,
        maxSteps: 5,
      },
      options,
    );

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        continueFromWorkflowExecutionId: sessionId,
        continueStartStepId: "step-2",
        continueAfterStepRunId: "ne-anchor",
        dryRun: true,
        maxSteps: 5,
      }),
    );
    expect(payload).toMatchObject({
      workflowExecutionId: "sess-schema-continue-hist-2",
      sessionId: "sess-schema-continue-hist-2",
      status: "completed",
      continuedAfterStepRunId: "ne-anchor",
      continuedStartStepId: "step-2",
      exitCode: 0,
    });
  });

  test("workflowExecutionStepRuns exposes merged timeline for continued sessions", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const artifactBase = path.join(root, "artifact-sub");
    await mkdir(artifactBase, { recursive: true });

    const source = {
      ...createSessionState({
        sessionId: "sess-gql-steprun-src",
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "step-1",
        runtimeVariables: {},
      }),
      nodeExecutions: [
        {
          nodeId: "step-1",
          nodeExecId: "ne-src-1",
          executionOrdinal: 1,
          stepId: "step-1",
          status: "succeeded" as const,
          artifactDir: path.join(artifactBase, "s1"),
          startedAt: "2026-05-02T10:00:00.000Z",
          endedAt: "2026-05-02T10:00:01.000Z",
        },
      ],
    };
    await saveSession(source, options);

    const continued = {
      ...createSessionState({
        sessionId: "sess-gql-steprun-cont",
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "step-2",
        runtimeVariables: {},
      }),
      historyImports: [
        {
          sourceWorkflowExecutionId: "sess-gql-steprun-src",
          throughStepRunId: "ne-src-1",
          throughExecutionOrdinal: 1,
        },
      ],
      nodeExecutions: [
        {
          nodeId: "step-2",
          nodeExecId: "ne-local-1",
          executionOrdinal: 1,
          stepId: "step-2",
          status: "succeeded" as const,
          artifactDir: path.join(artifactBase, "s2"),
          startedAt: "2026-05-02T11:00:00.000Z",
          endedAt: "2026-05-02T11:00:02.000Z",
        },
      ],
    };
    await saveSession(continued, options);

    const schema = createGraphqlSchema();
    const payload = await schema.query.workflowExecutionStepRuns(
      { workflowExecutionId: "sess-gql-steprun-cont" },
      options,
    );

    expect(payload.workflowExecutionId).toBe("sess-gql-steprun-cont");
    expect(payload.stepRuns.map((row) => row.stepRunId)).toEqual([
      "ne-src-1",
      "ne-local-1",
    ]);
    expect(payload.stepRuns[0]?.imported).toBe(true);
    expect(payload.stepRuns[1]?.imported).toBe(false);
  });

  test("reruns reusable-node workflows by explicit stepId", async () => {
    const root = await makeTempDir();
    const workflowName = "schema-rerun-step-node-mismatch";
    const sessionId = "sess-schema-rerun-step-node-mismatch";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await writeFile(
      path.join(workflowDirectory, "workflow.json"),
      `${JSON.stringify(
        {
          workflowId: workflowName,
          description: "schema rerun step-node mismatch fixture",
          defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
          entryStepId: "writer-step",
          nodes: [
            {
              id: "writer-node",
              nodeFile: "nodes/node-writer.json",
            },
          ],
          steps: [
            {
              id: "writer-step",
              nodeId: "writer-node",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(workflowDirectory, "nodes", "node-writer.json"),
      `${JSON.stringify(
        {
          id: "writer-node",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "writer",
          variables: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };
    await saveSession(
      createSessionState({
        sessionId,
        workflowName,
        workflowId: workflowName,
        initialNodeId: "writer-step",
        runtimeVariables: {},
      }),
      options,
    );

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId: "sess-schema-rerun-step-node-mismatch-2",
              workflowName,
              workflowId: workflowName,
              initialNodeId: "writer-step",
              runtimeVariables: {},
            }),
            status: "running" as const,
          },
          exitCode: 0,
        },
      });

    const schema = createGraphqlSchema();
    const payload = await schema.mutation.rerunWorkflowExecution(
      {
        workflowExecutionId: sessionId,
        stepId: "writer-step",
      },
      options,
    );

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      workflowName,
      expect.objectContaining({
        rerunFromSessionId: sessionId,
        rerunFromStepId: "writer-step",
      }),
    );
    expect(payload).toMatchObject({
      workflowExecutionId: "sess-schema-rerun-step-node-mismatch-2",
      sessionId: "sess-schema-rerun-step-node-mismatch-2",
      status: "running",
      rerunFromStepId: "writer-step",
      exitCode: 0,
    });
  });

  test("rerunWorkflowExecution rejects when stepId is blank", async () => {
    const root = await makeTempDir();
    const schema = createGraphqlSchema();
    await expect(
      schema.mutation.rerunWorkflowExecution(
        {
          workflowExecutionId: "sess-missing-rerun-target",
          stepId: " ",
        },
        {
          workflowRoot: root,
          artifactRoot: path.join(root, "artifacts"),
          sessionStoreRoot: path.join(root, "sessions"),
        },
      ),
    ).rejects.toThrow("stepId is required");
  });

  test("rerunWorkflowExecution trims stepId before dispatch", async () => {
    const root = await makeTempDir();
    const workflowName = "schema-rerun-trimmed-step-id";
    const sessionId = "sess-schema-rerun-trimmed-step-id";
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName,
        workflowId: workflowName,
        initialNodeId: "writer-step",
        runtimeVariables: {},
      }),
      options,
    );
    expect(saved.ok).toBe(true);

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId: "sess-schema-rerun-trimmed-step-id-2",
              workflowName,
              workflowId: workflowName,
              initialNodeId: "writer-step",
              runtimeVariables: {},
            }),
            status: "running" as const,
          },
          exitCode: 0,
        },
      });

    const schema = createGraphqlSchema();
    const payload = await schema.mutation.rerunWorkflowExecution(
      {
        workflowExecutionId: sessionId,
        stepId: " writer-step ",
      },
      options,
    );

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      workflowName,
      expect.objectContaining({
        rerunFromSessionId: sessionId,
        rerunFromStepId: "writer-step",
      }),
    );
    expect(payload.rerunFromStepId).toBe("writer-step");
  });

  test("executeWorkflow normalizes auto-improve and nested-superviser into runWorkflow", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId: "sess-schema-supervised-start",
              workflowName: "demo",
              workflowId: "demo",
              initialNodeId: "divedra-manager",
              runtimeVariables: {},
            }),
            status: "running" as const,
          },
          exitCode: 0,
        },
      });

    const schema = createGraphqlSchema();
    const payload = await schema.mutation.executeWorkflow(
      {
        workflowName: "demo",
        nestedSuperviser: true,
        autoImprove: {
          enabled: true,
          superviserWorkflowId: "custom-superviser",
          monitorIntervalMs: 6000,
          stallTimeoutMs: 12000,
          maxSupervisedAttempts: 4,
          maxWorkflowPatches: 2,
          workflowMutationMode: "in-place",
          allowTargetedRerun: false,
        },
      },
      options,
    );

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        nestedSuperviserDriver: true,
        autoImprove: {
          enabled: true,
          superviserWorkflowId: "custom-superviser",
          monitorIntervalMs: 6000,
          stallTimeoutMs: 12000,
          maxSupervisedAttempts: 4,
          maxWorkflowPatches: 2,
          workflowMutationMode: "in-place",
          allowTargetedRerun: false,
        },
      }),
    );
    expect(payload.status).toBe("running");
  });

  test("executeWorkflow forwards maxConcurrency to runWorkflow", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId: "sess-schema-max-concurrency",
              workflowName: "demo",
              workflowId: "demo",
              initialNodeId: "divedra-manager",
              runtimeVariables: {},
            }),
            status: "completed" as const,
          },
          exitCode: 0,
        },
      });

    const schema = createGraphqlSchema();
    await schema.mutation.executeWorkflow(
      {
        workflowName: "demo",
        maxConcurrency: 4,
      },
      options,
    );

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({ maxConcurrency: 4 }),
    );
  });

  test("executeWorkflow allows nested-superviser through default auto-improve policy", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId: "sess-schema-default-supervised-start",
              workflowName: "demo",
              workflowId: "demo",
              initialNodeId: "divedra-manager",
              runtimeVariables: {},
            }),
            status: "running" as const,
          },
          exitCode: 0,
        },
      });
    const schema = createGraphqlSchema();

    await schema.mutation.executeWorkflow(
      {
        workflowName: "demo",
        nestedSuperviser: true,
      },
      options,
    );
    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        nestedSuperviserDriver: true,
        autoImprove: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  test("executeWorkflow rejects invalid auto-improve policy before calling runWorkflow", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const runWorkflowSpy = vi.spyOn(workflowEngine, "runWorkflow");
    const schema = createGraphqlSchema();

    await expect(
      schema.mutation.executeWorkflow(
        {
          workflowName: "demo",
          autoImprove: {
            enabled: true,
            monitorIntervalMs: 6000,
            stallTimeoutMs: 5000,
          },
        },
        options,
      ),
    ).rejects.toThrow(
      "invalid autoImprove policy: stallTimeoutMs must be greater than or equal to monitorIntervalMs",
    );
    expect(runWorkflowSpy).not.toHaveBeenCalled();
  });

  test("resumeWorkflowExecution normalizes auto-improve and nested-superviser into runWorkflow", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const sessionId = "sess-schema-supervised-resume";
    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      options,
    );
    expect(saved.ok).toBe(true);

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId,
              workflowName: "demo",
              workflowId: "demo",
              initialNodeId: "divedra-manager",
              runtimeVariables: {},
            }),
            status: "running" as const,
          },
          exitCode: 0,
        },
      });

    const schema = createGraphqlSchema();
    const payload = await schema.mutation.resumeWorkflowExecution(
      {
        workflowExecutionId: sessionId,
        nestedSuperviser: true,
        autoImprove: {
          enabled: true,
        },
      },
      options,
    );

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        resumeSessionId: sessionId,
        nestedSuperviserDriver: true,
        autoImprove: expect.objectContaining({
          enabled: true,
        }),
      }),
    );
    expect(payload.status).toBe("running");
  });

  test("resumeWorkflowExecution does not synthesize default auto-improve", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const sessionId = "sess-schema-unsupervised-resume";
    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      options,
    );
    expect(saved.ok).toBe(true);
    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId,
              workflowName: "demo",
              workflowId: "demo",
              initialNodeId: "divedra-manager",
              runtimeVariables: {},
            }),
            status: "running" as const,
          },
          exitCode: 0,
        },
      });

    await createGraphqlSchema().mutation.resumeWorkflowExecution(
      { workflowExecutionId: sessionId },
      options,
    );

    expect(runWorkflowSpy.mock.calls[0]?.[1]).not.toHaveProperty("autoImprove");
  });

  test("rerunWorkflowExecution normalizes auto-improve into runWorkflow", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const sessionId = "sess-schema-supervised-rerun";
    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      options,
    );
    expect(saved.ok).toBe(true);

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId: "sess-schema-supervised-rerun-2",
              workflowName: "demo",
              workflowId: "demo",
              initialNodeId: "divedra-manager",
              runtimeVariables: {},
            }),
            status: "running" as const,
          },
          exitCode: 0,
        },
      });

    const schema = createGraphqlSchema();
    const payload = await schema.mutation.rerunWorkflowExecution(
      {
        workflowExecutionId: sessionId,
        stepId: "main-worker",
        autoImprove: {
          enabled: true,
          maxSupervisedAttempts: 2,
        },
      },
      options,
    );

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        rerunFromSessionId: sessionId,
        rerunFromStepId: "main-worker",
        autoImprove: expect.objectContaining({
          enabled: true,
          maxSupervisedAttempts: 2,
        }),
      }),
    );
    expect(payload.rerunFromStepId).toBe("main-worker");
  });

  test("rerunWorkflowExecution does not synthesize default auto-improve", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const sessionId = "sess-schema-unsupervised-rerun";
    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      options,
    );
    expect(saved.ok).toBe(true);
    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId: "sess-schema-unsupervised-rerun-2",
              workflowName: "demo",
              workflowId: "demo",
              initialNodeId: "divedra-manager",
              runtimeVariables: {},
            }),
            status: "running" as const,
          },
          exitCode: 0,
        },
      });

    await createGraphqlSchema().mutation.rerunWorkflowExecution(
      { workflowExecutionId: sessionId, stepId: "main-worker" },
      options,
    );

    expect(runWorkflowSpy.mock.calls[0]?.[1]).not.toHaveProperty("autoImprove");
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
    expect(workflow?.entryStepId).toBe("main-worker");
    expect(workflow?.nodeRegistryIds).toEqual(["main-worker"]);
    expect(workflow?.counts.nodeRegistry).toBe(1);
    expect(workflow?.counts.steps).toBe(1);
    expect(workflow?.counts.crossWorkflowDispatches).toBe(0);
  });

  test("reports scaffolded managed starters as not runtime-ready until code-manager runtime lands", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const schema = createGraphqlSchema();
    const workflow = await schema.query.workflow(
      { workflowName: "demo" },
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        rootDataDir: path.join(root, "data"),
        cwd: root,
      },
    );

    expect(workflow?.managerStepId).toBe("divedra-manager");
    expect(workflow?.entryStepId).toBe("divedra-manager");
    expect(workflow?.stepIds).toEqual(["divedra-manager", "main-worker"]);
    expect(workflow?.nodeRegistryIds).toEqual([
      "divedra-manager",
      "main-worker",
    ]);
    expect(workflow?.counts.nodeRegistry).toBe(2);
    expect(workflow?.counts.steps).toBe(2);
    expect(workflow?.counts.crossWorkflowDispatches).toBe(0);
    expect(workflow?.runtime.ready).toBe(false);
    expect(workflow?.runtime.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workflow-feature:code-manager-runtime",
          sourceStepIds: ["divedra-manager"],
        }),
      ]),
    );
    expect(workflow?.runtime.blockers).toEqual(
      expect.arrayContaining([expect.stringContaining("code-manager runtime")]),
    );
  });

  test("exposes step-derived cross-workflow calls through workflow inspection", async () => {
    const root = await makeTempDir();
    const { options } = await createWorkflowCallWorkflowFixture(root);
    const schema = createGraphqlSchema();

    const workflow = await schema.query.workflow(
      { workflowName: "workflow-calls" },
      options,
    );

    expect(workflow?.crossWorkflowDispatchIds).toEqual(["__cw:main-worker"]);
    expect(workflow?.counts.crossWorkflowDispatches).toBe(1);
    expect(workflow?.runtime.ready).toBe(true);
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
    const messageNodeExecution = session.nodeExecutions.find(
      (execution) => execution.status === "succeeded",
    );
    expect(messageNodeExecution).toBeDefined();
    if (messageNodeExecution === undefined) {
      return;
    }
    await saveNodeExecutionToRuntimeDb(
      {
        sessionId: session.sessionId,
        nodeId: messageNodeExecution.nodeId,
        ...(messageNodeExecution.stepId === undefined
          ? {}
          : { stepId: messageNodeExecution.stepId }),
        ...(messageNodeExecution.nodeRegistryId === undefined
          ? {}
          : { nodeRegistryId: messageNodeExecution.nodeRegistryId }),
        nodeExecId: messageNodeExecution.nodeExecId,
        executionOrdinal: messageNodeExecution.executionOrdinal ?? 1,
        ...(messageNodeExecution.mailboxInstanceId === undefined
          ? {}
          : { mailboxInstanceId: messageNodeExecution.mailboxInstanceId }),
        status: messageNodeExecution.status,
        artifactDir: messageNodeExecution.artifactDir,
        startedAt: messageNodeExecution.startedAt,
        endedAt: messageNodeExecution.endedAt,
        inputJson: await readFile(
          path.join(messageNodeExecution.artifactDir, "input.json"),
          "utf8",
        ),
        outputJson: await readFile(
          path.join(messageNodeExecution.artifactDir, "output.json"),
          "utf8",
        ),
        inputHash: "sha256:test-input",
        outputHash: "sha256:test-output",
        llmMessages: [
          {
            ordinal: 1,
            eventType: "assistant.snapshot",
            role: "assistant",
            contentText: "schema message",
            backendSessionId: "backend-schema",
            rawMessageJson: '{"type":"assistant.snapshot"}',
          },
        ],
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
    expect(overview?.llmMessages).toHaveLength(1);
    expect(overview?.llmMessages[0]?.contentText).toBe("schema message");
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
    const nodeWithMessage = overview?.nodes.find(
      (node) => node.nodeExecId === messageNodeExecution.nodeExecId,
    );
    expect(nodeWithMessage?.llmMessages[0]?.backendSessionId).toBe(
      "backend-schema",
    );

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

    const malformedValidation =
      await schema.mutation.validateWorkflowDefinition(
        {
          workflowName: "demo",
          bundle: {
            workflow: validBundle.workflow,
            nodePayloads: [] as unknown as Record<string, unknown>,
          },
        },
        options,
      );
    expect(malformedValidation.valid).toBe(false);
    expect(malformedValidation.error).toBe(
      "input.bundle.nodePayloads must be an object",
    );
    expect(malformedValidation.issues).toEqual([]);

    const malformedSave = await schema.mutation.saveWorkflowDefinition(
      {
        workflowName: "demo",
        bundle: {
          workflow: [] as unknown as Record<string, unknown>,
          nodePayloads: validBundle.nodePayloads,
        },
      },
      options,
    );
    expect(malformedSave.error).toBe("input.bundle.workflow must be an object");
    expect(malformedSave.issues).toEqual([]);
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
              addon: {
                name: addonName,
                version: "1",
                inputs: { message: "from local graphql" },
              },
            },
          ],
          steps: [
            {
              id: "addon-worker",
              nodeId: "addon-worker",
              role: "worker",
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
    expect(created.bundle.workflow.entryStepId).toBe("main-worker");
    expect(created.bundle.workflow.managerStepId).toBeUndefined();
    expect("entryNodeId" in created.bundle.workflow).toBe(false);
    expect("managerRuntimeId" in created.bundle.workflow).toBe(false);

    const workflowJsonText = await readFile(
      path.join(root, "solo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerRuntimeId"');
    expect(workflowJsonText).toContain('"entryStepId": "main-worker"');
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
    expect(workflowJsonText).not.toContain('"managerRuntimeId"');
    expect(workflowJsonText).not.toContain('"kind"');
    expect(workflowJsonText).toContain('"entryStepId": "main-worker"');
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
    const workerNode = created.bundle.workflow.nodes.find(
      (node) => node.id === "main-worker",
    );
    expect(workerNode).toBeDefined();
    if (workerNode === undefined) {
      return;
    }
    const workerRegistryNode =
      created.bundle.workflow.nodeRegistry?.find(
        (node) => node.id === "main-worker",
      ) ?? workerNode;
    const { managerStepId: _managerStepId, ...managedWorkflow } = cloneJson(
      created.bundle.workflow,
    );
    const convertedBundle = {
      workflow: {
        ...managedWorkflow,
        hasManagerNode: false,
        entryStepId: "main-worker",
        nodeRegistry: [
          {
            id: workerRegistryNode.id,
            ...(workerRegistryNode.nodeFile === undefined
              ? {}
              : { nodeFile: workerRegistryNode.nodeFile }),
          },
        ],
        steps: [
          {
            id: "main-worker",
            nodeId: "main-worker",
            role: "worker" as const,
          },
        ],
        nodes: [
          {
            ...cloneJson(workerNode),
            role: "worker" as const,
          },
        ],
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
    expect(reloaded?.bundle.workflow.entryStepId).toBe("main-worker");
    expect(reloaded?.bundle.workflow.managerStepId).toBeUndefined();
    expect(
      reloaded == null ? true : "managerRuntimeId" in reloaded.bundle.workflow,
    ).toBe(false);
    expect(
      reloaded == null ? true : "entryNodeId" in reloaded.bundle.workflow,
    ).toBe(false);
    expect(reloaded?.bundle.workflow.nodes).toHaveLength(1);

    const workflowJsonText = await readFile(
      path.join(root, "demo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerRuntimeId"');
    expect(workflowJsonText).toContain('"entryStepId": "main-worker"');
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
    const workerNode = created.bundle.workflow.nodes.find(
      (node) => node.id === "main-worker",
    );
    expect(workerNode).toBeDefined();
    if (workerNode === undefined) {
      return;
    }
    const workerRegistryNode =
      created.bundle.workflow.nodeRegistry?.find(
        (node) => node.id === "main-worker",
      ) ?? workerNode;
    const { managerStepId: _managerStepId, ...managedWorkflow } = cloneJson(
      created.bundle.workflow,
    );

    const convertedBundle = {
      workflow: {
        ...managedWorkflow,
        hasManagerNode: false,
        entryStepId: "main-worker",
        nodeRegistry: [
          {
            id: workerRegistryNode.id,
            ...(workerRegistryNode.nodeFile === undefined
              ? {}
              : { nodeFile: workerRegistryNode.nodeFile }),
          },
        ],
        steps: [
          {
            id: "main-worker",
            nodeId: "main-worker",
            role: "worker" as const,
          },
        ],
        nodes: [
          {
            ...cloneJson(workerNode),
            role: "worker" as const,
          },
        ],
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
    expect(reloaded?.bundle.workflow.entryStepId).toBe("main-worker");
    expect(reloaded?.bundle.workflow.managerStepId).toBeUndefined();
    expect(
      reloaded == null ? true : "managerRuntimeId" in reloaded.bundle.workflow,
    ).toBe(false);
    expect(
      reloaded == null ? true : "entryNodeId" in reloaded.bundle.workflow,
    ).toBe(false);
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
        actions: [{ type: "retry-step", stepId: "main-worker" }],
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
          actions: [{ type: "retry-step", stepId: "main-worker" }],
        },
        {
          ...options,
          authToken: "wrong-secret",
        },
      ),
    ).rejects.toThrow("invalid manager auth");
  });

  test("dispatchSupervisedWorkflowCommand starts target and supervisedWorkflowRun reads it back", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockImplementation(async (_workflowName, runOptions) => {
        const sessionId =
          (runOptions as { readonly sessionId?: string }).sessionId ??
          "sess-supervised-gql-start";
        const session = {
          ...createSessionState({
            sessionId,
            workflowName: "demo",
            workflowId: "demo",
            initialNodeId: "divedra-manager",
            runtimeVariables: {},
          }),
          status: "running" as const,
        };
        const saved = await saveSession(session, options);
        expect(saved.ok).toBe(true);
        return {
          ok: true,
          value: {
            session,
            exitCode: 0,
          },
        };
      });

    const schema = createGraphqlSchema();
    const binding = {
      id: "bind-sup-1",
      sourceId: "src-1",
      workflowName: "demo",
      inputMapping: { mode: "event-input" as const },
      execution: {
        mode: "supervised" as const,
        async: true,
        control: { intentMapping: { mode: "structured-only" as const } },
      },
    };

    const dispatchPayload =
      await schema.mutation.dispatchSupervisedWorkflowCommand(
        {
          command: {
            commandId: "cmd-sup-1",
            sourceId: "src-1",
            bindingId: "bind-sup-1",
            correlationKey: "corr-1",
            action: "start",
            targetWorkflowName: "demo",
            receivedEventReceiptId: "rcpt-1",
          },
          binding,
        },
        options,
      );

    expect(runWorkflowSpy).toHaveBeenCalled();
    const activeSessionId =
      dispatchPayload.supervisedRun.activeTargetExecutionId;
    expect(activeSessionId).toMatch(/^div-demo-/);
    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({ sessionId: activeSessionId }),
    );

    const savedAfter = await saveSession(
      {
        ...createSessionState({
          sessionId: activeSessionId ?? "missing-active-session",
          workflowName: "demo",
          workflowId: "demo",
          initialNodeId: "divedra-manager",
          runtimeVariables: {},
        }),
        status: "running" as const,
      },
      options,
    );
    expect(savedAfter.ok).toBe(true);

    const snapshot = await schema.query.supervisedWorkflowRun(
      {
        sourceId: "src-1",
        bindingId: "bind-sup-1",
        correlationKey: "corr-1",
      },
      options,
    );

    expect(snapshot.supervisedRun.supervisedRunId).toBe(
      dispatchPayload.supervisedRun.supervisedRunId,
    );
    expect(snapshot.activeTargetStatus).toBe("running");
  });

  test("dispatchSupervisedWorkflowCommand rejects non-object runtimeVariables", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const schema = createGraphqlSchema();

    await expect(
      schema.mutation.dispatchSupervisedWorkflowCommand(
        {
          command: {
            commandId: "cmd-sup-bad-runtime",
            sourceId: "src-1",
            bindingId: "bind-sup-1",
            correlationKey: "corr-1",
            action: "start",
            targetWorkflowName: "demo",
            receivedEventReceiptId: "rcpt-1",
          },
          binding: {
            id: "bind-sup-1",
            sourceId: "src-1",
            workflowName: "demo",
            inputMapping: { mode: "event-input" },
            execution: {
              mode: "supervised",
              control: { intentMapping: { mode: "structured-only" } },
            },
          },
          runtimeVariables: ["bad"] as unknown as Readonly<
            Record<string, unknown>
          >,
        },
        options,
      ),
    ).rejects.toThrow("runtimeVariables must be a JSON object");
  });

  test("dispatchSupervisedWorkflowCommand rejects direct-mode bindings", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const schema = createGraphqlSchema();
    await expect(
      schema.mutation.dispatchSupervisedWorkflowCommand(
        {
          command: {
            commandId: "cmd-direct",
            sourceId: "src-1",
            bindingId: "bind-direct",
            correlationKey: "corr-d",
            action: "start",
            targetWorkflowName: "demo",
            receivedEventReceiptId: "rcpt-1",
          },
          binding: {
            id: "bind-direct",
            sourceId: "src-1",
            workflowName: "demo",
            inputMapping: { mode: "event-input" },
            execution: { mode: "direct", async: true },
          },
        },
        options,
      ),
    ).rejects.toThrow(/requires binding\.execution\.mode to be "supervised"/i);
  });

  test("dispatchSupervisedWorkflowCommand rejects command and binding mismatches", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const schema = createGraphqlSchema();
    await expect(
      schema.mutation.dispatchSupervisedWorkflowCommand(
        {
          command: {
            commandId: "cmd-mismatch",
            sourceId: "src-1",
            bindingId: "bind-sup-1",
            correlationKey: "corr-1",
            action: "start",
            targetWorkflowName: "different-workflow",
            receivedEventReceiptId: "rcpt-1",
          },
          binding: {
            id: "bind-sup-1",
            sourceId: "src-1",
            workflowName: "demo",
            inputMapping: { mode: "event-input" },
            execution: {
              mode: "supervised",
              control: { intentMapping: { mode: "structured-only" } },
            },
          },
        },
        options,
      ),
    ).rejects.toThrow(
      /targetWorkflowName does not match binding\.workflowName/i,
    );
  });

  test("supervisedWorkflowRun rejects empty correlation lookup fields", async () => {
    const root = await makeTempDir();
    const schema = createGraphqlSchema();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };

    await expect(
      schema.query.supervisedWorkflowRun(
        {
          sourceId: "src-1",
          bindingId: "",
          correlationKey: "c1",
        },
        options,
      ),
    ).rejects.toThrow(/input\.bindingId/i);
  });

  test("dispatchSupervisedWorkflowCommand rejects invalid supervised restart policy", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const schema = createGraphqlSchema();
    await expect(
      schema.mutation.dispatchSupervisedWorkflowCommand(
        {
          command: {
            commandId: "cmd-bad-restart",
            sourceId: "src-1",
            bindingId: "bind-bad-restart",
            correlationKey: "corr-bad",
            action: "start",
            targetWorkflowName: "demo",
            receivedEventReceiptId: "rcpt-1",
          },
          binding: {
            id: "bind-bad-restart",
            sourceId: "src-1",
            workflowName: "demo",
            inputMapping: { mode: "event-input" },
            execution: {
              mode: "supervised",
              async: true,
              maxRestartsOnFailure: -1,
              control: { intentMapping: { mode: "structured-only" } },
            },
          },
        },
        options,
      ),
    ).rejects.toThrow(/maxRestartsOnFailure/i);
  });

  test("dispatchSupervisorChat uses server context for eventRoot", async () => {
    const root = await makeTempDir();
    const eventRoot = path.join(root, ".divedra-events");
    await mkdir(path.join(eventRoot, "sources"), { recursive: true });
    await mkdir(path.join(eventRoot, "bindings"), { recursive: true });
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
      eventRoot,
    };
    const schema = createGraphqlSchema();
    await expect(
      schema.mutation.dispatchSupervisorChat(
        {
          sourceId: "src-1",
          text: "hi",
        },
        options,
      ),
    ).rejects.toThrow(/event source not found or disabled/i);
  });

  test("dispatchSupervisorChat rejects blank text", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const schema = createGraphqlSchema();
    await expect(
      schema.mutation.dispatchSupervisorChat(
        {
          sourceId: "src-1",
          text: "   ",
        },
        options,
      ),
    ).rejects.toThrow(/non-empty text/i);
  });

  test("dispatchSupervisorConversation rejects supervised binding mode", async () => {
    const root = await makeTempDir();
    const options: GraphqlRequestContext = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const schema = createGraphqlSchema();
    await expect(
      schema.mutation.dispatchSupervisorConversation(
        {
          binding: {
            id: "b1",
            sourceId: "s1",
            workflowName: "demo",
            inputMapping: { mode: "event-input" },
            execution: {
              mode: "supervised",
              control: { intentMapping: { mode: "structured-only" } },
            },
          },
          event: {
            sourceId: "s1",
            eventId: "e1",
            provider: "p",
            eventType: "t",
            receivedAt: "2026-05-01T00:00:00.000Z",
            dedupeKey: "d1",
            input: { text: "x" },
          },
          supervisorProfileId: "prof1",
          correlationKey: "c1",
          sourceMessageId: "d1",
        },
        options,
      ),
    ).rejects.toThrow(/supervisor-dispatch/i);
  });

  test("supervisorDispatchConversation throws when conversation is missing", async () => {
    const root = await makeTempDir();
    const options: GraphqlRequestContext = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const schema = createGraphqlSchema();
    await expect(
      schema.query.supervisorDispatchConversation(
        { supervisorConversationId: "missing-conversation-id" },
        options,
      ),
    ).rejects.toThrow(/no supervisor dispatch conversation/i);
  });

  describe("dispatchSupervisorConversation GraphQL integration", () => {
    async function writeManagerOnlyWorkflow(input: {
      readonly root: string;
      readonly workflowName: string;
      readonly sticky: boolean;
    }): Promise<void> {
      const workflowDir = path.join(input.root, input.workflowName);
      await mkdir(workflowDir, { recursive: true });
      await writeJson(path.join(workflowDir, "workflow.json"), {
        workflowId: input.workflowName,
        description: "manager workflow",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "divedra-manager",
        managerStepId: "divedra-manager",
        nodes: [
          {
            id: "divedra-manager",
            nodeFile: "node-divedra-manager.json",
          },
        ],
        steps: [
          {
            id: "divedra-manager",
            nodeId: "divedra-manager",
            role: "manager",
          },
        ],
      });
      await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        ...(input.sticky ? { sessionPolicy: { mode: "reuse" } } : {}),
        promptTemplate: "manager",
        variables: {},
      });
    }

    async function writeSingleNodeWorkflow(input: {
      readonly root: string;
      readonly workflowName: string;
      readonly nodeId: string;
    }): Promise<void> {
      const workflowDir = path.join(input.root, input.workflowName);
      await mkdir(workflowDir, { recursive: true });
      await writeJson(path.join(workflowDir, "workflow.json"), {
        workflowId: input.workflowName,
        description: "single-node workflow",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: input.nodeId,
        nodes: [
          {
            id: input.nodeId,
            nodeFile: `node-${input.nodeId}.json`,
          },
        ],
        steps: [
          {
            id: input.nodeId,
            nodeId: input.nodeId,
            role: "worker",
          },
        ],
      });
      await writeJson(path.join(workflowDir, `node-${input.nodeId}.json`), {
        id: input.nodeId,
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "worker",
        variables: {},
      });
    }

    async function writeSupervisorDispatchProfile(input: {
      readonly eventRoot: string;
      readonly fileBaseName: string;
      readonly supervisorWorkflowName: string;
      readonly managedWorkflowName: string;
      readonly managedKey: string;
      readonly concurrencyMode: "single-active" | "multiple-active";
      readonly directAnswerPolicy?: {
        readonly enabled: boolean;
        readonly allowedDecisionKinds?: readonly string[];
      };
    }): Promise<void> {
      const supervisorsDir = path.join(input.eventRoot, "supervisors");
      await mkdir(supervisorsDir, { recursive: true });
      await writeJson(path.join(supervisorsDir, `${input.fileBaseName}.json`), {
        supervisorProfileId: input.fileBaseName,
        profileRevision: "1",
        supervisorWorkflowName: input.supervisorWorkflowName,
        managedWorkflows: [
          {
            key: input.managedKey,
            workflowName: input.managedWorkflowName,
            concurrency:
              input.concurrencyMode === "multiple-active"
                ? {
                    mode: "multiple-active",
                    requiresAliasForParallelRuns: true,
                  }
                : { mode: "single-active" },
          },
        ],
        ...(input.directAnswerPolicy === undefined
          ? {}
          : { directAnswerPolicy: input.directAnswerPolicy }),
      });
    }

    function buildSupervisorDispatchBinding(input: {
      readonly profileId: string;
      readonly resolverWorkflowName: string;
      readonly resolverNodeId: string;
      readonly dedupeWindowMs: number;
    }): EventBinding {
      return {
        id: "dispatch-binding-gql",
        sourceId: "chat-webhook",
        inputMapping: { mode: "event-input" },
        execution: {
          mode: "supervisor-dispatch",
          supervisorProfileId: input.profileId,
          async: false,
          allowUnsafeSyncWebhook: true,
          dedupeWindowMs: input.dedupeWindowMs,
          control: {
            intentMapping: {
              mode: "llm-command",
              resolverWorkflowName: input.resolverWorkflowName,
              resolverNodeId: input.resolverNodeId,
            },
          },
        },
      };
    }

    test("replays stored decision for the same sourceMessageId without a second resolver call", async () => {
      const root = await makeTempDir();
      const eventRoot = path.join(root, "events-gql-dispatch");
      const profileId = "gql-dispatch-replay-profile";
      const supWf = "gql-dispatch-replay-sup";
      const resolverWf = "gql-dispatch-replay-resolver";
      const resolverNodeId = "gql-dispatch-replay-res-node";
      const workerWf = "gql-dispatch-replay-worker";

      await writeSupervisorDispatchProfile({
        eventRoot,
        fileBaseName: profileId,
        supervisorWorkflowName: supWf,
        managedWorkflowName: workerWf,
        managedKey: "worker",
        concurrencyMode: "single-active",
        directAnswerPolicy: {
          enabled: true,
          allowedDecisionKinds: ["answer-directly"],
        },
      });
      await writeManagerOnlyWorkflow({
        root,
        workflowName: supWf,
        sticky: false,
      });
      await writeSingleNodeWorkflow({
        root,
        workflowName: resolverWf,
        nodeId: resolverNodeId,
      });
      await writeSingleNodeWorkflow({
        root,
        workflowName: workerWf,
        nodeId: "gql-dispatch-replay-worker-node",
      });

      const resolverSpy = vi.spyOn(
        dispatchResolver,
        "runSupervisorDispatchLlmResolver",
      );

      const binding = buildSupervisorDispatchBinding({
        profileId,
        resolverWorkflowName: resolverWf,
        resolverNodeId,
        dedupeWindowMs: 60_000,
      });

      const options: GraphqlRequestContext = {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        rootDataDir: path.join(root, "data"),
        sessionStoreRoot: path.join(root, "sessions"),
        cwd: root,
        eventRoot,
      };

      const schema = createGraphqlSchema();
      const stableSourceMessageId = "gql-replay-source-msg-1";
      const mockScenario = {
        [resolverNodeId]: [
          {
            payload: {
              action: "answer-directly",
              reason: "graphql replay fixture",
              confidence: 1,
              reply: { text: "direct" },
            },
          },
        ],
      };

      const baseEvent = {
        sourceId: "chat-webhook",
        provider: "chat-webhook",
        eventType: "chat.message",
        dedupeKey: "gql-dedupe-1",
        input: { text: "hello" },
        conversation: { id: "conv-gql-replay", threadId: "thread-gql-replay" },
        actor: { id: "user-1", displayName: "User One" },
      };

      const first = await schema.mutation.dispatchSupervisorConversation(
        {
          binding,
          supervisorProfileId: profileId,
          correlationKey: "corr-gql-replay",
          sourceMessageId: stableSourceMessageId,
          mockScenario,
          event: {
            ...baseEvent,
            eventId: "evt-gql-replay-1",
            receivedAt: "2026-05-01T12:00:00.000Z",
          },
        },
        options,
      );

      expect(first.applied).toBe(true);
      expect(first.decision.supervisorConversationId).toBe(
        first.conversation.supervisorConversationId,
      );
      expect(resolverSpy).toHaveBeenCalledTimes(1);

      const second = await schema.mutation.dispatchSupervisorConversation(
        {
          binding,
          supervisorProfileId: profileId,
          correlationKey: "corr-gql-replay",
          sourceMessageId: stableSourceMessageId,
          mockScenario,
          event: {
            ...baseEvent,
            eventId: "evt-gql-replay-2",
            receivedAt: "2026-05-01T12:30:00.000Z",
          },
        },
        options,
      );

      expect(second.applied).toBe(true);
      expect(second.conversation.supervisorConversationId).toBe(
        first.conversation.supervisorConversationId,
      );
      expect(second.decision.decisionId).toBe(first.decision.decisionId);
      expect(resolverSpy).toHaveBeenCalledTimes(1);

      resolverSpy.mockRestore();
    });
  });
});
