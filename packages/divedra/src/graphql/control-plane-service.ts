import type {
  GraphqlRuntimeEventReplyDispatchRecord,
  GraphqlRuntimeHookEventRecord,
  GraphqlRuntimeLlmSessionMessageRecord,
  GraphqlRuntimeNodeExecutionSummary,
  GraphqlRuntimeNodeLogEntry,
  WorkflowControlPlaneContinuationResult,
  WorkflowControlPlaneExecutionResult,
  WorkflowControlPlaneService,
  WorkflowControlPlaneSession,
  WorkflowControlPlaneStepRunsResult,
} from "divedra-graphql";
import {
  projectControlPlaneSessionToWorkflowSessionState,
  projectWorkflowSessionStateToControlPlaneSession,
} from "divedra-graphql";
import {
  continueWorkflowFromHistory,
  type ContinueWorkflowFromHistoryInput,
} from "../lib-continuation";
import { listMergedWorkflowExecutionStepRuns } from "../lib-step-runs";
import { runWorkflow, type WorkflowRunOptions } from "../workflow/engine";
import {
  listEventReplyDispatchesFromRuntimeDb,
  listRuntimeHookEvents,
  listRuntimeLlmSessionMessages,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
} from "../workflow/runtime-db";
import type { WorkflowSessionState } from "../workflow/session";
import {
  listSessions,
  loadSession,
  saveSession,
} from "../workflow/session-store";
import type { GraphqlRequestContext } from "./types";

function toControlPlaneSession(
  session: WorkflowSessionState,
): WorkflowControlPlaneSession {
  return projectWorkflowSessionStateToControlPlaneSession(session);
}

function toWorkflowSessionState(
  session: WorkflowControlPlaneSession,
): WorkflowSessionState {
  return projectControlPlaneSessionToWorkflowSessionState<WorkflowSessionState>(
    session,
  );
}

export function createWorkflowControlPlaneService(): WorkflowControlPlaneService<GraphqlRequestContext> {
  return {
    async loadSession(workflowExecutionId, context) {
      const loaded = await loadSession(workflowExecutionId, context);
      return loaded.ok ? toControlPlaneSession(loaded.value) : null;
    },

    async listSessionIds(context) {
      const listed = await listSessions(context);
      if (!listed.ok) {
        throw new Error(listed.error.message);
      }
      return listed.value;
    },

    async saveSession(session, context) {
      const saved = await saveSession(toWorkflowSessionState(session), context);
      if (!saved.ok) {
        throw new Error(saved.error.message);
      }
    },

    async listNodeExecutions(workflowExecutionId, context) {
      return (await listRuntimeNodeExecutions(
        workflowExecutionId,
        context,
      )) as readonly GraphqlRuntimeNodeExecutionSummary[];
    },

    async listNodeLogs(workflowExecutionId, context) {
      return (await listRuntimeNodeLogs(
        workflowExecutionId,
        context,
      )) as readonly GraphqlRuntimeNodeLogEntry[];
    },

    async listLlmSessionMessages(workflowExecutionId, context) {
      return (await listRuntimeLlmSessionMessages(
        workflowExecutionId,
        context,
      )) as readonly GraphqlRuntimeLlmSessionMessageRecord[];
    },

    async listHookEvents(workflowExecutionId, context) {
      return (await listRuntimeHookEvents(
        workflowExecutionId,
        context,
      )) as readonly GraphqlRuntimeHookEventRecord[];
    },

    async listReplyDispatches(workflowExecutionId, context) {
      return (await listEventReplyDispatchesFromRuntimeDb(
        { workflowExecutionId },
        context,
      )) as readonly GraphqlRuntimeEventReplyDispatchRecord[];
    },

    async runWorkflow(input) {
      const result = await runWorkflow(
        input.workflowName,
        input.options as WorkflowRunOptions,
      );
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return {
        workflowExecutionId: result.value.session.sessionId,
        sessionId: result.value.session.sessionId,
        status: result.value.session.status,
        exitCode: result.value.exitCode,
      } satisfies WorkflowControlPlaneExecutionResult;
    },

    async continueWorkflowFromHistory(input) {
      const result = await continueWorkflowFromHistory(
        input as ContinueWorkflowFromHistoryInput,
      );
      return {
        workflowExecutionId: result.sessionId,
        sessionId: result.sessionId,
        status: result.status,
        exitCode: result.exitCode,
        continuedAfterStepRunId: result.continuedAfterStepRunId,
        continuedStartStepId: result.continuedStartStepId,
      } satisfies WorkflowControlPlaneContinuationResult;
    },

    async listWorkflowExecutionStepRuns(input) {
      const result = await listMergedWorkflowExecutionStepRuns(
        input as Parameters<typeof listMergedWorkflowExecutionStepRuns>[0],
      );
      return {
        workflowExecutionId: result.workflowExecutionId,
        workflowId: result.workflowId,
        workflowName: result.workflowName,
        stepRuns: result.stepRuns.map((row) => ({
          workflowExecutionId: result.workflowExecutionId,
          timelineOrdinal: row.timelineOrdinal,
          executionOrdinal: row.executionOrdinal,
          stepRunId: row.stepRunId,
          ...(row.stepId === undefined ? {} : { stepId: row.stepId }),
          ...(row.nodeRegistryId === undefined
            ? {}
            : { nodeRegistryId: row.nodeRegistryId }),
          status: row.status,
          imported: row.imported,
          sourceWorkflowExecutionId: row.persistedWorkflowExecutionId,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
        })),
      } satisfies WorkflowControlPlaneStepRunsResult;
    },
  };
}
