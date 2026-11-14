import { describe, expect, test } from "vitest";
import {
  buildSupervisionStallWatch,
  formatSupervisionStallError,
  isSupervisionStallLastError,
  planSupervisionRemediation,
  resolveNestedSuperviserAddonRerunFromStepId,
  resolveSupervisionRerunAnchor,
  resolveSupervisionRerunTarget,
} from "./superviser";
import type { AutoImprovePolicy, LoadOptions } from "./types";
import type { WorkflowSessionState } from "./session";

describe("resolveSupervisionRerunAnchor", () => {
  test("prefers managerStepId over entryStepId", () => {
    expect(
      resolveSupervisionRerunAnchor({
        managerStepId: "mgr-step",
        entryStepId: "entry-step",
      }),
    ).toBe("mgr-step");
  });

  test("falls back to entryStepId", () => {
    expect(
      resolveSupervisionRerunAnchor({
        entryStepId: "entry-step",
      }),
    ).toBe("entry-step");
  });
});

describe("resolveNestedSuperviserAddonRerunFromStepId", () => {
  const stepAddressed = {
    entryStepId: "e1",
    steps: [
      { id: "e1", nodeId: "n1" },
      { id: "s2", nodeId: "n2" },
    ],
  } as const;

  const sess = (currentNodeId: string | undefined) =>
    ({
      currentNodeId,
      nodeExecutions: [],
    }) as Pick<WorkflowSessionState, "currentNodeId" | "nodeExecutions">;

  test("uses requested when provided", () => {
    expect(
      resolveNestedSuperviserAddonRerunFromStepId(
        "s2",
        sess("e1"),
        stepAddressed,
      ),
    ).toBe("s2");
  });

  test("uses current step from session when request omitted", () => {
    expect(
      resolveNestedSuperviserAddonRerunFromStepId(
        undefined,
        sess("s2"),
        stepAddressed,
      ),
    ).toBe("s2");
  });

  test("falls back to anchor when session step unknown", () => {
    expect(
      resolveNestedSuperviserAddonRerunFromStepId(
        undefined,
        sess("unknown"),
        stepAddressed,
      ),
    ).toBe("e1");
  });

  test("prefers manager step as anchor", () => {
    const sa = { ...stepAddressed, managerStepId: "mgr" };
    expect(
      resolveNestedSuperviserAddonRerunFromStepId(
        undefined,
        sess("unknown"),
        sa,
      ),
    ).toBe("mgr");
  });
});

function policy(over: Partial<AutoImprovePolicy> = {}): AutoImprovePolicy {
  return {
    enabled: true,
    monitorIntervalMs: 5_000,
    stallTimeoutMs: 60_000,
    maxSupervisedAttempts: 5,
    maxWorkflowPatches: 3,
    workflowMutationMode: "execution-copy",
    ...over,
  };
}

describe("resolveSupervisionRerunTarget", () => {
  const stepAddressedWf = {
    workflowId: "wf",
    description: "d",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120_000 },
    nodes: [{ id: "nm" }, { id: "nw" }],
    entryStepId: "entry",
    managerStepId: "mgr",
    steps: [
      { id: "mgr", nodeId: "nm" },
      { id: "w", nodeId: "nw" },
    ],
  };

  const failedAtWorker = {
    currentNodeId: "nw",
    nodeExecutions: [
      {
        nodeId: "nw",
        stepId: "w",
        nodeExecId: "ex1",
        status: "failed" as const,
        artifactDir: "/a",
        startedAt: "t0",
        endedAt: "t1",
      },
    ],
  };

  test("uses anchor when allowTargetedRerun is false", () => {
    const r = resolveSupervisionRerunTarget(
      policy({ allowTargetedRerun: false }),
      stepAddressedWf,
      failedAtWorker,
    );
    expect(r).toEqual({
      rerunFromStepId: "mgr",
      remediationAction: "rerun-workflow",
    });
  });

  test("uses rerun-step from failed step when targeted rerun is allowed", () => {
    const r = resolveSupervisionRerunTarget(
      policy(),
      stepAddressedWf,
      failedAtWorker,
    );
    expect(r).toEqual({
      rerunFromStepId: "w",
      remediationAction: "rerun-step",
      targetStepId: "w",
    });
  });

  test("uses rerun-workflow when failed step is the same as anchor", () => {
    const failedAtManager = {
      currentNodeId: "nm",
      nodeExecutions: [
        {
          nodeId: "nm",
          stepId: "mgr",
          nodeExecId: "ex0",
          status: "failed" as const,
          artifactDir: "/a",
          startedAt: "t0",
          endedAt: "t1",
        },
      ],
    };
    const r = resolveSupervisionRerunTarget(
      policy(),
      stepAddressedWf,
      failedAtManager,
    );
    expect(r).toEqual({
      rerunFromStepId: "mgr",
      remediationAction: "rerun-workflow",
    });
  });
});

