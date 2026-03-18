import type { NodeKind } from "../../../src/workflow/types";
import {
  deriveWorkflowVisualization,
  type DerivedVisNode,
} from "../../../src/workflow/visualization";
import type {
  EditorLoopRule,
  EditorWorkflowBundle,
  EditorWorkflowNode,
} from "./editor-workflow";

const RESERVED_STRUCTURE_KINDS = new Set<NodeKind>([
  "root-manager",
  "sub-divedra-manager",
  "input",
  "output",
]);

export interface NodeUsage {
  readonly isWorkflowManager: boolean;
  readonly managerOf: readonly string[];
  readonly inputOf: readonly string[];
  readonly outputOf: readonly string[];
}

type SubWorkflowBoundaryField =
  | "managerNodeId"
  | "inputNodeId"
  | "outputNodeId";

export function defaultNodeFile(nodeId: string): string {
  return `node-${nodeId}.json`;
}

export function orderedNodes(
  bundle: EditorWorkflowBundle | null | undefined,
): EditorWorkflowNode[] {
  if (!bundle) {
    return [];
  }

  const orderMap = new Map(
    bundle.workflowVis.nodes.map((entry) => [entry.id, entry.order]),
  );
  return [...bundle.workflow.nodes].sort((left, right) => {
    const leftOrder = orderMap.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderMap.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.id.localeCompare(right.id);
  });
}

export function ensureLoops(
  bundle: EditorWorkflowBundle | null | undefined,
): EditorLoopRule[] {
  if (!bundle) {
    return [];
  }
  bundle.workflow.loops ??= [];
  return bundle.workflow.loops;
}

export function nextLoopId(
  bundle: EditorWorkflowBundle | null | undefined,
): string {
  const existingIds = new Set(
    bundle?.workflow.loops?.map((loop) => loop.id) ?? [],
  );
  let counter = existingIds.size + 1;
  let candidate = `loop-${counter}`;
  while (existingIds.has(candidate)) {
    counter += 1;
    candidate = `loop-${counter}`;
  }
  return candidate;
}

export function nextGeneratedNodeId(
  bundle: EditorWorkflowBundle | null | undefined,
): string {
  const existingIds = new Set(
    bundle?.workflow.nodes.map((node) => node.id) ?? [],
  );
  let counter = existingIds.size + 1;
  let candidate = `worker-${counter}`;
  while (existingIds.has(candidate)) {
    counter += 1;
    candidate = `worker-${counter}`;
  }
  return candidate;
}

export function normalizeWorkflowVis(
  bundle: EditorWorkflowBundle | null | undefined,
): void {
  if (!bundle) {
    return;
  }

  const orderMap = new Map(
    bundle.workflowVis.nodes.map((entry) => [entry.id, entry.order]),
  );
  bundle.workflowVis.nodes = bundle.workflow.nodes
    .map((node, index) => ({
      id: node.id,
      order: orderMap.get(node.id) ?? index,
    }))
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    )
    .map((entry, index) => ({
      id: entry.id,
      order: index,
    }));
}

export function moveNode(
  bundle: EditorWorkflowBundle | null | undefined,
  nodeId: string,
  direction: -1 | 1,
): boolean {
  if (!bundle) {
    return false;
  }

  const ordered = orderedNodes(bundle);
  const index = ordered.findIndex((node) => node.id === nodeId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) {
    return false;
  }

  const nextOrdered = [...ordered];
  const [moved] = nextOrdered.splice(index, 1);
  if (!moved) {
    return false;
  }

  nextOrdered.splice(targetIndex, 0, moved);
  bundle.workflowVis.nodes = nextOrdered.map((node, order) => ({
    id: node.id,
    order,
  }));
  return true;
}

export function normalizeNodeIds(
  bundle: EditorWorkflowBundle | null | undefined,
  nodeIds: readonly string[],
): string[] {
  const existingIds = new Set(
    bundle?.workflow.nodes.map((node) => node.id) ?? [],
  );
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const nodeId of nodeIds) {
    if (!existingIds.has(nodeId) || seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);
    normalized.push(nodeId);
  }
  return normalized;
}

export function subWorkflowUsageForNode(
  bundle: EditorWorkflowBundle | null | undefined,
  nodeId: string,
): NodeUsage {
  if (!bundle) {
    return {
      isWorkflowManager: false,
      managerOf: [],
      inputOf: [],
      outputOf: [],
    };
  }

  return {
    isWorkflowManager: bundle.workflow.managerNodeId === nodeId,
    managerOf: bundle.workflow.subWorkflows
      .filter((subWorkflow) => subWorkflow.managerNodeId === nodeId)
      .map((subWorkflow) => subWorkflow.id),
    inputOf: bundle.workflow.subWorkflows
      .filter((subWorkflow) => subWorkflow.inputNodeId === nodeId)
      .map((subWorkflow) => subWorkflow.id),
    outputOf: bundle.workflow.subWorkflows
      .filter((subWorkflow) => subWorkflow.outputNodeId === nodeId)
      .map((subWorkflow) => subWorkflow.id),
  };
}

