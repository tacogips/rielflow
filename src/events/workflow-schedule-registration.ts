import { isJsonObject, type JsonObject } from "../shared/json";
import type { DivedraOptions } from "../lib";
import { buildWorkflowUsageCatalog } from "../workflow/usage";
import {
  computeNextCronFireTime,
  isValidCronSchedule,
  isValidTimeZone,
} from "./adapters/cron";
import type {
  WorkflowScheduleCandidate,
  WorkflowScheduleClarificationDecision,
  WorkflowScheduleReadyDecision,
  WorkflowScheduleRecord,
  WorkflowScheduleRegistrationDecision,
  WorkflowScheduleRefusalDecision,
} from "./types";

export interface WorkflowScheduleRegistrationValidationInput
  extends DivedraOptions {
  readonly output: unknown;
  readonly minConfidence?: number;
  readonly hasSafeReplyDestination: boolean;
  readonly now?: Date;
}

export type WorkflowScheduleRegistrationValidationResult =
  | {
      readonly status: "ready";
      readonly decision: WorkflowScheduleReadyDecision;
      readonly nextDueAt: string;
      readonly workflowSource?: WorkflowScheduleRecord["workflowSource"];
    }
  | {
      readonly status: "needs-clarification";
      readonly decision: WorkflowScheduleClarificationDecision;
    }
  | {
      readonly status: "refused";
      readonly decision: WorkflowScheduleRefusalDecision;
    };

export interface WorkflowScheduleRegistrationValidator {
  validate(
    input: WorkflowScheduleRegistrationValidationInput,
  ): Promise<WorkflowScheduleRegistrationValidationResult>;
}

interface OffsetLessDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

interface TimeZoneDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const EXPLICIT_TIMEZONE_PATTERN = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const OFFSET_LESS_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function unwrapDecision(output: unknown): unknown {
  if (isJsonObject(output) && isJsonObject(output["payload"])) {
    return output["payload"];
  }
  return output;
}

