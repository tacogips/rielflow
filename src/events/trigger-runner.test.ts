import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createWorkflowTriggerRunner,
  dispatchEventToMatchingBindings,
} from "./trigger-runner";
import * as supervisorIntent from "./supervisor-intent";
import type {
  EventBinding,
  EventConfiguration,
  ExternalEventEnvelope,
  EventSourceConfig,
} from "./types";
import {
  deleteSession,
  loadSession,
  saveSession,
} from "../workflow/session-store";
import type { WorkflowSupervisorClient } from "../workflow/supervisor-client";
import { loadEventWorkflowSessionStickiness } from "./session-stickiness";
import { atomicWriteJsonFile as writeJson } from "../shared/fs";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-trigger-runner-test-"),
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

async function writeManagerOnlyWorkflow(input: {
  readonly root: string;
  readonly workflowName: string;
  readonly sticky: boolean;
}): Promise<void> {
  const workflowDir = path.join(input.root, input.workflowName);
  await mkdir(workflowDir, { recursive: true });
  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: input.workflowName,
    description: "sticky manager workflow",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryStepId: "divedra-manager",
    managerStepId: "divedra-manager",
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
      },
    ],
    steps: [
      {
        id: "divedra-manager",
        nodeId: "divedra-manager",
        role: "manager",
      },
    ],
  });
  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    ...(input.sticky ? { sessionPolicy: { mode: "reuse" } } : {}),
    promptTemplate: "manager",
    variables: {},
  });
}

async function writeSingleNodeWorkflow(input: {
  readonly root: string;
  readonly workflowName: string;
  readonly nodeId: string;
}): Promise<void> {
  const workflowDir = path.join(input.root, input.workflowName);
  await mkdir(workflowDir, { recursive: true });
  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: input.workflowName,
    description: "single-node workflow",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryStepId: input.nodeId,
    nodes: [
      {
        id: input.nodeId,
        nodeFile: `node-${input.nodeId}.json`,
      },
    ],
    steps: [
      {
        id: input.nodeId,
        nodeId: input.nodeId,
        role: "worker",
      },
    ],
  });
  await writeJson(path.join(workflowDir, `node-${input.nodeId}.json`), {
    id: input.nodeId,
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "worker",
    variables: {},
  });
}

function buildBinding(
  workflowName: string,
  bindingId = "chat-demo",
): EventBinding {
  return {
    id: bindingId,
    sourceId: "chat-webhook",
    workflowName,
    inputMapping: { mode: "event-input" },
    execution: { async: false },
  };
}

function buildEvent(input: {
  readonly eventId: string;
  readonly dedupeKey: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly text: string;
}): ExternalEventEnvelope {
  return {
    sourceId: "chat-webhook",
    eventId: input.eventId,
    provider: "chat-webhook",
    eventType: "chat.message",
    receivedAt: "2026-04-22T00:00:00.000Z",
    dedupeKey: input.dedupeKey,
    actor: { id: "user-1", displayName: "User One" },
    conversation: {
      id: input.conversationId,
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
    },
    input: { text: input.text },
  };
}

function buildSource(): EventSourceConfig {
  return {
    id: "chat-webhook",
    kind: "webhook",
    path: "/events/chat",
  };
}