function nodeReservedByOtherSubWorkflow(
  bundle: EditorWorkflowBundle | null | undefined,
  nodeId: string,
  currentSubWorkflowId: string,
): boolean {
  const usage = subWorkflowUsageForNode(bundle, nodeId);
  return (
    usage.managerOf.some(
      (subWorkflowId) => subWorkflowId !== currentSubWorkflowId,
    ) ||
    usage.inputOf.some(
      (subWorkflowId) => subWorkflowId !== currentSubWorkflowId,
    ) ||
    usage.outputOf.some(
      (subWorkflowId) => subWorkflowId !== currentSubWorkflowId,
    )
  );
}

export function deriveEditableVisualization(
  bundle: EditorWorkflowBundle | null | undefined,
): DerivedVisNode[] {
  if (!bundle) {
    return [];
  }

  return [
    ...deriveWorkflowVisualization({
      workflow: bundle.workflow,
      workflowVis: bundle.workflowVis,
    }),
  ];
}

export function syncSubWorkflowNodeKinds(
  bundle: EditorWorkflowBundle | null | undefined,
): void {
  if (!bundle) {
    return;
  }

  const assignedKinds = new Map<string, NodeKind>();
  assignedKinds.set(bundle.workflow.managerNodeId, "root-manager");

  for (const subWorkflow of bundle.workflow.subWorkflows) {
    assignedKinds.set(subWorkflow.managerNodeId, "sub-divedra-manager");
    assignedKinds.set(subWorkflow.inputNodeId, "input");
    assignedKinds.set(subWorkflow.outputNodeId, "output");
    subWorkflow.nodeIds = normalizeNodeIds(bundle, [
      ...subWorkflow.nodeIds,
      subWorkflow.managerNodeId,
      subWorkflow.inputNodeId,
      subWorkflow.outputNodeId,
    ]);
  }

  for (const node of bundle.workflow.nodes) {
    const assignedKind = assignedKinds.get(node.id);
    if (assignedKind !== undefined) {
      node.kind = assignedKind;
      continue;
    }

    if (node.kind !== undefined && RESERVED_STRUCTURE_KINDS.has(node.kind)) {
      node.kind = "task";
    }
  }
}

export function nextSubWorkflowId(
  bundle: EditorWorkflowBundle | null | undefined,
): string {
  let counter = (bundle?.workflow.subWorkflows.length ?? 0) + 1;
  let candidate = `group-${counter}`;
  while (
    bundle?.workflow.subWorkflows.some(
      (subWorkflow) => subWorkflow.id === candidate,
    ) ??
    false
  ) {
    counter += 1;
    candidate = `group-${counter}`;
  }
  return candidate;
}

export function renameSubWorkflowReferences(
  bundle: EditorWorkflowBundle | null | undefined,
  oldId: string,
  nextId: string,
): void {
  if (
    !bundle ||
    oldId.length === 0 ||
    nextId.length === 0 ||
    oldId === nextId
  ) {
    return;
  }

  for (const subWorkflow of bundle.workflow.subWorkflows) {
    for (const source of subWorkflow.inputSources) {
      if (source.subWorkflowId === oldId) {
        source.subWorkflowId = nextId;
      }
    }
  }

  bundle.workflow.subWorkflowConversations?.forEach((conversation) => {
    conversation.participants = conversation.participants.map((participant) =>
      participant === oldId ? nextId : participant,
    );
  });
}

export function removeSubWorkflowReferences(
  bundle: EditorWorkflowBundle | null | undefined,
  subWorkflowId: string,
): void {
  if (!bundle || subWorkflowId.length === 0) {
    return;
  }

  for (const subWorkflow of bundle.workflow.subWorkflows) {
    for (const source of subWorkflow.inputSources) {
      if (source.subWorkflowId === subWorkflowId) {
        source.type = "human-input";
        delete source.subWorkflowId;
        delete source.nodeId;
        delete source.workflowId;
        delete source.selectionPolicy;
      }
    }
  }

  const conversations = bundle.workflow.subWorkflowConversations;
  if (conversations !== undefined) {
    bundle.workflow.subWorkflowConversations = conversations
      .map((conversation) => ({
        ...conversation,
        participants: conversation.participants.filter(
          (participant) => participant !== subWorkflowId,
        ),
      }))
      .filter((conversation) => new Set(conversation.participants).size >= 2);
  }
}