describe("planSupervisionRemediation", () => {
  const stepAddressedWf = {
    workflowId: "wf",
    description: "d",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120_000 },
    nodes: [{ id: "nm" }, { id: "nw" }],
    entryStepId: "entry",
    managerStepId: "mgr",
    steps: [
      { id: "mgr", nodeId: "nm" },
      { id: "w", nodeId: "nw" },
    ],
  };

  const failedAtWorker = {
    currentNodeId: "nw",
    nodeExecutions: [
      {
        nodeId: "nw",
        stepId: "w",
        nodeExecId: "ex1",
        status: "failed" as const,
        artifactDir: "/a",
        startedAt: "t0",
        endedAt: "t1",
      },
    ],
  } satisfies Pick<WorkflowSessionState, "currentNodeId" | "nodeExecutions">;

  const baseSup = {
    supervisionRunId: "sup-1",
    targetWorkflowId: "wf",
    superviserWorkflowId: "d",
    status: "running" as const,
    attemptCount: 2,
    workflowPatchCount: 0,
    incidents: [
      {
        incidentId: "i1",
        supervisedAttemptId: "sa1",
        category: "failure" as const,
        summary: "same error for repeat",
        detectedAt: "t",
      },
    ],
    remediations: [],
  };

  test("first failure (no prior failure incident) yields rerun, not patch", () => {
    const p = planSupervisionRemediation({
      policy: policy(),
      sup: { ...baseSup, attemptCount: 1, incidents: [] },
      workflow: stepAddressedWf,
      session: failedAtWorker,
      failIncident: {
        category: "failure",
        summary: "same error for repeat",
      },
    });
    expect(p.kind).toBe("rerun");
    if (p.kind === "rerun") {
      expect(p.remediationAction).toBe("rerun-step");
    }
  });

  test("repeat same error with patch budget picks patch-then-rerun", () => {
    const p = planSupervisionRemediation({
      policy: policy(),
      sup: { ...baseSup, workflowPatchCount: 0 },
      workflow: stepAddressedWf,
      session: failedAtWorker,
      failIncident: {
        category: "failure",
        summary: "same error for repeat",
      },
    });
    expect(p.kind).toBe("patch-then-rerun");
    if (p.kind === "patch-then-rerun") {
      expect(p.remediationAction).toBe("patch-workflow");
      expect(p.patchRecordReason.length).toBeGreaterThan(10);
    }
  });

  test("a different error after a prior failure yields rerun only, not patch", () => {
    const p = planSupervisionRemediation({
      policy: policy(),
      sup: { ...baseSup, workflowPatchCount: 0 },
      workflow: stepAddressedWf,
      session: failedAtWorker,
      failIncident: {
        category: "failure",
        summary: "new error after the first failure",
      },
    });
    expect(p.kind).toBe("rerun");
    if (p.kind === "rerun") {
      expect(p.remediationAction).toBe("rerun-step");
    }
  });

  test("exhausted patch budget stops", () => {
    const p = planSupervisionRemediation({
      policy: policy({ maxWorkflowPatches: 0 }),
      sup: { ...baseSup, workflowPatchCount: 0 },
      workflow: stepAddressedWf,
      session: failedAtWorker,
      failIncident: {
        category: "failure",
        summary: "same error for repeat",
      },
    });
    expect(p.kind).toBe("stop-patch-budget");
  });

  test("first stall incident does not escalate to patch", () => {
    const p = planSupervisionRemediation({
      policy: policy(),
      sup: { ...baseSup, incidents: [] },
      workflow: stepAddressedWf,
      session: failedAtWorker,
      failIncident: { category: "stall", summary: "no progress" },
    });
    expect(p.kind).toBe("rerun");
  });

  test("repeat stall with same summary escalates like repeated failure", () => {
    const stallMsg = formatSupervisionStallError(60_000);
    const p = planSupervisionRemediation({
      policy: policy(),
      sup: {
        ...baseSup,
        incidents: [
          {
            incidentId: "i-stall-1",
            supervisedAttemptId: "sa1",
            category: "stall" as const,
            summary: stallMsg,
            detectedAt: "t",
          },
        ],
      },
      workflow: stepAddressedWf,
      session: failedAtWorker,
      failIncident: { category: "stall", summary: stallMsg },
    });
    expect(p.kind).toBe("patch-then-rerun");
    if (p.kind === "patch-then-rerun") {
      expect(p.patchRecordReason).toContain("stall");
    }
  });

  test("repeat failure still escalates when a stall incident was recorded after the prior failure", () => {
    const p = planSupervisionRemediation({
      policy: policy(),
      sup: {
        ...baseSup,
        incidents: [
          {
            incidentId: "i1",
            supervisedAttemptId: "sa1",
            category: "failure" as const,
            summary: "same error for repeat",
            detectedAt: "t",
          },
          {
            incidentId: "i-stall",
            supervisedAttemptId: "sa2",
            category: "stall" as const,
            summary: "supervision stall: test",
            detectedAt: "t2",
          },
        ],
      },
      workflow: stepAddressedWf,
      session: failedAtWorker,
      failIncident: {
        category: "failure",
        summary: "same error for repeat",
      },
    });
    expect(p.kind).toBe("patch-then-rerun");
  });
});

