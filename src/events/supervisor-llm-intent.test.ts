import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { atomicWriteJsonFile as writeJson } from "../shared/fs";
import { resolveSupervisorIntentAsync } from "./supervisor-intent";
import type {
  EventBinding,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-supervisor-llm-intent-test-"),
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

async function writeSimpleWorkflow(input: {
  readonly root: string;
  readonly workflowName: string;
  readonly nodeId: string;
}): Promise<void> {
  const workflowDir = path.join(input.root, input.workflowName);
  await mkdir(workflowDir, { recursive: true });
  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: input.workflowName,
    description: "simple single-node workflow",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 30000 },
    entryStepId: input.nodeId,
    nodes: [{ id: input.nodeId, nodeFile: `node-${input.nodeId}.json` }],
    steps: [{ id: input.nodeId, nodeId: input.nodeId, role: "worker" }],
  });
  await writeJson(path.join(workflowDir, `node-${input.nodeId}.json`), {
    id: input.nodeId,
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "resolve intent",
    variables: {},
  });
}

function buildLlmSupervisedBinding(input: {
  readonly bindingId: string;
  readonly workflowName: string;
  readonly resolverWorkflowName: string;
  readonly resolverNodeId: string;
  readonly minConfidence?: number;
}): EventBinding {
  return {
    id: input.bindingId,
    sourceId: "chat-webhook",
    workflowName: input.workflowName,
    inputMapping: { mode: "event-input" },
    execution: {
      mode: "supervised",
      control: {
        intentMapping: {
          mode: "llm-command",
          resolverWorkflowName: input.resolverWorkflowName,
          resolverNodeId: input.resolverNodeId,
          ...(input.minConfidence !== undefined
            ? { minConfidence: input.minConfidence }
            : {}),
        },
      },
    },
  };
}

function buildEvent(text: string, eventId = "evt-1"): ExternalEventEnvelope {
  return {
    sourceId: "chat-webhook",
    eventId,
    provider: "chat-webhook",
    eventType: "chat.message",
    receivedAt: "2026-04-22T00:00:00.000Z",
    dedupeKey: `dedupe-${eventId}`,
    actor: { id: "user-1" },
    conversation: { id: "conv-1" },
    input: { text },
  };
}

function buildSource(): EventSourceConfig {
  return { id: "chat-webhook", kind: "webhook", path: "/events/chat" };
}

