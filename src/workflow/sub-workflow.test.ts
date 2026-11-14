import { describe, expect, test } from "vitest";
import {
  planRootManagerSubWorkflowStarts,
  planSubWorkflowChildInputs,
} from "./sub-workflow";
import type { WorkflowSessionState } from "./session";
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
        inputSources: [{ type: "human-input" }],
      },
      {
        id: "sw-b",
        description: "B",
        managerNodeId: "b-manager",
        inputNodeId: "b-input",
        outputNodeId: "b-output",
        nodeIds: ["b-manager", "b-input", "b-output"],
        inputSources: [{ type: "sub-workflow-output", subWorkflowId: "sw-a" }],
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
      },
      {
        id: "a-output",
        nodeFile: "node-a-output.json",
        kind: "output",
        completion: { type: "none" },
      },
      {
        id: "b-manager",
        nodeFile: "node-b-manager.json",
        kind: "subworkflow-manager",
        completion: { type: "none" },
      },
      {
        id: "b-input",
        nodeFile: "node-b-input.json",
        kind: "input",
        completion: { type: "none" },
      },
      {
        id: "b-output",
        nodeFile: "node-b-output.json",
        kind: "output",
        completion: { type: "none" },
      },
    ],
    edges: [],
    loops: [],
    branching: { mode: "fan-out" },
  };
}

function makeSession(
  overrides: Partial<WorkflowSessionState> = {},
): WorkflowSessionState {
  return {
    sessionId: "sess-abc12345",
    workflowName: "wf",
    workflowId: "wf",
    status: "running",
    startedAt: "2026-02-24T00:00:00.000Z",
    queue: ["divedra-manager"],
    nodeExecutionCounter: 0,
    nodeExecutionCounts: {},
    loopIterationCounts: {},
    restartCounts: {},
    restartEvents: [],
    transitions: [],
    nodeExecutions: [],
    communicationCounter: 0,
    communications: [],
    runtimeVariables: {},
    ...overrides,
  };
}

describe("planRootManagerSubWorkflowStarts", () => {
  test("starts sub-workflow whose human-input source is available", () => {
    const workflow = makeWorkflow();
    const session = makeSession({
      runtimeVariables: { humanInput: { topic: "x" } },
    });
    const planned = planRootManagerSubWorkflowStarts({ workflow, session });
    expect(planned.map((entry) => entry.id)).toEqual(["sw-a"]);
  });

  test("starts dependent sub-workflow only after source sub-workflow output succeeded", () => {
    const workflow = makeWorkflow();
    const session = makeSession({
      runtimeVariables: { humanInput: { topic: "x" } },
      nodeExecutions: [
        {
          nodeId: "a-input",
          nodeExecId: "exec-000001",
          status: "succeeded",
          artifactDir: "/tmp/a-input",
          startedAt: "2026-02-24T00:00:00.000Z",
          endedAt: "2026-02-24T00:00:01.000Z",
        },
        {
          nodeId: "a-output",
          nodeExecId: "exec-000002",
          status: "succeeded",
          artifactDir: "/tmp/a-output",
          startedAt: "2026-02-24T00:00:02.000Z",
          endedAt: "2026-02-24T00:00:03.000Z",
        },
      ],
    });
    const planned = planRootManagerSubWorkflowStarts({ workflow, session });
    expect(planned.map((entry) => entry.id)).toEqual(["sw-b"]);
  });

  test("does not start a sub-workflow again while its manager is already queued", () => {
    const workflow = {
      ...makeWorkflow(),
      subWorkflows: [
        {
          ...makeWorkflow().subWorkflows[0]!,
          managerNodeId: "a-manager",
        },
      ],
      nodes: [
        ...makeWorkflow().nodes,
        {
          id: "a-manager",
          nodeFile: "node-a-manager.json",
          kind: "subworkflow-manager",
          completion: { type: "none" },
        },
      ],
    } satisfies WorkflowJson;
    const session = makeSession({
      queue: ["divedra-manager", "a-manager"],
      runtimeVariables: { humanInput: { topic: "x" } },
    });

    const planned = planRootManagerSubWorkflowStarts({ workflow, session });

    expect(planned).toEqual([]);
  });

  test("does not start a sub-workflow again while a start handoff is still delivered", () => {
    const workflow = {
      ...makeWorkflow(),
      subWorkflows: [
        {
          ...makeWorkflow().subWorkflows[0]!,
          managerNodeId: "a-manager",
        },
      ],
      nodes: [
        ...makeWorkflow().nodes,
        {
          id: "a-manager",
          nodeFile: "node-a-manager.json",
          kind: "subworkflow-manager",
          completion: { type: "none" },
        },
      ],
    } satisfies WorkflowJson;
    const session = makeSession({
      runtimeVariables: { humanInput: { topic: "x" } },
      communications: [
        {
          workflowId: "wf",
          workflowExecutionId: "sess-abc12345",
          communicationId: "comm-000001",
          fromNodeId: "divedra-manager",
          toNodeId: "a-manager",
          toSubWorkflowId: "sw-a",
          routingScope: "parent-to-sub-workflow",
          sourceNodeExecId: "exec-000001",
          payloadRef: {
            workflowExecutionId: "sess-abc12345",
            workflowId: "wf",
            outputNodeId: "divedra-manager",
            nodeExecId: "exec-000001",
            artifactDir: "/tmp/divedra-manager/exec-000001",
          },
          deliveryKind: "edge-transition",
          transitionWhen: "sub-workflow-start:sw-a",
          status: "delivered",
          deliveryAttemptIds: ["attempt-000001"],
          activeDeliveryAttemptId: "attempt-000001",
          createdAt: "2026-02-24T00:00:00.000Z",
          deliveredAt: "2026-02-24T00:00:00.000Z",
          artifactDir: "/tmp/communications/comm-000001",
        },
      ],
      communicationCounter: 1,
    });

    const planned = planRootManagerSubWorkflowStarts({ workflow, session });

    expect(planned).toEqual([]);
  });

  test("does not auto-start branch-block sub-workflows from generic root-manager planning", () => {
    const workflow = {
      ...makeWorkflow(),
      subWorkflows: [
        {
          ...makeWorkflow().subWorkflows[0]!,
          block: { type: "branch-block" as const },
        },
      ],
    } satisfies WorkflowJson;
    const session = makeSession({
      runtimeVariables: { humanInput: { topic: "x" } },
    });

    const planned = planRootManagerSubWorkflowStarts({ workflow, session });

    expect(planned).toEqual([]);
  });

  test("does not auto-start loop-body sub-workflows from generic root-manager planning", () => {
    const workflow = {
      ...makeWorkflow(),
      subWorkflows: [
        {
          ...makeWorkflow().subWorkflows[0]!,
          block: { type: "loop-body" as const, loopId: "main-loop" },
        },
      ],
      loops: [
        {
          id: "main-loop",
          judgeNodeId: "loop-judge",
          continueWhen: "continue_round",
          exitWhen: "loop_exit",
        },
      ],
      nodes: [
        ...makeWorkflow().nodes,
        {
          id: "loop-judge",
          nodeFile: "node-loop-judge.json",
          kind: "loop-judge",
          completion: { type: "none" },
        },
      ],
    } satisfies WorkflowJson;
    const session = makeSession({
      runtimeVariables: { humanInput: { topic: "x" } },
    });

    const planned = planRootManagerSubWorkflowStarts({ workflow, session });

    expect(planned).toEqual([]);
  });
});

