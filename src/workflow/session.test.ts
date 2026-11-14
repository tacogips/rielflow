import { describe, expect, test } from "vitest";
import {
  normalizeSessionState,
  persistNodeBackendSession,
  resolveCurrentStepId,
  resolveCurrentStepIdFromWorkflow,
  resolveRequestedBackendSession,
  type CommunicationRecord,
  type WorkflowSessionState,
} from "./session";
import type { AgentNodePayload } from "./types";

function makeSession(
  overrides: Partial<WorkflowSessionState> = {},
): WorkflowSessionState {
  return {
    sessionId: "sess-1",
    workflowName: "example",
    workflowId: "example",
    status: "running",
    startedAt: "2026-04-24T00:00:00.000Z",
    queue: [],
    nodeExecutionCounter: 0,
    nodeExecutionCounts: {},
    loopIterationCounts: {},
    restartCounts: {},
    restartEvents: [],
    transitions: [],
    nodeExecutions: [],
    communicationCounter: 0,
    communications: [],
    conversationTurns: [],
    nodeBackendSessions: {},
    pendingOptionalNodeDecisions: [],
    activeUserActions: [],
    runtimeVariables: {},
    ...overrides,
  };
}

function makeReusableAgentNode(
  overrides: Partial<AgentNodePayload> = {},
): AgentNodePayload {
  return {
    id: "review-step",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "review",
    variables: {},
    sessionPolicy: { mode: "reuse" },
    ...overrides,
  };
}

describe("normalizeSessionState", () => {
  test("normalizes non-external communication routingScope values on load", () => {
    const sampleComm = {
      workflowId: "wf",
      workflowExecutionId: "sess-1",
      communicationId: "comm-1",
      fromNodeId: "a",
      toNodeId: "b",
      routingScope: "obsolete-or-unknown-in-graph-label",
      sourceNodeExecId: "exec-1",
      payloadRef: {
        workflowExecutionId: "sess-1",
        workflowId: "wf",
        outputNodeId: "a",
        nodeExecId: "exec-1",
        artifactDir: "/tmp/x",
      },
      deliveryKind: "edge-transition" as const,
      transitionWhen: "edge",
      status: "delivered" as const,
      deliveryAttemptIds: ["attempt-1"],
      activeDeliveryAttemptId: "attempt-1",
      createdAt: "2026-04-24T00:00:00.000Z",
      deliveredAt: "2026-04-24T00:00:00.000Z",
      artifactDir: "/tmp/comm",
    } as unknown as CommunicationRecord;

    const normalized = normalizeSessionState(
      makeSession({ communications: [sampleComm] }),
    );
    expect(normalized.communications[0]?.routingScope).toBe("intra-workflow");

    const external = normalizeSessionState(
      makeSession({
        communications: [{ ...sampleComm, routingScope: "external-mailbox" }],
      }),
    );
    expect(external.communications[0]?.routingScope).toBe("external-mailbox");
  });

  test("clones supervision incidents array", () => {
    const incident = {
      incidentId: "i1",
      supervisedAttemptId: "a1",
      category: "failure" as const,
      summary: "x",
      detectedAt: "2026-01-01T00:00:00.000Z",
    };
    const base = makeSession({
      supervision: {
        supervisionRunId: "sr1",
        targetWorkflowId: "target",
        superviserWorkflowId: "sup",
        status: "running",
        attemptCount: 1,
        workflowPatchCount: 0,
        incidents: [incident],
      },
    });
    const n = normalizeSessionState(base);
    expect(n.supervision?.incidents).not.toBe(base.supervision?.incidents);
    expect(n.supervision?.incidents).toEqual(base.supervision?.incidents);
  });

  test("clones supervision remediations array when present", () => {
    const remediation = {
      remediationId: "r1",
      incidentId: "i1",
      decidedAt: "2026-01-01T00:00:00.000Z",
      action: "rerun-workflow" as const,
      reason: "x",
    };
    const base = makeSession({
      supervision: {
        supervisionRunId: "sr1",
        targetWorkflowId: "target",
        superviserWorkflowId: "sup",
        status: "running",
        attemptCount: 1,
        workflowPatchCount: 0,
        incidents: [],
        remediations: [remediation],
      },
    });
    const n = normalizeSessionState(base);
    expect(n.supervision?.remediations).not.toBe(
      base.supervision?.remediations,
    );
    expect(n.supervision?.remediations).toEqual(base.supervision?.remediations);
  });
});

