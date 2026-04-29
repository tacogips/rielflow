import { describe, expect, test } from "vitest";
import { parseSupervisorChatCommandDecision } from "./supervisor-command-contract";

describe("parseSupervisorChatCommandDecision", () => {
  test("parses a valid full decision", () => {
    const result = parseSupervisorChatCommandDecision({
      action: "start",
      managedWorkflowName: "my-workflow",
      confidence: 0.95,
      reason: "user clearly requested a start",
      commandText: "start my-workflow",
      runtimeVariables: { key: "value" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      action: "start",
      managedWorkflowName: "my-workflow",
      confidence: 0.95,
      reason: "user clearly requested a start",
      commandText: "start my-workflow",
      runtimeVariables: { key: "value" },
    });
  });

  test("parses a minimal decision without optional fields", () => {
    const result = parseSupervisorChatCommandDecision({
      action: "input",
      managedWorkflowName: "  my-workflow  ",
      confidence: 0.8,
      reason: "forwarding input",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.managedWorkflowName).toBe("my-workflow");
    expect(result.value.commandText).toBeUndefined();
    expect(result.value.runtimeVariables).toBeUndefined();
  });

  test("accepts all valid actions", () => {
    const actions = ["ignore", "start", "stop", "restart", "status", "input"];
    for (const action of actions) {
      const result = parseSupervisorChatCommandDecision({
        action,
        managedWorkflowName: "wf",
        confidence: 1.0,
        reason: "test",
      });
      expect(result.ok).toBe(true);
    }
  });

  test("rejects non-object input", () => {
    expect(parseSupervisorChatCommandDecision(null).ok).toBe(false);
    expect(parseSupervisorChatCommandDecision("string").ok).toBe(false);
    expect(parseSupervisorChatCommandDecision(42).ok).toBe(false);
    expect(parseSupervisorChatCommandDecision([]).ok).toBe(false);
  });

  test("rejects invalid action", () => {
    const result = parseSupervisorChatCommandDecision({
      action: "delete",
      managedWorkflowName: "wf",
      confidence: 0.9,
      reason: "test",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("action must be one of");
  });

  test("rejects empty managedWorkflowName", () => {
    const result = parseSupervisorChatCommandDecision({
      action: "start",
      managedWorkflowName: "  ",
      confidence: 0.9,
      reason: "test",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("managedWorkflowName");
  });

  test("rejects missing managedWorkflowName", () => {
    const result = parseSupervisorChatCommandDecision({
      action: "start",
      confidence: 0.9,
      reason: "test",
    });
    expect(result.ok).toBe(false);
  });

  test("rejects non-finite confidence", () => {
    const result = parseSupervisorChatCommandDecision({
      action: "start",
      managedWorkflowName: "wf",
      confidence: NaN,
      reason: "test",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("confidence");
  });

  test("rejects non-string reason", () => {
    const result = parseSupervisorChatCommandDecision({
      action: "start",
      managedWorkflowName: "wf",
      confidence: 0.9,
      reason: 42,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("reason");
  });

  test("rejects non-string commandText", () => {
    const result = parseSupervisorChatCommandDecision({
      action: "start",
      managedWorkflowName: "wf",
      confidence: 0.9,
      reason: "test",
      commandText: 123,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("commandText");
  });

  test("rejects non-object runtimeVariables", () => {
    const result = parseSupervisorChatCommandDecision({
      action: "start",
      managedWorkflowName: "wf",
      confidence: 0.9,
      reason: "test",
      runtimeVariables: "not an object",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("runtimeVariables");
  });

  test("trims managedWorkflowName", () => {
    const result = parseSupervisorChatCommandDecision({
      action: "stop",
      managedWorkflowName: "  my-workflow  ",
      confidence: 0.85,
      reason: "trimming test",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.managedWorkflowName).toBe("my-workflow");
  });
});
