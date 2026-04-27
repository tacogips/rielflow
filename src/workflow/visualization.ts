import {
  getStructuralEdges,
  getStructuralLoops,
  type WorkflowJson,
} from "./types";

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
  readonly loopIntervals: readonly ScopeInterval[];
}

function compareIntervals(a: ScopeInterval, b: ScopeInterval): number {
  const spanA = a.endOrder - a.startOrder;
  const spanB = b.endOrder - b.startOrder;
  return (
    spanA - spanB || a.startOrder - b.startOrder || a.id.localeCompare(b.id)
  );
}

function buildScopeMetadata(
  workflow: WorkflowJson,
  orderByNodeId: ReadonlyMap<string, number>,
): ScopeMetadata {
  const structuralEdges = getStructuralEdges(workflow);
  const loopIntervals = getStructuralLoops(workflow)
    .map((loop) => {
      const judgeOrder = orderByNodeId.get(loop.judgeNodeId);
      if (judgeOrder === undefined) {
        return null;
      }
      const continueTargetOrders = structuralEdges
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
    loopIntervals,
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
}): readonly DerivedVisNode[] {
  const orderedVisNodes = args.workflow.nodes.map((node, order) => ({
    id: node.id,
    order,
  }));
  const orderByNodeId = new Map<string, number>();
  orderedVisNodes.forEach((node) => {
    orderByNodeId.set(node.id, node.order);
  });
  const scopeMetadata = buildScopeMetadata(args.workflow, orderByNodeId);

  return orderedVisNodes.map((node) => ({
    id: node.id,
    order: node.order,
    indent: collectScopesForOrder(node.order, scopeMetadata.loopIntervals).length,
    color: (() => {
      const loopScopes = collectScopesForOrder(
        node.order,
        scopeMetadata.loopIntervals,
      );
      if (loopScopes.length > 0) {
        return `loop:${loopScopes[0]?.id ?? ""}` as `loop:${string}`;
      }
      return "default";
    })(),
  }));
}
