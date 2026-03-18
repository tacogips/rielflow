import type {
  NodeKind,
  SubWorkflowBlockType,
  SubWorkflowInputSourceType,
} from "../../../src/workflow/types";
import type { EditorWorkflowBundle } from "./editor-workflow";
import {
  availableSubWorkflowBoundaryNodes,
  defaultNodeFile,
  ensureLoops,
  nextGeneratedNodeId,
  nextLoopId,
  nextSubWorkflowId,
  normalizeNodeIds,
  normalizeWorkflowVis,
  orderedNodes,
  renameLoopReferences,
  removeLoopReferences,
  removeLoopsOwnedByNode,
  removeNodeInputSourceReferences,
  removeSubWorkflowReferences,
  renameSubWorkflowReferences,
  syncSubWorkflowNodeKinds,
} from "./editor-workflow-operations";
import {
  isValidNodeIdInput,
  parseRequiredPositiveInteger,
} from "./editor-support";

export interface MutationSuccess {
  readonly ok: true;
}

export interface MutationError {
  readonly ok: false;
  readonly error: string;
}

export interface AddNodeSuccess extends MutationSuccess {
  readonly nodeId: string;
}

export interface RemoveNodeSuccess extends MutationSuccess {
  readonly nextSelectedNodeId: string;
}

export type MutationResult = MutationSuccess | MutationError;
export type AddNodeResult = AddNodeSuccess | MutationError;
export type RemoveNodeResult = RemoveNodeSuccess | MutationError;

function removeNodePayloadEntries(
  bundle: EditorWorkflowBundle,
  nodeId: string,
  nodeFile: string,
): void {
  delete bundle.nodePayloads[nodeId];
  delete bundle.nodePayloads[nodeFile];
}

export function addNodeToBundle(
  bundle: EditorWorkflowBundle | null | undefined,
  input: { readonly nodeIdInput: string; readonly kind: NodeKind },
): AddNodeResult {
  if (!bundle) {
    return { ok: false, error: "workflow is not loaded." };
  }

  const trimmedId = input.nodeIdInput.trim();
  const nodeId = trimmedId.length > 0 ? trimmedId : nextGeneratedNodeId(bundle);
  if (
    !isValidNodeIdInput(nodeId) ||
    bundle.workflow.nodes.some((node) => node.id === nodeId)
  ) {
    return {
      ok: false,
      error: `Node id '${nodeId}' is invalid or already exists.`,
    };
  }

  bundle.workflow.nodes = [
    ...bundle.workflow.nodes,
    {
      id: nodeId,
      kind: input.kind,
      nodeFile: defaultNodeFile(nodeId),
      completion: { type: "none" },
    },
  ];
  bundle.nodePayloads[nodeId] = {
    id: nodeId,
    model: "",
    promptTemplate: "",
    variables: {},
  };
  bundle.workflowVis.nodes = [
    ...bundle.workflowVis.nodes,
    { id: nodeId, order: bundle.workflowVis.nodes.length },
  ];
  normalizeWorkflowVis(bundle);
  return { ok: true, nodeId };
}

