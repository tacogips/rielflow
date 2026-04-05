import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile, atomicWriteTextFile } from "../shared/fs";
import { NODE_TEMPLATE_FIELD_SPECS } from "./node-template-fields";
import {
  remapAuthoredNodePayloadsByNodeFile,
  resolveAuthoredNodeFileReference,
} from "./authored-node";
import { resolveWorkflowRelativePath } from "./prompt-template-file";
import { err, ok, type Result } from "./result";
import { isSafeWorkflowName, resolveEffectiveRoots } from "./paths";
import { validateWorkflowBundle } from "./validate";
import {
  collectPromptTemplateFiles,
  computeWorkflowRevisionFromFiles,
} from "./revision";
import type { LoadOptions, WorkflowJson, WorkflowNodeRef } from "./types";

export interface SaveWorkflowInput {
  readonly workflow: unknown;
  readonly nodePayloads: Readonly<Record<string, unknown>>;
  readonly expectedRevision?: string;
}

export interface SaveWorkflowSuccess {
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly revision: string;
}

export interface SaveWorkflowFailure {
  readonly code: "INVALID_WORKFLOW_NAME" | "VALIDATION" | "CONFLICT" | "IO";
  readonly message: string;
  readonly issues?: readonly {
    readonly severity: "error" | "warning";
    readonly path: string;
    readonly message: string;
  }[];
  readonly currentRevision?: string;
}

const LEGACY_WORKFLOW_VISUALIZATION_FILE = "workflow-vis.json";

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnKey(
  value: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return value !== undefined && Object.hasOwn(value, key);
}

function stripPersistedWorkflowNodeCompatibilityFields(
  node: unknown,
): unknown {
  if (typeof node !== "object" || node === null) {
    return node;
  }

  const nodeRecord = { ...(node as Record<string, unknown>) };
  if (nodeRecord["role"] !== undefined) {
    delete nodeRecord["kind"];
  }
  return nodeRecord;
}

function stripPersistedWorkflowCompatibilityFields(
  workflow: unknown,
): unknown {
  if (typeof workflow !== "object" || workflow === null) {
    return workflow;
  }

  const workflowRecord = { ...(workflow as Record<string, unknown>) };
  const hasManagerNode = workflowRecord["hasManagerNode"];
  delete workflowRecord["hasManagerNode"];
  if (hasManagerNode === false) {
    delete workflowRecord["managerNodeId"];
  }

  const nodesRaw = workflowRecord["nodes"];
  if (Array.isArray(nodesRaw)) {
    workflowRecord["nodes"] = nodesRaw.map(
      stripPersistedWorkflowNodeCompatibilityFields,
    );
  }

  return workflowRecord;
}

function createPersistedWorkflowNode(
  node: WorkflowNodeRef,
  authoredNode: Record<string, unknown> | undefined,
): Readonly<Record<string, unknown>> {
  if (authoredNode === undefined) {
    return {
      id: node.id,
      nodeFile: node.nodeFile,
      ...(node.role === undefined && node.kind !== undefined
        ? { kind: node.kind }
        : {}),
      ...(node.role === undefined ? {} : { role: node.role }),
      ...(node.control === undefined ? {} : { control: node.control }),
      ...(node.completion === undefined ? {} : { completion: node.completion }),
      ...(node.execution === undefined ? {} : { execution: node.execution }),
      ...(node.group === undefined ? {} : { group: node.group }),
      ...(node.repeat === undefined ? {} : { repeat: node.repeat }),
    };
  }

  return {
    id: node.id,
    nodeFile: node.nodeFile,
    ...(hasOwnKey(authoredNode, "kind") && node.kind !== undefined
      ? { kind: node.kind }
      : {}),
    ...(hasOwnKey(authoredNode, "role") && node.role !== undefined
      ? { role: node.role }
      : {}),
    ...(hasOwnKey(authoredNode, "control") && node.control !== undefined
      ? { control: node.control }
      : {}),
    ...(hasOwnKey(authoredNode, "completion") && node.completion !== undefined
      ? { completion: node.completion }
      : {}),
    ...(hasOwnKey(authoredNode, "execution") && node.execution !== undefined
      ? { execution: node.execution }
      : {}),
    ...(hasOwnKey(authoredNode, "group") && node.group !== undefined
      ? { group: node.group }
      : {}),
    ...(hasOwnKey(authoredNode, "repeat") && node.repeat !== undefined
      ? { repeat: node.repeat }
      : {}),
  };
}

