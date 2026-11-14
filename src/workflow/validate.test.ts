import { describe, expect, test } from "vitest";
import {
  validateWorkflowBundle,
  validateWorkflowBundleDetailed,
} from "./validate";

function makeValidRaw(): {
  workflow: unknown;
  workflowVis: unknown;
  nodePayloads: Record<string, unknown>;
} {
  return {
    workflow: {
      workflowId: "demo",
      description: "demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
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
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-worker-1.json": {
        id: "worker-1",
        model: "tacogips/claude-code-agent",
        promptTemplate: "worker",
        variables: {},
      },
    },
  };
}

function makeUnifiedRoleRaw(): {
  workflow: unknown;
  workflowVis: unknown;
  nodePayloads: Record<string, unknown>;
} {
  return {
    workflow: {
      workflowId: "unified-demo",
      description: "unified demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "divedra-manager",
      entryNodeId: "divedra-manager",
      nodes: [
        {
          id: "divedra-manager",
          role: "manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "worker-1",
          role: "worker",
          nodeFile: "node-worker-1.json",
          completion: { type: "none" },
        },
        {
          id: "worker-2",
          role: "worker",
          control: "loop-judge",
          nodeFile: "node-worker-2.json",
          completion: { type: "none" },
        },
      ],
      edges: [
        { from: "divedra-manager", to: "worker-1", when: "always" },
        { from: "worker-1", to: "worker-2", when: "always" },
      ],
      branching: { mode: "fan-out" },
    },
    workflowVis: {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "worker-1", order: 1 },
        { id: "worker-2", order: 2 },
      ],
    },
    nodePayloads: {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "gpt-5-nano",
        executionBackend: "codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-worker-1.json": {
        id: "worker-1",
        model: "gpt-5-nano",
        executionBackend: "codex-agent",
        promptTemplate: "worker",
        variables: {},
      },
      "node-worker-2.json": {
        id: "worker-2",
        model: "gpt-5-nano",
        executionBackend: "codex-agent",
        promptTemplate: "judge",
        variables: {},
      },
    },
  };
}