export function removeNodeFromBundle(
  bundle: EditorWorkflowBundle | null | undefined,
  nodeId: string,
): RemoveNodeResult {
  if (!bundle) {
    return { ok: false, error: "workflow is not loaded." };
  }
  if (bundle.workflow.managerNodeId === nodeId) {
    return { ok: false, error: `Cannot remove manager node '${nodeId}'.` };
  }

  const removedNode = bundle.workflow.nodes.find((node) => node.id === nodeId);
  if (!removedNode) {
    return { ok: false, error: `Node '${nodeId}' was not found.` };
  }

  const removedSubWorkflowIds = bundle.workflow.subWorkflows
    .filter((subWorkflow) => {
      return (
        subWorkflow.managerNodeId === nodeId ||
        subWorkflow.inputNodeId === nodeId ||
        subWorkflow.outputNodeId === nodeId
      );
    })
    .map((subWorkflow) => subWorkflow.id);

  bundle.workflow.nodes = bundle.workflow.nodes.filter(
    (node) => node.id !== nodeId,
  );
  bundle.workflow.edges = bundle.workflow.edges.filter(
    (edge) => edge.from !== nodeId && edge.to !== nodeId,
  );
  removeLoopsOwnedByNode(bundle, nodeId);
  bundle.workflow.subWorkflows = bundle.workflow.subWorkflows
    .filter((subWorkflow) => {
      return (
        subWorkflow.managerNodeId !== nodeId &&
        subWorkflow.inputNodeId !== nodeId &&
        subWorkflow.outputNodeId !== nodeId
      );
    })
    .map((subWorkflow) => ({
      ...subWorkflow,
      nodeIds: subWorkflow.nodeIds.filter((entry) => entry !== nodeId),
      inputSources: subWorkflow.inputSources.map((source) => {
        if (source.nodeId !== nodeId) {
          return source;
        }
        const { nodeId: _nodeId, ...rest } = source;
        return rest;
      }),
    }));
  for (const subWorkflowId of removedSubWorkflowIds) {
    removeSubWorkflowReferences(bundle, subWorkflowId);
  }
  removeNodeInputSourceReferences(bundle, nodeId);
  bundle.workflowVis.nodes = bundle.workflowVis.nodes.filter(
    (entry) => entry.id !== nodeId,
  );
  removeNodePayloadEntries(bundle, nodeId, removedNode.nodeFile);
  normalizeWorkflowVis(bundle);

  return {
    ok: true,
    nextSelectedNodeId: bundle.workflow.nodes[0]?.id ?? "",
  };
}

export function addEdgeToBundle(
  bundle: EditorWorkflowBundle | null | undefined,
): boolean {
  if (!bundle || bundle.workflow.nodes.length < 2) {
    return false;
  }

  const ordered = orderedNodes(bundle);
  bundle.workflow.edges = [
    ...bundle.workflow.edges,
    {
      from: ordered[0]?.id ?? "",
      to: ordered[1]?.id ?? "",
      when: "always",
    },
  ];
  return true;
}

export function removeEdgeFromBundle(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
): boolean {
  if (!bundle) {
    return false;
  }
  bundle.workflow.edges = bundle.workflow.edges.filter(
    (_, edgeIndex) => edgeIndex !== index,
  );
  return true;
}

export function addLoopToBundle(
  bundle: EditorWorkflowBundle | null | undefined,
): boolean {
  if (!bundle) {
    return false;
  }

  const judgeNodeId =
    bundle.workflow.nodes.find((node) => node.kind === "loop-judge")?.id ?? "";
  ensureLoops(bundle).push({
    id: nextLoopId(bundle),
    judgeNodeId,
    continueWhen: "retry",
    exitWhen: "done",
  });
  return true;
}

export function removeLoopFromBundle(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
): boolean {
  if (!bundle) {
    return false;
  }
  const removedLoopId = bundle.workflow.loops?.[index]?.id;
  bundle.workflow.loops = ensureLoops(bundle).filter(
    (_, loopIndex) => loopIndex !== index,
  );
  if (removedLoopId !== undefined) {
    removeLoopReferences(bundle, removedLoopId);
  }
  return true;
}

