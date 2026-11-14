import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createSessionState } from "../session";
import { saveSession } from "../session-store";
import {
  discoverWorkflowSourceRuns,
  selectWorkflowSelfImproveSourceRuns,
} from "./source-selection";
import type { WorkflowSelfImproveSourceRun } from "./types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-self-improve-source-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

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

  test("discovers runtime-db indexed sessions through file-backed state", async () => {
    const root = await makeTempDir();
    const options = {
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "runtime-data"),
    };
    const session = {
      ...createSessionState({
        sessionId: "run-indexed",
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "manager",
        runtimeVariables: {},
      }),
      status: "completed" as const,
      endedAt: "2026-05-18T03:00:00.000Z",
    };
    const saved = await saveSession(session, options);
    expect(saved.ok).toBe(true);

    await expect(
      discoverWorkflowSourceRuns(
        { workflowName: "demo", workflowId: "demo" },
        options,
      ),
    ).resolves.toMatchObject([{ sessionId: "run-indexed" }]);
  });

  test("falls back to file-backed sessions when runtime-db rows are stale", async () => {
    const root = await makeTempDir();
    const options = {
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "runtime-data"),
    };
    const staleSession = createSessionState({
      sessionId: "run-stale",
      workflowName: "demo",
      workflowId: "demo",
      initialNodeId: "manager",
      runtimeVariables: {},
    });
    const fileOnlySession = createSessionState({
      sessionId: "run-file-only",
      workflowName: "demo",
      workflowId: "demo",
      initialNodeId: "manager",
      runtimeVariables: {},
    });
    expect((await saveSession(staleSession, options)).ok).toBe(true);
    expect((await saveSession(fileOnlySession, options)).ok).toBe(true);
    await rm(path.join(options.sessionStoreRoot, "run-stale.json"));

    await expect(
      discoverWorkflowSourceRuns(
        { workflowName: "demo", workflowId: "demo" },
        options,
      ).then((sourceRuns) => sourceRuns.map((run) => run.sessionId)),
    ).resolves.toEqual(["run-file-only"]);
  });
});
