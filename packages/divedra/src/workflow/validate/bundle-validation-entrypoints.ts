import {
  remapAuthoredNodePayloadsByNodeFile,
  synthesizeInlineNodeFile,
} from "../authored-node";
import { validatePureWorkflowBundleDetailed } from "divedra-core/workflow-validation";
import {
  resolveBoundaryNodeAddonPayloadAsync,
  resolveBoundaryNodeAddonPayloadSync,
} from "../addon-package-boundary";
import { err, ok, type Result } from "../result";
import type {
  AsyncNodeAddonPayloadResolver,
  NodeAddonPayloadResolver,
  NodePayload,
  NormalizedWorkflowBundle,
  ValidationIssue,
  WorkflowJson,
  WorkflowNodeRegistryRef,
  WorkflowStepRef,
} from "../types";
import type {
  NodeStepRoleUsage,
  RawBundle,
  ValidationResult,
  ValidationSuccessDetails,
  WorkflowValidationOptions,
} from "./validation-types-and-runtime-options";
import { makeIssue } from "./validation-types-and-runtime-options";
import { normalizeWorkflow } from "./workflow-normalization";
import {
  collectStepNodeRoleUsage,
  normalizeNodePayload,
} from "./node-payload-validation";
import {
  collectNodeExecutabilityValidation,
  collectPassiveNodeExecutabilityValidation,
} from "./node-executability-validation";
import { applyWorkflowNodePatchToRawPayloads } from "../node-patches";
import type { NodeValidationResult } from "./node-validation-result";
import {
  applyStepPromptVariant,
  resolveAsyncNodeAddonResolvers,
  resolveSyncNodeAddonResolvers,
  runSemanticValidation,
  validateCrossWorkflowCalleeEntryAlignment,
  validateCrossWorkflowCalleeEntryAlignmentSync,
  validateResolvedAddonPayload,
} from "./semantic-validation-and-addons";

function registerStepAddressedNodePayload(input: {
  readonly node: WorkflowNodeRegistryRef;
  readonly nodePayloadsRaw: Readonly<Record<string, unknown>>;
  readonly issues: ValidationIssue[];
  readonly usage: NodeStepRoleUsage | undefined;
  readonly nodePayloads: Record<string, NodePayload>;
  readonly basePayloadsByRegistryId: Map<string, NodePayload>;
}): void {
  if (input.node.nodeFile === undefined) {
    return;
  }
  const payloadRaw = input.nodePayloadsRaw[input.node.nodeFile];
  if (payloadRaw === undefined) {
    input.issues.push(
      makeIssue(
        "error",
        `nodePayloads.${input.node.nodeFile}`,
        "node payload file is missing",
      ),
    );
    return;
  }
  const payload = normalizeNodePayload({
    nodeId: input.node.id,
    nodeFile: input.node.nodeFile,
    payload: payloadRaw,
    issues: input.issues,
    allowManagerCodePathDefaults:
      input.usage?.manager === true && input.usage.worker !== true,
  });
  if (payload !== null) {
    input.basePayloadsByRegistryId.set(input.node.id, payload);
    input.nodePayloads[input.node.id] = payload;
    input.nodePayloads[input.node.nodeFile] = payload;
  }
}

function applyStepAddressedPromptVariants(input: {
  readonly workflow: WorkflowJson;
  readonly steps: readonly WorkflowStepRef[];
  readonly issues: ValidationIssue[];
  readonly nodePayloads: Record<string, NodePayload>;
  readonly basePayloadsByRegistryId: ReadonlyMap<string, NodePayload>;
}): void {
  input.steps.forEach((step, index) => {
    const basePayload = input.basePayloadsByRegistryId.get(step.nodeId);
    if (basePayload === undefined) {
      return;
    }
    input.nodePayloads[step.id] = applyStepPromptVariant({
      basePayload,
      workflow: input.workflow,
      step,
      issues: input.issues,
      stepPath: `workflow.steps[${index}]`,
    });
  });
}

