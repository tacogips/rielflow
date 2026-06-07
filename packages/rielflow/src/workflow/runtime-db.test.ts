import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import type { NodeAdapter } from "./adapter";
import { runWorkflow } from "./engine";
import {
  allocateNextWorkflowMessageCommunicationId,
  deleteRuntimeSession,
  listRuntimeLlmSessionMessages,
  listRuntimeSessions,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  listWorkflowMessagesFromRuntimeDb,
  loadWorkflowMessageFromRuntimeDb,
  loadRuntimeSessionSummary,
  markWorkflowMessagesConsumedInRuntimeDb,
  resolveRuntimeDbPath,
  saveCommunicationEventToRuntimeDb,
  saveNodeExecutionToRuntimeDb,
  saveProcessLogsToRuntimeDb,
  saveSessionSnapshotToRuntimeDb,
  saveWorkflowMessageToRuntimeDb,
  updateWorkflowMessageStatusInRuntimeDb,
  withDatabase,
  withEventRuntimeDatabase,
} from "./runtime-db";
import {
  setWorkflowMessageAttachmentSourceOpenHookForTests,
  setWorkflowMessageAttachmentTargetCloseHookForTests,
  setWorkflowMessageAttachmentTargetFileWriteHookForTests,
  setWorkflowMessageAttachmentTargetWriteHookForTests,
} from "./runtime-db/workflow-message-test-hooks";
import { createSessionState, type CommunicationRecord } from "./session";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-runtime-db-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function makeRuntimeDbOptions(
  root: string,
  sessionId?: string,
): {
  readonly artifactRoot: string;
  readonly cwd: string;
  readonly rootDataDir: string;
  readonly sessionId?: string;
  readonly workflowRoot: string;
} {
  return {
    workflowRoot: root,
    artifactRoot: path.join(root, "artifacts"),
    rootDataDir: path.join(root, "runtime-data"),
    cwd: root,
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

function expectSqliteJsonCheckRejection(action: () => unknown): void {
  expect(action).toThrow(/CHECK constraint failed|constraint/i);
}

function insertWorkflowMessageJsonConstraintRow(
  db: Database,
  input: {
    readonly communicationId: string;
    readonly deliveryAttemptIdsJson?: string;
    readonly payloadRefJson?: string;
    readonly payloadJson?: string | null;
    readonly artifactRefsJson?: string | null;
  },
): void {
  db.prepare(
    `
      INSERT INTO workflow_messages (
        workflow_id, workflow_execution_id, communication_id, from_node_id,
        to_node_id, routing_scope, delivery_kind, transition_when,
        source_node_exec_id, status, active_delivery_attempt_id,
        delivery_attempt_ids_json, payload_ref_json, payload_json,
        artifact_refs_json, artifact_dir, created_at, delivered_at,
        consumed_by_node_exec_id, consumed_at, failure_reason,
        superseded_by_communication_id, superseded_at,
        replayed_from_communication_id, manager_message_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    "demo",
    "sess-json-checks",
    input.communicationId,
    "manager",
    "worker",
    "intra-workflow",
    "edge-transition",
    "always",
    "exec-000001",
    "delivered",
    "attempt-000001",
    input.deliveryAttemptIdsJson ?? '["attempt-000001"]',
    input.payloadRefJson ??
      '{"kind":"node-output","workflowExecutionId":"sess-json-checks"}',
    input.payloadJson === undefined
      ? '{"payload":{"ok":true}}'
      : input.payloadJson,
    input.artifactRefsJson ?? null,
    "/tmp/artifacts",
    "2026-06-07T00:00:00.000Z",
    "2026-06-07T00:00:00.000Z",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "2026-06-07T00:00:00.000Z",
  );
}

async function createWorkflowFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "rielflow-manager",
    entryStepId: "rielflow-manager",
    nodes: [
      {
        id: "rielflow-manager",
        nodeFile: "node-rielflow-manager.json",
      },
      {
        id: "step-1",
        nodeFile: "node-step-1.json",
      },
    ],
    steps: [
      {
        id: "rielflow-manager",
        nodeId: "rielflow-manager",
        role: "manager",
        transitions: [{ toStepId: "step-1" }],
      },
      { id: "step-1", nodeId: "step-1" },
    ],
  });

  await writeJson(path.join(workflowDir, "node-rielflow-manager.json"), {
    id: "rielflow-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "manager {{topic}}",
    variables: { topic: "A" },
  });
  await writeJson(path.join(workflowDir, "node-step-1.json"), {
    id: "step-1",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    promptTemplate: "step {{topic}}",
    variables: {},
  });
}

async function createNodeSessionReuseFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "node session reuse fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "rielflow-manager",
    entryStepId: "rielflow-manager",
    nodes: [
      {
        id: "rielflow-manager",
        nodeFile: "node-rielflow-manager.json",
      },
      {
        id: "step-a",
        nodeFile: "node-step-a.json",
      },
      {
        id: "step-b",
        nodeFile: "node-step-b.json",
      },
      {
        id: "step-c",
        nodeFile: "node-step-c.json",
      },
    ],
    steps: [
      {
        id: "rielflow-manager",
        nodeId: "rielflow-manager",
        role: "manager",
        transitions: [{ toStepId: "step-a" }],
      },
      {
        id: "step-a",
        nodeId: "step-a",
        transitions: [{ toStepId: "step-b" }],
      },
      {
        id: "step-b",
        nodeId: "step-b",
        transitions: [{ toStepId: "step-c", label: "go_c" }],
      },
      {
        id: "step-c",
        nodeId: "step-c",
        transitions: [{ toStepId: "step-b" }],
      },
    ],
  });

  await writeJson(path.join(workflowDir, "node-rielflow-manager.json"), {
    id: "rielflow-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "manager",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-step-a.json"), {
    id: "step-a",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "return 2",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-step-b.json"), {
    id: "step-b",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    sessionPolicy: {
      mode: "reuse",
    },
    promptTemplate: "accumulate",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-step-c.json"), {
    id: "step-c",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "return 3",
    variables: {},
  });
}

class ReusableSessionAdapter implements NodeAdapter {
  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<Awaited<ReturnType<NodeAdapter["execute"]>>> {
    if (input.nodeId === "step-b") {
      const sessionId = input.backendSession?.sessionId ?? "backend-b-1";
      const seen =
        input.backendSession?.mode === "reuse" &&
        input.backendSession.sessionId === "backend-b-1";
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true, go_c: !seen },
        payload: {
          sum: seen ? 5 : 2,
          reused: seen,
          go_c: !seen,
        },
        backendSession: {
          sessionId,
        },
      };
    }

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: { nodeId: input.nodeId },
    };
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("runtime-db", () => {
  test("resolves runtime database placement with RIEL_RUNTIME_DB and RIEL_ARTIFACT_DIR", async () => {
    const root = await makeTempDir();

    expect(
      resolveRuntimeDbPath({
        cwd: root,
        env: { RIEL_USER_ROOT: "operator-home" },
      }),
    ).toBe(path.join(root, "operator-home", "artifacts", "rielflow.db"));
    expect(
      resolveRuntimeDbPath({
        cwd: root,
        env: { RIEL_ARTIFACT_DIR: "runtime-data" },
      }),
    ).toBe(path.join(root, "runtime-data", "rielflow.db"));
    expect(
      resolveRuntimeDbPath({
        cwd: root,
        env: {
          RIEL_ARTIFACT_DIR: "runtime-data",
          RIEL_RUNTIME_DB: "custom/runtime.sqlite",
        },
      }),
    ).toBe(path.join(root, "custom", "runtime.sqlite"));
  });

  test("writes session and node execution index rows to sqlite", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "sqlite-index");

    const options = makeRuntimeDbOptions(root);

    const mockScenario = {
      "rielflow-manager": {
        provider: "scenario-mock",
        when: { always: true },
        payload: { stage: "design" },
      },
      "step-1": {
        provider: "scenario-mock",
        when: { always: true },
        payload: { stage: "implement" },
      },
    };
    const result = await runWorkflow("sqlite-index", {
      ...options,
      mockScenario,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const dbPath = resolveRuntimeDbPath(options);
    const db = new Database(dbPath, { readonly: true });
    try {
      const sessionCount = db
        .query("SELECT count(*) as count FROM sessions")
        .get() as { count: number };
      const nodeCount = db
        .query("SELECT count(*) as count FROM node_executions")
        .get() as { count: number };
      const logCount = db
        .query("SELECT count(*) as count FROM node_logs")
        .get() as { count: number };
      const messageCount = db
        .query("SELECT count(*) as count FROM workflow_messages")
        .get() as { count: number };
      expect(sessionCount.count).toBeGreaterThanOrEqual(1);
      expect(nodeCount.count).toBeGreaterThanOrEqual(2);
      expect(logCount.count).toBeGreaterThanOrEqual(2);
      expect(messageCount.count).toBe(
        result.value.session.communications.length,
      );
    } finally {
      db.close();
    }
    const messages = await listWorkflowMessagesFromRuntimeDb(
      { workflowExecutionId: result.value.session.sessionId },
      options,
    );
    expect(messages).toHaveLength(result.value.session.communications.length);
    const latestMessage = messages.at(-1);
    expect(latestMessage?.payloadJson).toContain("scenario-mock");
    if (latestMessage !== undefined) {
      await expect(
        loadWorkflowMessageFromRuntimeDb(
          {
            workflowExecutionId: result.value.session.sessionId,
            communicationId: latestMessage.communicationId,
          },
          options,
        ),
      ).resolves.toEqual(latestMessage);
      await expect(
        listWorkflowMessagesFromRuntimeDb(
          {
            workflowExecutionId: result.value.session.sessionId,
            fromNodeId: latestMessage.fromNodeId,
          },
          options,
        ),
      ).resolves.toContainEqual(latestMessage);
      await expect(
        listWorkflowMessagesFromRuntimeDb(
          {
            workflowExecutionId: result.value.session.sessionId,
            toNodeId: latestMessage.toNodeId,
          },
          options,
        ),
      ).resolves.toContainEqual(latestMessage);
    }
  });

  test("workflow message indexes and metadata cover inbound created-order reads", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root);
    const workflowExecutionId = "sess-message-indexes";
    const makeCommunication = (
      communicationId: string,
      toNodeId: string,
      createdAt: string,
    ) =>
      ({
        workflowId: "demo",
        workflowExecutionId,
        communicationId,
        fromNodeId: "manager",
        toNodeId,
        routingScope: "intra-workflow",
        sourceNodeExecId: "exec-000001",
        payloadRef: {
          kind: "node-output",
          workflowExecutionId,
          workflowId: "demo",
          outputNodeId: "manager",
          nodeExecId: "exec-000001",
          artifactDir: path.join(root, "artifacts", "manager"),
        },
        deliveryKind: "edge-transition",
        transitionWhen: "always",
        status: "delivered",
        deliveryAttemptIds: ["attempt-000001"],
        activeDeliveryAttemptId: "attempt-000001",
        createdAt,
        deliveredAt: createdAt,
        artifactDir: path.join(root, "artifacts", "communications"),
      }) satisfies CommunicationRecord;

    await saveWorkflowMessageToRuntimeDb(
      {
        communication: makeCommunication(
          "comm-000002",
          "worker",
          "2026-04-20T00:00:02.000Z",
        ),
      },
      options,
    );
    await saveWorkflowMessageToRuntimeDb(
      {
        communication: makeCommunication(
          "comm-000001",
          "worker",
          "2026-04-20T00:00:01.000Z",
        ),
      },
      options,
    );
    await saveWorkflowMessageToRuntimeDb(
      {
        communication: makeCommunication(
          "comm-000003",
          "other-worker",
          "2026-04-20T00:00:03.000Z",
        ),
      },
      options,
    );

    const workerMessages = await listWorkflowMessagesFromRuntimeDb(
      { workflowExecutionId, toNodeId: "worker" },
      options,
    );
    expect(workerMessages.map((message) => message.communicationId)).toEqual([
      "comm-000001",
      "comm-000002",
    ]);

    const db = new Database(resolveRuntimeDbPath(options));
    try {
      const indexes = db
        .query("PRAGMA index_list(workflow_messages)")
        .all() as {
        readonly name: string;
      }[];
      expect(indexes.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          "idx_workflow_messages_created_order",
          "idx_workflow_messages_inbound_created",
          "idx_workflow_messages_outbound_created_order",
        ]),
      );
      const plan = db
        .query(
          `
            EXPLAIN QUERY PLAN
            SELECT * FROM workflow_messages
            WHERE workflow_execution_id = ? AND to_node_id = ?
            ORDER BY created_at ASC, communication_id ASC
          `,
        )
        .all(workflowExecutionId, "worker") as { readonly detail: string }[];
      expect(plan.map((row) => row.detail).join("\n")).toContain(
        "idx_workflow_messages_inbound_created",
      );

      const metadata = db
        .query(
          `
            SELECT
              schema_version,
              json_valid(active_tables_json) AS active_tables_json_valid,
              active_tables_json,
              migration_metadata_json
            FROM runtime_schema_metadata
            WHERE metadata_id = 'active'
          `,
        )
        .get() as {
        readonly schema_version: number;
        readonly active_tables_json_valid: number;
        readonly active_tables_json: string;
        readonly migration_metadata_json: string | null;
      } | null;
      expect(metadata).not.toBeNull();
      if (metadata === null) {
        return;
      }
      expect(metadata.schema_version).toBe(1);
      expect(metadata.active_tables_json_valid).toBe(1);
      expect(JSON.parse(metadata.active_tables_json)).toMatchObject({
        workflowMessages: "workflow_messages",
      });
      expect(metadata.migration_metadata_json).toBeNull();
      expect(() =>
        db
          .query(
            "UPDATE runtime_schema_metadata SET active_tables_json = ? WHERE metadata_id = 'active'",
          )
          .run("{invalid-json"),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  test("rejects malformed JSON in workflow_messages sqlite JSON columns", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root);

    await withDatabase(options, () => undefined);

    const db = new Database(resolveRuntimeDbPath(options));
    try {
      insertWorkflowMessageJsonConstraintRow(db, {
        communicationId: "comm-valid-json",
        artifactRefsJson: "[]",
      });
      insertWorkflowMessageJsonConstraintRow(db, {
        communicationId: "comm-nullable-json-null",
        payloadJson: null,
        artifactRefsJson: null,
      });
      const nullableRow = db
        .query(
          `
            SELECT payload_json, artifact_refs_json
            FROM workflow_messages
            WHERE communication_id = ?
          `,
        )
        .get("comm-nullable-json-null") as {
        readonly payload_json: string | null;
        readonly artifact_refs_json: string | null;
      } | null;
      expect(nullableRow).toEqual({
        payload_json: null,
        artifact_refs_json: null,
      });

      expectSqliteJsonCheckRejection(() =>
        insertWorkflowMessageJsonConstraintRow(db, {
          communicationId: "comm-bad-delivery-attempts",
          deliveryAttemptIdsJson: "{bad-json",
        }),
      );
      expectSqliteJsonCheckRejection(() =>
        insertWorkflowMessageJsonConstraintRow(db, {
          communicationId: "comm-bad-payload-ref",
          payloadRefJson: "{bad-json",
        }),
      );
      expectSqliteJsonCheckRejection(() =>
        insertWorkflowMessageJsonConstraintRow(db, {
          communicationId: "comm-bad-payload",
          payloadJson: "{bad-json",
        }),
      );
      expectSqliteJsonCheckRejection(() =>
        insertWorkflowMessageJsonConstraintRow(db, {
          communicationId: "comm-bad-artifacts",
          artifactRefsJson: "{bad-json",
        }),
      );
    } finally {
      db.close();
    }
  });

  test("rebuilds legacy workflow_messages tables with JSON checks", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root);
    const dbPath = resolveRuntimeDbPath(options);
    await mkdir(path.dirname(dbPath), { recursive: true });
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE workflow_messages (
        workflow_id TEXT NOT NULL,
        workflow_execution_id TEXT NOT NULL,
        communication_id TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        routing_scope TEXT NOT NULL,
        delivery_kind TEXT NOT NULL,
        transition_when TEXT NOT NULL,
        source_node_exec_id TEXT NOT NULL,
        status TEXT NOT NULL,
        active_delivery_attempt_id TEXT,
        delivery_attempt_ids_json TEXT NOT NULL,
        payload_ref_json TEXT NOT NULL,
        payload_json TEXT,
        artifact_refs_json TEXT,
        artifact_dir TEXT NOT NULL,
        compat_artifact_dir TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        consumed_by_node_exec_id TEXT,
        consumed_at TEXT,
        failure_reason TEXT,
        superseded_by_communication_id TEXT,
        superseded_at TEXT,
        replayed_from_communication_id TEXT,
        manager_message_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workflow_execution_id, communication_id)
      );
    `);
    legacyDb
      .prepare(
        `
          INSERT INTO workflow_messages (
            workflow_id, workflow_execution_id, communication_id, from_node_id,
            to_node_id, routing_scope, delivery_kind, transition_when,
            source_node_exec_id, status, active_delivery_attempt_id,
            delivery_attempt_ids_json, payload_ref_json, payload_json,
            artifact_refs_json, artifact_dir, compat_artifact_dir, created_at,
            delivered_at, consumed_by_node_exec_id, consumed_at, failure_reason,
            superseded_by_communication_id, superseded_at,
            replayed_from_communication_id, manager_message_id, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "demo",
        "sess-json-checks",
        "comm-legacy-json",
        "manager",
        "worker",
        "intra-workflow",
        "edge-transition",
        "always",
        "exec-000001",
        "delivered",
        "attempt-000001",
        '["attempt-000001"]',
        '{"kind":"node-output","workflowExecutionId":"sess-json-checks"}',
        '{"payload":{"ok":true}}',
        "[]",
        "/tmp/artifacts",
        "/tmp/compat-artifacts",
        "2026-06-07T00:00:00.000Z",
        "2026-06-07T00:00:00.000Z",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        "2026-06-07T00:00:00.000Z",
      );
    legacyDb.close();

    await withDatabase(options, () => undefined);

    const db = new Database(dbPath);
    try {
      const table = db
        .query(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workflow_messages'",
        )
        .get() as { readonly sql: string } | null;
      expect(table?.sql).toContain(
        "CHECK (json_valid(delivery_attempt_ids_json))",
      );
      expect(table?.sql).toContain("CHECK (json_valid(payload_ref_json))");
      expect(table?.sql).toContain(
        "CHECK (payload_json IS NULL OR json_valid(payload_json))",
      );
      expect(table?.sql).toContain(
        "CHECK (artifact_refs_json IS NULL OR json_valid(artifact_refs_json))",
      );
      const migratedRows = db
        .query(
          `
            SELECT communication_id, payload_json, artifact_refs_json, artifact_dir
            FROM workflow_messages
            ORDER BY communication_id ASC
          `,
        )
        .all() as readonly {
        readonly communication_id: string;
        readonly payload_json: string | null;
        readonly artifact_refs_json: string | null;
        readonly artifact_dir: string;
      }[];
      expect(migratedRows).toEqual([
        {
          communication_id: "comm-legacy-json",
          payload_json: '{"payload":{"ok":true}}',
          artifact_refs_json: "[]",
          artifact_dir: "/tmp/artifacts",
        },
      ]);
      expectSqliteJsonCheckRejection(() =>
        insertWorkflowMessageJsonConstraintRow(db, {
          communicationId: "comm-legacy-bad-json",
          payloadJson: "{bad-json",
        }),
      );
    } finally {
      db.close();
    }
  });

  test("fails malformed legacy workflow_messages compat rebuild without dropping source rows", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root);
    const dbPath = resolveRuntimeDbPath(options);
    await mkdir(path.dirname(dbPath), { recursive: true });
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE workflow_messages (
        workflow_id TEXT NOT NULL,
        workflow_execution_id TEXT NOT NULL,
        communication_id TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        routing_scope TEXT NOT NULL,
        delivery_kind TEXT NOT NULL,
        transition_when TEXT NOT NULL,
        source_node_exec_id TEXT NOT NULL,
        status TEXT NOT NULL,
        active_delivery_attempt_id TEXT,
        delivery_attempt_ids_json TEXT NOT NULL,
        payload_ref_json TEXT NOT NULL,
        payload_json TEXT,
        artifact_refs_json TEXT,
        artifact_dir TEXT NOT NULL,
        compat_artifact_dir TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        consumed_by_node_exec_id TEXT,
        consumed_at TEXT,
        failure_reason TEXT,
        superseded_by_communication_id TEXT,
        superseded_at TEXT,
        replayed_from_communication_id TEXT,
        manager_message_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workflow_execution_id, communication_id)
      );
    `);
    legacyDb
      .prepare(
        `
          INSERT INTO workflow_messages (
            workflow_id, workflow_execution_id, communication_id, from_node_id,
            to_node_id, routing_scope, delivery_kind, transition_when,
            source_node_exec_id, status, active_delivery_attempt_id,
            delivery_attempt_ids_json, payload_ref_json, payload_json,
            artifact_refs_json, artifact_dir, compat_artifact_dir, created_at,
            delivered_at, consumed_by_node_exec_id, consumed_at, failure_reason,
            superseded_by_communication_id, superseded_at,
            replayed_from_communication_id, manager_message_id, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "demo",
        "sess-json-checks",
        "comm-legacy-malformed-json",
        "manager",
        "worker",
        "intra-workflow",
        "edge-transition",
        "always",
        "exec-000001",
        "delivered",
        "attempt-000001",
        '["attempt-000001"]',
        '{"kind":"node-output","workflowExecutionId":"sess-json-checks"}',
        "{bad-json",
        "[]",
        "/tmp/artifacts",
        "/tmp/compat-artifacts",
        "2026-06-07T00:00:00.000Z",
        "2026-06-07T00:00:00.000Z",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        "2026-06-07T00:00:00.000Z",
      );
    legacyDb.close();

    await expect(withDatabase(options, () => undefined)).rejects.toThrow(
      /CHECK constraint failed|constraint/i,
    );

    const db = new Database(dbPath);
    try {
      const rows = db
        .query(
          `
            SELECT communication_id, payload_json
            FROM workflow_messages
            ORDER BY communication_id ASC
          `,
        )
        .all() as readonly {
        readonly communication_id: string;
        readonly payload_json: string | null;
      }[];
      expect(rows).toEqual([
        {
          communication_id: "comm-legacy-malformed-json",
          payload_json: "{bad-json",
        },
      ]);
      const columns = db
        .query("PRAGMA table_info(workflow_messages)")
        .all() as readonly { readonly name: string }[];
      expect(columns.map((column) => column.name)).toContain(
        "compat_artifact_dir",
      );
      const tempTable = db
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workflow_messages_new'",
        )
        .get();
      expect(tempTable).toBeNull();
    } finally {
      db.close();
    }
  });

  test("rejects malformed JSON in representative runtime and event tables", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root);

    await withDatabase(options, () => undefined);
    let db = new Database(resolveRuntimeDbPath(options));
    try {
      expectSqliteJsonCheckRejection(() =>
        db
          .prepare(
            `
              INSERT INTO sessions (
                session_id, workflow_name, workflow_id, status, started_at,
                node_execution_counter, queue_json, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            "sess-bad-json",
            "demo",
            "demo",
            "running",
            "2026-06-07T00:00:00.000Z",
            0,
            "{bad-json",
            "2026-06-07T00:00:00.000Z",
          ),
      );
      db.prepare(
        `
          INSERT INTO sessions (
            session_id, workflow_name, workflow_id, status, started_at,
            node_execution_counter, queue_json, supervision_json,
            history_imports_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        "sess-valid-json",
        "demo",
        "demo",
        "running",
        "2026-06-07T00:00:00.000Z",
        0,
        "[]",
        null,
        null,
        "2026-06-07T00:00:00.000Z",
      );
    } finally {
      db.close();
    }

    await withEventRuntimeDatabase(options, () => undefined);
    db = new Database(resolveRuntimeDbPath(options));
    try {
      expectSqliteJsonCheckRejection(() =>
        db
          .prepare(
            `
              INSERT INTO event_reply_dispatches (
                idempotency_key, source_id, provider, workflow_id,
                workflow_execution_id, node_id, node_exec_id, event_id,
                conversation_id, status, request_json, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            "idem-bad-request",
            "discord",
            "discord",
            "demo",
            "sess-event-json",
            "node",
            "exec-000001",
            "event-1",
            "conversation-1",
            "dispatching",
            "{bad-json",
            "2026-06-07T00:00:00.000Z",
            "2026-06-07T00:00:00.000Z",
          ),
      );
      expectSqliteJsonCheckRejection(() =>
        db
          .prepare(
            `
              INSERT INTO supervisor_dispatch_decisions (
                decision_id, supervisor_conversation_id, source_message_id,
                profile_revision, conversation_revision, status,
                proposal_json, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            "decision-bad-json",
            "conversation-1",
            "message-1",
            "profile-1",
            1,
            "pending",
            "{bad-json",
            "2026-06-07T00:00:00.000Z",
            "2026-06-07T00:00:00.000Z",
          ),
      );
    } finally {
      db.close();
    }
  });

  test("materializes root-data attachments under the attachment root before storing sqlite refs", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const sourceRelativePath =
      "files/demo/sess-message-attachments/attachments/brief.txt";
    const sourcePath = path.join(rootDataDir, ...sourceRelativePath.split("/"));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "attachment body\n", "utf8");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-message-attachments",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-message-attachments",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const outputRaw = `${JSON.stringify({
      provider: "manager-message",
      model: "manager",
      promptText: "deliver",
      completionPassed: true,
      when: { always: true },
      payload: {
        attachments: [
          {
            path: sourceRelativePath,
            mediaType: "text/plain",
            content: "must not be stored in sqlite",
          },
        ],
      },
    })}\n`;

    const record = await saveWorkflowMessageToRuntimeDb(
      { communication, outputRaw },
      {
        cwd: root,
        rootDataDir,
        env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
      },
    );

    const refs = JSON.parse(record.artifactRefsJson ?? "[]") as Array<{
      readonly pathBase: string;
      readonly path: string;
      readonly mediaType?: string;
      readonly byteLength?: number;
      readonly sourcePath?: string;
    }>;
    expect(refs).toEqual([
      {
        pathBase: "attachment-root",
        path: "demo/sess-message-attachments/messages/comm-000001/files/attachments/brief.txt",
        mediaType: "text/plain",
        byteLength: 16,
        sourcePath: sourceRelativePath,
      },
    ]);
    await expect(
      readFile(
        path.join(
          attachmentRoot,
          "demo",
          "sess-message-attachments",
          "messages",
          "comm-000001",
          "files",
          "attachments",
          "brief.txt",
        ),
        "utf8",
      ),
    ).resolves.toBe("attachment body\n");
    expect(record.payloadJson).toContain("attachment-root");
    expect(record.payloadJson).not.toContain("must not be stored in sqlite");
  });

  test("streams large root-data attachments into attachment-root refs", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const sourceRelativePath =
      "files/demo/sess-large-message-attachments/attachments/large.txt";
    const sourcePath = path.join(rootDataDir, ...sourceRelativePath.split("/"));
    const largeBody = "0123456789abcdef".repeat(160_000);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, largeBody, "utf8");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-large-message-attachments",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-large-message-attachments",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;

    const record = await saveWorkflowMessageToRuntimeDb(
      {
        communication,
        outputRaw: JSON.stringify({
          payload: { attachments: [{ path: sourceRelativePath }] },
        }),
      },
      {
        cwd: root,
        rootDataDir,
        env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
      },
    );

    const refs = JSON.parse(record.artifactRefsJson ?? "[]") as Array<{
      readonly byteLength?: number;
      readonly path: string;
    }>;
    expect(refs[0]?.byteLength).toBe(largeBody.length);
    await expect(
      readFile(
        path.join(
          attachmentRoot,
          "demo",
          "sess-large-message-attachments",
          "messages",
          "comm-000001",
          "files",
          "attachments",
          "large.txt",
        ),
        "utf8",
      ),
    ).resolves.toBe(largeBody);
  });

  test("rejects cross-workflow or cross-run root-data attachment refs", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const crossWorkflowPath = "files/other/sess-message-attachments/secret.txt";
    const crossRunPath = "files/demo/other-run/secret.txt";
    const missingCrossWorkflowPath =
      "files/other/sess-message-attachments/missing.txt";
    for (const sourceRelativePath of [crossWorkflowPath, crossRunPath]) {
      const sourcePath = path.join(
        rootDataDir,
        ...sourceRelativePath.split("/"),
      );
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, "secret\n", "utf8");
    }
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-message-attachments",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-message-attachments",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;

    for (const sourceRelativePath of [
      crossWorkflowPath,
      crossRunPath,
      missingCrossWorkflowPath,
    ]) {
      await expect(
        saveWorkflowMessageToRuntimeDb(
          {
            communication,
            outputRaw: JSON.stringify({
              payload: {
                attachments: [
                  {
                    path: sourceRelativePath,
                    mediaType: "text/plain",
                  },
                ],
              },
            }),
          },
          {
            cwd: root,
            rootDataDir,
            env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
          },
        ),
      ).rejects.toThrow("current workflow execution");
    }
  });

  test("rejects symlink escapes for root-data and attachment-root refs", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const outsideSecretPath = path.join(root, "outside-secret.txt");
    await writeFile(outsideSecretPath, "outside secret\n", "utf8");
    const rootDataLinkRelativePath =
      "files/demo/sess-symlink/attachments/link.txt";
    const rootDataLinkPath = path.join(
      rootDataDir,
      ...rootDataLinkRelativePath.split("/"),
    );
    await mkdir(path.dirname(rootDataLinkPath), { recursive: true });
    await symlink(outsideSecretPath, rootDataLinkPath);
    const attachmentRootLinkRelativePath =
      "demo/sess-symlink/messages/comm-000001/files/link.txt";
    const attachmentRootLinkPath = path.join(
      attachmentRoot,
      ...attachmentRootLinkRelativePath.split("/"),
    );
    await mkdir(path.dirname(attachmentRootLinkPath), { recursive: true });
    await symlink(outsideSecretPath, attachmentRootLinkPath);
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-symlink",
      communicationId: "comm-000002",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-symlink",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-2"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      rootDataDir,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: {
              attachments: [{ path: rootDataLinkRelativePath }],
            },
          }),
        },
        options,
      ),
    ).rejects.toThrow("attachment source");
    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: {
              attachments: [
                {
                  pathBase: "attachment-root",
                  path: attachmentRootLinkRelativePath,
                },
              ],
            },
          }),
        },
        options,
      ),
    ).rejects.toThrow("attachment source");
  });

  test("rejects symlinked workflow execution attachment scope directories", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const outsideRootDataScope = path.join(root, "outside-root-data-scope");
    await mkdir(outsideRootDataScope, { recursive: true });
    await writeFile(
      path.join(outsideRootDataScope, "secret.txt"),
      "outside root data secret\n",
      "utf8",
    );
    const rootDataScopePath = path.join(
      rootDataDir,
      "files",
      "demo",
      "sess-scope-symlink",
    );
    await mkdir(path.dirname(rootDataScopePath), { recursive: true });
    await symlink(outsideRootDataScope, rootDataScopePath);
    const outsideAttachmentMessages = path.join(
      root,
      "outside-attachment-messages",
    );
    await mkdir(path.join(outsideAttachmentMessages, "comm-000001"), {
      recursive: true,
    });
    await writeFile(
      path.join(outsideAttachmentMessages, "comm-000001", "secret.txt"),
      "outside attachment secret\n",
      "utf8",
    );
    const attachmentMessagesPath = path.join(
      attachmentRoot,
      "demo",
      "sess-scope-symlink",
      "messages",
    );
    await mkdir(path.dirname(attachmentMessagesPath), { recursive: true });
    await symlink(outsideAttachmentMessages, attachmentMessagesPath);
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-scope-symlink",
      communicationId: "comm-000002",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-scope-symlink",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-2"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      rootDataDir,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: {
              attachments: [
                { path: "files/demo/sess-scope-symlink/secret.txt" },
              ],
            },
          }),
        },
        options,
      ),
    ).rejects.toThrow("current workflow execution");
    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: {
              attachments: [
                {
                  pathBase: "attachment-root",
                  path: "demo/sess-scope-symlink/messages/comm-000001/secret.txt",
                },
              ],
            },
          }),
        },
        options,
      ),
    ).rejects.toThrow("current workflow execution");
  });

  test("rejects attachment source hardlinks for root-data and attachment-root refs", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const outsideRootDataSource = path.join(
      root,
      "outside-root-data-source.txt",
    );
    await writeFile(
      outsideRootDataSource,
      "outside root-data source\n",
      "utf8",
    );
    const rootDataSourceRelativePath =
      "files/demo/sess-source-hardlink/attachments/source.txt";
    const rootDataSourcePath = path.join(
      rootDataDir,
      ...rootDataSourceRelativePath.split("/"),
    );
    await mkdir(path.dirname(rootDataSourcePath), { recursive: true });
    await link(outsideRootDataSource, rootDataSourcePath);
    const outsideAttachmentRootSource = path.join(
      root,
      "outside-attachment-root-source.txt",
    );
    await writeFile(
      outsideAttachmentRootSource,
      "outside attachment-root source\n",
      "utf8",
    );
    const attachmentRootSourceRelativePath =
      "demo/sess-source-hardlink/messages/comm-source/files/source.txt";
    const attachmentRootSourcePath = path.join(
      attachmentRoot,
      ...attachmentRootSourceRelativePath.split("/"),
    );
    await mkdir(path.dirname(attachmentRootSourcePath), { recursive: true });
    await link(outsideAttachmentRootSource, attachmentRootSourcePath);
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-source-hardlink",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-source-hardlink",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      rootDataDir,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: {
              attachments: [{ path: rootDataSourceRelativePath }],
            },
          }),
        },
        options,
      ),
    ).rejects.toThrow("attachment source");

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication: {
            ...communication,
            communicationId: "comm-replay",
            deliveryKind: "manual-rerun",
            transitionWhen: "manual-rerun:comm-source",
            replayedFromCommunicationId: "comm-source",
            artifactDir: path.join(
              root,
              "artifacts",
              "communications",
              "comm-replay",
            ),
          },
          outputRaw: JSON.stringify({
            payload: {
              attachments: [
                {
                  pathBase: "attachment-root",
                  path: attachmentRootSourceRelativePath,
                },
              ],
            },
          }),
        },
        options,
      ),
    ).rejects.toThrow("attachment source");
  });

  test("rejects preexisting attachment target symlinks and hardlinks", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const sourceRelativePath =
      "files/demo/sess-target-symlink/attachments/source.txt";
    const sourcePath = path.join(rootDataDir, ...sourceRelativePath.split("/"));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "safe source\n", "utf8");
    const outsideRootDataTarget = path.join(
      root,
      "outside-root-data-target.txt",
    );
    await writeFile(outsideRootDataTarget, "outside before\n", "utf8");
    const rootDataTargetPath = path.join(
      attachmentRoot,
      "demo",
      "sess-target-symlink",
      "messages",
      "comm-000001",
      "files",
      "attachments",
      "source.txt",
    );
    await mkdir(path.dirname(rootDataTargetPath), { recursive: true });
    await symlink(outsideRootDataTarget, rootDataTargetPath);
    const rootDataCommunication = {
      workflowId: "demo",
      workflowExecutionId: "sess-target-symlink",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-target-symlink",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      rootDataDir,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication: rootDataCommunication,
          outputRaw: JSON.stringify({
            payload: { attachments: [{ path: sourceRelativePath }] },
          }),
        },
        options,
      ),
    ).rejects.toThrow("attachment target");
    await expect(readFile(outsideRootDataTarget, "utf8")).resolves.toBe(
      "outside before\n",
    );

    const replaySourcePath = path.join(
      attachmentRoot,
      "demo",
      "sess-target-symlink",
      "messages",
      "comm-source",
      "files",
      "source.txt",
    );
    await mkdir(path.dirname(replaySourcePath), { recursive: true });
    await writeFile(replaySourcePath, "replay source\n", "utf8");
    const outsideReplayTarget = path.join(root, "outside-replay-target.txt");
    await writeFile(outsideReplayTarget, "outside replay before\n", "utf8");
    const replayTargetPath = path.join(
      attachmentRoot,
      "demo",
      "sess-target-symlink",
      "messages",
      "comm-replay",
      "files",
      "source.txt",
    );
    await mkdir(path.dirname(replayTargetPath), { recursive: true });
    await symlink(outsideReplayTarget, replayTargetPath);
    const replayCommunication = {
      ...rootDataCommunication,
      communicationId: "comm-replay",
      deliveryKind: "manual-rerun" as const,
      transitionWhen: "manual-rerun:comm-source",
      replayedFromCommunicationId: "comm-source",
      artifactDir: path.join(
        root,
        "artifacts",
        "communications",
        "comm-replay",
      ),
    } satisfies CommunicationRecord;

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication: replayCommunication,
          outputRaw: JSON.stringify({
            payload: {
              attachments: [
                {
                  pathBase: "attachment-root",
                  path: "demo/sess-target-symlink/messages/comm-source/files/source.txt",
                },
              ],
            },
          }),
        },
        options,
      ),
    ).rejects.toThrow("attachment target");
    await expect(readFile(outsideReplayTarget, "utf8")).resolves.toBe(
      "outside replay before\n",
    );

    const outsideRootDataHardlinkTarget = path.join(
      root,
      "outside-root-data-hardlink-target.txt",
    );
    await writeFile(
      outsideRootDataHardlinkTarget,
      "outside hardlink\n",
      "utf8",
    );
    const rootDataHardlinkTargetPath = path.join(
      attachmentRoot,
      "demo",
      "sess-target-symlink",
      "messages",
      "comm-hardlink",
      "files",
      "attachments",
      "source.txt",
    );
    await mkdir(path.dirname(rootDataHardlinkTargetPath), { recursive: true });
    await link(outsideRootDataHardlinkTarget, rootDataHardlinkTargetPath);
    const rootDataHardlinkCommunication = {
      ...rootDataCommunication,
      communicationId: "comm-hardlink",
      artifactDir: path.join(
        root,
        "artifacts",
        "communications",
        "comm-hardlink",
      ),
    } satisfies CommunicationRecord;

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication: rootDataHardlinkCommunication,
          outputRaw: JSON.stringify({
            payload: { attachments: [{ path: sourceRelativePath }] },
          }),
        },
        options,
      ),
    ).rejects.toThrow("attachment target");
    await expect(readFile(outsideRootDataHardlinkTarget, "utf8")).resolves.toBe(
      "outside hardlink\n",
    );

    const outsideReplayHardlinkTarget = path.join(
      root,
      "outside-replay-hardlink-target.txt",
    );
    await writeFile(
      outsideReplayHardlinkTarget,
      "outside replay hardlink\n",
      "utf8",
    );
    const replayHardlinkTargetPath = path.join(
      attachmentRoot,
      "demo",
      "sess-target-symlink",
      "messages",
      "comm-hardlink-replay",
      "files",
      "source.txt",
    );
    await mkdir(path.dirname(replayHardlinkTargetPath), { recursive: true });
    await link(outsideReplayHardlinkTarget, replayHardlinkTargetPath);
    const replayHardlinkCommunication = {
      ...rootDataCommunication,
      communicationId: "comm-hardlink-replay",
      deliveryKind: "manual-rerun" as const,
      transitionWhen: "manual-rerun:comm-source",
      replayedFromCommunicationId: "comm-source",
      artifactDir: path.join(
        root,
        "artifacts",
        "communications",
        "comm-hardlink-replay",
      ),
    } satisfies CommunicationRecord;

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication: replayHardlinkCommunication,
          outputRaw: JSON.stringify({
            payload: {
              attachments: [
                {
                  pathBase: "attachment-root",
                  path: "demo/sess-target-symlink/messages/comm-source/files/source.txt",
                },
              ],
            },
          }),
        },
        options,
      ),
    ).rejects.toThrow("attachment target");
    await expect(readFile(outsideReplayHardlinkTarget, "utf8")).resolves.toBe(
      "outside replay hardlink\n",
    );
  });

  test("rejects raced attachment target symlinks before writing", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const sourceRelativePath =
      "files/demo/sess-target-race/attachments/source.txt";
    const sourcePath = path.join(rootDataDir, ...sourceRelativePath.split("/"));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "safe source\n", "utf8");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-target-race",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-target-race",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      rootDataDir,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };
    const outsideRootDataTarget = path.join(
      root,
      "outside-raced-root-data-target.txt",
    );
    await writeFile(outsideRootDataTarget, "outside before\n", "utf8");
    const restoreRootDataHook =
      setWorkflowMessageAttachmentTargetWriteHookForTests(
        async (targetAbsolutePath) => {
          await symlink(outsideRootDataTarget, targetAbsolutePath);
        },
      );
    try {
      await expect(
        saveWorkflowMessageToRuntimeDb(
          {
            communication,
            outputRaw: JSON.stringify({
              payload: { attachments: [{ path: sourceRelativePath }] },
            }),
          },
          options,
        ),
      ).rejects.toThrow("attachment target");
    } finally {
      restoreRootDataHook();
    }
    await expect(readFile(outsideRootDataTarget, "utf8")).resolves.toBe(
      "outside before\n",
    );
    await expect(
      loadWorkflowMessageFromRuntimeDb(
        {
          workflowExecutionId: communication.workflowExecutionId,
          communicationId: communication.communicationId,
        },
        options,
      ),
    ).resolves.toBeNull();

    const replaySourceRelativePath =
      "demo/sess-target-race/messages/comm-source/files/source.txt";
    const replaySourcePath = path.join(
      attachmentRoot,
      ...replaySourceRelativePath.split("/"),
    );
    await mkdir(path.dirname(replaySourcePath), { recursive: true });
    await writeFile(replaySourcePath, "replay source\n", "utf8");
    const replayCommunication = {
      ...communication,
      communicationId: "comm-replay",
      deliveryKind: "manual-rerun" as const,
      transitionWhen: "manual-rerun:comm-source",
      replayedFromCommunicationId: "comm-source",
      artifactDir: path.join(
        root,
        "artifacts",
        "communications",
        "comm-replay",
      ),
    } satisfies CommunicationRecord;
    const outsideReplayTarget = path.join(
      root,
      "outside-raced-replay-target.txt",
    );
    await writeFile(outsideReplayTarget, "outside replay before\n", "utf8");
    const restoreReplayHook =
      setWorkflowMessageAttachmentTargetWriteHookForTests(
        async (targetAbsolutePath) => {
          await symlink(outsideReplayTarget, targetAbsolutePath);
        },
      );
    try {
      await expect(
        saveWorkflowMessageToRuntimeDb(
          {
            communication: replayCommunication,
            outputRaw: JSON.stringify({
              payload: {
                attachments: [
                  {
                    pathBase: "attachment-root",
                    path: replaySourceRelativePath,
                  },
                ],
              },
            }),
          },
          options,
        ),
      ).rejects.toThrow("attachment target");
    } finally {
      restoreReplayHook();
    }
    await expect(readFile(outsideReplayTarget, "utf8")).resolves.toBe(
      "outside replay before\n",
    );
    await expect(
      loadWorkflowMessageFromRuntimeDb(
        {
          workflowExecutionId: replayCommunication.workflowExecutionId,
          communicationId: replayCommunication.communicationId,
        },
        options,
      ),
    ).resolves.toBeNull();
  });

  test("rejects raced attachment source symlinks before writing", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const sourceRelativePath =
      "files/demo/sess-source-race/attachments/source.txt";
    const sourcePath = path.join(rootDataDir, ...sourceRelativePath.split("/"));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "safe source\n", "utf8");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-source-race",
      communicationId: "comm-root",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-source-race",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-root"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      rootDataDir,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };
    const outsideRootDataSource = path.join(
      root,
      "outside-raced-root-data-source.txt",
    );
    await writeFile(
      outsideRootDataSource,
      "outside raced root-data source\n",
      "utf8",
    );
    const restoreRootDataHook =
      setWorkflowMessageAttachmentSourceOpenHookForTests(
        async (sourceRealPath) => {
          await rm(sourceRealPath, { force: true });
          await symlink(outsideRootDataSource, sourceRealPath);
        },
      );
    try {
      await expect(
        saveWorkflowMessageToRuntimeDb(
          {
            communication,
            outputRaw: JSON.stringify({
              payload: { attachments: [{ path: sourceRelativePath }] },
            }),
          },
          options,
        ),
      ).rejects.toThrow("attachment source");
    } finally {
      restoreRootDataHook();
    }
    await expect(readFile(outsideRootDataSource, "utf8")).resolves.toBe(
      "outside raced root-data source\n",
    );
    const rootDataTargetPath = path.join(
      attachmentRoot,
      "demo",
      "sess-source-race",
      "messages",
      "comm-root",
      "files",
      "attachments",
      "source.txt",
    );
    const rootDataTarget = await readFile(rootDataTargetPath, "utf8").catch(
      () => null,
    );
    expect(rootDataTarget).not.toBe("outside raced root-data source\n");
    await expect(
      loadWorkflowMessageFromRuntimeDb(
        {
          workflowExecutionId: communication.workflowExecutionId,
          communicationId: communication.communicationId,
        },
        options,
      ),
    ).resolves.toBeNull();

    const replaySourceRelativePath =
      "demo/sess-source-race/messages/comm-source/files/source.txt";
    const replaySourcePath = path.join(
      attachmentRoot,
      ...replaySourceRelativePath.split("/"),
    );
    await mkdir(path.dirname(replaySourcePath), { recursive: true });
    await writeFile(replaySourcePath, "safe replay source\n", "utf8");
    const replayCommunication = {
      ...communication,
      communicationId: "comm-replay",
      deliveryKind: "manual-rerun" as const,
      transitionWhen: "manual-rerun:comm-source",
      replayedFromCommunicationId: "comm-source",
      artifactDir: path.join(
        root,
        "artifacts",
        "communications",
        "comm-replay",
      ),
    } satisfies CommunicationRecord;
    const outsideReplaySource = path.join(
      root,
      "outside-raced-replay-source.txt",
    );
    await writeFile(
      outsideReplaySource,
      "outside raced replay source\n",
      "utf8",
    );
    const restoreReplayHook =
      setWorkflowMessageAttachmentSourceOpenHookForTests(
        async (sourceRealPath) => {
          await rm(sourceRealPath, { force: true });
          await symlink(outsideReplaySource, sourceRealPath);
        },
      );
    try {
      await expect(
        saveWorkflowMessageToRuntimeDb(
          {
            communication: replayCommunication,
            outputRaw: JSON.stringify({
              payload: {
                attachments: [
                  {
                    pathBase: "attachment-root",
                    path: replaySourceRelativePath,
                  },
                ],
              },
            }),
          },
          options,
        ),
      ).rejects.toThrow("attachment source");
    } finally {
      restoreReplayHook();
    }
    await expect(readFile(outsideReplaySource, "utf8")).resolves.toBe(
      "outside raced replay source\n",
    );
    const replayTargetPath = path.join(
      attachmentRoot,
      "demo",
      "sess-source-race",
      "messages",
      "comm-replay",
      "files",
      "source.txt",
    );
    const replayTarget = await readFile(replayTargetPath, "utf8").catch(
      () => null,
    );
    expect(replayTarget).not.toBe("outside raced replay source\n");
    await expect(
      loadWorkflowMessageFromRuntimeDb(
        {
          workflowExecutionId: replayCommunication.workflowExecutionId,
          communicationId: replayCommunication.communicationId,
        },
        options,
      ),
    ).resolves.toBeNull();
  });

  test("cleans copied attachments when sqlite persistence fails before row insert", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const sourceRelativePath =
      "files/demo/sess-post-copy-failure/attachments/source.txt";
    const sourcePath = path.join(rootDataDir, ...sourceRelativePath.split("/"));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "safe source\n", "utf8");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-post-copy-failure",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-post-copy-failure",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const targetPath = path.join(
      attachmentRoot,
      "demo",
      "sess-post-copy-failure",
      "messages",
      "comm-000001",
      "files",
      "attachments",
      "source.txt",
    );
    const failedDbPath = path.join(root, "db-directory");
    await mkdir(failedDbPath, { recursive: true });
    const failingOptions = {
      cwd: root,
      rootDataDir,
      env: {
        RIEL_ATTACHMENT_ROOT: attachmentRoot,
        RIEL_RUNTIME_DB: failedDbPath,
      },
    };

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: { attachments: [{ path: sourceRelativePath }] },
          }),
        },
        failingOptions,
      ),
    ).rejects.toThrow();
    await expect(readFile(targetPath, "utf8")).rejects.toThrow();

    const retryOptions = {
      cwd: root,
      rootDataDir,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };
    await saveWorkflowMessageToRuntimeDb(
      {
        communication,
        outputRaw: JSON.stringify({
          payload: { attachments: [{ path: sourceRelativePath }] },
        }),
      },
      retryOptions,
    );

    await expect(readFile(targetPath, "utf8")).resolves.toBe("safe source\n");
    const persisted = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: communication.workflowExecutionId,
        communicationId: communication.communicationId,
      },
      retryOptions,
    );
    expect(persisted).not.toBeNull();
    expect(persisted?.artifactRefsJson).toContain(
      "demo/sess-post-copy-failure/messages/comm-000001/files/attachments/source.txt",
    );
  });

  test("cleans partial attachment targets when target write fails before row insert", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const sourceRelativePath =
      "files/demo/sess-target-write-failure/attachments/source.txt";
    const sourcePath = path.join(rootDataDir, ...sourceRelativePath.split("/"));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "safe source\n", "utf8");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-target-write-failure",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-target-write-failure",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      rootDataDir,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };
    const targetPath = path.join(
      attachmentRoot,
      "demo",
      "sess-target-write-failure",
      "messages",
      "comm-000001",
      "files",
      "attachments",
      "source.txt",
    );
    const restoreHook = setWorkflowMessageAttachmentTargetFileWriteHookForTests(
      () => {
        throw new Error("forced attachment target write failure");
      },
    );
    try {
      await expect(
        saveWorkflowMessageToRuntimeDb(
          {
            communication,
            outputRaw: JSON.stringify({
              payload: { attachments: [{ path: sourceRelativePath }] },
            }),
          },
          options,
        ),
      ).rejects.toThrow("forced attachment target write failure");
    } finally {
      restoreHook();
    }
    await expect(readFile(targetPath, "utf8")).rejects.toThrow();

    await saveWorkflowMessageToRuntimeDb(
      {
        communication,
        outputRaw: JSON.stringify({
          payload: { attachments: [{ path: sourceRelativePath }] },
        }),
      },
      options,
    );

    await expect(readFile(targetPath, "utf8")).resolves.toBe("safe source\n");
    await expect(
      loadWorkflowMessageFromRuntimeDb(
        {
          workflowExecutionId: communication.workflowExecutionId,
          communicationId: communication.communicationId,
        },
        options,
      ),
    ).resolves.not.toBeNull();
  });

  test("cleans attachment targets when close path fails before row insert", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const sourceRelativePath =
      "files/demo/sess-target-close-failure/attachments/source.txt";
    const sourcePath = path.join(rootDataDir, ...sourceRelativePath.split("/"));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "safe source\n", "utf8");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-target-close-failure",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-target-close-failure",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      rootDataDir,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };
    const targetPath = path.join(
      attachmentRoot,
      "demo",
      "sess-target-close-failure",
      "messages",
      "comm-000001",
      "files",
      "attachments",
      "source.txt",
    );
    const restoreHook = setWorkflowMessageAttachmentTargetCloseHookForTests(
      () => {
        throw new Error("forced attachment target close failure");
      },
    );
    try {
      await expect(
        saveWorkflowMessageToRuntimeDb(
          {
            communication,
            outputRaw: JSON.stringify({
              payload: { attachments: [{ path: sourceRelativePath }] },
            }),
          },
          options,
        ),
      ).rejects.toThrow("forced attachment target close failure");
    } finally {
      restoreHook();
    }
    await expect(readFile(targetPath, "utf8")).rejects.toThrow();

    await saveWorkflowMessageToRuntimeDb(
      {
        communication,
        outputRaw: JSON.stringify({
          payload: { attachments: [{ path: sourceRelativePath }] },
        }),
      },
      options,
    );

    await expect(readFile(targetPath, "utf8")).resolves.toBe("safe source\n");
    await expect(
      loadWorkflowMessageFromRuntimeDb(
        {
          workflowExecutionId: communication.workflowExecutionId,
          communicationId: communication.communicationId,
        },
        options,
      ),
    ).resolves.not.toBeNull();
  });

  test("rejects target parent symlinks before creating missing descendants", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const sourceRelativePath =
      "files/demo/sess-target-parent-symlink/attachments/source.txt";
    const sourcePath = path.join(rootDataDir, ...sourceRelativePath.split("/"));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "safe source\n", "utf8");
    const outsideTargetParent = path.join(root, "outside-target-parent");
    await mkdir(outsideTargetParent, { recursive: true });
    const targetFilesPath = path.join(
      attachmentRoot,
      "demo",
      "sess-target-parent-symlink",
      "messages",
      "comm-000001",
      "files",
    );
    await mkdir(path.dirname(targetFilesPath), { recursive: true });
    await symlink(outsideTargetParent, targetFilesPath);
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-target-parent-symlink",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-target-parent-symlink",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: { attachments: [{ path: sourceRelativePath }] },
          }),
        },
        {
          cwd: root,
          rootDataDir,
          env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
        },
      ),
    ).rejects.toThrow("attachment target");
    await expect(
      stat(path.join(outsideTargetParent, "attachments")),
    ).rejects.toThrow("ENOENT");
  });

  test("failed SQLite writes block message publication by failing before delivery when attachment source files are missing", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-missing-attachment",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-missing-attachment",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: {
              attachments: [
                {
                  path: "files/demo/sess-missing-attachment/attachments/missing.txt",
                },
              ],
            },
          }),
        },
        { cwd: root, rootDataDir },
      ),
    ).rejects.toThrow("ENOENT");
  });

  test("rejects absolute attachment paths for new sqlite message records", async () => {
    const root = await makeTempDir();
    const absoluteAttachmentPath = path.join(root, "absolute.txt");
    await writeFile(absoluteAttachmentPath, "must remain outside sqlite\n");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-absolute-attachment",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-absolute-attachment",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: {
              attachments: [
                {
                  path: absoluteAttachmentPath,
                  mediaType: "text/plain",
                },
              ],
            },
          }),
        },
        { cwd: root },
      ),
    ).rejects.toThrow("absolute paths");
  });

  test("stores scoped attachment-root refs only when the relative file exists", async () => {
    const root = await makeTempDir();
    const attachmentRoot = path.join(root, "message-files");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-relative-attachment",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-relative-attachment",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const attachmentRelativePath = "attachments/brief.txt";
    const attachmentPath = path.join(
      attachmentRoot,
      "demo",
      "sess-relative-attachment",
      "messages",
      "comm-000001",
      "attachments",
      "brief.txt",
    );

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: { attachments: [{ path: attachmentRelativePath }] },
          }),
        },
        { cwd: root, env: { RIEL_ATTACHMENT_ROOT: attachmentRoot } },
      ),
    ).rejects.toThrow("ENOENT");

    await mkdir(path.dirname(attachmentPath), { recursive: true });
    await writeFile(attachmentPath, "existing attachment\n", "utf8");

    const record = await saveWorkflowMessageToRuntimeDb(
      {
        communication,
        outputRaw: JSON.stringify({
          payload: {
            attachments: [
              { path: attachmentRelativePath, mediaType: "text/plain" },
            ],
          },
        }),
      },
      { cwd: root, env: { RIEL_ATTACHMENT_ROOT: attachmentRoot } },
    );

    expect(JSON.parse(record.artifactRefsJson ?? "[]")).toEqual([
      {
        pathBase: "attachment-root",
        path: "demo/sess-relative-attachment/messages/comm-000001/attachments/brief.txt",
        mediaType: "text/plain",
        byteLength: 20,
      },
    ]);
  });

  test("rejects relative attachment-root source symlinks and hardlinks", async () => {
    const root = await makeTempDir();
    const attachmentRoot = path.join(root, "message-files");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-relative-link",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-relative-link",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };
    const outsideSymlinkSource = path.join(root, "outside-symlink-source.txt");
    await writeFile(outsideSymlinkSource, "outside symlink source\n", "utf8");
    const symlinkSourcePath = path.join(
      attachmentRoot,
      "demo",
      "sess-relative-link",
      "messages",
      "comm-000001",
      "attachments",
      "link.txt",
    );
    await mkdir(path.dirname(symlinkSourcePath), { recursive: true });
    await symlink(outsideSymlinkSource, symlinkSourcePath);

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: { attachments: [{ path: "attachments/link.txt" }] },
          }),
        },
        options,
      ),
    ).rejects.toThrow("attachment source");

    const outsideHardlinkSource = path.join(
      root,
      "outside-hardlink-source.txt",
    );
    await writeFile(outsideHardlinkSource, "outside hardlink source\n", "utf8");
    const hardlinkSourcePath = path.join(
      attachmentRoot,
      "demo",
      "sess-relative-link",
      "messages",
      "comm-hardlink",
      "attachments",
      "hardlink.txt",
    );
    await mkdir(path.dirname(hardlinkSourcePath), { recursive: true });
    await link(outsideHardlinkSource, hardlinkSourcePath);

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication: {
            ...communication,
            communicationId: "comm-hardlink",
            artifactDir: path.join(
              root,
              "artifacts",
              "communications",
              "comm-hardlink",
            ),
          },
          outputRaw: JSON.stringify({
            payload: { attachments: [{ path: "attachments/hardlink.txt" }] },
          }),
        },
        options,
      ),
    ).rejects.toThrow("attachment source");
  });

  test("preserves sqlite payload and artifact refs on state-only message updates", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const sourceRelativePath =
      "files/demo/sess-state-update-attachment/attachments/brief.txt";
    const sourcePath = path.join(rootDataDir, ...sourceRelativePath.split("/"));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "retry-safe attachment\n", "utf8");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-state-update-attachment",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-state-update-attachment",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      rootDataDir,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };
    const savedRecord = await saveWorkflowMessageToRuntimeDb(
      {
        communication,
        outputRaw: JSON.stringify({
          payload: {
            message: "keep me",
            attachments: [{ path: sourceRelativePath }],
          },
        }),
      },
      options,
    );

    await updateWorkflowMessageStatusInRuntimeDb(
      {
        ...communication,
        status: "superseded",
        supersededAt: "2026-04-20T00:00:01.000Z",
        supersededByCommunicationId: "comm-000002",
      },
      options,
    );

    const updatedRecord = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: communication.workflowExecutionId,
        communicationId: communication.communicationId,
      },
      options,
    );

    expect(updatedRecord?.status).toBe("superseded");
    expect(updatedRecord?.supersededByCommunicationId).toBe("comm-000002");
    expect(updatedRecord?.payloadJson).toBe(savedRecord.payloadJson);
    expect(updatedRecord?.artifactRefsJson).toBe(savedRecord.artifactRefsJson);
  });

  test("does not consume superseded sqlite messages from stale finalization", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-consume-superseded",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-consume-superseded",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const options = { cwd: root, rootDataDir };

    await saveWorkflowMessageToRuntimeDb({ communication }, options);
    await updateWorkflowMessageStatusInRuntimeDb(
      {
        ...communication,
        status: "superseded",
        supersededAt: "2026-04-20T00:00:01.000Z",
        supersededByCommunicationId: "comm-000002",
      },
      options,
    );

    await markWorkflowMessagesConsumedInRuntimeDb(
      {
        workflowExecutionId: communication.workflowExecutionId,
        communicationIds: [communication.communicationId],
        consumedByNodeExecId: "exec-stale-finalization",
        consumedAt: "2026-04-20T00:00:02.000Z",
      },
      options,
    );

    const record = await loadWorkflowMessageFromRuntimeDb(
      {
        workflowExecutionId: communication.workflowExecutionId,
        communicationId: communication.communicationId,
      },
      options,
    );
    expect(record?.status).toBe("superseded");
    expect(record?.supersededByCommunicationId).toBe("comm-000002");
    expect(record?.consumedByNodeExecId).toBeNull();
    expect(record?.consumedAt).toBeNull();
  });

  test("replays existing attachment-root refs into the new communication scope", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "runtime-data");
    const attachmentRoot = path.join(root, "message-files");
    const sourceRelativePath =
      "files/demo/sess-replay-attachment/attachments/brief.txt";
    const sourcePath = path.join(rootDataDir, ...sourceRelativePath.split("/"));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "replay attachment\n", "utf8");
    const sourceCommunication = {
      workflowId: "demo",
      workflowExecutionId: "sess-replay-attachment",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-replay-attachment",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-1"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      rootDataDir,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };
    const savedSource = await saveWorkflowMessageToRuntimeDb(
      {
        communication: sourceCommunication,
        outputRaw: JSON.stringify({
          payload: {
            attachments: [{ path: sourceRelativePath }],
          },
        }),
      },
      options,
    );
    expect(savedSource.payloadJson).not.toBeNull();
    if (savedSource.payloadJson === null) {
      return;
    }
    const replayedCommunication = {
      ...sourceCommunication,
      communicationId: "comm-000002",
      deliveryKind: "manual-rerun" as const,
      transitionWhen: "manual-rerun:comm-000001",
      replayedFromCommunicationId: "comm-000001",
      artifactDir: path.join(root, "artifacts", "communications", "comm-2"),
    } satisfies CommunicationRecord;

    const replayed = await saveWorkflowMessageToRuntimeDb(
      {
        communication: replayedCommunication,
        outputRaw: savedSource.payloadJson,
      },
      options,
    );

    expect(JSON.parse(replayed.artifactRefsJson ?? "[]")).toEqual([
      {
        pathBase: "attachment-root",
        path: "demo/sess-replay-attachment/messages/comm-000002/files/attachments/brief.txt",
        byteLength: 18,
        sourcePath:
          "demo/sess-replay-attachment/messages/comm-000001/files/attachments/brief.txt",
      },
    ]);
    await expect(
      readFile(
        path.join(
          attachmentRoot,
          "demo",
          "sess-replay-attachment",
          "messages",
          "comm-000002",
          "files",
          "attachments",
          "brief.txt",
        ),
        "utf8",
      ),
    ).resolves.toBe("replay attachment\n");
  });

  test("rejects cross-workflow or cross-run attachment-root refs", async () => {
    const root = await makeTempDir();
    const attachmentRoot = path.join(root, "message-files");
    const communication = {
      workflowId: "demo",
      workflowExecutionId: "sess-replay-attachment",
      communicationId: "comm-000002",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-replay-attachment",
        workflowId: "demo",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "manual-rerun",
      transitionWhen: "manual-rerun:comm-000001",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(root, "artifacts", "communications", "comm-2"),
    } satisfies CommunicationRecord;
    const options = {
      cwd: root,
      env: { RIEL_ATTACHMENT_ROOT: attachmentRoot },
    };

    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: {
              attachments: [
                {
                  pathBase: "attachment-root",
                  path: "other/sess-replay-attachment/messages/comm-000001/secret.txt",
                },
              ],
            },
          }),
        },
        options,
      ),
    ).rejects.toThrow("current workflow execution");
    await expect(
      saveWorkflowMessageToRuntimeDb(
        {
          communication,
          outputRaw: JSON.stringify({
            payload: {
              attachments: [
                {
                  pathBase: "attachment-root",
                  path: "demo/other-run/messages/comm-000001/secret.txt",
                },
              ],
            },
          }),
        },
        options,
      ),
    ).rejects.toThrow("current workflow execution");
  });

  test("persists output validation retry metadata for node executions", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "sqlite-output-contract");

    await writeJson(
      path.join(root, "sqlite-output-contract", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          maxValidationAttempts: 2,
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const options = makeRuntimeDbOptions(root, "sess-sqlite-output-contract");

    const mockScenario = {
      "rielflow-manager": {
        provider: "scenario-mock",
        when: { always: true },
        payload: { stage: "design" },
      },
      "step-1": [
        {
          provider: "scenario-mock",
          when: { always: true },
          payload: { wrong: true },
        },
        {
          provider: "scenario-mock",
          when: { always: true },
          payload: { wrong: true },
        },
      ],
    };
    const result = await runWorkflow("sqlite-output-contract", {
      ...options,
      mockScenario,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const dbPath = resolveRuntimeDbPath(options);
    const db = new Database(dbPath, { readonly: true });
    try {
      const columns = db
        .query("PRAGMA table_info(node_executions)")
        .all() as Array<{ name: string }>;
      expect(
        columns.some((column) => column.name === "output_attempt_count"),
      ).toBe(true);
      expect(
        columns.some(
          (column) => column.name === "output_validation_errors_json",
        ),
      ).toBe(true);

      const row = db
        .query(
          `SELECT output_attempt_count, output_validation_errors_json
           FROM node_executions
           WHERE session_id = ? AND node_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get("sess-sqlite-output-contract", "step-1") as {
        output_attempt_count: number | null;
        output_validation_errors_json: string | null;
      };

      expect(row.output_attempt_count).toBe(2);
      expect(row.output_validation_errors_json).not.toBeNull();
      const errors = JSON.parse(
        String(row.output_validation_errors_json),
      ) as Array<{ path: string }>;
      expect(errors[0]?.path).toBe("$.summary");
    } finally {
      db.close();
    }
  });

  test("persists backend session metadata for reusable node executions", async () => {
    const root = await makeTempDir();
    await createNodeSessionReuseFixture(root, "sqlite-node-session-reuse");

    const options = makeRuntimeDbOptions(
      root,
      "sess-sqlite-node-session-reuse",
    );

    const result = await runWorkflow(
      "sqlite-node-session-reuse",
      options,
      new ReusableSessionAdapter(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const dbPath = resolveRuntimeDbPath(options);
    const db = new Database(dbPath, { readonly: true });
    try {
      const columns = db
        .query("PRAGMA table_info(node_executions)")
        .all() as Array<{ name: string }>;
      expect(
        columns.some((column) => column.name === "backend_session_mode"),
      ).toBe(true);
      expect(
        columns.some((column) => column.name === "backend_session_id"),
      ).toBe(true);

      const rows = db
        .query(
          `SELECT backend_session_mode, backend_session_id
           FROM node_executions
           WHERE session_id = ? AND node_id = ?
           ORDER BY created_at ASC`,
        )
        .all("sess-sqlite-node-session-reuse", "step-b") as Array<{
        backend_session_mode: string | null;
        backend_session_id: string | null;
      }>;

      expect(rows).toEqual([
        { backend_session_mode: "new", backend_session_id: "backend-b-1" },
        { backend_session_mode: "reuse", backend_session_id: "backend-b-1" },
      ]);
    } finally {
      db.close();
    }
  });

  test("persists current step ids in runtime session summaries", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root, "sess-step-summary");
    const session = {
      ...createSessionState({
        sessionId: "sess-step-summary",
        workflowName: "step-summary",
        workflowId: "step-summary",
        initialNodeId: "writer-step",
        runtimeVariables: {},
      }),
      currentNodeId: "writer-step",
      nodeExecutionCounter: 1,
      nodeExecutionCounts: {
        "writer-step": 1,
      },
      nodeExecutions: [
        {
          nodeId: "writer-step",
          stepId: "writer-step",
          nodeRegistryId: "writer-node",
          nodeExecId: "exec-000001",
          mailboxInstanceId: "exec-000001",
          status: "succeeded" as const,
          artifactDir: path.join(root, "artifacts", "writer-step"),
          startedAt: "2026-04-24T00:00:00.000Z",
          endedAt: "2026-04-24T00:00:01.000Z",
          timeoutMs: 975,
        },
      ],
    };

    await saveSessionSnapshotToRuntimeDb(session, options);

    await expect(listRuntimeSessions(options)).resolves.toEqual([
      expect.objectContaining({
        sessionId: "sess-step-summary",
        currentNodeId: "writer-step",
        currentStepId: "writer-step",
      }),
    ]);
    await expect(
      loadRuntimeSessionSummary("sess-step-summary", options),
    ).resolves.toEqual(
      expect.objectContaining({
        sessionId: "sess-step-summary",
        currentNodeId: "writer-step",
        currentStepId: "writer-step",
      }),
    );
  });

  test("persists supervision_json on session snapshots", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root, "sess-supervision-db");
    const session = {
      ...createSessionState({
        sessionId: "sess-supervision-db",
        workflowName: "wf",
        workflowId: "wf",
        initialNodeId: "m",
        runtimeVariables: {},
      }),
      supervision: {
        supervisionRunId: "sr-1",
        targetWorkflowId: "wf",
        superviserWorkflowId: "sup",
        status: "running" as const,
        attemptCount: 1,
        workflowPatchCount: 0,
        incidents: [],
      },
    };

    await saveSessionSnapshotToRuntimeDb(session, options);

    const db = new Database(resolveRuntimeDbPath(options));
    try {
      const row = db
        .query("SELECT supervision_json FROM sessions WHERE session_id = ?")
        .get("sess-supervision-db") as { supervision_json: string | null };
      expect(row.supervision_json).toContain("sr-1");
      expect(row.supervision_json).toContain('"status":"running"');
    } finally {
      db.close();
    }
  });

  test("stores concise process log messages with full text in payload JSON", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root, "sess-sqlite-process-logs");
    const longText = `${"x".repeat(600)}\n`;

    await saveProcessLogsToRuntimeDb(
      {
        sessionId: "sess-sqlite-process-logs",
        nodeId: "step-1",
        nodeExecId: "exec-000001",
        processLogs: [{ stream: "stdout", text: longText }],
        at: "2026-04-20T00:00:00.000Z",
      },
      options,
    );

    const logs = await listRuntimeNodeLogs("sess-sqlite-process-logs", options);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toContain("[truncated 100 chars]");
    expect(logs[0]?.message).not.toContain("x".repeat(600));
    const payload = JSON.parse(logs[0]?.payloadJson ?? "{}") as {
      readonly text?: string;
    };
    expect(payload.text).toBe(longText);
  });

  test("process log lines use step label when executionLogTarget is step", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root, "sess-sqlite-process-logs-step");
    await saveProcessLogsToRuntimeDb(
      {
        sessionId: "sess-sqlite-process-logs-step",
        nodeId: "entry-worker",
        nodeExecId: "exec-000001",
        processLogs: [{ stream: "stdout", text: "ok\n" }],
        at: "2026-04-20T00:00:00.000Z",
        executionLogTarget: "step",
      },
      options,
    );
    const logs = await listRuntimeNodeLogs(
      "sess-sqlite-process-logs-step",
      options,
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message.startsWith("step entry-worker ")).toBe(true);
  });

  test("node execution finish log uses step label when stepId is set", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root, "sess-sqlite-finish-step");
    await saveNodeExecutionToRuntimeDb(
      {
        sessionId: "sess-sqlite-finish-step",
        nodeId: "w1",
        stepId: "w1",
        nodeExecId: "exec-000001",
        executionOrdinal: 1,
        status: "succeeded",
        artifactDir: path.join(root, "a", "b"),
        startedAt: "2026-04-20T00:00:00.000Z",
        endedAt: "2026-04-20T00:00:01.000Z",
        inputJson: "{}",
        outputJson: "{}",
        inputHash: "h1",
        outputHash: "h2",
      },
      options,
    );
    const execs = await listRuntimeNodeExecutions(
      "sess-sqlite-finish-step",
      options,
    );
    expect(execs[0]?.executionOrdinal).toBe(1);
    const logs = await listRuntimeNodeLogs("sess-sqlite-finish-step", options);
    const finish = logs.find((e) => e.message.includes("finished with status"));
    expect(finish).toBeDefined();
    expect(finish?.message).toBe("step w1 finished with status succeeded");
  });

  test("persists ordered LLM session messages with node executions", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root, "sess-sqlite-llm-messages");
    await saveNodeExecutionToRuntimeDb(
      {
        sessionId: "sess-sqlite-llm-messages",
        nodeId: "worker",
        stepId: "worker-step",
        nodeExecId: "exec-000001",
        executionOrdinal: 1,
        status: "succeeded",
        artifactDir: path.join(root, "a", "b"),
        startedAt: "2026-05-04T00:00:00.000Z",
        endedAt: "2026-05-04T00:00:01.000Z",
        backendSessionId: "backend-1",
        inputJson: "{}",
        outputJson: JSON.stringify({
          provider: "codex-agent",
          model: "gpt-5.5",
          payload: {},
        }),
        inputHash: "h1",
        outputHash: "h2",
        llmMessages: [
          {
            ordinal: 1,
            eventType: "assistant.snapshot",
            role: "assistant",
            contentText: "first",
            rawMessageJson: '{"type":"assistant.snapshot"}',
          },
          {
            ordinal: 2,
            eventType: "assistant.snapshot",
            role: "assistant",
            contentText: "second",
          },
        ],
      },
      options,
    );

    const messages = await listRuntimeLlmSessionMessages(
      "sess-sqlite-llm-messages",
      options,
    );
    expect(messages.map((message) => message.contentText)).toEqual([
      "first",
      "second",
    ]);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        nodeExecId: "exec-000001",
        nodeId: "worker",
        provider: "codex-agent",
        model: "gpt-5.5",
        backendSessionId: "backend-1",
        ordinal: 1,
        role: "assistant",
        eventType: "assistant.snapshot",
      }),
    );
  });

  test("node execution finish log uses stepId as message key when it differs from nodeId", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root, "sess-sqlite-finish-step-key");
    await saveNodeExecutionToRuntimeDb(
      {
        sessionId: "sess-sqlite-finish-step-key",
        nodeId: "materialized-exec",
        stepId: "author-step",
        nodeExecId: "exec-000001",
        executionOrdinal: 1,
        status: "succeeded",
        artifactDir: path.join(root, "a", "b"),
        startedAt: "2026-04-20T00:00:00.000Z",
        endedAt: "2026-04-20T00:00:01.000Z",
        inputJson: "{}",
        outputJson: "{}",
        inputHash: "h1",
        outputHash: "h2",
      },
      options,
    );
    const execsKey = await listRuntimeNodeExecutions(
      "sess-sqlite-finish-step-key",
      options,
    );
    expect(execsKey[0]?.executionOrdinal).toBe(1);
    const logs = await listRuntimeNodeLogs(
      "sess-sqlite-finish-step-key",
      options,
    );
    const finish = logs.find((e) => e.message.includes("finished with status"));
    expect(finish?.message).toBe(
      "step author-step finished with status succeeded",
    );
  });

  test("logs communication event status without implying failed delivery succeeded", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(root, "sess-sqlite-communication-log");
    const communication = {
      workflowId: "wf-communication-log",
      workflowExecutionId: "sess-sqlite-communication-log",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-sqlite-communication-log",
        workflowId: "wf-communication-log",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivery_failed",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      failureReason: "inbox write failed",
      artifactDir: path.join(
        root,
        "artifacts",
        "communications",
        "comm-000001",
      ),
    } satisfies CommunicationRecord;

    await saveCommunicationEventToRuntimeDb(communication, options);

    const logs = await listRuntimeNodeLogs(
      "sess-sqlite-communication-log",
      options,
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe("warning");
    expect(logs[0]?.message).toContain("status delivery_failed");
    expect(logs[0]?.message).not.toContain("delivered communication");
    const payload = JSON.parse(logs[0]?.payloadJson ?? "{}") as {
      readonly status?: string;
    };
    expect(payload.status).toBe("delivery_failed");
  });

  test("logs delivered communication events with explicit delivered status", async () => {
    const root = await makeTempDir();
    const options = makeRuntimeDbOptions(
      root,
      "sess-sqlite-delivered-communication-log",
    );
    const communication = {
      workflowId: "wf-delivered-communication-log",
      workflowExecutionId: "sess-sqlite-delivered-communication-log",
      communicationId: "comm-000001",
      fromNodeId: "manager",
      toNodeId: "worker",
      routingScope: "intra-workflow",
      sourceNodeExecId: "exec-000001",
      payloadRef: {
        kind: "node-output",
        workflowExecutionId: "sess-sqlite-delivered-communication-log",
        workflowId: "wf-delivered-communication-log",
        outputNodeId: "manager",
        nodeExecId: "exec-000001",
        artifactDir: path.join(root, "artifacts", "manager"),
      },
      deliveryKind: "edge-transition",
      transitionWhen: "always",
      status: "delivered",
      deliveryAttemptIds: ["attempt-000001"],
      activeDeliveryAttemptId: "attempt-000001",
      createdAt: "2026-04-20T00:00:00.000Z",
      deliveredAt: "2026-04-20T00:00:00.000Z",
      artifactDir: path.join(
        root,
        "artifacts",
        "communications",
        "comm-000001",
      ),
    } satisfies CommunicationRecord;

    await saveCommunicationEventToRuntimeDb(communication, options);

    const logs = await listRuntimeNodeLogs(
      "sess-sqlite-delivered-communication-log",
      options,
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe("info");
    expect(logs[0]?.message).toContain("communication comm-000001");
    expect(logs[0]?.message).toContain("status delivered");
  });

  test("migrates legacy node_executions tables before persisting output validation metadata", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "sqlite-output-contract-migration");

    await writeJson(
      path.join(root, "sqlite-output-contract-migration", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          maxValidationAttempts: 2,
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const options = makeRuntimeDbOptions(
      root,
      "sess-sqlite-output-contract-migration",
    );

    const dbPath = resolveRuntimeDbPath(options);
    await mkdir(path.dirname(dbPath), { recursive: true });
    const legacyDb = new Database(dbPath);
    try {
      legacyDb.exec(`
        CREATE TABLE sessions (
          session_id TEXT PRIMARY KEY,
          workflow_name TEXT NOT NULL,
          workflow_id TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          current_node_id TEXT,
          node_execution_counter INTEGER NOT NULL,
          queue_json TEXT NOT NULL,
          last_error TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE node_executions (
          session_id TEXT NOT NULL,
          node_exec_id TEXT NOT NULL,
          node_id TEXT NOT NULL,
          status TEXT NOT NULL,
          artifact_dir TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT NOT NULL,
          attempt INTEGER,
          restarted_from_node_exec_id TEXT,
          input_hash TEXT NOT NULL,
          output_hash TEXT NOT NULL,
          input_json TEXT NOT NULL,
          output_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (session_id, node_exec_id)
        );
        CREATE TABLE node_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          node_exec_id TEXT,
          node_id TEXT,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          payload_json TEXT,
          at TEXT NOT NULL
        );
      `);
    } finally {
      legacyDb.close();
    }

    const mockScenario = {
      "rielflow-manager": {
        provider: "scenario-mock",
        when: { always: true },
        payload: { stage: "design" },
      },
      "step-1": [
        {
          provider: "scenario-mock",
          when: { always: true },
          payload: { wrong: true },
        },
        {
          provider: "scenario-mock",
          when: { always: true },
          payload: { wrong: true },
        },
      ],
    };
    const result = await runWorkflow("sqlite-output-contract-migration", {
      ...options,
      mockScenario,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const db = new Database(dbPath, { readonly: true });
    try {
      const columns = db
        .query("PRAGMA table_info(node_executions)")
        .all() as Array<{ name: string }>;
      expect(
        columns.some((column) => column.name === "backend_session_mode"),
      ).toBe(true);
      expect(
        columns.some((column) => column.name === "backend_session_id"),
      ).toBe(true);

      const row = db
        .query(
          `SELECT output_attempt_count, output_validation_errors_json
           FROM node_executions
           WHERE session_id = ? AND node_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get("sess-sqlite-output-contract-migration", "step-1") as {
        output_attempt_count: number | null;
        output_validation_errors_json: string | null;
      };

      expect(row.output_attempt_count).toBe(2);
      expect(row.output_validation_errors_json).not.toBeNull();
      const errors = JSON.parse(
        String(row.output_validation_errors_json),
      ) as Array<{ path: string }>;
      expect(errors[0]?.path).toBe("$.summary");
    } finally {
      db.close();
    }
  });

  test("deleteRuntimeSession removes indexed rows for the workflow execution", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "sqlite-delete-session");

    const options = makeRuntimeDbOptions(root, "sess-sqlite-delete-session");
    const result = await runWorkflow("sqlite-delete-session", {
      ...options,
      mockScenario: {
        "rielflow-manager": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { stage: "design" },
        },
        "step-1": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { stage: "implement" },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    await allocateNextWorkflowMessageCommunicationId(
      {
        workflowExecutionId: "sess-sqlite-delete-session",
        sessionCommunicationCounter: result.value.session.communicationCounter,
      },
      options,
    );

    await deleteRuntimeSession("sess-sqlite-delete-session", options);

    const db = new Database(resolveRuntimeDbPath(options), { readonly: true });
    try {
      expect(
        (
          db
            .query(
              "SELECT count(*) as count FROM sessions WHERE session_id = ?",
            )
            .get("sess-sqlite-delete-session") as { count: number }
        ).count,
      ).toBe(0);
      expect(
        (
          db
            .query(
              "SELECT count(*) as count FROM node_executions WHERE session_id = ?",
            )
            .get("sess-sqlite-delete-session") as { count: number }
        ).count,
      ).toBe(0);
      expect(
        (
          db
            .query(
              "SELECT count(*) as count FROM node_logs WHERE session_id = ?",
            )
            .get("sess-sqlite-delete-session") as { count: number }
        ).count,
      ).toBe(0);
      expect(
        (
          db
            .query(
              "SELECT count(*) as count FROM workflow_messages WHERE workflow_execution_id = ?",
            )
            .get("sess-sqlite-delete-session") as { count: number }
        ).count,
      ).toBe(0);
      expect(
        (
          db
            .query(
              "SELECT count(*) as count FROM workflow_message_sequences WHERE workflow_execution_id = ?",
            )
            .get("sess-sqlite-delete-session") as { count: number }
        ).count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});
