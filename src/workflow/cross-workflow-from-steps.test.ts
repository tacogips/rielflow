import { describe, expect, test } from "vitest";
import {
  crossWorkflowCallsFromSteps,
  effectiveWorkflowCalls,
  workflowCallsForExecutionMatch,
} from "./cross-workflow-from-steps";
import type { WorkflowCallRef, WorkflowJson } from "./types";

describe("crossWorkflowCallsFromSteps", () => {
  test("returns empty for undefined steps", () => {
    expect(crossWorkflowCallsFromSteps(undefined)).toEqual([]);
  });

  test("ignores cross-workflow transitions missing resumeStepId", () => {
    const steps: WorkflowJson["steps"] = [
      {
        id: "a",
        nodeId: "n",
        transitions: [
          {
            toStepId: "calleeStart",
            toWorkflowId: "callee",
          },
        ],
      },
    ];
    expect(crossWorkflowCallsFromSteps(steps)).toEqual([]);
  });

  test("maps transition label to workflowCall when for evaluateBranch gating", () => {
    const steps: WorkflowJson["steps"] = [
      {
        id: "draft-write",
        nodeId: "draft-write",
        transitions: [
          {
            toStepId: "reviewer",
            toWorkflowId: "callee",
            resumeStepId: "apply-review",
            label: "need_review",
          },
        ],
      },
    ];
    expect(crossWorkflowCallsFromSteps(steps)).toEqual([
      {
        id: "__cw:draft-write",
        workflowId: "callee",
        callerNodeId: "draft-write",
        callerStepId: "draft-write",
        resultNodeId: "apply-review",
        when: "need_review",
      },
    ]);
  });
});

describe("effectiveWorkflowCalls", () => {
  test("unions explicit workflowCalls with step-derived calls by id", () => {
    const workflow: Pick<WorkflowJson, "workflowCalls" | "steps"> = {
      workflowCalls: [
        {
          id: "manual",
          workflowId: "w1",
          callerNodeId: "s1",
        },
      ],
      steps: [
        {
          id: "s2",
          nodeId: "n2",
          transitions: [
            {
              toStepId: "x",
              toWorkflowId: "w2",
              resumeStepId: "after",
            },
          ],
        },
      ],
    };
    const ids = effectiveWorkflowCalls(workflow)
      .map((c) => c.id)
      .sort();
    expect(ids).toEqual(["__cw:s2", "manual"]);
  });

  test("explicit workflow call wins over derived call with the same id", () => {
    const workflow: Pick<WorkflowJson, "workflowCalls" | "steps"> = {
      workflowCalls: [
        {
          id: "__cw:s1",
          workflowId: "override-target",
          callerNodeId: "s1",
          callerStepId: "s1",
          resultNodeId: "done",
        },
      ],
      steps: [
        {
          id: "s1",
          nodeId: "n1",
          transitions: [
            {
              toStepId: "callee",
              toWorkflowId: "derived-target",
              resumeStepId: "resume",
            },
          ],
        },
      ],
    };
    const effective = effectiveWorkflowCalls(workflow);
    expect(effective).toHaveLength(1);
    expect(effective[0]?.workflowId).toBe("override-target");
    expect(effective[0]?.resultNodeId).toBe("done");
  });
});

describe("workflowCallsForExecutionMatch", () => {
  test("preserves explicit workflowCalls order, then appends non-colliding step-derived calls", () => {
    const workflow: Pick<WorkflowJson, "workflowCalls" | "steps"> = {
      workflowCalls: [
        {
          id: "ex-second",
          workflowId: "w2",
          callerNodeId: "s1",
        },
        {
          id: "ex-first",
          workflowId: "w1",
          callerNodeId: "s1",
        },
      ],
      steps: [
        {
          id: "s1",
          nodeId: "n1",
          transitions: [
            {
              toStepId: "callee",
              toWorkflowId: "w3",
              resumeStepId: "resume",
            },
          ],
        },
      ],
    };
    const match = (c: WorkflowCallRef) => c.callerNodeId === "s1";
    expect(
      workflowCallsForExecutionMatch(workflow, match).map((c) => c.id),
    ).toEqual(["ex-second", "ex-first", "__cw:s1"]);
  });

  test("does not append a step-derived call whose id is already taken by a matching explicit call", () => {
    const workflow: Pick<WorkflowJson, "workflowCalls" | "steps"> = {
      workflowCalls: [
        {
          id: "__cw:s1",
          workflowId: "explicit-callee",
          callerNodeId: "s1",
          callerStepId: "s1",
          resultNodeId: "resume-here",
        },
      ],
      steps: [
        {
          id: "s1",
          nodeId: "n1",
          transitions: [
            {
              toStepId: "callee",
              toWorkflowId: "derived-would-collide",
              resumeStepId: "other",
            },
          ],
        },
      ],
    };
    const match = (c: WorkflowCallRef) =>
      c.callerNodeId === "s1" && c.callerStepId === "s1";
    const ids = workflowCallsForExecutionMatch(workflow, match).map(
      (c) => c.id,
    );
    expect(ids).toEqual(["__cw:s1"]);
    expect(workflowCallsForExecutionMatch(workflow, match)).toHaveLength(1);
  });
});
