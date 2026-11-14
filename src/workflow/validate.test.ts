import { makeStepAddressedAuthoredWorkflowFieldIssue } from "./authored-workflow";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  type RejectedAuthoredStepAddressedTopLevelField,
} from "./authored-workflow";
import { crossWorkflowDispatchesFromSteps } from "./cross-workflow-from-steps";
import {
  validateWorkflowBundle,
  validateWorkflowBundleAsync,
  validateWorkflowBundleDetailed,
  validateWorkflowBundleDetailedAsync,
  validatePureWorkflowBundle,
} from "./validate";
import {
  getStructuralEdges,
  getStructuralLoops,
  DEFAULT_CONTAINER_RUNNER_KIND,
  DEFAULT_NODE_TIMEOUT_MS,
  resolveWorkflowEntryRuntimeId,
  resolveWorkflowManagerStepId,
  type AsyncNodeAddonPayloadResolver,
  type WorkflowJson,
  type NodeAddonDefinition,
  type NodeAddonResolveResult,
} from "./types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "divedra-validate-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeExecutable(filePath: string, body: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${body}\n`, { encoding: "utf8", mode: 0o755 });
}

function makeStepAddressedRaw(): {
  workflow: Record<string, unknown>;
  nodePayloads: Record<string, unknown>;
} {
  return {
    workflow: {
      workflowId: "demo",
      description: "demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerStepId: "manager",
      entryStepId: "manager",
      nodes: [
        { id: "manager", nodeFile: "nodes/node-manager.json" },
        { id: "worker", nodeFile: "nodes/node-worker.json" },
        { id: "after-child", nodeFile: "nodes/node-after-child.json" },
      ],
      steps: [
        {
          id: "manager",
          nodeId: "manager",
          role: "manager",
          transitions: [{ toStepId: "worker", label: "always" }],
        },
        {
          id: "worker",
          nodeId: "worker",
          role: "worker",
        },
        {
          id: "after-child",
          nodeId: "after-child",
          role: "worker",
        },
      ],
    },
    nodePayloads: {
      "nodes/node-manager.json": {
        id: "manager",
        promptTemplate: "manager",
        variables: {},
      },
      "nodes/node-worker.json": {
        id: "worker",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "worker",
        variables: {},
      },
      "nodes/node-after-child.json": {
        id: "after-child",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "after-child",
        variables: {},
      },
    },
  };
}

function writeWorkflowBundle(input: {
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly workflow: Record<string, unknown>;
  readonly nodePayloads: Record<string, unknown>;
}): void {
  const workflowDirectory = path.join(input.workflowRoot, input.workflowName);
  writeJson(path.join(workflowDirectory, "workflow.json"), input.workflow);
  for (const [fileName, payload] of Object.entries(input.nodePayloads)) {
    writeJson(path.join(workflowDirectory, fileName), payload);
  }
}

function sampleRemovedTopLevelFieldValue(
  fieldName: RejectedAuthoredStepAddressedTopLevelField,
): unknown {
  switch (fieldName) {
    case "managerRuntimeId":
    case "managerNodeId":
    case "entryNodeId":
      return "manager";
    case "subWorkflows":
    case "workflowCalls":
    case "subWorkflowConversations":
      return [];
    case "edges":
      return [{ from: "manager", to: "worker", when: "always" }];
    case "loops":
      return [
        {
          id: "loop-manager",
          judgeNodeId: "manager",
          continueWhen: "again",
          exitWhen: "done",
        },
      ];
    case "branching":
      return {};
  }
}

describe("workflow runtime identity helpers", () => {
  test("resolveWorkflowEntryRuntimeId uses entryStepId", () => {
    expect(
      resolveWorkflowEntryRuntimeId({
        workflowId: "demo",
        description: "demo",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "entry-step",
        nodeRegistry: [],
        steps: [],
        nodes: [],
      } as WorkflowJson),
    ).toBe("entry-step");
  });

  test("resolveWorkflowManagerStepId uses managerStepId and falls back to entryStepId", () => {
    expect(
      resolveWorkflowManagerStepId({
        workflowId: "demo",
        description: "demo",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        managerStepId: "manager-step",
        entryStepId: "entry-step",
        nodeRegistry: [],
        steps: [],
        nodes: [],
      } as WorkflowJson),
    ).toBe("manager-step");

    expect(
      resolveWorkflowManagerStepId({
        workflowId: "demo",
        description: "demo",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "entry-step",
        nodeRegistry: [],
        steps: [],
        nodes: [],
      } as WorkflowJson),
    ).toBe("entry-step");
  });
});

describe("structural helpers", () => {
  test("getStructuralEdges derives only local step transitions", () => {
    expect(
      getStructuralEdges({
        steps: [
          {
            id: "manager",
            nodeId: "manager",
            transitions: [
              { toStepId: "worker", label: "always" },
              {
                toStepId: "child-entry",
                toWorkflowId: "child-flow",
                resumeStepId: "after-child",
                label: "handoff",
              },
            ],
          },
          {
            id: "worker",
            nodeId: "worker",
            transitions: [{ toStepId: "after-child", label: "done" }],
          },
          {
            id: "after-child",
            nodeId: "after-child",
          },
        ],
      } as Pick<WorkflowJson, "steps">),
    ).toEqual([
      { from: "manager", to: "worker", when: "always" },
      { from: "worker", to: "after-child", when: "done" },
    ]);
  });

  test("getStructuralLoops derives repeat loops from runtime nodes", () => {
    expect(
      getStructuralLoops({
        nodes: [
          { id: "manager", nodeFile: "nodes/node-manager.json" },
          { id: "implement", nodeFile: "nodes/node-implement.json" },
          {
            id: "review",
            nodeFile: "nodes/node-review.json",
            repeat: {
              while: "continue_round",
              restartAt: "implement",
              maxIterations: 2,
            },
          },
        ],
      } as unknown as Pick<WorkflowJson, "nodes">),
    ).toEqual([
      {
        id: "repeat-review",
        judgeNodeId: "review",
        continueWhen: "continue_round",
        exitWhen: "!(continue_round)",
        maxIterations: 2,
      },
    ]);
  });
});

describe("workflow defaults", () => {
  test("defaults omitted nodeTimeoutMs to the shared 60 minute timeout", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = { maxLoopIterations: 3 };

    const result = validateWorkflowBundle(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected workflow validation to succeed");
    }
    expect(result.value.workflow.defaults.nodeTimeoutMs).toBe(
      DEFAULT_NODE_TIMEOUT_MS,
    );
  });

  test("defaults omitted container runner kind to Docker", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
      containerRuntime: {},
    };

    const result = validateWorkflowBundle(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected workflow validation to succeed");
    }
    expect(result.value.workflow.defaults.containerRuntime).toEqual({
      runnerKind: DEFAULT_CONTAINER_RUNNER_KIND,
    });
    expect(DEFAULT_CONTAINER_RUNNER_KIND).toBe("docker");
  });
});

describe("validateWorkflowBundle", () => {
  test("pure validation accepts authored addon refs without resolving add-ons", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["nodes"] = [
      {
        id: "manager",
        addon: {
          name: "missing/package-owned-addon",
          config: { promptTemplate: "manager" },
        },
      },
    ];
    raw.workflow["steps"] = [
      {
        id: "manager",
        nodeId: "manager",
        role: "manager",
      },
    ];
    raw.nodePayloads = {};

    const pureResult = validatePureWorkflowBundle(raw);

    expect(pureResult.ok).toBe(true);
    if (!pureResult.ok) {
      return;
    }
    expect(pureResult.value.workflow.nodeRegistry[0]?.addon?.name).toBe(
      "missing/package-owned-addon",
    );
    expect(pureResult.value.nodePayloads).toEqual({});

    const runtimeResult = validateWorkflowBundle(raw);
    expect(runtimeResult.ok).toBe(false);
    if (runtimeResult.ok) {
      return;
    }
    expect(runtimeResult.error.map((issue) => issue.path)).toContain(
      "workflow.nodes[0].addon",
    );
  });

  test("rejects inline resolved step fields when stepFile is authored by default", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["steps"] = [
      {
        id: "manager",
        stepFile: "steps/manager.json",
        nodeId: "manager",
        role: "manager",
      },
    ];

    const defaultResult = validateWorkflowBundle(raw);

    expect(defaultResult.ok).toBe(false);
    if (defaultResult.ok) {
      return;
    }
    expect(defaultResult.error).toEqual(
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

    const resolvedResult = validateWorkflowBundle(raw, {
      allowResolvedStepFileFields: true,
    });
    expect(resolvedResult.ok).toBe(true);
  });

  test("rejects malformed authored stepFile values", () => {
    for (const stepFile of ["", 42] as const) {
      const raw = makeStepAddressedRaw();
      raw.workflow["steps"] = [
        {
          id: "manager",
          stepFile,
          nodeId: "manager",
          role: "manager",
        },
      ];

      const result = validateWorkflowBundle(raw);

      expect(result.ok).toBe(false);
      if (result.ok) {
        continue;
      }
      expect(result.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "workflow.steps[0].stepFile",
            message: "must be a non-empty string",
          }),
        ]),
      );
    }
  });

  test("pure validation preserves full authored workflow and node payload fields", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
      fanoutConcurrency: 2,
      supervision: {
        monitorIntervalMs: 15000,
        stallTimeoutMs: 900000,
        maxWorkflowPatches: 0,
        workflowMutationMode: "execution-copy",
        allowTargetedRerun: true,
      },
      timeoutPolicy: {
        onTimeout: "jump-to-step",
        jumpStepId: "worker",
        maxRetries: 2,
        retryTimeoutIncrementMs: 1000,
        reuseBackendSession: true,
      },
      containerRuntime: {
        runnerKind: "docker",
        runnerPath: "/usr/bin/docker",
      },
    };
    raw.workflow["nodes"] = [
      {
        id: "manager",
        nodeFile: "nodes/node-manager.json",
        execution: { mode: "optional", decisionBy: "owning-manager" },
        kind: "loop-judge",
        repeat: { while: "again", restartAt: "worker", maxIterations: 2 },
      },
      {
        id: "worker",
        addon: {
          name: "missing/package-owned-addon",
          env: { API_TOKEN: { fromEnv: "API_TOKEN", required: true } },
          inputs: { prompt: "{{input}}" },
        },
      },
    ];
    raw.workflow["steps"] = [
      {
        id: "manager",
        nodeId: "manager",
        role: "manager",
        sessionPolicy: { mode: "reuse" },
        transitions: [
          {
            toStepId: "worker",
            label: "fanout",
            fanout: {
              groupId: "group",
              itemsFrom: "/items",
              itemVariable: "item",
              concurrency: 2,
              joinStepId: "worker",
              failurePolicy: "collect-all",
              resultOrder: "input",
              writeOwnership: {
                mode: "disjoint-paths",
                paths: ["packages/divedra-core/src"],
              },
            },
          },
        ],
      },
      {
        id: "worker",
        nodeId: "worker",
        role: "worker",
        timeoutMs: 5000,
        stallTimeoutMs: 6000,
        sessionPolicy: { mode: "reuse", inheritFromStepId: "manager" },
      },
    ];
    raw.nodePayloads["nodes/node-manager.json"] = {
      id: "manager",
      nodeType: "command",
      managerType: "code",
      workingDirectory: ".",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      systemPromptTemplateFile: "prompts/system.md",
      promptTemplate: "manager",
      promptTemplateFile: "prompts/manager.md",
      sessionStartPromptTemplate: "start",
      sessionStartPromptTemplateFile: "prompts/start.md",
      promptVariants: {
        review: {
          promptTemplateFile: "prompts/review.md",
        },
      },
      variables: { mode: "test" },
      command: { scriptPath: "scripts/run.ts", argvTemplate: ["--json"] },
      argumentsTemplate: { input: "{{input}}" },
      argumentBindings: [
        {
          targetPath: "/input",
          source: "workflow-output",
          sourcePath: "/payload",
          required: true,
        },
      ],
      templateEngine: "handlebars",
      timeoutMs: 1234,
      stallTimeoutMs: 5678,
      input: { description: "input", jsonSchema: { type: "object" } },
      output: {
        description: "output",
        jsonSchema: { type: "object" },
        maxValidationAttempts: 2,
      },
    };

    const pureResult = validatePureWorkflowBundle(raw);

    expect(pureResult.ok).toBe(true);
    if (!pureResult.ok) {
      return;
    }
    expect(pureResult.value.workflow.defaults.supervision).toMatchObject({
      maxWorkflowPatches: 0,
      workflowMutationMode: "execution-copy",
      allowTargetedRerun: true,
    });
    expect(pureResult.value.workflow.defaults.timeoutPolicy).toMatchObject({
      onTimeout: "jump-to-step",
      jumpStepId: "worker",
      maxRetries: 2,
    });
    expect(pureResult.value.workflow.defaults.containerRuntime).toEqual({
      runnerKind: "docker",
      runnerPath: "/usr/bin/docker",
    });
    expect(pureResult.value.workflow.nodeRegistry[0]).toMatchObject({
      execution: { mode: "optional", decisionBy: "owning-manager" },
      kind: "loop-judge",
      repeat: { while: "again", restartAt: "worker", maxIterations: 2 },
    });
    expect(pureResult.value.workflow.nodeRegistry[1]?.addon).toMatchObject({
      env: { API_TOKEN: { fromEnv: "API_TOKEN", required: true } },
      inputs: { prompt: "{{input}}" },
    });
    expect(pureResult.value.workflow.steps[0]).toMatchObject({
      sessionPolicy: { mode: "reuse" },
      transitions: [
        {
          toStepId: "worker",
          fanout: {
            groupId: "group",
            writeOwnership: {
              mode: "disjoint-paths",
              paths: ["packages/divedra-core/src"],
            },
          },
        },
      ],
    });
    expect(pureResult.value.workflow.steps[1]).toMatchObject({
      timeoutMs: 5000,
      stallTimeoutMs: 6000,
      sessionPolicy: { mode: "reuse", inheritFromStepId: "manager" },
    });
    expect(pureResult.value.nodePayloads["manager"]).toMatchObject({
      nodeType: "command",
      managerType: "code",
      workingDirectory: ".",
      executionBackend: "codex-agent",
      promptTemplateFile: "prompts/manager.md",
      promptVariants: { review: { promptTemplateFile: "prompts/review.md" } },
      command: { scriptPath: "scripts/run.ts", argvTemplate: ["--json"] },
      argumentBindings: [
        {
          targetPath: "/input",
          source: "workflow-output",
          sourcePath: "/payload",
          required: true,
        },
      ],
      input: { description: "input", jsonSchema: { type: "object" } },
      output: {
        description: "output",
        jsonSchema: { type: "object" },
        maxValidationAttempts: 2,
      },
    });
  });

  test("accepts a canonical step-addressed workflow bundle", () => {
    const result = validateWorkflowBundle(makeStepAddressedRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.entryStepId).toBe("manager");
    expect(result.value.workflow.managerStepId).toBe("manager");
    expect(result.value.workflow.steps.map((step) => step.id)).toEqual([
      "manager",
      "worker",
      "after-child",
    ]);
    expect("workflowCalls" in result.value.workflow).toBe(false);
  });

  test("accepts workflow and step stall supervision defaults", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
      supervision: {
        monitorIntervalMs: 15000,
        stallTimeoutMs: 900000,
        maxWorkflowPatches: 0,
      },
    };
    const steps = raw.workflow["steps"] as Array<Record<string, unknown>>;
    const workerStep = steps[1] ?? {};
    steps[1] = {
      ...workerStep,
      stallTimeoutMs: 1200000,
    };
    const workerPayload = raw.nodePayloads["nodes/node-worker.json"] as Record<
      string,
      unknown
    >;
    raw.nodePayloads["nodes/node-worker.json"] = {
      ...workerPayload,
      stallTimeoutMs: 600000,
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflow.defaults.supervision).toEqual({
      monitorIntervalMs: 15000,
      stallTimeoutMs: 900000,
      maxWorkflowPatches: 0,
    });
    expect(result.value.workflow.steps[1]?.stallTimeoutMs).toBe(1200000);
    expect(result.value.nodePayloads["worker"]?.stallTimeoutMs).toBe(1200000);
    expect(
      result.value.nodePayloads["nodes/node-worker.json"]?.stallTimeoutMs,
    ).toBe(600000);
  });

  test("accepts worker sleep nodes with a relative duration", () => {
    const raw = makeStepAddressedRaw();
    raw.nodePayloads["nodes/node-worker.json"] = {
      id: "worker",
      nodeType: "sleep",
      variables: {},
      sleep: { durationMs: 500 },
    };

    const result = validateWorkflowBundle(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker"]?.nodeType).toBe("sleep");
    expect(result.value.nodePayloads["worker"]?.sleep).toEqual({
      durationMs: 500,
    });
  });

  test("accepts worker sleep nodes with an explicit-offset wake time", () => {
    const raw = makeStepAddressedRaw();
    raw.nodePayloads["nodes/node-worker.json"] = {
      id: "worker",
      nodeType: "sleep",
      variables: {},
      sleep: { until: "2026-05-15T12:00:00+09:00" },
    };

    const result = validateWorkflowBundle(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nodePayloads["worker"]?.sleep).toEqual({
      until: "2026-05-15T12:00:00+09:00",
    });
  });

  test("rejects sleep until timestamps without explicit timezone", () => {
    const raw = makeStepAddressedRaw();
    raw.nodePayloads["nodes/node-worker.json"] = {
      id: "worker",
      nodeType: "sleep",
      variables: {},
      sleep: { until: "2026-05-15T12:00:00" },
    };

    const result = validateWorkflowBundle(raw);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContainEqual(
      expect.objectContaining({
        path: "nodePayloads.nodes/node-worker.json.sleep.until",
        message: "must include an explicit timezone or UTC offset",
      }),
    );
  });

  test("rejects sleep nodes with agent execution fields", () => {
    const raw = makeStepAddressedRaw();
    raw.nodePayloads["nodes/node-worker.json"] = {
      id: "worker",
      nodeType: "sleep",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "worker",
      variables: {},
      sleep: { durationMs: 500 },
    };

    const result = validateWorkflowBundle(raw);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.map((issue) => issue.path)).toContain(
      "nodePayloads.nodes/node-worker.json.executionBackend",
    );
  });

  test("rejects invalid workflow supervision stall defaults", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
      supervision: {
        monitorIntervalMs: 5000,
        stallTimeoutMs: 4999,
      },
    };

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContainEqual(
      expect.objectContaining({
        path: "workflow.defaults.supervision.stallTimeoutMs",
      }),
    );
  });

  test.each(
    REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  )("rejects top-level workflow.%s on step-addressed bundles", (fieldName) => {
    const raw = makeStepAddressedRaw();
    raw.workflow[fieldName] = sampleRemovedTopLevelFieldValue(fieldName);

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContainEqual(
      makeStepAddressedAuthoredWorkflowFieldIssue(fieldName),
    );
  });

  test("rejects unsupported node registry fields on step-addressed bundles", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["nodes"] = [
      {
        id: "manager",
        nodeFile: "nodes/node-manager.json",
        role: "manager",
      },
      { id: "worker", nodeFile: "nodes/node-worker.json" },
      { id: "after-child", nodeFile: "nodes/node-after-child.json" },
    ];

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContainEqual({
      severity: "error",
      path: "workflow.nodes[0].role",
      message: "uses an unsupported step-addressed node registry field",
    });
  });

  test("keeps cross-workflow transitions on steps and derives runtime dispatch rows", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["steps"] = [
      {
        id: "manager",
        nodeId: "manager",
        role: "manager",
        transitions: [
          {
            toStepId: "child-entry",
            toWorkflowId: "child-flow",
            resumeStepId: "after-child",
            label: "handoff",
          },
        ],
      },
      {
        id: "after-child",
        nodeId: "after-child",
        role: "worker",
      },
    ];

    const result = validateWorkflowBundle(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(
      crossWorkflowDispatchesFromSteps(result.value.workflow.steps),
    ).toEqual([
      {
        id: "__cw:manager",
        workflowId: "child-flow",
        callerStepId: "manager",
        resumeStepId: "after-child",
        when: "handoff",
      },
    ]);
    expect("workflowCalls" in result.value.workflow).toBe(false);
  });

  test("accepts cross-workflow fanout transition and normalizes defaults", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
      fanoutConcurrency: 20,
    };
    raw.workflow["steps"] = [
      {
        id: "manager",
        nodeId: "manager",
        role: "manager",
        transitions: [
          {
            toStepId: "child-entry",
            toWorkflowId: "child-flow",
            resumeStepId: "after-child",
            fanout: {
              groupId: "features",
              itemsFrom: "/payload/features",
              itemVariable: "feature",
              concurrency: 5,
              joinStepId: "after-child",
              failurePolicy: "fail-fast",
              resultOrder: "input",
              writeOwnership: { mode: "read-only" },
            },
          },
        ],
      },
      {
        id: "after-child",
        nodeId: "after-child",
        role: "worker",
      },
    ];

    const result = validateWorkflowBundle(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.workflow.defaults.fanoutConcurrency).toBe(20);
    expect(
      crossWorkflowDispatchesFromSteps(result.value.workflow.steps),
    ).toEqual([
      {
        id: "__cw:manager",
        workflowId: "child-flow",
        callerStepId: "manager",
        resumeStepId: "after-child",
        fanout: {
          groupId: "features",
          itemsFrom: "/payload/features",
          itemVariable: "feature",
          concurrency: 5,
          joinStepId: "after-child",
          failurePolicy: "fail-fast",
          resultOrder: "input",
          writeOwnership: { mode: "read-only" },
        },
      },
    ]);
  });

  test("rejects invalid fanout authoring", () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["defaults"] = {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
      fanoutConcurrency: 2,
    };
    raw.workflow["steps"] = [
      {
        id: "manager",
        nodeId: "manager",
        role: "manager",
        transitions: [
          {
            toStepId: "child-entry",
            toWorkflowId: "child-flow",
            resumeStepId: "after-child",
            fanout: {
              groupId: "features",
              itemsFrom: "payload/features",
              itemVariable: "1bad",
              concurrency: 3,
              joinStepId: "missing-join",
              failurePolicy: "partial",
              resultOrder: "completion",
              writeOwnership: { mode: "shared" },
            },
          },
        ],
      },
      {
        id: "after-child",
        nodeId: "after-child",
        role: "worker",
      },
    ];

    const result = validateWorkflowBundle(raw);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "workflow.steps[0].transitions[0].fanout.itemsFrom",
        "workflow.steps[0].transitions[0].fanout.itemVariable",
        "workflow.steps[0].transitions[0].fanout.concurrency",
        "workflow.steps[0].transitions[0].fanout.joinStepId",
        "workflow.steps[0].transitions[0].fanout.failurePolicy",
        "workflow.steps[0].transitions[0].fanout.resultOrder",
        "workflow.steps[0].transitions[0].fanout.writeOwnership.mode",
      ]),
    );
  });

  test("sync and async validation align cross-workflow callee entry to the callee manager step", async () => {
    const workflowRoot = makeTempDir();
    const caller = makeStepAddressedRaw();
    caller.workflow["steps"] = [
      {
        id: "manager",
        nodeId: "manager",
        role: "manager",
        transitions: [
          {
            toStepId: "child-manager",
            toWorkflowId: "child-flow",
            resumeStepId: "after-child",
          },
        ],
      },
      {
        id: "after-child",
        nodeId: "after-child",
        role: "worker",
      },
    ];

    writeWorkflowBundle({
      workflowRoot,
      workflowName: "child-directory",
      workflow: {
        workflowId: "child-flow",
        description: "child",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        managerStepId: "child-manager",
        entryStepId: "child-manager",
        nodes: [
          { id: "child-manager", nodeFile: "nodes/node-child-manager.json" },
        ],
        steps: [
          { id: "child-manager", nodeId: "child-manager", role: "manager" },
        ],
      },
      nodePayloads: {
        "nodes/node-child-manager.json": {
          id: "child-manager",
          promptTemplate: "child manager",
          variables: {},
        },
      },
    });

    const syncResult = validateWorkflowBundleDetailed(caller, { workflowRoot });
    expect(syncResult.ok).toBe(true);

    const asyncResult = await validateWorkflowBundleAsync(caller, {
      workflowRoot,
    });
    expect(asyncResult.ok).toBe(true);
  });

  test("sync and async validation infer callee manager entry from stepFile", async () => {
    const workflowRoot = makeTempDir();
    const caller = makeStepAddressedRaw();
    caller.workflow["steps"] = [
      {
        id: "manager",
        nodeId: "manager",
        role: "manager",
        transitions: [
          {
            toStepId: "child-manager",
            toWorkflowId: "child-flow",
            resumeStepId: "after-child",
          },
        ],
      },
      {
        id: "after-child",
        nodeId: "after-child",
        role: "worker",
      },
    ];

    writeWorkflowBundle({
      workflowRoot,
      workflowName: "child-directory",
      workflow: {
        workflowId: "child-flow",
        description: "child",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "child-entry",
        nodes: [
          { id: "child-manager", nodeFile: "nodes/node-child-manager.json" },
        ],
        steps: [{ id: "child-manager", stepFile: "steps/manager.json" }],
      },
      nodePayloads: {
        "nodes/node-child-manager.json": {
          id: "child-manager",
          promptTemplate: "child manager",
          variables: {},
        },
      },
    });
    writeJson(
      path.join(workflowRoot, "child-directory", "steps/manager.json"),
      {
        nodeId: "child-manager",
        role: "manager",
      },
    );

    const syncResult = validateWorkflowBundleDetailed(caller, { workflowRoot });
    expect(syncResult.ok).toBe(true);

    const asyncResult = await validateWorkflowBundleAsync(caller, {
      workflowRoot,
    });
    expect(asyncResult.ok).toBe(true);
  });

  test("detailed validation reports passive node executability with all referencing step ids", async () => {
    const raw = makeStepAddressedRaw();
    raw.workflow["nodes"] = [
      { id: "worker", nodeFile: "nodes/node-worker.json" },
    ];
    raw.workflow["managerStepId"] = undefined;
    raw.workflow["entryStepId"] = "worker-a";
    raw.workflow["steps"] = [
      { id: "worker-a", nodeId: "worker", role: "worker" },
      { id: "worker-b", nodeId: "worker", role: "worker" },
    ];
    raw.nodePayloads = {
      "nodes/node-worker.json": {
        id: "worker",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "worker",
        variables: {},
      },
    };

    const result = await validateWorkflowBundleDetailedAsync(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const backendResult = result.value.nodeValidationResults.find(
      (entry) => entry.source === "agent-backend",
    );
    expect(backendResult?.status).toBe("unknown");
    expect(backendResult?.nodeId).toBe("worker");
    expect(backendResult?.stepIds).toEqual(["worker-a", "worker-b"]);
  });

  test("third-party add-on validate hook contributes one shared node result", async () => {
    const addonDefinition: NodeAddonDefinition = {
      name: "acme/validator",
      version: "1",
      resolve: async (input) => ({
        payload: {
          id: input.nodeId,
          executionBackend: "official/openai-sdk",
          model: "gpt-5-nano",
          promptTemplate: "addon",
          variables: {},
        },
      }),
      validate: (input) => ({
        status: "warning",
        message: `validated ${input.addon.name}`,
        nodeId: input.nodeId,
        source: "addon",
        path: input.path,
        addonName: input.addon.name,
      }),
    };
    const raw = {
      workflow: {
        workflowId: "addon-validate",
        description: "addon validate",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "addon-step",
        nodes: [
          {
            id: "addon-node",
            addon: { name: "acme/validator", version: "1" },
          },
        ],
        steps: [{ id: "addon-step", nodeId: "addon-node", role: "worker" }],
      },
      nodePayloads: {},
    };

    const result = await validateWorkflowBundleDetailedAsync(raw, {
      nodeAddons: [addonDefinition],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const addonResults = result.value.nodeValidationResults.filter(
      (entry) => entry.source === "addon",
    );
    expect(addonResults).toHaveLength(1);
    expect(addonResults[0]).toMatchObject({
      status: "warning",
      message: "validated acme/validator",
      nodeId: "addon-node",
      stepIds: ["addon-step"],
      addonName: "acme/validator",
    });
  });

  test("async third-party add-on resolver failures become validation issues", async () => {
    const raw = {
      workflow: {
        workflowId: "addon-throws",
        description: "addon throws",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "addon-step",
        nodes: [
          {
            id: "addon-node",
            addon: { name: "acme/throws", version: "1" },
          },
        ],
        steps: [{ id: "addon-step", nodeId: "addon-node", role: "worker" }],
      },
      nodePayloads: {},
    };
    const resolver: AsyncNodeAddonPayloadResolver = async () => {
      throw new Error("boom");
    };

    const result = await validateWorkflowBundleDetailedAsync(raw, {
      asyncNodeAddonResolvers: [resolver],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContainEqual({
      severity: "error",
      path: "workflow.nodes[0].addon",
      message:
        "third-party node add-on resolver failed for 'acme/throws': boom",
    });
  });

  test("malformed async third-party add-on resolver output becomes a validation issue", async () => {
    const raw = {
      workflow: {
        workflowId: "addon-malformed",
        description: "addon malformed",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "addon-step",
        nodes: [
          {
            id: "addon-node",
            addon: { name: "acme/malformed", version: "1" },
          },
        ],
        steps: [{ id: "addon-step", nodeId: "addon-node", role: "worker" }],
      },
      nodePayloads: {},
    };
    const resolver: AsyncNodeAddonPayloadResolver = async () =>
      ({ issues: "not-an-array" }) as unknown as NodeAddonResolveResult;

    const result = await validateWorkflowBundleDetailedAsync(raw, {
      asyncNodeAddonResolvers: [resolver],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContainEqual({
      severity: "error",
      path: "workflow.nodes[0].addon.resolverResult.issues",
      message:
        "third-party node add-on resolver for 'acme/malformed' must return issues as an array",
    });
  });

  test("async third-party add-on resolver node validation results are preserved", async () => {
    const raw = {
      workflow: {
        workflowId: "addon-node-results",
        description: "addon node results",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "addon-step",
        nodes: [
          {
            id: "addon-node",
            addon: { name: "acme/results", version: "1" },
          },
        ],
        steps: [{ id: "addon-step", nodeId: "addon-node", role: "worker" }],
      },
      nodePayloads: {},
    };
    const resolver: AsyncNodeAddonPayloadResolver = async (input) => ({
      payload: {
        id: input.nodeId,
        executionBackend: "official/openai-sdk",
        model: "gpt-5-nano",
        promptTemplate: "addon",
        variables: {},
      },
      nodeValidationResults: [
        {
          status: "warning",
          message: "resolver metadata preserved",
          nodeId: input.nodeId,
          source: "addon",
          path: input.path,
          addonName: input.addon.name,
        },
      ],
    });

    const result = await validateWorkflowBundleDetailedAsync(raw, {
      asyncNodeAddonResolvers: [resolver],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.nodeValidationResults.some(
        (entry) =>
          entry.source === "addon" &&
          entry.status === "warning" &&
          entry.message === "resolver metadata preserved" &&
          entry.nodeId === "addon-node" &&
          entry.path === "workflow.nodes[0].addon" &&
          entry.addonName === "acme/results" &&
          entry.stepIds?.[0] === "addon-step",
      ),
    ).toBe(true);
  });

  test("active codex-agent preflight reports authentication failures as node validation results", async () => {
    const root = makeTempDir();
    const bin = path.join(root, "bin");
    writeExecutable(
      path.join(bin, "codex"),
      [
        "#!/usr/bin/env bash",
        'if [ "$1" = "--version" ]; then echo \'codex 1.0.0\'; exit 0; fi',
        'if [ "$1" = "login" ]; then echo \'not logged in\' >&2; exit 1; fi',
        "exit 1",
      ].join("\n"),
    );
    writeExecutable(
      path.join(bin, "git"),
      "#!/usr/bin/env bash\necho 'git 2.0'",
    );
    writeExecutable(
      path.join(root, "node_modules", ".bin", "codex-agent"),
      "#!/usr/bin/env bash\necho '{\"available\":true}'",
    );

    const result = await validateWorkflowBundleDetailedAsync(
      makeStepAddressedRaw(),
      {
        executablePreflight: true,
        cwd: root,
        env: { PATH: `${bin}:${process.env["PATH"] ?? ""}` },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.nodeValidationResults.some(
        (entry) =>
          entry.status === "invalid" &&
          entry.backend === "codex-agent" &&
          entry.message.includes("authentication"),
      ),
    ).toBe(true);
  });
});
