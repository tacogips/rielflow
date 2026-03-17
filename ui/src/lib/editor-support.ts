import { isJsonObject } from "../../../src/shared/json";
import type {
  SessionStatus,
  ValidationResponse,
} from "../../../src/shared/ui-contract";
import type {
  NormalizedWorkflowBundle,
  ValidationIssue,
} from "../../../src/workflow/types";
import type { EditorWorkflowBundle } from "./editor-workflow";

export function isValidWorkflowNameInput(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

export function isValidNodeIdInput(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(value);
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseJsonObject(
  text: string,
  fieldName: string,
  emptyValue: Record<string, unknown> = {},
): Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return emptyValue;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${fieldName} JSON Parse error: ${detail}`);
  }

  if (!isJsonObject(parsed)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }

  return parsed;
}

export function parseOptionalInteger(
  text: string,
  fieldName: string,
): number | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return parseRequiredPositiveInteger(trimmed, fieldName);
}

export function parseRequiredPositiveInteger(
  text: string,
  fieldName: string,
): number {
  const trimmed = text.trim();
  if (!/^[1-9][0-9]*$/.test(trimmed)) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsed;
}

export function combinedValidationIssues(
  result: ValidationResponse,
): ValidationIssue[] {
  const merged = [...(result.issues ?? []), ...(result.warnings ?? [])];
  const seen = new Set<string>();
  return merged.filter((issue) => {
    const key = `${issue.severity}:${issue.path}:${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function validationSummaryFromIssues(
  valid: boolean,
  validationIssues: readonly ValidationIssue[],
): string {
  const warningCount = validationIssues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const errorCount = validationIssues.length - warningCount;
  return valid
    ? `Validation passed${warningCount > 0 ? ` with ${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}.`
    : `Validation returned ${errorCount} error${errorCount === 1 ? "" : "s"} and ${warningCount} warning${warningCount === 1 ? "" : "s"}.`;
}

export function workflowBundleDirty(
  savedBundle:
    | NormalizedWorkflowBundle
    | EditorWorkflowBundle
    | null
    | undefined,
  editableBundle: EditorWorkflowBundle | null | undefined,
): boolean {
  return (
    savedBundle !== null &&
    savedBundle !== undefined &&
    editableBundle !== null &&
    editableBundle !== undefined &&
    JSON.stringify(savedBundle) !== JSON.stringify(editableBundle)
  );
}

export function sessionStatusClass(status: SessionStatus): string {
  switch (status) {
    case "completed":
      return "ok";
    case "failed":
    case "cancelled":
      return "error";
    case "paused":
      return "warning";
    default:
      return "running";
  }
}

export function canCancelWorkflowExecution(
  status: SessionStatus | null | undefined,
): boolean {
  return (
    status !== null &&
    status !== undefined &&
    status !== "completed" &&
    status !== "failed" &&
    status !== "cancelled"
  );
}
