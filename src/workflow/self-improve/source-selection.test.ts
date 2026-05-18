import { describe, expect, test } from "vitest";
import { selectWorkflowSelfImproveSourceRuns } from "./source-selection";
import type { WorkflowSelfImproveSourceRun } from "./types";

const runs: readonly WorkflowSelfImproveSourceRun[] = [
  {
    sessionId: "run-old",
    workflowId: "demo",
    workflowName: "demo",
    status: "completed",
    updatedAt: "2026-05-18T01:00:00.000Z",
  },
  {
    sessionId: "run-new",
    workflowId: "demo",
    workflowName: "demo",
    status: "failed",
    updatedAt: "2026-05-18T03:00:00.000Z",
  },
  {
    sessionId: "other",
    workflowId: "other",
    workflowName: "other",
    status: "completed",
    updatedAt: "2026-05-18T04:00:00.000Z",
  },
];

describe("selectWorkflowSelfImproveSourceRuns", () => {
  test("falls back to latest runs when no marker exists", () => {
    expect(
      selectWorkflowSelfImproveSourceRuns({
        workflowName: "demo",
        workflowId: "demo",
        sourceMode: "since-last-or-latest",
        limit: 1,
        availableRuns: runs,
      }).map((run) => run.sessionId),
    ).toEqual(["run-new"]);
  });

  test("selects runs newer than the previous successful marker", () => {
    expect(
      selectWorkflowSelfImproveSourceRuns({
        workflowName: "demo",
        workflowId: "demo",
        sourceMode: "since-last-or-latest",
        limit: 10,
        marker: {
          selfImproveId: "sim-old",
          workflowName: "demo",
          workflowId: "demo",
          workflowDirectory: "/tmp/demo",
          completedAt: "2026-05-18T02:00:00.000Z",
          sourceSessionIds: ["run-old"],
        },
        availableRuns: runs,
      }).map((run) => run.sessionId),
    ).toEqual(["run-new"]);
  });

  test("does not fall back to latest when a marker exists and no runs are newer", () => {
    expect(
      selectWorkflowSelfImproveSourceRuns({
        workflowName: "demo",
        workflowId: "demo",
        sourceMode: "since-last-or-latest",
        limit: 10,
        marker: {
          selfImproveId: "sim-current",
          workflowName: "demo",
          workflowId: "demo",
          workflowDirectory: "/tmp/demo",
          completedAt: "2026-05-18T05:00:00.000Z",
          sourceSessionIds: ["run-new"],
        },
        availableRuns: runs,
      }),
    ).toEqual([]);
  });

  test("rejects explicit sessions outside the resolved workflow", () => {
    expect(() =>
      selectWorkflowSelfImproveSourceRuns({
        workflowName: "demo",
        workflowId: "demo",
        sourceMode: "explicit",
        limit: 10,
        explicitSessionIds: ["other"],
        availableRuns: runs,
      }),
    ).toThrow("does not belong to workflow");
  });
});
