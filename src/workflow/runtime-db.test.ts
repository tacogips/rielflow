import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import type { NodeAdapter } from "./adapter";
import { runWorkflow } from "./engine";
import {
  deleteRuntimeSession,
  listRuntimeLlmSessionMessages,
  listRuntimeSessions,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  loadRuntimeSessionSummary,
  resolveRuntimeDbPath,
  saveCommunicationEventToRuntimeDb,
  saveNodeExecutionToRuntimeDb,
  saveProcessLogsToRuntimeDb,
  saveSessionSnapshotToRuntimeDb,
} from "./runtime-db";
import { createSessionState, type CommunicationRecord } from "./session";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-runtime-db-test-"),
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
    managerStepId: "divedra-manager",
    entryStepId: "divedra-manager",
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
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
        id: "divedra-manager",
        nodeId: "divedra-manager",
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

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
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
  test("writes session and node execution index rows to sqlite", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "sqlite-index");

    const options = makeRuntimeDbOptions(root);

    const mockScenario = {
      "divedra-manager": {
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
      expect(sessionCount.count).toBeGreaterThanOrEqual(1);
      expect(nodeCount.count).toBeGreaterThanOrEqual(2);
      expect(logCount.count).toBeGreaterThanOrEqual(2);
    } finally {
      db.close();
    }
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
      "divedra-manager": {
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
      "divedra-manager": {
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
        "divedra-manager": {
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
    } finally {
      db.close();
    }
  });
});
