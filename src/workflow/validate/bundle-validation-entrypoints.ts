import {
  remapAuthoredNodePayloadsByNodeFile,
  synthesizeInlineNodeFile,
} from "../authored-node";
import {
  resolveNodeAddonPayload,
  resolveNodeAddonPayloadAsync,
} from "../node-addons";
import { err, ok, type Result } from "../result";
import type {
  AsyncNodeAddonPayloadResolver,
  NodeAddonPayloadResolver,
  NodePayload,
  NormalizedWorkflowBundle,
  ValidationIssue,
  WorkflowJson,
} from "../types";
import type {
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
  applyStepPromptVariant,
  resolveAsyncNodeAddonResolvers,
  resolveSyncNodeAddonResolvers,
  runSemanticValidation,
  validateCrossWorkflowCalleeEntryAlignment,
  validateCrossWorkflowCalleeEntryAlignmentSync,
  validateResolvedAddonPayload,
} from "./semantic-validation-and-addons";

export function buildStepAddressedNodePayloadsSync(input: {
  readonly workflow: WorkflowJson;
  readonly nodePayloadsRaw: Readonly<Record<string, unknown>>;
  readonly issues: ValidationIssue[];
  readonly options: WorkflowValidationOptions;
  readonly nodeAddonResolvers: readonly NodeAddonPayloadResolver[] | undefined;
}): Record<string, NodePayload> {
  const nodePayloads: Record<string, NodePayload> = {};
  const nodeRegistry = input.workflow.nodeRegistry ?? [];
  const steps = input.workflow.steps ?? [];
  const basePayloadsByRegistryId = new Map<string, NodePayload>();
  const nodeRoleUsage = collectStepNodeRoleUsage(input.workflow);

  nodeRegistry.forEach((node, index) => {
    const usage = nodeRoleUsage.get(node.id);
    if (node.addon !== undefined) {
      const resolved = resolveNodeAddonPayload({
        nodeId: node.id,
        addon: node.addon,
        path: `workflow.nodes[${index}].addon`,
        ...(input.options.resolvedWorkflowSource === undefined
          ? {}
          : { workflowSource: input.options.resolvedWorkflowSource }),
        options: input.options,
        ...(input.nodeAddonResolvers === undefined
          ? {}
          : { thirdPartyResolvers: input.nodeAddonResolvers }),
      });
      input.issues.push(...(resolved.issues ?? []));
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

    if (node.nodeFile === undefined) {
      return;
    }
    const payloadRaw = input.nodePayloadsRaw[node.nodeFile];
    if (payloadRaw === undefined) {
      input.issues.push(
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
      issues: input.issues,
      allowManagerCodePathDefaults:
        usage?.manager === true && usage.worker !== true,
    });
    if (payload !== null) {
      basePayloadsByRegistryId.set(node.id, payload);
      nodePayloads[node.id] = payload;
      nodePayloads[node.nodeFile] = payload;
    }
  });

  steps.forEach((step, index) => {
    const basePayload = basePayloadsByRegistryId.get(step.nodeId);
    if (basePayload === undefined) {
      return;
    }
    nodePayloads[step.id] = applyStepPromptVariant({
      basePayload,
      workflow: input.workflow,
      step,
      issues: input.issues,
      stepPath: `workflow.steps[${index}]`,
    });
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
}): Promise<Record<string, NodePayload>> {
  const nodePayloads: Record<string, NodePayload> = {};
  const nodeRegistry = input.workflow.nodeRegistry ?? [];
  const steps = input.workflow.steps ?? [];
  const basePayloadsByRegistryId = new Map<string, NodePayload>();
  const nodeRoleUsage = collectStepNodeRoleUsage(input.workflow);

  for (const [index, node] of nodeRegistry.entries()) {
    const usage = nodeRoleUsage.get(node.id);
    if (node.addon !== undefined) {
      const resolved = await resolveNodeAddonPayloadAsync({
        nodeId: node.id,
        addon: node.addon,
        path: `workflow.nodes[${index}].addon`,
        ...(input.options.resolvedWorkflowSource === undefined
          ? {}
          : { workflowSource: input.options.resolvedWorkflowSource }),
        options: input.options,
        ...(input.nodeAddonResolvers === undefined
          ? {}
          : { thirdPartyResolvers: input.nodeAddonResolvers }),
      });
      input.issues.push(...(resolved.issues ?? []));
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

    if (node.nodeFile === undefined) {
      continue;
    }
    const payloadRaw = input.nodePayloadsRaw[node.nodeFile];
    if (payloadRaw === undefined) {
      input.issues.push(
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
      issues: input.issues,
      allowManagerCodePathDefaults:
        usage?.manager === true && usage.worker !== true,
    });
    if (payload !== null) {
      basePayloadsByRegistryId.set(node.id, payload);
      nodePayloads[node.id] = payload;
      nodePayloads[node.nodeFile] = payload;
    }
  }

  steps.forEach((step, index) => {
    const basePayload = basePayloadsByRegistryId.get(step.nodeId);
    if (basePayload === undefined) {
      return;
    }
    nodePayloads[step.id] = applyStepPromptVariant({
      basePayload,
      workflow: input.workflow,
      step,
      issues: input.issues,
      stepPath: `workflow.steps[${index}]`,
    });
  });

  return nodePayloads;
}
export function validateWorkflowBundleDetailed(
  raw: RawBundle,
  options: WorkflowValidationOptions = {},
): Result<ValidationSuccessDetails, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const nodePayloadsRaw = remapAuthoredNodePayloadsByNodeFile(
    raw.workflow,
    raw.nodePayloads,
  );

  const workflow = normalizeWorkflow(raw.workflow, issues, options);

  const nodeAddonResolvers = resolveSyncNodeAddonResolvers(options, issues);

  let nodePayloads: Record<string, NodePayload> = {};
  if (workflow !== null && workflow.nodeRegistry !== undefined) {
    nodePayloads = buildStepAddressedNodePayloadsSync({
      workflow,
      nodePayloadsRaw,
      issues,
      options,
      nodeAddonResolvers,
    });
  } else if (workflow !== null) {
    workflow.nodes.forEach((node, index) => {
      if (node.addon !== undefined) {
        const resolved = resolveNodeAddonPayload({
          nodeId: node.id,
          addon: node.addon,
          path: `workflow.nodes[${index}].addon`,
          ...(options.resolvedWorkflowSource === undefined
            ? {}
            : { workflowSource: options.resolvedWorkflowSource }),
          options,
          ...(nodeAddonResolvers === undefined
            ? {}
            : { thirdPartyResolvers: nodeAddonResolvers }),
        });
        issues.push(...(resolved.issues ?? []));
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
  const allErrors = issues.filter((entry) => entry.severity === "error");
  if (allErrors.length > 0) {
    return err(issues);
  }

  return ok({ bundle, issues });
}
export async function validateWorkflowBundleDetailedAsync(
  raw: RawBundle,
  options: WorkflowValidationOptions = {},
): Promise<Result<ValidationSuccessDetails, readonly ValidationIssue[]>> {
  const issues: ValidationIssue[] = [];
  const nodePayloadsRaw = remapAuthoredNodePayloadsByNodeFile(
    raw.workflow,
    raw.nodePayloads,
  );

  const workflow = normalizeWorkflow(raw.workflow, issues, options);
  const nodeAddonResolvers = resolveAsyncNodeAddonResolvers(options);

  let nodePayloads: Record<string, NodePayload> = {};
  if (workflow !== null && workflow.nodeRegistry !== undefined) {
    nodePayloads = await buildStepAddressedNodePayloadsAsync({
      workflow,
      nodePayloadsRaw,
      issues,
      options,
      nodeAddonResolvers,
    });
  } else if (workflow !== null) {
    for (const [index, node] of workflow.nodes.entries()) {
      if (node.addon !== undefined) {
        const resolved = await resolveNodeAddonPayloadAsync({
          nodeId: node.id,
          addon: node.addon,
          path: `workflow.nodes[${index}].addon`,
          ...(options.resolvedWorkflowSource === undefined
            ? {}
            : { workflowSource: options.resolvedWorkflowSource }),
          options,
          ...(nodeAddonResolvers === undefined
            ? {}
            : { thirdPartyResolvers: nodeAddonResolvers }),
        });
        issues.push(...(resolved.issues ?? []));
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
  const allErrors = issues.filter((entry) => entry.severity === "error");
  if (allErrors.length > 0) {
    return err(issues);
  }

  return ok({ bundle, issues });
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
