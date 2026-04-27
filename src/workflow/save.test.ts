import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowTemplate } from "./create";
import { loadWorkflowFromDisk } from "./load";
import {
  collectPromptTemplateFiles,
  computeWorkflowRevisionFromFiles,
} from "./revision";
import { saveWorkflowToDisk } from "./save";
import {
  getLegacyAuthoredEdges,
  getLegacyAuthoredLoops,
  getStructuralEdges,
  resolveWorkflowEntryRuntimeId,
  resolveWorkflowManagerRuntimeId,
  type LoadOptions,
} from "./types";
import { REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE } from "./validate";

const testLegacyAuthorshipOk: Pick<
  LoadOptions,
  "rejectLegacyWorkflowAuthoring"
> = { rejectLegacyWorkflowAuthoring: false };

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-save-test-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(`${filePath}`, `${JSON.stringify(payload, null, 2)}\n`);
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("saveWorkflowToDisk", () => {
  test("preserves role-based authored workflow shape for managed templates", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(
      getLegacyAuthoredEdges(loaded.value.bundle.workflow),
    ).toBeUndefined();

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(root, "demo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"hasManagerNode"');
    expect(workflowJsonText).not.toContain('"entryNodeId"');
    expect(workflowJsonText).not.toContain('"kind"');
    expect(workflowJsonText).toContain('"role": "manager"');
    expect(workflowJsonText).toContain('"role": "worker"');
    expect(workflowJsonText).not.toContain('"subWorkflows"');
    expect(workflowJsonText).not.toContain('"edges"');
    expect(workflowJsonText).not.toContain('"loops"');
    expect(workflowJsonText).not.toContain('"branching"');
    expect(workflowJsonText).not.toContain('"containerRuntime"');
    expect(workflowJsonText).not.toContain('"completion"');
  });

  test("does not persist derived managerType defaults when re-saving loaded managed templates", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    expect(loaded.value.bundle.nodePayloads["divedra-manager"]).toMatchObject({
      managerType: "code",
    });

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const managerNodeText = await readFile(
      path.join(root, "demo", "nodes", "node-divedra-manager.json"),
      "utf8",
    );
    expect(managerNodeText).not.toContain('"managerType"');
    expect(managerNodeText).not.toContain('"executionBackend"');
    expect(managerNodeText).not.toContain('"model"');

    const reloaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(reloaded.value.bundle.nodePayloads["divedra-manager"]).toMatchObject(
      {
        managerType: "code",
      },
    );
    expect(
      reloaded.value.bundle.nodePayloads["nodes/node-divedra-manager.json"],
    ).not.toHaveProperty("managerType");
  });

  test("keeps worker-only workflows authored without compatibility manager fields on save", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("solo", {
      workflowRoot: root,
      templateMode: "worker-only",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("solo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saveResult = await saveWorkflowToDisk(
      "solo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(root, "solo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"hasManagerNode"');
    expect(workflowJsonText).not.toContain('"managerNodeId"');
    expect(workflowJsonText).not.toContain('"entryNodeId"');
    expect(workflowJsonText).not.toContain('"kind"');
    expect(workflowJsonText).toContain('"entryStepId": "main-worker"');
    expect(workflowJsonText).toContain('"steps"');
    expect(workflowJsonText).toContain('"role": "worker"');
    expect(workflowJsonText).not.toContain('"subWorkflows"');
    expect(workflowJsonText).not.toContain('"edges"');
    expect(workflowJsonText).not.toContain('"loops"');
    expect(workflowJsonText).not.toContain('"branching"');
    expect(workflowJsonText).not.toContain('"containerRuntime"');
    expect(workflowJsonText).not.toContain('"completion"');

    const reloaded = await loadWorkflowFromDisk("solo", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(reloaded.value.bundle.workflow.hasManagerNode).toBe(false);
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "managerNodeId"
      ],
    ).toBeUndefined();
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "entryNodeId"
      ],
    ).toBeUndefined();
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "branching"
      ],
    ).toBeUndefined();
  });

  test("preserves authored add-on node refs without writing generated node payloads", async () => {
    const root = await makeTempDir();
    const workflowDir = path.join(root, "chat-reply");
    await mkdir(path.join(workflowDir, "nodes"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "workflow.json"),
      `${JSON.stringify(
        {
          workflowId: "chat-reply",
          description: "Reply to chat",
          defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
          nodes: [
            {
              id: "answer",
              role: "worker",
              nodeFile: "nodes/node-answer.json",
            },
            {
              id: "reply",
              role: "worker",
              addon: {
                name: "divedra/chat-reply-worker",
                version: "1",
                config: {
                  textTemplate: "{{inbox.latest.output.payload.text}}",
                  onMissingTarget: "intent-only",
                },
                inputs: {
                  prefix: "Result",
                },
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(workflowDir, "nodes", "node-answer.json"),
      `${JSON.stringify(
        {
          id: "answer",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "Answer the chat request",
          variables: {},
          output: { description: "Answer payload" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const loaded = await loadWorkflowFromDisk("chat-reply", {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saveResult = await saveWorkflowToDisk(
      "chat-reply",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      { ...testLegacyAuthorshipOk, workflowRoot: root },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(workflowDir, "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).toContain('"addon"');
    expect(workflowJsonText).toContain('"divedra/chat-reply-worker"');
    expect(workflowJsonText).toContain('"inputs"');
    expect(workflowJsonText).toContain('"prefix": "Result"');
    expect(workflowJsonText).not.toContain(
      '"nodeFile": "nodes/node-reply.json"',
    );
    await expect(
      readFile(path.join(workflowDir, "nodes", "node-reply.json"), "utf8"),
    ).rejects.toThrow();
  });

  test("does not leak derived role fields when re-saving legacy kind-authored workflows", async () => {
    const root = await makeTempDir();
    const workflowDir = path.join(root, "legacy-demo");
    await mkdir(path.join(workflowDir, "nodes"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "workflow.json"),
      `${JSON.stringify(
        {
          workflowId: "legacy-demo",
          description: "Legacy workflow",
          defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
          nodes: [
            {
              id: "divedra-manager",
              kind: "root-manager",
              nodeFile: "nodes/node-divedra-manager.json",
            },
            {
              id: "main-worker",
              kind: "task",
              nodeFile: "nodes/node-main-worker.json",
            },
          ],
          edges: [
            { from: "divedra-manager", to: "main-worker", when: "always" },
          ],
          loops: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(workflowDir, "nodes", "node-divedra-manager.json"),
      `${JSON.stringify(
        {
          id: "divedra-manager",
          executionBackend: "claude-code-agent",
          model: "claude-opus-4-1",
          promptTemplate: "Coordinate the workflow",
          variables: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(workflowDir, "nodes", "node-main-worker.json"),
      `${JSON.stringify(
        {
          id: "main-worker",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "Do the work",
          variables: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const loaded = await loadWorkflowFromDisk("legacy-demo", {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saveResult = await saveWorkflowToDisk(
      "legacy-demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        ...testLegacyAuthorshipOk,
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(workflowDir, "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).toContain('"kind": "root-manager"');
    expect(workflowJsonText).toContain('"kind": "task"');
    expect(workflowJsonText).not.toContain('"role": "manager"');
    expect(workflowJsonText).not.toContain('"role": "worker"');
  });

  test("allows existing legacy kind-authored workflows to migrate to role-authored nodes on save", async () => {
    const root = await makeTempDir();
    const workflowDir = path.join(root, "legacy-demo");
    await mkdir(path.join(workflowDir, "nodes"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "workflow.json"),
      `${JSON.stringify(
        {
          workflowId: "legacy-demo",
          description: "Legacy workflow",
          defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
          nodes: [
            {
              id: "divedra-manager",
              kind: "root-manager",
              nodeFile: "nodes/node-divedra-manager.json",
            },
            {
              id: "main-worker",
              kind: "task",
              nodeFile: "nodes/node-main-worker.json",
            },
          ],
          edges: [
            { from: "divedra-manager", to: "main-worker", when: "always" },
          ],
          loops: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(workflowDir, "nodes", "node-divedra-manager.json"),
      `${JSON.stringify(
        {
          id: "divedra-manager",
          executionBackend: "claude-code-agent",
          model: "claude-opus-4-1",
          promptTemplate: "Coordinate the workflow",
          variables: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(workflowDir, "nodes", "node-main-worker.json"),
      `${JSON.stringify(
        {
          id: "main-worker",
          executionBackend: "codex-agent",
          model: "gpt-5-nano",
          promptTemplate: "Do the work",
          variables: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const loaded = await loadWorkflowFromDisk("legacy-demo", {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const migratedWorkflow = {
      ...loaded.value.bundle.workflow,
      nodes: [
        {
          id: "divedra-manager",
          role: "manager",
          nodeFile: "nodes/node-divedra-manager.json",
        },
        {
          id: "main-worker",
          role: "worker",
          nodeFile: "nodes/node-main-worker.json",
        },
      ],
    } as Record<string, unknown>;
    delete migratedWorkflow["edges"];
    delete migratedWorkflow["loops"];
    delete migratedWorkflow["branching"];

    const saveResult = await saveWorkflowToDisk(
      "legacy-demo",
      {
        workflow: migratedWorkflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        ...testLegacyAuthorshipOk,
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(workflowDir, "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"kind": "root-manager"');
    expect(workflowJsonText).not.toContain('"kind": "task"');
    expect(workflowJsonText).toContain('"role": "manager"');
    expect(workflowJsonText).toContain('"role": "worker"');
    expect(workflowJsonText).not.toContain('"managerNodeId"');
    expect(workflowJsonText).not.toContain('"entryNodeId"');
  });

  test("applies incoming workflow edits for existing workflows while preserving authored-minimal omissions", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          description: "Updated through save",
          defaults: {
            ...loaded.value.bundle.workflow.defaults,
            containerRuntime: { runnerKind: "docker" },
          },
        },
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJson = JSON.parse(
      await readFile(path.join(root, "demo", "workflow.json"), "utf8"),
    ) as {
      readonly description?: string;
      readonly managerStepId?: string;
      readonly edges?: unknown;
      readonly branching?: unknown;
      readonly defaults: {
        readonly containerRuntime?: {
          readonly runnerKind?: string;
        };
      };
    };

    expect(workflowJson.description).toBe("Updated through save");
    expect(workflowJson.defaults.containerRuntime).toEqual({
      runnerKind: "docker",
    });
    expect(workflowJson.managerStepId).toBe("divedra-manager");
    expect(workflowJson.edges).toBeUndefined();
    expect(workflowJson.branching).toBeUndefined();
  });

  test("removes containerRuntime when an existing workflow is reset to the default podman runtime", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const savedWithDocker = await saveWorkflowToDisk(
      "demo",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          defaults: {
            ...loaded.value.bundle.workflow.defaults,
            containerRuntime: { runnerKind: "docker" },
          },
        },
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(savedWithDocker.ok).toBe(true);
    if (!savedWithDocker.ok) {
      return;
    }

    const reloaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    const savedWithDefaultPodman = await saveWorkflowToDisk(
      "demo",
      {
        workflow: {
          ...reloaded.value.bundle.workflow,
          defaults: {
            ...reloaded.value.bundle.workflow.defaults,
            containerRuntime: { runnerKind: "podman" },
          },
        },
        nodePayloads: reloaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(savedWithDefaultPodman.ok).toBe(true);
    if (!savedWithDefaultPodman.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(root, "demo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"containerRuntime"');
  });

  test("allows existing managed workflows to be converted to worker-only on save", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const workerNode = loaded.value.bundle.workflow.nodes.find(
      (node) => node.id === "main-worker",
    );
    expect(workerNode).toBeDefined();
    if (workerNode === undefined) {
      return;
    }
    const workerRegistryNode =
      loaded.value.bundle.workflow.nodeRegistry?.find(
        (node) => node.id === "main-worker",
      ) ?? workerNode;

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          hasManagerNode: false,
          managerStepId: undefined,
          entryStepId: "main-worker",
          nodeRegistry: [
            {
              id: workerRegistryNode.id,
              nodeFile: workerRegistryNode.nodeFile,
            },
          ],
          steps: [
            {
              id: "main-worker",
              nodeId: "main-worker",
              role: "worker",
            },
          ],
          nodes: [
            {
              ...workerNode,
              role: "worker",
            },
          ],
        },
        nodePayloads: {
          [workerNode.id]: loaded.value.bundle.nodePayloads[workerNode.id],
        },
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(root, "demo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerNodeId"');
    expect(workflowJsonText).not.toContain('"managerStepId"');
    expect(workflowJsonText).toContain('"entryStepId": "main-worker"');
    expect(workflowJsonText).toContain('"role": "worker"');
    expect(workflowJsonText).not.toContain('"role": "manager"');

    const reloaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(reloaded.value.bundle.workflow.hasManagerNode).toBe(false);
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "managerNodeId"
      ],
    ).toBeUndefined();
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "entryNodeId"
      ],
    ).toBeUndefined();
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "branching"
      ],
    ).toBeUndefined();
    expect(reloaded.value.bundle.workflow.nodes).toHaveLength(1);
    expect(reloaded.value.bundle.workflow.nodes[0]?.id).toBe("main-worker");
  });

  test("allows managed-to-worker-only conversions to succeed with expectedRevision", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const expectedRevision = await computeWorkflowRevisionFromFiles(
      loaded.value.workflowDirectory,
      (
        loaded.value.bundle.workflow.nodeRegistry ??
        loaded.value.bundle.workflow.nodes
      ).flatMap((node) =>
        "nodeFile" in node && typeof node.nodeFile === "string"
          ? [node.nodeFile]
          : [],
      ),
      collectPromptTemplateFiles(loaded.value.bundle.nodePayloads),
    );
    expect(expectedRevision.ok).toBe(true);
    if (!expectedRevision.ok) {
      return;
    }

    const workerNode = loaded.value.bundle.workflow.nodes.find(
      (node) => node.id === "main-worker",
    );
    expect(workerNode).toBeDefined();
    if (workerNode === undefined) {
      return;
    }
    const workerRegistryNode =
      loaded.value.bundle.workflow.nodeRegistry?.find(
        (node) => node.id === "main-worker",
      ) ?? workerNode;

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          hasManagerNode: false,
          managerStepId: undefined,
          entryStepId: "main-worker",
          nodeRegistry: [
            {
              id: workerRegistryNode.id,
              nodeFile: workerRegistryNode.nodeFile,
            },
          ],
          steps: [
            {
              id: "main-worker",
              nodeId: "main-worker",
              role: "worker",
            },
          ],
          nodes: [
            {
              ...workerNode,
              role: "worker",
            },
          ],
        },
        nodePayloads: {
          [workerNode.id]: loaded.value.bundle.nodePayloads[workerNode.id],
        },
        expectedRevision: expectedRevision.value,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const reloaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(reloaded.value.bundle.workflow.hasManagerNode).toBe(false);
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "managerNodeId"
      ],
    ).toBeUndefined();
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "entryNodeId"
      ],
    ).toBeUndefined();
  });

  test("removes stale node and prompt files when workflows drop authored nodes", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const workerNode = loaded.value.bundle.workflow.nodes.find(
      (node) => node.id === "main-worker",
    );
    expect(workerNode).toBeDefined();
    if (workerNode === undefined) {
      return;
    }
    const workerRegistryNode =
      loaded.value.bundle.workflow.nodeRegistry?.find(
        (node) => node.id === "main-worker",
      ) ?? workerNode;

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          hasManagerNode: false,
          managerStepId: undefined,
          entryStepId: "main-worker",
          nodeRegistry: [
            {
              id: workerRegistryNode.id,
              nodeFile: workerRegistryNode.nodeFile,
            },
          ],
          steps: [
            {
              id: "main-worker",
              nodeId: "main-worker",
              role: "worker",
            },
          ],
          nodes: [
            {
              ...workerNode,
              role: "worker",
            },
          ],
        },
        nodePayloads: {
          [workerNode.id]: loaded.value.bundle.nodePayloads[workerNode.id],
        },
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    await expect(
      readFile(
        path.join(root, "demo", "nodes", "node-divedra-manager.json"),
        "utf8",
      ),
    ).rejects.toThrow(/ENOENT/u);
    await expect(
      readFile(
        path.join(root, "demo", "prompts", "divedra-manager.md"),
        "utf8",
      ),
    ).rejects.toThrow(/ENOENT/u);

    const workerPromptText = await readFile(
      path.join(root, "demo", "prompts", "main-worker.md"),
      "utf8",
    );
    expect(workerPromptText).toContain("Complete the assigned workflow step");
  });

  test("removes stale prompt template files when an existing node changes template file paths", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const updatedNodePayloads = {
      ...loaded.value.bundle.nodePayloads,
      "divedra-manager": {
        ...loaded.value.bundle.nodePayloads["divedra-manager"],
        promptTemplateFile: "prompts/renamed-manager.md",
        promptTemplate: "Updated manager prompt after template rename",
      },
    };

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: updatedNodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    await expect(
      readFile(
        path.join(root, "demo", "prompts", "divedra-manager.md"),
        "utf8",
      ),
    ).rejects.toThrow(/ENOENT/u);

    const renamedPromptText = await readFile(
      path.join(root, "demo", "prompts", "renamed-manager.md"),
      "utf8",
    );
    expect(renamedPromptText).toBe(
      "Updated manager prompt after template rename\n",
    );

    const nodeJsonRaw = await readFile(
      path.join(root, "demo", "nodes", "node-divedra-manager.json"),
      "utf8",
    );
    expect(nodeJsonRaw).toContain(
      '"promptTemplateFile": "prompts/renamed-manager.md"',
    );
  });

  test("preserves file-backed step definitions when saving step-addressed workflows", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "step-save-demo");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await mkdir(path.join(workflowDirectory, "steps"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "step-save-demo",
      description: "step save demo",
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

    const loaded = await loadWorkflowFromDisk("step-save-demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saveResult = await saveWorkflowToDisk(
      "step-save-demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(workflowDirectory, "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).toContain('"stepFile": "steps/step-manager.json"');
    expect(workflowJsonText).toContain('"stepFile": "steps/step-review.json"');
    expect(workflowJsonText).not.toContain('"nodeId": "manager-node"');
    expect(workflowJsonText).not.toContain('"nodeId": "coder-node"');

    const reviewStepText = await readFile(
      path.join(workflowDirectory, "steps", "step-review.json"),
      "utf8",
    );
    expect(reviewStepText).toContain('"nodeId": "coder-node"');
    expect(reviewStepText).toContain('"promptVariant": "self-review"');

    const managerNodeText = await readFile(
      path.join(workflowDirectory, "nodes", "node-manager.json"),
      "utf8",
    );
    expect(managerNodeText).not.toContain('"executionBackend"');
    expect(managerNodeText).not.toContain('"promptTemplate"');

    const strictReloaded = await loadWorkflowFromDisk("step-save-demo", {
      workflowRoot: root,
      rejectLegacyWorkflowAuthoring: true,
    });
    expect(strictReloaded.ok).toBe(true);

    const invalidStepAddressedSave = await saveWorkflowToDisk(
      "step-save-demo",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          entryStepId: undefined,
          entryNodeId: "manager-node",
        },
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(invalidStepAddressedSave.ok).toBe(false);
    if (invalidStepAddressedSave.ok) {
      return;
    }

    expect(invalidStepAddressedSave.error.code).toBe("VALIDATION");
    expect(invalidStepAddressedSave.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.entryNodeId",
          message: "is not part of the step-addressed workflow schema",
        }),
        expect.objectContaining({
          path: "workflow.entryStepId",
          message: "must be a non-empty string",
        }),
      ]),
    );
  });

  test("rejects save when step-addressed input still carries top-level workflowCalls by presence", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("step-workflow-calls", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("step-workflow-calls", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saveResult = await saveWorkflowToDisk(
      "step-workflow-calls",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          workflowCalls: {
            id: "legacy-call",
          },
        },
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message: "is not part of the step-addressed workflow schema",
        }),
      ]),
    );
  });

  test("rejects save when step-addressed input carries stale top-level edges that diverge from the step graph", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("step-legacy-edges", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("step-legacy-edges", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saveResult = await saveWorkflowToDisk(
      "step-legacy-edges",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          edges: [
            {
              from: "main-worker",
              to: "divedra-manager",
              when: "always",
            },
          ],
        },
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.edges",
          message:
            "is not part of the step-addressed workflow schema; local step-to-step routing must be authored on workflow.steps[].transitions",
        }),
      ]),
    );
  });

  test("rejects step-addressed legacy edges on save even when they match local transitions", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("step-matching-legacy-edges", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("step-matching-legacy-edges", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saveResult = await saveWorkflowToDisk(
      "step-matching-legacy-edges",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          edges: [
            { from: "divedra-manager", to: "main-worker", when: "always" },
          ],
        },
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.edges",
          message:
            "is not part of the step-addressed workflow schema; local step-to-step routing must be authored on workflow.steps[].transitions",
        }),
      ]),
    );
  });

  test("rejects legacy authored workflows on save when strict authored-schema mode is enabled", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "legacy-strict-save",
      {
        workflow: {
          workflowId: "legacy-strict-save",
          description: "legacy authored workflow",
          defaults: {
            nodeTimeoutMs: 120000,
          },
          nodes: [
            {
              id: "divedra-manager",
              role: "manager",
              nodeFile: "nodes/node-manager.json",
            },
            {
              id: "worker-1",
              role: "worker",
              nodeFile: "nodes/node-worker-1.json",
            },
          ],
          edges: [{ from: "divedra-manager", to: "worker-1", when: "always" }],
          loops: [],
        },
        nodePayloads: {
          "nodes/node-manager.json": {
            id: "divedra-manager",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "manager",
            variables: {},
          },
          "nodes/node-worker-1.json": {
            id: "worker-1",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "worker",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: true,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.entryStepId",
          message: "must be a non-empty string",
        }),
        expect.objectContaining({
          path: "workflow.steps",
          message: "must be an array",
        }),
      ]),
    );
  });

  test("rejects save when authored workflowCalls are present", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "legacy-workflow-call-step-id",
      {
        workflow: {
          workflowId: "legacy-workflow-call-step-id",
          description: "legacy workflow-call fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          workflowCalls: [
            {
              id: "call-review",
              workflowId: "review-flow",
              callerNodeId: "writer",
              callerStepId: "writer",
            },
          ],
          nodes: [
            {
              id: "writer",
              kind: "task",
              nodeFile: "nodes/node-writer.json",
              completion: { type: "none" },
            },
          ],
          edges: [],
        },
        nodePayloads: {
          "nodes/node-writer.json": {
            id: "writer",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "writer",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message:
            "authored workflowCalls are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
    expect(
      saveResult.error.issues?.some(
        (issue) => issue.path === "workflow.workflowCalls[0].callerStepId",
      ),
    ).toBe(false);
  });

  test("rejects save when role-authored bundles declare non-empty workflowCalls", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "role-workflow-call-authored",
      {
        workflow: {
          workflowId: "role-workflow-call-authored",
          description: "legacy workflow-call fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
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
              nodeFile: "nodes/node-writer.json",
              completion: { type: "none" },
            },
          ],
          edges: [],
        },
        nodePayloads: {
          "nodes/node-writer.json": {
            id: "writer",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "writer",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message:
            "authored workflowCalls are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
  });

  test("rejects save when role-authored bundles declare empty workflowCalls", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "role-workflow-call-authored-empty",
      {
        workflow: {
          workflowId: "role-workflow-call-authored-empty",
          description: "legacy workflow-call fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          workflowCalls: [],
          nodes: [
            {
              id: "writer",
              role: "worker",
              nodeFile: "nodes/node-writer.json",
              completion: { type: "none" },
            },
          ],
          edges: [],
        },
        nodePayloads: {
          "nodes/node-writer.json": {
            id: "writer",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "writer",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message:
            "authored workflowCalls are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
  });

  test("rejects role-authored workflowCalls on save by top-level presence without traversing legacy call-entry validation", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "role-workflow-call-authored-step-id",
      {
        workflow: {
          workflowId: "role-workflow-call-authored-step-id",
          description: "legacy workflow-call fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          workflowCalls: [
            {
              id: "call-review",
              workflowId: "review-flow",
              callerNodeId: "writer",
              callerStepId: "writer",
            },
          ],
          nodes: [
            {
              id: "writer",
              role: "worker",
              nodeFile: "nodes/node-writer.json",
              completion: { type: "none" },
            },
          ],
          edges: [],
        },
        nodePayloads: {
          "nodes/node-writer.json": {
            id: "writer",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "writer",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message:
            "authored workflowCalls are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
    expect(
      saveResult.error.issues?.some(
        (issue) => issue.path === "workflow.workflowCalls[0].callerStepId",
      ),
    ).toBe(false);
  });

  test("rejects role-authored edges on save by top-level presence without traversing legacy edge validation", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "role-edges-authored",
      {
        workflow: {
          workflowId: "role-edges-authored",
          description: "legacy edges fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          edges: [{ from: "", to: 42, when: "" }],
          nodes: [
            {
              id: "writer",
              role: "worker",
              nodeFile: "nodes/node-writer.json",
              completion: { type: "none" },
            },
          ],
        },
        nodePayloads: {
          "nodes/node-writer.json": {
            id: "writer",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "writer",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.edges",
          message:
            "authored edges are legacy compatibility only and cannot be combined with authored role/control nodes",
        }),
      ]),
    );
    expect(
      saveResult.error.issues?.some((issue) =>
        issue.path.startsWith("workflow.edges[0]."),
      ),
    ).toBe(false);
  });

  test("rejects role-authored loops on save by top-level presence without traversing legacy loop validation", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "role-loops-authored",
      {
        workflow: {
          workflowId: "role-loops-authored",
          description: "legacy loops fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          loops: [
            {
              id: "",
              judgeNodeId: "",
              continueWhen: "",
              exitWhen: "",
            },
          ],
          nodes: [
            {
              id: "writer",
              role: "worker",
              nodeFile: "nodes/node-writer.json",
              completion: { type: "none" },
            },
          ],
        },
        nodePayloads: {
          "nodes/node-writer.json": {
            id: "writer",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "writer",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.loops",
          message:
            "authored loops are legacy compatibility only and cannot be combined with authored role/control nodes",
        }),
      ]),
    );
    expect(
      saveResult.error.issues?.some((issue) =>
        issue.path.startsWith("workflow.loops[0]."),
      ),
    ).toBe(false);
  });

  test("strips role-authored managerNodeId and entryNodeId on save before legacy manager-entry semantic checks can fire", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "role-manager-entry-legacy-aliases",
      {
        workflow: {
          workflowId: "role-manager-entry-legacy-aliases",
          description: "legacy manager-entry fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          managerNodeId: "missing-manager",
          entryNodeId: "missing-entry",
          nodes: [
            {
              id: "divedra-manager",
              role: "manager",
              nodeFile: "nodes/node-divedra-manager.json",
              completion: { type: "none" },
            },
          ],
        },
        nodePayloads: {
          "nodes/node-divedra-manager.json": {
            id: "divedra-manager",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "manager",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(root, "role-manager-entry-legacy-aliases", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerNodeId"');
    expect(workflowJsonText).not.toContain('"entryNodeId"');

    const reloaded = await loadWorkflowFromDisk(
      "role-manager-entry-legacy-aliases",
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(
      resolveWorkflowManagerRuntimeId(reloaded.value.bundle.workflow),
    ).toBe("divedra-manager");
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "entryNodeId"
      ],
    ).toBeUndefined();
  });

  test("rejects save when role-authored bundles declare empty structural subWorkflows", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "role-subworkflow-authored-empty",
      {
        workflow: {
          workflowId: "role-subworkflow-authored-empty",
          description: "legacy structural fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          subWorkflows: [],
          nodes: [
            {
              id: "writer",
              role: "worker",
              nodeFile: "nodes/node-writer.json",
              completion: { type: "none" },
            },
          ],
          edges: [],
        },
        nodePayloads: {
          "nodes/node-writer.json": {
            id: "writer",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "writer",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.subWorkflows",
          message:
            REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
        }),
      ]),
    );
  });

  test("rejects legacy node-graph save when raw input includes empty subWorkflows", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "legacy-empty-subworkflows-save",
      {
        workflow: {
          workflowId: "legacy-empty-subworkflows-save",
          description: "legacy graph with structural sub-workflow key",
          defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
          subWorkflows: [],
          nodes: [
            {
              id: "divedra-manager",
              kind: "root-manager",
              nodeFile: "nodes/node-divedra-manager.json",
              completion: { type: "none" },
            },
            {
              id: "main-worker",
              kind: "task",
              nodeFile: "nodes/node-main-worker.json",
              completion: { type: "none" },
            },
          ],
          edges: [
            { from: "divedra-manager", to: "main-worker", when: "always" },
          ],
        },
        nodePayloads: {
          "nodes/node-divedra-manager.json": {
            id: "divedra-manager",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "manager",
            variables: {},
          },
          "nodes/node-main-worker.json": {
            id: "main-worker",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "worker",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }
    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.subWorkflows",
          message:
            REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
        }),
      ]),
    );
  });

  test("rejects role-authored subWorkflows on save by top-level presence without traversing legacy subWorkflow entry validation", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "role-subworkflow-authored-present",
      {
        workflow: {
          workflowId: "role-subworkflow-authored-present",
          description: "legacy structural fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          subWorkflows: [
            {
              id: "legacy-lane",
              description: "legacy lane",
              managerNodeId: "",
              inputNodeId: "missing-input",
              outputNodeId: "missing-output",
              nodeIds: [],
              inputSources: [{ type: "not-a-real-source" }],
              block: { type: "not-a-real-block" },
            },
          ],
          nodes: [
            {
              id: "writer",
              role: "worker",
              nodeFile: "nodes/node-writer.json",
              completion: { type: "none" },
            },
          ],
          edges: [],
        },
        nodePayloads: {
          "nodes/node-writer.json": {
            id: "writer",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "writer",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.subWorkflows",
          message:
            REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
        }),
      ]),
    );
    expect(
      saveResult.error.issues?.some(
        (issue) =>
          issue.path.startsWith("workflow.subWorkflows[0].managerNodeId") ||
          issue.path.startsWith("workflow.subWorkflows[0].inputSources") ||
          issue.path.startsWith("workflow.subWorkflows[0].block"),
      ),
    ).toBe(false);
  });

  test("rejects save when role-authored bundles declare empty structural subWorkflowConversations", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "role-subworkflow-conversation-authored-empty",
      {
        workflow: {
          workflowId: "role-subworkflow-conversation-authored-empty",
          description: "legacy structural fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          subWorkflowConversations: [],
          nodes: [
            {
              id: "writer",
              role: "worker",
              nodeFile: "nodes/node-writer.json",
              completion: { type: "none" },
            },
          ],
          edges: [],
        },
        nodePayloads: {
          "nodes/node-writer.json": {
            id: "writer",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "writer",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.subWorkflowConversations",
          message:
            "authored subWorkflowConversations are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
  });

  test("rejects role-authored subWorkflowConversations on save by top-level presence without traversing legacy conversation entry validation", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "role-subworkflow-conversation-authored-present",
      {
        workflow: {
          workflowId: "role-subworkflow-conversation-authored-present",
          description: "legacy structural fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          subWorkflowConversations: [
            {
              id: "legacy-conversation",
              participants: ["only-one"],
              maxTurns: 0,
              stopWhen: "",
              conversationPolicy: "unsupported",
            },
          ],
          nodes: [
            {
              id: "writer",
              role: "worker",
              nodeFile: "nodes/node-writer.json",
              completion: { type: "none" },
            },
          ],
          edges: [],
        },
        nodePayloads: {
          "nodes/node-writer.json": {
            id: "writer",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "writer",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.subWorkflowConversations",
          message:
            "authored subWorkflowConversations are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
    expect(
      saveResult.error.issues?.some(
        (issue) =>
          issue.path.startsWith(
            "workflow.subWorkflowConversations[0].participants",
          ) ||
          issue.path.startsWith(
            "workflow.subWorkflowConversations[0].conversationPolicy",
          ) ||
          issue.path === "workflow.subWorkflowConversations[0].maxTurns" ||
          issue.path === "workflow.subWorkflowConversations[0].stopWhen",
      ),
    ).toBe(false);
  });

  test("rejects role-authored legacy structural fields on save by top-level presence even when authored with invalid non-array values", async () => {
    const cases = [
      {
        name: "workflow-call",
        field: "workflowCalls",
        value: { invalid: true },
        message:
          "authored workflowCalls are legacy compatibility only and are no longer supported",
      },
      {
        name: "edges",
        field: "edges",
        value: "invalid",
        message:
          "authored edges are legacy compatibility only and cannot be combined with authored role/control nodes",
      },
      {
        name: "loops",
        field: "loops",
        value: { invalid: true },
        message:
          "authored loops are legacy compatibility only and cannot be combined with authored role/control nodes",
      },
      {
        name: "subworkflow",
        field: "subWorkflows",
        value: "invalid",
        message:
          REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
      },
      {
        name: "subworkflow-conversation",
        field: "subWorkflowConversations",
        value: { invalid: true },
        message:
          "authored subWorkflowConversations are legacy compatibility only and are no longer supported",
      },
    ] as const;

    for (const entry of cases) {
      const root = await makeTempDir();
      const saveResult = await saveWorkflowToDisk(
        `${entry.name}-role-authored-non-array`,
        {
          workflow: {
            workflowId: `${entry.name}-role-authored-non-array`,
            description: "legacy structural fixture",
            defaults: {
              maxLoopIterations: 3,
              nodeTimeoutMs: 120000,
            },
            entryNodeId: "writer",
            [entry.field]: entry.value,
            nodes: [
              {
                id: "writer",
                role: "worker",
                nodeFile: "nodes/node-writer.json",
                completion: { type: "none" },
              },
            ],
          },
          nodePayloads: {
            "nodes/node-writer.json": {
              id: "writer",
              executionBackend: "codex-agent",
              model: "gpt-5-nano",
              promptTemplate: "writer",
              variables: {},
            },
          },
        },
        {
          workflowRoot: root,
          rejectLegacyWorkflowAuthoring: false,
        },
      );
      expect(saveResult.ok).toBe(false);
      if (saveResult.ok) {
        continue;
      }

      expect(saveResult.error.code).toBe("VALIDATION");
      expect(saveResult.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: `workflow.${entry.field}`,
            message: entry.message,
          }),
        ]),
      );
      expect(
        saveResult.error.issues?.some(
          (issue) =>
            issue.path === `workflow.${entry.field}` &&
            issue.message === "must be an array when provided",
        ),
      ).toBe(false);
    }
  });

  test("rejects authored branching on save", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "branching-authored",
      {
        workflow: {
          workflowId: "branching-authored",
          description: "legacy branching fixture",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          branching: { mode: "fan-out" },
          nodes: [
            {
              id: "writer",
              kind: "root-manager",
              nodeFile: "nodes/node-writer.json",
              completion: { type: "none" },
            },
          ],
          edges: [],
        },
        nodePayloads: {
          "nodes/node-writer.json": {
            id: "writer",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "writer",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }

    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.branching",
          message:
            "authored branching is legacy compatibility only and is no longer supported",
        }),
      ]),
    );
    expect(
      saveResult.error.issues?.some(
        (issue) => issue.path === "workflow.branching.mode",
      ),
    ).toBe(false);
  });

  test("rejects legacy workflows that still carry authored workflowCalls when re-saving", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "legacy-empty-workflow-calls");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "legacy-empty-workflow-calls",
      description: "legacy workflow with empty workflowCalls",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      workflowCalls: [],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "nodes/node-divedra-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-divedra-manager.json"),
      {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
    );

    const loaded = await loadWorkflowFromDisk("legacy-empty-workflow-calls", {
      workflowRoot: root,
      rejectLegacyWorkflowAuthoring: false,
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) {
      return;
    }
    expect(loaded.error.code).toBe("VALIDATION");
    expect(loaded.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.workflowCalls",
          message:
            "authored workflowCalls are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
  });

  test("rejects legacy workflows that still carry authored subWorkflows when re-saving", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "legacy-authored-subworkflows");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "legacy-authored-subworkflows",
      description: "legacy workflow with authored structural sub-workflows",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      subWorkflows: [
        {
          id: "review-lane",
          description: "review lane",
          managerNodeId: "review-manager",
          inputNodeId: "review-input",
          outputNodeId: "review-output",
          nodeIds: ["review-manager", "review-input", "review-output"],
          inputSources: [{ type: "human-input" }],
        },
      ],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "nodes/node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "review-manager",
          kind: "task",
          nodeFile: "nodes/node-review-manager.json",
          completion: { type: "none" },
        },
        {
          id: "review-input",
          kind: "input",
          nodeFile: "nodes/node-review-input.json",
          completion: { type: "none" },
        },
        {
          id: "review-output",
          kind: "output",
          nodeFile: "nodes/node-review-output.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-divedra-manager.json"),
      {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
    );
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-review-manager.json"),
      {
        id: "review-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "review-manager",
        variables: {},
      },
    );
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-review-input.json"),
      {
        id: "review-input",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "review-input",
        variables: {},
      },
    );
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-review-output.json"),
      {
        id: "review-output",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "review-output",
        variables: {},
      },
    );

    const loaded = await loadWorkflowFromDisk("legacy-authored-subworkflows", {
      workflowRoot: root,
      rejectLegacyWorkflowAuthoring: false,
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) {
      return;
    }
    expect(loaded.error.code).toBe("VALIDATION");
    expect(loaded.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.subWorkflows",
          message:
            REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
        }),
      ]),
    );
  });

  test("rejects save when legacy workflows author subWorkflows without traversing legacy subWorkflow entry validation", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(
      root,
      "legacy-authored-subworkflows-invalid-entry",
    );
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "legacy-authored-subworkflows-invalid-entry",
      description:
        "legacy workflow with invalid authored structural sub-workflows",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      subWorkflows: [
        {
          id: "review-lane",
          description: "review lane",
          managerNodeId: "",
          inputNodeId: "missing-input",
          outputNodeId: "missing-output",
          nodeIds: [],
          inputSources: [{ type: "not-a-real-source" }],
          block: { type: "not-a-real-block" },
        },
      ],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "nodes/node-divedra-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-divedra-manager.json"),
      {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
    );

    const loaded = await loadWorkflowFromDisk(
      "legacy-authored-subworkflows-invalid-entry",
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(loaded.ok).toBe(false);
    if (loaded.ok) {
      return;
    }
    expect(loaded.error.code).toBe("VALIDATION");
    expect(loaded.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.subWorkflows",
          message:
            REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
        }),
      ]),
    );
    expect(
      loaded.error.issues?.some(
        (issue) =>
          issue.path.startsWith("workflow.subWorkflows[0].managerNodeId") ||
          issue.path.startsWith("workflow.subWorkflows[0].inputSources") ||
          issue.path.startsWith("workflow.subWorkflows[0].block"),
      ),
    ).toBe(false);
  });

  test("rejects save when legacy workflows still author subWorkflowConversations", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "legacy-empty-companions");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "legacy-empty-companions",
      description: "legacy workflow with empty compatibility companions",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      subWorkflowConversations: [
        {
          id: "conv-1",
          participantsIds: ["divedra-manager"],
          maxTurns: 1,
          stopWhen: "done",
        },
      ],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "nodes/node-divedra-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-divedra-manager.json"),
      {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
    );

    const saveResult = await saveWorkflowToDisk(
      "legacy-empty-companions",
      {
        workflow: JSON.parse(
          await readFile(path.join(workflowDirectory, "workflow.json"), "utf8"),
        ) as Record<string, unknown>,
        nodePayloads: {
          "nodes/node-divedra-manager.json": {
            id: "divedra-manager",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "manager",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }
    expect(saveResult.error.code).toBe("VALIDATION");
    expect(saveResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workflow.subWorkflowConversations",
          message:
            "authored subWorkflowConversations are legacy compatibility only and are no longer supported",
        }),
      ]),
    );
    expect(
      saveResult.error.issues?.some((issue) =>
        issue.path.startsWith("workflow.subWorkflowConversations[0]."),
      ),
    ).toBe(false);
  });

  test("drops authored empty loops when re-saving legacy workflows", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "legacy-empty-loops");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "legacy-empty-loops",
      description: "legacy workflow with empty loop companion",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      loops: [],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "nodes/node-divedra-manager.json",
          completion: { type: "none" },
        },
      ],
      edges: [],
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-divedra-manager.json"),
      {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
    );

    const loaded = await loadWorkflowFromDisk("legacy-empty-loops", {
      workflowRoot: root,
      rejectLegacyWorkflowAuthoring: false,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(
      getLegacyAuthoredLoops(loaded.value.bundle.workflow),
    ).toBeUndefined();

    const saveResult = await saveWorkflowToDisk(
      "legacy-empty-loops",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(workflowDirectory, "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"loops"');
  });

  test("drops no-op legacy compatibility companions when saving raw legacy workflow input over an existing bundle", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "legacy-raw-noop-companions");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    const rawWorkflow = {
      workflowId: "legacy-raw-noop-companions",
      description: "legacy workflow with no-op compatibility companions",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      workflowCalls: [],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "nodes/node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "main-worker",
          kind: "task",
          nodeFile: "nodes/node-main-worker.json",
          completion: { type: "none" },
        },
      ],
      edges: [{ from: "divedra-manager", to: "main-worker", when: "always" }],
      loops: [],
    };
    await writeJson(path.join(workflowDirectory, "workflow.json"), rawWorkflow);
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-divedra-manager.json"),
      {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
    );
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-main-worker.json"),
      {
        id: "main-worker",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "worker",
        variables: {},
      },
    );

    const saveResult = await saveWorkflowToDisk(
      "legacy-raw-noop-companions",
      {
        workflow: rawWorkflow,
        nodePayloads: {
          "nodes/node-divedra-manager.json": {
            id: "divedra-manager",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "manager",
            variables: {},
          },
          "nodes/node-main-worker.json": {
            id: "main-worker",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "worker",
            variables: {},
          },
        },
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(workflowDirectory, "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"workflowCalls"');
    expect(workflowJsonText).not.toContain('"subWorkflows"');
    expect(workflowJsonText).not.toContain('"subWorkflowConversations"');
    expect(workflowJsonText).not.toContain('"edges"');
    expect(workflowJsonText).not.toContain('"loops"');
    expect(workflowJsonText).not.toContain('"branching"');

    const reloaded = await loadWorkflowFromDisk("legacy-raw-noop-companions", {
      workflowRoot: root,
      rejectLegacyWorkflowAuthoring: false,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect("workflowCalls" in reloaded.value.bundle.workflow).toBe(false);
    expect("subWorkflows" in reloaded.value.bundle.workflow).toBe(false);
    expect(
      getLegacyAuthoredEdges(reloaded.value.bundle.workflow),
    ).toBeUndefined();
    expect(
      getLegacyAuthoredLoops(reloaded.value.bundle.workflow),
    ).toBeUndefined();
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "branching"
      ],
    ).toBeUndefined();
    expect(getStructuralEdges(reloaded.value.bundle.workflow)).toEqual([
      { from: "divedra-manager", to: "main-worker", when: "always" },
    ]);
  });

  test("does not re-author synthesized legacy edges when saving a loaded legacy bundle to a new workflow", async () => {
    const root = await makeTempDir();
    const sourceDirectory = path.join(root, "legacy-source");
    const copiedDirectory = path.join(root, "legacy-copy");
    await mkdir(path.join(sourceDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(sourceDirectory, "workflow.json"), {
      workflowId: "legacy-source",
      description: "legacy workflow source",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "nodes/node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "worker-1",
          kind: "task",
          nodeFile: "nodes/node-worker-1.json",
          completion: { type: "none" },
        },
      ],
      edges: [{ from: "divedra-manager", to: "worker-1", when: "always" }],
    });
    await writeJson(
      path.join(sourceDirectory, "nodes", "node-divedra-manager.json"),
      {
        id: "divedra-manager",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
    );
    await writeJson(path.join(sourceDirectory, "nodes", "node-worker-1.json"), {
      id: "worker-1",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "worker",
      variables: {},
    });

    const loaded = await loadWorkflowFromDisk("legacy-source", {
      workflowRoot: root,
      rejectLegacyWorkflowAuthoring: false,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saveResult = await saveWorkflowToDisk(
      "legacy-copy",
      {
        workflow: {
          ...loaded.value.bundle.workflow,
          workflowId: "legacy-copy",
        },
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(copiedDirectory, "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerNodeId"');
    expect(workflowJsonText).not.toContain('"entryNodeId"');
    expect(workflowJsonText).not.toContain('"edges"');
    expect(workflowJsonText).not.toContain('"branching"');

    const reloaded = await loadWorkflowFromDisk("legacy-copy", {
      workflowRoot: root,
      rejectLegacyWorkflowAuthoring: false,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(
      resolveWorkflowManagerRuntimeId(reloaded.value.bundle.workflow),
    ).toBe("divedra-manager");
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "managerNodeId"
      ],
    ).toBeUndefined();
    expect(
      getLegacyAuthoredEdges(reloaded.value.bundle.workflow),
    ).toBeUndefined();
    expect(getStructuralEdges(reloaded.value.bundle.workflow)).toEqual([
      { from: "divedra-manager", to: "worker-1", when: "always" },
    ]);
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "branching"
      ],
    ).toBeUndefined();
  });

  test("does not persist legacy entryNodeId on save; still resolves entry at runtime for manager-less bundles", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "legacy-managerless-save");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "legacy-managerless-save",
      description: "manager-less workflow source",
      defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
      nodes: [
        {
          id: "worker-1",
          role: "worker",
          nodeFile: "nodes/node-worker-1.json",
          completion: { type: "none" },
        },
      ],
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-worker-1.json"),
      {
        id: "worker-1",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "worker",
        variables: {},
      },
    );

    const loaded = await loadWorkflowFromDisk("legacy-managerless-save", {
      workflowRoot: root,
      rejectLegacyWorkflowAuthoring: false,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saveResult = await saveWorkflowToDisk(
      "legacy-managerless-save",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
        rejectLegacyWorkflowAuthoring: false,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(workflowDirectory, "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerNodeId"');
    expect(workflowJsonText).not.toContain('"entryNodeId"');
    expect(
      resolveWorkflowEntryRuntimeId(loaded.value.bundle.workflow),
    ).toBe("worker-1");
    const reloadedAgain = await loadWorkflowFromDisk("legacy-managerless-save", {
      workflowRoot: root,
      rejectLegacyWorkflowAuthoring: false,
    });
    expect(reloadedAgain.ok).toBe(true);
    if (!reloadedAgain.ok) {
      return;
    }
    expect(
      resolveWorkflowEntryRuntimeId(reloadedAgain.value.bundle.workflow),
    ).toBe("worker-1");
  });

  test("persists and cleans up prompt variant template files on save", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "variant-prompt-save");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await mkdir(path.join(workflowDirectory, "prompts"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "variant-prompt-save",
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
        },
      },
    });
    await writeFile(
      path.join(workflowDirectory, "prompts", "review.md"),
      "review v1\n",
      "utf8",
    );

    const loaded = await loadWorkflowFromDisk("variant-prompt-save", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const updatedNodePayloads = {
      ...loaded.value.bundle.nodePayloads,
      "coder-node": {
        ...loaded.value.bundle.nodePayloads["coder-node"],
        promptVariants: {
          "self-review": {
            promptTemplateFile: "prompts/review-renamed.md",
            promptTemplate: "review v2",
          },
        },
      },
    };

    const saveResult = await saveWorkflowToDisk(
      "variant-prompt-save",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: updatedNodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    await expect(
      readFile(path.join(workflowDirectory, "prompts", "review.md"), "utf8"),
    ).rejects.toThrow(/ENOENT/u);

    await expect(
      readFile(
        path.join(workflowDirectory, "prompts", "review-renamed.md"),
        "utf8",
      ),
    ).resolves.toBe("review v2\n");

    const nodeJsonRaw = await readFile(
      path.join(workflowDirectory, "nodes", "node-coder.json"),
      "utf8",
    );
    expect(nodeJsonRaw).toContain('"promptVariants"');
    expect(nodeJsonRaw).toContain(
      '"promptTemplateFile": "prompts/review-renamed.md"',
    );
    expect(nodeJsonRaw).not.toContain('"promptTemplate": "review v2"');
  });

  test("does not let a colliding step id overwrite the shared node payload on save", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "step-node-id-collision");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "step-node-id-collision",
      defaults: {
        nodeTimeoutMs: 120000,
      },
      entryStepId: "implement",
      nodes: [
        {
          id: "review",
          nodeFile: "nodes/node-review.json",
        },
      ],
      steps: [
        {
          id: "implement",
          nodeId: "review",
        },
        {
          id: "review",
          nodeId: "review",
          promptVariant: "self-review",
        },
      ],
    });
    await writeJson(path.join(workflowDirectory, "nodes", "node-review.json"), {
      id: "review",
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

    const loaded = await loadWorkflowFromDisk("step-node-id-collision", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    expect(loaded.value.bundle.nodePayloads["review"]?.promptTemplate).toBe(
      "review",
    );
    expect(
      loaded.value.bundle.nodePayloads["nodes/node-review.json"]
        ?.promptTemplate,
    ).toBe("implement");

    const saveResult = await saveWorkflowToDisk(
      "step-node-id-collision",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const nodeJsonRaw = await readFile(
      path.join(workflowDirectory, "nodes", "node-review.json"),
      "utf8",
    );
    expect(nodeJsonRaw).toContain('"promptTemplate": "implement"');
    expect(nodeJsonRaw).toContain('"promptVariants"');
    expect(nodeJsonRaw).toContain('"promptTemplate": "review"');

    const reloaded = await loadWorkflowFromDisk("step-node-id-collision", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(
      reloaded.value.bundle.nodePayloads["nodes/node-review.json"]
        ?.promptTemplate,
    ).toBe("implement");
    expect(reloaded.value.bundle.nodePayloads["review"]?.promptTemplate).toBe(
      "review",
    );
  });

  test("keeps managerStepId omitted when a single manager-role step already identifies the manager", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "implicit-manager-step");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeJson(path.join(workflowDirectory, "workflow.json"), {
      workflowId: "implicit-manager-step",
      description: "manager inferred from step role",
      defaults: {
        maxLoopIterations: 3,
        nodeTimeoutMs: 120000,
      },
      entryStepId: "manager",
      nodes: [
        {
          id: "manager-node",
          nodeFile: "nodes/node-manager.json",
        },
        {
          id: "worker-node",
          nodeFile: "nodes/node-worker.json",
        },
      ],
      steps: [
        {
          id: "manager",
          nodeId: "manager-node",
          role: "manager",
          transitions: [{ toStepId: "worker" }],
        },
        {
          id: "worker",
          nodeId: "worker-node",
        },
      ],
    });
    await writeJson(
      path.join(workflowDirectory, "nodes", "node-manager.json"),
      {
        id: "manager-node",
        variables: {},
      },
    );
    await writeJson(path.join(workflowDirectory, "nodes", "node-worker.json"), {
      id: "worker-node",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "Do the work",
      variables: {},
      output: { description: "Worker payload" },
    });

    const loaded = await loadWorkflowFromDisk("implicit-manager-step", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    expect(loaded.value.bundle.workflow.managerStepId).toBe("manager");

    const saveResult = await saveWorkflowToDisk(
      "implicit-manager-step",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonText = await readFile(
      path.join(workflowDirectory, "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerStepId"');
    expect(workflowJsonText).toContain('"entryStepId": "manager"');
    expect(workflowJsonText).toContain('"role": "manager"');

    const reloaded = await loadWorkflowFromDisk("implicit-manager-step", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(reloaded.value.bundle.workflow.managerStepId).toBe("manager");
    expect(reloaded.value.bundle.workflow.entryStepId).toBe("manager");
  });

  test("preserves omitted normalized workflow fields instead of leaking compatibility defaults on save", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "minimal-managed",
      {
        workflow: {
          workflowId: "minimal-managed",
          defaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          nodes: [
            {
              id: "divedra-manager",
              role: "manager",
              nodeFile: "nodes/node-divedra-manager.json",
            },
            {
              id: "decision",
              nodeFile: "nodes/node-decision.json",
              control: "branch-judge",
            },
            {
              id: "main-worker",
              role: "worker",
              nodeFile: "nodes/node-main-worker.json",
            },
          ],
        },
        nodePayloads: {
          "nodes/node-divedra-manager.json": {
            id: "divedra-manager",
            executionBackend: "claude-code-agent",
            model: "claude-opus-4-1",
            promptTemplate: "Coordinate the workflow",
            variables: {},
          },
          "nodes/node-decision.json": {
            id: "decision",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "Decide whether more work is needed",
            variables: {},
          },
          "nodes/node-main-worker.json": {
            id: "main-worker",
            executionBackend: "codex-agent",
            model: "gpt-5-nano",
            promptTemplate: "Do the work",
            variables: {},
          },
        },
      },
      {
        ...testLegacyAuthorshipOk,
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJson = JSON.parse(
      await readFile(
        path.join(root, "minimal-managed", "workflow.json"),
        "utf8",
      ),
    ) as {
      readonly defaults: Readonly<Record<string, unknown>>;
      readonly nodes: readonly Readonly<Record<string, unknown>>[];
      readonly description?: string;
      readonly managerNodeId?: string;
      readonly entryNodeId?: string;
      readonly edges?: unknown;
      readonly loops?: unknown;
      readonly branching?: unknown;
      readonly subWorkflows?: unknown;
      readonly subWorkflowConversations?: unknown;
      readonly workflowCalls?: unknown;
    };

    expect(workflowJson.description).toBeUndefined();
    expect(workflowJson.managerNodeId).toBeUndefined();
    expect(workflowJson.entryNodeId).toBeUndefined();
    expect(workflowJson.defaults["containerRuntime"]).toBeUndefined();
    expect(workflowJson.subWorkflows).toBeUndefined();
    expect(workflowJson.subWorkflowConversations).toBeUndefined();
    expect(workflowJson.workflowCalls).toBeUndefined();
    expect(workflowJson.edges).toBeUndefined();
    expect(workflowJson.loops).toBeUndefined();
    expect(workflowJson.branching).toBeUndefined();

    const savedManagerNode = workflowJson.nodes[0];
    const savedDecisionNode = workflowJson.nodes[1];
    expect(savedManagerNode).toMatchObject({
      id: "divedra-manager",
      role: "manager",
    });
    expect(savedDecisionNode?.["role"]).toBeUndefined();
    expect(savedDecisionNode).toMatchObject({
      id: "decision",
      control: "branch-judge",
    });

    const reloaded = await loadWorkflowFromDisk("minimal-managed", {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(
      resolveWorkflowManagerRuntimeId(reloaded.value.bundle.workflow),
    ).toBe("divedra-manager");
    expect(
      (reloaded.value.bundle.workflow as unknown as Record<string, unknown>)[
        "entryNodeId"
      ],
    ).toBeUndefined();
    expect(resolveWorkflowEntryRuntimeId(reloaded.value.bundle.workflow)).toBe(
      "divedra-manager",
    );
    expect(
      getLegacyAuthoredEdges(reloaded.value.bundle.workflow),
    ).toBeUndefined();
    expect(getStructuralEdges(reloaded.value.bundle.workflow)).toEqual([
      { from: "divedra-manager", to: "decision", when: "always" },
      { from: "decision", to: "main-worker", when: "always" },
    ]);
    expect(reloaded.value.bundle.workflow.nodes[1]).toMatchObject({
      id: "decision",
      role: "worker",
      control: "branch-judge",
    });
  });

  test("persists promptTemplate back to promptTemplateFile-backed prompt files", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const originalPayload = loaded.value.bundle.nodePayloads["divedra-manager"];
    expect(originalPayload?.promptTemplateFile).toBe(
      "prompts/divedra-manager.md",
    );

    const updatedNodePayloads = {
      ...loaded.value.bundle.nodePayloads,
      "divedra-manager": {
        ...originalPayload,
        promptTemplate: "Updated manager prompt from save path",
      },
    };

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: updatedNodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const promptFileText = await readFile(
      path.join(root, "demo", "prompts", "divedra-manager.md"),
      "utf8",
    );
    expect(promptFileText).toBe("Updated manager prompt from save path\n");

    const nodeJsonRaw = await readFile(
      path.join(root, "demo", "nodes", "node-divedra-manager.json"),
      "utf8",
    );
    expect(nodeJsonRaw).toContain(
      '"promptTemplateFile": "prompts/divedra-manager.md"',
    );
    expect(nodeJsonRaw).not.toContain('"promptTemplate":');

    const reloaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(
      reloaded.value.bundle.nodePayloads["divedra-manager"]?.promptTemplate,
    ).toBe("Updated manager prompt from save path\n");
  });

  test("reuses existing promptTemplateFile content when inline promptTemplate is omitted on save", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const originalPayload = loaded.value.bundle.nodePayloads["divedra-manager"];
    expect(originalPayload?.promptTemplateFile).toBe(
      "prompts/divedra-manager.md",
    );

    const strippedPromptPayload = {
      ...originalPayload,
    } as { promptTemplate?: string; [key: string]: unknown };
    delete strippedPromptPayload.promptTemplate;

    const updatedNodePayloads = {
      ...loaded.value.bundle.nodePayloads,
      "divedra-manager": strippedPromptPayload,
    };

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: updatedNodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const promptFileText = await readFile(
      path.join(root, "demo", "prompts", "divedra-manager.md"),
      "utf8",
    );
    expect(promptFileText).toBe(
      "Coordinate workflow execution for {{workflowId}}\n",
    );
  });

  test("persists system and session-start templates back to file-backed prompt fields", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const updatedNodePayloads = {
      ...loaded.value.bundle.nodePayloads,
      "divedra-manager": {
        ...loaded.value.bundle.nodePayloads["divedra-manager"],
        systemPromptTemplateFile: "prompts/divedra-manager-system.md",
        systemPromptTemplate: "Keep the manager role stable.",
        sessionStartPromptTemplateFile:
          "prompts/divedra-manager-session-start.md",
        sessionStartPromptTemplate: "## prompt\n{{prompt}}\n## args\n{{args}}",
      },
    };

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: updatedNodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const systemPromptText = await readFile(
      path.join(root, "demo", "prompts", "divedra-manager-system.md"),
      "utf8",
    );
    expect(systemPromptText).toBe("Keep the manager role stable.\n");

    const sessionStartPromptText = await readFile(
      path.join(root, "demo", "prompts", "divedra-manager-session-start.md"),
      "utf8",
    );
    expect(sessionStartPromptText).toBe(
      "## prompt\n{{prompt}}\n## args\n{{args}}\n",
    );

    const nodeJsonRaw = await readFile(
      path.join(root, "demo", "nodes", "node-divedra-manager.json"),
      "utf8",
    );
    expect(nodeJsonRaw).toContain(
      '"systemPromptTemplateFile": "prompts/divedra-manager-system.md"',
    );
    expect(nodeJsonRaw).toContain(
      '"sessionStartPromptTemplateFile": "prompts/divedra-manager-session-start.md"',
    );
    expect(nodeJsonRaw).not.toContain('"systemPromptTemplate":');
    expect(nodeJsonRaw).not.toContain('"sessionStartPromptTemplate":');

    const reloaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(
      reloaded.value.bundle.nodePayloads["divedra-manager"]
        ?.systemPromptTemplate,
    ).toBe("Keep the manager role stable.\n");
    expect(
      reloaded.value.bundle.nodePayloads["divedra-manager"]
        ?.sessionStartPromptTemplate,
    ).toBe("## prompt\n{{prompt}}\n## args\n{{args}}\n");
  });

  test("rejects promptTemplateFile values that would overwrite canonical workflow definition files on save", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const originalWorkflowJson = await readFile(
      path.join(root, "demo", "workflow.json"),
      "utf8",
    );

    const updatedNodePayloads = {
      ...loaded.value.bundle.nodePayloads,
      "divedra-manager": {
        ...loaded.value.bundle.nodePayloads["divedra-manager"],
        promptTemplateFile: "workflow.json",
        promptTemplate: "This must never replace workflow.json",
      },
    };

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: updatedNodePayloads,
      },
      {
        workflowRoot: root,
      },
    );

    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }
    expect(saveResult.error.code).toBe("VALIDATION");
    expect(
      saveResult.error.issues?.some(
        (issue) =>
          issue.path ===
            "nodePayloads.nodes/node-divedra-manager.json.promptTemplateFile" &&
          issue.message.includes(
            "must not target canonical workflow definition files",
          ),
      ),
    ).toBe(true);

    const workflowJsonAfter = await readFile(
      path.join(root, "demo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonAfter).toBe(originalWorkflowJson);
  });

  test("rejects promptTemplateFile values that would overwrite nested canonical node payload files on save", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const originalNodeJson = await readFile(
      path.join(root, "demo", "nodes", "node-divedra-manager.json"),
      "utf8",
    );

    const updatedNodePayloads = {
      ...loaded.value.bundle.nodePayloads,
      "divedra-manager": {
        ...loaded.value.bundle.nodePayloads["divedra-manager"],
        promptTemplateFile: "nodes/node-divedra-manager.json",
        promptTemplate: "This must never replace the node payload file",
      },
    };

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: updatedNodePayloads,
      },
      {
        workflowRoot: root,
      },
    );

    expect(saveResult.ok).toBe(false);
    if (saveResult.ok) {
      return;
    }
    expect(saveResult.error.code).toBe("VALIDATION");
    expect(
      saveResult.error.issues?.some(
        (issue) =>
          issue.path ===
            "nodePayloads.nodes/node-divedra-manager.json.promptTemplateFile" &&
          issue.message.includes(
            "must not target canonical workflow definition files",
          ),
      ),
    ).toBe(true);

    const nodeJsonAfter = await readFile(
      path.join(root, "demo", "nodes", "node-divedra-manager.json"),
      "utf8",
    );
    expect(nodeJsonAfter).toBe(originalNodeJson);
  });

  test("accepts inline-authored workflow nodes and persists synthesized nodes/ payload files", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "inline-demo",
      {
        workflow: {
          workflowId: "inline-demo",
          description: "inline demo",
          defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
          nodes: [
            {
              id: "divedra-manager",
              kind: "root-manager",
              completion: { type: "none" },
              node: {
                id: "divedra-manager",
                executionBackend: "codex-agent",
                model: "gpt-5-nano",
                promptTemplate: "inline manager",
                variables: {},
              },
            },
          ],
          edges: [],
          loops: [],
        },
        nodePayloads: {},
      },
      {
        ...testLegacyAuthorshipOk,
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const workflowJsonRaw = await readFile(
      path.join(root, "inline-demo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonRaw).toContain(
      '"nodeFile": "nodes/node-divedra-manager.json"',
    );

    const nodeJsonRaw = await readFile(
      path.join(root, "inline-demo", "nodes", "node-divedra-manager.json"),
      "utf8",
    );
    expect(nodeJsonRaw).toContain('"promptTemplate": "inline manager"');

    const reloaded = await loadWorkflowFromDisk("inline-demo", {
      ...testLegacyAuthorshipOk,
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(
      reloaded.value.bundle.nodePayloads["divedra-manager"]?.promptTemplate,
    ).toBe("inline manager");
  });

  test("prefers inline-authored node payloads over stale id-keyed nodePayloads on save", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "inline-demo",
      {
        workflow: {
          workflowId: "inline-demo",
          description: "inline demo",
          defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
          nodes: [
            {
              id: "divedra-manager",
              kind: "root-manager",
              completion: { type: "none" },
              node: {
                id: "divedra-manager",
                executionBackend: "codex-agent",
                model: "gpt-5-nano",
                promptTemplate: "inline manager",
                variables: {},
              },
            },
          ],
          edges: [],
          loops: [],
        },
        nodePayloads: {
          "divedra-manager": {
            id: "divedra-manager",
            executionBackend: "codex-agent",
            model: "gpt-5-mini",
            promptTemplate: "stale manager payload",
            sessionStartPromptTemplate: "stale first-turn prompt",
            variables: {},
          },
        },
      },
      {
        ...testLegacyAuthorshipOk,
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const nodeJsonRaw = await readFile(
      path.join(root, "inline-demo", "nodes", "node-divedra-manager.json"),
      "utf8",
    );
    expect(nodeJsonRaw).toContain('"promptTemplate": "inline manager"');
    expect(nodeJsonRaw).not.toContain("stale manager payload");
    expect(nodeJsonRaw).not.toContain("stale first-turn prompt");
  });

  test("ignores unreferenced node payload template files when computing save revisions", async () => {
    const root = await makeTempDir();

    const saveResult = await saveWorkflowToDisk(
      "inline-demo",
      {
        workflow: {
          workflowId: "inline-demo",
          description: "inline demo",
          defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
          nodes: [
            {
              id: "divedra-manager",
              kind: "root-manager",
              completion: { type: "none" },
              node: {
                id: "divedra-manager",
                executionBackend: "codex-agent",
                model: "gpt-5-nano",
                promptTemplate: "inline manager",
                variables: {},
              },
            },
          ],
          edges: [],
          loops: [],
        },
        nodePayloads: {
          "obsolete-worker": {
            id: "obsolete-worker",
            executionBackend: "codex-agent",
            model: "gpt-5-mini",
            promptTemplateFile: "prompts/missing-obsolete-worker.md",
            variables: {},
          },
        },
      },
      {
        ...testLegacyAuthorshipOk,
        workflowRoot: root,
      },
    );

    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    expect(saveResult.value.revision).toMatch(/^sha256:/u);
  });

  test("removes deprecated workflow-vis.json files when saving existing workflows", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const workflowVisPath = path.join(root, "demo", "workflow-vis.json");
    await Bun.write(
      workflowVisPath,
      `${JSON.stringify({ nodes: [{ id: "divedra-manager", order: 0 }] }, null, 2)}\n`,
    );

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: loaded.value.bundle.nodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    await expect(readFile(workflowVisPath, "utf8")).rejects.toThrow(/ENOENT/u);
  });

  test("preserves canonical container metadata across save and reload", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const loaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const updatedNodePayloads = {
      ...loaded.value.bundle.nodePayloads,
      "main-worker": {
        ...loaded.value.bundle.nodePayloads["main-worker"],
        nodeType: "container" as const,
        container: {
          runnerKind: "podman" as const,
          build: {
            contextPath: "containers/main-worker",
            containerfilePath: "containers/main-worker/Containerfile",
            target: "runtime",
          },
        },
      },
    };

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        nodePayloads: updatedNodePayloads,
      },
      {
        workflowRoot: root,
      },
    );
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    const reloaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(reloaded.value.bundle.nodePayloads["main-worker"]).toMatchObject({
      nodeType: "container",
      container: {
        runnerKind: "podman",
        build: {
          contextPath: "containers/main-worker",
          containerfilePath: "containers/main-worker/Containerfile",
          target: "runtime",
        },
      },
    });
  });
});
