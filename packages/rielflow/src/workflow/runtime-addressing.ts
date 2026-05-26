import type { AgentNodePayload, WorkflowJson } from "./types";

export interface StepIdentityFields {
  readonly stepId?: string;
  readonly nodeRegistryId?: string;
}

export interface StepExecutionAddress extends StepIdentityFields {
  readonly promptVariant?: string;
  readonly timeoutMs?: number;
  readonly inheritFromStepId?: string;
}

export interface ResolvedStepExecutionAddress extends StepExecutionAddress {
  readonly stepId: string;
  readonly nodeRegistryId: string;
}

export interface BackendSessionSelection extends StepIdentityFields {
  readonly sessionLookupNodeId?: string;
  readonly inheritFromStepId?: string;
  readonly promptVariant?: string;
}

export function resolveRequiredStepExecutionAddress(
  workflow: WorkflowJson,
  runtimeNodeId: string,
): ResolvedStepExecutionAddress | undefined {
  const step = workflow.steps.find((entry) => entry.id === runtimeNodeId);
  if (step === undefined) {
    return undefined;
  }

  return {
    stepId: step.id,
    nodeRegistryId: step.nodeId,
    ...(step.promptVariant === undefined
      ? {}
      : { promptVariant: step.promptVariant }),
    ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
    ...(step.sessionPolicy?.inheritFromStepId === undefined
      ? {}
      : { inheritFromStepId: step.sessionPolicy.inheritFromStepId }),
  };
}

export function resolveStepExecutionAddress(
  workflow: WorkflowJson,
  runtimeNodeId: string,
): StepExecutionAddress {
  return resolveRequiredStepExecutionAddress(workflow, runtimeNodeId) ?? {};
}

export function toStepIdentityFields(
  input: StepIdentityFields,
): StepIdentityFields {
  return {
    ...(input.stepId === undefined ? {} : { stepId: input.stepId }),
    ...(input.nodeRegistryId === undefined
      ? {}
      : { nodeRegistryId: input.nodeRegistryId }),
  };
}

export function resolveBackendSessionSelection(
  stepExecutionAddress: StepExecutionAddress,
  node: AgentNodePayload,
): BackendSessionSelection {
  if (node.sessionPolicy?.mode !== "reuse") {
    return {};
  }

  return {
    sessionLookupNodeId: stepExecutionAddress.inheritFromStepId ?? node.id,
    ...(stepExecutionAddress.inheritFromStepId === undefined
      ? {}
      : { inheritFromStepId: stepExecutionAddress.inheritFromStepId }),
    ...toStepIdentityFields(stepExecutionAddress),
    ...(stepExecutionAddress.promptVariant === undefined
      ? {}
      : { promptVariant: stepExecutionAddress.promptVariant }),
  };
}

/**
 * True when `runtimeNodeId` matches a workflow node ref with kind `output`.
 * Used for workflow-output runtime variables and external publication selection.
 * This is unrelated to which manager runtime id is recorded on communication
 * delivery metadata (`deliveredByNodeId`).
 */
export function isWorkflowOutputKindNode(
  workflow: WorkflowJson,
  runtimeNodeId: string,
): boolean {
  const node = workflow.nodes.find((entry) => entry.id === runtimeNodeId);
  return node?.kind === "output";
}
