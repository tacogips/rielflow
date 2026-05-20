import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadWorkflowManifest } from "./manifest";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "divedra-manifest-"));
  tempDirs.push(directory);
  return directory;
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeWorkflowBundle(
  root: string,
  name: string,
  workflowId = name,
): string {
  const workflowDirectory = path.join(root, name);
  writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId,
    description: "demo",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "manager",
    entryStepId: "manager",
    nodes: [{ id: "manager", nodeFile: "nodes/node-manager.json" }],
    steps: [{ id: "manager", nodeId: "manager", role: "manager" }],
  });
  writeJson(path.join(workflowDirectory, "nodes", "node-manager.json"), {
    id: "manager",
    promptTemplate: "manager",
    variables: {},
  });
  return workflowDirectory;
}

describe("loadWorkflowManifest", () => {
  test("resolves relative workflowDirectory and cwd from the manifest directory", async () => {
    const root = makeTempDir();
    const workflowDirectory = writeWorkflowBundle(
      root,
      "bundle",
      "authored-id",
    );
    const manifestPath = path.join(root, "manifest.json");
    writeJson(manifestPath, {
      manifestVersion: 1,
      workflows: [
        {
          id: "served-id",
          workflowDirectory: { relative: "./bundle" },
          cwd: { relative: "." },
          autoImprove: { mode: "active" },
          defaultVariables: { a: 1 },
          metadata: { title: "Served" },
        },
      ],
    });

    const result = await loadWorkflowManifest(manifestPath);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.entries[0]).toMatchObject({
      id: "served-id",
      enabled: true,
      workflowDirectory,
      cwd: root,
      authoredWorkflowId: "authored-id",
      autoImprove: { mode: "active" },
      defaultVariables: { a: 1 },
      metadata: { title: "Served" },
    });
  });

  test("rejects malformed path objects before duplicate id validation", async () => {
    const root = makeTempDir();
    writeWorkflowBundle(root, "bundle");
    const manifestPath = path.join(root, "manifest.json");
    writeJson(manifestPath, {
      manifestVersion: 1,
      workflows: [
        {
          id: "dup",
          workflowDirectory: { relative: "./bundle" },
        },
        {
          id: "dup",
          workflowDirectory: {
            absolute: path.join(root, "bundle"),
            relative: "./bundle",
          },
        },
      ],
    });

    const result = await loadWorkflowManifest(manifestPath);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("INVALID_PATH");
    expect(result.error.message).toContain(
      "workflowDirectory must contain exactly one of absolute or relative",
    );
  });

  test("rejects duplicate manifest ids after entries resolve", async () => {
    const root = makeTempDir();
    writeWorkflowBundle(root, "first-bundle");
    writeWorkflowBundle(root, "second-bundle");
    const manifestPath = path.join(root, "manifest.json");
    writeJson(manifestPath, {
      manifestVersion: 1,
      workflows: [
        {
          id: "dup",
          workflowDirectory: { relative: "./first-bundle" },
        },
        {
          id: "dup",
          workflowDirectory: { relative: "./second-bundle" },
        },
      ],
    });

    const result = await loadWorkflowManifest(manifestPath);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("DUPLICATE_ID");
    expect(result.error.message).toContain("duplicate workflow manifest id");
  });

  test("rejects duplicate enabled sources unless reserved metadata allows them", async () => {
    const root = makeTempDir();
    writeWorkflowBundle(root, "bundle", "authored");
    const duplicate = {
      workflowDirectory: { relative: "./bundle" },
      metadata: { allowDuplicateSource: true },
    };
    const manifestPath = path.join(root, "manifest.json");
    writeJson(manifestPath, {
      manifestVersion: 1,
      workflows: [
        { id: "first", ...duplicate },
        { id: "second", ...duplicate },
      ],
    });

    const result = await loadWorkflowManifest(manifestPath);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.entries.map((entry) => entry.allowDuplicateSource),
    ).toEqual([true, true]);
  });

  test("requires reserved duplicate-source metadata on each duplicate entry", async () => {
    const root = makeTempDir();
    writeWorkflowBundle(root, "bundle", "authored");
    const manifestPath = path.join(root, "manifest.json");
    writeJson(manifestPath, {
      manifestVersion: 1,
      workflows: [
        {
          id: "first",
          workflowDirectory: { relative: "./bundle" },
          metadata: { allowDuplicateSource: true },
        },
        {
          id: "second",
          workflowDirectory: { relative: "./bundle" },
        },
      ],
    });

    const result = await loadWorkflowManifest(manifestPath);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("DUPLICATE_SOURCE");
  });

  test("validates disabled entries before they can be re-enabled", async () => {
    const root = makeTempDir();
    const manifestPath = path.join(root, "manifest.json");
    writeJson(manifestPath, {
      manifestVersion: 1,
      workflows: [
        {
          id: "disabled",
          enabled: false,
          workflowDirectory: { relative: "./missing" },
        },
      ],
    });

    const result = await loadWorkflowManifest(manifestPath);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("workflow.json");
  });
});
