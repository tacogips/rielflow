import { eventConfigError as error } from "./validation-utils";
import type { EventBinding, EventConfigValidationIssue } from "./types";

export function validateScheduleRegistrationBinding(
  binding: EventBinding,
  workflowNames: ReadonlySet<string>,
  issues: EventConfigValidationIssue[],
): void {
  const execution = binding.execution;
  if (execution?.mode !== "schedule-registration") {
    return;
  }
  const pathPrefix = `bindings.${binding.id}.execution`;
  const resolverWorkflowName = execution.resolverWorkflowName;
  if (
    typeof resolverWorkflowName !== "string" ||
    resolverWorkflowName.trim().length === 0
  ) {
    issues.push(
      error(
        `${pathPrefix}.resolverWorkflowName`,
        "resolverWorkflowName is required when execution.mode is schedule-registration",
      ),
    );
  } else if (!workflowNames.has(resolverWorkflowName.trim())) {
    issues.push(
      error(
        `${pathPrefix}.resolverWorkflowName`,
        `unknown workflow '${resolverWorkflowName.trim()}'`,
      ),
    );
  }
  if (
    typeof execution.resolverNodeId !== "string" ||
    execution.resolverNodeId.trim().length === 0
  ) {
    issues.push(
      error(
        `${pathPrefix}.resolverNodeId`,
        "resolverNodeId is required when execution.mode is schedule-registration",
      ),
    );
  }
  if (execution.inputPath !== undefined) {
    issues.push(
      error(
        `${pathPrefix}.inputPath`,
        "schedule-registration uses binding inputMapping for resolver input and timezone-relevant values; remove execution.inputPath",
      ),
    );
  }
  if (execution.timezonePath !== undefined) {
    issues.push(
      error(
        `${pathPrefix}.timezonePath`,
        "schedule-registration uses binding inputMapping for resolver input and timezone-relevant values; remove execution.timezonePath",
      ),
    );
  }
  if (
    execution.minConfidence !== undefined &&
    (typeof execution.minConfidence !== "number" ||
      execution.minConfidence < 0 ||
      execution.minConfidence > 1)
  ) {
    issues.push(
      error(
        `${pathPrefix}.minConfidence`,
        "minConfidence must be a number in [0, 1] when set",
      ),
    );
  }
}