export function removeNodeInputSourceReferences(
  bundle: EditorWorkflowBundle | null | undefined,
  nodeId: string,
): void {
  if (!bundle || nodeId.length === 0) {
    return;
  }

  for (const subWorkflow of bundle.workflow.subWorkflows) {
    for (const source of subWorkflow.inputSources) {
      if (source.nodeId === nodeId) {
        source.type = "human-input";
        delete source.workflowId;
        delete source.nodeId;
        delete source.subWorkflowId;
        delete source.selectionPolicy;
      }
    }
  }
}

export function renameLoopReferences(
  bundle: EditorWorkflowBundle | null | undefined,
  oldId: string,
  nextId: string,
): void {
  if (
    !bundle ||
    oldId.length === 0 ||
    nextId.length === 0 ||
    oldId === nextId
  ) {
    return;
  }

  for (const subWorkflow of bundle.workflow.subWorkflows) {
    if (
      subWorkflow.block?.type === "loop-body" &&
      subWorkflow.block.loopId === oldId
    ) {
      subWorkflow.block = {
        type: "loop-body",
        loopId: nextId,
      };
    }
  }
}

export function removeLoopReferences(
  bundle: EditorWorkflowBundle | null | undefined,
  loopId: string,
): void {
  if (!bundle || loopId.length === 0) {
    return;
  }

  for (const subWorkflow of bundle.workflow.subWorkflows) {
    if (
      subWorkflow.block?.type === "loop-body" &&
      subWorkflow.block.loopId === loopId
    ) {
      subWorkflow.block = { type: "plain" };
    }
  }
}

export function removeLoopsOwnedByNode(
  bundle: EditorWorkflowBundle | null | undefined,
  nodeId: string,
): void {
  if (!bundle || nodeId.length === 0) {
    return;
  }

  const removedLoopIds = ensureLoops(bundle)
    .filter((loop) => loop.judgeNodeId === nodeId)
    .map((loop) => loop.id);

  if (removedLoopIds.length === 0) {
    return;
  }

  bundle.workflow.loops = ensureLoops(bundle).filter(
    (loop) => loop.judgeNodeId !== nodeId,
  );
  for (const loopId of removedLoopIds) {
    removeLoopReferences(bundle, loopId);
  }
}

export function availableSubWorkflowBoundaryNodes(
  bundle: EditorWorkflowBundle | null | undefined,
  kind: SubWorkflowBoundaryField,
  currentSubWorkflowId: string,
): EditorWorkflowNode[] {
  if (!bundle) {
    return [];
  }

  const workflow = bundle.workflow;
  const currentSubWorkflow = workflow.subWorkflows.find(
    (entry) => entry.id === currentSubWorkflowId,
  );
  return workflow.nodes.filter((node) => {
    if (workflow.managerNodeId === node.id) {
      return false;
    }
    if (nodeReservedByOtherSubWorkflow(bundle, node.id, currentSubWorkflowId)) {
      return false;
    }
    if (!currentSubWorkflow) {
      return true;
    }

    const conflictingNodeIds = new Set(
      [
        currentSubWorkflow.managerNodeId,
        currentSubWorkflow.inputNodeId,
        currentSubWorkflow.outputNodeId,
      ].filter((value) => value.length > 0),
    );
    conflictingNodeIds.delete(currentSubWorkflow[kind]);
    return !conflictingNodeIds.has(node.id);
  });
}

export function availableSubWorkflowMemberNodes(
  bundle: EditorWorkflowBundle | null | undefined,
  currentSubWorkflowId: string,
): EditorWorkflowNode[] {
  if (!bundle) {
    return [];
  }

  const workflow = bundle.workflow;
  return workflow.nodes.filter((node) => {
    if (workflow.managerNodeId === node.id) {
      return false;
    }
    return !nodeReservedByOtherSubWorkflow(
      bundle,
      node.id,
      currentSubWorkflowId,
    );
  });
}

export function workflowManagerCandidateNodes(
  bundle: EditorWorkflowBundle | null | undefined,
): EditorWorkflowNode[] {
  if (!bundle) {
    return [];
  }

  const workflow = bundle.workflow;
  return workflow.nodes.filter((node) => {
    if (node.id === workflow.managerNodeId) {
      return true;
    }
    const usage = subWorkflowUsageForNode(bundle, node.id);
    return (
      usage.managerOf.length === 0 &&
      usage.inputOf.length === 0 &&
      usage.outputOf.length === 0
    );
  });
}
