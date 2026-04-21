import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  callWorkflowNode,
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
import type { NodeAddonDefinition, NodeAddonPayloadResolver } from "./lib";
import type { MockNodeScenario } from "./workflow/adapter";
import { createWorkflowTemplate } from "./workflow/create";
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

async function createCallNodeFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDirectory = path.join(workflowRoot, workflowName);
  await mkdir(workflowDirectory, { recursive: true });
  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: workflowName,
    description: "call node library fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "writer",
        kind: "task",
        nodeFile: "node-writer.json",
        completion: { type: "none" },
      },
    ],
    edges: [],
    loops: [],
    branching: { mode: "fan-out" },
  });
  await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    promptTemplate: "manager",
    variables: {},
  });
  await writeJson(path.join(workflowDirectory, "node-writer.json"), {
    id: "writer",
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

  const nodes =
    input.includeSetupNode === true
      ? [
          {
            id: "setup",
            role: "worker",
            nodeFile: "nodes/node-setup.json",
            completion: { type: "none" },
          },
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
        ]
      : [
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
        ];

  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: input.workflowName,
    description: "third-party add-on library fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryNodeId: input.includeSetupNode === true ? "setup" : "addon-worker",
    nodes,
    edges:
      input.includeSetupNode === true
        ? [{ from: "setup", to: "addon-worker", when: "always" }]
        : [],
    loops: [],
    branching: { mode: "fan-out" },
  });

  if (input.includeSetupNode === true) {
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await writeJson(path.join(workflowDirectory, "nodes/node-setup.json"), {
      id: "setup",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "setup",
      variables: {},
    });
  }
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
      cwd: root,
    };
    const mockScenario = makeDefaultTemplateScenario();

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 405 }));
    let summary;
    try {
      summary = await inspectWorkflow("demo", options);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(summary.workflowName).toBe("demo");
    expect(summary.runtime.ready).toBe(true);

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

  test("calls one workflow node through the library wrapper", async () => {
    const root = await makeTempDir();
    const workflowName = "call-node-lib";
    const sessionId = "sess-call-node-lib";
    const sessionStoreRoot = path.join(root, "sessions");

    await createCallNodeFixture(root, workflowName);

    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName,
        workflowId: workflowName,
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      {
        sessionStoreRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const result = await callWorkflowNode({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      nodeId: "writer",
      mockScenario: {
        writer: {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "library ok" },
        },
      },
    });

    expect(result.sessionId).toBe(sessionId);
    expect(result.status).toBe("succeeded");
    expect(result.output["payload"]).toEqual({ summary: "library ok" });
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
        role: "worker",
        addon: {
          name: addonName,
          version: "1",
          inputs: { message: "from local library" },
        },
        completion: { type: "none" },
      },
    ];
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
      fromNodeId: "addon-worker",
    });
    expect(rerun.status).toBe("completed");
    expect(rerun.exitCode).toBe(0);
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
