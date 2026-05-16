import { isDeepStrictEqual } from "node:util";
import {
  cloneNodeTemplateAwarePayload,
  collectNodeTemplateFiles,
  NODE_TEMPLATE_FIELD_SPECS,
} from "./node-template-fields";
import {
  remapAuthoredNodePayloadsByNodeFile,
  resolveAuthoredNodeFileReference,
} from "./authored-node";
import { err, ok, type Result } from "./result";
import {
  collectStepAddressedAuthoredWorkflowFieldIssues,
  isNormalizedStepAddressedWorkflow,
  stripNormalizedWorkflowFieldsForPersistence,
} from "./authored-workflow";
import {
  collectPromptTemplateFiles,
  collectWorkflowRevisionNodeFiles,
  collectWorkflowRevisionStepFiles,
} from "./revision";
import type {
  AuthoredWorkflowJson,
  WorkflowJson,
  WorkflowNodeRegistryRef,
  WorkflowStepRef,
} from "./types";
import type { SaveWorkflowFailure, SaveWorkflowInput } from "./save-types";
import { isDefaultContainerRuntime } from "./save-authored";

export type AuthoredWorkflowRecord = AuthoredWorkflowJson &
  Readonly<Record<string, unknown>>;

export interface SaveWorkflowExistingFileState {
  readonly existingAuthoredWorkflowRecord: Record<string, unknown> | undefined;
  readonly existingNodeFiles: readonly string[];
  readonly existingStepFiles: readonly string[];
  readonly existingPromptTemplateFiles: ReadonlySet<string>;
}

export interface SaveWorkflowValidationPlan {
  readonly authoredWorkflow: unknown;
  readonly normalizedNodePayloads: Readonly<Record<string, unknown>>;
  readonly authoredReferencedNodePayloads: Readonly<Record<string, unknown>>;
  readonly stepAddressedLegacyIssues: ReturnType<
    typeof collectStepAddressedAuthoredWorkflowFieldIssues
  >;
}

export interface WorkflowNodePersistencePlan {
  readonly nodeFile: string;
  readonly payload: unknown;
}

export interface WorkflowStepPersistencePlan {
  readonly stepFile: string;
  readonly step: WorkflowStepRef;
}

export interface WorkflowStaleFilePlan {
  readonly nodeFiles: readonly string[];
  readonly stepFiles: readonly string[];
  readonly promptTemplateFiles: readonly string[];
}