describe("workflow trigger runner manager session stickiness", () => {
  test("reuses the same workflow session for repeated chat events when the manager is sticky", async () => {
    const root = await makeTempDir();
    const workflowName = "sticky-chat-manager";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: true,
    });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": [
          {
            payload: { reply: "first" },
            backendSession: { sessionId: "backend-manager-chat-1" },
          },
          {
            payload: { reply: "second" },
            backendSession: { sessionId: "backend-manager-chat-1" },
          },
        ],
      },
    });

    const first = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-1",
        dedupeKey: "dedupe-1",
        conversationId: "conv-1",
        threadId: "thread-1",
        text: "hello",
      }),
    });
    const second = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-2",
        dedupeKey: "dedupe-2",
        conversationId: "conv-1",
        threadId: "thread-1",
        text: "follow up",
      }),
    });
    const differentConversation = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-3",
        dedupeKey: "dedupe-3",
        conversationId: "conv-2",
        threadId: "thread-1",
        text: "new thread",
      }),
    });

    expect(first.workflowExecutionId).toBeDefined();
    expect(second.workflowExecutionId).toBe(first.workflowExecutionId);
    expect(differentConversation.workflowExecutionId).not.toBe(
      first.workflowExecutionId,
    );

    const saved = await loadSession(first.workflowExecutionId ?? "", {
      sessionStoreRoot: path.join(root, "sessions"),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }
    expect(saved.value.nodeExecutions).toHaveLength(2);
    expect(saved.value.nodeExecutions[0]).toMatchObject({
      nodeId: "divedra-manager",
      backendSessionMode: "new",
      backendSessionId: "backend-manager-chat-1",
    });
    expect(saved.value.nodeExecutions[1]).toMatchObject({
      nodeId: "divedra-manager",
      backendSessionMode: "reuse",
      backendSessionId: "backend-manager-chat-1",
    });
    expect(saved.value.nodeBackendSessions?.["divedra-manager"]).toMatchObject({
      nodeId: "divedra-manager",
      sessionId: "backend-manager-chat-1",
    });
    expect(saved.value.runtimeVariables["humanInput"]).toEqual({
      text: "follow up",
    });
  });

  test("starts a fresh workflow session when manager stickiness is disabled", async () => {
    const root = await makeTempDir();
    const workflowName = "nonsticky-chat-manager";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "fresh" },
        },
      },
    });

    const first = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-a",
        dedupeKey: "dedupe-a",
        conversationId: "conv-1",
        text: "hello",
      }),
    });
    const second = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-b",
        dedupeKey: "dedupe-b",
        conversationId: "conv-1",
        text: "follow up",
      }),
    });

    expect(first.workflowExecutionId).toBeDefined();
    expect(second.workflowExecutionId).toBeDefined();
    expect(second.workflowExecutionId).not.toBe(first.workflowExecutionId);
  });

  test("does not reuse a sticky workflow session across different bindings", async () => {
    const root = await makeTempDir();
    const workflowName = "binding-scoped-sticky-manager";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: true,
    });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "sticky" },
        },
      },
    });

    const first = await runner.dispatch({
      binding: buildBinding(workflowName, "binding-a"),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-binding-a1",
        dedupeKey: "dedupe-binding-a1",
        conversationId: "conv-shared",
        threadId: "thread-shared",
        text: "hello from a",
      }),
    });
    const second = await runner.dispatch({
      binding: buildBinding(workflowName, "binding-b"),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-binding-b1",
        dedupeKey: "dedupe-binding-b1",
        conversationId: "conv-shared",
        threadId: "thread-shared",
        text: "hello from b",
      }),
    });
    const third = await runner.dispatch({
      binding: buildBinding(workflowName, "binding-a"),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-binding-a2",
        dedupeKey: "dedupe-binding-a2",
        conversationId: "conv-shared",
        threadId: "thread-shared",
        text: "follow up from a",
      }),
    });

    expect(first.workflowExecutionId).toBeDefined();
    expect(second.workflowExecutionId).toBeDefined();
    expect(second.workflowExecutionId).not.toBe(first.workflowExecutionId);
    expect(third.workflowExecutionId).toBe(first.workflowExecutionId);
  });

  test("reopens the prior workflow when a sticky manager session was previously completed", async () => {
    const root = await makeTempDir();
    const sessionRoot = path.join(root, "sessions");
    const workflowName = "sticky-then-completed";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: true,
    });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: sessionRoot,
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "only-once" },
        },
      },
    });

    const first = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-c1",
        dedupeKey: "dedupe-c1",
        conversationId: "conv-finished",
        text: "hello",
      }),
    });
    const sessionId = first.workflowExecutionId;
    expect(sessionId).toBeDefined();
    if (sessionId === undefined) {
      return;
    }
    const stored = await loadSession(sessionId, {
      sessionStoreRoot: sessionRoot,
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      return;
    }
    const written = await saveSession(
      { ...stored.value, status: "completed" },
      { sessionStoreRoot: sessionRoot },
    );
    expect(written.ok).toBe(true);

    const afterComplete = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-c2",
        dedupeKey: "dedupe-c2",
        conversationId: "conv-finished",
        text: "next message",
      }),
    });
    expect(afterComplete.workflowExecutionId).toBeDefined();
    expect(afterComplete.workflowExecutionId).toBe(sessionId);
  });

  test("starts a new workflow when the prior sticky session failed", async () => {
    const root = await makeTempDir();
    const sessionRoot = path.join(root, "sessions");
    const workflowName = "sticky-then-failed";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: true,
    });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: sessionRoot,
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "only-once" },
        },
      },
    });

    const first = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-f1",
        dedupeKey: "dedupe-f1",
        conversationId: "conv-failed",
        text: "hello",
      }),
    });
    const sessionId = first.workflowExecutionId;
    expect(sessionId).toBeDefined();
    if (sessionId === undefined) {
      return;
    }
    const stored = await loadSession(sessionId, {
      sessionStoreRoot: sessionRoot,
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      return;
    }
    const written = await saveSession(
      { ...stored.value, status: "failed" },
      { sessionStoreRoot: sessionRoot },
    );
    expect(written.ok).toBe(true);

    const afterFailure = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-f2",
        dedupeKey: "dedupe-f2",
        conversationId: "conv-failed",
        text: "next message",
      }),
    });
    expect(afterFailure.workflowExecutionId).toBeDefined();
    expect(afterFailure.workflowExecutionId).not.toBe(sessionId);
  });

  test("skips dispatch when the sticky session has pending user actions", async () => {
    const root = await makeTempDir();
    const sessionRoot = path.join(root, "sessions");
    const workflowName = "sticky-pending-user-action";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: true,
    });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: sessionRoot,
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "only-once" },
        },
      },
    });

    const first = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-u1",
        dedupeKey: "dedupe-u1",
        conversationId: "conv-user-action",
        text: "hello",
      }),
    });
    const sessionId = first.workflowExecutionId;
    expect(sessionId).toBeDefined();
    if (sessionId === undefined) {
      return;
    }
    const stored = await loadSession(sessionId, {
      sessionStoreRoot: sessionRoot,
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      return;
    }
    const written = await saveSession(
      {
        ...stored.value,
        status: "paused",
        activeUserActions: [
          {
            nodeId: "divedra-manager",
            nodeExecId: "exec-pending",
            userActionId: "ua-1",
            artifactDir: path.join(root, "artifacts", "ua-1"),
            status: "waiting-for-reply",
            pausedAt: "2026-04-22T12:00:00.000Z",
          },
        ],
      },
      { sessionStoreRoot: sessionRoot },
    );
    expect(written.ok).toBe(true);

    const blocked = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-u2",
        dedupeKey: "dedupe-u2",
        conversationId: "conv-user-action",
        text: "next while waiting",
      }),
    });
    expect(blocked.workflowExecutionId).toBeUndefined();
    expect(blocked.receipt.status).toBe("skipped");
    expect(blocked.receipt.error).toContain("pending user actions");

    const sticky = await loadEventWorkflowSessionStickiness(
      {
        workflowId: workflowName,
        sourceId: "chat-webhook",
        bindingId: "chat-demo",
        conversationId: "conv-user-action",
      },
      { rootDataDir: path.join(root, "data") },
    );
    expect(sticky?.sessionId).toBe(sessionId);
  });

  test("starts a new workflow when the prior sticky session was cancelled", async () => {
    const root = await makeTempDir();
    const sessionRoot = path.join(root, "sessions");
    const workflowName = "sticky-then-cancelled";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: true,
    });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: sessionRoot,
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "only-once" },
        },
      },
    });

    const first = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-x1",
        dedupeKey: "dedupe-x1",
        conversationId: "conv-cancelled",
        text: "hello",
      }),
    });
    const sessionId = first.workflowExecutionId;
    expect(sessionId).toBeDefined();
    if (sessionId === undefined) {
      return;
    }
    const stored = await loadSession(sessionId, {
      sessionStoreRoot: sessionRoot,
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) {
      return;
    }
    const written = await saveSession(
      { ...stored.value, status: "cancelled" },
      { sessionStoreRoot: sessionRoot },
    );
    expect(written.ok).toBe(true);

    const afterCancel = await runner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-x2",
        dedupeKey: "dedupe-x2",
        conversationId: "conv-cancelled",
        text: "next message",
      }),
    });
    expect(afterCancel.workflowExecutionId).toBeDefined();
    expect(afterCancel.workflowExecutionId).not.toBe(sessionId);
  });

  test("clears a stale sticky record before a failed replacement dispatch when the stored session is missing", async () => {
    const root = await makeTempDir();
    const sessionRoot = path.join(root, "sessions");
    const dataRoot = path.join(root, "data");
    const workflowName = "sticky-stale-record";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: true,
    });

    const initialRunner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: sessionRoot,
      rootDataDir: dataRoot,
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "first" },
        },
      },
    });

    const first = await initialRunner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-stale-1",
        dedupeKey: "dedupe-stale-1",
        conversationId: "conv-stale",
        threadId: "thread-stale",
        text: "hello",
      }),
    });
    const sessionId = first.workflowExecutionId;
    expect(sessionId).toBeDefined();
    if (sessionId === undefined) {
      return;
    }

    const stickyBefore = await loadEventWorkflowSessionStickiness(
      {
        workflowId: workflowName,
        sourceId: "chat-webhook",
        bindingId: "chat-demo",
        conversationId: "conv-stale",
        threadId: "thread-stale",
      },
      { rootDataDir: dataRoot },
    );
    expect(stickyBefore?.sessionId).toBe(sessionId);

    const deleted = await deleteSession(sessionId, {
      sessionStoreRoot: sessionRoot,
    });
    expect(deleted.ok).toBe(true);

    const failingRunner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: sessionRoot,
      rootDataDir: dataRoot,
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          fail: true,
        },
      },
    });

    const failed = await failingRunner.dispatch({
      binding: buildBinding(workflowName),
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-stale-2",
        dedupeKey: "dedupe-stale-2",
        conversationId: "conv-stale",
        threadId: "thread-stale",
        text: "retry",
      }),
    });
    expect(failed.workflowExecutionId).toBeUndefined();

    const stickyAfter = await loadEventWorkflowSessionStickiness(
      {
        workflowId: workflowName,
        sourceId: "chat-webhook",
        bindingId: "chat-demo",
        conversationId: "conv-stale",
        threadId: "thread-stale",
      },
      { rootDataDir: dataRoot },
    );
    expect(stickyAfter).toBeNull();
  });
});

