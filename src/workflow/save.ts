import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile, atomicWriteTextFile } from "../shared/fs";
import { NODE_TEMPLATE_FIELD_SPECS } from "./node-template-fields";
import {
  remapAuthoredNodePayloadsByNodeFile,
  resolveAuthoredNodeFileReference,
  resolveWorkflowRelativeNodeFilePath,
} from "./authored-node";
import { resolveWorkflowRelativePath } from "./prompt-template-file";
import { err, ok, type Result } from "./result";
import { isSafeWorkflowName, resolveEffectiveRoots } from "./paths";
import { validateWorkflowBundleAsync } from "./validate";
import {
  collectPromptTemplateFiles,
  collectWorkflowRevisionNodeFiles,
  computeWorkflowRevisionFromFiles,
} from "./revision";
import type {
  AuthoredWorkflowJson,
  AuthoredWorkflowNodeRef,
  LoadOptions,
  WorkflowDefaults,
  WorkflowJson,
  WorkflowNodeRef,
} from "./types";

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
const WORKFLOW_DEFINITION_FILE = "workflow.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnKey(
  value: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return value !== undefined && Object.hasOwn(value, key);
}

function stripPersistedWorkflowNodeCompatibilityFields(node: unknown): unknown {
  if (typeof node !== "object" || node === null) {
    return node;
  }

  const nodeRecord = { ...(node as Record<string, unknown>) };
  if (nodeRecord["role"] !== undefined) {
    delete nodeRecord["kind"];
  }
  return nodeRecord;
}

