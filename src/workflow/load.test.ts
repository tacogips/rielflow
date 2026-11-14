import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  getStructuralEdges,
  resolveWorkflowEntryRuntimeId,
  resolveWorkflowManagerStepId,
} from "./types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "divedra-load-test-"));
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

describe("loadWorkflowFromDisk", () => {
  test("loads a step-addressed workflow and derives runtime ids from steps", async () => {
    const workflowRoot = makeTempDir();
    writeWorkflowBundle({ workflowRoot, workflowName: "demo" });

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
