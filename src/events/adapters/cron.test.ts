import { describe, expect, test } from "vitest";
import { computeNextCronFireTime, createCronEventSourceAdapter } from "./cron";

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
});
