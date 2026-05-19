import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createSessionState } from "../session";
import { saveSession } from "../session-store";
import {
  executeWorkflowSelfImprove,
  getWorkflowSelfImproveReport,
  listWorkflowSelfImproveReports,
} from "./service";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-self-improve-"),
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

async function writeDemoWorkflow(
  root: string,
  options: {
    readonly selfImproveMode?: string;
    readonly prompt?: string;
    readonly promptTemplateFile?: string;
  } = {},
): Promise<string> {
  const workflowDirectory = path.join(root, "demo");
  await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
  if (options.promptTemplateFile !== undefined) {
    await mkdir(
      path.dirname(path.join(workflowDirectory, options.promptTemplateFile)),
      {
        recursive: true,
      },
    );
    await writeFile(
      path.join(workflowDirectory, options.promptTemplateFile),
      `${options.prompt ?? "short"}\n`,
      "utf8",
    );
  }
  await writeFile(
    path.join(workflowDirectory, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: "demo",
        description: "demo workflow",
        defaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 1000,
          selfImprove: {
            enabled: true,
            mode: options.selfImproveMode ?? "report-only",
            defaultLogLimit: 10,
          },
        },
        managerStepId: "manager",
        entryStepId: "manager",
        nodes: [{ id: "manager", nodeFile: "nodes/node-manager.json" }],
        steps: [{ id: "manager", nodeId: "manager", role: "manager" }],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(workflowDirectory, "nodes/node-manager.json"),
    `${JSON.stringify(
      {
        id: "manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        ...(options.promptTemplateFile === undefined
          ? {
              promptTemplate:
                options.prompt ??
                "Assess the workflow execution and return structured JSON.",
            }
          : { promptTemplateFile: options.promptTemplateFile }),
        variables: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return workflowDirectory;
}

describe("executeWorkflowSelfImprove", () => {
  test("writes durable report artifacts and marker in report-only mode", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, "workflows");
    await writeDemoWorkflow(workflowRoot);
    const sessionStoreRoot = path.join(root, "sessions");
    const logRoot = path.join(root, "self-improve-log");
    const session = {
      ...createSessionState({
        sessionId: "session-a",
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "manager",
        runtimeVariables: {},
      }),
      status: "completed" as const,
      endedAt: "2026-05-18T03:00:00.000Z",
      nodeExecutions: [
        {
          nodeId: "manager",
          stepId: "manager",
          nodeExecId: "exec-a",
          status: "succeeded" as const,
          artifactDir: path.join(root, "artifacts", "exec-a"),
          startedAt: "2026-05-18T02:59:00.000Z",
          endedAt: "2026-05-18T03:00:00.000Z",
          outputAttemptCount: 1,
        },
      ],
    };
    const saved = await saveSession(session, { sessionStoreRoot });
    expect(saved.ok).toBe(true);

    const result = await executeWorkflowSelfImprove({
      workflowName: "demo",
      workflowRoot,
      sessionStoreRoot,
      selfImproveLogRoot: logRoot,
    });

    expect(result.selectedSourceRuns.map((run) => run.sessionId)).toEqual([
      "session-a",
    ]);
    expect(result.patchStatus).toBe("not-attempted");
    expect(JSON.parse(await readFile(result.reportPath, "utf8"))).toMatchObject(
      {
        selfImproveId: result.selfImproveId,
        workflowName: "demo",
        purposeAchievement: "achieved",
      },
    );
    await expect(
      readFile(result.markdownReportPath, "utf8"),
    ).resolves.toContain("Workflow Self-Improve Report");
    await expect(
      getWorkflowSelfImproveReport({
        workflowName: "demo",
        workflowRoot,
        selfImproveLogRoot: logRoot,
        selfImproveId: result.selfImproveId,
      }),
    ).resolves.toMatchObject({ selfImproveId: result.selfImproveId });
    await expect(
      listWorkflowSelfImproveReports({
        workflowName: "demo",
        workflowRoot,
        selfImproveLogRoot: logRoot,
      }),
    ).resolves.toHaveLength(1);
  });

  test("backs up and patches weak prompts in report-and-auto-improve mode", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, "workflows");
    const workflowDirectory = await writeDemoWorkflow(workflowRoot, {
      selfImproveMode: "report-and-auto-improve",
      prompt: "short",
    });

    const result = await executeWorkflowSelfImprove({
      workflowName: "demo",
      workflowRoot,
      sessionStoreRoot: path.join(root, "sessions"),
      selfImproveLogRoot: path.join(root, "self-improve-log"),
    });

    expect(result.backupPath).toBeDefined();
    expect(result.patchStatus).toBe("applied");
    expect(result.validationStatus).toBe("passed");
    const patchedNode = JSON.parse(
      await readFile(
        path.join(workflowDirectory, "nodes/node-manager.json"),
        "utf8",
      ),
    ) as { readonly promptTemplate?: string };
    expect(patchedNode.promptTemplate).toContain(
      "without inventing missing facts",
    );
    await expect(
      readFile(
        path.join(result.backupPath ?? "", "nodes/node-manager.json"),
        "utf8",
      ),
    ).resolves.toContain("short");
  });

  test("patches promptTemplateFile content instead of shadowing it in node JSON", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, "workflows");
    const workflowDirectory = await writeDemoWorkflow(workflowRoot, {
      selfImproveMode: "report-and-auto-improve",
      promptTemplateFile: "prompts/manager.md",
      prompt: "short",
    });

    const result = await executeWorkflowSelfImprove({
      workflowName: "demo",
      workflowRoot,
      sessionStoreRoot: path.join(root, "sessions"),
      selfImproveLogRoot: path.join(root, "self-improve-log"),
    });

    expect(result.patchStatus).toBe("applied");
    await expect(
      readFile(path.join(workflowDirectory, "prompts/manager.md"), "utf8"),
    ).resolves.toContain("without inventing missing facts");
    const nodeJson = JSON.parse(
      await readFile(
        path.join(workflowDirectory, "nodes/node-manager.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(nodeJson["promptTemplateFile"]).toBe("prompts/manager.md");
    expect(nodeJson["promptTemplate"]).toBeUndefined();
  });

  test("rejects invalid runtime mode and source mode overrides", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, "workflows");
    await writeDemoWorkflow(workflowRoot);

    await expect(
      executeWorkflowSelfImprove({
        workflowName: "demo",
        workflowRoot,
        sessionStoreRoot: path.join(root, "sessions"),
        mode: "bogus" as never,
      }),
    ).rejects.toThrow("invalid self-improve mode");

    await expect(
      executeWorkflowSelfImprove({
        workflowName: "demo",
        workflowRoot,
        sessionStoreRoot: path.join(root, "sessions"),
        sourceMode: "bogus" as never,
      }),
    ).rejects.toThrow("invalid self-improve source mode");
  });

  test("rejects invalid explicit source overrides before report side effects", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, "workflows");
    const logRoot = path.join(root, "self-improve-log");
    await writeDemoWorkflow(workflowRoot);

    await expect(
      executeWorkflowSelfImprove({
        workflowName: "demo",
        workflowRoot,
        sessionStoreRoot: path.join(root, "sessions"),
        selfImproveLogRoot: logRoot,
        sourceMode: "explicit",
      }),
    ).rejects.toThrow("requires at least one session id");

    await expect(readdir(logRoot)).rejects.toThrow();
  });
});
