// @ts-nocheck
import { publishWorkflowBusinessFinalExternalOutput } from "../../events/external-output";
import { err, ok } from "../result";
import type { CommunicationRecord } from "../session";
import { loadSession } from "../session-store";
import { findLatestPublishedWorkflowResult } from "./cross-workflow-dispatch";
import {
  isTerminalStatus,
  persistExternalMailboxOutputCommunication,
} from "./mailbox-communication-artifacts";
import {
  emitWorkflowRunEvent,
  failTerminalSession,
  nowIso,
  persistCompletedSessionState,
  readOutputPayloadArtifact,
  workflowRunFailure,
} from "./types-and-session-state";

export async function finalizeCompletedWorkflowRun(input) {
  const { session, workflow, loaded, options } = input;
  const beforeComplete = await loadSession(session.sessionId, options);
  if (beforeComplete.ok && isTerminalStatus(beforeComplete.value.status)) {
    if (beforeComplete.value.status === "completed") {
      return ok({ session: beforeComplete.value, exitCode: 0 });
    }
    const exitCode = beforeComplete.value.status === "cancelled" ? 130 : 1;
    return err(
      workflowRunFailure(
        exitCode,
        beforeComplete.value.lastError ??
          `session ${beforeComplete.value.status}`,
        beforeComplete.value,
      ),
    );
  }

  let completed = {
    ...session,
    status: "completed",
    endedAt: nowIso(),
    queue: [],
  };

  const publishedResultExecution = findLatestPublishedWorkflowResult(
    workflow,
    completed,
  );
  if (publishedResultExecution !== undefined) {
    const publishedTargetId =
      publishedResultExecution.stepId ?? publishedResultExecution.nodeId;
    const outputPayload = await readOutputPayloadArtifact(
      publishedResultExecution.artifactDir,
    );
    if (!outputPayload.ok) {
      const publicationFailureMessage =
        `failed to publish selected external output for step '${publishedTargetId}' ` +
        `(${publishedResultExecution.nodeExecId}): ${outputPayload.error}`;
      return await failTerminalSession(
        completed,
        options,
        publicationFailureMessage,
      );
    }

    let externalOutputCommunication: CommunicationRecord;
    try {
      externalOutputCommunication =
        await persistExternalMailboxOutputCommunication({
          artifactWorkflowRoot: loaded.artifactWorkflowRoot,
          runtimeLogOptions: options,
          workflow,
          session: completed,
          execution: publishedResultExecution,
          outputRaw: outputPayload.value.raw,
          communicationCounter: completed.communicationCounter,
          createdAt: completed.endedAt ?? nowIso(),
        });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "unknown external output publication failure";
      const publicationFailureMessage =
        `failed to persist external output publication for step '${publishedTargetId}' ` +
        `(${publishedResultExecution.nodeExecId}): ${message}`;
      return await failTerminalSession(
        completed,
        options,
        publicationFailureMessage,
      );
    }

    completed = {
      ...completed,
      communicationCounter: completed.communicationCounter + 1,
      communications: [
        ...completed.communications,
        externalOutputCommunication,
      ],
    };
    if (options.eventReplyDispatcher !== undefined) {
      try {
        await publishWorkflowBusinessFinalExternalOutput({
          dispatcher: options.eventReplyDispatcher,
          runtimeOptions: options,
          workflowId: workflow.workflowId,
          workflowExecutionId: completed.sessionId,
          runtimeVariables: completed.runtimeVariables,
          publishedNodeId: publishedTargetId,
          publishedNodeExecId: publishedResultExecution.nodeExecId,
          workflowOutputPayload: outputPayload.value.payload,
          createdAt: completed.endedAt ?? nowIso(),
        });
      } catch {
        // Best-effort: outbound provider delivery must not fail terminal completion.
      }
    }
  }

  const persistedCompleted = await persistCompletedSessionState(
    completed,
    options,
  );
  if (!persistedCompleted.ok) {
    return err(workflowRunFailure(1, persistedCompleted.error, completed));
  }
  await emitWorkflowRunEvent(options, {
    type: "workflow-completed",
    workflowExecutionId: completed.sessionId,
    status: completed.status,
  });
  return ok({ session: completed, exitCode: 0 });
}
