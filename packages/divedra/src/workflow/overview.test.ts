import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterAll } from "vitest";
import {
  buildWorkflowCatalogOverview,
  buildWorkflowStatusOverview,
  compareWorkflowExecutionsNewestFirst,
  countActiveWorkflowExecutions,
  deriveWorkflowOverviewStatus,
  isWorkflowExecutionSummaryActive,
  parseWorkflowOverviewAggregateStatusFilter,
  pickNewestActiveExecution,
  selectDefaultWorkflowOverviewRow,
  sortWorkflowExecutionsNewestFirst,
  type WorkflowOverviewRow,
} from "./overview";
import type { WorkflowExecutionCompactSummary } from "../shared/ui-contract";
import { createSessionState } from "./session";
import { saveSession } from "./session-store";
import { saveSessionSnapshotToRuntimeDb } from "./runtime-db";
import { withResolvedWorkflowSourceOptions } from "./catalog";
import type { ResolvedWorkflowSource } from "./types";

function compact(
  overrides: Partial<WorkflowExecutionCompactSummary> &
    Pick<
      WorkflowExecutionCompactSummary,
      "workflowExecutionId" | "workflowName" | "status" | "startedAt"
    >,
): WorkflowExecutionCompactSummary {
  return {
    sessionId: overrides.workflowExecutionId,
    currentNodeId: null,
    nodeExecutionCounter: 0,
    endedAt: null,
    ...overrides,
  };
}

describe("pickNewestActiveExecution", () => {
  it("returns null when nothing is active", () => {
    expect(
      pickNewestActiveExecution([
        compact({
          workflowExecutionId: "x",
          workflowName: "w",
          status: "completed",
          startedAt: "2026-05-03T01:00:00.000Z",
        }),
      ]),
    ).toBeNull();
  });

  it("returns newest started among active executions", () => {
    const oldPaused = compact({
      workflowExecutionId: "old",
      workflowName: "w",
      status: "paused",
      startedAt: "2026-05-01T01:00:00.000Z",
    });
    const newRunning = compact({
      workflowExecutionId: "new",
      workflowName: "w",
      status: "running",
      startedAt: "2026-05-10T01:00:00.000Z",
    });
    expect(pickNewestActiveExecution([oldPaused, newRunning])).toMatchObject({
      workflowExecutionId: "new",
    });
  });
});

describe("compareWorkflowExecutionsNewestFirst", () => {
  it("orders by startedAt descending", () => {
    const a = compact({
      workflowExecutionId: "a",
      workflowName: "w",
      status: "completed",
      startedAt: "2026-05-01T10:00:00.000Z",
    });
    const b = compact({
      workflowExecutionId: "b",
      workflowName: "w",
      status: "completed",
      startedAt: "2026-05-02T10:00:00.000Z",
    });
    expect(compareWorkflowExecutionsNewestFirst(a, b)).toBeGreaterThan(0);
    expect(compareWorkflowExecutionsNewestFirst(b, a)).toBeLessThan(0);
  });

  it("ties startedAt with workflowExecutionId descending lexicographic", () => {
    const a = compact({
      workflowExecutionId: "exec-a",
      workflowName: "w",
      status: "completed",
      startedAt: "2026-05-01T10:00:00.000Z",
    });
    const b = compact({
      workflowExecutionId: "exec-b",
      workflowName: "w",
      status: "completed",
      startedAt: "2026-05-01T10:00:00.000Z",
    });
    expect(compareWorkflowExecutionsNewestFirst(a, b)).toBeGreaterThan(0);
  });
});

describe("sortWorkflowExecutionsNewestFirst", () => {
  it("does not mutate the input array", () => {
    const x = compact({
      workflowExecutionId: "1",
      workflowName: "w",
      status: "completed",
      startedAt: "2026-05-01T10:00:00.000Z",
    });
    const y = compact({
      workflowExecutionId: "2",
      workflowName: "w",
      status: "completed",
      startedAt: "2026-05-02T10:00:00.000Z",
    });
    const original = [x, y];
    sortWorkflowExecutionsNewestFirst(original);
    expect(original[0]?.workflowExecutionId).toBe("1");
  });
});

