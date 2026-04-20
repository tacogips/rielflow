import { createHash } from "node:crypto";
import { isJsonObject } from "../../shared/json";
import type { EventSourceAdapter, EventSourceHandle } from "../source-adapter";
import type {
  CronSourceConfig,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "../types";

function isCronSource(source: EventSourceConfig): source is CronSourceConfig {
  return source.kind === "cron";
}

function hashDedupeKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let value = min; value <= max; value += 1) {
        values.add(value);
      }
      continue;
    }
    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      if (Number.isInteger(step) && step > 0) {
        for (let value = min; value <= max; value += step) {
          values.add(value);
        }
      }
      continue;
    }
    const numeric = Number(part);
    if (Number.isInteger(numeric) && numeric >= min && numeric <= max) {
      values.add(numeric);
    }
  }
  return values;
}

function parseSchedule(schedule: string): {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly days: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly weekdays: ReadonlySet<number>;
} {
  const fields = schedule.trim().split(/\s+/);
  return {
    minutes: parseCronField(fields[0] ?? "*", 0, 59),
    hours: parseCronField(fields[1] ?? "*", 0, 23),
    days: parseCronField(fields[2] ?? "*", 1, 31),
    months: parseCronField(fields[3] ?? "*", 1, 12),
    weekdays: parseCronField(fields[4] ?? "*", 0, 6),
  };
}

function dateMatchesSchedule(
  date: Date,
  schedule: ReturnType<typeof parseSchedule>,
): boolean {
  return (
    schedule.minutes.has(date.getUTCMinutes()) &&
    schedule.hours.has(date.getUTCHours()) &&
    schedule.days.has(date.getUTCDate()) &&
    schedule.months.has(date.getUTCMonth() + 1) &&
    schedule.weekdays.has(date.getUTCDay())
  );
}

export function computeNextCronFireTime(schedule: string, after: Date): Date {
  const parsed = parseSchedule(schedule);
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let attempt = 0; attempt < 366 * 24 * 60; attempt += 1) {
    if (dateMatchesSchedule(cursor, parsed)) {
      return cursor;
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error("cron schedule did not match within one year");
}

function buildCronEnvelope(input: {
  readonly source: CronSourceConfig;
  readonly scheduledAt: string;
  readonly firedAt: string;
  readonly receivedAt: string;
}): ExternalEventEnvelope {
  const dedupeMaterial = [input.source.id, "cron.tick", input.scheduledAt].join(
    ":",
  );
  return {
    sourceId: input.source.id,
    eventId: `${input.source.id}:${input.scheduledAt}`,
    provider: "cron",
    eventType: "cron.tick",
    occurredAt: input.scheduledAt,
    receivedAt: input.receivedAt,
    dedupeKey: hashDedupeKey(dedupeMaterial),
    input: {
      scheduleId: input.source.id,
      scheduledAt: input.scheduledAt,
      firedAt: input.firedAt,
      timezone: input.source.timezone,
    },
  };
}

export function createCronEventSourceAdapter(): EventSourceAdapter {
  return {
    kind: "cron",
    capabilities: {
      eventTypes: ["cron.tick"],
      supportsStart: true,
      webhook: false,
    },
    async start(input): Promise<EventSourceHandle> {
      if (!isCronSource(input.source)) {
        throw new Error("cron adapter requires a cron source");
      }
      const source = input.source;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const scheduleNext = (): void => {
        if (stopped) {
          return;
        }
        const now = input.now();
        const scheduled = computeNextCronFireTime(source.schedule, now);
        const waitMs = Math.max(0, scheduled.getTime() - now.getTime());
        timer = setTimeout(() => {
          const firedAt = input.now().toISOString();
          void input
            .dispatch(
              buildCronEnvelope({
                source,
                scheduledAt: scheduled.toISOString(),
                firedAt,
                receivedAt: firedAt,
              }),
            )
            .finally(scheduleNext);
        }, waitMs);
      };
      const stop = (): void => {
        stopped = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      };
      input.signal.addEventListener("abort", stop, { once: true });
      scheduleNext();
      return {
        sourceId: input.source.id,
        stop: async () => {
          stop();
        },
      };
    },
    async normalize(raw): Promise<ExternalEventEnvelope> {
      if (!isJsonObject(raw.body)) {
        throw new Error("cron raw event body must be a JSON object");
      }
      const scheduledAt =
        typeof raw.body["scheduledAt"] === "string"
          ? raw.body["scheduledAt"]
          : raw.receivedAt;
      return {
        sourceId: raw.sourceId,
        eventId:
          typeof raw.body["eventId"] === "string"
            ? raw.body["eventId"]
            : `${raw.sourceId}:${scheduledAt}`,
        provider: "cron",
        eventType: "cron.tick",
        occurredAt: scheduledAt,
        receivedAt: raw.receivedAt,
        dedupeKey:
          typeof raw.body["dedupeKey"] === "string"
            ? raw.body["dedupeKey"]
            : hashDedupeKey(`${raw.sourceId}:cron.tick:${scheduledAt}`),
        input: {
          scheduleId: raw.sourceId,
          scheduledAt,
          firedAt:
            typeof raw.body["firedAt"] === "string"
              ? raw.body["firedAt"]
              : raw.receivedAt,
          timezone:
            typeof raw.body["timezone"] === "string"
              ? raw.body["timezone"]
              : "UTC",
        },
        ...(raw.rawRef === undefined ? {} : { rawRef: raw.rawRef }),
      };
    },
  };
}
