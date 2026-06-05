import {
  applyWorkflowNodePatch,
  normalizeWorkflowNodePatchMap,
} from "./node-patches";
import { resolveEffectiveRoots, resolveWorkflowScopedPath } from "./paths";
import { err, ok, type Result } from "./result";
import {
  validateWorkflowBundleDetailedAsync,
  type NodeValidationResult,
} from "./validate";
import type { LoadedWorkflow, LoadFailure } from "./load";
import type {
  LoadOptions,
  NormalizedWorkflowBundle,
  ValidationIssue,
  WorkflowNodePatch,
  WorkflowNodePatchMap,
} from "./types";

export interface WorkflowExtendsSpec {
  readonly workflowId: string;
  readonly agentNodePatch?: WorkflowNodePatch;
  readonly nodePatch?: WorkflowNodePatchMap;
  readonly stringReplacements?: readonly (readonly [string, string])[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseWorkflowExtendsSpec(
  workflow: unknown,
): Result<WorkflowExtendsSpec | undefined, LoadFailure> {
  if (!isRecord(workflow) || workflow["extends"] === undefined) {
    return ok(undefined);
  }
  const extendsRaw = workflow["extends"];
  if (!isRecord(extendsRaw)) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: [
        {
          severity: "error",
          path: "workflow.extends",
          message: "must be an object when provided",
        },
      ],
    });
  }

  const workflowId = recordString(extendsRaw, "workflowId");
  if (workflowId === undefined) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: [
        {
          severity: "error",
          path: "workflow.extends.workflowId",
          message: "must be a non-empty string",
        },
      ],
    });
  }

  let agentNodePatch: WorkflowNodePatch | undefined;
  if (extendsRaw["agentNodePatch"] !== undefined) {
    const normalized = normalizeWorkflowNodePatchMap(
      { "*": extendsRaw["agentNodePatch"] },
      "workflow.extends.agentNodePatch",
    );
    if (!normalized.ok) {
      return err({
        code: "VALIDATION",
        message: "workflow validation failed",
        issues: normalized.error.map((issue) => ({
          ...issue,
          path: issue.path.replace(
            /^nodePatch\.\*/u,
            "workflow.extends.agentNodePatch",
          ),
        })),
      });
    }
    agentNodePatch = normalized.value["*"];
  }

  let nodePatch: WorkflowNodePatchMap | undefined;
  if (extendsRaw["nodePatch"] !== undefined) {
    const normalized = normalizeWorkflowNodePatchMap(
      extendsRaw["nodePatch"],
      "workflow.extends.nodePatch",
    );
    if (!normalized.ok) {
      return err({
        code: "VALIDATION",
        message: "workflow validation failed",
        issues: normalized.error.map((issue) => ({
          ...issue,
          path: issue.path.replace(/^nodePatch/u, "workflow.extends.nodePatch"),
        })),
      });
    }
    nodePatch = normalized.value;
  }

  let stringReplacements: readonly (readonly [string, string])[] | undefined;
  if (extendsRaw["stringReplacements"] !== undefined) {
    const replacementsRaw = extendsRaw["stringReplacements"];
    if (!isRecord(replacementsRaw)) {
      return err({
        code: "VALIDATION",
        message: "workflow validation failed",
        issues: [
          {
            severity: "error",
            path: "workflow.extends.stringReplacements",
            message: "must be an object keyed by source string",
          },
        ],
      });
    }
    const replacements: (readonly [string, string])[] = [];
    for (const [source, target] of Object.entries(replacementsRaw)) {
      if (source.length === 0 || typeof target !== "string") {
        return err({
          code: "VALIDATION",
          message: "workflow validation failed",
          issues: [
            {
              severity: "error",
              path: `workflow.extends.stringReplacements.${source}`,
              message:
                "replacement keys must be non-empty and values must be strings",
            },
          ],
        });
      }
      replacements.push([source, target]);
    }
    stringReplacements = replacements;
  }

  return ok({
    workflowId,
    ...(agentNodePatch === undefined ? {} : { agentNodePatch }),
    ...(nodePatch === undefined ? {} : { nodePatch }),
    ...(stringReplacements === undefined ? {} : { stringReplacements }),
  });
}

