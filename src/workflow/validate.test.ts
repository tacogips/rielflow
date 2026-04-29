import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { crossWorkflowDispatchesFromSteps } from "./cross-workflow-from-steps";
import {
  REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE,
  REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
  validateWorkflowBundle,
  validateWorkflowBundleAsync,
  validateWorkflowBundleDetailed,
} from "./validate";
import {
  getStructuralEdges,
  getStructuralLoops,
  resolveWorkflowEntryRuntimeId,
  resolveWorkflowManagerStepId,
  type WorkflowJson,
} from "./types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "divedra-validate-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function makeStepAddressedRaw(): {
  workflow: Record<string, unknown>;
  nodePayloads: Record<string, unknown>;
} {
  return {
    workflow: {
      workflowId: "demo",
      description: "demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerStepId: "manager",
      entryStepId: "manager",
      nodes: [
        { id: "manager", nodeFile: "nodes/node-manager.json" },
        { id: "worker", nodeFile: "nodes/node-worker.json" },
        { id: "after-child", nodeFile: "nodes/node-after-child.json" },
      ],
      steps: [
        {
          id: "manager",
          nodeId: "manager",
          role: "manager",
          transitions: [{ toStepId: "worker", label: "always" }],
        },
        {
          id: "worker",
          nodeId: "worker",
          role: "worker",
        },
        {
          id: "after-child",
          nodeId: "after-child",
          role: "worker",
        },
      ],
    },
    nodePayloads: {
      "nodes/node-manager.json": {
        id: "manager",
        promptTemplate: "manager",
        variables: {},
      },
      "nodes/node-worker.json": {
        id: "worker",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "worker",
        variables: {},
      },
      "nodes/node-after-child.json": {
        id: "after-child",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "after-child",
        variables: {},
      },
    },
  };
}

function writeWorkflowBundle(input: {
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly workflow: Record<string, unknown>;
  readonly nodePayloads: Record<string, unknown>;
}): void {
  const workflowDirectory = path.join(input.workflowRoot, input.workflowName);
  writeJson(path.join(workflowDirectory, "workflow.json"), input.workflow);
  for (const [fileName, payload] of Object.entries(input.nodePayloads)) {
    writeJson(path.join(workflowDirectory, fileName), payload);
  }
}

describe("workflow runtime identity helpers", () => {
  test("resolveWorkflowEntryRuntimeId uses entryStepId", () => {
    expect(
      resolveWorkflowEntryRuntimeId({
        workflowId: "demo",
        description: "demo",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "entry-step",
        nodeRegistry: [],
        steps: [],
        nodes: [],
      } as WorkflowJson),
    ).toBe("entry-step");
  });

  test("resolveWorkflowManagerStepId uses managerStepId and falls back to entryStepId", () => {
    expect(
      resolveWorkflowManagerStepId({
        workflowId: "demo",
        description: "demo",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        managerStepId: "manager-step",
        entryStepId: "entry-step",
        nodeRegistry: [],
        steps: [],
        nodes: [],
      } as WorkflowJson),
    ).toBe("manager-step");

    expect(
      resolveWorkflowManagerStepId({
        workflowId: "demo",
        description: "demo",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "entry-step",
        nodeRegistry: [],
        steps: [],
        nodes: [],
      } as WorkflowJson),
    ).toBe("entry-step");
  });
});

describe("structural helpers", () => {
  test("getStructuralEdges derives only local step transitions", () => {
    expect(
      getStructuralEdges({
        steps: [
          {
            id: "manager",
            nodeId: "manager",
            transitions: [
              { toStepId: "worker", label: "always" },
              {
                toStepId: "child-entry",
                toWorkflowId: "child-flow",
                resumeStepId: "after-child",
                label: "handoff",
              },
            ],
          },
          {
            id: "worker",
            nodeId: "worker",
            transitions: [{ toStepId: "after-child", label: "done" }],
          },
          {
            id: "after-child",
            nodeId: "after-child",
          },
        ],
      } as Pick<WorkflowJson, "steps">),
    ).toEqual([
      { from: "manager", to: "worker", when: "always" },
      { from: "worker", to: "after-child", when: "done" },
    ]);
  });

  test("getStructuralLoops derives repeat loops from runtime nodes", () => {
    expect(
      getStructuralLoops({
        nodes: [
          { id: "manager", nodeFile: "nodes/node-manager.json" },
          { id: "implement", nodeFile: "nodes/node-implement.json" },
          {
            id: "review",
            nodeFile: "nodes/node-review.json",
            repeat: {
              while: "continue_round",
              restartAt: "implement",
              maxIterations: 2,
            },
          },
        ],
      } as unknown as Pick<WorkflowJson, "nodes">),
    ).toEqual([
      {
        id: "repeat-review",
        judgeNodeId: "review",
        continueWhen: "continue_round",
        exitWhen: "!(continue_round)",
        maxIterations: 2,
      },
    ]);
  });
});

