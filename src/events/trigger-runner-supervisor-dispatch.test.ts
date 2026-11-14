import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createWorkflowTriggerRunner } from "./trigger-runner";
import * as dispatchResolver from "./supervisor-llm-resolver";
import type {
  EventBinding,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";
import { createRuntimeSupervisorConversationRepository } from "./supervisor-conversations";
import { atomicWriteJsonFile as writeJson } from "../shared/fs";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-trigger-runner-supervisor-dispatch-test-"),
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

interface SupervisorDispatchProfileTestManagedWorkflow {
  readonly key: string;
  readonly workflowName: string;
  readonly concurrencyMode: "single-active" | "multiple-active";
  readonly lifecycle?: {
    readonly stopOnSwitch?: boolean;
    readonly startOnSwitch?: boolean;
  };
}

async function writeSupervisorDispatchProfile(input: {
  readonly eventRoot: string;
  readonly fileBaseName: string;
  readonly supervisorWorkflowName: string;
  readonly managedWorkflowName?: string;
  readonly managedKey?: string;
  readonly concurrencyMode?: "single-active" | "multiple-active";
  readonly managedWorkflows?: readonly SupervisorDispatchProfileTestManagedWorkflow[];
  readonly directAnswerPolicy?: {
    readonly enabled: boolean;
    readonly allowedDecisionKinds?: readonly string[];
  };
}): Promise<void> {
  const managedWorkflows: readonly SupervisorDispatchProfileTestManagedWorkflow[] =
    input.managedWorkflows ??
    (() => {
      if (
        input.managedKey === undefined ||
        input.managedWorkflowName === undefined ||
        input.concurrencyMode === undefined
      ) {
        throw new Error(
          "writeSupervisorDispatchProfile requires either managedWorkflows or the legacy managed workflow fields",
        );
      }
      return [
        {
          key: input.managedKey,
          workflowName: input.managedWorkflowName,
          concurrencyMode: input.concurrencyMode,
        },
      ];
    })();
  const supervisorsDir = path.join(input.eventRoot, "supervisors");
  await mkdir(supervisorsDir, { recursive: true });
  await writeJson(path.join(supervisorsDir, `${input.fileBaseName}.json`), {
    supervisorProfileId: input.fileBaseName,
    profileRevision: "1",
    supervisorWorkflowName: input.supervisorWorkflowName,
    managedWorkflows: managedWorkflows.map((managedWorkflow) => ({
      key: managedWorkflow.key,
      workflowName: managedWorkflow.workflowName,
      concurrency:
        managedWorkflow.concurrencyMode === "multiple-active"
          ? {
              mode: "multiple-active",
              requiresAliasForParallelRuns: true,
            }
          : { mode: "single-active" },
      ...(managedWorkflow.lifecycle === undefined
        ? {}
        : { lifecycle: managedWorkflow.lifecycle }),
    })),
    ...(input.directAnswerPolicy === undefined
      ? {}
      : { directAnswerPolicy: input.directAnswerPolicy }),
  });
}

function buildSupervisorDispatchBinding(input: {
  readonly profileId: string;
  readonly resolverWorkflowName: string;
  readonly resolverNodeId: string;
  readonly dedupeWindowMs: number;
}): EventBinding {
  return {
    id: "dispatch-binding",
    sourceId: "chat-webhook",
    inputMapping: { mode: "event-input" },
    execution: {
      mode: "supervisor-dispatch",
      supervisorProfileId: input.profileId,
      async: false,
      allowUnsafeSyncWebhook: true,
      dedupeWindowMs: input.dedupeWindowMs,
      control: {
        intentMapping: {
          mode: "llm-command",
          resolverWorkflowName: input.resolverWorkflowName,
          resolverNodeId: input.resolverNodeId,
        },
      },
    },
  };
}

describe("workflow trigger runner supervisor-dispatch bindings", () => {
  test("replays stored dispatch decision without calling the LLM resolver twice when receipt dedupe expires before supervisor sourceMessageId", async () => {
    const root = await makeTempDir();
    const eventRoot = path.join(root, "events-config");
    const profileId = "dispatch-replay-profile";
    const supWf = "dispatch-replay-sup";
    const resolverWf = "dispatch-replay-resolver";
    const resolverNodeId = "dispatch-replay-res-node";
    const workerWf = "dispatch-replay-worker";
    const workerNodeId = "dispatch-replay-worker-node";

    await writeSupervisorDispatchProfile({
      eventRoot,
      fileBaseName: profileId,
      supervisorWorkflowName: supWf,
      managedWorkflowName: workerWf,
      managedKey: "worker",
      concurrencyMode: "single-active",
      directAnswerPolicy: {
        enabled: true,
        allowedDecisionKinds: ["answer-directly"],
      },
    });
    await writeManagerOnlyWorkflow({
      root,
      workflowName: supWf,
      sticky: false,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: resolverWf,
      nodeId: resolverNodeId,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: workerWf,
      nodeId: workerNodeId,
    });

    const resolverSpy = vi.spyOn(
      dispatchResolver,
      "runSupervisorDispatchLlmResolver",
    );

    const sharedDedupeKey = "stable-logical-chat-msg-1";
    const binding = buildSupervisorDispatchBinding({
      profileId,
      resolverWorkflowName: resolverWf,
      resolverNodeId,
      dedupeWindowMs: 60_000,
    });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      eventRoot,
      mockScenario: {
        [resolverNodeId]: [
          {
            payload: {
              action: "answer-directly",
              reason: "replay fixture",
              confidence: 1,
              reply: { text: "direct body" },
            },
          },
        ],
      },
    });

    const conv = "conv-dispatch-replay";
    const thread = "thread-dispatch-replay";

    const first = await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-replay-1",
          dedupeKey: sharedDedupeKey,
          conversationId: conv,
          threadId: thread,
          text: "hello",
        }),
        receivedAt: "2026-05-01T12:00:00.000Z",
      },
    });
    expect(first.receipt.status).toBe("dispatched");
    expect(first.supervisorConversationId).toBeDefined();
    expect(first.supervisorDecisionId).toBeDefined();
    expect(resolverSpy).toHaveBeenCalledTimes(1);

    const second = await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-replay-2",
          dedupeKey: sharedDedupeKey,
          conversationId: conv,
          threadId: thread,
          text: "hello",
        }),
        receivedAt: "2026-05-01T12:05:00.000Z",
      },
    });

    expect(second.receipt.status).toBe("dispatched");
    expect(second.duplicate).toBe(false);
    expect(second.supervisorConversationId).toBe(
      first.supervisorConversationId,
    );
    expect(second.supervisorDecisionId).toBe(first.supervisorDecisionId);
    expect(resolverSpy).toHaveBeenCalledTimes(1);

    resolverSpy.mockRestore();
  });

  test("includes supervisor dispatch proposal reply text in chat replies when configured", async () => {
    const root = await makeTempDir();
    const eventRoot = path.join(root, "events-config");
    const profileId = "dispatch-reply-profile";
    const supWf = "dispatch-reply-sup";
    const resolverWf = "dispatch-reply-resolver";
    const resolverNodeId = "dispatch-reply-res-node";
    const workerWf = "dispatch-reply-worker";

    await writeSupervisorDispatchProfile({
      eventRoot,
      fileBaseName: profileId,
      supervisorWorkflowName: supWf,
      managedWorkflowName: workerWf,
      managedKey: "worker",
      concurrencyMode: "single-active",
      directAnswerPolicy: {
        enabled: true,
        allowedDecisionKinds: ["answer-directly"],
      },
    });
    await writeManagerOnlyWorkflow({
      root,
      workflowName: supWf,
      sticky: false,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: resolverWf,
      nodeId: resolverNodeId,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: workerWf,
      nodeId: "dispatch-reply-worker-node",
    });

    const chatReplies: unknown[] = [];
    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      eventRoot,
      eventReplyDispatcher: {
        async dispatchChatReply(request: unknown) {
          chatReplies.push(request);
          return { status: "sent" as const, provider: "test" };
        },
      },
      mockScenario: {
        [resolverNodeId]: {
          payload: {
            action: "answer-directly",
            reason: "user visible",
            confidence: 1,
            reply: { text: "Hello from supervisor proposal.reply" },
          },
        },
      },
    });

    const binding = buildSupervisorDispatchBinding({
      profileId,
      resolverWorkflowName: resolverWf,
      resolverNodeId,
      dedupeWindowMs: 60_000,
    });

    await runner.dispatch({
      binding,
      source: buildSource(),
      event: buildEvent({
        eventId: "evt-dispatch-reply-1",
        dedupeKey: "dedupe-dispatch-reply-1",
        conversationId: "conv-dispatch-reply",
        threadId: "thread-dispatch-reply",
        text: "ping",
      }),
    });

    expect(chatReplies.length).toBeGreaterThanOrEqual(1);
    const last = chatReplies[chatReplies.length - 1] as {
      readonly message: { readonly text: string };
    };
    expect(last.message.text).toContain("Hello from supervisor proposal.reply");
    expect(last.message.text).toContain(
      "Supervisor dispatch (answer-directly)",
    );
  });

  test("returns a non-applied dispatch view when submit-input is ambiguous across parallel managed runs", async () => {
    const root = await makeTempDir();
    const eventRoot = path.join(root, "events-config");
    const profileId = "dispatch-amb-profile";
    const supWf = "dispatch-amb-sup";
    const resolverWf = "dispatch-amb-resolver";
    const resolverNodeId = "dispatch-amb-res-node";
    const workerWf = "dispatch-amb-worker";
    const workerNodeId = "dispatch-amb-worker-node";

    await writeSupervisorDispatchProfile({
      eventRoot,
      fileBaseName: profileId,
      supervisorWorkflowName: supWf,
      managedWorkflowName: workerWf,
      managedKey: "worker",
      concurrencyMode: "multiple-active",
    });
    await writeManagerOnlyWorkflow({
      root,
      workflowName: supWf,
      sticky: false,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: resolverWf,
      nodeId: resolverNodeId,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: workerWf,
      nodeId: workerNodeId,
    });

    const binding = buildSupervisorDispatchBinding({
      profileId,
      resolverWorkflowName: resolverWf,
      resolverNodeId,
      dedupeWindowMs: 120_000,
    });

    const resolverSpy = vi
      .spyOn(dispatchResolver, "runSupervisorDispatchLlmResolver")
      .mockResolvedValueOnce({
        ok: true,
        proposal: {
          action: "start-workflow",
          reason: "first",
          confidence: 1,
          targets: [
            {
              managedWorkflowKey: "worker",
              runAlias: "run-a",
              input: {},
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        proposal: {
          action: "start-workflow",
          reason: "second",
          confidence: 1,
          targets: [
            {
              managedWorkflowKey: "worker",
              runAlias: "run-b",
              input: {},
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        proposal: {
          action: "submit-input",
          reason: "ambiguous key only",
          confidence: 1,
          targets: [
            {
              managedWorkflowKey: "worker",
              input: { text: "go" },
            },
          ],
        },
      });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      eventRoot,
      mockScenario: {
        [workerNodeId]: [
          { payload: { reply: "w1" } },
          { payload: { reply: "w2" } },
        ],
      },
    });

    const conv = "conv-dispatch-amb";
    const thread = "thread-dispatch-amb";

    const start1 = await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-amb-s1",
          dedupeKey: "dedupe-amb-s1",
          conversationId: conv,
          threadId: thread,
          text: "start a",
        }),
        receivedAt: "2026-05-01T14:00:00.000Z",
      },
    });
    expect(start1.receipt.status).toBe("dispatched");

    const start2 = await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-amb-s2",
          dedupeKey: "dedupe-amb-s2",
          conversationId: conv,
          threadId: thread,
          text: "start b",
        }),
        receivedAt: "2026-05-01T14:02:00.000Z",
      },
    });
    expect(start2.receipt.status).toBe("dispatched");

    const ambiguous = await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-amb-input",
          dedupeKey: "dedupe-amb-input",
          conversationId: conv,
          threadId: thread,
          text: "input",
        }),
        receivedAt: "2026-05-01T14:04:00.000Z",
      },
    });

    expect(ambiguous.receipt.status).toBe("dispatched");
    const dispatchRef = ambiguous.receipt.dispatchRef;
    expect(dispatchRef).toBeDefined();
    if (dispatchRef === undefined) {
      resolverSpy.mockRestore();
      return;
    }
    const payload = JSON.parse(
      await readFile(path.join(root, "data", dispatchRef.path), "utf8"),
    ) as {
      readonly applied: boolean;
      readonly validationIssues?: readonly { readonly code: string }[];
    };
    expect(payload.applied).toBe(false);
    expect(
      payload.validationIssues?.some(
        (i) => i.code === "ambiguous-managed-target",
      ),
    ).toBe(true);

    resolverSpy.mockRestore();
  });

  test("replays a rejected dispatch decision without calling the LLM resolver again when event receipt dedupe expires", async () => {
    const root = await makeTempDir();
    const eventRoot = path.join(root, "events-config");
    const profileId = "dispatch-reject-replay-profile";
    const supWf = "dispatch-reject-replay-sup";
    const resolverWf = "dispatch-reject-replay-resolver";
    const resolverNodeId = "dispatch-reject-replay-res-node";
    const workerWf = "dispatch-reject-replay-worker";
    const workerNodeId = "dispatch-reject-replay-worker-node";

    await writeSupervisorDispatchProfile({
      eventRoot,
      fileBaseName: profileId,
      supervisorWorkflowName: supWf,
      managedWorkflowName: workerWf,
      managedKey: "worker",
      concurrencyMode: "multiple-active",
    });
    await writeManagerOnlyWorkflow({
      root,
      workflowName: supWf,
      sticky: false,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: resolverWf,
      nodeId: resolverNodeId,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: workerWf,
      nodeId: workerNodeId,
    });

    const binding = buildSupervisorDispatchBinding({
      profileId,
      resolverWorkflowName: resolverWf,
      resolverNodeId,
      dedupeWindowMs: 30_000,
    });

    const resolverSpy = vi
      .spyOn(dispatchResolver, "runSupervisorDispatchLlmResolver")
      .mockResolvedValueOnce({
        ok: true,
        proposal: {
          action: "start-workflow",
          reason: "first",
          confidence: 1,
          targets: [
            {
              managedWorkflowKey: "worker",
              runAlias: "replay-a",
              input: {},
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        proposal: {
          action: "start-workflow",
          reason: "second",
          confidence: 1,
          targets: [
            {
              managedWorkflowKey: "worker",
              runAlias: "replay-b",
              input: {},
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        proposal: {
          action: "submit-input",
          reason: "ambiguous key only",
          confidence: 1,
          targets: [
            {
              managedWorkflowKey: "worker",
              input: { text: "go" },
            },
          ],
        },
      });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      eventRoot,
      mockScenario: {
        [workerNodeId]: [
          { payload: { reply: "w1" } },
          { payload: { reply: "w2" } },
        ],
      },
    });

    const conv = "conv-dispatch-reject-replay";
    const thread = "thread-dispatch-reject-replay";
    const sharedSourceMessageDedupeKey = "dedupe-reject-replay-stable-msg";

    await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-rej-r-s1",
          dedupeKey: "dedupe-rej-r-s1",
          conversationId: conv,
          threadId: thread,
          text: "start a",
        }),
        receivedAt: "2026-05-01T16:00:00.000Z",
      },
    });
    await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-rej-r-s2",
          dedupeKey: "dedupe-rej-r-s2",
          conversationId: conv,
          threadId: thread,
          text: "start b",
        }),
        receivedAt: "2026-05-01T16:02:00.000Z",
      },
    });

    const rejected = await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-rej-r-input",
          dedupeKey: sharedSourceMessageDedupeKey,
          conversationId: conv,
          threadId: thread,
          text: "input",
        }),
        receivedAt: "2026-05-01T16:04:00.000Z",
      },
    });

    expect(rejected.receipt.status).toBe("dispatched");
    expect(rejected.supervisorDecisionId).toBeDefined();

    const replay = await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-rej-r-input-repeat",
          dedupeKey: sharedSourceMessageDedupeKey,
          conversationId: conv,
          threadId: thread,
          text: "input-repeat",
        }),
        receivedAt: "2026-05-01T16:10:00.000Z",
      },
    });

    expect(replay.receipt.status).toBe("dispatched");
    expect(replay.duplicate).toBe(false);
    expect(replay.supervisorDecisionId).toBe(rejected.supervisorDecisionId);
    expect(resolverSpy).toHaveBeenCalledTimes(3);

    const dispatchRef = replay.receipt.dispatchRef;
    expect(dispatchRef).toBeDefined();
    if (dispatchRef !== undefined) {
      const replayPayload = JSON.parse(
        await readFile(path.join(root, "data", dispatchRef.path), "utf8"),
      ) as {
        readonly applied: boolean;
        readonly decision: { readonly decisionId: string };
      };
      expect(replayPayload.applied).toBe(false);
      expect(replayPayload.decision.decisionId).toBe(
        rejected.supervisorDecisionId,
      );
    }

    resolverSpy.mockRestore();
  });

  test("keeps the previous managed run active when switch-workflow start fails", async () => {
    const root = await makeTempDir();
    const eventRoot = path.join(root, "events-config");
    const profileId = "dispatch-switch-failure-profile";
    const supWf = "dispatch-switch-failure-sup";
    const resolverWf = "dispatch-switch-failure-resolver";
    const resolverNodeId = "dispatch-switch-failure-res-node";
    const alphaWf = "dispatch-switch-alpha-worker";
    const alphaNodeId = "dispatch-switch-alpha-node";
    const betaWf = "dispatch-switch-beta-worker";
    const betaNodeId = "dispatch-switch-beta-node";

    await writeSupervisorDispatchProfile({
      eventRoot,
      fileBaseName: profileId,
      supervisorWorkflowName: supWf,
      managedWorkflows: [
        {
          key: "alpha",
          workflowName: alphaWf,
          concurrencyMode: "single-active",
          lifecycle: { stopOnSwitch: true },
        },
        {
          key: "beta",
          workflowName: betaWf,
          concurrencyMode: "single-active",
          lifecycle: { startOnSwitch: true },
        },
      ],
    });
    await writeManagerOnlyWorkflow({
      root,
      workflowName: supWf,
      sticky: false,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: resolverWf,
      nodeId: resolverNodeId,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: alphaWf,
      nodeId: alphaNodeId,
    });
    await writeSingleNodeWorkflow({
      root,
      workflowName: betaWf,
      nodeId: betaNodeId,
    });

    const resolverSpy = vi
      .spyOn(dispatchResolver, "runSupervisorDispatchLlmResolver")
      .mockResolvedValueOnce({
        ok: true,
        proposal: {
          action: "start-workflow",
          reason: "start alpha",
          confidence: 1,
          targets: [{ managedWorkflowKey: "alpha", input: {} }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        proposal: {
          action: "switch-workflow",
          reason: "switch to beta",
          confidence: 1,
          targets: [{ managedWorkflowKey: "beta", input: {} }],
        },
      });

    const runner = createWorkflowTriggerRunner({
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      eventRoot,
      mockScenario: {
        [alphaNodeId]: { payload: { reply: "alpha-started" } },
        [betaNodeId]: { fail: true },
      },
    });

    const conversationId = "conv-dispatch-switch-failure";
    const threadId = "thread-dispatch-switch-failure";
    const binding = buildSupervisorDispatchBinding({
      profileId,
      resolverWorkflowName: resolverWf,
      resolverNodeId,
      dedupeWindowMs: 60_000,
    });

    const started = await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-switch-start-alpha",
          dedupeKey: "dedupe-switch-start-alpha",
          conversationId,
          threadId,
          text: "start alpha",
        }),
        receivedAt: "2026-05-01T18:00:00.000Z",
      },
    });
    expect(started.receipt.status).toBe("dispatched");
    expect(started.workflowExecutionId).toBeDefined();
    if (started.workflowExecutionId === undefined) {
      resolverSpy.mockRestore();
      return;
    }

    const failedSwitch = await runner.dispatch({
      binding,
      source: buildSource(),
      event: {
        ...buildEvent({
          eventId: "evt-switch-to-beta",
          dedupeKey: "dedupe-switch-to-beta",
          conversationId,
          threadId,
          text: "switch to beta",
        }),
        receivedAt: "2026-05-01T18:02:00.000Z",
      },
    });

    expect(failedSwitch.receipt.status).toBe("failed");

    const repo = createRuntimeSupervisorConversationRepository({
      rootDataDir: path.join(root, "data"),
      cwd: root,
    });
    expect(started.supervisorConversationId).toBeDefined();
    if (started.supervisorConversationId === undefined) {
      resolverSpy.mockRestore();
      return;
    }
    const conversation = await repo.loadConversation(
      started.supervisorConversationId,
    );
    expect(conversation?.selectedManagedRunId).toBeDefined();

    const managedRuns = await repo.listManagedRuns(
      started.supervisorConversationId,
    );
    const alphaRun = managedRuns.find(
      (run) => run.managedWorkflowKey === "alpha",
    );
    expect(alphaRun).toBeDefined();
    expect(alphaRun?.status).not.toBe("stopped");
    expect(conversation?.selectedManagedRunId).toBe(alphaRun?.managedRunId);
    expect(
      managedRuns.some(
        (run) => run.managedWorkflowKey === "beta" && run.status === "failed",
      ),
    ).toBe(true);

    resolverSpy.mockRestore();
  });
});
