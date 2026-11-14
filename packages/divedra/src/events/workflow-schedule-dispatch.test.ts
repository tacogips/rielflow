import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createScheduledEventManager } from "./scheduled-event-manager";
import {
  createWorkflowTriggerRunner,
  dispatchEventToMatchingBindings,
} from "./trigger-runner";
import type { EventConfiguration, ExternalEventEnvelope } from "./types";
import { createWorkflowScheduleDispatcher } from "./workflow-schedule-dispatch";
import { createWorkflowScheduleRepository } from "./workflow-schedule-registry";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-schedule-dispatch-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("workflow schedule dispatch", () => {
  test("registers a chat schedule through a resolver workflow and queues the due event", async () => {
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });
    const scheduledEventManager = createScheduledEventManager({
      now: () => new Date("2026-05-18T00:00:00.000Z"),
    });
    const configuration: EventConfiguration = {
      eventRoot: "test",
      sources: [{ id: "chat", kind: "webhook", path: "/chat" }],
      destinations: [
        {
          id: "chat-replies",
          kind: "chat",
          sourceId: "chat",
        },
      ],
      bindings: [
        {
          id: "schedule-chat",
          sourceId: "chat",
          outputDestinations: ["chat-replies"],
          match: { eventType: "chat.message" },
          inputMapping: {
            mode: "template",
            template: { request: "{{event.input.text}}" },
          },
          execution: {
            mode: "schedule-registration",
            resolverWorkflowName: "dispatcher-llm-resolver-stub",
            resolverNodeId: "resolver-worker",
            minConfidence: 0.8,
          },
        },
      ],
    };
    const event: ExternalEventEnvelope = {
      sourceId: "chat",
      eventId: "evt-chat-schedule",
      provider: "webhook",
      eventType: "chat.message",
      receivedAt: "2026-05-18T00:00:00.000Z",
      dedupeKey: "evt-chat-schedule",
      conversation: { id: "conv-1", threadId: "thread-1" },
      actor: { id: "user-1" },
      input: { text: "run worker-only-single-step at 9:00" },
    };
    const dispatchChatReply = vi.fn(async () => ({
      status: "sent" as const,
      provider: "webhook",
      destinationResults: [
        {
          destinationId: "chat-replies",
          sourceId: "chat",
          idempotencyKey: "reply-1",
          status: "sent" as const,
          provider: "webhook",
        },
      ],
    }));
    const replyDispatcher = {
      dispatchChatReply,
    };

    const results = await dispatchEventToMatchingBindings(
      {
        configuration,
        event,
        runner: createWorkflowTriggerRunner({
          rootDataDir,
          workflowRoot: "./examples",
          mockScenario: {
            "resolver-worker": {
              provider: "scenario-mock",
              when: { always: true },
              payload: {
                status: "ready",
                workflowName: "worker-only-single-step",
                confidence: 0.99,
                schedule: {
                  kind: "one-time",
                  timezone: "UTC",
                  dueAt: "2026-05-19T09:00:00.000Z",
                },
                workflowInput: { topic: "release" },
                confirmationText: "Scheduled worker-only-single-step.",
              },
            },
          },
          eventReplyDispatcher: replyDispatcher,
          scheduledEventManager,
          workflowScheduleRepository: repository,
        }),
      },
      {
        rootDataDir,
        workflowRoot: "./examples",
        eventReplyDispatcher: replyDispatcher,
        scheduledEventManager,
        workflowScheduleRepository: repository,
      },
    );
    const schedules = await repository.loadActive();

    expect(results[0]?.receipt.status).toBe("dispatched");
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      workflowName: "worker-only-single-step",
      conversationId: "conv-1",
      actorId: "user-1",
    });
    expect(
      scheduledEventManager.get(
        `workflow-schedule:${schedules[0]?.scheduleId ?? ""}`,
      ),
    ).toMatchObject({
      kind: "workflow-schedule",
      status: "pending",
    });
    expect(dispatchChatReply).toHaveBeenCalledTimes(2);
    scheduledEventManager.stop();
  });

  test("suppresses unsafe schedule registration replies without output destinations", async () => {
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });
    const dispatchChatReply = vi.fn(async () => ({
      status: "sent" as const,
      provider: "webhook",
    }));
    const replyDispatcher = { dispatchChatReply };
    const configuration: EventConfiguration = {
      eventRoot: "test",
      sources: [{ id: "chat", kind: "webhook", path: "/chat" }],
      destinations: [],
      bindings: [
        {
          id: "schedule-chat",
          sourceId: "chat",
          match: { eventType: "chat.message" },
          inputMapping: {
            mode: "template",
            template: { request: "{{event.input.text}}" },
          },
          execution: {
            mode: "schedule-registration",
            resolverWorkflowName: "dispatcher-llm-resolver-stub",
            resolverNodeId: "resolver-worker",
            minConfidence: 0.8,
          },
        },
      ],
    };
    const event: ExternalEventEnvelope = {
      sourceId: "chat",
      eventId: "evt-chat-schedule-unsafe-reply",
      provider: "webhook",
      eventType: "chat.message",
      receivedAt: "2026-05-18T00:00:00.000Z",
      dedupeKey: "evt-chat-schedule-unsafe-reply",
      conversation: { id: "conv-1", threadId: "thread-1" },
      actor: { id: "user-1" },
      input: { text: "schedule worker-only-single-step without confidence" },
    };

    const results = await dispatchEventToMatchingBindings(
      {
        configuration,
        event,
        runner: createWorkflowTriggerRunner({
          rootDataDir,
          workflowRoot: "./examples",
          mockScenario: {
            "resolver-worker": {
              provider: "scenario-mock",
              when: { always: true },
              payload: {
                status: "ready",
                workflowName: "worker-only-single-step",
                schedule: {
                  kind: "one-time",
                  timezone: "UTC",
                  dueAt: "2026-05-19T09:00:00.000Z",
                },
                workflowInput: { topic: "release" },
                confirmationText: "Scheduled worker-only-single-step.",
              },
            },
          },
          eventReplyDispatcher: replyDispatcher,
          workflowScheduleRepository: repository,
        }),
      },
      {
        rootDataDir,
        workflowRoot: "./examples",
        eventReplyDispatcher: replyDispatcher,
        workflowScheduleRepository: repository,
      },
    );

    expect(results[0]?.receipt.status).toBe("skipped");
    expect(results[0]?.receipt.error).toBe(
      "cannot ask schedule clarification without a safe reply destination",
    );
    expect(dispatchChatReply).not.toHaveBeenCalled();
    expect(await repository.loadActive()).toHaveLength(0);
  });

  test("persists unsafe schedule registrations without dispatching confirmation replies", async () => {
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });
    const scheduledEventManager = createScheduledEventManager({
      now: () => new Date("2026-05-18T00:00:00.000Z"),
    });
    const dispatchChatReply = vi.fn(async () => ({
      status: "sent" as const,
      provider: "webhook",
    }));
    const replyDispatcher = { dispatchChatReply };
    const configuration: EventConfiguration = {
      eventRoot: "test",
      sources: [{ id: "chat", kind: "webhook", path: "/chat" }],
      destinations: [],
      bindings: [
        {
          id: "schedule-chat",
          sourceId: "chat",
          match: { eventType: "chat.message" },
          inputMapping: { mode: "event-input" },
          execution: {
            mode: "schedule-registration",
            resolverWorkflowName: "dispatcher-llm-resolver-stub",
            resolverNodeId: "resolver-worker",
            minConfidence: 0.8,
          },
        },
      ],
    };
    const event: ExternalEventEnvelope = {
      sourceId: "chat",
      eventId: "evt-chat-schedule-unsafe-ready",
      provider: "webhook",
      eventType: "chat.message",
      receivedAt: "2026-05-18T00:00:00.000Z",
      dedupeKey: "evt-chat-schedule-unsafe-ready",
      conversation: { id: "conv-1", threadId: "thread-1" },
      actor: { id: "user-1" },
      input: { text: "schedule worker-only-single-step at 9:00" },
    };

    const results = await dispatchEventToMatchingBindings(
      {
        configuration,
        event,
        runner: createWorkflowTriggerRunner({
          rootDataDir,
          workflowRoot: "./examples",
          mockScenario: {
            "resolver-worker": {
              provider: "scenario-mock",
              when: { always: true },
              payload: {
                status: "ready",
                workflowName: "worker-only-single-step",
                confidence: 0.99,
                schedule: {
                  kind: "one-time",
                  timezone: "UTC",
                  dueAt: "2026-05-19T09:00:00.000Z",
                },
                workflowInput: { topic: "release" },
                confirmationText: "Scheduled worker-only-single-step.",
              },
            },
          },
          eventReplyDispatcher: replyDispatcher,
          scheduledEventManager,
          workflowScheduleRepository: repository,
        }),
      },
      {
        rootDataDir,
        workflowRoot: "./examples",
        eventReplyDispatcher: replyDispatcher,
        scheduledEventManager,
        workflowScheduleRepository: repository,
      },
    );
    const schedules = await repository.loadActive();

    expect(results[0]?.receipt.status).toBe("dispatched");
    expect(schedules).toHaveLength(1);
    expect(
      scheduledEventManager.get(
        `workflow-schedule:${schedules[0]?.scheduleId ?? ""}`,
      ),
    ).toMatchObject({
      kind: "workflow-schedule",
      status: "pending",
    });
    expect(dispatchChatReply).not.toHaveBeenCalled();
    scheduledEventManager.stop();
  });

  test("marks schedule registration receipts failed when persistence throws", async () => {
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });
    const failingRepository = {
      ...repository,
      create: async () => {
        throw new Error("schedule store down");
      },
    };
    const configuration: EventConfiguration = {
      eventRoot: "test",
      sources: [{ id: "chat", kind: "webhook", path: "/chat" }],
      destinations: [{ id: "chat-replies", kind: "chat", sourceId: "chat" }],
      bindings: [
        {
          id: "schedule-chat",
          sourceId: "chat",
          outputDestinations: ["chat-replies"],
          match: { eventType: "chat.message" },
          inputMapping: { mode: "event-input" },
          execution: {
            mode: "schedule-registration",
            resolverWorkflowName: "dispatcher-llm-resolver-stub",
            resolverNodeId: "resolver-worker",
          },
        },
      ],
    };
    const event: ExternalEventEnvelope = {
      sourceId: "chat",
      eventId: "evt-chat-schedule-fail",
      provider: "webhook",
      eventType: "chat.message",
      receivedAt: "2026-05-18T00:00:00.000Z",
      dedupeKey: "evt-chat-schedule-fail",
      conversation: { id: "conv-1" },
      input: { text: "run worker-only-single-step at 9:00" },
    };

    const results = await dispatchEventToMatchingBindings(
      {
        configuration,
        event,
        runner: createWorkflowTriggerRunner({
          rootDataDir,
          workflowRoot: "./examples",
          mockScenario: {
            "resolver-worker": {
              provider: "scenario-mock",
              when: { always: true },
              payload: {
                status: "ready",
                workflowName: "worker-only-single-step",
                schedule: {
                  kind: "one-time",
                  timezone: "UTC",
                  dueAt: "2026-05-19T09:00:00.000Z",
                },
                workflowInput: {},
                confirmationText: "Scheduled worker-only-single-step.",
              },
            },
          },
          workflowScheduleRepository: failingRepository,
        }),
      },
      {
        rootDataDir,
        workflowRoot: "./examples",
        workflowScheduleRepository: failingRepository,
      },
    );

    expect(results[0]?.receipt.status).toBe("failed");
    expect(results[0]?.receipt.error).toBe("schedule store down");
    expect(await repository.loadActive()).toHaveLength(0);
  });

  test("dispatches one-time due occurrences through generated event bindings", async () => {
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });
    const schedule = await repository.create({
      sourceId: "chat",
      bindingId: "schedule-chat",
      sourceReceiptId: "evt-1",
      workflowName: "target-workflow",
      kind: "one-time",
      timezone: "UTC",
      dueAt: "2026-05-19T09:00:00.000Z",
      nextDueAt: "2026-05-19T09:00:00.000Z",
      workflowInput: { requestedBy: "chat" },
    });
    const execute = vi.fn(async (input) => {
      expect(input.workflowName).toBe("target-workflow");
      expect(input.runtimeVariables["workflowInput"]).toEqual({
        requestedBy: "chat",
      });
      expect(input.runtimeVariables["event"]).toMatchObject({
        input: { scheduleId: schedule.scheduleId },
      });
      return {
        workflowName: input.workflowName,
        workflowExecutionId: "sess-scheduled",
        sessionId: "sess-scheduled",
        status: "running",
        exitCode: 0,
      };
    });

    const result = await createWorkflowScheduleDispatcher({
      rootDataDir,
      workflowScheduleRepository: repository,
      workflowExecutionPort: {
        execute,
        resume: async () => {
          throw new Error("not used");
        },
      },
    }).dispatchDueOccurrence({
      rootDataDir,
      repository,
      scheduleId: schedule.scheduleId,
      occurrenceId: `${schedule.scheduleId}:2026-05-19T09:00:00.000Z`,
      scheduledAt: "2026-05-19T09:00:00.000Z",
      firedAt: "2026-05-19T09:00:00.000Z",
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.workflowExecutionId).toBe("sess-scheduled");
    expect(result.receiptId).toMatch(/^evt-/);
    expect(result.schedule.status).toBe("completed");
  });

  test("does not dispatch cancelled due occurrences", async () => {
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });
    const schedule = await repository.create({
      sourceId: "chat",
      bindingId: "schedule-chat",
      sourceReceiptId: "evt-1",
      workflowName: "target-workflow",
      kind: "one-time",
      timezone: "UTC",
      dueAt: "2026-05-19T09:00:00.000Z",
      nextDueAt: "2026-05-19T09:00:00.000Z",
      workflowInput: { requestedBy: "chat" },
    });
    await repository.cancel({
      scheduleId: schedule.scheduleId,
      reason: "operator cancelled",
    });
    const execute = vi.fn(async () => ({
      workflowName: "target-workflow",
      workflowExecutionId: "sess-scheduled",
      sessionId: "sess-scheduled",
      status: "running",
      exitCode: 0,
    }));

    const result = await createWorkflowScheduleDispatcher({
      rootDataDir,
      workflowScheduleRepository: repository,
      workflowExecutionPort: {
        execute,
        resume: async () => {
          throw new Error("not used");
        },
      },
    }).dispatchDueOccurrence({
      rootDataDir,
      repository,
      scheduleId: schedule.scheduleId,
      occurrenceId: `${schedule.scheduleId}:2026-05-19T09:00:00.000Z`,
      scheduledAt: "2026-05-19T09:00:00.000Z",
      firedAt: "2026-05-19T09:00:00.000Z",
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.receiptId).toBeUndefined();
    expect(result.workflowExecutionId).toBeUndefined();
    expect(result.schedule.status).toBe("cancelled");
    expect(result.schedule.attemptCount).toBe(0);
  });

  test("does not mutate recurring schedules for stale due occurrences", async () => {
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });
    const schedule = await repository.create({
      sourceId: "chat",
      bindingId: "schedule-chat",
      sourceReceiptId: "evt-1",
      workflowName: "target-workflow",
      kind: "recurring",
      timezone: "UTC",
      cron: "0 9 * * *",
      nextDueAt: "2026-05-19T09:00:00.000Z",
      workflowInput: { requestedBy: "chat" },
    });
    const occurrenceId = `${schedule.scheduleId}:2026-05-19T09:00:00.000Z`;
    const execute = vi.fn(async (input) => ({
      workflowName: input.workflowName,
      workflowExecutionId: "sess-scheduled",
      sessionId: "sess-scheduled",
      status: "running",
      exitCode: 0,
    }));
    const dispatcher = createWorkflowScheduleDispatcher({
      rootDataDir,
      workflowScheduleRepository: repository,
      workflowExecutionPort: {
        execute,
        resume: async () => {
          throw new Error("not used");
        },
      },
    });

    const first = await dispatcher.dispatchDueOccurrence({
      rootDataDir,
      repository,
      scheduleId: schedule.scheduleId,
      occurrenceId,
      scheduledAt: "2026-05-19T09:00:00.000Z",
      firedAt: "2026-05-19T09:00:00.000Z",
    });
    const stale = await dispatcher.dispatchDueOccurrence({
      rootDataDir,
      repository,
      scheduleId: schedule.scheduleId,
      occurrenceId,
      scheduledAt: "2026-05-19T09:00:00.000Z",
      firedAt: "2026-05-19T09:01:00.000Z",
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(first.schedule.status).toBe("active");
    expect(first.nextDueAt).toBe("2026-05-20T09:00:00.000Z");
    expect(stale.receiptId).toBeUndefined();
    expect(stale.workflowExecutionId).toBeUndefined();
    expect(stale.schedule.nextDueAt).toBe("2026-05-20T09:00:00.000Z");
    expect(stale.schedule.attemptCount).toBe(1);
  });

  test("marks due occurrences failed when receipt dispatch throws", async () => {
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });
    const schedule = await repository.create({
      sourceId: "chat",
      bindingId: "schedule-chat",
      sourceReceiptId: "evt-1",
      workflowName: "target-workflow",
      kind: "one-time",
      timezone: "UTC",
      dueAt: "2026-05-19T09:00:00.000Z",
      nextDueAt: "2026-05-19T09:00:00.000Z",
      workflowInput: { requestedBy: "chat" },
    });
    const occurrenceId = `${schedule.scheduleId}:2026-05-19T09:00:00.000Z`;
    const receiptStore = {
      begin: async () => {
        throw new Error("receipt down");
      },
      update: async () => {
        throw new Error("not used");
      },
    };

    await expect(
      createWorkflowScheduleDispatcher({
        rootDataDir,
        workflowScheduleRepository: repository,
        eventReceiptStore: receiptStore,
      }).dispatchDueOccurrence({
        rootDataDir,
        repository,
        scheduleId: schedule.scheduleId,
        occurrenceId,
        scheduledAt: "2026-05-19T09:00:00.000Z",
        firedAt: "2026-05-19T09:00:00.000Z",
        eventReceiptStore: receiptStore,
      }),
    ).rejects.toThrow("receipt down");
    const failed = await repository.load(schedule.scheduleId);

    expect(failed).toMatchObject({
      status: "failed",
      attemptCount: 1,
      lastOccurrenceId: occurrenceId,
      lastError: "receipt down",
    });
  });

  test("rehydrates active schedules into the shared scheduled event manager", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-05-19T08:59:59.000Z");
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });
    const schedule = await repository.create({
      sourceId: "chat",
      bindingId: "schedule-chat",
      sourceReceiptId: "evt-1",
      workflowName: "target-workflow",
      kind: "one-time",
      timezone: "UTC",
      dueAt: "2026-05-19T09:00:00.000Z",
      nextDueAt: "2026-05-19T09:00:00.000Z",
      workflowInput: {},
    });
    const manager = createScheduledEventManager({ now: () => now });
    const execute = vi.fn(async () => ({
      workflowName: "target-workflow",
      workflowExecutionId: "sess-scheduled",
      sessionId: "sess-scheduled",
      status: "running",
      exitCode: 0,
    }));
    const dispatcher = createWorkflowScheduleDispatcher({
      rootDataDir,
      workflowScheduleRepository: repository,
      workflowExecutionPort: {
        execute,
        resume: async () => {
          throw new Error("not used");
        },
      },
    });

    const registered = await dispatcher.rehydrateActiveSchedules({
      rootDataDir,
      repository,
      scheduledEventManager: manager,
    });

    expect(registered.map((event) => event.id)).toEqual([
      `workflow-schedule:${schedule.scheduleId}`,
    ]);
    expect(
      manager.get(`workflow-schedule:${schedule.scheduleId}`),
    ).toMatchObject({
      kind: "workflow-schedule",
      status: "pending",
      payload: {
        scheduleId: schedule.scheduleId,
        workflowName: "target-workflow",
      },
    });
    expect(execute).not.toHaveBeenCalled();
    manager.stop();
  });

  test("rehydrates stale recurring schedules to the next future occurrence", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-05-21T08:00:00.000Z");
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });
    const schedule = await repository.create({
      sourceId: "chat",
      bindingId: "schedule-chat",
      sourceReceiptId: "evt-1",
      workflowName: "target-workflow",
      kind: "recurring",
      timezone: "UTC",
      cron: "0 9 * * *",
      nextDueAt: "2026-05-19T09:00:00.000Z",
      workflowInput: {},
    });
    const manager = createScheduledEventManager({ now: () => now });
    const execute = vi.fn(async () => ({
      workflowName: "target-workflow",
      workflowExecutionId: "sess-scheduled",
      sessionId: "sess-scheduled",
      status: "running",
      exitCode: 0,
    }));
    const dispatcher = createWorkflowScheduleDispatcher({
      rootDataDir,
      workflowScheduleRepository: repository,
      workflowExecutionPort: {
        execute,
        resume: async () => {
          throw new Error("not used");
        },
      },
    });

    const registered = await dispatcher.rehydrateActiveSchedules({
      rootDataDir,
      repository,
      scheduledEventManager: manager,
      now,
    });
    const reloaded = await repository.load(schedule.scheduleId);

    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      id: `workflow-schedule:${schedule.scheduleId}`,
      kind: "workflow-schedule",
      dueAt: "2026-05-21T09:00:00.000Z",
      status: "pending",
      payload: {
        scheduleId: schedule.scheduleId,
        occurrenceId: `${schedule.scheduleId}:2026-05-21T09:00:00.000Z`,
        scheduledAt: "2026-05-21T09:00:00.000Z",
      },
    });
    expect(reloaded?.nextDueAt).toBe("2026-05-21T09:00:00.000Z");
    expect(execute).not.toHaveBeenCalled();
    manager.stop();
  });
});
