
const PART_TYPES = [
  "year",
  "month",
  "day",
  "hour",
  "minute",
  "second",
] as const;

type TimePartType = (typeof PART_TYPES)[number];

type TimeParts = Readonly<Record<TimePartType, string>>;

function requiredValue(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function parseScheduledAt(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`scheduledAt must be an ISO timestamp: ${value}`);
  }
  return date;
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function readTimeParts(date: Date, timeZone: string): TimeParts {
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const entries = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => PART_TYPES.includes(part.type as TimePartType))
      .map((part) => [part.type, part.value]),
  ) as Partial<TimeParts>;

  for (const type of PART_TYPES) {
    if (entries[type] === undefined) {
      throw new Error(`failed to read ${type} for timezone ${timeZone}`);
    }
  }
  return entries as TimeParts;
}

async function main(): Promise<void> {
  const scheduledAtRaw = requiredValue(process.argv[2], "scheduledAt");
  const timeZone = requiredValue(process.argv[3], "timezone");
  const scheduledAt = parseScheduledAt(scheduledAtRaw);
  const intervalMinutes = parsePositiveIntegerEnv(
    "RIEL_TIME_SIGNAL_INTERVAL_MINUTES",
    5,
  );
  const parts = readTimeParts(scheduledAt, timeZone);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const shouldAnnounce = second === 0 && minute % intervalMinutes === 0;
  const localTime = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  const replyText = shouldAnnounce
    ? `時報です。${timeZone} の現在時刻は ${localTime} です。`
    : "";
  process.stdout.write(
    `${JSON.stringify({
      when: {
        always: true,
        should_announce: shouldAnnounce,
      },
      payload: {
        shouldAnnounce,
        scheduledAt: scheduledAt.toISOString(),
        timezone: timeZone,
        intervalMinutes,
        localTime,
        replyText,
      },
    })}\n`,
  );
}

await main();
