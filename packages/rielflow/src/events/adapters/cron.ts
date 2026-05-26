import { createHash } from "node:crypto";
import { isJsonObject } from "../../shared/json";
import type { EventSourceAdapter, EventSourceHandle } from "../source-adapter";
import { createScheduledEventManager } from "../scheduled-event-manager";
import type {
  CronSourceConfig,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "../types";

const CRON_LOOKAHEAD_MINUTES = 366 * 24 * 60;
const WEEKDAY_VALUES = new Map([
  ["Sun", 0],
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6],
]);
const CRON_NUMBER_PATTERN = /^\d+$/;

interface ParsedCronSchedule {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly days: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly weekdays: ReadonlySet<number>;
}

interface CronDateParts {
  readonly minute: number;
  readonly hour: number;
  readonly day: number;
  readonly month: number;
  readonly weekday: number;
}

interface CronDatePartsReader {
  read(date: Date): CronDateParts;
}

function isCronSource(source: EventSourceConfig): source is CronSourceConfig {
  return source.kind === "cron";
}

function hashDedupeKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseCronNumber(value: string, min: number, max: number): number {
  if (!CRON_NUMBER_PATTERN.test(value)) {
    throw new Error(`cron value '${value}' must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`cron value '${value}' must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseCronStep(value: string | undefined): number {
  if (value === undefined) {
    return 1;
  }
  if (!CRON_NUMBER_PATTERN.test(value)) {
    throw new Error(`cron step '${value}' must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`cron step '${value}' must be a positive integer`);
  }
  return parsed;
}

function parseCronRange(
  value: string,
  min: number,
  max: number,
): { readonly start: number; readonly end: number } {
  if (value === "*") {
    return { start: min, end: max };
  }
  const rangeParts = value.split("-");
  if (rangeParts.length === 1) {
    const exact = parseCronNumber(value, min, max);
    return { start: exact, end: exact };
  }
  if (rangeParts.length !== 2) {
    throw new Error(`cron range '${value}' is invalid`);
  }
  const start = parseCronNumber(rangeParts[0] ?? "", min, max);
  const end = parseCronNumber(rangeParts[1] ?? "", min, max);
  if (start > end) {
    throw new Error(`cron range '${value}' must be ascending`);
  }
  return { start, end };
}

function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      throw new Error("cron fields must not contain empty segments");
    }
    const stepParts = trimmed.split("/");
    if (stepParts.length > 2) {
      throw new Error(`cron segment '${trimmed}' has too many step markers`);
    }
    const range = parseCronRange(stepParts[0] ?? "", min, max);
    const step = parseCronStep(stepParts[1]);
    for (let value = range.start; value <= range.end; value += step) {
      values.add(value);
    }
  }
  if (values.size === 0) {
    throw new Error(`cron field '${field}' did not select any values`);
  }
  return values;
}

export function parseCronSchedule(schedule: string): ParsedCronSchedule {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("cron schedule must have exactly five fields");
  }
  return {
    minutes: parseCronField(fields[0] ?? "", 0, 59),
    hours: parseCronField(fields[1] ?? "", 0, 23),
    days: parseCronField(fields[2] ?? "", 1, 31),
    months: parseCronField(fields[3] ?? "", 1, 12),
    weekdays: parseCronField(fields[4] ?? "", 0, 6),
  };
}

export function isValidCronSchedule(schedule: string): boolean {
  try {
    parseCronSchedule(schedule);
    return true;
  } catch {
    return false;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function readDatePart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) {
    throw new Error(`failed to read ${type} from cron timezone formatter`);
  }
  return value;
}

function createCronDatePartsReader(timeZone: string): CronDatePartsReader {
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return {
    read(date: Date): CronDateParts {
      const parts = formatter.formatToParts(date);
      const weekdayLabel = readDatePart(parts, "weekday");
      const weekday = WEEKDAY_VALUES.get(weekdayLabel);
      if (weekday === undefined) {
        throw new Error(`unsupported cron weekday label '${weekdayLabel}'`);
      }
      return {
        minute: Number(readDatePart(parts, "minute")),
        hour: Number(readDatePart(parts, "hour")),
        day: Number(readDatePart(parts, "day")),
        month: Number(readDatePart(parts, "month")),
        weekday,
      };
    },
  };
}

function dateMatchesSchedule(
  date: Date,
  schedule: ParsedCronSchedule,
  datePartsReader: CronDatePartsReader,
): boolean {
  const parts = datePartsReader.read(date);
  return (
    schedule.minutes.has(parts.minute) &&
    schedule.hours.has(parts.hour) &&
    schedule.days.has(parts.day) &&
    schedule.months.has(parts.month) &&
    schedule.weekdays.has(parts.weekday)
  );
}

export function computeNextCronFireTime(
  schedule: string,
  after: Date,
  timeZone = "UTC",
): Date {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`invalid cron timezone '${timeZone}'`);
  }
  const parsed = parseCronSchedule(schedule);
  const datePartsReader = createCronDatePartsReader(timeZone);
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let attempt = 0; attempt < CRON_LOOKAHEAD_MINUTES; attempt += 1) {
    if (dateMatchesSchedule(cursor, parsed, datePartsReader)) {
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
      const manager =
        input.scheduledEventManager ??
        createScheduledEventManager({ now: input.now });
      const ownsManager = input.scheduledEventManager === undefined;
      let stopped = false;
      let scheduledEventId: string | undefined;
      const scheduleNext = (): void => {
        if (stopped) {
          return;
        }
        const now = input.now();
        const scheduled = computeNextCronFireTime(
          source.schedule,
          now,
          source.timezone,
        );
        scheduledEventId = `cron:${source.id}`;
        manager.register({
          id: scheduledEventId,
          kind: "cron",
          dueAt: scheduled,
          dedupeKey: hashDedupeKey(
            [source.id, "cron.tick", scheduled.toISOString()].join(":"),
          ),
          payload: {
            sourceId: source.id,
            scheduledAt: scheduled.toISOString(),
          },
          fire: async () => {
            const firedAt = input.now().toISOString();
            try {
              await input.dispatch(
                buildCronEnvelope({
                  source,
                  scheduledAt: scheduled.toISOString(),
                  firedAt,
                  receivedAt: firedAt,
                }),
              );
            } catch {
              // Keep cron sources alive even if one dispatch path fails.
            } finally {
              scheduleNext();
            }
          },
        });
      };
      const stop = (): void => {
        stopped = true;
        if (scheduledEventId !== undefined) {
          manager.cancel(scheduledEventId);
        }
        if (ownsManager) {
          manager.stop();
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
