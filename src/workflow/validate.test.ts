import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { crossWorkflowCallsFromSteps } from "./cross-workflow-from-steps";
import {
  isStrictWorkflowAuthorshipValidation,
  validateWorkflowBundleAsync,
  validateWorkflowBundle,
  validateWorkflowBundleDetailed,
} from "./validate";
import {
  getLegacyAuthoredEdges,
  getLegacyAuthoredLoops,
  getLegacyEntryNodeId,
  getLegacyManagerNodeId,
  getStructuralEdges,
  getStructuralLoops,
  getStructuralSubWorkflows,
  resolveWorkflowEntryRuntimeId,
  resolveWorkflowManagerRuntimeId,
  type NodeAddonDefinition,
  type NodeAddonPayloadResolver,
  type WorkflowJson,
} from "./types";

describe("resolveWorkflowEntryRuntimeId", () => {
  test("uses entryStepId when entryStepId and steps are present", () => {
    expect(
      resolveWorkflowEntryRuntimeId({
        entryStepId: "entry-step",
        steps: [],
        entryNodeId: "stale-compat-entry",
      } as unknown as WorkflowJson),
    ).toBe("entry-step");
  });

  test("uses entryNodeId for legacy node-graph bundles", () => {
    expect(
      resolveWorkflowEntryRuntimeId({
        entryNodeId: "legacy-entry",
        managerNodeId: "legacy-manager",
      } as unknown as WorkflowJson),
    ).toBe("legacy-entry");
  });

  test("falls back to managerNodeId for legacy manager-only bundles", () => {
    expect(
      resolveWorkflowEntryRuntimeId({
        managerNodeId: "legacy-manager",
      } as unknown as WorkflowJson),
    ).toBe("legacy-manager");
  });

  test("throws for legacy bundles that expose neither entryNodeId nor managerNodeId", () => {
    expect(() =>
      resolveWorkflowEntryRuntimeId({
        workflowId: "broken-legacy-entry",
      } as WorkflowJson),
    ).toThrowError(
      "workflow 'broken-legacy-entry' has no entry runtime id; expected entryNodeId or managerNodeId on a legacy node-graph bundle",
    );
  });
});

describe("resolveWorkflowManagerRuntimeId", () => {
  test("uses managerStepId ?? entryStepId when entryStepId and steps are present", () => {
    expect(
      resolveWorkflowManagerRuntimeId({
        entryStepId: "e",
        managerStepId: "m",
        steps: [],
        managerNodeId: "compat-synthetic",
      } as unknown as WorkflowJson),
    ).toBe("m");
  });

  test("uses entryStepId when managerStepId is omitted on step-addressed bundles", () => {
    expect(
      resolveWorkflowManagerRuntimeId({
        entryStepId: "e",
        steps: [],
        managerNodeId: "compat",
      } as unknown as WorkflowJson),
    ).toBe("e");
  });

  test("uses managerNodeId for legacy node-graph bundles", () => {
    expect(
      resolveWorkflowManagerRuntimeId({
        managerNodeId: "root",
      } as unknown as WorkflowJson),
    ).toBe("root");
  });

  test("throws for legacy bundles that expose neither managerNodeId nor entryNodeId", () => {
    expect(() =>
      resolveWorkflowManagerRuntimeId({
        workflowId: "broken-legacy",
      } as WorkflowJson),
    ).toThrowError(
      "workflow 'broken-legacy' has no manager runtime id; expected managerNodeId or entryNodeId on a legacy node-graph bundle",
    );
  });
});

describe("getStructuralEdges", () => {
  test("derives step-addressed local edges from step transitions instead of compatibility workflow.edges", () => {
    expect(
      getStructuralEdges({
        entryStepId: "manager",
        steps: [
          {
            id: "manager",
            nodeId: "manager-node",
            transitions: [
              { toStepId: "worker", label: "always" },
              {
                toStepId: "child-entry",
                toWorkflowId: "child-flow",
                resumeStepId: "after-child",
              },
            ],
          },
          {
            id: "worker",
            nodeId: "worker-node",
            transitions: [{ toStepId: "after-child", label: "done" }],
          },
          { id: "after-child", nodeId: "after-child-node" },
        ],
        edges: [{ from: "stale", to: "edge", when: "never" }],
      } as unknown as WorkflowJson),
    ).toEqual([
      { from: "manager", to: "worker", when: "always" },
      { from: "worker", to: "after-child", when: "done" },
    ]);
  });

  test("uses authored workflow.edges for legacy node-graph bundles", () => {
    expect(
      getStructuralEdges({
        edges: [{ from: "root", to: "worker", when: "always" }],
      } as unknown as WorkflowJson),
    ).toEqual([{ from: "root", to: "worker", when: "always" }]);
  });

  test("derives sequential legacy edges from node order when workflow.edges is omitted", () => {
    expect(
      getStructuralEdges({
        nodes: [
          { id: "root", nodeFile: "node-root.json" },
          {
            id: "repeat",
            nodeFile: "node-repeat.json",
            repeat: { while: "again", restartAt: "root" },
          },
          { id: "done", nodeFile: "node-done.json" },
        ],
      } as unknown as WorkflowJson),
    ).toEqual([
      { from: "root", to: "repeat", when: "always" },
      { from: "repeat", to: "root", when: "again" },
      { from: "repeat", to: "done", when: "!(again)" },
    ]);
  });
});

describe("getStructuralLoops", () => {
  test("derives legacy repeat loops from node.repeat without requiring workflow.loops", () => {
    expect(
      getStructuralLoops({
        nodes: [
          { id: "root", nodeFile: "node-root.json" },
          {
            id: "repeat",
            nodeFile: "node-repeat.json",
            repeat: { while: "again", restartAt: "root", maxIterations: 2 },
          },
          { id: "done", nodeFile: "node-done.json" },
        ],
      } as unknown as WorkflowJson),
    ).toEqual([
      {
        id: "repeat-repeat",
        judgeNodeId: "repeat",
        continueWhen: "again",
        exitWhen: "!(again)",
        maxIterations: 2,
      },
    ]);
  });
});

/** Opt in to legacy node-ordered / structural authoring for tests of the compatibility validator path. */
const legacyWorkflowAuthorshipOk = {
  rejectLegacyWorkflowAuthoring: false,
} as const;

function makeValidRaw(): {
  workflow: unknown;
  nodePayloads: Record<string, unknown>;
} {
  return {
    workflow: {
      workflowId: "demo",
      description: "demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "divedra-manager",
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
    },
    nodePayloads: {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-worker-1.json": {
        id: "worker-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "worker",
        variables: {},
      },
    },
  };
}

