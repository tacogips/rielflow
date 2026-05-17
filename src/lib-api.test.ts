import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  callWorkflowStep,
  createNodeAddonPayloadResolver,
  createWorkflowExecutionClient,
  executeWorkflow,
  getRuntimeSessionView,
  getSession,
  inspectWorkflow,
  listSessions,
  rerunWorkflow,
  resumeWorkflow,
} from "./lib";
import type {
  NodeAddonDefinition,
  NodeAddonPayloadResolver,
  WorkflowInspectionSummary,
} from "./lib";
import type { MockNodeScenario } from "./workflow/scenario-adapter";
import { createWorkflowTemplate } from "./workflow/create";
import * as workflowEngine from "./workflow/engine";
import { createSessionState } from "./workflow/session";
import { saveSession } from "./workflow/session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-lib-test-"));
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
    description: "call step library fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
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
    model: "gpt-5",
    promptTemplate: "writer",
    variables: {},
  });
}

async function createThirdPartyAddonWorkflowFixture(input: {
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly includeSetupNode?: boolean;
}): Promise<void> {
  const workflowDirectory = path.join(input.workflowRoot, input.workflowName);
  await mkdir(workflowDirectory, { recursive: true });

  if (input.includeSetupNode === true) {
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: input.workflowName,
      description: "third-party add-on library fixture",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      entryStepId: "setup",
      nodes: [
        {
          id: "setup",
          nodeFile: "nodes/node-setup.json",
        },
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
          id: "setup",
          nodeId: "setup",
          transitions: [{ toStepId: "addon-worker" }],
        },
        { id: "addon-worker", nodeId: "addon-worker" },
      ],
    });
    await writeJson(path.join(workflowDirectory, "nodes/node-setup.json"), {
      id: "setup",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "setup",
      variables: {},
    });
    return;
  }

  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: input.workflowName,
    description: "third-party add-on library fixture",
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
    steps: [{ id: "addon-worker", nodeId: "addon-worker" }],
  });
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
  await writeJson(path.join(addonDirectory, "addon.json"), {
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
  });
}

