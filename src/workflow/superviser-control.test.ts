import { describe, expect, test } from "bun:test";
import { ok } from "./result";
import { DEFAULT_STALL_TIMEOUT_MS } from "./auto-improve-policy";
import {
  parseGetWorkflowExecutionDetailsControlArguments,
  parseGetWorkflowStatusControlArguments,
  parseLoadWorkflowDefinitionControlArguments,
  parseRerunTargetWorkflowControlArguments,
  parseSaveWorkflowDefinitionControlArguments,
  parseStartTargetWorkflowControlArguments,
  parseSuperviserControlAuth,
} from "./superviser-control";

describe("parseSuperviserControlAuth", () => {
  test("rejects null arguments", () => {
    const r = parseSuperviserControlAuth(null, "x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("must be an object");
    }
  });

  test("extracts auth fields", () => {
    const r = parseSuperviserControlAuth(
      { supervisionRunId: "s1", targetSessionId: "t1" },
      "x",
    );
    expect(r).toEqual(ok({ supervisionRunId: "s1", targetSessionId: "t1" }));
  });

  test("trims auth fields", () => {
    const r = parseSuperviserControlAuth(
      { supervisionRunId: "  s1  ", targetSessionId: "  t1  " },
      "x",
    );
    expect(r).toEqual(ok({ supervisionRunId: "s1", targetSessionId: "t1" }));
  });
});

describe("parseStartTargetWorkflowControlArguments", () => {
  const expected = { supervisionRunId: "s1", targetSessionId: "t1" };

  test("rejects wrong supervision id", () => {
    const r = parseStartTargetWorkflowControlArguments(
      {
        supervisionRunId: "other",
        targetSessionId: "t1",
        workflowId: "wf",
      },
      "p",
      expected,
    );
    expect(r.ok).toBe(false);
  });

  test("returns start payload without autoImprove", () => {
    const r = parseStartTargetWorkflowControlArguments(
      {
        supervisionRunId: "s1",
        targetSessionId: "t1",
        workflowId: "wf-1",
        runtimeVariables: { k: 1 },
      },
      "p",
      expected,
    );
    expect(r).toEqual(
      ok({
        auth: expected,
        workflowId: "wf-1",
        runtimeVariables: { k: 1 },
      }),
    );
  });

  test("normalizes autoImprove when provided", () => {
    const r = parseStartTargetWorkflowControlArguments(
      {
        supervisionRunId: "s1",
        targetSessionId: "t1",
        workflowId: "wf-1",
        autoImprove: {
          enabled: true,
          monitorIntervalMs: 1500,
          allowTargetedRerun: false,
        },
      },
      "p",
      expected,
    );
    expect(r).toEqual(
      ok({
        auth: expected,
        workflowId: "wf-1",
        autoImprove: {
          enabled: true,
          monitorIntervalMs: 1500,
          stallTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
          maxSupervisedAttempts: 5,
          maxWorkflowPatches: 3,
          superviserWorkflowId: "divedra-default-superviser",
          workflowMutationMode: "execution-copy",
          allowTargetedRerun: false,
        },
      }),
    );
  });

  test("rejects non-object autoImprove fields", () => {
    const r = parseStartTargetWorkflowControlArguments(
      {
        supervisionRunId: "s1",
        targetSessionId: "t1",
        workflowId: "wf-1",
        autoImprove: {
          enabled: true,
          allowTargetedRerun: "no",
        },
      },
      "p",
      expected,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("allowTargetedRerun");
    }
  });
});

describe("parseGetWorkflowStatusControlArguments", () => {
  const expected = { supervisionRunId: "s1", targetSessionId: "t1" };

  test("requires sessionId to match targetSessionId", () => {
    const r = parseGetWorkflowStatusControlArguments(
      {
        supervisionRunId: "s1",
        targetSessionId: "t1",
        sessionId: "other",
      },
      "p",
      expected,
    );
    expect(r.ok).toBe(false);
  });

  test("succeeds when sessionId matches", () => {
    const r = parseGetWorkflowStatusControlArguments(
      {
        supervisionRunId: "s1",
        targetSessionId: "t1",
        sessionId: "t1",
      },
      "p",
      expected,
    );
    expect(r).toEqual(ok({ sessionId: "t1" }));
  });
});

describe("parseGetWorkflowExecutionDetailsControlArguments", () => {
  const expected = { supervisionRunId: "s1", targetSessionId: "t1" };

  test("succeeds when sessionId matches", () => {
    const r = parseGetWorkflowExecutionDetailsControlArguments(
      {
        supervisionRunId: "s1",
        targetSessionId: "t1",
        sessionId: "t1",
      },
      "p",
      expected,
    );
    expect(r).toEqual(ok({ sessionId: "t1" }));
  });
});

describe("parseRerunTargetWorkflowControlArguments", () => {
  const expected = { supervisionRunId: "s1", targetSessionId: "t1" };

  test("passes through optional rerunFromStepId", () => {
    const r = parseRerunTargetWorkflowControlArguments(
      {
        supervisionRunId: "s1",
        targetSessionId: "t1",
        sessionId: "t1",
        rerunFromStepId: " step-b ",
      },
      "p",
      expected,
    );
    expect(r).toEqual(ok({ sessionId: "t1", rerunFromStepId: "step-b" }));
  });

  test("rejects unknown arguments on nested superviser rerun-workflow", () => {
    const r = parseRerunTargetWorkflowControlArguments(
      {
        supervisionRunId: "s1",
        targetSessionId: "t1",
        sessionId: "t1",
        rerunFromNodeId: "old-node",
      },
      "p",
      expected,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("rerunFromNodeId");
      expect(r.error).toContain("not a supported argument");
    }
  });
});

describe("workflow definition control arguments", () => {
  const expected = { supervisionRunId: "s1", targetSessionId: "t1" };

  test("load workflow definition requires workflow id and mutable dir", () => {
    const r = parseLoadWorkflowDefinitionControlArguments(
      {
        supervisionRunId: "s1",
        targetSessionId: "t1",
        workflowId: "wf-1",
        mutableWorkflowDir: "/tmp/mutable",
      },
      "p",
      expected,
    );
    expect(r).toEqual(
      ok({
        workflowId: "wf-1",
        mutableWorkflowDir: "/tmp/mutable",
      }),
    );
  });

  test("save workflow definition requires structured bundle payloads", () => {
    const r = parseSaveWorkflowDefinitionControlArguments(
      {
        supervisionRunId: "s1",
        targetSessionId: "t1",
        workflowId: "wf-1",
        mutableWorkflowDir: "/tmp/mutable",
        bundle: {
          workflow: { workflowId: "wf-1" },
          nodePayloads: { "node-1.json": { id: "node-1" } },
        },
      },
      "p",
      expected,
    );
    expect(r).toEqual(
      ok({
        workflowId: "wf-1",
        mutableWorkflowDir: "/tmp/mutable",
        bundle: {
          workflow: { workflowId: "wf-1" },
          nodePayloads: { "node-1.json": { id: "node-1" } },
        },
      }),
    );
  });

  test("save workflow definition rejects non-object nodePayloads", () => {
    const r = parseSaveWorkflowDefinitionControlArguments(
      {
        supervisionRunId: "s1",
        targetSessionId: "t1",
        workflowId: "wf-1",
        mutableWorkflowDir: "/tmp/mutable",
        bundle: {
          workflow: { workflowId: "wf-1" },
          nodePayloads: [],
        },
      },
      "p",
      expected,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("p.bundle.nodePayloads must be an object");
    }
  });
});
