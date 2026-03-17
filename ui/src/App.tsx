import { createSignal, onCleanup, onMount, type JSX } from "solid-js";

import { WorkflowSaveValidationError } from "./lib/api-client";
import {
  combinedValidationIssues,
  toErrorMessage,
  validationSummaryFromIssues,
  workflowBundleDirty,
} from "./lib/editor-support";
import {
  loadEditorAppShellData,
  type EditorAppShellData,
} from "./lib/editor-app-controller";
import { createEditorActions } from "./lib/editor-actions";
import { buildExecuteWorkflowRequest } from "./lib/editor-execution";
import {
  applyEditorSessionUpdate,
  cancelSelectedEditorSession,
  executeEditorWorkflow,
  pollSelectedEditorSession,
  refreshEditorSessions,
  selectEditorSession,
} from "./lib/editor-session-controller";
import {
  updateEdgeFieldValue,
  updateNodeCompletionValue,
  updateNodeKindValue,
  updateNodePayloadObjectValue,
  updateNodePayloadStringValue,
  updateNodePayloadTypeValue,
  updateNodeTimeoutValue,
  updateWorkflowContainerRuntimeValue,
  updateWorkflowDefaultValue,
  updateWorkflowDescriptionValue,
  updateWorkflowManagerNodeValue,
} from "./lib/editor-field-updates";
import {
  addEdgeToBundle,
  addLoopToBundle,
  addNodeToBundle,
  addSubWorkflowInputSource,
  addSubWorkflowToBundle,
  removeEdgeFromBundle,
  removeLoopFromBundle,
  removeNodeFromBundle,
  removeSubWorkflowFromBundle,
  removeSubWorkflowInputSource,
  toggleSubWorkflowNodeMembership,
  updateLoopField,
  updateSubWorkflowBlockLoopId,
  updateSubWorkflowBlockType,
  updateSubWorkflowBoundary,
  updateSubWorkflowField,
  updateSubWorkflowInputSourceField,
  updateSubWorkflowInputSourceType,
  type MutationResult,
} from "./lib/editor-mutations";
import {
  emptyValidationState,
  syncSelectedNodeVariablesOrThrow,
  workflowStateAfterMutation,
  workflowStateWithNodeVariablesText,
  workflowStateWithSelectedNode,
} from "./lib/editor-editing-state";
import { moveNode as moveWorkflowNode } from "./lib/editor-workflow-operations";
import AppShell from "./lib/components/AppShell";
import ExecutionPanel from "./lib/components/ExecutionPanel";
import WorkflowEditorPanel from "./lib/components/WorkflowEditorPanel";
import WorkflowSidebar from "./lib/components/WorkflowSidebar";
import "./app.css";
import "./styles/editor-ui.css";
import type {
  CompletionType,
  NodeKind,
  NodeType,
  SubWorkflowBlockType,
  SubWorkflowInputSourceType,
  ValidationIssue,
} from "../../src/workflow/types";
import type { EditorWorkflowEdge } from "./lib/editor-workflow";

const SESSION_POLL_INTERVAL_MS = 2_000;