function stringField(object: JsonObject, field: string): string | undefined {
  const value = object[field];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberField(object: JsonObject, field: string): number | undefined {
  const value = object[field];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringArrayField(
  object: JsonObject,
  field: string,
): readonly string[] {
  const value = object[field];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function candidatesField(
  object: JsonObject,
): readonly WorkflowScheduleCandidate[] | undefined {
  const candidates = object["candidates"];
  if (!Array.isArray(candidates)) {
    return undefined;
  }
  return candidates.filter(isJsonObject).flatMap((entry) => {
    const workflowName = stringField(entry, "workflowName");
    if (workflowName === undefined) {
      return [];
    }
    const description = stringField(entry, "description");
    const confidence = numberField(entry, "confidence");
    return [
      {
        workflowName,
        ...(description === undefined ? {} : { description }),
        ...(confidence === undefined ? {} : { confidence }),
      },
    ];
  });
}

function refusal(reason: string): WorkflowScheduleRegistrationValidationResult {
  return {
    status: "refused",
    decision: {
      status: "refused",
      reason,
      message: reason,
    },
  };
}

function clarification(
  missing: readonly string[],
  question: string,
  candidates?: readonly WorkflowScheduleCandidate[],
  hasSafeReplyDestination = true,
): WorkflowScheduleRegistrationValidationResult {
  if (!hasSafeReplyDestination) {
    return refusal(
      "cannot ask schedule clarification without a safe reply destination",
    );
  }
  return {
    status: "needs-clarification",
    decision: {
      status: "needs-clarification",
      missing,
      question,
      ...(candidates === undefined ? {} : { candidates }),
    },
  };
}

function parseDecision(
  output: unknown,
): WorkflowScheduleRegistrationDecision | undefined {
  const value = unwrapDecision(output);
  if (!isJsonObject(value)) {
    return undefined;
  }
  const status = value["status"];
  if (status === "needs-clarification") {
    const question = stringField(value, "question");
    const missing = stringArrayField(value, "missing");
    const candidates = candidatesField(value);
    if (question === undefined || missing.length === 0) {
      return undefined;
    }
    return {
      status,
      missing,
      question,
      ...(candidates === undefined ? {} : { candidates }),
    };
  }
  if (status === "refused") {
    const reason =
      stringField(value, "reason") ?? stringField(value, "message");
    const message = stringField(value, "message");
    return reason === undefined
      ? undefined
      : { status, reason, ...(message === undefined ? {} : { message }) };
  }
  if (status !== "ready") {
    return undefined;
  }
  const workflowName = stringField(value, "workflowName");
  const schedule = value["schedule"];
  const workflowInput = value["workflowInput"];
  const confirmationText = stringField(value, "confirmationText");
  const confidence = numberField(value, "confidence");
  const candidates = candidatesField(value);
  if (
    workflowName === undefined ||
    !isJsonObject(schedule) ||
    !isJsonObject(workflowInput) ||
    confirmationText === undefined
  ) {
    return undefined;
  }
  const kind = schedule["kind"];
  const timezone = stringField(schedule, "timezone");
  if ((kind !== "one-time" && kind !== "recurring") || timezone === undefined) {
    return undefined;
  }
  return {
    status,
    workflowName,
    ...(confidence === undefined ? {} : { confidence }),
    ...(candidates === undefined ? {} : { candidates }),
    schedule:
      kind === "one-time"
        ? {
            kind,
            timezone,
            dueAt: stringField(schedule, "dueAt") ?? "",
          }
        : {
            kind,
            timezone,
            cron: stringField(schedule, "cron") ?? "",
            ...(stringField(schedule, "nextDueAt") === undefined
              ? {}
              : { nextDueAt: stringField(schedule, "nextDueAt") ?? "" }),
          },
    workflowInput,
    confirmationText,
  };
}

function requiredWorkflowInputFields(schema: unknown): readonly string[] {
  if (!isJsonObject(schema)) {
    return [];
  }
  const required = schema["required"];
  return Array.isArray(required)
    ? required.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function workflowSourceJson(
  source:
    | {
        readonly scope: string;
        readonly workflowRoot: string;
        readonly workflowDirectory: string;
        readonly scopeRoot?: string;
      }
    | undefined,
): JsonObject | undefined {
  if (source === undefined) {
    return undefined;
  }
  return {
    scope: source.scope,
    workflowRoot: source.workflowRoot,
    workflowDirectory: source.workflowDirectory,
    ...(source.scopeRoot === undefined ? {} : { scopeRoot: source.scopeRoot }),
  };
}

function parseOffsetLessDateTime(
  dueAt: string,
): OffsetLessDateTimeParts | undefined {
  const match = OFFSET_LESS_DATE_TIME_PATTERN.exec(dueAt.trim());
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const millisecond =
    match[7] === undefined ? 0 : Number(match[7].padEnd(3, "0"));
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day ||
    utc.getUTCHours() !== hour ||
    utc.getUTCMinutes() !== minute ||
    utc.getUTCSeconds() !== second
  ) {
    return undefined;
  }
  return { year, month, day, hour, minute, second, millisecond };
}

function readTimeZonePart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) {
    throw new Error(`failed to read ${type} from schedule timezone formatter`);
  }
  return Number(value);
}

function formatTimeZoneDateTimeParts(
  formatter: Intl.DateTimeFormat,
  date: Date,
): TimeZoneDateTimeParts {
  const parts = formatter.formatToParts(date);
  return {
    year: readTimeZonePart(parts, "year"),
    month: readTimeZonePart(parts, "month"),
    day: readTimeZonePart(parts, "day"),
    hour: readTimeZonePart(parts, "hour"),
    minute: readTimeZonePart(parts, "minute"),
    second: readTimeZonePart(parts, "second"),
  };
}

function offsetLessPartsMatch(
  expected: OffsetLessDateTimeParts,
  actual: TimeZoneDateTimeParts,
): boolean {
  return (
    expected.year === actual.year &&
    expected.month === actual.month &&
    expected.day === actual.day &&
    expected.hour === actual.hour &&
    expected.minute === actual.minute &&
    expected.second === actual.second
  );
}

function resolveOffsetLessDueAt(
  dueAt: string,
  timeZone: string,
): string | undefined {
  const parts = parseOffsetLessDateTime(dueAt);
  if (parts === undefined) {
    return undefined;
  }
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
  const wallClockUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  const matchingInstants = new Set<number>();
  for (
    let offsetMinutes = -14 * 60;
    offsetMinutes <= 14 * 60;
    offsetMinutes += 1
  ) {
    const candidateMs = wallClockUtcMs - offsetMinutes * 60_000;
    const candidate = new Date(candidateMs);
    const candidateParts = formatTimeZoneDateTimeParts(formatter, candidate);
    if (offsetLessPartsMatch(parts, candidateParts)) {
      matchingInstants.add(candidateMs);
    }
  }
  return matchingInstants.size === 1
    ? new Date([...matchingInstants][0] ?? Number.NaN).toISOString()
    : undefined;
}

function resolveOneTimeDueAt(
  dueAt: string,
  timeZone: string,
): string | undefined {
  if (EXPLICIT_TIMEZONE_PATTERN.test(dueAt.trim())) {
    const explicitInstant = new Date(dueAt);
    return Number.isFinite(explicitInstant.getTime())
      ? explicitInstant.toISOString()
      : undefined;
  }
  return resolveOffsetLessDueAt(dueAt, timeZone);
}

export function createWorkflowScheduleRegistrationValidator(): WorkflowScheduleRegistrationValidator {
  return {
    async validate(
      input,
    ): Promise<WorkflowScheduleRegistrationValidationResult> {
      const decision = parseDecision(input.output);
      if (decision === undefined) {
        return refusal(
          "schedule resolver output must be a structured decision",
        );
      }
      if (decision.status === "refused") {
        return { status: "refused", decision };
      }
      if (decision.status === "needs-clarification") {
        return input.hasSafeReplyDestination
          ? { status: "needs-clarification", decision }
          : refusal(
              "cannot ask schedule clarification without a safe reply destination",
            );
      }
      const runtimeClarification = (
        missing: readonly string[],
        question: string,
        candidates?: readonly WorkflowScheduleCandidate[],
      ): WorkflowScheduleRegistrationValidationResult =>
        clarification(
          missing,
          question,
          candidates,
          input.hasSafeReplyDestination,
        );
      if (
        input.minConfidence !== undefined &&
        decision.confidence === undefined
      ) {
        return runtimeClarification(
          ["workflow"],
          "Which workflow should I schedule?",
          decision.candidates,
        );
      }
      if (
        input.minConfidence !== undefined &&
        decision.confidence !== undefined &&
        decision.confidence < input.minConfidence
      ) {
        return runtimeClarification(
          ["workflow"],
          "Which workflow should I schedule?",
          decision.candidates,
        );
      }
      const catalog = await buildWorkflowUsageCatalog({}, input);
      if (!catalog.ok) {
        return refusal(catalog.error.message);
      }
      const exactMatches = catalog.value.workflows.filter(
        (workflow) => workflow.workflowName === decision.workflowName,
      );
      if (exactMatches.length !== 1) {
        return runtimeClarification(
          ["workflow"],
          "Which workflow should I schedule?",
          decision.candidates,
        );
      }
      const workflow = exactMatches[0];
      if (workflow === undefined) {
        return refusal("matched workflow disappeared during validation");
      }
      const required = requiredWorkflowInputFields(
        workflow.callable.input?.jsonSchema,
      ).filter((field) => decision.workflowInput[field] === undefined);
      if (required.length > 0) {
        return runtimeClarification(
          required.map((field) => `workflowInput.${field}`),
          `I need ${required.join(", ")} before I can schedule ${workflow.workflowName}.`,
        );
      }
      if (!isValidTimeZone(decision.schedule.timezone)) {
        return runtimeClarification(
          ["timezone"],
          "Which timezone should I use?",
        );
      }
      if (decision.schedule.kind === "one-time") {
        const nextDueAt = resolveOneTimeDueAt(
          decision.schedule.dueAt,
          decision.schedule.timezone,
        );
        if (nextDueAt === undefined) {
          return runtimeClarification(
            ["time"],
            "When should this workflow run?",
          );
        }
        return {
          status: "ready",
          decision,
          nextDueAt,
          ...(workflowSourceJson(workflow.source) === undefined
            ? {}
            : { workflowSource: workflowSourceJson(workflow.source) }),
        };
      }
      if (!isValidCronSchedule(decision.schedule.cron)) {
        return runtimeClarification(
          ["recurrence"],
          "What recurring schedule should I use?",
        );
      }
      const after = input.now ?? new Date();
      const nextDueAt = computeNextCronFireTime(
        decision.schedule.cron,
        after,
        decision.schedule.timezone,
      ).toISOString();
      return {
        status: "ready",
        decision,
        nextDueAt,
        ...(workflowSourceJson(workflow.source) === undefined
          ? {}
          : { workflowSource: workflowSourceJson(workflow.source) }),
      };
    },
  };
}