describe("validateWorkflowBundle", () => {
  test("accepts a canonical step-addressed workflow bundle", () => {
    const result = validateWorkflowBundle(makeStepAddressedRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.entryStepId).toBe("manager");
    expect(result.value.workflow.managerStepId).toBe("manager");
    expect(result.value.workflow.steps.map((step) => step.id)).toEqual([
      "manager",
      "worker",
      "after-child",
    ]);
    expect("workflowCalls" in result.value.workflow).toBe(false);
  });

  test("rejects top-level entryNodeId on step-addressed bundles", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["entryNodeId"] = "manager";

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContainEqual({
      severity: "error",
      path: "workflow.entryNodeId",
      message: REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
    });
  });

  test("rejects top-level workflow.edges on step-addressed bundles", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["edges"] = [{ from: "manager", to: "worker", when: "always" }];

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContainEqual({
      severity: "error",
      path: "workflow.edges",
      message: REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE,
    });
  });

  test("rejects top-level workflowCalls on step-addressed bundles", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["workflowCalls"] = [];

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContainEqual({
      severity: "error",
      path: "workflow.workflowCalls",
      message: REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
    });
  });

  test("keeps cross-workflow transitions on steps and derives runtime dispatch rows", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["steps"] = [
      {
        id: "manager",
        nodeId: "manager",
        role: "manager",
        transitions: [
          {
            toStepId: "child-entry",
            toWorkflowId: "child-flow",
            resumeStepId: "after-child",
            label: "handoff",
          },
        ],
      },
      {
        id: "after-child",
        nodeId: "after-child",
        role: "worker",
      },
    ];

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(crossWorkflowDispatchesFromSteps(result.value.workflow.steps)).toEqual(
      [
        {
          id: "__cw:manager",
          workflowId: "child-flow",
          callerNodeId: "manager",
          callerStepId: "manager",
          resultNodeId: "after-child",
          when: "handoff",
        },
      ],
    );
    expect("workflowCalls" in result.value.workflow).toBe(false);
  });

  test("sync and async validation align cross-workflow callee entry to the callee manager step", async () => {
    const workflowRoot = makeTempDir();
    const caller = makeStepAddressedRaw();
    caller.workflow["steps"] = [
      {
        id: "manager",
        nodeId: "manager",
        role: "manager",
        transitions: [
          {
            toStepId: "child-manager",
            toWorkflowId: "child-flow",
            resumeStepId: "after-child",
          },
        ],
      },
      {
        id: "after-child",
        nodeId: "after-child",
        role: "worker",
      },
    ];

    writeWorkflowBundle({
      workflowRoot,
      workflowName: "child-directory",
      workflow: {
        workflowId: "child-flow",
        description: "child",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        managerStepId: "child-manager",
        entryStepId: "child-manager",
        nodes: [
          { id: "child-manager", nodeFile: "nodes/node-child-manager.json" },
        ],
        steps: [
          { id: "child-manager", nodeId: "child-manager", role: "manager" },
        ],
      },
      nodePayloads: {
        "nodes/node-child-manager.json": {
          id: "child-manager",
          promptTemplate: "child manager",
          variables: {},
        },
      },
    });

    const syncResult = validateWorkflowBundleDetailed(caller, { workflowRoot });
    expect(syncResult.ok).toBe(true);

    const asyncResult = await validateWorkflowBundleAsync(caller, {
      workflowRoot,
    });
    expect(asyncResult.ok).toBe(true);
  });
});
