import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowTriggerRunner } from "./trigger-runner";
import type {
  EventBinding,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";
import {
  deleteSession,
  loadSession,
  saveSession,
} from "../workflow/session-store";
import { loadEventWorkflowSessionStickiness } from "./session-stickiness";
import { atomicWriteJsonFile as writeJson } from "../shared/fs";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-trigger-runner-stickiness-test-"),
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
