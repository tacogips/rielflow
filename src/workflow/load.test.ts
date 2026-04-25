import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowTemplate } from "./create";
import { listWorkflowCatalogSources } from "./catalog";
import {
  loadWorkflowByIdFromDisk,
  loadWorkflowFromCatalog,
  loadWorkflowFromDisk,
} from "./load";
import {
  computeDefaultRootDataDir,
  encodeProjectPathForDivedraScope,
  inferRootDataDirFromExplicitStorageRoots,
  resolveAttachmentRoot,
  resolveEffectiveRoots,
  resolveSafeScopedPath,
  resolveWorkflowScopedPath,
} from "./paths";
import type {
  LoadOptions,
  NodeAddonDefinition,
  NodeAddonPayloadResolver,
} from "./types";

/** Opt in to loading legacy-shaped inline fixtures (suite defaults to strict authorship when omitted). */
const testLegacyAuthorshipOk: Pick<
  LoadOptions,
  "rejectLegacyWorkflowAuthoring"
> = { rejectLegacyWorkflowAuthoring: false };

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

async function writeLocalAddonManifest(input: {
  readonly addonRoot: string;
  readonly name: string;
  readonly version: string;
  readonly prompt: string;
  readonly model?: string;
}): Promise<void> {
  const [namespace, addonName] = input.name.split("/");
  if (namespace === undefined || addonName === undefined) {
    throw new Error(`invalid test add-on name '${input.name}'`);
  }
  const addonDirectory = path.join(
    input.addonRoot,
    namespace,
    addonName,
    input.version,
  );
  await mkdir(path.join(addonDirectory, "prompts"), { recursive: true });
  await writeText(
    path.join(addonDirectory, "prompts", "worker.md"),
    input.prompt,
  );
  await writeJson(path.join(addonDirectory, "addon.json"), {
    name: input.name,
    version: input.version,
    description: "Local echo worker",
    allowedRoles: ["worker"],
    inputSchema: {
      type: "object",
      required: ["message"],
      additionalProperties: false,
      properties: {
        message: { type: "string", minLength: 1 },
      },
    },
    resolution: {
      kind: "node-payload-template",
      nodeType: "agent",
      executionBackend: "official/openai-sdk",
      model: input.model ?? "gpt-5-nano",
      promptTemplateFile: "prompts/worker.md",
      variables: {
        renderedMessage: "{{addon.inputs.message}}",
      },
    },
  });
}

async function writeAddonWorkflow(input: {
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly addonName: string;
  readonly version?: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
}): Promise<void> {
  const workflowDirectory = path.join(input.workflowRoot, input.workflowName);
  await mkdir(workflowDirectory, { recursive: true });
  await writeJson(path.join(workflowDirectory, "workflow.json"), {
    workflowId: input.workflowName,
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryNodeId: "worker-1",
    nodes: [
      {
        id: "worker-1",
        role: "worker",
        addon: {
          name: input.addonName,
          ...(input.version === undefined ? {} : { version: input.version }),
          inputs: input.inputs ?? { message: "loaded" },
        },
        completion: { type: "none" },
      },
    ],
    edges: [],
    loops: [],
    branching: { mode: "fan-out" },
  });
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
    expect(
      resolveWorkflowScopedPath("/tmp/root", "demo-id", "executions"),
    ).toBe(path.join("/tmp/root", "demo-id", "executions"));
  });

  test("rejects unsafe workflow ids before joining filesystem paths", () => {
    expect(resolveWorkflowScopedPath("/tmp/root", "../demo")).toBeUndefined();
  });
});

describe("project path encoding for default root data dir", () => {
  test("encodeProjectPathForDivedraScope joins segments with double underscore", () => {
    if (process.platform !== "win32") {
      expect(encodeProjectPathForDivedraScope("/tmp/project")).toBe(
        "tmp__project",
      );
      expect(encodeProjectPathForDivedraScope("/g/gits/tacogips/divedra")).toBe(
        "g__gits__tacogips__divedra",
      );
    }
    const nested = path.join(os.tmpdir(), "divedra-encode", "nested");
    expect(encodeProjectPathForDivedraScope(nested)).toMatch(
      /divedra-encode__nested$/,
    );
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
    expect(
      encodeProjectPathForDivedraScope("/tmp/project:feature branch"),
    ).toBe("tmp__project_feature_branch");
  });
});

