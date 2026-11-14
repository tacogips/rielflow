import { describe, expect, test } from "vitest";
import {
  buildMergedContinuationTimeline,
  flattenedHistoryImportsForTimelinePrefix,
  resolveContinuationAnchorPlacement,
} from "./history-continuation";
import {
  createSessionState,
  normalizeSessionState,
  type WorkflowSessionState,
} from "./session";

function makeCompletedSession(
  overrides: Partial<WorkflowSessionState> & {
    readonly sessionId: string;
  },
): WorkflowSessionState {
  return normalizeSessionState({
    ...createSessionState({
      sessionId: overrides.sessionId,
      workflowName: "demo",
      workflowId: "wf-1",
      initialNodeId: "step-1",
      runtimeVariables: {},
    }),
    status: "completed",
    startedAt: "2026-05-01T00:00:00.000Z",
    endedAt: "2026-05-01T00:01:00.000Z",
    ...overrides,
  });
}

describe("history-continuation", () => {
  test("normalizes continuation metadata through JSON round-trip", () => {
    const session = normalizeSessionState({
      ...createSessionState({
        sessionId: "div-wf-00000000-abc",
        workflowName: "demo",
        workflowId: "wf-1",
        initialNodeId: "step-1",
        runtimeVariables: {},
      }),
      continuedFromWorkflowExecutionId: "div-src-00000000-src",
      continuedAfterStepRunId: "exec-anchor",
      continuedAfterExecutionOrdinal: 2,
      continuedStartStepId: "step-2",
      continuationMode: "rerun-from-history",
      historyImports: [
        {
          sourceWorkflowExecutionId: "div-src-00000000-src",
          throughStepRunId: "exec-anchor",
          throughExecutionOrdinal: 2,
        },
      ],
    });
    const roundTrip = normalizeSessionState(
      JSON.parse(JSON.stringify(session)) as WorkflowSessionState,
    );
    expect(roundTrip.continuedFromWorkflowExecutionId).toBe(
      "div-src-00000000-src",
    );
    expect(roundTrip.historyImports).toEqual(session.historyImports);
    expect(roundTrip.continuationMode).toBe("rerun-from-history");
  });

  test("strips invalid history import rows while keeping valid segments", () => {
    const raw = {
      ...createSessionState({
        sessionId: "div-wf-00000000-bad",
        workflowName: "demo",
        workflowId: "wf-1",
        initialNodeId: "step-1",
        runtimeVariables: {},
      }),
      historyImports: [
        {
          sourceWorkflowExecutionId: "",
          throughStepRunId: "x",
          throughExecutionOrdinal: 1,
        },
        {
          sourceWorkflowExecutionId: "div-src-00000000-ok",
          throughStepRunId: "exec-1",
          throughExecutionOrdinal: 1,
        },
      ],
    } as WorkflowSessionState;
    const normalized = normalizeSessionState(raw);
    expect(normalized.historyImports).toEqual([
      {
        sourceWorkflowExecutionId: "div-src-00000000-ok",
        throughStepRunId: "exec-1",
        throughExecutionOrdinal: 1,
      },
    ]);
  });

  test("resolves a plain-source anchor and summarizes history imports", () => {
    const source = makeCompletedSession({
      sessionId: "div-src-plain-00000001",
      nodeExecutions: [
        {
          nodeId: "step-1",
          stepId: "step-1",
          nodeExecId: "exec-a",
          executionOrdinal: 1,
          status: "succeeded",
          artifactDir: "/a",
          startedAt: "2026-05-01T00:00:00.000Z",
          endedAt: "2026-05-01T00:00:01.000Z",
        },
        {
          nodeId: "step-2",
          stepId: "step-2",
          nodeExecId: "exec-b",
          executionOrdinal: 2,
          status: "succeeded",
          artifactDir: "/b",
          startedAt: "2026-05-01T00:00:02.000Z",
          endedAt: "2026-05-01T00:00:03.000Z",
        },
      ],
      nodeExecutionCounter: 2,
    });
    const snapshots = new Map<string, WorkflowSessionState>([
      [source.sessionId, source],
    ]);
    const resolved = resolveContinuationAnchorPlacement({
      snapshots,
      sourceWorkflowExecutionId: source.sessionId,
      anchorStepRunId: "exec-b",
      expectedWorkflowId: "wf-1",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.value.flattenedHistoryImports).toEqual([
      {
        sourceWorkflowExecutionId: source.sessionId,
        throughStepRunId: "exec-b",
        throughExecutionOrdinal: 2,
      },
    ]);
    expect(
      flattenedHistoryImportsForTimelinePrefix(
        resolved.value.mergedTimelinePrefixThroughAnchor,
      ),
    ).toEqual(resolved.value.flattenedHistoryImports);
  });

  test("rejects non-terminal anchors", () => {
    const source = makeCompletedSession({
      sessionId: "div-src-fail-00000002",
      nodeExecutions: [
        {
          nodeId: "step-1",
          stepId: "step-1",
          nodeExecId: "exec-fail",
          executionOrdinal: 1,
          status: "failed",
          artifactDir: "/a",
          startedAt: "2026-05-01T00:00:00.000Z",
          endedAt: "2026-05-01T00:00:01.000Z",
        },
      ],
      nodeExecutionCounter: 1,
    });
    const resolved = resolveContinuationAnchorPlacement({
      snapshots: new Map([[source.sessionId, source]]),
      sourceWorkflowExecutionId: source.sessionId,
      anchorStepRunId: "exec-fail",
      expectedWorkflowId: "wf-1",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.error.kind).toBe("non_terminal_anchor");
  });

  test("rejects unknown anchor step run ids", () => {
    const source = makeCompletedSession({
      sessionId: "div-src-unknown-00000005",
      nodeExecutions: [
        {
          nodeId: "step-1",
          stepId: "step-1",
          nodeExecId: "exec-only",
          executionOrdinal: 1,
          status: "succeeded",
          artifactDir: "/a",
          startedAt: "2026-05-01T00:00:00.000Z",
          endedAt: "2026-05-01T00:00:01.000Z",
        },
      ],
      nodeExecutionCounter: 1,
    });
    const resolved = resolveContinuationAnchorPlacement({
      snapshots: new Map([[source.sessionId, source]]),
      sourceWorkflowExecutionId: source.sessionId,
      anchorStepRunId: "exec-missing",
      expectedWorkflowId: "wf-1",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.error.kind).toBe("unknown_step_run");
  });

  test("rejects ambiguous anchors when stepRunId repeats across merged owners", () => {
    const parent = makeCompletedSession({
      sessionId: "div-parent-dup-exec-id",
      nodeExecutions: [
        {
          nodeId: "step-1",
          stepId: "step-1",
          nodeExecId: "exec-000001",
          executionOrdinal: 1,
          status: "succeeded",
          artifactDir: "/p1",
          startedAt: "2026-05-01T00:00:00.000Z",
          endedAt: "2026-05-01T00:00:01.000Z",
        },
      ],
      nodeExecutionCounter: 1,
    });
    const child = makeCompletedSession({
      sessionId: "div-child-dup-exec-id",
      historyImports: [
        {
          sourceWorkflowExecutionId: parent.sessionId,
          throughStepRunId: "exec-000001",
          throughExecutionOrdinal: 1,
        },
      ],
      nodeExecutions: [
        {
          nodeId: "step-2",
          stepId: "step-2",
          nodeExecId: "exec-000001",
          executionOrdinal: 1,
          status: "succeeded",
          artifactDir: "/c1",
          startedAt: "2026-05-01T00:00:02.000Z",
          endedAt: "2026-05-01T00:00:03.000Z",
        },
      ],
      nodeExecutionCounter: 1,
    });
    const resolved = resolveContinuationAnchorPlacement({
      snapshots: new Map([
        [parent.sessionId, parent],
        [child.sessionId, child],
      ]),
      sourceWorkflowExecutionId: child.sessionId,
      anchorStepRunId: "exec-000001",
      expectedWorkflowId: "wf-1",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.error.kind).toBe("ambiguous_anchor_step_run");
  });

  test("rejects anchors when the workflow id does not match the expected bundle id", () => {
    const source = makeCompletedSession({
      sessionId: "div-src-wf-mismatch-00000006",
      workflowId: "wf-other",
      nodeExecutions: [
        {
          nodeId: "step-1",
          stepId: "step-1",
          nodeExecId: "exec-a",
          executionOrdinal: 1,
          status: "succeeded",
          artifactDir: "/a",
          startedAt: "2026-05-01T00:00:00.000Z",
          endedAt: "2026-05-01T00:00:01.000Z",
        },
      ],
      nodeExecutionCounter: 1,
    });
    const resolved = resolveContinuationAnchorPlacement({
      snapshots: new Map([[source.sessionId, source]]),
      sourceWorkflowExecutionId: source.sessionId,
      anchorStepRunId: "exec-a",
      expectedWorkflowId: "wf-1",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.error.kind).toBe("workflow_mismatch_at_anchor");
  });

  test("merges imported segments before local rows", () => {
    const upstream = makeCompletedSession({
      sessionId: "div-upstream-00000003",
      nodeExecutions: [
        {
          nodeId: "step-1",
          stepId: "step-1",
          nodeExecId: "exec-u1",
          executionOrdinal: 1,
          status: "succeeded",
          artifactDir: "/u1",
          startedAt: "2026-05-01T00:00:00.000Z",
          endedAt: "2026-05-01T00:00:01.000Z",
        },
      ],
      nodeExecutionCounter: 1,
    });
    const continued = makeCompletedSession({
      sessionId: "div-continued-00000004",
      historyImports: [
        {
          sourceWorkflowExecutionId: upstream.sessionId,
          throughStepRunId: "exec-u1",
          throughExecutionOrdinal: 1,
        },
      ],
      nodeExecutions: [
        {
          nodeId: "step-2",
          stepId: "step-2",
          nodeExecId: "exec-local",
          executionOrdinal: 1,
          status: "succeeded",
          artifactDir: "/l1",
          startedAt: "2026-05-01T00:00:10.000Z",
          endedAt: "2026-05-01T00:00:11.000Z",
        },
      ],
      nodeExecutionCounter: 1,
    });
    const snapshots = new Map<string, WorkflowSessionState>([
      [upstream.sessionId, upstream],
      [continued.sessionId, continued],
    ]);
    const merged = buildMergedContinuationTimeline(
      snapshots,
      continued.sessionId,
    );
    expect(merged.ok).toBe(true);
    if (!merged.ok) {
      return;
    }
    expect(merged.value.map((row) => row.stepRunId)).toEqual([
      "exec-u1",
      "exec-local",
    ]);
  });

  test("deduplicates timeline rows when history import segments overlap", () => {
    const grandparent = makeCompletedSession({
      sessionId: "div-gp-00000005",
      nodeExecutions: [
        {
          nodeId: "step-1",
          stepId: "step-1",
          nodeExecId: "exec-g1",
          executionOrdinal: 1,
          status: "succeeded",
          artifactDir: "/g1",
          startedAt: "2026-05-01T00:00:00.000Z",
          endedAt: "2026-05-01T00:00:01.000Z",
        },
      ],
      nodeExecutionCounter: 1,
    });
    const parent = makeCompletedSession({
      sessionId: "div-par-00000006",
      historyImports: [
        {
          sourceWorkflowExecutionId: grandparent.sessionId,
          throughStepRunId: "exec-g1",
          throughExecutionOrdinal: 1,
        },
      ],
      nodeExecutions: [
        {
          nodeId: "step-2",
          stepId: "step-2",
          nodeExecId: "exec-p1",
          executionOrdinal: 1,
          status: "succeeded",
          artifactDir: "/p1",
          startedAt: "2026-05-01T00:00:10.000Z",
          endedAt: "2026-05-01T00:00:11.000Z",
        },
      ],
      nodeExecutionCounter: 1,
    });
    const child = makeCompletedSession({
      sessionId: "div-ch-00000007",
      historyImports: [
        {
          sourceWorkflowExecutionId: grandparent.sessionId,
          throughStepRunId: "exec-g1",
          throughExecutionOrdinal: 1,
        },
        {
          sourceWorkflowExecutionId: parent.sessionId,
          throughStepRunId: "exec-p1",
          throughExecutionOrdinal: 1,
        },
      ],
      nodeExecutions: [
        {
          nodeId: "step-3",
          stepId: "step-3",
          nodeExecId: "exec-c1",
          executionOrdinal: 1,
          status: "succeeded",
          artifactDir: "/c1",
          startedAt: "2026-05-01T00:00:20.000Z",
          endedAt: "2026-05-01T00:00:21.000Z",
        },
      ],
      nodeExecutionCounter: 1,
    });
    const snapshots = new Map<string, WorkflowSessionState>([
      [grandparent.sessionId, grandparent],
      [parent.sessionId, parent],
      [child.sessionId, child],
    ]);
    const merged = buildMergedContinuationTimeline(
      snapshots,
      child.sessionId,
    );
    expect(merged.ok).toBe(true);
    if (!merged.ok) {
      return;
    }
    expect(merged.value.map((row) => row.stepRunId)).toEqual([
      "exec-g1",
      "exec-p1",
      "exec-c1",
    ]);
  });
});
