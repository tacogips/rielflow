import type { SubWorkflowRef, WorkflowJson, WorkflowVisJson } from "./types";

export interface DerivedVisNode {
  readonly id: string;
  readonly order: number;
  readonly indent: number;
  readonly color:
    | "default"
    | `loop:${string}`
    | `group:${string}`
    | `branch:${string}`;
}

interface ScopeInterval {
  readonly id: string;
  readonly startOrder: number;
  readonly endOrder: number;
}

interface ScopeMetadata {
  readonly groupIntervals: readonly ScopeInterval[];
  readonly loopIntervals: readonly ScopeInterval[];
  readonly colorByGroupScopeId: ReadonlyMap<string, DerivedVisNode["color"]>;
}

function compareIntervals(a: ScopeInterval, b: ScopeInterval): number {
  const spanA = a.endOrder - a.startOrder;
  const spanB = b.endOrder - b.startOrder;
  return (
    spanA - spanB || a.startOrder - b.startOrder || a.id.localeCompare(b.id)
  );
}

function resolveSubWorkflowInterval(
  subWorkflow: SubWorkflowRef,
  orderByNodeId: ReadonlyMap<string, number>,
): ScopeInterval | null {
  const inputOrder = orderByNodeId.get(subWorkflow.inputNodeId);
  const outputOrder = orderByNodeId.get(subWorkflow.outputNodeId);
  if (
    inputOrder === undefined ||
    outputOrder === undefined ||
    inputOrder > outputOrder
  ) {
    return null;
  }

  return {
    id: subWorkflow.id,
    startOrder: inputOrder,
    endOrder: outputOrder,
  };
}

function colorForSubWorkflow(
  subWorkflow: SubWorkflowRef,
): DerivedVisNode["color"] {
  if (subWorkflow.block?.type === "loop-body") {
    return `loop:${subWorkflow.block.loopId ?? subWorkflow.id}`;
  }
  if (subWorkflow.block?.type === "branch-block") {
    return `branch:${subWorkflow.id}`;
  }
  return `group:${subWorkflow.id}`;
}

function groupScopeColor(
  groupScopes: readonly ScopeInterval[],
  colorByGroupScopeId: ReadonlyMap<string, DerivedVisNode["color"]>,
): DerivedVisNode["color"] {
  const loopColor = groupScopes
    .map((scope) => colorByGroupScopeId.get(scope.id))
    .find(
      (color): color is `loop:${string}` =>
        typeof color === "string" && color.startsWith("loop:"),
    );
  if (loopColor !== undefined) {
    return loopColor;
  }

  const branchColor = groupScopes
    .map((scope) => colorByGroupScopeId.get(scope.id))
    .find(
      (color): color is `branch:${string}` =>
        typeof color === "string" && color.startsWith("branch:"),
    );
  if (branchColor !== undefined) {
    return branchColor;
  }

  return colorByGroupScopeId.get(groupScopes[0]?.id ?? "") ?? "default";
}

function buildScopeMetadata(
  workflow: WorkflowJson,
  orderByNodeId: ReadonlyMap<string, number>,
): ScopeMetadata {
  const groupIntervals = workflow.subWorkflows
    .map((entry) => resolveSubWorkflowInterval(entry, orderByNodeId))
    .filter((entry): entry is ScopeInterval => entry !== null)
    .sort(compareIntervals);

  const colorByGroupScopeId = new Map<string, DerivedVisNode["color"]>();
  workflow.subWorkflows.forEach((entry) => {
    colorByGroupScopeId.set(entry.id, colorForSubWorkflow(entry));
  });

  const loopIdsRepresentedBySubWorkflow = new Set(
    workflow.subWorkflows
      .filter((entry) => entry.block?.type === "loop-body")
      .map((entry) => entry.block?.loopId)
      .filter((entry): entry is string => entry !== undefined),
  );

  const loopIntervals = (workflow.loops ?? [])
    .filter((loop) => !loopIdsRepresentedBySubWorkflow.has(loop.id))
    .map((loop) => {
      const judgeOrder = orderByNodeId.get(loop.judgeNodeId);
      if (judgeOrder === undefined) {
        return null;
      }
      const continueTargetOrders = workflow.edges
        .filter(
          (edge) =>
            edge.from === loop.judgeNodeId && edge.when === loop.continueWhen,
        )
        .map((edge) => orderByNodeId.get(edge.to))
        .filter((value): value is number => value !== undefined)
        .filter((value) => value <= judgeOrder);
      if (continueTargetOrders.length === 0) {
        return null;
      }
      return {
        id: loop.id,
        startOrder: Math.min(...continueTargetOrders),
        endOrder: judgeOrder,
      } satisfies ScopeInterval;
    })
    .filter((entry): entry is ScopeInterval => entry !== null)
    .sort(compareIntervals);

  return {
    groupIntervals,
    loopIntervals,
    colorByGroupScopeId,
  };
}

function collectScopesForOrder(
  order: number,
  intervals: readonly ScopeInterval[],
): readonly ScopeInterval[] {
  return intervals
    .filter((entry) => entry.startOrder <= order && order <= entry.endOrder)
    .sort(compareIntervals);
}

export function deriveWorkflowVisualization(args: {
  readonly workflow: WorkflowJson;
  readonly workflowVis: WorkflowVisJson;
}): readonly DerivedVisNode[] {
  const orderedVisNodes = [...args.workflowVis.nodes].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
  const orderByNodeId = new Map<string, number>();
  orderedVisNodes.forEach((node) => {
    orderByNodeId.set(node.id, node.order);
  });
  const scopeMetadata = buildScopeMetadata(args.workflow, orderByNodeId);

  return orderedVisNodes.map((node) => ({
    id: node.id,
    order: node.order,
    indent:
      collectScopesForOrder(node.order, scopeMetadata.groupIntervals).length +
      collectScopesForOrder(node.order, scopeMetadata.loopIntervals).length,
    color: (() => {
      const loopScopes = collectScopesForOrder(
        node.order,
        scopeMetadata.loopIntervals,
      );
      if (loopScopes.length > 0) {
        return `loop:${loopScopes[0]?.id ?? ""}` as `loop:${string}`;
      }
      const groupScopes = collectScopesForOrder(
        node.order,
        scopeMetadata.groupIntervals,
      );
      if (groupScopes.length > 0) {
        return groupScopeColor(groupScopes, scopeMetadata.colorByGroupScopeId);
      }
      return "default";
    })(),
  }));
}