function createPersistedWorkflowDefaults(input: {
  readonly workflow: WorkflowJson;
  readonly authoredWorkflow: Record<string, unknown> | undefined;
}): Readonly<Record<string, unknown>> {
  const authoredDefaults = isRecord(input.authoredWorkflow?.["defaults"])
    ? input.authoredWorkflow["defaults"]
    : undefined;
  return {
    maxLoopIterations: input.workflow.defaults.maxLoopIterations,
    nodeTimeoutMs: input.workflow.defaults.nodeTimeoutMs,
    ...(hasOwnKey(authoredDefaults, "containerRuntime")
      ? { containerRuntime: input.workflow.defaults.containerRuntime }
      : {}),
  };
}

function buildAuthoredWorkflowNodesById(
  authoredWorkflow: Record<string, unknown> | undefined,
): ReadonlyMap<string, Record<string, unknown>> {
  const authoredNodes = authoredWorkflow?.["nodes"];
  if (!Array.isArray(authoredNodes)) {
    return new Map();
  }

  return new Map(
    authoredNodes.flatMap((node) => {
      if (!isRecord(node) || typeof node["id"] !== "string") {
        return [];
      }
      return [[node["id"], node] as const];
    }),
  );
}

function createPersistedWorkflowJson(input: {
  readonly workflow: WorkflowJson;
  readonly authoredWorkflow: unknown;
}): Readonly<Record<string, unknown>> {
  const authoredWorkflow = isRecord(input.authoredWorkflow)
    ? input.authoredWorkflow
    : undefined;
  const authoredNodesById = buildAuthoredWorkflowNodesById(authoredWorkflow);

  return {
    workflowId: input.workflow.workflowId,
    ...(hasOwnKey(authoredWorkflow, "description")
      ? { description: input.workflow.description }
      : {}),
    defaults: createPersistedWorkflowDefaults({
      workflow: input.workflow,
      authoredWorkflow,
    }),
    ...(hasOwnKey(authoredWorkflow, "prompts") &&
    input.workflow.prompts !== undefined
      ? { prompts: input.workflow.prompts }
      : {}),
    ...(hasOwnKey(authoredWorkflow, "managerNodeId") &&
    input.workflow.hasManagerNode !== false
      ? { managerNodeId: input.workflow.managerNodeId }
      : {}),
    ...(hasOwnKey(authoredWorkflow, "entryNodeId") &&
    input.workflow.entryNodeId !== undefined
      ? { entryNodeId: input.workflow.entryNodeId }
      : {}),
    ...(hasOwnKey(authoredWorkflow, "workflowCalls") &&
    input.workflow.workflowCalls !== undefined
      ? { workflowCalls: input.workflow.workflowCalls }
      : {}),
    ...(hasOwnKey(authoredWorkflow, "subWorkflows")
      ? { subWorkflows: input.workflow.subWorkflows }
      : {}),
    ...(hasOwnKey(authoredWorkflow, "subWorkflowConversations") &&
    input.workflow.subWorkflowConversations !== undefined
      ? { subWorkflowConversations: input.workflow.subWorkflowConversations }
      : {}),
    nodes: input.workflow.nodes.map((node) =>
      createPersistedWorkflowNode(node, authoredNodesById.get(node.id)),
    ),
    ...(hasOwnKey(authoredWorkflow, "edges")
      ? { edges: input.workflow.edges }
      : {}),
    ...(hasOwnKey(authoredWorkflow, "loops") &&
    input.workflow.loops !== undefined
      ? { loops: input.workflow.loops }
      : {}),
    ...(hasOwnKey(authoredWorkflow, "branching")
      ? { branching: input.workflow.branching }
      : {}),
  };
}