export function addSubWorkflowToBundle(
  bundle: EditorWorkflowBundle | null | undefined,
): MutationResult {
  if (!bundle) {
    return { ok: false, error: "workflow is not loaded." };
  }

  const id = nextSubWorkflowId(bundle);
  const managerCandidates = availableSubWorkflowBoundaryNodes(
    bundle,
    "managerNodeId",
    id,
  );
  const inputCandidates = availableSubWorkflowBoundaryNodes(
    bundle,
    "inputNodeId",
    id,
  );
  const outputCandidates = availableSubWorkflowBoundaryNodes(
    bundle,
    "outputNodeId",
    id,
  );
  const managerNode = managerCandidates.find(
    (node) => node.kind === "sub-divedra-manager",
  );
  const inputNode =
    inputCandidates.find(
      (node) => node.id !== managerNode?.id && node.kind === "input",
    ) ?? inputCandidates.find((node) => node.id !== managerNode?.id);
  const outputNode =
    outputCandidates.find((node) => {
      return (
        node.id !== managerNode?.id &&
        node.id !== inputNode?.id &&
        node.kind === "output"
      );
    }) ??
    outputCandidates.find((node) => {
      return node.id !== managerNode?.id && node.id !== inputNode?.id;
    });

  if (!managerNode) {
    return {
      ok: false,
      error:
        "Add a dedicated sub-divedra-manager node before creating another sub-workflow.",
    };
  }

  if (!inputNode || !outputNode) {
    return {
      ok: false,
      error:
        "Add at least three non-root nodes before creating another sub-workflow.",
    };
  }

  bundle.workflow.subWorkflows = [
    ...bundle.workflow.subWorkflows,
    {
      id,
      description: `${id} sub-workflow`,
      managerNodeId: managerNode.id,
      inputNodeId: inputNode.id,
      outputNodeId: outputNode.id,
      nodeIds: [managerNode.id, inputNode.id, outputNode.id],
      inputSources: [{ type: "human-input" }],
      block: { type: "plain" },
    },
  ];
  syncSubWorkflowNodeKinds(bundle);
  return { ok: true };
}

export function removeSubWorkflowFromBundle(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
): boolean {
  if (!bundle) {
    return false;
  }
  const removedSubWorkflowId = bundle.workflow.subWorkflows[index]?.id;
  bundle.workflow.subWorkflows = bundle.workflow.subWorkflows.filter(
    (_, currentIndex) => currentIndex !== index,
  );
  if (removedSubWorkflowId !== undefined) {
    removeSubWorkflowReferences(bundle, removedSubWorkflowId);
  }
  syncSubWorkflowNodeKinds(bundle);
  return true;
}

export function updateSubWorkflowField(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
  field: "id" | "description",
  nextValue: string,
): MutationResult {
  const subWorkflow = bundle?.workflow.subWorkflows[index];
  if (!subWorkflow) {
    return { ok: false, error: "sub-workflow was not found." };
  }

  if (field === "id") {
    const nextId = nextValue.trim();
    if (nextId.length === 0) {
      return { ok: false, error: "Sub-workflow id must not be empty." };
    }
    if (
      bundle.workflow.subWorkflows.some(
        (entry, entryIndex) => entryIndex !== index && entry.id === nextId,
      )
    ) {
      return {
        ok: false,
        error: `Sub-workflow id '${nextId}' already exists.`,
      };
    }
    const previousId = subWorkflow.id;
    subWorkflow.id = nextId;
    renameSubWorkflowReferences(bundle, previousId, subWorkflow.id);
  } else {
    subWorkflow[field] = nextValue;
  }
  return { ok: true };
}

export function updateSubWorkflowBlockType(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
  type: SubWorkflowBlockType,
): boolean {
  const subWorkflow = bundle?.workflow.subWorkflows[index];
  if (!subWorkflow) {
    return false;
  }

  if (type === "loop-body") {
    subWorkflow.block = {
      type,
      ...(subWorkflow.block?.loopId !== undefined
        ? { loopId: subWorkflow.block.loopId }
        : {}),
    };
  } else {
    subWorkflow.block = { type };
  }
  return true;
}

export function updateSubWorkflowBlockLoopId(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
  loopId: string,
): boolean {
  const subWorkflow = bundle?.workflow.subWorkflows[index];
  if (!subWorkflow || subWorkflow.block?.type !== "loop-body") {
    return false;
  }

  subWorkflow.block =
    loopId.length === 0 ? { type: "loop-body" } : { type: "loop-body", loopId };
  return true;
}

export function updateSubWorkflowBoundary(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
  field: "managerNodeId" | "inputNodeId" | "outputNodeId",
  nodeId: string,
): boolean {
  const subWorkflow = bundle?.workflow.subWorkflows[index];
  if (!subWorkflow) {
    return false;
  }

  subWorkflow[field] = nodeId;
  subWorkflow.nodeIds = normalizeNodeIds(bundle, [
    ...subWorkflow.nodeIds,
    subWorkflow.managerNodeId,
    subWorkflow.inputNodeId,
    subWorkflow.outputNodeId,
  ]);
  syncSubWorkflowNodeKinds(bundle);
  return true;
}

