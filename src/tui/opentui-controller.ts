import type { LoadedWorkflow } from "../workflow/load";
import type { NodeExecutionRecord, WorkflowSessionState } from "../workflow/session";
import type { RuntimeSessionSummary } from "../workflow/runtime-db";
import type {
  FocusPane,
  HistoryViewMode,
  OpenTuiNavigationState,
  OpenTuiCopyTargetInput,
  RuntimeSessionView,
  ScreenMode,
  TuiWorkflowInputDetection,
  TuiWorkflowInputMode,
} from "./opentui-model";
import {
  buildTuiRuntimeVariables,
  describeTuiWorkflowInputSyntax,
  deriveEditorTextFromRuntimeVariables,
  formatEditorValue,
  formatJsonEditorText,
  resolveOpenTuiCopyTarget,
} from "./opentui-model";

export interface OpenTuiPopupState {
  readonly agentSessionOpen: boolean;
  readonly filterOpen: boolean;
  readonly helpOpen: boolean;
  readonly nodeDefinitionOpen: boolean;
  readonly runConfirmationOpen: boolean;
}

export interface OpenTuiScreenState {
  readonly detailMode: OpenTuiNavigationState["detailMode"];
  readonly detailReturnPane: OpenTuiNavigationState["detailReturnPane"];
  readonly editingInput: OpenTuiNavigationState["editingInput"];
  readonly focusPane: FocusPane;
  readonly lastStatus: string;
  readonly popups: OpenTuiPopupState;
  readonly screenMode: ScreenMode;
  readonly subworkflowPath: readonly string[];
  readonly workflowFilterText: string;
  readonly workflowFilterTextBeforePopup: string;
}

export interface OpenTuiControllerContext {
  readonly applyFocus: (pane: FocusPane) => void;
  readonly copyToClipboard: (value: string) => boolean;
  readonly executeWorkflow: (input: {
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly workflowName: string;
  }) => Promise<{
    readonly completion: Promise<{
      readonly exitCode: number;
      readonly sessionId: string;
      readonly status: WorkflowSessionState["status"];
    }>;
    readonly sessionId: string;
  }>;
  readonly getFocusPane: () => FocusPane;
  readonly getHistoryViewMode: () => HistoryViewMode;
  readonly getInputText: () => string;
  readonly getLoadedWorkflow: () => LoadedWorkflow | undefined;
  readonly getPendingRunRuntimeVariables: () =>
    | Readonly<Record<string, unknown>>
    | undefined;
  readonly getRuntimeSessionView: () => RuntimeSessionView | undefined;
  readonly getScreenMode: () => ScreenMode;
  readonly getSelectedChildSubworkflowId: () => string | undefined;
  readonly getSelectedDefinitionNodeId: () => string | undefined;
  readonly getSelectedHistoryExecution: () => NodeExecutionRecord | undefined;
  readonly getSelectedManagerSessionId: () => string | undefined;
  readonly getSelectedNodeExecution: () => NodeExecutionRecord | undefined;
  readonly getSelectedSessionSummary: () => RuntimeSessionSummary | undefined;
  readonly getSelectedSubworkflowNodeId: () => string | undefined;
  readonly getSelectedWorkflowName: () => string | undefined;
  readonly getSelectedWorkspaceWorkflowId: () => string | undefined;
  readonly getWorkflowInputDetection: () => TuiWorkflowInputDetection;
  readonly refreshAll: () => Promise<void>;
  readonly refreshWorkflow: (
    workflowName: string | undefined,
    preferredSessionId?: string,
  ) => Promise<void>;
  readonly render: () => Promise<void>;
  readonly rerunWorkflow: (input: {
    readonly fromNodeId: string;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly sourceSessionId: string;
  }) => Promise<{
    readonly exitCode: number;
    readonly sessionId: string;
    readonly status: WorkflowSessionState["status"];
  }>;
  readonly resetRunState: () => void;
  readonly resumeWorkflow: (sessionId: string) => Promise<{
    readonly exitCode: number;
    readonly sessionId: string;
    readonly status: WorkflowSessionState["status"];
  }>;
  readonly setInputText: (value: string) => void;
  readonly setPendingRunRuntimeVariables: (
    value: Readonly<Record<string, unknown>> | undefined,
  ) => void;
  readonly setRunConfirmationContent: (content: string) => void;
  readonly setRunConfirmationOpen: (open: boolean) => void;
  readonly setRunExecutionResult: (result:
    | {
        readonly exitCode: number;
        readonly sessionId: string;
        readonly status: WorkflowSessionState["status"];
      }
    | undefined) => void;
  readonly setRunPendingSessionId: (sessionId: string | undefined) => void;
  readonly setRunStatusError: (message: string | undefined) => void;
  readonly setStatus: (message: string) => void;
  readonly setWorkflowInputDetection: (
    detection: TuiWorkflowInputDetection,
  ) => void;
  readonly startRunPolling: () => void;
  readonly stopRunPolling: () => void;
  readonly withBusy: (label: string, action: () => Promise<void>) => Promise<void>;
}

