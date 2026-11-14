import { describe, expect, test } from "vitest";
import {
  jsonBodyObject,
  optionalStringField,
  optionalTrimmedStringField,
  readWorkflowExecuteRequestOptions,
  readWorkflowRerunRequestOptions,
} from "./api-request";

describe("api-request", () => {
  test("normalizes unknown bodies to object records", () => {
    expect(jsonBodyObject(null)).toEqual({});
    expect(jsonBodyObject("text")).toEqual({});
    expect(jsonBodyObject(["not", "an", "object"])).toEqual({});
    expect(jsonBodyObject({ workflowName: "demo" })).toEqual({
      workflowName: "demo",
    });
  });

  test("reads optional string fields with explicit trimming support", () => {
    const body = { workflowName: " demo ", blank: "   " };
    expect(optionalStringField(body, "workflowName")).toBe(" demo ");
    expect(optionalTrimmedStringField(body, "workflowName")).toBe("demo");
    expect(optionalTrimmedStringField(body, "blank")).toBeUndefined();
    expect(optionalTrimmedStringField(body, "missing")).toBeUndefined();
  });

  test("parses shared workflow execute request options", () => {
    const parsed = readWorkflowExecuteRequestOptions({
      runtimeVariables: { topic: "demo" },
      mockScenario: { "worker-1": { mode: "success", output: { ok: true } } },
      async: true,
      maxSteps: 12,
      maxLoopIterations: 3,
      defaultTimeoutMs: 5_000,
      dryRun: true,
    });

    expect(parsed).toEqual({
      runtimeVariables: { topic: "demo" },
      mockScenario: { "worker-1": { mode: "success", output: { ok: true } } },
      asyncMode: true,
      maxSteps: 12,
      maxLoopIterations: 3,
      defaultTimeoutMs: 5_000,
      dryRun: true,
    });
  });

  test("ignores array-shaped object fields when parsing workflow run options", () => {
    const parsed = readWorkflowExecuteRequestOptions({
      runtimeVariables: ["topic", "demo"],
      mockScenario: { "worker-1": { mode: "success", output: { ok: true } } },
      async: false,
    });

    expect(parsed).toEqual({
      runtimeVariables: {},
      mockScenario: { "worker-1": { mode: "success", output: { ok: true } } },
      asyncMode: false,
    });
  });

  test("keeps only mock scenario entries that match the adapter scenario shape", () => {
    const parsed = readWorkflowExecuteRequestOptions({
      async: false,
      mockScenario: {
        "worker-1": {
          provider: "deterministic-local",
          completionPassed: true,
          when: { always: true },
          payload: { ok: true },
        },
        "worker-2": [
          {
            promptText: "first",
            payload: { step: 1 },
          },
          {
            promptText: 10,
          },
        ],
        "worker-3": "invalid",
      },
    });

    expect(parsed).toEqual({
      runtimeVariables: {},
      asyncMode: false,
      mockScenario: {
        "worker-1": {
          provider: "deterministic-local",
          completionPassed: true,
          when: { always: true },
          payload: { ok: true },
        },
        "worker-2": [
          {
            promptText: "first",
            payload: { step: 1 },
          },
        ],
      },
    });
  });

  test("ignores invalid optional rerun fields without failing the whole parse", () => {
    const parsed = readWorkflowRerunRequestOptions({
      fromNodeId: "workflow-output",
      runtimeVariables: null,
      mockScenario: [],
      maxSteps: "10",
      defaultTimeoutMs: 2_000,
    });

    expect(parsed).toEqual({
      fromNodeId: "workflow-output",
      runtimeVariables: {},
      defaultTimeoutMs: 2_000,
    });
  });

  test("trims rerun fromNodeId and drops blank values", () => {
    expect(
      readWorkflowRerunRequestOptions({
        fromNodeId: " workflow-output ",
      }),
    ).toEqual({
      fromNodeId: "workflow-output",
      runtimeVariables: {},
    });

    expect(
      readWorkflowRerunRequestOptions({
        fromNodeId: "   ",
      }),
    ).toEqual({
      runtimeVariables: {},
    });
  });
});
