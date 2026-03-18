import { describe, expect, test } from "vitest";
import type { NormalizedWorkflowBundle } from "../../../src/workflow/types";
import { cloneEditableValue } from "./editor-workflow";
import {
  updateNodeKindValue,
  updateNodePayloadObjectValue,
  updateNodePayloadTypeValue,
  updateNodeTimeoutValue,
  updateWorkflowContainerRuntimeValue,
  updateWorkflowDefaultValue,
} from "./editor-field-updates";
import { parseOptionalInteger } from "./editor-support";

function makeBundle() {
  const bundle: NormalizedWorkflowBundle = {
    workflow: {
      workflowId: "demo",
      description: "Demo workflow",
      defaults: {
        maxLoopIterations: 3,
        nodeTimeoutMs: 120000,
      },
      managerNodeId: "divedra-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "worker-1",
          kind: "task",
          nodeFile: "node-worker-1.json",
          completion: { type: "none" },
        },
      ],
      edges: [{ from: "divedra-manager", to: "worker-1", when: "always" }],
      loops: [],
      branching: { mode: "fan-out" },
    },
    workflowVis: {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "worker-1", order: 1 },
      ],
    },
    nodePayloads: {
      "divedra-manager": {
        id: "divedra-manager",
        model: "gpt-5",
        promptTemplate: "Coordinate",
        variables: {},
      },
      "worker-1": {
        id: "worker-1",
        model: "gpt-5",
        promptTemplate: "Work",
        variables: {},
      },
    },
  };

  return cloneEditableValue(bundle);
}

describe("editor-field-updates", () => {
  test("rejects assigning reserved structure kinds manually", () => {
    const bundle = makeBundle();

    const result = updateNodeKindValue(bundle, "worker-1", "root-manager");

    expect(result).toEqual({
      ok: false,
      error:
        "Node kind 'root-manager' is assigned by workflow structure. Edit the manager or sub-workflow boundaries instead.",
    });
    expect(bundle.workflow.nodes[1]?.kind).toBe("task");
  });

  test("rejects invalid positive-only workflow defaults without mutating state", () => {
    const bundle = makeBundle();

    const result = updateWorkflowDefaultValue(bundle, "maxLoopIterations", "0");

    expect(result).toEqual({
      ok: false,
      error: "Workflow default 'maxLoopIterations' must be a positive integer.",
    });
    expect(bundle.workflow.defaults.maxLoopIterations).toBe(3);
  });

  test("rejects malformed numeric workflow values instead of truncating them", () => {
    const bundle = makeBundle();
    const payload = bundle.nodePayloads["worker-1"];
    if (!payload) {
      throw new Error("missing payload fixture");
    }

    expect(
      updateWorkflowDefaultValue(bundle, "maxLoopIterations", "1.5"),
    ).toEqual({
      ok: false,
      error: "Workflow default 'maxLoopIterations' must be a positive integer.",
    });
    expect(bundle.workflow.defaults.maxLoopIterations).toBe(3);

    expect(updateNodeTimeoutValue(payload, "10ms")).toEqual({
      ok: false,
      error: "Node timeout must be a positive integer.",
    });
    expect(payload.timeoutMs).toBeUndefined();

    expect(() => parseOptionalInteger("25ms", "Max steps")).toThrow(
      "Max steps must be a positive integer.",
    );
  });

  test("updates optional object-backed workflow and node payload sections", () => {
    const bundle = makeBundle();
    const payload = bundle.nodePayloads["worker-1"];
    if (!payload) {
      throw new Error("missing payload fixture");
    }

    expect(
      updateWorkflowContainerRuntimeValue(
        bundle,
        '{\n  "runnerKind": "docker"\n}',
      ),
    ).toEqual({ ok: true });
    expect(bundle.workflow.defaults.containerRuntime).toEqual({
      runnerKind: "docker",
    });

    expect(updateNodePayloadTypeValue(payload, "container")).toBe(true);
    expect(payload.nodeType).toBe("container");

    expect(
      updateNodePayloadObjectValue(
        payload,
        "container",
        '{\n  "image": "ghcr.io/example/worker:latest"\n}',
      ),
    ).toEqual({ ok: true });
    expect(payload.container).toEqual({
      image: "ghcr.io/example/worker:latest",
    });

    expect(
      updateNodePayloadObjectValue(
        payload,
        "durability",
        '{\n  "mode": "node-persistent"\n}',
      ),
    ).toEqual({ ok: true });
    expect(payload.durability).toEqual({
      mode: "node-persistent",
    });
  });

  test("preserves invalid JSON text by rejecting object-backed updates", () => {
    const bundle = makeBundle();
    const payload = bundle.nodePayloads["worker-1"];
    if (!payload) {
      throw new Error("missing payload fixture");
    }

    const result = updateNodePayloadObjectValue(payload, "command", "{");

    expect(result).toEqual({
      ok: false,
      error:
        "Node field 'command' JSON Parse error: JSON Parse error: Expected '}'",
    });
    expect(payload.command).toBeUndefined();
  });

  test("clears empty node timeout and rejects non-positive values", () => {
    const bundle = makeBundle();
    const payload = bundle.nodePayloads["worker-1"];
    if (!payload) {
      throw new Error("missing payload fixture");
    }

    payload.timeoutMs = 50;
    expect(updateNodeTimeoutValue(payload, "   ")).toEqual({ ok: true });
    expect(payload.timeoutMs).toBeUndefined();

    const result = updateNodeTimeoutValue(payload, "-1");
    expect(result).toEqual({
      ok: false,
      error: "Node timeout must be a positive integer.",
    });
    expect(payload.timeoutMs).toBeUndefined();
  });
});
