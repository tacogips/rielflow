import { describe, expect, test } from "vitest";
import { buildNodeExecutionMailbox } from "./node-execution-mailbox";
import {
  composeExecutionPrompt,
  composeExecutionPrompts,
} from "./prompt-composition";
import type { NodePayload, WorkflowJson, WorkflowNodeRef } from "./types";

function makeWorkflow(): WorkflowJson {
  return {
    workflowId: "wf",
    description: "Ship a release safely.",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    prompts: {
      divedraPromptTemplate: "Plan {{topic}} carefully.",
      workerSystemPromptTemplate: "Execute {{topic}} precisely.",
    },
    managerNodeId: "divedra-manager",
    subWorkflows: [
      {
        id: "main",
        description: "Main delivery path",
        managerNodeId: "main-divedra",
        inputNodeId: "workflow-input",
        outputNodeId: "workflow-output",
        nodeIds: [
          "main-divedra",
          "workflow-input",
          "implement",
          "workflow-output",
        ],
        inputSources: [{ type: "human-input" }],
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
        id: "main-divedra",
        nodeFile: "node-main-divedra.json",
        kind: "subworkflow-manager",
        completion: { type: "none" },
      },
      {
        id: "workflow-input",
        nodeFile: "node-workflow-input.json",
        kind: "input",
        completion: { type: "none" },
      },
      {
        id: "implement",
        nodeFile: "node-implement.json",
        kind: "task",
        completion: { type: "none" },
      },
      {
        id: "workflow-output",
        nodeFile: "node-workflow-output.json",
        kind: "output",
        completion: { type: "none" },
      },
    ],
    edges: [{ from: "workflow-input", to: "implement", when: "always" }],
    loops: [],
    branching: { mode: "fan-out" },
  };
}

function makeRoleWorkflow(): WorkflowJson {
  return {
    workflowId: "role-wf",
    description: "Coordinate a direct manager-worker workflow.",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    prompts: {
      divedraPromptTemplate: "Plan {{topic}} carefully.",
      workerSystemPromptTemplate: "Execute {{topic}} precisely.",
    },
    managerNodeId: "divedra-manager",
    workflowCalls: [
      {
        id: "review-call",
        workflowId: "review-target",
        callerNodeId: "implement",
        resultNodeId: "publish",
      },
    ],
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
        role: "manager",
      },
      {
        id: "implement",
        nodeFile: "node-implement.json",
        role: "worker",
      },
      {
        id: "publish",
        nodeFile: "node-publish.json",
        role: "worker",
      },
    ],
    edges: [{ from: "implement", to: "publish", when: "always" }],
    loops: [],
    branching: { mode: "fan-out" },
  };
}

function makeNode(overrides: Partial<NodePayload> = {}): NodePayload {
  return {
    id: "implement",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "Implement the release step.",
    variables: {},
    ...overrides,
  };
}

function makeNodePayloads(): Readonly<Record<string, NodePayload>> {
  return {
    "divedra-manager": {
      id: "divedra-manager",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "Plan the overall workflow.",
      variables: {},
    },
    "main-divedra": {
      id: "main-divedra",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate:
        "Translate the parent instruction into child workflow work.",
      variables: {},
    },
    "workflow-input": {
      id: "workflow-input",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "Normalize the received instruction into workflow input.",
      variables: {},
    },
    implement: makeNode(),
    "workflow-output": {
      id: "workflow-output",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "Assemble the final workflow output.",
      variables: {},
      output: {
        description: "Return the completed release package summary.",
      },
    },
  };
}

function makeNodeRef(
  overrides: Partial<WorkflowNodeRef> = {},
): WorkflowNodeRef {
  return {
    id: "implement",
    nodeFile: "node-implement.json",
    kind: "task",
    completion: { type: "none" },
    ...overrides,
  };
}

