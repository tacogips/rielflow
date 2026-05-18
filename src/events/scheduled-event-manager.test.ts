import { afterEach, describe, expect, test, vi } from "vitest";
import { createScheduledEventManager } from "./scheduled-event-manager";

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduled event manager", () => {
  test("fires due events and re-arms when an earlier event is registered", async () => {
    vi.useFakeTimers();
    let now = new Date("2026-05-15T00:00:00.000Z");
    const fired: string[] = [];
    const manager = createScheduledEventManager({ now: () => now });

    manager.register({
      id: "late",
      kind: "workflow-sleep",
      dueAt: "2026-05-15T00:00:10.000Z",
      dedupeKey: "late",
      fire: async (event) => {
        fired.push(event.id);
      },
    });
    manager.register({
      id: "early",
      kind: "cron",
      dueAt: "2026-05-15T00:00:01.000Z",
      dedupeKey: "early",
      fire: async (event) => {
        fired.push(event.id);
      },
    });

    now = new Date("2026-05-15T00:00:01.000Z");
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(fired).toEqual(["early"]);
    expect(manager.get("early")?.status).toBe("fired");
    expect(manager.get("late")?.status).toBe("pending");

    manager.stop();
  });

  test("cancels pending events before they fire", async () => {
    vi.useFakeTimers();
    let now = new Date("2026-05-15T00:00:00.000Z");
    const fire = vi.fn();
    const manager = createScheduledEventManager({ now: () => now });

    manager.register({
      id: "sleep",
      kind: "workflow-sleep",
      dueAt: "2026-05-15T00:00:01.000Z",
      dedupeKey: "sleep",
      fire,
    });

    expect(manager.cancel("sleep")).toBe(true);
    now = new Date("2026-05-15T00:00:01.000Z");
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(fire).not.toHaveBeenCalled();
    expect(manager.get("sleep")?.status).toBe("cancelled");
    manager.stop();
  });

  test("fires with real timers", async () => {
    const fired: string[] = [];
    const manager = createScheduledEventManager();

    manager.register({
      id: "real",
      kind: "workflow-sleep",
      dueAt: new Date(Date.now() + 5),
      dedupeKey: "real",
      fire: (event) => {
        fired.push(event.id);
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fired).toEqual(["real"]);
    expect(manager.get("real")?.status).toBe("fired");
    manager.stop();
  });

  test("marks events failed when the fire callback throws", async () => {
    vi.useFakeTimers();
    let now = new Date("2026-05-15T00:00:00.000Z");
    const manager = createScheduledEventManager({ now: () => now });

    manager.register({
      id: "failing-sleep",
      kind: "workflow-sleep",
      dueAt: "2026-05-15T00:00:01.000Z",
      dedupeKey: "failing-sleep",
      fire: async () => {
        throw new Error("resume failed");
      },
    });

    now = new Date("2026-05-15T00:00:01.000Z");
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.get("failing-sleep")?.status).toBe("failed");
    expect(manager.get("failing-sleep")?.lastError).toBe("resume failed");
    manager.stop();
  });

  test("supports workflow-schedule events in the shared pool", async () => {
    vi.useFakeTimers();
    let now = new Date("2026-05-15T00:00:00.000Z");
    const fired: string[] = [];
    const manager = createScheduledEventManager({ now: () => now });

    manager.register({
      id: "workflow-schedule:sched_123",
      kind: "workflow-schedule",
      dueAt: "2026-05-15T00:00:01.000Z",
      dedupeKey: "workflow-schedule:sched_123:occ-1",
      payload: { scheduleId: "sched_123" },
      fire: async (event) => {
        fired.push(event.kind);
      },
    });

    now = new Date("2026-05-15T00:00:01.000Z");
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(fired).toEqual(["workflow-schedule"]);
    expect(manager.get("workflow-schedule:sched_123")?.status).toBe("fired");
    manager.stop();
  });

  test("does not cancel events that are already firing", async () => {
    vi.useFakeTimers();
    let now = new Date("2026-05-15T00:00:00.000Z");
    const manager = createScheduledEventManager({ now: () => now });
    let releaseFire: (() => void) | undefined;
    const fireBlocked = new Promise<void>((resolve) => {
      releaseFire = resolve;
    });

    manager.register({
      id: "firing-sleep",
      kind: "workflow-sleep",
      dueAt: "2026-05-15T00:00:01.000Z",
      dedupeKey: "firing-sleep",
      fire: async () => {
        await fireBlocked;
      },
    });

    now = new Date("2026-05-15T00:00:01.000Z");
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(manager.get("firing-sleep")?.status).toBe("firing");
    expect(manager.cancel("firing-sleep")).toBe(false);
    releaseFire?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.get("firing-sleep")?.status).toBe("fired");
    manager.stop();
  });

  test("does not cancel events that already failed", async () => {
    vi.useFakeTimers();
    let now = new Date("2026-05-15T00:00:00.000Z");
    const manager = createScheduledEventManager({ now: () => now });

    manager.register({
      id: "failed-sleep",
      kind: "workflow-sleep",
      dueAt: "2026-05-15T00:00:01.000Z",
      dedupeKey: "failed-sleep",
      fire: async () => {
        throw new Error("continuation failed");
      },
    });

    now = new Date("2026-05-15T00:00:01.000Z");
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.get("failed-sleep")?.status).toBe("failed");
    expect(manager.cancel("failed-sleep")).toBe(false);
    expect(manager.get("failed-sleep")?.status).toBe("failed");
    expect(manager.get("failed-sleep")?.lastError).toBe("continuation failed");
    manager.stop();
  });
});