function stripPersistedWorkflowCompatibilityFields(workflow: unknown): unknown {
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
): AuthoredWorkflowNodeRef {
  const nodeSource =
    node.addon === undefined
      ? { nodeFile: node.nodeFile }
      : { addon: node.addon };
  if (authoredNode === undefined) {
    return {
      id: node.id,
      ...nodeSource,
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
    ...nodeSource,
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
}): WorkflowDefaults {
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

function buildAuthoredNodesById(
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

function collectAuthoredNodeFiles(
  authoredWorkflow: Record<string, unknown> | undefined,
): readonly string[] {
  const authoredNodes = authoredWorkflow?.["nodes"];
  if (!Array.isArray(authoredNodes)) {
    return [];
  }

  return [
    ...new Set(
      authoredNodes.flatMap((node) =>
        isRecord(node)
          ? [resolveAuthoredNodeFileReference(node)].filter(
              (nodeFile): nodeFile is string => nodeFile !== undefined,
            )
          : [],
      ),
    ),
  ];
}

function buildAuthoredWorkflowNodesById(
  authoredWorkflow: AuthoredWorkflowJson | undefined,
): ReadonlyMap<string, Record<string, unknown>> {
  return buildAuthoredNodesById(authoredWorkflow);
}

function buildIncomingNodesById(
  workflow: unknown,
): ReadonlyMap<string, Record<string, unknown>> {
  if (!isRecord(workflow) || !Array.isArray(workflow["nodes"])) {
    return new Map();
  }
  return buildAuthoredNodesById(workflow);
}

function hasNonEmptyStringRecordValue(
  value: Record<string, unknown> | undefined,
): boolean {
  if (value === undefined) {
    return false;
  }
  return Object.values(value).some(
    (entry) => typeof entry === "string" && entry.length > 0,
  );
}

function isDefaultContainerRuntime(value: unknown): boolean {
  return (
    isRecord(value) &&
    value["runnerKind"] === "podman" &&
    value["runnerPath"] === undefined
  );
}

function hasManagerRoleNode(nodes: readonly unknown[]): boolean {
  return nodes.some(
    (node) =>
      isRecord(node) &&
      (node["role"] === "manager" ||
        node["kind"] === "root-manager" ||
        node["kind"] === "subworkflow-manager"),
  );
}

function createSequentialEdgesFromNodes(
  nodes: readonly unknown[],
): WorkflowJson["edges"] {
  const nodeIds = nodes.flatMap((node) =>
    isRecord(node) && typeof node["id"] === "string" ? [node["id"]] : [],
  );
  return nodeIds.slice(0, -1).map((from, index) => ({
    from,
    to: nodeIds[index + 1] as string,
    when: "always",
  }));
}

function edgesMatch(
  left: readonly unknown[] | undefined,
  right: WorkflowJson["edges"],
): boolean {
  if (!Array.isArray(left) || left.length !== right.length) {
    return false;
  }

  return left.every((edge, index) => {
    if (!isRecord(edge)) {
      return false;
    }
    const expected = right[index];
    return (
      edge["from"] === expected?.from &&
      edge["to"] === expected?.to &&
      edge["when"] === expected?.when &&
      edge["priority"] === expected?.priority
    );
  });
}

function shouldPersistTopLevelField(input: {
  readonly existingAuthoredWorkflow: Record<string, unknown> | undefined;
  readonly incomingWorkflow: Record<string, unknown>;
  readonly key: string;
  readonly keepWhenMeaningful?: boolean;
}): boolean {
  if (hasOwnKey(input.existingAuthoredWorkflow, input.key)) {
    return (
      hasOwnKey(input.incomingWorkflow, input.key) ||
      input.keepWhenMeaningful === true
    );
  }
  if (input.existingAuthoredWorkflow === undefined) {
    return hasOwnKey(input.incomingWorkflow, input.key);
  }
  return input.keepWhenMeaningful === true;
}

function prepareAuthoredWorkflowNodeForSave(input: {
  readonly node: unknown;
  readonly existingNode: Record<string, unknown> | undefined;
  readonly incomingNode: Record<string, unknown> | undefined;
}): unknown {
  if (!isRecord(input.node)) {
    return input.node;
  }

  const node = { ...input.node };
  if (node["addon"] !== undefined) {
    delete node["nodeFile"];
  }
  const isExplicitKindMigration =
    hasOwnKey(input.existingNode, "kind") &&
    input.incomingNode !== undefined &&
    !hasOwnKey(input.incomingNode, "kind") &&
    (hasOwnKey(input.incomingNode, "role") ||
      hasOwnKey(input.incomingNode, "control"));

  if (
    (!hasOwnKey(input.existingNode, "kind") || isExplicitKindMigration) &&
    !(input.existingNode === undefined && hasOwnKey(node, "kind"))
  ) {
    delete node["kind"];
  }

  if (
    !hasOwnKey(input.existingNode, "role") &&
    !(
      (input.existingNode === undefined && hasOwnKey(node, "role")) ||
      (isExplicitKindMigration &&
        input.incomingNode !== undefined &&
        hasOwnKey(input.incomingNode, "role"))
    )
  ) {
    delete node["role"];
  }

  if (
    !hasOwnKey(input.existingNode, "control") &&
    (node["control"] === undefined ||
      node["control"] === "none" ||
      hasOwnKey(node, "kind"))
  ) {
    delete node["control"];
  }

  for (const key of ["completion", "execution", "group", "repeat"] as const) {
    if (!hasOwnKey(node, key) || node[key] === undefined) {
      delete node[key];
    }
  }

  return node;
}

function prepareAuthoredWorkflowForSave(input: {
  readonly workflow: unknown;
  readonly existingAuthoredWorkflow: unknown;
}): unknown {
  const incomingWorkflow = stripPersistedWorkflowCompatibilityFields(
    input.workflow,
  );
  if (!isRecord(incomingWorkflow)) {
    return incomingWorkflow;
  }

  const existingAuthoredWorkflow = isRecord(input.existingAuthoredWorkflow)
    ? input.existingAuthoredWorkflow
    : undefined;
  const preparedWorkflow: Record<string, unknown> = { ...incomingWorkflow };
  const incomingNodesById = buildIncomingNodesById(input.workflow);
  const incomingDefaults = isRecord(preparedWorkflow["defaults"])
    ? { ...preparedWorkflow["defaults"] }
    : undefined;

  if (incomingDefaults !== undefined) {
    if (
      incomingDefaults["containerRuntime"] === undefined ||
      isDefaultContainerRuntime(incomingDefaults["containerRuntime"])
    ) {
      delete incomingDefaults["containerRuntime"];
    }
    preparedWorkflow["defaults"] = incomingDefaults;
  }

  if (
    !hasOwnKey(preparedWorkflow, "description") ||
    typeof preparedWorkflow["description"] !== "string" ||
    preparedWorkflow["description"].length === 0
  ) {
    delete preparedWorkflow["description"];
  }

  if (
    !hasOwnKey(preparedWorkflow, "prompts") ||
    !hasNonEmptyStringRecordValue(
      isRecord(preparedWorkflow["prompts"])
        ? preparedWorkflow["prompts"]
        : undefined,
    )
  ) {
    delete preparedWorkflow["prompts"];
  }

  if (
    !shouldPersistTopLevelField({
      existingAuthoredWorkflow,
      incomingWorkflow,
      key: "managerNodeId",
    }) ||
    preparedWorkflow["hasManagerNode"] === false
  ) {
    delete preparedWorkflow["managerNodeId"];
  }

  const incomingNodes = Array.isArray(preparedWorkflow["nodes"])
    ? preparedWorkflow["nodes"]
    : [];
  const existingNodesById = buildAuthoredNodesById(existingAuthoredWorkflow);
  preparedWorkflow["nodes"] = incomingNodes.map((node) =>
    prepareAuthoredWorkflowNodeForSave({
      node,
      existingNode:
        isRecord(node) && typeof node["id"] === "string"
          ? existingNodesById.get(node["id"])
          : undefined,
      incomingNode:
        isRecord(node) && typeof node["id"] === "string"
          ? incomingNodesById.get(node["id"])
          : undefined,
    }),
  );

  const shouldKeepEntryNode =
    hasManagerRoleNode(incomingNodes) === false ||
    shouldPersistTopLevelField({
      existingAuthoredWorkflow,
      incomingWorkflow,
      key: "entryNodeId",
    });
  if (!shouldKeepEntryNode) {
    delete preparedWorkflow["entryNodeId"];
  }

  const synthesizedEdges = createSequentialEdgesFromNodes(incomingNodes);
  const keepEdges = shouldPersistTopLevelField({
    existingAuthoredWorkflow,
    incomingWorkflow,
    key: "edges",
    keepWhenMeaningful:
      Array.isArray(preparedWorkflow["edges"]) &&
      !edgesMatch(preparedWorkflow["edges"], synthesizedEdges),
  });
  if (!keepEdges) {
    delete preparedWorkflow["edges"];
  }

  for (const key of [
    "workflowCalls",
    "subWorkflows",
    "subWorkflowConversations",
    "loops",
  ] as const) {
    const keepField = shouldPersistTopLevelField({
      existingAuthoredWorkflow,
      incomingWorkflow,
      key,
      keepWhenMeaningful:
        Array.isArray(preparedWorkflow[key]) &&
        preparedWorkflow[key].length > 0,
    });
    if (!keepField) {
      delete preparedWorkflow[key];
    }
  }

  const keepBranching = shouldPersistTopLevelField({
    existingAuthoredWorkflow,
    incomingWorkflow,
    key: "branching",
    keepWhenMeaningful:
      isRecord(preparedWorkflow["branching"]) &&
      preparedWorkflow["branching"]["mode"] !== "fan-out",
  });
  if (!keepBranching) {
    delete preparedWorkflow["branching"];
  }

  return preparedWorkflow;
}

function createPersistedWorkflowJson(input: {
  readonly workflow: WorkflowJson;
  readonly authoredWorkflow: AuthoredWorkflowJson | undefined;
}): AuthoredWorkflowJson {
  const authoredWorkflow = input.authoredWorkflow;
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
      readonly addon?: unknown;
    }[];
  };
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const referencedPayloads: Record<string, unknown> = {};
  for (const node of input.workflow.nodes) {
    if (node.addon !== undefined) {
      continue;
    }
    const payload =
      input.nodePayloads[node.nodeFile] ?? input.nodePayloads[node.id];
    if (payload !== undefined) {
      referencedPayloads[node.nodeFile] = payload;
    }
  }
  return referencedPayloads;
}

function collectReferencedPromptTemplateFiles(
  nodePayloads: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  return new Set(collectPromptTemplateFiles(nodePayloads));
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

async function readExistingAuthoredWorkflow(
  workflowDirectory: string,
): Promise<Result<unknown | undefined, SaveWorkflowFailure>> {
  const workflowPath = path.join(workflowDirectory, WORKFLOW_DEFINITION_FILE);
  try {
    const raw = await readFile(workflowPath, "utf8");
    return ok(JSON.parse(raw) as unknown);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("ENOENT")) {
      return ok(undefined);
    }
    return err({
      code: "IO",
      message: `failed reading existing workflow definition '${workflowPath}' while preparing save: ${message}`,
    });
  }
}

async function readExistingNodePayload(
  workflowDirectory: string,
  nodeFile: string,
): Promise<unknown | undefined> {
  const nodeFilePath = resolveWorkflowRelativeNodeFilePath(
    workflowDirectory,
    nodeFile,
  );
  if (!nodeFilePath.ok) {
    return undefined;
  }

  try {
    const raw = await readFile(nodeFilePath.value, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

function collectPayloadPromptTemplateFiles(
  payload: unknown,
): readonly string[] {
  if (!isRecord(payload)) {
    return [];
  }

  return NODE_TEMPLATE_FIELD_SPECS.flatMap((spec) => {
    const templateFile = payload[spec.fileField];
    return typeof templateFile === "string" && templateFile.length > 0
      ? [templateFile]
      : [];
  });
}

async function collectExistingPromptTemplateFiles(input: {
  readonly workflowDirectory: string;
  readonly existingNodeFiles: readonly string[];
}): Promise<ReadonlySet<string>> {
  const existingPromptTemplateFiles = new Set<string>();

  for (const nodeFile of input.existingNodeFiles) {
    const existingPayload = await readExistingNodePayload(
      input.workflowDirectory,
      nodeFile,
    );
    for (const templateFile of collectPayloadPromptTemplateFiles(
      existingPayload,
    )) {
      existingPromptTemplateFiles.add(templateFile);
    }
  }

  return existingPromptTemplateFiles;
}

async function loadExistingAuthoredWorkflowFileState(input: {
  readonly workflowDirectory: string;
  readonly existingAuthoredWorkflow: unknown;
}): Promise<
  Result<
    {
      readonly existingAuthoredWorkflowRecord:
        | Record<string, unknown>
        | undefined;
      readonly existingNodeFiles: readonly string[];
      readonly existingPromptTemplateFiles: ReadonlySet<string>;
    },
    SaveWorkflowFailure
  >
> {
  const existingAuthoredWorkflowRecord = isRecord(
    input.existingAuthoredWorkflow,
  )
    ? input.existingAuthoredWorkflow
    : undefined;
  const existingNodeFiles = collectAuthoredNodeFiles(
    existingAuthoredWorkflowRecord,
  );

  try {
    const existingPromptTemplateFiles =
      await collectExistingPromptTemplateFiles({
        workflowDirectory: input.workflowDirectory,
        existingNodeFiles,
      });
    return ok({
      existingAuthoredWorkflowRecord,
      existingNodeFiles,
      existingPromptTemplateFiles,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed reading existing workflow files while preparing save: ${message}`,
    });
  }
}

async function removeStaleWorkflowFiles(input: {
  readonly workflowDirectory: string;
  readonly existingNodeFiles: readonly string[];
  readonly existingPromptTemplateFiles: ReadonlySet<string>;
  readonly persistedNodeFiles: readonly string[];
  readonly persistedPromptTemplateFiles: ReadonlySet<string>;
}): Promise<void> {
  const persistedNodeFileSet = new Set(input.persistedNodeFiles);
  const staleNodeFiles = input.existingNodeFiles.filter(
    (nodeFile) => !persistedNodeFileSet.has(nodeFile),
  );
  const stalePromptTemplateFiles = [
    ...input.existingPromptTemplateFiles,
  ].filter(
    (templateFile) => !input.persistedPromptTemplateFiles.has(templateFile),
  );

  for (const nodeFile of staleNodeFiles) {
    const nodeFilePath = resolveWorkflowRelativeNodeFilePath(
      input.workflowDirectory,
      nodeFile,
    );
    if (!nodeFilePath.ok) {
      continue;
    }
    await rm(nodeFilePath.value, { force: true });
  }

  for (const templateFile of stalePromptTemplateFiles) {
    const templateFilePath = resolveWorkflowRelativePath(
      input.workflowDirectory,
      templateFile,
    );
    if (!templateFilePath.ok) {
      continue;
    }
    await rm(templateFilePath.value, { force: true });
  }
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
        hydratedPayload[spec.textField] = await readFile(
          resolvedPath.value,
          "utf8",
        );
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
                message: `must be provided inline or by an existing ${spec.fileField} '${templateFile}'`,
              },
            ],
          });
        }

        return err({
          code: "IO",
          message: `failed reading ${spec.fileField} '${templateFile}' for validation: ${message}`,
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

  const roots = resolveEffectiveRoots(options);
  const workflowDirectory = path.join(roots.workflowRoot, workflowName);
  const existingAuthoredWorkflow =
    await readExistingAuthoredWorkflow(workflowDirectory);
  if (!existingAuthoredWorkflow.ok) {
    return err(existingAuthoredWorkflow.error);
  }

  const authoredWorkflow = prepareAuthoredWorkflowForSave({
    workflow: input.workflow,
    existingAuthoredWorkflow: existingAuthoredWorkflow.value,
  });
  const normalizedNodePayloads = remapAuthoredNodePayloadsByNodeFile(
    authoredWorkflow,
    input.nodePayloads,
  );
  const authoredReferencedNodePayloads = collectAuthoredReferencedNodePayloads(
    authoredWorkflow,
    normalizedNodePayloads,
  );
  const validationNodePayloads = await hydratePromptTemplateFilesForValidation({
    workflowDirectory,
    nodePayloads: authoredReferencedNodePayloads,
  });
  if (!validationNodePayloads.ok) {
    return err(validationNodePayloads.error);
  }

  const validation = await validateWorkflowBundleAsync(
    {
      workflow: authoredWorkflow,
      nodePayloads: validationNodePayloads.value,
    },
    options,
  );

  if (!validation.ok) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: validation.error,
    });
  }

  const nodeFiles = collectWorkflowRevisionNodeFiles(validation.value.workflow);
  const referencedNodePayloads = collectReferencedNodePayloads({
    workflow: validation.value.workflow,
    nodePayloads: normalizedNodePayloads,
  });
  const existingWorkflowFileState = await loadExistingAuthoredWorkflowFileState(
    {
      workflowDirectory,
      existingAuthoredWorkflow: existingAuthoredWorkflow.value,
    },
  );
  if (!existingWorkflowFileState.ok) {
    return err(existingWorkflowFileState.error);
  }

  const currentRevision = await computeWorkflowRevisionFromFiles(
    workflowDirectory,
    existingWorkflowFileState.value.existingAuthoredWorkflowRecord === undefined
      ? nodeFiles
      : existingWorkflowFileState.value.existingNodeFiles,
    existingWorkflowFileState.value.existingAuthoredWorkflowRecord === undefined
      ? collectPromptTemplateFiles(referencedNodePayloads)
      : [...existingWorkflowFileState.value.existingPromptTemplateFiles],
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
      authoredWorkflow: isRecord(authoredWorkflow)
        ? (authoredWorkflow as AuthoredWorkflowJson)
        : undefined,
    });
    await mkdir(workflowDirectory, { recursive: true });
    await atomicWriteJsonFile(
      path.join(workflowDirectory, WORKFLOW_DEFINITION_FILE),
      persistedWorkflow,
    );
    for (const node of validation.value.workflow.nodes) {
      if (node.addon !== undefined) {
        continue;
      }
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
    await removeStaleWorkflowFiles({
      workflowDirectory,
      existingNodeFiles: existingWorkflowFileState.value.existingNodeFiles,
      existingPromptTemplateFiles:
        existingWorkflowFileState.value.existingPromptTemplateFiles,
      persistedNodeFiles: nodeFiles,
      persistedPromptTemplateFiles: collectReferencedPromptTemplateFiles(
        referencedNodePayloads,
      ),
    });
    await rm(path.join(workflowDirectory, LEGACY_WORKFLOW_VISUALIZATION_FILE), {
      force: true,
    });
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