export interface SaveWorkflowPersistencePlan {
  readonly persistedWorkflow: AuthoredWorkflowJson;
  readonly nodesToPersist: readonly WorkflowNodePersistencePlan[];
  readonly stepsToPersist: readonly WorkflowStepPersistencePlan[];
  readonly staleFiles: WorkflowStaleFilePlan;
  readonly currentRevisionNodeFiles: readonly string[];
  readonly currentRevisionExtraFiles: readonly string[];
  readonly finalRevisionNodeFiles: readonly string[];
  readonly finalRevisionExtraFiles: readonly string[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnKey(
  value: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return value !== undefined && Object.hasOwn(value, key);
}

function projectAuthoredWorkflowFromNormalized(input: {
  readonly workflow: WorkflowJson;
  readonly persistManagerStepId: boolean;
}): AuthoredWorkflowJson {
  const { workflow } = input;

  return {
    workflowId: workflow.workflowId,
    ...(workflow.description.length === 0
      ? {}
      : { description: workflow.description }),
    defaults: {
      nodeTimeoutMs: workflow.defaults.nodeTimeoutMs,
      maxLoopIterations: workflow.defaults.maxLoopIterations,
      ...(workflow.defaults.fanoutConcurrency === undefined
        ? {}
        : { fanoutConcurrency: workflow.defaults.fanoutConcurrency }),
      ...(workflow.defaults.supervision === undefined
        ? {}
        : { supervision: workflow.defaults.supervision }),
      ...(workflow.defaults.timeoutPolicy === undefined
        ? {}
        : { timeoutPolicy: workflow.defaults.timeoutPolicy }),
      ...(workflow.defaults.containerRuntime === undefined ||
      isDefaultContainerRuntime(workflow.defaults.containerRuntime)
        ? {}
        : { containerRuntime: workflow.defaults.containerRuntime }),
    },
    ...(workflow.prompts === undefined ? {} : { prompts: workflow.prompts }),
    ...(input.persistManagerStepId &&
    workflow.hasManagerNode !== false &&
    workflow.managerStepId !== undefined
      ? { managerStepId: workflow.managerStepId }
      : {}),
    entryStepId: workflow.entryStepId,
    nodes: workflow.nodeRegistry.map(projectAuthoredWorkflowRegistryNode),
    steps: workflow.steps.map((step) =>
      step.stepFile === undefined
        ? {
            id: step.id,
            nodeId: step.nodeId,
            ...(step.description === undefined
              ? {}
              : { description: step.description }),
            ...(step.role === undefined ? {} : { role: step.role }),
            ...(step.promptVariant === undefined
              ? {}
              : { promptVariant: step.promptVariant }),
            ...(step.timeoutMs === undefined
              ? {}
              : { timeoutMs: step.timeoutMs }),
            ...(step.stallTimeoutMs === undefined
              ? {}
              : { stallTimeoutMs: step.stallTimeoutMs }),
            ...(step.sessionPolicy === undefined
              ? {}
              : { sessionPolicy: step.sessionPolicy }),
            ...(step.transitions === undefined
              ? {}
              : { transitions: step.transitions }),
          }
        : {
            id: step.id,
            stepFile: step.stepFile,
          },
    ),
  };
}

function projectAuthoredWorkflowRegistryNode(
  node: WorkflowNodeRegistryRef,
): WorkflowNodeRegistryRef {
  return { ...node };
}

function createPersistedWorkflowJson(input: {
  readonly workflow: WorkflowJson;
  readonly authoredWorkflow: AuthoredWorkflowRecord | undefined;
}): AuthoredWorkflowJson {
  const shouldPersistManagerStepId = (() => {
    if (
      input.workflow.hasManagerNode === false ||
      input.workflow.managerStepId === undefined
    ) {
      return false;
    }
    if (hasOwnKey(input.authoredWorkflow, "managerStepId")) {
      return true;
    }
    const explicitManagerSteps =
      input.workflow.steps?.filter((step) => step.role === "manager") ?? [];
    return !(
      explicitManagerSteps.length === 1 &&
      explicitManagerSteps[0]?.id === input.workflow.managerStepId
    );
  })();

  return projectAuthoredWorkflowFromNormalized({
    workflow: input.workflow,
    persistManagerStepId: shouldPersistManagerStepId,
  });
}

function createStepAddressedWorkflowForValidation(
  workflow: WorkflowJson,
): AuthoredWorkflowJson {
  return projectAuthoredWorkflowFromNormalized({
    workflow,
    persistManagerStepId:
      workflow.hasManagerNode !== false && workflow.managerStepId !== undefined,
  });
}

function collectReferencedNodePayloads(input: {
  readonly workflow: {
    readonly nodeRegistry?: readonly {
      readonly id: string;
      readonly nodeFile?: string;
      readonly addon?: unknown;
    }[];
    readonly steps?: readonly {
      readonly id: string;
      readonly role?: unknown;
      readonly promptVariant?: string;
      readonly timeoutMs?: number;
      readonly sessionPolicy?: unknown;
    }[];
    readonly nodes: readonly {
      readonly id: string;
      readonly nodeFile: string;
      readonly addon?: unknown;
    }[];
  };
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const referencedPayloads: Record<string, unknown> = {};
  const authoredNodes =
    input.workflow.nodeRegistry?.map((node) => ({
      id: node.id,
      ...(node.nodeFile === undefined ? {} : { nodeFile: node.nodeFile }),
      ...(node.addon === undefined ? {} : { addon: node.addon }),
    })) ?? input.workflow.nodes;
  for (const node of authoredNodes) {
    if (node.addon !== undefined) {
      continue;
    }
    if (node.nodeFile === undefined) {
      continue;
    }
    const prefersNodeFilePayload =
      input.workflow.nodeRegistry !== undefined &&
      hasStepAddressedDerivedNodePayload({
        workflow: input.workflow,
        nodeId: node.id,
        nodeFile: node.nodeFile,
        nodePayloads: input.nodePayloads,
      });
    const payload =
      input.workflow.nodeRegistry !== undefined
        ? prefersNodeFilePayload
          ? (input.nodePayloads[node.nodeFile] ?? input.nodePayloads[node.id])
          : (input.nodePayloads[node.id] ?? input.nodePayloads[node.nodeFile])
        : (input.nodePayloads[node.nodeFile] ?? input.nodePayloads[node.id]);
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
  if (!isRecord(workflow)) {
    return nodePayloads;
  }

  const nodesRaw = workflow["nodes"];
  if (!Array.isArray(nodesRaw)) {
    return nodePayloads;
  }

  const referencedPayloads: Record<string, unknown> = {};
  for (const node of nodesRaw) {
    if (!isRecord(node)) {
      continue;
    }

    const nodeId = typeof node["id"] === "string" ? node["id"] : undefined;
    const nodeFile = resolveAuthoredNodeFileReference(node);
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

function applyPromptVariantProjection(input: {
  readonly payload: Record<string, unknown>;
  readonly variant: Record<string, unknown>;
}): Record<string, unknown> {
  const projectedPayload = cloneNodeTemplateAwarePayload(input.payload);

  for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
    const variantTemplate = input.variant[spec.textField];
    const variantTemplateFile = input.variant[spec.fileField];
    if (variantTemplate === undefined && variantTemplateFile === undefined) {
      continue;
    }

    delete projectedPayload[spec.textField];
    delete projectedPayload[spec.fileField];
    if (variantTemplate !== undefined) {
      projectedPayload[spec.textField] = variantTemplate;
    }
    if (variantTemplateFile !== undefined) {
      projectedPayload[spec.fileField] = variantTemplateFile;
    }
  }

  return projectedPayload;
}

function hasStepAddressedDerivedNodePayload(input: {
  readonly workflow: {
    readonly managerStepId?: string;
    readonly steps?: readonly {
      readonly id: string;
      readonly role?: unknown;
      readonly promptVariant?: string;
      readonly timeoutMs?: number;
      readonly sessionPolicy?: unknown;
    }[];
  };
  readonly nodeId: string;
  readonly nodeFile: string;
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}): boolean {
  const step = input.workflow.steps?.find((entry) => entry.id === input.nodeId);
  if (step === undefined) {
    return false;
  }

  const nodeFilePayload = input.nodePayloads[input.nodeFile];
  const nodeIdPayload = input.nodePayloads[input.nodeId];
  if (!isRecord(nodeFilePayload) || !isRecord(nodeIdPayload)) {
    return false;
  }

  let stepProjectedPayload = cloneNodeTemplateAwarePayload(nodeFilePayload);
  stepProjectedPayload["id"] = step.id;
  if (step.timeoutMs === undefined) {
    delete stepProjectedPayload["timeoutMs"];
  } else {
    stepProjectedPayload["timeoutMs"] = step.timeoutMs;
  }
  const sessionPolicy =
    isRecord(step.sessionPolicy) &&
    typeof step.sessionPolicy["mode"] === "string"
      ? { mode: step.sessionPolicy["mode"] }
      : undefined;
  if (sessionPolicy === undefined) {
    delete stepProjectedPayload["sessionPolicy"];
  } else {
    stepProjectedPayload["sessionPolicy"] = sessionPolicy;
  }

  const isManagerStep =
    step.role === "manager" ||
    (step.role === undefined && input.workflow.managerStepId === step.id);
  if (isManagerStep) {
    stepProjectedPayload["managerType"] =
      typeof stepProjectedPayload["managerType"] === "string"
        ? stepProjectedPayload["managerType"]
        : "code";
  } else {
    delete stepProjectedPayload["managerType"];
  }

  if (step.promptVariant !== undefined) {
    const promptVariants = stepProjectedPayload["promptVariants"];
    const variantRaw =
      isRecord(promptVariants) && isRecord(promptVariants[step.promptVariant])
        ? promptVariants[step.promptVariant]
        : undefined;
    if (isRecord(variantRaw)) {
      stepProjectedPayload = applyPromptVariantProjection({
        payload: stepProjectedPayload,
        variant: variantRaw,
      });
    }
  }

  return isDeepStrictEqual(stepProjectedPayload, nodeIdPayload);
}

function preferStepAddressedRegistryIdPayloads(
  workflow: unknown,
  nodePayloads: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (!isRecord(workflow) || !Array.isArray(workflow["steps"])) {
    return nodePayloads;
  }
  const nodesRaw = workflow["nodes"];
  if (!Array.isArray(nodesRaw)) {
    return nodePayloads;
  }

  const preferredPayloads: Record<string, unknown> = { ...nodePayloads };
  for (const node of nodesRaw) {
    if (!isRecord(node)) {
      continue;
    }
    const nodeId =
      typeof node["id"] === "string" && node["id"].length > 0
        ? node["id"]
        : undefined;
    const nodeFile =
      typeof node["nodeFile"] === "string" && node["nodeFile"].length > 0
        ? node["nodeFile"]
        : undefined;
    if (nodeId === undefined || nodeFile === undefined) {
      continue;
    }
    const prefersNodeFilePayload = hasStepAddressedDerivedNodePayload({
      workflow,
      nodeId,
      nodeFile,
      nodePayloads,
    });
    if (
      nodePayloads[nodeId] !== undefined &&
      (preferredPayloads[nodeFile] === undefined || !prefersNodeFilePayload)
    ) {
      preferredPayloads[nodeFile] = nodePayloads[nodeId];
    }
  }
  return preferredPayloads;
}

export function buildWorkflowSaveValidationPlan(
  input: SaveWorkflowInput,
): SaveWorkflowValidationPlan {
  const normalizedInputWorkflow = isNormalizedStepAddressedWorkflow(
    input.workflow,
  )
    ? input.workflow
    : undefined;
  const stepAddressedLegacyIssues =
    normalizedInputWorkflow !== undefined
      ? collectStepAddressedAuthoredWorkflowFieldIssues(input.workflow)
      : [];
  const authoredWorkflow =
    normalizedInputWorkflow === undefined
      ? stripNormalizedWorkflowFieldsForPersistence(input.workflow)
      : createStepAddressedWorkflowForValidation(normalizedInputWorkflow);
  const normalizedNodePayloads = preferStepAddressedRegistryIdPayloads(
    authoredWorkflow,
    remapAuthoredNodePayloadsByNodeFile(authoredWorkflow, input.nodePayloads),
  );
  const authoredReferencedNodePayloads = collectAuthoredReferencedNodePayloads(
    authoredWorkflow,
    normalizedNodePayloads,
  );

  return {
    authoredWorkflow,
    normalizedNodePayloads,
    authoredReferencedNodePayloads,
    stepAddressedLegacyIssues,
  };
}

function createNodesToPersist(input: {
  readonly workflow: WorkflowJson;
  readonly normalizedNodePayloads: Readonly<Record<string, unknown>>;
}): Result<readonly WorkflowNodePersistencePlan[], SaveWorkflowFailure> {
  const nodesToPersist: WorkflowNodePersistencePlan[] = [];
  const authoredNodes =
    input.workflow.nodeRegistry?.map((node) => ({
      id: node.id,
      ...(node.nodeFile === undefined ? {} : { nodeFile: node.nodeFile }),
      ...(node.addon === undefined ? {} : { addon: node.addon }),
    })) ?? input.workflow.nodes;
  for (const node of authoredNodes) {
    if (node.addon !== undefined || node.nodeFile === undefined) {
      continue;
    }
    const prefersNodeFilePayload =
      input.workflow.nodeRegistry !== undefined &&
      hasStepAddressedDerivedNodePayload({
        workflow: input.workflow,
        nodeId: node.id,
        nodeFile: node.nodeFile,
        nodePayloads: input.normalizedNodePayloads,
      });
    const payload =
      input.workflow.nodeRegistry !== undefined
        ? prefersNodeFilePayload
          ? (input.normalizedNodePayloads[node.nodeFile] ??
            input.normalizedNodePayloads[node.id])
          : (input.normalizedNodePayloads[node.id] ??
            input.normalizedNodePayloads[node.nodeFile])
        : (input.normalizedNodePayloads[node.nodeFile] ??
          input.normalizedNodePayloads[node.id]);
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
    nodesToPersist.push({ nodeFile: node.nodeFile, payload });
  }

  return ok(nodesToPersist);
}

export function buildWorkflowSavePersistencePlan(input: {
  readonly workflow: WorkflowJson;
  readonly authoredWorkflow: unknown;
  readonly normalizedNodePayloads: Readonly<Record<string, unknown>>;
  readonly existingFileState: SaveWorkflowExistingFileState;
}): Result<SaveWorkflowPersistencePlan, SaveWorkflowFailure> {
  const nodeFiles = collectWorkflowRevisionNodeFiles(input.workflow);
  const stepFiles = collectWorkflowRevisionStepFiles(input.workflow);
  const referencedNodePayloads = collectReferencedNodePayloads({
    workflow: input.workflow,
    nodePayloads: input.normalizedNodePayloads,
  });
  const persistedPromptTemplateFiles = collectReferencedPromptTemplateFiles(
    referencedNodePayloads,
  );
  const nodesToPersist = createNodesToPersist({
    workflow: input.workflow,
    normalizedNodePayloads: input.normalizedNodePayloads,
  });
  if (!nodesToPersist.ok) {
    return err(nodesToPersist.error);
  }

  const persistedNodeFileSet = new Set(nodeFiles);
  const persistedStepFileSet = new Set(stepFiles);
  const staleFiles = {
    nodeFiles: input.existingFileState.existingNodeFiles.filter(
      (nodeFile) => !persistedNodeFileSet.has(nodeFile),
    ),
    stepFiles: input.existingFileState.existingStepFiles.filter(
      (stepFile) => !persistedStepFileSet.has(stepFile),
    ),
    promptTemplateFiles: [
      ...input.existingFileState.existingPromptTemplateFiles,
    ].filter((templateFile) => !persistedPromptTemplateFiles.has(templateFile)),
  };
  const existingAuthoredWorkflowRecord =
    input.existingFileState.existingAuthoredWorkflowRecord;

  return ok({
    persistedWorkflow: createPersistedWorkflowJson({
      workflow: input.workflow,
      authoredWorkflow: isRecord(input.authoredWorkflow)
        ? (input.authoredWorkflow as AuthoredWorkflowRecord)
        : undefined,
    }),
    nodesToPersist: nodesToPersist.value,
    stepsToPersist: input.workflow.steps.flatMap((step) =>
      step.stepFile === undefined ? [] : [{ stepFile: step.stepFile, step }],
    ),
    staleFiles,
    currentRevisionNodeFiles:
      existingAuthoredWorkflowRecord === undefined
        ? nodeFiles
        : input.existingFileState.existingNodeFiles,
    currentRevisionExtraFiles:
      existingAuthoredWorkflowRecord === undefined
        ? [...stepFiles, ...collectPromptTemplateFiles(referencedNodePayloads)]
        : [
            ...input.existingFileState.existingStepFiles,
            ...input.existingFileState.existingPromptTemplateFiles,
          ],
    finalRevisionNodeFiles: nodeFiles,
    finalRevisionExtraFiles: [
      ...stepFiles,
      ...collectPromptTemplateFiles(referencedNodePayloads),
    ],
  });
}

export function checkWorkflowSaveRevisionConflict(input: {
  readonly expectedRevision: string | undefined;
  readonly currentRevision: string | undefined;
}): SaveWorkflowFailure | undefined {
  if (
    input.expectedRevision !== undefined &&
    input.currentRevision !== undefined &&
    input.currentRevision !== input.expectedRevision
  ) {
    return {
      code: "CONFLICT",
      message: "workflow revision conflict",
      currentRevision: input.currentRevision,
    };
  }

  return undefined;
}

export function collectPayloadPromptTemplateFiles(
  payload: unknown,
): readonly string[] {
  return collectNodeTemplateFiles(payload);
}
