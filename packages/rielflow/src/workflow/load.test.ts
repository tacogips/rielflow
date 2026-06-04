import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  makeStepAddressedAuthoredWorkflowFieldIssue,
  type RejectedAuthoredStepAddressedTopLevelField,
} from "./authored-workflow";
import { loadWorkflowByIdFromDisk, loadWorkflowFromDisk } from "./load";
import {
  normalizeWorkflowNodePatchMap,
  readWorkflowNodePatch,
} from "./node-patches";
import {
  getStructuralEdges,
  resolveWorkflowEntryRuntimeId,
  resolveWorkflowManagerStepId,
} from "./types";
import { normalizeTemporaryWorkflowPayload } from "./temporary-workflow";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "rielflow-load-test-"));
  tempDirs.push(directory);
  return directory;
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

function writeWorkflowBundle(input: {
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly workflowId?: string;
  readonly extraWorkflowFields?: Readonly<Record<string, unknown>>;
}): void {
  const workflowDirectory = path.join(input.workflowRoot, input.workflowName);
  writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: input.workflowId ?? input.workflowName,
    description: "demo",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "manager",
    entryStepId: "manager",
    nodes: [
      { id: "manager", nodeFile: "nodes/node-manager.json" },
      { id: "worker", nodeFile: "nodes/node-worker.json" },
    ],
    steps: [
      {
        id: "manager",
        nodeId: "manager",
        role: "manager",
        transitions: [{ toStepId: "worker", label: "always" }],
      },
      { id: "worker", nodeId: "worker", role: "worker" },
    ],
    ...(input.extraWorkflowFields ?? {}),
  });
  writeJson(path.join(workflowDirectory, "nodes", "node-manager.json"), {
    id: "manager",
    promptTemplate: "manager",
    variables: {},
  });
  writeJson(path.join(workflowDirectory, "nodes", "node-worker.json"), {
    id: "worker",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "worker",
    variables: {},
  });
}

function temporaryWorkflowBundle(
  overrides: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    workflow: {
      workflowId: "temp-demo",
      description: "temporary demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerStepId: "main",
      entryStepId: "main",
      nodes: [{ id: "main", nodeFile: "nodes/node-main.json" }],
      steps: [{ id: "main", nodeId: "main", role: "manager" }],
      ...(overrides["workflow"] as
        | Readonly<Record<string, unknown>>
        | undefined),
    },
    nodePayloads: {
      "nodes/node-main.json": {
        id: "main",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "do the work",
        variables: {},
      },
      ...(overrides["nodePayloads"] as
        | Readonly<Record<string, unknown>>
        | undefined),
    },
  };
}

