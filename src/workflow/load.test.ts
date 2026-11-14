import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowTemplate } from "./create";
import { loadWorkflowFromDisk } from "./load";
import {
  computeDefaultRootDataDir,
  encodeProjectPathForDivedraScope,
  inferRootDataDirFromExplicitStorageRoots,
  resolveAttachmentRoot,
  resolveEffectiveRoots,
  resolveSafeScopedPath,
  resolveWorkflowScopedPath,
} from "./paths";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-load-test-"));
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
    const defaultRoot = computeDefaultRootDataDir("/tmp/project");
    const fromEnv = resolveEffectiveRoots({
      env: {
        DIVEDRA_WORKFLOW_ROOT: "env-workflows",
        DIVEDRA_ARTIFACT_ROOT: "env-artifacts",
      },
      cwd: "/tmp/project",
    });
    expect(fromEnv.workflowRoot).toBe("/tmp/project/env-workflows");
    expect(fromEnv.artifactRoot).toBe("/tmp/project/env-artifacts");
    expect(fromEnv.rootDataDir).toBe(defaultRoot);
    expect(fromEnv.attachmentRoot).toBe(path.join(defaultRoot, "files"));

    const fromOption = resolveEffectiveRoots({
      workflowRoot: "flag-workflows",
      artifactRoot: "flag-artifacts",
      env: {
        DIVEDRA_WORKFLOW_ROOT: "env-workflows",
        DIVEDRA_ARTIFACT_ROOT: "env-artifacts",
      },
      cwd: "/tmp/project",
    });
    expect(fromOption.workflowRoot).toBe("/tmp/project/flag-workflows");
    expect(fromOption.artifactRoot).toBe("/tmp/project/flag-artifacts");
    expect(fromOption.rootDataDir).toBe(defaultRoot);
  });

  test("derives artifact and attachment roots from DIVEDRA_ARTIFACT_DIR", () => {
    const resolved = resolveEffectiveRoots({
      env: {
        DIVEDRA_ARTIFACT_DIR: "env-data",
      },
      cwd: "/tmp/project",
    });

    expect(resolved.rootDataDir).toBe("/tmp/project/env-data");
    expect(resolved.artifactRoot).toBe("/tmp/project/env-data/workflow");
    expect(resolved.attachmentRoot).toBe("/tmp/project/env-data/files");
    expect(
      resolveAttachmentRoot({
        env: {
          DIVEDRA_ARTIFACT_DIR: "env-data",
        },
        cwd: "/tmp/project",
      }),
    ).toBe("/tmp/project/env-data/files");
  });

  test("derives artifact and attachment roots from DIVEDRA_ROOT_DATA_DIR (legacy)", () => {
    const resolved = resolveEffectiveRoots({
      env: {
        DIVEDRA_ROOT_DATA_DIR: "env-data",
      },
      cwd: "/tmp/project",
    });

    expect(resolved.rootDataDir).toBe("/tmp/project/env-data");
    expect(resolved.artifactRoot).toBe("/tmp/project/env-data/workflow");
    expect(resolved.attachmentRoot).toBe("/tmp/project/env-data/files");
  });

  test("DIVEDRA_ARTIFACT_DIR wins over DIVEDRA_ROOT_DATA_DIR", () => {
    const resolved = resolveEffectiveRoots({
      env: {
        DIVEDRA_ARTIFACT_DIR: "artifact-wins",
        DIVEDRA_ROOT_DATA_DIR: "root-loses",
      },
      cwd: "/tmp/project",
    });
    expect(resolved.rootDataDir).toBe("/tmp/project/artifact-wins");
  });

  test("accepts DIVEDRA_RUNTIME_ROOT as a compatibility alias", () => {
    const resolved = resolveEffectiveRoots({
      env: {
        DIVEDRA_RUNTIME_ROOT: "legacy-data",
      },
      cwd: "/tmp/project",
    });

    expect(resolved.rootDataDir).toBe("/tmp/project/legacy-data");
    expect(resolved.artifactRoot).toBe("/tmp/project/legacy-data/workflow");
  });

  test("walks up parent directories to find the nearest .divedra project root", async () => {
    const root = await makeTempDir();
    const nestedCwd = path.join(root, "packages", "feature", "src");
    await mkdir(path.join(root, ".divedra"), { recursive: true });
    await mkdir(nestedCwd, { recursive: true });

    const resolved = resolveEffectiveRoots({
      cwd: nestedCwd,
      env: {},
    });

    expect(resolved.workflowRoot).toBe(path.join(root, ".divedra"));
    expect(resolved.rootDataDir).toBe(computeDefaultRootDataDir(root));
    expect(resolved.artifactRoot).toBe(
      path.join(computeDefaultRootDataDir(root), "workflow"),
    );
  });

  test("falls back to the current directory when no ancestor has .divedra", async () => {
    const root = await makeTempDir();
    const nestedCwd = path.join(root, "packages", "feature", "src");
    await mkdir(nestedCwd, { recursive: true });

    const resolved = resolveEffectiveRoots({
      cwd: nestedCwd,
      env: {},
    });

    expect(resolved.workflowRoot).toBe(path.join(nestedCwd, ".divedra"));
    expect(resolved.rootDataDir).toBe(computeDefaultRootDataDir(nestedCwd));
  });

  test("ignores ancestor .divedra entries that are regular files", async () => {
    const root = await makeTempDir();
    const nestedCwd = path.join(root, "packages", "feature", "src");
    await writeText(path.join(root, ".divedra"), "not-a-directory");
    await mkdir(nestedCwd, { recursive: true });

    const resolved = resolveEffectiveRoots({
      cwd: nestedCwd,
      env: {},
    });

    expect(resolved.workflowRoot).toBe(path.join(nestedCwd, ".divedra"));
    expect(resolved.rootDataDir).toBe(computeDefaultRootDataDir(nestedCwd));
  });
});

