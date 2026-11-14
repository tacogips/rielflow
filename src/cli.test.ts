import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createOpenTuiWorkflowAppOptions,
  loadOpenTuiScreenImplementations,
  resolveCliHomeDir,
  resolveTuiStartupSelection,
  runCli,
  shouldFallbackFromOpenTuiError,
} from "./cli";
import type { CliDependencies } from "./cli";
import * as workflowCallNode from "./workflow/call-node";
import * as workflowEngine from "./workflow/engine";
import { ok } from "./workflow/result";
import { saveEventReplyDispatchToRuntimeDb } from "./workflow/runtime-db";
import { createSessionState } from "./workflow/session";
import { saveSession } from "./workflow/session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-cli-test-"));
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

function makeDefaultTemplateScenario(): Readonly<Record<string, unknown>> {
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

function createIoCapture(): {
  stdout: string[];
  stderr: string[];
  io: { stdout: (line: string) => void; stderr: (line: string) => void };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (line: string) => {
        stdout.push(line);
      },
      stderr: (line: string) => {
        stderr.push(line);
      },
    },
  };
}

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

async function writeRuntimeVariablesFile(
  root: string,
  fileName: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<string> {
  const filePath = path.join(root, fileName);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeLocalAddonManifest(input: {
  readonly addonRoot: string;
  readonly name: string;
  readonly version: string;
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
    "CLI local {{renderedMessage}}\n",
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

async function createCallNodeFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDirectory = path.join(workflowRoot, workflowName);
  await mkdir(workflowDirectory, { recursive: true });

  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: workflowName,
    description: "call node cli fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
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
    output: {
      description: "writer output",
      maxValidationAttempts: 2,
      jsonSchema: {
        type: "object",
        required: ["summary"],
        properties: {
          summary: { type: "string" },
        },
      },
    },
  });
}

async function createManagerlessWorkflowFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDirectory = path.join(workflowRoot, workflowName);
  await mkdir(workflowDirectory, { recursive: true });

  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: workflowName,
    description: "worker-only cli fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryNodeId: "worker-1",
    nodes: [
      {
        id: "worker-1",
        role: "worker",
        nodeFile: "node-worker-1.json",
        completion: { type: "none" },
      },
      {
        id: "worker-2",
        role: "worker",
        nodeFile: "node-worker-2.json",
        completion: { type: "none" },
      },
    ],
    edges: [{ from: "worker-1", to: "worker-2", when: "always" }],
    loops: [],
    branching: { mode: "fan-out" },
  });
  await writeJson(path.join(workflowDirectory, "node-worker-1.json"), {
    id: "worker-1",
    executionBackend: "codex-agent",
    model: "gpt-5",
    promptTemplate: "step 1",
    variables: {},
  });
  await writeJson(path.join(workflowDirectory, "node-worker-2.json"), {
    id: "worker-2",
    executionBackend: "codex-agent",
    model: "gpt-5",
    promptTemplate: "step 2",
    variables: {},
  });
}

async function createWorkflowCallInspectFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDirectory = path.join(workflowRoot, workflowName);
  await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: workflowName,
    description: "workflow-call cli fixture",
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
  });
  await writeJson(
    path.join(workflowDirectory, "nodes", "node-divedra-manager.json"),
    {
      id: "divedra-manager",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "manage the workflow",
      variables: {},
    },
  );
  await writeJson(
    path.join(workflowDirectory, "nodes", "node-main-worker.json"),
    {
      id: "main-worker",
      executionBackend: "codex-agent",
      model: "gpt-5",
      promptTemplate: "do the work",
      variables: {},
    },
  );

  const reviewDirectory = path.join(workflowRoot, "review");
  await mkdir(path.join(reviewDirectory, "nodes"), { recursive: true });
  await writeJson(path.join(reviewDirectory, "workflow.json"), {
    workflowId: "review",
    description: "workflow-call cli callee fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryNodeId: "reviewer",
    nodes: [
      {
        id: "reviewer",
        role: "worker",
        nodeFile: "nodes/node-reviewer.json",
      },
    ],
  });
  await writeJson(path.join(reviewDirectory, "nodes", "node-reviewer.json"), {
    id: "reviewer",
    executionBackend: "codex-agent",
    model: "gpt-5",
    promptTemplate: "review the work",
    variables: {},
  });
}

async function createCompletedCliWorkflowRun(root: string): Promise<{
  readonly workflowName: string;
  readonly artifactsRoot: string;
  readonly sessionsRoot: string;
  readonly sessionId: string;
}> {
  const workflowName = "demo";
  const artifactsRoot = path.join(root, "artifacts");
  const sessionsRoot = path.join(root, "sessions");
  const scenarioPath = path.join(root, "scenario.json");
  const variablesPath = await writeRuntimeVariablesFile(
    root,
    "runtime-variables.json",
    {
      humanInput: { request: "start demo workflow" },
    },
  );
  await writeFile(
    scenarioPath,
    JSON.stringify(makeDefaultTemplateScenario(), null, 2),
    "utf8",
  );

  expect(
    await runCli(
      ["workflow", "create", workflowName, "--workflow-root", root],
      createIoCapture().io,
    ),
  ).toBe(0);

  const runCapture = createIoCapture();
  expect(
    await runCli(
      [
        "workflow",
        "run",
        workflowName,
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
        "--variables",
        variablesPath,
        "--output",
        "json",
      ],
      runCapture.io,
    ),
  ).toBe(0);

  const runPayload = JSON.parse(runCapture.stdout.join("\n")) as {
    sessionId: string;
  };

  return {
    workflowName,
    artifactsRoot,
    sessionsRoot,
    sessionId: runPayload.sessionId,
  };
}

