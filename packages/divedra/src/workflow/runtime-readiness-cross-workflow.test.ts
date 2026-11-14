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

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-runtime-ready-test-"),
  );
  tempDirs.push(directory);
  return directory;
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
          entryStepId: "reviewer",
          nodes: [
            {
              id: "reviewer",
              nodeFile: "nodes/node-reviewer.json",
            },
          ],
          steps: [{ id: "reviewer", nodeId: "reviewer" }],
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
      sourceStepIds: ["writer"],
    });
  });

  test("attributes cross-workflow dispatch readiness to the caller step id when it differs from the node registry id", async () => {
    const root = await makeTempDir();
    const workflowDir = path.join(root, "review-flow-bundle");
    await mkdir(path.join(workflowDir, "nodes"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "workflow.json"),
      `${JSON.stringify(
        {
          workflowId: "review-flow",
          description: "valid review workflow",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120_000,
          },
          entryStepId: "reviewer",
          nodes: [
            {
              id: "reviewer-node",
              nodeFile: "nodes/node-reviewer.json",
            },
          ],
          steps: [
            {
              id: "reviewer",
              nodeId: "reviewer-node",
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
          id: "reviewer-node",
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
      {
        workflow: {
          workflowId: "runtime-ready",
          description: "runtime readiness fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120_000,
          },
          hasManagerNode: false,
          entryStepId: "writer-step",
          nodeRegistry: [
            {
              id: "writer-node",
              nodeFile: "nodes/node-writer.json",
            },
          ],
          steps: [
            {
              id: "writer-step",
              nodeId: "writer-node",
              role: "worker",
              transitions: [
                {
                  toStepId: "reviewer",
                  toWorkflowId: "review-flow",
                  resumeStepId: "writer-step",
                },
              ],
            },
          ],
          nodes: [
            {
              id: "writer-step",
              role: "worker",
              nodeFile: "nodes/node-writer.json",
            },
          ],
        },
        nodePayloads: {
          "writer-node": {
            id: "writer-node",
            nodeType: "command",
            variables: {},
            command: {
              scriptPath: "scripts/write.sh",
            },
          },
        },
      },
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
      sourceStepIds: ["writer-step"],
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
      sourceStepIds: ["writer"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID,
      ).detail,
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
      sourceStepIds: ["writer"],
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
      sourceStepIds: ["manager"],
    });
    expect(
      findRequirement(
        readiness.requirements,
        WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID,
      ).detail,
    ).toContain(
      "recursive cross-workflow dispatch chains are unsupported: runtime-ready -> review-flow -> runtime-ready",
    );
  });
});
