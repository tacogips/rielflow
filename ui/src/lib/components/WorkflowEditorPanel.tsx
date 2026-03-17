import { For, Show, createEffect, createSignal, type JSX } from "solid-js";

import type {
  UiConfigResponse,
  WorkflowResponse,
} from "../../../../src/shared/ui-contract";
import type {
  CompletionType,
  NodeKind,
  NodeType,
  SubWorkflowBlockType,
  SubWorkflowInputSourceType,
  ValidationIssue,
} from "../../../../src/workflow/types";
import type { DerivedVisNode } from "../../../../src/workflow/visualization";
import { RESERVED_STRUCTURE_KINDS } from "../editor-field-updates";
import {
  availableSubWorkflowBoundaryNodes,
  availableSubWorkflowMemberNodes,
  nextGeneratedNodeId,
  orderedNodes,
  workflowManagerCandidateNodes,
} from "../editor-workflow-operations";
import type {
  EditorNodePayload,
  EditorSubWorkflowInputSource,
  EditorSubWorkflowRef,
  EditorWorkflowBundle,
  EditorWorkflowEdge,
  EditorWorkflowNode,
} from "../editor-workflow";

const MANUALLY_ASSIGNABLE_NODE_KINDS: readonly NodeKind[] = [
  "task",
  "branch-judge",
  "loop-judge",
  "manager",
];

export interface WorkflowEditorPanelProps {
  readonly newNodeId: string;
  readonly newNodeKind: NodeKind;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly config: UiConfigResponse | null;
  readonly workflow: WorkflowResponse | null;
  readonly editableBundle: EditorWorkflowBundle | null;
  readonly editableDerivedVisualization: readonly DerivedVisNode[];
  readonly selectedNodeId: string;
  readonly selectedNode: EditorWorkflowNode | null;
  readonly selectedNodePayload: EditorNodePayload | null;
  readonly nodeVariablesText: string;
  readonly validationIssues: readonly ValidationIssue[];
  readonly validationSummary: string;
  readonly workflowDirty: boolean;
  readonly onNewNodeIdChange: (value: string) => void;
  readonly onNewNodeKindChange: (value: NodeKind) => void;
  readonly onUpdateDescription: (value: string) => void;
  readonly onUpdateDefaultNumber: (
    field: "maxLoopIterations" | "nodeTimeoutMs",
    value: string,
  ) => void;
  readonly onUpdateContainerRuntime: (value: string) => void;
  readonly onUpdateManagerNode: (nodeId: string) => void;
  readonly onAddNode: () => void;
  readonly onSetSelectedNode: (nodeId: string) => void;
  readonly onMoveNode: (nodeId: string, direction: -1 | 1) => void;
  readonly onRemoveNode: (nodeId: string) => void;
  readonly onUpdateNodeKind: (nodeId: string, kind: NodeKind) => void;
  readonly onUpdateNodeCompletion: (
    nodeId: string,
    completionType: CompletionType,
  ) => void;
  readonly onUpdateNodePayloadString: (
    field: "executionBackend" | "model" | "promptTemplate",
    value: string,
  ) => void;
  readonly onUpdateNodeType: (value: NodeType) => void;
  readonly onUpdateNodePayloadObject: (
    field: "command" | "container" | "durability",
    value: string,
  ) => void;
  readonly onUpdateNodeTimeout: (value: string) => void;
  readonly onSyncVariablesText: (value: string) => void;
  readonly onAddEdge: () => void;
  readonly onRemoveEdge: (index: number) => void;
  readonly onUpdateEdgeField: (
    index: number,
    field: keyof EditorWorkflowEdge,
    value: string,
  ) => void;
  readonly onAddLoop: () => void;
  readonly onRemoveLoop: (index: number) => void;
  readonly onUpdateLoopField: (
    index: number,
    field: "id" | "judgeNodeId" | "continueWhen" | "exitWhen" | "maxIterations",
    value: string,
  ) => void;
  readonly onAddSubWorkflow: () => void;
  readonly onRemoveSubWorkflow: (index: number) => void;
  readonly onUpdateSubWorkflowField: (
    index: number,
    field: "id" | "description",
    value: string,
  ) => void;
  readonly onUpdateSubWorkflowBlockType: (
    index: number,
    value: SubWorkflowBlockType,
  ) => void;
  readonly onUpdateSubWorkflowBlockLoopId: (
    index: number,
    value: string,
  ) => void;
  readonly onUpdateSubWorkflowBoundary: (
    index: number,
    field: "managerNodeId" | "inputNodeId" | "outputNodeId",
    value: string,
  ) => void;
  readonly onToggleSubWorkflowNodeMembership: (
    index: number,
    nodeId: string,
    checked: boolean,
  ) => void;
  readonly onAddSubWorkflowInputSource: (index: number) => void;
  readonly onRemoveSubWorkflowInputSource: (
    index: number,
    sourceIndex: number,
  ) => void;
  readonly onUpdateSubWorkflowInputSourceType: (
    index: number,
    sourceIndex: number,
    value: SubWorkflowInputSourceType,
  ) => void;
  readonly onUpdateSubWorkflowInputSourceField: (
    index: number,
    sourceIndex: number,
    field: "workflowId" | "nodeId" | "subWorkflowId",
    value: string,
  ) => void;
}