export function buildStepAddressedNodePayloadsSync(input: {
  readonly workflow: WorkflowJson;
  readonly nodePayloadsRaw: Readonly<Record<string, unknown>>;
  readonly issues: ValidationIssue[];
  readonly options: WorkflowValidationOptions;
  readonly nodeAddonResolvers: readonly NodeAddonPayloadResolver[] | undefined;
  readonly addonValidationResults: NodeValidationResult[];
}): Record<string, NodePayload> {
  const nodePayloads: Record<string, NodePayload> = {};
  const nodeRegistry = input.workflow.nodeRegistry ?? [];
  const steps = input.workflow.steps ?? [];
  const basePayloadsByRegistryId = new Map<string, NodePayload>();
  const nodeRoleUsage = collectStepNodeRoleUsage(input.workflow);

  nodeRegistry.forEach((node, index) => {
    const usage = nodeRoleUsage.get(node.id);
    if (node.addon !== undefined) {
      const resolved = resolveBoundaryNodeAddonPayloadSync({
        nodeId: node.id,
        addon: node.addon,
        path: `workflow.nodes[${index}].addon`,
        executablePreflight: input.options.executablePreflight === true,
        ...(input.options.resolvedWorkflowSource === undefined
          ? {}
          : { workflowSource: input.options.resolvedWorkflowSource }),
        options: input.options,
        ...(input.nodeAddonResolvers === undefined
          ? {}
          : { thirdPartyResolvers: input.nodeAddonResolvers }),
      });
      input.issues.push(...(resolved.issues ?? []));
      input.addonValidationResults.push(
        ...(resolved.nodeValidationResults ?? []),
      );
      if (
        resolved.payload !== undefined &&
        validateResolvedAddonPayload({
          authoredAddonName: node.addon.name,
          expectedNodeId: node.id,
          payload: resolved.payload,
          path: `workflow.nodes[${index}].addon`,
          issues: input.issues,
        })
      ) {
        const normalizedPayload = node.addon.name.startsWith("divedra/")
          ? (resolved.payload as NodePayload)
          : normalizeNodePayload({
              nodeId: node.id,
              nodeFile: node.nodeFile ?? synthesizeInlineNodeFile(node.id),
              payload: resolved.payload,
              issues: input.issues,
              path: `workflow.nodes[${index}].addon.payload`,
              allowManagerCodePathDefaults:
                usage?.manager === true && usage.worker !== true,
            });
        if (normalizedPayload !== null) {
          basePayloadsByRegistryId.set(node.id, normalizedPayload);
          nodePayloads[node.id] = normalizedPayload;
        }
      }
      return;
    }

    registerStepAddressedNodePayload({
      node,
      nodePayloadsRaw: input.nodePayloadsRaw,
      issues: input.issues,
      usage,
      nodePayloads,
      basePayloadsByRegistryId,
    });
  });

  applyStepAddressedPromptVariants({
    workflow: input.workflow,
    steps,
    issues: input.issues,
    nodePayloads,
    basePayloadsByRegistryId,
  });

  return nodePayloads;
}
export async function buildStepAddressedNodePayloadsAsync(input: {
  readonly workflow: WorkflowJson;
  readonly nodePayloadsRaw: Readonly<Record<string, unknown>>;
  readonly issues: ValidationIssue[];
  readonly options: WorkflowValidationOptions;
  readonly nodeAddonResolvers:
    | readonly AsyncNodeAddonPayloadResolver[]
    | undefined;
  readonly addonValidationResults: NodeValidationResult[];
}): Promise<Record<string, NodePayload>> {
  const nodePayloads: Record<string, NodePayload> = {};
  const nodeRegistry = input.workflow.nodeRegistry ?? [];
  const steps = input.workflow.steps ?? [];
  const basePayloadsByRegistryId = new Map<string, NodePayload>();
  const nodeRoleUsage = collectStepNodeRoleUsage(input.workflow);

  for (const [index, node] of nodeRegistry.entries()) {
    const usage = nodeRoleUsage.get(node.id);
    if (node.addon !== undefined) {
      const resolved = await resolveBoundaryNodeAddonPayloadAsync({
        nodeId: node.id,
        addon: node.addon,
        path: `workflow.nodes[${index}].addon`,
        executablePreflight: input.options.executablePreflight === true,
        ...(input.options.resolvedWorkflowSource === undefined
          ? {}
          : { workflowSource: input.options.resolvedWorkflowSource }),
        options: input.options,
        ...(input.nodeAddonResolvers === undefined
          ? {}
          : { thirdPartyResolvers: input.nodeAddonResolvers }),
      });
      input.issues.push(...(resolved.issues ?? []));
      input.addonValidationResults.push(
        ...(resolved.nodeValidationResults ?? []),
      );
      if (
        resolved.payload !== undefined &&
        validateResolvedAddonPayload({
          authoredAddonName: node.addon.name,
          expectedNodeId: node.id,
          payload: resolved.payload,
          path: `workflow.nodes[${index}].addon`,
          issues: input.issues,
        })
      ) {
        const normalizedPayload = node.addon.name.startsWith("divedra/")
          ? (resolved.payload as NodePayload)
          : normalizeNodePayload({
              nodeId: node.id,
              nodeFile: node.nodeFile ?? synthesizeInlineNodeFile(node.id),
              payload: resolved.payload,
              issues: input.issues,
              path: `workflow.nodes[${index}].addon.payload`,
              allowManagerCodePathDefaults:
                usage?.manager === true && usage.worker !== true,
            });
        if (normalizedPayload !== null) {
          basePayloadsByRegistryId.set(node.id, normalizedPayload);
          nodePayloads[node.id] = normalizedPayload;
        }
      }
      continue;
    }

    registerStepAddressedNodePayload({
      node,
      nodePayloadsRaw: input.nodePayloadsRaw,
      issues: input.issues,
      usage,
      nodePayloads,
      basePayloadsByRegistryId,
    });
  }

  applyStepAddressedPromptVariants({
    workflow: input.workflow,
    steps,
    issues: input.issues,
    nodePayloads,
    basePayloadsByRegistryId,
  });

  return nodePayloads;
}
export function validateWorkflowBundleDetailed(
  raw: RawBundle,
  options: WorkflowValidationOptions = {},
): Result<ValidationSuccessDetails, readonly ValidationIssue[]> {
  const pureValidation = validatePureWorkflowBundleDetailed(raw, {
    ...(options.allowResolvedStepFileFields === undefined
      ? {}
      : { allowResolvedStepFileFields: options.allowResolvedStepFileFields }),
  });
  const issues: ValidationIssue[] = pureValidation.ok
    ? [...pureValidation.value.issues]
    : [...pureValidation.error];
  let nodePayloadsRaw = remapAuthoredNodePayloadsByNodeFile(
    raw.workflow,
    raw.nodePayloads,
  );

  const workflow = pureValidation.ok
    ? pureValidation.value.workflow
    : normalizeWorkflow(raw.workflow, issues, options);

  const nodeAddonResolvers = resolveSyncNodeAddonResolvers(options, issues);
  const addonValidationResults: NodeValidationResult[] = [];

  if (workflow !== null && options.nodePatch !== undefined) {
    const patched = applyWorkflowNodePatchToRawPayloads({
      workflow,
      nodePayloadsRaw,
      patch: options.nodePatch,
      sourceLabel: "nodePatch",
    });
    if (patched.ok) {
      nodePayloadsRaw = patched.value;
    } else {
      issues.push(...patched.error);
    }
  }

  let nodePayloads: Record<string, NodePayload> = {};
  if (workflow !== null && workflow.nodeRegistry !== undefined) {
    nodePayloads = buildStepAddressedNodePayloadsSync({
      workflow,
      nodePayloadsRaw,
      issues,
      options,
      nodeAddonResolvers,
      addonValidationResults,
    });
  } else if (workflow !== null) {
    workflow.nodes.forEach((node, index) => {
      if (node.addon !== undefined) {
        const resolved = resolveBoundaryNodeAddonPayloadSync({
          nodeId: node.id,
          addon: node.addon,
          path: `workflow.nodes[${index}].addon`,
          executablePreflight: options.executablePreflight === true,
          ...(options.resolvedWorkflowSource === undefined
            ? {}
            : { workflowSource: options.resolvedWorkflowSource }),
          options,
          ...(nodeAddonResolvers === undefined
            ? {}
            : { thirdPartyResolvers: nodeAddonResolvers }),
        });
        issues.push(...(resolved.issues ?? []));
        addonValidationResults.push(...(resolved.nodeValidationResults ?? []));
        if (
          resolved.payload !== undefined &&
          validateResolvedAddonPayload({
            authoredAddonName: node.addon.name,
            expectedNodeId: node.id,
            payload: resolved.payload,
            path: `workflow.nodes[${index}].addon`,
            issues,
          })
        ) {
          if (node.addon.name.startsWith("divedra/")) {
            nodePayloads[node.id] = resolved.payload;
            return;
          }

          const normalizedPayload = normalizeNodePayload({
            nodeId: node.id,
            nodeFile: node.nodeFile,
            payload: resolved.payload,
            issues,
            path: `workflow.nodes[${index}].addon.payload`,
          });
          if (normalizedPayload !== null) {
            nodePayloads[node.id] = normalizedPayload;
          }
        }
        return;
      }

      const payloadRaw = nodePayloadsRaw[node.nodeFile];
      if (payloadRaw === undefined) {
        issues.push(
          makeIssue(
            "error",
            `nodePayloads.${node.nodeFile}`,
            "node payload file is missing",
          ),
        );
        return;
      }
      const payload = normalizeNodePayload({
        nodeId: node.id,
        nodeFile: node.nodeFile,
        payload: payloadRaw,
        issues,
      });
      if (payload !== null) {
        nodePayloads[node.id] = payload;
      }
    });
  }

  if (workflow === null) {
    return err(issues);
  }

  const bundle: NormalizedWorkflowBundle = {
    workflow,
    nodePayloads,
  };

  runSemanticValidation(bundle, issues);
  validateCrossWorkflowCalleeEntryAlignmentSync(bundle, options, issues);
  const nodeValidationResults = collectPassiveNodeExecutabilityValidation({
    bundle,
    options,
    addonValidationResults,
  });
  const allErrors = issues.filter((entry) => entry.severity === "error");
  if (allErrors.length > 0) {
    return err(issues);
  }

  return ok({ bundle, issues, nodeValidationResults });
}
export async function validateWorkflowBundleDetailedAsync(
  raw: RawBundle,
  options: WorkflowValidationOptions = {},
): Promise<Result<ValidationSuccessDetails, readonly ValidationIssue[]>> {
  const pureValidation = validatePureWorkflowBundleDetailed(raw, {
    ...(options.allowResolvedStepFileFields === undefined
      ? {}
      : { allowResolvedStepFileFields: options.allowResolvedStepFileFields }),
  });
  const issues: ValidationIssue[] = pureValidation.ok
    ? [...pureValidation.value.issues]
    : [...pureValidation.error];
  let nodePayloadsRaw = remapAuthoredNodePayloadsByNodeFile(
    raw.workflow,
    raw.nodePayloads,
  );

  const workflow = pureValidation.ok
    ? pureValidation.value.workflow
    : normalizeWorkflow(raw.workflow, issues, options);
  const nodeAddonResolvers = resolveAsyncNodeAddonResolvers(options);
  const addonValidationResults: NodeValidationResult[] = [];

  if (workflow !== null && options.nodePatch !== undefined) {
    const patched = applyWorkflowNodePatchToRawPayloads({
      workflow,
      nodePayloadsRaw,
      patch: options.nodePatch,
      sourceLabel: "nodePatch",
    });
    if (patched.ok) {
      nodePayloadsRaw = patched.value;
    } else {
      issues.push(...patched.error);
    }
  }

  let nodePayloads: Record<string, NodePayload> = {};
  if (workflow !== null && workflow.nodeRegistry !== undefined) {
    nodePayloads = await buildStepAddressedNodePayloadsAsync({
      workflow,
      nodePayloadsRaw,
      issues,
      options,
      nodeAddonResolvers,
      addonValidationResults,
    });
  } else if (workflow !== null) {
    for (const [index, node] of workflow.nodes.entries()) {
      if (node.addon !== undefined) {
        const resolved = await resolveBoundaryNodeAddonPayloadAsync({
          nodeId: node.id,
          addon: node.addon,
          path: `workflow.nodes[${index}].addon`,
          executablePreflight: options.executablePreflight === true,
          ...(options.resolvedWorkflowSource === undefined
            ? {}
            : { workflowSource: options.resolvedWorkflowSource }),
          options,
          ...(nodeAddonResolvers === undefined
            ? {}
            : { thirdPartyResolvers: nodeAddonResolvers }),
        });
        issues.push(...(resolved.issues ?? []));
        addonValidationResults.push(...(resolved.nodeValidationResults ?? []));
        if (
          resolved.payload !== undefined &&
          validateResolvedAddonPayload({
            authoredAddonName: node.addon.name,
            expectedNodeId: node.id,
            payload: resolved.payload,
            path: `workflow.nodes[${index}].addon`,
            issues,
          })
        ) {
          if (node.addon.name.startsWith("divedra/")) {
            nodePayloads[node.id] = resolved.payload;
            continue;
          }

          const normalizedPayload = normalizeNodePayload({
            nodeId: node.id,
            nodeFile: node.nodeFile,
            payload: resolved.payload,
            issues,
            path: `workflow.nodes[${index}].addon.payload`,
          });
          if (normalizedPayload !== null) {
            nodePayloads[node.id] = normalizedPayload;
          }
        }
        continue;
      }

      const payloadRaw = nodePayloadsRaw[node.nodeFile];
      if (payloadRaw === undefined) {
        issues.push(
          makeIssue(
            "error",
            `nodePayloads.${node.nodeFile}`,
            "node payload file is missing",
          ),
        );
        continue;
      }
      const payload = normalizeNodePayload({
        nodeId: node.id,
        nodeFile: node.nodeFile,
        payload: payloadRaw,
        issues,
      });
      if (payload !== null) {
        nodePayloads[node.id] = payload;
      }
    }
  }

  if (workflow === null) {
    return err(issues);
  }

  const bundle: NormalizedWorkflowBundle = {
    workflow,
    nodePayloads,
  };

  runSemanticValidation(bundle, issues);
  await validateCrossWorkflowCalleeEntryAlignment(bundle, options, issues);
  const nodeValidationResults = await collectNodeExecutabilityValidation({
    bundle,
    options,
    addonValidationResults,
  });
  const allErrors = issues.filter((entry) => entry.severity === "error");
  if (allErrors.length > 0) {
    return err(issues);
  }

  return ok({ bundle, issues, nodeValidationResults });
}
export function validateWorkflowBundle(
  raw: RawBundle,
  options: WorkflowValidationOptions = {},
): ValidationResult {
  const validation = validateWorkflowBundleDetailed(raw, options);
  if (!validation.ok) {
    return err(validation.error);
  }
  return ok(validation.value.bundle);
}
export async function validateWorkflowBundleAsync(
  raw: RawBundle,
  options: WorkflowValidationOptions = {},
): Promise<ValidationResult> {
  const validation = await validateWorkflowBundleDetailedAsync(raw, options);
  if (!validation.ok) {
    return err(validation.error);
  }
  return ok(validation.value.bundle);
}
