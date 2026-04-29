import { expect, test } from "bun:test";
import type { AuthoredWorkflowJson } from "./types";
import {
  REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS,
  REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS,
} from "./validate";

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

test("REJECTED_AUTHORED step-addressed list is legacy rejects plus step-only extras", () => {
  expect([...REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS]).toEqual([
    ...REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS,
    ...REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS,
  ]);
});

test("AuthoredWorkflowJson excludes disallowed top-level authored keys", () => {
  // @ts-expect-error managerRuntimeId is not part of the authored schema.
  void ({ ...createStrictAuthoredWorkflow(), managerRuntimeId: "main-worker" } satisfies AuthoredWorkflowJson);

  // @ts-expect-error entryNodeId is not part of the authored schema (use entryStepId).
  void ({ ...createStrictAuthoredWorkflow(), entryNodeId: "main-worker" } satisfies AuthoredWorkflowJson);

  // @ts-expect-error workflowCalls is not part of the authored schema.
  void ({ ...createStrictAuthoredWorkflow(), workflowCalls: [] } satisfies AuthoredWorkflowJson);

  // @ts-expect-error subWorkflows is not part of the authored schema.
  void ({ ...createStrictAuthoredWorkflow(), subWorkflows: [] } satisfies AuthoredWorkflowJson);

  // @ts-expect-error subWorkflowConversations is not part of the authored schema.
  void ({ ...createStrictAuthoredWorkflow(), subWorkflowConversations: [] } satisfies AuthoredWorkflowJson);

  // @ts-expect-error edges is not part of the authored schema.
  void ({ ...createStrictAuthoredWorkflow(), edges: [] } satisfies AuthoredWorkflowJson);

  // @ts-expect-error loops is not part of the authored schema.
  void ({ ...createStrictAuthoredWorkflow(), loops: [] } satisfies AuthoredWorkflowJson);

  // @ts-expect-error branching is not part of the authored schema.
  void ({ ...createStrictAuthoredWorkflow(), branching: {} } satisfies AuthoredWorkflowJson);
});