describe("loadWorkflowFromDisk", () => {
  test("normalizes temporary workflow payloads from embedded bundle JSON", async () => {
    const artifactRoot = makeTempDir();
    const loaded = await normalizeTemporaryWorkflowPayload(
      { kind: "inline-json", value: temporaryWorkflowBundle() },
      { artifactRoot },
    );

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      throw new Error("temporary workflow failed to load");
    }
    expect(loaded.value.loadedWorkflow.source?.scope).toBe("temporary");
    expect(loaded.value.loadedWorkflow.workflowName).toBe("temp-demo");
    expect(loaded.value.normalizedPayload.workflow.workflowId).toBe(
      "temp-demo",
    );
  });

  test("rejects temporary workflow payloads with external prompt files", async () => {
    const loaded = await normalizeTemporaryWorkflowPayload(
      {
        kind: "inline-json",
        value: temporaryWorkflowBundle({
          nodePayloads: {
            "nodes/node-main.json": {
              id: "main",
              executionBackend: "codex-agent",
              model: "gpt-5-nano",
              promptTemplateFile: "prompts/main.md",
              variables: {},
            },
          },
        }),
      },
      {},
    );

    expect(loaded.ok).toBe(false);
    if (loaded.ok) {
      throw new Error("temporary workflow unexpectedly loaded");
    }
    expect(loaded.error.issues?.[0]?.message).toContain(
      "temporary workflows must embed prompt",
    );
  });

  test("rejects ambiguous temporary single-workflow objects", async () => {
    const loaded = await normalizeTemporaryWorkflowPayload(
      {
        kind: "inline-json",
        value: {
          workflowId: "temp-demo",
          nodes: [],
        },
      },
      {},
    );

    expect(loaded.ok).toBe(false);
    if (loaded.ok) {
      throw new Error("temporary workflow unexpectedly loaded");
    }
    expect(loaded.error.message).toContain("{ workflow, nodePayloads }");
  });

  test("loads a step-addressed workflow and derives runtime ids from steps", async () => {
    const workflowRoot = makeTempDir();
    writeWorkflowBundle({ workflowRoot, workflowName: "demo" });
    const workflowBody = readFileSync(
      path.join(workflowRoot, "demo", "workflow.json"),
      "utf8",
    );

    const result = await loadWorkflowFromDisk("demo", { workflowRoot });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(resolveWorkflowEntryRuntimeId(result.value.bundle.workflow)).toBe(
      "manager",
    );
    expect(resolveWorkflowManagerStepId(result.value.bundle.workflow)).toBe(
      "manager",
    );
    expect(getStructuralEdges(result.value.bundle.workflow)).toEqual([
      { from: "manager", to: "worker", when: "always" },
    ]);
    expect(result.value.workflowDefinitionJsonBody).toBe(workflowBody);
  });

  test("applies node patches without writing workflow bundle files", async () => {
    const workflowRoot = makeTempDir();
    writeWorkflowBundle({ workflowRoot, workflowName: "demo" });
    const workflowPath = path.join(workflowRoot, "demo", "workflow.json");
    const workerPath = path.join(
      workflowRoot,
      "demo",
      "nodes",
      "node-worker.json",
    );
    const workflowBefore = readFileSync(workflowPath, "utf8");
    const workerBefore = readFileSync(workerPath, "utf8");

    const result = await loadWorkflowFromDisk("demo", {
      workflowRoot,
      nodePatch: {
        worker: {
          executionBackend: "cursor-cli-agent",
          model: "claude-sonnet-4-5",
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.nodePayloads["worker"]).toMatchObject({
      executionBackend: "cursor-cli-agent",
      model: "claude-sonnet-4-5",
    });
    expect(readFileSync(workflowPath, "utf8")).toBe(workflowBefore);
    expect(readFileSync(workerPath, "utf8")).toBe(workerBefore);
  });

  test("applies codex effort in node patches", async () => {
    const workflowRoot = makeTempDir();
    writeWorkflowBundle({ workflowRoot, workflowName: "demo" });

    const result = await loadWorkflowFromDisk("demo", {
      workflowRoot,
      nodePatch: {
        worker: { effort: "high" },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.nodePayloads["worker"]).toMatchObject({
      executionBackend: "codex-agent",
      effort: "high",
    });
  });

  test("rejects unknown node ids and unsupported SDK effort in node patches", async () => {
    const workflowRoot = makeTempDir();
    writeWorkflowBundle({ workflowRoot, workflowName: "demo" });

    const result = await loadWorkflowFromDisk("demo", {
      workflowRoot,
      nodePatch: {
        missing: { model: "gpt-5.5" },
        worker: { executionBackend: "official/openai-sdk", effort: "high" },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "nodePatch.missing",
          message: expect.stringContaining("unknown workflow node id"),
        }),
        expect.objectContaining({
          path: "nodePatch.worker.effort",
          message: expect.stringContaining("is not supported"),
        }),
      ]),
    );
  });

  test("preserves prototype-like node patch ids as own keys", async () => {
    const normalized = normalizeWorkflowNodePatchMap(
      JSON.parse('{"__proto__":{"model":"gpt-5.5"}}') as unknown,
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    expect(Object.getPrototypeOf(normalized.value)).toBeNull();
    expect(Object.hasOwn(normalized.value, "__proto__")).toBe(true);
    expect(Object.entries(normalized.value)).toEqual([
      ["__proto__", { model: "gpt-5.5" }],
    ]);

    const workflowRoot = makeTempDir();
    writeWorkflowBundle({ workflowRoot, workflowName: "demo" });
    const result = await loadWorkflowFromDisk("demo", {
      workflowRoot,
      nodePatch: normalized.value,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "nodePatch.__proto__",
          message: expect.stringContaining("unknown workflow node id"),
        }),
      ]),
    );
  });

  test("reads node patches from inline JSON, explicit files, and bare file paths", async () => {
    const root = makeTempDir();
    const patchPath = path.join(root, "patch.json");
    writeJson(patchPath, {
      worker: { executionBackend: "cursor-cli-agent", model: "gpt-5.5" },
    });

    await expect(
      readWorkflowNodePatch({
        value: '{"worker":{"model":"gpt-5.5"}}',
        invocationCwd: root,
        optionName: "--node-patch",
      }),
    ).resolves.toEqual({ worker: { model: "gpt-5.5" } });
    await expect(
      readWorkflowNodePatch({
        value: `@${patchPath}`,
        invocationCwd: root,
        optionName: "--node-patch",
      }),
    ).resolves.toEqual({
      worker: { executionBackend: "cursor-cli-agent", model: "gpt-5.5" },
    });
    await expect(
      readWorkflowNodePatch({
        value: patchPath,
        invocationCwd: root,
        optionName: "--node-patch",
      }),
    ).resolves.toEqual({
      worker: { executionBackend: "cursor-cli-agent", model: "gpt-5.5" },
    });
    await expect(
      readWorkflowNodePatch({
        value: '{"worker":{"temperature":0.2}}',
        invocationCwd: root,
        optionName: "--node-patch",
      }),
    ).rejects.toThrow("accepted fields are executionBackend, model, effort");
  });

  test("reports workflow-relative stepFile path diagnostics with the stepFile field name", async () => {
    const workflowRoot = makeTempDir();
    const workflowDirectory = path.join(workflowRoot, "demo");
    writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "demo",
      description: "demo",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      entryStepId: "manager",
      nodes: [{ id: "manager", nodeFile: "nodes/node-manager.json" }],
      steps: [{ id: "manager", stepFile: "../manager-step.json" }],
    });

    const result = await loadWorkflowFromDisk("demo", { workflowRoot });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.issues).toContainEqual({
      severity: "error",
      path: "workflow.steps[0].stepFile",
      message:
        "stepFile '../manager-step.json' must be a workflow-relative path without '.' or '..' segments",
    });
  });

  test("resolves workflows by authored workflowId even when the directory name differs", async () => {
    const workflowRoot = makeTempDir();
    writeWorkflowBundle({
      workflowRoot,
      workflowName: "directory-name",
      workflowId: "actual-id",
    });

    const result = await loadWorkflowByIdFromDisk("actual-id", {
      workflowRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflowName).toBe("directory-name");
    expect(result.value.bundle.workflow.workflowId).toBe("actual-id");
  });

  test.each(
    REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  )("rejects top-level workflow.%s on step-addressed workflow.json", async (fieldName) => {
    const workflowRoot = makeTempDir();
    writeWorkflowBundle({
      workflowRoot,
      workflowName: "demo",
      extraWorkflowFields: {
        [fieldName]: sampleRemovedTopLevelFieldValue(fieldName),
      },
    });

    const result = await loadWorkflowFromDisk("demo", { workflowRoot });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.issues).toContainEqual(
      makeStepAddressedAuthoredWorkflowFieldIssue(fieldName),
    );
  });
});
