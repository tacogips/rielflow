import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "./result";
import { isSafeWorkflowName, resolveEffectiveRoots } from "./paths";
import type { LoadOptions } from "./types";

export interface CreateWorkflowSuccess {
  readonly workflowName: string;
  readonly workflowDirectory: string;
}

export interface CreateWorkflowFailure {
  readonly code: "INVALID_WORKFLOW_NAME" | "ALREADY_EXISTS" | "IO";
  readonly message: string;
}

const TEMPLATE_EXECUTION_BACKEND = "codex-agent";
const TEMPLATE_MODEL = "gpt-5-nano";

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeText(filePath: string, text: string): Promise<void> {
  await writeFile(filePath, `${text.trimEnd()}\n`, "utf8");
}

export async function createWorkflowTemplate(
  workflowName: string,
  options: LoadOptions = {},
): Promise<Result<CreateWorkflowSuccess, CreateWorkflowFailure>> {
  if (!isSafeWorkflowName(workflowName)) {
    return err({
      code: "INVALID_WORKFLOW_NAME",
      message: `invalid workflow name '${workflowName}'`,
    });
  }

  const roots = resolveEffectiveRoots(options);
  const workflowDirectory = path.join(roots.workflowRoot, workflowName);
  const promptDirectory = path.join(workflowDirectory, "prompts");

  try {
    await mkdir(roots.workflowRoot, { recursive: true });
    await mkdir(workflowDirectory, { recursive: false });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("EEXIST")) {
      return err({
        code: "ALREADY_EXISTS",
        message: `workflow already exists: ${workflowDirectory}`,
      });
    }
    return err({
      code: "IO",
      message: `failed creating workflow directory '${workflowDirectory}': ${message}`,
    });
  }

  const workflowId = workflowName;
  const managerId = "oyakata-manager";
  const mainManagerId = "main-oyakata";
  const inputId = "workflow-input";
  const outputId = "workflow-output";

  const workflowJson = {
    workflowId,
    description: "New workflow",
    defaults: {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
      containerRuntime: {
        runnerKind: "podman",
      },
    },
    prompts: {
      oyakataPromptTemplate:
        "Coordinate {{workflowId}} so each node and sub-workflow works for a clear reason and returns the value needed downstream.",
      workerSystemPromptTemplate:
        "Work only on the assigned node task, use the provided workflow context, and return the business JSON payload requested by the node.",
    },
    managerNodeId: managerId,
    subWorkflows: [
      {
        id: "main",
        description: "Main sub-workflow",
        managerNodeId: mainManagerId,
        inputNodeId: inputId,
        outputNodeId: outputId,
        nodeIds: [mainManagerId, inputId, outputId],
        inputSources: [{ type: "human-input" }],
        block: { type: "plain" },
      },
    ],
    nodes: [
      {
        id: managerId,
        kind: "root-manager",
        nodeFile: `node-${managerId}.json`,
        completion: { type: "none" },
      },
      {
        id: mainManagerId,
        kind: "sub-oyakata-manager",
        nodeFile: `node-${mainManagerId}.json`,
        completion: { type: "none" },
      },
      {
        id: inputId,
        kind: "input",
        nodeFile: `node-${inputId}.json`,
        completion: { type: "none" },
      },
      {
        id: outputId,
        kind: "output",
        nodeFile: `node-${outputId}.json`,
        completion: { type: "none" },
      },
    ],
    edges: [{ from: inputId, to: outputId, when: "always" }],
    loops: [],
    branching: { mode: "fan-out" },
  };

  const workflowVis = {
    nodes: [
      { id: managerId, order: 0 },
      { id: mainManagerId, order: 1 },
      { id: inputId, order: 2 },
      { id: outputId, order: 3 },
    ],
    uiMeta: { layout: "vertical" },
  };

  const nodePayloads: Array<{ fileName: string; payload: object }> = [
    {
      fileName: `node-${managerId}.json`,
      payload: {
        id: managerId,
        executionBackend: TEMPLATE_EXECUTION_BACKEND,
        model: TEMPLATE_MODEL,
        promptTemplateFile: `prompts/${managerId}.md`,
        variables: { workflowId },
      },
    },
    {
      fileName: `node-${mainManagerId}.json`,
      payload: {
        id: mainManagerId,
        executionBackend: TEMPLATE_EXECUTION_BACKEND,
        model: TEMPLATE_MODEL,
        promptTemplateFile: `prompts/${mainManagerId}.md`,
        variables: { workflowId },
      },
    },
    {
      fileName: `node-${inputId}.json`,
      payload: {
        id: inputId,
        executionBackend: TEMPLATE_EXECUTION_BACKEND,
        model: TEMPLATE_MODEL,
        promptTemplateFile: `prompts/${inputId}.md`,
        variables: {},
      },
    },
    {
      fileName: `node-${outputId}.json`,
      payload: {
        id: outputId,
        executionBackend: TEMPLATE_EXECUTION_BACKEND,
        model: TEMPLATE_MODEL,
        promptTemplateFile: `prompts/${outputId}.md`,
        variables: {},
      },
    },
  ];

  const promptFiles: Array<{ fileName: string; content: string }> = [
    {
      fileName: `${managerId}.md`,
      content: "Coordinate workflow execution for {{workflowId}}",
    },
    {
      fileName: `${mainManagerId}.md`,
      content:
        "Translate the parent oyakata instruction into this sub-workflow's child work for {{workflowId}}",
    },
    {
      fileName: `${inputId}.md`,
      content:
        "Normalize the received sub-workflow instruction into workflow input",
    },
    {
      fileName: `${outputId}.md`,
      content: "Finalize workflow output",
    },
  ];

  try {
    await writeJson(
      path.join(workflowDirectory, "workflow.json"),
      workflowJson,
    );
    await writeJson(
      path.join(workflowDirectory, "workflow-vis.json"),
      workflowVis,
    );
    await mkdir(promptDirectory, { recursive: true });
    for (const node of nodePayloads) {
      await writeJson(
        path.join(workflowDirectory, node.fileName),
        node.payload,
      );
    }
    for (const promptFile of promptFiles) {
      await writeText(path.join(promptDirectory, promptFile.fileName), promptFile.content);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    try {
      await rm(workflowDirectory, { recursive: true, force: true });
    } catch {
      // Preserve the original write failure; the caller only needs one actionable error.
    }
    return err({
      code: "IO",
      message: `failed writing workflow templates: ${message}`,
    });
  }

  return ok({
    workflowName,
    workflowDirectory,
  });
}
