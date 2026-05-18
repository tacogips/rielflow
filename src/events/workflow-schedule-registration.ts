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
        const due = new Date(decision.schedule.dueAt);
        if (!Number.isFinite(due.getTime())) {
          return runtimeClarification(
            ["time"],
            "When should this workflow run?",
          );
        }
        return {
          status: "ready",
          decision,
          nextDueAt: due.toISOString(),
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