function mergeWorkflowNodePatches(
  left: WorkflowNodePatchMap | undefined,
  right: WorkflowNodePatchMap | undefined,
): WorkflowNodePatchMap | undefined {
  if (left === undefined && right === undefined) {
    return undefined;
  }
  const merged: Record<string, WorkflowNodePatch> = {};
  for (const [nodeId, patch] of Object.entries(left ?? {})) {
    merged[nodeId] = patch;
  }
  for (const [nodeId, patch] of Object.entries(right ?? {})) {
    merged[nodeId] = {
      ...(merged[nodeId] ?? {}),
      ...patch,
    };
  }
  return merged;
}

function authoredWorkflowForValidation(
  workflow: NormalizedWorkflowBundle["workflow"],
): Readonly<Record<string, unknown>> {
  const {
    nodeRegistry,
    nodes: _nodes,
    hasManagerNode: _hasManagerNode,
    ...workflowFields
  } = workflow;
  return {
    ...workflowFields,
    nodes: nodeRegistry,
  };
}

async function validateResolvedInheritedBundle(
  bundle: NormalizedWorkflowBundle,
  options: LoadOptions,
): Promise<
  Result<
    {
      readonly bundle: NormalizedWorkflowBundle;
      readonly issues: readonly ValidationIssue[];
      readonly nodeValidationResults: readonly NodeValidationResult[];
    },
    LoadFailure
  >
> {
  const validation = await validateWorkflowBundleDetailedAsync(
    {
      workflow: authoredWorkflowForValidation(bundle.workflow),
      nodePayloads: bundle.nodePayloads,
    },
    {
      ...options,
      allowResolvedStepFileFields: true,
    },
  );
  if (!validation.ok) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: validation.error,
    });
  }

  return ok(validation.value);
}

function isAgentNodePayload(value: unknown): boolean {
  return (
    isRecord(value) &&
    (typeof value["executionBackend"] === "string" ||
      typeof value["model"] === "string")
  );
}

function applyStringReplacements(
  value: unknown,
  replacements: readonly (readonly [string, string])[] | undefined,
): unknown {
  if (replacements === undefined || replacements.length === 0) {
    return value;
  }
  if (typeof value === "string") {
    return replacements.reduce(
      (current, [source, target]) => current.split(source).join(target),
      value,
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => applyStringReplacements(entry, replacements));
  }
  if (!isRecord(value)) {
    return value;
  }

  const replaced: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    replaced[key] = applyStringReplacements(entry, replacements);
  }
  return replaced;
}

function agentNodePatchMapForBundle(
  bundle: NormalizedWorkflowBundle,
  patch: WorkflowNodePatch | undefined,
  fileBackedNodeIds: ReadonlySet<string> | undefined,
): WorkflowNodePatchMap | undefined {
  if (patch === undefined) {
    return undefined;
  }

  const mapped: Record<string, WorkflowNodePatch> = {};
  for (const node of bundle.workflow.nodeRegistry) {
    if (node.addon !== undefined || node.nodeFile === undefined) {
      continue;
    }
    if (fileBackedNodeIds !== undefined && !fileBackedNodeIds.has(node.id)) {
      continue;
    }
    const payload =
      bundle.nodePayloads[node.id] ?? bundle.nodePayloads[node.nodeFile];
    if (isAgentNodePayload(payload)) {
      mapped[node.id] = patch;
    }
  }

  return Object.keys(mapped).length === 0 ? undefined : mapped;
}

function fileBackedNodeIdsFromWorkflowJson(
  rawText: string,
  replacements: readonly (readonly [string, string])[] | undefined,
): ReadonlySet<string> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["nodes"])) {
    return new Set();
  }

  const ids = new Set<string>();
  for (const node of parsed["nodes"]) {
    if (!isRecord(node)) {
      continue;
    }
    const id = recordString(node, "id");
    const nodeFile = recordString(node, "nodeFile");
    if (id === undefined || nodeFile === undefined) {
      continue;
    }
    const replacedId = applyStringReplacements(id, replacements);
    if (typeof replacedId === "string") {
      ids.add(replacedId);
    }
  }
  return ids;
}

