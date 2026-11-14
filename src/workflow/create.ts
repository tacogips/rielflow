import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "./result";
import { isSafeWorkflowName } from "./paths";
import {
  resolveWorkflowCreateSource,
  withResolvedWorkflowSourceOptions,
} from "./catalog";
import type { AuthoredWorkflowJson, LoadOptions } from "./types";

export interface CreateWorkflowSuccess {
  readonly workflowName: string;
  readonly workflowDirectory: string;
}

export interface CreateWorkflowFailure {
  readonly code:
    | "INVALID_WORKFLOW_NAME"
    | "INVALID_SCOPE"
    | "ALREADY_EXISTS"
    | "IO";
  readonly message: string;
}

export type CreateWorkflowTemplateMode = "managed" | "worker-only";

export interface CreateWorkflowTemplateOptions extends LoadOptions {
  readonly templateMode?: CreateWorkflowTemplateMode;
}

interface TemplateNodeDefinition {
  readonly id: string;
  readonly role: "manager" | "worker";
  readonly executionBackend: "claude-code-agent" | "codex-agent";
  readonly model: string;
  readonly prompt: string;
  readonly includeWorkflowId: boolean;
}

interface TemplateDefinition {
  readonly nodes: readonly TemplateNodeDefinition[];
  readonly workflowPrompts: {
    readonly divedraPromptTemplate?: string;
    readonly workerSystemPromptTemplate?: string;
  };
  readonly managerNodeId?: string;
  readonly entryNodeId: string;
}

const MANAGED_TEMPLATE_NODE_DEFINITIONS = [
  {
    id: "divedra-manager",
    role: "manager",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    prompt: "Coordinate workflow execution for {{workflowId}}",
    includeWorkflowId: true,
  },
  {
    id: "main-worker",
    role: "worker",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    prompt: "Complete the assigned workflow step for {{workflowId}}",
    includeWorkflowId: true,
  },
] as const satisfies readonly [TemplateNodeDefinition, TemplateNodeDefinition];

const WORKER_ONLY_TEMPLATE_NODE_DEFINITIONS = [
  {
    id: "main-worker",
    role: "worker",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    prompt: "Complete the assigned workflow step for {{workflowId}}",
    includeWorkflowId: true,
  },
] as const satisfies readonly [TemplateNodeDefinition];

function templateNodeFileName(nodeId: string): string {
  return `nodes/node-${nodeId}.json`;
}

function createTemplateWorkflowNode(definition: TemplateNodeDefinition): {
  readonly id: string;
  readonly role: TemplateNodeDefinition["role"];
  readonly nodeFile: string;
} {
  return {
    id: definition.id,
    role: definition.role,
    nodeFile: templateNodeFileName(definition.id),
  };
}

function createTemplateNodePayload(
  definition: TemplateNodeDefinition,
  workflowId: string,
): {
  readonly fileName: string;
  readonly payload: {
    readonly id: string;
    readonly executionBackend: TemplateNodeDefinition["executionBackend"];
    readonly model: string;
    readonly promptTemplateFile: string;
    readonly variables: Readonly<Record<string, string>>;
  };
} {
  return {
    fileName: templateNodeFileName(definition.id),
    payload: {
      id: definition.id,
      executionBackend: definition.executionBackend,
      model: definition.model,
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

function resolveTemplateDefinition(
  mode: CreateWorkflowTemplateMode,
): TemplateDefinition {
  if (mode === "worker-only") {
    const [workerNode] = WORKER_ONLY_TEMPLATE_NODE_DEFINITIONS;
    return {
      nodes: WORKER_ONLY_TEMPLATE_NODE_DEFINITIONS,
      workflowPrompts: {
        workerSystemPromptTemplate:
          "Work only on the assigned node task, use the provided workflow context, and return the business JSON payload requested by the node.",
      },
      entryNodeId: workerNode.id,
    };
  }

  const [managerNode] = MANAGED_TEMPLATE_NODE_DEFINITIONS;
  return {
    nodes: MANAGED_TEMPLATE_NODE_DEFINITIONS,
    workflowPrompts: {
      divedraPromptTemplate:
        "Coordinate {{workflowId}} so each node works for a clear reason and returns the value needed downstream.",
      workerSystemPromptTemplate:
        "Work only on the assigned node task, use the provided workflow context, and return the business JSON payload requested by the node.",
    },
    managerNodeId: managerNode.id,
    entryNodeId: managerNode.id,
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
  options: CreateWorkflowTemplateOptions = {},
): Promise<Result<CreateWorkflowSuccess, CreateWorkflowFailure>> {
  if (!isSafeWorkflowName(workflowName)) {
    return err({
      code: "INVALID_WORKFLOW_NAME",
      message: `invalid workflow name '${workflowName}'`,
    });
  }

  const source = resolveWorkflowCreateSource(workflowName, options);
  if (!source.ok) {
    return err({
      code:
        source.error.code === "INVALID_SCOPE"
          ? "INVALID_SCOPE"
          : "INVALID_WORKFLOW_NAME",
      message: source.error.message,
    });
  }

  const roots = withResolvedWorkflowSourceOptions(source.value, options);
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
  const templateDefinition = resolveTemplateDefinition(
    options.templateMode ?? "managed",
  );

  const workflowJson: AuthoredWorkflowJson = {
    workflowId,
    description: "New workflow",
    defaults: {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
    },
    prompts: templateDefinition.workflowPrompts,
    ...(templateDefinition.managerNodeId === undefined
      ? {}
      : { managerNodeId: templateDefinition.managerNodeId }),
    entryNodeId: templateDefinition.entryNodeId,
    nodes: templateDefinition.nodes.map(createTemplateWorkflowNode),
  };

  const nodePayloads = templateDefinition.nodes.map((definition) =>
    createTemplateNodePayload(definition, workflowId),
  );
  const promptFiles = templateDefinition.nodes.map(createTemplatePromptFile);

  try {
    await writeJson(
      path.join(workflowDirectory, "workflow.json"),
      workflowJson,
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
