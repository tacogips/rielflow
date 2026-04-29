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