describe("countActiveWorkflowExecutions", () => {
  it("counts only running and paused", () => {
    expect(
      countActiveWorkflowExecutions([
        compact({
          workflowExecutionId: "1",
          workflowName: "w",
          status: "running",
          startedAt: "2026-05-01T10:00:00.000Z",
        }),
        compact({
          workflowExecutionId: "2",
          workflowName: "w",
          status: "paused",
          startedAt: "2026-05-01T09:00:00.000Z",
        }),
        compact({
          workflowExecutionId: "3",
          workflowName: "w",
          status: "completed",
          startedAt: "2026-05-01T08:00:00.000Z",
        }),
      ]),
    ).toBe(2);
  });
});

describe("isWorkflowExecutionSummaryActive", () => {
  it("matches the workflow overview active statuses", () => {
    expect(
      isWorkflowExecutionSummaryActive(
        compact({
          workflowExecutionId: "run",
          workflowName: "w",
          status: "running",
          startedAt: "2026-05-01T10:00:00.000Z",
        }),
      ),
    ).toBe(true);
    expect(
      isWorkflowExecutionSummaryActive(
        compact({
          workflowExecutionId: "done",
          workflowName: "w",
          status: "completed",
          startedAt: "2026-05-01T10:00:00.000Z",
        }),
      ),
    ).toBe(false);
  });
});

describe("deriveWorkflowOverviewStatus", () => {
  it("returns never-run for empty executions", () => {
    expect(deriveWorkflowOverviewStatus([])).toBe("never-run");
  });

  it("prefers running over paused and terminals", () => {
    expect(
      deriveWorkflowOverviewStatus([
        compact({
          workflowExecutionId: "old",
          workflowName: "w",
          status: "completed",
          startedAt: "2026-05-01T08:00:00.000Z",
        }),
        compact({
          workflowExecutionId: "p",
          workflowName: "w",
          status: "paused",
          startedAt: "2026-05-01T09:00:00.000Z",
        }),
        compact({
          workflowExecutionId: "r",
          workflowName: "w",
          status: "running",
          startedAt: "2026-05-01T07:00:00.000Z",
        }),
      ]),
    ).toBe("running");
  });

  it("prefers paused when no running", () => {
    expect(
      deriveWorkflowOverviewStatus([
        compact({
          workflowExecutionId: "c",
          workflowName: "w",
          status: "completed",
          startedAt: "2026-05-02T08:00:00.000Z",
        }),
        compact({
          workflowExecutionId: "p",
          workflowName: "w",
          status: "paused",
          startedAt: "2026-05-01T09:00:00.000Z",
        }),
      ]),
    ).toBe("paused");
  });

  it("uses newest terminal execution when no active", () => {
    expect(
      deriveWorkflowOverviewStatus([
        compact({
          workflowExecutionId: "old-fail",
          workflowName: "w",
          status: "failed",
          startedAt: "2026-05-01T08:00:00.000Z",
        }),
        compact({
          workflowExecutionId: "new-cancel",
          workflowName: "w",
          status: "cancelled",
          startedAt: "2026-05-02T08:00:00.000Z",
        }),
      ]),
    ).toBe("cancelled");
  });

  it("uses newest terminal by startedAt then execution id tie-break", () => {
    expect(
      deriveWorkflowOverviewStatus([
        compact({
          workflowExecutionId: "exec-z",
          workflowName: "w",
          status: "failed",
          startedAt: "2026-05-01T08:00:00.000Z",
        }),
        compact({
          workflowExecutionId: "exec-a",
          workflowName: "w",
          status: "completed",
          startedAt: "2026-05-01T08:00:00.000Z",
        }),
      ]),
    ).toBe("failed");
  });
});

const overviewTempDirs: string[] = [];

async function overviewMakeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "divedra-overview-test-"));
  overviewTempDirs.push(dir);
  return dir;
}

