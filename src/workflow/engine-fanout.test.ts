import { describe, expect, test } from "bun:test";
import {
  buildFanoutGroupRunRecord,
  buildFanoutJoinAggregate,
  reduceFanoutBranchResults,
} from "./engine-fanout";
import {
  createSessionState,
  type FanoutBranchRecord,
  type OutputRef,
} from "./session";

function makeOutputRef(nodeExecId: string): OutputRef {
  return {
    kind: "node-output",
    workflowExecutionId: "sess-fanout",
    workflowId: "wf-fanout",
    outputNodeId: "reviewer",
    outputStepId: "reviewer",
    nodeExecId,
    artifactDir: `/tmp/${nodeExecId}`,
  };
}

function makeBranch(
  branchIndex: number,
  status: FanoutBranchRecord["status"],
  extras: Partial<FanoutBranchRecord> = {},
): FanoutBranchRecord {
  return {
    branchIndex,
    item: { id: `feature-${branchIndex}` },
    status,
    workItemId: `fanout-local-exec:${branchIndex}`,
    ...extras,
  };
}

function makeGroup(branches: readonly FanoutBranchRecord[]) {
  return buildFanoutGroupRunRecord({
    fanoutGroupRunId: "fanout-local-exec",
    groupId: "local",
    sourceStepId: "writer",
    sourceNodeExecId: "exec-writer",
    transitionLabel: "ready",
    targetStepId: "reviewer",
    joinStepId: "join",
    concurrency: 1,
    failurePolicy: "fail-fast",
    resultOrder: "input",
    branches,
  });
}

function makeSession() {
  return createSessionState({
    sessionId: "sess-fanout",
    workflowName: "fanout-workflow",
    workflowId: "wf-fanout",
    initialNodeId: "writer",
    runtimeVariables: { base: true },
  });
}

describe("engine fanout helpers", () => {
  test("reduces paused branches to a paused session with branch diagnostics", () => {
    const session = makeSession();
    const group = makeGroup([
      makeBranch(0, "succeeded", { outputRef: makeOutputRef("exec-a") }),
      makeBranch(1, "paused", { error: "awaiting user action" }),
      makeBranch(2, "pending"),
    ]);

    const reduction = reduceFanoutBranchResults({
      group,
      priorFanoutGroups: [],
      workingSession: session,
    });

    expect(reduction.outcome).toBe("paused");
    if (reduction.outcome !== "paused") {
      return;
    }
    expect(reduction.fanoutGroups).toEqual([group]);
    expect(reduction.session.status).toBe("paused");
    expect(reduction.session.fanoutGroups).toEqual([group]);
    expect(reduction.session.lastError).toBe("branch 1: awaiting user action");
    expect(reduction.pausedMessage).toBe(
      "fanout group 'fanout-local-exec' paused: branch 1: awaiting user action",
    );
  });

  test("reduces failed and cancelled branches to a failure message without mutating the session status", () => {
    const session = makeSession();
    const group = makeGroup([
      makeBranch(0, "failed", { error: "provider failed" }),
      makeBranch(1, "cancelled", {
        error: "fanout fail-fast stopped before branch launch",
      }),
    ]);

    const reduction = reduceFanoutBranchResults({
      group,
      priorFanoutGroups: [],
      workingSession: session,
    });

    expect(reduction.outcome).toBe("failed");
    if (reduction.outcome !== "failed") {
      return;
    }
    expect(reduction.session).toBe(session);
    expect(reduction.failureMessage).toBe(
      "fanout group 'fanout-local-exec' failed: branch 0: provider failed; branch 1: fanout fail-fast stopped before branch launch",
    );
  });

  test("builds deterministic join aggregates from successful branch records", () => {
    const outputRef = makeOutputRef("exec-a");
    const group = makeGroup([
      makeBranch(0, "succeeded", {
        outputRef,
        workspaceRoot: "/tmp/workspaces/branch-0",
      }),
      makeBranch(1, "succeeded"),
    ]);

    const aggregate = buildFanoutJoinAggregate({ group });

    expect(aggregate).toEqual({
      fanoutGroupRunId: "fanout-local-exec",
      groupId: "local",
      sourceStepId: "writer",
      resultOrder: "input",
      results: [
        {
          branchIndex: 0,
          item: { id: "feature-0" },
          status: "succeeded",
          outputRef,
          workspaceRoot: "/tmp/workspaces/branch-0",
        },
        {
          branchIndex: 1,
          item: { id: "feature-1" },
          status: "succeeded",
        },
      ],
    });
  });
});
