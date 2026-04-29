import { describe, expect, test } from "vitest";
import {
  composeExecutionPrompt,
  composeExecutionPrompts,
} from "./prompt-composition";
import type {
  NodePayload,
  WorkflowJson,
  WorkflowNodeRef,
} from "./types";

function makeWorkflow(): WorkflowJson {
  return {
    workflowId: "wf",
    description: "Ship a release safely.",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    prompts: {
      divedraPromptTemplate: "Plan {{topic}} carefully.",
      workerSystemPromptTemplate: "Execute {{topic}} precisely.",
    },
    entryStepId: "manager-step",
    managerStepId: "manager-step",
    nodeRegistry: [
      { id: "manager-step", nodeFile: "node-manager.json" },
      { id: "worker-step", nodeFile: "node-worker.json" },
    ],
    steps: [
      { id: "manager-step", nodeId: "manager-step", role: "manager" },
      { id: "worker-step", nodeId: "worker-step", role: "worker" },
    ],
    nodes: [
      { id: "manager-step", nodeFile: "node-manager.json", role: "manager" },
      { id: "worker-step", nodeFile: "node-worker.json", role: "worker" },
    ],
  };
}

function makeNode(overrides: Partial<NodePayload> = {}): NodePayload {
  return {
    id: "worker-step",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "Implement the release step.",
    variables: {},
    ...overrides,
  };
}

function composeFor(input: {
  readonly nodeRef: WorkflowNodeRef;
  readonly node: NodePayload;
  readonly includeSessionStartPrompt?: boolean;
  readonly managerMessage?: unknown;
}) {
  return composeExecutionPrompts({
    includeSessionStartPrompt: input.includeSessionStartPrompt ?? false,
    promptComposition: {
      workflow: makeWorkflow(),
      nodeRef: input.nodeRef,
      node: input.node,
      nodePayloads: {
        [input.nodeRef.id]: input.node,
      },
      runtimeVariables: { topic: "release" },
      basePromptText: input.node.promptTemplate ?? "",
      assembledArguments: null,
      upstreamInputs: [],
      ...(input.managerMessage === undefined
        ? {}
        : { managerMessage: input.managerMessage }),
    },
  });
}

describe("composeExecutionPrompts", () => {
  test("uses worker system guidance for worker steps", () => {
    const prompts = composeFor({
      nodeRef: {
        id: "worker-step",
        nodeFile: "node-worker.json",
        role: "worker",
      },
      node: makeNode({
        systemPromptTemplate: "Follow the worker checklist.",
      }),
    });

    expect(prompts.systemPromptText).toContain("Execute release precisely.");
    expect(prompts.systemPromptText).toContain("Follow the worker checklist.");
    expect(prompts.promptText).toContain("Node-specific instruction:");
    expect(prompts.promptText).toContain("Implement the release step.");
  });

  test("uses manager system guidance for manager steps", () => {
    const prompts = composeFor({
      nodeRef: {
        id: "manager-step",
        nodeFile: "node-manager.json",
        role: "manager",
      },
      node: makeNode({
        id: "manager-step",
        promptTemplate: "Plan the overall workflow.",
      }),
    });

    expect(prompts.systemPromptText).toContain("Plan release carefully.");
    expect(prompts.promptText).toContain("Node kind: manager");
    expect(prompts.promptText).toContain("Plan the overall workflow.");
  });

  test("includes managerMessage in the composed prompt", () => {
    const promptText = composeExecutionPrompt({
      workflow: makeWorkflow(),
      nodeRef: {
        id: "worker-step",
        nodeFile: "node-worker.json",
        role: "worker",
      },
      node: makeNode(),
      nodePayloads: {
        "worker-step": makeNode(),
      },
      runtimeVariables: { topic: "release" },
      basePromptText: "Implement the release step.",
      assembledArguments: null,
      upstreamInputs: [],
      managerMessage: { instruction: "Use the hotfix branch." },
    });

    expect(promptText).toContain("Manager inbox message:");
    expect(promptText).toContain("Use the hotfix branch.");
  });
});
