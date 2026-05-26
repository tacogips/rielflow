import { createCommunicationService } from "./communication-service";
import {
  loadWorkflowFromDisk,
  mergeLoadOptionsForSessionMutableBundle,
} from "./load";
import {
  createManagerSessionStore,
  type ManagerIntentSummary,
} from "./manager-session-store";
import {
  assertCommunicationInManagerScope,
  parseManagerControlActions,
} from "./manager-control";
import { loadSession, saveSession } from "./session-store";
import type { WorkflowSessionState } from "./session";
import {
  normalizeAttachmentsForIdempotency,
  prepareManagerMessageArtifacts,
  validateAttachments,
  writeManagerMessageEnvelope,
} from "./manager-message-service/artifacts";
import {
  createManagerMessageId,
  runIdempotentMutation,
} from "./manager-message-service/idempotency";
import {
  applyOptionalNodeDecision,
  dedupe,
  isTerminalStatus,
  normalizeActionsForIdempotency,
  normalizeManagerMessageText,
  toIntentSummary,
} from "./manager-message-service/session";
import type {
  ManagerMessageService,
  ManagerMessageServiceDependencies,
  SendManagerMessageResult,
} from "./manager-message-service/types";
export type {
  DataDirFileRef,
  ManagerMessageService,
  ManagerMessageServiceDependencies,
  SendManagerMessageInput,
  SendManagerMessageResult,
} from "./manager-message-service/types";

