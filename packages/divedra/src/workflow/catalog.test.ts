import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  listWorkflowCatalogSources,
  resolveWorkflowSource,
  withResolvedWorkflowSourceOptions,
} from "./catalog";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "divedra-catalog-"));
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

describe("manifest workflow catalog", () => {
  test("lists only enabled manifest ids and preserves manifest metadata", async () => {
    const root = makeTempDir();
    const enabledDirectory = writeWorkflowBundle(root, "actual", "authored");
    writeWorkflowBundle(root, "hidden");
    const manifestPath = path.join(root, "manifest.json");
    writeJson(manifestPath, {
      manifestVersion: 1,
      workflows: [
        {
          id: "public-alias",
          workflowDirectory: { relative: "./actual" },
          cwd: { relative: "." },
          autoImprove: { mode: "disabled" },
          defaultVariables: { topic: "manifest" },
          metadata: { title: "Public" },
        },
        {
          id: "hidden",
          enabled: false,
          workflowDirectory: { relative: "./hidden" },
        },
      ],
    });

    const result = await listWorkflowCatalogSources({
      workflowManifestPath: manifestPath,
      enableWorkflowManifestCatalog: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      scope: "manifest",
      workflowName: "public-alias",
      workflowDirectory: enabledDirectory,
      authoredWorkflowId: "authored",
      manifestEntryId: "public-alias",
      manifestPath,
      defaultVariables: { topic: "manifest" },
      manifestAutoImprove: { mode: "disabled" },
      metadata: { title: "Public" },
    });
  });

  test("resolves and loads aliases whose id differs from the bundle directory", async () => {
    const root = makeTempDir();
    writeWorkflowBundle(root, "actual", "authored");
    const manifestPath = path.join(root, "manifest.json");
    writeJson(manifestPath, {
      manifestVersion: 1,
      workflows: [
        {
          id: "served-alias",
          workflowDirectory: { relative: "./actual" },
        },
      ],
    });

    const source = await resolveWorkflowSource("served-alias", {
      workflowManifestPath: manifestPath,
      enableWorkflowManifestCatalog: true,
    });
    expect(source.ok).toBe(true);
    if (!source.ok) {
      return;
    }
    const scoped = withResolvedWorkflowSourceOptions(source.value, {
      workflowManifestPath: manifestPath,
      enableWorkflowManifestCatalog: true,
    });
    expect(scoped.workflowBundleDirectoryOverride).toBe(
      path.join(root, "actual"),
    );

    expect(source.value.authoredWorkflowId).toBe("authored");
  });

  test("rejects disabled manifest ids", async () => {
    const root = makeTempDir();
    writeWorkflowBundle(root, "actual");
    const manifestPath = path.join(root, "manifest.json");
    writeJson(manifestPath, {
      manifestVersion: 1,
      workflows: [
        {
          id: "actual",
          enabled: false,
          workflowDirectory: { relative: "./actual" },
        },
      ],
    });

    const result = await resolveWorkflowSource("actual", {
      workflowManifestPath: manifestPath,
      enableWorkflowManifestCatalog: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("NOT_FOUND");
  });
});
