import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { deleteWorkflowHistory } from "./history";
import { runWorkflow } from "./engine";
import { createManagerSessionStore } from "./manager-session-store";
import { listRuntimeSessions } from "./runtime-db";
import { createSessionState } from "./session";
import { getSessionStoreRoot, loadSession, saveSession } from "./session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-workflow-history-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function createWorkflowFixture(
  root: string,
  workflowName: string,
  workflowId = workflowName,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId,
    description: "fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "divedra-manager",
    entryStepId: "divedra-manager",
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
      },
      {
        id: "step-1",
        nodeFile: "node-step-1.json",
      },
    ],
    steps: [
      {
        id: "divedra-manager",
        nodeId: "divedra-manager",
        role: "manager",
        transitions: [{ toStepId: "step-1" }],
      },
      { id: "step-1", nodeId: "step-1" },
    ],
  });

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "manager",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-step-1.json"), {
    id: "step-1",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    promptTemplate: "step",
    variables: {},
  });
}

function makeWorkflowOptions(root: string) {
  return {
    artifactRoot: path.join(root, "artifacts"),
    cwd: root,
    rootDataDir: path.join(root, "runtime-data"),
    sessionStoreRoot: path.join(root, "sessions"),
    workflowRoot: root,
  };
}

async function expectPathToExist(targetPath: string): Promise<void> {
  await access(targetPath);
}

async function expectPathToBeMissing(targetPath: string): Promise<void> {
  try {
    await access(targetPath);
  } catch {
    return;
  }
  throw new Error(`expected path to be missing: ${targetPath}`);
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("deleteWorkflowHistory", () => {
  test("deletes session files, runtime rows, and artifacts only for the selected workflow", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "alpha", "alpha-id");
    await createWorkflowFixture(root, "beta", "beta-id");

    const options = makeWorkflowOptions(root);
    const alphaSessionIds: string[] = [];
    for (const input of ["first alpha", "second alpha"]) {
      const result = await runWorkflow("alpha", {
        ...options,
        runtimeVariables: { humanInput: input },
        mockScenario: {
          "divedra-manager": {
            payload: { stage: "design" },
            provider: "scenario-mock",
            when: { always: true },
          },
          "step-1": {
            payload: { stage: "implement" },
            provider: "scenario-mock",
            when: { always: true },
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        alphaSessionIds.push(result.value.session.sessionId);
      }
    }

    const betaResult = await runWorkflow("beta", {
      ...options,
      runtimeVariables: { humanInput: "beta" },
      mockScenario: {
        "divedra-manager": {
          payload: { stage: "design" },
          provider: "scenario-mock",
          when: { always: true },
        },
        "step-1": {
          payload: { stage: "implement" },
          provider: "scenario-mock",
          when: { always: true },
        },
      },
    });
    expect(betaResult.ok).toBe(true);
    if (!betaResult.ok) {
      return;
    }

    for (const sessionId of alphaSessionIds) {
      const alphaAttachmentDir = path.join(
        options.rootDataDir,
        "files",
        "alpha-id",
        sessionId,
      );
      await mkdir(alphaAttachmentDir, { recursive: true });
      await writeFile(
        path.join(alphaAttachmentDir, "attachment.txt"),
        "alpha\n",
        "utf8",
      );
    }
    const alphaOrphanAttachmentDir = path.join(
      options.rootDataDir,
      "files",
      "alpha-id",
      "sess-alpha-orphan",
    );
    await mkdir(alphaOrphanAttachmentDir, { recursive: true });
    await writeFile(
      path.join(alphaOrphanAttachmentDir, "attachment.txt"),
      "alpha orphan\n",
      "utf8",
    );

    const betaAttachmentDir = path.join(
      options.rootDataDir,
      "files",
      "beta-id",
      betaResult.value.session.sessionId,
    );
    await mkdir(betaAttachmentDir, { recursive: true });
    await writeFile(
      path.join(betaAttachmentDir, "attachment.txt"),
      "beta\n",
      "utf8",
    );

    const managerStore = createManagerSessionStore(options);
    await managerStore.createOrResumeSession({
      managerSessionId: "mgrsess-alpha-orphan",
      workflowId: "alpha-id",
      workflowExecutionId: "sess-alpha-orphan",
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-alpha-orphan",
      status: "completed",
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z",
      authTokenHash: "hash",
      authTokenExpiresAt: "2026-03-31T00:00:00.000Z",
    });

    const alphaArtifactRoot = path.join(options.artifactRoot, "alpha-id");
    const betaArtifactRoot = path.join(options.artifactRoot, "beta-id");
    await expectPathToExist(alphaArtifactRoot);
    await expectPathToExist(betaArtifactRoot);

    const deleted = await deleteWorkflowHistory({
      ...options,
      workflowId: "alpha-id",
      workflowName: "alpha",
    });

    expect(deleted).toEqual({
      deletedSessionCount: 2,
      workflowId: "alpha-id",
      workflowName: "alpha",
    });

    for (const sessionId of alphaSessionIds) {
      const loaded = await loadSession(sessionId, options);
      expect(loaded.ok).toBe(false);
    }
    expect(
      (await listRuntimeSessions(options)).filter(
        (session) => session.workflowId === "alpha-id",
      ),
    ).toHaveLength(0);
    expect(
      (await listRuntimeSessions(options)).filter(
        (session) => session.workflowId === "beta-id",
      ),
    ).toHaveLength(1);
    await expectPathToBeMissing(alphaArtifactRoot);
    await expectPathToBeMissing(
      path.join(options.rootDataDir, "files", "alpha-id"),
    );
    await expectPathToExist(betaArtifactRoot);
    await expectPathToExist(betaAttachmentDir);
    expect(await managerStore.loadSession("mgrsess-alpha-orphan")).toBeNull();
  });

  test("refuses to delete workflow history while paused sessions still exist", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "alpha");
    const options = makeWorkflowOptions(root);

    const pausedSession = {
      ...createSessionState({
        initialNodeId: "step-1",
        runtimeVariables: { humanInput: "hold" },
        sessionId: "sess-alpha-paused",
        workflowId: "alpha",
        workflowName: "alpha",
      }),
      status: "paused" as const,
    };
    const saved = await saveSession(pausedSession, options);
    expect(saved.ok).toBe(true);

    const sessionFilePath = path.join(
      getSessionStoreRoot(options),
      `${pausedSession.sessionId}.json`,
    );
    const artifactRoot = path.join(options.artifactRoot, "alpha");
    await mkdir(
      path.join(artifactRoot, "executions", pausedSession.sessionId),
      {
        recursive: true,
      },
    );

    await expect(
      deleteWorkflowHistory({
        ...options,
        workflowId: "alpha",
        workflowName: "alpha",
      }),
    ).rejects.toThrow(
      /cannot delete workflow history while sessions are active/,
    );

    await expectPathToExist(sessionFilePath);
    await expectPathToExist(artifactRoot);
    expect(
      (await listRuntimeSessions(options)).filter(
        (session) => session.workflowId === "alpha",
      ),
    ).toHaveLength(1);
  });

  test("refuses to delete workflow history when the supplied workflow id does not match the loaded definition", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "alpha");
    const options = makeWorkflowOptions(root);

    await expect(
      deleteWorkflowHistory({
        ...options,
        workflowId: "other-workflow-id",
        workflowName: "alpha",
      }),
    ).rejects.toThrow(
      /workflow 'alpha' does not match workflow id 'other-workflow-id'/,
    );
  });
});