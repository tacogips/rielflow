import { describe, expect, test } from "vitest";
import {
  findOwningSubWorkflowByRuntimeNodeId,
  isRootScopeOutputNode,
  resolveBackendSessionSelection,
  resolveStepExecutionAddress,
  type StepExecutionAddress,
  toStepIdentityFields,
} from "./runtime-addressing";
import type { AgentNodePayload, SubWorkflowRef, WorkflowJson } from "./types";

type LegacyStructuralWorkflow = WorkflowJson & {
  readonly managerNodeId?: string;
  readonly entryNodeId?: string;
  readonly subWorkflows?: readonly SubWorkflowRef[];
  readonly edges?: readonly { from: string; to: string; when: string }[];
};

function makeWorkflow(): LegacyStructuralWorkflow {
  return {
    workflowId: "demo",
    description: "runtime addressing test fixture",
    defaults: {
      nodeTimeoutMs: 120_000,
      maxLoopIterations: 3,
    },
    managerNodeId: "manager-step",
    entryNodeId: "manager-step",
    managerStepId: "manager-step",
    entryStepId: "manager-step",
    subWorkflows: [
      {
        id: "child-flow",
        description: "child flow",
        managerNodeId: "child-manager-step",
        inputNodeId: "child-input-step",
        outputNodeId: "child-output-step",
        nodeIds: [
          "child-manager-step",
          "child-input-step",
          "child-worker-step",
          "child-output-step",
        ],
        inputSources: [],
      },
    ],
    nodes: [
      {
        id: "manager-step",
        nodeFile: "nodes/node-manager.json",
        kind: "root-manager",
      },
      {
        id: "writer-step",
        nodeFile: "nodes/node-writer.json",
        kind: "task",
      },
      {
        id: "root-output-step",
        nodeFile: "nodes/node-root-output.json",
        kind: "output",
      },
      {
        id: "child-manager-step",
        nodeFile: "nodes/node-child-manager.json",
        kind: "subworkflow-manager",
      },
      {
        id: "child-input-step",
        nodeFile: "nodes/node-child-input.json",
        kind: "input",
      },
      {
        id: "child-worker-step",
        nodeFile: "nodes/node-child-worker.json",
        kind: "task",
      },
      {
        id: "child-output-step",
        nodeFile: "nodes/node-child-output.json",
        kind: "output",
      },
    ],
    steps: [
      {
        id: "manager-step",
        nodeId: "manager-node",
        role: "manager",
        transitions: [{ toStepId: "writer-step" }],
      },
      {
        id: "writer-step",
        nodeId: "writer-node",
        promptVariant: "review",
        timeoutMs: 4_321,
        sessionPolicy: {
          mode: "reuse",
          inheritFromStepId: "manager-step",
        },
      },
      {
        id: "root-output-step",
        nodeId: "root-output-node",
      },
      {
        id: "child-manager-step",
        nodeId: "child-manager-node",
      },
      {
        id: "child-input-step",
        nodeId: "child-input-node",
      },
      {
        id: "child-worker-step",
        nodeId: "child-worker-node",
      },
      {
        id: "child-output-step",
        nodeId: "child-output-node",
      },
    ],
    edges: [],
  };
}

describe("resolveStepExecutionAddress", () => {
  test("returns step-scoped execution metadata for materialized runtime nodes", () => {
    expect(resolveStepExecutionAddress(makeWorkflow(), "writer-step")).toEqual({
      stepId: "writer-step",
      nodeRegistryId: "writer-node",
      promptVariant: "review",
      timeoutMs: 4_321,
      inheritFromStepId: "manager-step",
    });
  });

  test("returns an empty address for unknown runtime nodes", () => {
    expect(resolveStepExecutionAddress(makeWorkflow(), "missing-step")).toEqual(
      {},
    );
  });
});

describe("resolveBackendSessionSelection", () => {
  test("preserves the shared-node session lineage for reusable steps", () => {
    const stepExecutionAddress = resolveStepExecutionAddress(
      makeWorkflow(),
      "writer-step",
    );
    const reusableNode: AgentNodePayload = {
      id: "writer-step",
      nodeType: "agent",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "write code",
      variables: {},
      sessionPolicy: {
        mode: "reuse",
      },
    };

    expect(
      resolveBackendSessionSelection(stepExecutionAddress, reusableNode),
    ).toEqual({
      sessionLookupNodeId: "manager-step",
      inheritFromStepId: "manager-step",
      nodeRegistryId: "writer-node",
      stepId: "writer-step",
      promptVariant: "review",
    });
  });

  test("returns no selection metadata when the node does not reuse a session", () => {
    const stepExecutionAddress = resolveStepExecutionAddress(
      makeWorkflow(),
      "writer-step",
    );
    const freshNode: AgentNodePayload = {
      id: "writer-step",
      nodeType: "agent",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "write code",
      variables: {},
      sessionPolicy: {
        mode: "new",
      },
    };

    expect(
      resolveBackendSessionSelection(stepExecutionAddress, freshNode),
    ).toEqual({});
  });
});

describe("toStepIdentityFields", () => {
  test("returns only the execution identity fields used across runtime records", () => {
    const executionAddress: StepExecutionAddress = {
      stepId: "writer-step",
      nodeRegistryId: "writer-node",
      promptVariant: "review",
    };
    expect(toStepIdentityFields(executionAddress)).toEqual({
      stepId: "writer-step",
      nodeRegistryId: "writer-node",
    });
  });
});

describe("sub-workflow ownership helpers", () => {
  test("finds the owning structural sub-workflow for runtime node ids", () => {
    const workflow = makeWorkflow();
    expect(
      findOwningSubWorkflowByRuntimeNodeId(workflow, "child-worker-step")?.id,
    ).toBe("child-flow");
    expect(
      findOwningSubWorkflowByRuntimeNodeId(workflow, "child-manager-step")?.id,
    ).toBe("child-flow");
    expect(
      findOwningSubWorkflowByRuntimeNodeId(workflow, "manager-step"),
    ).toBeUndefined();
  });

  test("detects only root-scope output steps as publishable root outputs", () => {
    const workflow = makeWorkflow();
    expect(isRootScopeOutputNode(workflow, "root-output-step")).toBe(true);
    expect(isRootScopeOutputNode(workflow, "child-output-step")).toBe(false);
    expect(isRootScopeOutputNode(workflow, "writer-step")).toBe(false);
  });
});
