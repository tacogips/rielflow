import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createScheduledEventManager } from "../events/scheduled-event-manager";
import { rerunWorkflow } from "../lib";
import { runWorkflow } from "./engine";
import { loadSession, saveSession } from "./session-store";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-sleep-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function createSleepWorkflow(
  root: string,
  durationMs = 5,
): Promise<void> {
  const workflowDir = path.join(root, "sleep-flow");
  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: "sleep-flow",
    description: "sleep flow",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryStepId: "wait",
    nodes: [
      { id: "wait-node", nodeFile: "nodes/node-wait.json" },
      { id: "worker-node", nodeFile: "nodes/node-worker.json" },
    ],
    steps: [
      {
        id: "wait",
        nodeId: "wait-node",
        role: "worker",
        transitions: [{ toStepId: "worker", label: "always" }],
      },
      { id: "worker", nodeId: "worker-node", role: "worker" },
    ],
  });
  await writeJson(path.join(workflowDir, "nodes/node-wait.json"), {
    id: "wait-node",
    nodeType: "sleep",
    variables: {},
    sleep: { durationMs },
  });
  await writeJson(path.join(workflowDir, "nodes/node-worker.json"), {
    id: "worker-node",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "worker",
    variables: {},
  });
}

describe("sleep node runtime", () => {
  test("pauses without blocking and resumes the queued continuation", async () => {
    const root = await makeTempDir();
    await createSleepWorkflow(root);
    const scheduledEventManager = createScheduledEventManager();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      scheduledEventManager,
      mockScenario: {
        worker: {
          payload: { completedAfterSleep: true },
          when: { always: true },
        },
      },
    };

    const result = await runWorkflow("sleep-flow", options);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.exitCode).toBe(4);
    expect(result.value.session.status).toBe("paused");
    expect(result.value.session.queue).toEqual(["worker"]);

    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(scheduledEventManager.list().map((event) => event.status)).toEqual([
      "fired",
    ]);
    const loaded = await loadSession(result.value.session.sessionId, options);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.status).toBe("completed");
    expect(loaded.value.nodeExecutions.map((entry) => entry.nodeId)).toEqual([
      "wait",
      "worker",
    ]);
    scheduledEventManager.stop();
  });

  test("does not revive a cancelled paused sleep session", async () => {
    const root = await makeTempDir();
    await createSleepWorkflow(root, 2_000);
    const scheduledEventManager = createScheduledEventManager();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      scheduledEventManager,
      mockScenario: {
        worker: {
          payload: { shouldNotRun: true },
          when: { always: true },
        },
      },
    };

    const result = await runWorkflow("sleep-flow", options);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const cancelled = {
      ...result.value.session,
      status: "cancelled" as const,
      endedAt: new Date().toISOString(),
      lastError: "cancelled by test",
    };
    const saved = await saveSession(cancelled, options);
    expect(saved.ok).toBe(true);
    const cancelledStored = await loadSession(
      result.value.session.sessionId,
      options,
    );
    expect(cancelledStored.ok).toBe(true);
    if (!cancelledStored.ok) {
      return;
    }
    expect(cancelledStored.value.scheduledEvents?.[0]?.status).toBe(
      "cancelled",
    );
    expect(scheduledEventManager.list().map((event) => event.status)).toEqual([
      "cancelled",
    ]);

    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const loaded = await loadSession(result.value.session.sessionId, options);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.status).toBe("cancelled");
    expect(loaded.value.nodeExecutions.map((entry) => entry.nodeId)).toEqual([
      "wait",
    ]);
    scheduledEventManager.stop();
  });

  test("cancels stale pending sleep events before rerun replacement", async () => {
    const root = await makeTempDir();
    await createSleepWorkflow(root, 10_000);
    const scheduledEventManager = createScheduledEventManager();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      scheduledEventManager,
      mockScenario: {
        worker: {
          payload: { completedAfterSleep: true },
          when: { always: true },
        },
      },
    };

    const first = await runWorkflow("sleep-flow", options);

    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const firstEventId = first.value.session.scheduledEvents?.[0]?.eventId;
    expect(firstEventId).toBeDefined();

    const rerun = await runWorkflow("sleep-flow", {
      ...options,
      rerunFromSessionId: first.value.session.sessionId,
      rerunFromStepId: "wait",
    });

    expect(rerun.ok).toBe(true);
    if (!rerun.ok) {
      return;
    }
    const source = await loadSession(first.value.session.sessionId, options);
    expect(source.ok).toBe(true);
    if (!source.ok || firstEventId === undefined) {
      return;
    }
    expect(source.value.scheduledEvents?.[0]?.status).toBe("cancelled");
    expect(scheduledEventManager.get(firstEventId)?.status).toBe("cancelled");
    expect(rerun.value.session.sessionId).not.toBe(
      first.value.session.sessionId,
    );
    expect(rerun.value.session.scheduledEvents?.[0]?.status).toBe("pending");
    scheduledEventManager.stop();
  });

  test("library rerunWorkflow cancels stale pending sleep events in the shared manager", async () => {
    const root = await makeTempDir();
    await createSleepWorkflow(root, 10_000);
    const scheduledEventManager = createScheduledEventManager();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      scheduledEventManager,
      mockScenario: {
        worker: {
          payload: { completedAfterSleep: true },
          when: { always: true },
        },
      },
    };

    const first = await runWorkflow("sleep-flow", options);

    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const firstEventId = first.value.session.scheduledEvents?.[0]?.eventId;
    expect(firstEventId).toBeDefined();

    const rerun = await rerunWorkflow({
      ...options,
      sourceSessionId: first.value.session.sessionId,
      fromStepId: "wait",
    });

    const source = await loadSession(first.value.session.sessionId, options);
    expect(source.ok).toBe(true);
    if (!source.ok || firstEventId === undefined) {
      return;
    }
    expect(source.value.scheduledEvents?.[0]?.status).toBe("cancelled");
    expect(scheduledEventManager.get(firstEventId)?.status).toBe("cancelled");
    expect(rerun.sessionId).not.toBe(first.value.session.sessionId);
    expect(rerun.status).toBe("paused");
    scheduledEventManager.stop();
  });

  test("keeps pending sleep events when rerun target validation fails", async () => {
    const root = await makeTempDir();
    await createSleepWorkflow(root, 10_000);
    const scheduledEventManager = createScheduledEventManager();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      scheduledEventManager,
      mockScenario: {
        worker: {
          payload: { shouldNotRun: true },
          when: { always: true },
        },
      },
    };

    const first = await runWorkflow("sleep-flow", options);

    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const firstEventId = first.value.session.scheduledEvents?.[0]?.eventId;
    expect(firstEventId).toBeDefined();

    const rerun = await runWorkflow("sleep-flow", {
      ...options,
      rerunFromSessionId: first.value.session.sessionId,
      rerunFromStepId: "missing-step",
    });

    expect(rerun.ok).toBe(false);
    const source = await loadSession(first.value.session.sessionId, options);
    expect(source.ok).toBe(true);
    if (!source.ok || firstEventId === undefined) {
      return;
    }
    expect(source.value.scheduledEvents?.[0]?.status).toBe("pending");
    expect(scheduledEventManager.get(firstEventId)?.status).toBe("pending");
    scheduledEventManager.stop();
  });

  test("marks sleep events failed when scheduled continuation fails", async () => {
    const root = await makeTempDir();
    await createSleepWorkflow(root, 5);
    const scheduledEventManager = createScheduledEventManager();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      scheduledEventManager,
      mockScenario: {
        worker: {
          fail: true,
        },
      },
    };

    const result = await runWorkflow("sleep-flow", options);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const eventId = result.value.session.scheduledEvents?.[0]?.eventId;
    expect(eventId).toBeDefined();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (scheduledEventManager.get(eventId ?? "")?.status === "failed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const loaded = await loadSession(result.value.session.sessionId, options);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok || eventId === undefined) {
      return;
    }
    expect(loaded.value.status).toBe("failed");
    expect(loaded.value.scheduledEvents?.[0]?.status).toBe("failed");
    expect(scheduledEventManager.get(eventId)?.status).toBe("failed");
    scheduledEventManager.stop();
  });

  test("terminal session persistence cancels pending sleep events", async () => {
    const root = await makeTempDir();
    await createSleepWorkflow(root, 10_000);
    const scheduledEventManager = createScheduledEventManager();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      scheduledEventManager,
      mockScenario: {
        worker: {
          payload: { shouldNotRun: true },
          when: { always: true },
        },
      },
    };

    const result = await runWorkflow("sleep-flow", options);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const terminal = {
      ...result.value.session,
      status: "completed" as const,
      queue: [],
      endedAt: new Date().toISOString(),
    };
    const saved = await saveSession(terminal, options);
    expect(saved.ok).toBe(true);

    const loaded = await loadSession(result.value.session.sessionId, options);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.scheduledEvents?.[0]?.status).toBe("cancelled");
    expect(scheduledEventManager.list().map((event) => event.status)).toEqual([
      "cancelled",
    ]);
    scheduledEventManager.stop();
  });
});
