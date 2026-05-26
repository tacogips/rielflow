import { isJsonObject } from "../shared/json";
import {
  eventConfigError as error,
  isNonEmptyString,
} from "./validation-utils";
import type {
  EventBinding,
  EventConfigValidationIssue,
  EventTaskPlanningPolicy,
} from "./types";

export function validateTaskPlanning(
  binding: EventBinding,
  issues: EventConfigValidationIssue[],
): void {
  const policy = binding.taskPlanning;
  if (policy === undefined) {
    return;
  }
  const base = `bindings.${binding.id}.taskPlanning`;
  if (!isJsonObject(policy as unknown)) {
    issues.push(error(base, "taskPlanning must be an object when set"));
    return;
  }

  validateRequiredInput(policy.requiredInput, `${base}.requiredInput`, issues);
  if (
    policy.planTemplate !== undefined &&
    !isNonEmptyString(policy.planTemplate)
  ) {
    issues.push(
      error(`${base}.planTemplate`, "planTemplate must be non-empty"),
    );
  }
  if (
    policy.clarificationTemplate !== undefined &&
    !isNonEmptyString(policy.clarificationTemplate)
  ) {
    issues.push(
      error(
        `${base}.clarificationTemplate`,
        "clarificationTemplate must be non-empty",
      ),
    );
  }
}

function validateRequiredInput(
  requiredInput: EventTaskPlanningPolicy["requiredInput"],
  base: string,
  issues: EventConfigValidationIssue[],
): void {
  if (requiredInput === undefined) {
    return;
  }
  if (!Array.isArray(requiredInput)) {
    issues.push(error(base, "requiredInput must be an array"));
    return;
  }
  for (const [index, entry] of requiredInput.entries()) {
    const path = `${base}[${String(index)}]`;
    if (!isJsonObject(entry as unknown)) {
      issues.push(error(path, "required input entry must be an object"));
      continue;
    }
    if (!isNonEmptyString(entry.path)) {
      issues.push(error(`${path}.path`, "path is required"));
    }
    if (entry.label !== undefined && !isNonEmptyString(entry.label)) {
      issues.push(error(`${path}.label`, "label must be non-empty"));
    }
    if (entry.question !== undefined && !isNonEmptyString(entry.question)) {
      issues.push(error(`${path}.question`, "question must be non-empty"));
    }
  }
}
