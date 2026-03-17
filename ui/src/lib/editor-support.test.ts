import { describe, expect, test } from "vitest";
import type { ValidationIssue } from "../../../src/workflow/types";
import { validationSummaryFromIssues } from "./editor-support";

describe("editor-support", () => {
  test("summarizes invalid validation issues with warning and error counts", () => {
    const issues: readonly ValidationIssue[] = [
      {
        severity: "error",
        path: "workflow.nodes[0].id",
        message: "duplicate node id",
      },
      {
        severity: "warning",
        path: "workflow.defaults.nodeTimeoutMs",
        message: "prefer a shorter timeout",
      },
    ];

    expect(validationSummaryFromIssues(false, issues)).toBe(
      "Validation returned 1 error and 1 warning.",
    );
  });

  test("summarizes valid validation issues as warnings only", () => {
    const warnings: readonly ValidationIssue[] = [
      {
        severity: "warning",
        path: "workflow.defaults.maxLoopIterations",
        message: "prefer a lower limit",
      },
    ];

    expect(validationSummaryFromIssues(true, warnings)).toBe(
      "Validation passed with 1 warning.",
    );
  });
});
