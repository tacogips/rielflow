import { expect, test } from "bun:test";
import type { AuthoredWorkflowJson } from "./types";

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

test("AuthoredWorkflowJson omits legacy top-level compatibility fields", () => {
  // @ts-expect-error managerNodeId is a legacy compatibility field.
  void ({ ...createStrictAuthoredWorkflow(), managerNodeId: "main-worker" } satisfies AuthoredWorkflowJson);

  // @ts-expect-error workflowCalls is a legacy compatibility field.
  void ({ ...createStrictAuthoredWorkflow(), workflowCalls: [] } satisfies AuthoredWorkflowJson);

  // @ts-expect-error subWorkflows is a legacy compatibility field.
  void ({ ...createStrictAuthoredWorkflow(), subWorkflows: [] } satisfies AuthoredWorkflowJson);

  // @ts-expect-error edges is a legacy compatibility field.
  void ({ ...createStrictAuthoredWorkflow(), edges: [] } satisfies AuthoredWorkflowJson);

  expect(true).toBe(true);
});
