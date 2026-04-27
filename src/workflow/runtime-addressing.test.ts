import { describe, expect, test } from "vitest";
import {
  isRootScopeOutputNode,
  resolveBackendSessionSelection,
  resolveStepExecutionAddress,
  type StepExecutionAddress,
  toStepIdentityFields,
} from "./runtime-addressing";
import type { AgentNodePayload, WorkflowJson } from "./types";

function makeWorkflow(): WorkflowJson {
  return {
    workflowId: "demo",
    description: "runtime addressing test fixture",
    defaults: {
      nodeTimeoutMs: 120_000,
      maxLoopIterations: 3,
    },
    managerStepId: "manager-step",
    entryStepId: "manager-step",
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
        kind: "task",
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

describe("output scope helpers", () => {
  test("treats every output node as a publishable workflow output after legacy structural scope removal", () => {
    const workflow = makeWorkflow();
    expect(isRootScopeOutputNode(workflow, "root-output-step")).toBe(true);
    expect(isRootScopeOutputNode(workflow, "child-output-step")).toBe(true);
    expect(isRootScopeOutputNode(workflow, "writer-step")).toBe(false);
  });
});
