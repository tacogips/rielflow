import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildAmbientManagerControlPlaneEnvironment,
  createManagerSessionStore,
  hashManagerAuthToken,
  mintManagerAuthToken,
  resolveAmbientManagerExecutionContext,
  stripAmbientManagerExecutionContext,
} from "./manager-session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-manager-session-store-test-"),
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

describe("manager-session-store", () => {
  test("migrates manager_runtime_id columns to manager_step_id for legacy runtime databases", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "data");
    await mkdir(rootDataDir, { recursive: true });
    const dbPath = path.join(rootDataDir, "divedra.db");

    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE manager_sessions (
        manager_session_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_execution_id TEXT NOT NULL,
        manager_runtime_id TEXT NOT NULL,
        manager_node_exec_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_message_id TEXT,
        control_mode TEXT,
        auth_token_hash TEXT NOT NULL,
        auth_token_expires_at TEXT NOT NULL
      );
      CREATE TABLE manager_messages (
        manager_message_id TEXT PRIMARY KEY,
        manager_session_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        workflow_execution_id TEXT NOT NULL,
        manager_runtime_id TEXT NOT NULL,
        manager_node_exec_id TEXT NOT NULL,
        message TEXT,
        parsed_intent_json TEXT NOT NULL,
        accepted INTEGER NOT NULL,
        rejection_reason TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotent_mutations (
        mutation_name TEXT NOT NULL,
        manager_session_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        normalized_request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY (mutation_name, manager_session_id, idempotency_key)
      );
    `);
    legacyDb
      .prepare(
        `
      INSERT INTO manager_sessions (
        manager_session_id, workflow_id, workflow_execution_id, manager_runtime_id,
        manager_node_exec_id, status, created_at, updated_at, last_message_id,
        control_mode, auth_token_hash, auth_token_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        "mgrsess-legacy-runtime",
        "wf",
        "exec-1",
        "manager-step-from-legacy-col",
        "node-exec-1",
        "active",
        "2026-04-29T00:00:00.000Z",
        "2026-04-29T00:00:00.000Z",
        null,
        null,
        "hash",
        "2026-05-29T00:00:00.000Z",
      );
    legacyDb.close();

    const store = createManagerSessionStore({
      cwd: root,
      rootDataDir,
    });
    const loaded = await store.loadSession("mgrsess-legacy-runtime");
    expect(loaded).not.toBeNull();
    expect(loaded?.managerStepId).toBe("manager-step-from-legacy-col");
  });

  test("migrates manager_node_id columns to manager_step_id when legacy runtime id column used node naming", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "data");
    await mkdir(rootDataDir, { recursive: true });
    const dbPath = path.join(rootDataDir, "divedra.db");

    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE manager_sessions (
        manager_session_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_execution_id TEXT NOT NULL,
        manager_node_id TEXT NOT NULL,
        manager_node_exec_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_message_id TEXT,
        control_mode TEXT,
        auth_token_hash TEXT NOT NULL,
        auth_token_expires_at TEXT NOT NULL
      );
      CREATE TABLE manager_messages (
        manager_message_id TEXT PRIMARY KEY,
        manager_session_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        workflow_execution_id TEXT NOT NULL,
        manager_node_id TEXT NOT NULL,
        manager_node_exec_id TEXT NOT NULL,
        message TEXT,
        parsed_intent_json TEXT NOT NULL,
        accepted INTEGER NOT NULL,
        rejection_reason TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotent_mutations (
        mutation_name TEXT NOT NULL,
        manager_session_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        normalized_request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY (mutation_name, manager_session_id, idempotency_key)
      );
    `);
    legacyDb
      .prepare(
        `
      INSERT INTO manager_sessions (
        manager_session_id, workflow_id, workflow_execution_id, manager_node_id,
        manager_node_exec_id, status, created_at, updated_at, last_message_id,
        control_mode, auth_token_hash, auth_token_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        "mgrsess-legacy-node-col",
        "wf",
        "exec-1",
        "manager-step-from-node-col",
        "node-exec-1",
        "active",
        "2026-04-29T00:00:00.000Z",
        "2026-04-29T00:00:00.000Z",
        null,
        null,
        "hash",
        "2026-05-29T00:00:00.000Z",
      );
    legacyDb.close();

    const store = createManagerSessionStore({
      cwd: root,
      rootDataDir,
    });
    const loaded = await store.loadSession("mgrsess-legacy-node-col");
    expect(loaded).not.toBeNull();
    expect(loaded?.managerStepId).toBe("manager-step-from-node-col");
  });

  test("persists sessions, messages, and idempotent mutation records", async () => {
    const root = await makeTempDir();
    const store = createManagerSessionStore({
      cwd: root,
      rootDataDir: path.join(root, "data"),
    });

    const createdAt = "2026-03-15T00:00:00.000Z";
    const authToken = "manager-secret-token";
    await store.createOrResumeSession({
      managerSessionId: "mgrsess-000001",
      workflowId: "demo",
      workflowExecutionId: "sess-abc12345",
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      status: "active",
      createdAt,
      updatedAt: createdAt,
      authTokenHash: hashManagerAuthToken(authToken),
      authTokenExpiresAt: "2026-03-16T00:00:00.000Z",
    });

    const loaded = await store.loadSession("mgrsess-000001");
    expect(loaded).not.toBeNull();
    expect(loaded?.workflowExecutionId).toBe("sess-abc12345");

    await store.appendMessage({
      managerMessageId: "mgrmsg-000001",
      managerSessionId: "mgrsess-000001",
      workflowId: "demo",
      workflowExecutionId: "sess-abc12345",
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      message: "start replay",
      parsedIntent: [
        {
          kind: "replay-communication",
          targetId: "comm-000001",
        },
      ],
      accepted: true,
      createdAt: "2026-03-15T00:01:00.000Z",
    });
    expect(
      await store.claimControlMode({
        managerSessionId: "mgrsess-000001",
        controlMode: "graphql-manager-message",
        updatedAt: "2026-03-15T00:01:00.000Z",
      }),
    ).toBe("graphql-manager-message");
    expect(
      await store.claimControlMode({
        managerSessionId: "mgrsess-000001",
        controlMode: "payload-manager-control",
        updatedAt: "2026-03-15T00:01:30.000Z",
      }),
    ).toBe("graphql-manager-message");

    const messages = await store.listMessages("mgrsess-000001");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.parsedIntent[0]?.kind).toBe("replay-communication");

    await store.saveIdempotentResult({
      mutationName: "replayCommunication",
      managerSessionId: "mgrsess-000001",
      idempotencyKey: "idem-1",
      normalizedRequestHash: "sha256:hash",
      responseJson: JSON.stringify({ replayedCommunicationId: "comm-000002" }),
      completedAt: "2026-03-15T00:02:00.000Z",
    });

    const idempotent = await store.loadIdempotentResult({
      mutationName: "replayCommunication",
      managerSessionId: "mgrsess-000001",
      idempotencyKey: "idem-1",
    });
    expect(idempotent?.normalizedRequestHash).toBe("sha256:hash");
    expect(
      await store.validateAuthToken({
        managerSessionId: "mgrsess-000001",
        authToken,
        now: "2026-03-15T12:00:00.000Z",
      }),
    ).not.toBeNull();
    expect(
      await store.validateAuthToken({
        managerSessionId: "mgrsess-000001",
        authToken: "wrong-token",
        now: "2026-03-15T12:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      await store.validateAuthToken({
        managerSessionId: "mgrsess-000001",
        authToken,
        now: "2026-03-16T00:00:00.000Z",
      }),
    ).toBeNull();

    await store.createOrResumeSession({
      managerSessionId: "mgrsess-000001",
      workflowId: "demo",
      workflowExecutionId: "sess-abc12345",
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      status: "completed",
      createdAt,
      updatedAt: "2026-03-15T00:03:00.000Z",
      authTokenHash: hashManagerAuthToken(authToken),
      authTokenExpiresAt: "2026-03-15T00:03:00.000Z",
    });
    const finalized = await store.loadSession("mgrsess-000001");
    expect(finalized?.lastMessageId).toBe("mgrmsg-000001");
    expect(finalized?.controlMode).toBe("graphql-manager-message");
  });

  test("resolves ambient manager execution context only when required fields exist", () => {
    expect(resolveAmbientManagerExecutionContext({})).toBeNull();
    expect(
      resolveAmbientManagerExecutionContext({
        DIVEDRA_WORKFLOW_ID: "demo",
        DIVEDRA_WORKFLOW_EXECUTION_ID: "sess-abc12345",
        DIVEDRA_MANAGER_STEP_ID: "divedra-manager",
        DIVEDRA_MANAGER_NODE_EXEC_ID: "exec-000001",
        DIVEDRA_MANAGER_SESSION_ID: "mgrsess-000001",
        DIVEDRA_MANAGER_AUTH_TOKEN: "secret",
      }),
    ).toEqual({
      workflowId: "demo",
      workflowExecutionId: "sess-abc12345",
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      managerSessionId: "mgrsess-000001",
      authToken: "secret",
    });
  });

  test("builds the ambient control-plane environment with endpoint override", () => {
    const authToken = mintManagerAuthToken();
    expect(authToken.length).toBeGreaterThan(10);

    expect(
      buildAmbientManagerControlPlaneEnvironment({
        workflowId: "demo",
        workflowExecutionId: "sess-abc12345",
        managerStepId: "divedra-manager",
        managerNodeExecId: "exec-000001",
        managerSessionId: "mgrsess-000001",
        authToken,
        env: {
          DIVEDRA_GRAPHQL_ENDPOINT: "http://127.0.0.1:9999/graphql",
        },
      }),
    ).toEqual({
      DIVEDRA_GRAPHQL_ENDPOINT: "http://127.0.0.1:9999/graphql",
      DIVEDRA_MANAGER_AUTH_TOKEN: authToken,
      DIVEDRA_MANAGER_SESSION_ID: "mgrsess-000001",
      DIVEDRA_WORKFLOW_ID: "demo",
      DIVEDRA_WORKFLOW_EXECUTION_ID: "sess-abc12345",
      DIVEDRA_MANAGER_STEP_ID: "divedra-manager",
      DIVEDRA_MANAGER_NODE_EXEC_ID: "exec-000001",
    });
  });

  test("strips ambient manager execution context without removing unrelated env", () => {
    expect(
      stripAmbientManagerExecutionContext({
        DIVEDRA_GRAPHQL_ENDPOINT: "http://127.0.0.1:43173/graphql",
        DIVEDRA_MANAGER_AUTH_TOKEN: "secret",
        DIVEDRA_MANAGER_SESSION_ID: "mgrsess-000001",
        DIVEDRA_WORKFLOW_ID: "demo",
        DIVEDRA_WORKFLOW_EXECUTION_ID: "sess-abc12345",
        DIVEDRA_MANAGER_STEP_ID: "divedra-manager",
        DIVEDRA_MANAGER_NODE_EXEC_ID: "exec-000001",
        PATH: "/usr/bin",
      }),
    ).toEqual({
      DIVEDRA_GRAPHQL_ENDPOINT: "http://127.0.0.1:43173/graphql",
      PATH: "/usr/bin",
    });
  });

  test("keeps the first claimed control mode authoritative across store instances", async () => {
    const root = await makeTempDir();
    const options = {
      cwd: root,
      rootDataDir: path.join(root, "data"),
    };
    const firstStore = createManagerSessionStore(options);
    const secondStore = createManagerSessionStore(options);

    await firstStore.createOrResumeSession({
      managerSessionId: "mgrsess-atomic-000001",
      workflowId: "demo",
      workflowExecutionId: "sess-atomic-000001",
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      status: "active",
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
      authTokenHash: hashManagerAuthToken("atomic-secret"),
      authTokenExpiresAt: "2026-03-16T00:00:00.000Z",
    });

    expect(
      await firstStore.claimControlMode({
        managerSessionId: "mgrsess-atomic-000001",
        controlMode: "graphql-manager-message",
        updatedAt: "2026-03-15T00:01:00.000Z",
      }),
    ).toBe("graphql-manager-message");

    expect(
      await secondStore.claimControlMode({
        managerSessionId: "mgrsess-atomic-000001",
        controlMode: "payload-manager-control",
        updatedAt: "2026-03-15T00:02:00.000Z",
      }),
    ).toBe("graphql-manager-message");

    const persisted = await secondStore.loadSession("mgrsess-atomic-000001");
    expect(persisted?.controlMode).toBe("graphql-manager-message");
    expect(persisted?.updatedAt).toBe("2026-03-15T00:01:00.000Z");
  });

  test("deleteByWorkflowExecutionId removes manager session records and dependent rows", async () => {
    const root = await makeTempDir();
    const store = createManagerSessionStore({
      cwd: root,
      rootDataDir: path.join(root, "data"),
    });

    await store.createOrResumeSession({
      managerSessionId: "mgrsess-delete-000001",
      workflowId: "demo",
      workflowExecutionId: "sess-delete-000001",
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      status: "active",
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
      authTokenHash: hashManagerAuthToken("delete-secret"),
      authTokenExpiresAt: "2026-03-16T00:00:00.000Z",
    });
    await store.appendMessage({
      managerMessageId: "mgrmsg-delete-000001",
      managerSessionId: "mgrsess-delete-000001",
      workflowId: "demo",
      workflowExecutionId: "sess-delete-000001",
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      message: "delete me",
      parsedIntent: [{ kind: "wait" }],
      accepted: true,
      createdAt: "2026-03-15T00:01:00.000Z",
    });
    await store.saveIdempotentResult({
      mutationName: "resumeWorkflow",
      managerSessionId: "mgrsess-delete-000001",
      idempotencyKey: "idem-delete-1",
      normalizedRequestHash: "sha256:delete",
      responseJson: '{"ok":true}',
      completedAt: "2026-03-15T00:02:00.000Z",
    });

    await store.deleteByWorkflowExecutionId("sess-delete-000001");

    expect(await store.loadSession("mgrsess-delete-000001")).toBeNull();
    expect(await store.listMessages("mgrsess-delete-000001")).toEqual([]);
    expect(
      await store.loadIdempotentResult({
        mutationName: "resumeWorkflow",
        managerSessionId: "mgrsess-delete-000001",
        idempotencyKey: "idem-delete-1",
      }),
    ).toBeNull();
  });

  test("deleteByWorkflowId removes manager session records across the workflow", async () => {
    const root = await makeTempDir();
    const store = createManagerSessionStore({
      cwd: root,
      rootDataDir: path.join(root, "data"),
    });

    await store.createOrResumeSession({
      managerSessionId: "mgrsess-delete-workflow-000001",
      workflowId: "demo",
      workflowExecutionId: "sess-delete-workflow-000001",
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      status: "active",
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
      authTokenHash: hashManagerAuthToken("delete-secret"),
      authTokenExpiresAt: "2026-03-16T00:00:00.000Z",
    });
    await store.appendMessage({
      managerMessageId: "mgrmsg-delete-workflow-000001",
      managerSessionId: "mgrsess-delete-workflow-000001",
      workflowId: "demo",
      workflowExecutionId: "sess-delete-workflow-000001",
      managerStepId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      message: "delete me",
      parsedIntent: [{ kind: "wait" }],
      accepted: true,
      createdAt: "2026-03-15T00:01:00.000Z",
    });
    await store.saveIdempotentResult({
      mutationName: "resumeWorkflow",
      managerSessionId: "mgrsess-delete-workflow-000001",
      idempotencyKey: "idem-delete-workflow-1",
      normalizedRequestHash: "sha256:delete",
      responseJson: '{"ok":true}',
      completedAt: "2026-03-15T00:02:00.000Z",
    });

    await store.deleteByWorkflowId("demo");

    expect(
      await store.loadSession("mgrsess-delete-workflow-000001"),
    ).toBeNull();
    expect(await store.listMessages("mgrsess-delete-workflow-000001")).toEqual(
      [],
    );
    expect(
      await store.loadIdempotentResult({
        mutationName: "resumeWorkflow",
        managerSessionId: "mgrsess-delete-workflow-000001",
        idempotencyKey: "idem-delete-workflow-1",
      }),
    ).toBeNull();
  });
});