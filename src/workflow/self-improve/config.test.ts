import { describe, expect, test } from "vitest";
import { validatePureWorkflowBundle } from "../validate";
import {
  resolveWorkflowSelfImprovePolicy,
  validateWorkflowSelfImprovePublicInput,
} from "./config";

function makeBundle(selfImprove: unknown) {
  return {
    workflow: {
      workflowId: "demo",
      description: "demo workflow",
      defaults: {
        maxLoopIterations: 3,
        nodeTimeoutMs: 1000,
        selfImprove,
      },
      managerStepId: "manager",
      entryStepId: "manager",
      nodes: [{ id: "manager", nodeFile: "nodes/node-manager.json" }],
      steps: [{ id: "manager", nodeId: "manager", role: "manager" }],
    },
    nodePayloads: {
      "nodes/node-manager.json": {
        id: "manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "Review the workflow output and return JSON.",
        variables: {},
      },
    },
  };
}

describe("workflow self-improve config", () => {
  test("normalizes valid disabled defaults", () => {
    const result = validatePureWorkflowBundle(
      makeBundle({
        enabled: false,
        mode: "report-and-auto-improve",
        defaultLogLimit: 12,
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.workflow.defaults.selfImprove).toEqual({
        enabled: false,
        mode: "report-and-auto-improve",
        defaultLogLimit: 12,
      });
    }
  });

  test("rejects unknown fields, invalid modes, and non-positive limits", () => {
    const result = validatePureWorkflowBundle(
      makeBundle({
        enabled: true,
        mode: "auto",
        defaultLogLimit: 0,
        extra: true,
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.map((issue) => issue.path)).toEqual(
        expect.arrayContaining([
          "workflow.defaults.selfImprove.extra",
          "workflow.defaults.selfImprove.mode",
          "workflow.defaults.selfImprove.defaultLogLimit",
        ]),
      );
    }
  });

  test("resolves caller, workflow, env, and default limit precedence", () => {
    expect(
      resolveWorkflowSelfImprovePolicy({
        defaults: { enabled: false, mode: "report-only", defaultLogLimit: 7 },
        env: { DIVEDRA_SELF_IMPROVE_DEFAULT_LIMIT: "8" },
        limit: 9,
        mode: "report-and-auto-improve",
        enableDisabled: true,
      }),
    ).toEqual({
      enabled: true,
      mode: "report-and-auto-improve",
      defaultLogLimit: 9,
    });
  });

  test("normalizes valid command and API overrides before service side effects", () => {
    expect(
      validateWorkflowSelfImprovePublicInput({
        workflowName: " demo ",
        mode: "report-only",
        sourceMode: "explicit",
        limit: 3,
        sessionIds: [" session-a "],
        enableDisabled: true,
      }),
    ).toEqual({
      workflowName: "demo",
      mode: "report-only",
      sourceMode: "explicit",
      limit: 3,
      sessionIds: ["session-a"],
      enableDisabled: true,
      commandApiOverrides: [
        "mode",
        "sourceMode",
        "limit",
        "sessionIds",
        "enableDisabled",
      ],
    });
  });

  test("rejects invalid public source selectors and session ids", () => {
    expect(() =>
      validateWorkflowSelfImprovePublicInput({
        workflowName: "demo",
        sourceMode: "explicit",
      }),
    ).toThrow("requires at least one session id");
    expect(() =>
      validateWorkflowSelfImprovePublicInput({
        workflowName: "demo",
        sourceMode: "latest",
        sessionIds: ["session-a"],
      }),
    ).toThrow("require sourceMode 'explicit'");
    expect(() =>
      validateWorkflowSelfImprovePublicInput({
        workflowName: "demo",
        sessionIds: ["../session-a"],
      }),
    ).toThrow("path separators are not allowed");
  });
});
