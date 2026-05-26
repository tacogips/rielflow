import { expect, test } from "vitest";
import {
  REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS,
  REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS,
} from "./authored-workflow";
import {
  getNormalizedNodePayload,
  type AuthoredWorkflowJson,
  type NormalizedWorkflowBundle,
} from "./types";

function createStrictAuthoredWorkflow(): AuthoredWorkflowJson {
  return {
    workflowId: "demo",
    defaults: {
      maxLoopIterations: 3,
      nodeTimeoutMs: 1_000,
    },
    entryStepId: "main-worker",
    nodes: [{ id: "main-worker", nodeFile: "nodes/node-main-worker.json" }],
    steps: [{ id: "main-worker", nodeId: "main-worker" }],
  };
}

test("AuthoredWorkflowJson accepts the supported step-addressed authored surface", () => {
  const workflow = createStrictAuthoredWorkflow();

  expect(workflow.workflowId).toBe("demo");
  expect(workflow.entryStepId).toBe("main-worker");
});

test("REJECTED_AUTHORED step-addressed list is removed-field rejects plus step-only extras", () => {
  expect([
    ...REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  ]).toEqual([
    ...REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS,
    ...REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS,
  ]);
});

test("AuthoredWorkflowJson excludes disallowed top-level authored keys", () => {
  void ({
    ...createStrictAuthoredWorkflow(),
    // @ts-expect-error managerRuntimeId is not part of the authored schema.
    managerRuntimeId: "main-worker",
  } satisfies AuthoredWorkflowJson);

  void ({
    ...createStrictAuthoredWorkflow(),
    // @ts-expect-error managerNodeId is not part of the authored schema.
    managerNodeId: "main-worker",
  } satisfies AuthoredWorkflowJson);

  void ({
    ...createStrictAuthoredWorkflow(),
    // @ts-expect-error entryNodeId is not part of the authored schema (use entryStepId).
    entryNodeId: "main-worker",
  } satisfies AuthoredWorkflowJson);

  void ({
    ...createStrictAuthoredWorkflow(),
    // @ts-expect-error workflowCalls is not part of the authored schema.
    workflowCalls: [],
  } satisfies AuthoredWorkflowJson);

  void ({
    ...createStrictAuthoredWorkflow(),
    // @ts-expect-error subWorkflows is not part of the authored schema.
    subWorkflows: [],
  } satisfies AuthoredWorkflowJson);

  void ({
    ...createStrictAuthoredWorkflow(),
    // @ts-expect-error subWorkflowConversations is not part of the authored schema.
    subWorkflowConversations: [],
  } satisfies AuthoredWorkflowJson);

  void ({
    ...createStrictAuthoredWorkflow(),
    // @ts-expect-error edges is not part of the authored schema.
    edges: [],
  } satisfies AuthoredWorkflowJson);

  void ({
    ...createStrictAuthoredWorkflow(),
    // @ts-expect-error loops is not part of the authored schema.
    loops: [],
  } satisfies AuthoredWorkflowJson);

  void ({
    ...createStrictAuthoredWorkflow(),
    // @ts-expect-error branching is not part of the authored schema.
    branching: {},
  } satisfies AuthoredWorkflowJson);
});

test("AuthoredWorkflowJson excludes unsupported authored node registry fields", () => {
  void ({
    ...createStrictAuthoredWorkflow(),
    nodes: [
      {
        id: "main-worker",
        nodeFile: "nodes/node-main-worker.json",
        // @ts-expect-error role is not part of authored node registry entries.
        role: "worker",
      },
    ],
  } satisfies AuthoredWorkflowJson);

  void ({
    ...createStrictAuthoredWorkflow(),
    nodes: [
      {
        id: "main-worker",
        nodeFile: "nodes/node-main-worker.json",
        // @ts-expect-error inline node payloads are not part of the strict authored node registry schema.
        node: {},
      },
    ],
  } satisfies AuthoredWorkflowJson);
});

test("getNormalizedNodePayload falls back to nodeFile-keyed payloads", () => {
  const bundle = {
    workflow: {
      workflowId: "demo",
      description: "",
      defaults: {
        maxLoopIterations: 3,
        nodeTimeoutMs: 1_000,
      },
      entryStepId: "main-step",
      nodeRegistry: [
        { id: "main-node", nodeFile: "nodes/node-main-node.json" },
      ],
      steps: [{ id: "main-step", nodeId: "main-node" }],
      nodes: [
        {
          id: "main-step",
          nodeFile: "nodes/node-main-node.json",
          role: "worker",
        },
      ],
    },
    nodePayloads: {
      "nodes/node-main-node.json": {
        id: "main-node",
        promptTemplate: "worker",
        model: "gpt-5",
        variables: {},
      },
    },
  } satisfies NormalizedWorkflowBundle;

  expect(getNormalizedNodePayload(bundle, "main-step")).toEqual({
    id: "main-node",
    promptTemplate: "worker",
    model: "gpt-5",
    variables: {},
  });
});
