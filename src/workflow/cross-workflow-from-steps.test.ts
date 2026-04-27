import { describe, expect, test } from "vitest";
import {
  crossWorkflowDispatchesForExecutionMatch,
  crossWorkflowCallsFromSteps,
  effectiveWorkflowCalls,
  type CrossWorkflowExecutionDispatch,
  type EffectiveWorkflowCall,
} from "./cross-workflow-from-steps";
import type { WorkflowJson } from "./types";

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
  test("legacy node-graph bundles expose no authored workflowCalls", () => {
    const workflow = {};
    expect(effectiveWorkflowCalls(workflow)).toEqual([]);
  });

  test("step-addressed graph uses only step-derived calls", () => {
    const workflow: Pick<WorkflowJson, "entryStepId" | "steps"> = {
      entryStepId: "s1",
      steps: [
        {
          id: "s1",
          nodeId: "n1",
          transitions: [
            {
              toStepId: "after",
              toWorkflowId: "callee",
              resumeStepId: "after",
            },
          ],
        },
      ],
    };
    const effective = effectiveWorkflowCalls(workflow);
    expect(effective).toHaveLength(1);
    expect(effective[0]?.id).toBe("__cw:s1");
    expect(effective[0]?.workflowId).toBe("callee");
  });

  test("labels only step-derived workflowCalls", () => {
    const workflow: Pick<WorkflowJson, "entryStepId" | "steps"> = {
      entryStepId: "writer",
      steps: [
        {
          id: "writer",
          nodeId: "writer-node",
          transitions: [
            {
              toStepId: "resume",
              toWorkflowId: "legacy-target",
              resumeStepId: "resume",
            },
          ],
        },
      ],
    };
    const effective = effectiveWorkflowCalls(workflow);
    expect(effective).toEqual<readonly EffectiveWorkflowCall[]>([
      {
        id: "__cw:writer",
        workflowId: "legacy-target",
        callerNodeId: "writer",
        callerStepId: "writer",
        resultNodeId: "resume",
      },
    ]);
  });
});

describe("crossWorkflowDispatchesForExecutionMatch", () => {
  test("legacy node-graph bundles expose no execution dispatches", () => {
    const workflow = {};
    const match = (dispatch: CrossWorkflowExecutionDispatch) =>
      dispatch.callerNodeId === "s1";
    expect(crossWorkflowDispatchesForExecutionMatch(workflow, match)).toEqual(
      [],
    );
  });

  test("step-addressed graph derives execution matches from step transitions", () => {
    const workflow: Pick<WorkflowJson, "entryStepId" | "steps"> = {
      entryStepId: "s1",
      steps: [
        {
          id: "s1",
          nodeId: "n1",
          transitions: [
            {
              toStepId: "after",
              toWorkflowId: "derived-wf",
              resumeStepId: "after",
            },
          ],
        },
      ],
    };
    const match = (dispatch: CrossWorkflowExecutionDispatch) =>
      dispatch.callerNodeId === "s1";
    const dispatches = crossWorkflowDispatchesForExecutionMatch(
      workflow,
      match,
    );
    expect(dispatches.map((dispatch) => dispatch.workflowId)).toEqual([
      "derived-wf",
    ]);
  });

  test("does not dispatch legacy authored workflowCalls", () => {
    const workflow = {};
    const dispatches = crossWorkflowDispatchesForExecutionMatch(
      workflow,
      (dispatch) => dispatch.callerNodeId === "writer",
    );
    expect(dispatches).toEqual([]);
  });
});
