import { describe, expect, test } from "vitest";
import { deriveWorkflowVisualization } from "./visualization";
import type { WorkflowJson } from "./types";

function makeWorkflow(input: {
  readonly entryStepId?: string;
  readonly managerStepId?: string;
  readonly nodeIds: readonly string[];
  readonly steps: readonly {
    readonly id: string;
    readonly nodeId: string;
    readonly role?: "manager" | "worker";
    readonly transitions?: readonly {
      readonly toStepId: string;
      readonly label?: string;
    }[];
  }[];
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
  if (firstStep === undefined && input.entryStepId === undefined) {
    throw new Error("makeWorkflow requires at least one step or entryStepId");
  }
  const entryStepId = input.entryStepId ?? firstStep?.id;
  if (entryStepId === undefined) {
    throw new Error("makeWorkflow requires an entry step id");
  }

  return {
    workflowId: "wf",
    description: "wf",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    ...(input.managerStepId === undefined
      ? {}
      : { managerStepId: input.managerStepId }),
    entryStepId,
    nodeRegistry: input.nodeIds.map((id) => ({
      id,
      nodeFile: `nodes/node-${id}.json`,
    })),
    steps: input.steps,
    nodes: input.nodeIds.map((id) => {
      const step = input.steps.find((entry) => entry.nodeId === id);
      return {
        id,
        nodeFile: `nodes/node-${id}.json`,
        ...(step?.role === undefined ? {} : { role: step.role }),
        ...(input.repeatByNodeId?.[id] === undefined
          ? {}
          : { repeat: input.repeatByNodeId[id] }),
      };
    }),
  };
}

describe("deriveWorkflowVisualization", () => {
  test("keeps a linear step-addressed chain at base indent", () => {
    const workflow = makeWorkflow({
      managerStepId: "manager",
      nodeIds: ["manager", "design", "implement"],
      steps: [
        {
          id: "manager",
          nodeId: "manager",
          role: "manager",
          transitions: [{ toStepId: "design", label: "always" }],
        },
        {
          id: "design",
          nodeId: "design",
          role: "worker",
          transitions: [{ toStepId: "implement", label: "always" }],
        },
        {
          id: "implement",
          nodeId: "implement",
          role: "worker",
        },
      ],
    });

    expect(deriveWorkflowVisualization({ workflow })).toEqual([
      { id: "manager", order: 0, indent: 0, color: "default" },
      { id: "design", order: 1, indent: 0, color: "default" },
      { id: "implement", order: 2, indent: 0, color: "default" },
    ]);
  });

  test("derives loop indentation from node repeat and step transitions", () => {
    const workflow = makeWorkflow({
      managerStepId: "manager",
      nodeIds: ["manager", "implement", "review", "done"],
      steps: [
        {
          id: "manager",
          nodeId: "manager",
          role: "manager",
          transitions: [{ toStepId: "implement", label: "always" }],
        },
        {
          id: "implement",
          nodeId: "implement",
          role: "worker",
          transitions: [{ toStepId: "review", label: "always" }],
        },
        {
          id: "review",
          nodeId: "review",
          role: "worker",
          transitions: [
            { toStepId: "implement", label: "continue_round" },
            { toStepId: "done", label: "!(continue_round)" },
          ],
        },
        {
          id: "done",
          nodeId: "done",
          role: "worker",
        },
      ],
      repeatByNodeId: {
        review: {
          while: "continue_round",
          restartAt: "implement",
          maxIterations: 2,
        },
      },
    });

    expect(deriveWorkflowVisualization({ workflow })).toEqual([
      { id: "manager", order: 0, indent: 0, color: "default" },
      { id: "implement", order: 1, indent: 1, color: "loop:repeat-review" },
      { id: "review", order: 2, indent: 1, color: "loop:repeat-review" },
      { id: "done", order: 3, indent: 0, color: "default" },
    ]);
  });

  test("ignores cross-workflow transitions for local visualization structure", () => {
    const workflow = makeWorkflow({
      managerStepId: "manager",
      nodeIds: ["manager", "after-child"],
      steps: [
        {
          id: "manager",
          nodeId: "manager",
          role: "manager",
          transitions: [
            {
              toStepId: "child-entry",
              label: "handoff",
            } as {
              readonly toStepId: string;
              readonly label?: string;
            },
          ],
        },
        {
          id: "after-child",
          nodeId: "after-child",
          role: "worker",
        },
      ],
    });

    expect(deriveWorkflowVisualization({ workflow })).toEqual([
      { id: "manager", order: 0, indent: 0, color: "default" },
      { id: "after-child", order: 1, indent: 0, color: "default" },
    ]);
  });
});
