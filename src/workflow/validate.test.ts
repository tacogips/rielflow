import { makeStepAddressedAuthoredWorkflowFieldIssue } from "./authored-workflow";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  type RejectedAuthoredStepAddressedTopLevelField,
} from "./authored-workflow";
import { crossWorkflowDispatchesFromSteps } from "./cross-workflow-from-steps";
import {
  validateWorkflowBundle,
  validateWorkflowBundleAsync,
  validateWorkflowBundleDetailed,
} from "./validate";
import {
  getStructuralEdges,
  getStructuralLoops,
  DEFAULT_NODE_TIMEOUT_MS,
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

function sampleRemovedTopLevelFieldValue(
  fieldName: RejectedAuthoredStepAddressedTopLevelField,
): unknown {
  switch (fieldName) {
    case "managerRuntimeId":
    case "managerNodeId":
    case "entryNodeId":
      return "manager";
    case "subWorkflows":
    case "workflowCalls":
    case "subWorkflowConversations":
      return [];
    case "edges":
      return [{ from: "manager", to: "worker", when: "always" }];
    case "loops":
      return [
        {
          id: "loop-manager",
          judgeNodeId: "manager",
          continueWhen: "again",
          exitWhen: "done",
        },
      ];
    case "branching":
      return {};
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

describe("workflow defaults", () => {
  test("defaults omitted nodeTimeoutMs to the shared 60 minute timeout", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = { maxLoopIterations: 3 };

    const result = validateWorkflowBundle(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected workflow validation to succeed");
    }
    expect(result.value.workflow.defaults.nodeTimeoutMs).toBe(
      DEFAULT_NODE_TIMEOUT_MS,
    );
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

  test("accepts workflow and step stall supervision defaults", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
      supervision: {
        monitorIntervalMs: 15000,
        stallTimeoutMs: 900000,
        maxWorkflowPatches: 0,
      },
    };
    const steps = raw.workflow["steps"] as Array<Record<string, unknown>>;
    const workerStep = steps[1] ?? {};
    steps[1] = {
      ...workerStep,
      stallTimeoutMs: 1200000,
    };
    const workerPayload = raw.nodePayloads["nodes/node-worker.json"] as Record<
      string,
      unknown
    >;
    raw.nodePayloads["nodes/node-worker.json"] = {
      ...workerPayload,
      stallTimeoutMs: 600000,
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.defaults.supervision).toEqual({
      monitorIntervalMs: 15000,
      stallTimeoutMs: 900000,
      maxWorkflowPatches: 0,
    });
    expect(result.value.workflow.steps[1]?.stallTimeoutMs).toBe(1200000);
    expect(result.value.nodePayloads["worker"]?.stallTimeoutMs).toBe(1200000);
    expect(
      result.value.nodePayloads["nodes/node-worker.json"]?.stallTimeoutMs,
    ).toBe(600000);
  });

  test("rejects invalid workflow supervision stall defaults", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
      supervision: {
        monitorIntervalMs: 5000,
        stallTimeoutMs: 4999,
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContainEqual(
      expect.objectContaining({
        path: "workflow.defaults.supervision.stallTimeoutMs",
      }),
    );
  });

  test.each(
    REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  )("rejects top-level workflow.%s on step-addressed bundles", (fieldName) => {
    const raw = makeStepAddressedRaw();
    raw.workflow[fieldName] = sampleRemovedTopLevelFieldValue(fieldName);

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContainEqual(
      makeStepAddressedAuthoredWorkflowFieldIssue(fieldName),
    );
  });

  test("rejects unsupported node registry fields on step-addressed bundles", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["nodes"] = [
      {
        id: "manager",
        nodeFile: "nodes/node-manager.json",
        role: "manager",
      },
      { id: "worker", nodeFile: "nodes/node-worker.json" },
      { id: "after-child", nodeFile: "nodes/node-after-child.json" },
    ];

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContainEqual({
      severity: "error",
      path: "workflow.nodes[0].role",
      message: "uses an unsupported step-addressed node registry field",
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

    expect(
      crossWorkflowDispatchesFromSteps(result.value.workflow.steps),
    ).toEqual([
      {
        id: "__cw:manager",
        workflowId: "child-flow",
        callerStepId: "manager",
        resumeStepId: "after-child",
        when: "handoff",
      },
    ]);
    expect("workflowCalls" in result.value.workflow).toBe(false);
  });

  test("accepts cross-workflow fanout transition and normalizes defaults", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
      fanoutConcurrency: 20,
    };
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
            fanout: {
              groupId: "features",
              itemsFrom: "/payload/features",
              itemVariable: "feature",
              concurrency: 5,
              joinStepId: "after-child",
              failurePolicy: "fail-fast",
              resultOrder: "input",
              writeOwnership: { mode: "read-only" },
            },
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
    expect(result.value.workflow.defaults.fanoutConcurrency).toBe(20);
    expect(
      crossWorkflowDispatchesFromSteps(result.value.workflow.steps),
    ).toEqual([
      {
        id: "__cw:manager",
        workflowId: "child-flow",
        callerStepId: "manager",
        resumeStepId: "after-child",
        fanout: {
          groupId: "features",
          itemsFrom: "/payload/features",
          itemVariable: "feature",
          concurrency: 5,
          joinStepId: "after-child",
          failurePolicy: "fail-fast",
          resultOrder: "input",
          writeOwnership: { mode: "read-only" },
        },
      },
    ]);
  });

  test("rejects invalid fanout authoring", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
      fanoutConcurrency: 2,
    };
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
            fanout: {
              groupId: "features",
              itemsFrom: "payload/features",
              itemVariable: "1bad",
              concurrency: 3,
              joinStepId: "missing-join",
              failurePolicy: "partial",
              resultOrder: "completion",
              writeOwnership: { mode: "shared" },
            },
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

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "workflow.steps[0].transitions[0].fanout.itemsFrom",
        "workflow.steps[0].transitions[0].fanout.itemVariable",
        "workflow.steps[0].transitions[0].fanout.concurrency",
        "workflow.steps[0].transitions[0].fanout.joinStepId",
        "workflow.steps[0].transitions[0].fanout.failurePolicy",
        "workflow.steps[0].transitions[0].fanout.resultOrder",
        "workflow.steps[0].transitions[0].fanout.writeOwnership.mode",
      ]),
    );
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
