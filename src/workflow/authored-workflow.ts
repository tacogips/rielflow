import type { ValidationIssue, WorkflowJson } from "./types";

/** Rejection text for any authored top-level `workflow.json` field outside the step-addressed schema. */
export const REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE =
  "is not part of the step-addressed workflow schema";

/**
 * Rejection text for top-level `workflow.edges` on step-addressed bundles (local
 * routing belongs on `workflow.steps[].transitions`).
 */
export const REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE =
  "is not part of the step-addressed workflow schema; local step-to-step routing must be authored on workflow.steps[].transitions";

/**
 * Authored `workflow.json` only: explicit enumeration of removed top-level keys that
 * must fail validation. This is intentional schema-boundary guarding (clear paths and
 * stable rejection messages), not a runtime compatibility layer.
 */
export const REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS = [
  "managerRuntimeId",
  "managerNodeId",
  "entryNodeId",
  "subWorkflows",
] as const;

/**
 * Additional removed top-level fields for step-addressed bundles; same explicit
 * schema-guard rationale as {@link REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS}.
 */
export const REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS = [
  "workflowCalls",
  "subWorkflowConversations",
  "edges",
  "loops",
  "branching",
] as const;

/**
 * Full set of disallowed top-level `workflow.json` keys when the bundle is
 * treated as step-addressed (`entryStepId` with `nodes` and `steps`), including
 * {@link REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS}.
 */
export const REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS = [
  ...REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS,
  ...REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS,
] as const;

export type RejectedAuthoredStepAddressedTopLevelField =
  (typeof REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeIssue(path: string, message: string): ValidationIssue {
  return { severity: "error", path, message };
}

function getAuthoredTopLevelFieldMessage(
  fieldName: RejectedAuthoredStepAddressedTopLevelField,
): string {
  return fieldName === "edges"
    ? REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE
    : REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE;
}

export function makeStepAddressedAuthoredWorkflowFieldIssue(
  fieldName: RejectedAuthoredStepAddressedTopLevelField,
): ValidationIssue {
  return makeIssue(
    `workflow.${fieldName}`,
    getAuthoredTopLevelFieldMessage(fieldName),
  );
}

export function collectStepAddressedAuthoredWorkflowFieldIssues(
  workflow: unknown,
): readonly ValidationIssue[] {
  if (!isRecord(workflow)) {
    return [];
  }

  return REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS.flatMap(
    (fieldName) =>
      workflow[fieldName] === undefined
        ? []
        : [makeStepAddressedAuthoredWorkflowFieldIssue(fieldName)],
  );
}

/**
 * Persist only authored workflow fields. `hasManagerNode` is a normalized runtime flag.
 * If a caller passes a materialized runtime node list instead of authored registry entries,
 * drop redundant `kind` when that node also carries `role`.
 */
export function stripNormalizedWorkflowFieldsForPersistence(
  workflow: unknown,
): unknown {
  if (!isRecord(workflow)) {
    return workflow;
  }

  const workflowRecord = { ...workflow };
  delete workflowRecord["hasManagerNode"];

  const nodesRaw = workflowRecord["nodes"];
  if (!Array.isArray(nodesRaw)) {
    return workflowRecord;
  }

  workflowRecord["nodes"] = nodesRaw.map((node) => {
    if (!isRecord(node)) {
      return node;
    }

    const authoredNode = { ...node };
    if (authoredNode["role"] !== undefined) {
      delete authoredNode["kind"];
    }
    return authoredNode;
  });

  return workflowRecord;
}

export function isNormalizedStepAddressedWorkflow(
  value: unknown,
): value is WorkflowJson {
  return (
    isRecord(value) &&
    Array.isArray(value["steps"]) &&
    Array.isArray(value["nodeRegistry"])
  );
}
