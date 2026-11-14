import { describe, expect, test } from "vitest";
import {
  assertCommunicationInManagerScope,
  parseManagerControlActions,
  parseManagerControlPayload,
} from "./manager-control";
import type { WorkflowJson } from "./types";

function makeWorkflow(): WorkflowJson {
  return {
    workflowId: "wf",
    description: "wf",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [
      {
        id: "sw-a",
        description: "A",
        managerNodeId: "a-manager",
        inputNodeId: "a-input",
        outputNodeId: "a-output",
        nodeIds: ["a-manager", "a-input", "a-output"],
        inputSources: [],
      },
    ],
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
        kind: "subworkflow-manager",
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
    branching: { mode: "fan-out" },
  };
}

describe("parseManagerControlPayload", () => {
  test("returns null when managerControl is absent", () => {
    expect(
      parseManagerControlPayload({ marker: "plain" }, makeWorkflow(), {
        managerNodeId: "divedra-manager",
        managerKind: "root-manager",
      }),
    ).toBeNull();
  });

  test("parses supported manager control actions", () => {
    const parsed = parseManagerControlPayload(
      {
        managerControl: {
          actions: [{ type: "start-sub-workflow", subWorkflowId: "sw-a" }],
        },
      },
      makeWorkflow(),
      {
        managerNodeId: "divedra-manager",
        managerKind: "root-manager",
      },
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.startSubWorkflowIds).toEqual(["sw-a"]);
    expect(parsed?.childInputNodeIds).toEqual([]);
    expect(parsed?.retryNodeIds).toEqual([]);
    expect(parsed?.replayCommunicationIds).toEqual([]);
    expect(parsed?.overridesRootSubWorkflowPlanning).toBe(true);
    expect(parsed?.overridesChildInputPlanning).toBe(true);
  });

  test("parses supported subworkflow-manager child-input and retry actions", () => {
    const parsed = parseManagerControlPayload(
      {
        managerControl: {
          actions: [
            { type: "deliver-to-child-input", inputNodeId: "a-input" },
            { type: "retry-node", nodeId: "a-input" },
          ],
        },
      },
      makeWorkflow(),
      {
        managerNodeId: "a-manager",
        managerKind: "subworkflow-manager",
      },
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.startSubWorkflowIds).toEqual([]);
    expect(parsed?.childInputNodeIds).toEqual(["a-input"]);
    expect(parsed?.retryNodeIds).toEqual(["a-input"]);
    expect(parsed?.replayCommunicationIds).toEqual([]);
    expect(parsed?.overridesRootSubWorkflowPlanning).toBe(true);
    expect(parsed?.overridesChildInputPlanning).toBe(true);
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
        managerNodeId: "divedra-manager",
        managerKind: "root-manager",
      },
    );

    expect(parsed.actions).toHaveLength(2);
    expect(parsed.retryNodeIds).toEqual([]);
    expect(parsed.replayCommunicationIds).toEqual(["comm-000123"]);
  });

  test("parses execute-optional-node and skip-optional-node action variants", () => {
    const parsed = parseManagerControlActions(
      [
        { type: "execute-optional-node", nodeId: "step-1" },
        {
          type: "skip-optional-node",
          nodeId: "step-1",
          reason: "not needed this run",
        },
      ],
      makeWorkflow(),
      {
        managerNodeId: "divedra-manager",
        managerKind: "root-manager",
      },
    );

    expect(parsed.executeOptionalNodeIds).toEqual(["step-1"]);
    expect(parsed.skipOptionalNodeIds).toEqual(["step-1"]);
  });

  test("rejects start-sub-workflow outside the root-manager scope", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "start-sub-workflow", subWorkflowId: "sw-a" }],
          },
        },
        makeWorkflow(),
        {
          managerNodeId: "a-manager",
          managerKind: "subworkflow-manager",
        },
      ),
    ).toThrow("only allowed for the root manager");
  });

  test("rejects unknown referenced ids", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "retry-node", nodeId: "missing" }],
          },
        },
        makeWorkflow(),
        {
          managerNodeId: "a-manager",
          managerKind: "subworkflow-manager",
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
          managerNodeId: "divedra-manager",
          managerKind: "root-manager",
        },
      ),
    ).toThrow("reason must be a string");
  });

  test("rejects child-input dispatch outside the subworkflow-manager owned scope", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [
              { type: "deliver-to-child-input", inputNodeId: "a-input" },
            ],
          },
        },
        makeWorkflow(),
        {
          managerNodeId: "divedra-manager",
          managerKind: "root-manager",
        },
      ),
    ).toThrow("only allowed for a subworkflow-manager");

    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [
              {
                type: "deliver-to-child-input",
                inputNodeId: "divedra-manager",
              },
            ],
          },
        },
        makeWorkflow(),
        {
          managerNodeId: "a-manager",
          managerKind: "subworkflow-manager",
        },
      ),
    ).toThrow("must exist with kind 'input'");

    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [
              { type: "deliver-to-child-input", inputNodeId: "a-output" },
            ],
          },
        },
        makeWorkflow(),
        {
          managerNodeId: "a-manager",
          managerKind: "subworkflow-manager",
        },
      ),
    ).toThrow("must exist with kind 'input'");
  });

  test("rejects subworkflow-manager retries outside the owned sub-workflow scope", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "retry-node", nodeId: "divedra-manager" }],
          },
        },
        makeWorkflow(),
        {
          managerNodeId: "a-manager",
          managerKind: "subworkflow-manager",
        },
      ),
    ).toThrow("must belong to sub-workflow 'sw-a'");
  });

  test("rejects root-manager retries that pierce into a sub-workflow internals", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "retry-node", nodeId: "a-input" }],
          },
        },
        makeWorkflow(),
        {
          managerNodeId: "divedra-manager",
          managerKind: "root-manager",
        },
      ),
    ).toThrow(
      "must re-invoke that sub-workflow with start-sub-workflow instead",
    );
  });

  test("rejects manager self-retry", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "retry-node", nodeId: "a-manager" }],
          },
        },
        makeWorkflow(),
        {
          managerNodeId: "a-manager",
          managerKind: "subworkflow-manager",
        },
      ),
    ).toThrow("cannot target the manager node itself");
  });

  test("rejects optional-node decisions for non-optional or out-of-scope nodes", () => {
    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "execute-optional-node", nodeId: "a-output" }],
          },
        },
        makeWorkflow(),
        {
          managerNodeId: "a-manager",
          managerKind: "subworkflow-manager",
        },
      ),
    ).toThrow("workflow execution.mode 'optional'");

    expect(() =>
      parseManagerControlPayload(
        {
          managerControl: {
            actions: [{ type: "skip-optional-node", nodeId: "a-input" }],
          },
        },
        makeWorkflow(),
        {
          managerNodeId: "divedra-manager",
          managerKind: "root-manager",
        },
      ),
    ).toThrow("use the owning subworkflow-manager instead");
  });

  test("enforces communication replay scope with legacy boundary fallback", () => {
    const workflow = makeWorkflow();

    expect(() =>
      assertCommunicationInManagerScope(
        {
          workflowId: "wf",
          workflowExecutionId: "sess-1",
          communicationId: "comm-legacy-sub",
          fromNodeId: "a-manager",
          toNodeId: "a-input",
          routingScope: "intra-sub-workflow",
          sourceNodeExecId: "exec-1",
          payloadRef: {
            workflowId: "wf",
            workflowExecutionId: "sess-1",
            outputNodeId: "a-manager",
            nodeExecId: "exec-1",
            artifactDir: "/tmp/out",
          },
          deliveryKind: "edge-transition",
          transitionWhen: "legacy",
          status: "delivered",
          deliveryAttemptIds: ["attempt-000001"],
          activeDeliveryAttemptId: "attempt-000001",
          createdAt: "2026-03-15T00:00:00.000Z",
          artifactDir: "/tmp/comm",
        },
        workflow,
        {
          managerNodeId: "a-manager",
          managerKind: "subworkflow-manager",
        },
        "test replay",
      ),
    ).not.toThrow();

    expect(() =>
      assertCommunicationInManagerScope(
        {
          workflowId: "wf",
          workflowExecutionId: "sess-1",
          communicationId: "comm-root",
          fromNodeId: "divedra-manager",
          toNodeId: "step-1",
          routingScope: "intra-sub-workflow",
          sourceNodeExecId: "exec-2",
          payloadRef: {
            workflowId: "wf",
            workflowExecutionId: "sess-1",
            outputNodeId: "divedra-manager",
            nodeExecId: "exec-2",
            artifactDir: "/tmp/out",
          },
          deliveryKind: "edge-transition",
          transitionWhen: "root",
          status: "delivered",
          deliveryAttemptIds: ["attempt-000001"],
          activeDeliveryAttemptId: "attempt-000001",
          createdAt: "2026-03-15T00:01:00.000Z",
          artifactDir: "/tmp/comm",
        },
        workflow,
        {
          managerNodeId: "a-manager",
          managerKind: "subworkflow-manager",
        },
        "test replay",
      ),
    ).toThrow("must stay within sub-workflow 'sw-a'");

    expect(() =>
      assertCommunicationInManagerScope(
        {
          workflowId: "wf",
          workflowExecutionId: "sess-1",
          communicationId: "comm-sub",
          fromNodeId: "a-manager",
          toNodeId: "a-input",
          routingScope: "intra-sub-workflow",
          sourceNodeExecId: "exec-3",
          payloadRef: {
            workflowId: "wf",
            workflowExecutionId: "sess-1",
            outputNodeId: "a-manager",
            nodeExecId: "exec-3",
            artifactDir: "/tmp/out",
          },
          deliveryKind: "edge-transition",
          transitionWhen: "sub",
          status: "delivered",
          deliveryAttemptIds: ["attempt-000001"],
          activeDeliveryAttemptId: "attempt-000001",
          createdAt: "2026-03-15T00:02:00.000Z",
          artifactDir: "/tmp/comm",
        },
        workflow,
        {
          managerNodeId: "divedra-manager",
          managerKind: "root-manager",
        },
        "test replay",
      ),
    ).toThrow("outside root-manager scope");
  });
});
