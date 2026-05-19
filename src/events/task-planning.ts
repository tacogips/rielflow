import {
  renderNamedTemplate,
  resolveEventPathReference,
} from "divedra-events/path-resolution";
import type { EventBinding } from "./types";

export type EventTaskPlanningDecision =
  | {
      readonly status: "ready";
      readonly replyKind: "plan-or-question";
      readonly text: string;
    }
  | {
      readonly status: "needs-clarification";
      readonly replyKind: "clarification";
      readonly text: string;
      readonly missing: readonly string[];
    };

interface MissingRequiredInput {
  readonly label: string;
  readonly question: string;
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

export function resolveEventTaskPlanningDecision(input: {
  readonly binding: EventBinding;
  readonly workflowInput: Readonly<Record<string, unknown>>;
}): EventTaskPlanningDecision | null {
  const policy = input.binding.taskPlanning;
  if (policy?.enabled === false) {
    return null;
  }
  const required = policy?.requiredInput ?? [];
  const missing: readonly MissingRequiredInput[] = required
    .filter(
      (entry) =>
        !isPresent(
          resolveEventPathReference({
            expression: `workflowInput.${entry.path}`,
            roots: { workflowInput: input.workflowInput },
            allowedRoots: ["workflowInput"],
            trimExpression: false,
          }),
        ),
    )
    .map((entry) => {
      const label = entry.label ?? entry.path;
      return {
        label,
        question: entry.question ?? label,
      };
    });
  if (missing.length > 0) {
    const labels = missing.map((entry) => entry.label);
    const questions = missing.map((entry) => entry.question);
    const defaultQuestion =
      missing.length === 1
        ? (questions[0] ?? "I need more detail before starting.")
        : `I need these details before starting: ${questions.join(" ")}`;
    return {
      status: "needs-clarification",
      replyKind: "clarification",
      missing: labels,
      text:
        policy?.clarificationTemplate === undefined
          ? defaultQuestion
          : renderNamedTemplate(policy.clarificationTemplate, {
              missing: labels.join(", "),
              questions: questions.join(" "),
              workflowName: input.binding.workflowName ?? "selected workflow",
            }),
    };
  }
  return {
    status: "ready",
    replyKind: "plan-or-question",
    text:
      policy?.planTemplate === undefined
        ? `Plan: run ${input.binding.workflowName ?? "the selected workflow"} for this request.`
        : renderNamedTemplate(policy.planTemplate, {
            workflowName: input.binding.workflowName ?? "selected workflow",
          }),
  };
}