export function toggleSubWorkflowNodeMembership(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
  nodeId: string,
  checked: boolean,
): boolean {
  const subWorkflow = bundle?.workflow.subWorkflows[index];
  if (!subWorkflow) {
    return false;
  }

  if (checked) {
    subWorkflow.nodeIds = normalizeNodeIds(bundle, [
      ...subWorkflow.nodeIds,
      nodeId,
    ]);
    return true;
  }

  const locked = new Set([
    subWorkflow.managerNodeId,
    subWorkflow.inputNodeId,
    subWorkflow.outputNodeId,
  ]);
  if (locked.has(nodeId)) {
    return false;
  }
  subWorkflow.nodeIds = normalizeNodeIds(
    bundle,
    subWorkflow.nodeIds.filter((entry) => entry !== nodeId),
  );
  return true;
}

export function addSubWorkflowInputSource(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
): boolean {
  const subWorkflow = bundle?.workflow.subWorkflows[index];
  if (!subWorkflow) {
    return false;
  }
  subWorkflow.inputSources = [
    ...subWorkflow.inputSources,
    { type: "human-input" },
  ];
  return true;
}

export function removeSubWorkflowInputSource(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
  sourceIndex: number,
): boolean {
  const subWorkflow = bundle?.workflow.subWorkflows[index];
  if (!subWorkflow) {
    return false;
  }
  subWorkflow.inputSources = subWorkflow.inputSources.filter(
    (_, currentIndex) => currentIndex !== sourceIndex,
  );
  return true;
}

export function updateSubWorkflowInputSourceType(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
  sourceIndex: number,
  nextType: SubWorkflowInputSourceType,
): boolean {
  const source =
    bundle?.workflow.subWorkflows[index]?.inputSources[sourceIndex];
  if (!source) {
    return false;
  }
  source.type = nextType;
  delete source.workflowId;
  delete source.nodeId;
  delete source.subWorkflowId;
  delete source.selectionPolicy;
  return true;
}

export function updateSubWorkflowInputSourceField(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
  sourceIndex: number,
  field: "workflowId" | "nodeId" | "subWorkflowId",
  value: string,
): boolean {
  const source =
    bundle?.workflow.subWorkflows[index]?.inputSources[sourceIndex];
  if (!source) {
    return false;
  }

  if (value.length === 0) {
    delete source[field];
  } else {
    source[field] = value;
  }
  return true;
}

export function updateLoopField(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
  field: "id" | "judgeNodeId" | "continueWhen" | "exitWhen" | "maxIterations",
  nextValue: string,
): MutationResult {
  const loop = bundle?.workflow.loops?.[index];
  if (!loop) {
    return { ok: false, error: "loop was not found." };
  }

  if (field === "maxIterations") {
    const trimmed = nextValue.trim();
    if (trimmed.length === 0) {
      delete loop.maxIterations;
      return { ok: true };
    }

    let parsed: number;
    try {
      parsed = parseRequiredPositiveInteger(trimmed, "Loop max iterations");
    } catch {
      return {
        ok: false,
        error: "Loop max iterations must be a positive integer.",
      };
    }

    loop.maxIterations = parsed;
    return { ok: true };
  }

  if (field === "id") {
    const nextId = nextValue.trim();
    if (nextId.length === 0) {
      return { ok: false, error: "Loop id must not be empty." };
    }
    if (
      bundle.workflow.loops?.some(
        (entry, entryIndex) => entryIndex !== index && entry.id === nextId,
      ) ??
      false
    ) {
      return { ok: false, error: `Loop id '${nextId}' already exists.` };
    }

    renameLoopReferences(bundle, loop.id, nextId);
    loop.id = nextId;
    return { ok: true };
  }

  switch (field) {
    case "judgeNodeId":
      loop.judgeNodeId = nextValue;
      break;
    case "continueWhen":
      loop.continueWhen = nextValue;
      break;
    case "exitWhen":
      loop.exitWhen = nextValue;
      break;
    default:
      return { ok: false, error: "unsupported loop field." };
  }

  return { ok: true };
}