function collectReferencedNodePayloads(input: {
  readonly workflow: {
    readonly nodes: readonly {
      readonly id: string;
      readonly nodeFile: string;
    }[];
  };
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const referencedPayloads: Record<string, unknown> = {};
  for (const node of input.workflow.nodes) {
    const payload =
      input.nodePayloads[node.nodeFile] ?? input.nodePayloads[node.id];
    if (payload !== undefined) {
      referencedPayloads[node.nodeFile] = payload;
    }
  }
  return referencedPayloads;
}

function collectAuthoredReferencedNodePayloads(
  workflow: unknown,
  nodePayloads: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (typeof workflow !== "object" || workflow === null) {
    return nodePayloads;
  }

  const nodesRaw = (workflow as Record<string, unknown>)["nodes"];
  if (!Array.isArray(nodesRaw)) {
    return nodePayloads;
  }

  const referencedPayloads: Record<string, unknown> = {};
  for (const node of nodesRaw) {
    if (typeof node !== "object" || node === null) {
      continue;
    }

    const nodeRecord = node as Record<string, unknown>;
    const nodeId =
      typeof nodeRecord["id"] === "string" ? nodeRecord["id"] : undefined;
    const nodeFile = resolveAuthoredNodeFileReference(nodeRecord);
    if (!nodeId || nodeFile === undefined) {
      continue;
    }

    const payload = nodePayloads[nodeFile] ?? nodePayloads[nodeId];
    if (payload !== undefined) {
      referencedPayloads[nodeFile] = payload;
    }
  }

  return referencedPayloads;
}

async function persistNodePayload(input: {
  readonly workflowDirectory: string;
  readonly nodeFile: string;
  readonly payload: unknown;
}): Promise<void> {
  if (typeof input.payload !== "object" || input.payload === null) {
    await atomicWriteJsonFile(
      path.join(input.workflowDirectory, input.nodeFile),
      input.payload,
    );
    return;
  }

  const payload = input.payload as Record<string, unknown>;
  const persistedPayload = { ...payload };
  let wroteTemplateFile = false;

  for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
    const templateFile = payload[spec.fileField];
    const templateText = payload[spec.textField];
    if (
      typeof templateFile !== "string" ||
      templateFile.length === 0 ||
      typeof templateText !== "string" ||
      templateText.length === 0
    ) {
      continue;
    }

    const promptFilePath = resolveWorkflowRelativePath(
      input.workflowDirectory,
      templateFile,
    );
    if (!promptFilePath.ok) {
      throw new Error(promptFilePath.error.message);
    }
    await atomicWriteTextFile(
      promptFilePath.value,
      `${templateText.trimEnd()}\n`,
    );
    delete persistedPayload[spec.textField];
    wroteTemplateFile = true;
  }

  await atomicWriteJsonFile(
    path.join(input.workflowDirectory, input.nodeFile),
    wroteTemplateFile ? persistedPayload : input.payload,
  );
}

async function hydratePromptTemplateFilesForValidation(input: {
  readonly workflowDirectory: string;
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}): Promise<Result<Readonly<Record<string, unknown>>, SaveWorkflowFailure>> {
  const hydrated: Record<string, unknown> = { ...input.nodePayloads };

  for (const [nodeFile, payload] of Object.entries(input.nodePayloads)) {
    if (typeof payload !== "object" || payload === null) {
      continue;
    }

    const payloadRecord = payload as Record<string, unknown>;
    const hydratedPayload = { ...payloadRecord };
    for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
      const templateText = payloadRecord[spec.textField];
      if (typeof templateText === "string" && templateText.length > 0) {
        continue;
      }

      const templateFile = payloadRecord[spec.fileField];
      if (typeof templateFile !== "string" || templateFile.length === 0) {
        continue;
      }

      const resolvedPath = resolveWorkflowRelativePath(
        input.workflowDirectory,
        templateFile,
      );
      if (!resolvedPath.ok) {
        return err({
          code: "VALIDATION",
          message: "workflow validation failed",
          issues: [
            {
              severity: "error",
              path: `bundle.nodePayloads.${nodeFile}.${spec.fileField}`,
              message: resolvedPath.error.message,
            },
          ],
        });
      }

      try {
        hydratedPayload[spec.textField] = await readFile(resolvedPath.value, "utf8");
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        if (message.includes("ENOENT")) {
          return err({
            code: "VALIDATION",
            message: "workflow validation failed",
            issues: [
              {
                severity: "error",
                path: `bundle.nodePayloads.${nodeFile}.${spec.textField}`,
                message:
                  `must be provided inline or by an existing ${spec.fileField} '${templateFile}'`,
              },
            ],
          });
        }

        return err({
          code: "IO",
          message:
            `failed reading ${spec.fileField} '${templateFile}' for validation: ${message}`,
        });
      }
    }

    hydrated[nodeFile] = hydratedPayload;
  }

  return ok(hydrated);
}