describe("inferRootDataDirFromExplicitStorageRoots", () => {
  test("uses the explicit artifact-root parent when only artifact-root is provided", () => {
    expect(
      inferRootDataDirFromExplicitStorageRoots({
        artifactRoot: "runtime/artifacts",
        cwd: "/tmp/project",
      }),
    ).toBe("/tmp/project/runtime");
  });

  test("uses the shared parent when explicit artifact and session roots align", () => {
    expect(
      inferRootDataDirFromExplicitStorageRoots({
        artifactRoot: "runtime/artifacts",
        sessionStoreRoot: "runtime/sessions",
        cwd: "/tmp/project",
      }),
    ).toBe("/tmp/project/runtime");
  });

  test("returns undefined when explicit storage roots do not share a parent", () => {
    expect(
      inferRootDataDirFromExplicitStorageRoots({
        artifactRoot: "/tmp/artifacts",
        sessionStoreRoot: "/var/sessions",
      }),
    ).toBeUndefined();
  });
});

describe("resolveSafeScopedPath", () => {
  test("allows child paths when the scoped root is the filesystem root", () => {
    const filesystemRoot = path.parse(process.cwd()).root;
    expect(resolveSafeScopedPath(filesystemRoot, "safe-child")).toBe(
      path.join(filesystemRoot, "safe-child"),
    );
  });

  test("rejects unsafe path segments", () => {
    expect(resolveSafeScopedPath("/tmp/root", "..")).toBeUndefined();
    expect(resolveSafeScopedPath("/tmp/root", "nested/path")).toBeUndefined();
    expect(resolveSafeScopedPath("/tmp/root", "")).toBeUndefined();
  });
});

describe("resolveWorkflowScopedPath", () => {
  test("scopes safe workflow ids under the target root", () => {
    expect(resolveWorkflowScopedPath("/tmp/root", "demo-id", "executions")).toBe(
      path.join("/tmp/root", "demo-id", "executions"),
    );
  });

  test("rejects unsafe workflow ids before joining filesystem paths", () => {
    expect(resolveWorkflowScopedPath("/tmp/root", "../demo")).toBeUndefined();
  });
});