describe("resolveSupervisorIntentAsync with llm-command", () => {
  test("resolves to action when LLM decision meets confidence and action is allowed", async () => {
    const root = await makeTempDir();
    const resolverWorkflowName = "intent-resolver";
    const resolverNodeId = "llm-node";
    const managedWorkflowName = "managed-workflow";

    await writeSimpleWorkflow({
      root,
      workflowName: resolverWorkflowName,
      nodeId: resolverNodeId,
    });
    await writeSimpleWorkflow({
      root,
      workflowName: managedWorkflowName,
      nodeId: "worker",
    });

    const binding = buildLlmSupervisedBinding({
      bindingId: "test-binding",
      workflowName: managedWorkflowName,
      resolverWorkflowName,
      resolverNodeId,
      minConfidence: 0.7,
    });

    const result = await resolveSupervisorIntentAsync({
      binding,
      event: buildEvent("start the managed workflow"),
      source: buildSource(),
      divedraOptions: {
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
                managedWorkflowName,
                confidence: 0.9,
                reason: "user wants to start the workflow",
                runtimeVariables: {
                  llmFlag: true,
                },
              },
            },
          ],
        },
      },
    });

    expect(result.outcome).toBe("action");
    if (result.outcome !== "action") return;
    expect(result.action).toBe("start");
    expect(result.runtimeVariables).toEqual({ llmFlag: true });
    expect(result.reason).toBe("user wants to start the workflow");
  });

  test("returns skip when LLM decision confidence is below minimum", async () => {
    const root = await makeTempDir();
    const resolverWorkflowName = "intent-resolver-low-conf";
    const resolverNodeId = "llm-node";
    const managedWorkflowName = "managed-workflow";

    await writeSimpleWorkflow({
      root,
      workflowName: resolverWorkflowName,
      nodeId: resolverNodeId,
    });
    await writeSimpleWorkflow({
      root,
      workflowName: managedWorkflowName,
      nodeId: "worker",
    });

    const binding = buildLlmSupervisedBinding({
      bindingId: "test-binding-low",
      workflowName: managedWorkflowName,
      resolverWorkflowName,
      resolverNodeId,
      minConfidence: 0.8,
    });

    const result = await resolveSupervisorIntentAsync({
      binding,
      event: buildEvent("maybe stop?"),
      source: buildSource(),
      divedraOptions: {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        rootDataDir: path.join(root, "data"),
        cwd: root,
        mockScenario: {
          [resolverNodeId]: [
            {
              payload: {
                action: "stop",
                managedWorkflowName,
                confidence: 0.5,
                reason: "ambiguous request",
              },
            },
          ],
        },
      },
    });

    expect(result.outcome).toBe("skip");
    if (result.outcome !== "skip") return;
    expect(result.reason).toContain("below minimum");
  });

  test("returns skip when LLM action is 'ignore'", async () => {
    const root = await makeTempDir();
    const resolverWorkflowName = "intent-resolver-ignore";
    const resolverNodeId = "llm-node";
    const managedWorkflowName = "managed-wf";

    await writeSimpleWorkflow({
      root,
      workflowName: resolverWorkflowName,
      nodeId: resolverNodeId,
    });
    await writeSimpleWorkflow({
      root,
      workflowName: managedWorkflowName,
      nodeId: "worker",
    });

    const binding = buildLlmSupervisedBinding({
      bindingId: "test-binding-ignore",
      workflowName: managedWorkflowName,
      resolverWorkflowName,
      resolverNodeId,
    });

    const result = await resolveSupervisorIntentAsync({
      binding,
      event: buildEvent("hello world"),
      source: buildSource(),
      divedraOptions: {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        rootDataDir: path.join(root, "data"),
        cwd: root,
        mockScenario: {
          [resolverNodeId]: [
            {
              payload: {
                action: "ignore",
                managedWorkflowName,
                confidence: 0.95,
                reason: "message not relevant",
              },
            },
          ],
        },
      },
    });

    expect(result.outcome).toBe("skip");
    if (result.outcome !== "skip") return;
    expect(result.reason).toContain("ignore");
  });

  test("returns skip when managedWorkflowName does not match binding workflowName", async () => {
    const root = await makeTempDir();
    const resolverWorkflowName = "intent-resolver-mismatch";
    const resolverNodeId = "llm-node";
    const managedWorkflowName = "my-workflow";

    await writeSimpleWorkflow({
      root,
      workflowName: resolverWorkflowName,
      nodeId: resolverNodeId,
    });
    await writeSimpleWorkflow({
      root,
      workflowName: managedWorkflowName,
      nodeId: "worker",
    });

    const binding = buildLlmSupervisedBinding({
      bindingId: "test-binding-mismatch",
      workflowName: managedWorkflowName,
      resolverWorkflowName,
      resolverNodeId,
    });

    const result = await resolveSupervisorIntentAsync({
      binding,
      event: buildEvent("restart other-workflow"),
      source: buildSource(),
      divedraOptions: {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        rootDataDir: path.join(root, "data"),
        cwd: root,
        mockScenario: {
          [resolverNodeId]: [
            {
              payload: {
                action: "restart",
                managedWorkflowName: "other-workflow",
                confidence: 0.95,
                reason: "targeting different workflow",
              },
            },
          ],
        },
      },
    });

    expect(result.outcome).toBe("skip");
    if (result.outcome !== "skip") return;
    expect(result.reason).toContain("managedWorkflowName");
  });

  test("falls through to sync resolution for non-llm binding", async () => {
    const binding: EventBinding = {
      id: "sync-binding",
      sourceId: "chat-webhook",
      workflowName: "my-wf",
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        control: {
          intentMapping: { mode: "structured-only" },
        },
      },
    };

    const event: ExternalEventEnvelope = {
      sourceId: "chat-webhook",
      eventId: "evt-sync",
      provider: "chat",
      eventType: "msg",
      receivedAt: "2026-04-22T00:00:00.000Z",
      dedupeKey: "sync-dedupe",
      input: { action: "start" },
    };

    const result = await resolveSupervisorIntentAsync({
      binding,
      event,
      divedraOptions: {},
    });

    expect(result.outcome).toBe("action");
    if (result.outcome !== "action") return;
    expect(result.action).toBe("start");
  });
});
