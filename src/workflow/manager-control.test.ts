import { describe, expect, test } from "vitest";
import {
  parseManagerControlActions,
  parseManagerControlPayload,
} from "./manager-control";
import type { LoopRule, WorkflowCallRef, WorkflowJson } from "./types";

type LegacyNodeGraphFixture = WorkflowJson & {
  readonly edges: readonly { from: string; to: string; when: string }[];
  readonly loops: readonly LoopRule[];
};

type LegacyWorkflowCallWorkflow = WorkflowJson & {
  readonly workflowCalls?: readonly WorkflowCallRef[];
  readonly edges?: readonly { from: string; to: string; when: string }[];
  readonly loops?: readonly LoopRule[];
};

function makeWorkflow(): LegacyNodeGraphFixture {
  return {
    workflowId: "wf",
    description: "wf",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
        kind: "root-manager",
        completion: { type: "none" },
      },
      {
        id: "a-manager",
        nodeFile: "node-a-manager.json",
        kind: "task",
        completion: { type: "none" },
      },
      {
        id: "a-input",
        nodeFile: "node-a-input.json",
        kind: "input",
        completion: { type: "none" },
        execution: {
          mode: "optional",
          decisionBy: "owning-manager",
        },
      },
      {
        id: "a-output",
        nodeFile: "node-a-output.json",
        kind: "output",
        completion: { type: "none" },
      },
      {
        id: "step-1",
        nodeFile: "node-step-1.json",
        kind: "task",
        completion: { type: "none" },
        execution: {
          mode: "optional",
          decisionBy: "owning-manager",
        },
      },
    ],
    edges: [],
    loops: [],
  };
}

function makeRoleWorkflow(): LegacyWorkflowCallWorkflow {
  return {
    workflowId: "wf-role",
    description: "role workflow",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    workflowCalls: [
      {
        id: "call-review",
        workflowId: "review-target",
        callerNodeId: "step-1",
        resultNodeId: "step-2",
      },
    ],
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
        role: "manager",
      },
      {
        id: "step-1",
        nodeFile: "node-step-1.json",
        role: "worker",
        execution: {
          mode: "optional",
          decisionBy: "owning-manager",
        },
      },
      {
        id: "step-2",
        nodeFile: "node-step-2.json",
        role: "worker",
      },
    ],
    edges: [],
    loops: [],
  };
}

