import { isJsonObject } from "../shared/json";
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

function readPath(
  value: Readonly<Record<string, unknown>>,
  path: string,
): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!isJsonObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
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

function renderTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    return values[String(key)] ?? "";
  });
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
    .filter((entry) => !isPresent(readPath(input.workflowInput, entry.path)))
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
          : renderTemplate(policy.clarificationTemplate, {
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
        : renderTemplate(policy.planTemplate, {
            workflowName: input.binding.workflowName ?? "selected workflow",
          }),
  };
}
