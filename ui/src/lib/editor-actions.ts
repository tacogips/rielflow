import type {
  ExecuteWorkflowRequest,
  SessionStatus,
  UiConfigResponse,
} from "../../../src/shared/ui-contract";
import type { ValidationIssue } from "../../../src/workflow/types";
import {
  cancelWorkflowExecution as cancelWorkflowExecutionRequest,
  executeWorkflow as executeWorkflowRequest,
  loadConfig as loadUiConfig,
  saveWorkflowBundle as saveWorkflowBundleRequest,
  validateWorkflowBundle as validateWorkflowBundleRequest,
} from "./api-client";
import {
  createWorkflowEditorData,
  loadWorkflowEditorData,
  loadWorkflowPickerState,
  loadWorkflowSessionPanelState,
  type LoadedWorkflowEditorData,
  type LoadedWorkflowSessionPanelData,
  type WorkflowPickerState,
} from "./editor-data";
import {
  type SessionPanelState,
  type WorkflowEditorState,
  emptySessionPanelState,
  emptyWorkflowEditorState,
} from "./editor-state";
import type { EditorWorkflowBundle } from "./editor-workflow";
import {
  combinedValidationIssues,
  validationSummaryFromIssues,
} from "./editor-support";

export interface RefreshedEditorState {
  readonly config: UiConfigResponse;
  readonly workflowPickerState: WorkflowPickerState;
  readonly workflowState: WorkflowEditorState;
  readonly sessionPanelState: SessionPanelState;
  readonly selectedSessionPollStatus: SessionStatus | null;
}

export interface CreatedWorkflowState {
  readonly workflowPickerState: WorkflowPickerState;
  readonly workflowState: WorkflowEditorState;
  readonly sessionPanelState: SessionPanelState;
  readonly infoMessage: string;
}

export interface ValidatedWorkflowState {
  readonly validationIssues: ValidationIssue[];
  readonly validationSummary: string;
  readonly infoMessage: string;
}

export interface SavedWorkflowState extends LoadedWorkflowEditorData {
  readonly infoMessage: string;
}

export interface SessionActionState extends LoadedWorkflowSessionPanelData {
  readonly infoMessage?: string;
}

export interface ExecuteWorkflowState extends LoadedWorkflowSessionPanelData {
  readonly infoMessage: string;
}

export interface EditorActionDependencies {
  readonly loadConfig: typeof loadUiConfig;
  readonly loadWorkflowPickerState: typeof loadWorkflowPickerState;
  readonly loadWorkflowEditorData: typeof loadWorkflowEditorData;
  readonly createWorkflowEditorData: typeof createWorkflowEditorData;
  readonly loadWorkflowSessionPanelState: typeof loadWorkflowSessionPanelState;
  readonly validateWorkflowBundle: typeof validateWorkflowBundleRequest;
  readonly saveWorkflowBundle: typeof saveWorkflowBundleRequest;
  readonly executeWorkflow: typeof executeWorkflowRequest;
  readonly cancelWorkflowExecution: typeof cancelWorkflowExecutionRequest;
}

export interface EditorActions {
  refresh(input: {
    readonly selectedWorkflowName: string;
    readonly preferredNodeId: string;
    readonly selectedExecutionId: string;
  }): Promise<RefreshedEditorState>;
  loadWorkflow(input: {
    readonly workflowName: string;
    readonly preferredNodeId: string;
    readonly selectedExecutionId: string;
  }): Promise<LoadedWorkflowEditorData>;
  createWorkflow(input: {
    readonly config: UiConfigResponse | null;
    readonly workflowName: string;
    readonly preferredNodeId: string;
  }): Promise<CreatedWorkflowState>;
  validateWorkflow(input: {
    readonly workflowName: string;
    readonly bundle: EditorWorkflowBundle;
  }): Promise<ValidatedWorkflowState>;
  saveWorkflow(input: {
    readonly workflowName: string;
    readonly bundle: EditorWorkflowBundle;
    readonly expectedRevision?: string;
    readonly preferredNodeId: string;
    readonly selectedExecutionId: string;
  }): Promise<SavedWorkflowState>;
  refreshSessions(input: {
    readonly workflowName: string;
    readonly selectedExecutionId: string;
  }): Promise<SessionActionState>;
  selectSession(input: {
    readonly workflowName: string;
    readonly workflowExecutionId: string;
    readonly allowPollingOnSelectedSession?: boolean;
  }): Promise<SessionActionState>;
  executeWorkflow(input: {
    readonly workflowName: string;
    readonly request: ExecuteWorkflowRequest;
  }): Promise<ExecuteWorkflowState>;
  cancelWorkflowExecution(input: {
    readonly workflowName: string;
    readonly workflowExecutionId: string;
  }): Promise<SessionActionState>;
}

const defaultDependencies: EditorActionDependencies = {
  loadConfig: loadUiConfig,
  loadWorkflowPickerState,
  loadWorkflowEditorData,
  createWorkflowEditorData,
  loadWorkflowSessionPanelState,
  validateWorkflowBundle: validateWorkflowBundleRequest,
  saveWorkflowBundle: saveWorkflowBundleRequest,
  executeWorkflow: executeWorkflowRequest,
  cancelWorkflowExecution: cancelWorkflowExecutionRequest,
};