async function overviewWriteBundle(input: {
  readonly workflowDirectory: string;
  readonly workflowId: string;
  readonly description: string;
}): Promise<void> {
  await mkdir(input.workflowDirectory, { recursive: true });
  await writeFile(
    path.join(input.workflowDirectory, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: input.workflowId,
        description: input.description,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

describe("buildWorkflowCatalogOverview", () => {
  afterAll(async () => {
    await Promise.all(
      overviewTempDirs.map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    );
  });

  it("labels direct workflow-root rows with scope direct and never-run sessions", async () => {
    const root = await overviewMakeTempDir();
    const workflowName = "alpha";
    await overviewWriteBundle({
      workflowDirectory: path.join(root, workflowName),
      workflowId: "alpha-canonical",
      description: "alpha desc",
    });
    const sessionStoreRoot = path.join(root, "sessions");

    const result = await buildWorkflowCatalogOverview(
      {},
      {
        workflowRoot: root,
        sessionStoreRoot,
        cwd: root,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflows).toHaveLength(1);
    const row = result.value.workflows[0];
    expect(row?.sourceScope).toBe("direct");
    expect(row?.workflowName).toBe(workflowName);
    expect(row?.workflowDirectory).toBe(path.join(root, workflowName));
    expect(row?.description).toBe("alpha desc");
    expect(row?.aggregateStatus).toBe("never-run");
    expect(row?.activeExecutionCount).toBe(0);
    expect(row?.latestExecution).toBeNull();
  });

  it("does not read sibling invalid bundles when fixedResolvedWorkflowSource pins one workflow", async () => {
    const root = await overviewMakeTempDir();
    const workflowName = "good";
    await overviewWriteBundle({
      workflowDirectory: path.join(root, workflowName),
      workflowId: "good-id",
      description: "ok",
    });
    await mkdir(path.join(root, "broken"), { recursive: true });
    await writeFile(
      path.join(root, "broken", "workflow.json"),
      "{ not json",
      "utf8",
    );

    const fixedSource: ResolvedWorkflowSource = {
      scope: "direct",
      workflowRoot: root,
      workflowName,
      workflowDirectory: path.join(root, workflowName),
    };

    const withoutPin = await buildWorkflowCatalogOverview(
      {},
      { workflowRoot: root, cwd: root },
    );
    expect(withoutPin.ok).toBe(false);

    const pinned = await buildWorkflowCatalogOverview(
      {},
      {
        workflowRoot: root,
        cwd: root,
        fixedResolvedWorkflowSource: fixedSource,
      },
    );
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) {
      return;
    }
    expect(pinned.value.workflows).toHaveLength(1);
    expect(pinned.value.workflows[0]?.workflowName).toBe(workflowName);
  });

  it("scopes sessions per catalog source workflowId", async () => {
    const root = await overviewMakeTempDir();
    const workflowName = "alpha";
    await overviewWriteBundle({
      workflowDirectory: path.join(root, workflowName),
      workflowId: "alpha-scope-a",
      description: "",
    });
    await overviewWriteBundle({
      workflowDirectory: path.join(root, "beta"),
      workflowId: "beta-id",
      description: "",
    });
    const sessionStoreRoot = path.join(root, "sessions");
    await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-alpha",
          workflowName,
          workflowId: "alpha-scope-a",
          initialNodeId: "n",
          runtimeVariables: {},
        }),
        status: "completed",
        endedAt: "2026-05-01T12:00:00.000Z",
      },
      {
        workflowRoot: root,
        sessionStoreRoot,
        cwd: root,
      },
    );
    await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-stray",
          workflowName,
          workflowId: "different-id",
          initialNodeId: "n",
          runtimeVariables: {},
        }),
        status: "running",
      },
      {
        workflowRoot: root,
        sessionStoreRoot,
        cwd: root,
      },
    );

    const catalog = await buildWorkflowCatalogOverview(
      {},
      { workflowRoot: root, sessionStoreRoot, cwd: root },
    );
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) {
      return;
    }
    const alphaRow = catalog.value.workflows.find(
      (entry) => entry.workflowName === "alpha",
    );
    expect(alphaRow?.aggregateStatus).toBe("completed");
    expect(alphaRow?.activeExecutionCount).toBe(0);
    expect(alphaRow?.latestExecution?.sessionId).toBe("sess-alpha");

    const betaRow = catalog.value.workflows.find(
      (entry) => entry.workflowName === "beta",
    );
    expect(betaRow?.aggregateStatus).toBe("never-run");
  });

  it("ignores unloadable session files when computing active catalog rows", async () => {
    const root = await overviewMakeTempDir();
    const workflowName = "alpha";
    await overviewWriteBundle({
      workflowDirectory: path.join(root, workflowName),
      workflowId: "alpha-id",
      description: "",
    });
    const sessionStoreRoot = path.join(root, "sessions");
    await mkdir(sessionStoreRoot, { recursive: true });
    await writeFile(
      path.join(sessionStoreRoot, "sess-corrupt-running.json"),
      "{ not valid json",
      "utf8",
    );
    await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-completed",
          workflowName,
          workflowId: "alpha-id",
          initialNodeId: "n",
          runtimeVariables: {},
        }),
        status: "completed",
        endedAt: "2026-05-01T12:00:00.000Z",
      },
      {
        workflowRoot: root,
        sessionStoreRoot,
        cwd: root,
      },
    );

    const catalog = await buildWorkflowCatalogOverview(
      {},
      { workflowRoot: root, sessionStoreRoot, cwd: root },
    );
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) {
      return;
    }
    const alphaRow = catalog.value.workflows.find(
      (entry) => entry.workflowName === workflowName,
    );
    expect(alphaRow?.aggregateStatus).toBe("completed");
    expect(alphaRow?.activeExecutionCount).toBe(0);
    expect(alphaRow?.latestExecution?.sessionId).toBe("sess-completed");
  });

  it("ignores stale runtime-db active rows without primary session files", async () => {
    const root = await overviewMakeTempDir();
    const workflowName = "alpha";
    await overviewWriteBundle({
      workflowDirectory: path.join(root, workflowName),
      workflowId: "alpha-id",
      description: "",
    });
    const rootDataDir = path.join(root, "data");
    const sessionStoreRoot = path.join(rootDataDir, "sessions");
    const baseOptions = { workflowRoot: root, rootDataDir, cwd: root };
    const staleSessionIds = [
      "div-alpha-1777861733-fe70502e",
      "div-alpha-1777861657-715d97aa",
      "div-alpha-1777861530-89aee9e0",
      "div-alpha-1777859505-fdeb86d3",
    ] as const;

    for (const sessionId of staleSessionIds) {
      await saveSessionSnapshotToRuntimeDb(
        {
          ...createSessionState({
            sessionId,
            workflowName,
            workflowId: "alpha-id",
            initialNodeId: "n",
            runtimeVariables: {},
          }),
          status: "running",
          startedAt: `2026-05-0${String(staleSessionIds.indexOf(sessionId) + 1)}T12:00:00.000Z`,
        },
        baseOptions,
      );
    }
    await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-terminal-loadable",
          workflowName,
          workflowId: "alpha-id",
          initialNodeId: "n",
          runtimeVariables: {},
        }),
        status: "completed",
        startedAt: "2026-05-10T12:00:00.000Z",
        endedAt: "2026-05-10T12:05:00.000Z",
      },
      baseOptions,
    );

    const catalog = await buildWorkflowCatalogOverview(
      {},
      { workflowRoot: root, sessionStoreRoot, rootDataDir, cwd: root },
    );
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) {
      return;
    }
    const alphaRow = catalog.value.workflows.find(
      (entry) => entry.workflowName === workflowName,
    );
    expect(alphaRow).toMatchObject({
      aggregateStatus: "completed",
      activeExecutionCount: 0,
      latestExecution: { sessionId: "sess-terminal-loadable" },
    });
    expect(staleSessionIds).not.toContain(alphaRow?.latestExecution?.sessionId);

    const status = await buildWorkflowStatusOverview(
      { workflowName },
      { workflowRoot: root, sessionStoreRoot, rootDataDir, cwd: root },
    );
    expect(status.ok).toBe(true);
    if (!status.ok) {
      return;
    }
    expect(status.value.aggregateStatus).toBe("completed");
    expect(status.value.activeExecutionCount).toBe(0);
    expect(status.value.newestActiveExecution).toBeNull();
    expect(status.value.recentExecutions).toHaveLength(1);
    expect(status.value.recentExecutions[0]?.sessionId).toBe(
      "sess-terminal-loadable",
    );
  });

  it("lists duplicate workflow names across project and user scopes separately", async () => {
    const base = await overviewMakeTempDir();
    const workspace = path.join(base, "projtree");
    const projectScopeRoot = path.join(workspace, ".divedra");
    const projectWorkflowRoot = path.join(projectScopeRoot, "workflows");
    const userScopeRoot = path.join(base, "userhome", ".divedra");
    const userWorkflowRoot = path.join(userScopeRoot, "workflows");
    await overviewWriteBundle({
      workflowDirectory: path.join(projectWorkflowRoot, "dup"),
      workflowId: "project-dup",
      description: "from project",
    });
    await overviewWriteBundle({
      workflowDirectory: path.join(userWorkflowRoot, "dup"),
      workflowId: "user-dup",
      description: "from user",
    });
    const baseOpts = {
      cwd: workspace,
      projectRoot: projectScopeRoot,
      userRoot: userScopeRoot,
    };
    const projectSource: ResolvedWorkflowSource = {
      scope: "project",
      workflowRoot: projectWorkflowRoot,
      workflowName: "dup",
      workflowDirectory: path.join(projectWorkflowRoot, "dup"),
      scopeRoot: projectScopeRoot,
    };
    const userSource: ResolvedWorkflowSource = {
      scope: "user",
      workflowRoot: userWorkflowRoot,
      workflowName: "dup",
      workflowDirectory: path.join(userWorkflowRoot, "dup"),
      scopeRoot: userScopeRoot,
    };
    await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-proj",
          workflowName: "dup",
          workflowId: "project-dup",
          initialNodeId: "step",
          runtimeVariables: {},
        }),
        startedAt: "2026-05-02T09:00:00.000Z",
        status: "completed",
        endedAt: "2026-05-02T09:05:00.000Z",
      },
      withResolvedWorkflowSourceOptions(projectSource, baseOpts),
    );
    await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-user",
          workflowName: "dup",
          workflowId: "user-dup",
          initialNodeId: "step",
          runtimeVariables: {},
        }),
        startedAt: "2026-05-02T08:00:00.000Z",
        status: "running",
      },
      withResolvedWorkflowSourceOptions(userSource, baseOpts),
    );

    const overview = await buildWorkflowCatalogOverview(
      { workflowScope: "auto" },
      baseOpts,
    );
    expect(overview.ok).toBe(true);
    if (!overview.ok) {
      return;
    }
    const dupRows = overview.value.workflows.filter(
      (entry) => entry.workflowName === "dup",
    );
    expect(dupRows).toHaveLength(2);
    const scopes = [...new Set(dupRows.map((r) => r.sourceScope))].sort();
    expect(scopes).toEqual(["project", "user"]);
    const projectRow = dupRows.find((entry) => entry.sourceScope === "project");
    expect(projectRow?.description).toBe("from project");
    expect(projectRow?.aggregateStatus).toBe("completed");
    expect(projectRow?.activeExecutionCount).toBe(0);
    const userRow = dupRows.find((entry) => entry.sourceScope === "user");
    expect(userRow?.description).toBe("from user");
    expect(userRow?.aggregateStatus).toBe("running");
    expect(userRow?.activeExecutionCount).toBe(1);
  });

  it("filters by aggregate status when requested", async () => {
    const root = await overviewMakeTempDir();
    await overviewWriteBundle({
      workflowDirectory: path.join(root, "idle"),
      workflowId: "idle",
      description: "",
    });
    await overviewWriteBundle({
      workflowDirectory: path.join(root, "busy"),
      workflowId: "busy",
      description: "",
    });
    const sessionStoreRoot = path.join(root, "sessions");
    await saveSession(
      createSessionState({
        sessionId: "sess-busy-running",
        workflowName: "busy",
        workflowId: "busy",
        initialNodeId: "n",
        runtimeVariables: {},
      }),
      { workflowRoot: root, sessionStoreRoot, cwd: root },
    );

    const filtered = await buildWorkflowCatalogOverview(
      { status: "never-run" },
      { workflowRoot: root, sessionStoreRoot, cwd: root },
    );
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) {
      return;
    }
    expect(
      filtered.value.workflows.every(
        (row) => row.aggregateStatus === "never-run",
      ),
    ).toBe(true);
    expect(filtered.value.workflows).toHaveLength(1);
    expect(filtered.value.workflows[0]?.workflowName).toBe("idle");
  });
});

