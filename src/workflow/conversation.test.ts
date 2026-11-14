import { describe, expect, test } from "vitest";
import { executeConversationRound } from "./conversation";
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
    subWorkflowConversations: [
      {
        id: "conv-1",
        participants: ["sw-a", "sw-b"],
        maxTurns: 3,
        stopWhen: "done",
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

function makeSession(): WorkflowSessionState {
  return {
    sessionId: "sess-abc12345",
    workflowName: "wf",
    workflowId: "wf",
    status: "running",
    startedAt: "2026-02-24T00:00:00.000Z",
    queue: [],
    nodeExecutionCounter: 0,
    nodeExecutionCounts: {},
    loopIterationCounts: {},
    restartCounts: {},
    restartEvents: [],
    transitions: [],
    communicationCounter: 0,
    communications: [],
    nodeExecutions: [
      {
        nodeId: "a-output",
        nodeExecId: "exec-000001",
        status: "succeeded",
        artifactDir: "/tmp/a-output/exec-000001",
        startedAt: "2026-02-24T00:00:00.000Z",
        endedAt: "2026-02-24T00:00:01.000Z",
      },
    ],
    conversationTurns: [],
    runtimeVariables: {},
  };
}

describe("executeConversationRound", () => {
  test("routes a turn from latest sender output to next participant", async () => {
    const result = await executeConversationRound({
      workflow: makeWorkflow(),
      workflowExecutionId: "wfexec-000001",
      session: makeSession(),
    });

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]?.fromSubWorkflowId).toBe("sw-a");
    expect(result.turns[0]?.toSubWorkflowId).toBe("sw-b");
    expect(result.turns[0]?.fromManagerNodeId).toBe("a-manager");
    expect(result.turns[0]?.toManagerNodeId).toBe("b-manager");
    expect(result.turns[0]?.outputRef["nodeExecId"]).toBe("exec-000001");
  });

  test("stops when stopWhen condition evaluates true", async () => {
    const workflow = {
      ...makeWorkflow(),
      subWorkflowConversations: [
        {
          id: "conv-1",
          participants: ["sw-a", "sw-b"],
          maxTurns: 3,
          stopWhen: "has_sender_output",
        },
      ],
    };

    const result = await executeConversationRound({
      workflow,
      workflowExecutionId: "wfexec-000001",
      session: makeSession(),
    });

    expect(result.status).toBe("stopped");
    expect(result.turns).toHaveLength(0);
  });

  test("continues a later turn even after the receiver input node ran previously", async () => {
    const session = {
      ...makeSession(),
      nodeExecutions: [
        ...makeSession().nodeExecutions,
        {
          nodeId: "b-input",
          nodeExecId: "exec-000002",
          status: "succeeded" as const,
          artifactDir: "/tmp/b-input/exec-000002",
          startedAt: "2026-02-24T00:00:02.000Z",
          endedAt: "2026-02-24T00:00:03.000Z",
        },
        {
          nodeId: "b-output",
          nodeExecId: "exec-000003",
          status: "succeeded" as const,
          artifactDir: "/tmp/b-output/exec-000003",
          startedAt: "2026-02-24T00:00:04.000Z",
          endedAt: "2026-02-24T00:00:05.000Z",
        },
      ],
      conversationTurns: [
        {
          conversationId: "conv-1",
          turnIndex: 1,
          fromSubWorkflowId: "sw-a",
          toSubWorkflowId: "sw-b",
          fromManagerNodeId: "a-manager",
          toManagerNodeId: "b-manager",
          communicationId: "comm-000001",
          outputRef: {
            workflowExecutionId: "wfexec-000001",
            workflowId: "wf",
            subWorkflowId: "sw-a",
            outputNodeId: "a-output",
            nodeExecId: "exec-000001",
            artifactDir: "/tmp/a-output/exec-000001",
          },
          sentAt: "2026-02-24T00:00:01.500Z",
        },
      ],
    } satisfies WorkflowSessionState;

    const result = await executeConversationRound({
      workflow: makeWorkflow(),
      workflowExecutionId: "wfexec-000001",
      session,
    });

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]?.fromSubWorkflowId).toBe("sw-b");
    expect(result.turns[0]?.toSubWorkflowId).toBe("sw-a");
    expect(result.turns[0]?.outputRef.nodeExecId).toBe("exec-000003");
  });

  test("does not replay the same sender output as a later turn", async () => {
    const session = {
      ...makeSession(),
      conversationTurns: [
        {
          conversationId: "conv-1",
          turnIndex: 1,
          fromSubWorkflowId: "sw-a",
          toSubWorkflowId: "sw-b",
          fromManagerNodeId: "a-manager",
          toManagerNodeId: "b-manager",
          communicationId: "comm-000001",
          outputRef: {
            workflowExecutionId: "wfexec-000001",
            workflowId: "wf",
            subWorkflowId: "sw-a",
            outputNodeId: "a-output",
            nodeExecId: "exec-000001",
            artifactDir: "/tmp/a-output/exec-000001",
          },
          sentAt: "2026-02-24T00:00:01.500Z",
        },
        {
          conversationId: "conv-1",
          turnIndex: 2,
          fromSubWorkflowId: "sw-b",
          toSubWorkflowId: "sw-a",
          fromManagerNodeId: "b-manager",
          toManagerNodeId: "a-manager",
          communicationId: "comm-000002",
          outputRef: {
            workflowExecutionId: "wfexec-000001",
            workflowId: "wf",
            subWorkflowId: "sw-b",
            outputNodeId: "b-output",
            nodeExecId: "exec-000003",
            artifactDir: "/tmp/b-output/exec-000003",
          },
          sentAt: "2026-02-24T00:00:05.500Z",
        },
      ],
      nodeExecutions: [
        ...makeSession().nodeExecutions,
        {
          nodeId: "b-output",
          nodeExecId: "exec-000003",
          status: "succeeded" as const,
          artifactDir: "/tmp/b-output/exec-000003",
          startedAt: "2026-02-24T00:00:04.000Z",
          endedAt: "2026-02-24T00:00:05.000Z",
        },
      ],
    } satisfies WorkflowSessionState;

    const result = await executeConversationRound({
      workflow: makeWorkflow(),
      workflowExecutionId: "wfexec-000001",
      session,
    });

    expect(result.turns).toEqual([]);
  });

  test("waits for the receiver to produce a fresh output before the next turn", async () => {
    const session = {
      ...makeSession(),
      conversationTurns: [
        {
          conversationId: "conv-1",
          turnIndex: 1,
          fromSubWorkflowId: "sw-a",
          toSubWorkflowId: "sw-b",
          fromManagerNodeId: "a-manager",
          toManagerNodeId: "b-manager",
          communicationId: "comm-000001",
          outputRef: {
            workflowExecutionId: "wfexec-000001",
            workflowId: "wf",
            subWorkflowId: "sw-a",
            outputNodeId: "a-output",
            nodeExecId: "exec-000002",
            artifactDir: "/tmp/a-output/exec-000002",
          },
          sentAt: "2026-02-24T00:00:06.000Z",
        },
      ],
      nodeExecutions: [
        {
          nodeId: "a-output",
          nodeExecId: "exec-000002",
          status: "succeeded" as const,
          artifactDir: "/tmp/a-output/exec-000002",
          startedAt: "2026-02-24T00:00:04.000Z",
          endedAt: "2026-02-24T00:00:05.000Z",
        },
        {
          nodeId: "b-output",
          nodeExecId: "exec-000001",
          status: "succeeded" as const,
          artifactDir: "/tmp/b-output/exec-000001",
          startedAt: "2026-02-24T00:00:01.000Z",
          endedAt: "2026-02-24T00:00:02.000Z",
        },
      ],
    } satisfies WorkflowSessionState;

    const result = await executeConversationRound({
      workflow: makeWorkflow(),
      workflowExecutionId: "wfexec-000001",
      session,
    });

    expect(result.turns).toEqual([]);
  });

  test("exposes turns_exhausted before the final permitted turn is sent", async () => {
    const workflow = {
      ...makeWorkflow(),
      subWorkflowConversations: [
        {
          id: "conv-1",
          participants: ["sw-a", "sw-b"],
          maxTurns: 1,
          stopWhen: "turns_exhausted",
        },
      ],
    };

    const result = await executeConversationRound({
      workflow,
      workflowExecutionId: "wfexec-000001",
      session: makeSession(),
    });

    expect(result.status).toBe("stopped");
    expect(result.turns).toEqual([]);
  });

  test("reports stopped when a conversation is waiting for a fresh sender output", async () => {
    const session = {
      ...makeSession(),
      conversationTurns: [
        {
          conversationId: "conv-1",
          turnIndex: 1,
          fromSubWorkflowId: "sw-a",
          toSubWorkflowId: "sw-b",
          fromManagerNodeId: "a-manager",
          toManagerNodeId: "b-manager",
          communicationId: "comm-000001",
          outputRef: {
            workflowExecutionId: "wfexec-000001",
            workflowId: "wf",
            subWorkflowId: "sw-a",
            outputNodeId: "a-output",
            nodeExecId: "exec-000001",
            artifactDir: "/tmp/a-output/exec-000001",
          },
          sentAt: "2026-02-24T00:00:01.500Z",
        },
      ],
    } satisfies WorkflowSessionState;

    const result = await executeConversationRound({
      workflow: makeWorkflow(),
      workflowExecutionId: "wfexec-000001",
      session,
    });

    expect(result.status).toBe("stopped");
    expect(result.turns).toEqual([]);
  });
});
