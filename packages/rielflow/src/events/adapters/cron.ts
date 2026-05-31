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
  readonly seconds: ReadonlySet<number>;
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly days: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly weekdays: ReadonlySet<number>;
  readonly hasExplicitSeconds: boolean;
}

interface CronDateParts {
  readonly second: number;
  readonly minute: number;
  readonly hour: number;
  readonly day: number;
  readonly year: number;
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

function exactCronField(value: number): ReadonlySet<number> {
  return new Set([value]);
}

export function parseCronSchedule(schedule: string): ParsedCronSchedule {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    throw new Error("cron schedule must have exactly five or six fields");
  }
  const hasExplicitSeconds = fields.length === 6;
  const offset = hasExplicitSeconds ? 1 : 0;
  return {
    seconds: hasExplicitSeconds
      ? parseCronField(fields[0] ?? "", 0, 59)
      : exactCronField(0),
    minutes: parseCronField(fields[offset] ?? "", 0, 59),
    hours: parseCronField(fields[offset + 1] ?? "", 0, 23),
    days: parseCronField(fields[offset + 2] ?? "", 1, 31),
    months: parseCronField(fields[offset + 3] ?? "", 1, 12),
    weekdays: parseCronField(fields[offset + 4] ?? "", 0, 6),
    hasExplicitSeconds,
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
    second: "2-digit",
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
        second: Number(readDatePart(parts, "second")),
        minute: Number(readDatePart(parts, "minute")),
        hour: Number(readDatePart(parts, "hour")),
        day: Number(readDatePart(parts, "day")),
        year: Number(readDatePart(parts, "year")),
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
    schedule.seconds.has(parts.second) &&
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
  if (parsed.hasExplicitSeconds) {
    cursor.setUTCMilliseconds(0);
    cursor.setUTCSeconds(cursor.getUTCSeconds() + 1);
  } else {
    cursor.setUTCSeconds(0, 0);
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  const maxAttempts = parsed.hasExplicitSeconds
    ? CRON_LOOKAHEAD_MINUTES * 60
    : CRON_LOOKAHEAD_MINUTES;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (dateMatchesSchedule(cursor, parsed, datePartsReader)) {
      return cursor;
    }
    if (parsed.hasExplicitSeconds) {
      cursor.setUTCSeconds(cursor.getUTCSeconds() + 1);
    } else {
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    }
  }
  throw new Error("cron schedule did not match within one year");
}

function cronReplyTarget(input: {
  readonly source: CronSourceConfig;
  readonly fallbackEventId: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): CronSourceConfig["replyTarget"] {
  const target = input.source.replyTarget;
  if (target === undefined) {
    return undefined;
  }
  const envConversationId =
    target.conversationIdEnv === undefined
      ? undefined
      : input.env?.[target.conversationIdEnv];
  const conversationId = envConversationId ?? target.conversationId;
  if (conversationId === undefined || conversationId.length === 0) {
    return undefined;
  }
  return {
    sourceId: target.sourceId,
    provider: target.provider,
    conversationId,
    eventId: target.eventId ?? input.fallbackEventId,
    ...(target.threadId === undefined ? {} : { threadId: target.threadId }),
    ...(target.actorId === undefined ? {} : { actorId: target.actorId }),
  };
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function formatCronLocalDateTime(
  scheduledAt: string,
  timeZone: string,
): string {
  const parsed = new Date(scheduledAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `cron scheduledAt must be an ISO timestamp: ${scheduledAt}`,
    );
  }
  const parts = createCronDatePartsReader(timeZone).read(parsed);
  const dateText = [
    String(parts.year),
    padDatePart(parts.month),
    padDatePart(parts.day),
  ].join("-");
  return `${dateText} ${padDatePart(parts.hour)}:${padDatePart(parts.minute)}`;
}

function buildCronEnvelope(input: {
  readonly source: CronSourceConfig;
  readonly scheduledAt: string;
  readonly firedAt: string;
  readonly receivedAt: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): ExternalEventEnvelope {
  const eventId = `${input.source.id}:${input.scheduledAt}`;
  const replyTarget = cronReplyTarget({
    source: input.source,
    fallbackEventId: eventId,
    ...(input.env === undefined ? {} : { env: input.env }),
  });
  const dedupeMaterial = [input.source.id, "cron.tick", input.scheduledAt].join(
    ":",
  );
  return {
    sourceId: input.source.id,
    eventId,
    provider: "cron",
    eventType: "cron.tick",
    occurredAt: input.scheduledAt,
    receivedAt: input.receivedAt,
    dedupeKey: hashDedupeKey(dedupeMaterial),
    input: {
      scheduleId: input.source.id,
      scheduledAt: input.scheduledAt,
      scheduledLocalTime: formatCronLocalDateTime(
        input.scheduledAt,
        input.source.timezone,
      ),
      firedAt: input.firedAt,
      timezone: input.source.timezone,
      ...(replyTarget === undefined ? {} : { replyTarget }),
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
                  ...(input.env === undefined ? {} : { env: input.env }),
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
      const timezone =
        typeof raw.body["timezone"] === "string" ? raw.body["timezone"] : "UTC";
      const eventId =
        typeof raw.body["eventId"] === "string"
          ? raw.body["eventId"]
          : `${raw.sourceId}:${scheduledAt}`;
      const replyTarget =
        raw.source !== undefined && isCronSource(raw.source)
          ? cronReplyTarget({
              source: raw.source,
              fallbackEventId: eventId,
              ...(raw.env === undefined ? {} : { env: raw.env }),
            })
          : undefined;
      return {
        sourceId: raw.sourceId,
        eventId,
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
          scheduledLocalTime: formatCronLocalDateTime(scheduledAt, timezone),
          firedAt:
            typeof raw.body["firedAt"] === "string"
              ? raw.body["firedAt"]
              : raw.receivedAt,
          timezone,
          ...(replyTarget === undefined ? {} : { replyTarget }),
        },
        ...(raw.rawRef === undefined ? {} : { rawRef: raw.rawRef }),
      };
    },
  };
}
