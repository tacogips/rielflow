import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowTemplate } from "./create";
import { loadWorkflowFromDisk } from "./load";
import { resolveAttachmentRoot, resolveEffectiveRoots } from "./paths";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "oyakata-load-test-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeText(filePath: string, text: string): Promise<void> {
  await writeFile(filePath, `${text}\n`, "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("resolveEffectiveRoots", () => {
  test("uses option > env > default priority", () => {
    const fromEnv = resolveEffectiveRoots({
      env: {
        OYAKATA_WORKFLOW_ROOT: "env-workflows",
        OYAKATA_ARTIFACT_ROOT: "env-artifacts",
      },
      cwd: "/tmp/project",
    });
    expect(fromEnv.workflowRoot).toBe("/tmp/project/env-workflows");
    expect(fromEnv.artifactRoot).toBe("/tmp/project/env-artifacts");
    expect(fromEnv.rootDataDir).toBe("/tmp/project/.oyakata-datas");
    expect(fromEnv.attachmentRoot).toBe("/tmp/project/.oyakata-datas/files");

    const fromOption = resolveEffectiveRoots({
      workflowRoot: "flag-workflows",
      artifactRoot: "flag-artifacts",
      env: {
        OYAKATA_WORKFLOW_ROOT: "env-workflows",
        OYAKATA_ARTIFACT_ROOT: "env-artifacts",
      },
      cwd: "/tmp/project",
    });
    expect(fromOption.workflowRoot).toBe("/tmp/project/flag-workflows");
    expect(fromOption.artifactRoot).toBe("/tmp/project/flag-artifacts");
    expect(fromOption.rootDataDir).toBe("/tmp/project/.oyakata-datas");
  });

  test("derives artifact and attachment roots from OYAKATA_ROOT_DATA_DIR", () => {
    const resolved = resolveEffectiveRoots({
      env: {
        OYAKATA_ROOT_DATA_DIR: "env-data",
      },
      cwd: "/tmp/project",
    });

    expect(resolved.rootDataDir).toBe("/tmp/project/env-data");
    expect(resolved.artifactRoot).toBe("/tmp/project/env-data/workflow");
    expect(resolved.attachmentRoot).toBe("/tmp/project/env-data/files");
    expect(
      resolveAttachmentRoot({
        env: {
          OYAKATA_ROOT_DATA_DIR: "env-data",
        },
        cwd: "/tmp/project",
      }),
    ).toBe("/tmp/project/env-data/files");
  });

  test("accepts OYAKATA_RUNTIME_ROOT as a compatibility alias", () => {
    const resolved = resolveEffectiveRoots({
      env: {
        OYAKATA_RUNTIME_ROOT: "legacy-data",
      },
      cwd: "/tmp/project",
    });

    expect(resolved.rootDataDir).toBe("/tmp/project/legacy-data");
    expect(resolved.artifactRoot).toBe("/tmp/project/legacy-data/workflow");
  });
});

