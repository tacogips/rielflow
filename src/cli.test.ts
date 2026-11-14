import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { runCli, type CliDependencies } from "./cli";
import { createWorkflowTemplate } from "./workflow/create";
import * as workflowCallStep from "./workflow/call-step";
import * as workflowEngine from "./workflow/engine";
import { ok } from "./workflow/result";
import type {
  NodeAddonDefinition,
  ResolvedWorkflowSource,
} from "./workflow/types";
import {
  saveEventReplyDispatchToRuntimeDb,
  saveNodeExecutionToRuntimeDb,
} from "./workflow/runtime-db";
import { createSessionState } from "./workflow/session";
import { saveSession } from "./workflow/session-store";
import { computeProjectScopedRootDataDir } from "./workflow/paths";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-cli-test-"));
  tempDirs.push(directory);
  return directory;
}

/** `runCli` loads workflows like the production CLI; legacy disk fixtures opt in via the same env knob as `isStrictWorkflowAuthorshipValidation`. */
async function withLegacyWorkflowAuthorshipForCli<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const prev = process.env["DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT"];
  process.env["DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT"] = "true";
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env["DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT"];
    } else {
      process.env["DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT"] = prev;
    }
  }
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

function createCliDeps(
  overrides: Partial<CliDependencies> = {},
): CliDependencies {
  return {
    startServe: async () => ({
      host: "127.0.0.1",
      port: 43173,
      stop: () => {},
    }),
    isInteractiveTerminal: () => false,
    ...overrides,
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

async function writeExecutable(filePath: string, body: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${body}\n`, { mode: 0o755 });
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

async function createCallStepFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDirectory = path.join(workflowRoot, workflowName);
  await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: workflowName,
    description: "call step cli fixture",
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
    description: "worker-only cli fixture (step-addressed linear)",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryStepId: "step-1",
    nodes: [
      {
        id: "worker-1",
        nodeFile: "node-worker-1.json",
      },
      {
        id: "worker-2",
        nodeFile: "node-worker-2.json",
      },
    ],
    steps: [
      {
        id: "step-1",
        nodeId: "worker-1",
        description:
          "Accept the initial worker-only input and produce the first result.",
        transitions: [{ toStepId: "step-2" }],
      },
      {
        id: "step-2",
        nodeId: "worker-2",
        description: "Finalize the worker-only workflow output.",
      },
    ],
  });
  await writeJson(path.join(workflowDirectory, "node-worker-1.json"), {
    id: "worker-1",
    executionBackend: "codex-agent",
    model: "gpt-5",
    promptTemplate: "step 1",
    variables: {},
    input: {
      description: "Worker-only workflow input payload.",
      jsonSchema: {
        type: "object",
        properties: {
          request: { type: "string" },
        },
      },
    },
    output: {
      description: "Worker-only workflow output payload.",
      jsonSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
        },
      },
    },
  });
  await writeJson(path.join(workflowDirectory, "node-worker-2.json"), {
    id: "worker-2",
    executionBackend: "codex-agent",
    model: "gpt-5",
    promptTemplate: "step 2",
    variables: {},
  });
}

async function createMissingDescriptionWorkflowFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDirectory = path.join(workflowRoot, workflowName);
  await mkdir(workflowDirectory, { recursive: true });

  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: workflowName,
    description: "missing description cli fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryStepId: "step-1",
    nodes: [
      {
        id: "worker-1",
        nodeFile: "node-worker-1.json",
      },
      {
        id: "worker-2",
        nodeFile: "node-worker-2.json",
      },
    ],
    steps: [
      {
        id: "step-1",
        nodeId: "worker-1",
        transitions: [{ toStepId: "step-2" }],
      },
      {
        id: "step-2",
        nodeId: "worker-2",
      },
    ],
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
    description: "workflow-call cli fixture (step-addressed cross-workflow)",
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
      {
        id: "post-review",
        nodeFile: "nodes/node-post-review.json",
      },
    ],
    steps: [
      {
        id: "divedra-manager",
        nodeId: "divedra-manager",
        description: "Coordinate the cross-workflow review flow.",
        role: "manager",
        transitions: [{ toStepId: "main-worker" }],
      },
      {
        id: "main-worker",
        nodeId: "main-worker",
        description:
          "Draft the main workflow output and send it to the review workflow.",
        role: "worker",
        transitions: [
          {
            toWorkflowId: "review",
            toStepId: "reviewer",
            resumeStepId: "post-review",
          },
        ],
      },
      {
        id: "post-review",
        nodeId: "post-review",
        description: "Apply the review result after the callee returns.",
        role: "worker",
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
      input: {
        description: "Manager issue and workflow invocation input.",
        jsonSchema: {
          type: "object",
          properties: {
            issueUrl: { type: "string" },
          },
        },
      },
      output: {
        description: "Manager handoff for the next step.",
      },
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
  await writeJson(
    path.join(workflowDirectory, "nodes", "node-post-review.json"),
    {
      id: "post-review",
      executionBackend: "codex-agent",
      model: "gpt-5",
      promptTemplate: "after review",
      variables: {},
    },
  );

  const reviewDirectory = path.join(workflowRoot, "review");
  await mkdir(path.join(reviewDirectory, "nodes"), { recursive: true });
  await writeJson(path.join(reviewDirectory, "workflow.json"), {
    workflowId: "review",
    description: "workflow-call cli callee fixture",
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
        description: "Review the caller payload and return review guidance.",
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
      ["workflow", "create", workflowName, "--workflow-definition-dir", root],
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
        "--workflow-definition-dir",
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
  test("returns help for unknown scope", async () => {
    const capture = createIoCapture();
    const code = await runCli(["unknown", "cmd", "target"], capture.io);
    expect(code).toBe(1);
    const help = capture.stdout.join("\n");
    expect(help).toContain("Usage:");
    expect(help).toContain(
      "call-step <workflow-id> <workflow-run-id> <step-id>",
    );
    expect(help).toContain("--superviser-workflow");
    expect(help).toContain("--supervisor-workflow");
    expect(help).toContain("--nested-superviser");
    expect(help).toContain("--nested-supervisor");
    expect(help).toContain("--no-auto-improve");
    expect(help).toContain("--no-allow-targeted-rerun");
    expect(help).toContain("--disable-targeted-rerun");
    expect(help).toContain("--workflow-definition-dir");
    expect(help).toContain("Does not control logs, sessions, or artifacts");
    expect(help).toContain("divedra graphql <graphql-document>");
    expect(help).not.toContain("divedra gql");
    expect(help).toContain("session export");
    expect(help).toContain("session logs");
    expect(help).toContain("session health");
    expect(help).toContain("session step-runs");
  });

  test("call-step executes locally with structured manager message input", async () => {
    const root = await makeTempDir();
    const workflowName = "call-step-cli";
    const sessionId = "sess-call-step-cli";
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const scenarioPath = path.join(root, "scenario.json");
    const messagePath = path.join(root, "message.json");

    await createCallStepFixture(root, workflowName);
    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName,
        workflowId: workflowName,
        initialNodeId: "manager-step",
        runtimeVariables: {},
      }),
      { sessionStoreRoot },
    );
    expect(saved.ok).toBe(true);

    await writeFile(
      scenarioPath,
      JSON.stringify(
        {
          "writer-step": [
            {
              provider: "scenario-mock",
              when: { always: true },
              payload: { wrong: true },
            },
            {
              provider: "scenario-mock",
              when: { always: true },
              payload: { summary: "cli step ok" },
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
      JSON.stringify({ instruction: "review this step" }, null, 2),
      "utf8",
    );

    const capture = createIoCapture();
    const code = await runCli(
      [
        "call-step",
        workflowName,
        sessionId,
        "writer-step",
        "--workflow-definition-dir",
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
      stepId: string;
      output: { payload: { summary: string } };
      outputRef: { artifactDir: string };
    };
    expect(payload.stepId).toBe("writer-step");
    expect(payload.output.payload.summary).toBe("cli step ok");

    const inputJson = JSON.parse(
      await readFile(
        path.join(payload.outputRef.artifactDir, "input.json"),
        "utf8",
      ),
    ) as { managerMessage?: { instruction?: string } };
    expect(inputJson.managerMessage?.instruction).toBe("review this step");
  });

  test("create -> validate -> inspect roundtrip", async () => {
    const root = await makeTempDir();

    const createCapture = createIoCapture();
    const createCode = await runCli(
      ["workflow", "create", "demo", "--workflow-definition-dir", root],
      createCapture.io,
    );
    expect(createCode).toBe(0);

    const validateCapture = createIoCapture();
    const validateCode = await runCli(
      ["workflow", "validate", "demo", "--workflow-definition-dir", root],
      validateCapture.io,
    );
    expect(validateCode).toBe(0);
    expect(validateCapture.stdout.join("\n")).toContain("is valid");

    const jsonValidateCapture = createIoCapture();
    const jsonValidateCode = await runCli(
      [
        "workflow",
        "validate",
        "demo",
        "--workflow-definition-dir",
        root,
        "--output",
        "json",
      ],
      jsonValidateCapture.io,
    );
    expect(jsonValidateCode).toBe(0);
    const validationPayload = JSON.parse(
      jsonValidateCapture.stdout.join("\n"),
    ) as {
      nodeValidationResults: readonly { status: string; message: string }[];
    };
    expect(validationPayload.nodeValidationResults.length).toBeGreaterThan(0);

    const inspectCapture = createIoCapture();
    const inspectCode = await runCli(
      [
        "workflow",
        "inspect",
        "demo",
        "--workflow-definition-dir",
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
      entryNodeId?: string;
      entryStepId?: string;
      managerStepId?: string;
      stepIds: readonly string[];
      nodeRegistryIds: readonly string[];
      counts: {
        nodeRegistry: number;
        steps: number;
        crossWorkflowDispatches: number;
      };
      runtime: { ready: boolean; blockers: readonly string[] };
    };
    expect(parsed.workflowName).toBe("demo");
    expect(parsed.entryNodeId).toBeUndefined();
    expect("managerRuntimeId" in parsed).toBe(false);
    expect(parsed.entryStepId).toBe("divedra-manager");
    expect(parsed.managerStepId).toBe("divedra-manager");
    expect(parsed.stepIds).toEqual(["divedra-manager", "main-worker"]);
    expect(parsed.nodeRegistryIds).toEqual(["divedra-manager", "main-worker"]);
    expect(parsed.counts.nodeRegistry).toBe(2);
    expect(parsed.counts.steps).toBe(2);
    expect(parsed.counts.crossWorkflowDispatches).toBe(0);
    expect(parsed.runtime.ready).toBe(false);
    expect(parsed.runtime.blockers).toEqual(
      expect.arrayContaining([expect.stringContaining("code-manager runtime")]),
    );

    const inspectTextCapture = createIoCapture();
    const inspectTextCode = await runCli(
      ["workflow", "inspect", "demo", "--workflow-definition-dir", root],
      inspectTextCapture.io,
    );
    expect(inspectTextCode).toBe(0);
    expect(inspectTextCapture.stdout.join("\n")).toContain(
      "managerStepId: divedra-manager",
    );
    expect(inspectTextCapture.stdout.join("\n")).toContain(
      "entryStepId: divedra-manager",
    );
    expect(inspectTextCapture.stdout.join("\n")).toContain(
      "stepIds: divedra-manager, main-worker",
    );
    expect(inspectTextCapture.stdout.join("\n")).toContain(
      "nodeRegistryIds: divedra-manager, main-worker",
    );
    expect(inspectTextCapture.stdout.join("\n")).toMatch(
      /steps: 2, nodeRegistry: 2, crossWorkflowDispatches: 0/,
    );
  });

  test("workflow validate --executable returns invalid node validation results", async () => {
    const root = await makeTempDir();
    const bin = path.join(root, "bin");
    await writeExecutable(
      path.join(bin, "codex"),
      [
        "#!/usr/bin/env bash",
        'if [ "$1" = "--version" ]; then echo \'codex 1.0.0\'; exit 0; fi',
        'if [ "$1" = "login" ]; then echo \'not logged in\' >&2; exit 1; fi',
        "exit 1",
      ].join("\n"),
    );
    await writeExecutable(
      path.join(bin, "git"),
      "#!/usr/bin/env bash\necho 'git 2.0'",
    );
    await writeExecutable(
      path.join(root, "node_modules", ".bin", "codex-agent"),
      "#!/usr/bin/env bash\necho '{\"available\":true}'",
    );

    const createCapture = createIoCapture();
    expect(
      await runCli(
        ["workflow", "create", "demo", "--workflow-definition-dir", root],
        createCapture.io,
      ),
    ).toBe(0);

    const validateCapture = createIoCapture();
    const validateCode = await runCli(
      [
        "workflow",
        "validate",
        "demo",
        "--workflow-definition-dir",
        root,
        "--executable",
        "--output",
        "json",
      ],
      validateCapture.io,
      createCliDeps({
        env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
      }),
    );
    expect(validateCode).toBe(2);
    const validation = JSON.parse(validateCapture.stdout.join("\n")) as {
      valid: boolean;
      nodeValidationResults: readonly {
        status: string;
        backend?: string;
        message: string;
      }[];
    };
    expect(validation.valid).toBe(false);
    expect(
      validation.nodeValidationResults.some(
        (entry) =>
          entry.status === "invalid" &&
          entry.backend === "codex-agent" &&
          entry.message.includes("authentication"),
      ),
    ).toBe(true);
  });

  test("workflow validate preserves loaded add-on node validation results", async () => {
    const root = await makeTempDir();
    const workflowName = "addon-validator";
    const addonDefinition: NodeAddonDefinition = {
      name: "acme/validator",
      version: "1",
      resolve: async (input) => ({
        payload: {
          id: input.nodeId,
          executionBackend: "official/openai-sdk",
          model: "gpt-5-nano",
          promptTemplate: "validated add-on",
          variables: {},
        },
      }),
      validate: (input) => ({
        status: "warning",
        message: `validated ${input.addon.name}`,
        nodeId: input.nodeId,
        source: "addon",
        path: input.path,
        addonName: input.addon.name,
      }),
    };
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });
    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "third-party add-on validation fixture",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      entryStepId: "addon-worker",
      nodes: [
        {
          id: "addon-worker",
          addon: {
            name: "acme/validator",
            version: "1",
          },
        },
      ],
      steps: [{ id: "addon-worker", nodeId: "addon-worker", role: "worker" }],
    });

    const validateCapture = createIoCapture();
    const validateCode = await runCli(
      [
        "workflow",
        "validate",
        workflowName,
        "--workflow-definition-dir",
        root,
        "--output",
        "json",
      ],
      validateCapture.io,
      createCliDeps({ nodeAddons: [addonDefinition] }),
    );

    expect(validateCode).toBe(0);
    const validation = JSON.parse(validateCapture.stdout.join("\n")) as {
      nodeValidationResults: ReadonlyArray<{
        readonly status: string;
        readonly message: string;
        readonly nodeId?: string;
        readonly source?: string;
        readonly addonName?: string;
      }>;
    };
    expect(validation.nodeValidationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "warning",
          message: "validated acme/validator",
          nodeId: "addon-worker",
          source: "addon",
          addonName: "acme/validator",
        }),
      ]),
    );
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

  test("workflow list and status use overview data for direct workflow root", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }
    const listCapture = createIoCapture();
    const listCode = await runCli(
      ["workflow", "list", "--workflow-definition-dir", root],
      listCapture.io,
    );
    expect(listCode).toBe(0);
    const listText = listCapture.stdout.join("\n");
    expect(listText).toContain("demo");
    expect(listText).toContain("direct");

    const listJsonCapture = createIoCapture();
    const listJsonCode = await runCli(
      [
        "workflow",
        "list",
        "--workflow-definition-dir",
        root,
        "--output",
        "json",
      ],
      listJsonCapture.io,
    );
    expect(listJsonCode).toBe(0);
    const listPayload = JSON.parse(listJsonCapture.stdout.join("\n")) as {
      workflows: ReadonlyArray<{ workflowName: string; sourceScope: string }>;
    };
    expect(listPayload.workflows.length).toBeGreaterThanOrEqual(1);
    expect(listPayload.workflows.some((w) => w.workflowName === "demo")).toBe(
      true,
    );

    const statusCapture = createIoCapture();
    const statusCode = await runCli(
      ["workflow", "status", "demo", "--workflow-definition-dir", root],
      statusCapture.io,
    );
    expect(statusCode).toBe(0);
    expect(statusCapture.stdout.join("\n")).toContain("aggregateStatus:");

    const missingCapture = createIoCapture();
    const missingCode = await runCli(
      ["workflow", "status", "missing-wf", "--workflow-definition-dir", root],
      missingCapture.io,
    );
    expect(missingCode).toBe(2);
  });

  test("workflow list uses DIVEDRA_WORKFLOW_DEFINITION_DIR as direct definition directory", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("env-demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);

    const capture = createIoCapture();
    const code = await runCli(
      ["workflow", "list"],
      capture.io,
      createCliDeps({ env: { DIVEDRA_WORKFLOW_DEFINITION_DIR: root } }),
    );

    expect(code).toBe(0);
    const listText = capture.stdout.join("\n");
    expect(listText).toContain("env-demo");
    expect(listText).toContain("direct");
  });

  test("workflow list labels scoped rows and warns on project user duplicates", async () => {
    const root = await makeTempDir();
    const workspaceRoot = path.join(root, "workspace");
    const projectRoot = path.join(workspaceRoot, ".divedra");
    const userRoot = path.join(root, "home", ".divedra");

    for (const workflowRoot of [
      path.join(projectRoot, "workflows"),
      path.join(userRoot, "workflows"),
    ]) {
      const created = await createWorkflowTemplate("dup", { workflowRoot });
      expect(created.ok).toBe(true);
    }

    const previousCwd = process.cwd();
    process.chdir(workspaceRoot);
    try {
      const listCapture = createIoCapture();
      const listCode = await runCli(
        ["workflow", "list", "--user-root", userRoot],
        listCapture.io,
      );
      expect(listCode).toBe(0);
      const listText = listCapture.stdout.join("\n");
      expect(listText).toContain("project scope");
      expect(listText).toContain("user scope");
      expect(listCapture.stderr.join("\n")).toContain(
        "warning: workflow 'dup' exists in both project scope and user scope",
      );

      const listJsonCapture = createIoCapture();
      const listJsonCode = await runCli(
        ["workflow", "list", "--user-root", userRoot, "--output", "json"],
        listJsonCapture.io,
      );
      expect(listJsonCode).toBe(0);
      const listJsonPayload = JSON.parse(listJsonCapture.stdout.join("\n")) as {
        workflows: ReadonlyArray<{ workflowName: string; sourceScope: string }>;
      };
      expect(
        listJsonPayload.workflows
          .filter((row) => row.workflowName === "dup")
          .map((row) => row.sourceScope)
          .sort(),
      ).toEqual(["project", "user"]);
      expect(listJsonCapture.stderr.join("\n")).toContain(
        "warning: workflow 'dup' exists in both project scope and user scope",
      );

      const limitedCapture = createIoCapture();
      const limitedCode = await runCli(
        ["workflow", "list", "--user-root", userRoot, "--limit", "1"],
        limitedCapture.io,
      );
      expect(limitedCode).toBe(0);
      expect(limitedCapture.stdout.join("\n")).toContain("project scope");
      expect(limitedCapture.stdout.join("\n")).not.toContain("user scope");
      expect(limitedCapture.stderr.join("\n")).toContain(
        "warning: workflow 'dup' exists in both project scope and user scope",
      );
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("workflow list uses DIVEDRA_PROJECT_ROOT outside the project cwd", async () => {
    const root = await makeTempDir();
    const projectScopeRoot = path.join(root, "workspace", ".divedra");
    const userRoot = path.join(root, "home", ".divedra");
    const externalRoot = await makeTempDir();

    for (const workflowRoot of [
      path.join(projectScopeRoot, "workflows"),
      path.join(userRoot, "workflows"),
    ]) {
      const created = await createWorkflowTemplate("dup", { workflowRoot });
      expect(created.ok).toBe(true);
    }

    const previousCwd = process.cwd();
    process.chdir(externalRoot);
    try {
      const capture = createIoCapture();
      const code = await runCli(
        ["workflow", "list", "--user-root", userRoot],
        capture.io,
        createCliDeps({ env: { DIVEDRA_PROJECT_ROOT: projectScopeRoot } }),
      );
      expect(code).toBe(0);
      expect(capture.stdout.join("\n")).toContain("project scope");
      expect(capture.stdout.join("\n")).toContain("user scope");
      expect(capture.stderr.join("\n")).toContain(
        "warning: workflow 'dup' exists in both project scope and user scope",
      );
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("remote workflow list warns from unfiltered catalog sources", async () => {
    const capture = createIoCapture();
    let requestedBody: Readonly<Record<string, unknown>> | undefined;

    const code = await runCli(
      [
        "workflow",
        "list",
        "--endpoint",
        "http://example.test/graphql",
        "--limit",
        "1",
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
              workflowCatalogOverview: {
                workflows: [
                  {
                    workflowName: "dup",
                    sourceScope: "project",
                    workflowDirectory: "/project/.divedra/workflows/dup",
                    description: "project duplicate",
                    aggregateStatus: "never-run",
                    activeExecutionCount: 0,
                    latestExecution: null,
                  },
                ],
              },
              workflowCatalogWarningSources: {
                workflows: [
                  { workflowName: "dup", sourceScope: "project" },
                  { workflowName: "dup", sourceScope: "user" },
                ],
              },
            },
          });
        },
      },
    );

    expect(code).toBe(0);
    expect(requestedBody).toMatchObject({
      variables: { limit: 1 },
    });
    expect(String(requestedBody?.["query"])).toContain(
      "workflowCatalogWarningSources",
    );
    const payload = JSON.parse(capture.stdout.join("\n")) as {
      workflows: readonly { sourceScope: string }[];
    };
    expect(payload.workflows).toEqual([
      expect.objectContaining({ sourceScope: "project" }),
    ]);
    expect(capture.stderr.join("\n")).toContain(
      "warning: workflow 'dup' exists in both project scope and user scope",
    );
  });

  test("workflow validate and inspect report scoped local add-on sources", async () => {
    await withLegacyWorkflowAuthorshipForCli(async () => {
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
        entryStepId: "addon-worker",
        nodes: [
          {
            id: "addon-worker",
            addon: {
              name: addonName,
              version: "1",
              inputs: { message: "from cli" },
            },
          },
        ],
        steps: [{ id: "addon-worker", nodeId: "addon-worker" }],
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
    const projectRoot = path.join(root, "workspace", ".divedra");
    const externalRoot = await makeTempDir();
    const previousCwd = process.cwd();
    process.chdir(externalRoot);
    try {
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
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("create --worker-only scaffolds a manager-less starter", async () => {
    const root = await makeTempDir();

    const createCapture = createIoCapture();
    const createCode = await runCli(
      [
        "workflow",
        "create",
        "solo",
        "--workflow-definition-dir",
        root,
        "--worker-only",
      ],
      createCapture.io,
    );
    expect(createCode).toBe(0);

    const inspectCapture = createIoCapture();
    const inspectCode = await runCli(
      [
        "workflow",
        "inspect",
        "solo",
        "--workflow-definition-dir",
        root,
        "--output",
        "json",
      ],
      inspectCapture.io,
    );
    expect(inspectCode).toBe(0);

    const parsed = JSON.parse(inspectCapture.stdout.join("\n")) as {
      entryStepId?: string;
      hasManagerNode: boolean;
      nodeRegistryIds: readonly string[];
      counts: {
        nodeRegistry: number;
        steps: number;
        crossWorkflowDispatches: number;
      };
    };
    expect(parsed.hasManagerNode).toBe(false);
    expect(parsed.entryStepId).toBe("main-worker");
    expect(parsed.nodeRegistryIds).toEqual(["main-worker"]);
    expect(parsed.counts.nodeRegistry).toBe(1);
    expect(parsed.counts.steps).toBe(1);
    expect(parsed.counts.crossWorkflowDispatches).toBe(0);

    const inspectTextCapture = createIoCapture();
    const inspectTextCode = await runCli(
      ["workflow", "inspect", "solo", "--workflow-definition-dir", root],
      inspectTextCapture.io,
    );
    expect(inspectTextCode).toBe(0);
    const textOut = inspectTextCapture.stdout.join("\n");
    expect(textOut).toContain("entryStepId: main-worker");
    expect(textOut).not.toContain("compatibility:");
    expect(textOut).not.toContain("variablesExamples:");
  });

  test("inspect reports worker-only workflows without an authored manager node", async () => {
    await withLegacyWorkflowAuthorshipForCli(async () => {
      const root = await makeTempDir();
      await createManagerlessWorkflowFixture(root, "worker-only");

      const capture = createIoCapture();
      const code = await runCli(
        [
          "workflow",
          "inspect",
          "worker-only",
          "--workflow-definition-dir",
          root,
          "--output",
          "json",
        ],
        capture.io,
      );
      expect(code).toBe(0);

      const parsed = JSON.parse(capture.stdout.join("\n")) as {
        hasManagerNode: boolean;
        entryStepId?: string;
        callable: {
          stepId: string;
          role: string;
          input?: {
            description?: string;
            jsonSchema?: Readonly<Record<string, unknown>>;
          };
          output?: { description?: string };
        };
        steps: Array<{
          stepId: string;
          role: string;
          description?: string;
        }>;
        nodeRegistryIds: readonly string[];
        counts: {
          nodeRegistry: number;
          steps: number;
          crossWorkflowDispatches: number;
        };
      };
      expect(parsed.hasManagerNode).toBe(false);
      expect(parsed.entryStepId).toBe("step-1");
      expect(parsed.callable.stepId).toBe("step-1");
      expect(parsed.callable.role).toBe("worker");
      expect(parsed.callable.input?.description).toBe(
        "Worker-only workflow input payload.",
      );
      expect(parsed.callable.input?.jsonSchema).toMatchObject({
        type: "object",
        properties: {
          request: { type: "string" },
        },
      });
      expect(parsed.callable.output?.description).toBe(
        "Worker-only workflow output payload.",
      );
      expect(parsed.steps).toEqual([
        {
          stepId: "step-1",
          role: "worker",
          description:
            "Accept the initial worker-only input and produce the first result.",
        },
        {
          stepId: "step-2",
          role: "worker",
          description: "Finalize the worker-only workflow output.",
        },
      ]);
      expect(parsed.nodeRegistryIds).toEqual(["worker-1", "worker-2"]);
      expect(parsed.counts.nodeRegistry).toBe(2);
      expect(parsed.counts.steps).toBe(2);
      expect(parsed.counts.crossWorkflowDispatches).toBe(0);

      const textCapture = createIoCapture();
      const textCode = await runCli(
        [
          "workflow",
          "inspect",
          "worker-only",
          "--workflow-definition-dir",
          root,
        ],
        textCapture.io,
      );
      expect(textCode).toBe(0);
      const textOut = textCapture.stdout.join("\n");
      expect(textOut).toContain("variablesExamples:");
      expect(textOut).toContain(
        `inline-json: divedra workflow run worker-only --variables '{"request":""}'`,
      );
      expect(textOut).toContain(
        "explicit-file: divedra workflow run worker-only --variables @./variables.json",
      );
      expect(textOut).toContain(
        "file-path: divedra workflow run worker-only --variables ./variables.json",
      );
    });
  });

  test("workflow inspect --structure prints compact rows without inspection summary", async () => {
    await withLegacyWorkflowAuthorshipForCli(async () => {
      const root = await makeTempDir();
      await createManagerlessWorkflowFixture(root, "worker-only");
      const buildInspectionSummary: NonNullable<
        CliDependencies["buildInspectionSummary"]
      > = async () => {
        throw new Error(
          "compact structure text must not build inspection summary",
        );
      };
      const buildInspectionSummarySpy = vi.fn(buildInspectionSummary);

      const capture = createIoCapture();
      const code = await runCli(
        [
          "workflow",
          "inspect",
          "worker-only",
          "--workflow-definition-dir",
          root,
          "--structure",
        ],
        capture.io,
        createCliDeps({ buildInspectionSummary: buildInspectionSummarySpy }),
      );

      expect(code).toBe(0);
      expect(buildInspectionSummarySpy).not.toHaveBeenCalled();
      expect(capture.stdout).toEqual([
        "step-1",
        "  Accept the initial worker-only input and produce the first result.",
        "step-2",
        "  Finalize the worker-only workflow output.",
      ]);
      const output = capture.stdout.join("\n");
      expect(output).not.toContain("role=");
      expect(output).not.toContain("runtimeReady");
      expect(output).not.toContain("nodeRegistryIds");
      expect(output).not.toContain("workflowId");
      expect(output).not.toContain("callable");
    });
  });

  test("workflow inspect --structure prints missing descriptions as indented dash lines", async () => {
    await withLegacyWorkflowAuthorshipForCli(async () => {
      const root = await makeTempDir();
      await createMissingDescriptionWorkflowFixture(root, "missing-desc");

      const capture = createIoCapture();
      const code = await runCli(
        [
          "workflow",
          "inspect",
          "missing-desc",
          "--workflow-definition-dir",
          root,
          "--structure",
        ],
        capture.io,
      );

      expect(code).toBe(0);
      expect(capture.stdout).toEqual(["step-1", "  -", "step-2", "  -"]);
    });
  });

  test("workflow inspect --structure preserves json inspection output", async () => {
    await withLegacyWorkflowAuthorshipForCli(async () => {
      const root = await makeTempDir();
      await createManagerlessWorkflowFixture(root, "worker-only");

      const capture = createIoCapture();
      const code = await runCli(
        [
          "workflow",
          "inspect",
          "worker-only",
          "--workflow-definition-dir",
          root,
          "--structure",
          "--output",
          "json",
        ],
        capture.io,
      );

      expect(code).toBe(0);
      const parsed = JSON.parse(capture.stdout.join("\n")) as {
        workflowId: string;
        callable: { stepId: string; role: string };
        steps: Array<{ stepId: string; role: string; description?: string }>;
        nodeRegistryIds: readonly string[];
        runtime: { ready: boolean };
      };
      expect(parsed.workflowId).toBe("worker-only");
      expect(parsed.callable).toMatchObject({
        stepId: "step-1",
        role: "worker",
      });
      expect(parsed.steps).toEqual([
        {
          stepId: "step-1",
          role: "worker",
          description:
            "Accept the initial worker-only input and produce the first result.",
        },
        {
          stepId: "step-2",
          role: "worker",
          description: "Finalize the worker-only workflow output.",
        },
      ]);
      expect(parsed.nodeRegistryIds).toEqual(["worker-1", "worker-2"]);
      expect(typeof parsed.runtime.ready).toBe("boolean");
    });
  });

  test("workflow usage lists AI-facing workflow contracts", async () => {
    await withLegacyWorkflowAuthorshipForCli(async () => {
      const root = await makeTempDir();
      await createManagerlessWorkflowFixture(root, "worker-only");

      const capture = createIoCapture();
      const code = await runCli(
        [
          "workflow",
          "usage",
          "--workflow-definition-dir",
          root,
          "--output",
          "json",
        ],
        capture.io,
      );
      expect(code).toBe(0);

      const parsed = JSON.parse(capture.stdout.join("\n")) as {
        workflows: Array<{
          workflowName: string;
          callable: {
            stepId: string;
            role: string;
            input?: { description?: string };
            output?: { description?: string };
          };
          steps: Array<{
            stepId: string;
            role: string;
            description?: string;
          }>;
        }>;
      };
      expect(parsed.workflows).toHaveLength(1);
      expect(parsed.workflows[0]).toMatchObject({
        workflowName: "worker-only",
        callable: {
          stepId: "step-1",
          role: "worker",
          input: { description: "Worker-only workflow input payload." },
          output: { description: "Worker-only workflow output payload." },
        },
        steps: [
          {
            stepId: "step-1",
            role: "worker",
            description:
              "Accept the initial worker-only input and produce the first result.",
          },
          {
            stepId: "step-2",
            role: "worker",
            description: "Finalize the worker-only workflow output.",
          },
        ],
      });

      const textCapture = createIoCapture();
      const textCode = await runCli(
        ["workflow", "usage", "--workflow-definition-dir", root],
        textCapture.io,
      );
      expect(textCode).toBe(0);
      const textOut = textCapture.stdout.join("\n");
      expect(textOut).toContain("workflowName: worker-only");
      expect(textOut).toContain("input: Worker-only workflow input payload.");
      expect(textOut).toContain("steps:");
      expect(textOut).toContain(
        "  - step-1 role=worker description=Accept the initial worker-only input and produce the first result.",
      );
      expect(textOut).toContain(
        "  - step-2 role=worker description=Finalize the worker-only workflow output.",
      );
    });
  });

  test("workflow usage resolves one workflow and reports manager callable contract", async () => {
    await withLegacyWorkflowAuthorshipForCli(async () => {
      const root = await makeTempDir();
      await createWorkflowCallInspectFixture(root, "workflow-calls");

      const capture = createIoCapture();
      const code = await runCli(
        [
          "workflow",
          "usage",
          "workflow-calls",
          "--workflow-definition-dir",
          root,
          "--output",
          "json",
        ],
        capture.io,
      );
      expect(code).toBe(0);

      const parsed = JSON.parse(capture.stdout.join("\n")) as {
        workflowName: string;
        callable: {
          stepId: string;
          role: string;
          input?: { description?: string };
          output?: { description?: string };
        };
        steps: Array<{
          stepId: string;
          role: string;
          description?: string;
        }>;
      };
      expect(parsed.workflowName).toBe("workflow-calls");
      expect(parsed.callable).toMatchObject({
        stepId: "divedra-manager",
        role: "manager",
        input: { description: "Manager issue and workflow invocation input." },
        output: { description: "Manager handoff for the next step." },
      });
      expect(parsed.steps).toEqual([
        {
          stepId: "divedra-manager",
          role: "manager",
          description: "Coordinate the cross-workflow review flow.",
        },
        {
          stepId: "main-worker",
          role: "worker",
          description:
            "Draft the main workflow output and send it to the review workflow.",
        },
        {
          stepId: "post-review",
          role: "worker",
          description: "Apply the review result after the callee returns.",
        },
      ]);
    });
  });

  test("inspect reports step-derived cross-workflow calls in json and text output", async () => {
    await withLegacyWorkflowAuthorshipForCli(async () => {
      const root = await makeTempDir();
      await createWorkflowCallInspectFixture(root, "workflow-calls");

      const jsonCapture = createIoCapture();
      const jsonCode = await runCli(
        [
          "workflow",
          "inspect",
          "workflow-calls",
          "--workflow-definition-dir",
          root,
          "--output",
          "json",
        ],
        jsonCapture.io,
      );
      expect(jsonCode).toBe(0);

      const parsed = JSON.parse(jsonCapture.stdout.join("\n")) as {
        crossWorkflowDispatchIds: readonly string[];
        counts: { crossWorkflowDispatches: number };
        runtime: { ready: boolean };
      };
      expect(parsed.crossWorkflowDispatchIds).toEqual(["__cw:main-worker"]);
      expect(parsed.counts.crossWorkflowDispatches).toBe(1);
      expect(parsed.runtime.ready).toBe(true);

      const textCapture = createIoCapture();
      const textCode = await runCli(
        [
          "workflow",
          "inspect",
          "workflow-calls",
          "--workflow-definition-dir",
          root,
        ],
        textCapture.io,
      );
      expect(textCode).toBe(0);
      expect(textCapture.stdout.join("\n")).toContain(
        "crossWorkflowDispatches: 1",
      );
      expect(textCapture.stdout.join("\n")).toContain(
        "crossWorkflowDispatchIds: __cw:main-worker",
      );
      expect(textCapture.stdout.join("\n")).not.toContain("compatibility:");
      expect(textCapture.stdout.join("\n")).not.toContain("subWorkflows:");
      expect(textCapture.stdout.join("\n")).toContain("runtimeReady: yes");
    });
  });

  test("workflow run fails early when required agent backend transport is unavailable", async () => {
    const root = await makeTempDir();

    const createCode = await runCli(
      ["workflow", "create", "demo", "--workflow-definition-dir", root],
      createIoCapture().io,
    );
    expect(createCode).toBe(0);

    const capture = createIoCapture();
    const originalPath = process.env["PATH"];
    process.env["PATH"] = root;
    let code: number;
    try {
      code = await runCli(
        ["workflow", "run", "demo", "--workflow-definition-dir", root],
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
      ["workflow", "create", "demo", "--workflow-definition-dir", root],
      createIoCapture().io,
    );
    expect(createCode).toBe(0);

    const capture = createIoCapture();
    const originalPath = process.env["PATH"];
    process.env["PATH"] = root;
    let code: number;
    try {
      code = await runCli(
        ["cli", "workflow", "run", "demo", "--workflow-definition-dir", root],
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

  test("project workflow run stores runtime data in user-root project namespace", async () => {
    const projectRoot = await makeTempDir();
    const projectScopeRoot = path.join(projectRoot, ".divedra");
    const workflowRoot = path.join(projectScopeRoot, "workflows");
    const userRoot = path.join(projectRoot, "user-home", ".divedra");
    const expectedRootDataDir = computeProjectScopedRootDataDir({
      projectRoot,
      userRoot,
    });
    const scenarioPath = path.join(projectRoot, "mock-scenario.json");

    const created = await createWorkflowTemplate("demo", {
      workflowRoot,
      templateMode: "worker-only",
    });
    expect(created.ok).toBe(true);
    await writeFile(
      scenarioPath,
      `${JSON.stringify(makeDefaultTemplateScenario(), null, 2)}\n`,
      "utf8",
    );

    const previousCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const capture = createIoCapture();
      const code = await runCli(
        [
          "workflow",
          "run",
          "demo",
          "--mock-scenario",
          scenarioPath,
          "--output",
          "json",
        ],
        capture.io,
        createCliDeps({ env: { DIVEDRA_USER_ROOT: userRoot } }),
      );

      expect(code).toBe(0);
      const payload = JSON.parse(capture.stdout.join("\n")) as {
        readonly sessionId: string;
      };
      await expect(
        readFile(
          path.join(
            expectedRootDataDir,
            "sessions",
            `${payload.sessionId}.json`,
          ),
          "utf8",
        ),
      ).resolves.toContain('"workflowName": "demo"');
      await expect(
        readFile(
          path.join(
            projectScopeRoot,
            "artifacts",
            "sessions",
            `${payload.sessionId}.json`,
          ),
          "utf8",
        ),
      ).rejects.toThrow();
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("project workflow run uses direct project root as runtime namespace identity", async () => {
    const projectRoot = await makeTempDir();
    const workflowRoot = path.join(projectRoot, "workflows");
    const userRoot = path.join(projectRoot, "user-home", ".divedra");
    const expectedRootDataDir = computeProjectScopedRootDataDir({
      projectRoot,
      userRoot,
    });
    const scenarioPath = path.join(projectRoot, "mock-scenario.json");

    const created = await createWorkflowTemplate("demo", {
      workflowRoot,
      templateMode: "worker-only",
    });
    expect(created.ok).toBe(true);
    await writeFile(
      scenarioPath,
      `${JSON.stringify(makeDefaultTemplateScenario(), null, 2)}\n`,
      "utf8",
    );

    const previousCwd = process.cwd();
    process.chdir(await makeTempDir());
    try {
      const capture = createIoCapture();
      const code = await runCli(
        [
          "workflow",
          "run",
          "demo",
          "--mock-scenario",
          scenarioPath,
          "--output",
          "json",
        ],
        capture.io,
        createCliDeps({
          env: {
            DIVEDRA_PROJECT_ROOT: projectRoot,
            DIVEDRA_USER_ROOT: userRoot,
          },
        }),
      );

      expect(code).toBe(0);
      const payload = JSON.parse(capture.stdout.join("\n")) as {
        readonly sessionId: string;
      };
      await expect(
        readFile(
          path.join(
            expectedRootDataDir,
            "sessions",
            `${payload.sessionId}.json`,
          ),
          "utf8",
        ),
      ).resolves.toContain('"workflowName": "demo"');
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("workflow run passes --auto-improve through to the engine (mock fail then succeed)", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const examplesRoot = path.join(process.cwd(), "examples");
    const scenarioPath = path.join(
      examplesRoot,
      "supervised-mock-retry",
      "mock-scenario.json",
    );

    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        examplesRoot,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--mock-scenario",
        scenarioPath,
        "--auto-improve",
        "--max-supervised-attempts",
        "3",
        "--output",
        "json",
      ],
      capture.io,
    );

    expect(code).toBe(0);
    const out = JSON.parse(capture.stdout.join("\n")) as {
      status: string;
      supervision?: {
        status: string;
        incidents: readonly { category: string }[];
      };
    };
    expect(out.status).toBe("completed");
    expect(out.supervision).toBeDefined();
    expect(out.supervision?.status).toBe("succeeded");
    expect(
      (out.supervision?.incidents ?? []).some((i) => i.category === "failure"),
    ).toBe(true);
  });

  test("workflow run enables auto-improve by default", async () => {
    const root = await makeTempDir();
    const examplesRoot = path.join(process.cwd(), "examples");
    const scenarioPath = path.join(
      examplesRoot,
      "supervised-mock-retry",
      "mock-scenario.json",
    );

    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        examplesRoot,
        "--artifact-root",
        path.join(root, "artifacts"),
        "--session-store",
        path.join(root, "sessions"),
        "--mock-scenario",
        scenarioPath,
        "--output",
        "json",
      ],
      capture.io,
    );

    expect(code).toBe(0);
    const out = JSON.parse(capture.stdout.join("\n")) as {
      status: string;
      supervision?: {
        status: string;
        incidents: readonly { category: string }[];
      };
    };
    expect(out.status).toBe("completed");
    expect(out.supervision?.status).toBe("succeeded");
    expect(
      (out.supervision?.incidents ?? []).some((i) => i.category === "failure"),
    ).toBe(true);
  });

  test("workflow run keeps supervision under --no-auto-improve but disables workflow patching", async () => {
    const root = await makeTempDir();
    const examplesRoot = path.join(process.cwd(), "examples");
    const scenarioPath = path.join(
      examplesRoot,
      "supervised-mock-retry",
      "mock-scenario.json",
    );

    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        examplesRoot,
        "--artifact-root",
        path.join(root, "artifacts"),
        "--session-store",
        path.join(root, "sessions"),
        "--mock-scenario",
        scenarioPath,
        "--no-auto-improve",
        "--max-supervised-attempts",
        "3",
        "--output",
        "json",
      ],
      capture.io,
    );

    expect(code).toBe(0);
    const out = JSON.parse(capture.stdout.join("\n")) as {
      readonly status: string;
      readonly supervision?: {
        readonly status: string;
        readonly policy: {
          readonly maxSupervisedAttempts: number;
          readonly maxWorkflowPatches: number;
        };
        readonly incidents: readonly { readonly category: string }[];
      };
    };
    expect(out.status).toBe("completed");
    expect(out.supervision?.status).toBe("succeeded");
    expect(out.supervision?.policy.maxSupervisedAttempts).toBe(3);
    expect(out.supervision?.policy.maxWorkflowPatches).toBe(0);
    expect(
      (out.supervision?.incidents ?? []).some((i) => i.category === "failure"),
    ).toBe(true);
  });

  test("commands without auto-improve flags do not synthesize supervision policy input", async () => {
    const root = await makeTempDir();
    const capture = createIoCapture();
    const code = await runCli(
      ["workflow", "create", "demo", "--workflow-definition-dir", root],
      capture.io,
    );

    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
  });

  test("workflow run rejects invalid auto-improve numeric flags", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        path.join(process.cwd(), "examples"),
        "--auto-improve",
        "--monitor-interval-ms",
        "0",
      ],
      capture.io,
    );

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "invalid --auto-improve policy: monitorIntervalMs must be a positive integer",
    );
  });

  test("workflow run rejects a stall timeout shorter than the monitor interval", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        path.join(process.cwd(), "examples"),
        "--auto-improve",
        "--monitor-interval-ms",
        "5000",
        "--stall-timeout-ms",
        "4999",
      ],
      capture.io,
    );

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "invalid --auto-improve policy: stallTimeoutMs must be greater than or equal to monitorIntervalMs",
    );
  });

  test("workflow run accepts supervision policy flags through default supervision", async () => {
    const root = await makeTempDir();
    const examplesRoot = path.join(process.cwd(), "examples");
    const scenarioPath = path.join(
      examplesRoot,
      "supervised-mock-retry",
      "mock-scenario.json",
    );
    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        examplesRoot,
        "--artifact-root",
        path.join(root, "artifacts"),
        "--session-store",
        path.join(root, "sessions"),
        "--mock-scenario",
        scenarioPath,
        "--monitor-interval-ms",
        "1000",
        "--output",
        "json",
      ],
      capture.io,
    );

    expect(code).toBe(0);
    const out = JSON.parse(capture.stdout.join("\n")) as {
      readonly supervision?: {
        readonly policy?: { monitorIntervalMs: number };
      };
    };
    expect(out.supervision?.policy?.monitorIntervalMs).toBe(1000);
  });

  test("workflow run does not reject --nested-supervisor under default supervision", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        path.join(process.cwd(), "examples"),
        "--endpoint",
        "http://127.0.0.1:8787/graphql",
        "--nested-supervisor",
      ],
      capture.io,
    );

    expect(code).toBe(1);
    expect(capture.stderr.join("\n")).toContain("remote run failed");
    expect(capture.stderr.join("\n")).not.toContain("require --auto-improve");
  });

  test("workflow run accepts multiple supervision policy flags through default supervision", async () => {
    const root = await makeTempDir();
    const examplesRoot = path.join(process.cwd(), "examples");
    const scenarioPath = path.join(
      examplesRoot,
      "supervised-mock-retry",
      "mock-scenario.json",
    );
    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        examplesRoot,
        "--artifact-root",
        path.join(root, "artifacts"),
        "--session-store",
        path.join(root, "sessions"),
        "--mock-scenario",
        scenarioPath,
        "--workflow-mutation-mode",
        "execution-copy",
        "--monitor-interval-ms",
        "1000",
        "--output",
        "json",
      ],
      capture.io,
    );

    expect(code).toBe(0);
    const out = JSON.parse(capture.stdout.join("\n")) as {
      readonly supervision?: {
        readonly policy?: {
          monitorIntervalMs: number;
          workflowMutationMode: string;
        };
      };
    };
    expect(out.supervision?.policy).toMatchObject({
      monitorIntervalMs: 1000,
      workflowMutationMode: "execution-copy",
    });
  });

  test("workflow run rejects --superviser-workflow without a value", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        path.join(process.cwd(), "examples"),
        "--auto-improve",
        "--superviser-workflow",
      ],
      capture.io,
    );

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "--superviser-workflow requires a value",
    );
  });

  test("workflow run rejects --superviser-workflow when the value is missing before another flag", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        path.join(process.cwd(), "examples"),
        "--auto-improve",
        "--superviser-workflow",
        "--monitor-interval-ms",
        "1000",
      ],
      capture.io,
    );

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "--superviser-workflow requires a value",
    );
  });

  test("workflow run rejects --workflow-mutation-mode without a value", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        path.join(process.cwd(), "examples"),
        "--auto-improve",
        "--workflow-mutation-mode",
      ],
      capture.io,
    );

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "--workflow-mutation-mode requires a value: execution-copy or in-place",
    );
  });

  test("workflow run rejects --workflow-mutation-mode when the value is missing before another flag", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        path.join(process.cwd(), "examples"),
        "--auto-improve",
        "--workflow-mutation-mode",
        "--monitor-interval-ms",
        "1000",
      ],
      capture.io,
    );

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "--workflow-mutation-mode requires a value: execution-copy or in-place",
    );
  });

  test("workflow run preserves the first parse error when a later flag is also invalid", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        path.join(process.cwd(), "examples"),
        "--auto-improve",
        "--superviser-workflow",
        "--workflow-mutation-mode",
        "mutate-all-the-things",
      ],
      capture.io,
    );

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "--superviser-workflow requires a value",
    );
    expect(capture.stderr.join("\n")).not.toContain(
      "invalid --workflow-mutation-mode value 'mutate-all-the-things'",
    );
  });

  test.each([
    {
      name: "workflow run rejects --workflow-definition-dir without a value",
      argv: [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
      ],
      message: "--workflow-definition-dir requires a value",
    },
    {
      name: "workflow run rejects removed --workflow-root",
      argv: ["workflow", "run", "supervised-mock-retry", "--workflow-root"],
      message:
        "--workflow-root has been removed; use --workflow-definition-dir",
    },
    {
      name: "session status rejects --endpoint without a value",
      argv: ["session", "status", "sess-missing-endpoint", "--endpoint"],
      message: "--endpoint requires a value",
    },
    {
      name: "call-step rejects --message-file without a value",
      argv: [
        "call-step",
        "demo",
        "sess-call-step-local",
        "writer-step",
        "--message-file",
      ],
      message: "--message-file requires a value",
    },
    {
      name: "workflow inspect rejects --output without a value",
      argv: ["workflow", "inspect", "supervised-mock-retry", "--output"],
      message: "--output requires a value: json, text, or table",
    },
    {
      name: "session logs rejects --format without a value",
      argv: ["session", "logs", "sess-format-missing", "--format"],
      message: "--format requires a value: json, jsonl, or text",
    },
  ])("$name", async ({ argv, message }) => {
    const capture = createIoCapture();
    const code = await runCli(argv, capture.io);

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(message);
  });

  test("workflow inspect rejects --output table (table is only for workflow list and status)", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "workflow",
        "inspect",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        path.join(process.cwd(), "examples"),
        "--output",
        "table",
      ],
      capture.io,
    );
    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "`--output table` is only supported for workflow list and workflow status",
    );
  });

  test.each([
    {
      name: "workflow run rejects invalid --workflow-mutation-mode values",
      argv: [
        "workflow",
        "run",
        "supervised-mock-retry",
        "--workflow-definition-dir",
        path.join(process.cwd(), "examples"),
        "--auto-improve",
        "--workflow-mutation-mode",
        "mutate-all-the-things",
      ],
      message:
        "invalid --workflow-mutation-mode value 'mutate-all-the-things'; expected execution-copy or in-place",
    },
    {
      name: "workflow inspect rejects invalid --output values",
      argv: [
        "workflow",
        "inspect",
        "supervised-mock-retry",
        "--output",
        "yaml",
      ],
      message: "invalid --output value 'yaml'; expected json, text, or table",
    },
    {
      name: "session logs rejects invalid --format values",
      argv: ["session", "logs", "sess-format-invalid", "--format", "yaml"],
      message: "invalid --format value 'yaml'; expected json, jsonl, or text",
    },
  ])("$name", async ({ argv, message }) => {
    const capture = createIoCapture();
    const code = await runCli(argv, capture.io);

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(message);
  });

  test("workflow run accepts inline, explicit file, and bare file runtime variables locally", async () => {
    const root = await makeTempDir();
    await createManagerlessWorkflowFixture(root, "worker-only");
    const explicitVariablesPath = await writeRuntimeVariablesFile(
      root,
      "explicit-runtime-variables.json",
      { hours: 24 },
    );
    const bareVariablesPath = await writeRuntimeVariablesFile(
      root,
      "bare-runtime-variables.json",
      { humanInput: { request: "from file" } },
    );
    const scalarNamedVariablesPath = await writeRuntimeVariablesFile(
      root,
      "48",
      {
        hours: 12,
      },
    );
    const session = createSessionState({
      sessionId: "sess-runtime-vars",
      workflowName: "worker-only",
      workflowId: "worker-only",
      initialNodeId: "step-1",
      runtimeVariables: {},
    });
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

    const cases = [
      {
        value: '{"hours":48}',
        expected: { hours: 48 },
      },
      {
        value: `@${explicitVariablesPath}`,
        expected: { hours: 24 },
      },
      {
        value: bareVariablesPath,
        expected: { humanInput: { request: "from file" } },
      },
      {
        value: scalarNamedVariablesPath,
        expected: { hours: 12 },
      },
    ] as const;

    for (const entry of cases) {
      const capture = createIoCapture();
      const code = await runCli(
        [
          "workflow",
          "run",
          "worker-only",
          "--workflow-definition-dir",
          root,
          "--variables",
          entry.value,
          "--output",
          "json",
        ],
        capture.io,
      );
      expect(code).toBe(0);
    }

    expect(runWorkflowSpy).toHaveBeenCalledTimes(cases.length);
    for (const [index, entry] of cases.entries()) {
      expect(runWorkflowSpy.mock.calls[index]?.[1]).toEqual(
        expect.objectContaining({
          runtimeVariables: entry.expected,
        }),
      );
    }
  });

  test.each([
    {
      name: "malformed inline object",
      value: '{"hours":',
      expected: "inline JSON must contain valid JSON",
    },
    {
      name: "inline array",
      value: '["hours"]',
      expected: "--variables must resolve to a JSON object",
    },
    {
      name: "inline scalar",
      value: "48",
      expected: "--variables must resolve to a JSON object",
    },
    {
      name: "unreadable explicit file",
      value: "@/missing/variables.json",
      expected: "ENOENT",
    },
    {
      name: "unreadable bare file",
      value: "/missing/variables.json",
      expected: "ENOENT",
    },
  ])("workflow run rejects invalid runtime variables: $name", async ({
    value,
    expected,
  }) => {
    const runWorkflowSpy = vi.spyOn(workflowEngine, "runWorkflow");
    const capture = createIoCapture();
    const code = await runCli(
      ["workflow", "run", "demo", "--variables", value],
      capture.io,
    );

    expect(code).toBe(1);
    expect(capture.stderr.join("\n")).toContain("failed to parse --variables");
    expect(capture.stderr.join("\n")).toContain(expected);
    expect(runWorkflowSpy).not.toHaveBeenCalled();
  });

  test("workflow run rejects non-object runtime variables files", async () => {
    const root = await makeTempDir();
    const variablesPath = path.join(root, "variables.json");
    await writeJson(variablesPath, ["hours"]);
    const runWorkflowSpy = vi.spyOn(workflowEngine, "runWorkflow");
    const capture = createIoCapture();
    const code = await runCli(
      ["workflow", "run", "demo", "--variables", variablesPath],
      capture.io,
    );

    expect(code).toBe(1);
    expect(capture.stderr.join("\n")).toContain(
      "--variables must resolve to a JSON object",
    );
    expect(runWorkflowSpy).not.toHaveBeenCalled();
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
      ["workflow", "create", "demo", "--workflow-definition-dir", root],
      createCapture.io,
    );
    expect(createCode).toBe(0);

    const runCapture = createIoCapture();
    const runCode = await runCli(
      [
        "workflow",
        "run",
        "demo",
        "--workflow-definition-dir",
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
        "--workflow-definition-dir",
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
        "--workflow-definition-dir",
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
        ["workflow", "create", "demo", "--workflow-definition-dir", root],
        createCapture.io,
      ),
    ).toBe(0);

    const runCapture = createIoCapture();
    const runCode = await runCli(
      [
        "workflow",
        "run",
        "demo",
        "--workflow-definition-dir",
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
        "--workflow-definition-dir",
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
        "--workflow-definition-dir",
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
      rerunFromStepId: string;
    };
    expect(rerunPayload.sourceSessionId).toBe(runPayload.sessionId);
    expect(rerunPayload.sessionId).not.toBe(runPayload.sessionId);
    expect(rerunPayload.rerunFromStepId).toBe("main-worker");
  });

  test("session progress and status expose step-centric execution state", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const sessionId = "sess-step-progress";
    const session = {
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
      restartCounts: {
        "writer-step": 2,
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
            artifactsRoot,
            "demo",
            sessionId,
            "exec-writer-1",
          ),
          startedAt: "2026-04-24T05:00:00.000Z",
          endedAt: "2026-04-24T05:00:10.000Z",
        },
      ],
    };
    const saved = await saveSession(session, {
      sessionStoreRoot: sessionsRoot,
    });
    expect(saved.ok).toBe(true);

    const progressCapture = createIoCapture();
    const progressCode = await runCli(
      [
        "session",
        "progress",
        sessionId,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--output",
        "json",
      ],
      progressCapture.io,
    );
    expect(progressCode).toBe(0);
    const progressPayload = JSON.parse(progressCapture.stdout.join("\n")) as {
      currentNodeId: string | null;
      currentStepId: string | null;
      stepSummaries: Array<{
        stepId: string;
        executions: number;
        restarts: number;
      }>;
      nodeSummaries: Array<{
        nodeId: string;
        executions: number;
        restarts: number;
      }>;
    };
    expect(progressPayload.currentNodeId).toBe("writer-node");
    expect(progressPayload.currentStepId).toBe("writer-step");
    expect(progressPayload.nodeSummaries).toContainEqual({
      nodeId: "writer-node",
      executions: 1,
      restarts: 0,
    });
    expect(progressPayload.stepSummaries).toEqual([
      {
        stepId: "writer-step",
        executions: 1,
        restarts: 2,
      },
    ]);

    const statusCapture = createIoCapture();
    const statusCode = await runCli(
      [
        "session",
        "status",
        sessionId,
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
      currentNodeId: string | null;
      currentStepId: string | null;
    };
    expect(statusPayload.currentNodeId).toBe("writer-node");
    expect(statusPayload.currentStepId).toBe("writer-step");
  });

  test("session status discovers project-local session store from cwd", async () => {
    const projectRoot = await makeTempDir();
    const projectScopeRoot = path.join(projectRoot, ".divedra");
    const userRoot = path.join(projectRoot, "user-home", ".divedra");
    const artifactsRoot = computeProjectScopedRootDataDir({
      projectRoot,
      userRoot,
    });
    const sessionsRoot = path.join(artifactsRoot, "sessions");
    const sessionId = "sess-project-local-status";
    await mkdir(path.join(projectScopeRoot, "workflows"), { recursive: true });

    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName: "demo",
          workflowId: "demo",
          initialNodeId: "writer-node",
          runtimeVariables: {},
        }),
        status: "running" as const,
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
              artifactsRoot,
              "workflow",
              "demo",
              sessionId,
              "nodes",
              "writer-node",
              "exec-writer-1",
            ),
            startedAt: "2026-04-24T05:00:00.000Z",
            endedAt: "2026-04-24T05:00:10.000Z",
          },
        ],
      },
      {
        sessionStoreRoot: sessionsRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const previousCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const statusCapture = createIoCapture();
      const statusCode = await runCli(
        ["session", "status", sessionId, "--output", "json"],
        statusCapture.io,
        createCliDeps({ env: { DIVEDRA_USER_ROOT: userRoot } }),
      );
      expect(statusCode).toBe(0);
      const payload = JSON.parse(statusCapture.stdout.join("\n")) as {
        currentNodeId: string | null;
        currentStepId: string | null;
        status: string;
      };
      expect(payload.status).toBe("running");
      expect(payload.currentNodeId).toBe("writer-node");
      expect(payload.currentStepId).toBe("writer-step");
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("session status discovers project-local session store from workflow definition dir outside the project cwd", async () => {
    const projectRoot = await makeTempDir();
    const externalRoot = await makeTempDir();
    const projectScopeRoot = path.join(projectRoot, ".divedra");
    const workflowRoot = path.join(projectScopeRoot, "workflows");
    const userRoot = path.join(projectRoot, "user-home", ".divedra");
    const artifactsRoot = computeProjectScopedRootDataDir({
      projectRoot,
      userRoot,
      cwd: externalRoot,
    });
    const sessionsRoot = path.join(artifactsRoot, "sessions");
    const sessionId = "sess-project-local-workflow-root";
    await mkdir(workflowRoot, { recursive: true });

    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName: "demo",
          workflowId: "demo",
          initialNodeId: "writer-node",
          runtimeVariables: {},
        }),
        status: "running" as const,
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
              artifactsRoot,
              "workflow",
              "demo",
              sessionId,
              "nodes",
              "writer-node",
              "exec-writer-1",
            ),
            startedAt: "2026-04-24T05:00:00.000Z",
            endedAt: "2026-04-24T05:00:10.000Z",
          },
        ],
      },
      {
        sessionStoreRoot: sessionsRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const previousCwd = process.cwd();
    process.chdir(externalRoot);
    try {
      const statusCapture = createIoCapture();
      const statusCode = await runCli(
        [
          "session",
          "status",
          sessionId,
          "--workflow-definition-dir",
          workflowRoot,
          "--output",
          "json",
        ],
        statusCapture.io,
        createCliDeps({ env: { DIVEDRA_USER_ROOT: userRoot } }),
      );
      expect(statusCode).toBe(0);
      const payload = JSON.parse(statusCapture.stdout.join("\n")) as {
        currentNodeId: string | null;
        currentStepId: string | null;
        status: string;
      };
      expect(payload.status).toBe("running");
      expect(payload.currentNodeId).toBe("writer-node");
      expect(payload.currentStepId).toBe("writer-step");
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("session progress and status infer the current step from authored workflow state before the first execution record exists", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const sessionId = "sess-step-current-target";

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
        sessionStoreRoot: sessionsRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const progressCapture = createIoCapture();
    const progressCode = await runCli(
      [
        "session",
        "progress",
        sessionId,
        "--workflow-definition-dir",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--output",
        "json",
      ],
      progressCapture.io,
    );
    expect(progressCode).toBe(0);
    const progressPayload = JSON.parse(progressCapture.stdout.join("\n")) as {
      currentNodeId: string | null;
      currentStepId: string | null;
    };
    expect(progressPayload.currentNodeId).toBe("writer-step");
    expect(progressPayload.currentStepId).toBe("writer-step");

    const statusCapture = createIoCapture();
    const statusCode = await runCli(
      [
        "session",
        "status",
        sessionId,
        "--workflow-definition-dir",
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
      currentNodeId: string | null;
      currentStepId: string | null;
    };
    expect(statusPayload.currentNodeId).toBe("writer-step");
    expect(statusPayload.currentStepId).toBe("writer-step");
  });

  test("session health emits conservative json and omits LLM messages by default", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const sessionId = "sess-health-json";
    const artifactDir = path.join(
      artifactsRoot,
      "demo",
      sessionId,
      "node-exec-001",
    );
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(artifactDir, "output.json"), "{}\n", "utf8");
    const session = {
      ...createSessionState({
        sessionId,
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "writer-step",
        runtimeVariables: {},
      }),
      status: "running" as const,
      startedAt: "2026-05-04T00:00:00.000Z",
      currentNodeId: "writer-step",
      queue: ["writer-step"],
      nodeExecutions: [
        {
          nodeId: "writer-step",
          stepId: "writer-step",
          nodeExecId: "node-exec-001",
          status: "succeeded" as const,
          artifactDir,
          startedAt: "2026-05-04T00:00:01.000Z",
          endedAt: "2026-05-04T00:00:02.000Z",
        },
      ],
      nodeExecutionCounter: 1,
      nodeExecutionCounts: { "writer-step": 1 },
    };
    const saved = await saveSession(session, {
      sessionStoreRoot: sessionsRoot,
      rootDataDir: root,
      artifactRoot: artifactsRoot,
    });
    expect(saved.ok).toBe(true);
    await saveNodeExecutionToRuntimeDb(
      {
        sessionId,
        nodeId: "writer-step",
        stepId: "writer-step",
        nodeExecId: "node-exec-001",
        status: "succeeded",
        artifactDir,
        startedAt: "2026-05-04T00:00:01.000Z",
        endedAt: "2026-05-04T00:00:02.000Z",
        executionOrdinal: 1,
        inputJson: "{}",
        outputJson: JSON.stringify({
          provider: "codex-agent",
          model: "gpt-5.5",
        }),
        inputHash: "input-hash",
        outputHash: "output-hash",
        llmMessages: [
          {
            ordinal: 1,
            eventType: "assistant.message",
            role: "assistant",
            contentText: "hidden by default",
            at: "2026-05-04T00:00:03.000Z",
          },
        ],
      },
      { rootDataDir: root, artifactRoot: artifactsRoot },
    );

    const healthCapture = createIoCapture();
    const healthCode = await runCli(
      [
        "session",
        "health",
        sessionId,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--stall-timeout-ms",
        "60000",
        "--output",
        "json",
      ],
      healthCapture.io,
    );

    expect(healthCode).toBe(0);
    const payload = JSON.parse(healthCapture.stdout.join("\n")) as {
      health: { state: string };
      recentLlmMessages: unknown[];
      evidenceCompleteness: { llmMessages: string };
    };
    expect(payload.health.state).toBe("running");
    expect(payload.recentLlmMessages).toEqual([]);
    expect(payload.evidenceCompleteness.llmMessages).toBe("disabled");
  });

  test("session health text includes bounded LLM history only with the opt-in flag", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const sessionId = "sess-health-llm";
    const artifactDir = path.join(
      artifactsRoot,
      "demo",
      sessionId,
      "node-exec-001",
    );
    await mkdir(artifactDir, { recursive: true });
    const session = {
      ...createSessionState({
        sessionId,
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "writer-step",
        runtimeVariables: {},
      }),
      status: "running" as const,
      startedAt: "2026-05-04T00:00:00.000Z",
      currentNodeId: "writer-step",
      queue: ["writer-step"],
    };
    const saved = await saveSession(session, {
      sessionStoreRoot: sessionsRoot,
      rootDataDir: root,
      artifactRoot: artifactsRoot,
    });
    expect(saved.ok).toBe(true);
    await saveNodeExecutionToRuntimeDb(
      {
        sessionId,
        nodeId: "writer-step",
        stepId: "writer-step",
        nodeExecId: "node-exec-001",
        status: "succeeded",
        artifactDir,
        startedAt: "2026-05-04T00:00:01.000Z",
        endedAt: "2026-05-04T00:00:02.000Z",
        executionOrdinal: 1,
        inputJson: "{}",
        outputJson: JSON.stringify({
          provider: "codex-agent",
          model: "gpt-5.5",
        }),
        inputHash: "input-hash",
        outputHash: "output-hash",
        llmMessages: [
          {
            ordinal: 1,
            eventType: "assistant.message",
            role: "assistant",
            contentText: "visible when requested",
            at: "2026-05-04T00:00:03.000Z",
          },
        ],
      },
      { rootDataDir: root, artifactRoot: artifactsRoot },
    );

    const healthCapture = createIoCapture();
    const healthCode = await runCli(
      [
        "session",
        "health",
        sessionId,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--stall-timeout-ms",
        "60000",
        "--include-llm-messages",
        "--llm-limit",
        "1",
      ],
      healthCapture.io,
    );

    expect(healthCode).toBe(0);
    expect(healthCapture.stdout.join("\n")).toContain("recentLlmMessages: 1");
  });

  test("session health rejects graphql transport", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "session",
        "health",
        "sess-health-remote",
        "--endpoint",
        "http://127.0.0.1:8787/graphql",
      ],
      capture.io,
    );

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "session health currently supports local execution only",
    );
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
        "--workflow-definition-dir",
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
        "--workflow-definition-dir",
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

  test("session export includes continuationMetadata for history-linked sessions", async () => {
    const root = await makeTempDir();
    const sessionsRoot = path.join(root, "sessions");
    const artifactRoot = path.join(root, "artifacts");
    await mkdir(artifactRoot, { recursive: true });

    const continued = {
      ...createSessionState({
        sessionId: "sess-export-continued",
        workflowName: "demo",
        workflowId: "demo-wf",
        initialNodeId: "step-2",
        runtimeVariables: {},
      }),
      continuedFromWorkflowExecutionId: "sess-export-src",
      continuedAfterStepRunId: "ne-1",
      continuedAfterExecutionOrdinal: 1,
      continuedStartStepId: "step-2",
      continuationMode: "rerun-from-history" as const,
      historyImports: [
        {
          sourceWorkflowExecutionId: "sess-export-src",
          throughStepRunId: "ne-1",
          throughExecutionOrdinal: 1,
        },
      ],
    };
    const saved = await saveSession(continued, {
      sessionStoreRoot: sessionsRoot,
    });
    expect(saved.ok).toBe(true);

    const exportCapture = createIoCapture();
    const exportCode = await runCli(
      [
        "session",
        "export",
        "sess-export-continued",
        "--workflow-definition-dir",
        root,
        "--artifact-root",
        artifactRoot,
        "--session-store",
        sessionsRoot,
      ],
      exportCapture.io,
    );

    expect(exportCode).toBe(0);
    const exportPayload = JSON.parse(exportCapture.stdout.join("\n")) as {
      continuationMetadata?: {
        continuedFromWorkflowExecutionId?: string;
        historyImports?: readonly {
          sourceWorkflowExecutionId: string;
          throughStepRunId: string;
          throughExecutionOrdinal: number;
        }[];
      };
    };
    expect(
      exportPayload.continuationMetadata?.continuedFromWorkflowExecutionId,
    ).toBe("sess-export-src");
    expect(exportPayload.continuationMetadata?.historyImports).toEqual([
      {
        sourceWorkflowExecutionId: "sess-export-src",
        throughStepRunId: "ne-1",
        throughExecutionOrdinal: 1,
      },
    ]);
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
        "--workflow-definition-dir",
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
        "--workflow-definition-dir",
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
        ["workflow", "create", "demo", "--workflow-definition-dir", root],
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
        "--workflow-definition-dir",
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
    const capture = createIoCapture();
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
        '{"humanInput":{"request":"start demo workflow"}}',
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

  test("workflow run forwards --no-auto-improve as lifecycle-only supervision through GraphQL transport", async () => {
    const capture = createIoCapture();
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
        "--no-auto-improve",
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
                  workflowExecutionId: "sess-remote-no-auto",
                  sessionId: "sess-remote-no-auto",
                  status: "completed",
                  exitCode: 0,
                },
              },
            });
          }
          return createJsonResponse({
            data: {
              workflowExecution: {
                session: {
                  sessionId: "sess-remote-no-auto",
                  workflowName: "demo",
                  workflowId: "demo",
                  transitions: [{ at: "2026-03-15T00:00:00.000Z" }],
                },
                nodeExecutions: [{ nodeExecId: "exec-1" }],
              },
            },
          });
        },
      },
    );

    expect(code).toBe(0);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("http://example.test/graphql");
    expect(requests[0]?.body).toMatchObject({
      variables: {
        input: {
          workflowName: "demo",
          autoImprove: expect.objectContaining({
            enabled: true,
            maxWorkflowPatches: 0,
          }),
        },
      },
    });
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({
      sessionId: "sess-remote-no-auto",
      status: "completed",
      workflowName: "demo",
      workflowId: "demo",
      nodeExecutions: 1,
      transitions: 1,
      exitCode: 0,
    });
  });

  test("workflow run rejects invalid inline variables before GraphQL transport", async () => {
    const capture = createIoCapture();
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({ data: { unreachable: true } }),
    );

    const code = await runCli(
      [
        "workflow",
        "run",
        "demo",
        "--endpoint",
        "http://example.test/graphql",
        "--variables",
        "[]",
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

    expect(code).toBe(1);
    expect(capture.stderr.join("\n")).toContain(
      "--variables must resolve to a JSON object",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
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
          stepId: "workflow-output",
        },
      },
    });
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({
      sourceSessionId: "sess-remote-001",
      sessionId: "sess-remote-002",
      status: "running",
      rerunFromStepId: "workflow-output",
      exitCode: 0,
    });
  });

  test("workflow run forwards auto-improve and nested-superviser through GraphQL transport", async () => {
    const capture = createIoCapture();
    const requests: Readonly<Record<string, unknown>>[] = [];

    const code = await runCli(
      [
        "workflow",
        "run",
        "demo",
        "--endpoint",
        "http://example.test/graphql",
        "--auto-improve",
        "--nested-superviser",
        "--superviser-workflow",
        "custom-superviser",
        "--monitor-interval-ms",
        "6000",
        "--stall-timeout-ms",
        "12000",
        "--max-supervised-attempts",
        "4",
        "--max-workflow-patches",
        "2",
        "--workflow-mutation-mode",
        "in-place",
        "--no-allow-targeted-rerun",
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
          const body = JSON.parse(String(init?.body)) as Readonly<
            Record<string, unknown>
          >;
          requests.push(body);
          const query = typeof body["query"] === "string" ? body["query"] : "";
          if (query.includes("mutation ExecuteWorkflow")) {
            return createJsonResponse({
              data: {
                executeWorkflow: {
                  workflowExecutionId: "sess-remote-supervised",
                  sessionId: "sess-remote-supervised",
                  status: "running",
                  exitCode: 0,
                },
              },
            });
          }
          return createJsonResponse({
            data: {
              workflowExecution: {
                session: {
                  sessionId: "sess-remote-supervised",
                  workflowName: "demo",
                  workflowId: "demo",
                  transitions: [],
                },
                nodeExecutions: [],
              },
            },
          });
        },
      },
    );

    expect(code).toBe(0);
    expect(requests[0]).toMatchObject({
      variables: {
        input: {
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
      },
    });
  });

  test("workflow run forwards canonical supervisor CLI aliases through GraphQL transport", async () => {
    const capture = createIoCapture();
    const requests: Readonly<Record<string, unknown>>[] = [];

    const code = await runCli(
      [
        "workflow",
        "run",
        "demo",
        "--endpoint",
        "http://example.test/graphql",
        "--auto-improve",
        "--nested-supervisor",
        "--supervisor-workflow",
        "custom-superviser",
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
          const body = JSON.parse(String(init?.body)) as Readonly<
            Record<string, unknown>
          >;
          requests.push(body);
          const query = typeof body["query"] === "string" ? body["query"] : "";
          if (query.includes("mutation ExecuteWorkflow")) {
            return createJsonResponse({
              data: {
                executeWorkflow: {
                  workflowExecutionId: "sess-remote-supervised",
                  sessionId: "sess-remote-supervised",
                  status: "running",
                  exitCode: 0,
                },
              },
            });
          }
          return createJsonResponse({
            data: {
              workflowExecution: {
                session: {
                  sessionId: "sess-remote-supervised",
                  workflowName: "demo",
                  workflowId: "demo",
                  transitions: [],
                },
                nodeExecutions: [],
              },
            },
          });
        },
      },
    );

    expect(code).toBe(0);
    expect(requests[0]).toMatchObject({
      variables: {
        input: {
          workflowName: "demo",
          nestedSuperviser: true,
          autoImprove: {
            enabled: true,
            superviserWorkflowId: "custom-superviser",
          },
        },
      },
    });
  });

  test("session resume forwards auto-improve and nested-superviser through GraphQL transport", async () => {
    const capture = createIoCapture();
    let requestedBody: Readonly<Record<string, unknown>> | undefined;

    const code = await runCli(
      [
        "session",
        "resume",
        "sess-remote-001",
        "--endpoint",
        "http://example.test/graphql",
        "--auto-improve",
        "--nested-superviser",
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
          nestedSuperviser: true,
          autoImprove: {
            enabled: true,
          },
        },
      },
    });
  });

  test("session rerun rejects nested superviser before execution", async () => {
    const capture = createIoCapture();

    const code = await runCli(
      [
        "session",
        "rerun",
        "sess-remote-001",
        "workflow-output",
        "--auto-improve",
        "--nested-superviser",
      ],
      capture.io,
    );

    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "not supported for session rerun",
    );
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
    expect(runWorkflowSpy.mock.calls[0]?.[1]).not.toHaveProperty("autoImprove");
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
        rerunFromStepId: "workflow-output",
        workflowWorkingDirectory: "apps/reviewer",
        dryRun: true,
        maxSteps: 7,
        maxLoopIterations: 4,
        defaultTimeoutMs: 1200,
      }),
    );
    expect(runWorkflowSpy.mock.calls[0]?.[1]).not.toHaveProperty("autoImprove");
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({
      sourceSessionId: "sess-local-rerun",
      sessionId: "sess-local-rerun-2",
      status: "running",
      rerunFromStepId: "workflow-output",
      exitCode: 0,
    });
  });

  test("session continue requires --start-step and --after-step-run", async () => {
    const capture = createIoCapture();
    const code = await runCli(["session", "continue", "sess-any"], capture.io);
    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain("--start-step is required");
    expect(capture.stderr.join("\n")).toContain("--after-step-run is required");
  });

  test("session continue rejects graphql transport", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "session",
        "continue",
        "sess-remote-001",
        "--start-step",
        "step-2",
        "--after-step-run",
        "exec-1",
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
        fetchImpl: async () => new Response("{}"),
      },
    );
    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "session continue currently supports local execution only",
    );
  });

  test("session continue rejects auto-improve", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "session",
        "continue",
        "sess-x",
        "--start-step",
        "step-2",
        "--after-step-run",
        "exec-1",
        "--auto-improve",
      ],
      capture.io,
    );
    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "cannot be combined with session continue",
    );
  });

  test("local session continue forwards continuation engine options", async () => {
    const root = await makeTempDir();
    const sessionStoreRoot = path.join(root, "sessions");
    const capture = createIoCapture();
    const session = createSessionState({
      sessionId: "sess-local-continue-src",
      workflowName: "demo",
      workflowId: "demo",
      initialNodeId: "main-worker",
      runtimeVariables: {},
    });
    await saveSession(session, { sessionStoreRoot });

    const continuedSessionState = createSessionState({
      sessionId: "sess-local-continue-new",
      workflowName: "demo",
      workflowId: "demo",
      initialNodeId: "step-2",
      runtimeVariables: {},
    });

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue(
        ok({
          session: {
            ...continuedSessionState,
            status: "running",
          },
          exitCode: 0,
        } satisfies workflowEngine.WorkflowRunResult),
      );

    const code = await runCli(
      [
        "session",
        "continue",
        "sess-local-continue-src",
        "--session-store",
        sessionStoreRoot,
        "--start-step",
        "step-2",
        "--after-step-run",
        "exec-anchor",
        "--working-dir",
        " apps/reviewer ",
        "--dry-run",
        "--max-steps",
        "9",
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
        continueFromWorkflowExecutionId: "sess-local-continue-src",
        continueAfterStepRunId: "exec-anchor",
        continueStartStepId: "step-2",
        workflowWorkingDirectory: "apps/reviewer",
        dryRun: true,
        maxSteps: 9,
      }),
    );
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({
      sourceWorkflowExecutionId: "sess-local-continue-src",
      sessionId: "sess-local-continue-new",
      status: "running",
      continuedAfterStepRunId: "exec-anchor",
      continuedStartStepId: "step-2",
      exitCode: 0,
    });
  });

  test("workflow run forwards --max-concurrency to runWorkflow options", async () => {
    const root = await makeTempDir();
    await createManagerlessWorkflowFixture(root, "worker-only");
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const capture = createIoCapture();
    const session = createSessionState({
      sessionId: "sess-max-concurrency-run",
      workflowName: "worker-only",
      workflowId: "worker-only",
      initialNodeId: "main-worker",
      runtimeVariables: {},
    });

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue(
        ok({
          session: { ...session, status: "completed" },
          exitCode: 0,
        } satisfies workflowEngine.WorkflowRunResult),
      );

    const code = await runCli(
      [
        "workflow",
        "run",
        "worker-only",
        "--workflow-definition-dir",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--max-concurrency",
        "3",
        "--output",
        "json",
      ],
      capture.io,
    );

    expect(code).toBe(0);
    expect(runWorkflowSpy).toHaveBeenCalledWith(
      "worker-only",
      expect.objectContaining({ maxConcurrency: 3 }),
    );
  });

  test("workflow run --verbose prints step-start progress to stderr without polluting json stdout", async () => {
    const root = await makeTempDir();
    await createManagerlessWorkflowFixture(root, "worker-only");
    const artifactsRoot = path.join(root, "artifacts");
    const sessionsRoot = path.join(root, "sessions");
    const capture = createIoCapture();
    const session = createSessionState({
      sessionId: "sess-verbose-run",
      workflowName: "worker-only",
      workflowId: "worker-only",
      initialNodeId: "main-worker",
      runtimeVariables: {},
    });

    vi.spyOn(workflowEngine, "runWorkflow").mockImplementation(
      async (_workflowName, options) => {
        await options?.eventSink?.emit({
          type: "step-started",
          workflowExecutionId: "sess-verbose-run",
          workflowName: "worker-only",
          workflowId: "worker-only",
          stepId: "main-worker",
          nodeId: "main-worker",
          nodeExecId: "exec-000001",
          attempt: 1,
          queuedStepIds: [],
        });
        return ok({
          session: { ...session, status: "completed" },
          exitCode: 0,
        } satisfies workflowEngine.WorkflowRunResult);
      },
    );

    const code = await runCli(
      [
        "workflow",
        "run",
        "worker-only",
        "--workflow-definition-dir",
        root,
        "--artifact-root",
        artifactsRoot,
        "--session-store",
        sessionsRoot,
        "--verbose",
        "--output",
        "json",
      ],
      capture.io,
    );

    expect(code).toBe(0);
    expect(capture.stderr.join("\n")).toContain(
      "workflow step start: sessionId=sess-verbose-run workflow=worker-only stepId=main-worker nodeId=main-worker nodeExecId=exec-000001 attempt=1 queueRemaining=0",
    );
    const payload = JSON.parse(capture.stdout.join("\n")) as {
      readonly sessionId?: string;
    };
    expect(payload.sessionId).toBe("sess-verbose-run");
  });

  test.each([
    {
      name: "zero",
      value: "0",
      expected: "invalid --max-concurrency",
    },
    {
      name: "non-integer",
      value: "1.5",
      expected: "invalid --max-concurrency",
    },
    {
      name: "negative",
      value: "-1",
      expected: "invalid --max-concurrency",
    },
  ])("workflow run rejects invalid --max-concurrency: $name", async ({
    value,
    expected,
  }) => {
    const runWorkflowSpy = vi.spyOn(workflowEngine, "runWorkflow");
    const capture = createIoCapture();
    const code = await runCli(
      ["workflow", "run", "demo", "--max-concurrency", value],
      capture.io,
    );
    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(expected);
    expect(runWorkflowSpy).not.toHaveBeenCalled();
  });

  test("session step-runs rejects graphql transport", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "session",
        "step-runs",
        "sess-remote-001",
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
        fetchImpl: async () => new Response("{}"),
      },
    );
    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain(
      "session step-runs currently supports local execution only",
    );
  });

  test("session step-runs rejects invalid node execution status filter", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      ["session", "step-runs", "sess-z", "--status", "paused"],
      capture.io,
    );
    expect(code).toBe(2);
    expect(capture.stderr.join("\n")).toContain("invalid --status");
  });

  test("local session step-runs lists merged timeline with import markers", async () => {
    const root = await makeTempDir();
    const sessionStoreRoot = path.join(root, "sessions");
    const artifactBase = path.join(root, "artifacts");
    await mkdir(artifactBase, { recursive: true });

    const source = {
      ...createSessionState({
        sessionId: "sess-steprun-src",
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
    await saveSession(source, { sessionStoreRoot });

    const continued = {
      ...createSessionState({
        sessionId: "sess-steprun-cont",
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "step-2",
        runtimeVariables: {},
      }),
      historyImports: [
        {
          sourceWorkflowExecutionId: "sess-steprun-src",
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
    await saveSession(continued, { sessionStoreRoot });

    const capture = createIoCapture();
    const code = await runCli(
      [
        "session",
        "step-runs",
        "sess-steprun-cont",
        "--session-store",
        sessionStoreRoot,
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
    const payload = JSON.parse(capture.stdout.join("\n")) as {
      workflowExecutionId: string;
      stepRuns: readonly { imported: boolean; stepRunId: string }[];
    };
    expect(payload.workflowExecutionId).toBe("sess-steprun-cont");
    expect(payload.stepRuns).toHaveLength(2);
    expect(payload.stepRuns[0]).toMatchObject({
      stepRunId: "ne-src-1",
      imported: true,
    });
    expect(payload.stepRuns[1]).toMatchObject({
      stepRunId: "ne-local-1",
      imported: false,
    });

    const filterCapture = createIoCapture();
    const filterCode = await runCli(
      [
        "session",
        "step-runs",
        "sess-steprun-cont",
        "--session-store",
        sessionStoreRoot,
        "--step",
        "step-2",
        "--status",
        "succeeded",
        "--output",
        "json",
      ],
      filterCapture.io,
      {
        startServe: async () => ({
          host: "127.0.0.1",
          port: 43173,
          stop: () => {},
        }),
        isInteractiveTerminal: () => true,
      },
    );
    expect(filterCode).toBe(0);
    const filtered = JSON.parse(filterCapture.stdout.join("\n")) as {
      stepRuns: readonly { stepId: string }[];
    };
    expect(filtered.stepRuns).toHaveLength(1);
    expect(filtered.stepRuns[0]?.stepId).toBe("step-2");
  });

  test("local call-step forwards normalized working directory and continuation overrides", async () => {
    const capture = createIoCapture();
    const session = createSessionState({
      sessionId: "sess-call-step-local",
      workflowName: "demo",
      workflowId: "demo",
      initialNodeId: "writer-step",
      runtimeVariables: {},
    });

    const callStepSpy = vi
      .spyOn(workflowCallStep, "callStep")
      .mockResolvedValue(
        ok({
          session,
          stepId: "writer-step",
          nodeExecution: {
            nodeId: "writer-step",
            nodeExecId: "exec-1",
            status: "succeeded",
          },
          output: { ok: true },
          outputRef: {
            type: "json",
            path: "artifacts/output.json",
          },
          exitCode: 0,
        } as unknown as workflowCallStep.CallStepSuccess),
      );

    const code = await runCli(
      [
        "call-step",
        "demo",
        "sess-call-step-local",
        "writer-step",
        "--working-dir",
        " apps/reviewer ",
        "--default-timeout-ms",
        "750",
        "--timeout-ms",
        "975",
        "--prompt-variant",
        "review",
        "--continue-session",
        "--resume-step-exec",
        "exec-previous",
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
    expect(callStepSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "demo",
        workflowRunId: "sess-call-step-local",
        stepId: "writer-step",
        workflowWorkingDirectory: "apps/reviewer",
        defaultTimeoutMs: 750,
        overrides: {
          timeoutMs: 975,
          promptVariant: "review",
          sessionMode: "reuse",
          resumeStepExecId: "exec-previous",
        },
        dryRun: true,
      }),
    );
  });

  test("call-step accepts --resume-step-exec for resume execution id", async () => {
    const capture = createIoCapture();
    const session = {
      sessionId: "sess-call-step-local",
      status: "running" as const,
      workflowId: "demo",
      workflowName: "demo",
      startedAt: "2024-01-01T00:00:00.000Z",
      queue: [],
      nodeExecutions: [],
      nodeExecutionCounter: 0,
      communications: [],
      communicationCounter: 0,
    };

    const callStepSpy = vi
      .spyOn(workflowCallStep, "callStep")
      .mockResolvedValue(
        ok({
          session,
          stepId: "writer-step",
          nodeExecution: {
            nodeId: "writer-step",
            nodeExecId: "exec-1",
            status: "succeeded",
          },
          output: { ok: true },
          outputRef: {
            type: "json",
            path: "artifacts/output.json",
          },
          exitCode: 0,
        } as unknown as workflowCallStep.CallStepSuccess),
      );

    const code = await runCli(
      [
        "call-step",
        "demo",
        "sess-call-step-local",
        "writer-step",
        "--resume-step-exec",
        "exec-previous",
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
    expect(callStepSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: { resumeStepExecId: "exec-previous" },
      }),
    );
  });

  test("call-step rejects removed --resume-node-exec", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "call-step",
        "demo",
        "sess-call-step-local",
        "writer-step",
        "--resume-node-exec",
        "exec-a",
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
    expect(capture.stderr.join("\n")).toContain(
      "--resume-node-exec has been removed; use --resume-step-exec",
    );
  });

  test("call-step rejects removed --resume-node-exec without treating its value as a positional argument", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "call-step",
        "demo",
        "sess-call-step-local",
        "writer-step",
        "--resume-node-exec",
        "exec-a",
        "--resume-step-exec",
        "exec-b",
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
    expect(capture.stderr.join("\n")).toContain(
      "--resume-node-exec has been removed; use --resume-step-exec",
    );
  });

  test("call-step rejects --resume-step-exec without a value", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "call-step",
        "demo",
        "sess-call-step-local",
        "writer-step",
        "--resume-step-exec",
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
    expect(capture.stderr.join("\n")).toContain(
      "--resume-step-exec requires an execution record id",
    );
  });

  test("call-step rejects --resume-step-exec when value is missing before another flag", async () => {
    const capture = createIoCapture();
    const code = await runCli(
      [
        "call-step",
        "demo",
        "sess-call-step-local",
        "writer-step",
        "--resume-step-exec",
        "--dry-run",
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
    expect(capture.stderr.join("\n")).toContain(
      "--resume-step-exec requires an execution record id",
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
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const capture = createIoCapture();
    const started: Array<{
      host?: string;
      port?: number;
      addonRoot?: string;
      workflowRoot?: string;
      fixedWorkflowName?: string;
      fixedResolvedWorkflowSource?: ResolvedWorkflowSource;
      readOnly?: boolean;
      noExec?: boolean;
    }> = [];

    const code = await runCli(
      [
        "serve",
        "demo",
        "--workflow-definition-dir",
        root,
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
    expect(started[0]?.workflowRoot).toBe(root);
    expect(started[0]?.fixedResolvedWorkflowSource?.scope).toBe("direct");
    expect(started[0]?.fixedResolvedWorkflowSource?.workflowName).toBe("demo");
    expect(started[0]?.readOnly).toBe(true);
    expect(started[0]?.noExec).toBe(true);
    const payload = JSON.parse(capture.stdout.join("\n")) as { port: number };
    expect(payload.port).toBe(7777);
  });

  test("serve reports the actual bound port returned by the server", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const capture = createIoCapture();

    const code = await runCli(
      [
        "serve",
        "demo",
        "--workflow-definition-dir",
        root,
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
        "--workflow-definition-dir",
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
    await withLegacyWorkflowAuthorshipForCli(async () => {
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
          "--workflow-definition-dir",
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
        "--workflow-definition-dir",
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
        "--workflow-definition-dir",
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
        "--workflow-definition-dir",
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
