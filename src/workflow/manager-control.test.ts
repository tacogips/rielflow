import { describe, expect, test } from "vitest";
import {
  parseManagerControlActions,
  parseManagerControlPayload,
} from "./manager-control";
import type { WorkflowJson } from "./types";

function makeWorkflow(): WorkflowJson {
  return {
    workflowId: "wf",
    description: "wf",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryStepId: "manager-step",
    managerStepId: "manager-step",
    nodeRegistry: [
      { id: "manager-step", nodeFile: "node-manager.json" },
      { id: "optional-step", nodeFile: "node-optional.json" },
      { id: "worker-step", nodeFile: "node-worker.json" },
    ],
    steps: [
      { id: "manager-step", nodeId: "manager-step", role: "manager" },
      { id: "optional-step", nodeId: "optional-step", role: "worker" },
      { id: "worker-step", nodeId: "worker-step", role: "worker" },
    ],
    nodes: [
      {
        id: "manager-step",
        nodeFile: "node-manager.json",
        role: "manager",
      },
      {
        id: "optional-step",
        nodeFile: "node-optional.json",
        role: "worker",
        execution: {
          mode: "optional",
          decisionBy: "owning-manager",
        },
      },
      {
        id: "worker-step",
        nodeFile: "node-worker.json",
        role: "worker",
      },
    ],
  };
}

describe("parseManagerControlPayload", () => {
  test("returns null when managerControl is absent", () => {
    expect(
      parseManagerControlPayload({ marker: "plain" }, makeWorkflow(), {
        managerStepId: "manager-step",
      }),
    ).toBeNull();
  });

  test("returns empty action groups when managerControl.actions is omitted", () => {
    expect(
      parseManagerControlPayload(
        { managerControl: {} },
        makeWorkflow(),
        { managerStepId: "manager-step" },
      ),
    ).toEqual({
      actions: [],
      retryStepIds: [],
      replayCommunicationIds: [],
      executeOptionalStepIds: [],
      skipOptionalStepIds: [],
    });
  });
});

describe("parseManagerControlActions", () => {
  test("dedupes retry and optional-step actions", () => {
    const parsed = parseManagerControlActions(
      [
        { type: "retry-step", stepId: "worker-step" },
        { type: "retry-step", stepId: "worker-step" },
        { type: "execute-optional-step", stepId: "optional-step" },
        { type: "execute-optional-step", stepId: "optional-step" },
        { type: "skip-optional-step", stepId: "optional-step", reason: "nope" },
        {
          type: "replay-communication",
          communicationId: "comm-1",
          reason: "retry context",
        },
      ],
      makeWorkflow(),
      { managerStepId: "manager-step" },
    );

    expect(parsed.retryStepIds).toEqual(["worker-step"]);
    expect(parsed.executeOptionalStepIds).toEqual(["optional-step"]);
    expect(parsed.skipOptionalStepIds).toEqual(["optional-step"]);
    expect(parsed.replayCommunicationIds).toEqual(["comm-1"]);
  });

  test("rejects retrying the manager step itself", () => {
    expect(() =>
      parseManagerControlActions(
        [{ type: "retry-step", stepId: "manager-step" }],
        makeWorkflow(),
        { managerStepId: "manager-step" },
      ),
    ).toThrow("cannot target the manager itself");
  });

  test("rejects optional-step control from an unrecognized manager scope", () => {
    expect(() =>
      parseManagerControlActions(
        [{ type: "execute-optional-step", stepId: "optional-step" }],
        makeWorkflow(),
        { managerStepId: "other-manager" },
      ),
    ).toThrow("does not have a recognized control scope");
  });
});