describe("parseManagerControlPayload", () => {
  test("returns null when managerControl is absent", () => {
    expect(
      parseManagerControlPayload({ marker: "plain" }, makeWorkflow(), {
        managerRuntimeId: "divedra-manager",
        managerKind: "root-manager",
      }),
    ).toBeNull();
  });

  test("parses supported manager control actions", () => {
    const parsed = parseManagerControlPayload(
      {
        managerControl: {
          actions: [{ type: "retry-step", stepId: "a-manager" }],
        },
      },
      makeWorkflow(),
      {
        managerRuntimeId: "divedra-manager",
        managerKind: "root-manager",
      },
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.retryStepIds).toEqual(["a-manager"]);
    expect(parsed?.actions[0]).toEqual({
      type: "retry-step",
      stepId: "a-manager",
    });
    expect(parsed?.replayCommunicationIds).toEqual([]);
  });

  test("accepts role-authored workflow managers as root-manager control scope", () => {
    const baseWorkflow = makeWorkflow();
    const workflow = {
      ...baseWorkflow,
      nodes: baseWorkflow.nodes.map((node) =>
        node.id === "divedra-manager"
          ? {
              id: "divedra-manager",
              nodeFile: "node-divedra-manager.json",
              role: "manager" as const,
            }
          : node,
      ),
    };

    const parsed = parseManagerControlPayload(
      {
        managerControl: {
          actions: [{ type: "planner-note" }],
        },
      },
      workflow,
      {
        managerRuntimeId: "divedra-manager",
        managerKind: undefined,
        managerRole: "manager",
      },
    );

    expect(parsed?.actions).toEqual([{ type: "planner-note" }]);
  });

  test("rejects removed structural manager control action types", () => {
    const context = {
      managerRuntimeId: "divedra-manager",
      managerKind: undefined,
      managerRole: "manager" as const,
    };
    for (const action of [
      { type: "start-sub-workflow" as const, subWorkflowId: "call-review" },
      { type: "deliver-to-child-input" as const, inputNodeId: "a-input" },
    ]) {
      expect(() =>
        parseManagerControlActions([action], makeRoleWorkflow(), context),
      ).toThrow("is not supported");
    }
  });

  test("rejects retry actions from non-root manager runtime ids after structural scope removal", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "retry-step", stepId: "a-input" }],
          },
        },
        makeWorkflow(),
        {
          managerRuntimeId: "a-manager",
          managerKind: undefined,
        },
      ),
    ).toThrow("does not have a recognized control scope");
  });

  test("parses planner-note and replay-communication action variants", () => {
    const parsed = parseManagerControlActions(
      [
        { type: "planner-note" },
        {
          type: "replay-communication",
          communicationId: "comm-000123",
          reason: "rerun after inspection",
        },
      ],
      makeWorkflow(),
      {
        managerRuntimeId: "divedra-manager",
        managerKind: "root-manager",
      },
    );

    expect(parsed.actions).toHaveLength(2);
    expect(parsed.retryStepIds).toEqual([]);
    expect(parsed.replayCommunicationIds).toEqual(["comm-000123"]);
  });

  test("trims manager-control identifiers and optional reason text", () => {
    const parsed = parseManagerControlActions(
      [
        { type: "retry-step", stepId: " a-input " },
        {
          type: "replay-communication",
          communicationId: " comm-000123 ",
          reason: " rerun after inspection ",
        },
        {
          type: "skip-optional-step",
          stepId: " step-1 ",
          reason: "   ",
        },
      ],
      makeWorkflow(),
      {
        managerRuntimeId: "divedra-manager",
        managerKind: "root-manager",
      },
    );

    expect(parsed.retryStepIds).toEqual(["a-input"]);
    expect(parsed.replayCommunicationIds).toEqual(["comm-000123"]);
    expect(parsed.skipOptionalStepIds).toEqual(["step-1"]);
    expect(parsed.actions[1]).toEqual({
      type: "replay-communication",
      communicationId: "comm-000123",
      reason: "rerun after inspection",
    });
    expect(parsed.actions[2]).toEqual({
      type: "skip-optional-step",
      stepId: "step-1",
    });
  });

  test("parses execute-optional-step and skip-optional-step action variants", () => {
    const parsed = parseManagerControlActions(
      [
        { type: "execute-optional-step", stepId: "step-1" },
        {
          type: "skip-optional-step",
          stepId: "step-1",
          reason: "not needed this run",
        },
      ],
      makeWorkflow(),
      {
        managerRuntimeId: "divedra-manager",
        managerKind: "root-manager",
      },
    );

    expect(parsed.executeOptionalStepIds).toEqual(["step-1"]);
    expect(parsed.skipOptionalStepIds).toEqual(["step-1"]);
  });

  test("rejects removal-bound retry-node and optional-node action types", () => {
    expect(() =>
      parseManagerControlActions(
        [{ type: "retry-node", nodeId: "a-manager" }],
        makeWorkflow(),
        {
          managerRuntimeId: "divedra-manager",
          managerKind: "root-manager",
        },
      ),
    ).toThrow("is not supported");

    expect(() =>
      parseManagerControlActions(
        [{ type: "execute-optional-node", nodeId: "step-1" }],
        makeWorkflow(),
        {
          managerRuntimeId: "divedra-manager",
          managerKind: "root-manager",
        },
      ),
    ).toThrow("is not supported");
  });

  test("rejects unknown referenced ids", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "retry-step", stepId: "missing" }],
          },
        },
        makeWorkflow(),
        {
          managerRuntimeId: "a-manager",
          managerKind: undefined,
        },
      ),
    ).toThrow("does not exist");
  });

  test("rejects replay-communication with a non-string reason", () => {
    expect(() =>
      parseManagerControlActions(
        [
          {
            type: "replay-communication",
            communicationId: "comm-000001",
            reason: 123,
          },
        ],
        makeWorkflow(),
        {
          managerRuntimeId: "divedra-manager",
          managerKind: "root-manager",
        },
      ),
    ).toThrow("reason must be a string");
  });

  test("rejects whitespace-only control identifiers", () => {
    expect(() =>
      parseManagerControlActions(
        [{ type: "retry-step", stepId: "   " }],
        makeWorkflow(),
        {
          managerRuntimeId: "divedra-manager",
          managerKind: "root-manager",
        },
      ),
    ).toThrow("stepId must be a non-empty string");

    expect(() =>
      parseManagerControlActions(
        [{ type: "replay-communication", communicationId: "   " }],
        makeWorkflow(),
        {
          managerRuntimeId: "divedra-manager",
          managerKind: "root-manager",
        },
      ),
    ).toThrow("communicationId must be a non-empty string");
  });

  test("rejects retry-step from non-root legacy nested manager runtime contexts", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "retry-step", stepId: "divedra-manager" }],
          },
        },
        makeWorkflow(),
        {
          managerRuntimeId: "a-manager",
          managerKind: undefined,
        },
      ),
    ).toThrow("does not have a recognized control scope");
  });

  test("accepts root-manager retry-step for a task step id", () => {
    const parsed = parseManagerControlPayload(
      {
        managerControl: {
          actions: [{ type: "retry-step", stepId: "a-input" }],
        },
      },
      makeWorkflow(),
      {
        managerRuntimeId: "divedra-manager",
        managerKind: "root-manager",
      },
    );
    expect(parsed?.retryStepIds).toEqual(["a-input"]);
  });

  test("rejects manager self-retry", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "retry-step", stepId: "a-manager" }],
          },
        },
        makeWorkflow(),
        {
          managerRuntimeId: "a-manager",
          managerKind: undefined,
        },
      ),
    ).toThrow("cannot target the manager itself");
  });

  test("rejects optional-node decisions for non-optional nodes and allows root-manager decisions across the workflow", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "execute-optional-step", stepId: "a-output" }],
          },
        },
        makeWorkflow(),
        {
          managerRuntimeId: "a-manager",
          managerKind: undefined,
        },
      ),
    ).toThrow("workflow execution.mode 'optional'");

    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "skip-optional-step", stepId: "a-input" }],
          },
        },
        makeWorkflow(),
        {
          managerRuntimeId: "divedra-manager",
          managerKind: "root-manager",
        },
      ),
    ).not.toThrow();
  });
});
