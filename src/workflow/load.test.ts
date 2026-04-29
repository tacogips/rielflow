import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadWorkflowByIdFromDisk, loadWorkflowFromDisk } from "./load";
import {
  getStructuralEdges,
  resolveWorkflowEntryRuntimeId,
  resolveWorkflowManagerRuntimeId,
} from "./types";
import {
  REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE,
  REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
} from "./validate";

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
    expect(resolveWorkflowManagerRuntimeId(result.value.bundle.workflow)).toBe(
      "manager",
    );
    expect(getStructuralEdges(result.value.bundle.workflow)).toEqual([
      { from: "manager", to: "worker", when: "always" },
    ]);
    expect("workflowCalls" in result.value.bundle.workflow).toBe(false);
  });

  test("resolves workflows by authored workflowId even when the directory name differs", async () => {
    const workflowRoot = makeTempDir();
    writeWorkflowBundle({
      workflowRoot,
      workflowName: "directory-name",
      workflowId: "actual-id",
    });

    const result = await loadWorkflowByIdFromDisk("actual-id", { workflowRoot });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflowName).toBe("directory-name");
    expect(result.value.bundle.workflow.workflowId).toBe("actual-id");
  });

  test("rejects authored workflowCalls on step-addressed workflow.json", async () => {
    const workflowRoot = makeTempDir();
    writeWorkflowBundle({
      workflowRoot,
      workflowName: "demo",
      extraWorkflowFields: { workflowCalls: [] },
    });

    const result = await loadWorkflowFromDisk("demo", { workflowRoot });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.issues).toContainEqual({
      severity: "error",
      path: "workflow.workflowCalls",
      message: REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
    });
  });

  test("rejects top-level workflow.edges on step-addressed workflow.json", async () => {
    const workflowRoot = makeTempDir();
    writeWorkflowBundle({
      workflowRoot,
      workflowName: "demo",
      extraWorkflowFields: {
        edges: [{ from: "manager", to: "worker", when: "always" }],
      },
    });

    const result = await loadWorkflowFromDisk("demo", { workflowRoot });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.issues).toContainEqual({
      severity: "error",
      path: "workflow.edges",
      message: REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE,
    });
  });
});