export async function saveWorkflowToDisk(
  workflowName: string,
  input: SaveWorkflowInput,
  options: LoadOptions = {},
): Promise<Result<SaveWorkflowSuccess, SaveWorkflowFailure>> {
  if (!isSafeWorkflowName(workflowName)) {
    return err({
      code: "INVALID_WORKFLOW_NAME",
      message: `invalid workflow name '${workflowName}'`,
    });
  }

  const authoredWorkflow = stripPersistedWorkflowCompatibilityFields(
    input.workflow,
  );
  const normalizedNodePayloads = remapAuthoredNodePayloadsByNodeFile(
    authoredWorkflow,
    input.nodePayloads,
  );
  const authoredReferencedNodePayloads = collectAuthoredReferencedNodePayloads(
    authoredWorkflow,
    normalizedNodePayloads,
  );
  const roots = resolveEffectiveRoots(options);
  const workflowDirectory = path.join(roots.workflowRoot, workflowName);
  const validationNodePayloads = await hydratePromptTemplateFilesForValidation({
    workflowDirectory,
    nodePayloads: authoredReferencedNodePayloads,
  });
  if (!validationNodePayloads.ok) {
    return err(validationNodePayloads.error);
  }

  const validation = validateWorkflowBundle({
    workflow: authoredWorkflow,
    nodePayloads: validationNodePayloads.value,
  });

  if (!validation.ok) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: validation.error,
    });
  }

  const nodeFiles = validation.value.workflow.nodes.map(
    (node) => node.nodeFile,
  );
  const referencedNodePayloads = collectReferencedNodePayloads({
    workflow: validation.value.workflow,
    nodePayloads: normalizedNodePayloads,
  });

  const currentRevision = await computeWorkflowRevisionFromFiles(
    workflowDirectory,
    nodeFiles,
    collectPromptTemplateFiles(referencedNodePayloads),
  );
  if (input.expectedRevision !== undefined) {
    if (
      currentRevision.ok &&
      currentRevision.value !== input.expectedRevision
    ) {
      return err({
        code: "CONFLICT",
        message: "workflow revision conflict",
        currentRevision: currentRevision.value,
      });
    }
  }

  try {
    const persistedWorkflow = createPersistedWorkflowJson({
      workflow: validation.value.workflow,
      authoredWorkflow,
    });
    await mkdir(workflowDirectory, { recursive: true });
    await atomicWriteJsonFile(
      path.join(workflowDirectory, "workflow.json"),
      persistedWorkflow,
    );
    for (const node of validation.value.workflow.nodes) {
      const payload =
        normalizedNodePayloads[node.nodeFile] ??
        normalizedNodePayloads[node.id];
      if (payload === undefined) {
        return err({
          code: "VALIDATION",
          message: `missing node payload for ${node.nodeFile}`,
          issues: [
            {
              severity: "error",
              path: `bundle.nodePayloads.${node.nodeFile}`,
              message: "required payload is missing",
            },
          ],
        });
      }
      await persistNodePayload({
        workflowDirectory,
        nodeFile: node.nodeFile,
        payload,
      });
    }
    await rm(
      path.join(workflowDirectory, LEGACY_WORKFLOW_VISUALIZATION_FILE),
      { force: true },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed saving workflow files: ${message}`,
    });
  }

  const revision = await computeWorkflowRevisionFromFiles(
    workflowDirectory,
    nodeFiles,
    collectPromptTemplateFiles(referencedNodePayloads),
  );
  if (!revision.ok) {
    return err({ code: "IO", message: revision.error.message });
  }

  return ok({ workflowName, workflowDirectory, revision: revision.value });
}