function makeUnifiedRoleRaw(): {
  workflow: unknown;
  nodePayloads: Record<string, unknown>;
} {
  return {
    workflow: {
      workflowId: "unified-demo",
      description: "unified demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
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

function deleteLegacyBranchingField(workflow: unknown): void {
  const workflowRecord = workflow as {
    branching?: unknown;
    edges?: unknown;
    loops?: unknown;
  };
  delete workflowRecord.branching;
  delete workflowRecord.edges;
  delete workflowRecord.loops;
}

function makeValidStepAddressedRaw(): {
  workflow: unknown;
  nodePayloads: Record<string, unknown>;
} {
  return {
    workflow: {
      workflowId: "step-demo",
      description: "step demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerStepId: "manager",
      entryStepId: "manager",
      nodes: [
        {
          id: "manager-node",
          nodeFile: "nodes/node-manager.json",
        },
        {
          id: "worker-node",
          nodeFile: "nodes/node-worker.json",
        },
      ],
      steps: [
        {
          id: "manager",
          nodeId: "manager-node",
          role: "manager",
          transitions: [{ toStepId: "worker" }],
        },
        {
          id: "worker",
          nodeId: "worker-node",
        },
      ],
    },
    nodePayloads: {
      "nodes/node-manager.json": {
        id: "manager-node",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "nodes/node-worker.json": {
        id: "worker-node",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "worker",
        variables: {},
      },
    },
  };
}

describe("validateWorkflowBundle", () => {
  test("defaults to strict authorship validation when legacy default env is unset", () => {
    const prev = process.env["DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT"];
    delete process.env["DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT"];
    try {
      expect(isStrictWorkflowAuthorshipValidation({})).toBe(true);
      expect(
        isStrictWorkflowAuthorshipValidation({
          rejectLegacyWorkflowAuthoring: false,
        }),
      ).toBe(false);
    } finally {
      if (prev === undefined) {
        delete process.env["DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT"];
      } else {
        process.env["DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT"] = prev;
      }
    }
  });

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

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
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
    const result = validateWorkflowBundle(
      makeValidRaw(),
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.workflowId).toBe("demo");
    expect(result.value.workflow.nodes).toHaveLength(2);
    expect(result.value.workflow.nodes[0]?.role).toBeUndefined();
    expect(result.value.workflow.nodes[1]?.role).toBeUndefined();
  });

  test("rejects step-addressed bundle that also includes legacy entryNodeId", () => {
    const raw = makeValidStepAddressedRaw();
    (raw.workflow as Record<string, unknown>)["entryNodeId"] = "manager";
    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.entryNodeId",
          message: "is not part of the step-addressed workflow schema",
        }),
      ]),
    );
  });

  test("accepts strict step-addressed validation for canonical step-addressed payloads", () => {
    const result = validateWorkflowBundle(makeValidStepAddressedRaw(), {
      rejectLegacyWorkflowAuthoring: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.entryStepId).toBe("manager");
    expect(result.value.workflow.managerStepId).toBe("manager");
    expect(result.value.workflow.steps?.map((step) => step.id)).toEqual([
      "manager",
      "worker",
    ]);
  });

  test("examples default-superviser workflow.json passes strict authorship validation", () => {
    const workflowPath = path.join(
      process.cwd(),
      "examples",
      "default-superviser",
      "workflow.json",
    );
    const workflow = JSON.parse(readFileSync(workflowPath, "utf8")) as unknown;
    const result = validateWorkflowBundleDetailed(
      { workflow, nodePayloads: {} },
      { rejectLegacyWorkflowAuthoring: true },
    );
    expect(result.ok).toBe(true);
  });

  test("rejects cross-workflow step transitions without resumeStepId", () => {
    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      { toStepId: "ext-step", toWorkflowId: "other-workflow" },
    ];
    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.steps[0].transitions[0].resumeStepId" &&
          issue.message.includes("required when toWorkflowId is set"),
      ),
    ).toBe(true);
  });

  test("rejects resumeStepId on local step transitions", () => {
    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "worker",
        resumeStepId: "worker",
      },
    ];
    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.steps[0].transitions[0].resumeStepId" &&
          issue.message.includes("only when toWorkflowId is set"),
      ),
    ).toBe(true);
  });

  test("keeps cross-workflow step transitions on the step graph (no merged workflowCalls)", () => {
    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "callee-entry",
        toWorkflowId: "other-workflow",
        resumeStepId: "worker",
      },
    ];
    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect("workflowCalls" in result.value.bundle.workflow).toBe(false);
    expect(
      (result.value.bundle.workflow as unknown as Record<string, unknown>)[
        "branching"
      ],
    ).toBeUndefined();
    expect(
      crossWorkflowCallsFromSteps(result.value.bundle.workflow.steps),
    ).toEqual([
      {
        id: "__cw:manager",
        workflowId: "other-workflow",
        callerNodeId: "manager",
        callerStepId: "manager",
        resultNodeId: "worker",
        source: "step-transition",
      },
    ]);
  });

  test("maps cross-workflow step transition label to derived workflowCall when for execution", () => {
    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "callee-entry",
        toWorkflowId: "other-workflow",
        resumeStepId: "worker",
        label: "need_review",
      },
    ];
    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect("workflowCalls" in result.value.bundle.workflow).toBe(false);
    expect(
      (result.value.bundle.workflow as unknown as Record<string, unknown>)[
        "branching"
      ],
    ).toBeUndefined();
    expect(
      crossWorkflowCallsFromSteps(result.value.bundle.workflow.steps),
    ).toEqual([
      {
        id: "__cw:manager",
        workflowId: "other-workflow",
        callerNodeId: "manager",
        callerStepId: "manager",
        resultNodeId: "worker",
        when: "need_review",
        source: "step-transition",
      },
    ]);
  });

  test("rejects top-level workflowCalls on step-addressed bundles even with cross-workflow step transitions (non-strict)", () => {
    const raw = makeValidStepAddressedRaw();
    const workflow = raw.workflow as Record<string, unknown>;
    (workflow as { workflowCalls: readonly unknown[] }).workflowCalls = [
      {
        id: "extra-call",
        workflowId: "callee",
        callerNodeId: "manager",
        callerStepId: "manager",
        resultNodeId: "worker",
      },
    ];
    const steps = workflow["steps"] as Array<Record<string, unknown>>;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "callee-entry",
        toWorkflowId: "callee",
        resumeStepId: "worker",
      },
    ];
    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.workflowCalls" &&
          issue.message.includes(
            "is not part of the step-addressed workflow schema",
          ),
      ),
    ).toBe(true);
  });

  test("async validation requires cross-workflow toStepId to match callee entry when workflowRoot is set", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wf-cross-"));
    const calleeName = "callee-wf";
    await mkdir(path.join(root, calleeName), { recursive: true });
    await writeFile(
      path.join(root, calleeName, "workflow.json"),
      JSON.stringify({
        workflowId: "callee-wf",
        description: "c",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "real-entry",
        nodes: [],
        steps: [],
      }),
      "utf8",
    );

    const rawMismatch = makeValidStepAddressedRaw();
    const stepsMismatch = (
      rawMismatch.workflow as { steps: Array<Record<string, unknown>> }
    ).steps;
    (stepsMismatch[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "wrong-step",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const bad = await validateWorkflowBundleAsync(rawMismatch, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) {
      return;
    }
    expect(
      bad.error.some(
        (issue) =>
          issue.path === "workflow.steps[0].transitions[0].toStepId" &&
          issue.message.includes("real-entry"),
      ),
    ).toBe(true);

    const rawOk = makeValidStepAddressedRaw();
    const stepsOk = (
      rawOk.workflow as { steps: Array<Record<string, unknown>> }
    ).steps;
    (stepsOk[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "real-entry",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const good = await validateWorkflowBundleAsync(rawOk, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(good.ok).toBe(true);
  });

  test("sync validateWorkflowBundleDetailed applies callee entry alignment when workflowRoot is set", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wf-cross-sync-"));
    const calleeName = "callee-wf";
    await mkdir(path.join(root, calleeName), { recursive: true });
    await writeFile(
      path.join(root, calleeName, "workflow.json"),
      JSON.stringify({
        workflowId: "callee-wf",
        description: "c",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "real-entry",
        nodes: [],
        steps: [],
      }),
      "utf8",
    );

    const rawMismatch = makeValidStepAddressedRaw();
    const stepsMismatch = (
      rawMismatch.workflow as { steps: Array<Record<string, unknown>> }
    ).steps;
    (stepsMismatch[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "wrong-step",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const bad = validateWorkflowBundleDetailed(rawMismatch, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) {
      return;
    }
    expect(
      bad.error.some(
        (issue) =>
          issue.path === "workflow.steps[0].transitions[0].toStepId" &&
          issue.message.includes("real-entry"),
      ),
    ).toBe(true);
  });

  test("async validation rejects a legacy entryNodeId-only callee for step-addressed cross-workflow transitions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wf-cross-legacy-callee-"));
    const calleeName = "legacy-callee";
    await mkdir(path.join(root, calleeName), { recursive: true });
    await writeFile(
      path.join(root, calleeName, "workflow.json"),
      JSON.stringify({
        workflowId: calleeName,
        description: "legacy callee",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryNodeId: "legacy-entry",
        nodes: [],
      }),
      "utf8",
    );

    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "legacy-entry",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const result = await validateWorkflowBundleAsync(raw, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.steps[0].transitions[0].toWorkflowId" &&
          issue.message.includes("must declare managerStepId or entryStepId"),
      ),
    ).toBe(true);
  });

  test("sync validation rejects a legacy entryNodeId-only callee for step-addressed cross-workflow transitions", () => {
    const root = mkdtempSync(
      path.join(tmpdir(), "wf-cross-legacy-callee-sync-"),
    );
    const calleeName = "legacy-callee-sync";
    mkdirSync(path.join(root, calleeName), { recursive: true });
    writeFileSync(
      path.join(root, calleeName, "workflow.json"),
      JSON.stringify({
        workflowId: calleeName,
        description: "legacy callee",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryNodeId: "legacy-entry",
        nodes: [],
      }),
      "utf8",
    );

    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "legacy-entry",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.steps[0].transitions[0].toWorkflowId" &&
          issue.message.includes("must declare managerStepId or entryStepId"),
      ),
    ).toBe(true);
  });

  test("async validation resolves cross-workflow callees by workflowId even when the directory name differs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wf-cross-id-async-"));
    const calleeDirectoryName = "callee-directory";
    const calleeWorkflowId = "callee-by-id";
    await mkdir(path.join(root, calleeDirectoryName), { recursive: true });
    await writeFile(
      path.join(root, calleeDirectoryName, "workflow.json"),
      JSON.stringify({
        workflowId: calleeWorkflowId,
        description: "c",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "real-entry",
        nodes: [],
        steps: [],
      }),
      "utf8",
    );

    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "real-entry",
        toWorkflowId: calleeWorkflowId,
        resumeStepId: "worker",
      },
    ];

    const result = await validateWorkflowBundleAsync(raw, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(result.ok).toBe(true);
  });

  test("sync validation resolves cross-workflow callees by workflowId even when the directory name differs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "wf-cross-id-sync-"));
    const calleeDirectoryName = "callee-directory";
    const calleeWorkflowId = "callee-by-id";
    mkdirSync(path.join(root, calleeDirectoryName), { recursive: true });
    writeFileSync(
      path.join(root, calleeDirectoryName, "workflow.json"),
      JSON.stringify({
        workflowId: calleeWorkflowId,
        description: "c",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "real-entry",
        nodes: [],
        steps: [],
      }),
      "utf8",
    );

    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "real-entry",
        toWorkflowId: calleeWorkflowId,
        resumeStepId: "worker",
      },
    ];

    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(result.ok).toBe(true);
  });

  test("async validation uses callee managerStepId as the start step when both managerStepId and entryStepId are set", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wf-cross-"));
    const calleeName = "managed-callee";
    await mkdir(path.join(root, calleeName), { recursive: true });
    await writeFile(
      path.join(root, calleeName, "workflow.json"),
      JSON.stringify({
        workflowId: "managed-callee",
        description: "c",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        managerStepId: "mgr-step",
        entryStepId: "other-step",
        nodes: [],
        steps: [],
      }),
      "utf8",
    );

    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "other-step",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const bad = await validateWorkflowBundleAsync(raw, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) {
      return;
    }
    expect(
      bad.error.some(
        (issue) =>
          issue.path === "workflow.steps[0].transitions[0].toStepId" &&
          issue.message.includes("mgr-step"),
      ),
    ).toBe(true);
  });

  test("async validation accepts a callee with an implicit manager-role step when managerStepId is omitted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wf-cross-"));
    const calleeName = "implicit-managed-callee";
    await mkdir(path.join(root, calleeName), { recursive: true });
    await writeFile(
      path.join(root, calleeName, "workflow.json"),
      JSON.stringify({
        workflowId: calleeName,
        description: "c",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "worker-step",
        nodes: [{ id: "mgr-node", nodeFile: "node-mgr.json" }],
        steps: [
          {
            id: "mgr-step",
            nodeId: "mgr-node",
            role: "manager",
          },
          {
            id: "worker-step",
            nodeId: "mgr-node",
          },
        ],
      }),
      "utf8",
    );

    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "mgr-step",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const result = await validateWorkflowBundleAsync(raw, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(result.ok).toBe(true);
  });

  test("sync validation accepts a callee with an implicit manager-role step when managerStepId is omitted", () => {
    const root = mkdtempSync(path.join(tmpdir(), "wf-cross-sync-"));
    const calleeName = "implicit-managed-callee-sync";
    mkdirSync(path.join(root, calleeName), { recursive: true });
    writeFileSync(
      path.join(root, calleeName, "workflow.json"),
      JSON.stringify({
        workflowId: calleeName,
        description: "c",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "worker-step",
        nodes: [{ id: "mgr-node", nodeFile: "node-mgr.json" }],
        steps: [
          {
            id: "mgr-step",
            nodeId: "mgr-node",
            role: "manager",
          },
          {
            id: "worker-step",
            nodeId: "mgr-node",
          },
        ],
      }),
      "utf8",
    );

    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "mgr-step",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(result.ok).toBe(true);
  });

  test("async validation rejects an ambiguous implicit callee manager when managerStepId is omitted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wf-cross-ambiguous-"));
    const calleeName = "ambiguous-managed-callee";
    await mkdir(path.join(root, calleeName), { recursive: true });
    await writeFile(
      path.join(root, calleeName, "workflow.json"),
      JSON.stringify({
        workflowId: calleeName,
        description: "c",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "worker-step",
        nodes: [
          { id: "mgr-node-a", nodeFile: "node-mgr-a.json" },
          { id: "mgr-node-b", nodeFile: "node-mgr-b.json" },
          { id: "worker-node", nodeFile: "node-worker.json" },
        ],
        steps: [
          {
            id: "mgr-step-a",
            nodeId: "mgr-node-a",
            role: "manager",
          },
          {
            id: "mgr-step-b",
            nodeId: "mgr-node-b",
            role: "manager",
          },
          {
            id: "worker-step",
            nodeId: "worker-node",
          },
        ],
      }),
      "utf8",
    );

    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "mgr-step-a",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const result = await validateWorkflowBundleAsync(raw, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.steps[0].transitions[0].toWorkflowId" &&
          issue.message.includes("more than one manager-role step"),
      ),
    ).toBe(true);
  });

  test("sync validation rejects an ambiguous implicit callee manager when managerStepId is omitted", () => {
    const root = mkdtempSync(path.join(tmpdir(), "wf-cross-ambiguous-sync-"));
    const calleeName = "ambiguous-managed-callee-sync";
    mkdirSync(path.join(root, calleeName), { recursive: true });
    writeFileSync(
      path.join(root, calleeName, "workflow.json"),
      JSON.stringify({
        workflowId: calleeName,
        description: "c",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "worker-step",
        nodes: [
          { id: "mgr-node-a", nodeFile: "node-mgr-a.json" },
          { id: "mgr-node-b", nodeFile: "node-mgr-b.json" },
          { id: "worker-node", nodeFile: "node-worker.json" },
        ],
        steps: [
          {
            id: "mgr-step-a",
            nodeId: "mgr-node-a",
            role: "manager",
          },
          {
            id: "mgr-step-b",
            nodeId: "mgr-node-b",
            role: "manager",
          },
          {
            id: "worker-step",
            nodeId: "worker-node",
          },
        ],
      }),
      "utf8",
    );

    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "mgr-step-a",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.steps[0].transitions[0].toWorkflowId" &&
          issue.message.includes("more than one manager-role step"),
      ),
    ).toBe(true);
  });

  test("async validation accepts a file-backed callee with an implicit manager-role step when managerStepId is omitted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wf-cross-file-step-"));
    const calleeName = "file-step-managed-callee";
    const calleeRoot = path.join(root, calleeName);
    await mkdir(path.join(calleeRoot, "steps"), { recursive: true });
    await writeFile(
      path.join(calleeRoot, "workflow.json"),
      JSON.stringify({
        workflowId: calleeName,
        description: "c",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "worker-step",
        nodes: [{ id: "mgr-node", nodeFile: "node-mgr.json" }],
        steps: [
          {
            id: "mgr-step",
            stepFile: "steps/step-mgr.json",
          },
          {
            id: "worker-step",
            stepFile: "steps/step-worker.json",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(calleeRoot, "steps/step-mgr.json"),
      JSON.stringify({
        id: "mgr-step",
        nodeId: "mgr-node",
        role: "manager",
      }),
      "utf8",
    );
    await writeFile(
      path.join(calleeRoot, "steps/step-worker.json"),
      JSON.stringify({
        id: "worker-step",
        nodeId: "mgr-node",
      }),
      "utf8",
    );

    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "mgr-step",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const result = await validateWorkflowBundleAsync(raw, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(result.ok).toBe(true);
  });

  test("sync validation accepts a file-backed callee with an implicit manager-role step when managerStepId is omitted", () => {
    const root = mkdtempSync(path.join(tmpdir(), "wf-cross-file-step-sync-"));
    const calleeName = "file-step-managed-callee-sync";
    const calleeRoot = path.join(root, calleeName);
    mkdirSync(path.join(calleeRoot, "steps"), { recursive: true });
    writeFileSync(
      path.join(calleeRoot, "workflow.json"),
      JSON.stringify({
        workflowId: calleeName,
        description: "c",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "worker-step",
        nodes: [{ id: "mgr-node", nodeFile: "node-mgr.json" }],
        steps: [
          {
            id: "mgr-step",
            stepFile: "steps/step-mgr.json",
          },
          {
            id: "worker-step",
            stepFile: "steps/step-worker.json",
          },
        ],
      }),
      "utf8",
    );
    writeFileSync(
      path.join(calleeRoot, "steps/step-mgr.json"),
      JSON.stringify({
        id: "mgr-step",
        nodeId: "mgr-node",
        role: "manager",
      }),
      "utf8",
    );
    writeFileSync(
      path.join(calleeRoot, "steps/step-worker.json"),
      JSON.stringify({
        id: "worker-step",
        nodeId: "mgr-node",
      }),
      "utf8",
    );

    const raw = makeValidStepAddressedRaw();
    const steps = (raw.workflow as { steps: Array<Record<string, unknown>> })
      .steps;
    (steps[0] as { transitions: unknown[] }).transitions = [
      {
        toStepId: "mgr-step",
        toWorkflowId: calleeName,
        resumeStepId: "worker",
      },
    ];

    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: true,
      workflowRoot: root,
    });
    expect(result.ok).toBe(true);
  });

  test("rejects legacy node-addressed authoring in strict step-addressed validation mode", () => {
    const result = validateWorkflowBundleDetailed(makeValidRaw(), {
      rejectLegacyWorkflowAuthoring: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.entryStepId",
          message: "must be a non-empty string",
        }),
        expect.objectContaining({
          path: "workflow.managerNodeId",
          message: "is not part of the step-addressed workflow schema",
        }),
        expect.objectContaining({
          path: "workflow.steps",
          message: "must be an array",
        }),
      ]),
    );
  });

  test("accepts workflow definitions without a top-level description", () => {
    const raw = makeValidRaw();
    delete (raw.workflow as { description?: unknown }).description;

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.description).toBe("");
  });

  test("rejects authored branching on legacy node-graph bundles", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      branching: { mode: "fan-out" },
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.branching",
          message:
            "authored branching is legacy compatibility only and is no longer supported",
        }),
      ]),
    );
    expect(
      result.error.some((issue) => issue.path === "workflow.branching.mode"),
    ).toBe(false);
  });

  test("rejects workflow ids that are unsafe for runtime filesystem namespaces", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      workflowId: "../demo",
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
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
    const result = validateWorkflowBundle(
      makeUnifiedRoleRaw(),
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(getLegacyEntryNodeId(result.value.workflow)).toBeUndefined();
    expect(resolveWorkflowEntryRuntimeId(result.value.workflow)).toBe(
      "divedra-manager",
    );
    expect(result.value.workflow.nodes[0]?.role).toBe("manager");
    expect(result.value.workflow.nodes[2]?.control).toBe("loop-judge");
    expect(result.value.workflow.nodes[2]?.kind).toBe("loop-judge");
  });

  test("accepts step-addressed workflows with reusable node registry entries", () => {
    const result = validateWorkflowBundle({
      workflow: {
        workflowId: "step-demo",
        description: "step addressed workflow",
        defaults: {
          nodeTimeoutMs: 120000,
          timeoutPolicy: {
            onTimeout: "retry-same-step",
            maxRetries: 1,
          },
        },
        managerStepId: "manager",
        entryStepId: "manager",
        nodes: [
          {
            id: "manager-node",
            nodeFile: "nodes/node-manager.json",
          },
          {
            id: "coder-node",
            nodeFile: "nodes/node-coder.json",
          },
        ],
        steps: [
          {
            id: "manager",
            nodeId: "manager-node",
            role: "manager",
            transitions: [{ toStepId: "implement" }],
          },
          {
            id: "implement",
            nodeId: "coder-node",
            role: "worker",
            transitions: [{ toStepId: "review" }],
          },
          {
            id: "review",
            nodeId: "coder-node",
            role: "worker",
            promptVariant: "self-review",
          },
        ],
      },
      nodePayloads: {
        "nodes/node-manager.json": {
          id: "manager-node",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "manager",
          variables: {},
          managerType: "code",
        },
        "nodes/node-coder.json": {
          id: "coder-node",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "implement",
          variables: {},
          promptVariants: {
            "self-review": {
              promptTemplate: "review",
            },
          },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.nodeRegistry?.map((node) => node.id)).toEqual([
      "manager-node",
      "coder-node",
    ]);
    expect(result.value.workflow.steps?.map((step) => step.id)).toEqual([
      "manager",
      "implement",
      "review",
    ]);
    expect(getLegacyAuthoredEdges(result.value.workflow)).toBeUndefined();
    expect(result.value.nodePayloads["manager"]?.managerType).toBe("code");
    expect(result.value.nodePayloads["implement"]?.promptTemplate).toBe(
      "implement",
    );
    expect(result.value.nodePayloads["review"]?.promptTemplate).toBe("review");
  });

  test("defaults manager steps to code-manager payloads without LLM fields", () => {
    const result = validateWorkflowBundle({
      workflow: {
        workflowId: "step-code-manager-default",
        defaults: {
          nodeTimeoutMs: 120000,
        },
        managerStepId: "manager-step",
        entryStepId: "manager-step",
        nodes: [
          {
            id: "manager-node",
            nodeFile: "nodes/node-manager.json",
          },
          {
            id: "worker-node",
            nodeFile: "nodes/node-worker.json",
          },
        ],
        steps: [
          {
            id: "manager-step",
            nodeId: "manager-node",
            transitions: [{ toStepId: "worker-step" }],
          },
          {
            id: "worker-step",
            nodeId: "worker-node",
          },
        ],
      },
      nodePayloads: {
        "nodes/node-manager.json": {
          id: "manager-node",
          variables: {},
        },
        "nodes/node-worker.json": {
          id: "worker-node",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "implement",
          variables: {},
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.nodePayloads["manager-step"]).toMatchObject({
      id: "manager-step",
      managerType: "code",
      variables: {},
    });
    expect(result.value.nodePayloads["manager-step"]?.executionBackend).toBe(
      undefined,
    );
    expect(result.value.nodePayloads["manager-step"]?.promptTemplate).toBe(
      undefined,
    );
  });

  test("rejects managerType on worker-role steps in step-addressed workflows", () => {
    const result = validateWorkflowBundle({
      workflow: {
        workflowId: "step-worker-manager-type",
        defaults: {
          nodeTimeoutMs: 120000,
        },
        managerStepId: "manager-step",
        entryStepId: "manager-step",
        nodes: [
          {
            id: "shared-node",
            nodeFile: "nodes/node-shared.json",
          },
        ],
        steps: [
          {
            id: "manager-step",
            nodeId: "shared-node",
            role: "manager",
          },
          {
            id: "worker-step",
            nodeId: "shared-node",
            role: "worker",
          },
        ],
      },
      nodePayloads: {
        "nodes/node-shared.json": {
          id: "shared-node",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "shared prompt",
          variables: {},
          managerType: "code",
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.steps[1].nodeId",
          message:
            "references node 'shared-node' whose payload declares managerType; managerType is valid only for manager-role steps",
        }),
      ]),
    );
  });

  test("rejects add-on-backed node registry entries for manager steps in step-addressed workflows", () => {
    const result = validateWorkflowBundle({
      workflow: {
        workflowId: "step-manager-addon",
        defaults: {
          nodeTimeoutMs: 120000,
        },
        managerStepId: "manager-step",
        entryStepId: "manager-step",
        nodes: [
          {
            id: "shared-node",
            addon: {
              name: "divedra/codex-worker",
              version: "1",
              config: {
                model: "gpt-5-nano",
                promptTemplate: "shared prompt",
              },
            },
          },
        ],
        steps: [
          {
            id: "manager-step",
            nodeId: "shared-node",
            role: "manager",
          },
        ],
      },
      nodePayloads: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.steps[0].nodeId",
          message:
            "manager step 'manager-step' must reference a file-backed node; add-on-backed node registry entry 'shared-node' is worker-only",
        }),
      ]),
    );
  });

  test("rejects duplicate step ids and node registry ids in step-addressed workflows", () => {
    const result = validateWorkflowBundle({
      workflow: {
        workflowId: "step-duplicate-demo",
        defaults: {
          nodeTimeoutMs: 120000,
        },
        entryStepId: "manager",
        managerStepId: "manager",
        nodes: [
          {
            id: "shared-node",
            nodeFile: "nodes/node-manager.json",
          },
          {
            id: "shared-node",
            nodeFile: "nodes/node-coder.json",
          },
        ],
        steps: [
          {
            id: "manager",
            nodeId: "shared-node",
            role: "manager",
          },
          {
            id: "manager",
            nodeId: "shared-node",
            role: "worker",
          },
        ],
      },
      nodePayloads: {
        "nodes/node-manager.json": {
          id: "shared-node",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "manager",
          variables: {},
        },
        "nodes/node-coder.json": {
          id: "shared-node",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "worker",
          variables: {},
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.nodes[1].id",
          message: "duplicate node registry id 'shared-node'",
        }),
        expect.objectContaining({
          path: "workflow.steps[1].id",
          message: "duplicate step id 'manager'",
        }),
      ]),
    );
  });

  test("rejects mixing stepFile with inline step fields in authored step-addressed workflows", () => {
    const result = validateWorkflowBundleDetailed({
      workflow: {
        workflowId: "step-file-inline-mix",
        defaults: {
          nodeTimeoutMs: 120000,
        },
        entryStepId: "manager",
        nodes: [
          {
            id: "manager-node",
            nodeFile: "nodes/node-manager.json",
          },
        ],
        steps: [
          {
            id: "manager",
            stepFile: "steps/step-manager.json",
            nodeId: "manager-node",
            role: "manager",
          },
        ],
      },
      nodePayloads: {
        "nodes/node-manager.json": {
          id: "manager-node",
          variables: {},
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.steps[0].nodeId",
          message:
            "must not be authored inline when workflow.steps[].stepFile is used",
        }),
        expect.objectContaining({
          path: "workflow.steps[0].role",
          message:
            "must not be authored inline when workflow.steps[].stepFile is used",
        }),
      ]),
    );
  });

  test("treats malformed steps authoring as step-addressed schema input", () => {
    const result = validateWorkflowBundleDetailed({
      workflow: {
        workflowId: "broken-step-schema",
        defaults: {
          nodeTimeoutMs: 120000,
        },
        nodes: [],
        steps: {},
      },
      nodePayloads: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.steps",
          message: "must be an array",
        }),
        expect.objectContaining({
          path: "workflow.entryStepId",
          message: "must be a non-empty string",
        }),
      ]),
    );
    expect(
      result.error.some((issue) => issue.path === "workflow.managerNodeId"),
    ).toBe(false);
    expect(
      result.error.some((issue) => issue.path === "workflow.entryNodeId"),
    ).toBe(false);
  });

  test("rejects empty step-addressed arrays without leaking legacy compatibility diagnostics", () => {
    const emptyStepsResult = validateWorkflowBundleDetailed({
      workflow: {
        workflowId: "empty-step-addressed-steps",
        defaults: {
          nodeTimeoutMs: 120000,
        },
        entryStepId: "missing-step",
        nodes: [
          {
            id: "shared-node",
            nodeFile: "nodes/node-shared.json",
          },
        ],
        steps: [],
      },
      nodePayloads: {
        "nodes/node-shared.json": {
          id: "shared-node",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "worker",
          variables: {},
        },
      },
    });
    expect(emptyStepsResult.ok).toBe(false);
    if (!emptyStepsResult.ok) {
      expect(emptyStepsResult.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "workflow.steps",
            message: "must contain at least one step",
          }),
          expect.objectContaining({
            path: "workflow.entryStepId",
            message: "must reference an existing step id (missing-step)",
          }),
        ]),
      );
      expect(
        emptyStepsResult.error.some(
          (issue) =>
            issue.path === "workflow.managerNodeId" ||
            issue.path === "workflow.entryNodeId" ||
            issue.path.startsWith("workflow.edges["),
        ),
      ).toBe(false);
    }

    const emptyNodesResult = validateWorkflowBundleDetailed({
      workflow: {
        workflowId: "empty-step-addressed-nodes",
        defaults: {
          nodeTimeoutMs: 120000,
        },
        entryStepId: "worker-step",
        nodes: [],
        steps: [
          {
            id: "worker-step",
            nodeId: "shared-node",
          },
        ],
      },
      nodePayloads: {},
    });
    expect(emptyNodesResult.ok).toBe(false);
    if (!emptyNodesResult.ok) {
      expect(emptyNodesResult.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "workflow.nodes",
            message: "must contain at least one workflow node registry entry",
          }),
          expect.objectContaining({
            path: "workflow.steps[0].nodeId",
            message:
              "must reference an existing workflow node registry entry (shared-node)",
          }),
        ]),
      );
      expect(
        emptyNodesResult.error.some(
          (issue) =>
            issue.path === "workflow.managerNodeId" ||
            issue.path === "workflow.entryNodeId" ||
            issue.path.startsWith("workflow.edges["),
        ),
      ).toBe(false);
    }
  });

  test("replaces base prompt fields when a step prompt variant overrides them", () => {
    const result = validateWorkflowBundle({
      workflow: {
        workflowId: "step-prompt-variant-overrides",
        defaults: {
          nodeTimeoutMs: 120000,
        },
        entryStepId: "review",
        nodes: [
          {
            id: "coder-node",
            nodeFile: "nodes/node-coder.json",
          },
        ],
        steps: [
          {
            id: "review",
            nodeId: "coder-node",
            promptVariant: "self-review",
          },
        ],
      },
      nodePayloads: {
        "nodes/node-coder.json": {
          id: "coder-node",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "implement",
          systemPromptTemplateFile: "prompts/system-default.md",
          sessionStartPromptTemplate: "first turn",
          variables: {},
          promptVariants: {
            "self-review": {
              promptTemplateFile: "prompts/review.md",
              systemPromptTemplate: "review system",
              sessionStartPromptTemplateFile: "prompts/review-start.md",
            },
          },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.nodePayloads["review"]?.promptTemplate).toBeUndefined();
    expect(result.value.nodePayloads["review"]?.promptTemplateFile).toBe(
      "prompts/review.md",
    );
    expect(result.value.nodePayloads["review"]?.systemPromptTemplate).toBe(
      "review system",
    );
    expect(
      result.value.nodePayloads["review"]?.systemPromptTemplateFile,
    ).toBeUndefined();
    expect(
      result.value.nodePayloads["review"]?.sessionStartPromptTemplate,
    ).toBeUndefined();
    expect(
      result.value.nodePayloads["review"]?.sessionStartPromptTemplateFile,
    ).toBe("prompts/review-start.md");
    expect(result.value.nodePayloads["coder-node"]?.promptTemplate).toBe(
      "implement",
    );
    expect(
      result.value.nodePayloads["coder-node"]?.systemPromptTemplateFile,
    ).toBe("prompts/system-default.md");
    expect(
      result.value.nodePayloads["coder-node"]?.sessionStartPromptTemplate,
    ).toBe("first turn");
  });

  test("accepts simplified sequential schema and derives edges plus repeat loop projections", () => {
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(getLegacyManagerNodeId(result.value.workflow)).toBe(
      "divedra-manager",
    );
    expect(getLegacyEntryNodeId(result.value.workflow)).toBeUndefined();
    expect(resolveWorkflowEntryRuntimeId(result.value.workflow)).toBe(
      "divedra-manager",
    );
    expect(getStructuralSubWorkflows(result.value.workflow)).toEqual([]);
    expect("subWorkflows" in result.value.workflow).toBe(false);
    expect(getLegacyAuthoredEdges(result.value.workflow)).toBeUndefined();
    expect(getLegacyAuthoredLoops(result.value.workflow)).toBeUndefined();
    expect(getStructuralEdges(result.value.workflow)).toEqual([
      { from: "divedra-manager", to: "step-1", when: "always" },
      { from: "step-1", to: "repeat-step", when: "always" },
      { from: "repeat-step", to: "repeat-step", when: "continue_turn" },
      { from: "repeat-step", to: "done-step", when: "!(continue_turn)" },
    ]);
    expect(getStructuralLoops(result.value.workflow)).toEqual([
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
        managerNodeId: "divedra-manager",
        nodes: [
          {
            id: "divedra-manager",
            kind: "root-manager",
            nodeFile: "node-divedra-manager.json",
            completion: { type: "none" },
          },
          {
            id: "repeat-step",
            kind: "task",
            nodeFile: "node-repeat-step.json",
            repeat: {
              while: "continue_turn",
            },
            completion: { type: "none" },
          },
          {
            id: "done-step",
            kind: "task",
            nodeFile: "node-done-step.json",
            completion: { type: "none" },
          },
        ],
        edges: [{ from: "divedra-manager", to: "repeat-step", when: "always" }],
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

  test("rejects authored workflowCalls by top-level presence on legacy node-graph bundles", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      entryNodeId: "divedra-manager",
      workflowCalls: [
        {
          id: "call-review",
          workflowId: "review-flow",
          callerNodeId: "worker-1",
          resultNodeId: "worker-1",
        },
      ],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message:
            "authored workflowCalls are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
  });

  test("rejects non-empty authored workflowCalls on role-authored bundles", () => {
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

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message:
            "authored workflowCalls are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
  });

  test("rejects empty authored workflowCalls on role-authored bundles", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      workflowCalls: [],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message:
            "authored workflowCalls are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
  });

  test("rejects role-authored workflowCalls by top-level presence without traversing legacy call-entry validation", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      workflowCalls: [
        {
          id: "call-review",
          workflowId: "review-flow",
          callerNodeId: "writer",
          callerStepId: "writer",
        },
      ],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message:
            "authored workflowCalls are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
    expect(
      result.error.some(
        (issue) => issue.path === "workflow.workflowCalls[0].callerStepId",
      ),
    ).toBe(false);
  });

  test("rejects authored edges on role-authored bundles", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      edges: [{ from: "divedra-manager", to: "worker-1", when: "always" }],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.edges",
          message:
            "authored edges are legacy compatibility only and cannot be combined with authored role/control nodes",
        }),
      ]),
    );
  });

  test("rejects role-authored edges by top-level presence without traversing legacy edge validation", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      edges: [{ from: "", to: 42, when: "" }],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.edges",
          message:
            "authored edges are legacy compatibility only and cannot be combined with authored role/control nodes",
        }),
      ]),
    );
    expect(
      result.error.some((issue) => issue.path.startsWith("workflow.edges[0].")),
    ).toBe(false);
  });

  test("rejects authored loops on role-authored bundles", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      loops: [
        {
          id: "legacy-loop",
          judgeNodeId: "worker-1",
          continueWhen: "always",
          exitWhen: "never",
        },
      ],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.loops",
          message:
            "authored loops are legacy compatibility only and cannot be combined with authored role/control nodes",
        }),
      ]),
    );
  });

  test("rejects role-authored loops by top-level presence without traversing legacy loop validation", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      loops: [
        {
          id: "",
          judgeNodeId: "",
          continueWhen: "",
          exitWhen: "",
        },
      ],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.loops",
          message:
            "authored loops are legacy compatibility only and cannot be combined with authored role/control nodes",
        }),
      ]),
    );
    expect(
      result.error.some((issue) => issue.path.startsWith("workflow.loops[0].")),
    ).toBe(false);
  });

  test("rejects authored branching on role-authored bundles by top-level presence", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      branching: { mode: "legacy-fan-out" },
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.branching",
          message:
            "authored branching is legacy compatibility only and is no longer supported",
        }),
      ]),
    );
    expect(
      result.error.some((issue) => issue.path === "workflow.branching.mode"),
    ).toBe(false);
  });

  test("rejects authored managerNodeId and entryNodeId on role-authored bundles with a manager-role node", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      managerNodeId: "divedra-manager",
      entryNodeId: "divedra-manager",
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.managerNodeId",
          message:
            "authored managerNodeId is legacy compatibility only and cannot be combined with authored manager-role nodes",
        }),
        expect.objectContaining({
          path: "workflow.entryNodeId",
          message:
            "authored entryNodeId is legacy compatibility only and cannot be combined with authored manager-role nodes",
        }),
      ]),
    );
  });

  test("rejects role-authored managerNodeId and entryNodeId by top-level presence without traversing legacy manager-entry semantic checks", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      managerNodeId: "missing-manager",
      entryNodeId: "missing-entry",
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.filter((issue) => issue.path === "workflow.managerNodeId"),
    ).toEqual([
      expect.objectContaining({
        path: "workflow.managerNodeId",
        message:
          "authored managerNodeId is legacy compatibility only and cannot be combined with authored manager-role nodes",
      }),
    ]);
    expect(
      result.error.filter((issue) => issue.path === "workflow.entryNodeId"),
    ).toEqual([
      expect.objectContaining({
        path: "workflow.entryNodeId",
        message:
          "authored entryNodeId is legacy compatibility only and cannot be combined with authored manager-role nodes",
      }),
    ]);
  });

  test("rejects empty authored workflowCalls by top-level presence on legacy node-graph bundles", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      entryNodeId: "divedra-manager",
      workflowCalls: [],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message:
            "authored workflowCalls are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
  });

  test("rejects authored subWorkflowConversations by top-level presence without traversing legacy conversation-entry validation", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      entryNodeId: "divedra-manager",
      subWorkflowConversations: [
        {
          id: "conv-1",
          participantsIds: ["divedra-manager"],
          maxTurns: 1,
          stopWhen: "done",
        },
      ],
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflowConversations" &&
          issue.message ===
            "authored subWorkflowConversations are legacy compatibility only and are no longer supported",
      ),
    ).toBe(true);
    expect(
      result.error.some((issue) =>
        issue.path.startsWith("workflow.subWorkflowConversations[0]."),
      ),
    ).toBe(false);
  });

  test("rejects authored workflowCalls by top-level presence without traversing legacy call-entry validation", () => {
    const raw = makeValidRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      entryNodeId: "divedra-manager",
      workflowCalls: [
        {
          id: "call-review",
          workflowId: "review-flow",
          callerNodeId: "worker-1",
          callerStepId: "worker-1",
          resultNodeId: "worker-1",
        },
      ],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message:
            "authored workflowCalls are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
    expect(
      result.error.some(
        (issue) => issue.path === "workflow.workflowCalls[0].callerStepId",
      ),
    ).toBe(false);
  });

  test("rejects top-level workflowCalls on step-addressed bundles outside strict mode", () => {
    const raw = makeValidStepAddressedRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      workflowCalls: [
        {
          id: "call-review",
          workflowId: "review-flow",
          callerNodeId: "worker",
          resultNodeId: "worker",
        },
      ],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.workflowCalls" &&
          issue.message.includes(
            "is not part of the step-addressed workflow schema",
          ),
      ),
    ).toBe(true);
  });

  test("rejects top-level workflowCalls by presence on step-addressed bundles in strict mode", () => {
    const raw = makeValidStepAddressedRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      workflowCalls: {
        id: "call-review",
      },
    };

    const result = validateWorkflowBundleDetailed(raw, {
      rejectLegacyWorkflowAuthoring: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message: "is not part of the step-addressed workflow schema",
        }),
      ]),
    );
  });

  test("rejects structural subWorkflows for role-authored bundles", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      subWorkflows: [
        {
          id: "legacy-lane",
          description: "legacy lane",
          managerNodeId: "divedra-manager",
          inputNodeId: "worker-1",
          outputNodeId: "worker-2",
          nodeIds: ["worker-1", "worker-2"],
          inputSources: [{ type: "human-input" }],
          block: { type: "plain" },
        },
      ],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflows" &&
          issue.message.includes("legacy compatibility only"),
      ),
    ).toBe(true);
  });

  test("rejects role-authored subWorkflows by top-level presence without traversing legacy subWorkflow entry validation", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      subWorkflows: [
        {
          id: "legacy-lane",
          description: "legacy lane",
          managerNodeId: "",
          inputNodeId: "missing-input",
          outputNodeId: "missing-output",
          nodeIds: [],
          inputSources: [{ type: "not-a-real-source" }],
          block: { type: "not-a-real-block" },
        },
      ],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.subWorkflows",
          message:
            "authored subWorkflows are legacy compatibility only and cannot be combined with authored role/control nodes",
        }),
      ]),
    );
    expect(
      result.error.some(
        (issue) =>
          issue.path.startsWith("workflow.subWorkflows[0].managerNodeId") ||
          issue.path.startsWith("workflow.subWorkflows[0].inputSources") ||
          issue.path.startsWith("workflow.subWorkflows[0].block"),
      ),
    ).toBe(false);
  });

  test("rejects empty structural subWorkflows for role-authored bundles", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      subWorkflows: [],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflows" &&
          issue.message.includes("legacy compatibility only"),
      ),
    ).toBe(true);
  });

  test("rejects structural subWorkflowConversations for role-authored bundles", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      subWorkflowConversations: [
        {
          id: "legacy-conversation",
          participants: ["legacy-a", "legacy-b"],
          maxTurns: 2,
          stopWhen: "always",
        },
      ],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflowConversations" &&
          issue.message.includes("legacy compatibility only"),
      ),
    ).toBe(true);
  });

  test("rejects role-authored subWorkflowConversations by top-level presence without traversing legacy conversation entry validation", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      subWorkflowConversations: [
        {
          id: "legacy-conversation",
          participants: ["only-one"],
          maxTurns: 0,
          stopWhen: "",
          conversationPolicy: "unsupported",
        },
      ],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.subWorkflowConversations",
          message:
            "authored subWorkflowConversations are legacy compatibility only and cannot be combined with authored role/control nodes",
        }),
      ]),
    );
    expect(
      result.error.some(
        (issue) =>
          issue.path.startsWith(
            "workflow.subWorkflowConversations[0].participants",
          ) ||
          issue.path.startsWith(
            "workflow.subWorkflowConversations[0].conversationPolicy",
          ),
      ),
    ).toBe(false);
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflowConversations[0].maxTurns" ||
          issue.path === "workflow.subWorkflowConversations[0].stopWhen",
      ),
    ).toBe(false);
  });

  test("rejects empty structural subWorkflowConversations for role-authored bundles", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      subWorkflowConversations: [],
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflowConversations" &&
          issue.message.includes("legacy compatibility only"),
      ),
    ).toBe(true);
  });

  test("rejects role-authored legacy structural fields by top-level presence even when authored with invalid non-array values", () => {
    const cases = [
      {
        field: "workflowCalls",
        value: { invalid: true },
        message:
          "authored workflowCalls are legacy compatibility only and are no longer supported",
      },
      {
        field: "edges",
        value: "invalid",
        message:
          "authored edges are legacy compatibility only and cannot be combined with authored role/control nodes",
      },
      {
        field: "loops",
        value: { invalid: true },
        message:
          "authored loops are legacy compatibility only and cannot be combined with authored role/control nodes",
      },
      {
        field: "subWorkflows",
        value: "invalid",
        message:
          "authored subWorkflows are legacy compatibility only and cannot be combined with authored role/control nodes",
      },
      {
        field: "subWorkflowConversations",
        value: { invalid: true },
        message:
          "authored subWorkflowConversations are legacy compatibility only and cannot be combined with authored role/control nodes",
      },
    ] as const;

    for (const entry of cases) {
      const raw = makeUnifiedRoleRaw();
      raw.workflow = {
        ...(raw.workflow as Record<string, unknown>),
        [entry.field]: entry.value,
      };

      const result = validateWorkflowBundleDetailed(
        raw,
        legacyWorkflowAuthorshipOk,
      );
      expect(result.ok).toBe(false);
      if (result.ok) {
        continue;
      }

      expect(result.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: `workflow.${entry.field}`,
            message: entry.message,
          }),
        ]),
      );
      expect(
        result.error.some(
          (issue) =>
            issue.path === `workflow.${entry.field}` &&
            issue.message === "must be an array when provided",
        ),
      ).toBe(false);
    }
  });

  test("rejects structural boundary node kinds for role-authored bundles", () => {
    for (const kind of ["subworkflow-manager", "input", "output"] as const) {
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
            role: "worker",
            kind,
            nodeFile: "node-worker-1.json",
            completion: { type: "none" },
          },
        ],
      };

      const result = validateWorkflowBundleDetailed(
        raw,
        legacyWorkflowAuthorshipOk,
      );
      expect(result.ok).toBe(false);
      if (result.ok) {
        continue;
      }
      expect(
        result.error.some(
          (issue) =>
            issue.path === "workflow.nodes[1].kind" &&
            issue.message.includes("legacy structural compatibility only"),
        ),
      ).toBe(true);
    }
  });

  test("accepts manager-less worker-only workflows with explicit entryNodeId", () => {
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
    };
    delete (raw.workflow as Record<string, unknown>)["managerNodeId"];
    delete raw.nodePayloads["node-divedra-manager.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.hasManagerNode).toBe(false);
    expect(getLegacyManagerNodeId(result.value.workflow)).toBe("worker-1");
    expect(getLegacyEntryNodeId(result.value.workflow)).toBe("worker-1");
  });

  test("rejects multiple manager-role nodes", () => {
    const raw = makeUnifiedRoleRaw();
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
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
          role: "manager",
          nodeFile: "node-worker-1.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

  test("rejects non-canonical executionBackend identifiers", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      executionBackend: "tacogips/claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.executionBackend" &&
          issue.message.includes("must be codex-agent"),
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

  test("accepts built-in chat reply add-on node refs", () => {
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
          role: "worker",
          addon: {
            name: "divedra/chat-reply-worker",
            version: "1",
            config: {
              textTemplate: "{{inbox.latest.output.payload.text}}",
              onMissingTarget: "intent-only",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.nodes[1]?.addon).toEqual({
      name: "divedra/chat-reply-worker",
      version: "1",
      config: {
        textTemplate: "{{inbox.latest.output.payload.text}}",
        onMissingTarget: "intent-only",
      },
    });
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      id: "worker-1",
      nodeType: "addon",
      addon: {
        name: "divedra/chat-reply-worker",
        version: "1",
        config: {
          textTemplate: "{{inbox.latest.output.payload.text}}",
          onMissingTarget: "intent-only",
        },
      },
    });
  });

  test("normalizes optional built-in chat reply add-on config fields", () => {
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
          role: "worker",
          addon: {
            name: "divedra/chat-reply-worker",
            config: {
              textTemplate: "Reply: {{event.payload.text}}",
              visibility: "ephemeral",
              threadPolicy: "same-thread",
              onMissingTarget: "dry-run",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const chatAddon = result.value.nodePayloads["worker-1"]?.addon;
    expect(
      chatAddon && "config" in chatAddon ? chatAddon.config : undefined,
    ).toEqual({
      textTemplate: "Reply: {{event.payload.text}}",
      visibility: "ephemeral",
      threadPolicy: "same-thread",
      onMissingTarget: "dry-run",
    });
  });

  test("accepts built-in codex worker add-on node refs", () => {
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
          role: "worker",
          addon: {
            name: "divedra/codex-worker",
            version: "1",
            config: {
              model: "gpt-5.4-codex",
              promptTemplate: "Implement: {{task}}",
              systemPromptTemplate: "You are a coding worker.",
              sessionPolicy: { mode: "reuse" },
              timeoutMs: 180000,
            },
            inputs: {
              task: "Add agent add-ons",
              priority: 1,
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.nodes[1]?.addon).toEqual({
      name: "divedra/codex-worker",
      version: "1",
      config: {
        model: "gpt-5.4-codex",
        promptTemplate: "Implement: {{task}}",
        systemPromptTemplate: "You are a coding worker.",
        sessionPolicy: { mode: "reuse" },
        timeoutMs: 180000,
      },
      inputs: {
        task: "Add agent add-ons",
        priority: 1,
      },
    });
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      id: "worker-1",
      executionBackend: "codex-agent",
      model: "gpt-5.4-codex",
      promptTemplate: "Implement: {{task}}",
      systemPromptTemplate: "You are a coding worker.",
      sessionPolicy: { mode: "reuse" },
      timeoutMs: 180000,
      variables: {
        task: "Add agent add-ons",
        priority: 1,
      },
      addon: {
        name: "divedra/codex-worker",
        version: "1",
      },
    });
  });

  test("accepts built-in claude code worker add-on node refs", () => {
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
          role: "worker",
          addon: {
            name: "divedra/claude-code-worker",
            config: {
              model: "claude-opus-4-1",
              promptTemplate: "Review: {{reviewTarget}}",
            },
            inputs: {
              reviewTarget: "src/workflow/node-addons.ts",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      id: "worker-1",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "Review: {{reviewTarget}}",
      variables: {
        reviewTarget: "src/workflow/node-addons.ts",
      },
      addon: {
        name: "divedra/claude-code-worker",
        version: "1",
      },
    });
  });

  test("accepts built-in x-gateway read add-on env mappings", () => {
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
          role: "worker",
          addon: {
            name: "divedra/x-gateway-read",
            version: "1",
            env: {
              X_GW_TOKEN: "ACCOUNT_A_X_GW_TOKEN",
              X_GW_CONFIG_MODE: {
                fromEnv: "ACCOUNT_A_X_GW_CONFIG_MODE",
                required: false,
              },
              X_GW_REQUIRED_OBJECT: {
                fromEnv: "ACCOUNT_A_REQUIRED_X_GW_TOKEN",
                required: true,
              },
            },
            config: {
              queryTemplate: '{ post(id: "{{postId}}") { id text } }',
              image: "example/x-gateway:latest",
              runnerKind: "docker",
            },
            inputs: {
              postId: "123",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.nodes[1]?.addon).toEqual({
      name: "divedra/x-gateway-read",
      version: "1",
      env: {
        X_GW_TOKEN: { fromEnv: "ACCOUNT_A_X_GW_TOKEN" },
        X_GW_CONFIG_MODE: {
          fromEnv: "ACCOUNT_A_X_GW_CONFIG_MODE",
          required: false,
        },
        X_GW_REQUIRED_OBJECT: {
          fromEnv: "ACCOUNT_A_REQUIRED_X_GW_TOKEN",
          required: true,
        },
      },
      config: {
        queryTemplate: '{ post(id: "{{postId}}") { id text } }',
        image: "example/x-gateway:latest",
        runnerKind: "docker",
      },
      inputs: {
        postId: "123",
      },
    });
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      id: "worker-1",
      nodeType: "addon",
      variables: {
        postId: "123",
      },
      addon: {
        name: "divedra/x-gateway-read",
        version: "1",
        env: {
          X_GW_TOKEN: { fromEnv: "ACCOUNT_A_X_GW_TOKEN" },
        },
      },
    });
  });

  test("rejects x-gateway read add-on command overrides", () => {
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
          role: "worker",
          addon: {
            name: "divedra/x-gateway-read",
            config: {
              queryTemplate: "{ accountMe { id } }",
              command: ["x-gateway"],
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.config.command" &&
          issue.message.includes("not supported"),
      ),
    ).toBe(true);
  });

  test("accepts built-in x-gateway write-capable add-on env mappings", () => {
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
          role: "worker",
          addon: {
            name: "divedra/x-gateway",
            version: "1",
            env: {
              X_GW_CONSUMER_KEY: "ACCOUNT_A_X_GW_CONSUMER_KEY",
              X_GW_CONSUMER_SECRET: "ACCOUNT_A_X_GW_CONSUMER_SECRET",
              X_GW_ACCESS_TOKEN: "ACCOUNT_A_X_GW_ACCESS_TOKEN",
              X_GW_ACCESS_TOKEN_SECRET: "ACCOUNT_A_X_GW_ACCESS_TOKEN_SECRET",
            },
            config: {
              documentTemplate:
                'mutation { createPost(text: "{{postText}}") { id text } }',
              image: "example/x-gateway:latest",
              runnerKind: "docker",
            },
            inputs: {
              postText: "hello",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.nodes[1]?.addon).toEqual({
      name: "divedra/x-gateway",
      version: "1",
      env: {
        X_GW_CONSUMER_KEY: { fromEnv: "ACCOUNT_A_X_GW_CONSUMER_KEY" },
        X_GW_CONSUMER_SECRET: { fromEnv: "ACCOUNT_A_X_GW_CONSUMER_SECRET" },
        X_GW_ACCESS_TOKEN: { fromEnv: "ACCOUNT_A_X_GW_ACCESS_TOKEN" },
        X_GW_ACCESS_TOKEN_SECRET: {
          fromEnv: "ACCOUNT_A_X_GW_ACCESS_TOKEN_SECRET",
        },
      },
      config: {
        documentTemplate:
          'mutation { createPost(text: "{{postText}}") { id text } }',
        image: "example/x-gateway:latest",
        runnerKind: "docker",
      },
      inputs: {
        postText: "hello",
      },
    });
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      id: "worker-1",
      nodeType: "addon",
      variables: {
        postText: "hello",
      },
      addon: {
        name: "divedra/x-gateway",
        version: "1",
      },
    });
  });

  test("rejects x-gateway add-on command overrides", () => {
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
          role: "worker",
          addon: {
            name: "divedra/x-gateway",
            config: {
              documentTemplate:
                'mutation { createPost(text: "hello") { id text } }',
              command: ["x-gateway-reader"],
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.config.command" &&
          issue.message.includes("not supported"),
      ),
    ).toBe(true);
  });

  test("accepts built-in mail-gateway read add-on env mappings", () => {
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
          role: "worker",
          addon: {
            name: "divedra/mail-gateway-read",
            version: "1",
            env: {
              MAIL_GATEWAY_CONFIG: "ACCOUNT_A_MAIL_GATEWAY_CONFIG",
              MAIL_GATEWAY_CREDENTIAL_WORK_TOKEN_STORE_PATH: {
                fromEnv: "ACCOUNT_A_MAIL_TOKEN_STORE_PATH",
                required: false,
              },
            },
            config: {
              queryTemplate:
                '{ message(accountId: "{{accountId}}", messageId: "{{messageId}}") { id subject } }',
              image: "example/mail-gateway:latest",
              runnerKind: "docker",
            },
            inputs: {
              accountId: "work",
              messageId: "msg-123",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.nodes[1]?.addon).toEqual({
      name: "divedra/mail-gateway-read",
      version: "1",
      env: {
        MAIL_GATEWAY_CONFIG: { fromEnv: "ACCOUNT_A_MAIL_GATEWAY_CONFIG" },
        MAIL_GATEWAY_CREDENTIAL_WORK_TOKEN_STORE_PATH: {
          fromEnv: "ACCOUNT_A_MAIL_TOKEN_STORE_PATH",
          required: false,
        },
      },
      config: {
        queryTemplate:
          '{ message(accountId: "{{accountId}}", messageId: "{{messageId}}") { id subject } }',
        image: "example/mail-gateway:latest",
        runnerKind: "docker",
      },
      inputs: {
        accountId: "work",
        messageId: "msg-123",
      },
    });
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      id: "worker-1",
      nodeType: "addon",
      variables: {
        accountId: "work",
        messageId: "msg-123",
      },
      addon: {
        name: "divedra/mail-gateway-read",
        version: "1",
      },
    });
  });

  test("rejects mail-gateway read add-on command overrides", () => {
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
          role: "worker",
          addon: {
            name: "divedra/mail-gateway-read",
            config: {
              queryTemplate: "{ accounts { id } }",
              command: ["mail-gateway"],
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.config.command" &&
          issue.message.includes("not supported"),
      ),
    ).toBe(true);
  });

  test("accepts built-in mail-gateway send-capable add-on env mappings", () => {
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
          role: "worker",
          addon: {
            name: "divedra/mail-gateway",
            version: "1",
            env: {
              MAIL_GATEWAY_CONFIG: "ACCOUNT_A_MAIL_GATEWAY_CONFIG",
            },
            config: {
              documentTemplate:
                'mutation { sendMessage(input: { accountId: "{{accountId}}", to: ["{{to}}"], subject: "{{subject}}", textBody: "{{body}}" }) { message { id subject } } }',
              image: "example/mail-gateway:latest",
              runnerKind: "docker",
            },
            inputs: {
              accountId: "work",
              to: "person@example.test",
              subject: "hello",
              body: "body",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.nodes[1]?.addon).toEqual({
      name: "divedra/mail-gateway",
      version: "1",
      env: {
        MAIL_GATEWAY_CONFIG: { fromEnv: "ACCOUNT_A_MAIL_GATEWAY_CONFIG" },
      },
      config: {
        documentTemplate:
          'mutation { sendMessage(input: { accountId: "{{accountId}}", to: ["{{to}}"], subject: "{{subject}}", textBody: "{{body}}" }) { message { id subject } } }',
        image: "example/mail-gateway:latest",
        runnerKind: "docker",
      },
      inputs: {
        accountId: "work",
        to: "person@example.test",
        subject: "hello",
        body: "body",
      },
    });
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      id: "worker-1",
      nodeType: "addon",
      variables: {
        accountId: "work",
        to: "person@example.test",
        subject: "hello",
        body: "body",
      },
      addon: {
        name: "divedra/mail-gateway",
        version: "1",
      },
    });
  });

  test("rejects mail-gateway add-on command overrides", () => {
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
          role: "worker",
          addon: {
            name: "divedra/mail-gateway",
            config: {
              documentTemplate:
                'mutation { sendMessage(input: { accountId: "work", to: ["person@example.test"], subject: "hello", textBody: "body" }) { message { id } } }',
              command: ["mail-gateway-reader"],
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.config.command" &&
          issue.message.includes("not supported"),
      ),
    ).toBe(true);
  });

  test("rejects malformed built-in add-on env mappings", () => {
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
          role: "worker",
          addon: {
            name: "divedra/x-gateway-read",
            env: {
              "X-GW-TOKEN": {
                fromEnv: "ACCOUNT_A_X_GW_TOKEN",
              },
              X_GW_TOKEN: {
                fromEnv: "not-valid-source-name!",
              },
            },
            config: {
              queryTemplate: "{ accountMe { id } }",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.env.X-GW-TOKEN" &&
          issue.message.includes("valid environment variable name"),
      ),
    ).toBe(true);
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.env.X_GW_TOKEN.fromEnv" &&
          issue.message.includes("valid environment variable name"),
      ),
    ).toBe(true);
  });

  test("rejects invalid built-in agent worker add-on config", () => {
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
          role: "worker",
          addon: {
            name: "divedra/codex-worker",
            version: "1",
            config: {
              model: "",
              promptTemplate: "Do work",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.config.model" &&
          issue.message.includes("non-empty string"),
      ),
    ).toBe(true);
  });

  test("rejects non-object built-in add-on inputs", () => {
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
          role: "worker",
          addon: {
            name: "divedra/claude-code-worker",
            config: {
              model: "claude-opus-4-1",
              promptTemplate: "Review",
            },
            inputs: "not-an-object",
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.inputs" &&
          issue.message.includes("must be an object"),
      ),
    ).toBe(true);
  });

  test("rejects env mappings for built-in add-ons without env support", () => {
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
          role: "worker",
          addon: {
            name: "divedra/codex-worker",
            config: {
              model: "gpt-5.4-codex",
              promptTemplate: "Implement: {{task}}",
            },
            env: {
              API_TOKEN: "CODEX_API_TOKEN",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.env" &&
          issue.message.includes("is not supported"),
      ),
    ).toBe(true);
  });

  test("rejects add-on node refs without explicit worker role", () => {
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
          addon: {
            name: "divedra/chat-reply-worker",
            version: "1",
            config: {
              textTemplate: "reply",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon" &&
          issue.message.includes("role 'worker'"),
      ),
    ).toBe(true);
  });

  test("rejects add-on node refs when worker role is only inferred from control", () => {
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
          control: "branch-judge",
          addon: {
            name: "divedra/chat-reply-worker",
            version: "1",
            config: {
              textTemplate: "reply",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon" &&
          issue.message.includes("role 'worker'"),
      ),
    ).toBe(true);
  });

  test("rejects authored node payloads with runtime-only add-on nodeType", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      nodeType: "addon",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.nodeType" &&
          issue.message.includes("workflow.nodes[].addon"),
      ),
    ).toBe(true);
  });

  test("rejects add-on node refs mixed with nodeFile", () => {
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
          role: "worker",
          nodeFile: "node-worker-1.json",
          addon: {
            name: "divedra/chat-reply-worker",
            config: { textTemplate: "done" },
          },
          completion: { type: "none" },
        },
      ],
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon" &&
          issue.message.includes("must be omitted when nodeFile is provided"),
      ),
    ).toBe(true);
  });

  test("rejects invalid built-in add-on config", () => {
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
          role: "worker",
          addon: {
            name: "divedra/chat-reply-worker",
            version: "1",
            config: {
              textTemplate: "",
            },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.config.textTemplate" &&
          issue.message.includes("non-empty string"),
      ),
    ).toBe(true);
  });

  test("rejects non-object built-in add-on config", () => {
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
          role: "worker",
          addon: {
            name: "divedra/chat-reply-worker",
            config: "not-an-object",
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.config" &&
          issue.message.includes("must be an object"),
      ),
    ).toBe(true);
  });

  test("rejects unknown built-in add-on refs", () => {
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
          role: "worker",
          addon: {
            name: "divedra/unknown-worker",
            config: { textTemplate: "done" },
          },
          completion: { type: "none" },
        },
      ],
    };
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.name" &&
          issue.message.includes("unknown built-in node add-on"),
      ),
    ).toBe(true);
  });

  test("accepts third-party add-on refs through explicit resolvers", () => {
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
          role: "worker",
          addon: {
            name: "acme/echo-worker",
            version: "1",
            inputs: { message: "hello" },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const resolver: NodeAddonPayloadResolver = (input) => {
      if (input.addon.name !== "acme/echo-worker") {
        return undefined;
      }
      return {
        payload: {
          id: input.nodeId,
          description: "Third-party echo worker resolved by the host.",
          model: "gpt-5-nano",
          executionBackend: "official/openai-sdk",
          promptTemplate: "Echo {{message}}",
          variables: input.addon.inputs ?? {},
        },
      };
    };

    const result = validateWorkflowBundle(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddonResolvers: [resolver],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      id: "worker-1",
      description: "Third-party echo worker resolved by the host.",
      model: "gpt-5-nano",
      executionBackend: "official/openai-sdk",
      promptTemplate: "Echo {{message}}",
      variables: { message: "hello" },
    });
  });

  test("accepts third-party add-on definitions through nodeAddons", () => {
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
          role: "worker",
          addon: {
            name: "acme/echo-worker",
            version: "1",
            inputs: { message: "hello" },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const addon: NodeAddonDefinition = {
      name: "acme/echo-worker",
      version: "1",
      resolve: (input) => ({
        payload: {
          id: input.nodeId,
          executionBackend: "official/openai-sdk",
          model: "gpt-5-nano",
          promptTemplate: "Echo {{message}}",
          variables: input.addon.inputs ?? {},
        },
      }),
    };

    const result = validateWorkflowBundle(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddons: [addon],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      id: "worker-1",
      executionBackend: "official/openai-sdk",
      variables: { message: "hello" },
    });
  });

  test("accepts async third-party add-on definitions through async validation", async () => {
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
          role: "worker",
          addon: {
            name: "acme/async-echo-worker",
            version: "1",
            inputs: { message: "hello async" },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const addon: NodeAddonDefinition = {
      name: "acme/async-echo-worker",
      version: "1",
      resolve: async (input) => ({
        payload: {
          id: input.nodeId,
          executionBackend: "official/openai-sdk",
          model: "gpt-5-nano",
          promptTemplate: "Echo {{message}}",
          variables: input.addon.inputs ?? {},
        },
      }),
    };

    const result = await validateWorkflowBundleAsync(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddons: [addon],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      id: "worker-1",
      executionBackend: "official/openai-sdk",
      variables: { message: "hello async" },
    });
  });

  test("rejects async third-party add-on definitions through sync validation", () => {
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
          role: "worker",
          addon: {
            name: "acme/async-echo-worker",
            version: "1",
          },
          completion: { type: "none" },
        },
      ],
    };
    delete raw.nodePayloads["node-worker-1.json"];

    const addon: NodeAddonDefinition = {
      name: "acme/async-echo-worker",
      version: "1",
      resolve: async (input) => ({
        payload: {
          id: input.nodeId,
          executionBackend: "official/openai-sdk",
          model: "gpt-5-nano",
          promptTemplate: "Echo",
          variables: {},
        },
      }),
    };

    const result = validateWorkflowBundle(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddons: [addon],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon" &&
          issue.message.includes("uses an async definition resolver"),
      ),
    ).toBe(true);
  });

  test("rejects third-party add-on definitions with unsupported versions", () => {
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
          role: "worker",
          addon: {
            name: "acme/echo-worker",
            version: "2",
          },
          completion: { type: "none" },
        },
      ],
    };
    delete raw.nodePayloads["node-worker-1.json"];

    const addon: NodeAddonDefinition = {
      name: "acme/echo-worker",
      version: "1",
      resolve: (input) => ({
        payload: {
          id: input.nodeId,
          executionBackend: "official/openai-sdk",
          model: "gpt-5-nano",
          promptTemplate: "Echo",
          variables: {},
        },
      }),
    };

    const result = validateWorkflowBundle(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddons: [addon],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.version" &&
          issue.message.includes("unsupported version '2'"),
      ),
    ).toBe(true);
  });

  test("rejects third-party add-on refs when no resolver handles them", () => {
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
          role: "worker",
          addon: {
            name: "acme/missing-worker",
            version: "1",
          },
          completion: { type: "none" },
        },
      ],
    };
    delete raw.nodePayloads["node-worker-1.json"];

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.name" &&
          issue.message.includes("unknown third-party node add-on"),
      ),
    ).toBe(true);
  });

  test("rejects third-party resolver payloads with the wrong node id", () => {
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
          role: "worker",
          addon: {
            name: "acme/echo-worker",
            version: "1",
          },
          completion: { type: "none" },
        },
      ],
    };
    delete raw.nodePayloads["node-worker-1.json"];

    const resolver: NodeAddonPayloadResolver = () => ({
      issues: [],
      payload: {
        id: "wrong-worker",
        model: "gpt-5-nano",
        executionBackend: "official/openai-sdk",
        promptTemplate: "Echo",
        variables: {},
      },
    });

    const result = validateWorkflowBundle(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddonResolvers: [resolver],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.payload.id" &&
          issue.message.includes("payload id must be 'worker-1'"),
      ),
    ).toBe(true);
  });

  test("rejects third-party resolver payloads that use native add-on nodeType", () => {
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
          role: "worker",
          addon: {
            name: "acme/native-worker",
            version: "1",
          },
          completion: { type: "none" },
        },
      ],
    };
    delete raw.nodePayloads["node-worker-1.json"];

    const resolver: NodeAddonPayloadResolver = (input) => ({
      issues: [],
      payload: {
        id: input.nodeId,
        nodeType: "addon",
        variables: {},
      },
    });

    const result = validateWorkflowBundle(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddonResolvers: [resolver],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.payload.nodeType" &&
          issue.message.includes("ordinary agent, command, container"),
      ),
    ).toBe(true);
  });

  test("normalizes third-party resolver payloads through node payload validation", () => {
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
          role: "worker",
          addon: {
            name: "acme/command-worker",
            version: "1",
          },
          completion: { type: "none" },
        },
      ],
    };
    delete raw.nodePayloads["node-worker-1.json"];

    const resolver: NodeAddonPayloadResolver = (input) => ({
      issues: [],
      payload: {
        id: input.nodeId,
        nodeType: "command",
        variables: {},
      },
    });

    const result = validateWorkflowBundle(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddonResolvers: [resolver],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.payload.command" &&
          issue.message.includes("is required when nodeType is 'command'"),
      ),
    ).toBe(true);
  });

  test("continues past third-party resolvers that return undefined for unhandled refs", () => {
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
          role: "worker",
          addon: {
            name: "acme/echo-worker",
            version: "1",
            inputs: { message: "hello" },
          },
          completion: { type: "none" },
        },
      ],
    };
    deleteLegacyBranchingField(raw.workflow);
    delete raw.nodePayloads["node-worker-1.json"];

    const unhandledResolver: NodeAddonPayloadResolver = () => undefined;
    const handledResolver: NodeAddonPayloadResolver = (input) => ({
      payload: {
        id: input.nodeId,
        model: "gpt-5-nano",
        executionBackend: "official/openai-sdk",
        promptTemplate: "Echo {{message}}",
        variables: input.addon.inputs ?? {},
      },
    });

    const result = validateWorkflowBundle(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddonResolvers: [unhandledResolver, handledResolver],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]).toMatchObject({
      id: "worker-1",
      executionBackend: "official/openai-sdk",
      variables: { message: "hello" },
    });
  });

  test("rejects malformed third-party resolver results as validation issues", () => {
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
          role: "worker",
          addon: {
            name: "acme/malformed-worker",
            version: "1",
          },
          completion: { type: "none" },
        },
      ],
    };
    delete raw.nodePayloads["node-worker-1.json"];

    const resolver = (() => 42) as unknown as NodeAddonPayloadResolver;

    const result = validateWorkflowBundle(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddonResolvers: [resolver],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.resolverResult" &&
          issue.message.includes("must return an object result"),
      ),
    ).toBe(true);
  });

  test("rejects non-object third-party resolver payloads without throwing", () => {
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
          role: "worker",
          addon: {
            name: "acme/null-payload-worker",
            version: "1",
          },
          completion: { type: "none" },
        },
      ],
    };
    delete raw.nodePayloads["node-worker-1.json"];

    const resolver = (() => ({
      issues: [],
      payload: null,
    })) as unknown as NodeAddonPayloadResolver;

    const result = validateWorkflowBundle(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddonResolvers: [resolver],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.payload" &&
          issue.message.includes("must be an object"),
      ),
    ).toBe(true);
  });

  test("rejects third-party resolver payloads that return runtime add-on metadata", () => {
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
          role: "worker",
          addon: {
            name: "acme/spoofed-worker",
            version: "1",
          },
          completion: { type: "none" },
        },
      ],
    };
    delete raw.nodePayloads["node-worker-1.json"];

    const resolver: NodeAddonPayloadResolver = (input) => ({
      issues: [],
      payload: {
        id: input.nodeId,
        model: "gpt-5-nano",
        executionBackend: "official/openai-sdk",
        promptTemplate: "Echo",
        variables: {},
        addon: {
          name: "divedra/chat-reply-worker",
          version: "1",
          config: { textTemplate: "hello" },
        },
      },
    });

    const result = validateWorkflowBundle(raw, {
      ...legacyWorkflowAuthorshipOk,
      nodeAddonResolvers: [resolver],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.nodes[1].addon.payload.addon" &&
          issue.message.includes("must not return runtime add-on metadata"),
      ),
    ).toBe(true);
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      sessionPolicy: {
        mode: "reuse",
      },
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]?.sessionPolicy?.mode).toBe(
      "reuse",
    );
  });

  test("accepts canonical container nodes with a prebuilt image", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      nodeType: "container",
      variables: {},
      container: {
        runnerKind: "podman",
        image: "ghcr.io/example/reviewer:latest",
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

  test("accepts canonical container build metadata with containerfilePath", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      nodeType: "container",
      variables: {},
      container: {
        runnerKind: "podman",
        build: {
          contextPath: "containers/reviewer",
          containerfilePath: "containers/reviewer/Containerfile",
          target: "runtime",
        },
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
          containerfilePath: "containers/reviewer/Containerfile",
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

  test("rejects legacy runtimeIsolation fields", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.runtimeIsolation" &&
          issue.message.includes("not supported"),
      ),
    ).toBe(true);
  });

  test("rejects unsafe containerfilePath", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      nodeType: "container",
      variables: {},
      container: {
        runnerKind: "podman",
        build: {
          contextPath: "containers/reviewer",
          containerfilePath: "../Containerfile",
        },
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path ===
            "nodePayloads.node-worker-1.json.container.build.containerfilePath" &&
          issue.message.includes("workflow-relative path"),
      ),
    ).toBe(true);
  });

  test("rejects legacy dockerfilePath", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      nodeType: "container",
      variables: {},
      container: {
        build: {
          contextPath: "containers/reviewer",
          dockerfilePath: "containers/reviewer/Dockerfile",
        },
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path ===
            "nodePayloads.node-worker-1.json.container.build.dockerfilePath" &&
          issue.message.includes("not supported"),
      ),
    ).toBe(true);
  });

  test("rejects containerfilePath values that target canonical workflow definition files", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      nodeType: "container",
      variables: {},
      container: {
        runnerKind: "podman",
        build: {
          contextPath: "containers/reviewer",
          containerfilePath: "workflow.json",
        },
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path ===
            "nodePayloads.node-worker-1.json.container.build.containerfilePath" &&
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      promptTemplateFile: "../outside.md",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

  test("accepts node-level workingDirectory as a trimmed relative path", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      workingDirectory: " apps/reviewer ",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker-1"]?.workingDirectory).toBe(
      "apps/reviewer",
    );
  });

  test("trims legacy command.workingDirectory values", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      nodeType: "command",
      variables: {},
      command: {
        scriptPath: "scripts/run.sh",
        workingDirectory: " legacy-worker ",
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.nodePayloads["worker-1"]?.command?.workingDirectory,
    ).toBe("legacy-worker");
  });

  test("rejects empty node-level workingDirectory values", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      workingDirectory: "   ",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.workingDirectory" &&
          issue.message.includes("absolute or relative path"),
      ),
    ).toBe(true);
  });

  test("rejects promptTemplateFile paths that target canonical workflow definition files", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      promptTemplateFile: "workflow.json",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

  test("rejects promptTemplateFile paths that target nested canonical node payload files", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      promptTemplateFile: "nodes/node-worker-1.json",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      systemPromptTemplateFile: "../system.md",
      sessionStartPromptTemplateFile: "workflow.json",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      sessionPolicy: {
        mode: "shared",
      },
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

  test("rejects tacogips cli-wrapper identifiers with explicit backends", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      executionBackend: "official/openai-sdk",
      model: "tacogips/codex-agent",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

  test("rejects non-canonical backend aliases even when model is legacy-branded", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      executionBackend: "tacogips/codex-agent",
      model: "tacogips/codex-agent",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundleDetailed(
      raw,
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.executionBackend" &&
          issue.message.includes("must be codex-agent"),
      ),
    ).toBe(true);
  });

  test("requires executionBackend for agent nodes", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      model: "gpt-5-nano",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

  test("does not emit compatibility warnings for canonical payloads", () => {
    const result = validateWorkflowBundleDetailed(
      makeValidRaw(),
      legacyWorkflowAuthorshipOk,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.issues.some(
        (issue) =>
          issue.message.includes("legacy") ||
          issue.message.includes("not supported; use"),
      ),
    ).toBe(false);
  });

  test("rejects legacy prompt and variable fields", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      prompt: "legacy prompt",
      variable: { name: "legacy" },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.prompt" &&
          issue.message.includes("not supported"),
      ),
    ).toBe(true);
    expect(
      result.error.some(
        (issue) =>
          issue.path === "nodePayloads.node-worker-1.json.variable" &&
          issue.message.includes("not supported"),
      ),
    ).toBe(true);
  });

  test("accepts node-level descriptions", () => {
    const raw = makeValidRaw();
    raw.nodePayloads["node-worker-1.json"] = {
      id: "worker-1",
      description: "Summarize the diff and propose the next action.",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
      output: {
        description:
          "Return only the structured worker payload as a JSON object.",
        maxValidationAttempts: 2,
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
      output: {
        description: "   ",
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
      output: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
      output: {
        description: "structured worker output",
        schema: {
          type: "object",
        },
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
      output: {
        jsonSchema: {
          type: "object",
          not: { type: "null" },
        },
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
      output: {
        jsonSchema: {
          type: "string",
        },
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "worker",
      variables: {},
      output: {
        jsonSchema: {
          anyOf: [{ type: "string" }, { type: "number" }],
        },
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads["node-shadow-manager.json"] = {
      id: "shadow-manager",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "shadow manager",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sub-manager-a.json": {
        id: "sub-manager-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sub-manager-a",
        variables: {},
      },
      "node-input-a.json": {
        id: "input-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "input-a",
        variables: {},
      },
      "node-output-a.json": {
        id: "output-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "output-a",
        variables: {},
      },
      "node-output-b.json": {
        id: "output-b",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "output-b",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sub-manager-a.json": {
        id: "sub-manager-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sub-manager-a",
        variables: {},
      },
      "node-input-a.json": {
        id: "input-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "input-a",
        variables: {},
      },
      "node-output-a.json": {
        id: "output-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "output-a",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sub-manager-a.json": {
        id: "sub-manager-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sub-manager-a",
        variables: {},
      },
      "node-sub-output-a.json": {
        id: "sub-output-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sub-output-a",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sub-manager-a.json": {
        id: "sub-manager-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sub-manager-a",
        variables: {},
      },
      "node-input-a.json": {
        id: "input-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "input-a",
        variables: {},
      },
      "node-output-a.json": {
        id: "output-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "output-a",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    };
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-plain-manager-a.json": {
        id: "plain-manager-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "plain-manager-a",
        variables: {},
      },
      "node-input-a.json": {
        id: "input-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "input-a",
        variables: {},
      },
      "node-output-a.json": {
        id: "output-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "output-a",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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

  test("rejects authored subWorkflowConversations on legacy node-graph bundles by top-level presence", () => {
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sw1-manager.json": {
        id: "sw1-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "m1",
        variables: {},
      },
      "node-branch-judge.json": {
        id: "branch-judge",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "judge",
        variables: {},
      },
      "node-sw1-input.json": {
        id: "sw1-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "in1",
        variables: {},
      },
      "node-sw1-output.json": {
        id: "sw1-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "out1",
        variables: {},
      },
      "node-sw2-manager.json": {
        id: "sw2-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "m2",
        variables: {},
      },
      "node-sw2-input.json": {
        id: "sw2-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "in2",
        variables: {},
      },
      "node-sw2-output.json": {
        id: "sw2-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "out2",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflowConversations" &&
          issue.message ===
            "authored subWorkflowConversations are legacy compatibility only and are no longer supported",
      ),
    ).toBe(true);
    expect(
      result.error.some((issue) =>
        issue.path.startsWith("workflow.subWorkflowConversations[0]."),
      ),
    ).toBe(false);
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-loop-manager.json": {
        id: "loop-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-manager",
        variables: {},
      },
      "node-loop-input.json": {
        id: "loop-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-input",
        variables: {},
      },
      "node-loop-output.json": {
        id: "loop-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-loop-manager-a.json": {
        id: "loop-manager-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-manager-a",
        variables: {},
      },
      "node-loop-input-a.json": {
        id: "loop-input-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-input-a",
        variables: {},
      },
      "node-loop-output-a.json": {
        id: "loop-output-a",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-output-a",
        variables: {},
      },
      "node-loop-manager-b.json": {
        id: "loop-manager-b",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-manager-b",
        variables: {},
      },
      "node-loop-input-b.json": {
        id: "loop-input-b",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-input-b",
        variables: {},
      },
      "node-loop-output-b.json": {
        id: "loop-output-b",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-output-b",
        variables: {},
      },
      "node-loop-judge.json": {
        id: "loop-judge",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-judge",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-prepare.json": {
        id: "prepare",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "prepare",
        variables: {},
      },
      "node-branch-manager.json": {
        id: "branch-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "branch-manager",
        variables: {},
      },
      "node-branch-input.json": {
        id: "branch-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "branch-input",
        variables: {},
      },
      "node-branch-output.json": {
        id: "branch-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "branch-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-loop-manager.json": {
        id: "loop-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-manager",
        variables: {},
      },
      "node-loop-input.json": {
        id: "loop-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-input",
        variables: {},
      },
      "node-loop-output.json": {
        id: "loop-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-output",
        variables: {},
      },
      "node-loop-worker.json": {
        id: "loop-worker",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-worker",
        variables: {},
      },
      "node-loop-judge.json": {
        id: "loop-judge",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "loop-judge",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-a-manager.json": {
        id: "a-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-manager",
        variables: {},
      },
      "node-a-input.json": {
        id: "a-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-in",
        variables: {},
      },
      "node-a-inner-manager.json": {
        id: "a-inner-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-inner-manager",
        variables: {},
      },
      "node-a-inner-input.json": {
        id: "a-inner-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-inner-in",
        variables: {},
      },
      "node-a-inner-output.json": {
        id: "a-inner-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-inner-out",
        variables: {},
      },
      "node-a-output.json": {
        id: "a-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-out",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-a-manager.json": {
        id: "a-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-manager",
        variables: {},
      },
      "node-a-input.json": {
        id: "a-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-in",
        variables: {},
      },
      "node-a-output.json": {
        id: "a-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-out",
        variables: {},
      },
      "node-b-manager.json": {
        id: "b-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "b-manager",
        variables: {},
      },
      "node-b-input.json": {
        id: "b-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "b-in",
        variables: {},
      },
      "node-b-output.json": {
        id: "b-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "b-out",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-root-worker.json": {
        id: "root-worker",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "root-worker",
        variables: {},
      },
      "node-sw-manager.json": {
        id: "sw-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sw-manager",
        variables: {},
      },
      "node-sw-input.json": {
        id: "sw-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sw-input",
        variables: {},
      },
      "node-sw-output.json": {
        id: "sw-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sw-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-root-worker.json": {
        id: "root-worker",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "root-worker",
        variables: {},
      },
      "node-sw-manager.json": {
        id: "sw-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sw-manager",
        variables: {},
      },
      "node-sw-input.json": {
        id: "sw-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sw-input",
        variables: {},
      },
      "node-sw-output.json": {
        id: "sw-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sw-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-a-manager.json": {
        id: "a-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-manager",
        variables: {},
      },
      "node-a-input.json": {
        id: "a-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-input",
        variables: {},
      },
      "node-a-output.json": {
        id: "a-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "a-output",
        variables: {},
      },
      "node-b-manager.json": {
        id: "b-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "b-manager",
        variables: {},
      },
      "node-b-input.json": {
        id: "b-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "b-input",
        variables: {},
      },
      "node-b-output.json": {
        id: "b-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "b-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.workflow = {
      ...(raw.workflow as Record<string, unknown>),
      nodes: [
        (raw.workflow as { nodes: unknown[] }).nodes[0],
        (raw.workflow as { nodes: unknown[] }).nodes[2],
        (raw.workflow as { nodes: unknown[] }).nodes[1],
      ],
    };
    raw.nodePayloads["node-loop-judge.json"] = {
      id: "loop-judge",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "judge",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads["node-loop-a-start.json"] = {
      id: "loop-a-start",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "loop-a-start",
      variables: {},
    };
    raw.nodePayloads["node-loop-b-start.json"] = {
      id: "loop-b-start",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "loop-b-start",
      variables: {},
    };
    raw.nodePayloads["node-loop-a-judge.json"] = {
      id: "loop-a-judge",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "loop-a-judge",
      variables: {},
    };
    raw.nodePayloads["node-loop-b-judge.json"] = {
      id: "loop-b-judge",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "loop-b-judge",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads["node-group-manager.json"] = {
      id: "group-manager",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "group-manager",
      variables: {},
    };
    raw.nodePayloads["node-group-input.json"] = {
      id: "group-input",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "group-input",
      variables: {},
    };
    raw.nodePayloads["node-loop-start.json"] = {
      id: "loop-start",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "loop-start",
      variables: {},
    };
    raw.nodePayloads["node-group-output.json"] = {
      id: "group-output",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "group-output",
      variables: {},
    };
    raw.nodePayloads["node-loop-judge.json"] = {
      id: "loop-judge",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "loop-judge",
      variables: {},
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sw1-manager.json": {
        id: "sw1-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sw1-manager",
        variables: {},
      },
      "node-sw1-input.json": {
        id: "sw1-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sw1-input",
        variables: {},
      },
      "node-sw1-output.json": {
        id: "sw1-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "sw1-output",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
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
      "workflow.subWorkflowConversations:authored subWorkflowConversations are legacy compatibility only and are no longer supported",
    );
    expect(messages).not.toContain(
      "workflow.subWorkflowConversations[0].conversationPolicy",
    );
  });

  test("rejects legacy sub-workflow aliases inputs without traversing removed conversation entry aliases", () => {
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
    raw.nodePayloads = {
      "node-divedra-manager.json": {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      "node-sw1-manager.json": {
        id: "sw1-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "m1",
        variables: {},
      },
      "node-sw1-input.json": {
        id: "sw1-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "in1",
        variables: {},
      },
      "node-sw1-output.json": {
        id: "sw1-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "out1",
        variables: {},
      },
      "node-sw2-manager.json": {
        id: "sw2-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "m2",
        variables: {},
      },
      "node-sw2-input.json": {
        id: "sw2-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "in2",
        variables: {},
      },
      "node-sw2-output.json": {
        id: "sw2-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "out2",
        variables: {},
      },
    };

    const result = validateWorkflowBundle(raw, legacyWorkflowAuthorshipOk);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflows[0].inputs" &&
          issue.message.includes("not supported"),
      ),
    ).toBe(true);
    expect(
      result.error.some(
        (issue) =>
          issue.path === "workflow.subWorkflowConversations" &&
          issue.message ===
            "authored subWorkflowConversations are legacy compatibility only and are no longer supported",
      ),
    ).toBe(true);
    expect(
      result.error.some((issue) =>
        issue.path.startsWith("workflow.subWorkflowConversations[0]."),
      ),
    ).toBe(false);
  });
});