describe("runCli", () => {
  test("resolveTuiStartupSelection aligns interactive resume with the session workflow", () => {
    expect(
      resolveTuiStartupSelection({
        requestedWorkflowName: "demo",
        resumeSession: {
          sessionId: "session-123",
          workflowName: "demo",
        },
      }),
    ).toEqual({
      ok: true,
      initialSessionId: "session-123",
      initialWorkflowName: "demo",
    });
  });

  test("resolveTuiStartupSelection rejects conflicting workflow and resume-session inputs", () => {
    expect(
      resolveTuiStartupSelection({
        requestedWorkflowName: "other",
        resumeSession: {
          sessionId: "session-123",
          workflowName: "demo",
        },
      }),
    ).toEqual({
      ok: false,
      message:
        "resume session 'session-123' belongs to workflow 'demo', not 'other'",
    });
  });

  test("shouldFallbackFromOpenTuiError only matches OpenTUI package availability failures", () => {
    expect(
      shouldFallbackFromOpenTuiError(
        new Error("Cannot find package '@opentui/core' imported from src/tui"),
      ),
    ).toBe(true);
    expect(
      shouldFallbackFromOpenTuiError(
        new Error("Cannot find package '@opentui/solid' imported from src/tui"),
      ),
    ).toBe(true);
    expect(
      shouldFallbackFromOpenTuiError(
        new Error("Cannot find package 'solid-js' imported from src/tui"),
      ),
    ).toBe(true);
    expect(
      shouldFallbackFromOpenTuiError(
        new Error(
          "Cannot find module 'solid-js/jsx-runtime' imported from src/tui/opentui-solid-app.tsx",
        ),
      ),
    ).toBe(true);
    expect(
      shouldFallbackFromOpenTuiError(
        new Error('cannot find module "@opentui/core"'),
      ),
    ).toBe(true);
    expect(
      shouldFallbackFromOpenTuiError(
        new Error("Cannot find module '@opentui/core'"),
      ),
    ).toBe(true);
    expect(
      shouldFallbackFromOpenTuiError(
        new Error("Cannot find package '@opentui/core-linux-x64'"),
      ),
    ).toBe(true);
    expect(
      shouldFallbackFromOpenTuiError(
        new Error('Cannot find module "@opentui/core-darwin-arm64"'),
      ),
    ).toBe(true);
    expect(
      shouldFallbackFromOpenTuiError(new Error("workflow load failed")),
    ).toBe(false);
    expect(
      shouldFallbackFromOpenTuiError(new Error("OpenTUI screen render failed")),
    ).toBe(false);
    expect(
      shouldFallbackFromOpenTuiError(
        new Error("Cannot find package '@types/node' imported from src/tui"),
      ),
    ).toBe(false);
    expect(shouldFallbackFromOpenTuiError("@opentui/core")).toBe(false);
  });

  test("loadOpenTuiScreenImplementations prefers an injected OpenTUI app", async () => {
    const runOpenTuiWorkflowApp = vi.fn<
      NonNullable<CliDependencies["runOpenTuiWorkflowApp"]>
    >(async () => 0);

    const loaded = await loadOpenTuiScreenImplementations({
      isInteractiveTerminal: () => true,
      runOpenTuiWorkflowApp,
      startServe: async () => ({
        host: "127.0.0.1",
        port: 7777,
        stop: () => {},
      }),
    });

    expect(loaded.runOpenTuiWorkflowApp).toBe(runOpenTuiWorkflowApp);
  });

  test("resolveCliHomeDir prefers HOME over USERPROFILE in injected env", () => {
    expect(
      resolveCliHomeDir({
        HOME: "/tmp/home",
        USERPROFILE: "/tmp/profile",
      }),
    ).toBe("/tmp/home");
    expect(
      resolveCliHomeDir({
        HOME: "",
        USERPROFILE: "/tmp/profile",
      }),
    ).toBe("/tmp/profile");
  });

  test("resolveCliHomeDir falls back to os.homedir when env vars are unavailable", () => {
    const previousHome = process.env["HOME"];
    const previousUserProfile = process.env["USERPROFILE"];
    process.env["HOME"] = "";
    process.env["USERPROFILE"] = "";
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue("/tmp/os-home");
    try {
      expect(
        resolveCliHomeDir({
          HOME: "",
          USERPROFILE: "",
        }),
      ).toBe("/tmp/os-home");
    } finally {
      homedirSpy.mockRestore();
      if (previousHome === undefined) {
        delete process.env["HOME"];
      } else {
        process.env["HOME"] = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env["USERPROFILE"];
      } else {
        process.env["USERPROFILE"] = previousUserProfile;
      }
    }
  });

  test("createOpenTuiWorkflowAppOptions merges CLI runtime variables into executeWorkflow", async () => {
    const root = await makeTempDir();
    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);

    const startedInputs: Array<{
      readonly workflowName: string;
      readonly runtimeVariables: Readonly<Record<string, unknown>>;
      readonly sessionId: string;
    }> = [];
    const appOptions = createOpenTuiWorkflowAppOptions({
      deps: {
        env: {},
      },
      io: createIoCapture().io,
      optionRuntimeVariables: {
        cliOnlyFlag: true,
      },
      runLocalTuiWorkflow: async () => ({
        exitCode: 0,
        sessionId: "unused",
        status: "completed",
      }),
      sharedOptions: {
        workflowRoot: root,
      },
      startLocalTuiWorkflow: async (input) => {
        startedInputs.push(input);
        return {
          sessionId: input.sessionId,
          completion: Promise.resolve({
            exitCode: 0,
            sessionId: input.sessionId,
            status: "completed",
          }),
        };
      },
      workflowNames: ["demo"],
    });

    const handle = await appOptions.executeWorkflow({
      workflowName: "demo",
      runtimeVariables: {
        humanInput: {
          request: "ship it",
        },
      },
    });

    expect(startedInputs).toHaveLength(1);
    expect(startedInputs[0]).toMatchObject({
      workflowName: "demo",
      runtimeVariables: {
        cliOnlyFlag: true,
        humanInput: {
          request: "ship it",
        },
      },
    });
    expect(startedInputs[0]?.sessionId).toMatch(/^div-demo-/);
    expect(handle.sessionId).toBe(startedInputs[0]?.sessionId);
  });

  test("returns help for unknown scope", async () => {
    const capture = createIoCapture();
    const code = await runCli(["unknown", "cmd", "target"], capture.io);
    expect(code).toBe(1);
    expect(capture.stdout.join("\n")).toContain("Usage:");
  });

  test("call-node executes locally with structured manager message input", async () => {
    const root = await makeTempDir();
    const workflowName = "call-node-cli";
    const sessionId = "sess-call-node-cli";
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const messagePath = path.join(root, "message.json");

    await createCallNodeFixture(root, workflowName);
    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName,
        workflowId: workflowName,
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      { sessionStoreRoot },
    );
    expect(saved.ok).toBe(true);

    await writeFile(
      scenarioPath,
      JSON.stringify(
        {
          writer: [
            {
              provider: "scenario-mock",
              when: { always: true },
              payload: { wrong: true },
            },
            {
              provider: "scenario-mock",
              when: { always: true },
              payload: { summary: "cli ok" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      messagePath,
      JSON.stringify({ instruction: "review this change" }, null, 2),
      "utf8",
    );

    const capture = createIoCapture();
    const code = await runCli(
      [
        "call-node",
        workflowName,
        sessionId,
        "writer",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionStoreRoot,
        "--mock-scenario",
        scenarioPath,
        "--message-file",
        messagePath,
        "--output",
        "json",
      ],
      capture.io,
    );

    expect(code).toBe(0);
    const payload = JSON.parse(capture.stdout.join("\n")) as {
      output: { payload: { summary: string } };
      outputRef: { artifactDir: string };
    };
    expect(payload.output.payload.summary).toBe("cli ok");

    const inputJson = JSON.parse(
      await readFile(
        path.join(payload.outputRef.artifactDir, "input.json"),
        "utf8",
      ),
    ) as { managerMessage?: { instruction?: string } };
    expect(inputJson.managerMessage?.instruction).toBe("review this change");
  });

  test("create -> validate -> inspect roundtrip", async () => {
    const root = await makeTempDir();

    const createCapture = createIoCapture();
    const createCode = await runCli(
      ["workflow", "create", "demo", "--workflow-root", root],
      createCapture.io,
    );
    expect(createCode).toBe(0);

    const validateCapture = createIoCapture();
    const validateCode = await runCli(
      ["workflow", "validate", "demo", "--workflow-root", root],
      validateCapture.io,
    );
    expect(validateCode).toBe(0);
    expect(validateCapture.stdout.join("\n")).toContain("is valid");

    const inspectCapture = createIoCapture();
    const inspectCode = await runCli(
      [
        "workflow",
        "inspect",
        "demo",
        "--workflow-root",
        root,
        "--output",
        "json",
      ],
      inspectCapture.io,
    );
    expect(inspectCode).toBe(0);

    const outputJson = inspectCapture.stdout.join("\n");
    const parsed = JSON.parse(outputJson) as {
      workflowName: string;
      entryNodeId: string;
      managerNodeId?: string;
      counts: { nodes: number };
      runtime: { ready: boolean };
    };
    expect(parsed.workflowName).toBe("demo");
    expect(parsed.entryNodeId).toBe("divedra-manager");
    expect(parsed.managerNodeId).toBe("divedra-manager");
    expect(parsed.counts.nodes).toBe(2);
    expect(parsed.runtime.ready).toBe(true);
  });

  test("workflow commands resolve explicit user scope", async () => {
    const root = await makeTempDir();
    const userRoot = path.join(root, "user");
    const workflowDirectory = path.join(userRoot, "workflows", "demo");

    const createCapture = createIoCapture();
    const createCode = await runCli(
      [
        "workflow",
        "create",
        "demo",
        "--scope",
        "user",
        "--user-root",
        userRoot,
      ],
      createCapture.io,
    );
    expect(createCode).toBe(0);
    expect(createCapture.stdout.join("\n")).toContain(workflowDirectory);

    const validateCapture = createIoCapture();
    const validateCode = await runCli(
      [
        "workflow",
        "validate",
        "demo",
        "--scope",
        "user",
        "--user-root",
        userRoot,
      ],
      validateCapture.io,
    );
    expect(validateCode).toBe(0);
    expect(validateCapture.stdout.join("\n")).toContain("is valid");
    expect(validateCapture.stdout.join("\n")).toContain(
      `source: user ${workflowDirectory}`,
    );

    const inspectCapture = createIoCapture();
    const inspectCode = await runCli(
      [
        "workflow",
        "inspect",
        "demo",
        "--scope",
        "user",
        "--user-root",
        userRoot,
        "--output",
        "json",
      ],
      inspectCapture.io,
    );
    expect(inspectCode).toBe(0);
    const inspectPayload = JSON.parse(inspectCapture.stdout.join("\n")) as {
      source?: { scope?: string; workflowDirectory?: string };
    };
    expect(inspectPayload.source?.scope).toBe("user");
    expect(inspectPayload.source?.workflowDirectory).toBe(workflowDirectory);

    const scenarioPath = path.join(root, "scenario.json");
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );
    const runCapture = createIoCapture();
    const runCode = await runCli(
      [
        "workflow",
        "run",
        "demo",
        "--scope",
        "user",
        "--user-root",
        userRoot,
        "--mock-scenario",
        scenarioPath,
        "--output",
        "json",
      ],
      runCapture.io,
    );
    expect(runCode).toBe(0);
    const runPayload = JSON.parse(runCapture.stdout.join("\n")) as {
      source?: { scope?: string; workflowDirectory?: string };
    };
    expect(runPayload.source?.scope).toBe("user");
    expect(runPayload.source?.workflowDirectory).toBe(workflowDirectory);
  });

  test("workflow validate and inspect report scoped local add-on sources", async () => {
    const root = await makeTempDir();
    const userRoot = path.join(root, "user");
    const workflowName = "local-addon-cli";
    const addonName = "acme/local-echo-worker";
    const workflowDirectory = path.join(userRoot, "workflows", workflowName);
    await mkdir(workflowDirectory, { recursive: true });
    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "local add-on cli fixture",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      entryNodeId: "addon-worker",
      nodes: [
        {
          id: "addon-worker",
          role: "worker",
          addon: {
            name: addonName,
            version: "1",
            inputs: { message: "from cli" },
          },
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });
    await writeLocalAddonManifest({
      addonRoot: path.join(userRoot, "addons"),
      name: addonName,
      version: "1",
    });

    const validateCapture = createIoCapture();
    const validateCode = await runCli(
      [
        "workflow",
        "validate",
        workflowName,
        "--scope",
        "user",
        "--user-root",
        userRoot,
        "--output",
        "json",
      ],
      validateCapture.io,
    );
    expect(validateCode).toBe(0);
    const validation = JSON.parse(validateCapture.stdout.join("\n")) as {
      addonSources?: ReadonlyArray<{
        readonly nodeId: string;
        readonly name: string;
        readonly scope: string;
        readonly manifestPath: string;
      }>;
    };
    expect(validation.addonSources).toEqual([
      expect.objectContaining({
        nodeId: "addon-worker",
        name: addonName,
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

    const inspectCapture = createIoCapture();
    const inspectCode = await runCli(
      [
        "workflow",
        "inspect",
        workflowName,
        "--scope",
        "user",
        "--user-root",
        userRoot,
      ],
      inspectCapture.io,
    );
    expect(inspectCode).toBe(0);
    expect(inspectCapture.stdout.join("\n")).toContain(
      `addonSource: addon-worker: ${addonName}@1 user`,
    );
  });

  test("workflow commands reject invalid scope selectors", async () => {
    const capture = createIoCapture();

    const code = await runCli(
      ["workflow", "validate", "demo", "--scope", "global"],
      capture.io,
    );

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "invalid --scope value 'global'",
    );
  });

  test("workflow commands reject invalid scope environment selectors", async () => {
    const capture = createIoCapture();

    const code = await runCli(["workflow", "validate", "demo"], capture.io, {
      startServe: async () => ({
        host: "127.0.0.1",
        port: 7777,
        stop: () => {},
      }),
      isInteractiveTerminal: () => true,
      env: {
        DIVEDRA_WORKFLOW_SCOPE: "global",
      },
    });

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "invalid DIVEDRA_WORKFLOW_SCOPE value 'global'",
    );
  });

  test("workflow commands resolve explicit project scope root", async () => {
    const root = await makeTempDir();
    const projectRoot = path.join(root, ".divedra");

    const createCapture = createIoCapture();
    const createCode = await runCli(
      [
        "workflow",
        "create",
        "demo",
        "--scope",
        "project",
        "--project-root",
        projectRoot,
      ],
      createCapture.io,
    );
    expect(createCode).toBe(0);
    expect(createCapture.stdout.join("\n")).toContain(
      path.join(projectRoot, "workflows", "demo"),
    );

    const inspectCapture = createIoCapture();
    const inspectCode = await runCli(
      [
        "workflow",
        "inspect",
        "demo",
        "--scope",
        "project",
        "--project-root",
        projectRoot,
        "--output",
        "json",
      ],
      inspectCapture.io,
    );
    expect(inspectCode).toBe(0);
    const parsed = JSON.parse(inspectCapture.stdout.join("\n")) as {
      workflowName: string;
    };
    expect(parsed.workflowName).toBe("demo");
  });

  test("create --worker-only scaffolds a manager-less starter", async () => {
    const root = await makeTempDir();

    const createCapture = createIoCapture();
    const createCode = await runCli(
      ["workflow", "create", "solo", "--workflow-root", root, "--worker-only"],
      createCapture.io,
    );
    expect(createCode).toBe(0);

    const inspectCapture = createIoCapture();
    const inspectCode = await runCli(
      [
        "workflow",
        "inspect",
        "solo",
        "--workflow-root",
        root,
        "--output",
        "json",
      ],
      inspectCapture.io,
    );
    expect(inspectCode).toBe(0);

    const parsed = JSON.parse(inspectCapture.stdout.join("\n")) as {
      entryNodeId: string;
      hasManagerNode: boolean;
      managerNodeId?: string;
      counts: { nodes: number };
    };
    expect(parsed.hasManagerNode).toBe(false);
    expect(parsed.managerNodeId).toBeUndefined();
    expect(parsed.entryNodeId).toBe("main-worker");
    expect(parsed.counts.nodes).toBe(1);
  });

  test("inspect reports worker-only workflows without an authored manager node", async () => {
    const root = await makeTempDir();
    await createManagerlessWorkflowFixture(root, "worker-only");

    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "inspect",
        "worker-only",
        "--workflow-root",
        root,
        "--output",
        "json",
      ],
      capture.io,
    );
    expect(code).toBe(0);

    const parsed = JSON.parse(capture.stdout.join("\n")) as {
      compatibility: {
        usesEffectiveEntryManagerNodeId: boolean;
        notes: readonly string[];
      };
      entryNodeId: string;
      hasManagerNode: boolean;
      managerNodeId?: string;
      counts: { nodes: number };
    };
    expect(parsed.hasManagerNode).toBe(false);
    expect(parsed.managerNodeId).toBeUndefined();
    expect(parsed.entryNodeId).toBe("worker-1");
    expect(parsed.counts.nodes).toBe(2);
    expect(parsed.compatibility.usesEffectiveEntryManagerNodeId).toBe(true);
    expect(parsed.compatibility.notes).toContain(
      "Worker-only workflows normalize entryNodeId to an internal effective managerNodeId during runtime execution.",
    );
  });

  test("inspect reports authored workflowCalls in json and text output", async () => {
    const root = await makeTempDir();
    await createWorkflowCallInspectFixture(root, "workflow-calls");

    const jsonCapture = createIoCapture();
    const jsonCode = await runCli(
      [
        "workflow",
        "inspect",
        "workflow-calls",
        "--workflow-root",
        root,
        "--output",
        "json",
      ],
      jsonCapture.io,
    );
    expect(jsonCode).toBe(0);

    const parsed = JSON.parse(jsonCapture.stdout.join("\n")) as {
      compatibility: {
        normalizesRoleAuthoredNodesToStructuralKinds: boolean;
        usesLegacyStructuralSubWorkflows: boolean;
        notes: readonly string[];
      };
      workflowCallIds: readonly string[];
      counts: { workflowCalls: number; legacySubWorkflows: number };
      runtime: { ready: boolean };
    };
    expect(parsed.workflowCallIds).toEqual(["review-call"]);
    expect(parsed.counts.workflowCalls).toBe(1);
    expect(parsed.counts.legacySubWorkflows).toBe(0);
    expect(parsed.runtime.ready).toBe(true);
    expect(
      parsed.compatibility.normalizesRoleAuthoredNodesToStructuralKinds,
    ).toBe(true);
    expect(parsed.compatibility.usesLegacyStructuralSubWorkflows).toBe(false);
    expect(parsed.compatibility.notes).toContain(
      "Role-authored nodes still normalize to structural runtime kinds internally for execution compatibility.",
    );

    const textCapture = createIoCapture();
    const textCode = await runCli(
      ["workflow", "inspect", "workflow-calls", "--workflow-root", root],
      textCapture.io,
    );
    expect(textCode).toBe(0);
    expect(textCapture.stdout.join("\n")).toContain("workflowCalls: 1");
    expect(textCapture.stdout.join("\n")).toContain(
      "workflowCallIds: review-call",
    );
    expect(textCapture.stdout.join("\n")).toContain("compatibility:");
    expect(textCapture.stdout.join("\n")).toContain(
      "Role-authored nodes still normalize to structural runtime kinds internally for execution compatibility.",
    );
    expect(textCapture.stdout.join("\n")).not.toContain("subWorkflows:");
    expect(textCapture.stdout.join("\n")).not.toContain("legacySubWorkflows:");
    expect(textCapture.stdout.join("\n")).toContain("runtimeReady: yes");
  });

  test("workflow run fails early when required agent backend transport is unavailable", async () => {
    const root = await makeTempDir();

    const createCode = await runCli(
      ["workflow", "create", "demo", "--workflow-root", root],
      createIoCapture().io,
    );
    expect(createCode).toBe(0);

    const capture = createIoCapture();
    const originalPath = process.env["PATH"];
    process.env["PATH"] = root;
    let code: number;
    try {
      code = await runCli(
        ["workflow", "run", "demo", "--workflow-root", root],
        capture.io,
      );
    } finally {
      process.env["PATH"] = originalPath;
    }

    expect(code).toBe(1);
    expect(capture.stderr.join("\n")).toContain(
      "workflow runtime readiness failed",
    );
  });

  test("cli workflow run aliases the workflow namespace", async () => {
    const root = await makeTempDir();

    const createCode = await runCli(
      ["workflow", "create", "demo", "--workflow-root", root],
      createIoCapture().io,
    );
    expect(createCode).toBe(0);

    const capture = createIoCapture();
    const originalPath = process.env["PATH"];
    process.env["PATH"] = root;
    let code: number;
    try {
      code = await runCli(
        ["cli", "workflow", "run", "demo", "--workflow-root", root],
        capture.io,
      );
    } finally {
      process.env["PATH"] = originalPath;
    }

    expect(code).toBe(1);
    expect(capture.stderr.join("\n")).toContain(
      "workflow runtime readiness failed",
    );
  });

  test("run -> status -> resume flow", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const variablesPath = await writeRuntimeVariablesFile(
      root,
      "runtime-variables.json",
      {
        humanInput: { request: "start demo workflow" },
      },
    );
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );

    const createCapture = createIoCapture();
    const createCode = await runCli(
      ["workflow", "create", "demo", "--workflow-root", root],
      createCapture.io,
    );
    expect(createCode).toBe(0);

    const runCapture = createIoCapture();
    const runCode = await runCli(
      [
        "workflow",
        "run",
        "demo",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
        "--variables",
        variablesPath,
        "--max-steps",
        "1",
        "--output",
        "json",
      ],
      runCapture.io,
    );
    expect(runCode).toBe(4);

    const runPayload = JSON.parse(runCapture.stdout.join("\n")) as {
      sessionId: string;
      status: string;
    };
    expect(runPayload.status).toBe("paused");

    const statusCapture = createIoCapture();
    const statusCode = await runCli(
      [
        "session",
        "status",
        runPayload.sessionId,
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--output",
        "json",
      ],
      statusCapture.io,
    );
    expect(statusCode).toBe(0);
    const statusPayload = JSON.parse(statusCapture.stdout.join("\n")) as {
      status: string;
    };
    expect(statusPayload.status).toBe("paused");

    const resumeCapture = createIoCapture();
    const resumeCode = await runCli(
      [
        "session",
        "resume",
        runPayload.sessionId,
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
      ],
      resumeCapture.io,
    );
    expect(resumeCode).toBe(0);
    expect(resumeCapture.stdout.join("\n")).toContain("completed");
  });

  test("run with mock scenario and inspect progress + rerun", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const variablesPath = await writeRuntimeVariablesFile(
      root,
      "runtime-variables.json",
      {
        humanInput: { request: "start demo workflow" },
      },
    );
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );

    const createCapture = createIoCapture();
    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createCapture.io,
      ),
    ).toBe(0);

    const runCapture = createIoCapture();
    const runCode = await runCli(
      [
        "workflow",
        "run",
        "demo",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
        "--variables",
        variablesPath,
        "--max-steps",
        "1",
        "--output",
        "json",
      ],
      runCapture.io,
    );
    expect(runCode).toBe(4);
    const runPayload = JSON.parse(runCapture.stdout.join("\n")) as {
      sessionId: string;
      status: string;
    };
    expect(runPayload.status).toBe("paused");

    const progressCapture = createIoCapture();
    const progressCode = await runCli(
      [
        "session",
        "progress",
        runPayload.sessionId,
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
        "--output",
        "json",
      ],
      progressCapture.io,
    );
    expect(progressCode).toBe(0);
    const progressPayload = JSON.parse(progressCapture.stdout.join("\n")) as {
      status: string;
      nodeSummaries: Array<{ nodeId: string; executions: number }>;
    };
    expect(progressPayload.status).toBe("paused");
    expect(
      progressPayload.nodeSummaries.some(
        (entry) => entry.nodeId === "divedra-manager",
      ),
    ).toBe(true);

    const rerunCapture = createIoCapture();
    const rerunCode = await runCli(
      [
        "session",
        "rerun",
        runPayload.sessionId,
        "main-worker",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
        "--output",
        "json",
      ],
      rerunCapture.io,
    );
    expect(rerunCode).toBe(0);
    const rerunPayload = JSON.parse(rerunCapture.stdout.join("\n")) as {
      sourceSessionId: string;
      sessionId: string;
      rerunFromNodeId: string;
    };
    expect(rerunPayload.sourceSessionId).toBe(runPayload.sessionId);
    expect(rerunPayload.sessionId).not.toBe(runPayload.sessionId);
    expect(rerunPayload.rerunFromNodeId).toBe("main-worker");
  });

  test("session export prints workflow execution logs as JSON", async () => {
    const root = await makeTempDir();
    const run = await createCompletedCliWorkflowRun(root);

    const exportCapture = createIoCapture();
    const exportCode = await runCli(
      [
        "session",
        "export",
        run.sessionId,
        "--workflow-root",
        root,
        "--artifact-root",
        run.artifactsRoot,
        "--session-store",
        run.sessionsRoot,
      ],
      exportCapture.io,
    );

    expect(exportCode).toBe(0);
    const exportPayload = JSON.parse(exportCapture.stdout.join("\n")) as {
      workflowId: string;
      workflowExecutionId: string;
      session: { sessionId: string };
      nodeExecutions: unknown[];
      nodeLogs: unknown[];
      communications: Array<{
        artifactSnapshot: {
          inboxMessageJson: string | null;
          outboxOutputRaw: string | null;
        };
      }>;
    };
    expect(exportPayload.workflowId).toBe(run.workflowName);
    expect(exportPayload.workflowExecutionId).toBe(run.sessionId);
    expect(exportPayload.session.sessionId).toBe(run.sessionId);
    expect(exportPayload.nodeExecutions.length).toBeGreaterThan(0);
    expect(exportPayload.nodeLogs.length).toBeGreaterThan(0);
    expect(exportPayload.communications.length).toBeGreaterThan(0);
    expect(
      exportPayload.communications.some(
        (entry) =>
          entry.artifactSnapshot.inboxMessageJson !== null &&
          entry.artifactSnapshot.outboxOutputRaw !== null,
      ),
    ).toBe(true);
  });

  test("session export writes workflow execution logs to a file", async () => {
    const root = await makeTempDir();
    const run = await createCompletedCliWorkflowRun(root);
    const exportFilePath = path.join(root, "workflow-export.json");

    const exportCapture = createIoCapture();
    const exportCode = await runCli(
      [
        "session",
        "export",
        run.sessionId,
        "--workflow-root",
        root,
        "--artifact-root",
        run.artifactsRoot,
        "--session-store",
        run.sessionsRoot,
        "--file",
        exportFilePath,
        "--output",
        "json",
      ],
      exportCapture.io,
    );

    expect(exportCode).toBe(0);
    const exportSummary = JSON.parse(exportCapture.stdout.join("\n")) as {
      filePath: string;
      workflowExecutionId: string;
    };
    expect(exportSummary.filePath).toBe(exportFilePath);
    expect(exportSummary.workflowExecutionId).toBe(run.sessionId);

    const savedPayload = JSON.parse(await readFile(exportFilePath, "utf8")) as {
      workflowId: string;
      workflowExecutionId: string;
      nodeExecutions: unknown[];
      nodeLogs: unknown[];
      communications: unknown[];
    };
    expect(savedPayload.workflowId).toBe(run.workflowName);
    expect(savedPayload.workflowExecutionId).toBe(run.sessionId);
    expect(savedPayload.nodeExecutions.length).toBeGreaterThan(0);
    expect(savedPayload.nodeLogs.length).toBeGreaterThan(0);
    expect(savedPayload.communications.length).toBeGreaterThan(0);
  });

  test("top-level export is not a supported command", async () => {
    const root = await makeTempDir();
    const run = await createCompletedCliWorkflowRun(root);

    const exportCapture = createIoCapture();
    const exportCode = await runCli(
      [
        "export",
        run.workflowName,
        run.sessionId,
        "--workflow-root",
        root,
        "--artifact-root",
        run.artifactsRoot,
        "--session-store",
        run.sessionsRoot,
      ],
      exportCapture.io,
    );

    expect(exportCode).toBe(1);
    expect(exportCapture.stderr.join("\n")).toContain("unknown scope: export");
  });

  test("session logs prints runtime node and communication logs as jsonl", async () => {
    const root = await makeTempDir();
    const run = await createCompletedCliWorkflowRun(root);

    const logsCapture = createIoCapture();
    const logsCode = await runCli(
      [
        "session",
        "logs",
        run.sessionId,
        "--workflow-root",
        root,
        "--artifact-root",
        run.artifactsRoot,
        "--session-store",
        run.sessionsRoot,
        "--format",
        "jsonl",
      ],
      logsCapture.io,
    );

    expect(logsCode).toBe(0);
    const lines = logsCapture.stdout.filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const logs = lines.map((line) => JSON.parse(line)) as Array<{
      sessionId: string;
      nodeId: string | null;
      nodeExecId: string | null;
      message: string;
      payloadJson: string | null;
    }>;
    expect(logs.every((entry) => entry.sessionId === run.sessionId)).toBe(true);
    expect(
      logs.some(
        (entry) =>
          entry.nodeId !== null &&
          entry.message.includes("finished with status"),
      ),
    ).toBe(true);

    const communicationLog = logs.find((entry) => {
      if (entry.payloadJson === null) {
        return false;
      }
      const payload = JSON.parse(entry.payloadJson) as {
        eventType?: string;
        deliveryKind?: string;
        transitionWhen?: string;
      };
      return (
        payload.eventType === "communication" &&
        payload.deliveryKind === "edge-transition" &&
        payload.transitionWhen === "always"
      );
    });
    expect(communicationLog).toBeTruthy();
    expect(communicationLog?.message).toContain(
      "transition divedra-manager -> main-worker when always",
    );
    const communicationPayload = JSON.parse(
      communicationLog?.payloadJson ?? "{}",
    ) as {
      eventType: string;
      fromNodeId: string;
      toNodeId: string;
      transitionWhen: string;
      communicationId: string;
    };
    expect(communicationPayload).toMatchObject({
      eventType: "communication",
      fromNodeId: "divedra-manager",
      toNodeId: "main-worker",
      transitionWhen: "always",
    });
    expect(communicationPayload.communicationId).toMatch(/^comm-/);
  });

  test("workflow run keeps the runtime db aligned with explicit storage roots", async () => {
    const root = await makeTempDir();
    const ambientRoot = path.join(root, "ambient-runtime");
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const variablesPath = await writeRuntimeVariablesFile(
      root,
      "runtime-variables.json",
      {
        humanInput: { request: "start demo workflow" },
      },
    );
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );

    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
        {
          env: {
            DIVEDRA_ARTIFACT_DIR: ambientRoot,
          },
          isInteractiveTerminal: () => false,
          startServe: async () => ({
            host: "127.0.0.1",
            port: 7777,
            stop: () => {},
          }),
        },
      ),
    ).toBe(0);

    const runCapture = createIoCapture();
    const runCode = await runCli(
      [
        "workflow",
        "run",
        "demo",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
        "--variables",
        variablesPath,
        "--max-steps",
        "1",
        "--output",
        "json",
      ],
      runCapture.io,
      {
        env: {
          DIVEDRA_ARTIFACT_DIR: ambientRoot,
        },
        isInteractiveTerminal: () => false,
        startServe: async () => ({
          host: "127.0.0.1",
          port: 7777,
          stop: () => {},
        }),
      },
    );

    expect(runCode).toBe(4);
    expect(await Bun.file(path.join(root, "divedra.db")).exists()).toBe(true);
    expect(await Bun.file(path.join(ambientRoot, "divedra.db")).exists()).toBe(
      false,
    );
  });

  test("gql sends the document, variables, and ambient auth token", async () => {
    const capture = createIoCapture();
    let requestedUrl = "";
    let requestedAuthorization = "";
    let requestedManagerSessionId = "";
    let requestedBody = "";

    const code = await runCli(
      [
        "gql",
        "query ($workflowName: String!) { workflow(workflowName: $workflowName) { workflowId } }",
        "--variables",
        '{"workflowName":"demo"}',
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        fetchImpl: async (input, init) => {
          requestedUrl = String(input);
          requestedAuthorization =
            new Headers(init?.headers).get("authorization") ?? "";
          requestedManagerSessionId =
            new Headers(init?.headers).get("x-divedra-manager-session-id") ??
            "";
          requestedBody = typeof init?.body === "string" ? init.body : "";
          return createJsonResponse({
            data: {
              workflow: {
                workflowId: "demo",
              },
            },
          });
        },
        env: {
          DIVEDRA_MANAGER_AUTH_TOKEN: "secret",
          DIVEDRA_MANAGER_SESSION_ID: "mgrsess-000001",
        },
      },
    );

    expect(code).toBe(0);
    expect(requestedUrl).toBe("http://127.0.0.1:43173/graphql");
    expect(requestedAuthorization).toBe("Bearer secret");
    expect(requestedManagerSessionId).toBe("mgrsess-000001");
    expect(JSON.parse(requestedBody)).toMatchObject({
      query:
        "query ($workflowName: String!) { workflow(workflowName: $workflowName) { workflowId } }",
      variables: {
        workflowName: "demo",
      },
    });
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({
      data: {
        workflow: {
          workflowId: "demo",
        },
      },
    });
  });

  test("workflow run uses GraphQL transport when --endpoint is provided", async () => {
    const root = await makeTempDir();
    const capture = createIoCapture();
    const variablesPath = await writeRuntimeVariablesFile(
      root,
      "runtime-variables.json",
      {
        humanInput: {
          request: "start demo workflow",
        },
      },
    );
    const requests: Array<{
      url: string;
      body: Readonly<Record<string, unknown>>;
    }> = [];

    const code = await runCli(
      [
        "workflow",
        "run",
        "demo",
        "--endpoint",
        "http://example.test/graphql",
        "--variables",
        variablesPath,
        "--max-steps",
        "3",
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        fetchImpl: async (input, init) => {
          const body = JSON.parse(String(init?.body)) as Readonly<
            Record<string, unknown>
          >;
          requests.push({
            url: String(input),
            body,
          });
          const query = typeof body["query"] === "string" ? body["query"] : "";
          if (query.includes("mutation ExecuteWorkflow")) {
            return createJsonResponse({
              data: {
                executeWorkflow: {
                  workflowExecutionId: "sess-remote-001",
                  sessionId: "sess-remote-001",
                  status: "paused",
                  exitCode: 4,
                },
              },
            });
          }
          return createJsonResponse({
            data: {
              workflowExecution: {
                session: {
                  sessionId: "sess-remote-001",
                  workflowName: "demo",
                  workflowId: "demo",
                  transitions: [{ at: "2026-03-15T00:00:00.000Z" }],
                },
                nodeExecutions: [
                  { nodeExecId: "exec-1" },
                  { nodeExecId: "exec-2" },
                ],
              },
            },
          });
        },
      },
    );

    expect(code).toBe(4);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("http://example.test/graphql");
    expect(requests[0]?.body).toMatchObject({
      variables: {
        input: {
          workflowName: "demo",
          runtimeVariables: {
            humanInput: {
              request: "start demo workflow",
            },
          },
          maxSteps: 3,
        },
      },
    });
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({
      sessionId: "sess-remote-001",
      status: "paused",
      workflowName: "demo",
      workflowId: "demo",
      nodeExecutions: 2,
      transitions: 1,
      exitCode: 4,
    });
  });

  test("session resume uses GraphQL transport when --endpoint is provided", async () => {
    const capture = createIoCapture();
    let requestedBody: Readonly<Record<string, unknown>> | undefined;

    const code = await runCli(
      [
        "session",
        "resume",
        "sess-remote-001",
        "--endpoint",
        "http://example.test/graphql",
        "--working-dir",
        " apps/reviewer ",
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        fetchImpl: async (_input, init) => {
          requestedBody = JSON.parse(String(init?.body)) as Readonly<
            Record<string, unknown>
          >;
          return createJsonResponse({
            data: {
              resumeWorkflowExecution: {
                workflowExecutionId: "sess-remote-001",
                sessionId: "sess-remote-001",
                status: "completed",
                exitCode: 0,
              },
            },
          });
        },
      },
    );

    expect(code).toBe(0);
    expect(requestedBody).toMatchObject({
      variables: {
        input: {
          workflowExecutionId: "sess-remote-001",
          workingDirectory: "apps/reviewer",
        },
      },
    });
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({
      sessionId: "sess-remote-001",
      status: "completed",
      exitCode: 0,
    });
  });

  test("session rerun uses GraphQL transport when --endpoint is provided", async () => {
    const capture = createIoCapture();
    let requestedBody: Readonly<Record<string, unknown>> | undefined;

    const code = await runCli(
      [
        "session",
        "rerun",
        "sess-remote-001",
        "workflow-output",
        "--endpoint",
        "http://example.test/graphql",
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        fetchImpl: async (_input, init) => {
          requestedBody = JSON.parse(String(init?.body)) as Readonly<
            Record<string, unknown>
          >;
          return createJsonResponse({
            data: {
              rerunWorkflowExecution: {
                workflowExecutionId: "sess-remote-002",
                sessionId: "sess-remote-002",
                status: "running",
                exitCode: 0,
              },
            },
          });
        },
      },
    );

    expect(code).toBe(0);
    expect(requestedBody).toMatchObject({
      variables: {
        input: {
          workflowExecutionId: "sess-remote-001",
          nodeId: "workflow-output",
        },
      },
    });
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({
      sourceSessionId: "sess-remote-001",
      sessionId: "sess-remote-002",
      status: "running",
      rerunFromNodeId: "workflow-output",
      exitCode: 0,
    });
  });

  test("local session resume forwards normalized workflow run overrides", async () => {
    const root = await makeTempDir();
    const sessionStoreRoot = path.join(root, "sessions");
    const capture = createIoCapture();
    const session = createSessionState({
      sessionId: "sess-local-resume",
      workflowName: "demo",
      workflowId: "demo",
      initialNodeId: "main-worker",
      runtimeVariables: {},
    });
    await saveSession(session, { sessionStoreRoot });

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue(
        ok({
          session: {
            ...session,
            status: "completed",
          },
          exitCode: 0,
        } satisfies workflowEngine.WorkflowRunResult),
      );

    const code = await runCli(
      [
        "session",
        "resume",
        "sess-local-resume",
        "--session-store",
        sessionStoreRoot,
        "--working-dir",
        " apps/reviewer ",
        "--dry-run",
        "--max-steps",
        "5",
        "--max-loop-iterations",
        "3",
        "--default-timeout-ms",
        "900",
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
      },
    );

    expect(code).toBe(0);
    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        sessionStoreRoot,
        resumeSessionId: "sess-local-resume",
        workflowWorkingDirectory: "apps/reviewer",
        dryRun: true,
        maxSteps: 5,
        maxLoopIterations: 3,
        defaultTimeoutMs: 900,
      }),
    );
  });

  test("local session rerun forwards normalized workflow run overrides", async () => {
    const root = await makeTempDir();
    const sessionStoreRoot = path.join(root, "sessions");
    const capture = createIoCapture();
    const session = createSessionState({
      sessionId: "sess-local-rerun",
      workflowName: "demo",
      workflowId: "demo",
      initialNodeId: "main-worker",
      runtimeVariables: {},
    });
    await saveSession(session, { sessionStoreRoot });

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue(
        ok({
          session: {
            ...session,
            sessionId: "sess-local-rerun-2",
            status: "running",
          },
          exitCode: 0,
        } satisfies workflowEngine.WorkflowRunResult),
      );

    const code = await runCli(
      [
        "session",
        "rerun",
        "sess-local-rerun",
        "workflow-output",
        "--session-store",
        sessionStoreRoot,
        "--working-dir",
        " apps/reviewer ",
        "--dry-run",
        "--max-steps",
        "7",
        "--max-loop-iterations",
        "4",
        "--default-timeout-ms",
        "1200",
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
      },
    );

    expect(code).toBe(0);
    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        sessionStoreRoot,
        rerunFromSessionId: "sess-local-rerun",
        rerunFromNodeId: "workflow-output",
        workflowWorkingDirectory: "apps/reviewer",
        dryRun: true,
        maxSteps: 7,
        maxLoopIterations: 4,
        defaultTimeoutMs: 1200,
      }),
    );
  });

  test("local call-node forwards normalized working directory overrides", async () => {
    const capture = createIoCapture();
    const session = createSessionState({
      sessionId: "sess-call-node-local",
      workflowName: "demo",
      workflowId: "demo",
      initialNodeId: "writer",
      runtimeVariables: {},
    });

    const callNodeSpy = vi
      .spyOn(workflowCallNode, "callNode")
      .mockResolvedValue(
        ok({
          session,
          nodeExecution: {
            nodeId: "writer",
            nodeExecId: "exec-1",
            status: "succeeded",
          },
          output: { ok: true },
          outputRef: {
            type: "json",
            path: "artifacts/output.json",
          },
          exitCode: 0,
        } as unknown as workflowCallNode.CallNodeSuccess),
      );

    const code = await runCli(
      [
        "call-node",
        "demo",
        "sess-call-node-local",
        "writer",
        "--working-dir",
        " apps/reviewer ",
        "--default-timeout-ms",
        "750",
        "--dry-run",
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
      },
    );

    expect(code).toBe(0);
    expect(callNodeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "demo",
        workflowRunId: "sess-call-node-local",
        nodeId: "writer",
        workflowWorkingDirectory: "apps/reviewer",
        defaultTimeoutMs: 750,
        dryRun: true,
      }),
    );
  });

  test("workflow run rejects --mock-scenario when using remote GraphQL transport", async () => {
    const root = await makeTempDir();
    const capture = createIoCapture();
    const scenarioPath = path.join(root, "scenario.json");
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );
    let fetchCalled = false;

    const code = await runCli(
      [
        "workflow",
        "run",
        "demo",
        "--endpoint",
        "http://example.test/graphql",
        "--mock-scenario",
        scenarioPath,
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        fetchImpl: async () => {
          fetchCalled = true;
          return createJsonResponse({ data: {} });
        },
      },
    );

    expect(code).toBe(2);
    expect(fetchCalled).toBe(false);
    expect(capture.stderr.join("\n")).toContain(
      "--mock-scenario is only supported for local execution",
    );
  });

  test("serve command uses injected starter", async () => {
    const capture = createIoCapture();
    const started: Array<{
      host?: string;
      port?: number;
      addonRoot?: string;
      fixedWorkflowName?: string;
      readOnly?: boolean;
      noExec?: boolean;
    }> = [];

    const code = await runCli(
      [
        "serve",
        "demo",
        "--host",
        "127.0.0.1",
        "--port",
        "7777",
        "--read-only",
        "--no-exec",
        "--addon-root",
        "/tmp/direct-addons",
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async (options) => {
          started.push(options);
          return {
            host: options.host ?? "127.0.0.1",
            port: options.port ?? 7777,
            stop: () => {},
          };
        },
        isInteractiveTerminal: () => true,
        waitForServeShutdown: async () => {},
      },
    );

    expect(code).toBe(0);
    expect(started).toHaveLength(1);
    expect(started[0]?.addonRoot).toBe("/tmp/direct-addons");
    expect(started[0]?.fixedWorkflowName).toBe("demo");
    expect(started[0]?.readOnly).toBe(true);
    expect(started[0]?.noExec).toBe(true);
    const payload = JSON.parse(capture.stdout.join("\n")) as { port: number };
    expect(payload.port).toBe(7777);
  });

  test("web serve command uses the serve backend", async () => {
    const capture = createIoCapture();
    const started: Array<{
      host?: string;
      port?: number;
      fixedWorkflowName?: string;
    }> = [];

    const code = await runCli(
      [
        "web",
        "serve",
        "demo",
        "--host",
        "127.0.0.1",
        "--port",
        "7777",
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async (options) => {
          started.push(options);
          return {
            host: options.host ?? "127.0.0.1",
            port: options.port ?? 7777,
            stop: () => {},
          };
        },
        isInteractiveTerminal: () => true,
        waitForServeShutdown: async () => {},
      },
    );

    expect(code).toBe(0);
    expect(started).toHaveLength(1);
    expect(started[0]?.fixedWorkflowName).toBe("demo");
    expect(JSON.parse(capture.stdout.join("\n"))).toMatchObject({
      fixedWorkflowName: "demo",
      port: 7777,
    });
  });

  test("serve reports the actual bound port returned by the server", async () => {
    const capture = createIoCapture();

    const code = await runCli(
      [
        "serve",
        "demo",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async (options) => ({
          host: options.host ?? "127.0.0.1",
          port: 48321,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        waitForServeShutdown: async () => {},
      },
    );

    expect(code).toBe(0);
    expect(JSON.parse(capture.stdout.join("\n"))).toMatchObject({
      host: "127.0.0.1",
      port: 48321,
    });
  });

  test("validate returns code 2 for invalid workflow name", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      ["workflow", "validate", "../bad-name"],
      capture.io,
    );
    expect(code).toBe(2);
  });

  test("tui non-interactive fallback requires workflow name", async () => {
    const root = await makeTempDir();
    const capture = createIoCapture();
    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);

    const code = await runCli(["tui", "--workflow-root", root], capture.io, {
      startServe: async () => ({
        host: "127.0.0.1",
        port: 7777,
        stop: () => {},
      }),
      isInteractiveTerminal: () => false,
    });

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "workflow name is required in non-interactive terminal",
    );
  });

  test("interactive tui opens the unified OpenTUI app directly", async () => {
    const root = await makeTempDir();
    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);

    const appCalls: Array<
      Parameters<NonNullable<CliDependencies["runOpenTuiWorkflowApp"]>>[0]
    > = [];
    const runOpenTuiWorkflowApp = vi.fn<
      NonNullable<CliDependencies["runOpenTuiWorkflowApp"]>
    >(async (options) => {
      appCalls.push(options);
      return 0;
    });
    const code = await runCli(
      ["tui", "--workflow-root", root],
      createIoCapture().io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 7777,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        runOpenTuiWorkflowApp,
      },
    );

    expect(code).toBe(0);
    expect(runOpenTuiWorkflowApp).toHaveBeenCalledTimes(1);
    expect(appCalls[0]).toMatchObject({
      workflowNames: ["demo"],
    });
    expect(appCalls[0]?.initialWorkflowName).toBeUndefined();
  });

  test("tui supports non-interactive fallback and resume-session", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const variablesPath = await writeRuntimeVariablesFile(
      root,
      "runtime-variables.json",
      {
        humanInput: { request: "start demo workflow" },
      },
    );
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );

    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);

    const firstRunCapture = createIoCapture();
    const firstRunCode = await runCli(
      [
        "tui",
        "demo",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
        "--variables",
        variablesPath,
        "--max-steps",
        "1",
      ],
      firstRunCapture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 7777,
          stop: () => {},
        }),
        isInteractiveTerminal: () => false,
      },
    );
    expect(firstRunCode).toBe(4);
    expect(firstRunCapture.stdout.join("\n")).toContain(
      "promptless fallback mode",
    );

    const sessionIdLine = firstRunCapture.stdout.find((line) =>
      line.startsWith("sessionId: "),
    );
    expect(sessionIdLine).toBeDefined();
    const sessionId = sessionIdLine?.replace("sessionId: ", "");
    expect(sessionId).toBeDefined();

    const resumeCapture = createIoCapture();
    const resumeCode = await runCli(
      [
        "tui",
        "--resume-session",
        sessionId ?? "",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
      ],
      resumeCapture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 7777,
          stop: () => {},
        }),
        isInteractiveTerminal: () => false,
      },
    );
    expect(resumeCode).toBe(0);
    expect(resumeCapture.stdout.join("\n")).toContain("Resuming session");
    expect(resumeCapture.stdout.join("\n")).toContain("status: completed");
  });

  test("tui resume-session works even when workflow directory is unavailable", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const variablesPath = await writeRuntimeVariablesFile(
      root,
      "runtime-variables.json",
      {
        humanInput: { request: "start demo workflow" },
      },
    );
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );

    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);

    const firstRunCapture = createIoCapture();
    expect(
      await runCli(
        [
          "tui",
          "demo",
          "--workflow-root",
          root,
          "--artifact-root",
          artifactsRoot,
          "--session-store",
          sessionsRoot,
          "--mock-scenario",
          scenarioPath,
          "--variables",
          variablesPath,
          "--max-steps",
          "1",
        ],
        firstRunCapture.io,
        {
          startServe: async () => ({
            host: "127.0.0.1",
            port: 7777,
            stop: () => {},
          }),
          isInteractiveTerminal: () => false,
        },
      ),
    ).toBe(4);

    const sessionId = firstRunCapture.stdout
      .find((line) => line.startsWith("sessionId: "))
      ?.replace("sessionId: ", "");
    expect(sessionId).toBeDefined();

    await rename(path.join(root, "demo"), path.join(root, "_demo_tmp_hidden"));

    const resumeCapture = createIoCapture();
    const resumeCode = await runCli(
      [
        "tui",
        "--resume-session",
        sessionId ?? "",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
      ],
      resumeCapture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 7777,
          stop: () => {},
        }),
        isInteractiveTerminal: () => false,
      },
    );

    expect(resumeCode).toBe(1);
    expect(resumeCapture.stderr.join("\n")).not.toContain("no workflows found");
    expect(resumeCapture.stderr.join("\n")).toContain("run failed:");
  });

  test("interactive tui resume-session falls back to direct resume when OpenTUI is unavailable", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const variablesPath = await writeRuntimeVariablesFile(
      root,
      "runtime-variables.json",
      {
        humanInput: { request: "start demo workflow" },
      },
    );
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );

    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);

    const firstRunCapture = createIoCapture();
    expect(
      await runCli(
        [
          "tui",
          "demo",
          "--workflow-root",
          root,
          "--artifact-root",
          artifactsRoot,
          "--session-store",
          sessionsRoot,
          "--mock-scenario",
          scenarioPath,
          "--variables",
          variablesPath,
          "--max-steps",
          "1",
        ],
        firstRunCapture.io,
        {
          startServe: async () => ({
            host: "127.0.0.1",
            port: 7777,
            stop: () => {},
          }),
          isInteractiveTerminal: () => false,
        },
      ),
    ).toBe(4);

    const sessionId = firstRunCapture.stdout
      .find((line) => line.startsWith("sessionId: "))
      ?.replace("sessionId: ", "");
    expect(sessionId).toBeDefined();

    const resumeCapture = createIoCapture();
    const resumeCode = await runCli(
      [
        "tui",
        "--resume-session",
        sessionId ?? "",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
      ],
      resumeCapture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 7777,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        runOpenTuiWorkflowApp: async () => {
          throw new Error(
            "Cannot find package '@opentui/core' imported from src/tui",
          );
        },
      },
    );

    expect(resumeCode).toBe(0);
    expect(resumeCapture.stderr.join("\n")).toContain(
      "falling back to readline workflow selection",
    );
    expect(resumeCapture.stderr.join("\n")).toContain(
      "will use direct resume fallback",
    );
    expect(resumeCapture.stdout.join("\n")).toContain("Resuming session");
    expect(resumeCapture.stdout.join("\n")).toContain("status: completed");
  });

  test("interactive tui resume-session fallback still uses workflow-local mock-scenario.json", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const workflowScenarioPath = path.join(root, "demo", "mock-scenario.json");
    const variablesPath = await writeRuntimeVariablesFile(
      root,
      "runtime-variables.json",
      {
        humanInput: { request: "start demo workflow" },
      },
    );
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );

    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);
    await writeJson(workflowScenarioPath, makeDefaultTemplateScenario());

    const firstRunCapture = createIoCapture();
    expect(
      await runCli(
        [
          "tui",
          "demo",
          "--workflow-root",
          root,
          "--artifact-root",
          artifactsRoot,
          "--session-store",
          sessionsRoot,
          "--mock-scenario",
          scenarioPath,
          "--variables",
          variablesPath,
          "--max-steps",
          "1",
        ],
        firstRunCapture.io,
        {
          startServe: async () => ({
            host: "127.0.0.1",
            port: 7777,
            stop: () => {},
          }),
          isInteractiveTerminal: () => false,
        },
      ),
    ).toBe(4);

    const sessionId = firstRunCapture.stdout
      .find((line) => line.startsWith("sessionId: "))
      ?.replace("sessionId: ", "");
    expect(sessionId).toBeDefined();

    const resumeCapture = createIoCapture();
    const resumeCode = await runCli(
      [
        "tui",
        "--resume-session",
        sessionId ?? "",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
      ],
      resumeCapture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 7777,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        runOpenTuiWorkflowApp: async () => {
          throw new Error(
            "Cannot find package '@opentui/core' imported from src/tui",
          );
        },
      },
    );

    expect(resumeCode).toBe(0);
    expect(resumeCapture.stdout.join("\n")).toContain("Resuming session");
    expect(resumeCapture.stdout.join("\n")).toContain("status: completed");
  });

  test("tui supports --workflow option in non-interactive mode", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const variablesPath = await writeRuntimeVariablesFile(
      root,
      "runtime-variables.json",
      {
        humanInput: { request: "start demo workflow" },
      },
    );
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );
    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);

    const capture = createIoCapture();
    const code = await runCli(
      [
        "tui",
        "--workflow",
        "demo",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
        "--variables",
        variablesPath,
        "--max-steps",
        "1",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 7777,
          stop: () => {},
        }),
        isInteractiveTerminal: () => false,
      },
    );

    expect(code).toBe(4);
    expect(capture.stdout.join("\n")).toContain(
      "using promptless fallback mode",
    );
  });

  test("tui rejects conflicting positional and --workflow values", async () => {
    const root = await makeTempDir();
    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);
    expect(
      await runCli(
        ["workflow", "create", "other", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);

    const capture = createIoCapture();
    const code = await runCli(
      ["tui", "demo", "--workflow", "other", "--workflow-root", root],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 7777,
          stop: () => {},
        }),
        isInteractiveTerminal: () => false,
      },
    );

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain("conflicting workflow names");
  });

  test("tui fallback applies --variables runtime values", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const variablesPath = path.join(root, "runtime-variables.json");
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );
    await writeFile(
      variablesPath,
      JSON.stringify(
        { topic: "tui-fallback", humanInput: { request: "alpha" } },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);

    const runCapture = createIoCapture();
    const runCode = await runCli(
      [
        "tui",
        "demo",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
        "--variables",
        variablesPath,
        "--max-steps",
        "1",
      ],
      runCapture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 7777,
          stop: () => {},
        }),
        isInteractiveTerminal: () => false,
      },
    );

    expect(runCode).toBe(4);
    const sessionId = runCapture.stdout
      .find((line) => line.startsWith("sessionId: "))
      ?.replace("sessionId: ", "");
    expect(sessionId).toBeDefined();

    const statusCapture = createIoCapture();
    const statusCode = await runCli(
      [
        "session",
        "status",
        sessionId ?? "",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--output",
        "json",
      ],
      statusCapture.io,
    );
    expect(statusCode).toBe(0);

    const statusPayload = JSON.parse(statusCapture.stdout.join("\n")) as {
      runtimeVariables: { topic?: string; humanInput?: { request?: string } };
    };
    expect(statusPayload.runtimeVariables.topic).toBe("tui-fallback");
    expect(statusPayload.runtimeVariables.humanInput?.request).toBe("alpha");
  });

  test("tui resume-session merges --variables into resumed runtime values", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const initialVariablesPath = await writeRuntimeVariablesFile(
      root,
      "runtime-variables.json",
      {
        humanInput: { request: "start demo workflow" },
      },
    );
    const resumeVariablesPath = path.join(root, "resume-variables.json");
    await writeFile(
      scenarioPath,
      JSON.stringify(makeDefaultTemplateScenario(), null, 2),
      "utf8",
    );
    await writeFile(
      resumeVariablesPath,
      JSON.stringify({ resumeNote: "from-file" }, null, 2),
      "utf8",
    );

    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-root", root],
        createIoCapture().io,
      ),
    ).toBe(0);

    const firstRunCapture = createIoCapture();
    expect(
      await runCli(
        [
          "tui",
          "demo",
          "--workflow-root",
          root,
          "--artifact-root",
          artifactsRoot,
          "--session-store",
          sessionsRoot,
          "--mock-scenario",
          scenarioPath,
          "--variables",
          initialVariablesPath,
          "--max-steps",
          "1",
        ],
        firstRunCapture.io,
        {
          startServe: async () => ({
            host: "127.0.0.1",
            port: 7777,
            stop: () => {},
          }),
          isInteractiveTerminal: () => false,
        },
      ),
    ).toBe(4);

    const sessionId = firstRunCapture.stdout
      .find((line) => line.startsWith("sessionId: "))
      ?.replace("sessionId: ", "");
    expect(sessionId).toBeDefined();

    const resumeCapture = createIoCapture();
    const resumeCode = await runCli(
      [
        "tui",
        "--resume-session",
        sessionId ?? "",
        "--workflow-root",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
        "--variables",
        resumeVariablesPath,
      ],
      resumeCapture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 7777,
          stop: () => {},
        }),
        isInteractiveTerminal: () => false,
      },
    );
    expect(resumeCode).toBe(0);

    const statusCapture = createIoCapture();
    expect(
      await runCli(
        [
          "session",
          "status",
          sessionId ?? "",
          "--workflow-root",
          root,
          "--artifact-root",
          artifactsRoot,
          "--session-store",
          sessionsRoot,
          "--output",
          "json",
        ],
        statusCapture.io,
      ),
    ).toBe(0);
    const statusPayload = JSON.parse(statusCapture.stdout.join("\n")) as {
      runtimeVariables: {
        humanInput?: { request?: string };
        resumeNote?: string;
        resumedFromSessionId?: string;
      };
    };
    expect(statusPayload.runtimeVariables.humanInput?.request).toBe(
      "start demo workflow",
    );
    expect(statusPayload.runtimeVariables.resumeNote).toBe("from-file");
    expect(statusPayload.runtimeVariables.resumedFromSessionId).toBe(sessionId);
  });

  test("events validate reports valid event configuration", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await mkdir(path.join(workflowRoot, "demo"), { recursive: true });
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await mkdir(path.join(eventRoot, "sources"), { recursive: true });
    await writeJson(path.join(eventRoot, "sources", "webhook.json"), {
      id: "webhook",
      kind: "webhook",
      path: "/events/webhook",
    });
    await mkdir(path.join(eventRoot, "bindings"), { recursive: true });
    await writeJson(path.join(eventRoot, "bindings", "demo.json"), {
      id: "demo",
      sourceId: "webhook",
      workflowName: "demo",
      inputMapping: { mode: "event-input" },
    });
    const capture = createIoCapture();

    const code = await runCli(
      [
        "events",
        "validate",
        "--workflow-root",
        workflowRoot,
        "--event-root",
        eventRoot,
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
      },
    );

    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(JSON.parse(capture.stdout.join("\n"))).toMatchObject({
      valid: true,
      eventRoot,
      sources: 1,
      bindings: 1,
    });
  });

  test("events emit dispatches locally with mock scenario without endpoint", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    const artifactRoot = path.join(root, "data", "workflow");
    const eventFile = path.join(root, "event.json");
    const mockScenarioPath = path.join(root, "mock-scenario.json");
    await createManagerlessWorkflowFixture(workflowRoot, "demo");
    await mkdir(path.join(eventRoot, "sources"), { recursive: true });
    await writeJson(path.join(eventRoot, "sources", "webhook.json"), {
      id: "webhook",
      kind: "webhook",
      path: "/events/webhook",
    });
    await mkdir(path.join(eventRoot, "bindings"), { recursive: true });
    await writeJson(path.join(eventRoot, "bindings", "demo.json"), {
      id: "demo",
      sourceId: "webhook",
      workflowName: "demo",
      match: { eventType: "chat.message" },
      inputMapping: {
        mode: "template",
        template: { request: "{{event.input.text}}" },
        mirrorToHumanInput: true,
      },
      execution: {
        async: false,
        allowUnsafeSyncWebhook: true,
      },
    });
    await writeJson(eventFile, {
      eventId: "evt-local-mock",
      eventType: "chat.message",
      input: { text: "hello local mock" },
    });
    await writeJson(mockScenarioPath, {
      "worker-1": {
        provider: "scenario-mock",
        payload: { step: "first" },
      },
      "worker-2": {
        provider: "scenario-mock",
        payload: { step: "second" },
      },
    });
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({ errors: [{ message: "unexpected fetch" }] }),
    ) as typeof fetch;
    const capture = createIoCapture();

    const code = await runCli(
      [
        "events",
        "emit",
        "webhook",
        "--workflow-root",
        workflowRoot,
        "--artifact-root",
        artifactRoot,
        "--event-root",
        eventRoot,
        "--event-file",
        eventFile,
        "--mock-scenario",
        mockScenarioPath,
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        fetchImpl,
      },
    );
    const payload = JSON.parse(capture.stdout.join("\n")) as {
      receipts: readonly {
        status: string;
        workflowExecutionId: string | null;
      }[];
    };

    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(payload.receipts[0]?.status).toBe("dispatched");
    expect(payload.receipts[0]?.workflowExecutionId).toMatch(/^div-demo-/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("events emit honors DIVEDRA_EVENTS_READ_ONLY", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    const artifactRoot = path.join(root, "data", "workflow");
    const eventFile = path.join(root, "event.json");
    await mkdir(path.join(workflowRoot, "demo"), { recursive: true });
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await mkdir(path.join(eventRoot, "sources"), { recursive: true });
    await writeJson(path.join(eventRoot, "sources", "webhook.json"), {
      id: "webhook",
      kind: "webhook",
      path: "/events/webhook",
    });
    await mkdir(path.join(eventRoot, "bindings"), { recursive: true });
    await writeJson(path.join(eventRoot, "bindings", "demo.json"), {
      id: "demo",
      sourceId: "webhook",
      workflowName: "demo",
      match: { eventType: "chat.message" },
      inputMapping: {
        mode: "template",
        template: { request: "{{event.input.text}}" },
      },
    });
    await writeJson(eventFile, {
      eventId: "evt-cli-read-only",
      eventType: "chat.message",
      input: { text: "hello read-only cli" },
    });
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({ errors: [{ message: "unexpected dispatch" }] }),
    ) as typeof fetch;
    const capture = createIoCapture();

    const code = await runCli(
      [
        "events",
        "emit",
        "webhook",
        "--workflow-root",
        workflowRoot,
        "--artifact-root",
        artifactRoot,
        "--event-root",
        eventRoot,
        "--event-file",
        eventFile,
        "--endpoint",
        "http://example.test/graphql",
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        env: { DIVEDRA_EVENTS_READ_ONLY: "true" },
        fetchImpl,
      },
    );
    const payload = JSON.parse(capture.stdout.join("\n")) as {
      receipts: readonly {
        status: string;
        workflowExecutionId: string | null;
      }[];
    };

    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(payload.receipts[0]?.status).toBe("skipped");
    expect(payload.receipts[0]?.workflowExecutionId).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("events reject mock scenario with remote endpoint", async () => {
    const root = await makeTempDir();
    const mockScenarioPath = path.join(root, "mock-scenario.json");
    await writeJson(mockScenarioPath, {});
    const capture = createIoCapture();

    const code = await runCli(
      [
        "events",
        "emit",
        "webhook",
        "--event-file",
        path.join(root, "event.json"),
        "--mock-scenario",
        mockScenarioPath,
        "--endpoint",
        "http://example.test/graphql",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
      },
    );

    expect(code).toBe(2);
    expect(capture.stderr).toEqual([
      "--mock-scenario cannot be combined with --endpoint",
    ]);
    expect(capture.stdout).toEqual([]);
  });

  test("events list and replay operate on persisted receipts with mocked dispatch", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    const artifactRoot = path.join(root, "data", "workflow");
    const eventFile = path.join(root, "event.json");
    await mkdir(path.join(workflowRoot, "demo"), { recursive: true });
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await mkdir(path.join(eventRoot, "sources"), { recursive: true });
    await writeJson(path.join(eventRoot, "sources", "webhook.json"), {
      id: "webhook",
      kind: "webhook",
      path: "/events/webhook",
    });
    await mkdir(path.join(eventRoot, "bindings"), { recursive: true });
    await writeJson(path.join(eventRoot, "bindings", "demo.json"), {
      id: "demo",
      sourceId: "webhook",
      workflowName: "demo",
      match: { eventType: "chat.message" },
      inputMapping: {
        mode: "template",
        template: { request: "{{event.input.text}}" },
        mirrorToHumanInput: true,
      },
    });
    await writeJson(eventFile, {
      eventId: "evt-cli",
      eventType: "chat.message",
      input: { text: "hello cli replay" },
    });
    const executionIds = ["sess-cli-first", "sess-cli-replay"];
    const requestedDryRuns: unknown[] = [];
    const fetchImpl = vi.fn(async (_request, init) => {
      const body = JSON.parse(String(init?.body)) as {
        variables: {
          input: {
            workflowName: string;
            runtimeVariables: Readonly<Record<string, unknown>>;
            dryRun?: boolean;
          };
        };
      };
      expect(body.variables.input.workflowName).toBe("demo");
      expect(body.variables.input.runtimeVariables["workflowInput"]).toEqual({
        request: "hello cli replay",
      });
      requestedDryRuns.push(body.variables.input.dryRun);
      return createJsonResponse({
        data: {
          executeWorkflow: {
            workflowExecutionId: executionIds.shift() ?? "sess-cli-extra",
            sessionId: "sess-cli",
            status: "running",
            accepted: true,
            exitCode: null,
          },
        },
      });
    }) as typeof fetch;
    const deps: CliDependencies = {
      startServe: async () => ({
        host: "127.0.0.1",
        port: 43173,
        stop: () => {},
      }),
      isInteractiveTerminal: () => true,
      fetchImpl,
    };
    const emitCapture = createIoCapture();

    const emitCode = await runCli(
      [
        "events",
        "emit",
        "webhook",
        "--workflow-root",
        workflowRoot,
        "--artifact-root",
        artifactRoot,
        "--event-root",
        eventRoot,
        "--event-file",
        eventFile,
        "--endpoint",
        "http://example.test/graphql",
        "--output",
        "json",
      ],
      emitCapture.io,
      deps,
    );
    const emitPayload = JSON.parse(emitCapture.stdout.join("\n")) as {
      receipts: readonly { receiptId: string; status: string }[];
    };
    const listCapture = createIoCapture();

    const listCode = await runCli(
      [
        "events",
        "list",
        "--artifact-root",
        artifactRoot,
        "--source",
        "webhook",
        "--output",
        "json",
      ],
      listCapture.io,
      deps,
    );
    const listPayload = JSON.parse(listCapture.stdout.join("\n")) as {
      receipts: readonly { receiptId: string; status: string }[];
    };
    const replayCapture = createIoCapture();

    const replayCode = await runCli(
      [
        "events",
        "replay",
        emitPayload.receipts[0]?.receiptId ?? "",
        "--workflow-root",
        workflowRoot,
        "--artifact-root",
        artifactRoot,
        "--event-root",
        eventRoot,
        "--endpoint",
        "http://example.test/graphql",
        "--dry-run",
        "--reason",
        "operator verification",
        "--output",
        "json",
      ],
      replayCapture.io,
      deps,
    );
    const replayPayload = JSON.parse(replayCapture.stdout.join("\n")) as {
      replayedFromReceiptId: string;
      replayEventId: string;
      replayReason: string | null;
      receipts: readonly { status: string; workflowExecutionId: string }[];
    };

    expect(emitCode).toBe(0);
    expect(listCode).toBe(0);
    expect(replayCode).toBe(0);
    expect(emitCapture.stderr).toEqual([]);
    expect(listCapture.stderr).toEqual([]);
    expect(replayCapture.stderr).toEqual([]);
    expect(emitPayload.receipts[0]?.status).toBe("dispatched");
    expect(listPayload.receipts[0]?.receiptId).toBe(
      emitPayload.receipts[0]?.receiptId,
    );
    expect(replayPayload.replayedFromReceiptId).toBe(
      emitPayload.receipts[0]?.receiptId,
    );
    expect(replayPayload.replayEventId).toContain(":replay-");
    expect(replayPayload.replayReason).toBe("operator verification");
    expect(replayPayload.receipts[0]?.status).toBe("dispatched");
    expect(replayPayload.receipts[0]?.workflowExecutionId).toBe(
      "sess-cli-replay",
    );
    expect(requestedDryRuns).toEqual([undefined, true]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("events replies lists persisted chat reply dispatches", async () => {
    const root = await makeTempDir();
    const artifactRoot = path.join(root, "data", "workflow");
    const rootDataDir = path.dirname(artifactRoot);
    await saveEventReplyDispatchToRuntimeDb(
      {
        idempotencyKey: "reply-cli-key",
        sourceId: "webhook",
        provider: "webhook",
        workflowId: "demo",
        workflowExecutionId: "sess-reply-cli",
        nodeId: "reply-node",
        nodeExecId: "exec-000001",
        eventId: "evt-reply-cli",
        conversationId: "conv-cli",
        status: "sent",
        providerMessageId: "message-cli",
        requestJson: JSON.stringify({ message: { text: "hello" } }),
        responseJson: JSON.stringify({
          status: "sent",
          providerMessageId: "message-cli",
        }),
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
      { rootDataDir },
    );
    const capture = createIoCapture();

    const code = await runCli(
      [
        "events",
        "replies",
        "sess-reply-cli",
        "--artifact-root",
        artifactRoot,
        "--status",
        "sent",
        "--output",
        "json",
      ],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
      },
    );
    const payload = JSON.parse(capture.stdout.join("\n")) as {
      replies: readonly {
        readonly idempotencyKey: string;
        readonly workflowExecutionId: string;
        readonly providerMessageId: string | null;
      }[];
    };

    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(payload.replies).toHaveLength(1);
    expect(payload.replies[0]).toMatchObject({
      idempotencyKey: "reply-cli-key",
      workflowExecutionId: "sess-reply-cli",
      providerMessageId: "message-cli",
    });
  });

  test("hook command reads stdin and returns noop JSON", async () => {
    const capture = createIoCapture();

    const code = await runCli(["hook", "--vendor", "codex"], capture.io, {
      startServe: async () => ({
        host: "127.0.0.1",
        port: 43173,
        stop: () => {},
      }),
      isInteractiveTerminal: () => true,
      readStdin: async () =>
        JSON.stringify({
          session_id: "sess-hook-001",
          transcript_path: "/tmp/divedra/transcript.jsonl",
          cwd: "/tmp/divedra",
          hook_event_name: "PreToolUse",
          tool_name: "exec_command",
          tool_input: {},
          tool_use_id: "tool-001",
        }),
    });

    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({});
  });

  test("hook snippet command prints Claude Code hook configuration", async () => {
    const capture = createIoCapture();

    const code = await runCli(
      ["hook", "snippet", "--vendor", "claude-code"],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        readStdin: async () => "",
      },
    );

    const output = JSON.parse(capture.stdout.join("\n"));
    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(output.hooks.PreToolUse).toEqual([
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: "divedra hook",
          },
        ],
      },
    ]);
  });

  test("hook snippet command prints Codex hook configuration", async () => {
    const capture = createIoCapture();

    const code = await runCli(
      ["hook", "snippet", "--vendor", "codex"],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        readStdin: async () => "",
      },
    );

    const output = JSON.parse(capture.stdout.join("\n"));
    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(output.hooks.PostToolUse).toEqual([
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: "divedra hook",
          },
        ],
      },
    ]);
  });

  test("hook snippet command prints Gemini hook configuration", async () => {
    const capture = createIoCapture();

    const code = await runCli(
      ["hook", "snippet", "--vendor", "gemini"],
      capture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
        readStdin: async () => "",
      },
    );

    const output = JSON.parse(capture.stdout.join("\n"));
    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(output.hooks.SessionStart).toEqual([
      {
        matcher: "startup",
        hooks: [
          {
            type: "command",
            command: "divedra hook",
          },
        ],
      },
    ]);
    expect(output.hooks.BeforeTool).toEqual([
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: "divedra hook",
          },
        ],
      },
    ]);
  });

  test("hook snippet command requires an explicit vendor", async () => {
    const capture = createIoCapture();

    const code = await runCli(["hook", "snippet"], capture.io, {
      startServe: async () => ({
        host: "127.0.0.1",
        port: 43173,
        stop: () => {},
      }),
      isInteractiveTerminal: () => true,
      readStdin: async () => "",
    });

    expect(code).toBe(2);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toEqual([
      "--vendor is required for hook snippet; expected 'claude-code' or 'codex' or 'gemini'",
    ]);
  });

  test("hook command rejects invalid vendor values", async () => {
    const capture = createIoCapture();

    const code = await runCli(["hook", "--vendor", "bad-vendor"], capture.io, {
      startServe: async () => ({
        host: "127.0.0.1",
        port: 43173,
        stop: () => {},
      }),
      isInteractiveTerminal: () => true,
      readStdin: async () => "{}",
    });

    expect(code).toBe(2);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toEqual([
      "invalid --vendor value 'bad-vendor'; expected 'claude-code' or 'codex' or 'gemini'",
    ]);
  });

  test("hook command rejects positional arguments", async () => {
    const capture = createIoCapture();

    const code = await runCli(["hook", "extra-arg"], capture.io, {
      startServe: async () => ({
        host: "127.0.0.1",
        port: 43173,
        stop: () => {},
      }),
      isInteractiveTerminal: () => true,
      readStdin: async () => "",
    });

    expect(code).toBe(2);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toEqual([
      "unknown hook subcommand",
      "usage: divedra hook snippet --vendor claude-code|codex|gemini",
    ]);
  });
});