function loadWorkflowData(
  deps: EditorActionDependencies,
  input: {
    readonly workflowName: string;
    readonly preferredNodeId: string;
    readonly selectedExecutionId: string;
  },
): Promise<LoadedWorkflowEditorData> {
  return deps.loadWorkflowEditorData({
    workflowName: input.workflowName,
    preferredNodeId: input.preferredNodeId,
    selectedExecutionId: input.selectedExecutionId,
    allowPollingOnSelectedSession: true,
  });
}

function loadSessionPanelData(
  deps: EditorActionDependencies,
  input: {
    readonly workflowName: string;
    readonly selectedExecutionId: string;
    readonly allowPollingOnSelectedSession: boolean;
  },
): Promise<LoadedWorkflowSessionPanelData> {
  return deps.loadWorkflowSessionPanelState({
    workflowName: input.workflowName,
    selectedExecutionId: input.selectedExecutionId,
    allowPollingOnSelectedSession: input.allowPollingOnSelectedSession,
  });
}

export function createEditorActions(
  deps: EditorActionDependencies = defaultDependencies,
): EditorActions {
  return {
    async refresh(input) {
      const config = await deps.loadConfig();
      const workflowPickerState = await deps.loadWorkflowPickerState(
        config,
        input.selectedWorkflowName,
      );
      if (workflowPickerState.selectedWorkflowName.length === 0) {
        return {
          config,
          workflowPickerState,
          workflowState: emptyWorkflowEditorState(),
          sessionPanelState: emptySessionPanelState(),
          selectedSessionPollStatus: null,
        };
      }

      const loaded = await loadWorkflowData(deps, {
        workflowName: workflowPickerState.selectedWorkflowName,
        preferredNodeId: input.preferredNodeId,
        selectedExecutionId: input.selectedExecutionId,
      });

      return {
        config,
        workflowPickerState,
        workflowState: loaded.workflowState,
        sessionPanelState: loaded.sessionPanelState,
        selectedSessionPollStatus: loaded.selectedSessionPollStatus,
      };
    },

    loadWorkflow(input) {
      return loadWorkflowData(deps, {
        workflowName: input.workflowName,
        preferredNodeId: input.preferredNodeId,
        selectedExecutionId: input.selectedExecutionId,
      });
    },

    async createWorkflow(input) {
      const created = await deps.createWorkflowEditorData({
        workflowName: input.workflowName,
        preferredNodeId: input.preferredNodeId,
      });
      const workflowPickerState = await deps.loadWorkflowPickerState(
        input.config,
        created.workflowName,
      );
      return {
        workflowPickerState,
        workflowState: created.workflowState,
        sessionPanelState: created.sessionPanelState,
        infoMessage: `Created workflow '${created.workflowName}'.`,
      };
    },

    async validateWorkflow(input) {
      const result = await deps.validateWorkflowBundle(
        input.workflowName,
        input.bundle,
      );
      const validationIssues = combinedValidationIssues(result);
      const validationSummary = validationSummaryFromIssues(
        result.valid,
        validationIssues,
      );
      return {
        validationIssues,
        validationSummary,
        infoMessage: validationSummary,
      };
    },

    async saveWorkflow(input) {
      const saved = await deps.saveWorkflowBundle({
        workflowName: input.workflowName,
        bundle: input.bundle,
        ...(input.expectedRevision === undefined
          ? {}
          : { expectedRevision: input.expectedRevision }),
      });
      const loaded = await loadWorkflowData(deps, {
        workflowName: input.workflowName,
        preferredNodeId: input.preferredNodeId,
        selectedExecutionId: input.selectedExecutionId,
      });
      return {
        ...loaded,
        infoMessage: `Saved workflow '${saved.workflowName}' at revision ${saved.revision}.`,
      };
    },

    async refreshSessions(input) {
      return {
        ...(await loadSessionPanelData(deps, {
          workflowName: input.workflowName,
          selectedExecutionId: input.selectedExecutionId,
          allowPollingOnSelectedSession: true,
        })),
        infoMessage: `Refreshed sessions for '${input.workflowName}'.`,
      };
    },

    selectSession(input) {
      return loadSessionPanelData(deps, {
        workflowName: input.workflowName,
        selectedExecutionId: input.workflowExecutionId,
        allowPollingOnSelectedSession:
          input.allowPollingOnSelectedSession ?? true,
      });
    },

    async executeWorkflow(input) {
      const result = await deps.executeWorkflow(
        input.workflowName,
        input.request,
      );
      const loaded = await loadSessionPanelData(deps, {
        workflowName: input.workflowName,
        selectedExecutionId: result.workflowExecutionId,
        allowPollingOnSelectedSession: true,
      });
      return {
        ...loaded,
        infoMessage:
          result.accepted === true
            ? `Execution accepted for '${input.workflowName}' as execution ${result.workflowExecutionId}.`
            : `Execution ${result.workflowExecutionId} completed with session ${result.sessionId} in status ${result.status}.`,
      };
    },

    async cancelWorkflowExecution(input) {
      const result = await deps.cancelWorkflowExecution(
        input.workflowExecutionId,
      );
      return {
        ...(await loadSessionPanelData(deps, {
          workflowName: input.workflowName,
          selectedExecutionId: input.workflowExecutionId,
          allowPollingOnSelectedSession: true,
        })),
        infoMessage: result.accepted
          ? `Cancelled execution ${input.workflowExecutionId}.`
          : `Execution ${input.workflowExecutionId} is already ${result.status}.`,
      };
    },
  };
}
