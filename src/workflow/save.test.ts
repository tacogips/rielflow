import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowTemplate } from "./create";
import { loadWorkflowFromDisk } from "./load";
import { saveWorkflowToDisk } from "./save";
import { resolveWorkflowManagerStepId } from "./types";
import {
  REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE,
  REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
} from "./validate";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-save-test-"));
  tempDirs.push(directory);
  return directory;
}

describe("saveWorkflowToDisk", () => {
  test("round-trips managed templates without writing legacy workflow fields", async () => {
    const workflowRoot = await makeTempDir();

    const created = await createWorkflowTemplate("demo", { workflowRoot });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", { workflowRoot });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saved = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      { workflowRoot },
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(workflowRoot, "demo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).toContain('"entryStepId": "divedra-manager"');
    expect(workflowJsonText).toContain('"steps"');
    expect(workflowJsonText).not.toContain('"managerRuntimeId"');
    expect(workflowJsonText).not.toContain('"entryNodeId"');
    expect(workflowJsonText).not.toContain('"workflowCalls"');
    expect(workflowJsonText).not.toContain('"edges"');
    expect(workflowJsonText).not.toContain('"loops"');
    expect(workflowJsonText).not.toContain('"branching"');
  });

  test("round-trips worker-only templates without inventing a manager step", async () => {
    const workflowRoot = await makeTempDir();

    const created = await createWorkflowTemplate("solo", {
      workflowRoot,
      templateMode: "worker-only",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("solo", { workflowRoot });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    expect(resolveWorkflowManagerStepId(loaded.value.bundle.workflow)).toBe(
      "main-worker",
    );

    const saved = await saveWorkflowToDisk(
      "solo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      { workflowRoot },
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(workflowRoot, "solo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).toContain('"entryStepId": "main-worker"');
    expect(workflowJsonText).not.toContain('"managerStepId"');
    expect(workflowJsonText).not.toContain('"managerRuntimeId"');
    expect(workflowJsonText).not.toContain('"entryNodeId"');
  });

  test("rejects top-level workflowCalls on step-addressed save input", async () => {
    const workflowRoot = await makeTempDir();
    const created = await createWorkflowTemplate("demo", { workflowRoot });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", { workflowRoot });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saved = await saveWorkflowToDisk(
      "demo",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          workflowCalls: [],
        } as typeof loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      { workflowRoot },
    );
    expect(saved.ok).toBe(false);
    if (saved.ok) {
      return;
    }

    expect(saved.error.code).toBe("VALIDATION");
    expect(saved.error.issues).toContainEqual({
      severity: "error",
      path: "workflow.workflowCalls",
      message: REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
    });
  });

  test("rejects top-level workflow.edges on step-addressed save input", async () => {
    const workflowRoot = await makeTempDir();
    const created = await createWorkflowTemplate("demo", { workflowRoot });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", { workflowRoot });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saved = await saveWorkflowToDisk(
      "demo",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          edges: [{ from: "a", to: "b", when: "never" }],
        } as typeof loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      { workflowRoot },
    );
    expect(saved.ok).toBe(false);
    if (saved.ok) {
      return;
    }

    expect(saved.error.code).toBe("VALIDATION");
    expect(saved.error.issues).toContainEqual({
      severity: "error",
      path: "workflow.edges",
      message: REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE,
    });
  });
});