describe("loadWorkflowFromDisk", () => {
  test("loads and validates workflow directory", async () => {
    const root = await makeTempDir();
    const workflowName = "sample-workflow";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "sample-workflow",
      description: "sample",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "oyakata-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "oyakata-manager",
          kind: "manager",
          nodeFile: "node-oyakata-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "oyakata-manager", order: 0 }],
    });

    await writeJson(path.join(workflowDirectory, "node-oyakata-manager.json"), {
      id: "oyakata-manager",
      model: "tacogips/codex-agent",
      promptTemplate: "manager",
      variables: {},
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.workflowId).toBe("sample-workflow");
    expect(result.value.artifactWorkflowRoot).toContain(
      path.join("artifacts", "sample-workflow"),
    );
  });

  test("preserves podman runtimeIsolation build metadata during load", async () => {
    const root = await makeTempDir();
    const workflowName = "podman-build-load";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "sample",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "oyakata-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "oyakata-manager",
          kind: "manager",
          nodeFile: "node-oyakata-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "oyakata-manager", order: 0 }],
    });

    await writeJson(path.join(workflowDirectory, "node-oyakata-manager.json"), {
      id: "oyakata-manager",
      model: "tacogips/codex-agent",
      promptTemplate: "manager",
      variables: {},
      runtimeIsolation: {
        mode: "podman",
        build: {
          contextPath: "containers/manager",
          dockerfilePath: "containers/manager/Dockerfile",
          target: "runtime",
        },
      },
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      workflowRoot: root,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.bundle.nodePayloads["oyakata-manager"]).toMatchObject({
      nodeType: "container",
      container: {
        runnerKind: "podman",
        build: {
          contextPath: "containers/manager",
          dockerfilePath: "containers/manager/Dockerfile",
          target: "runtime",
        },
      },
    });
  });

  test("returns validation error when files are invalid", async () => {
    const root = await makeTempDir();
    const workflowName = "broken-workflow";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "broken-workflow",
      description: "broken",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "missing",
      subWorkflows: [],
      nodes: [],
      edges: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [],
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      workflowRoot: root,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("VALIDATION");
  });

  test("auto-generates vertical ordering when workflow-vis.json is missing", async () => {
    const root = await makeTempDir();
    const workflowName = "missing-vis";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "missing-vis",
      description: "sample",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "oyakata-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "oyakata-manager",
          kind: "manager",
          nodeFile: "node-oyakata-manager.json",
          completion: { type: "none" },
        },
        {
          id: "worker-1",
          kind: "task",
          nodeFile: "node-worker-1.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "node-oyakata-manager.json"), {
      id: "oyakata-manager",
      model: "tacogips/codex-agent",
      promptTemplate: "manager",
      variables: {},
    });
    await writeJson(path.join(workflowDirectory, "node-worker-1.json"), {
      id: "worker-1",
      model: "tacogips/codex-agent",
      promptTemplate: "worker",
      variables: {},
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflowVis.nodes).toEqual([
      { id: "oyakata-manager", order: 0 },
      { id: "worker-1", order: 1 },
    ]);
    expect(result.value.bundle.workflowVis.uiMeta).toEqual({
      layout: "vertical",
      autoGenerated: true,
    });
  });

  test("loads newly created templates with root-manager kind", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("template-root-manager", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const result = await loadWorkflowFromDisk("template-root-manager", {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.nodes[0]?.id).toBe("oyakata-manager");
    expect(result.value.bundle.workflow.nodes[0]?.kind).toBe("root-manager");
    expect(
      result.value.bundle.workflow.prompts?.oyakataPromptTemplate,
    ).toContain("Coordinate");
    expect(
      result.value.bundle.workflow.prompts?.workerSystemPromptTemplate,
    ).toContain("assigned node task");
    expect(result.value.bundle.workflow.subWorkflows[0]?.managerNodeId).toBe(
      "main-oyakata",
    );
    expect(result.value.bundle.workflow.subWorkflows[0]?.nodeIds).toEqual([
      "main-oyakata",
      "workflow-input",
      "workflow-output",
    ]);
    expect(result.value.bundle.workflow.subWorkflows[0]?.inputSources).toEqual([
      { type: "human-input" },
    ]);
    expect(
      result.value.bundle.nodePayloads["oyakata-manager"]?.executionBackend,
    ).toBe("codex-agent");
    expect(result.value.bundle.nodePayloads["oyakata-manager"]?.model).toBe(
      "gpt-5-nano",
    );
    expect(
      result.value.bundle.nodePayloads["oyakata-manager"]?.promptTemplateFile,
    ).toBe("prompts/oyakata-manager.md");
    expect(
      result.value.bundle.nodePayloads["oyakata-manager"]?.promptTemplate,
    ).toContain("Coordinate workflow execution");
    expect(
      result.value.bundle.nodePayloads["workflow-output"]?.executionBackend,
    ).toBe("codex-agent");
    expect(result.value.bundle.nodePayloads["workflow-output"]?.model).toBe(
      "gpt-5-nano",
    );
  });

  test("loads promptTemplate from a workflow-local promptTemplateFile", async () => {
    const root = await makeTempDir();
    const workflowName = "prompt-file-workflow";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(path.join(workflowDirectory, "prompts"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "sample",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "oyakata-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "oyakata-manager",
          kind: "manager",
          nodeFile: "node-oyakata-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "oyakata-manager", order: 0 }],
    });

    await writeJson(path.join(workflowDirectory, "node-oyakata-manager.json"), {
      id: "oyakata-manager",
      model: "tacogips/codex-agent",
      promptTemplateFile: "prompts/oyakata-manager.md",
      variables: {},
    });
    await writeText(
      path.join(workflowDirectory, "prompts", "oyakata-manager.md"),
      "Coordinate via prompt file {{workflowId}}",
    );

    const result = await loadWorkflowFromDisk(workflowName, {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(
      result.value.bundle.nodePayloads["oyakata-manager"]?.promptTemplateFile,
    ).toBe("prompts/oyakata-manager.md");
    expect(
      result.value.bundle.nodePayloads["oyakata-manager"]?.promptTemplate,
    ).toBe("Coordinate via prompt file {{workflowId}}\n");
  });

  test("rejects promptTemplateFile values that target canonical workflow definition files", async () => {
    const root = await makeTempDir();
    const workflowName = "invalid-prompt-file-workflow";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "sample",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "oyakata-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "oyakata-manager",
          kind: "manager",
          nodeFile: "node-oyakata-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "oyakata-manager", order: 0 }],
    });

    await writeJson(path.join(workflowDirectory, "node-oyakata-manager.json"), {
      id: "oyakata-manager",
      model: "tacogips/codex-agent",
      promptTemplateFile: "workflow.json",
      variables: {},
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("IO");
    expect(result.error.message).toContain(
      "must not overwrite canonical workflow definition files",
    );
  });
});
