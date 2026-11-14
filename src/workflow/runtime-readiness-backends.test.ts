import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  inspectWorkflowRuntimeReadiness,
  type WorkflowRuntimeRequirement,
} from "./runtime-readiness";
import { loadWorkflowFromDisk } from "./load";
import type { NormalizedWorkflowBundle, NodePayload } from "./types";

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
    const transition = options.crossWorkflowTransition;
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
                    toStepId: transition.toStepId,
                    toWorkflowId: transition.workflowId,
                    resumeStepId: transition.resumeStepId,
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
      entryStepId: managerStepId,
      nodeRegistry: nodeIds.map((id) => ({
        id,
        nodeFile: `nodes/node-${id}.json`,
      })),
      steps: nodeIds.map((id, index) => {
        const nextId = nodeIds[index + 1];
        return {
          id,
          nodeId: id,
          role: index === 0 ? "manager" : "worker",
          ...(nextId !== undefined
            ? { transitions: [{ toStepId: nextId, label: "always" }] }
            : {}),
        };
      }),
      nodes: nodeIds.map((id, index) => ({
        id,
        role: index === 0 ? "manager" : "worker",
        nodeFile: `nodes/node-${id}.json`,
        completion: { type: "none" },
      })),
    },
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
  test("marks cursor-cli-agent backend available when cursor-cli-agent wrapper reports cursor-agent available", async () => {
    const root = await makeTempDir();
    const cursorCliAgentBin = path.join(
      root,
      "node_modules",
      ".bin",
      "cursor-cli-agent",
    );
    await writeExecutable(
      cursorCliAgentBin,
      '#!/usr/bin/env bash\ncat <<\'EOF\'\n{"agent":"1.0.0","tools":{"cursor-agent":{"version":"0.45.0","error":null}}}\nEOF',
    );

    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        worker: {
          id: "worker",
          executionBackend: "cursor-cli-agent",
          model: "claude-sonnet-4-5",
          promptTemplate: "worker",
          variables: {},
        },
      }),
      { cwd: root },
    );

    const requirement = findRequirement(
      readiness.requirements,
      "agent-backend:cursor-cli-agent",
    );
    expect(requirement).toMatchObject({
      kind: "agent-backend",
      status: "available",
      sourceStepIds: expect.arrayContaining(["worker"]),
    });
    expect(requirement.detail).toContain("cursor-agent");
    expect(requirement.detail).toContain("0.45.0");
  });

  test("marks cursor-cli-agent backend unavailable when cursor-agent tool reports error", async () => {
    const root = await makeTempDir();
    const cursorCliAgentBin = path.join(
      root,
      "node_modules",
      ".bin",
      "cursor-cli-agent",
    );
    await writeExecutable(
      cursorCliAgentBin,
      '#!/usr/bin/env bash\ncat <<\'EOF\'\n{"agent":"1.0.0","tools":{"cursor-agent":{"version":null,"error":"cursor binary not found"}}}\nEOF',
    );

    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        worker: {
          id: "worker",
          executionBackend: "cursor-cli-agent",
          model: "claude-sonnet-4-5",
          promptTemplate: "worker",
          variables: {},
        },
      }),
      { cwd: root },
    );

    const requirement = findRequirement(
      readiness.requirements,
      "agent-backend:cursor-cli-agent",
    );
    expect(requirement).toMatchObject({
      kind: "agent-backend",
      status: "unavailable",
    });
    expect(requirement.detail).toContain("cursor-agent");
  });

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
      sourceStepIds: ["manager"],
    });
    expect(
      findRequirement(readiness.requirements, "agent-backend:codex-agent"),
    ).toMatchObject({
      kind: "agent-backend",
      status: "available",
      sourceStepIds: ["worker"],
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
      sourceStepIds: ["container-worker"],
    });
    expect(
      findRequirement(readiness.requirements, "node-executor:container"),
    ).toMatchObject({
      kind: "node-executor",
      status: "available",
      sourceStepIds: ["container-worker"],
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
      sourceStepIds: ["manager"],
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
      sourceStepIds: ["manager"],
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
      sourceStepIds: ["worker-step"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        "workflow-feature:code-manager-runtime",
      ),
    ).toMatchObject({
      sourceStepIds: ["manager-step"],
    });
  });

  test("filters readiness requirements by authored step id when reusable node payloads back multiple steps", async () => {
    const sharedBundle: NormalizedWorkflowBundle = {
      workflow: {
        workflowId: "shared-runtime-ready",
        description: "shared node payload readiness fixture",
        defaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120_000,
        },
        managerStepId: "draft-step",
        entryStepId: "draft-step",
        nodeRegistry: [
          {
            id: "shared-node",
            nodeFile: "nodes/node-shared.json",
          },
        ],
        steps: [
          {
            id: "draft-step",
            nodeId: "shared-node",
            role: "manager",
            transitions: [{ toStepId: "review-step" }],
          },
          {
            id: "review-step",
            nodeId: "shared-node",
            role: "worker",
          },
        ],
        nodes: [
          {
            id: "draft-step",
            role: "manager",
            nodeFile: "nodes/node-shared.json",
          },
          {
            id: "review-step",
            role: "worker",
            nodeFile: "nodes/node-shared.json",
          },
        ],
      },
      nodePayloads: {
        "shared-node": {
          id: "shared-node",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "shared worker",
          variables: {},
        },
        "nodes/node-shared.json": {
          id: "shared-node",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "shared worker",
          variables: {},
        },
        "draft-step": {
          id: "shared-node",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "shared worker",
          variables: {},
        },
        "review-step": {
          id: "shared-node",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "shared worker",
          variables: {},
        },
      },
    };

    const fullReadiness = await inspectWorkflowRuntimeReadiness(sharedBundle);
    expect(
      findRequirement(fullReadiness.requirements, "agent-backend:codex-agent"),
    ).toMatchObject({
      sourceStepIds: ["draft-step", "review-step"],
    });

    const filteredReadiness = await inspectWorkflowRuntimeReadiness(
      sharedBundle,
      {
        onlyStepIds: new Set(["review-step"]),
      },
    );
    expect(
      findRequirement(
        filteredReadiness.requirements,
        "agent-backend:codex-agent",
      ),
    ).toMatchObject({
      sourceStepIds: ["review-step"],
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
      sourceStepIds: ["x-read"],
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
      sourceStepIds: ["x-read"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        "environment-variable:addon:ACCOUNT_A_X_GW_TOKEN",
      ),
    ).toMatchObject({
      kind: "environment-variable",
      status: "unavailable",
      sourceStepIds: ["x-read"],
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
      sourceStepIds: ["x-post"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        "environment-variable:addon:ACCOUNT_A_X_GW_ACCESS_TOKEN",
      ),
    ).toMatchObject({
      kind: "environment-variable",
      status: "unavailable",
      sourceStepIds: ["x-post"],
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
      sourceStepIds: ["mail-send"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        "environment-variable:addon:ACCOUNT_A_MAIL_GATEWAY_CONFIG",
      ),
    ).toMatchObject({
      kind: "environment-variable",
      status: "unavailable",
      sourceStepIds: ["mail-send"],
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
      sourceStepIds: ["x-read"],
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
      sourceStepIds: ["x-read"],
    });
  });
});