export default function App(): JSX.Element {
  const editorActions = createEditorActions();

  const [appData, setAppData] = createSignal<EditorAppShellData | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal("");
  const [infoMessage, setInfoMessage] = createSignal("");
  const [newWorkflowName, setNewWorkflowName] = createSignal("");
  const [newNodeId, setNewNodeId] = createSignal("");
  const [newNodeKind, setNewNodeKind] = createSignal<NodeKind>("task");
  const [runtimeVariablesText, setRuntimeVariablesText] = createSignal(
    '{\n  "topic": "demo"\n}',
  );
  const [mockScenarioText, setMockScenarioText] = createSignal("");
  const [maxStepsText, setMaxStepsText] = createSignal("");
  const [maxLoopIterationsText, setMaxLoopIterationsText] = createSignal("");
  const [defaultTimeoutText, setDefaultTimeoutText] = createSignal("");
  const [runAsync, setRunAsync] = createSignal(true);
  const [runDryRun, setRunDryRun] = createSignal(false);
  const [validationIssues, setValidationIssues] = createSignal<
    readonly ValidationIssue[]
  >(emptyValidationState().validationIssues);
  const [validationSummary, setValidationSummary] = createSignal(
    emptyValidationState().validationSummary,
  );

  let sessionPollTimer: ReturnType<typeof setTimeout> | null = null;

  function clearSessionPoll(): void {
    if (sessionPollTimer !== null) {
      clearTimeout(sessionPollTimer);
      sessionPollTimer = null;
    }
  }

  function patchAppData(
    updater: (current: EditorAppShellData) => EditorAppShellData,
  ): void {
    const current = appData();
    if (current === null) {
      return;
    }
    setAppData(updater(current));
  }

  function clearValidation(): void {
    setValidationIssues(emptyValidationState().validationIssues);
    setValidationSummary(emptyValidationState().validationSummary);
  }

  function editableBundleForMutation(minimumNodeCount?: number) {
    const current = appData();
    const bundle = current?.workflowState.editableBundle ?? null;
    if (bundle === null || current?.config.readOnly === true) {
      return null;
    }

    if (
      minimumNodeCount !== undefined &&
      bundle.workflow.nodes.length < minimumNodeCount
    ) {
      return null;
    }

    return bundle;
  }

  function patchWorkflowState(
    updater: (
      current: EditorAppShellData,
    ) => EditorAppShellData["workflowState"],
  ): void {
    patchAppData((current) => ({
      ...current,
      workflowState: updater(current),
    }));
  }

  function applyWorkflowMutation(
    result: boolean | { readonly ok: boolean; readonly error?: string },
    options?: {
      readonly syncSelectedNode?: boolean;
    },
  ): boolean {
    if (result === false) {
      return false;
    }

    if (result !== true && result.ok !== true) {
      setErrorMessage(result.error ?? "Workflow update failed.");
      return false;
    }

    patchWorkflowState((current) =>
      workflowStateAfterMutation(current.workflowState, options),
    );
    clearValidation();
    return true;
  }

  function updateWorkflowStateAfterMutation(
    result: boolean | MutationResult,
    updater: (
      current: EditorAppShellData["workflowState"],
    ) => EditorAppShellData["workflowState"],
  ): boolean {
    if (result === false) {
      return false;
    }

    if (result !== true && result.ok !== true) {
      setErrorMessage(result.error ?? "Workflow update failed.");
      return false;
    }

    patchWorkflowState((current) => updater(current.workflowState));
    clearValidation();
    return true;
  }

  function syncSessionPolling(
    workflowExecutionId: string,
    status: EditorAppShellData["selectedSessionPollStatus"],
  ): void {
    clearSessionPoll();
    if (workflowExecutionId.length === 0 || status !== "running") {
      return;
    }

    sessionPollTimer = setTimeout(() => {
      void pollSelectedSession(workflowExecutionId);
    }, SESSION_POLL_INTERVAL_MS);
  }

  function applyLoadedData(loaded: EditorAppShellData): void {
    setAppData(loaded);
    clearValidation();
    syncSessionPolling(
      loaded.sessionPanelState.selectedExecutionId,
      loaded.selectedSessionPollStatus,
    );
  }

  async function refresh(options?: {
    readonly selectedWorkflowName?: string;
    readonly selectedExecutionId?: string;
  }): Promise<void> {
    setBusy(true);
    setErrorMessage("");

    try {
      const current = appData();
      const loaded = await loadEditorAppShellData({
        selectedWorkflowName:
          options?.selectedWorkflowName ?? current?.selectedWorkflowName ?? "",
        selectedExecutionId:
          options?.selectedExecutionId ??
          current?.sessionPanelState.selectedExecutionId ??
          "",
        preferredNodeId: current?.workflowState.selectedNodeId ?? "",
      });
      applyLoadedData(loaded);
      setNewWorkflowName("");
      setInfoMessage(loaded.statusMessage);
    } catch (error: unknown) {
      clearSessionPoll();
      setInfoMessage("");
      setErrorMessage(toErrorMessage(error));
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }

  async function selectWorkflow(workflowName: string): Promise<void> {
    patchAppData((current) => ({
      ...current,
      selectedWorkflowName: workflowName,
    }));
    await refresh({
      selectedWorkflowName: workflowName,
      selectedExecutionId: "",
    });
  }

  async function createWorkflow(): Promise<void> {
    const workflowName = newWorkflowName().trim();
    if (workflowName.length === 0) {
      return;
    }

    setBusy(true);
    setErrorMessage("");

    try {
      const created = await editorActions.createWorkflow({
        config: appData()?.config ?? null,
        workflowName,
        preferredNodeId: "",
      });
      const loaded = await loadEditorAppShellData({
        selectedWorkflowName: created.workflowPickerState.selectedWorkflowName,
        preferredNodeId: created.workflowState.selectedNodeId,
      });
      applyLoadedData(loaded);
      setNewWorkflowName("");
      setInfoMessage(created.infoMessage);
    } catch (error: unknown) {
      clearSessionPoll();
      setInfoMessage("");
      setErrorMessage(toErrorMessage(error));
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }

  async function refreshSessions(): Promise<void> {
    const current = appData();
    const workflowName = current?.selectedWorkflowName ?? "";
    if (workflowName.length === 0) {
      return;
    }

    setBusy(true);
    setErrorMessage("");

    try {
      const loaded = await refreshEditorSessions(
        {
          workflowName,
          selectedExecutionId:
            current?.sessionPanelState.selectedExecutionId ?? "",
        },
        editorActions,
      );
      patchAppData((appState) => applyEditorSessionUpdate(appState, loaded));
      syncSessionPolling(
        loaded.sessionPanelState.selectedExecutionId,
        loaded.selectedSessionPollStatus,
      );
      if (loaded.infoMessage !== undefined) {
        setInfoMessage(loaded.infoMessage);
      }
    } catch (error: unknown) {
      clearSessionPoll();
      setInfoMessage("");
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function selectSession(workflowExecutionId: string): Promise<void> {
    const current = appData();
    const workflowName = current?.selectedWorkflowName ?? "";
    if (workflowName.length === 0) {
      return;
    }

    setBusy(true);
    setErrorMessage("");

    try {
      const loaded = await selectEditorSession(
        {
          workflowName,
          workflowExecutionId,
        },
        editorActions,
      );
      patchAppData((appState) => applyEditorSessionUpdate(appState, loaded));
      syncSessionPolling(
        loaded.sessionPanelState.selectedExecutionId,
        loaded.selectedSessionPollStatus,
      );
    } catch (error: unknown) {
      clearSessionPoll();
      setInfoMessage("");
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function pollSelectedSession(
    workflowExecutionId: string,
  ): Promise<void> {
    const current = appData();
    const workflowName = current?.selectedWorkflowName ?? "";
    if (workflowName.length === 0) {
      return;
    }

    const result = await pollSelectedEditorSession(
      {
        workflowName,
        selectedExecutionId:
          current?.sessionPanelState.selectedExecutionId ?? "",
        workflowExecutionId,
      },
      editorActions,
    );
    if (result.kind === "updated") {
      const latest = appData();
      if (
        latest === null ||
        latest.selectedWorkflowName !== workflowName ||
        latest.sessionPanelState.selectedExecutionId !== workflowExecutionId
      ) {
        return;
      }

      patchAppData((appState) =>
        applyEditorSessionUpdate(appState, result.update),
      );
      syncSessionPolling(
        result.update.sessionPanelState.selectedExecutionId,
        result.update.selectedSessionPollStatus,
      );
      return;
    }

    if (result.kind === "retry") {
      clearSessionPoll();
      setErrorMessage(result.errorMessage);
      syncSessionPolling(workflowExecutionId, "running");
    }
  }

  async function executeWorkflow(): Promise<void> {
    const current = appData();
    const workflowName = current?.selectedWorkflowName ?? "";
    if (workflowName.length === 0) {
      return;
    }

    setBusy(true);
    setErrorMessage("");

    try {
      const loaded = await executeEditorWorkflow(
        {
          workflowName,
          request: buildExecuteWorkflowRequest({
            runtimeVariablesText: runtimeVariablesText(),
            mockScenarioText: mockScenarioText(),
            maxStepsText: maxStepsText(),
            maxLoopIterationsText: maxLoopIterationsText(),
            defaultTimeoutText: defaultTimeoutText(),
            runAsync: runAsync(),
            runDryRun: runDryRun(),
          }),
        },
        editorActions,
      );
      patchAppData((appState) => applyEditorSessionUpdate(appState, loaded));
      syncSessionPolling(
        loaded.sessionPanelState.selectedExecutionId,
        loaded.selectedSessionPollStatus,
      );
      setInfoMessage(loaded.infoMessage ?? "");
    } catch (error: unknown) {
      clearSessionPoll();
      setInfoMessage("");
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancelSelectedSession(): Promise<void> {
    const current = appData();
    const workflowName = current?.selectedWorkflowName ?? "";
    const workflowExecutionId =
      current?.sessionPanelState.selectedExecutionId ?? "";
    if (workflowName.length === 0 || workflowExecutionId.length === 0) {
      return;
    }

    setBusy(true);
    setErrorMessage("");

    try {
      const loaded = await cancelSelectedEditorSession(
        {
          workflowName,
          workflowExecutionId,
        },
        editorActions,
      );
      patchAppData((appState) => applyEditorSessionUpdate(appState, loaded));
      syncSessionPolling(
        loaded.sessionPanelState.selectedExecutionId,
        loaded.selectedSessionPollStatus,
      );
      if (loaded.infoMessage !== undefined) {
        setInfoMessage(loaded.infoMessage);
      }
    } catch (error: unknown) {
      clearSessionPoll();
      setInfoMessage("");
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function setSelectedNode(nodeId: string): void {
    patchWorkflowState((current) =>
      workflowStateWithSelectedNode(current.workflowState, nodeId),
    );
  }

  function syncVariablesText(value: string): void {
    patchWorkflowState((current) =>
      workflowStateWithNodeVariablesText(current.workflowState, value),
    );
  }

  function updateDescription(value: string): void {
    applyWorkflowMutation(
      updateWorkflowDescriptionValue(editableBundleForMutation(), value),
    );
  }

  function updateDefaultNumber(
    field: "maxLoopIterations" | "nodeTimeoutMs",
    value: string,
  ): void {
    applyWorkflowMutation(
      updateWorkflowDefaultValue(editableBundleForMutation(), field, value),
    );
  }

  function updateContainerRuntime(value: string): void {
    applyWorkflowMutation(
      updateWorkflowContainerRuntimeValue(editableBundleForMutation(), value),
    );
  }

  function updateManagerNode(value: string): void {
    applyWorkflowMutation(
      updateWorkflowManagerNodeValue(editableBundleForMutation(), value),
      { syncSelectedNode: true },
    );
  }

  function updateNodeKind(nodeId: string, value: NodeKind): void {
    applyWorkflowMutation(
      updateNodeKindValue(editableBundleForMutation(), nodeId, value),
      { syncSelectedNode: true },
    );
  }

  function updateNodeCompletion(nodeId: string, value: CompletionType): void {
    applyWorkflowMutation(
      updateNodeCompletionValue(editableBundleForMutation(), nodeId, value),
      { syncSelectedNode: true },
    );
  }

  function updateNodePayloadString(
    field: "executionBackend" | "model" | "promptTemplate",
    value: string,
  ): void {
    applyWorkflowMutation(
      updateNodePayloadStringValue(
        appData()?.workflowState.selectedNodePayload ?? null,
        field,
        value,
      ),
    );
  }

  function updateNodeType(value: NodeType): void {
    applyWorkflowMutation(
      updateNodePayloadTypeValue(
        appData()?.workflowState.selectedNodePayload ?? null,
        value,
      ),
    );
  }

  function updateNodePayloadObject(
    field: "command" | "container" | "durability",
    value: string,
  ): void {
    applyWorkflowMutation(
      updateNodePayloadObjectValue(
        appData()?.workflowState.selectedNodePayload ?? null,
        field,
        value,
      ),
    );
  }

  function updateNodeTimeout(value: string): void {
    applyWorkflowMutation(
      updateNodeTimeoutValue(
        appData()?.workflowState.selectedNodePayload ?? null,
        value,
      ),
    );
  }

  function moveNode(nodeId: string, direction: -1 | 1): void {
    applyWorkflowMutation(
      moveWorkflowNode(editableBundleForMutation(), nodeId, direction),
    );
  }

  function addNode(): void {
    const result = addNodeToBundle(editableBundleForMutation(), {
      nodeIdInput: newNodeId(),
      kind: newNodeKind(),
    });
    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }

    setNewNodeId("");
    updateWorkflowStateAfterMutation(result, (current) => {
      const nextWorkflowState = {
        ...current,
        selectedNodeId: result.nodeId,
      };
      return workflowStateAfterMutation(nextWorkflowState, {
        syncSelectedNode: true,
      });
    });
  }

  function removeNode(nodeId: string): void {
    const result = removeNodeFromBundle(editableBundleForMutation(), nodeId);
    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }

    updateWorkflowStateAfterMutation(result, (current) => {
      const nextSelectedNodeId =
        current.selectedNodeId === nodeId
          ? result.nextSelectedNodeId
          : current.selectedNodeId;
      return workflowStateAfterMutation(
        {
          ...current,
          selectedNodeId: nextSelectedNodeId,
        },
        { syncSelectedNode: true },
      );
    });
  }

  function addEdge(): void {
    applyWorkflowMutation(addEdgeToBundle(editableBundleForMutation(2)));
  }

  function removeEdge(index: number): void {
    applyWorkflowMutation(
      removeEdgeFromBundle(editableBundleForMutation(), index),
    );
  }

  function updateEdgeField(
    index: number,
    field: keyof EditorWorkflowEdge,
    value: string,
  ): void {
    applyWorkflowMutation(
      updateEdgeFieldValue(editableBundleForMutation(), index, field, value),
    );
  }

  function addLoop(): void {
    applyWorkflowMutation(addLoopToBundle(editableBundleForMutation()));
  }

  function removeLoop(index: number): void {
    applyWorkflowMutation(
      removeLoopFromBundle(editableBundleForMutation(), index),
    );
  }

  function updateLoopRule(
    index: number,
    field: "id" | "judgeNodeId" | "continueWhen" | "exitWhen" | "maxIterations",
    value: string,
  ): void {
    applyWorkflowMutation(
      updateLoopField(editableBundleForMutation(), index, field, value),
    );
  }

  function addSubWorkflow(): void {
    applyWorkflowMutation(addSubWorkflowToBundle(editableBundleForMutation()));
  }

  function removeSubWorkflow(index: number): void {
    applyWorkflowMutation(
      removeSubWorkflowFromBundle(editableBundleForMutation(), index),
    );
  }

  function updateSubWorkflowMeta(
    index: number,
    field: "id" | "description",
    value: string,
  ): void {
    applyWorkflowMutation(
      updateSubWorkflowField(editableBundleForMutation(), index, field, value),
    );
  }

  function updateSubWorkflowType(
    index: number,
    value: SubWorkflowBlockType,
  ): void {
    applyWorkflowMutation(
      updateSubWorkflowBlockType(editableBundleForMutation(), index, value),
    );
  }

  function updateSubWorkflowLoop(index: number, value: string): void {
    applyWorkflowMutation(
      updateSubWorkflowBlockLoopId(
        editableBundleForMutation(),
        index,
        value.trim(),
      ),
    );
  }

  function updateSubWorkflowBoundaryField(
    index: number,
    field: "managerNodeId" | "inputNodeId" | "outputNodeId",
    value: string,
  ): void {
    applyWorkflowMutation(
      updateSubWorkflowBoundary(
        editableBundleForMutation(),
        index,
        field,
        value,
      ),
      { syncSelectedNode: true },
    );
  }

  function toggleSubWorkflowMembership(
    index: number,
    nodeId: string,
    checked: boolean,
  ): void {
    applyWorkflowMutation(
      toggleSubWorkflowNodeMembership(
        editableBundleForMutation(),
        index,
        nodeId,
        checked,
      ),
    );
  }

  function addSubWorkflowSource(index: number): void {
    applyWorkflowMutation(
      addSubWorkflowInputSource(editableBundleForMutation(), index),
    );
  }

  function removeSubWorkflowSource(index: number, sourceIndex: number): void {
    applyWorkflowMutation(
      removeSubWorkflowInputSource(
        editableBundleForMutation(),
        index,
        sourceIndex,
      ),
    );
  }

  function updateSubWorkflowSourceType(
    index: number,
    sourceIndex: number,
    value: SubWorkflowInputSourceType,
  ): void {
    applyWorkflowMutation(
      updateSubWorkflowInputSourceType(
        editableBundleForMutation(),
        index,
        sourceIndex,
        value,
      ),
    );
  }

  function updateSubWorkflowSourceField(
    index: number,
    sourceIndex: number,
    field: "workflowId" | "nodeId" | "subWorkflowId",
    value: string,
  ): void {
    applyWorkflowMutation(
      updateSubWorkflowInputSourceField(
        editableBundleForMutation(),
        index,
        sourceIndex,
        field,
        value.trim(),
      ),
    );
  }

  async function validateWorkflow(): Promise<void> {
    const current = appData();
    const workflowName = current?.selectedWorkflowName ?? "";
    const workflowState = current?.workflowState;
    if (!workflowState?.editableBundle || workflowName.length === 0) {
      return;
    }

    setBusy(true);
    setErrorMessage("");

    try {
      const syncedWorkflowState =
        syncSelectedNodeVariablesOrThrow(workflowState);
      patchWorkflowState(() => syncedWorkflowState);
      const result = await editorActions.validateWorkflow({
        workflowName,
        bundle: syncedWorkflowState.editableBundle!,
      });
      setValidationIssues(result.validationIssues);
      setValidationSummary(result.validationSummary);
      setInfoMessage(result.infoMessage);
    } catch (error: unknown) {
      setValidationSummary("");
      setInfoMessage("");
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveWorkflow(): Promise<void> {
    const current = appData();
    if (current === null) {
      return;
    }

    const workflowName = current.selectedWorkflowName;
    const workflowState = current.workflowState;
    if (
      !workflowState.editableBundle ||
      workflowName.length === 0 ||
      current.config.readOnly === true
    ) {
      return;
    }

    setBusy(true);
    setErrorMessage("");

    try {
      const syncedWorkflowState =
        syncSelectedNodeVariablesOrThrow(workflowState);
      patchWorkflowState(() => syncedWorkflowState);
      const nextState = await editorActions.saveWorkflow({
        workflowName,
        bundle: syncedWorkflowState.editableBundle!,
        ...(syncedWorkflowState.workflow?.revision === null ||
        syncedWorkflowState.workflow?.revision === undefined
          ? {}
          : { expectedRevision: syncedWorkflowState.workflow.revision }),
        preferredNodeId: syncedWorkflowState.selectedNodeId,
        selectedExecutionId:
          current?.sessionPanelState.selectedExecutionId ?? "",
      });
      applyLoadedData({
        config: current.config,
        workflows: current.workflows,
        selectedWorkflowName: current.selectedWorkflowName,
        workflowState: nextState.workflowState,
        sessionPanelState: nextState.sessionPanelState,
        selectedSessionPollStatus: nextState.selectedSessionPollStatus,
        statusMessage: current.statusMessage,
      });
      setInfoMessage(nextState.infoMessage);
    } catch (error: unknown) {
      if (error instanceof WorkflowSaveValidationError) {
        const nextValidationIssues = combinedValidationIssues({
          valid: false,
          issues: error.issues,
        });
        setValidationIssues(nextValidationIssues);
        setValidationSummary(
          validationSummaryFromIssues(false, nextValidationIssues),
        );
      }
      setInfoMessage("");
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  onMount(() => {
    void refresh();
  });

  onCleanup(() => {
    clearSessionPoll();
  });

  const hasEditableBundle = (): boolean =>
    appData()?.workflowState.editableBundle !== null;
  const workflowDirty = (): boolean => {
    const current = appData();
    if (current === null) {
      return false;
    }
    return workflowBundleDirty(
      current.workflowState.workflow?.bundle,
      current.workflowState.editableBundle,
    );
  };

  return (
    <AppShell
      config={appData()?.config ?? null}
      loading={loading()}
      busy={busy()}
      errorMessage={errorMessage()}
      infoMessage={infoMessage()}
      workflowCount={appData()?.workflows.length ?? 0}
      sessionCount={appData()?.sessionPanelState.sessions.length ?? 0}
      selectedWorkflowName={appData()?.selectedWorkflowName ?? ""}
      onReload={() => refresh()}
      sidebar={
        <WorkflowSidebar
          workflows={appData()?.workflows ?? []}
          selectedWorkflowName={appData()?.selectedWorkflowName ?? ""}
          newWorkflowName={newWorkflowName()}
          loading={loading()}
          busy={busy()}
          hasEditableBundle={hasEditableBundle()}
          workflowDirty={workflowDirty()}
          config={appData()?.config ?? null}
          onSelectedWorkflowNameChange={(workflowName) => {
            patchAppData((current) => ({
              ...current,
              selectedWorkflowName: workflowName,
            }));
          }}
          onNewWorkflowNameChange={setNewWorkflowName}
          onSelectWorkflow={selectWorkflow}
          onCreateWorkflow={createWorkflow}
          onValidateWorkflow={validateWorkflow}
          onSaveWorkflow={saveWorkflow}
          onRefreshSessions={refreshSessions}
        />
      }
      editor={
        <WorkflowEditorPanel
          newNodeId={newNodeId()}
          newNodeKind={newNodeKind()}
          loading={loading()}
          busy={busy()}
          config={appData()?.config ?? null}
          workflow={appData()?.workflowState.workflow ?? null}
          editableBundle={appData()?.workflowState.editableBundle ?? null}
          editableDerivedVisualization={
            appData()?.workflowState.editableDerivedVisualization ?? []
          }
          selectedNodeId={appData()?.workflowState.selectedNodeId ?? ""}
          selectedNode={appData()?.workflowState.selectedNode ?? null}
          selectedNodePayload={
            appData()?.workflowState.selectedNodePayload ?? null
          }
          nodeVariablesText={appData()?.workflowState.nodeVariablesText ?? "{}"}
          validationIssues={validationIssues()}
          validationSummary={validationSummary()}
          workflowDirty={workflowDirty()}
          onNewNodeIdChange={setNewNodeId}
          onNewNodeKindChange={setNewNodeKind}
          onUpdateDescription={updateDescription}
          onUpdateDefaultNumber={updateDefaultNumber}
          onUpdateContainerRuntime={updateContainerRuntime}
          onUpdateManagerNode={updateManagerNode}
          onAddNode={addNode}
          onUpdateNodeKind={updateNodeKind}
          onUpdateNodeCompletion={updateNodeCompletion}
          onUpdateNodePayloadString={updateNodePayloadString}
          onUpdateNodeType={updateNodeType}
          onUpdateNodePayloadObject={updateNodePayloadObject}
          onUpdateNodeTimeout={updateNodeTimeout}
          onSyncVariablesText={syncVariablesText}
          onSetSelectedNode={setSelectedNode}
          onMoveNode={moveNode}
          onRemoveNode={removeNode}
          onAddEdge={addEdge}
          onRemoveEdge={removeEdge}
          onUpdateEdgeField={updateEdgeField}
          onAddLoop={addLoop}
          onRemoveLoop={removeLoop}
          onUpdateLoopField={updateLoopRule}
          onAddSubWorkflow={addSubWorkflow}
          onRemoveSubWorkflow={removeSubWorkflow}
          onUpdateSubWorkflowField={updateSubWorkflowMeta}
          onUpdateSubWorkflowBlockType={updateSubWorkflowType}
          onUpdateSubWorkflowBlockLoopId={updateSubWorkflowLoop}
          onUpdateSubWorkflowBoundary={updateSubWorkflowBoundaryField}
          onToggleSubWorkflowNodeMembership={toggleSubWorkflowMembership}
          onAddSubWorkflowInputSource={addSubWorkflowSource}
          onRemoveSubWorkflowInputSource={removeSubWorkflowSource}
          onUpdateSubWorkflowInputSourceType={updateSubWorkflowSourceType}
          onUpdateSubWorkflowInputSourceField={updateSubWorkflowSourceField}
        />
      }
      execution={
        <ExecutionPanel
          selectedWorkflowName={appData()?.selectedWorkflowName ?? ""}
          config={appData()?.config ?? null}
          busy={busy()}
          runtimeVariablesText={runtimeVariablesText()}
          mockScenarioText={mockScenarioText()}
          maxStepsText={maxStepsText()}
          maxLoopIterationsText={maxLoopIterationsText()}
          defaultTimeoutText={defaultTimeoutText()}
          runAsync={runAsync()}
          runDryRun={runDryRun()}
          sessions={appData()?.sessionPanelState.sessions ?? []}
          selectedExecutionId={
            appData()?.sessionPanelState.selectedExecutionId ?? ""
          }
          selectedSession={appData()?.sessionPanelState.selectedSession ?? null}
          onRuntimeVariablesTextChange={setRuntimeVariablesText}
          onMockScenarioTextChange={setMockScenarioText}
          onMaxStepsTextChange={setMaxStepsText}
          onMaxLoopIterationsTextChange={setMaxLoopIterationsText}
          onDefaultTimeoutTextChange={setDefaultTimeoutText}
          onRunAsyncChange={setRunAsync}
          onRunDryRunChange={setRunDryRun}
          onExecuteWorkflow={executeWorkflow}
          onCancelSelectedSession={cancelSelectedSession}
          onSelectSession={selectSession}
        />
      }
    />
  );
}