describe("scoped workflow catalog", () => {
  test("loads project-scope workflows before user-scope workflows", async () => {
    const root = await makeTempDir();
    const projectScopeRoot = path.join(root, ".divedra");
    const userScopeRoot = path.join(root, "user-scope");

    await createWorkflowTemplate("demo", {
      workflowRoot: path.join(userScopeRoot, "workflows"),
    });
    await createWorkflowTemplate("demo", {
      workflowRoot: path.join(projectScopeRoot, "workflows"),
    });

    const loaded = await loadWorkflowFromCatalog("demo", {
      cwd: root,
      userRoot: userScopeRoot,
      env: {},
    });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.source?.scope).toBe("project");
    expect(loaded.value.workflowDirectory).toBe(
      path.join(projectScopeRoot, "workflows", "demo"),
    );
    expect(loaded.value.artifactWorkflowRoot).toBe(
      path.join(projectScopeRoot, "artifacts", "workflow", "demo"),
    );
  });

  test("can force user scope when a project workflow shadows the name", async () => {
    const root = await makeTempDir();
    const projectScopeRoot = path.join(root, ".divedra");
    const userScopeRoot = path.join(root, "user-scope");

    await createWorkflowTemplate("demo", {
      workflowRoot: path.join(userScopeRoot, "workflows"),
    });
    await createWorkflowTemplate("demo", {
      workflowRoot: path.join(projectScopeRoot, "workflows"),
    });

    const loaded = await loadWorkflowFromCatalog("demo", {
      cwd: root,
      workflowScope: "user",
      userRoot: userScopeRoot,
      env: {},
    });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.source?.scope).toBe("user");
    expect(loaded.value.workflowDirectory).toBe(
      path.join(userScopeRoot, "workflows", "demo"),
    );
    expect(loaded.value.artifactWorkflowRoot).toBe(
      path.join(userScopeRoot, "artifacts", "workflow", "demo"),
    );
  });

  test("rejects invalid workflow scope environment values in catalog APIs", async () => {
    const root = await makeTempDir();
    const userScopeRoot = path.join(root, "user-scope");
    await createWorkflowTemplate("demo", {
      workflowRoot: path.join(userScopeRoot, "workflows"),
    });

    const loaded = await loadWorkflowFromCatalog("demo", {
      cwd: root,
      userRoot: userScopeRoot,
      env: {
        DIVEDRA_WORKFLOW_SCOPE: "global",
      },
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) {
      return;
    }
    expect(loaded.error.code).toBe("INVALID_SCOPE");
    expect(loaded.error.message).toContain("DIVEDRA_WORKFLOW_SCOPE");

    const listed = await listWorkflowCatalogSources({
      cwd: root,
      userRoot: userScopeRoot,
      env: {
        DIVEDRA_WORKFLOW_SCOPE: "global",
      },
    });
    expect(listed.ok).toBe(false);
    if (listed.ok) {
      return;
    }
    expect(listed.error.code).toBe("INVALID_SCOPE");
  });

  test("rejects invalid workflow scope environment values during create", async () => {
    const root = await makeTempDir();

    const created = await createWorkflowTemplate("demo", {
      cwd: root,
      env: {
        DIVEDRA_WORKFLOW_SCOPE: "global",
      },
    });

    expect(created.ok).toBe(false);
    if (created.ok) {
      return;
    }
    expect(created.error.code).toBe("INVALID_SCOPE");
    expect(created.error.message).toContain("DIVEDRA_WORKFLOW_SCOPE");
  });

  test("infers scoped runtime data root from explicit session store roots", async () => {
    const root = await makeTempDir();
    const userScopeRoot = path.join(root, "user-scope");
    const rootDataDir = path.join(root, "runtime-data");
    await createWorkflowTemplate("demo", {
      workflowRoot: path.join(userScopeRoot, "workflows"),
    });

    const loaded = await loadWorkflowFromCatalog("demo", {
      cwd: root,
      workflowScope: "user",
      userRoot: userScopeRoot,
      sessionStoreRoot: path.join(rootDataDir, "sessions"),
      env: {},
    });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.artifactWorkflowRoot).toBe(
      path.join(rootDataDir, "workflow", "demo"),
    );
  });

  test("preserves direct workflow-root loading", async () => {
    const root = await makeTempDir();
    await createWorkflowTemplate("demo", { workflowRoot: root });

    const loaded = await loadWorkflowFromCatalog("demo", {
      workflowRoot: root,
      env: {},
    });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.source?.scope).toBe("direct");
    expect(loaded.value.workflowDirectory).toBe(path.join(root, "demo"));
  });

  test("creates workflows in user scope when no project scope exists", async () => {
    const root = await makeTempDir();
    const userScopeRoot = path.join(root, "user-scope");

    const created = await createWorkflowTemplate("new-flow", {
      cwd: root,
      userRoot: userScopeRoot,
      env: {},
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.value.workflowDirectory).toBe(
      path.join(userScopeRoot, "workflows", "new-flow"),
    );
  });

  test("creates project scope intentionally with --scope project semantics", async () => {
    const root = await makeTempDir();

    const created = await createWorkflowTemplate("project-flow", {
      cwd: root,
      workflowScope: "project",
      env: {},
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.value.workflowDirectory).toBe(
      path.join(root, ".divedra", "workflows", "project-flow"),
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

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "manager",
      variables: {},
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
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

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      model: "gpt-5-nano",
      executionBackend: "codex-agent",
      promptTemplate: "manager",
      variables: {},
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
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
    await writeText(
      path.join(workflowDirectory, "prompts", "divedra-manager.md"),
      "inline manager prompt",
    );

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
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
    expect(
      result.value.bundle.nodePayloads["divedra-manager"]?.promptTemplate,
    ).toBe("inline manager prompt\n");
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
      ...testLegacyAuthorshipOk,
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
    expect(
      result.value.bundle.nodePayloads["divedra-manager"]?.promptTemplate,
    ).toBe("nested manager");
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
    await writeFile(
      path.join(externalDirectory, "node-divedra-manager.json"),
      "{ invalid json }\n",
      "utf8",
    );

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
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
      ...testLegacyAuthorshipOk,
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

  test("loads manager-less workflows with an explicit entry node", async () => {
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

    await writeJson(path.join(workflowDirectory, "node-worker-1.json"), {
      id: "worker-1",
      model: "gpt-5-nano",
      executionBackend: "codex-agent",
      promptTemplate: "worker",
      variables: {},
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.hasManagerNode).toBe(false);
    expect(result.value.bundle.workflow.entryNodeId).toBe("worker-1");
    expect(result.value.bundle.workflow.managerNodeId).toBe("worker-1");
    expect(result.value.bundle.workflow.nodes[0]?.kind).toBe("task");
  });

  test("loads authored workflowCalls for later runtime-readiness checks", async () => {
    const root = await makeTempDir();
    const workflowName = "workflow-call-authored";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "workflow call fixture",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      entryNodeId: "writer",
      workflowCalls: [
        {
          id: "call-review",
          workflowId: "review-flow",
          callerNodeId: "writer",
        },
      ],
      nodes: [
        {
          id: "writer",
          role: "worker",
          nodeFile: "node-writer.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "node-writer.json"), {
      id: "writer",
      nodeType: "command",
      command: {
        scriptPath: "scripts/write.sh",
      },
      variables: {},
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.workflowCalls).toEqual([
      {
        id: "call-review",
        workflowId: "review-flow",
        callerNodeId: "writer",
      },
    ]);
  });

  test("preserves canonical container build metadata for worker nodes during load", async () => {
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

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      model: "gpt-5-nano",
      executionBackend: "codex-agent",
      promptTemplate: "manager",
      variables: {},
    });

    await writeJson(path.join(workflowDirectory, "node-build-worker.json"), {
      id: "build-worker",
      nodeType: "container",
      variables: {},
      container: {
        runnerKind: "podman",
        build: {
          contextPath: "containers/manager",
          containerfilePath: "containers/manager/Containerfile",
          target: "runtime",
        },
      },
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
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
          containerfilePath: "containers/manager/Containerfile",
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
      nodes: [],
      edges: [],
      branching: { mode: "fan-out" },
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("VALIDATION");
  });

  test("loads workflow definitions without separate visualization metadata", async () => {
    const root = await makeTempDir();
    const workflowName = "missing-vis";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "missing-vis",
      description: "sample",
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
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "manager",
      variables: {},
    });
    await writeJson(path.join(workflowDirectory, "node-worker-1.json"), {
      id: "worker-1",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "worker",
      variables: {},
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.bundle.workflow.nodes.map((node) => node.id)).toEqual([
      "divedra-manager",
      "worker-1",
    ]);
  });

  test("loads newly created templates with explicit entry and role-based nodes", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("template-role-workflow", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(root, "template-role-workflow", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"subWorkflows"');
    expect(workflowJsonText).not.toContain('"edges"');
    expect(workflowJsonText).not.toContain('"loops"');
    expect(workflowJsonText).not.toContain('"branching"');
    expect(workflowJsonText).not.toContain('"containerRuntime"');
    expect(workflowJsonText).not.toContain('"completion"');
    expect(workflowJsonText).toContain('"managerStepId": "divedra-manager"');
    expect(workflowJsonText).toContain('"entryStepId": "divedra-manager"');
    expect(workflowJsonText).toContain('"steps"');

    const result = await loadWorkflowFromDisk("template-role-workflow", {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.nodes[0]?.id).toBe("divedra-manager");
    expect(result.value.bundle.workflow.entryNodeId).toBe("divedra-manager");
    expect(result.value.bundle.workflow.managerStepId).toBe("divedra-manager");
    expect(result.value.bundle.workflow.entryStepId).toBe("divedra-manager");
    expect(result.value.bundle.workflow.nodes[0]?.role).toBe("manager");
    expect(result.value.bundle.workflow.nodes[1]?.role).toBe("worker");
    expect(
      result.value.bundle.workflow.prompts?.divedraPromptTemplate,
    ).toContain("Coordinate");
    expect(
      result.value.bundle.workflow.prompts?.workerSystemPromptTemplate,
    ).toContain("assigned node task");
    expect(result.value.bundle.workflow.subWorkflows).toEqual([]);
    expect(
      result.value.bundle.nodePayloads["divedra-manager"]?.executionBackend,
    ).toBeUndefined();
    expect(result.value.bundle.nodePayloads["divedra-manager"]?.model).toBe(
      undefined,
    );
    expect(
      result.value.bundle.nodePayloads["divedra-manager"]?.promptTemplateFile,
    ).toBe("prompts/divedra-manager.md");
    expect(
      result.value.bundle.nodePayloads["divedra-manager"]?.promptTemplate,
    ).toContain("Coordinate workflow execution");
    expect(
      result.value.bundle.nodePayloads["main-worker"]?.executionBackend,
    ).toBe("codex-agent");
    expect(result.value.bundle.nodePayloads["main-worker"]?.model).toBe(
      "gpt-5-nano",
    );
  });

  test("creates worker-only starter templates without an authored manager", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("template-worker-only", {
      workflowRoot: root,
      templateMode: "worker-only",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(root, "template-worker-only", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerNodeId"');
    expect(workflowJsonText).not.toContain('"subWorkflows"');
    expect(workflowJsonText).not.toContain('"edges"');
    expect(workflowJsonText).not.toContain('"loops"');
    expect(workflowJsonText).not.toContain('"branching"');
    expect(workflowJsonText).not.toContain('"containerRuntime"');
    expect(workflowJsonText).not.toContain('"completion"');
    expect(workflowJsonText).toContain('"entryStepId": "main-worker"');
    expect(workflowJsonText).toContain('"steps"');

    const result = await loadWorkflowFromDisk("template-worker-only", {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.hasManagerNode).toBe(false);
    expect(result.value.bundle.workflow.entryNodeId).toBe("main-worker");
    expect(result.value.bundle.workflow.entryStepId).toBe("main-worker");
    expect(result.value.bundle.workflow.managerNodeId).toBe("main-worker");
    expect(result.value.bundle.workflow.nodes.map((node) => node.id)).toEqual([
      "main-worker",
    ]);
    expect(result.value.bundle.workflow.prompts?.divedraPromptTemplate).toBe(
      undefined,
    );
    expect(
      result.value.bundle.workflow.prompts?.workerSystemPromptTemplate,
    ).toContain("assigned node task");
    expect(
      result.value.bundle.nodePayloads["main-worker"]?.executionBackend,
    ).toBe("codex-agent");
  });

  test("loads step-addressed workflows with file-backed step definitions in strict authored-schema mode", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "step-file-demo");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await mkdir(path.join(workflowDirectory, "steps"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "step-file-demo",
      description: "step file workflow",
      defaults: {
        nodeTimeoutMs: 120000,
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
          stepFile: "steps/step-manager.json",
        },
        {
          id: "review",
          stepFile: "steps/step-review.json",
        },
      ],
    });
    await writeJson(
      path.join(workflowDirectory, "steps", "step-manager.json"),
      {
        id: "manager",
        nodeId: "manager-node",
        role: "manager",
        transitions: [{ toStepId: "review" }],
      },
    );
    await writeJson(path.join(workflowDirectory, "steps", "step-review.json"), {
      id: "review",
      nodeId: "coder-node",
      role: "worker",
      promptVariant: "self-review",
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-manager.json"),
      {
        id: "manager-node",
        variables: {},
      },
    );
    await writeJson(path.join(workflowDirectory, "nodes", "node-coder.json"), {
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
    });

    const result = await loadWorkflowFromDisk("step-file-demo", {
      workflowRoot: root,
      rejectLegacyWorkflowAuthoring: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(
      result.value.bundle.workflow.nodeRegistry?.map((node) => node.id),
    ).toEqual(["manager-node", "coder-node"]);
    expect(result.value.bundle.workflow.steps?.map((step) => step.id)).toEqual([
      "manager",
      "review",
    ]);
    expect(result.value.bundle.workflow.steps?.[0]?.stepFile).toBe(
      "steps/step-manager.json",
    );
    expect(result.value.bundle.nodePayloads["manager"]?.managerType).toBe(
      "code",
    );
    expect(result.value.bundle.nodePayloads["manager"]?.executionBackend).toBe(
      undefined,
    );
    expect(result.value.bundle.nodePayloads["review"]?.promptTemplate).toBe(
      "review",
    );
  });

  test("rejects legacy node-addressed authored workflows when strict authored-schema mode is enabled", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "legacy-strict-reject");
    await mkdir(workflowDirectory, { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "legacy-strict-reject",
      description: "legacy authored workflow",
      defaults: {
        nodeTimeoutMs: 120000,
      },
      managerNodeId: "divedra-manager",
      entryNodeId: "divedra-manager",
      nodes: [
        {
          id: "divedra-manager",
          role: "manager",
          nodeFile: "node-manager.json",
        },
        {
          id: "worker-1",
          role: "worker",
          nodeFile: "node-worker-1.json",
        },
      ],
      edges: [{ from: "divedra-manager", to: "worker-1", when: "always" }],
      loops: [],
    });
    await writeJson(path.join(workflowDirectory, "node-manager.json"), {
      id: "divedra-manager",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "manager",
      variables: {},
    });
    await writeJson(path.join(workflowDirectory, "node-worker-1.json"), {
      id: "worker-1",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "worker",
      variables: {},
    });

    const result = await loadWorkflowFromDisk("legacy-strict-reject", {
      workflowRoot: root,
      rejectLegacyWorkflowAuthoring: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.issues).toEqual(
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

  test("loads prompt variant template files for step-addressed node reuse", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "step-variant-file-demo");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await mkdir(path.join(workflowDirectory, "prompts"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "step-variant-file-demo",
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
    });
    await writeJson(path.join(workflowDirectory, "nodes", "node-coder.json"), {
      id: "coder-node",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "implement",
      variables: {},
      promptVariants: {
        "self-review": {
          promptTemplateFile: "prompts/review.md",
          systemPromptTemplateFile: "prompts/review-system.md",
        },
      },
    });
    await writeFile(
      path.join(workflowDirectory, "prompts", "review.md"),
      "review via file\n",
      "utf8",
    );
    await writeFile(
      path.join(workflowDirectory, "prompts", "review-system.md"),
      "review system via file\n",
      "utf8",
    );

    const result = await loadWorkflowFromDisk("step-variant-file-demo", {
      workflowRoot: root,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(
      result.value.bundle.nodePayloads["coder-node"]?.promptVariants,
    ).toMatchObject({
      "self-review": {
        promptTemplate: "review via file\n",
        promptTemplateFile: "prompts/review.md",
        systemPromptTemplate: "review system via file\n",
        systemPromptTemplateFile: "prompts/review-system.md",
      },
    });
    expect(result.value.bundle.nodePayloads["review"]?.promptTemplate).toBe(
      "review via file\n",
    );
    expect(
      result.value.bundle.nodePayloads["review"]?.systemPromptTemplate,
    ).toBe("review system via file\n");
  });

  test("rejects step files whose authored id disagrees with workflow.json", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "step-file-id-mismatch");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await mkdir(path.join(workflowDirectory, "steps"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "step-file-id-mismatch",
      defaults: {
        nodeTimeoutMs: 120000,
      },
      entryStepId: "manager",
      managerStepId: "manager",
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
        },
      ],
    });
    await writeJson(
      path.join(workflowDirectory, "steps", "step-manager.json"),
      {
        id: "not-manager",
        nodeId: "manager-node",
        role: "manager",
      },
    );
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-manager.json"),
      {
        id: "manager-node",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
    );

    const result = await loadWorkflowFromDisk("step-file-id-mismatch", {
      workflowRoot: root,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.steps[0].stepFile",
          message:
            "step file id 'not-manager' must match workflow step id 'manager'",
        }),
      ]),
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

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplateFile: "prompts/divedra-manager.md",
      variables: {},
    });
    await writeText(
      path.join(workflowDirectory, "prompts", "divedra-manager.md"),
      "Coordinate via prompt file {{workflowId}}",
    );

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
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

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
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
      ...testLegacyAuthorshipOk,
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

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      description:
        "Coordinate the workflow and route work to downstream lanes.",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "manager",
      variables: {},
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(
      result.value.bundle.nodePayloads["divedra-manager"]?.description,
    ).toBe("Coordinate the workflow and route work to downstream lanes.");
  });

  test("loads the claude worker example with an explicit claude-code-agent worker node", async () => {
    const artifactRoot = path.join(await makeTempDir(), "artifacts");
    const result = await loadWorkflowFromDisk("claude-divedra-claude-worker", {
      ...testLegacyAuthorshipOk,
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

  test("loads third-party add-on refs when a resolver is provided", async () => {
    const root = await makeTempDir();
    const workflowName = "third-party-addon";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });
    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      entryNodeId: "worker-1",
      nodes: [
        {
          id: "worker-1",
          role: "worker",
          addon: {
            name: "acme/echo-worker",
            inputs: { message: "loaded" },
          },
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    const resolver: NodeAddonPayloadResolver = (input) =>
      input.addon.name === "acme/echo-worker"
        ? {
            issues: [],
            payload: {
              id: input.nodeId,
              model: "gpt-5-nano",
              executionBackend: "official/openai-sdk",
              promptTemplate: "Echo {{message}}",
              variables: input.addon.inputs ?? {},
            },
          }
        : { issues: [] };

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      nodeAddonResolvers: [resolver],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.bundle.nodePayloads["worker-1"]).toMatchObject({
      executionBackend: "official/openai-sdk",
      variables: { message: "loaded" },
    });
  });

  test("loads third-party add-on refs when an async definition is provided", async () => {
    const root = await makeTempDir();
    const workflowName = "async-third-party-addon";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });
    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      entryNodeId: "worker-1",
      nodes: [
        {
          id: "worker-1",
          role: "worker",
          addon: {
            name: "acme/async-echo-worker",
            version: "1",
            inputs: { message: "loaded async" },
          },
          completion: { type: "none" },
        },
      ],
      edges: [],
      loops: [],
      branching: { mode: "fan-out" },
    });

    const addon: NodeAddonDefinition = {
      name: "acme/async-echo-worker",
      version: "1",
      resolve: async (input) => ({
        payload: {
          id: input.nodeId,
          model: "gpt-5-nano",
          executionBackend: "official/openai-sdk",
          promptTemplate: "Echo {{message}}",
          variables: input.addon.inputs ?? {},
        },
      }),
    };

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      nodeAddons: [addon],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.bundle.nodePayloads["worker-1"]).toMatchObject({
      executionBackend: "official/openai-sdk",
      variables: { message: "loaded async" },
    });
  });

  test("resolves user-scope local add-on manifests", async () => {
    const root = await makeTempDir();
    const userScopeRoot = path.join(root, "user-scope");
    const workflowName = "user-local-addon";
    const addonName = "acme/echo-worker";

    await writeAddonWorkflow({
      workflowRoot: path.join(userScopeRoot, "workflows"),
      workflowName,
      addonName,
      version: "1",
      inputs: { message: "from user scope" },
    });
    await writeLocalAddonManifest({
      addonRoot: path.join(userScopeRoot, "addons"),
      name: addonName,
      version: "1",
      prompt: "User prompt {{renderedMessage}}",
    });

    const result = await loadWorkflowFromCatalog(workflowName, {
      ...testLegacyAuthorshipOk,
      workflowScope: "user",
      userRoot: userScopeRoot,
      cwd: root,
      env: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.bundle.nodePayloads["worker-1"]).toMatchObject({
      executionBackend: "official/openai-sdk",
      model: "gpt-5-nano",
      promptTemplate: "User prompt {{renderedMessage}}\n",
      variables: {
        renderedMessage: "from user scope",
        message: "from user scope",
      },
    });
  });

  test("project-scope local add-on shadows user-scope add-on by exact version", async () => {
    const root = await makeTempDir();
    const projectScopeRoot = path.join(root, ".divedra");
    const userScopeRoot = path.join(root, "user-scope");
    const workflowName = "project-shadow-addon";
    const addonName = "acme/echo-worker";

    await writeAddonWorkflow({
      workflowRoot: path.join(userScopeRoot, "workflows"),
      workflowName,
      addonName,
      version: "1",
      inputs: { message: "shadowed" },
    });
    await writeLocalAddonManifest({
      addonRoot: path.join(userScopeRoot, "addons"),
      name: addonName,
      version: "1",
      prompt: "User add-on",
      model: "gpt-5-nano",
    });
    await writeLocalAddonManifest({
      addonRoot: path.join(projectScopeRoot, "addons"),
      name: addonName,
      version: "1",
      prompt: "Project add-on",
      model: "gpt-5-mini",
    });

    const result = await loadWorkflowFromCatalog(workflowName, {
      ...testLegacyAuthorshipOk,
      workflowScope: "user",
      userRoot: userScopeRoot,
      cwd: root,
      env: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.bundle.nodePayloads["worker-1"]).toMatchObject({
      model: "gpt-5-mini",
      promptTemplate: "Project add-on\n",
    });
  });

  test("uses direct add-on root override before scoped local add-ons", async () => {
    const root = await makeTempDir();
    const projectScopeRoot = path.join(root, ".divedra");
    const directAddonRoot = path.join(root, "direct-addons");
    const workflowName = "direct-addon-root";
    const addonName = "acme/echo-worker";

    await writeAddonWorkflow({
      workflowRoot: path.join(projectScopeRoot, "workflows"),
      workflowName,
      addonName,
      version: "1",
    });
    await writeLocalAddonManifest({
      addonRoot: path.join(projectScopeRoot, "addons"),
      name: addonName,
      version: "1",
      prompt: "Project add-on",
      model: "gpt-5-nano",
    });
    await writeLocalAddonManifest({
      addonRoot: directAddonRoot,
      name: addonName,
      version: "1",
      prompt: "Direct add-on",
      model: "gpt-5-mini",
    });

    const result = await loadWorkflowFromCatalog(workflowName, {
      ...testLegacyAuthorshipOk,
      cwd: root,
      addonRoot: directAddonRoot,
      env: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.bundle.nodePayloads["worker-1"]).toMatchObject({
      model: "gpt-5-mini",
      promptTemplate: "Direct add-on\n",
    });
  });

  test("falls back to scoped local add-ons after a direct add-on root miss", async () => {
    const root = await makeTempDir();
    const projectScopeRoot = path.join(root, ".divedra");
    const directAddonRoot = path.join(root, "direct-addons");
    const workflowName = "direct-addon-root-fallback";
    const addonName = "acme/project-only-worker";

    await writeAddonWorkflow({
      workflowRoot: path.join(projectScopeRoot, "workflows"),
      workflowName,
      addonName,
      version: "1",
    });
    await writeLocalAddonManifest({
      addonRoot: path.join(projectScopeRoot, "addons"),
      name: addonName,
      version: "1",
      prompt: "Project fallback add-on",
      model: "gpt-5-mini",
    });

    const result = await loadWorkflowFromCatalog(workflowName, {
      ...testLegacyAuthorshipOk,
      cwd: root,
      addonRoot: directAddonRoot,
      env: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.bundle.nodePayloads["worker-1"]).toMatchObject({
      model: "gpt-5-mini",
      promptTemplate: "Project fallback add-on\n",
    });
  });

  test("does not infer scoped local add-ons for direct workflow-root loading", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, "direct-workflows");
    const projectScopeRoot = path.join(root, ".divedra");
    const workflowName = "direct-root-addon-isolation";
    const addonName = "acme/echo-worker";

    await writeAddonWorkflow({
      workflowRoot,
      workflowName,
      addonName,
      version: "1",
    });
    await writeLocalAddonManifest({
      addonRoot: path.join(projectScopeRoot, "addons"),
      name: addonName,
      version: "1",
      prompt: "Project add-on",
      model: "gpt-5-mini",
    });

    const isolated = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
      workflowRoot,
      cwd: root,
      env: {},
    });

    expect(isolated.ok).toBe(false);
    if (isolated.ok) {
      return;
    }
    expect(isolated.error.code).toBe("VALIDATION");
    expect(
      isolated.error.issues?.some(
        (issue) =>
          issue.path === "workflow.nodes[0].addon.name" &&
          issue.message.includes("unknown third-party node add-on"),
      ),
    ).toBe(true);

    const withMissingDirectAddonRoot = await loadWorkflowFromDisk(
      workflowName,
      {
        ...testLegacyAuthorshipOk,
        workflowRoot,
        addonRoot: path.join(root, "missing-direct-addons"),
        cwd: root,
        env: {},
      },
    );

    expect(withMissingDirectAddonRoot.ok).toBe(false);
    if (withMissingDirectAddonRoot.ok) {
      return;
    }
    expect(
      withMissingDirectAddonRoot.error.issues?.some(
        (issue) =>
          issue.path === "workflow.nodes[0].addon.name" &&
          issue.message.includes("unknown third-party node add-on"),
      ),
    ).toBe(true);

    const withDirectAddonRoot = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
      workflowRoot,
      addonRoot: path.join(projectScopeRoot, "addons"),
      cwd: root,
      env: {},
    });

    expect(withDirectAddonRoot.ok).toBe(true);
    if (!withDirectAddonRoot.ok) {
      return;
    }
    expect(
      withDirectAddonRoot.value.bundle.nodePayloads["worker-1"],
    ).toMatchObject({
      model: "gpt-5-mini",
      promptTemplate: "Project add-on\n",
    });
  });

  test("rejects unsafe local add-on names before resolving paths", async () => {
    const root = await makeTempDir();
    const projectScopeRoot = path.join(root, ".divedra");
    const workflowName = "unsafe-addon-name";

    await writeAddonWorkflow({
      workflowRoot: path.join(projectScopeRoot, "workflows"),
      workflowName,
      addonName: "../evil",
      version: "1",
    });

    const result = await loadWorkflowFromCatalog(workflowName, {
      ...testLegacyAuthorshipOk,
      cwd: root,
      env: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("VALIDATION");
    expect(
      result.error.issues?.some((issue) => issue.path.endsWith(".addon")),
    ).toBe(true);
    expect(
      result.error.issues?.some((issue) =>
        issue.message.includes("invalid local"),
      ),
    ).toBe(true);
  });

  test("rejects local add-on template files outside the add-on directory", async () => {
    const root = await makeTempDir();
    const projectScopeRoot = path.join(root, ".divedra");
    const workflowName = "unsafe-addon-template";
    const addonName = "acme/unsafe-worker";
    const addonRoot = path.join(projectScopeRoot, "addons");
    const addonDirectory = path.join(addonRoot, "acme", "unsafe-worker", "1");

    await writeAddonWorkflow({
      workflowRoot: path.join(projectScopeRoot, "workflows"),
      workflowName,
      addonName,
      version: "1",
    });
    await mkdir(addonDirectory, { recursive: true });
    await writeJson(path.join(addonDirectory, "addon.json"), {
      name: addonName,
      version: "1",
      description: "Unsafe local worker",
      allowedRoles: ["worker"],
      resolution: {
        kind: "node-payload-template",
        nodeType: "agent",
        executionBackend: "official/openai-sdk",
        model: "gpt-5-nano",
        promptTemplateFile: "../outside.md",
        variables: {},
      },
    });

    const result = await loadWorkflowFromCatalog(workflowName, {
      ...testLegacyAuthorshipOk,
      cwd: root,
      env: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("VALIDATION");
    expect(
      result.error.issues?.some((issue) =>
        issue.message.includes("must not contain '.' or '..' segments"),
      ),
    ).toBe(true);
  });

  test("loads the worker-only example without an authored manager node and accepts its shipped step-addressed authoring in strict mode", async () => {
    const artifactRoot = path.join(await makeTempDir(), "artifacts");
    const result = await loadWorkflowFromDisk("worker-only-single-step", {
      workflowRoot: path.resolve(process.cwd(), "examples"),
      artifactRoot,
      rejectLegacyWorkflowAuthoring: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.hasManagerNode).toBe(false);
    expect(result.value.bundle.workflow.entryStepId).toBe("main-worker");
    expect(result.value.bundle.workflow.entryNodeId).toBe("main-worker");
    expect(result.value.bundle.workflow.steps?.map((step) => step.id)).toEqual([
      "main-worker",
    ]);
    expect(result.value.bundle.workflow.nodes.map((node) => node.id)).toEqual([
      "main-worker",
    ]);
    expect(
      result.value.bundle.nodePayloads["main-worker"]?.executionBackend,
    ).toBe("codex-agent");
    expect(
      result.value.bundle.nodePayloads["main-worker"]?.promptTemplate,
    ).toContain("Complete the assigned workflow step");
  });

  test("loads the supervised-mock-retry example as a shipped strict step-addressed worker-only bundle", async () => {
    const artifactRoot = path.join(await makeTempDir(), "artifacts");
    const result = await loadWorkflowFromDisk("supervised-mock-retry", {
      workflowRoot: path.resolve(process.cwd(), "examples"),
      artifactRoot,
      rejectLegacyWorkflowAuthoring: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.workflowId).toBe("supervised-mock-retry");
    expect(result.value.bundle.workflow.hasManagerNode).toBe(false);
    expect(result.value.bundle.workflow.entryStepId).toBe("main-worker");
    expect(result.value.bundle.workflow.steps?.map((step) => step.id)).toEqual([
      "main-worker",
    ]);
    expect(result.value.bundle.workflow.nodes.map((node) => node.id)).toEqual([
      "main-worker",
    ]);
  });

  test("loads the chat reply example as a shipped strict step-addressed worker-only bundle", async () => {
    const artifactRoot = path.join(await makeTempDir(), "artifacts");
    const result = await loadWorkflowFromDisk("chat-reply-webhook", {
      workflowRoot: path.resolve(process.cwd(), "examples"),
      artifactRoot,
      rejectLegacyWorkflowAuthoring: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.hasManagerNode).toBe(false);
    expect(result.value.bundle.workflow.entryStepId).toBe("reply-to-chat");
    expect(result.value.bundle.workflow.entryNodeId).toBe("reply-to-chat");
    expect(result.value.bundle.workflow.steps?.map((step) => step.id)).toEqual([
      "reply-to-chat",
    ]);
    expect(result.value.bundle.workflow.nodes.map((node) => node.id)).toEqual([
      "reply-to-chat",
    ]);
    const replyNodePayload = result.value.bundle.nodePayloads["reply-to-chat"];
    expect(replyNodePayload?.nodeType).toBe("addon");
    expect(replyNodePayload?.addon?.name).toBe("divedra/chat-reply-worker");
  });

  test("loads the claude managed examples as shipped strict step-addressed bundles", async () => {
    const examplesRoot = path.resolve(process.cwd(), "examples");

    for (const [workflowName, expectedStepIds] of [
      [
        "claude-divedra-codex-coding",
        [
          "divedra-manager",
          "main-divedra",
          "workflow-input",
          "implementation-brief",
          "implement",
          "workflow-output",
        ],
      ],
      [
        "claude-divedra-claude-worker",
        [
          "divedra-manager",
          "main-divedra",
          "workflow-input",
          "claude-task",
          "workflow-output",
        ],
      ],
    ] as const) {
      const artifactRoot = path.join(await makeTempDir(), "artifacts");
      const result = await loadWorkflowFromDisk(workflowName, {
        workflowRoot: examplesRoot,
        artifactRoot,
        rejectLegacyWorkflowAuthoring: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        continue;
      }

      expect(result.value.bundle.workflow.hasManagerNode).toBe(true);
      expect(result.value.bundle.workflow.managerStepId).toBe(
        "divedra-manager",
      );
      expect(result.value.bundle.workflow.entryStepId).toBe("divedra-manager");
      expect(
        result.value.bundle.workflow.steps?.map((step) => step.id),
      ).toEqual(expectedStepIds);
      expect(result.value.bundle.workflow.nodes.map((node) => node.id)).toEqual(
        expectedStepIds,
      );
    }
  });

  test("loads additional shipped managed examples as strict step-addressed bundles where their authored schema no longer depends on compatibility-only metadata", async () => {
    const examplesRoot = path.resolve(process.cwd(), "examples");

    for (const [workflowName, expectedStepIds] of [
      [
        "subworkflow-chained-simple",
        [
          "divedra-manager",
          "alpha-manager",
          "alpha-input",
          "alpha-worker",
          "alpha-output",
          "beta-manager",
          "beta-input",
          "beta-worker",
          "beta-output",
        ],
      ],
      [
        "first-four-arithmetic-pipeline",
        [
          "divedra-manager",
          "add-manager",
          "add-input",
          "add-worker",
          "add-output",
          "multiply-manager",
          "multiply-input",
          "multiply-worker",
          "multiply-output",
          "divide-manager",
          "divide-input",
          "divide-worker",
          "divide-output",
        ],
      ],
      [
        "node-combinations-showcase",
        [
          "divedra-manager",
          "command-manager",
          "command-input",
          "command-worker",
          "command-output",
          "container-manager",
          "container-input",
          "container-worker",
          "container-output",
          "foreach-manager",
          "foreach-input",
          "foreach-worker",
          "foreach-judge",
          "foreach-output",
        ],
      ],
      [
        "codex-codex-euthanasia-debate",
        [
          "divedra-manager",
          "affirmative-manager",
          "affirmative-input",
          "affirmative-speaker",
          "affirmative-output",
          "negative-manager",
          "negative-input",
          "negative-speaker",
          "negative-output",
          "debate-judge",
          "debate-summary",
        ],
      ],
    ] as const) {
      const artifactRoot = path.join(await makeTempDir(), "artifacts");
      const result = await loadWorkflowFromDisk(workflowName, {
        workflowRoot: examplesRoot,
        artifactRoot,
        rejectLegacyWorkflowAuthoring: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        continue;
      }

      expect(result.value.bundle.workflow.hasManagerNode).toBe(true);
      expect(result.value.bundle.workflow.managerStepId).toBe(
        "divedra-manager",
      );
      expect(result.value.bundle.workflow.entryStepId).toBe("divedra-manager");
      expect(
        result.value.bundle.workflow.steps?.map((step) => step.id),
      ).toEqual(expectedStepIds);
      expect(result.value.bundle.workflow.nodes.map((node) => node.id)).toEqual(
        expectedStepIds,
      );
    }
  });

  test("loads the same-node shared-session example as a strict step-addressed bundle", async () => {
    const artifactRoot = path.join(await makeTempDir(), "artifacts");
    const examplesRoot = path.resolve(process.cwd(), "examples");
    const result = await loadWorkflowFromDisk("same-node-session-echo", {
      workflowRoot: examplesRoot,
      artifactRoot,
      rejectLegacyWorkflowAuthoring: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.bundle.workflow.hasManagerNode).toBe(true);
    expect(result.value.bundle.workflow.managerStepId).toBe("divedra-manager");
    expect(result.value.bundle.workflow.entryStepId).toBe("divedra-manager");
    expect(result.value.bundle.workflow.steps?.map((step) => step.id)).toEqual([
      "divedra-manager",
      "main-divedra",
      "workflow-input",
      "echo-request",
      "answer-request",
      "workflow-output",
    ]);
    expect(
      result.value.bundle.workflow.nodeRegistry?.map((node) => node.id),
    ).toEqual([
      "divedra-manager",
      "main-divedra",
      "workflow-input",
      "echo-session",
      "workflow-output",
    ]);
    expect(
      result.value.bundle.workflow.steps?.find(
        (step) => step.id === "answer-request",
      ),
    ).toMatchObject({
      nodeId: "echo-session",
      promptVariant: "answer",
      sessionPolicy: {
        mode: "reuse",
        inheritFromStepId: "echo-request",
      },
    });
    expect(
      result.value.bundle.nodePayloads["echo-request"]?.promptTemplate,
    ).toContain("first visit to the reusable worker node");
    expect(
      result.value.bundle.nodePayloads["answer-request"]?.promptTemplate,
    ).toContain("revisiting the reusable worker node for its answer step");
  });

  test("loads the workflow-call examples with a step-addressed parent (cross-workflow step transition, no authored workflowCalls) and strict step-addressed callee", async () => {
    const artifactRoot = path.join(await makeTempDir(), "artifacts");
    const examplesRoot = path.resolve(process.cwd(), "examples");
    const parentResult = await loadWorkflowFromDisk("workflow-call-simple", {
      ...testLegacyAuthorshipOk,
      workflowRoot: examplesRoot,
      artifactRoot,
    });

    expect(parentResult.ok).toBe(true);
    if (!parentResult.ok) {
      return;
    }

    expect(parentResult.value.bundle.workflow.workflowCalls).toBeUndefined();
    expect(parentResult.value.bundle.workflow.managerStepId).toBe(
      "divedra-manager",
    );
    expect(parentResult.value.bundle.workflow.entryStepId).toBe(
      "divedra-manager",
    );
    expect(
      parentResult.value.bundle.workflow.steps?.map((step) => step.id),
    ).toEqual(["divedra-manager", "draft-write", "apply-review"]);

    const strictParentResult = await loadWorkflowFromDisk(
      "workflow-call-simple",
      {
        workflowRoot: examplesRoot,
        artifactRoot,
        rejectLegacyWorkflowAuthoring: true,
      },
    );
    expect(strictParentResult.ok).toBe(true);
    if (!strictParentResult.ok) {
      return;
    }
    expect(
      strictParentResult.value.bundle.workflow.workflowCalls,
    ).toBeUndefined();

    const calleeResult = await loadWorkflowFromDisk(
      "workflow-call-review-target",
      {
        workflowRoot: examplesRoot,
        artifactRoot,
        rejectLegacyWorkflowAuthoring: true,
      },
    );

    expect(calleeResult.ok).toBe(true);
    if (!calleeResult.ok) {
      return;
    }

    expect(calleeResult.value.bundle.workflow.hasManagerNode).toBe(false);
    expect(calleeResult.value.bundle.workflow.entryStepId).toBe("reviewer");
    expect(calleeResult.value.bundle.workflow.entryNodeId).toBe("reviewer");
    expect(
      calleeResult.value.bundle.workflow.steps?.map((step) => step.id),
    ).toEqual(["reviewer"]);
    expect(
      calleeResult.value.bundle.workflow.nodes.map((node) => node.id),
    ).toEqual(["reviewer"]);
  });

  test("keeps shipped examples off structural sub-workflow authoring", async () => {
    const examplesRoot = path.resolve(process.cwd(), "examples");
    const roleAuthoredExamples = [
      "chat-reply-webhook",
      "worker-only-single-step",
      "workflow-call-simple",
      "workflow-call-review-target",
      "claude-divedra-codex-coding",
      "claude-divedra-claude-worker",
      "same-node-session-echo",
      "subworkflow-chained-simple",
      "node-combinations-showcase",
      "first-four-arithmetic-pipeline",
      "codex-codex-euthanasia-debate",
    ];

    for (const workflowName of roleAuthoredExamples) {
      const workflowText = await readFile(
        path.join(examplesRoot, workflowName, "workflow.json"),
        "utf8",
      );
      const workflowJson = JSON.parse(workflowText) as {
        readonly subWorkflows?: unknown;
        readonly subWorkflowConversations?: unknown;
      };
      expect(workflowJson.subWorkflows).toBeUndefined();
      expect(workflowJson.subWorkflowConversations).toBeUndefined();
    }
  });

  test("resolves workflow ids from a directory whose name differs from workflowId", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "review-flow-bundle");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "review-flow",
      description: "review workflow",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      entryNodeId: "reviewer",
      nodes: [
        {
          id: "reviewer",
          role: "worker",
          nodeFile: "nodes/node-reviewer.json",
        },
      ],
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-reviewer.json"),
      {
        id: "reviewer",
        executionBackend: "codex-agent",
        model: "gpt-5",
        promptTemplate: "review",
        variables: {},
      },
    );

    const result = await loadWorkflowByIdFromDisk("review-flow", {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.workflowName).toBe("review-flow-bundle");
    expect(result.value.bundle.workflow.workflowId).toBe("review-flow");
  });

  test("surfaces validation failures for workflow ids found under a different directory name", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "review-flow-bundle");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "review-flow",
      description: "invalid review workflow",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      entryNodeId: "reviewer",
      nodes: [
        {
          id: "reviewer",
          role: "worker",
          nodeFile: "nodes/node-reviewer.json",
        },
      ],
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-reviewer.json"),
      {
        id: "reviewer",
        executionBackend: "codex-agent",
        model: "gpt-5",
        variables: {},
      },
    );

    const result = await loadWorkflowByIdFromDisk("review-flow", {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.message).toContain("workflow validation failed");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "nodePayloads.nodes/node-reviewer.json.promptTemplate",
        }),
      ]),
    );
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

    await writeJson(path.join(workflowDirectory, "node-divedra-manager.json"), {
      id: "divedra-manager",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplateFile: "workflow.json",
      variables: {},
    });

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
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

  test("rejects promptTemplateFile values that target nested canonical node payload files", async () => {
    const root = await makeTempDir();
    const workflowName = "invalid-nested-prompt-file-workflow";
    const workflowDirectory = path.join(root, workflowName);
    await mkdir(workflowDirectory, { recursive: true });
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: workflowName,
      description: "sample",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      managerNodeId: "divedra-manager",
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

    await writeJson(
      path.join(workflowDirectory, "nodes", "node-divedra-manager.json"),
      {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplateFile: "nodes/node-divedra-manager.json",
        variables: {},
      },
    );

    const result = await loadWorkflowFromDisk(workflowName, {
      ...testLegacyAuthorshipOk,
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