export interface OpenTuiController {
  readonly confirmRun: () => Promise<void>;
  readonly copyActiveValue: () => Promise<void>;
  readonly formatJsonInput: () => Promise<void>;
  readonly openRunConfirmation: () => Promise<void>;
  readonly refreshAll: () => Promise<void>;
  readonly rerunWorkflow: () => Promise<void>;
  readonly resumeWorkflow: () => Promise<void>;
  readonly switchInputMode: () => Promise<void>;
}

function buildCopyTargetInput(
  context: OpenTuiControllerContext,
): OpenTuiCopyTargetInput {
  const screenMode = context.getScreenMode();
  const historyViewMode = context.getHistoryViewMode();
  const loadedWorkflowId =
    screenMode === "workspace" || screenMode === "definition"
      ? context.getSelectedWorkspaceWorkflowId()
      : context.getLoadedWorkflow()?.bundle.workflow.workflowId;
  const selectedNodeExecutionId =
    historyViewMode === "workflow"
      ? context.getSelectedNodeExecution()?.nodeExecId
      : undefined;
  const selectedSessionId =
    historyViewMode === "workflow"
      ? context.getSelectedSessionSummary()?.sessionId
      : undefined;
  const selectedWorkflowName = context.getSelectedWorkflowName();
  const selectedSubworkflowId = context.getSelectedChildSubworkflowId();
  const selectedWorkflowNodeId =
    screenMode === "definition"
      ? context.getSelectedDefinitionNodeId()
      : context.getSelectedSubworkflowNodeId();
  return {
    focusPane: context.getFocusPane(),
    screenMode,
    ...(loadedWorkflowId === undefined ? {} : { loadedWorkflowId }),
    ...(selectedNodeExecutionId === undefined ? {} : { selectedNodeExecutionId }),
    ...(selectedSessionId === undefined ? {} : { selectedSessionId }),
    ...(selectedSubworkflowId === undefined ? {} : { selectedSubworkflowId }),
    ...(selectedWorkflowName === undefined ? {} : { selectedWorkflowName }),
    ...(selectedWorkflowNodeId === undefined ? {} : { selectedWorkflowNodeId }),
  };
}

