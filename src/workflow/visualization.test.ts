import { describe, expect, test } from "vitest";
import { deriveWorkflowVisualization } from "./visualization";
import type { WorkflowJson } from "./types";

function makeBaseWorkflow(
  nodes: readonly string[],
  edges: readonly { from: string; to: string; when: string }[],
): WorkflowJson {
  return {
    workflowId: "wf",
    description: "wf",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: nodes.map((id) => ({
      id,
      nodeFile: `node-${id}.json`,
      kind: id === "divedra-manager" ? "root-manager" : "task",
      completion: { type: "none" },
    })),
    edges,
    loops: [],
    branching: { mode: "fan-out" },
  };
}

describe("deriveWorkflowVisualization", () => {
  test("keeps top-level linear chain at base indent", () => {
    const workflow = makeBaseWorkflow(
      ["divedra-manager", "design", "implement"],
      [
        { from: "divedra-manager", to: "design", when: "always" },
        { from: "design", to: "implement", when: "always" },
      ],
    );

    const derived = deriveWorkflowVisualization({
      workflow,
    });

    expect(derived).toEqual([
      { id: "divedra-manager", order: 0, indent: 0, color: "default" },
      { id: "design", order: 1, indent: 0, color: "default" },
      { id: "implement", order: 2, indent: 0, color: "default" },
    ]);
  });

  test("derives loop color and returns exit target to base depth", () => {
    const workflow = {
      ...makeBaseWorkflow(
        ["divedra-manager", "implement", "test-review", "done"],
        [
          { from: "divedra-manager", to: "implement", when: "always" },
          { from: "implement", to: "test-review", when: "always" },
          { from: "test-review", to: "implement", when: "continue_round" },
          { from: "test-review", to: "done", when: "loop_exit" },
        ],
      ),
      nodes: [
        {
          id: "divedra-manager",
          nodeFile: "node-divedra-manager.json",
          kind: "root-manager",
          completion: { type: "none" },
        },
        {
          id: "implement",
          nodeFile: "node-implement.json",
          kind: "task",
          completion: { type: "none" },
        },
        {
          id: "test-review",
          nodeFile: "node-test-review.json",
          kind: "loop-judge",
          completion: { type: "none" },
        },
        {
          id: "done",
          nodeFile: "node-done.json",
          kind: "output",
          completion: { type: "none" },
        },
      ],
      loops: [
        {
          id: "main-loop",
          judgeNodeId: "test-review",
          continueWhen: "continue_round",
          exitWhen: "loop_exit",
        },
      ],
    } satisfies WorkflowJson;

    const derived = deriveWorkflowVisualization({
      workflow,
    });

    expect(derived).toEqual([
      { id: "divedra-manager", order: 0, indent: 0, color: "default" },
      { id: "implement", order: 1, indent: 1, color: "loop:main-loop" },
      { id: "test-review", order: 2, indent: 1, color: "loop:main-loop" },
      { id: "done", order: 3, indent: 0, color: "default" },
    ]);
  });

  test("derives sub-workflow group indent and color", () => {
    const workflow = makeBaseWorkflow(
      [
        "divedra-manager",
        "group-manager",
        "group-input",
        "group-output",
        "done",
      ],
      [
        { from: "divedra-manager", to: "group-manager", when: "always" },
        { from: "group-input", to: "group-output", when: "always" },
        { from: "group-output", to: "done", when: "always" },
      ],
    );
    const grouped = {
      ...workflow,
      nodes: [
        {
          id: "divedra-manager",
          nodeFile: "node-divedra-manager.json",
          kind: "root-manager",
          completion: { type: "none" },
        },
        {
          id: "group-manager",
          nodeFile: "node-group-manager.json",
          kind: "subworkflow-manager",
          completion: { type: "none" },
        },
        {
          id: "group-input",
          nodeFile: "node-group-input.json",
          kind: "input",
          completion: { type: "none" },
        },
        {
          id: "group-output",
          nodeFile: "node-group-output.json",
          kind: "output",
          completion: { type: "none" },
        },
        {
          id: "done",
          nodeFile: "node-done.json",
          kind: "output",
          completion: { type: "none" },
        },
      ],
      subWorkflows: [
        {
          id: "main-group",
          description: "main",
          managerNodeId: "group-manager",
          inputNodeId: "group-input",
          outputNodeId: "group-output",
          nodeIds: ["group-manager", "group-input", "group-output"],
          inputSources: [{ type: "human-input" }],
        },
      ],
    } satisfies WorkflowJson;

    const derived = deriveWorkflowVisualization({
      workflow: grouped,
    });

    expect(derived).toEqual([
      { id: "divedra-manager", order: 0, indent: 0, color: "default" },
      { id: "group-manager", order: 1, indent: 0, color: "default" },
      { id: "group-input", order: 2, indent: 1, color: "group:main-group" },
      { id: "group-output", order: 3, indent: 1, color: "group:main-group" },
      { id: "done", order: 4, indent: 0, color: "default" },
    ]);
  });

  test("colors branch-block sub-workflow scopes as branch blocks", () => {
    const workflow = {
      ...makeBaseWorkflow(
        [
          "divedra-manager",
          "branch-manager",
          "branch-input",
          "branch-output",
          "done",
        ],
        [
          {
            from: "divedra-manager",
            to: "branch-manager",
            when: "needs_review",
          },
          { from: "branch-input", to: "branch-output", when: "always" },
          { from: "branch-output", to: "done", when: "always" },
        ],
      ),
      nodes: [
        {
          id: "divedra-manager",
          nodeFile: "node-divedra-manager.json",
          kind: "root-manager",
          completion: { type: "none" },
        },
        {
          id: "branch-manager",
          nodeFile: "node-branch-manager.json",
          kind: "subworkflow-manager",
          completion: { type: "none" },
        },
        {
          id: "branch-input",
          nodeFile: "node-branch-input.json",
          kind: "input",
          completion: { type: "none" },
        },
        {
          id: "branch-output",
          nodeFile: "node-branch-output.json",
          kind: "output",
          completion: { type: "none" },
        },
        {
          id: "done",
          nodeFile: "node-done.json",
          kind: "output",
          completion: { type: "none" },
        },
      ],
      subWorkflows: [
        {
          id: "review-branch",
          description: "review branch",
          managerNodeId: "branch-manager",
          inputNodeId: "branch-input",
          outputNodeId: "branch-output",
          nodeIds: ["branch-manager", "branch-input", "branch-output"],
          inputSources: [{ type: "human-input" }],
          block: { type: "branch-block" },
        },
      ],
    } satisfies WorkflowJson;

    const derived = deriveWorkflowVisualization({
      workflow,
    });

    expect(derived).toEqual([
      { id: "divedra-manager", order: 0, indent: 0, color: "default" },
      { id: "branch-manager", order: 1, indent: 0, color: "default" },
      {
        id: "branch-input",
        order: 2,
        indent: 1,
        color: "branch:review-branch",
      },
      {
        id: "branch-output",
        order: 3,
        indent: 1,
        color: "branch:review-branch",
      },
      { id: "done", order: 4, indent: 0, color: "default" },
    ]);
  });

  test("nests loop scope inside a sub-workflow group", () => {
    const workflow = {
      ...makeBaseWorkflow(
        [
          "divedra-manager",
          "group-manager",
          "group-input",
          "implement",
          "test-review",
          "group-output",
          "done",
        ],
        [
          { from: "divedra-manager", to: "group-manager", when: "always" },
          { from: "group-input", to: "implement", when: "always" },
          { from: "implement", to: "test-review", when: "always" },
          { from: "test-review", to: "implement", when: "continue_round" },
          { from: "test-review", to: "group-output", when: "loop_exit" },
          { from: "group-output", to: "done", when: "always" },
        ],
      ),
      nodes: [
        {
          id: "divedra-manager",
          nodeFile: "node-divedra-manager.json",
          kind: "root-manager",
          completion: { type: "none" },
        },
        {
          id: "group-manager",
          nodeFile: "node-group-manager.json",
          kind: "subworkflow-manager",
          completion: { type: "none" },
        },
        {
          id: "group-input",
          nodeFile: "node-group-input.json",
          kind: "input",
          completion: { type: "none" },
        },
        {
          id: "implement",
          nodeFile: "node-implement.json",
          kind: "task",
          completion: { type: "none" },
        },
        {
          id: "test-review",
          nodeFile: "node-test-review.json",
          kind: "loop-judge",
          completion: { type: "none" },
        },
        {
          id: "group-output",
          nodeFile: "node-group-output.json",
          kind: "output",
          completion: { type: "none" },
        },
        {
          id: "done",
          nodeFile: "node-done.json",
          kind: "output",
          completion: { type: "none" },
        },
      ],
      subWorkflows: [
        {
          id: "main-group",
          description: "main",
          managerNodeId: "group-manager",
          inputNodeId: "group-input",
          outputNodeId: "group-output",
          nodeIds: [
            "group-manager",
            "group-input",
            "implement",
            "test-review",
            "group-output",
          ],
          inputSources: [{ type: "human-input" }],
        },
      ],
      loops: [
        {
          id: "main-loop",
          judgeNodeId: "test-review",
          continueWhen: "continue_round",
          exitWhen: "loop_exit",
        },
      ],
    } satisfies WorkflowJson;

    const derived = deriveWorkflowVisualization({
      workflow,
    });

    expect(derived).toEqual([
      { id: "divedra-manager", order: 0, indent: 0, color: "default" },
      { id: "group-manager", order: 1, indent: 0, color: "default" },
      { id: "group-input", order: 2, indent: 1, color: "group:main-group" },
      { id: "implement", order: 3, indent: 2, color: "loop:main-loop" },
      { id: "test-review", order: 4, indent: 2, color: "loop:main-loop" },
      { id: "group-output", order: 5, indent: 1, color: "group:main-group" },
      { id: "done", order: 6, indent: 0, color: "default" },
    ]);
  });

  test("prefers loop-body sub-workflow scopes over inferred loop intervals", () => {
    const workflow = {
      ...makeBaseWorkflow(
        [
          "divedra-manager",
          "loop-manager",
          "loop-input",
          "implement",
          "loop-output",
          "loop-judge",
          "done",
        ],
        [
          { from: "divedra-manager", to: "loop-manager", when: "always" },
          { from: "loop-input", to: "implement", when: "always" },
          { from: "implement", to: "loop-output", when: "always" },
          { from: "loop-output", to: "loop-judge", when: "always" },
          { from: "loop-judge", to: "loop-manager", when: "continue_round" },
          { from: "loop-judge", to: "done", when: "loop_exit" },
        ],
      ),
      nodes: [
        {
          id: "divedra-manager",
          nodeFile: "node-divedra-manager.json",
          kind: "root-manager",
          completion: { type: "none" },
        },
        {
          id: "loop-manager",
          nodeFile: "node-loop-manager.json",
          kind: "subworkflow-manager",
          completion: { type: "none" },
        },
        {
          id: "loop-input",
          nodeFile: "node-loop-input.json",
          kind: "input",
          completion: { type: "none" },
        },
        {
          id: "implement",
          nodeFile: "node-implement.json",
          kind: "task",
          completion: { type: "none" },
        },
        {
          id: "loop-output",
          nodeFile: "node-loop-output.json",
          kind: "output",
          completion: { type: "none" },
        },
        {
          id: "loop-judge",
          nodeFile: "node-loop-judge.json",
          kind: "loop-judge",
          completion: { type: "none" },
        },
        {
          id: "done",
          nodeFile: "node-done.json",
          kind: "output",
          completion: { type: "none" },
        },
      ],
      subWorkflows: [
        {
          id: "implementation-loop",
          description: "implementation loop body",
          managerNodeId: "loop-manager",
          inputNodeId: "loop-input",
          outputNodeId: "loop-output",
          nodeIds: ["loop-manager", "loop-input", "implement", "loop-output"],
          inputSources: [{ type: "human-input" }],
          block: { type: "loop-body", loopId: "main-loop" },
        },
      ],
      loops: [
        {
          id: "main-loop",
          judgeNodeId: "loop-judge",
          continueWhen: "continue_round",
          exitWhen: "loop_exit",
        },
      ],
    } satisfies WorkflowJson;

    const derived = deriveWorkflowVisualization({
      workflow,
    });

    expect(derived).toEqual([
      { id: "divedra-manager", order: 0, indent: 0, color: "default" },
      { id: "loop-manager", order: 1, indent: 0, color: "default" },
      { id: "loop-input", order: 2, indent: 1, color: "loop:main-loop" },
      { id: "implement", order: 3, indent: 1, color: "loop:main-loop" },
      { id: "loop-output", order: 4, indent: 1, color: "loop:main-loop" },
      { id: "loop-judge", order: 5, indent: 0, color: "default" },
      { id: "done", order: 6, indent: 0, color: "default" },
    ]);
  });

  test("keeps loop-body color precedence inside nested plain groups", () => {
    const workflow = {
      ...makeBaseWorkflow(
        [
          "divedra-manager",
          "loop-manager",
          "loop-input",
          "inner-manager",
          "inner-input",
          "implement",
          "inner-output",
          "loop-output",
          "loop-judge",
          "done",
        ],
        [
          { from: "divedra-manager", to: "loop-manager", when: "always" },
          { from: "loop-input", to: "inner-manager", when: "always" },
          { from: "inner-input", to: "implement", when: "always" },
          { from: "implement", to: "inner-output", when: "always" },
          { from: "inner-output", to: "loop-output", when: "always" },
          { from: "loop-output", to: "loop-judge", when: "always" },
          { from: "loop-judge", to: "loop-manager", when: "continue_round" },
          { from: "loop-judge", to: "done", when: "loop_exit" },
        ],
      ),
      nodes: [
        {
          id: "divedra-manager",
          nodeFile: "node-divedra-manager.json",
          kind: "root-manager",
          completion: { type: "none" },
        },
        {
          id: "loop-manager",
          nodeFile: "node-loop-manager.json",
          kind: "subworkflow-manager",
          completion: { type: "none" },
        },
        {
          id: "loop-input",
          nodeFile: "node-loop-input.json",
          kind: "input",
          completion: { type: "none" },
        },
        {
          id: "inner-manager",
          nodeFile: "node-inner-manager.json",
          kind: "subworkflow-manager",
          completion: { type: "none" },
        },
        {
          id: "inner-input",
          nodeFile: "node-inner-input.json",
          kind: "input",
          completion: { type: "none" },
        },
        {
          id: "implement",
          nodeFile: "node-implement.json",
          kind: "task",
          completion: { type: "none" },
        },
        {
          id: "inner-output",
          nodeFile: "node-inner-output.json",
          kind: "output",
          completion: { type: "none" },
        },
        {
          id: "loop-output",
          nodeFile: "node-loop-output.json",
          kind: "output",
          completion: { type: "none" },
        },
        {
          id: "loop-judge",
          nodeFile: "node-loop-judge.json",
          kind: "loop-judge",
          completion: { type: "none" },
        },
        {
          id: "done",
          nodeFile: "node-done.json",
          kind: "output",
          completion: { type: "none" },
        },
      ],
      subWorkflows: [
        {
          id: "implementation-loop",
          description: "implementation loop body",
          managerNodeId: "loop-manager",
          inputNodeId: "loop-input",
          outputNodeId: "loop-output",
          nodeIds: [
            "loop-manager",
            "loop-input",
            "inner-manager",
            "inner-input",
            "implement",
            "inner-output",
            "loop-output",
          ],
          inputSources: [{ type: "human-input" }],
          block: { type: "loop-body", loopId: "main-loop" },
        },
        {
          id: "inner-group",
          description: "inner plain group",
          managerNodeId: "inner-manager",
          inputNodeId: "inner-input",
          outputNodeId: "inner-output",
          nodeIds: [
            "inner-manager",
            "inner-input",
            "implement",
            "inner-output",
          ],
          inputSources: [{ type: "human-input" }],
          block: { type: "plain" },
        },
      ],
      loops: [
        {
          id: "main-loop",
          judgeNodeId: "loop-judge",
          continueWhen: "continue_round",
          exitWhen: "loop_exit",
        },
      ],
    } satisfies WorkflowJson;

    const derived = deriveWorkflowVisualization({
      workflow,
    });

    expect(derived).toEqual([
      { id: "divedra-manager", order: 0, indent: 0, color: "default" },
      { id: "loop-manager", order: 1, indent: 0, color: "default" },
      { id: "loop-input", order: 2, indent: 1, color: "loop:main-loop" },
      { id: "inner-manager", order: 3, indent: 1, color: "loop:main-loop" },
      { id: "inner-input", order: 4, indent: 2, color: "loop:main-loop" },
      { id: "implement", order: 5, indent: 2, color: "loop:main-loop" },
      { id: "inner-output", order: 6, indent: 2, color: "loop:main-loop" },
      { id: "loop-output", order: 7, indent: 1, color: "loop:main-loop" },
      { id: "loop-judge", order: 8, indent: 0, color: "default" },
      { id: "done", order: 9, indent: 0, color: "default" },
    ]);
  });

  test("keeps branch-block color precedence inside nested plain groups", () => {
    const workflow = {
      ...makeBaseWorkflow(
        [
          "divedra-manager",
          "branch-manager",
          "branch-input",
          "inner-manager",
          "inner-input",
          "review",
          "inner-output",
          "branch-output",
          "done",
        ],
        [
          {
            from: "divedra-manager",
            to: "branch-manager",
            when: "needs_review",
          },
          { from: "branch-input", to: "inner-manager", when: "always" },
          { from: "inner-input", to: "review", when: "always" },
          { from: "review", to: "inner-output", when: "always" },
          { from: "inner-output", to: "branch-output", when: "always" },
          { from: "branch-output", to: "done", when: "always" },
        ],
      ),
      nodes: [
        {
          id: "divedra-manager",
          nodeFile: "node-divedra-manager.json",
          kind: "root-manager",
          completion: { type: "none" },
        },
        {
          id: "branch-manager",
          nodeFile: "node-branch-manager.json",
          kind: "subworkflow-manager",
          completion: { type: "none" },
        },
        {
          id: "branch-input",
          nodeFile: "node-branch-input.json",
          kind: "input",
          completion: { type: "none" },
        },
        {
          id: "inner-manager",
          nodeFile: "node-inner-manager.json",
          kind: "subworkflow-manager",
          completion: { type: "none" },
        },
        {
          id: "inner-input",
          nodeFile: "node-inner-input.json",
          kind: "input",
          completion: { type: "none" },
        },
        {
          id: "review",
          nodeFile: "node-review.json",
          kind: "task",
          completion: { type: "none" },
        },
        {
          id: "inner-output",
          nodeFile: "node-inner-output.json",
          kind: "output",
          completion: { type: "none" },
        },
        {
          id: "branch-output",
          nodeFile: "node-branch-output.json",
          kind: "output",
          completion: { type: "none" },
        },
        {
          id: "done",
          nodeFile: "node-done.json",
          kind: "output",
          completion: { type: "none" },
        },
      ],
      subWorkflows: [
        {
          id: "review-branch",
          description: "review branch",
          managerNodeId: "branch-manager",
          inputNodeId: "branch-input",
          outputNodeId: "branch-output",
          nodeIds: [
            "branch-manager",
            "branch-input",
            "inner-manager",
            "inner-input",
            "review",
            "inner-output",
            "branch-output",
          ],
          inputSources: [{ type: "human-input" }],
          block: { type: "branch-block" },
        },
        {
          id: "inner-group",
          description: "inner plain group",
          managerNodeId: "inner-manager",
          inputNodeId: "inner-input",
          outputNodeId: "inner-output",
          nodeIds: ["inner-manager", "inner-input", "review", "inner-output"],
          inputSources: [{ type: "human-input" }],
          block: { type: "plain" },
        },
      ],
    } satisfies WorkflowJson;

    const derived = deriveWorkflowVisualization({
      workflow,
    });

    expect(derived).toEqual([
      { id: "divedra-manager", order: 0, indent: 0, color: "default" },
      { id: "branch-manager", order: 1, indent: 0, color: "default" },
      {
        id: "branch-input",
        order: 2,
        indent: 1,
        color: "branch:review-branch",
      },
      {
        id: "inner-manager",
        order: 3,
        indent: 1,
        color: "branch:review-branch",
      },
      { id: "inner-input", order: 4, indent: 2, color: "branch:review-branch" },
      { id: "review", order: 5, indent: 2, color: "branch:review-branch" },
      {
        id: "inner-output",
        order: 6,
        indent: 2,
        color: "branch:review-branch",
      },
      {
        id: "branch-output",
        order: 7,
        indent: 1,
        color: "branch:review-branch",
      },
      { id: "done", order: 8, indent: 0, color: "default" },
    ]);
  });
});
