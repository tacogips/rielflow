import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  inspectWorkflowRuntimeReadiness,
  WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID,
  type WorkflowRuntimeRequirement,
} from "./runtime-readiness";
import { loadWorkflowFromDisk } from "./load";
import type { NormalizedWorkflowBundle, NodePayload } from "./types";

type LegacyEdgeWorkflow = NormalizedWorkflowBundle["workflow"] & {
  readonly edges?: readonly { from: string; to: string; when: string }[];
};

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-runtime-ready-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writeExecutable(filePath: string, body: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${body}\n`, { mode: 0o755 });
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function makeBundle(
  nodePayloads: Readonly<Record<string, NodePayload>>,
  options: {
    readonly crossWorkflowTransition?: {
      readonly workflowId: string;
      readonly toStepId: string;
      readonly resumeStepId: string;
    };
  } = {},
): NormalizedWorkflowBundle {
  const nodeIds = Object.keys(nodePayloads);
  const managerStepId = nodeIds[0] ?? "node-1";

  if (options.crossWorkflowTransition !== undefined) {
    return {
      workflow: {
        workflowId: "runtime-ready",
        description: "runtime readiness fixture",
        defaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120_000,
        },
        hasManagerNode: false,
        entryStepId: managerStepId,
        nodeRegistry: nodeIds.map((id) => ({
          id,
          nodeFile: `nodes/node-${id}.json`,
        })),
        steps: nodeIds.map((id, index) => ({
          id,
          nodeId: id,
          role: "worker",
          ...(index === 0
            ? {
                transitions: [
                  {
                    toStepId: options.crossWorkflowTransition!.toStepId,
                    toWorkflowId: options.crossWorkflowTransition!.workflowId,
                    resumeStepId:
                      options.crossWorkflowTransition!.resumeStepId,
                  },
                ],
              }
            : {}),
        })),
        nodes: nodeIds.map((id) => ({
          id,
          role: "worker",
          nodeFile: `nodes/node-${id}.json`,
        })),
      },
      nodePayloads,
    };
  }

  return {
    workflow: {
      workflowId: "runtime-ready",
      description: "runtime readiness fixture",
      defaults: {
        maxLoopIterations: 3,
        nodeTimeoutMs: 120_000,
      },
      managerStepId,
      nodes: nodeIds.map((id, index) => ({
        id,
        kind: index === 0 ? "manager" : "task",
        nodeFile: `nodes/node-${id}.json`,
        completion: { type: "none" },
      })),
      edges: [],
    } as unknown as LegacyEdgeWorkflow,
    nodePayloads,
  };
}

function findRequirement(
  requirements: readonly WorkflowRuntimeRequirement[],
  id: string,
): WorkflowRuntimeRequirement {
  const requirement = requirements.find((entry) => entry.id === id);
  expect(requirement).toBeDefined();
  return requirement as WorkflowRuntimeRequirement;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("inspectWorkflowRuntimeReadiness", () => {
  test("marks codex-agent and claude-code-agent backends available when local tools are runnable", async () => {
    const root = await makeTempDir();
    const binDir = path.join(root, "bin");
    await mkdir(binDir, { recursive: true });
    await writeExecutable(
      path.join(binDir, "codex"),
      "#!/usr/bin/env bash\necho 'codex-cli 0.116.0'",
    );
    await writeExecutable(
      path.join(binDir, "git"),
      "#!/usr/bin/env bash\necho 'git version 2.53.0'",
    );
    await writeExecutable(
      path.join(root, "node_modules", ".bin", "claude-code-agent"),
      '#!/usr/bin/env bash\ncat <<\'EOF\'\n{"agent":"0.1.0","tools":{"claude":{"version":"2.1.86","error":null},"codex":{"version":"0.116.0","error":null},"git":{"version":"2.53.0","error":null}}}\nEOF',
    );

    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        manager: {
          id: "manager",
          executionBackend: "claude-code-agent",
          model: "claude-sonnet-4-5",
          promptTemplate: "manager",
          variables: {},
        },
        worker: {
          id: "worker",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "worker",
          variables: {},
        },
      }),
      {
        cwd: root,
        env: {
          PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
        },
      },
    );

    expect(readiness.ready).toBe(true);
    expect(
      findRequirement(
        readiness.requirements,
        "agent-backend:claude-code-agent",
      ),
    ).toMatchObject({
      kind: "agent-backend",
      status: "available",
      sourceNodeIds: ["manager"],
    });
    expect(
      findRequirement(readiness.requirements, "agent-backend:codex-agent"),
    ).toMatchObject({
      kind: "agent-backend",
      status: "available",
      sourceNodeIds: ["worker"],
    });
  });

  test("reports container runner problems and container executor availability", async () => {
    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        "container-worker": {
          id: "container-worker",
          nodeType: "container",
          variables: {},
          container: {
            runnerPath: "/definitely/missing/podman",
            build: {
              contextPath: "containers/worker",
            },
          },
        },
      }),
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        "container-runner:podman:/definitely/missing/podman",
      ),
    ).toMatchObject({
      kind: "container-runner",
      status: "unavailable",
      sourceNodeIds: ["container-worker"],
    });
    expect(
      findRequirement(readiness.requirements, "node-executor:container"),
    ).toMatchObject({
      kind: "node-executor",
      status: "available",
      sourceNodeIds: ["container-worker"],
    });
  });

  test("reports backend-less code managers as unsupported runtime features", async () => {
    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        manager: {
          id: "manager",
          managerType: "code",
          promptTemplate: "Coordinate the workflow",
          variables: {},
        },
      }),
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        "workflow-feature:code-manager-runtime",
      ),
    ).toMatchObject({
      kind: "workflow-feature",
      status: "unsupported",
      sourceNodeIds: ["manager"],
    });
  });

  test("reports backend-less code managers with resolved prompts as unsupported runtime features", async () => {
    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        manager: {
          id: "manager",
          managerType: "code",
          model: "deterministic-code-manager",
          promptTemplate: "Coordinate the workflow",
          variables: {},
        },
      }),
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        "workflow-feature:code-manager-runtime",
      ),
    ).toMatchObject({
      kind: "workflow-feature",
      status: "unsupported",
      sourceNodeIds: ["manager"],
    });
  });

  test("reports readiness source ids only for executable step-addressed nodes", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, "workflows");
    const workflowName = "step-readiness";
    const workflowDirectory = path.join(workflowRoot, workflowName);

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "step-addressed readiness source id fixture",
      defaults: {
        maxLoopIterations: 3,
        nodeTimeoutMs: 120_000,
      },
      managerStepId: "manager-step",
      entryStepId: "manager-step",
      nodes: [
        {
          id: "manager-node",
          nodeFile: "nodes/node-manager.json",
        },
        {
          id: "worker-node",
          nodeFile: "nodes/node-worker.json",
        },
      ],
      steps: [
        {
          id: "manager-step",
          nodeId: "manager-node",
          role: "manager",
          transitions: [{ toStepId: "worker-step" }],
        },
        {
          id: "worker-step",
          nodeId: "worker-node",
        },
      ],
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-manager.json"),
      {
        id: "manager-node",
        promptTemplate: "manager",
        variables: {},
      },
    );
    await writeJson(path.join(workflowDirectory, "nodes", "node-worker.json"), {
      id: "worker-node",
      executionBackend: "codex-agent",
      model: "gpt-5",
      promptTemplate: "worker",
      variables: {},
    });

    const loaded = await loadWorkflowFromDisk(workflowName, {
      workflowRoot,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const readiness = await inspectWorkflowRuntimeReadiness(
      loaded.value.bundle,
    );

    expect(
      findRequirement(readiness.requirements, "agent-backend:codex-agent"),
    ).toMatchObject({
      sourceNodeIds: ["worker-step"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        "workflow-feature:code-manager-runtime",
      ),
    ).toMatchObject({
      sourceNodeIds: ["manager-step"],
    });
  });

  test("reports x-gateway read add-on container runner requirements", async () => {
    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        "x-read": {
          id: "x-read",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "divedra/x-gateway-read",
            version: "1",
            config: {
              queryTemplate: "{ accountMe { id } }",
              runnerKind: "docker",
              runnerPath: "/definitely/missing/docker",
            },
          },
        },
      }),
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        "container-runner:docker:/definitely/missing/docker:docker-cli",
      ),
    ).toMatchObject({
      kind: "container-runner",
      status: "unavailable",
      sourceNodeIds: ["x-read"],
    });
  });

  test("reports required x-gateway read add-on env sources", async () => {
    const root = await makeTempDir();
    const runnerPath = path.join(root, "fake-docker");
    await writeExecutable(
      runnerPath,
      "#!/usr/bin/env bash\necho 'Docker version 27.0.0'",
    );

    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        "x-read": {
          id: "x-read",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "divedra/x-gateway-read",
            version: "1",
            env: {
              X_GW_TOKEN: {
                fromEnv: "ACCOUNT_A_X_GW_TOKEN",
              },
              X_GW_CONFIG_MODE: {
                fromEnv: "OPTIONAL_X_GW_CONFIG_MODE",
                required: false,
              },
            },
            config: {
              queryTemplate: "{ accountMe { id } }",
              runnerKind: "docker",
              runnerPath,
            },
          },
        },
      }),
      {
        env: {},
      },
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        "container-runner:docker:" + runnerPath + ":docker-cli",
      ),
    ).toMatchObject({
      kind: "container-runner",
      status: "available",
      sourceNodeIds: ["x-read"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        "environment-variable:addon:ACCOUNT_A_X_GW_TOKEN",
      ),
    ).toMatchObject({
      kind: "environment-variable",
      status: "unavailable",
      sourceNodeIds: ["x-read"],
    });
    expect(
      readiness.requirements.find(
        (requirement) =>
          requirement.id ===
          "environment-variable:addon:OPTIONAL_X_GW_CONFIG_MODE",
      ),
    ).toBeUndefined();
  });

  test("reports x-gateway add-on container runner and env requirements", async () => {
    const root = await makeTempDir();
    const runnerPath = path.join(root, "fake-docker");
    await writeExecutable(
      runnerPath,
      "#!/usr/bin/env bash\necho 'Docker version 27.0.0'",
    );

    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        "x-post": {
          id: "x-post",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "divedra/x-gateway",
            version: "1",
            env: {
              X_GW_ACCESS_TOKEN: {
                fromEnv: "ACCOUNT_A_X_GW_ACCESS_TOKEN",
              },
            },
            config: {
              documentTemplate:
                'mutation { createPost(text: "hello") { id text } }',
              runnerKind: "docker",
              runnerPath,
            },
          },
        },
      }),
      {
        env: {},
      },
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        "container-runner:docker:" + runnerPath + ":docker-cli",
      ),
    ).toMatchObject({
      kind: "container-runner",
      status: "available",
      sourceNodeIds: ["x-post"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        "environment-variable:addon:ACCOUNT_A_X_GW_ACCESS_TOKEN",
      ),
    ).toMatchObject({
      kind: "environment-variable",
      status: "unavailable",
      sourceNodeIds: ["x-post"],
    });
  });

  test("reports mail-gateway add-on container runner and env requirements", async () => {
    const root = await makeTempDir();
    const runnerPath = path.join(root, "fake-docker");
    await writeExecutable(
      runnerPath,
      "#!/usr/bin/env bash\necho 'Docker version 27.0.0'",
    );

    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        "mail-send": {
          id: "mail-send",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "divedra/mail-gateway",
            version: "1",
            env: {
              MAIL_GATEWAY_CONFIG: {
                fromEnv: "ACCOUNT_A_MAIL_GATEWAY_CONFIG",
              },
            },
            config: {
              documentTemplate:
                'mutation { sendMessage(input: { accountId: "work", to: ["person@example.test"], subject: "hello", textBody: "body" }) { message { id } } }',
              runnerKind: "docker",
              runnerPath,
            },
          },
        },
      }),
      {
        env: {},
      },
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        "container-runner:docker:" + runnerPath + ":docker-cli",
      ),
    ).toMatchObject({
      kind: "container-runner",
      status: "available",
      sourceNodeIds: ["mail-send"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        "environment-variable:addon:ACCOUNT_A_MAIL_GATEWAY_CONFIG",
      ),
    ).toMatchObject({
      kind: "environment-variable",
      status: "unavailable",
      sourceNodeIds: ["mail-send"],
    });
  });

  test("reports empty required x-gateway read add-on env sources as unavailable", async () => {
    const root = await makeTempDir();
    const runnerPath = path.join(root, "fake-docker");
    await writeExecutable(
      runnerPath,
      "#!/usr/bin/env bash\necho 'Docker version 27.0.0'",
    );

    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        "x-read": {
          id: "x-read",
          nodeType: "addon",
          variables: {},
          addon: {
            name: "divedra/x-gateway-read",
            version: "1",
            env: {
              X_GW_TOKEN: {
                fromEnv: "EMPTY_X_GW_TOKEN",
              },
            },
            config: {
              queryTemplate: "{ accountMe { id } }",
              runnerKind: "docker",
              runnerPath,
            },
          },
        },
      }),
      {
        env: {
          EMPTY_X_GW_TOKEN: "",
        },
      },
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        "environment-variable:addon:EMPTY_X_GW_TOKEN",
      ),
    ).toMatchObject({
      kind: "environment-variable",
      status: "unavailable",
      sourceNodeIds: ["x-read"],
    });
  });

  test("reports unsupported x-gateway read add-on inherited runner defaults", async () => {
    const bundle = makeBundle({
      "x-read": {
        id: "x-read",
        nodeType: "addon",
        variables: {},
        addon: {
          name: "divedra/x-gateway-read",
          version: "1",
          config: {
            queryTemplate: "{ accountMe { id } }",
          },
        },
      },
    });
    const readiness = await inspectWorkflowRuntimeReadiness({
      ...bundle,
      workflow: {
        ...bundle.workflow,
        defaults: {
          ...bundle.workflow.defaults,
          containerRuntime: {
            runnerKind: "apple-container",
          },
        },
      },
    });

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        "container-runner:apple-container:default:docker-cli",
      ),
    ).toMatchObject({
      kind: "container-runner",
      status: "unsupported",
      sourceNodeIds: ["x-read"],
    });
  });

  test("reports cross-workflow dispatch as available when target workflows resolve", async () => {
    const root = await makeTempDir();
    const workflowDir = path.join(root, "review-flow-bundle");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "workflow.json"),
      `${JSON.stringify(
        {
          workflowId: "review-flow",
          description: "review workflow",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120_000,
          },
          nodes: [
            {
              id: "reviewer",
              role: "worker",
              nodeFile: "nodes/node-reviewer.json",
              completion: { type: "none" },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(path.join(workflowDir, "nodes"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "nodes", "node-reviewer.json"),
      `${JSON.stringify(
        {
          id: "reviewer",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "review",
          variables: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle(
        {
          writer: {
            id: "writer",
            nodeType: "command",
            variables: {},
            command: {
              scriptPath: "scripts/write.sh",
            },
          },
        },
        {
          crossWorkflowTransition: {
            workflowId: "review-flow",
            toStepId: "reviewer",
            resumeStepId: "writer",
          },
        },
      ),
      {
        workflowRoot: root,
      },
    );

    expect(readiness.ready).toBe(true);
    expect(
      findRequirement(
        readiness.requirements,
        WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID,
      ),
    ).toMatchObject({
      kind: "workflow-feature",
      status: "available",
      sourceNodeIds: ["writer"],
    });
  });

  test("reports cross-workflow dispatch as unavailable when a resolved target is invalid", async () => {
    const root = await makeTempDir();
    const workflowDir = path.join(root, "review-flow-bundle");
    await mkdir(path.join(workflowDir, "nodes"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "workflow.json"),
      `${JSON.stringify(
        {
          workflowId: "review-flow",
          description: "invalid review workflow",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120_000,
          },
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
      path.join(workflowDir, "nodes", "node-reviewer.json"),
      `${JSON.stringify(
        {
          id: "reviewer",
          executionBackend: "codex-agent",
          model: "gpt-5",
          variables: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle(
        {
          writer: {
            id: "writer",
            nodeType: "command",
            variables: {},
            command: {
              scriptPath: "scripts/write.sh",
            },
          },
        },
        {
          crossWorkflowTransition: {
            workflowId: "review-flow",
            toStepId: "reviewer",
            resumeStepId: "writer",
          },
        },
      ),
      {
        workflowRoot: root,
      },
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID,
      ),
    ).toMatchObject({
      kind: "workflow-feature",
      status: "unavailable",
      sourceNodeIds: ["writer"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID,
      )
        .detail,
    ).toContain("workflow validation failed");
  });

  test("reports cross-workflow dispatch as unavailable when targets are missing", async () => {
    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle(
        {
          writer: {
            id: "writer",
            nodeType: "command",
            variables: {},
            command: {
              scriptPath: "scripts/write.sh",
            },
          },
        },
        {
          crossWorkflowTransition: {
            workflowId: "review-flow",
            toStepId: "reviewer",
            resumeStepId: "writer",
          },
        },
      ),
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID,
      ),
    ).toMatchObject({
      kind: "workflow-feature",
      status: "unavailable",
      sourceNodeIds: ["writer"],
    });
  });

  test("reports cross-workflow dispatch as unavailable when the target graph is recursive", async () => {
    const root = await makeTempDir();
    const callerDir = path.join(root, "runtime-ready-bundle");
    await mkdir(path.join(callerDir, "nodes"), { recursive: true });
    await writeFile(
      path.join(callerDir, "workflow.json"),
      `${JSON.stringify(
        {
          workflowId: "runtime-ready",
          description: "runtime-ready caller",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120_000,
          },
          managerStepId: "manager",
          entryStepId: "manager",
          nodes: [
            {
              id: "manager",
              nodeFile: "nodes/node-manager.json",
            },
          ],
          steps: [
            {
              id: "manager",
              nodeId: "manager",
              role: "manager",
              transitions: [
                {
                  toStepId: "reviewer",
                  toWorkflowId: "review-flow",
                  resumeStepId: "manager",
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
      path.join(callerDir, "nodes", "node-manager.json"),
      `${JSON.stringify(
        {
          id: "manager",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "manager",
          variables: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const calleeDir = path.join(root, "review-flow-bundle");
    await mkdir(path.join(calleeDir, "nodes"), { recursive: true });
    await writeFile(
      path.join(calleeDir, "workflow.json"),
      `${JSON.stringify(
        {
          workflowId: "review-flow",
          description: "recursive review workflow",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120_000,
          },
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
              transitions: [
                {
                  toStepId: "manager",
                  toWorkflowId: "runtime-ready",
                  resumeStepId: "reviewer",
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
      path.join(calleeDir, "nodes", "node-reviewer.json"),
      `${JSON.stringify(
        {
          id: "reviewer",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "review",
          variables: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const loaded = await loadWorkflowFromDisk("runtime-ready-bundle", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const readiness = await inspectWorkflowRuntimeReadiness(
      loaded.value.bundle,
      {
        workflowRoot: root,
      },
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID,
      ),
    ).toMatchObject({
      kind: "workflow-feature",
      status: "unavailable",
      sourceNodeIds: ["manager"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID,
      )
        .detail,
    ).toContain(
      "recursive cross-workflow dispatch chains are unsupported: runtime-ready -> review-flow -> runtime-ready",
    );
  });
});