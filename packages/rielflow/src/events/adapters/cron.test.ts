import { afterEach, describe, expect, test, vi } from "vitest";
import {
  computeNextCronFireTime,
  createCronEventSourceAdapter,
  isValidCronSchedule,
} from "./cron";

afterEach(() => {
  vi.useRealTimers();
});

describe("cron event source adapter", () => {
  test("computes the next matching fire time without wall-clock sleeps", () => {
    expect(
      computeNextCronFireTime(
        "0 2 * * *",
        new Date("2026-04-20T01:59:00.000Z"),
      ).toISOString(),
    ).toBe("2026-04-20T02:00:00.000Z");

    expect(
      computeNextCronFireTime(
        "*/15 * * * *",
        new Date("2026-04-20T02:01:00.000Z"),
      ).toISOString(),
    ).toBe("2026-04-20T02:15:00.000Z");
  });

  test("computes fire times against the configured source timezone", () => {
    expect(
      computeNextCronFireTime(
        "0 2 * * *",
        new Date("2026-04-20T16:59:00.000Z"),
        "Asia/Tokyo",
      ).toISOString(),
    ).toBe("2026-04-20T17:00:00.000Z");
  });

  test("validates the same cron syntax that the scheduler parses", () => {
    expect(isValidCronSchedule("0-10/5 2 * * 1-5")).toBe(true);
    expect(isValidCronSchedule("60 2 * * *")).toBe(false);
    expect(isValidCronSchedule("*/0 2 * * *")).toBe(false);
    expect(isValidCronSchedule("/5 2 * * *")).toBe(false);
    expect(isValidCronSchedule("-5 2 * * *")).toBe(false);
    expect(isValidCronSchedule("5- 2 * * *")).toBe(false);
    expect(isValidCronSchedule("0-10-20 2 * * *")).toBe(false);
  });

  test("normalizes cron fixture payloads without external services", async () => {
    const adapter = createCronEventSourceAdapter();

    const envelope = await adapter.normalize({
      sourceId: "nightly-cron",
      receivedAt: "2026-04-20T02:00:01.000Z",
      body: {
        scheduledAt: "2026-04-20T02:00:00.000Z",
        firedAt: "2026-04-20T02:00:01.000Z",
        timezone: "Asia/Tokyo",
      },
    });

    expect(envelope).toMatchObject({
      sourceId: "nightly-cron",
      provider: "cron",
      eventType: "cron.tick",
      occurredAt: "2026-04-20T02:00:00.000Z",
      input: {
        scheduleId: "nightly-cron",
        scheduledAt: "2026-04-20T02:00:00.000Z",
        firedAt: "2026-04-20T02:00:01.000Z",
        timezone: "Asia/Tokyo",
      },
    });
  });

  test("keeps scheduling after a dispatch rejection", async () => {
    vi.useFakeTimers();
    const adapter = createCronEventSourceAdapter();
    const abortController = new AbortController();
    let now = new Date("2026-04-20T01:59:59.999Z");
    const dispatch = vi.fn(async () => {
      now = new Date("2026-04-20T02:00:00.000Z");
      throw new Error("dispatch failed");
    });

    const handle = await adapter.start({
      source: {
        id: "nightly-cron",
        kind: "cron",
        schedule: "* * * * *",
        timezone: "UTC",
      },
      signal: abortController.signal,
      now: () => now,
      dispatch,
    });

    now = new Date("2026-04-20T02:00:00.000Z");
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await handle.stop();
  });
});
