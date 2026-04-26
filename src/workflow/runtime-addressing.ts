import type { AgentNodePayload, SubWorkflowRef, WorkflowJson } from "./types";

export interface StepExecutionAddress {
  readonly stepId?: string;
  readonly nodeRegistryId?: string;
  readonly promptVariant?: string;
  readonly timeoutMs?: number;
  readonly inheritFromStepId?: string;
}

export interface BackendSessionSelection {
  readonly sessionLookupNodeId?: string;
  readonly inheritFromStepId?: string;
  readonly nodeRegistryId?: string;
  readonly stepId?: string;
  readonly promptVariant?: string;
}

export function resolveStepExecutionAddress(
  workflow: WorkflowJson,
  runtimeNodeId: string,
): StepExecutionAddress {
  const step = workflow.steps?.find((entry) => entry.id === runtimeNodeId);
  return {
    ...(step?.id === undefined ? {} : { stepId: step.id }),
    ...(step?.nodeId === undefined ? {} : { nodeRegistryId: step.nodeId }),
    ...(step?.promptVariant === undefined
      ? {}
      : { promptVariant: step.promptVariant }),
    ...(step?.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
    ...(step?.sessionPolicy?.inheritFromStepId === undefined
      ? {}
      : { inheritFromStepId: step.sessionPolicy.inheritFromStepId }),
  };
}

export function resolveBackendSessionSelection(
  workflow: WorkflowJson,
  runtimeNodeId: string,
  node: AgentNodePayload,
): BackendSessionSelection {
  if (node.sessionPolicy?.mode !== "reuse") {
    return {};
  }

  const stepExecutionAddress = resolveStepExecutionAddress(
    workflow,
    runtimeNodeId,
  );
  return {
    sessionLookupNodeId: stepExecutionAddress.inheritFromStepId ?? node.id,
    ...(stepExecutionAddress.inheritFromStepId === undefined
      ? {}
      : { inheritFromStepId: stepExecutionAddress.inheritFromStepId }),
    ...(stepExecutionAddress.nodeRegistryId === undefined
      ? {}
      : { nodeRegistryId: stepExecutionAddress.nodeRegistryId }),
    ...(stepExecutionAddress.stepId === undefined
      ? {}
      : { stepId: stepExecutionAddress.stepId }),
    ...(stepExecutionAddress.promptVariant === undefined
      ? {}
      : { promptVariant: stepExecutionAddress.promptVariant }),
  };
}

export function findOwningSubWorkflowByRuntimeNodeId(
  workflow: WorkflowJson,
  runtimeNodeId: string,
): SubWorkflowRef | undefined {
  return workflow.subWorkflows.find((entry) => {
    if (entry.nodeIds?.includes(runtimeNodeId) ?? false) {
      return true;
    }
    return (
      entry.managerNodeId === runtimeNodeId ||
      entry.inputNodeId === runtimeNodeId ||
      entry.outputNodeId === runtimeNodeId
    );
  });
}

export function isRootScopeOutputNode(
  workflow: WorkflowJson,
  runtimeNodeId: string,
): boolean {
  const node = workflow.nodes.find((entry) => entry.id === runtimeNodeId);
  return (
    node?.kind === "output" &&
    findOwningSubWorkflowByRuntimeNodeId(workflow, runtimeNodeId) === undefined
  );
}
