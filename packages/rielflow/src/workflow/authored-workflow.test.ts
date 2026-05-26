import { describe, expect, test } from "vitest";
import {
  REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE,
  REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
  collectStepAddressedAuthoredWorkflowFieldIssues,
  makeStepAddressedAuthoredWorkflowFieldIssue,
  stripNormalizedWorkflowFieldsForPersistence,
} from "./authored-workflow";

describe("collectStepAddressedAuthoredWorkflowFieldIssues", () => {
  test("maps every removed top-level field through the shared issue builder", () => {
    for (const fieldName of REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS) {
      expect(
        collectStepAddressedAuthoredWorkflowFieldIssues({
          workflowId: "demo",
          [fieldName]: fieldName === "edges" ? [] : "legacy",
        }),
      ).toContainEqual(makeStepAddressedAuthoredWorkflowFieldIssue(fieldName));
    }
  });
});

describe("makeStepAddressedAuthoredWorkflowFieldIssue", () => {
  test("uses the edges-specific rejection message for workflow.edges", () => {
    expect(makeStepAddressedAuthoredWorkflowFieldIssue("edges")).toEqual({
      severity: "error",
      path: "workflow.edges",
      message: REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE,
    });
  });

  test("uses the generic step-addressed schema message for other removed fields", () => {
    expect(makeStepAddressedAuthoredWorkflowFieldIssue("entryNodeId")).toEqual({
      severity: "error",
      path: "workflow.entryNodeId",
      message: REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
    });
  });
});

describe("stripNormalizedWorkflowFieldsForPersistence", () => {
  test("removes normalized-only workflow fields and redundant node kind", () => {
    expect(
      stripNormalizedWorkflowFieldsForPersistence({
        workflowId: "demo",
        hasManagerNode: true,
        nodes: [
          { id: "manager", role: "manager", kind: "task" },
          { id: "review", kind: "loop-judge" },
        ],
      }),
    ).toEqual({
      workflowId: "demo",
      nodes: [
        { id: "manager", role: "manager" },
        { id: "review", kind: "loop-judge" },
      ],
    });
  });
});