describe("planSubWorkflowChildInputs", () => {
  test("queues the child input for a subworkflow-manager that owns a sub-workflow", () => {
    const workflow = makeWorkflow();
    const session = makeSession();
    const planned = planSubWorkflowChildInputs({
      workflow: {
        ...workflow,
        subWorkflows: [
          {
            ...workflow.subWorkflows[0]!,
            managerNodeId: "a-manager",
          },
        ],
      },
      session,
      managerNodeId: "a-manager",
    });
    expect(planned).toEqual(["a-input"]);
  });

  test("does not queue the child input again while it is already queued", () => {
    const workflow = makeWorkflow();
    const session = makeSession({
      queue: ["divedra-manager", "a-input"],
    });
    const planned = planSubWorkflowChildInputs({
      workflow: {
        ...workflow,
        subWorkflows: [
          {
            ...workflow.subWorkflows[0]!,
            managerNodeId: "a-manager",
          },
        ],
      },
      session,
      managerNodeId: "a-manager",
    });

    expect(planned).toEqual([]);
  });

  test("does not queue the child input again while a delivery is still pending", () => {
    const workflow = makeWorkflow();
    const session = makeSession({
      communications: [
        {
          workflowId: "wf",
          workflowExecutionId: "sess-abc12345",
          communicationId: "comm-000001",
          fromNodeId: "a-manager",
          toNodeId: "a-input",
          toSubWorkflowId: "sw-a",
          routingScope: "intra-sub-workflow",
          sourceNodeExecId: "exec-000001",
          payloadRef: {
            workflowExecutionId: "sess-abc12345",
            workflowId: "wf",
            subWorkflowId: "sw-a",
            outputNodeId: "a-output",
            nodeExecId: "exec-000001",
            artifactDir: "/tmp/a-output/exec-000001",
          },
          deliveryKind: "edge-transition",
          transitionWhen: "subworkflow-manager-input:a-input",
          status: "delivered",
          deliveryAttemptIds: ["attempt-000001"],
          activeDeliveryAttemptId: "attempt-000001",
          createdAt: "2026-02-24T00:00:00.000Z",
          deliveredAt: "2026-02-24T00:00:00.000Z",
          artifactDir: "/tmp/communications/comm-000001",
        },
      ],
      communicationCounter: 1,
    });
    const planned = planSubWorkflowChildInputs({
      workflow: {
        ...workflow,
        subWorkflows: [
          {
            ...workflow.subWorkflows[0]!,
            managerNodeId: "a-manager",
          },
        ],
      },
      session,
      managerNodeId: "a-manager",
    });

    expect(planned).toEqual([]);
  });

  test("allows the child input to be re-queued for later manager deliveries", () => {
    const workflow = makeWorkflow();
    const session = makeSession({
      nodeExecutions: [
        {
          nodeId: "a-input",
          nodeExecId: "exec-000001",
          status: "succeeded",
          artifactDir: "/tmp/a-input/exec-000001",
          startedAt: "2026-02-24T00:00:00.000Z",
          endedAt: "2026-02-24T00:00:01.000Z",
        },
      ],
    });
    const planned = planSubWorkflowChildInputs({
      workflow: {
        ...workflow,
        subWorkflows: [
          {
            ...workflow.subWorkflows[0]!,
            managerNodeId: "a-manager",
          },
        ],
      },
      session,
      managerNodeId: "a-manager",
    });

    expect(planned).toEqual(["a-input"]);
  });
});