export function createOpenTuiController(
  context: OpenTuiControllerContext,
): OpenTuiController {
  return {
    switchInputMode: async (): Promise<void> => {
      const previousMode = context.getWorkflowInputDetection().mode;
      const nextMode: TuiWorkflowInputMode =
        previousMode === "json" ? "text" : "json";
      try {
        const parsedValue = buildTuiRuntimeVariables({
          editorText: context.getInputText(),
          mode: previousMode,
          purpose: "run",
        });
        const nextValue =
          previousMode === "text"
            ? parsedValue["humanInput"]
            : parsedValue["promptJson"] ?? parsedValue["humanInput"];
        context.setWorkflowInputDetection({
          mode: nextMode,
          reason: "manually toggled inside the TUI",
        });
        context.setInputText(formatEditorValue(nextValue, nextMode));
        context.setStatus(`Input mode switched to ${nextMode}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        context.setStatus(`Input mode toggle failed: ${message}`);
      }
      await context.render();
    },

    formatJsonInput: async (): Promise<void> => {
      if (context.getWorkflowInputDetection().mode !== "json") {
        context.setStatus(
          "JSON formatting is only available when input mode is json",
        );
        await context.render();
        return;
      }
      try {
        context.setInputText(formatJsonEditorText(context.getInputText()));
        context.setStatus("Formatted JSON input");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        context.setStatus(`JSON formatting failed: ${message}`);
      }
      await context.render();
    },

    openRunConfirmation: async (): Promise<void> => {
      const workflowName =
        context.getLoadedWorkflow()?.workflowName ??
        context.getSelectedWorkflowName();
      if (workflowName === undefined) {
        context.setStatus("Select a workflow before starting a run");
        await context.render();
        return;
      }
      try {
        const runtimeVariables = buildTuiRuntimeVariables({
          editorText: context.getInputText(),
          mode: context.getWorkflowInputDetection().mode,
          purpose: "run",
        });
        context.setPendingRunRuntimeVariables(runtimeVariables);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        context.setStatus(`Cannot run workflow: ${message}`);
        await context.render();
        return;
      }
      context.setRunConfirmationContent(
        describeRunConfirmation({
          editorText: context.getInputText(),
          inputMode: context.getWorkflowInputDetection().mode,
          workflowName,
        }),
      );
      context.setRunConfirmationOpen(true);
      context.setStatus(`Confirm new run for '${workflowName}'`);
      await context.render();
      context.applyFocus("input");
    },

    confirmRun: async (): Promise<void> => {
      const workflowName = context.getLoadedWorkflow()?.workflowName;
      const pendingRunRuntimeVariables = context.getPendingRunRuntimeVariables();
      if (
        workflowName === undefined ||
        pendingRunRuntimeVariables === undefined
      ) {
        context.setStatus("Run confirmation is unavailable");
        await context.render();
        return;
      }
      let started = false;
      await context.withBusy(`Starting workflow '${workflowName}'`, async () => {
        context.resetRunState();
        const handle = await context.executeWorkflow({
          workflowName,
          runtimeVariables: pendingRunRuntimeVariables,
        });
        started = true;
        context.setRunPendingSessionId(handle.sessionId);
        context.setRunConfirmationOpen(false);
        context.setStatus(`Run started: ${handle.sessionId}`);
        context.startRunPolling();
        void handle.completion
          .then(async (result) => {
            context.setRunExecutionResult(result);
            await context.refreshWorkflow(workflowName, result.sessionId);
            await context.render();
            context.setStatus(
              `Run finished: ${result.sessionId} status=${result.status} exitCode=${String(
                result.exitCode,
              )}`,
            );
          })
          .catch(async (error: unknown) => {
            const message =
              error instanceof Error ? error.message : "unknown workflow error";
            context.setRunStatusError(message);
            context.setStatus(`Run failed: ${message}`);
            context.stopRunPolling();
            await context.render();
          });
      });
      if (!started) {
        return;
      }
      context.setPendingRunRuntimeVariables(undefined);
      await context.render();
      context.applyFocus("input");
    },

    rerunWorkflow: async (): Promise<void> => {
      const session = context.getRuntimeSessionView()?.session;
      const execution = context.getSelectedHistoryExecution();
      if (session === undefined || execution === undefined) {
        context.setStatus(
          "Select a historical session and node execution before rerunning",
        );
        await context.render();
        return;
      }
      const managerSessionId = context.getSelectedManagerSessionId();
      let runtimeVariables: Readonly<Record<string, unknown>>;
      try {
        runtimeVariables = buildTuiRuntimeVariables(
          managerSessionId === undefined
            ? {
                editorText: context.getInputText(),
                mode: context.getWorkflowInputDetection().mode,
                purpose: "rerun",
              }
            : {
                editorText: context.getInputText(),
                managerSessionId,
                mode: context.getWorkflowInputDetection().mode,
                purpose: "rerun",
              },
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        context.setStatus(`Cannot rerun workflow: ${message}`);
        await context.render();
        return;
      }
      await context.withBusy(
        `Rerunning '${execution.nodeId}' from ${session.sessionId}`,
        async () => {
          const result = await context.rerunWorkflow({
            sourceSessionId: session.sessionId,
            fromNodeId: execution.nodeId,
            runtimeVariables,
          });
          await context.refreshWorkflow(session.workflowName, result.sessionId);
          context.setStatus(
            `Rerun finished: ${result.sessionId} status=${result.status} exitCode=${String(
              result.exitCode,
            )}`,
          );
        },
      );
    },

    resumeWorkflow: async (): Promise<void> => {
      const session = context.getRuntimeSessionView()?.session;
      if (session === undefined) {
        context.setStatus("Select a session before resuming");
        await context.render();
        return;
      }
      await context.withBusy(`Resuming ${session.sessionId}`, async () => {
        const result = await context.resumeWorkflow(session.sessionId);
        await context.refreshWorkflow(session.workflowName, result.sessionId);
        context.setStatus(
          `Resume finished: ${result.sessionId} status=${result.status} exitCode=${String(
            result.exitCode,
          )}`,
        );
      });
    },

    refreshAll: async (): Promise<void> => {
      await context.refreshAll();
    },

    copyActiveValue: async (): Promise<void> => {
      const target = resolveOpenTuiCopyTarget(buildCopyTargetInput(context));
      if (target === undefined) {
        context.setStatus("Nothing copyable is selected in the active pane");
        await context.render();
        return;
      }
      if (!context.copyToClipboard(target.value)) {
        context.setStatus(`Failed to copy ${target.label}`);
        await context.render();
        return;
      }
      context.setStatus(`Copied ${target.label}: ${target.value}`);
      await context.render();
    },
  };
}

export function describeRunConfirmation(input: {
  readonly editorText: string;
  readonly inputMode: TuiWorkflowInputMode;
  readonly workflowName: string;
}): string {
  return [
    `Start workflow '${input.workflowName}'?`,
    `Input mode: ${input.inputMode}`,
    `Input syntax: ${describeTuiWorkflowInputSyntax(
      input.editorText,
      input.inputMode,
    ).summary}`,
    "",
    "Preview:",
    input.editorText.trim().length === 0 ? "{}" : input.editorText.trim(),
    "",
    "Press enter or ctrl-m to confirm. Esc cancels.",
  ].join("\n");
}

export function resolveEditorTextForLoadedSession(input: {
  readonly detection: TuiWorkflowInputDetection;
  readonly runtimeSessionView: RuntimeSessionView | undefined;
}): string {
  if (input.runtimeSessionView === undefined) {
    return input.detection.mode === "json" ? "{}" : "";
  }
  return deriveEditorTextFromRuntimeVariables(
    input.runtimeSessionView.session.runtimeVariables,
    input.detection.mode,
  );
}
