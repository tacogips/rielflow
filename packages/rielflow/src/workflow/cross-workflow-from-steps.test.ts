import { describe, expect, test } from "vitest";
import {
  crossWorkflowDispatchesForExecutionMatch,
  crossWorkflowDispatchesFromSteps,
  effectiveCrossWorkflowDispatches,
  type CrossWorkflowDispatch,
} from "./cross-workflow-from-steps";
import type { WorkflowJson } from "./types";

describe("crossWorkflowDispatchesFromSteps", () => {
  test("returns empty for undefined steps", () => {
    expect(crossWorkflowDispatchesFromSteps(undefined)).toEqual([]);
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
    expect(crossWorkflowDispatchesFromSteps(steps)).toEqual([]);
  });

  test("maps transition label to dispatch `when` for evaluateBranch gating", () => {
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
    expect(crossWorkflowDispatchesFromSteps(steps)).toEqual([
      {
        id: "__cw:draft-write",
        workflowId: "callee",
        callerStepId: "draft-write",
        resumeStepId: "apply-review",
        when: "need_review",
      },
    ]);
  });
});

describe("effectiveCrossWorkflowDispatches", () => {
  test("empty step-addressed bundles expose no cross-workflow dispatches", () => {
    const workflow: Pick<WorkflowJson, "entryStepId" | "steps"> = {
      entryStepId: "entry",
      steps: [],
    };
    expect(effectiveCrossWorkflowDispatches(workflow)).toEqual([]);
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
    const effective = effectiveCrossWorkflowDispatches(workflow);
    expect(effective).toHaveLength(1);
    expect(effective[0]?.id).toBe("__cw:s1");
    expect(effective[0]?.workflowId).toBe("callee");
  });

  test("labels only step-derived cross-workflow dispatches", () => {
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
    const effective = effectiveCrossWorkflowDispatches(workflow);
    expect(effective).toEqual<readonly CrossWorkflowDispatch[]>([
      {
        id: "__cw:writer",
        workflowId: "legacy-target",
        callerStepId: "writer",
        resumeStepId: "resume",
      },
    ]);
  });
});

describe("crossWorkflowDispatchesForExecutionMatch", () => {
  test("empty step-addressed bundles expose no execution dispatches", () => {
    const workflow: Pick<WorkflowJson, "entryStepId" | "steps"> = {
      entryStepId: "entry",
      steps: [],
    };
    const match = (dispatch: CrossWorkflowDispatch) =>
      dispatch.callerStepId === "s1";
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
    const match = (dispatch: CrossWorkflowDispatch) =>
      dispatch.callerStepId === "s1";
    const dispatches = crossWorkflowDispatchesForExecutionMatch(
      workflow,
      match,
    );
    expect(dispatches.map((dispatch) => dispatch.workflowId)).toEqual([
      "derived-wf",
    ]);
  });

  test("does not dispatch when no cross-workflow transitions exist", () => {
    const workflow: Pick<WorkflowJson, "entryStepId" | "steps"> = {
      entryStepId: "entry",
      steps: [],
    };
    const dispatches = crossWorkflowDispatchesForExecutionMatch(
      workflow,
      (dispatch) => dispatch.callerStepId === "writer",
    );
    expect(dispatches).toEqual([]);
  });

  test("matches by caller step id when the step and node registry ids differ", () => {
    const workflow: Pick<WorkflowJson, "entryStepId" | "steps"> = {
      entryStepId: "writer",
      steps: [
        {
          id: "writer",
          nodeId: "writer-node",
          transitions: [
            {
              toStepId: "resume",
              toWorkflowId: "derived-wf",
              resumeStepId: "resume",
            },
          ],
        },
      ],
    };

    const dispatches = crossWorkflowDispatchesForExecutionMatch(
      workflow,
      (dispatch) => dispatch.callerStepId === "writer",
    );

    expect(dispatches).toEqual([
      {
        id: "__cw:writer",
        workflowId: "derived-wf",
        callerStepId: "writer",
        resumeStepId: "resume",
      },
    ]);
  });
});