describe("buildWorkflowStatusOverview", () => {
  it("returns recent executions limited by input.limit", async () => {
    const root = await overviewMakeTempDir();
    await overviewWriteBundle({
      workflowDirectory: path.join(root, "w"),
      workflowId: "w",
      description: "",
    });
    await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-old",
          workflowName: "w",
          workflowId: "w",
          initialNodeId: "n",
          runtimeVariables: {},
        }),
        startedAt: "2026-05-01T08:00:00.000Z",
        endedAt: "2026-05-01T08:05:00.000Z",
        status: "completed",
      },
      { workflowRoot: root, sessionStoreRoot: path.join(root, "s"), cwd: root },
    );
    await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-new",
          workflowName: "w",
          workflowId: "w",
          initialNodeId: "n",
          runtimeVariables: {},
        }),
        startedAt: "2026-05-02T08:00:00.000Z",
        endedAt: "2026-05-02T08:05:00.000Z",
        status: "failed",
      },
      { workflowRoot: root, sessionStoreRoot: path.join(root, "s"), cwd: root },
    );

    const st = await buildWorkflowStatusOverview(
      { workflowName: "w", limit: 1 },
      {
        workflowRoot: root,
        sessionStoreRoot: path.join(root, "s"),
        cwd: root,
      },
    );
    expect(st.ok).toBe(true);
    if (!st.ok) {
      return;
    }
    expect(st.value.recentExecutions).toHaveLength(1);
    expect(st.value.recentExecutions[0]?.sessionId).toBe("sess-new");
    expect(st.value.latestExecution?.sessionId).toBe("sess-new");
    expect(st.value.aggregateStatus).toBe("failed");
    expect(st.value.description).toBe("");
    expect(st.value.newestActiveExecution).toBeNull();
  });

  it("includes newestActiveExecution from full history when it falls outside limited recentExecutions", async () => {
    const root = await overviewMakeTempDir();
    const workflowName = "w";
    await overviewWriteBundle({
      workflowDirectory: path.join(root, workflowName),
      workflowId: "w",
      description: "",
    });
    const sessionStoreRoot = path.join(root, "s");
    const baseOpts = { workflowRoot: root, sessionStoreRoot, cwd: root };
    const artifactBase = path.join(root, "art");
    await saveSession(
      {
        ...createSessionState({
          sessionId: "sess-old-paused",
          workflowName: "w",
          workflowId: "w",
          initialNodeId: "step-node",
          runtimeVariables: {},
        }),
        startedAt: "2026-01-01T08:00:00.000Z",
        status: "paused",
        currentNodeId: "step-node",
        queue: ["step-node"],
        nodeExecutionCounter: 1,
        nodeExecutionCounts: {
          "step-node": 1,
        },
        nodeExecutions: [
          {
            nodeId: "step-node",
            stepId: "worker-step",
            nodeRegistryId: "step-node",
            nodeExecId: "exec-p",
            mailboxInstanceId: "exec-p",
            status: "succeeded",
            artifactDir: path.join(artifactBase, "sess-old-paused", "exec-p"),
            startedAt: "2026-01-01T08:00:05.000Z",
            endedAt: "2026-01-01T08:00:06.000Z",
          },
        ],
      },
      baseOpts,
    );
    for (let i = 0; i < 11; i += 1) {
      await saveSession(
        {
          ...createSessionState({
            sessionId: `sess-done-${String(i)}`,
            workflowName: "w",
            workflowId: "w",
            initialNodeId: "s",
            runtimeVariables: {},
          }),
          startedAt: new Date(Date.UTC(2026, 6, 1 + i)).toISOString(),
          endedAt: new Date(Date.UTC(2026, 6, 2 + i)).toISOString(),
          status: "completed",
        },
        baseOpts,
      );
    }
    const st = await buildWorkflowStatusOverview(
      { workflowName: "w", limit: 10 },
      baseOpts,
    );
    expect(st.ok).toBe(true);
    if (!st.ok) {
      return;
    }
    expect(st.value.recentExecutions).toHaveLength(10);
    expect(
      st.value.recentExecutions.some(
        (e) => e.workflowExecutionId === "sess-old-paused",
      ),
    ).toBe(false);
    expect(st.value.newestActiveExecution?.workflowExecutionId).toBe(
      "sess-old-paused",
    );
    expect(st.value.newestActiveExecution?.currentStepId).toBe("worker-step");
  });

  it("propagates not-found workflows", async () => {
    const root = await overviewMakeTempDir();
    await overviewWriteBundle({
      workflowDirectory: path.join(root, "exists-only"),
      workflowId: "e",
      description: "",
    });
    const result = await buildWorkflowStatusOverview(
      { workflowName: "missing" },
      { workflowRoot: root, cwd: root },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("parseWorkflowOverviewAggregateStatusFilter", () => {
  it("accepts empty and valid statuses", () => {
    expect(parseWorkflowOverviewAggregateStatusFilter(undefined).ok).toBe(true);
    const running = parseWorkflowOverviewAggregateStatusFilter("running");
    expect(running.ok).toBe(true);
    if (running.ok) {
      expect(running.value).toBe("running");
    }
  });

  it("rejects unknown status tokens", () => {
    const result = parseWorkflowOverviewAggregateStatusFilter("nope");
    expect(result.ok).toBe(false);
  });
});

describe("selectDefaultWorkflowOverviewRow", () => {
  const neverRunRow = (
    name: string,
    scope: WorkflowOverviewRow["sourceScope"],
  ): WorkflowOverviewRow => ({
    workflowName: name,
    sourceScope: scope,
    workflowDirectory: `/dir/${name}`,
    description: "",
    aggregateStatus: "never-run",
    activeExecutionCount: 0,
    latestExecution: null,
  });

  const rowWithLatest = (
    base: WorkflowOverviewRow,
    latest: WorkflowExecutionCompactSummary,
  ): WorkflowOverviewRow => ({
    ...base,
    latestExecution: latest,
    aggregateStatus: "completed",
  });

  it("returns null for empty input or missing fixed name", () => {
    expect(selectDefaultWorkflowOverviewRow([])).toBeNull();
    expect(
      selectDefaultWorkflowOverviewRow([neverRunRow("a", "project")], {
        fixedWorkflowName: "b",
      }),
    ).toBeNull();
  });

  it("prefers running over paused when both workflows are active in catalog order", () => {
    const pausedEarly: WorkflowOverviewRow = {
      ...neverRunRow("idle", "project"),
      aggregateStatus: "paused",
      activeExecutionCount: 1,
      latestExecution: compact({
        workflowExecutionId: "e-pause",
        workflowName: "idle",
        status: "paused",
        startedAt: "2026-05-01T01:00:00.000Z",
      }),
    };
    const runningLater: WorkflowOverviewRow = {
      ...neverRunRow("busy", "project"),
      aggregateStatus: "running",
      activeExecutionCount: 1,
      latestExecution: compact({
        workflowExecutionId: "e-run",
        workflowName: "busy",
        status: "running",
        startedAt: "2026-05-02T01:00:00.000Z",
      }),
    };
    const picked = selectDefaultWorkflowOverviewRow([
      pausedEarly,
      runningLater,
    ]);
    expect(picked?.workflowName).toBe("busy");
    expect(picked?.aggregateStatus).toBe("running");
  });

  it("prefers running over completed in fixed-name pool", () => {
    const rows: WorkflowOverviewRow[] = [
      {
        ...neverRunRow("w", "user"),
        aggregateStatus: "completed",
        latestExecution: compact({
          workflowExecutionId: "e1",
          workflowName: "w",
          status: "completed",
          startedAt: "2026-05-01T01:00:00.000Z",
          endedAt: "2026-05-01T02:00:00.000Z",
        }),
      },
      {
        ...neverRunRow("w", "project"),
        aggregateStatus: "running",
        activeExecutionCount: 1,
        latestExecution: compact({
          workflowExecutionId: "e2",
          workflowName: "w",
          status: "running",
          startedAt: "2026-05-02T01:00:00.000Z",
        }),
      },
    ];
    const picked = selectDefaultWorkflowOverviewRow(rows, {
      fixedWorkflowName: "w",
    });
    expect(picked?.sourceScope).toBe("project");
    expect(picked?.aggregateStatus).toBe("running");
  });

  it("prefers running scoped row over paused duplicate with the same workflow name", () => {
    const rows: WorkflowOverviewRow[] = [
      {
        ...neverRunRow("w", "user"),
        aggregateStatus: "paused",
        activeExecutionCount: 1,
        latestExecution: compact({
          workflowExecutionId: "pause-user",
          workflowName: "w",
          status: "paused",
          startedAt: "2026-05-03T06:00:00.000Z",
        }),
      },
      {
        ...neverRunRow("w", "project"),
        aggregateStatus: "running",
        activeExecutionCount: 1,
        latestExecution: compact({
          workflowExecutionId: "run-project",
          workflowName: "w",
          status: "running",
          startedAt: "2026-05-01T06:00:00.000Z",
        }),
      },
    ];
    const picked = selectDefaultWorkflowOverviewRow(rows, {
      fixedWorkflowName: "w",
    });
    expect(picked?.sourceScope).toBe("project");
    expect(picked?.aggregateStatus).toBe("running");
  });

  it("selects newest latestExecution when none active", () => {
    const a = neverRunRow("same", "project");
    const b = neverRunRow("same", "user");
    const rows = [
      rowWithLatest(
        a,
        compact({
          workflowExecutionId: "old",
          workflowName: "same",
          status: "completed",
          startedAt: "2026-05-01T01:00:00.000Z",
          endedAt: "2026-05-01T02:00:00.000Z",
        }),
      ),
      rowWithLatest(
        b,
        compact({
          workflowExecutionId: "new",
          workflowName: "same",
          status: "failed",
          startedAt: "2026-05-03T01:00:00.000Z",
          endedAt: "2026-05-03T02:00:00.000Z",
        }),
      ),
    ];
    const picked = selectDefaultWorkflowOverviewRow(rows, {
      fixedWorkflowName: "same",
    });
    expect(picked?.latestExecution?.workflowExecutionId).toBe("new");
  });

  it("restricts fixed-name selection to pinned source when duplicates exist", () => {
    const pinProj: ResolvedWorkflowSource = {
      scope: "project",
      workflowRoot: "/proj/workflows",
      workflowName: "w",
      workflowDirectory: "/proj/workflows/w",
      scopeRoot: "/proj/.divedra",
    };
    const userRow: WorkflowOverviewRow = {
      ...neverRunRow("w", "user"),
      workflowDirectory: "/user/workflows/w",
      aggregateStatus: "completed",
      latestExecution: compact({
        workflowExecutionId: "e-user",
        workflowName: "w",
        status: "completed",
        startedAt: "2026-05-03T05:00:00.000Z",
        endedAt: "2026-05-03T06:00:00.000Z",
      }),
    };
    const projectRow: WorkflowOverviewRow = {
      ...neverRunRow("w", "project"),
      workflowDirectory: pinProj.workflowDirectory,
      aggregateStatus: "running",
      activeExecutionCount: 1,
      latestExecution: compact({
        workflowExecutionId: "e-proj",
        workflowName: "w",
        status: "running",
        startedAt: "2026-05-03T01:00:00.000Z",
      }),
    };

    const picked = selectDefaultWorkflowOverviewRow([userRow, projectRow], {
      fixedWorkflowName: "w",
      fixedResolvedWorkflowSource: pinProj,
    });
    expect(picked?.sourceScope).toBe("project");
    expect(picked?.latestExecution?.workflowExecutionId).toBe("e-proj");
  });
});