describe("workflow trigger runner supervised bindings", () => {
  test("preserves llm-command runtimeVariables when dispatching a supervised start", async () => {
    const root = await makeTempDir();
    const workflowName = "supervised-target-llm";
    const resolverWorkflowName = "supervisor-intent-resolver";
    const resolverNodeId = "llm-node";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: resolverWorkflowName,
      nodeId: resolverNodeId,
    });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        [resolverNodeId]: [
          {
            payload: {
              action: "start",
              managedWorkflowName: workflowName,
              confidence: 0.99,
              reason: "resolved start",
              runtimeVariables: {
                llmFlag: true,
              },
            },
          },
        ],
        "divedra-manager": [
          {
            payload: { reply: "supervised-ok" },
            backendSession: { sessionId: "backend-supervised-llm-1" },
          },
        ],
      },
    });

    const binding: EventBinding = {
      id: "supervised-binding-llm",
      sourceId: "chat-webhook",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        async: false,
        allowUnsafeSyncWebhook: true,
        control: {
          intentMapping: {
            mode: "llm-command",
            resolverWorkflowName,
            resolverNodeId,
          },
        },
      },
    };

    const result = await runner.dispatch({
      binding,
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-sup-llm-1",
        dedupeKey: "dedupe-sup-llm-1",
        conversationId: "conv-sup-llm-1",
        threadId: "thread-sup-llm-1",
        text: "start the workflow",
      }),
    });

    expect(result.workflowExecutionId).toBeDefined();
    const loaded = await loadSession(result.workflowExecutionId ?? "", {
      sessionStoreRoot: path.join(root, "sessions"),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.runtimeVariables["llmFlag"]).toBe(true);
  });

  test("dispatches supervised start through supervisor client", async () => {
    const root = await makeTempDir();
    const workflowName = "supervised-target-wf";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": [
          {
            payload: { reply: "supervised-ok" },
            backendSession: { sessionId: "backend-supervised-1" },
          },
        ],
      },
    });

    const binding: EventBinding = {
      id: "supervised-binding",
      sourceId: "chat-webhook",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        async: false,
        allowUnsafeSyncWebhook: true,
        control: {
          intentMapping: { mode: "structured-only" },
        },
      },
    };

    const base = buildEvent({
      eventId: "evt-sup-1",
      dedupeKey: "dedupe-sup-1",
      conversationId: "conv-sup-1",
      threadId: "thread-sup-1",
      text: "hello",
    });
    const event: ExternalEventEnvelope = {
      ...base,
      input: { ...base.input, action: "start" },
    };

    const result = await runner.dispatch({
      binding,
      source: buildSource(),
      event,
    });

    expect(result.receipt.status).toBe("dispatched");
    expect(result.supervisedRunId).toMatch(/^esv-/);
    expect(result.workflowExecutionId).toBeDefined();
  });

  test("uses GraphQL supervisor client when endpoint is set", async () => {
    const root = await makeTempDir();
    const workflowName = "supervised-gql-target";
    await writeManagerOnlyWorkflow({ root, workflowName, sticky: false });

    const now = new Date().toISOString();
    const supervisedRun = {
      supervisedRunId: "esv-remote-1",
      sourceId: "chat-webhook",
      bindingId: "supervised-binding-gql",
      correlationKey: "chat-webhook:supervised-binding-gql:conv-gql-1:thread-gql-1",
      supervisorWorkflowName: "divedra-default-workflow-supervisor",
      targetWorkflowName: workflowName,
      activeTargetExecutionId: "sess-remote-1",
      status: "running" as const,
      restartCount: 0,
      maxRestartsOnFailure: 3,
      autoImproveEnabled: false,
      createdAt: now,
      updatedAt: now,
    };

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            dispatchSupervisedWorkflowCommand: {
              supervisedRun,
              activeTargetStatus: "running",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      endpoint: "http://example.test/graphql",
      fetchImpl,
    });

    const binding: EventBinding = {
      id: "supervised-binding-gql",
      sourceId: "chat-webhook",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        async: false,
        allowUnsafeSyncWebhook: true,
        control: {
          intentMapping: { mode: "structured-only" },
        },
      },
    };

    const base = buildEvent({
      eventId: "evt-sup-gql-1",
      dedupeKey: "dedupe-sup-gql-1",
      conversationId: "conv-gql-1",
      threadId: "thread-gql-1",
      text: "hello",
    });
    const event: ExternalEventEnvelope = {
      ...base,
      input: { ...base.input, action: "start" },
    };

    const result = await runner.dispatch({
      binding,
      source: buildSource(),
      event,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.receipt.status).toBe("dispatched");
    expect(result.supervisedRunId).toBe("esv-remote-1");
    expect(result.workflowExecutionId).toBe("sess-remote-1");
  });

  test("dispatches chat reply after supervised status when reply dispatcher is configured", async () => {
    const root = await makeTempDir();
    const workflowName = "supervised-reply-status-wf";
    await writeManagerOnlyWorkflow({ root, workflowName, sticky: false });

    const dispatched: unknown[] = [];
    const eventReplyDispatcher = {
      async dispatchChatReply(request: unknown) {
        dispatched.push(request);
        return { status: "sent" as const, provider: "test" };
      },
    };

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      eventReplyDispatcher,
      mockScenario: {
        "divedra-manager": [
          {
            payload: { reply: "ok" },
            backendSession: { sessionId: "backend-reply-status-1" },
          },
          {
            payload: { reply: "ok2" },
            backendSession: { sessionId: "backend-reply-status-2" },
          },
        ],
      },
    });

    const binding: EventBinding = {
      id: "supervised-binding-reply",
      sourceId: "chat-webhook",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        async: false,
        allowUnsafeSyncWebhook: true,
        control: {
          intentMapping: {
            mode: "command-map",
            commands: { start: "start", status: "status" },
            defaultAction: "input",
          },
        },
      },
    };

    const conv = "conv-reply-status";
    const thread = "thread-reply-status";
    const startEvent: ExternalEventEnvelope = {
      ...buildEvent({
        eventId: "evt-reply-1",
        dedupeKey: "dedupe-reply-1",
        conversationId: conv,
        threadId: thread,
        text: "start",
      }),
      input: { text: "start" },
    };
    await runner.dispatch({
      binding,
      source: buildSource(),
      event: startEvent,
    });

    const statusEvent: ExternalEventEnvelope = {
      ...buildEvent({
        eventId: "evt-reply-2",
        dedupeKey: "dedupe-reply-2",
        conversationId: conv,
        threadId: thread,
        text: "status",
      }),
      input: { text: "status" },
    };
    const statusResult = await runner.dispatch({
      binding,
      source: buildSource(),
      event: statusEvent,
    });

    expect(dispatched.length).toBeGreaterThanOrEqual(1);
    const last = dispatched[dispatched.length - 1] as {
      readonly message: { readonly text: string };
    };
    expect(last.message.text).toMatch(/Supervised workflow control \(status\)/);
    const inputRef = statusResult.receipt.inputRef;
    expect(inputRef).toBeDefined();
    if (inputRef === undefined) {
      return;
    }
    const rootDataDir = path.join(root, "data");
    const storedInput = JSON.parse(
      await readFile(path.join(rootDataDir, inputRef.path), "utf8"),
    ) as { readonly workflowInput?: unknown };
    expect(storedInput.workflowInput).toEqual({});
  });

  test("supervised dispatch stays dispatched when chat reply dispatcher throws", async () => {
    const root = await makeTempDir();
    const workflowName = "supervised-reply-throw-wf";
    await writeManagerOnlyWorkflow({ root, workflowName, sticky: false });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      eventReplyDispatcher: {
        async dispatchChatReply() {
          throw new Error("provider unavailable");
        },
      },
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "ok" },
          backendSession: { sessionId: "backend-reply-throw-1" },
        },
      },
    });

    const binding: EventBinding = {
      id: "supervised-binding-reply-throw",
      sourceId: "chat-webhook",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        async: false,
        allowUnsafeSyncWebhook: true,
        control: {
          intentMapping: {
            mode: "command-map",
            commands: { start: "start" },
            defaultAction: "input",
          },
        },
      },
    };

    const result = await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-reply-throw-1",
          dedupeKey: "dedupe-reply-throw-1",
          conversationId: "conv-reply-throw",
          threadId: "thread-reply-throw",
          text: "start",
        }),
        input: { text: "start" },
      },
    });

    expect(result.receipt.status).toBe("dispatched");
    expect(result.supervisedRunId).toMatch(/^esv-/);
  });

  test("dispatches generic chat reply when supervised command fails and reply dispatcher is configured", async () => {
    const root = await makeTempDir();
    const workflowName = "supervised-reply-fail-wf";
    await writeManagerOnlyWorkflow({ root, workflowName, sticky: false });

    const dispatched: unknown[] = [];
    const supervisorClient = {
      async dispatchCommand() {
        throw new Error("simulated supervisor transport failure");
      },
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      status: vi.fn(),
      submitInput: vi.fn(),
    } as unknown as WorkflowSupervisorClient;

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      supervisorClient,
      eventReplyDispatcher: {
        async dispatchChatReply(request: unknown) {
          dispatched.push(request);
          return { status: "sent" as const, provider: "test" };
        },
      },
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "ok" },
          backendSession: { sessionId: "backend-reply-fail-1" },
        },
      },
    });

    const binding: EventBinding = {
      id: "supervised-binding-reply-fail",
      sourceId: "chat-webhook",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        async: false,
        allowUnsafeSyncWebhook: true,
        control: {
          intentMapping: {
            mode: "command-map",
            commands: { start: "start" },
            defaultAction: "input",
          },
        },
      },
    };

    const result = await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-reply-fail-1",
          dedupeKey: "dedupe-reply-fail-1",
          conversationId: "conv-reply-fail",
          threadId: "thread-reply-fail",
          text: "start",
        }),
        input: { text: "start" },
      },
    });

    expect(result.receipt.status).toBe("failed");
    expect(dispatched).toHaveLength(1);
    const req = dispatched[0] as { readonly message: { readonly text: string } };
    expect(req.message.text).toContain("Control command could not be completed");
    expect(req.message.text).not.toContain("simulated supervisor");
  });

  test("dispatchEventToMatchingBindings sends one chat clarification for destructive llm ambiguity", async () => {
    const root = await makeTempDir();
    const wfAlpha = "wf-alpha-amb";
    const wfBeta = "wf-beta-amb";
    const resolverWorkflowName = "resolver-amb";
    const resolverNodeId = "llm-amb-node";
    await writeManagerOnlyWorkflow({
      root,
      workflowName: wfAlpha,
      sticky: false,
    });
    await writeManagerOnlyWorkflow({
      root,
      workflowName: wfBeta,
      sticky: false,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: resolverWorkflowName,
      nodeId: resolverNodeId,
    });

    const chatReplies: unknown[] = [];
    const sharedOptions = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      eventReplyDispatcher: {
        async dispatchChatReply(request: unknown) {
          chatReplies.push(request);
          return { status: "sent" as const, provider: "test" };
        },
      },
    };

    const runner = createWorkflowTriggerRunner(sharedOptions);

    const supervisedLlm = (id: string, workflowName: string): EventBinding => ({
      id,
      sourceId: "chat-webhook",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        async: false,
        allowUnsafeSyncWebhook: true,
        control: {
          intentMapping: {
            mode: "llm-command",
            resolverWorkflowName,
            resolverNodeId,
          },
        },
      },
    });

    const configuration: EventConfiguration = {
      eventRoot: root,
      sources: [{ ...buildSource(), enabled: true }],
      bindings: [supervisedLlm("b-amb-1", wfAlpha), supervisedLlm("b-amb-2", wfBeta)],
    };

    const intentSpy = vi
      .spyOn(supervisorIntent, "resolveSupervisorIntentAsync")
      .mockResolvedValue({
        outcome: "action",
        action: "stop",
      });

    const event: ExternalEventEnvelope = {
      ...buildEvent({
        eventId: "evt-amb-1",
        dedupeKey: "dedupe-amb-1",
        conversationId: "conv-amb",
        threadId: "thread-amb",
        text: "stop",
      }),
      input: { text: "stop" },
    };

    const results = await dispatchEventToMatchingBindings(
      {
        configuration,
        event,
        runner,
      },
      sharedOptions,
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.receipt.status === "skipped")).toBe(true);
    expect(chatReplies).toHaveLength(1);
    const req = chatReplies[0] as {
      readonly message: { readonly text: string };
      readonly idempotencyKey: string;
    };
    expect(req.message.text).toContain("ambiguous");
    expect(req.idempotencyKey).toContain("router:");
    intentSpy.mockRestore();
  });
});