function createThirdPartyAddonDefinition(): NodeAddonDefinition {
  return {
    name: "acme/echo-worker",
    version: "1",
    resolve: (input) => ({
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

function createThirdPartyAddonResolver(): NodeAddonPayloadResolver {
  return createNodeAddonPayloadResolver(createThirdPartyAddonDefinition());
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

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("library api", () => {
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

  test("inspects workflow and executes/resumes via library functions", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const mockScenario = makeDefaultTemplateScenario();

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 405 }));
    let summary: WorkflowInspectionSummary;
    try {
      summary = await inspectWorkflow("demo", options);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(summary.workflowName).toBe("demo");
    expect(summary.entryStepId).toBe("divedra-manager");
    expect(summary.counts.nodeRegistry).toBe(2);
    expect(summary.counts.steps).toBe(2);
    expect(summary.counts.crossWorkflowDispatches).toBe(0);
    expect(summary.runtime.ready).toBe(false);
    expect(summary.runtime.blockers).toEqual(
      expect.arrayContaining([expect.stringContaining("code-manager runtime")]),
    );

    const paused = await executeWorkflow({
      workflowName: "demo",
      ...options,
      runtimeVariables: { humanInput: { request: "start demo workflow" } },
      mockScenario,
      maxSteps: 1,
    });
    expect(paused.status).toBe("paused");
    expect(paused.exitCode).toBe(4);

    const sessionBeforeResume = await getSession(paused.sessionId, options);
    expect(sessionBeforeResume.status).toBe("paused");

    const resumed = await resumeWorkflow({
      ...options,
      sessionId: paused.sessionId,
      mockScenario,
    });
    expect(resumed.status).toBe("completed");
    expect(resumed.exitCode).toBe(0);

    const sessions = await listSessions(options);
    expect(sessions.some((entry) => entry.sessionId === paused.sessionId)).toBe(
      true,
    );

    const runtimeView = await getRuntimeSessionView(paused.sessionId, options);
    expect(runtimeView.nodeExecutions.length).toBeGreaterThan(0);
    expect(runtimeView.nodeLogs.length).toBeGreaterThan(0);
  });

  test("lists persisted sessions from the session store even when runtime-db indexing fails", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "blocked-root-data");
    const sessionStoreRoot = path.join(root, "sessions");
    const startedAt = "2026-04-24T00:00:00.000Z";
    const endedAt = "2026-04-24T00:01:00.000Z";

    await writeFile(rootDataDir, "not-a-directory\n", "utf8");

    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-library-list-fallback",
          workflowName: "step-demo",
          workflowId: "step-demo",
          initialNodeId: "writer-step",
          runtimeVariables: {},
        }),
        startedAt,
        endedAt,
        currentNodeId: "writer-step",
        nodeExecutionCounter: 1,
        nodeExecutionCounts: {
          "writer-step": 1,
        },
        nodeExecutions: [
          {
            nodeId: "writer-step",
            stepId: "writer-step",
            nodeRegistryId: "writer-node",
            nodeExecId: "exec-000001",
            mailboxInstanceId: "exec-000001",
            status: "succeeded",
            artifactDir: path.join(root, "artifacts", "exec-000001"),
            startedAt,
            endedAt,
          },
        ],
        status: "completed" as const,
      },
      {
        sessionStoreRoot,
        rootDataDir,
      },
    );
    expect(saved.ok).toBe(true);

    const sessions = await listSessions({
      sessionStoreRoot,
      rootDataDir,
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe("sess-library-list-fallback");
    expect(sessions[0]?.currentStepId).toBe("writer-step");
  });

  test("derives currentStepId from authored workflow state before the first execution record exists", async () => {
    const root = await makeTempDir();
    const sessionStoreRoot = path.join(root, "sessions");
    const rootDataDir = path.join(root, "data");
    const sessionId = "sess-library-current-step";

    await createCallStepFixture(root, "demo");

    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName: "demo",
          workflowId: "demo",
          initialNodeId: "manager-step",
          runtimeVariables: {},
        }),
        status: "paused" as const,
        currentNodeId: "writer-step",
        queue: ["writer-step"],
      },
      {
        sessionStoreRoot,
        rootDataDir,
      },
    );
    expect(saved.ok).toBe(true);

    const sessions = await listSessions({
      workflowRoot: root,
      sessionStoreRoot,
      rootDataDir,
    });
    expect(sessions[0]?.currentStepId).toBe("writer-step");

    const runtimeView = await getRuntimeSessionView(sessionId, {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot,
      rootDataDir,
    });
    expect(runtimeView.session.currentStepId).toBe("writer-step");
  });

  test("calls one workflow step through the library wrapper", async () => {
    const root = await makeTempDir();
    const workflowName = "call-step-lib";
    const sessionId = "sess-call-step-lib";
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

    const result = await callWorkflowStep({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer-step",
      mockScenario: {
        "writer-step": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "library step ok" },
        },
      },
    });

    expect(result.sessionId).toBe(sessionId);
    expect(result.stepId).toBe("writer-step");
    expect(result.status).toBe("succeeded");
    expect(result.output["payload"]).toEqual({ summary: "library step ok" });

    const runtimeView = await getRuntimeSessionView(sessionId, {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot,
    });
    expect(runtimeView.session.currentStepId).toBe("writer-step");
  });

  test("executes a fixed workflow through the library client", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const client = createWorkflowExecutionClient({
      workflowName: "demo",
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      cwd: root,
    });

    const result = await client.execute({
      input: {
        humanInput: {
          request: "start demo workflow from fixed client",
        },
      },
      mockScenario: makeDefaultTemplateScenario(),
    });

    expect(result.workflowName).toBe("demo");
    expect(result.workflowExecutionId).toBe(result.sessionId);
    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
  });

  test("rejects invalid async nodePatch before library client dispatch", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const runWorkflowSpy = vi.spyOn(workflowEngine, "runWorkflow");
    const client = createWorkflowExecutionClient({
      workflowName: "demo",
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      cwd: root,
    });

    await expect(
      client.execute({
        async: true,
        nodePatch: {
          missing: { model: "gpt-5.5" },
        },
      }),
    ).rejects.toThrow("unknown workflow node id 'missing'");

    expect(runWorkflowSpy).not.toHaveBeenCalled();
  });

  test("forwards valid async nodePatch through the library client", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId: "sess-lib-node-patch-async",
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
    const client = createWorkflowExecutionClient({
      workflowName: "demo",
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      cwd: root,
    });

    const result = await client.execute({
      async: true,
      nodePatch: {
        "main-worker": {
          executionBackend: "cursor-cli-agent",
          model: "claude-sonnet-4-5",
        },
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.status).toBe("running");
    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        nodePatch: {
          "main-worker": {
            executionBackend: "cursor-cli-agent",
            model: "claude-sonnet-4-5",
          },
        },
      }),
    );
  });

  test("passes third-party add-on resolvers through execution wrappers", async () => {
    const root = await makeTempDir();
    await createThirdPartyAddonWorkflowFixture({
      workflowRoot: root,
      workflowName: "third-party-execute",
    });

    const result = await executeWorkflow({
      workflowName: "third-party-execute",
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      nodeAddonResolvers: [createThirdPartyAddonResolver()],
      mockScenario: {
        "addon-worker": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "resolved" },
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
  });

  test("executes user-scope workflows through library wrappers", async () => {
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
      return;
    }

    const summary = await inspectWorkflow("scoped-demo", {
      cwd: root,
      workflowScope: "user",
      userRoot,
      env: {},
    });
    expect(summary.workflowName).toBe("scoped-demo");

    const result = await executeWorkflow({
      workflowName: "scoped-demo",
      cwd: root,
      workflowScope: "user",
      userRoot,
      env: {},
      mockScenario: makeDefaultTemplateScenario(),
    });

    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    const session = await getSession(result.sessionId, {
      rootDataDir: path.join(userRoot, "artifacts"),
      env: {},
    });
    expect(session.status).toBe("completed");
  });

  test("reports scoped local add-on sources through library inspection", async () => {
    const root = await makeTempDir();
    const userRoot = path.join(root, "user-scope");
    const workflowName = "local-addon-library";
    const addonName = "acme/local-echo-worker";
    await createThirdPartyAddonWorkflowFixture({
      workflowRoot: path.join(userRoot, "workflows"),
      workflowName,
    });
    await writeLocalAddonManifest({
      addonRoot: path.join(userRoot, "addons"),
      name: addonName,
      version: "1",
      prompt: "Local library {{renderedMessage}}",
    });
    const workflowPath = path.join(
      userRoot,
      "workflows",
      workflowName,
      "workflow.json",
    );
    const workflowJson = JSON.parse(
      await readFile(workflowPath, "utf8"),
    ) as Record<string, unknown>;
    workflowJson["nodes"] = [
      {
        id: "addon-worker",
        addon: {
          name: addonName,
          version: "1",
          inputs: { message: "from local library" },
        },
      },
    ];
    workflowJson["entryStepId"] = "addon-worker";
    workflowJson["steps"] = [{ id: "addon-worker", nodeId: "addon-worker" }];
    await writeJson(workflowPath, workflowJson);

    const summary = await inspectWorkflow(workflowName, {
      cwd: root,
      workflowScope: "user",
      userRoot,
      env: {},
    });

    expect(summary.addonSources).toEqual([
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
  });

  test("rejects invalid workflow scope environment values through library wrappers", async () => {
    const root = await makeTempDir();

    await expect(
      inspectWorkflow("scoped-demo", {
        cwd: root,
        env: {
          DIVEDRA_WORKFLOW_SCOPE: "global",
        },
      }),
    ).rejects.toThrow("DIVEDRA_WORKFLOW_SCOPE");
  });

  test("passes third-party add-on definitions through execution wrappers", async () => {
    const root = await makeTempDir();
    await createThirdPartyAddonWorkflowFixture({
      workflowRoot: root,
      workflowName: "third-party-addon-definition",
    });

    const result = await executeWorkflow({
      workflowName: "third-party-addon-definition",
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      nodeAddons: [createThirdPartyAddonDefinition()],
      mockScenario: {
        "addon-worker": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "resolved" },
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
  });

  test("passes async third-party add-on definitions through execution wrappers", async () => {
    const root = await makeTempDir();
    await createThirdPartyAddonWorkflowFixture({
      workflowRoot: root,
      workflowName: "async-third-party-addon-definition",
    });

    const result = await executeWorkflow({
      workflowName: "async-third-party-addon-definition",
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      nodeAddons: [createAsyncThirdPartyAddonDefinition()],
      mockScenario: {
        "addon-worker": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "resolved" },
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
  });

  test("passes third-party add-on resolvers through resume and rerun wrappers", async () => {
    const root = await makeTempDir();
    const workflowName = "third-party-resume";
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      nodeAddonResolvers: [createThirdPartyAddonResolver()],
      mockScenario: {
        setup: {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "setup" },
        },
        "addon-worker": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "resolved" },
        },
      },
    };
    await createThirdPartyAddonWorkflowFixture({
      workflowRoot: root,
      workflowName,
      includeSetupNode: true,
    });

    const paused = await executeWorkflow({
      workflowName,
      ...options,
      maxSteps: 1,
    });
    expect(paused.status).toBe("paused");

    const resumed = await resumeWorkflow({
      ...options,
      sessionId: paused.sessionId,
    });
    expect(resumed.status).toBe("completed");

    const rerun = await rerunWorkflow({
      ...options,
      sourceSessionId: resumed.sessionId,
      fromStepId: "addon-worker",
    });
    expect(rerun.status).toBe("completed");
    expect(rerun.exitCode).toBe(0);
    expect(rerun.rerunFromStepId).toBe("addon-worker");
  });

  test("rerunWorkflow forwards only the authored step id", async () => {
    const root = await makeTempDir();
    const workflowName = "rerun-call-step-lib";
    const sessionId = "sess-rerun-call-step-lib";
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };

    await createCallStepFixture(root, workflowName);
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
              sessionId: "sess-rerun-call-step-lib-2",
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

    const rerun = await rerunWorkflow({
      ...options,
      sourceSessionId: sessionId,
      fromStepId: "writer-step",
    });

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      workflowName,
      expect.objectContaining({
        rerunFromSessionId: sessionId,
        rerunFromStepId: "writer-step",
      }),
    );
    expect(rerun).toMatchObject({
      sessionId: "sess-rerun-call-step-lib-2",
      status: "running",
      rerunFromStepId: "writer-step",
      exitCode: 0,
    });
  });

  test("resumeWorkflow forwards autoImprove to runWorkflow", async () => {
    const root = await makeTempDir();
    const workflowName = "resume-ai-lib";
    const sessionId = "sess-resume-ai-lib";
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };
    const policy = {
      enabled: true as const,
      monitorIntervalMs: 1111,
      stallTimeoutMs: 60_000,
      maxSupervisedAttempts: 3,
      maxWorkflowPatches: 2,
      workflowMutationMode: "execution-copy" as const,
    };
    await saveSession(
      createSessionState({
        sessionId,
        workflowName,
        workflowId: workflowName,
        initialNodeId: "step-a",
        runtimeVariables: {},
      }),
      options,
    );
    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: createSessionState({
            sessionId,
            workflowName,
            workflowId: workflowName,
            initialNodeId: "step-a",
            runtimeVariables: {},
          }),
          exitCode: 0,
        },
      });

    await resumeWorkflow({
      ...options,
      sessionId,
      autoImprove: policy,
    });

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      workflowName,
      expect.objectContaining({
        resumeSessionId: sessionId,
        autoImprove: policy,
      }),
    );
    runWorkflowSpy.mockRestore();
  });

  test("executeWorkflow forwards lifecycle-only supervision as raw input", async () => {
    const root = await makeTempDir();
    const workflowName = "disable-ai-lib";
    await createCallStepFixture(root, workflowName);
    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: createSessionState({
            sessionId: "sess-disable-ai-lib",
            workflowName,
            workflowId: workflowName,
            initialNodeId: "manager-step",
            runtimeVariables: {},
          }),
          exitCode: 0,
        },
      });

    await executeWorkflow({
      workflowName,
      workflowRoot: root,
      disableAutoImprove: true,
    });

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      workflowName,
      expect.objectContaining({
        autoImprove: {
          enabled: true,
          maxWorkflowPatches: 0,
        },
      }),
    );
  });

  test("executes a fixed workflow through the endpoint-backed library client", async () => {
    const fetchImpl: typeof fetch = vi.fn(async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        variables: {
          input: {
            workflowName: string;
            runtimeVariables: Readonly<Record<string, unknown>>;
            workingDirectory?: string;
            async: boolean;
            dryRun: boolean;
          };
        };
      };
      expect(payload.variables.input.workflowName).toBe("demo");
      expect(payload.variables.input.runtimeVariables).toEqual({
        humanInput: {
          request: "remote fixed client",
        },
      });
      expect(payload.variables.input.workingDirectory).toBe("apps/reviewer");
      expect(payload.variables.input.async).toBe(true);
      expect(payload.variables.input.dryRun).toBe(true);
      return new Response(
        JSON.stringify({
          data: {
            executeWorkflow: {
              workflowExecutionId: "sess-remote-fixed",
              sessionId: "sess-remote-fixed",
              status: "running",
              accepted: true,
              exitCode: null,
            },
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const client = createWorkflowExecutionClient({
      workflowName: "demo",
      endpoint: "http://example.test/graphql",
      fetchImpl,
    });

    const result = await client.execute({
      input: {
        humanInput: {
          request: "remote fixed client",
        },
      },
      workingDirectory: " apps/reviewer ",
      async: true,
      dryRun: true,
    });

    expect(result.workflowName).toBe("demo");
    expect(result.workflowExecutionId).toBe("sess-remote-fixed");
    expect(result.sessionId).toBe("sess-remote-fixed");
    expect(result.status).toBe("running");
    expect(result.accepted).toBe(true);
    expect(result.exitCode).toBeUndefined();
  });

  test("rejects mixed input and runtimeVariables in the fixed workflow client", async () => {
    const client = createWorkflowExecutionClient({
      workflowName: "demo",
      endpoint: "http://example.test/graphql",
      fetchImpl: vi.fn() as typeof fetch,
    });

    await expect(
      client.execute({
        input: { humanInput: { request: "one" } },
        runtimeVariables: { humanInput: { request: "two" } },
      }),
    ).rejects.toThrow("use only one of input or runtimeVariables");
  });
});
