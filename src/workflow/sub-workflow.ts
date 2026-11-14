import type {
  CommunicationRecord,
  NodeExecutionRecord,
  WorkflowSessionState,
} from "./session";
import type {
  SubWorkflowInputSource,
  SubWorkflowRef,
  WorkflowJson,
} from "./types";

function findLatestSucceededExecution(
  session: WorkflowSessionState,
  nodeId: string,
): NodeExecutionRecord | undefined {
  return [...session.nodeExecutions]
    .reverse()
    .find((entry) => entry.nodeId === nodeId && entry.status === "succeeded");
}

function sourceSatisfied(
  source: SubWorkflowInputSource,
  workflow: WorkflowJson,
  session: WorkflowSessionState,
): boolean {
  if (source.type === "human-input") {
    return session.runtimeVariables["humanInput"] !== undefined;
  }
  if (source.type === "workflow-output") {
    return session.runtimeVariables["workflowOutput"] !== undefined;
  }
  if (source.type === "node-output") {
    if (source.nodeId === undefined) {
      return false;
    }
    return findLatestSucceededExecution(session, source.nodeId) !== undefined;
  }
  if (source.type === "sub-workflow-output") {
    if (source.subWorkflowId === undefined) {
      return false;
    }
    const referenced = workflow.subWorkflows.find(
      (entry) => entry.id === source.subWorkflowId,
    );
    if (referenced === undefined) {
      return false;
    }
    return (
      findLatestSucceededExecution(session, referenced.outputNodeId) !==
      undefined
    );
  }
  return false;
}

function hasPendingDeliveryToTargets(
  communications: readonly CommunicationRecord[],
  targetNodeIds: ReadonlySet<string>,
): boolean {
  return communications.some((communication) => {
    if (
      communication.status !== "created" &&
      communication.status !== "delivered"
    ) {
      return false;
    }
    return targetNodeIds.has(communication.toNodeId);
  });
}

function subWorkflowAlreadyStarted(
  subWorkflow: SubWorkflowRef,
  workflow: WorkflowJson,
  session: WorkflowSessionState,
): boolean {
  const targetNodeIds = new Set([subWorkflow.inputNodeId]);
  if (subWorkflow.managerNodeId !== workflow.managerNodeId) {
    targetNodeIds.add(subWorkflow.managerNodeId);
  }
  if (session.queue.some((nodeId) => targetNodeIds.has(nodeId))) {
    return true;
  }
  if (session.nodeExecutions.some((entry) => targetNodeIds.has(entry.nodeId))) {
    return true;
  }
  return hasPendingDeliveryToTargets(session.communications, targetNodeIds);
}

function hasQueuedOrPendingTarget(
  session: WorkflowSessionState,
  targetNodeIds: ReadonlySet<string>,
): boolean {
  if (session.queue.some((nodeId) => targetNodeIds.has(nodeId))) {
    return true;
  }
  return hasPendingDeliveryToTargets(session.communications, targetNodeIds);
}

function subWorkflowReady(
  subWorkflow: SubWorkflowRef,
  workflow: WorkflowJson,
  session: WorkflowSessionState,
): boolean {
  if (subWorkflow.inputSources.length === 0) {
    return true;
  }
  return subWorkflow.inputSources.every((source) =>
    sourceSatisfied(source, workflow, session),
  );
}

function autoStartEligible(subWorkflow: SubWorkflowRef): boolean {
  return subWorkflow.block === undefined || subWorkflow.block.type === "plain";
}

export function planRootManagerSubWorkflowStarts(args: {
  readonly workflow: WorkflowJson;
  readonly session: WorkflowSessionState;
}): readonly SubWorkflowRef[] {
  const planned: SubWorkflowRef[] = [];
  for (const subWorkflow of args.workflow.subWorkflows) {
    if (!autoStartEligible(subWorkflow)) {
      continue;
    }
    if (subWorkflowAlreadyStarted(subWorkflow, args.workflow, args.session)) {
      continue;
    }
    if (!subWorkflowReady(subWorkflow, args.workflow, args.session)) {
      continue;
    }
    planned.push(subWorkflow);
  }
  return planned;
}

export function planSubWorkflowChildInputs(args: {
  readonly workflow: WorkflowJson;
  readonly session: WorkflowSessionState;
  readonly managerNodeId: string;
}): readonly string[] {
  const subWorkflow = args.workflow.subWorkflows.find(
    (entry) => entry.managerNodeId === args.managerNodeId,
  );
  if (subWorkflow === undefined) {
    return [];
  }
  if (
    hasQueuedOrPendingTarget(args.session, new Set([subWorkflow.inputNodeId]))
  ) {
    return [];
  }
  return [subWorkflow.inputNodeId];
}