export async function loadInheritedWorkflowFromDisk(input: {
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly rawText: string;
  readonly workflow: Readonly<Record<string, unknown>>;
  readonly spec: WorkflowExtendsSpec;
  readonly options: LoadOptions;
  readonly inheritanceStack: readonly string[];
  readonly loadBaseWorkflowById: (
    workflowId: string,
    options: LoadOptions,
    inheritanceStack: readonly string[],
  ) => Promise<Result<LoadedWorkflow, LoadFailure>>;
}): Promise<Result<LoadedWorkflow, LoadFailure>> {
  const workflowId = recordString(input.workflow, "workflowId");
  if (workflowId === undefined) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: [
        {
          severity: "error",
          path: "workflow.workflowId",
          message: "must be a non-empty string",
        },
      ],
    });
  }
  const inheritanceChain = [...input.inheritanceStack, workflowId];
  if (inheritanceChain.includes(input.spec.workflowId)) {
    return err({
      code: "VALIDATION",
      message: `workflow inheritance cycle detected: ${[
        ...inheritanceChain,
        input.spec.workflowId,
      ].join(" -> ")}`,
    });
  }

  const {
    workflowBundleDirectoryOverride: _workflowBundleDirectoryOverride,
    nodePatch: _nodePatch,
    ...baseOptions
  } = input.options;
  const base = await input.loadBaseWorkflowById(
    input.spec.workflowId,
    baseOptions,
    inheritanceChain,
  );
  if (!base.ok) {
    return base;
  }

  const replacedBundle = applyStringReplacements(
    base.value.bundle,
    input.spec.stringReplacements,
  ) as NormalizedWorkflowBundle;
  const inheritedBundle: NormalizedWorkflowBundle = {
    ...replacedBundle,
    workflow: {
      ...replacedBundle.workflow,
      workflowId,
      ...(typeof input.workflow["description"] === "string"
        ? { description: input.workflow["description"] }
        : {}),
    },
  };
  const inheritedPatch = mergeWorkflowNodePatches(
    agentNodePatchMapForBundle(
      inheritedBundle,
      input.spec.agentNodePatch,
      fileBackedNodeIdsFromWorkflowJson(
        base.value.workflowDefinitionJsonBody,
        input.spec.stringReplacements,
      ),
    ),
    input.spec.nodePatch,
  );
  const patchedBundle =
    inheritedPatch === undefined
      ? ok(inheritedBundle)
      : applyWorkflowNodePatch({
          bundle: inheritedBundle,
          patch: inheritedPatch,
          sourceLabel: "workflow.extends",
        });
  if (!patchedBundle.ok) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: patchedBundle.error.map((issue) => ({
        ...issue,
        path: issue.path.replace(/^nodePatch/u, "workflow.extends.nodePatch"),
      })),
    });
  }
  const validation = await validateResolvedInheritedBundle(
    patchedBundle.value,
    input.options,
  );
  if (!validation.ok) {
    return validation;
  }

  const roots = resolveEffectiveRoots(input.options);
  const artifactWorkflowRoot = resolveWorkflowScopedPath(
    roots.artifactRoot,
    validation.value.bundle.workflow.workflowId,
  );
  if (artifactWorkflowRoot === undefined) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: [
        {
          severity: "error",
          path: "workflow.workflowId",
          message:
            "must start with an alphanumeric character and contain only letters, digits, hyphens, or underscores",
        },
      ],
    });
  }

  return ok({
    workflowName: input.workflowName,
    workflowDirectory: input.workflowDirectory,
    artifactWorkflowRoot,
    workflowDefinitionJsonBody: input.rawText,
    bundle: validation.value.bundle,
    validationIssues: validation.value.issues,
    nodeValidationResults: validation.value.nodeValidationResults,
  });
}