describe("resolveCurrentStepId", () => {
  test("returns null when no current node is active", () => {
    expect(resolveCurrentStepId(makeSession())).toBeNull();
  });

  test("returns null when executions lack stepId and currentNodeId is only a node registry id", () => {
    expect(
      resolveCurrentStepId(
        makeSession({
          currentNodeId: "worker-node",
          nodeExecutions: [
            {
              nodeId: "worker-node",
              nodeExecId: "exec-1",
              status: "succeeded",
              artifactDir: "/tmp/artifacts/exec-1",
              startedAt: "2026-04-24T00:00:00.000Z",
              endedAt: "2026-04-24T00:00:01.000Z",
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  test("returns the step id for step-addressed executions", () => {
    expect(
      resolveCurrentStepId(
        makeSession({
          currentNodeId: "review-step",
          nodeExecutions: [
            {
              nodeId: "review-step",
              stepId: "review-step",
              nodeRegistryId: "writer-node",
              nodeExecId: "exec-2",
              status: "succeeded",
              artifactDir: "/tmp/artifacts/exec-2",
              startedAt: "2026-04-24T00:00:00.000Z",
              endedAt: "2026-04-24T00:00:01.000Z",
            },
          ],
        }),
      ),
    ).toBe("review-step");
  });

  test("prefers the latest execution step id when currentNodeId matches node registry id", () => {
    expect(
      resolveCurrentStepId(
        makeSession({
          currentNodeId: "writer-node",
          nodeExecutions: [
            {
              nodeId: "writer-node",
              stepId: "draft-step",
              nodeRegistryId: "writer-node",
              nodeExecId: "exec-1",
              status: "succeeded",
              artifactDir: "/tmp/artifacts/exec-1",
              startedAt: "2026-04-24T00:00:00.000Z",
              endedAt: "2026-04-24T00:00:01.000Z",
            },
            {
              nodeId: "writer-node",
              stepId: "review-step",
              nodeRegistryId: "writer-node",
              nodeExecId: "exec-2",
              status: "succeeded",
              artifactDir: "/tmp/artifacts/exec-2",
              startedAt: "2026-04-24T00:00:02.000Z",
              endedAt: "2026-04-24T00:00:03.000Z",
            },
          ],
        }),
      ),
    ).toBe("review-step");
  });

  test("does not misreport a node id as the current step id in mixed step-addressed sessions", () => {
    expect(
      resolveCurrentStepId(
        makeSession({
          currentNodeId: "writer-node",
          nodeExecutions: [
            {
              nodeId: "writer-node",
              stepId: "draft-step",
              nodeRegistryId: "writer-node",
              nodeExecId: "exec-1",
              status: "succeeded",
              artifactDir: "/tmp/artifacts/exec-1",
              startedAt: "2026-04-24T00:00:00.000Z",
              endedAt: "2026-04-24T00:00:01.000Z",
            },
            {
              nodeId: "review-node",
              stepId: "review-step",
              nodeRegistryId: "review-node",
              nodeExecId: "exec-2",
              status: "succeeded",
              artifactDir: "/tmp/artifacts/exec-2",
              startedAt: "2026-04-24T00:00:02.000Z",
              endedAt: "2026-04-24T00:00:03.000Z",
            },
          ],
        }),
      ),
    ).toBe("draft-step");

    expect(
      resolveCurrentStepId(
        makeSession({
          currentNodeId: "future-worker-node",
          nodeExecutions: [
            {
              nodeId: "writer-node",
              stepId: "draft-step",
              nodeRegistryId: "writer-node",
              nodeExecId: "exec-1",
              status: "succeeded",
              artifactDir: "/tmp/artifacts/exec-1",
              startedAt: "2026-04-24T00:00:00.000Z",
              endedAt: "2026-04-24T00:00:01.000Z",
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  test("falls back to the authored current step when no execution record exists yet", () => {
    expect(
      resolveCurrentStepIdFromWorkflow(
        makeSession({
          currentNodeId: "review-step",
        }),
        {
          steps: [
            {
              id: "review-step",
              nodeId: "writer-node",
            },
          ],
        },
      ),
    ).toBe("review-step");
  });
});

describe("resolveRequestedBackendSession", () => {
  test("prefers the latest compatible session whose source provenance matches inheritFromStepId", () => {
    const session = makeSession({
      nodeBackendSessions: {
        "implement-step": {
          nodeId: "implement-step",
          stepId: "implement-step",
          nodeRegistryId: "writer-node",
          sourceStepId: "implement-step",
          lastStepId: "implement-step",
          backend: "codex-agent",
          provider: "provider-a",
          sessionId: "session-1",
          createdAt: "2026-04-24T00:00:00.000Z",
          updatedAt: "2026-04-24T00:00:00.000Z",
          lastNodeExecId: "exec-1",
        },
        "review-step": {
          nodeId: "review-step",
          stepId: "review-step",
          nodeRegistryId: "writer-node",
          sourceStepId: "implement-step",
          lastStepId: "review-step",
          backend: "codex-agent",
          provider: "provider-b",
          sessionId: "session-2",
          createdAt: "2026-04-24T00:00:00.000Z",
          updatedAt: "2026-04-24T00:01:00.000Z",
          lastNodeExecId: "exec-2",
        },
      },
    });

    expect(
      resolveRequestedBackendSession({
        session,
        node: makeReusableAgentNode(),
        sessionLookupNodeId: "implement-step",
        nodeRegistryId: "writer-node",
        inheritFromStepId: "implement-step",
      }),
    ).toEqual({
      mode: "reuse",
      sessionId: "session-2",
    });
  });
});

describe("persistNodeBackendSession", () => {
  test("preserves source-step provenance when an inheriting step refreshes the backend session id", () => {
    const next = persistNodeBackendSession({
      session: makeSession({
        nodeBackendSessions: {
          "implement-step": {
            nodeId: "implement-step",
            stepId: "implement-step",
            nodeRegistryId: "writer-node",
            sourceStepId: "implement-step",
            lastStepId: "implement-step",
            backend: "codex-agent",
            provider: "provider-a",
            sessionId: "session-1",
            createdAt: "2026-04-24T00:00:00.000Z",
            updatedAt: "2026-04-24T00:00:00.000Z",
            lastNodeExecId: "exec-1",
          },
        },
      }),
      node: makeReusableAgentNode(),
      stepId: "review-step",
      nodeRegistryId: "writer-node",
      inheritFromStepId: "implement-step",
      nodeExecId: "exec-2",
      provider: "provider-b",
      endedAt: "2026-04-24T00:01:00.000Z",
      backendSession: {
        mode: "reuse",
        sessionId: "session-1",
      },
      returnedSessionId: "session-2",
    });

    expect(next["review-step"]).toMatchObject({
      sourceStepId: "implement-step",
      lastStepId: "review-step",
      sessionId: "session-2",
    });
  });
});