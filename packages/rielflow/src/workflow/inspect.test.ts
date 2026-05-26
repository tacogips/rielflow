import { describe, expect, test } from "vitest";
import { deriveWorkflowStructureRows } from "./inspect";
import type { WorkflowJson } from "./types";

function makeWorkflow(input: {
  readonly nodeIds: readonly string[];
  readonly steps: WorkflowJson["steps"];
  readonly repeatByNodeId?: Readonly<
    Record<
      string,
      {
        readonly while: string;
        readonly restartAt: string;
        readonly maxIterations?: number;
      }
    >
  >;
}): WorkflowJson {
  const firstStep = input.steps[0];
  if (firstStep === undefined) {
    throw new Error("makeWorkflow requires at least one step");
  }
  return {
    workflowId: "wf",
    description: "wf",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryStepId: firstStep.id,
    nodeRegistry: input.nodeIds.map((id) => ({
      id,
      nodeFile: `nodes/node-${id}.json`,
    })),
    steps: input.steps,
    nodes: input.nodeIds.map((id) => ({
      id,
      nodeFile: `nodes/node-${id}.json`,
      ...(input.repeatByNodeId?.[id] === undefined
        ? {}
        : { repeat: input.repeatByNodeId[id] }),
    })),
  };
}

describe("deriveWorkflowStructureRows", () => {
  test("maps loop-scope visualization indentation onto compact structure rows", () => {
    const workflow = makeWorkflow({
      nodeIds: ["start", "work", "review", "done"],
      steps: [
        {
          id: "start",
          nodeId: "start",
          description: "Start the work.",
          transitions: [{ toStepId: "work" }],
        },
        {
          id: "work",
          nodeId: "work",
          description: "Implement the change.",
          transitions: [{ toStepId: "review" }],
        },
        {
          id: "review",
          nodeId: "review",
          description: "Review the change.",
          transitions: [
            { toStepId: "work", label: "needs_revision" },
            { toStepId: "done", label: "!(needs_revision)" },
          ],
        },
        {
          id: "done",
          nodeId: "done",
          description: "Finish.",
        },
      ],
      repeatByNodeId: {
        review: {
          while: "needs_revision",
          restartAt: "work",
          maxIterations: 2,
        },
      },
    });

    expect(deriveWorkflowStructureRows(workflow)).toEqual([
      { stepId: "start", description: "Start the work.", indent: 0 },
      { stepId: "work", description: "Implement the change.", indent: 1 },
      { stepId: "review", description: "Review the change.", indent: 1 },
      { stepId: "done", description: "Finish.", indent: 0 },
    ]);
  });

  test("maps loop indentation when step ids differ from node ids", () => {
    const workflow = makeWorkflow({
      nodeIds: ["start-node", "work-node", "review-node", "done-node"],
      steps: [
        {
          id: "start-step",
          nodeId: "start-node",
          description: "Start the work.",
          transitions: [{ toStepId: "work-step" }],
        },
        {
          id: "work-step",
          nodeId: "work-node",
          description: "Implement the change.",
          transitions: [{ toStepId: "review-step" }],
        },
        {
          id: "review-step",
          nodeId: "review-node",
          description: "Review the change.",
          transitions: [
            { toStepId: "work-step", label: "needs_revision" },
            { toStepId: "done-step", label: "!(needs_revision)" },
          ],
        },
        {
          id: "done-step",
          nodeId: "done-node",
          description: "Finish.",
        },
      ],
      repeatByNodeId: {
        "review-node": {
          while: "needs_revision",
          restartAt: "work-step",
          maxIterations: 2,
        },
      },
    });

    expect(deriveWorkflowStructureRows(workflow)).toEqual([
      { stepId: "start-step", description: "Start the work.", indent: 0 },
      { stepId: "work-step", description: "Implement the change.", indent: 1 },
      { stepId: "review-step", description: "Review the change.", indent: 1 },
      { stepId: "done-step", description: "Finish.", indent: 0 },
    ]);
  });

  test("uses base indentation and dash descriptions when no structure row is derivable", () => {
    const workflow = makeWorkflow({
      nodeIds: ["start", "finish"],
      steps: [
        {
          id: "start",
          nodeId: "start",
          description: "",
          transitions: [{ toStepId: "finish" }],
        },
        {
          id: "finish",
          nodeId: "finish",
        },
      ],
    });

    expect(deriveWorkflowStructureRows(workflow)).toEqual([
      { stepId: "start", description: "-", indent: 0 },
      { stepId: "finish", description: "-", indent: 0 },
    ]);
  });
});
