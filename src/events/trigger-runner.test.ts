import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowTriggerRunner } from "./trigger-runner";
import type {
  EventBinding,
  ExternalEventEnvelope,
  EventSourceConfig,
} from "./types";
import { loadSession } from "../workflow/session-store";
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
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
    ],
    edges: [],
    loops: [],
    branching: { mode: "fan-out" },
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

function buildBinding(workflowName: string): EventBinding {
  return {
    id: "chat-demo",
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
  test("reuses the same workflow session for repeated chat events when the root manager is sticky", async () => {
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

  test("starts a fresh workflow session when root-manager stickiness is disabled", async () => {
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
});