describe("validateWorkflowBundle", () => {
  function expectInvalidNodeKind(kind: string): void {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "worker-1",
          kind,
          nodeFile: "node-worker-1.json",
          completion: { type: "none" },
        },
      ],
    };

    const result = validateWorkflowBundleDetailed(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].kind" &&
          issue.message === "must be a valid node kind",
      ),
    ).toBe(true);
  }

  test("accepts canonical valid payload", () => {
    const result = validateWorkflowBundle(makeValidRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.workflowId).toBe("demo");
    expect(result.value.workflow.nodes).toHaveLength(2);
    expect(result.value.workflow.nodes[0]?.role).toBeUndefined();
    expect(result.value.workflow.nodes[1]?.role).toBeUndefined();
  });

  test("accepts workflow definitions without a top-level description", () => {
    const raw = makeValidRaw();
    delete (raw.workflow as { description?: unknown }).description;

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.description).toBe("");
  });

  test("rejects workflow ids that are unsafe for runtime filesystem namespaces", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      workflowId: "../demo",
    };

    const result = validateWorkflowBundleDetailed(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContainEqual({
      severity: "error",
      path: "workflow.workflowId",
      message:
        "must start with an alphanumeric character and contain only letters, digits, hyphens, or underscores",
    });
  });

  test("accepts inline node payload authoring when nodeFile is omitted", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          completion: { type: "none" },
          node: {
            id: "divedra-manager",
            model: "gpt-5-nano",
            executionBackend: "codex-agent",
            promptTemplate: "manager",
            variables: {},
          },
        },
        {
          id: "worker-1",
          kind: "task",
          nodeFile: "node-worker-1.json",
          completion: { type: "none" },
        },
      ],
    };
    delete raw.nodePayloads["node-divedra-manager.json"];

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.nodes[0]?.nodeFile).toBe(
      "nodes/node-divedra-manager.json",
    );
    expect(result.value.nodePayloads["divedra-manager"]?.promptTemplate).toBe(
      "manager",
    );
  });

  test("keeps inline-authored node payloads authoritative during direct validation", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          completion: { type: "none" },
          node: {
            id: "divedra-manager",
            model: "gpt-5-nano",
            executionBackend: "codex-agent",
            promptTemplate: "inline manager",
            variables: {},
          },
        },
        {
          id: "worker-1",
          kind: "task",
          nodeFile: "node-worker-1.json",
          completion: { type: "none" },
        },
      ],
    };
    raw.nodePayloads["nodes/node-divedra-manager.json"] = {
      id: "divedra-manager",
      model: "gpt-5-mini",
      executionBackend: "codex-agent",
      promptTemplate: "stale external payload",
      sessionStartPromptTemplate: "stale first-turn prompt",
      variables: {},
    };
    delete raw.nodePayloads["node-divedra-manager.json"];

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.nodePayloads["divedra-manager"]?.promptTemplate).toBe(
      "inline manager",
    );
    expect(result.value.nodePayloads["divedra-manager"]).not.toHaveProperty(
      "sessionStartPromptTemplate",
    );
  });

  test("accepts workflow-relative node payload paths under nodes/", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "nodes/node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "worker-1",
          kind: "task",
          nodeFile: "nodes/node-worker-1.json",
          completion: { type: "none" },
        },
      ],
    };
    raw.nodePayloads = {
      "nodes/node-divedra-manager.json":
        raw.nodePayloads["node-divedra-manager.json"],
      "nodes/node-worker-1.json": raw.nodePayloads["node-worker-1.json"],
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.nodes[0]?.nodeFile).toBe(
      "nodes/node-divedra-manager.json",
    );
    expect(result.value.workflow.nodes[1]?.nodeFile).toBe(
      "nodes/node-worker-1.json",
    );
  });

  test("rejects empty workflow descriptions when provided", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      description: "",
    };

    const result = validateWorkflowBundleDetailed(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.description" &&
          issue.message === "must be a non-empty string when provided",
      ),
    ).toBe(true);
  });

  test("accepts unified role schema", () => {
    const result = validateWorkflowBundle(makeUnifiedRoleRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.entryNodeId).toBe("divedra-manager");
    expect(result.value.workflow.nodes[0]?.role).toBe("manager");
    expect(result.value.workflow.nodes[2]?.control).toBe("loop-judge");
    expect(result.value.workflow.nodes[2]?.kind).toBe("loop-judge");
  });

  test("accepts simplified sequential schema and synthesizes edges plus repeat loops", () => {
    const raw = {
      workflow: {
        workflowId: "simplified-sequential",
        description: "simplified sequential workflow",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        nodes: [
          {
            id: "divedra-manager",
            role: "manager",
            nodeFile: "node-divedra-manager.json",
            completion: { type: "none" },
          },
          {
            id: "step-1",
            role: "worker",
            group: "phase-a",
            nodeFile: "node-step-1.json",
            completion: { type: "none" },
          },
          {
            id: "repeat-step",
            role: "worker",
            nodeFile: "node-repeat-step.json",
            repeat: {
              while: "continue_turn",
              maxIterations: 2,
            },
            completion: { type: "none" },
          },
          {
            id: "done-step",
            role: "worker",
            nodeFile: "node-done-step.json",
            completion: { type: "none" },
          },
        ],
      },
      workflowVis: {
        nodes: [
          { id: "divedra-manager", order: 0 },
          { id: "step-1", order: 1 },
          { id: "repeat-step", order: 2 },
          { id: "done-step", order: 3 },
        ],
      },
      nodePayloads: {
        "node-divedra-manager.json": {
          id: "divedra-manager",
          model: "gpt-5-nano",
          executionBackend: "codex-agent",
          promptTemplate: "manager",
          variables: {},
        },
        "node-step-1.json": {
          id: "step-1",
          model: "gpt-5-nano",
          executionBackend: "codex-agent",
          promptTemplate: "step-1",
          variables: {},
        },
        "node-repeat-step.json": {
          id: "repeat-step",
          model: "gpt-5-nano",
          executionBackend: "codex-agent",
          promptTemplate: "repeat-step",
          variables: {},
        },
        "node-done-step.json": {
          id: "done-step",
          model: "gpt-5-nano",
          executionBackend: "codex-agent",
          promptTemplate: "done-step",
          variables: {},
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.managerNodeId).toBe("divedra-manager");
    expect(result.value.workflow.entryNodeId).toBe("divedra-manager");
    expect(result.value.workflow.subWorkflows).toEqual([]);
    expect(result.value.workflow.edges).toEqual([
      { from: "divedra-manager", to: "step-1", when: "always" },
      { from: "step-1", to: "repeat-step", when: "always" },
      { from: "repeat-step", to: "repeat-step", when: "continue_turn" },
      { from: "repeat-step", to: "done-step", when: "!(continue_turn)" },
    ]);
    expect(result.value.workflow.loops).toEqual([
      {
        id: "repeat-repeat-step",
        judgeNodeId: "repeat-step",
        continueWhen: "continue_turn",
        exitWhen: "!(continue_turn)",
        maxIterations: 2,
      },
    ]);
    expect(result.value.workflow.nodes[2]?.kind).toBe("loop-judge");
    expect(result.value.workflow.nodes[1]?.group).toBe("phase-a");
  });

  test("rejects repeat when explicit edges are also authored", () => {
    const raw = {
      workflow: {
        workflowId: "repeat-with-edges",
        description: "repeat with explicit edges",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        nodes: [
          {
            id: "divedra-manager",
            role: "manager",
            nodeFile: "node-divedra-manager.json",
            completion: { type: "none" },
          },
          {
            id: "repeat-step",
            role: "worker",
            nodeFile: "node-repeat-step.json",
            repeat: {
              while: "continue_turn",
            },
            completion: { type: "none" },
          },
          {
            id: "done-step",
            role: "worker",
            nodeFile: "node-done-step.json",
            completion: { type: "none" },
          },
        ],
        edges: [{ from: "divedra-manager", to: "repeat-step", when: "always" }],
      },
      workflowVis: {
        nodes: [
          { id: "divedra-manager", order: 0 },
          { id: "repeat-step", order: 1 },
          { id: "done-step", order: 2 },
        ],
      },
      nodePayloads: {
        "node-divedra-manager.json": {
          id: "divedra-manager",
          model: "gpt-5-nano",
          executionBackend: "codex-agent",
          promptTemplate: "manager",
          variables: {},
        },
        "node-repeat-step.json": {
          id: "repeat-step",
          model: "gpt-5-nano",
          executionBackend: "codex-agent",
          promptTemplate: "repeat-step",
          variables: {},
        },
        "node-done-step.json": {
          id: "done-step",
          model: "gpt-5-nano",
          executionBackend: "codex-agent",
          promptTemplate: "done-step",
          variables: {},
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.edges" &&
          issue.message.includes(
            "repeat is supported only when workflow.edges is omitted",
          ),
      ),
    ).toBe(true);
  });

  test("rejects workflowCalls until the runtime implements them", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      workflowCalls: [
        {
          id: "call-review",
          workflowId: "review-flow",
          callerNodeId: "worker-1",
          resultNodeId: "worker-2",
        },
      ],
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.workflowCalls" &&
          issue.message.includes("not executable"),
      ),
    ).toBe(true);
  });

  test("rejects manager-less worker-only workflows until the runtime supports them", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      managerNodeId: undefined,
      entryNodeId: "worker-1",
      nodes: [
        {
          id: "worker-1",
          role: "worker",
          nodeFile: "node-worker-1.json",
          completion: { type: "none" },
        },
        {
          id: "worker-2",
          role: "worker",
          control: "loop-judge",
          nodeFile: "node-worker-2.json",
          completion: { type: "none" },
        },
      ],
      edges: [{ from: "worker-1", to: "worker-2", when: "always" }],
      workflowCalls: [],
    };
    delete (raw.workflow as Record<string, unknown>)["managerNodeId"];
    delete raw.nodePayloads["node-divedra-manager.json"];
    raw.workflowVis = {
      nodes: [
        { id: "worker-1", order: 0 },
        { id: "worker-2", order: 1 },
      ],
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.entryNodeId" &&
          issue.message.includes("not executable"),
      ),
    ).toBe(true);
  });

  test("rejects multiple manager-role nodes", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          role: "manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "worker-1",
          role: "manager",
          nodeFile: "node-worker-1.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some((issue) =>
        issue.message.includes("at most one manager node"),
      ),
    ).toBe(true);
  });

  test("rejects manager-role nodes outside the agent execution path", () => {
    const raw = makeUnifiedRoleRaw();
    raw.nodePayloads["node-divedra-manager.json"] = {
      id: "divedra-manager",
      nodeType: "command",
      command: {
        scriptPath: "scripts/manager.sh",
      },
      promptTemplate: "manager",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-divedra-manager.json.nodeType" &&
          issue.message.includes("agent execution path"),
      ),
    ).toBe(true);
  });

  test("accepts official sdk backend with arbitrary model string", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "gpt-5-nano",
      executionBackend: "official/openai-sdk",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]?.executionBackend).toBe(
      "official/openai-sdk",
    );
    expect(result.value.nodePayloads["worker-1"]?.model).toBe("gpt-5-nano");
  });

  test("accepts canonical short backend with provider model string", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]?.executionBackend).toBe(
      "claude-code-agent",
    );
    expect(result.value.nodePayloads["worker-1"]?.model).toBe(
      "claude-opus-4-1",
    );
  });

  test("normalizes legacy tacogips executionBackend alias to canonical short name", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      executionBackend: "tacogips/claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundleDetailed(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.bundle.nodePayloads["worker-1"]?.executionBackend).toBe(
      "claude-code-agent",
    );
    expect(
      result.value.issues.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.executionBackend" &&
          issue.message.includes("normalized"),
      ),
    ).toBe(true);
  });

  test("rejects legacy sub-manager node kind", () => {
    expectInvalidNodeKind("sub-manager");
  });

  test("rejects legacy manager node kind", () => {
    expectInvalidNodeKind("manager");
  });

  test("rejects branded sub-workflow manager node kind", () => {
    expectInvalidNodeKind("sub-divedra-manager");
  });

  test("accepts optional execution policy on workflow nodes", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
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
          execution: {
            mode: "optional",
            decisionBy: "owning-manager",
          },
        },
      ],
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.nodes[1]?.execution).toEqual({
      mode: "optional",
      decisionBy: "owning-manager",
    });
  });

  test("rejects optional execution policy without owning-manager decisionBy", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
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
          execution: {
            mode: "optional",
          },
        },
      ],
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].execution.decisionBy" &&
          issue.message.includes("required"),
      ),
    ).toBe(true);
  });

  test("accepts user-action node payloads", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      nodeType: "user-action",
      promptTemplate: "Approve the release?",
      variables: {},
      userAction: {
        messageToolIds: ["matrix-primary"],
        notificationToolIds: ["desktop-notify"],
        replyPolicy: "first-valid-reply-wins",
        allowStructuredReply: true,
        allowFreeTextReply: true,
      },
      output: {
        description: "Validated user reply payload",
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]).toEqual({
      id: "worker-1",
      nodeType: "user-action",
      promptTemplate: "Approve the release?",
      variables: {},
      userAction: {
        messageToolIds: ["matrix-primary"],
        notificationToolIds: ["desktop-notify"],
        replyPolicy: "first-valid-reply-wins",
        allowStructuredReply: true,
        allowFreeTextReply: true,
      },
      output: {
        description: "Validated user reply payload",
      },
    });
  });

  test("rejects user-action nodes without message tool ids", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      nodeType: "user-action",
      promptTemplate: "Approve the release?",
      variables: {},
      userAction: {
        messageToolIds: [],
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path ===
            "nodePayloads.node-worker-1.json.userAction.messageToolIds" &&
          issue.message.includes("at least one"),
      ),
    ).toBe(true);
  });

  test("rejects agent-only fields on user-action nodes", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      nodeType: "user-action",
      model: "gpt-5-nano",
      executionBackend: "official/openai-sdk",
      sessionPolicy: { mode: "reuse" },
      promptTemplate: "Approve the release?",
      variables: {},
      userAction: {
        messageToolIds: ["matrix-primary"],
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.model" &&
          issue.message.includes("must be omitted"),
      ),
    ).toBe(true);
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.executionBackend" &&
          issue.message.includes("must be omitted"),
      ),
    ).toBe(true);
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.sessionPolicy" &&
          issue.message.includes("must be omitted"),
      ),
    ).toBe(true);
  });

  test("accepts node session reuse policy", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      sessionPolicy: {
        mode: "reuse",
      },
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]?.sessionPolicy?.mode).toBe(
      "reuse",
    );
  });

  test("accepts podman runtimeIsolation with a prebuilt image", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      runtimeIsolation: {
        mode: "podman",
        image: "ghcr.io/example/reviewer:latest",
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      nodeType: "container",
      container: {
        runnerKind: "podman",
        image: "ghcr.io/example/reviewer:latest",
      },
    });
  });

  test("accepts podman runtimeIsolation build metadata with dockerfilePath", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      runtimeIsolation: {
        mode: "podman",
        build: {
          contextPath: "containers/reviewer",
          dockerfilePath: "containers/reviewer/Dockerfile",
          target: "runtime",
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      nodeType: "container",
      container: {
        runnerKind: "podman",
        build: {
          contextPath: "containers/reviewer",
          dockerfilePath: "containers/reviewer/Dockerfile",
          target: "runtime",
        },
      },
    });
  });

  test("accepts authored container nodes without agent-only fields", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      nodeType: "container",
      variables: {},
      container: {
        image: "ghcr.io/example/reviewer:latest",
      },
      durability: {
        mode: "node-persistent",
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]).toEqual({
      id: "worker-1",
      nodeType: "container",
      variables: {},
      container: {
        image: "ghcr.io/example/reviewer:latest",
      },
      durability: {
        mode: "node-persistent",
      },
    });
  });

  test("rejects podman runtimeIsolation when both image and build are provided", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      runtimeIsolation: {
        mode: "podman",
        image: "ghcr.io/example/reviewer:latest",
        build: {
          contextPath: "containers/reviewer",
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.runtimeIsolation" &&
          issue.message.includes("exactly one"),
      ),
    ).toBe(true);
  });

  test("rejects unsafe podman dockerfilePath", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      runtimeIsolation: {
        mode: "podman",
        build: {
          contextPath: "containers/reviewer",
          dockerfilePath: "../Dockerfile",
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path ===
            "nodePayloads.node-worker-1.json.runtimeIsolation.build.dockerfilePath" &&
          issue.message.includes("workflow-relative path"),
      ),
    ).toBe(true);
  });

  test("rejects podman dockerfilePath values that target canonical workflow definition files", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      runtimeIsolation: {
        mode: "podman",
        build: {
          contextPath: "containers/reviewer",
          dockerfilePath: "workflow.json",
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path ===
            "nodePayloads.node-worker-1.json.runtimeIsolation.build.dockerfilePath" &&
          issue.message.includes(
            "must not target canonical workflow definition files",
          ),
      ),
    ).toBe(true);
  });

  test("rejects unsafe promptTemplateFile paths", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      promptTemplateFile: "../outside.md",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.promptTemplateFile" &&
          issue.message.includes("workflow-relative path"),
      ),
    ).toBe(true);
  });

  test("rejects promptTemplateFile paths that target canonical workflow definition files", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      promptTemplateFile: "workflow.json",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.promptTemplateFile" &&
          issue.message.includes(
            "must not target canonical workflow definition files",
          ),
      ),
    ).toBe(true);
  });

  test("rejects unsafe systemPromptTemplateFile and sessionStartPromptTemplateFile paths", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      systemPromptTemplateFile: "../system.md",
      sessionStartPromptTemplateFile: "workflow.json",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path ===
            "nodePayloads.node-worker-1.json.systemPromptTemplateFile" &&
          issue.message.includes("workflow-relative path"),
      ),
    ).toBe(true);
    expect(
      result.error.some(
        (issue) =>
          issue.path ===
            "nodePayloads.node-worker-1.json.sessionStartPromptTemplateFile" &&
          issue.message.includes(
            "must not target canonical workflow definition files",
          ),
      ),
    ).toBe(true);
  });

  test("rejects unsupported node session policy mode", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      sessionPolicy: {
        mode: "shared",
      },
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.sessionPolicy.mode",
      ),
    ).toBe(true);
  });

  test("rejects tacogips cli-wrapper identifiers with official sdk backends", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/codex-agent",
      executionBackend: "official/openai-sdk",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.model" &&
          issue.message.includes("provider or backend-specific model name"),
      ),
    ).toBe(true);
  });

  test("rejects tacogips cli-wrapper identifiers with explicit tacogips backends", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/codex-agent",
      executionBackend: "tacogips/codex-agent",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundleDetailed(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.model" &&
          issue.message.includes("provider or backend-specific model name"),
      ),
    ).toBe(true);
  });

  test("requires executionBackend for non-tacogips model strings", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "gpt-5-nano",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.executionBackend",
      ),
    ).toBe(true);
  });

  test("warns when legacy cli backend identifier is encoded in model", () => {
    const result = validateWorkflowBundleDetailed(makeValidRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.issues.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.model" &&
          issue.message.includes("legacy CLI backend identifier"),
      ),
    ).toBe(true);
  });

  test("normalizes legacy prompt and variable fields", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      prompt: "legacy prompt",
      variable: { name: "legacy" },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]?.promptTemplate).toBe(
      "legacy prompt",
    );
    expect(result.value.nodePayloads["worker-1"]?.variables).toEqual({
      name: "legacy",
    });
  });

  test("accepts node-level descriptions", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      description: "Summarize the diff and propose the next action.",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]?.description).toBe(
      "Summarize the diff and propose the next action.",
    );
  });

  test("rejects empty node-level descriptions", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      description: "   ",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.description" &&
          issue.message.includes("non-empty string"),
      ),
    ).toBe(true);
  });

  test("accepts node output contract with supported JSON Schema subset", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      output: {
        description: "structured worker output",
        maxValidationAttempts: 3,
        jsonSchema: {
          type: "object",
          required: ["summary"],
          additionalProperties: false,
          properties: {
            summary: { type: "string", minLength: 1 },
          },
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.nodePayloads["worker-1"]?.output?.maxValidationAttempts,
    ).toBe(3);
  });

  test("accepts description-only node output contracts with retry attempts", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      output: {
        description:
          "Return only the structured worker payload as a JSON object.",
        maxValidationAttempts: 2,
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.nodePayloads["worker-1"]?.output?.maxValidationAttempts,
    ).toBe(2);
  });

  test("rejects empty output descriptions", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      output: {
        description: "   ",
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.output.description" &&
          issue.message.includes("non-empty string"),
      ),
    ).toBe(true);
  });

  test("rejects empty node output contracts that declare no description or schema", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      output: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.output" &&
          issue.message.includes(
            "must define output.description and/or output.jsonSchema",
          ),
      ),
    ).toBe(true);
  });

  test("rejects unsupported node output contract fields", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      output: {
        description: "structured worker output",
        schema: {
          type: "object",
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.output.schema" &&
          issue.message.includes("unsupported output contract field"),
      ),
    ).toBe(true);
  });

  test("rejects unsupported JSON Schema keywords in node output contract", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      output: {
        jsonSchema: {
          type: "object",
          not: { type: "null" },
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path ===
            "nodePayloads.node-worker-1.json.output.jsonSchema.not" &&
          issue.message.includes("unsupported"),
      ),
    ).toBe(true);
  });

  test("rejects node output schemas whose root cannot accept an object payload", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      output: {
        jsonSchema: {
          type: "string",
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.output.jsonSchema" &&
          issue.message.includes("top-level JSON objects"),
      ),
    ).toBe(true);
  });

  test("rejects node output schemas whose combinator root cannot accept an object payload", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      output: {
        jsonSchema: {
          anyOf: [{ type: "string" }, { type: "number" }],
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.output.jsonSchema" &&
          issue.message.includes("top-level JSON objects"),
      ),
    ).toBe(true);
  });

  test("does not report missing jsonSchema when output.jsonSchema is present but invalid", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "tacogips/claude-code-agent",
      promptTemplate: "worker",
      variables: {},
      output: {
        maxValidationAttempts: 2,
        jsonSchema: {
          type: "object",
          not: { type: "null" },
        },
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path ===
            "nodePayloads.node-worker-1.json.output.maxValidationAttempts" &&
          issue.message.includes("requires output.jsonSchema"),
      ),
    ).toBe(false);
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.output" &&
          issue.message.includes(
            "must define output.description and/or output.jsonSchema",
          ),
      ),
    ).toBe(false);
  });

  test("normalizes legacy coordinate layout to top-to-bottom then left-to-right order", () => {
    const raw = makeValidRaw();
    raw.workflowVis = {
      nodes: [
        { id: "worker-1", x: 200, y: 10, width: 100, height: 80 },
        { id: "divedra-manager", x: 10, y: 10, width: 100, height: 80 },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflowVis.nodes).toEqual([
      { id: "divedra-manager", order: 0 },
      { id: "worker-1", order: 1 },
    ]);
  });

  test("ignores persisted indent and color metadata", () => {
    const raw = makeValidRaw();
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0, indent: 0, color: "manager" },
        { id: "worker-1", order: 1, indent: 1, color: "loop-main" },
      ],
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflowVis.nodes).toEqual([
      { id: "divedra-manager", order: 0 },
      { id: "worker-1", order: 1 },
    ]);
  });

  test("reports semantic errors for missing manager and bad node ids", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      managerNodeId: "missing-manager",
      nodes: [
        {
          id: "BadID",
          nodeFile: "node-BadID.json",
          kind: "root-manager",
          completion: { type: "none" },
        },
      ],
      edges: [],
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflow.nodes[0].id:must match ^[a-z0-9][a-z0-9-]{1,63}$",
    );
    expect(messages).toContain(
      "workflow.managerNodeId:must reference an existing node id",
    );
  });

  test("rejects workflow managerNodeId that does not reference a root manager node", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "task",
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
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflow.managerNodeId:must reference a node with kind 'root-manager'",
    );
  });

  test("rejects additional root-manager nodes that are not workflow.managerNodeId", () => {
    const raw = makeValidRaw();
    const workflowVis = raw.workflowVis as {
      nodes: Array<{ id: string; order: number }>;
    };
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        ...(raw.workflow as { nodes: unknown[] }).nodes,
        {
          id: "shadow-manager",
          kind: "root-manager",
          nodeFile: "node-shadow-manager.json",
          completion: { type: "none" },
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        ...workflowVis.nodes,
        { id: "shadow-manager", order: workflowVis.nodes.length },
      ],
    };
    raw.nodePayloads["node-shadow-manager.json"] = {
      id: "shadow-manager",
      model: "tacogips/codex-agent",
      promptTemplate: "shadow manager",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes" &&
          issue.message.includes("shadow-manager") &&
          issue.message.includes("root-manager"),
      ),
    ).toBe(true);
  });

  test("rejects duplicate sub-workflow boundary nodes that make routing ambiguous", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      workflowId: "demo",
      description: "demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "divedra-manager",
      subWorkflows: [
        {
          id: "sw-a",
          description: "A",
          managerNodeId: "sub-manager-a",
          inputNodeId: "input-a",
          outputNodeId: "output-a",
          nodeIds: ["sub-manager-a", "input-a", "output-a"],
          inputSources: [{ type: "human-input" }],
        },
        {
          id: "sw-b",
          description: "B",
          managerNodeId: "sub-manager-a",
          inputNodeId: "input-a",
          outputNodeId: "output-b",
          nodeIds: ["sub-manager-a", "input-a", "output-b"],
          inputSources: [{ type: "human-input" }],
        },
      ],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sub-manager-a",
          kind: "subworkflow-manager",
          nodeFile: "node-sub-manager-a.json",
          completion: { type: "none" },
        },
        {
          id: "input-a",
          kind: "input",
          nodeFile: "node-input-a.json",
          completion: { type: "none" },
        },
        {
          id: "output-a",
          kind: "output",
          nodeFile: "node-output-a.json",
          completion: { type: "none" },
        },
        {
          id: "output-b",
          kind: "output",
          nodeFile: "node-output-b.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "sub-manager-a", order: 1 },
        { id: "input-a", order: 2 },
        { id: "output-a", order: 3 },
        { id: "output-b", order: 4 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sub-manager-a.json": {
        id: "sub-manager-a",
        model: "tacogips/codex-agent",
        promptTemplate: "sub-manager-a",
        variables: {},
      },
      "node-input-a.json": {
        id: "input-a",
        model: "tacogips/codex-agent",
        promptTemplate: "input-a",
        variables: {},
      },
      "node-output-a.json": {
        id: "output-a",
        model: "tacogips/codex-agent",
        promptTemplate: "output-a",
        variables: {},
      },
      "node-output-b.json": {
        id: "output-b",
        model: "tacogips/codex-agent",
        promptTemplate: "output-b",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) => issue.path === "workflow.subWorkflows[1].managerNodeId",
      ),
    ).toBe(true);
    expect(
      result.error.some(
        (issue) => issue.path === "workflow.subWorkflows[1].inputNodeId",
      ),
    ).toBe(true);
  });

  test("requires sub-workflow nodeIds membership lists", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      workflowId: "demo",
      description: "demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "divedra-manager",
      subWorkflows: [
        {
          id: "sw-a",
          description: "A",
          managerNodeId: "sub-manager-a",
          inputNodeId: "input-a",
          outputNodeId: "output-a",
          inputSources: [{ type: "human-input" }],
        },
      ],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sub-manager-a",
          kind: "subworkflow-manager",
          nodeFile: "node-sub-manager-a.json",
          completion: { type: "none" },
        },
        {
          id: "input-a",
          kind: "input",
          nodeFile: "node-input-a.json",
          completion: { type: "none" },
        },
        {
          id: "output-a",
          kind: "output",
          nodeFile: "node-output-a.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "sub-manager-a", order: 1 },
        { id: "input-a", order: 2 },
        { id: "output-a", order: 3 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sub-manager-a.json": {
        id: "sub-manager-a",
        model: "tacogips/codex-agent",
        promptTemplate: "sub-manager-a",
        variables: {},
      },
      "node-input-a.json": {
        id: "input-a",
        model: "tacogips/codex-agent",
        promptTemplate: "input-a",
        variables: {},
      },
      "node-output-a.json": {
        id: "output-a",
        model: "tacogips/codex-agent",
        promptTemplate: "output-a",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) => issue.path === "workflow.subWorkflows[0].nodeIds",
      ),
    ).toBe(true);
  });

  test("rejects reused boundary nodes inside the same sub-workflow", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      workflowId: "demo",
      description: "demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "divedra-manager",
      subWorkflows: [
        {
          id: "sw-a",
          description: "A",
          managerNodeId: "sub-manager-a",
          inputNodeId: "sub-manager-a",
          outputNodeId: "sub-output-a",
          nodeIds: ["sub-manager-a", "sub-output-a"],
          inputSources: [{ type: "human-input" }],
        },
      ],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sub-manager-a",
          kind: "subworkflow-manager",
          nodeFile: "node-sub-manager-a.json",
          completion: { type: "none" },
        },
        {
          id: "sub-output-a",
          kind: "output",
          nodeFile: "node-sub-output-a.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "sub-manager-a", order: 1 },
        { id: "sub-output-a", order: 2 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sub-manager-a.json": {
        id: "sub-manager-a",
        model: "tacogips/codex-agent",
        promptTemplate: "sub-manager-a",
        variables: {},
      },
      "node-sub-output-a.json": {
        id: "sub-output-a",
        model: "tacogips/codex-agent",
        promptTemplate: "sub-output-a",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflows[0].managerNodeId" &&
          issue.message.includes("same node as inputNodeId"),
      ),
    ).toBe(true);
  });

  test("rejects duplicate nodeIds within the same sub-workflow", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      workflowId: "demo",
      description: "demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "divedra-manager",
      subWorkflows: [
        {
          id: "sw-a",
          description: "A",
          managerNodeId: "sub-manager-a",
          inputNodeId: "input-a",
          outputNodeId: "output-a",
          nodeIds: ["sub-manager-a", "input-a", "output-a", "input-a"],
          inputSources: [{ type: "human-input" }],
        },
      ],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sub-manager-a",
          kind: "subworkflow-manager",
          nodeFile: "node-sub-manager-a.json",
          completion: { type: "none" },
        },
        {
          id: "input-a",
          kind: "input",
          nodeFile: "node-input-a.json",
          completion: { type: "none" },
        },
        {
          id: "output-a",
          kind: "output",
          nodeFile: "node-output-a.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "sub-manager-a", order: 1 },
        { id: "input-a", order: 2 },
        { id: "output-a", order: 3 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sub-manager-a.json": {
        id: "sub-manager-a",
        model: "tacogips/codex-agent",
        promptTemplate: "sub-manager-a",
        variables: {},
      },
      "node-input-a.json": {
        id: "input-a",
        model: "tacogips/codex-agent",
        promptTemplate: "input-a",
        variables: {},
      },
      "node-output-a.json": {
        id: "output-a",
        model: "tacogips/codex-agent",
        promptTemplate: "output-a",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflows[0].nodeIds[3]" &&
          issue.message.includes("duplicate node id 'input-a'"),
      ),
    ).toBe(true);
  });

  test("rejects sub-workflow managerNodeId that does not reference a subworkflow-manager node", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      workflowId: "demo",
      description: "demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "divedra-manager",
      subWorkflows: [
        {
          id: "sw-a",
          description: "A",
          managerNodeId: "plain-manager-a",
          inputNodeId: "input-a",
          outputNodeId: "output-a",
          nodeIds: ["plain-manager-a", "input-a", "output-a"],
          inputSources: [{ type: "human-input" }],
        },
      ],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "plain-manager-a",
          kind: "root-manager",
          nodeFile: "node-plain-manager-a.json",
          completion: { type: "none" },
        },
        {
          id: "input-a",
          kind: "input",
          nodeFile: "node-input-a.json",
          completion: { type: "none" },
        },
        {
          id: "output-a",
          kind: "output",
          nodeFile: "node-output-a.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "plain-manager-a", order: 1 },
        { id: "input-a", order: 2 },
        { id: "output-a", order: 3 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-plain-manager-a.json": {
        id: "plain-manager-a",
        model: "tacogips/codex-agent",
        promptTemplate: "plain-manager-a",
        variables: {},
      },
      "node-input-a.json": {
        id: "input-a",
        model: "tacogips/codex-agent",
        promptTemplate: "input-a",
        variables: {},
      },
      "node-output-a.json": {
        id: "output-a",
        model: "tacogips/codex-agent",
        promptTemplate: "output-a",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflows[0].managerNodeId" &&
          issue.message.includes("kind 'subworkflow-manager'"),
      ),
    ).toBe(true);
  });

  test("rejects duplicate vertical order entries", () => {
    const raw = makeValidRaw();
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "worker-1", order: 0 },
      ],
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflowVis.nodes[1].order:duplicate order '0'",
    );
  });

  test("rejects missing vertical order for any workflow node", () => {
    const raw = makeValidRaw();
    raw.workflowVis = {
      nodes: [{ id: "divedra-manager", order: 0 }],
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflowVis.nodes:missing vertical order for node 'worker-1'",
    );
  });

  test("rejects unknown vertical order ids", () => {
    const raw = makeValidRaw();
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "worker-1", order: 1 },
        { id: "ghost", order: 2 },
      ],
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflowVis.nodes[2].id:references unknown node id",
    );
  });

  test("accepts typed subWorkflows and subWorkflowConversations", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      prompts: {
        divedraPromptTemplate: "Coordinate {{topic}}.",
        workerSystemPromptTemplate: "Return the node payload for {{topic}}.",
      },
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "branch-judge",
          kind: "branch-judge",
          nodeFile: "node-branch-judge.json",
          completion: { type: "none" },
        },
        {
          id: "sw1-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-sw1-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sw1-input",
          kind: "input",
          nodeFile: "node-sw1-input.json",
          completion: { type: "none" },
        },
        {
          id: "sw1-output",
          kind: "output",
          nodeFile: "node-sw1-output.json",
          completion: { type: "none" },
        },
        {
          id: "sw2-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-sw2-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sw2-input",
          kind: "input",
          nodeFile: "node-sw2-input.json",
          completion: { type: "none" },
        },
        {
          id: "sw2-output",
          kind: "output",
          nodeFile: "node-sw2-output.json",
          completion: { type: "none" },
        },
      ],
      edges: [
        { from: "divedra-manager", to: "branch-judge", when: "always" },
        { from: "branch-judge", to: "sw1-manager", when: "take_sw1" },
        { from: "sw1-output", to: "sw2-manager", when: "always" },
      ],
      subWorkflows: [
        {
          id: "sw1",
          description: "first",
          managerNodeId: "sw1-manager",
          inputNodeId: "sw1-input",
          outputNodeId: "sw1-output",
          nodeIds: ["sw1-manager", "sw1-input", "sw1-output"],
          inputSources: [{ type: "human-input" }],
          block: { type: "branch-block" },
        },
        {
          id: "sw2",
          description: "second",
          managerNodeId: "sw2-manager",
          inputNodeId: "sw2-input",
          outputNodeId: "sw2-output",
          nodeIds: ["sw2-manager", "sw2-input", "sw2-output"],
          inputSources: [{ type: "sub-workflow-output", subWorkflowId: "sw1" }],
        },
      ],
      subWorkflowConversations: [
        {
          id: "conv-1",
          participants: ["sw1", "sw2"],
          maxTurns: 4,
          stopWhen: "done",
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "branch-judge", order: 1 },
        { id: "sw1-manager", order: 2 },
        { id: "sw1-input", order: 3 },
        { id: "sw1-output", order: 4 },
        { id: "sw2-manager", order: 5 },
        { id: "sw2-input", order: 6 },
        { id: "sw2-output", order: 7 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sw1-manager.json": {
        id: "sw1-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "m1",
        variables: {},
      },
      "node-branch-judge.json": {
        id: "branch-judge",
        model: "tacogips/codex-agent",
        promptTemplate: "judge",
        variables: {},
      },
      "node-sw1-input.json": {
        id: "sw1-input",
        model: "tacogips/codex-agent",
        promptTemplate: "in1",
        variables: {},
      },
      "node-sw1-output.json": {
        id: "sw1-output",
        model: "tacogips/codex-agent",
        promptTemplate: "out1",
        variables: {},
      },
      "node-sw2-manager.json": {
        id: "sw2-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "m2",
        variables: {},
      },
      "node-sw2-input.json": {
        id: "sw2-input",
        model: "tacogips/codex-agent",
        promptTemplate: "in2",
        variables: {},
      },
      "node-sw2-output.json": {
        id: "sw2-output",
        model: "tacogips/codex-agent",
        promptTemplate: "out2",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.prompts?.divedraPromptTemplate).toBe(
      "Coordinate {{topic}}.",
    );
    expect(result.value.workflow.prompts?.workerSystemPromptTemplate).toBe(
      "Return the node payload for {{topic}}.",
    );
    expect(result.value.workflow.subWorkflows).toHaveLength(2);
    expect(result.value.workflow.subWorkflows[0]?.block?.type).toBe(
      "branch-block",
    );
    expect(result.value.workflow.subWorkflowConversations?.[0]?.id).toBe(
      "conv-1",
    );
  });

  test("rejects loop-body sub-workflow blocks that do not reference an existing loop", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "loop-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-loop-manager.json",
          completion: { type: "none" },
        },
        {
          id: "loop-input",
          kind: "input",
          nodeFile: "node-loop-input.json",
          completion: { type: "none" },
        },
        {
          id: "loop-output",
          kind: "output",
          nodeFile: "node-loop-output.json",
          completion: { type: "none" },
        },
      ],
      edges: [{ from: "divedra-manager", to: "loop-manager", when: "always" }],
      subWorkflows: [
        {
          id: "loop-body",
          description: "loop body",
          managerNodeId: "loop-manager",
          inputNodeId: "loop-input",
          outputNodeId: "loop-output",
          nodeIds: ["loop-manager", "loop-input", "loop-output"],
          inputSources: [{ type: "human-input" }],
          block: { type: "loop-body", loopId: "missing-loop" },
        },
      ],
      loops: [],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "loop-manager", order: 1 },
        { id: "loop-input", order: 2 },
        { id: "loop-output", order: 3 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-loop-manager.json": {
        id: "loop-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-manager",
        variables: {},
      },
      "node-loop-input.json": {
        id: "loop-input",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-input",
        variables: {},
      },
      "node-loop-output.json": {
        id: "loop-output",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) => issue.path === "workflow.subWorkflows[0].block.loopId",
      ),
    ).toBe(true);
  });

  test("rejects duplicate loop-body sub-workflows for the same loop", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "loop-manager-a",
          kind: "subworkflow-manager",
          nodeFile: "node-loop-manager-a.json",
          completion: { type: "none" },
        },
        {
          id: "loop-input-a",
          kind: "input",
          nodeFile: "node-loop-input-a.json",
          completion: { type: "none" },
        },
        {
          id: "loop-output-a",
          kind: "output",
          nodeFile: "node-loop-output-a.json",
          completion: { type: "none" },
        },
        {
          id: "loop-manager-b",
          kind: "subworkflow-manager",
          nodeFile: "node-loop-manager-b.json",
          completion: { type: "none" },
        },
        {
          id: "loop-input-b",
          kind: "input",
          nodeFile: "node-loop-input-b.json",
          completion: { type: "none" },
        },
        {
          id: "loop-output-b",
          kind: "output",
          nodeFile: "node-loop-output-b.json",
          completion: { type: "none" },
        },
        {
          id: "loop-judge",
          kind: "loop-judge",
          nodeFile: "node-loop-judge.json",
          completion: { type: "none" },
        },
      ],
      edges: [
        { from: "divedra-manager", to: "loop-manager-a", when: "always" },
        { from: "loop-judge", to: "loop-manager-a", when: "continue_round" },
        { from: "loop-judge", to: "divedra-manager", when: "loop_exit" },
      ],
      subWorkflows: [
        {
          id: "loop-body-a",
          description: "loop body a",
          managerNodeId: "loop-manager-a",
          inputNodeId: "loop-input-a",
          outputNodeId: "loop-output-a",
          nodeIds: ["loop-manager-a", "loop-input-a", "loop-output-a"],
          inputSources: [{ type: "human-input" }],
          block: { type: "loop-body", loopId: "main-loop" },
        },
        {
          id: "loop-body-b",
          description: "loop body b",
          managerNodeId: "loop-manager-b",
          inputNodeId: "loop-input-b",
          outputNodeId: "loop-output-b",
          nodeIds: ["loop-manager-b", "loop-input-b", "loop-output-b"],
          inputSources: [{ type: "human-input" }],
          block: { type: "loop-body", loopId: "main-loop" },
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
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "loop-manager-a", order: 1 },
        { id: "loop-input-a", order: 2 },
        { id: "loop-output-a", order: 3 },
        { id: "loop-manager-b", order: 4 },
        { id: "loop-input-b", order: 5 },
        { id: "loop-output-b", order: 6 },
        { id: "loop-judge", order: 7 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-loop-manager-a.json": {
        id: "loop-manager-a",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-manager-a",
        variables: {},
      },
      "node-loop-input-a.json": {
        id: "loop-input-a",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-input-a",
        variables: {},
      },
      "node-loop-output-a.json": {
        id: "loop-output-a",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-output-a",
        variables: {},
      },
      "node-loop-manager-b.json": {
        id: "loop-manager-b",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-manager-b",
        variables: {},
      },
      "node-loop-input-b.json": {
        id: "loop-input-b",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-input-b",
        variables: {},
      },
      "node-loop-output-b.json": {
        id: "loop-output-b",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-output-b",
        variables: {},
      },
      "node-loop-judge.json": {
        id: "loop-judge",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-judge",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflows[1].block.loopId" &&
          issue.message.includes("already assigned to loop-body subWorkflow"),
      ),
    ).toBe(true);
  });

  test("rejects branch-block sub-workflows that are not entered from a branch-judge", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "prepare",
          kind: "task",
          nodeFile: "node-prepare.json",
          completion: { type: "none" },
        },
        {
          id: "branch-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-branch-manager.json",
          completion: { type: "none" },
        },
        {
          id: "branch-input",
          kind: "input",
          nodeFile: "node-branch-input.json",
          completion: { type: "none" },
        },
        {
          id: "branch-output",
          kind: "output",
          nodeFile: "node-branch-output.json",
          completion: { type: "none" },
        },
      ],
      edges: [
        { from: "divedra-manager", to: "prepare", when: "always" },
        { from: "prepare", to: "branch-manager", when: "always" },
      ],
      subWorkflows: [
        {
          id: "branch-body",
          description: "branch body",
          managerNodeId: "branch-manager",
          inputNodeId: "branch-input",
          outputNodeId: "branch-output",
          nodeIds: ["branch-manager", "branch-input", "branch-output"],
          inputSources: [{ type: "human-input" }],
          block: { type: "branch-block" },
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "prepare", order: 1 },
        { id: "branch-manager", order: 2 },
        { id: "branch-input", order: 3 },
        { id: "branch-output", order: 4 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-prepare.json": {
        id: "prepare",
        model: "tacogips/codex-agent",
        promptTemplate: "prepare",
        variables: {},
      },
      "node-branch-manager.json": {
        id: "branch-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "branch-manager",
        variables: {},
      },
      "node-branch-input.json": {
        id: "branch-input",
        model: "tacogips/codex-agent",
        promptTemplate: "branch-input",
        variables: {},
      },
      "node-branch-output.json": {
        id: "branch-output",
        model: "tacogips/codex-agent",
        promptTemplate: "branch-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) => issue.path === "workflow.subWorkflows[0].block.type",
      ),
    ).toBe(true);
  });

  test("rejects loop-body sub-workflows whose linked loop does not continue into the sub-workflow manager", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "loop-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-loop-manager.json",
          completion: { type: "none" },
        },
        {
          id: "loop-input",
          kind: "input",
          nodeFile: "node-loop-input.json",
          completion: { type: "none" },
        },
        {
          id: "loop-output",
          kind: "output",
          nodeFile: "node-loop-output.json",
          completion: { type: "none" },
        },
        {
          id: "loop-worker",
          kind: "task",
          nodeFile: "node-loop-worker.json",
          completion: { type: "none" },
        },
        {
          id: "loop-judge",
          kind: "loop-judge",
          nodeFile: "node-loop-judge.json",
          completion: { type: "none" },
        },
      ],
      edges: [
        { from: "divedra-manager", to: "loop-manager", when: "always" },
        { from: "loop-judge", to: "loop-worker", when: "continue_round" },
        { from: "loop-judge", to: "divedra-manager", when: "loop_exit" },
      ],
      subWorkflows: [
        {
          id: "loop-body",
          description: "loop body",
          managerNodeId: "loop-manager",
          inputNodeId: "loop-input",
          outputNodeId: "loop-output",
          nodeIds: ["loop-manager", "loop-input", "loop-worker", "loop-output"],
          inputSources: [{ type: "human-input" }],
          block: { type: "loop-body", loopId: "main-loop" },
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
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "loop-manager", order: 1 },
        { id: "loop-input", order: 2 },
        { id: "loop-worker", order: 3 },
        { id: "loop-output", order: 4 },
        { id: "loop-judge", order: 5 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-loop-manager.json": {
        id: "loop-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-manager",
        variables: {},
      },
      "node-loop-input.json": {
        id: "loop-input",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-input",
        variables: {},
      },
      "node-loop-output.json": {
        id: "loop-output",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-output",
        variables: {},
      },
      "node-loop-worker.json": {
        id: "loop-worker",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-worker",
        variables: {},
      },
      "node-loop-judge.json": {
        id: "loop-judge",
        model: "tacogips/codex-agent",
        promptTemplate: "loop-judge",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflows[0].block.loopId" &&
          issue.message.includes("continue edge to manager 'loop-manager'"),
      ),
    ).toBe(true);
  });

  test("allows nested sub-workflow vertical groups", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "a-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-a-manager.json",
          completion: { type: "none" },
        },
        {
          id: "a-input",
          kind: "input",
          nodeFile: "node-a-input.json",
          completion: { type: "none" },
        },
        {
          id: "a-inner-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-a-inner-manager.json",
          completion: { type: "none" },
        },
        {
          id: "a-inner-input",
          kind: "input",
          nodeFile: "node-a-inner-input.json",
          completion: { type: "none" },
        },
        {
          id: "a-inner-output",
          kind: "output",
          nodeFile: "node-a-inner-output.json",
          completion: { type: "none" },
        },
        {
          id: "a-output",
          kind: "output",
          nodeFile: "node-a-output.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      subWorkflows: [
        {
          id: "a",
          description: "a",
          managerNodeId: "a-manager",
          inputNodeId: "a-input",
          outputNodeId: "a-output",
          nodeIds: ["a-manager", "a-input", "a-output"],
          inputSources: [{ type: "human-input" }],
        },
        {
          id: "a-inner",
          description: "a-inner",
          managerNodeId: "a-inner-manager",
          inputNodeId: "a-inner-input",
          outputNodeId: "a-inner-output",
          nodeIds: ["a-inner-manager", "a-inner-input", "a-inner-output"],
          inputSources: [{ type: "human-input" }],
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "a-manager", order: 1 },
        { id: "a-input", order: 2 },
        { id: "a-inner-manager", order: 3 },
        { id: "a-inner-input", order: 4 },
        { id: "a-inner-output", order: 5 },
        { id: "a-output", order: 6 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-a-manager.json": {
        id: "a-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "a-manager",
        variables: {},
      },
      "node-a-input.json": {
        id: "a-input",
        model: "tacogips/codex-agent",
        promptTemplate: "a-in",
        variables: {},
      },
      "node-a-inner-manager.json": {
        id: "a-inner-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "a-inner-manager",
        variables: {},
      },
      "node-a-inner-input.json": {
        id: "a-inner-input",
        model: "tacogips/codex-agent",
        promptTemplate: "a-inner-in",
        variables: {},
      },
      "node-a-inner-output.json": {
        id: "a-inner-output",
        model: "tacogips/codex-agent",
        promptTemplate: "a-inner-out",
        variables: {},
      },
      "node-a-output.json": {
        id: "a-output",
        model: "tacogips/codex-agent",
        promptTemplate: "a-out",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
  });

  test("rejects crossing sub-workflow vertical groups", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "a-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-a-manager.json",
          completion: { type: "none" },
        },
        {
          id: "a-input",
          kind: "input",
          nodeFile: "node-a-input.json",
          completion: { type: "none" },
        },
        {
          id: "b-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-b-manager.json",
          completion: { type: "none" },
        },
        {
          id: "b-input",
          kind: "input",
          nodeFile: "node-b-input.json",
          completion: { type: "none" },
        },
        {
          id: "a-output",
          kind: "output",
          nodeFile: "node-a-output.json",
          completion: { type: "none" },
        },
        {
          id: "b-output",
          kind: "output",
          nodeFile: "node-b-output.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      subWorkflows: [
        {
          id: "a",
          description: "a",
          managerNodeId: "a-manager",
          inputNodeId: "a-input",
          outputNodeId: "a-output",
          nodeIds: ["a-manager", "a-input", "a-output"],
          inputSources: [{ type: "human-input" }],
        },
        {
          id: "b",
          description: "b",
          managerNodeId: "b-manager",
          inputNodeId: "b-input",
          outputNodeId: "b-output",
          nodeIds: ["b-manager", "b-input", "b-output"],
          inputSources: [{ type: "human-input" }],
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "a-manager", order: 1 },
        { id: "a-input", order: 2 },
        { id: "b-manager", order: 3 },
        { id: "b-input", order: 4 },
        { id: "a-output", order: 5 },
        { id: "b-output", order: 6 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-a-manager.json": {
        id: "a-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "a-manager",
        variables: {},
      },
      "node-a-input.json": {
        id: "a-input",
        model: "tacogips/codex-agent",
        promptTemplate: "a-in",
        variables: {},
      },
      "node-a-output.json": {
        id: "a-output",
        model: "tacogips/codex-agent",
        promptTemplate: "a-out",
        variables: {},
      },
      "node-b-manager.json": {
        id: "b-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "b-manager",
        variables: {},
      },
      "node-b-input.json": {
        id: "b-input",
        model: "tacogips/codex-agent",
        promptTemplate: "b-in",
        variables: {},
      },
      "node-b-output.json": {
        id: "b-output",
        model: "tacogips/codex-agent",
        promptTemplate: "b-out",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflow.subWorkflows:vertical subWorkflow groups 'a' and 'b' cross",
    );
  });

  test("rejects root-to-child edges that bypass the sub-workflow manager boundary", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "root-worker",
          kind: "task",
          nodeFile: "node-root-worker.json",
          completion: { type: "none" },
        },
        {
          id: "sw-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-sw-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sw-input",
          kind: "input",
          nodeFile: "node-sw-input.json",
          completion: { type: "none" },
        },
        {
          id: "sw-output",
          kind: "output",
          nodeFile: "node-sw-output.json",
          completion: { type: "none" },
        },
      ],
      edges: [{ from: "root-worker", to: "sw-input", when: "always" }],
      subWorkflows: [
        {
          id: "sw",
          description: "sw",
          managerNodeId: "sw-manager",
          inputNodeId: "sw-input",
          outputNodeId: "sw-output",
          nodeIds: ["sw-manager", "sw-input", "sw-output"],
          inputSources: [{ type: "human-input" }],
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "root-worker", order: 1 },
        { id: "sw-manager", order: 2 },
        { id: "sw-input", order: 3 },
        { id: "sw-output", order: 4 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-root-worker.json": {
        id: "root-worker",
        model: "tacogips/codex-agent",
        promptTemplate: "root-worker",
        variables: {},
      },
      "node-sw-manager.json": {
        id: "sw-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "sw-manager",
        variables: {},
      },
      "node-sw-input.json": {
        id: "sw-input",
        model: "tacogips/codex-agent",
        promptTemplate: "sw-input",
        variables: {},
      },
      "node-sw-output.json": {
        id: "sw-output",
        model: "tacogips/codex-agent",
        promptTemplate: "sw-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflow.edges[0].to:cross-scope edge from root scope must target recipient sub-workflow manager 'sw-manager', not child node 'sw-input'",
    );
  });

  test("rejects child-to-root-worker edges that bypass the root manager boundary", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "root-worker",
          kind: "task",
          nodeFile: "node-root-worker.json",
          completion: { type: "none" },
        },
        {
          id: "sw-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-sw-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sw-input",
          kind: "input",
          nodeFile: "node-sw-input.json",
          completion: { type: "none" },
        },
        {
          id: "sw-output",
          kind: "output",
          nodeFile: "node-sw-output.json",
          completion: { type: "none" },
        },
      ],
      edges: [{ from: "sw-output", to: "root-worker", when: "always" }],
      subWorkflows: [
        {
          id: "sw",
          description: "sw",
          managerNodeId: "sw-manager",
          inputNodeId: "sw-input",
          outputNodeId: "sw-output",
          nodeIds: ["sw-manager", "sw-input", "sw-output"],
          inputSources: [{ type: "human-input" }],
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "root-worker", order: 1 },
        { id: "sw-manager", order: 2 },
        { id: "sw-input", order: 3 },
        { id: "sw-output", order: 4 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-root-worker.json": {
        id: "root-worker",
        model: "tacogips/codex-agent",
        promptTemplate: "root-worker",
        variables: {},
      },
      "node-sw-manager.json": {
        id: "sw-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "sw-manager",
        variables: {},
      },
      "node-sw-input.json": {
        id: "sw-input",
        model: "tacogips/codex-agent",
        promptTemplate: "sw-input",
        variables: {},
      },
      "node-sw-output.json": {
        id: "sw-output",
        model: "tacogips/codex-agent",
        promptTemplate: "sw-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflow.edges[0].to:cross-scope edge from sub-workflow 'sw' to root scope must target workflow manager 'divedra-manager', not root node 'root-worker'",
    );
  });

  test("rejects cross-sub-workflow edges that bypass the recipient manager boundary", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "a-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-a-manager.json",
          completion: { type: "none" },
        },
        {
          id: "a-input",
          kind: "input",
          nodeFile: "node-a-input.json",
          completion: { type: "none" },
        },
        {
          id: "a-output",
          kind: "output",
          nodeFile: "node-a-output.json",
          completion: { type: "none" },
        },
        {
          id: "b-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-b-manager.json",
          completion: { type: "none" },
        },
        {
          id: "b-input",
          kind: "input",
          nodeFile: "node-b-input.json",
          completion: { type: "none" },
        },
        {
          id: "b-output",
          kind: "output",
          nodeFile: "node-b-output.json",
          completion: { type: "none" },
        },
      ],
      edges: [{ from: "a-output", to: "b-input", when: "always" }],
      subWorkflows: [
        {
          id: "a",
          description: "a",
          managerNodeId: "a-manager",
          inputNodeId: "a-input",
          outputNodeId: "a-output",
          nodeIds: ["a-manager", "a-input", "a-output"],
          inputSources: [{ type: "human-input" }],
        },
        {
          id: "b",
          description: "b",
          managerNodeId: "b-manager",
          inputNodeId: "b-input",
          outputNodeId: "b-output",
          nodeIds: ["b-manager", "b-input", "b-output"],
          inputSources: [{ type: "sub-workflow-output", subWorkflowId: "a" }],
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "a-manager", order: 1 },
        { id: "a-input", order: 2 },
        { id: "a-output", order: 3 },
        { id: "b-manager", order: 4 },
        { id: "b-input", order: 5 },
        { id: "b-output", order: 6 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-a-manager.json": {
        id: "a-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "a-manager",
        variables: {},
      },
      "node-a-input.json": {
        id: "a-input",
        model: "tacogips/codex-agent",
        promptTemplate: "a-input",
        variables: {},
      },
      "node-a-output.json": {
        id: "a-output",
        model: "tacogips/codex-agent",
        promptTemplate: "a-output",
        variables: {},
      },
      "node-b-manager.json": {
        id: "b-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "b-manager",
        variables: {},
      },
      "node-b-input.json": {
        id: "b-input",
        model: "tacogips/codex-agent",
        promptTemplate: "b-input",
        variables: {},
      },
      "node-b-output.json": {
        id: "b-output",
        model: "tacogips/codex-agent",
        promptTemplate: "b-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflow.edges[0].to:cross-scope edge from sub-workflow 'a' to sub-workflow 'b' must target recipient manager 'b-manager', not child node 'b-input'",
    );
  });

  test("rejects loop continue target placed after the loop judge", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
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
        {
          id: "loop-judge",
          kind: "loop-judge",
          nodeFile: "node-loop-judge.json",
          completion: { type: "none" },
        },
      ],
      edges: [
        { from: "divedra-manager", to: "loop-judge", when: "always" },
        { from: "loop-judge", to: "worker-1", when: "continue_round" },
      ],
      loops: [
        {
          id: "main-loop",
          judgeNodeId: "loop-judge",
          continueWhen: "continue_round",
          exitWhen: "loop_exit",
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "loop-judge", order: 1 },
        { id: "worker-1", order: 2 },
      ],
    };
    raw.nodePayloads["node-loop-judge.json"] = {
      id: "loop-judge",
      model: "tacogips/codex-agent",
      promptTemplate: "judge",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflow.loops[0].continueWhen:continue edge target 'worker-1' must appear before loop judge 'loop-judge' in vertical order",
    );
  });

  test("rejects crossing loop scopes that cannot be represented vertically", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "loop-a-start",
          kind: "task",
          nodeFile: "node-loop-a-start.json",
          completion: { type: "none" },
        },
        {
          id: "loop-b-start",
          kind: "task",
          nodeFile: "node-loop-b-start.json",
          completion: { type: "none" },
        },
        {
          id: "loop-a-judge",
          kind: "loop-judge",
          nodeFile: "node-loop-a-judge.json",
          completion: { type: "none" },
        },
        {
          id: "loop-b-judge",
          kind: "loop-judge",
          nodeFile: "node-loop-b-judge.json",
          completion: { type: "none" },
        },
      ],
      edges: [
        { from: "loop-a-judge", to: "loop-a-start", when: "retry-a" },
        { from: "loop-a-judge", to: "loop-b-judge", when: "exit-a" },
        { from: "loop-b-judge", to: "loop-b-start", when: "retry-b" },
        { from: "loop-b-judge", to: "loop-a-judge", when: "exit-b" },
      ],
      loops: [
        {
          id: "loop-a",
          judgeNodeId: "loop-a-judge",
          continueWhen: "retry-a",
          exitWhen: "exit-a",
        },
        {
          id: "loop-b",
          judgeNodeId: "loop-b-judge",
          continueWhen: "retry-b",
          exitWhen: "exit-b",
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "loop-a-start", order: 1 },
        { id: "loop-b-start", order: 2 },
        { id: "loop-a-judge", order: 3 },
        { id: "loop-b-judge", order: 4 },
      ],
    };
    raw.nodePayloads["node-loop-a-start.json"] = {
      id: "loop-a-start",
      model: "tacogips/codex-agent",
      promptTemplate: "loop-a-start",
      variables: {},
    };
    raw.nodePayloads["node-loop-b-start.json"] = {
      id: "loop-b-start",
      model: "tacogips/codex-agent",
      promptTemplate: "loop-b-start",
      variables: {},
    };
    raw.nodePayloads["node-loop-a-judge.json"] = {
      id: "loop-a-judge",
      model: "tacogips/codex-agent",
      promptTemplate: "loop-a-judge",
      variables: {},
    };
    raw.nodePayloads["node-loop-b-judge.json"] = {
      id: "loop-b-judge",
      model: "tacogips/codex-agent",
      promptTemplate: "loop-b-judge",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflow.loops:vertical loop scopes 'loop-a' and 'loop-b' cross",
    );
  });

  test("rejects crossing group and loop scopes that cannot be represented vertically", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "group-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-group-manager.json",
          completion: { type: "none" },
        },
        {
          id: "group-input",
          kind: "input",
          nodeFile: "node-group-input.json",
          completion: { type: "none" },
        },
        {
          id: "loop-start",
          kind: "task",
          nodeFile: "node-loop-start.json",
          completion: { type: "none" },
        },
        {
          id: "group-output",
          kind: "output",
          nodeFile: "node-group-output.json",
          completion: { type: "none" },
        },
        {
          id: "loop-judge",
          kind: "loop-judge",
          nodeFile: "node-loop-judge.json",
          completion: { type: "none" },
        },
      ],
      edges: [
        { from: "loop-judge", to: "loop-start", when: "retry" },
        { from: "loop-judge", to: "divedra-manager", when: "exit" },
      ],
      subWorkflows: [
        {
          id: "main-group",
          description: "main-group",
          managerNodeId: "group-manager",
          inputNodeId: "group-input",
          outputNodeId: "group-output",
          nodeIds: [
            "group-manager",
            "group-input",
            "loop-start",
            "group-output",
          ],
          inputSources: [{ type: "human-input" }],
        },
      ],
      loops: [
        {
          id: "main-loop",
          judgeNodeId: "loop-judge",
          continueWhen: "retry",
          exitWhen: "exit",
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "group-manager", order: 1 },
        { id: "group-input", order: 2 },
        { id: "loop-start", order: 3 },
        { id: "group-output", order: 4 },
        { id: "loop-judge", order: 5 },
      ],
    };
    raw.nodePayloads["node-group-manager.json"] = {
      id: "group-manager",
      model: "tacogips/codex-agent",
      promptTemplate: "group-manager",
      variables: {},
    };
    raw.nodePayloads["node-group-input.json"] = {
      id: "group-input",
      model: "tacogips/codex-agent",
      promptTemplate: "group-input",
      variables: {},
    };
    raw.nodePayloads["node-loop-start.json"] = {
      id: "loop-start",
      model: "tacogips/codex-agent",
      promptTemplate: "loop-start",
      variables: {},
    };
    raw.nodePayloads["node-group-output.json"] = {
      id: "group-output",
      model: "tacogips/codex-agent",
      promptTemplate: "group-output",
      variables: {},
    };
    raw.nodePayloads["node-loop-judge.json"] = {
      id: "loop-judge",
      model: "tacogips/codex-agent",
      promptTemplate: "loop-judge",
      variables: {},
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflow:vertical group and loop scopes 'main-group' and 'main-loop' cross",
    );
  });

  test("rejects unsupported inert sub-workflow conversation policy and selection policy", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sw1-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-sw1-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sw1-input",
          kind: "input",
          nodeFile: "node-sw1-input.json",
          completion: { type: "none" },
        },
        {
          id: "sw1-output",
          kind: "output",
          nodeFile: "node-sw1-output.json",
          completion: { type: "none" },
        },
      ],
      subWorkflows: [
        {
          id: "sw1",
          description: "first",
          managerNodeId: "sw1-manager",
          inputNodeId: "sw1-input",
          outputNodeId: "sw1-output",
          nodeIds: ["sw1-manager", "sw1-input", "sw1-output"],
          inputSources: [
            {
              type: "human-input",
              selectionPolicy: { mode: "latest-any" },
            },
          ],
        },
      ],
      subWorkflowConversations: [
        {
          id: "conv-1",
          participants: ["sw1", "sw1"],
          maxTurns: 1,
          stopWhen: "done",
          conversationPolicy: { turnPolicy: "round-robin" },
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "sw1-manager", order: 1 },
        { id: "sw1-input", order: 2 },
        { id: "sw1-output", order: 3 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sw1-manager.json": {
        id: "sw1-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "sw1-manager",
        variables: {},
      },
      "node-sw1-input.json": {
        id: "sw1-input",
        model: "tacogips/codex-agent",
        promptTemplate: "sw1-input",
        variables: {},
      },
      "node-sw1-output.json": {
        id: "sw1-output",
        model: "tacogips/codex-agent",
        promptTemplate: "sw1-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const messages = result.error
      .map((entry) => `${entry.path}:${entry.message}`)
      .join("\n");
    expect(messages).toContain(
      "workflow.subWorkflows[0].inputSources[0].selectionPolicy:is currently unsupported",
    );
    expect(messages).toContain(
      "workflow.subWorkflowConversations[0].conversationPolicy:is currently unsupported",
    );
  });

  test("normalizes legacy sub-workflow aliases inputs and participantsIds", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sw1-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-sw1-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sw1-input",
          kind: "input",
          nodeFile: "node-sw1-input.json",
          completion: { type: "none" },
        },
        {
          id: "sw1-output",
          kind: "output",
          nodeFile: "node-sw1-output.json",
          completion: { type: "none" },
        },
        {
          id: "sw2-manager",
          kind: "subworkflow-manager",
          nodeFile: "node-sw2-manager.json",
          completion: { type: "none" },
        },
        {
          id: "sw2-input",
          kind: "input",
          nodeFile: "node-sw2-input.json",
          completion: { type: "none" },
        },
        {
          id: "sw2-output",
          kind: "output",
          nodeFile: "node-sw2-output.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      subWorkflows: [
        {
          id: "sw1",
          description: "first",
          managerNodeId: "sw1-manager",
          inputNodeId: "sw1-input",
          outputNodeId: "sw1-output",
          nodeIds: ["sw1-manager", "sw1-input", "sw1-output"],
          inputs: [{ type: "human-input" }],
        },
        {
          id: "sw2",
          description: "second",
          managerNodeId: "sw2-manager",
          inputNodeId: "sw2-input",
          outputNodeId: "sw2-output",
          nodeIds: ["sw2-manager", "sw2-input", "sw2-output"],
          inputSources: [{ type: "sub-workflow-output", subWorkflowId: "sw1" }],
        },
      ],
      subWorkflowConversations: [
        {
          id: "conv-legacy",
          participantsIds: ["sw1", "sw2"],
          maxTurns: 2,
          stopWhen: "done",
        },
      ],
    };
    raw.workflowVis = {
      nodes: [
        { id: "divedra-manager", x: 10, y: 10, width: 100, height: 80 },
        { id: "sw1-manager", x: 120, y: 10, width: 100, height: 80 },
        { id: "sw1-input", x: 230, y: 10, width: 100, height: 80 },
        { id: "sw1-output", x: 340, y: 10, width: 100, height: 80 },
        { id: "sw2-manager", x: 450, y: 10, width: 100, height: 80 },
        { id: "sw2-input", x: 560, y: 10, width: 100, height: 80 },
        { id: "sw2-output", x: 670, y: 10, width: 100, height: 80 },
      ],
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sw1-manager.json": {
        id: "sw1-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "m1",
        variables: {},
      },
      "node-sw1-input.json": {
        id: "sw1-input",
        model: "tacogips/codex-agent",
        promptTemplate: "in1",
        variables: {},
      },
      "node-sw1-output.json": {
        id: "sw1-output",
        model: "tacogips/codex-agent",
        promptTemplate: "out1",
        variables: {},
      },
      "node-sw2-manager.json": {
        id: "sw2-manager",
        model: "tacogips/codex-agent",
        promptTemplate: "m2",
        variables: {},
      },
      "node-sw2-input.json": {
        id: "sw2-input",
        model: "tacogips/codex-agent",
        promptTemplate: "in2",
        variables: {},
      },
      "node-sw2-output.json": {
        id: "sw2-output",
        model: "tacogips/codex-agent",
        promptTemplate: "out2",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.subWorkflows[0]?.inputSources[0]?.type).toBe(
      "human-input",
    );
    expect(
      result.value.workflow.subWorkflowConversations?.[0]?.participants,
    ).toEqual(["sw1", "sw2"]);
  });
});
