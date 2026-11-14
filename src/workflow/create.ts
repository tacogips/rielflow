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

interface TemplateNodeDefinition {
  readonly id: string;
  readonly kind: "root-manager" | "subworkflow-manager" | "input" | "output";
  readonly prompt: string;
  readonly includeWorkflowId: boolean;
}

const TEMPLATE_NODE_DEFINITIONS = [
  {
    id: "divedra-manager",
    kind: "root-manager",
    prompt: "Coordinate workflow execution for {{workflowId}}",
    includeWorkflowId: true,
  },
  {
    id: "main-divedra",
    kind: "subworkflow-manager",
    prompt:
      "Translate the parent divedra instruction into this sub-workflow's child work for {{workflowId}}",
    includeWorkflowId: true,
  },
  {
    id: "workflow-input",
    kind: "input",
    prompt:
      "Normalize the received sub-workflow instruction into workflow input",
    includeWorkflowId: false,
  },
  {
    id: "workflow-output",
    kind: "output",
    prompt: "Finalize workflow output",
    includeWorkflowId: false,
  },
] as const satisfies readonly [
  TemplateNodeDefinition,
  TemplateNodeDefinition,
  TemplateNodeDefinition,
  TemplateNodeDefinition,
];

function templateNodeFileName(nodeId: string): string {
  return `nodes/node-${nodeId}.json`;
}

function createTemplateWorkflowNode(definition: TemplateNodeDefinition): {
  readonly id: string;
  readonly kind: TemplateNodeDefinition["kind"];
  readonly nodeFile: string;
  readonly completion: { readonly type: "none" };
} {
  return {
    id: definition.id,
    kind: definition.kind,
    nodeFile: templateNodeFileName(definition.id),
    completion: { type: "none" },
  };
}

function createTemplateNodePayload(
  definition: TemplateNodeDefinition,
  workflowId: string,
): {
  readonly fileName: string;
  readonly payload: {
    readonly id: string;
    readonly executionBackend: typeof TEMPLATE_EXECUTION_BACKEND;
    readonly model: typeof TEMPLATE_MODEL;
    readonly promptTemplateFile: string;
    readonly variables: Readonly<Record<string, string>>;
  };
} {
  return {
    fileName: templateNodeFileName(definition.id),
    payload: {
      id: definition.id,
      executionBackend: TEMPLATE_EXECUTION_BACKEND,
      model: TEMPLATE_MODEL,
      promptTemplateFile: `prompts/${definition.id}.md`,
      variables: definition.includeWorkflowId ? { workflowId } : {},
    },
  };
}

function createTemplatePromptFile(definition: TemplateNodeDefinition): {
  readonly fileName: string;
  readonly content: string;
} {
  return {
    fileName: `${definition.id}.md`,
    content: definition.prompt,
  };
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeText(filePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
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
  const [managerNode, mainManagerNode, inputNode, outputNode] =
    TEMPLATE_NODE_DEFINITIONS;
  const managerId = managerNode.id;
  const mainManagerId = mainManagerNode.id;
  const inputId = inputNode.id;
  const outputId = outputNode.id;

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
      divedraPromptTemplate:
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
    nodes: TEMPLATE_NODE_DEFINITIONS.map(createTemplateWorkflowNode),
    edges: [{ from: inputId, to: outputId, when: "always" }],
    loops: [],
    branching: { mode: "fan-out" },
  };

  const workflowVis = {
    nodes: TEMPLATE_NODE_DEFINITIONS.map((definition, order) => ({
      id: definition.id,
      order,
    })),
    uiMeta: { layout: "vertical" },
  };

  const nodePayloads = TEMPLATE_NODE_DEFINITIONS.map((definition) =>
    createTemplateNodePayload(definition, workflowId),
  );
  const promptFiles = TEMPLATE_NODE_DEFINITIONS.map(createTemplatePromptFile);

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
      await writeText(
        path.join(promptDirectory, promptFile.fileName),
        promptFile.content,
      );
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
