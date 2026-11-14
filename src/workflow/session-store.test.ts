import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createSessionState } from "./session";
import {
  deleteSession,
  getSessionStoreRoot,
  loadSession,
  saveSession,
} from "./session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-session-store-test-"),
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

describe("session-store", () => {
  test("uses ~/.divedra/artifacts/sessions when unset", async () => {
    const root = await makeTempDir();
    const resolved = getSessionStoreRoot({ cwd: root, env: {} });
    expect(resolved).toBe(
      path.join(os.homedir(), ".divedra", "artifacts", "sessions"),
    );
  });

  test("uses user-root artifacts for default session-store scoping", async () => {
    const root = await makeTempDir();
    const nestedCwd = path.join(root, "packages", "feature", "src");
    await mkdir(path.join(root, ".divedra"), { recursive: true });
    await mkdir(nestedCwd, { recursive: true });
    const resolved = getSessionStoreRoot({ cwd: nestedCwd, env: {} });
    expect(resolved).toBe(
      path.join(os.homedir(), ".divedra", "artifacts", "sessions"),
    );
  });

  test("uses DIVEDRA_USER_ROOT for default session-store scoping", async () => {
    const root = await makeTempDir();
    const resolved = getSessionStoreRoot({
      cwd: root,
      env: { DIVEDRA_USER_ROOT: "custom-user-root" },
    });
    expect(resolved).toBe(
      path.join(root, "custom-user-root", "artifacts", "sessions"),
    );
  });

  test("derives the session store root from DIVEDRA_ARTIFACT_DIR", async () => {
    const resolved = getSessionStoreRoot({
      cwd: "/tmp/project",
      env: {
        DIVEDRA_ARTIFACT_DIR: "env-data",
      },
    });
    expect(resolved).toBe("/tmp/project/env-data/sessions");
  });

  test("save/load roundtrip", async () => {
    const root = await makeTempDir();
    const session = createSessionState({
      sessionId: "sess-abc12345",
      workflowName: "wf",
      workflowId: "wf",
      initialNodeId: "manager",
      runtimeVariables: { topic: "demo" },
    });

    const save = await saveSession(session, { sessionStoreRoot: root });
    expect(save.ok).toBe(true);

    const loaded = await loadSession(session.sessionId, {
      sessionStoreRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.sessionId).toBe(session.sessionId);
    expect(loaded.value.queue[0]).toBe("manager");
    expect(loaded.value.pendingOptionalNodeDecisions).toEqual([]);
    expect(loaded.value.activeUserActions).toEqual([]);
  });

  test("uses injected session snapshot indexer when saving", async () => {
    const root = await makeTempDir();
    const indexedSessionIds: string[] = [];
    const session = createSessionState({
      sessionId: "sess-index001",
      workflowName: "wf",
      workflowId: "wf",
      initialNodeId: "manager",
      runtimeVariables: {},
    });

    const save = await saveSession(session, {
      sessionStoreRoot: root,
      sessionSnapshotIndexer: {
        async saveSnapshot(savedSession) {
          indexedSessionIds.push(savedSession.sessionId);
        },
      },
    });

    expect(save.ok).toBe(true);
    expect(indexedSessionIds).toEqual([session.sessionId]);
  });

  test("does not fail primary save when snapshot indexing fails", async () => {
    const root = await makeTempDir();
    const session = createSessionState({
      sessionId: "sess-indexfail",
      workflowName: "wf",
      workflowId: "wf",
      initialNodeId: "manager",
      runtimeVariables: {},
    });

    const save = await saveSession(session, {
      sessionStoreRoot: root,
      sessionSnapshotIndexer: {
        async saveSnapshot() {
          throw new Error("index unavailable");
        },
      },
    });

    expect(save.ok).toBe(true);
    await expect(
      readFile(path.join(root, `${session.sessionId}.json`), "utf8"),
    ).resolves.toContain(session.sessionId);
  });

  test("save/load roundtrip preserves supervision state", async () => {
    const root = await makeTempDir();
    const session: ReturnType<typeof createSessionState> = {
      ...createSessionState({
        sessionId: "sess-superv01",
        workflowName: "wf",
        workflowId: "wf",
        initialNodeId: "manager",
        runtimeVariables: {},
      }),
      supervision: {
        supervisionRunId: "sup-run-1",
        targetWorkflowId: "wf",
        superviserWorkflowId: "divedra-superviser",
        status: "running",
        attemptCount: 2,
        workflowPatchCount: 0,
        incidents: [
          {
            incidentId: "inc-1",
            supervisedAttemptId: "att-1",
            category: "stall",
            summary: "no progress",
            detectedAt: "2026-04-25T12:00:00.000Z",
          },
        ],
      },
    };

    const save = await saveSession(session, { sessionStoreRoot: root });
    expect(save.ok).toBe(true);

    const loaded = await loadSession(session.sessionId, {
      sessionStoreRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.supervision?.supervisionRunId).toBe("sup-run-1");
    expect(loaded.value.supervision?.incidents[0]?.category).toBe("stall");
  });

  test("save/load roundtrip preserves fanout workspace lineage", async () => {
    const root = await makeTempDir();
    const session: ReturnType<typeof createSessionState> = {
      ...createSessionState({
        sessionId: "sess-fanout01",
        workflowName: "wf",
        workflowId: "wf",
        initialNodeId: "manager",
        runtimeVariables: {},
      }),
      fanoutGroups: [
        {
          fanoutGroupRunId: "fanout-review-node-exec-1",
          groupId: "review",
          sourceStepId: "writer",
          sourceNodeExecId: "node-exec-1",
          targetStepId: "reviewer",
          joinStepId: "join",
          concurrency: 1,
          failurePolicy: "collect-all",
          resultOrder: "input",
          branches: [
            {
              branchIndex: 0,
              item: { id: "feature-a" },
              status: "succeeded",
              workItemId: "fanout-review-node-exec-1:0",
              workspaceRoot: "/tmp/divedra-fanout-workspaces/old-branch",
            },
            {
              branchIndex: 1,
              item: { id: "feature-b" },
              status: "succeeded",
              workItemId: "fanout-review-node-exec-1:1",
              workspaceRoot: "/tmp/divedra-fanout-workspaces/old-branch-b",
            },
          ],
        },
        {
          fanoutGroupRunId: "fanout-review-node-exec-2",
          groupId: "review",
          sourceStepId: "writer",
          sourceNodeExecId: "node-exec-2",
          targetStepId: "reviewer",
          joinStepId: "join",
          concurrency: 1,
          failurePolicy: "collect-all",
          resultOrder: "input",
          branches: [
            {
              branchIndex: 0,
              item: { id: "feature-a" },
              status: "succeeded",
              workItemId: "fanout-review-node-exec-2:0",
              workspaceRoot: "/tmp/divedra-fanout-workspaces/new-branch",
              supersededWorkspaceRoot:
                "/tmp/divedra-fanout-workspaces/old-branch",
            },
          ],
        },
      ],
    };

    const save = await saveSession(session, { sessionStoreRoot: root });
    expect(save.ok).toBe(true);

    const loaded = await loadSession(session.sessionId, {
      sessionStoreRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const retryBranch = loaded.value.fanoutGroups?.[1]?.branches[0];
    expect(retryBranch?.workspaceRoot).toBe(
      "/tmp/divedra-fanout-workspaces/new-branch",
    );
    expect(retryBranch?.supersededWorkspaceRoot).toBe(
      "/tmp/divedra-fanout-workspaces/old-branch",
    );
  });

  test("rejects invalid session id", async () => {
    const root = await makeTempDir();
    const loaded = await loadSession("../bad", { sessionStoreRoot: root });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.code).toBe("INVALID_SESSION_ID");
    }
  });

  test("normalizes legacy sessions without mailbox fields", async () => {
    const root = await makeTempDir();
    const session = createSessionState({
      sessionId: "sess-legacy0",
      workflowName: "wf",
      workflowId: "wf",
      initialNodeId: "manager",
      runtimeVariables: {},
    });
    await saveSession(session, { sessionStoreRoot: root });

    const filePath = path.join(root, `${session.sessionId}.json`);
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    delete parsed["communicationCounter"];
    delete parsed["communications"];
    delete parsed["pendingOptionalNodeDecisions"];
    delete parsed["activeUserActions"];
    await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    const loaded = await loadSession(session.sessionId, {
      sessionStoreRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.communicationCounter).toBe(0);
    expect(loaded.value.communications).toEqual([]);
    expect(loaded.value.pendingOptionalNodeDecisions).toEqual([]);
    expect(loaded.value.activeUserActions).toEqual([]);
  });

  test("deleteSession removes the persisted session file", async () => {
    const root = await makeTempDir();
    const session = createSessionState({
      sessionId: "sess-delete001",
      workflowName: "wf",
      workflowId: "wf",
      initialNodeId: "manager",
      runtimeVariables: {},
    });
    await saveSession(session, { sessionStoreRoot: root });

    const deleted = await deleteSession(session.sessionId, {
      sessionStoreRoot: root,
    });
    expect(deleted.ok).toBe(true);

    const loaded = await loadSession(session.sessionId, {
      sessionStoreRoot: root,
    });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.code).toBe("NOT_FOUND");
    }
  });
});
