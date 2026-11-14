import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  makeStepAddressedAuthoredWorkflowFieldIssue,
  type RejectedAuthoredStepAddressedTopLevelField,
} from "./authored-workflow";
import { createWorkflowTemplate } from "./create";
import { loadWorkflowFromDisk } from "./load";
import { saveWorkflowToDisk } from "./save";
import { resolveWorkflowManagerStepId } from "./types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-save-test-"));
  tempDirs.push(directory);
  return directory;
}

function sampleRemovedTopLevelFieldValue(
  fieldName: RejectedAuthoredStepAddressedTopLevelField,
): unknown {
  switch (fieldName) {
    case "managerRuntimeId":
    case "managerNodeId":
    case "entryNodeId":
      return "demo-manager";
    case "subWorkflows":
    case "workflowCalls":
    case "subWorkflowConversations":
      return [];
    case "edges":
      return [{ from: "a", to: "b", when: "never" }];
    case "loops":
      return [
        {
          id: "loop-a",
          judgeNodeId: "a",
          continueWhen: "retry",
          exitWhen: "done",
        },
      ];
    case "branching":
      return {};
  }
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

  test.each(
    REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  )("rejects top-level workflow.%s on step-addressed save input", async (fieldName) => {
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
          [fieldName]: sampleRemovedTopLevelFieldValue(fieldName),
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
    expect(saved.error.issues).toContainEqual(
      makeStepAddressedAuthoredWorkflowFieldIssue(fieldName),
    );
  });

  test("preserves authored node registry kind and repeat fields when saving a normalized workflow", async () => {
    const workflowRoot = await makeTempDir();
    const workflowDirectory = path.join(workflowRoot, "loop-demo");

    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await writeFile(
      path.join(workflowDirectory, "workflow.json"),
      JSON.stringify(
        {
          workflowId: "loop-demo",
          defaults: {
            nodeTimeoutMs: 120000,
            maxLoopIterations: 8,
          },
          entryStepId: "review",
          nodes: [
            {
              id: "review-node",
              nodeFile: "nodes/node-review.json",
              kind: "loop-judge",
              repeat: {
                while: "continue_review",
                maxIterations: 5,
              },
            },
          ],
          steps: [
            {
              id: "review",
              nodeId: "review-node",
              transitions: [
                {
                  toStepId: "review",
                  label: "continue_review",
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(workflowDirectory, "nodes", "node-review.json"),
      JSON.stringify(
        {
          id: "review-node",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "Review the draft and decide whether to continue.",
          variables: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const loaded = await loadWorkflowFromDisk("loop-demo", { workflowRoot });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saved = await saveWorkflowToDisk(
      "loop-demo",
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

    const persistedWorkflow = JSON.parse(
      await readFile(path.join(workflowDirectory, "workflow.json"), "utf8"),
    ) as {
      readonly nodes?: ReadonlyArray<Record<string, unknown>>;
    };

    expect(persistedWorkflow.nodes).toEqual([
      {
        id: "review-node",
        nodeFile: "nodes/node-review.json",
        kind: "loop-judge",
        repeat: {
          while: "continue_review",
          maxIterations: 5,
        },
      },
    ]);
  });

  test("preserves fanout concurrency defaults when saving a normalized workflow", async () => {
    const workflowRoot = await makeTempDir();
    const workflowDirectory = path.join(workflowRoot, "fanout-demo");

    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await writeFile(
      path.join(workflowDirectory, "workflow.json"),
      JSON.stringify(
        {
          workflowId: "fanout-demo",
          defaults: {
            nodeTimeoutMs: 120000,
            maxLoopIterations: 8,
            fanoutConcurrency: 7,
          },
          entryStepId: "classify",
          nodes: [
            {
              id: "classify-node",
              nodeFile: "nodes/node-classify.json",
            },
            {
              id: "join-node",
              nodeFile: "nodes/node-join.json",
            },
          ],
          steps: [
            {
              id: "classify",
              nodeId: "classify-node",
              transitions: [
                {
                  toStepId: "join",
                  fanout: {
                    groupId: "features",
                    itemsFrom: "/payload/features",
                    joinStepId: "join",
                    failurePolicy: "collect-all",
                    resultOrder: "input",
                    writeOwnership: { mode: "read-only" },
                  },
                },
              ],
            },
            {
              id: "join",
              nodeId: "join-node",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(workflowDirectory, "nodes", "node-classify.json"),
      JSON.stringify(
        {
          id: "classify-node",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "Classify feature work.",
          variables: {},
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(workflowDirectory, "nodes", "node-join.json"),
      JSON.stringify(
        {
          id: "join-node",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "Join feature work.",
          variables: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const loaded = await loadWorkflowFromDisk("fanout-demo", { workflowRoot });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const saved = await saveWorkflowToDisk(
      "fanout-demo",
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

    const persistedWorkflow = JSON.parse(
      await readFile(path.join(workflowDirectory, "workflow.json"), "utf8"),
    ) as {
      readonly defaults?: Record<string, unknown>;
    };

    expect(persistedWorkflow.defaults?.["fanoutConcurrency"]).toBe(7);
  });
});
