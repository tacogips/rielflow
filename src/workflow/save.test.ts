import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowTemplate } from "./create";
import { loadWorkflowFromDisk } from "./load";
import { saveWorkflowToDisk } from "./save";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-save-test-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("saveWorkflowToDisk", () => {
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

    const originalPayload =
      loaded.value.bundle.nodePayloads["divedra-manager"];
    expect(originalPayload?.promptTemplateFile).toBe("prompts/divedra-manager.md");

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
        workflowVis: loaded.value.bundle.workflowVis,
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
    expect(nodeJsonRaw).toContain('"promptTemplateFile": "prompts/divedra-manager.md"');
    expect(nodeJsonRaw).not.toContain('"promptTemplate":');

    const reloaded = await loadWorkflowFromDisk("demo", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(reloaded.value.bundle.nodePayloads["divedra-manager"]?.promptTemplate).toBe(
      "Updated manager prompt from save path\n",
    );
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

    const originalPayload =
      loaded.value.bundle.nodePayloads["divedra-manager"];
    expect(originalPayload?.promptTemplateFile).toBe("prompts/divedra-manager.md");

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
        workflowVis: loaded.value.bundle.workflowVis,
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
        sessionStartPromptTemplate:
          "## prompt\n{{prompt}}\n## args\n{{args}}",
      },
    };

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        workflowVis: loaded.value.bundle.workflowVis,
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
      path.join(
        root,
        "demo",
        "prompts",
        "divedra-manager-session-start.md",
      ),
      "utf8",
    );
    expect(sessionStartPromptText).toBe("## prompt\n{{prompt}}\n## args\n{{args}}\n");

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
        workflowVis: loaded.value.bundle.workflowVis,
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
    expect(saveResult.error.issues?.some(
      (issue) =>
        issue.path ===
          "nodePayloads.nodes/node-divedra-manager.json.promptTemplateFile" &&
        issue.message.includes("must not target canonical workflow definition files"),
    )).toBe(true);

    const workflowJsonAfter = await readFile(
      path.join(root, "demo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonAfter).toBe(originalWorkflowJson);
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
          managerNodeId: "divedra-manager",
          subWorkflows: [],
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
          branching: { mode: "fan-out" },
        },
        workflowVis: {
          nodes: [{ id: "divedra-manager", order: 0 }],
        },
        nodePayloads: {},
      },
      {
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
    expect(workflowJsonRaw).toContain('"nodeFile": "nodes/node-divedra-manager.json"');

    const nodeJsonRaw = await readFile(
      path.join(root, "inline-demo", "nodes", "node-divedra-manager.json"),
      "utf8",
    );
    expect(nodeJsonRaw).toContain('"promptTemplate": "inline manager"');

    const reloaded = await loadWorkflowFromDisk("inline-demo", {
      workflowRoot: root,
    });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) {
      return;
    }

    expect(reloaded.value.bundle.nodePayloads["divedra-manager"]?.promptTemplate).toBe(
      "inline manager",
    );
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
          managerNodeId: "divedra-manager",
          subWorkflows: [],
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
          branching: { mode: "fan-out" },
        },
        workflowVis: {
          nodes: [{ id: "divedra-manager", order: 0 }],
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
          managerNodeId: "divedra-manager",
          subWorkflows: [],
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
          branching: { mode: "fan-out" },
        },
        workflowVis: {
          nodes: [{ id: "divedra-manager", order: 0 }],
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
        workflowRoot: root,
      },
    );

    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) {
      return;
    }

    expect(saveResult.value.revision).toMatch(/^sha256:/u);
  });

  test("preserves podman runtimeIsolation metadata across save and reload", async () => {
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
        runtimeIsolation: {
          mode: "podman" as const,
          build: {
            contextPath: "containers/divedra-manager",
            dockerfilePath: "containers/divedra-manager/Dockerfile",
            target: "runtime",
          },
        },
      },
    };

    const saveResult = await saveWorkflowToDisk(
      "demo",
      {
        workflow: loaded.value.bundle.workflow,
        workflowVis: loaded.value.bundle.workflowVis,
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

    expect(reloaded.value.bundle.nodePayloads["divedra-manager"]).toMatchObject({
      nodeType: "container",
      container: {
        runnerKind: "podman",
        build: {
          contextPath: "containers/divedra-manager",
          dockerfilePath: "containers/divedra-manager/Dockerfile",
          target: "runtime",
        },
      },
    });
  });
});
