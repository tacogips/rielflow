import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildOutputPromptText as buildDirectOutputPromptText,
  buildReservedCandidateSubmissionPath as buildDirectReservedCandidateSubmissionPath,
  formatOutputValidationErrors as formatDirectOutputValidationErrors,
} from "./call-step-impl/direct-step-helpers";
import {
  buildOutputPromptText as buildEngineOutputPromptText,
  buildReservedCandidateSubmissionPath as buildEngineReservedCandidateSubmissionPath,
  formatOutputValidationErrors as formatEngineOutputValidationErrors,
} from "./engine/types-and-session-state";
import {
  buildOutputPromptText,
  buildReservedCandidateSubmissionPath,
  formatOutputValidationErrors,
  resolveRuntimeTimeoutMs,
} from "./runtime-execution-contracts";
import type { JsonSchemaValidationError } from "./json-schema";
import type { NodePayload } from "./types";

describe("runtime execution contract helpers", () => {
  test("keeps engine and direct-step candidate path helpers on the shared implementation", () => {
    expect(buildEngineReservedCandidateSubmissionPath).toBe(
      buildReservedCandidateSubmissionPath,
    );
    expect(buildDirectReservedCandidateSubmissionPath).toBe(
      buildReservedCandidateSubmissionPath,
    );

    const candidatePath = buildReservedCandidateSubmissionPath({
      workflowId: "workflow-a",
      workflowExecutionId: "run-b",
      nodeId: "node-c",
      nodeExecId: "exec-000001",
      outputAttemptId: "attempt-000002",
    });

    expect(candidatePath).toBe(
      path.join(
        path.dirname(path.dirname(path.dirname(path.dirname(candidatePath)))),
        "node-c",
        "exec-000001",
        "attempt-000002",
        "candidate.json",
      ),
    );
  });

  test("keeps engine and direct-step validation feedback helpers on the shared implementation", () => {
    expect(buildEngineOutputPromptText).toBe(buildOutputPromptText);
    expect(buildDirectOutputPromptText).toBe(buildOutputPromptText);
    expect(formatEngineOutputValidationErrors).toBe(
      formatOutputValidationErrors,
    );
    expect(formatDirectOutputValidationErrors).toBe(
      formatOutputValidationErrors,
    );

    const validationErrors: JsonSchemaValidationError[] = Array.from(
      { length: 10 },
      (_, index) => ({
        path: `$.field${index}`,
        message: `invalid field ${index}`,
      }),
    );
    const node: NodePayload = {
      id: "node-a",
      executionBackend: "codex-agent",
      model: "codex-test",
      promptTemplate: "base",
      variables: {},
      output: {
        jsonSchema: {
          type: "object",
          required: ["summary"],
          properties: { summary: { type: "string" } },
        },
      },
    };

    const promptText = buildOutputPromptText({
      basePromptText: "base prompt",
      node,
      candidatePath: "/tmp/candidate.json",
      validationErrors,
    });

    expect(formatOutputValidationErrors(validationErrors)).toHaveLength(8);
    expect(promptText).toContain("Previous output was rejected:");
    expect(promptText).toContain("2 additional validation errors omitted");
    expect(
      promptText
        .split("\n")
        .filter((line) => line.startsWith("- $.") || line.startsWith("- $:")),
    ).toHaveLength(9);
  });

  test("preserves timeout priority while sharing timeout candidate selection", () => {
    expect(
      resolveRuntimeTimeoutMs({
        candidates: [
          { timeoutMs: 0, source: "invocation", requirePositive: true },
          { timeoutMs: 20, source: "node" },
        ],
        fallback: { timeoutMs: 30, source: "workflow" },
      }),
    ).toEqual({ timeoutMs: 20, source: "node" });
  });
});