function visualizationForNode(
  derivedVisualization: readonly DerivedVisNode[],
  nodeId: string,
): DerivedVisNode | undefined {
  return derivedVisualization.find((entry) => entry.id === nodeId);
}

function selectedNodePayloadValue(
  bundle: EditorWorkflowBundle,
  node: EditorWorkflowNode,
): EditorNodePayload | null {
  return (
    bundle.nodePayloads[node.id] ?? bundle.nodePayloads[node.nodeFile] ?? null
  );
}

function loopJudgeNodes(
  bundle: EditorWorkflowBundle,
): readonly EditorWorkflowNode[] {
  return bundle.workflow.nodes.filter((node) => node.kind === "loop-judge");
}

function subWorkflowInputSourceOptions(
  bundle: EditorWorkflowBundle,
  subWorkflow: EditorSubWorkflowRef,
): readonly EditorSubWorkflowRef[] {
  return bundle.workflow.subWorkflows.filter(
    (entry) => entry.id !== subWorkflow.id,
  );
}

function formatOptionalJson(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  return JSON.stringify(value, null, 2);
}

export default function WorkflowEditorPanel(
  props: WorkflowEditorPanelProps,
): JSX.Element {
  const selectedNode = (): EditorWorkflowNode => {
    if (props.selectedNode === null) {
      throw new Error("selected node is unavailable");
    }

    return props.selectedNode;
  };
  const selectedNodeKind = (): NodeKind => selectedNode().kind ?? "task";

  const orderedWorkflowNodes = (): readonly EditorWorkflowNode[] => {
    if (props.editableBundle === null) {
      return [];
    }
    return orderedNodes(props.editableBundle);
  };
  const selectedNodeType = (): NodeType =>
    props.selectedNodePayload?.nodeType ?? "agent";
  const [containerRuntimeText, setContainerRuntimeText] = createSignal("");
  const [commandText, setCommandText] = createSignal("");
  const [containerText, setContainerText] = createSignal("");
  const [durabilityText, setDurabilityText] = createSignal("");

  createEffect(() => {
    setContainerRuntimeText(
      formatOptionalJson(
        props.editableBundle?.workflow.defaults.containerRuntime,
      ),
    );
  });
  createEffect(() => {
    setCommandText(formatOptionalJson(props.selectedNodePayload?.command));
  });
  createEffect(() => {
    setContainerText(formatOptionalJson(props.selectedNodePayload?.container));
  });
  createEffect(() => {
    setDurabilityText(
      formatOptionalJson(props.selectedNodePayload?.durability),
    );
  });

  return (
    <section class="panel main-panel">
      <div class="section-head">
        <div>
          <h2>Workflow Editor</h2>
          <Show when={props.workflow}>
            {(workflow) => (
              <p class="subtle">
                {workflow().workflowName} · revision{" "}
                {workflow().revision ?? "none"} ·{" "}
                {props.workflowDirty ? "unsaved changes" : "saved"}
              </p>
            )}
          </Show>
        </div>
        <Show when={props.editableBundle}>
          {(editableBundle) => (
            <span class="badge subtle">
              {editableBundle().workflow.workflowId}
            </span>
          )}
        </Show>
      </div>

      <Show
        when={!props.loading}
        fallback={<p class="empty">Loading UI bootstrap data...</p>}
      >
        <Show
          when={props.editableBundle}
          fallback={
            <p class="empty">Select or create a workflow to inspect it.</p>
          }
        >
          {(editableBundle) => (
            <div class="editor-grid">
              <div class="editor-column">
                <label for="description">Workflow Description</label>
                <textarea
                  id="description"
                  value={editableBundle().workflow.description}
                  disabled={props.config?.readOnly === true || props.busy}
                  onInput={(event) => {
                    props.onUpdateDescription(event.currentTarget.value);
                  }}
                />

                <div class="defaults-grid">
                  <div>
                    <label for="max-loop-iterations">
                      Default Max Loop Iterations
                    </label>
                    <input
                      id="max-loop-iterations"
                      type="number"
                      min="1"
                      value={String(
                        editableBundle().workflow.defaults.maxLoopIterations,
                      )}
                      disabled={props.config?.readOnly === true || props.busy}
                      onInput={(event) => {
                        props.onUpdateDefaultNumber(
                          "maxLoopIterations",
                          event.currentTarget.value,
                        );
                      }}
                    />
                  </div>
                  <div>
                    <label for="default-timeout">
                      Default Node Timeout (ms)
                    </label>
                    <input
                      id="default-timeout"
                      type="number"
                      min="1"
                      value={String(
                        editableBundle().workflow.defaults.nodeTimeoutMs,
                      )}
                      disabled={props.config?.readOnly === true || props.busy}
                      onInput={(event) => {
                        props.onUpdateDefaultNumber(
                          "nodeTimeoutMs",
                          event.currentTarget.value,
                        );
                      }}
                    />
                  </div>
                </div>
                <label for="container-runtime-default">
                  Container Runtime Defaults JSON
                </label>
                <textarea
                  id="container-runtime-default"
                  class="code"
                  value={containerRuntimeText()}
                  spellcheck={false}
                  disabled={props.config?.readOnly === true || props.busy}
                  placeholder={'{\n  "runnerKind": "podman"\n}'}
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    setContainerRuntimeText(value);
                    props.onUpdateContainerRuntime(value);
                  }}
                />

                <div class="structure-block">
                  <div class="section-head">
                    <h3>Structure</h3>
                    <span>
                      {editableBundle().workflow.edges.length} edges ·{" "}
                      {editableBundle().workflow.loops?.length ?? 0} loops
                    </span>
                  </div>

                  <div class="property-grid">
                    <div>
                      <label for="manager-node">Manager Node</label>
                      <select
                        id="manager-node"
                        value={editableBundle().workflow.managerNodeId}
                        disabled={props.config?.readOnly === true || props.busy}
                        onChange={(event) => {
                          props.onUpdateManagerNode(event.currentTarget.value);
                        }}
                      >
                        <For
                          each={workflowManagerCandidateNodes(editableBundle())}
                        >
                          {(node) => <option value={node.id}>{node.id}</option>}
                        </For>
                      </select>
                    </div>
                  </div>

                  <div class="section-head">
                    <h3>Node Actions</h3>
                    <button
                      class="ghost"
                      type="button"
                      disabled={props.config?.readOnly === true || props.busy}
                      onClick={() => props.onAddNode()}
                    >
                      Add Node
                    </button>
                  </div>

                  <div class="property-grid">
                    <div>
                      <label for="new-node-id">New Node ID</label>
                      <input
                        id="new-node-id"
                        value={props.newNodeId}
                        placeholder={nextGeneratedNodeId(editableBundle())}
                        disabled={props.config?.readOnly === true || props.busy}
                        onInput={(event) => {
                          props.onNewNodeIdChange(event.currentTarget.value);
                        }}
                      />
                    </div>
                    <div>
                      <label for="new-node-kind">New Node Kind</label>
                      <select
                        id="new-node-kind"
                        value={props.newNodeKind}
                        disabled={props.config?.readOnly === true || props.busy}
                        onChange={(event) => {
                          props.onNewNodeKindChange(
                            event.currentTarget.value as NodeKind,
                          );
                        }}
                      >
                        <For each={MANUALLY_ASSIGNABLE_NODE_KINDS}>
                          {(kind) => <option value={kind}>{kind}</option>}
                        </For>
                      </select>
                    </div>
                  </div>
                </div>

                <div class="nodes">
                  <div class="section-head">
                    <h3>Nodes</h3>
                    <span>{editableBundle().workflow.nodes.length}</span>
                  </div>
                  <For each={orderedWorkflowNodes()}>
                    {(node, index) => {
                      const view = () =>
                        visualizationForNode(
                          props.editableDerivedVisualization,
                          node.id,
                        );
                      const payload = () =>
                        selectedNodePayloadValue(editableBundle(), node);
                      return (
                        <div
                          class="node-card ghost"
                          classList={{
                            selected: node.id === props.selectedNodeId,
                          }}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            props.onSetSelectedNode(node.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              props.onSetSelectedNode(node.id);
                            }
                          }}
                        >
                          <div class="node-head">
                            <strong>{node.label ?? node.id}</strong>
                            <span class="node-kind">{node.kind ?? "task"}</span>
                          </div>
                          <div class="node-meta">
                            <span>Indent {view()?.indent ?? 0}</span>
                            <span>{view()?.color ?? "default"}</span>
                          </div>
                          <div class="node-meta">
                            <span>
                              {payload()?.executionBackend ?? "legacy backend"}
                            </span>
                            <span>{payload()?.model ?? "unspecified"}</span>
                          </div>
                          <div class="node-actions">
                            <button
                              class="ghost"
                              type="button"
                              disabled={
                                props.config?.readOnly === true ||
                                props.busy ||
                                index() === 0
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                props.onMoveNode(node.id, -1);
                              }}
                            >
                              Up
                            </button>
                            <button
                              class="ghost"
                              type="button"
                              disabled={
                                props.config?.readOnly === true ||
                                props.busy ||
                                index() === orderedWorkflowNodes().length - 1
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                props.onMoveNode(node.id, 1);
                              }}
                            >
                              Down
                            </button>
                            <button
                              class="ghost"
                              type="button"
                              disabled={
                                props.config?.readOnly === true ||
                                props.busy ||
                                editableBundle().workflow.managerNodeId ===
                                  node.id
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                props.onRemoveNode(node.id);
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>

              <div class="editor-column">
                <div class="section-head">
                  <h3>Selected Node</h3>
                  <Show when={props.selectedNode}>
                    {(nodeAccessor) => (
                      <span class="badge subtle">
                        {nodeAccessor().nodeFile}
                      </span>
                    )}
                  </Show>
                </div>

                <Show
                  when={props.selectedNode && props.selectedNodePayload}
                  fallback={
                    <p class="empty">
                      Select a node to edit backend, model, prompt, and
                      variables.
                    </p>
                  }
                >
                  <div class="editor-column">
                    <div class="property-grid">
                      <div>
                        <label for="node-id">Node ID</label>
                        <input
                          id="node-id"
                          value={selectedNode().id}
                          readOnly
                        />
                      </div>
                      <div>
                        <label for="node-kind">Kind</label>
                        <Show
                          when={
                            selectedNode().kind !== undefined &&
                            RESERVED_STRUCTURE_KINDS.has(selectedNodeKind())
                          }
                          fallback={
                            <select
                              id="node-kind"
                              value={selectedNodeKind()}
                              disabled={
                                props.config?.readOnly === true || props.busy
                              }
                              onChange={(event) => {
                                props.onUpdateNodeKind(
                                  selectedNode().id,
                                  event.currentTarget.value as NodeKind,
                                );
                              }}
                            >
                              <For each={MANUALLY_ASSIGNABLE_NODE_KINDS}>
                                {(kind) => <option value={kind}>{kind}</option>}
                              </For>
                            </select>
                          }
                        >
                          <input
                            id="node-kind"
                            value={`${selectedNodeKind()} (derived from structure)`}
                            readOnly
                          />
                        </Show>
                      </div>
                      <div>
                        <label for="node-completion">Completion</label>
                        <select
                          id="node-completion"
                          value={selectedNode().completion?.type ?? "none"}
                          disabled={
                            props.config?.readOnly === true || props.busy
                          }
                          onChange={(event) => {
                            props.onUpdateNodeCompletion(
                              selectedNode().id,
                              event.currentTarget.value as CompletionType,
                            );
                          }}
                        >
                          <option value="none">none</option>
                          <option value="checklist">checklist</option>
                          <option value="score-threshold">
                            score-threshold
                          </option>
                          <option value="validator-result">
                            validator-result
                          </option>
                        </select>
                      </div>
                      <div>
                        <label for="node-type">Node Type</label>
                        <select
                          id="node-type"
                          value={selectedNodeType()}
                          disabled={
                            props.config?.readOnly === true || props.busy
                          }
                          onChange={(event) => {
                            props.onUpdateNodeType(
                              event.currentTarget.value as NodeType,
                            );
                          }}
                        >
                          <option value="agent">agent</option>
                          <option value="command">command</option>
                          <option value="container">container</option>
                        </select>
                      </div>
                      <div>
                        <label for="timeout">Node Timeout (ms)</label>
                        <input
                          id="timeout"
                          type="number"
                          min="1"
                          value={
                            props.selectedNodePayload?.timeoutMs === undefined
                              ? ""
                              : String(props.selectedNodePayload.timeoutMs)
                          }
                          placeholder="inherit default"
                          disabled={
                            props.config?.readOnly === true || props.busy
                          }
                          onInput={(event) => {
                            props.onUpdateNodeTimeout(
                              event.currentTarget.value,
                            );
                          }}
                        />
                      </div>
                    </div>

                    <Show when={selectedNodeType() === "agent"}>
                      <div class="property-grid">
                        <div>
                          <label for="execution-backend">
                            Execution Backend
                          </label>
                          <input
                            id="execution-backend"
                            value={
                              props.selectedNodePayload?.executionBackend ?? ""
                            }
                            placeholder="tacogips/codex-agent"
                            disabled={
                              props.config?.readOnly === true || props.busy
                            }
                            onInput={(event) => {
                              props.onUpdateNodePayloadString(
                                "executionBackend",
                                event.currentTarget.value,
                              );
                            }}
                          />
                        </div>
                        <div>
                          <label for="model">Model</label>
                          <input
                            id="model"
                            value={props.selectedNodePayload?.model ?? ""}
                            placeholder="gpt-5 / claude-sonnet-4-5 / claude-opus-4-1"
                            disabled={
                              props.config?.readOnly === true || props.busy
                            }
                            onInput={(event) => {
                              props.onUpdateNodePayloadString(
                                "model",
                                event.currentTarget.value,
                              );
                            }}
                          />
                        </div>
                      </div>

                      <label for="prompt-template">Prompt Template</label>
                      <textarea
                        id="prompt-template"
                        value={props.selectedNodePayload?.promptTemplate ?? ""}
                        disabled={props.config?.readOnly === true || props.busy}
                        onInput={(event) => {
                          props.onUpdateNodePayloadString(
                            "promptTemplate",
                            event.currentTarget.value,
                          );
                        }}
                      />
                    </Show>

                    <Show when={selectedNodeType() === "command"}>
                      <div>
                        <label for="command-json">Command JSON</label>
                        <textarea
                          id="command-json"
                          class="code"
                          value={commandText()}
                          spellcheck={false}
                          disabled={
                            props.config?.readOnly === true || props.busy
                          }
                          placeholder={
                            '{\n  "scriptPath": "scripts/run.sh",\n  "argvTemplate": ["--topic", "{{variables.topic}}"]\n}'
                          }
                          onInput={(event) => {
                            const value = event.currentTarget.value;
                            setCommandText(value);
                            props.onUpdateNodePayloadObject("command", value);
                          }}
                        />
                      </div>
                    </Show>

                    <Show when={selectedNodeType() === "container"}>
                      <div>
                        <label for="container-json">Container JSON</label>
                        <textarea
                          id="container-json"
                          class="code"
                          value={containerText()}
                          spellcheck={false}
                          disabled={
                            props.config?.readOnly === true || props.busy
                          }
                          placeholder={
                            '{\n  "image": "ghcr.io/example/worker:latest",\n  "networkPolicy": "disabled"\n}'
                          }
                          onInput={(event) => {
                            const value = event.currentTarget.value;
                            setContainerText(value);
                            props.onUpdateNodePayloadObject("container", value);
                          }}
                        />
                      </div>
                      <div>
                        <label for="durability-json">Durability JSON</label>
                        <textarea
                          id="durability-json"
                          class="code"
                          value={durabilityText()}
                          spellcheck={false}
                          disabled={
                            props.config?.readOnly === true || props.busy
                          }
                          placeholder={
                            '{\n  "mode": "node-persistent",\n  "mountPath": "/durable"\n}'
                          }
                          onInput={(event) => {
                            const value = event.currentTarget.value;
                            setDurabilityText(value);
                            props.onUpdateNodePayloadObject(
                              "durability",
                              value,
                            );
                          }}
                        />
                      </div>
                    </Show>

                    <label for="variables">Variables JSON</label>
                    <textarea
                      id="variables"
                      class="code"
                      value={props.nodeVariablesText}
                      spellcheck={false}
                      disabled={props.config?.readOnly === true || props.busy}
                      onInput={(event) => {
                        props.onSyncVariablesText(event.currentTarget.value);
                      }}
                    />
                  </div>
                </Show>

                <div class="validation-block">
                  <div class="section-head">
                    <h3>Validation</h3>
                    <span>{props.validationIssues.length}</span>
                  </div>
                  <p class="subtle">
                    {props.validationSummary ||
                      "Run validation before saving to inspect workflow and payload issues."}
                  </p>
                  <Show
                    when={props.validationIssues.length === 0}
                    fallback={
                      <div class="issues">
                        <For each={props.validationIssues}>
                          {(issue) => (
                            <article
                              class="issue-card"
                              classList={{
                                error: issue.severity === "error",
                                warning: issue.severity === "warning",
                              }}
                            >
                              <div class="issue-head">
                                <strong>{issue.severity}</strong>
                                <span>{issue.path}</span>
                              </div>
                              <p>{issue.message}</p>
                            </article>
                          )}
                        </For>
                      </div>
                    }
                  >
                    <p class="empty">No validation results yet.</p>
                  </Show>
                </div>

                <div class="structure-block">
                  <div class="section-head">
                    <h3>Edges</h3>
                    <button
                      class="ghost"
                      type="button"
                      disabled={
                        props.config?.readOnly === true ||
                        props.busy ||
                        editableBundle().workflow.nodes.length < 2
                      }
                      onClick={() => props.onAddEdge()}
                    >
                      Add Edge
                    </button>
                  </div>
                  <Show
                    when={editableBundle().workflow.edges.length > 0}
                    fallback={<p class="empty">No edges defined.</p>}
                  >
                    <div class="issues">
                      <For each={editableBundle().workflow.edges}>
                        {(edge, index) => (
                          <article class="issue-card">
                            <div class="property-grid">
                              <div>
                                <label for={`edge-from-${index()}`}>From</label>
                                <select
                                  id={`edge-from-${index()}`}
                                  value={edge.from}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onChange={(event) => {
                                    props.onUpdateEdgeField(
                                      index(),
                                      "from",
                                      event.currentTarget.value,
                                    );
                                  }}
                                >
                                  <For each={editableBundle().workflow.nodes}>
                                    {(node) => (
                                      <option value={node.id}>{node.id}</option>
                                    )}
                                  </For>
                                </select>
                              </div>
                              <div>
                                <label for={`edge-to-${index()}`}>To</label>
                                <select
                                  id={`edge-to-${index()}`}
                                  value={edge.to}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onChange={(event) => {
                                    props.onUpdateEdgeField(
                                      index(),
                                      "to",
                                      event.currentTarget.value,
                                    );
                                  }}
                                >
                                  <For each={editableBundle().workflow.nodes}>
                                    {(node) => (
                                      <option value={node.id}>{node.id}</option>
                                    )}
                                  </For>
                                </select>
                              </div>
                              <div>
                                <label for={`edge-when-${index()}`}>When</label>
                                <input
                                  id={`edge-when-${index()}`}
                                  value={edge.when}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onInput={(event) => {
                                    props.onUpdateEdgeField(
                                      index(),
                                      "when",
                                      event.currentTarget.value,
                                    );
                                  }}
                                />
                              </div>
                              <div>
                                <label for={`edge-priority-${index()}`}>
                                  Priority
                                </label>
                                <input
                                  id={`edge-priority-${index()}`}
                                  type="number"
                                  min="0"
                                  value={
                                    edge.priority === undefined
                                      ? ""
                                      : String(edge.priority)
                                  }
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onInput={(event) => {
                                    props.onUpdateEdgeField(
                                      index(),
                                      "priority",
                                      event.currentTarget.value,
                                    );
                                  }}
                                />
                              </div>
                            </div>
                            <button
                              class="ghost"
                              type="button"
                              disabled={
                                props.config?.readOnly === true || props.busy
                              }
                              onClick={() => props.onRemoveEdge(index())}
                            >
                              Remove Edge
                            </button>
                          </article>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                <div class="structure-block">
                  <div class="section-head">
                    <h3>Loops</h3>
                    <button
                      class="ghost"
                      type="button"
                      disabled={props.config?.readOnly === true || props.busy}
                      onClick={() => props.onAddLoop()}
                    >
                      Add Loop
                    </button>
                  </div>
                  <Show
                    when={(editableBundle().workflow.loops?.length ?? 0) > 0}
                    fallback={<p class="empty">No loops defined.</p>}
                  >
                    <div class="issues">
                      <For each={editableBundle().workflow.loops ?? []}>
                        {(loop, index) => (
                          <article class="issue-card">
                            <div class="property-grid">
                              <div>
                                <label for={`loop-id-${index()}`}>
                                  Loop ID
                                </label>
                                <input
                                  id={`loop-id-${index()}`}
                                  value={loop.id}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onInput={(event) => {
                                    props.onUpdateLoopField(
                                      index(),
                                      "id",
                                      event.currentTarget.value,
                                    );
                                  }}
                                />
                              </div>
                              <div>
                                <label for={`loop-judge-${index()}`}>
                                  Judge Node
                                </label>
                                <select
                                  id={`loop-judge-${index()}`}
                                  value={loop.judgeNodeId}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onChange={(event) => {
                                    props.onUpdateLoopField(
                                      index(),
                                      "judgeNodeId",
                                      event.currentTarget.value,
                                    );
                                  }}
                                >
                                  <option value="">
                                    Select a loop-judge node
                                  </option>
                                  <For each={loopJudgeNodes(editableBundle())}>
                                    {(node) => (
                                      <option value={node.id}>{node.id}</option>
                                    )}
                                  </For>
                                </select>
                              </div>
                              <div>
                                <label for={`loop-continue-${index()}`}>
                                  Continue When
                                </label>
                                <input
                                  id={`loop-continue-${index()}`}
                                  value={loop.continueWhen}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onInput={(event) => {
                                    props.onUpdateLoopField(
                                      index(),
                                      "continueWhen",
                                      event.currentTarget.value,
                                    );
                                  }}
                                />
                              </div>
                              <div>
                                <label for={`loop-exit-${index()}`}>
                                  Exit When
                                </label>
                                <input
                                  id={`loop-exit-${index()}`}
                                  value={loop.exitWhen}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onInput={(event) => {
                                    props.onUpdateLoopField(
                                      index(),
                                      "exitWhen",
                                      event.currentTarget.value,
                                    );
                                  }}
                                />
                              </div>
                              <div>
                                <label for={`loop-max-${index()}`}>
                                  Max Iterations
                                </label>
                                <input
                                  id={`loop-max-${index()}`}
                                  type="number"
                                  min="1"
                                  value={
                                    loop.maxIterations === undefined
                                      ? ""
                                      : String(loop.maxIterations)
                                  }
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onInput={(event) => {
                                    props.onUpdateLoopField(
                                      index(),
                                      "maxIterations",
                                      event.currentTarget.value,
                                    );
                                  }}
                                />
                              </div>
                            </div>
                            <button
                              class="ghost"
                              type="button"
                              disabled={
                                props.config?.readOnly === true || props.busy
                              }
                              onClick={() => props.onRemoveLoop(index())}
                            >
                              Remove Loop
                            </button>
                          </article>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                <div class="structure-block">
                  <div class="section-head">
                    <h3>Sub-Workflows</h3>
                    <button
                      class="ghost"
                      type="button"
                      disabled={props.config?.readOnly === true || props.busy}
                      onClick={() => props.onAddSubWorkflow()}
                    >
                      Add Sub-Workflow
                    </button>
                  </div>
                  <Show
                    when={editableBundle().workflow.subWorkflows.length > 0}
                    fallback={<p class="empty">No sub-workflows defined.</p>}
                  >
                    <div class="issues">
                      <For each={editableBundle().workflow.subWorkflows}>
                        {(subWorkflow, index) => (
                          <article class="issue-card">
                            <div class="property-grid">
                              <div>
                                <label for={`sub-workflow-id-${index()}`}>
                                  Sub-Workflow ID
                                </label>
                                <input
                                  id={`sub-workflow-id-${index()}`}
                                  value={subWorkflow.id}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onInput={(event) => {
                                    props.onUpdateSubWorkflowField(
                                      index(),
                                      "id",
                                      event.currentTarget.value,
                                    );
                                  }}
                                />
                              </div>
                              <div>
                                <label
                                  for={`sub-workflow-description-${index()}`}
                                >
                                  Description
                                </label>
                                <input
                                  id={`sub-workflow-description-${index()}`}
                                  value={subWorkflow.description}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onInput={(event) => {
                                    props.onUpdateSubWorkflowField(
                                      index(),
                                      "description",
                                      event.currentTarget.value,
                                    );
                                  }}
                                />
                              </div>
                              <div>
                                <label
                                  for={`sub-workflow-block-type-${index()}`}
                                >
                                  Block Type
                                </label>
                                <select
                                  id={`sub-workflow-block-type-${index()}`}
                                  value={subWorkflow.block?.type ?? "plain"}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onChange={(event) => {
                                    props.onUpdateSubWorkflowBlockType(
                                      index(),
                                      event.currentTarget
                                        .value as SubWorkflowBlockType,
                                    );
                                  }}
                                >
                                  <option value="plain">plain</option>
                                  <option value="branch-block">
                                    branch-block
                                  </option>
                                  <option value="loop-body">loop-body</option>
                                </select>
                              </div>
                              <Show
                                when={subWorkflow.block?.type === "loop-body"}
                              >
                                <div>
                                  <label
                                    for={`sub-workflow-loop-id-${index()}`}
                                  >
                                    Loop
                                  </label>
                                  <select
                                    id={`sub-workflow-loop-id-${index()}`}
                                    value={subWorkflow.block?.loopId ?? ""}
                                    disabled={
                                      props.config?.readOnly === true ||
                                      props.busy
                                    }
                                    onChange={(event) => {
                                      props.onUpdateSubWorkflowBlockLoopId(
                                        index(),
                                        event.currentTarget.value.trim(),
                                      );
                                    }}
                                  >
                                    <option value="">Select a loop</option>
                                    <For
                                      each={
                                        editableBundle().workflow.loops ?? []
                                      }
                                    >
                                      {(loop) => (
                                        <option value={loop.id}>
                                          {loop.id}
                                        </option>
                                      )}
                                    </For>
                                  </select>
                                </div>
                              </Show>
                              <div>
                                <label for={`sub-workflow-manager-${index()}`}>
                                  Manager Node
                                </label>
                                <select
                                  id={`sub-workflow-manager-${index()}`}
                                  value={subWorkflow.managerNodeId}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onChange={(event) => {
                                    props.onUpdateSubWorkflowBoundary(
                                      index(),
                                      "managerNodeId",
                                      event.currentTarget.value,
                                    );
                                  }}
                                >
                                  <For
                                    each={availableSubWorkflowBoundaryNodes(
                                      editableBundle(),
                                      "managerNodeId",
                                      subWorkflow.id,
                                    )}
                                  >
                                    {(node) => (
                                      <option value={node.id}>{node.id}</option>
                                    )}
                                  </For>
                                </select>
                              </div>
                              <div>
                                <label for={`sub-workflow-input-${index()}`}>
                                  Input Node
                                </label>
                                <select
                                  id={`sub-workflow-input-${index()}`}
                                  value={subWorkflow.inputNodeId}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onChange={(event) => {
                                    props.onUpdateSubWorkflowBoundary(
                                      index(),
                                      "inputNodeId",
                                      event.currentTarget.value,
                                    );
                                  }}
                                >
                                  <For
                                    each={availableSubWorkflowBoundaryNodes(
                                      editableBundle(),
                                      "inputNodeId",
                                      subWorkflow.id,
                                    )}
                                  >
                                    {(node) => (
                                      <option value={node.id}>{node.id}</option>
                                    )}
                                  </For>
                                </select>
                              </div>
                              <div>
                                <label for={`sub-workflow-output-${index()}`}>
                                  Output Node
                                </label>
                                <select
                                  id={`sub-workflow-output-${index()}`}
                                  value={subWorkflow.outputNodeId}
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onChange={(event) => {
                                    props.onUpdateSubWorkflowBoundary(
                                      index(),
                                      "outputNodeId",
                                      event.currentTarget.value,
                                    );
                                  }}
                                >
                                  <For
                                    each={availableSubWorkflowBoundaryNodes(
                                      editableBundle(),
                                      "outputNodeId",
                                      subWorkflow.id,
                                    )}
                                  >
                                    {(node) => (
                                      <option value={node.id}>{node.id}</option>
                                    )}
                                  </For>
                                </select>
                              </div>
                            </div>

                            <div class="selection-group">
                              <div class="section-head compact">
                                <h4>Member Nodes</h4>
                                <span>{subWorkflow.nodeIds.length}</span>
                              </div>
                              <div class="check-grid">
                                <For
                                  each={availableSubWorkflowMemberNodes(
                                    editableBundle(),
                                    subWorkflow.id,
                                  )}
                                >
                                  {(node) => {
                                    const lockedBoundary = (): boolean =>
                                      node.id === subWorkflow.managerNodeId ||
                                      node.id === subWorkflow.inputNodeId ||
                                      node.id === subWorkflow.outputNodeId;
                                    return (
                                      <label
                                        class="check-chip"
                                        classList={{ locked: lockedBoundary() }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={subWorkflow.nodeIds.includes(
                                            node.id,
                                          )}
                                          disabled={
                                            props.config?.readOnly === true ||
                                            props.busy ||
                                            lockedBoundary()
                                          }
                                          onChange={(event) => {
                                            props.onToggleSubWorkflowNodeMembership(
                                              index(),
                                              node.id,
                                              event.currentTarget.checked,
                                            );
                                          }}
                                        />
                                        <span>{node.id}</span>
                                        <small>{node.kind ?? "task"}</small>
                                      </label>
                                    );
                                  }}
                                </For>
                              </div>
                            </div>

                            <div class="selection-group">
                              <div class="section-head compact">
                                <h4>Input Sources</h4>
                                <button
                                  class="ghost"
                                  type="button"
                                  disabled={
                                    props.config?.readOnly === true ||
                                    props.busy
                                  }
                                  onClick={() =>
                                    props.onAddSubWorkflowInputSource(index())
                                  }
                                >
                                  Add Source
                                </button>
                              </div>
                              <Show
                                when={subWorkflow.inputSources.length > 0}
                                fallback={
                                  <p class="empty compact">
                                    No input sources defined.
                                  </p>
                                }
                              >
                                <div class="issues">
                                  <For each={subWorkflow.inputSources}>
                                    {(
                                      source: EditorSubWorkflowInputSource,
                                      sourceIndex,
                                    ) => (
                                      <article class="issue-card nested">
                                        <div class="property-grid">
                                          <div>
                                            <label
                                              for={`sub-workflow-source-type-${index()}-${sourceIndex()}`}
                                            >
                                              Source Type
                                            </label>
                                            <select
                                              id={`sub-workflow-source-type-${index()}-${sourceIndex()}`}
                                              value={source.type}
                                              disabled={
                                                props.config?.readOnly ===
                                                  true || props.busy
                                              }
                                              onChange={(event) => {
                                                props.onUpdateSubWorkflowInputSourceType(
                                                  index(),
                                                  sourceIndex(),
                                                  event.currentTarget
                                                    .value as SubWorkflowInputSourceType,
                                                );
                                              }}
                                            >
                                              <option value="human-input">
                                                human-input
                                              </option>
                                              <option value="workflow-output">
                                                workflow-output
                                              </option>
                                              <option value="node-output">
                                                node-output
                                              </option>
                                              <option value="sub-workflow-output">
                                                sub-workflow-output
                                              </option>
                                            </select>
                                          </div>
                                          <Show
                                            when={
                                              source.type === "workflow-output"
                                            }
                                          >
                                            <div>
                                              <label
                                                for={`sub-workflow-source-workflow-${index()}-${sourceIndex()}`}
                                              >
                                                Workflow ID
                                              </label>
                                              <input
                                                id={`sub-workflow-source-workflow-${index()}-${sourceIndex()}`}
                                                value={source.workflowId ?? ""}
                                                disabled={
                                                  props.config?.readOnly ===
                                                    true || props.busy
                                                }
                                                onInput={(event) => {
                                                  props.onUpdateSubWorkflowInputSourceField(
                                                    index(),
                                                    sourceIndex(),
                                                    "workflowId",
                                                    event.currentTarget.value.trim(),
                                                  );
                                                }}
                                              />
                                            </div>
                                          </Show>
                                          <Show
                                            when={source.type === "node-output"}
                                          >
                                            <div>
                                              <label
                                                for={`sub-workflow-source-node-${index()}-${sourceIndex()}`}
                                              >
                                                Node
                                              </label>
                                              <select
                                                id={`sub-workflow-source-node-${index()}-${sourceIndex()}`}
                                                value={source.nodeId ?? ""}
                                                disabled={
                                                  props.config?.readOnly ===
                                                    true || props.busy
                                                }
                                                onChange={(event) => {
                                                  props.onUpdateSubWorkflowInputSourceField(
                                                    index(),
                                                    sourceIndex(),
                                                    "nodeId",
                                                    event.currentTarget.value.trim(),
                                                  );
                                                }}
                                              >
                                                <option value="">
                                                  Select a node
                                                </option>
                                                <For
                                                  each={
                                                    editableBundle().workflow
                                                      .nodes
                                                  }
                                                >
                                                  {(node) => (
                                                    <option value={node.id}>
                                                      {node.id}
                                                    </option>
                                                  )}
                                                </For>
                                              </select>
                                            </div>
                                          </Show>
                                          <Show
                                            when={
                                              source.type ===
                                              "sub-workflow-output"
                                            }
                                          >
                                            <div>
                                              <label
                                                for={`sub-workflow-source-ref-${index()}-${sourceIndex()}`}
                                              >
                                                Sub-Workflow
                                              </label>
                                              <select
                                                id={`sub-workflow-source-ref-${index()}-${sourceIndex()}`}
                                                value={
                                                  source.subWorkflowId ?? ""
                                                }
                                                disabled={
                                                  props.config?.readOnly ===
                                                    true || props.busy
                                                }
                                                onChange={(event) => {
                                                  props.onUpdateSubWorkflowInputSourceField(
                                                    index(),
                                                    sourceIndex(),
                                                    "subWorkflowId",
                                                    event.currentTarget.value.trim(),
                                                  );
                                                }}
                                              >
                                                <option value="">
                                                  Select a sub-workflow
                                                </option>
                                                <For
                                                  each={subWorkflowInputSourceOptions(
                                                    editableBundle(),
                                                    subWorkflow,
                                                  )}
                                                >
                                                  {(entry) => (
                                                    <option value={entry.id}>
                                                      {entry.id}
                                                    </option>
                                                  )}
                                                </For>
                                              </select>
                                            </div>
                                          </Show>
                                        </div>
                                        <button
                                          class="ghost"
                                          type="button"
                                          disabled={
                                            props.config?.readOnly === true ||
                                            props.busy
                                          }
                                          onClick={() =>
                                            props.onRemoveSubWorkflowInputSource(
                                              index(),
                                              sourceIndex(),
                                            )
                                          }
                                        >
                                          Remove Source
                                        </button>
                                      </article>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>

                            <button
                              class="ghost"
                              type="button"
                              disabled={
                                props.config?.readOnly === true || props.busy
                              }
                              onClick={() => props.onRemoveSubWorkflow(index())}
                            >
                              Remove Sub-Workflow
                            </button>
                          </article>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </section>
  );
}