describe("composeExecutionPrompt", () => {
  test("includes explicit given data for the execution", () => {
    const prompt = composeExecutionPrompt({
      workflow: makeWorkflow(),
      nodeRef: makeNodeRef(),
      node: makeNode(),
      nodePayloads: makeNodePayloads(),
      runtimeVariables: { topic: "release" },
      basePromptText: "Implement the release step.",
      assembledArguments: {
        task: {
          repository: "divedra",
          target: "release",
        },
      },
      upstreamInputs: [],
    });

    expect(prompt).toContain("Given data:");
    expect(prompt).toContain('"repository":"divedra"');
    expect(prompt).toContain('"target":"release"');
  });

  test("exposes top-level human input to the root manager without custom argument bindings", () => {
    const prompt = composeExecutionPrompt({
      workflow: makeWorkflow(),
      nodeRef: makeNodeRef({
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
        kind: "root-manager",
      }),
      node: makeNodePayloads()["divedra-manager"] as NodePayload,
      nodePayloads: makeNodePayloads(),
      runtimeVariables: {
        topic: "release",
        humanInput: {
          request: "ship version 1.2.3",
          constraints: ["run tests", "update changelog"],
        },
      },
      basePromptText: "Plan the overall workflow.",
      assembledArguments: null,
      upstreamInputs: [],
    });

    expect(prompt).toContain("Given data:");
    expect(prompt).toContain("humanInput=");
    expect(prompt).toContain('"request":"ship version 1.2.3"');
    expect(prompt).toContain('"constraints":["run tests","update changelog"]');
  });

  test("recognizes sub-workflow scope for internal nodes declared in nodeIds", () => {
    const prompt = composeExecutionPrompt({
      workflow: makeWorkflow(),
      nodeRef: makeNodeRef(),
      node: makeNode(),
      nodePayloads: makeNodePayloads(),
      runtimeVariables: { topic: "release" },
      basePromptText: "Implement the release step.",
      assembledArguments: null,
      upstreamInputs: [],
    });

    expect(prompt).toContain("Current sub-workflow scope:");
    expect(prompt).toContain("- Sub-workflow: main");
    expect(prompt).toContain(
      "- Owned nodes: main-divedra, workflow-input, workflow-output, implement",
    );
  });

  test("includes sub-workflow boundary nodes even when nodeIds omits them", () => {
    const workflow = makeWorkflow();
    const prompt = composeExecutionPrompt({
      workflow: {
        ...workflow,
        subWorkflows: workflow.subWorkflows.map((entry) => ({
          ...entry,
          nodeIds: ["implement"],
        })),
      },
      nodeRef: makeNodeRef(),
      node: makeNode(),
      nodePayloads: makeNodePayloads(),
      runtimeVariables: { topic: "release" },
      basePromptText: "Implement the release step.",
      assembledArguments: null,
      upstreamInputs: [],
    });

    expect(prompt).toContain(
      "- Owned nodes: main-divedra, workflow-input, workflow-output, implement",
    );
  });

  test("includes managed child catalog for the root manager", () => {
    const prompt = composeExecutionPrompt({
      workflow: makeWorkflow(),
      nodeRef: makeNodeRef({
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
        kind: "root-manager",
      }),
      node: makeNodePayloads()["divedra-manager"] as NodePayload,
      nodePayloads: makeNodePayloads(),
      runtimeVariables: { topic: "release" },
      basePromptText: "Plan the overall workflow.",
      assembledArguments: null,
      upstreamInputs: [],
    });

    expect(prompt).toContain("Managed children in current scope:");
    expect(prompt).toContain("- Child sub-workflow: main");
    expect(prompt).toContain(
      "handoff=Parent manager output is delivered by mailbox",
    );
    expect(prompt).toContain(
      "expectedReturn=Return the completed release package summary.",
    );
    expect(prompt).not.toContain(
      "- Child node: main-divedra (subworkflow-manager)",
    );
    expect(prompt).not.toContain("- Child node: workflow-input (input)");
    expect(prompt).not.toContain("- Child node: workflow-output (output)");
  });

  test("treats role-authored managers as manager prompts instead of worker prompts", () => {
    const workflow = makeRoleWorkflow();
    const prompts = composeExecutionPrompts({
      promptComposition: {
        workflow,
        nodeRef: {
          id: "divedra-manager",
          nodeFile: "node-divedra-manager.json",
          role: "manager",
        },
        node: makeNodePayloads()["divedra-manager"] as NodePayload,
        nodePayloads: {
          "divedra-manager": makeNodePayloads()[
            "divedra-manager"
          ] as NodePayload,
          implement: makeNode(),
          publish: {
            id: "publish",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "Publish the reviewed release.",
            variables: {},
          },
        },
        runtimeVariables: { topic: "release" },
        basePromptText: "Plan the overall workflow.",
        assembledArguments: null,
        upstreamInputs: [],
      },
      includeSessionStartPrompt: false,
    });

    expect(prompts.systemPromptText).toContain("Plan release carefully.");
    expect(prompts.systemPromptText).not.toContain(
      "Execute release precisely.",
    );
    expect(prompts.systemPromptText).toContain(
      "Manage only the current workflow execution.",
    );
    expect(prompts.systemPromptText).not.toContain(
      "sub-workflow manager to treat the received instruction",
    );
    expect(prompts.promptText).toContain("Manager control payload:");
    expect(prompts.promptText).toContain("Managed children in current scope:");
    expect(prompts.promptText).toContain("Node kind: manager");
  });

  test("uses role-local manager control guidance for role-authored workflows", () => {
    const workflow = makeRoleWorkflow();
    const prompt = composeExecutionPrompt({
      workflow,
      nodeRef: {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
        role: "manager",
      },
      node: makeNodePayloads()["divedra-manager"] as NodePayload,
      nodePayloads: {
        "divedra-manager": makeNodePayloads()["divedra-manager"] as NodePayload,
        implement: makeNode(),
        publish: {
          id: "publish",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "Publish the reviewed release.",
          variables: {},
        },
      },
      runtimeVariables: { topic: "release" },
      basePromptText: "Plan the overall workflow.",
      assembledArguments: null,
      upstreamInputs: [],
    });

    expect(prompt).toContain(
      "workflow-call decisions, output assessment, and retry decisions",
    );
    expect(prompt).toContain('"type":"retry-node","nodeId":"<node-id>"');
    expect(prompt).toContain(
      '"type":"replay-communication","communicationId":"<communication-id>"',
    );
    expect(prompt).toContain(
      '"type":"execute-optional-node","nodeId":"<node-id>"',
    );
    expect(prompt).toContain(
      '"type":"skip-optional-node","nodeId":"<node-id>"',
    );
    expect(prompt).toContain(
      "Explicit `workflowCalls` run automatically from authored caller nodes",
    );
    expect(prompt).not.toContain('"type":"start-sub-workflow"');
    expect(prompt).not.toContain('"type":"deliver-to-child-input"');
    expect(prompt).not.toContain("sub-workflow dispatch");
    expect(prompt).not.toContain("Sub-workflows:");
    expect(prompt).not.toContain("Sub-workflows: none declared");
  });

  test("keeps structural manager system guidance for explicit subworkflow compatibility bundles", () => {
    const prompts = composeExecutionPrompts({
      promptComposition: {
        workflow: makeWorkflow(),
        nodeRef: makeNodeRef({
          id: "divedra-manager",
          nodeFile: "node-divedra-manager.json",
          kind: "root-manager",
        }),
        node: makeNodePayloads()["divedra-manager"] as NodePayload,
        nodePayloads: makeNodePayloads(),
        runtimeVariables: { topic: "release" },
        basePromptText: "Plan the overall workflow.",
        assembledArguments: null,
        upstreamInputs: [],
      },
      includeSessionStartPrompt: false,
    });

    expect(prompts.systemPromptText).toContain(
      "current workflow or sub-workflow scope",
    );
    expect(prompts.systemPromptText).toContain(
      "Treat a sub-workflow as one node from the parent perspective",
    );
  });

  test("includes managed child node catalog for a subworkflow-manager", () => {
    const prompt = composeExecutionPrompt({
      workflow: makeWorkflow(),
      nodeRef: makeNodeRef({
        id: "main-divedra",
        nodeFile: "node-main-divedra.json",
        kind: "subworkflow-manager",
      }),
      node: makeNodePayloads()["main-divedra"] as NodePayload,
      nodePayloads: makeNodePayloads(),
      runtimeVariables: { topic: "release" },
      basePromptText:
        "Translate the parent instruction into child workflow work.",
      assembledArguments: null,
      upstreamInputs: [],
    });

    expect(prompt).toContain("Managed children in current scope:");
    expect(prompt).toContain("- Child node: workflow-input (input)");
    expect(prompt).toContain("- Child node: implement (task)");
    expect(prompt).toContain(
      "promptSeed=Normalize the received instruction into workflow input.",
    );
    expect(prompt).toContain("promptSeed=Implement the release step.");
  });

  test("renders workflow metadata inside worker system prompts", () => {
    const workflow = makeWorkflow();
    const prompts = composeExecutionPrompts({
      promptComposition: {
        workflow: {
          ...workflow,
          prompts: {
            ...workflow.prompts,
            workerSystemPromptTemplate:
              "Execute workflow={{workflowId}} purpose={{workflowDescription}} node={{nodeId}} kind={{nodeKind}}.",
          },
        },
        nodeRef: makeNodeRef({
          id: "workflow-input",
          nodeFile: "node-workflow-input.json",
          kind: "input",
        }),
        node: makeNodePayloads()["workflow-input"] as NodePayload,
        nodePayloads: makeNodePayloads(),
        runtimeVariables: {},
        basePromptText:
          "Normalize the received instruction into workflow input.",
        assembledArguments: null,
        upstreamInputs: [],
      },
      includeSessionStartPrompt: false,
    });

    expect(prompts.systemPromptText).toContain(
      "Execute workflow=wf purpose=Ship a release safely. node=workflow-input kind=input.",
    );
  });

  test("uses worker for role-authored worker nodeKind metadata", () => {
    const workflow = makeWorkflow();
    const prompts = composeExecutionPrompts({
      promptComposition: {
        workflow: {
          ...workflow,
          prompts: {
            ...workflow.prompts,
            workerSystemPromptTemplate:
              "Execute workflow={{workflowId}} node={{nodeId}} kind={{nodeKind}}.",
          },
        },
        nodeRef: {
          id: "implement",
          nodeFile: "node-implement.json",
          role: "worker",
        },
        node: makeNode(),
        nodePayloads: makeNodePayloads(),
        runtimeVariables: {},
        basePromptText: "Implement the release step.",
        assembledArguments: null,
        upstreamInputs: [],
      },
      includeSessionStartPrompt: false,
    });

    expect(prompts.systemPromptText).toContain(
      "Execute workflow=wf node=implement kind=worker.",
    );
  });

  test("does not allow runtime or node variables to override workflow metadata in prompt templates", () => {
    const workflow = makeWorkflow();
    const prompts = composeExecutionPrompts({
      promptComposition: {
        workflow: {
          ...workflow,
          prompts: {
            ...workflow.prompts,
            workerSystemPromptTemplate:
              "Execute workflow={{workflowId}} purpose={{workflowDescription}} node={{nodeId}} kind={{nodeKind}}.",
          },
        },
        nodeRef: makeNodeRef({
          id: "workflow-input",
          nodeFile: "node-workflow-input.json",
          kind: "input",
        }),
        node: {
          ...(makeNodePayloads()["workflow-input"] as NodePayload),
          variables: {
            workflowId: "spoofed-node-workflow",
            workflowDescription: "spoofed-node-description",
            nodeId: "spoofed-node-id",
            nodeKind: "spoofed-node-kind",
          },
        },
        nodePayloads: makeNodePayloads(),
        runtimeVariables: {
          workflowId: "spoofed-runtime-workflow",
          workflowDescription: "spoofed-runtime-description",
          nodeId: "spoofed-runtime-node",
          nodeKind: "spoofed-runtime-kind",
        },
        basePromptText:
          "Normalize the received instruction into workflow input.",
        assembledArguments: null,
        upstreamInputs: [],
      },
      includeSessionStartPrompt: false,
    });

    expect(prompts.systemPromptText).toContain(
      "Execute workflow=wf purpose=Ship a release safely. node=workflow-input kind=input.",
    );
    expect(prompts.systemPromptText).not.toContain("spoofed-node");
    expect(prompts.systemPromptText).not.toContain("spoofed-runtime");
  });

  test("renders inbox variables inside workflow-level manager prompts", () => {
    const workflow = makeWorkflow();
    const prompts = composeExecutionPrompts({
      promptComposition: {
        workflow: {
          ...workflow,
          prompts: {
            ...workflow.prompts,
            divedraPromptTemplate:
              "If inboxCount={{inbox.count}} latestSender={{inbox.latest.fromNodeId}}, prefer divedra gql.",
          },
        },
        nodeRef: makeNodeRef({
          id: "main-divedra",
          nodeFile: "node-main-divedra.json",
          kind: "subworkflow-manager",
        }),
        node: makeNodePayloads()["main-divedra"] as NodePayload,
        nodePayloads: makeNodePayloads(),
        runtimeVariables: {},
        basePromptText:
          "Translate the parent instruction into child workflow work.",
        assembledArguments: null,
        upstreamInputs: [
          {
            fromNodeId: "divedra-manager",
            transitionWhen: "always",
            communicationId: "comm-000001",
            output: {
              payload: {
                request: "ship the release",
              },
            },
            outputRaw:
              '{"provider":"mock","payload":{"request":"ship the release"}}\n',
          },
        ],
      },
      includeSessionStartPrompt: false,
    });

    expect(prompts.systemPromptText).toContain(
      "If inboxCount=1 latestSender=divedra-manager, prefer divedra gql.",
    );
  });

  test("renders node-level system and first-session-only prompts separately", () => {
    const prompts = composeExecutionPrompts({
      promptComposition: {
        workflow: makeWorkflow(),
        nodeRef: makeNodeRef(),
        node: makeNode({
          systemPromptTemplate: "Take the {{stance}} position.",
          sessionStartPromptTemplate: "##prompt\n{{prompt}}\n## args\n{{args}}",
          variables: { stance: "affirmative" },
        }),
        nodePayloads: makeNodePayloads(),
        runtimeVariables: { topic: "release" },
        basePromptText: "Implement the release step.",
        assembledArguments: {
          task: {
            repository: "divedra",
          },
        },
        upstreamInputs: [],
      },
      includeSessionStartPrompt: true,
    });

    expect(prompts.systemPromptText).toContain(
      "Take the affirmative position.",
    );
    expect(prompts.promptText).toContain(
      "##prompt\nImplement the release step.",
    );
    expect(prompts.promptText).toContain('"repository":"divedra"');
  });

  test("omits the first-session-only prompt after the first turn", () => {
    const prompts = composeExecutionPrompts({
      promptComposition: {
        workflow: makeWorkflow(),
        nodeRef: makeNodeRef(),
        node: makeNode({
          sessionStartPromptTemplate: "##prompt\n{{prompt}}\n## args\n{{args}}",
        }),
        nodePayloads: makeNodePayloads(),
        runtimeVariables: { topic: "release" },
        basePromptText: "Implement the release step.",
        assembledArguments: {
          task: "release",
        },
        upstreamInputs: [],
      },
      includeSessionStartPrompt: false,
    });

    expect(prompts.promptText).not.toContain("##prompt");
  });

  test("applies managerMessage even when a prebuilt execution mailbox is provided", () => {
    const workflow = makeWorkflow();
    const executionMailbox = buildNodeExecutionMailbox({
      workflow,
      nodeRef: makeNodeRef(),
      node: makeNode(),
      nodePayloads: makeNodePayloads(),
      runtimeVariables: { topic: "release" },
      basePromptText: "Implement the release step.",
      assembledArguments: null,
      upstreamInputs: [],
    });

    const prompt = composeExecutionPrompt({
      workflow,
      nodeRef: makeNodeRef(),
      node: makeNode(),
      nodePayloads: makeNodePayloads(),
      runtimeVariables: { topic: "release" },
      basePromptText: "Implement the release step.",
      assembledArguments: null,
      upstreamInputs: [],
      executionMailbox,
      managerMessage: { instruction: "Use the hotfix branch." },
    });

    expect(prompt).toContain("Manager inbox message:");
    expect(prompt).toContain('"instruction": "Use the hotfix branch."');
  });
});
