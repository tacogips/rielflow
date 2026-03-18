import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  callWorkflowNode,
  executeWorkflow,
  getRuntimeSessionView,
  getSession,
  inspectWorkflow,
  listSessions,
  resumeWorkflow,
} from "./lib";
import type { MockNodeScenario } from "./workflow/adapter";
import { createWorkflowTemplate } from "./workflow/create";
import { createSessionState } from "./workflow/session";
import { saveSession } from "./workflow/session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-lib-test-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function createCallNodeFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDirectory = path.join(workflowRoot, workflowName);
  await mkdir(workflowDirectory, { recursive: true });
  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: workflowName,
    description: "call node library fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "writer",
        kind: "task",
        nodeFile: "node-writer.json",
        completion: { type: "none" },
      },
    ],
    edges: [],
    loops: [],
    branching: { mode: "fan-out" },
  });
  await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
    nodes: [
      { id: "divedra-manager", order: 0 },
      { id: "writer", order: 1 },
    ],
  });
  await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
    id: "divedra-manager",
    model: "tacogips/claude-code-agent",
    promptTemplate: "manager",
    variables: {},
  });
  await writeJson(path.join(workflowDirectory, "node-writer.json"), {
    id: "writer",
    model: "tacogips/codex-agent",
    promptTemplate: "writer",
    variables: {},
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("library api", () => {
  function makeDefaultTemplateScenario(): MockNodeScenario {
    return {
      "divedra-manager": {
        provider: "scenario-mock",
        when: { always: true },
        payload: { stage: "design" },
      },
      "main-divedra": {
        provider: "scenario-mock",
        when: { always: true },
        payload: { stage: "dispatch" },
      },
      "workflow-input": {
        provider: "scenario-mock",
        when: { always: true },
        payload: { stage: "implement" },
      },
      "workflow-output": {
        provider: "scenario-mock",
        when: { always: true },
        payload: { stage: "review" },
      },
    };
  }

  test("inspects workflow and executes/resumes via library functions", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      cwd: root,
    };
    const mockScenario = makeDefaultTemplateScenario();

    const summary = await inspectWorkflow("demo", options);
    expect(summary.workflowName).toBe("demo");

    const paused = await executeWorkflow({
      workflowName: "demo",
      ...options,
      runtimeVariables: { humanInput: { request: "start demo workflow" } },
      mockScenario,
      maxSteps: 1,
    });
    expect(paused.status).toBe("paused");
    expect(paused.exitCode).toBe(4);

    const sessionBeforeResume = await getSession(paused.sessionId, options);
    expect(sessionBeforeResume.status).toBe("paused");

    const resumed = await resumeWorkflow({
      ...options,
      sessionId: paused.sessionId,
      mockScenario,
    });
    expect(resumed.status).toBe("completed");
    expect(resumed.exitCode).toBe(0);

    const sessions = await listSessions(options);
    expect(sessions.some((entry) => entry.sessionId === paused.sessionId)).toBe(
      true,
    );

    const runtimeView = await getRuntimeSessionView(paused.sessionId, options);
    expect(runtimeView.nodeExecutions.length).toBeGreaterThan(0);
    expect(runtimeView.nodeLogs.length).toBeGreaterThan(0);
  });

  test("calls one workflow node through the library wrapper", async () => {
    const root = await makeTempDir();
    const workflowName = "call-node-lib";
    const sessionId = "sess-call-node-lib";
    const sessionStoreRoot = path.join(root, "sessions");

    await createCallNodeFixture(root, workflowName);

    const saved = await saveSession(
      createSessionState({
        sessionId,
        workflowName,
        workflowId: workflowName,
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      {
        sessionStoreRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const result = await callWorkflowNode({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      nodeId: "writer",
      mockScenario: {
        writer: {
          provider: "scenario-mock",
          when: { always: true },
          payload: { summary: "library ok" },
        },
      },
    });

    expect(result.sessionId).toBe(sessionId);
    expect(result.status).toBe("succeeded");
    expect(result.output["payload"]).toEqual({ summary: "library ok" });
  });
});
