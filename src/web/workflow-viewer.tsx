import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";
import { render } from "solid-js/web";
import type {
  WorkflowDefinitionView,
  WorkflowExecutionOverviewView,
} from "../graphql/types";
import type { WorkflowExecutionSummary } from "../shared/ui-contract";
import type {
  NodePayload,
  WorkflowEdge,
  WorkflowNodeRef,
} from "../workflow/types";

interface WorkflowViewerConfig {
  readonly fixedWorkflowName: string | null;
  readonly readOnly: boolean;
  readonly noExec: boolean;
}

interface WindowWithViewerConfig extends Window {
  readonly __DIVEDRA_VIEWER_CONFIG__?: WorkflowViewerConfig;
}

interface GraphqlErrorEntry {
  readonly message: string;
}

interface GraphqlResponse<TData> {
  readonly data?: TData | null;
  readonly errors?: readonly GraphqlErrorEntry[];
}

interface GraphNodeLayout {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly kind: string;
  readonly status: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const DEFAULT_CONFIG: WorkflowViewerConfig = {
  fixedWorkflowName: null,
  readOnly: true,
  noExec: true,
};
const EXECUTION_PAGE_SIZE = 50;
const RECENT_LOG_LIMIT = 200;
const MIN_GRAPH_WIDTH = 720;
const MIN_GRAPH_HEIGHT = 420;

const WORKFLOWS_QUERY = `
  query ViewerWorkflows {
    workflows
  }
`;

const WORKFLOW_DEFINITION_QUERY = `
  query ViewerWorkflowDefinition($workflowName: String!) {
    workflowDefinition(workflowName: $workflowName) {
      workflowName
      revision
      bundle
      derivedVisualization
    }
  }
`;

const WORKFLOW_EXECUTIONS_QUERY = `
  query ViewerWorkflowExecutions($workflowName: String, $first: Int) {
    workflowExecutions(workflowName: $workflowName, first: $first) {
      items
      totalCount
      nextCursor
    }
  }
`;

const WORKFLOW_EXECUTION_OVERVIEW_QUERY = `
  query ViewerWorkflowExecutionOverview($workflowExecutionId: String!, $recentLogLimit: Int) {
    workflowExecutionOverview(
      workflowExecutionId: $workflowExecutionId
      recentLogLimit: $recentLogLimit
    ) {
      workflowExecutionId
      workflowId
      workflowName
      status
      nodes {
        nodeId
        nodeExecId
        status
        startedAt
        endedAt
      }
      nodeLogs {
        id
        sessionId
        nodeExecId
        nodeId
        level
        message
        payloadJson
        at
      }
    }
  }
`;

function viewerConfig(): WorkflowViewerConfig {
  const config = (window as WindowWithViewerConfig).__DIVEDRA_VIEWER_CONFIG__;
  return config ?? DEFAULT_CONFIG;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertGraphqlData<TData>(payload: unknown): TData {
  if (!isRecord(payload)) {
    throw new Error("GraphQL response was not a JSON object");
  }
  const response = payload as GraphqlResponse<TData>;
  if (response.errors !== undefined && response.errors.length > 0) {
    const firstError = response.errors[0];
    throw new Error(firstError?.message ?? "GraphQL request failed");
  }
  if (response.data === undefined || response.data === null) {
    throw new Error("GraphQL response did not include data");
  }
  return response.data;
}

async function graphql<TData>(
  query: string,
  variables: Readonly<Record<string, unknown>> = {},
): Promise<TData> {
  const response = await fetch("/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(
      `GraphQL request failed with HTTP ${String(response.status)}`,
    );
  }
  return assertGraphqlData<TData>((await response.json()) as unknown);
}

function formatTimestamp(value: string | null): string {
  if (value === null || value.length === 0) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function shortId(value: string): string {
  return value.length <= 18
    ? value
    : `${value.slice(0, 9)}...${value.slice(-6)}`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function nodeStatus(
  nodeId: string,
  overview: WorkflowExecutionOverviewView | null,
): string | null {
  if (overview === null) {
    return null;
  }
  for (let index = overview.nodes.length - 1; index >= 0; index -= 1) {
    const entry = overview.nodes[index];
    if (entry !== undefined && entry.nodeId === nodeId) {
      return entry.status;
    }
  }
  return null;
}

function cssStatus(status: string | null): string {
  if (status === null) {
    return "";
  }
  return `status-${status}`;
}

function nodeSubtitle(
  node: WorkflowNodeRef,
  payload: NodePayload | undefined,
): string {
  const parts = [
    node.role,
    node.control === undefined || node.control === "none"
      ? undefined
      : node.control,
    payload?.executionBackend,
    payload?.model,
  ].filter((entry): entry is string => entry !== undefined && entry.length > 0);
  return parts.length === 0 ? node.nodeFile : parts.join(" / ");
}

function buildGraphNodes(
  definition: WorkflowDefinitionView | null,
  overview: WorkflowExecutionOverviewView | null,
): readonly GraphNodeLayout[] {
  if (definition === null) {
    return [];
  }

  const visByNodeId = new Map(
    definition.derivedVisualization.map((entry) => [entry.id, entry]),
  );
  return definition.bundle.workflow.nodes.map((node, index) => {
    const vis = visByNodeId.get(node.id);
    const indent = vis?.indent ?? 0;
    const payload = definition.bundle.nodePayloads[node.id];
    return {
      id: node.id,
      title: truncateText(node.id, 34),
      subtitle: truncateText(nodeSubtitle(node, payload), 45),
      kind: node.kind ?? payload?.nodeType ?? "node",
      status: nodeStatus(node.id, overview),
      x: 40 + indent * 54,
      y: 32 + index * 116,
      width: 290,
      height: 78,
    } satisfies GraphNodeLayout;
  });
}

function pathForEdge(from: GraphNodeLayout, to: GraphNodeLayout): string {
  const fromX = from.x + from.width / 2;
  const fromY = from.y + from.height;
  const toX = to.x + to.width / 2;
  const toY = to.y;
  if (to.y > from.y) {
    const midY = (fromY + toY) / 2;
    return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
  }
  const routeX = Math.max(from.x + from.width, to.x + to.width) + 42;
  return `M ${fromX} ${fromY} C ${routeX} ${fromY}, ${routeX} ${toY}, ${toX} ${toY}`;
}

function edgeLabelPosition(
  from: GraphNodeLayout,
  to: GraphNodeLayout,
): { readonly x: number; readonly y: number } {
  return {
    x: (from.x + to.x) / 2 + from.width / 2,
    y: (from.y + to.y) / 2 + 18,
  };
}

function App() {
  const config = viewerConfig();
  const [workflows, setWorkflows] = createSignal<readonly string[]>([]);
  const [workflowName, setWorkflowName] = createSignal<string | null>(
    config.fixedWorkflowName,
  );
  const [definition, setDefinition] =
    createSignal<WorkflowDefinitionView | null>(null);
  const [executions, setExecutions] = createSignal<
    readonly WorkflowExecutionSummary[]
  >([]);
  const [selectedExecutionId, setSelectedExecutionId] = createSignal<
    string | null
  >(null);
  const [overview, setOverview] =
    createSignal<WorkflowExecutionOverviewView | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let refreshSerial = 0;
  let overviewSerial = 0;

  const graphNodes = createMemo(() =>
    buildGraphNodes(definition(), overview()),
  );
  const nodeById = createMemo(() => {
    const result = new Map<string, GraphNodeLayout>();
    graphNodes().forEach((node) => result.set(node.id, node));
    return result;
  });
  const graphEdges = createMemo(() => {
    const currentDefinition = definition();
    if (currentDefinition === null) {
      return [];
    }
    return currentDefinition.bundle.workflow.edges
      .map((edge) => {
        const from = nodeById().get(edge.from);
        const to = nodeById().get(edge.to);
        if (from === undefined || to === undefined) {
          return null;
        }
        return { edge, from, to };
      })
      .filter(
        (
          entry,
        ): entry is {
          readonly edge: WorkflowEdge;
          readonly from: GraphNodeLayout;
          readonly to: GraphNodeLayout;
        } => entry !== null,
      );
  });
  const graphSize = createMemo(() => {
    const nodes = graphNodes();
    const maxX = Math.max(
      ...nodes.map((node) => node.x + node.width),
      MIN_GRAPH_WIDTH,
    );
    const maxY = Math.max(
      ...nodes.map((node) => node.y + node.height),
      MIN_GRAPH_HEIGHT,
    );
    return { width: maxX + 90, height: maxY + 70 };
  });

  async function loadExecutionsForWorkflow(
    nextWorkflowName: string,
  ): Promise<readonly WorkflowExecutionSummary[]> {
    const data = await graphql<{
      readonly workflowExecutions: {
        readonly items: readonly WorkflowExecutionSummary[];
      };
    }>(WORKFLOW_EXECUTIONS_QUERY, {
      workflowName: nextWorkflowName,
      first: EXECUTION_PAGE_SIZE,
    });
    return data.workflowExecutions.items;
  }

  async function selectWorkflow(nextWorkflowName: string): Promise<void> {
    const serial = ++refreshSerial;
    setLoading(true);
    setError(null);
    setWorkflowName(nextWorkflowName);
    setSelectedExecutionId(null);
    setOverview(null);
    try {
      const [definitionData, executionItems] = await Promise.all([
        graphql<{ readonly workflowDefinition: WorkflowDefinitionView | null }>(
          WORKFLOW_DEFINITION_QUERY,
          { workflowName: nextWorkflowName },
        ),
        loadExecutionsForWorkflow(nextWorkflowName),
      ]);
      if (serial !== refreshSerial) {
        return;
      }
      setDefinition(definitionData.workflowDefinition);
      setExecutions(executionItems);
      setSelectedExecutionId(executionItems[0]?.workflowExecutionId ?? null);
    } catch (caught: unknown) {
      if (serial !== refreshSerial) {
        return;
      }
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setDefinition(null);
      setExecutions([]);
      setSelectedExecutionId(null);
    } finally {
      if (serial === refreshSerial) {
        setLoading(false);
      }
    }
  }

  async function refresh(): Promise<void> {
    const serial = ++refreshSerial;
    setLoading(true);
    setError(null);
    try {
      const names =
        config.fixedWorkflowName === null
          ? (
              await graphql<{ readonly workflows: readonly string[] }>(
                WORKFLOWS_QUERY,
              )
            ).workflows
          : [config.fixedWorkflowName];
      if (serial !== refreshSerial) {
        return;
      }
      setWorkflows(names);
      const selected =
        workflowName() !== null && names.includes(workflowName() as string)
          ? workflowName()
          : (names[0] ?? null);
      if (selected === null) {
        setWorkflowName(null);
        setDefinition(null);
        setExecutions([]);
        setSelectedExecutionId(null);
        setOverview(null);
        return;
      }
      await selectWorkflow(selected);
    } catch (caught: unknown) {
      if (serial !== refreshSerial) {
        return;
      }
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setWorkflows([]);
      setDefinition(null);
      setExecutions([]);
      setSelectedExecutionId(null);
      setOverview(null);
      setLoading(false);
    } finally {
      if (serial === refreshSerial) {
        setLoading(false);
      }
    }
  }

  createEffect(() => {
    const workflowExecutionId = selectedExecutionId();
    if (workflowExecutionId === null) {
      setOverview(null);
      return;
    }
    const serial = ++overviewSerial;
    setError(null);
    void graphql<{
      readonly workflowExecutionOverview: WorkflowExecutionOverviewView | null;
    }>(WORKFLOW_EXECUTION_OVERVIEW_QUERY, {
      workflowExecutionId,
      recentLogLimit: RECENT_LOG_LIMIT,
    })
      .then((data) => {
        if (serial === overviewSerial) {
          setOverview(data.workflowExecutionOverview);
        }
      })
      .catch((caught: unknown) => {
        if (serial === overviewSerial) {
          const message =
            caught instanceof Error ? caught.message : String(caught);
          setError(message);
          setOverview(null);
        }
      });
  });

  onMount(() => {
    void refresh();
  });

  return (
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <h1>divedra</h1>
          <span>workflow viewer</span>
        </div>
        <div class="toolbar">
          <select
            class="select"
            value={workflowName() ?? ""}
            disabled={config.fixedWorkflowName !== null || loading()}
            onChange={(event) => {
              const nextWorkflowName = event.currentTarget.value;
              if (nextWorkflowName.length > 0) {
                void selectWorkflow(nextWorkflowName);
              }
            }}
          >
            <For each={workflows()}>
              {(name) => <option value={name}>{name}</option>}
            </For>
          </select>
          <button
            class="button"
            disabled={loading()}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
      </header>

      <main class="layout">
        <section class="main panel">
          <div class="summary">
            <h2>{definition()?.workflowName ?? "No workflow selected"}</h2>
            <p>
              {definition()?.bundle.workflow.description ??
                "No workflow definitions were found."}
            </p>
            <Show when={error() !== null}>
              <p class="error">{error()}</p>
            </Show>
          </div>
          <div class="graph-wrap">
            <Show
              when={definition() !== null}
              fallback={<div class="empty">No graph data</div>}
            >
              <svg
                class="graph"
                width={graphSize().width}
                height={graphSize().height}
                viewBox={`0 0 ${graphSize().width} ${graphSize().height}`}
                role="img"
                aria-label="Workflow node graph"
              >
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#718096" />
                  </marker>
                </defs>
                <For each={graphEdges()}>
                  {({ edge, from, to }) => {
                    const label = edgeLabelPosition(from, to);
                    return (
                      <g>
                        <path
                          class="edge"
                          d={pathForEdge(from, to)}
                          marker-end="url(#arrow)"
                        />
                        <text class="edge-label" x={label.x} y={label.y}>
                          {edge.when}
                        </text>
                      </g>
                    );
                  }}
                </For>
                <For each={graphNodes()}>
                  {(node) => (
                    <g class={`node ${cssStatus(node.status)}`}>
                      <rect
                        x={node.x}
                        y={node.y}
                        width={node.width}
                        height={node.height}
                      />
                      <text class="title" x={node.x + 14} y={node.y + 24}>
                        {node.title}
                      </text>
                      <text class="meta" x={node.x + 14} y={node.y + 45}>
                        {node.subtitle}
                      </text>
                      <rect
                        class="badge"
                        x={node.x + 14}
                        y={node.y + 55}
                        width="102"
                        height="16"
                        rx="4"
                      />
                      <text class="badge-text" x={node.x + 22} y={node.y + 67}>
                        {truncateText(node.status ?? node.kind, 13)}
                      </text>
                    </g>
                  )}
                </For>
              </svg>
            </Show>
          </div>
        </section>

        <aside class="side">
          <section class="section panel">
            <h2>Execution Runs</h2>
            <div class="scroll">
              <Show
                when={executions().length > 0}
                fallback={<div class="empty">No execution runs</div>}
              >
                <div class="run-list">
                  <For each={executions()}>
                    {(execution) => (
                      <button
                        classList={{
                          run: true,
                          selected:
                            selectedExecutionId() ===
                            execution.workflowExecutionId,
                        }}
                        onClick={() =>
                          setSelectedExecutionId(execution.workflowExecutionId)
                        }
                      >
                        <strong>
                          {shortId(execution.workflowExecutionId)}
                        </strong>
                        <span>
                          {execution.status} /{" "}
                          {String(execution.nodeExecutionCounter)} nodes
                        </span>
                        <span>{formatTimestamp(execution.startedAt)}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </section>

          <section class="section panel">
            <h2>Execution Logs</h2>
            <div class="scroll">
              <Show
                when={(overview()?.nodeLogs.length ?? 0) > 0}
                fallback={<div class="empty">No logs for the selected run</div>}
              >
                <div class="log-list">
                  <For each={overview()?.nodeLogs ?? []}>
                    {(log) => (
                      <article class={`log ${log.level}`}>
                        <div class="log-time">
                          {formatTimestamp(log.at)} / {log.nodeId ?? "workflow"}{" "}
                          / {log.level}
                        </div>
                        <div class="log-message">{log.message}</div>
                      </article>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (root === null) {
  throw new Error("workflow viewer root element was not found");
}
render(() => <App />, root);