describe("project path encoding for default root data dir", () => {
  test("encodeProjectPathForDivedraScope joins segments with double underscore", () => {
    if (process.platform !== "win32") {
      expect(encodeProjectPathForDivedraScope("/tmp/project")).toBe("tmp__project");
      expect(encodeProjectPathForDivedraScope("/g/gits/tacogips/divedra")).toBe(
        "g__gits__tacogips__divedra",
      );
    }
    const nested = path.join(os.tmpdir(), "divedra-encode", "nested");
    expect(encodeProjectPathForDivedraScope(nested)).toMatch(/divedra-encode__nested$/);
  });

  test("computeDefaultRootDataDir nests under ~/.divedra/project/.../divedra-artifact", () => {
    const cwd = path.join(os.tmpdir(), "divedra-default-root-test");
    expect(computeDefaultRootDataDir(cwd)).toBe(
      path.join(
        os.homedir(),
        ".divedra",
        "project",
        encodeProjectPathForDivedraScope(cwd),
        "divedra-artifact",
      ),
    );
  });

  test("encodeProjectPathForDivedraScope normalizes path-hostile characters", () => {
    expect(encodeProjectPathForDivedraScope("/tmp/project:feature branch")).toBe(
      "tmp__project_feature_branch",
    );
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
      managerNodeId: "divedra-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "divedra-manager", order: 0 }],
    });

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
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

  test("loads workflows without a top-level description", async () => {
    const root = await makeTempDir();
    const workflowName = "workflow-without-description";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
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
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "divedra-manager", order: 0 }],
    });

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      model: "gpt-5-nano",
      executionBackend: "codex-agent",
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

    expect(result.value.bundle.workflow.description).toBe("");
  });

  test("loads inline node payloads when nodeFile is omitted", async () => {
    const root = await makeTempDir();
    const workflowName = "inline-node-workflow";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(path.join(workflowDirectory, "prompts"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "inline",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "divedra-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          completion: { type: "none" },
          node: {
            id: "divedra-manager",
            model: "gpt-5-nano",
            executionBackend: "codex-agent",
            promptTemplateFile: "prompts/divedra-manager.md",
            variables: {},
          },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "divedra-manager", order: 0 }],
    });
    await writeText(
      path.join(workflowDirectory, "prompts", "divedra-manager.md"),
      "inline manager prompt",
    );

    const result = await loadWorkflowFromDisk(workflowName, {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.nodes[0]?.nodeFile).toBe(
      "nodes/node-divedra-manager.json",
    );
    expect(result.value.bundle.nodePayloads["divedra-manager"]?.promptTemplate).toBe(
      "inline manager prompt\n",
    );
  });

  test("loads node payload files from nodes/ paths", async () => {
    const root = await makeTempDir();
    const workflowName = "nested-node-path-workflow";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "nested nodes",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "divedra-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "nodes/node-divedra-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "divedra-manager", order: 0 }],
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-divedra-manager.json"),
      {
        id: "divedra-manager",
        model: "gpt-5-nano",
        executionBackend: "codex-agent",
        promptTemplate: "nested manager",
        variables: {},
      },
    );

    const result = await loadWorkflowFromDisk(workflowName, {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.nodes[0]?.nodeFile).toBe(
      "nodes/node-divedra-manager.json",
    );
    expect(result.value.bundle.nodePayloads["divedra-manager"]?.promptTemplate).toBe(
      "nested manager",
    );
  });

  test("rejects nodeFile paths that escape the workflow directory before reading them", async () => {
    const root = await makeTempDir();
    const workflowName = "unsafe-node-path-workflow";
    const workflowDirectory = path.join(root, workflowName);
    const externalDirectory = path.join(root, "external");
    await mkdir(workflowDirectory, { recursive: true });
    await mkdir(externalDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "unsafe",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "divedra-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "../external/node-divedra-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });
    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "divedra-manager", order: 0 }],
    });
    await writeFile(
      path.join(externalDirectory, "node-divedra-manager.json"),
      "{ invalid json }\n",
      "utf8",
    );

    const result = await loadWorkflowFromDisk(workflowName, {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.issues).toEqual([
      {
        severity: "error",
        path: "workflow.nodes[0].nodeFile",
        message:
          "nodeFile '../external/node-divedra-manager.json' must be a workflow-relative path without '.' or '..' segments",
      },
    ]);
  });

  test("loads unified role workflows with a manager-role node", async () => {
    const root = await makeTempDir();
    const workflowName = "unified-role-workflow";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "sample",
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
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "worker-1", order: 1 },
        { id: "worker-2", order: 2 },
      ],
    });

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      model: "gpt-5-nano",
      executionBackend: "codex-agent",
      promptTemplate: "manager",
      variables: {},
    });
    await writeJson(path.join(workflowDirectory, "node-worker-1.json"), {
      id: "worker-1",
      model: "gpt-5-nano",
      executionBackend: "codex-agent",
      promptTemplate: "worker",
      variables: {},
    });
    await writeJson(path.join(workflowDirectory, "node-worker-2.json"), {
      id: "worker-2",
      model: "gpt-5-nano",
      executionBackend: "codex-agent",
      promptTemplate: "judge",
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

    expect(result.value.bundle.workflow.entryNodeId).toBe("divedra-manager");
    expect(result.value.bundle.workflow.managerNodeId).toBe("divedra-manager");
    expect(result.value.bundle.workflow.subWorkflows).toEqual([]);
    expect(result.value.bundle.workflow.nodes[0]?.kind).toBe("root-manager");
    expect(result.value.bundle.workflow.nodes[2]?.control).toBe("loop-judge");
    expect(result.value.bundle.workflow.nodes[2]?.kind).toBe("loop-judge");
  });

  test("returns validation error for manager-less workflows before runtime support lands", async () => {
    const root = await makeTempDir();
    const workflowName = "managerless-workflow";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "sample",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      entryNodeId: "worker-1",
      nodes: [
        {
          id: "worker-1",
          role: "worker",
          nodeFile: "node-worker-1.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "worker-1", order: 0 }],
    });

    await writeJson(path.join(workflowDirectory, "node-worker-1.json"), {
      id: "worker-1",
      model: "gpt-5-nano",
      executionBackend: "codex-agent",
      promptTemplate: "worker",
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

    expect(result.error.code).toBe("VALIDATION");
    expect(
      result.error.issues?.some(
        (issue) =>
          issue.path === "workflow.entryNodeId" &&
          issue.message.includes("not executable"),
      ),
    ).toBe(true);
  });

  test("preserves podman runtimeIsolation build metadata for worker nodes during load", async () => {
    const root = await makeTempDir();
    const workflowName = "podman-build-load";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "sample",
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
          id: "build-worker",
          role: "worker",
          nodeFile: "node-build-worker.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "build-worker", order: 1 },
      ],
    });

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      model: "gpt-5-nano",
      executionBackend: "codex-agent",
      promptTemplate: "manager",
      variables: {},
    });

    await writeJson(path.join(workflowDirectory, "node-build-worker.json"), {
      id: "build-worker",
      model: "tacogips/codex-agent",
      promptTemplate: "worker",
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
    expect(result.value.bundle.nodePayloads["build-worker"]).toMatchObject({
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
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
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
      { id: "divedra-manager", order: 0 },
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

    expect(result.value.bundle.workflow.nodes[0]?.id).toBe("divedra-manager");
    expect(result.value.bundle.workflow.nodes[0]?.kind).toBe("root-manager");
    expect(
      result.value.bundle.workflow.prompts?.divedraPromptTemplate,
    ).toContain("Coordinate");
    expect(
      result.value.bundle.workflow.prompts?.workerSystemPromptTemplate,
    ).toContain("assigned node task");
    expect(result.value.bundle.workflow.subWorkflows[0]?.managerNodeId).toBe(
      "main-divedra",
    );
    expect(result.value.bundle.workflow.subWorkflows[0]?.nodeIds).toEqual([
      "main-divedra",
      "workflow-input",
      "workflow-output",
    ]);
    expect(result.value.bundle.workflow.subWorkflows[0]?.inputSources).toEqual([
      { type: "human-input" },
    ]);
    expect(
      result.value.bundle.nodePayloads["divedra-manager"]?.executionBackend,
    ).toBe("codex-agent");
    expect(result.value.bundle.nodePayloads["divedra-manager"]?.model).toBe(
      "gpt-5-nano",
    );
    expect(
      result.value.bundle.nodePayloads["divedra-manager"]?.promptTemplateFile,
    ).toBe("prompts/divedra-manager.md");
    expect(
      result.value.bundle.nodePayloads["divedra-manager"]?.promptTemplate,
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
      managerNodeId: "divedra-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "divedra-manager", order: 0 }],
    });

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      model: "tacogips/codex-agent",
      promptTemplateFile: "prompts/divedra-manager.md",
      variables: {},
    });
    await writeText(
      path.join(workflowDirectory, "prompts", "divedra-manager.md"),
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
      result.value.bundle.nodePayloads["divedra-manager"]?.promptTemplateFile,
    ).toBe("prompts/divedra-manager.md");
    expect(
      result.value.bundle.nodePayloads["divedra-manager"]?.promptTemplate,
    ).toBe("Coordinate via prompt file {{workflowId}}\n");
  });

  test("loads node system and session-start templates from workflow-local files", async () => {
    const root = await makeTempDir();
    const workflowName = "node-template-files";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(path.join(workflowDirectory, "prompts"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "sample",
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
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "divedra-manager", order: 0 }],
    });

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      model: "tacogips/codex-agent",
      systemPromptTemplateFile: "prompts/system.md",
      promptTemplateFile: "prompts/body.md",
      sessionStartPromptTemplateFile: "prompts/session-start.md",
      variables: {},
    });
    await writeText(
      path.join(workflowDirectory, "prompts", "system.md"),
      "System {{workflowId}}",
    );
    await writeText(
      path.join(workflowDirectory, "prompts", "body.md"),
      "Body {{workflowId}}",
    );
    await writeText(
      path.join(workflowDirectory, "prompts", "session-start.md"),
      "##prompt\n{{prompt}}\n## args\n{{args}}",
    );

    const result = await loadWorkflowFromDisk(workflowName, {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const payload = result.value.bundle.nodePayloads["divedra-manager"];
    expect(payload?.systemPromptTemplateFile).toBe("prompts/system.md");
    expect(payload?.systemPromptTemplate).toBe("System {{workflowId}}\n");
    expect(payload?.promptTemplateFile).toBe("prompts/body.md");
    expect(payload?.promptTemplate).toBe("Body {{workflowId}}\n");
    expect(payload?.sessionStartPromptTemplateFile).toBe(
      "prompts/session-start.md",
    );
    expect(payload?.sessionStartPromptTemplate).toBe(
      "##prompt\n{{prompt}}\n## args\n{{args}}\n",
    );
  });

  test("loads node-level descriptions from node payload files", async () => {
    const root = await makeTempDir();
    const workflowName = "node-description-workflow";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "sample",
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
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "divedra-manager", order: 0 }],
    });

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      description: "Coordinate the workflow and route work to downstream lanes.",
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

    expect(result.value.bundle.nodePayloads["divedra-manager"]?.description).toBe(
      "Coordinate the workflow and route work to downstream lanes.",
    );
  });

  test("loads the claude worker example with an explicit claude-code-agent worker node", async () => {
    const artifactRoot = path.join(await makeTempDir(), "artifacts");
    const result = await loadWorkflowFromDisk("claude-divedra-claude-worker", {
      workflowRoot: path.resolve(process.cwd(), "examples"),
      artifactRoot,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(
      result.value.bundle.workflow.nodes.find(
        (node) => node.id === "claude-task",
      )?.nodeFile,
    ).toBe("nodes/node-claude-task.json");
    expect(
      result.value.bundle.nodePayloads["claude-task"]?.executionBackend,
    ).toBe("claude-code-agent");
    expect(result.value.bundle.nodePayloads["claude-task"]?.model).toBe(
      "claude-haiku-4-5",
    );
    expect(
      result.value.bundle.nodePayloads["claude-task"]?.promptTemplate,
    ).toContain("Use the normalized request");
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
      managerNodeId: "divedra-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "workflow-vis.json"), {
      nodes: [{ id: "divedra-manager", order: 0 }],
    });

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
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
