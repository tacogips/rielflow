import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
import { createSessionState } from "./workflow/session";
import { saveSession } from "./workflow/session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-cli-test-"));
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

function makeDefaultTemplateScenario(): Readonly<Record<string, unknown>> {
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
  await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
    nodes: [
      { id: "divedra-manager", order: 0 },
      { id: "writer", order: 1 },
    ],
  });
  await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
    id: "divedra-manager",
    model: "tacogips/claude-code-agent",
    promptTemplate: "manager",
    variables: {},
  });
  await writeJson(path.join(workflowDirectory, "node-writer.json"), {
    id: "writer",
    model: "tacogips/codex-agent",
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
      counts: { nodes: number };
      runtime: { ready: boolean };
    };
    expect(parsed.workflowName).toBe("demo");
    expect(parsed.counts.nodes).toBe(4);
    expect(parsed.runtime.ready).toBe(true);
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
        "workflow-output",
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
    expect(rerunPayload.rerunFromNodeId).toBe("workflow-output");
  });

  test("export prints workflow execution logs as JSON", async () => {
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

  test("export writes workflow execution logs to a file", async () => {
    const root = await makeTempDir();
    const run = await createCompletedCliWorkflowRun(root);
    const exportFilePath = path.join(root, "workflow-export.json");

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

    const savedPayload = JSON.parse(
      await readFile(exportFilePath, "utf8"),
    ) as {
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

  test("export rejects workflow ids that do not match the workflow run", async () => {
    const root = await makeTempDir();
    const run = await createCompletedCliWorkflowRun(root);

    const exportCapture = createIoCapture();
    const exportCode = await runCli(
      [
        "export",
        "other-workflow",
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
    expect(exportCapture.stderr.join("\n")).toContain(
      `workflow execution '${run.sessionId}' does not belong to workflow 'other-workflow'`,
    );
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
    expect(started[0]?.readOnly).toBe(true);
    expect(started[0]?.noExec).toBe(true);
    const payload = JSON.parse(capture.stdout.join("\n")) as { port: number };
    expect(payload.port).toBe(7777);
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
});
