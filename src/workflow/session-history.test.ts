import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createManagerSessionStore } from "./manager-session-store";
import { resolveEffectiveRoots } from "./paths";
import { listRuntimeSessions } from "./runtime-db";
import { createSessionState } from "./session";
import { deleteWorkflowSessionHistory } from "./session-history";
import { loadSession, saveSession } from "./session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-session-history-test-"),
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

describe("session-history", () => {
  test("deletes persisted history, runtime indexes, and artifacts for a workflow run", async () => {
    const root = await makeTempDir();
    const options = {
      cwd: root,
      rootDataDir: path.join(root, "runtime-data"),
      sessionStoreRoot: path.join(root, "sessions"),
    };
    const session = {
      ...createSessionState({
        sessionId: "sess-history-delete-001",
        workflowName: "demo",
        workflowId: "demo-id",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      status: "completed" as const,
    };
    await saveSession(session, options);

    const roots = resolveEffectiveRoots(options);
    const executionDir = path.join(
      roots.artifactRoot,
      "demo-id",
      "executions",
      session.sessionId,
    );
    await mkdir(executionDir, { recursive: true });
    await writeFile(path.join(executionDir, "output.json"), "{}\n", "utf8");

    const attachmentDir = path.join(
      options.rootDataDir,
      "files",
      "demo-id",
      session.sessionId,
    );
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(path.join(attachmentDir, "attachment.txt"), "artifact\n");

    const managerStore = createManagerSessionStore(options);
    await managerStore.createOrResumeSession({
      managerSessionId: "mgrsess-history-delete-001",
      workflowId: "demo-id",
      workflowExecutionId: session.sessionId,
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      status: "completed",
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z",
      authTokenHash: "hash",
      authTokenExpiresAt: "2026-03-31T00:00:00.000Z",
    });

    await deleteWorkflowSessionHistory(
      {
        sessionId: session.sessionId,
        workflowId: "demo-id",
        workflowName: "demo",
      },
      options,
    );

    const loaded = await loadSession(session.sessionId, options);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.code).toBe("NOT_FOUND");
    }
    expect(await listRuntimeSessions(options)).toEqual([]);
    expect(
      await managerStore.loadSession("mgrsess-history-delete-001"),
    ).toBeNull();
    await expect(
      Bun.file(path.join(executionDir, "output.json")).exists(),
    ).resolves.toBe(false);
    await expect(
      Bun.file(path.join(attachmentDir, "attachment.txt")).exists(),
    ).resolves.toBe(false);
  });

  test("allows deleting runtime history when the session file is already missing", async () => {
    const root = await makeTempDir();
    const options = {
      cwd: root,
      rootDataDir: path.join(root, "runtime-data"),
      sessionStoreRoot: path.join(root, "sessions"),
    };
    const session = {
      ...createSessionState({
        sessionId: "sess-runtime-only-delete-001",
        workflowName: "demo",
        workflowId: "demo-id",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      status: "completed" as const,
    };
    await saveSession(session, options);
    await rm(path.join(options.sessionStoreRoot, `${session.sessionId}.json`), {
      force: true,
    });

    await deleteWorkflowSessionHistory(
      {
        sessionId: session.sessionId,
        workflowId: session.workflowId,
        workflowName: session.workflowName,
      },
      options,
    );

    expect(await listRuntimeSessions(options)).toEqual([]);
  });

  test("refuses to delete paused workflow runs", async () => {
    const root = await makeTempDir();
    const options = {
      cwd: root,
      rootDataDir: path.join(root, "runtime-data"),
      sessionStoreRoot: path.join(root, "sessions"),
    };
    const session = {
      ...createSessionState({
        sessionId: "sess-history-paused-001",
        workflowName: "demo",
        workflowId: "demo-id",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      status: "paused" as const,
    };
    await saveSession(session, options);

    const roots = resolveEffectiveRoots(options);
    const executionDir = path.join(
      roots.artifactRoot,
      "demo-id",
      "executions",
      session.sessionId,
    );
    await mkdir(executionDir, { recursive: true });
    await writeFile(path.join(executionDir, "output.json"), "{}\n", "utf8");

    const attachmentDir = path.join(
      options.rootDataDir,
      "files",
      "demo-id",
      session.sessionId,
    );
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(path.join(attachmentDir, "attachment.txt"), "artifact\n");

    const managerStore = createManagerSessionStore(options);
    await managerStore.createOrResumeSession({
      managerSessionId: "mgrsess-history-paused-001",
      workflowId: "demo-id",
      workflowExecutionId: session.sessionId,
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      status: "active",
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z",
      authTokenHash: "hash",
      authTokenExpiresAt: "2026-03-31T00:00:00.000Z",
    });

    await expect(
      deleteWorkflowSessionHistory(
        {
          sessionId: session.sessionId,
          workflowId: "demo-id",
          workflowName: "demo",
        },
        options,
      ),
    ).rejects.toThrow(/while it is paused/);

    const loaded = await loadSession(session.sessionId, options);
    expect(loaded.ok).toBe(true);
    expect(await listRuntimeSessions(options)).toHaveLength(1);
    expect(
      await managerStore.loadSession("mgrsess-history-paused-001"),
    ).not.toBeNull();
    await expect(
      Bun.file(path.join(executionDir, "output.json")).exists(),
    ).resolves.toBe(true);
    await expect(
      Bun.file(path.join(attachmentDir, "attachment.txt")).exists(),
    ).resolves.toBe(true);
  });

  test("refuses to delete runtime-only paused workflow runs when the session file is already missing", async () => {
    const root = await makeTempDir();
    const options = {
      cwd: root,
      rootDataDir: path.join(root, "runtime-data"),
      sessionStoreRoot: path.join(root, "sessions"),
    };
    const session = {
      ...createSessionState({
        sessionId: "sess-history-runtime-paused-001",
        workflowName: "demo",
        workflowId: "demo-id",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      status: "paused" as const,
    };
    await saveSession(session, options);
    await rm(path.join(options.sessionStoreRoot, `${session.sessionId}.json`), {
      force: true,
    });

    const roots = resolveEffectiveRoots(options);
    const executionDir = path.join(
      roots.artifactRoot,
      "demo-id",
      "executions",
      session.sessionId,
    );
    await mkdir(executionDir, { recursive: true });
    await writeFile(path.join(executionDir, "output.json"), "{}\n", "utf8");

    const attachmentDir = path.join(
      options.rootDataDir,
      "files",
      "demo-id",
      session.sessionId,
    );
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(path.join(attachmentDir, "attachment.txt"), "artifact\n");

    await expect(
      deleteWorkflowSessionHistory(
        {
          sessionId: session.sessionId,
          workflowId: "demo-id",
          workflowName: "demo",
        },
        options,
      ),
    ).rejects.toThrow(/while it is paused/);

    expect(await listRuntimeSessions(options)).toHaveLength(1);
    await expect(
      Bun.file(path.join(executionDir, "output.json")).exists(),
    ).resolves.toBe(true);
    await expect(
      Bun.file(path.join(attachmentDir, "attachment.txt")).exists(),
    ).resolves.toBe(true);
  });

  test("refuses to delete history when the supplied workflow identity does not match the stored session", async () => {
    const root = await makeTempDir();
    const options = {
      cwd: root,
      rootDataDir: path.join(root, "runtime-data"),
      sessionStoreRoot: path.join(root, "sessions"),
    };
    const session = {
      ...createSessionState({
        sessionId: "sess-history-mismatch-001",
        workflowName: "demo",
        workflowId: "demo-id",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      status: "completed" as const,
    };
    await saveSession(session, options);

    const roots = resolveEffectiveRoots(options);
    const executionDir = path.join(
      roots.artifactRoot,
      "demo-id",
      "executions",
      session.sessionId,
    );
    await mkdir(executionDir, { recursive: true });
    await writeFile(path.join(executionDir, "output.json"), "{}\n", "utf8");

    const attachmentDir = path.join(
      options.rootDataDir,
      "files",
      "demo-id",
      session.sessionId,
    );
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(path.join(attachmentDir, "attachment.txt"), "artifact\n");

    await expect(
      deleteWorkflowSessionHistory(
        {
          sessionId: session.sessionId,
          workflowId: "other-id",
          workflowName: "other-workflow",
        },
        options,
      ),
    ).rejects.toThrow(/does not match the stored workflow identity/);

    expect((await loadSession(session.sessionId, options)).ok).toBe(true);
    expect(await listRuntimeSessions(options)).toHaveLength(1);
    await expect(
      Bun.file(path.join(executionDir, "output.json")).exists(),
    ).resolves.toBe(true);
    await expect(
      Bun.file(path.join(attachmentDir, "attachment.txt")).exists(),
    ).resolves.toBe(true);
  });

  test("refuses deleting a workflow execution still referenced as a continuation source", async () => {
    const root = await makeTempDir();
    const options = {
      cwd: root,
      rootDataDir: path.join(root, "runtime-data"),
      sessionStoreRoot: path.join(root, "sessions"),
    };
    const source = {
      ...createSessionState({
        sessionId: "sess-history-deps-src-001",
        workflowName: "demo",
        workflowId: "demo-id",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      status: "completed" as const,
    };
    const dependent = {
      ...createSessionState({
        sessionId: "sess-history-deps-dep-001",
        workflowName: "demo",
        workflowId: "demo-id",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      continuedFromWorkflowExecutionId: source.sessionId,
      status: "completed" as const,
    };
    await saveSession(source, options);
    await saveSession(dependent, options);

    await expect(
      deleteWorkflowSessionHistory(
        {
          sessionId: source.sessionId,
          workflowId: "demo-id",
          workflowName: "demo",
        },
        options,
      ),
    ).rejects.toThrow(/still reference/);

    await deleteWorkflowSessionHistory(
      {
        sessionId: dependent.sessionId,
        workflowId: "demo-id",
        workflowName: "demo",
      },
      options,
    );
    await deleteWorkflowSessionHistory(
      {
        sessionId: source.sessionId,
        workflowId: "demo-id",
        workflowName: "demo",
      },
      options,
    );
  });

  test("refuses deleting a workflow execution referenced by historyImports", async () => {
    const root = await makeTempDir();
    const options = {
      cwd: root,
      rootDataDir: path.join(root, "runtime-data"),
      sessionStoreRoot: path.join(root, "sessions"),
    };
    const source = {
      ...createSessionState({
        sessionId: "sess-history-deps-import-src-001",
        workflowName: "demo",
        workflowId: "demo-id",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      status: "completed" as const,
    };
    const dependent = {
      ...createSessionState({
        sessionId: "sess-history-deps-import-dep-001",
        workflowName: "demo",
        workflowId: "demo-id",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      status: "completed" as const,
      historyImports: [
        {
          sourceWorkflowExecutionId: source.sessionId,
          throughStepRunId: "exec-placeholder",
          throughExecutionOrdinal: 1,
        },
      ],
    };
    await saveSession(source, options);
    await saveSession(dependent, options);

    await expect(
      deleteWorkflowSessionHistory(
        {
          sessionId: source.sessionId,
          workflowId: "demo-id",
          workflowName: "demo",
        },
        options,
      ),
    ).rejects.toThrow(/still reference/);
  });
});