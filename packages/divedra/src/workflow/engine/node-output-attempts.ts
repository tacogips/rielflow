import { runOutputAttempts } from "../output-attempt-runner";
import type {
  AdapterAmbientManagerContext,
  AdapterBackendSessionInput,
  AdapterLlmSessionMessage,
  AdapterProcessLog,
  NodeAdapter,
} from "../adapter";
import type { JsonSchemaValidationError } from "../json-schema";
import type { NodeExecutionMailbox } from "../node-execution-mailbox";
import type { OutputAttemptRunnerResult } from "../output-attempt-runner";
import type { NodeExecutionRecord, WorkflowSessionState } from "../session";
import type { AgentNodePayload, NodePayload, WorkflowJson } from "../types";
import type { LoadedWorkflowSuccess } from "./run-setup";
import type { NormalizedWorkflowRunOptions } from "./types-and-session-state";
import { workflowNodeOutputAttemptPort } from "./workflow-runner-deps";

const {
  buildAdapterDivedraHookContext,
  executeAdapterWithTimeout,
  executePackageNodeWithTimeout,
  buildSupervisionStallWatch,
  resolveNodeExecutionWorkingDirectory,
} = workflowNodeOutputAttemptPort;

export interface ResolveNodeExecutionOutputInput {
  readonly options: NormalizedWorkflowRunOptions;
  readonly agentNodePayload: AgentNodePayload | null;
  readonly executionNodePayload: NodePayload;
  readonly systemPromptText: string | undefined;
  readonly effectivePromptText: string;
  readonly outputPayload: Readonly<Record<string, unknown>> | undefined;
  readonly nodeStatus: NodeExecutionRecord["status"];
  readonly outputValidationErrors: readonly JsonSchemaValidationError[];
  readonly outputAttemptCount: number;
  readonly processLogs: readonly AdapterProcessLog[];
  readonly llmMessages: readonly AdapterLlmSessionMessage[];
  readonly backendSessionProvider: string | undefined;
  readonly backendSession: AdapterBackendSessionInput | undefined;
  readonly backendSessionId: string | undefined;
  readonly workflow: WorkflowJson;
  readonly session: WorkflowSessionState;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly artifactDir: string;
  readonly loaded: LoadedWorkflowSuccess;
  readonly workflowWorkingDirectory: string;
  readonly mergedVariables: Readonly<Record<string, unknown>>;
  readonly assembledArguments: Readonly<Record<string, unknown>> | null;
  readonly upstreamCommunicationIds: readonly string[];
  readonly executionMailbox: NodeExecutionMailbox;
  readonly mailboxDir: string;
  readonly ambientManagerContext: AdapterAmbientManagerContext | undefined;
  readonly effectiveAdapter: NodeAdapter;
  readonly timeoutMs: number;
  readonly nextCount: number;
}