const lo = {} as LoadOptions;

describe("formatSupervisionStallError / isSupervisionStallLastError", () => {
  test("isSupervisionStallLastError matches prefix and format", () => {
    const msg = formatSupervisionStallError(1_200);
    expect(isSupervisionStallLastError(msg)).toBe(true);
    expect(isSupervisionStallLastError(undefined)).toBe(false);
    expect(isSupervisionStallLastError("other")).toBe(false);
  });
});

describe("buildSupervisionStallWatch", () => {
  test("returns watch when session has policy", () => {
    const session = {
      sessionId: "sess-1",
      workflowName: "n",
      workflowId: "wid",
      supervision: {
        supervisionRunId: "sup-1",
        targetWorkflowId: "wid",
        superviserWorkflowId: "s",
        status: "running" as const,
        attemptCount: 1,
        workflowPatchCount: 0,
        policy: {
          enabled: true as const,
          monitorIntervalMs: 1_000,
          stallTimeoutMs: 9_000,
          maxSupervisedAttempts: 2,
          maxWorkflowPatches: 0,
          workflowMutationMode: "execution-copy" as const,
        },
        incidents: [],
        remediations: [],
      },
    } as unknown as WorkflowSessionState;
    const w = buildSupervisionStallWatch(session, lo);
    expect(w).toEqual({
      sessionId: "sess-1",
      monitorIntervalMs: 1_000,
      stallTimeoutMs: 9_000,
      loadOptions: lo,
    });
  });

  test("returns undefined when policy is missing", () => {
    const session: Pick<WorkflowSessionState, "sessionId" | "supervision"> = {
      sessionId: "a",
      supervision: {
        supervisionRunId: "x",
        targetWorkflowId: "t",
        superviserWorkflowId: "d",
        status: "running",
        attemptCount: 0,
        workflowPatchCount: 0,
        incidents: [],
      } as const,
    };
    expect(buildSupervisionStallWatch(session, lo)).toBeUndefined();
  });
});
