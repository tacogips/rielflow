import { describe, expect, test } from "vitest";
import {
  createSupervisorRunnerPool as createRootSupervisorRunnerPool,
  getSupervisionSummary,
} from "./lib";
import { createSessionState } from "./workflow/session";
import {
  createSupervisorRunnerPool as createCoreSupervisorRunnerPool,
  type SupervisorRunnerPool as CoreSupervisorRunnerPool,
} from "../../divedra-core/src/index";

describe("getSupervisionSummary", () => {
  test("returns undefined when the session has no supervision block", () => {
    const session = createSessionState({
      sessionId: "s1",
      workflowName: "w",
      workflowId: "w",
      initialNodeId: "m",
      runtimeVariables: {},
    });
    expect(getSupervisionSummary(session)).toBeUndefined();
  });

  test("maps stored supervision to a summary with latest incident id", () => {
    const session = {
      ...createSessionState({
        sessionId: "s1",
        workflowName: "w",
        workflowId: "w",
        initialNodeId: "m",
        runtimeVariables: {},
      }),
      supervision: {
        supervisionRunId: "run-a",
        targetWorkflowId: "target-wf",
        superviserWorkflowId: "sup-wf",
        status: "running" as const,
        attemptCount: 3,
        workflowPatchCount: 1,
        incidents: [
          {
            incidentId: "i1",
            supervisedAttemptId: "t1",
            category: "failure" as const,
            summary: "first",
            detectedAt: "2026-04-25T00:00:00.000Z",
          },
          {
            incidentId: "i2",
            supervisedAttemptId: "t2",
            category: "stall" as const,
            summary: "second",
            detectedAt: "2026-04-25T00:01:00.000Z",
          },
        ],
      },
    };
    const summary = getSupervisionSummary(session);
    expect(summary?.latestIncidentId).toBe("i2");
    expect(summary?.attemptCount).toBe(3);
    expect(summary?.status).toBe("running");
    expect(summary?.superviserWorkflowId).toBe("sup-wf");
    expect(summary?.workflowPatchCount).toBe(1);
    expect(summary?.latestRemediationId).toBeUndefined();
    expect(summary?.nestedSuperviserSessionId).toBeUndefined();
  });

  test("includes nestedSuperviserSessionId when present on supervision", () => {
    const session = {
      ...createSessionState({
        sessionId: "s1",
        workflowName: "w",
        workflowId: "w",
        initialNodeId: "m",
        runtimeVariables: {},
      }),
      supervision: {
        supervisionRunId: "run-n",
        targetWorkflowId: "target-wf",
        superviserWorkflowId: "sup-wf",
        status: "running" as const,
        attemptCount: 0,
        workflowPatchCount: 0,
        nestedSuperviserSessionId: "nested-sess-1",
        incidents: [],
      },
    };
    expect(getSupervisionSummary(session)?.nestedSuperviserSessionId).toBe(
      "nested-sess-1",
    );
  });

  test("maps latest remediation id when remediations are present", () => {
    const session = {
      ...createSessionState({
        sessionId: "s1",
        workflowName: "w",
        workflowId: "w",
        initialNodeId: "m",
        runtimeVariables: {},
      }),
      supervision: {
        supervisionRunId: "run-b",
        targetWorkflowId: "target-wf",
        superviserWorkflowId: "sup-wf",
        status: "running" as const,
        attemptCount: 1,
        workflowPatchCount: 2,
        incidents: [],
        remediations: [
          {
            remediationId: "r1",
            incidentId: "i1",
            decidedAt: "2026-04-25T00:00:00.000Z",
            action: "rerun-workflow" as const,
            reason: "retry",
          },
          {
            remediationId: "r2",
            incidentId: "i2",
            decidedAt: "2026-04-25T00:01:00.000Z",
            action: "patch-workflow" as const,
            reason: "defect",
          },
        ],
      },
    };
    const summary = getSupervisionSummary(session);
    expect(summary?.latestRemediationId).toBe("r2");
    expect(summary?.workflowPatchCount).toBe(2);
  });
});

describe("public supervision exports", () => {
  test("root and divedra-core expose the runner-pool surface", () => {
    expect(createRootSupervisorRunnerPool).toBe(createCoreSupervisorRunnerPool);
    const methods = [
      "dispatch",
      "lookup",
      "cancel",
      "wait",
      "lookupHandle",
      "lookupHandles",
    ] as const;
    const assertSurface = (
      pool: CoreSupervisorRunnerPool,
    ): CoreSupervisorRunnerPool => {
      for (const method of methods) {
        expect(typeof pool[method]).toBe("function");
      }
      return pool;
    };
    expect(assertSurface).toBeTypeOf("function");
  });
});