export async function resolveNodeExecutionOutput(
  input: ResolveNodeExecutionOutputInput,
): Promise<OutputAttemptRunnerResult> {
  let {
    options,
    agentNodePayload,
    executionNodePayload,
    systemPromptText,
    effectivePromptText,
    outputPayload,
    nodeStatus,
    outputValidationErrors,
    outputAttemptCount,
    processLogs,
    llmMessages,
    backendSessionProvider,
    backendSession,
    backendSessionId,
    workflow,
    session,
    nodeId,
    nodeExecId,
    artifactDir,
    loaded,
    workflowWorkingDirectory,
    mergedVariables,
    assembledArguments,
    upstreamCommunicationIds,
    executionMailbox,
    mailboxDir,
    ambientManagerContext,
    effectiveAdapter,
    timeoutMs,
    nextCount,
  } = input;
  if (options.dryRun === true) {
    outputPayload = {
      provider: "dry-run",
      model:
        agentNodePayload?.model ??
        `${executionNodePayload.nodeType ?? "agent"}-dry-run`,
      ...(systemPromptText === undefined ? {} : { systemPromptText }),
      promptText: effectivePromptText,
      completionPassed: true,
      when: { always: true },
      payload: { skippedExecution: true },
    };
  } else {
    const attemptResult = await runOutputAttempts({
      workflowId: workflow.workflowId,
      workflowExecutionId: session.sessionId,
      nodeId,
      nodeExecId,
      artifactDir,
      agentNodePayload,
      executionNodePayload,
      basePromptText: effectivePromptText,
      ...(systemPromptText === undefined ? {} : { systemPromptText }),
      initialOutputValidationErrors: outputValidationErrors,
      initialProcessLogs: processLogs,
      initialLlmMessages: llmMessages,
      ...(backendSession === undefined
        ? {}
        : { initialBackendSession: backendSession }),
      clearValidationErrorsOnExecutionFailure: true,
      executeAttempt: async ({
        executionPromptText,
        outputContract,
        backendSession: currentBackendSession,
      }) => {
        const supervisionStall = buildSupervisionStallWatch(session, options, {
          ...(executionNodePayload.stallTimeoutMs === undefined
            ? {}
            : { stallTimeoutMs: executionNodePayload.stallTimeoutMs }),
        });
        if (agentNodePayload !== null) {
          return await executeAdapterWithTimeout(
            effectiveAdapter,
            {
              workflowId: workflow.workflowId,
              workflowExecutionId: session.sessionId,
              nodeId,
              nodeExecId,
              node: agentNodePayload,
              workingDirectory: resolveNodeExecutionWorkingDirectory(
                workflowWorkingDirectory,
                agentNodePayload.workingDirectory,
              ),
              mergedVariables,
              ...(systemPromptText === undefined ? {} : { systemPromptText }),
              promptText: executionPromptText,
              arguments: assembledArguments,
              executionIndex: nextCount,
              artifactDir,
              upstreamCommunicationIds,
              executionMailbox,
              divedraHookContext: buildAdapterDivedraHookContext({
                workflowId: workflow.workflowId,
                workflowExecutionId: session.sessionId,
                nodeId,
                nodeExecId,
                mailboxDir,
                ...(agentNodePayload.executionBackend === undefined
                  ? {}
                  : {
                      agentBackend: agentNodePayload.executionBackend,
                    }),
              }),
              ...(currentBackendSession === undefined
                ? {}
                : { backendSession: currentBackendSession }),
              ...(ambientManagerContext === undefined
                ? {}
                : { ambientManagerContext }),
              ...(outputContract === undefined
                ? {}
                : { output: outputContract }),
            },
            timeoutMs,
            supervisionStall,
          );
        }
        return await executePackageNodeWithTimeout({
          workflowDirectory: loaded.value.workflowDirectory,
          workflowWorkingDirectory,
          artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
          workflowId: workflow.workflowId,
          workflowDescription: workflow.description,
          workflowExecutionId: session.sessionId,
          nodeId,
          nodeExecId,
          node: executionNodePayload,
          workflowDefaults: workflow.defaults,
          runtimeVariables: session.runtimeVariables,
          mergedVariables,
          arguments: assembledArguments,
          artifactDir,
          executionMailbox,
          ...(options.eventReplyDispatcher === undefined
            ? {}
            : { chatReplyDispatcher: options.eventReplyDispatcher }),
          ...(options.env === undefined ? {} : { env: options.env }),
          ...(options.superviserControl === undefined
            ? {}
            : { superviserControl: options.superviserControl }),
          timeoutMs,
          ...(supervisionStall === undefined ? {} : { supervisionStall }),
        });
      },
    });
    outputPayload = attemptResult.outputPayload;
    nodeStatus = attemptResult.nodeStatus;
    outputValidationErrors = attemptResult.outputValidationErrors;
    outputAttemptCount = attemptResult.outputAttemptCount;
    processLogs = attemptResult.processLogs;
    llmMessages = attemptResult.llmMessages;
    backendSessionProvider = attemptResult.backendSessionProvider;
    backendSession = attemptResult.backendSession;
    backendSessionId = attemptResult.backendSessionId;
  }
  return {
    outputPayload,
    nodeStatus,
    outputValidationErrors,
    outputAttemptCount,
    processLogs,
    llmMessages,
    ...(backendSessionProvider === undefined ? {} : { backendSessionProvider }),
    ...(backendSession === undefined ? {} : { backendSession }),
    ...(backendSessionId === undefined ? {} : { backendSessionId }),
  };
}
