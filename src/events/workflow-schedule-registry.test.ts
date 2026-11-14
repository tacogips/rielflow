import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowScheduleRepository } from "./workflow-schedule-registry";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-schedules-"));
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

describe("workflow schedule registry", () => {
  test("creates, lists, loads active, and cancels schedules", async () => {
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });

    const created = await repository.create({
      sourceId: "chat",
      bindingId: "schedule-chat",
      sourceReceiptId: "evt-1",
      workflowName: "release-review",
      kind: "one-time",
      timezone: "UTC",
      dueAt: "2026-05-19T09:00:00.000Z",
      nextDueAt: "2026-05-19T09:00:00.000Z",
      workflowInput: { release: "1.2.3" },
      conversationId: "conv-1",
      now: "2026-05-18T00:00:00.000Z",
    });

    expect(created.status).toBe("active");
    expect(created.scheduleId).toMatch(/^sched_/);
    expect(await repository.load(created.scheduleId)).toMatchObject({
      workflowName: "release-review",
      workflowInput: { release: "1.2.3" },
    });
    expect(await repository.loadActive()).toHaveLength(1);
    expect(
      await repository.list({ sourceId: "chat", status: "active" }),
    ).toHaveLength(1);

    const cancelled = await repository.cancel({
      scheduleId: created.scheduleId,
      reason: "user requested",
      now: "2026-05-18T00:05:00.000Z",
    });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.lastError).toBe("user requested");
    expect(await repository.loadActive()).toHaveLength(0);
  });

  test("marks one-time and recurring schedule outcomes", async () => {
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });

    const oneTime = await repository.create({
      sourceId: "chat",
      bindingId: "schedule-chat",
      sourceReceiptId: "evt-1",
      workflowName: "once",
      kind: "one-time",
      timezone: "UTC",
      dueAt: "2026-05-19T09:00:00.000Z",
      nextDueAt: "2026-05-19T09:00:00.000Z",
      workflowInput: {},
    });
    await repository.markFiring({
      scheduleId: oneTime.scheduleId,
      occurrenceId: `${oneTime.scheduleId}:2026-05-19T09:00:00.000Z`,
      scheduledAt: "2026-05-19T09:00:00.000Z",
      firedAt: "2026-05-19T09:00:00.000Z",
    });
    const completed = await repository.markCompleted({
      scheduleId: oneTime.scheduleId,
      occurrenceId: `${oneTime.scheduleId}:2026-05-19T09:00:00.000Z`,
      workflowExecutionId: "sess-1",
    });
    expect(completed.status).toBe("completed");
    expect(completed.lastExecutionId).toBe("sess-1");
    expect(completed.attemptCount).toBe(1);

    const recurring = await repository.create({
      sourceId: "chat",
      bindingId: "schedule-chat",
      sourceReceiptId: "evt-2",
      workflowName: "daily",
      kind: "recurring",
      timezone: "UTC",
      cron: "0 9 * * *",
      nextDueAt: "2026-05-19T09:00:00.000Z",
      workflowInput: {},
    });
    const recurringOccurrenceId = `${recurring.scheduleId}:2026-05-19T09:00:00.000Z`;
    await repository.markFiring({
      scheduleId: recurring.scheduleId,
      occurrenceId: recurringOccurrenceId,
      scheduledAt: "2026-05-19T09:00:00.000Z",
      firedAt: "2026-05-19T09:00:00.000Z",
    });
    const rearmed = await repository.markFailed({
      scheduleId: recurring.scheduleId,
      occurrenceId: recurringOccurrenceId,
      error: "transient dispatch failure",
      nextDueAt: "2026-05-20T09:00:00.000Z",
    });
    expect(rearmed.status).toBe("active");
    expect(rearmed.nextDueAt).toBe("2026-05-20T09:00:00.000Z");
    expect(rearmed.lastError).toBe("transient dispatch failure");
  });

  test("does not reactivate schedules cancelled during an in-flight occurrence", async () => {
    const rootDataDir = await makeTempDir();
    const repository = createWorkflowScheduleRepository({ rootDataDir });
    const recurring = await repository.create({
      sourceId: "chat",
      bindingId: "schedule-chat",
      sourceReceiptId: "evt-1",
      workflowName: "daily",
      kind: "recurring",
      timezone: "UTC",
      cron: "0 9 * * *",
      nextDueAt: "2026-05-19T09:00:00.000Z",
      workflowInput: {},
    });
    const occurrenceId = `${recurring.scheduleId}:2026-05-19T09:00:00.000Z`;

    await repository.markFiring({
      scheduleId: recurring.scheduleId,
      occurrenceId,
      scheduledAt: "2026-05-19T09:00:00.000Z",
      firedAt: "2026-05-19T09:00:00.000Z",
    });
    await repository.cancel({
      scheduleId: recurring.scheduleId,
      reason: "operator cancelled",
    });
    const completed = await repository.markCompleted({
      scheduleId: recurring.scheduleId,
      occurrenceId,
      workflowExecutionId: "sess-1",
      nextDueAt: "2026-05-20T09:00:00.000Z",
    });
    const failed = await repository.markFailed({
      scheduleId: recurring.scheduleId,
      occurrenceId,
      error: "late failure",
      nextDueAt: "2026-05-20T09:00:00.000Z",
    });

    expect(completed.status).toBe("cancelled");
    expect(completed.nextDueAt).toBe("2026-05-19T09:00:00.000Z");
    expect(failed.status).toBe("cancelled");
    expect(failed.nextDueAt).toBe("2026-05-19T09:00:00.000Z");
  });
});