export function createManagerMessageService(
  deps: ManagerMessageServiceDependencies = {},
): ManagerMessageService {
  return {
    async sendManagerMessage(input, options = {}) {
      const now = deps.now?.() ?? new Date().toISOString();
      const managerStore =
        deps.managerSessionStore ?? createManagerSessionStore(options);
      const communicationService =
        deps.communicationService ??
        createCommunicationService({
          ...(deps.now === undefined ? {} : { now: deps.now }),
          idempotencyStore: managerStore,
        });
      const trimmedMessage = normalizeManagerMessageText(input.message);
      const normalizedActions = normalizeActionsForIdempotency(
        input.actions ?? [],
      );
      const normalizedAttachments = normalizeAttachmentsForIdempotency(
        input.attachments ?? [],
      );

      return await runIdempotentMutation({
        mutationName: "sendManagerMessage",
        idempotencyKey: input.idempotencyKey,
        managerSessionId: input.managerSessionId,
        normalizedPayload: {
          workflowId: input.workflowId,
          workflowExecutionId: input.workflowExecutionId,
          managerSessionId: input.managerSessionId,
          message: trimmedMessage ?? null,
          actions: normalizedActions,
          attachments: normalizedAttachments,
        },
        store: managerStore,
        now,
        action: async () => {
          const managerSession = await managerStore.loadSession(
            input.managerSessionId,
          );
          if (managerSession === null) {
            throw new Error(
              `manager session '${input.managerSessionId}' was not found`,
            );
          }
          if (managerSession.status !== "active") {
            throw new Error(
              `manager session '${input.managerSessionId}' is not active`,
            );
          }
          if (
            managerSession.workflowId !== input.workflowId ||
            managerSession.workflowExecutionId !== input.workflowExecutionId
          ) {
            throw new Error(
              `manager session '${input.managerSessionId}' does not match the requested workflow scope`,
            );
          }
          const controlMode = await managerStore.claimControlMode({
            managerSessionId: input.managerSessionId,
            controlMode: "graphql-manager-message",
            updatedAt: now,
          });
          if (controlMode !== "graphql-manager-message") {
            throw new Error(
              `manager session '${input.managerSessionId}' is already using payload managerControl for this execution`,
            );
          }

          const loadedSession = await loadSession(
            input.workflowExecutionId,
            options,
          );
          if (!loadedSession.ok) {
            throw new Error(loadedSession.error.message);
          }
          if (loadedSession.value.workflowId !== input.workflowId) {
            throw new Error(
              `workflow execution '${input.workflowExecutionId}' does not belong to workflow '${input.workflowId}'`,
            );
          }

          const loadedWorkflow = await loadWorkflowFromDisk(
            loadedSession.value.workflowName,
            mergeLoadOptionsForSessionMutableBundle(
              options,
              loadedSession.value,
            ),
          );
          if (!loadedWorkflow.ok) {
            throw new Error(loadedWorkflow.error.message);
          }
          const workflow = loadedWorkflow.value.bundle.workflow;

          const parsedActions = parseManagerControlActions(
            normalizedActions as readonly unknown[],
            workflow,
            {
              managerStepId: managerSession.managerStepId,
            },
          );

          const hasMessage = trimmedMessage !== undefined;
          const attachments = await validateAttachments(
            normalizedAttachments,
            input.workflowId,
            input.workflowExecutionId,
            options,
          );
          if (
            parsedActions.actions.length === 0 &&
            !hasMessage &&
            attachments.length === 0
          ) {
            throw new Error(
              "manager message must contain a message, attachments, or actions",
            );
          }

          const managerMessageId = createManagerMessageId();
          const parsedIntent =
            parsedActions.actions.length > 0
              ? parsedActions.actions.map((action) => toIntentSummary(action))
              : ([
                  { kind: "planner-note" },
                ] satisfies readonly ManagerIntentSummary[]);
          const artifacts = await prepareManagerMessageArtifacts({
            artifactWorkflowRoot: loadedWorkflow.value.artifactWorkflowRoot,
            workflowId: input.workflowId,
            workflowExecutionId: input.workflowExecutionId,
            managerSessionId: input.managerSessionId,
            managerMessageId,
            managerStepId: managerSession.managerStepId,
            managerNodeExecId: managerSession.managerNodeExecId,
            message: trimmedMessage,
            attachments,
            actions: parsedActions.actions,
          });

          try {
            const createdCommunicationIds: string[] = [];
            const queuedNodeIds: string[] = [];
            let nextSession: WorkflowSessionState = loadedSession.value;
            for (const action of parsedActions.actions) {
              switch (action.type) {
                case "planner-note":
                  break;
                case "retry-step":
                  queuedNodeIds.push(action.stepId);
                  break;
                case "replay-communication": {
                  const sourceCommunication = nextSession.communications.find(
                    (entry) => entry.communicationId === action.communicationId,
                  );
                  if (sourceCommunication === undefined) {
                    throw new Error(
                      `communication '${action.communicationId}' was not found in workflow execution '${input.workflowExecutionId}'`,
                    );
                  }
                  assertCommunicationInManagerScope(
                    sourceCommunication,
                    workflow,
                    {
                      managerStepId: managerSession.managerStepId,
                    },
                    "managerControl replay-communication",
                  );
                  const replayed =
                    await communicationService.replayCommunication(
                      {
                        workflowId: input.workflowId,
                        workflowExecutionId: input.workflowExecutionId,
                        communicationId: action.communicationId,
                        managerSessionId: input.managerSessionId,
                        ...(action.reason === undefined
                          ? {}
                          : { reason: action.reason }),
                      },
                      options,
                    );
                  createdCommunicationIds.push(
                    replayed.replayedCommunicationId,
                  );
                  break;
                }
                case "execute-optional-step":
                case "skip-optional-step":
                  nextSession = applyOptionalNodeDecision({
                    session: nextSession,
                    workflow,
                    managerStepId: managerSession.managerStepId,
                    managerNodeExecId: managerSession.managerNodeExecId,
                    action,
                    decidedAt: now,
                  });
                  queuedNodeIds.push(action.stepId);
                  break;
              }
            }

            const dedupedQueue = dedupe([
              ...nextSession.queue,
              ...queuedNodeIds,
            ]);
            const sessionToSave =
              dedupedQueue.length > nextSession.queue.length ||
              nextSession.communicationCounter !==
                loadedSession.value.communicationCounter
                ? (() => {
                    const {
                      endedAt: _endedAt,
                      lastError: _lastError,
                      ...restSession
                    } = nextSession;
                    return isTerminalStatus(nextSession.status)
                      ? {
                          ...restSession,
                          status: "running" as const,
                          queue: dedupedQueue,
                        }
                      : {
                          ...nextSession,
                          queue: dedupedQueue,
                        };
                  })()
                : nextSession;
            if (
              sessionToSave !== loadedSession.value ||
              sessionToSave.communicationCounter !==
                loadedSession.value.communicationCounter
            ) {
              const saved = await saveSession(sessionToSave, options);
              if (!saved.ok) {
                throw new Error(saved.error.message);
              }
            }

            const acceptedResult: SendManagerMessageResult = {
              accepted: true,
              managerMessageId,
              parsedIntent,
              createdCommunicationIds,
              queuedNodeIds: dedupe(queuedNodeIds),
            };
            await writeManagerMessageEnvelope({
              artifacts,
              workflowId: input.workflowId,
              workflowExecutionId: input.workflowExecutionId,
              managerSessionId: input.managerSessionId,
              managerMessageId,
              managerStepId: managerSession.managerStepId,
              managerNodeExecId: managerSession.managerNodeExecId,
              message: trimmedMessage,
              attachments,
              actions: parsedActions.actions,
              parsedIntent,
              createdAt: now,
              accepted: true,
              createdCommunicationIds,
              queuedNodeIds: acceptedResult.queuedNodeIds,
            });
            await managerStore.appendMessage({
              managerMessageId,
              managerSessionId: input.managerSessionId,
              workflowId: input.workflowId,
              workflowExecutionId: input.workflowExecutionId,
              managerStepId: managerSession.managerStepId,
              managerNodeExecId: managerSession.managerNodeExecId,
              ...(trimmedMessage === undefined
                ? {}
                : { message: trimmedMessage }),
              parsedIntent,
              accepted: true,
              createdAt: now,
            });
            return acceptedResult;
          } catch (error: unknown) {
            const rejectionReason =
              error instanceof Error ? error.message : String(error);
            await writeManagerMessageEnvelope({
              artifacts,
              workflowId: input.workflowId,
              workflowExecutionId: input.workflowExecutionId,
              managerSessionId: input.managerSessionId,
              managerMessageId,
              managerStepId: managerSession.managerStepId,
              managerNodeExecId: managerSession.managerNodeExecId,
              message: trimmedMessage,
              attachments,
              actions: parsedActions.actions,
              parsedIntent,
              createdAt: now,
              accepted: false,
              createdCommunicationIds: [],
              queuedNodeIds: [],
              rejectionReason,
            });
            await managerStore.appendMessage({
              managerMessageId,
              managerSessionId: input.managerSessionId,
              workflowId: input.workflowId,
              workflowExecutionId: input.workflowExecutionId,
              managerStepId: managerSession.managerStepId,
              managerNodeExecId: managerSession.managerNodeExecId,
              ...(trimmedMessage === undefined
                ? {}
                : { message: trimmedMessage }),
              parsedIntent,
              accepted: false,
              rejectionReason,
              createdAt: now,
            });
            return {
              accepted: false,
              managerMessageId,
              parsedIntent,
              createdCommunicationIds: [],
              queuedNodeIds: [],
              rejectionReason,
            };
          }
        },
      });
    },
  };
}
