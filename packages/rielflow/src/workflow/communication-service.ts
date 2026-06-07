import path from "node:path";
import {
  allocateNextWorkflowMessageCommunicationId,
  listWorkflowMessagesFromRuntimeDb,
  loadWorkflowMessageFromRuntimeDb,
  saveWorkflowMessageReplayToRuntimeDb,
  updateWorkflowMessageStatusInRuntimeDb,
  type RuntimeWorkflowMessageRecord,
  workflowMessageRecordToCommunication,
} from "./runtime-db";
import type { IdempotencyStore } from "./manager-message-service/idempotency";
import { runIdempotentMutation } from "./manager-message-service/idempotency";
import {
  loadSession,
  saveSession,
  type SessionStoreOptions,
} from "./session-store";
import type {
  CommunicationRecord,
  NodeExecutionRecord,
  WorkflowSessionState,
} from "./session";
import {
  initialDeliveryAttemptId,
  nextDeliveryAttemptId,
} from "./runtime-execution-contracts";
import { getWorkflowTelemetry } from "../telemetry";

export interface CommunicationLookupInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationId: string;
}

export interface ReplayCommunicationInput extends CommunicationLookupInput {
  readonly managerSessionId?: string;
  readonly idempotencyKey?: string;
  readonly reason?: string;
}

export interface RetryCommunicationDeliveryInput
  extends CommunicationLookupInput {
  readonly managerSessionId?: string;
  readonly idempotencyKey?: string;
  readonly reason?: string;
}

export interface CommunicationAttemptSnapshot {
  readonly deliveryAttemptId: string;
  readonly attemptJson: string | null;
  readonly receiptJson: string | null;
}

export interface CommunicationArtifactSnapshot {
  readonly messageJson: string | null;
  readonly metaJson: string | null;
  readonly outboxMessageJson: string | null;
  readonly outboxOutputRaw: string | null;
  readonly inboxMessageJson: string | null;
  readonly attemptFiles: readonly CommunicationAttemptSnapshot[];
}

export interface CommunicationGraphqlView {
  readonly record: CommunicationRecord;
  readonly sourceNodeExecution: NodeExecutionRecord | null;
  readonly consumedByNodeExecution: NodeExecutionRecord | null;
  readonly artifactSnapshot: CommunicationArtifactSnapshot;
}

export interface ReplayCommunicationResult {
  readonly sourceCommunicationId: string;
  readonly workflowExecutionId: string;
  readonly replayedCommunicationId: string;
  readonly status: CommunicationRecord["status"];
}

export interface RetryCommunicationDeliveryResult {
  readonly communicationId: string;
  readonly activeDeliveryAttemptId: string;
  readonly status: CommunicationRecord["status"];
}

export type CommunicationServiceOptions = SessionStoreOptions;

export interface CommunicationServiceDependencies {
  readonly now?: () => string;
  readonly idempotencyStore?: IdempotencyStore;
}

export interface CommunicationService {
  getCommunication(
    input: CommunicationLookupInput,
    options?: CommunicationServiceOptions,
  ): Promise<CommunicationGraphqlView | null>;
  replayCommunication(
    input: ReplayCommunicationInput,
    options?: CommunicationServiceOptions,
  ): Promise<ReplayCommunicationResult>;
  retryCommunicationDelivery(
    input: RetryCommunicationDeliveryInput,
    options?: CommunicationServiceOptions,
  ): Promise<RetryCommunicationDeliveryResult>;
}

async function loadRuntimeMessageForLookup(
  input: CommunicationLookupInput,
  options: CommunicationServiceOptions,
): Promise<RuntimeWorkflowMessageRecord | null> {
  const record = await loadWorkflowMessageFromRuntimeDb(
    {
      workflowExecutionId: input.workflowExecutionId,
      communicationId: input.communicationId,
    },
    options,
  );
  if (record === null || record.workflowId !== input.workflowId) {
    return null;
  }
  return record;
}

function findNodeExecution(
  session: WorkflowSessionState,
  nodeExecId: string | undefined,
): NodeExecutionRecord | null {
  if (nodeExecId === undefined) {
    return null;
  }
  return (
    session.nodeExecutions.find(
      (execution) => execution.nodeExecId === nodeExecId,
    ) ?? null
  );
}

function parseJsonOrNull(value: string | null): unknown {
  return value === null ? null : JSON.parse(value);
}

function buildCommunicationSnapshotFromRuntimeRecord(
  record: RuntimeWorkflowMessageRecord,
): CommunicationArtifactSnapshot {
  const communication = workflowMessageRecordToCommunication(record);
  const messageJson = `${JSON.stringify(
    {
      workflowId: record.workflowId,
      workflowExecutionId: record.workflowExecutionId,
      communicationId: record.communicationId,
      fromNodeId: record.fromNodeId,
      toNodeId: record.toNodeId,
      routingScope: record.routingScope,
      sourceNodeExecId: record.sourceNodeExecId,
      deliveryKind: record.deliveryKind,
      payloadRef: JSON.parse(record.payloadRefJson) as unknown,
      payload: parseJsonOrNull(record.payloadJson),
      artifactRefs: parseJsonOrNull(record.artifactRefsJson) ?? [],
      createdAt: record.createdAt,
    },
    null,
    2,
  )}\n`;
  const metaJson = `${JSON.stringify(
    {
      status: record.status,
      workflowId: record.workflowId,
      workflowExecutionId: record.workflowExecutionId,
      communicationId: record.communicationId,
      fromNodeId: record.fromNodeId,
      toNodeId: record.toNodeId,
      sourceNodeExecId: record.sourceNodeExecId,
      routingScope: record.routingScope,
      deliveryKind: record.deliveryKind,
      activeDeliveryAttemptId: record.activeDeliveryAttemptId,
      deliveryAttemptIds: JSON.parse(record.deliveryAttemptIdsJson) as unknown,
      createdAt: record.createdAt,
      deliveredAt: record.deliveredAt,
      consumedByNodeExecId: record.consumedByNodeExecId,
      consumedAt: record.consumedAt,
      failureReason: record.failureReason,
      supersededByCommunicationId: record.supersededByCommunicationId,
      supersededAt: record.supersededAt,
      replayedFromCommunicationId: record.replayedFromCommunicationId,
      managerMessageId: record.managerMessageId,
      updatedAt: record.updatedAt,
    },
    null,
    2,
  )}\n`;
  return {
    messageJson,
    metaJson,
    outboxMessageJson: messageJson,
    outboxOutputRaw: record.payloadJson,
    inboxMessageJson: messageJson,
    attemptFiles: communication.deliveryAttemptIds.map((deliveryAttemptId) => ({
      deliveryAttemptId,
      attemptJson: `${JSON.stringify(
        {
          workflowId: record.workflowId,
          workflowExecutionId: record.workflowExecutionId,
          communicationId: record.communicationId,
          deliveryAttemptId,
          toNodeId: record.toNodeId,
          status: "succeeded",
        },
        null,
        2,
      )}\n`,
      receiptJson: `${JSON.stringify(
        {
          communicationId: record.communicationId,
          deliveryAttemptId,
          deliveredByNodeId: record.fromNodeId,
          deliveredAt: record.deliveredAt,
        },
        null,
        2,
      )}\n`,
    })),
  };
}

function loadSourceOutputRaw(record: RuntimeWorkflowMessageRecord): string {
  if (record.payloadJson !== null) {
    return `${JSON.stringify(JSON.parse(record.payloadJson), null, 2)}\n`;
  }
  throw new Error(
    `communication '${record.communicationId}' does not have a persisted sqlite payload`,
  );
}

function resolveArtifactWorkflowRoot(artifactDir: string): string {
  return path.dirname(path.dirname(path.dirname(path.dirname(artifactDir))));
}

async function persistUpdatedSession(
  session: WorkflowSessionState,
  options: CommunicationServiceOptions,
): Promise<void> {
  const saved = await saveSession(session, options);
  if (!saved.ok) {
    throw new Error(saved.error.message);
  }
}

export function createCommunicationService(
  deps: CommunicationServiceDependencies = {},
): CommunicationService {
  return {
    async getCommunication(input, options = {}) {
      return await getWorkflowTelemetry().startSpan(
        "rielflow.communication.get",
        {
          "workflow.id": input.workflowId,
          "workflow.execution.id": input.workflowExecutionId,
          "communication.id": input.communicationId,
        },
        async () => {
          const loaded = await loadSession(input.workflowExecutionId, options);
          if (!loaded.ok) {
            return null;
          }
          const record = await loadRuntimeMessageForLookup(input, options);
          if (record === null) {
            return null;
          }
          const communication = workflowMessageRecordToCommunication(record);
          return {
            record: communication,
            sourceNodeExecution: findNodeExecution(
              loaded.value,
              communication.sourceNodeExecId,
            ),
            consumedByNodeExecution: findNodeExecution(
              loaded.value,
              communication.consumedByNodeExecId,
            ),
            artifactSnapshot:
              buildCommunicationSnapshotFromRuntimeRecord(record),
          };
        },
      );
    },
    async replayCommunication(input, options = {}) {
      return await getWorkflowTelemetry().startSpan(
        "rielflow.communication.replay",
        {
          "workflow.id": input.workflowId,
          "workflow.execution.id": input.workflowExecutionId,
          "communication.id": input.communicationId,
        },
        async () => {
          const now = deps.now?.() ?? new Date().toISOString();
          return await runIdempotentMutation({
            mutationName: "replayCommunication",
            managerSessionId: input.managerSessionId,
            idempotencyKey: input.idempotencyKey,
            normalizedPayload: {
              workflowId: input.workflowId,
              workflowExecutionId: input.workflowExecutionId,
              communicationId: input.communicationId,
              reason: input.reason ?? null,
            },
            store: deps.idempotencyStore,
            now,
            action: async () => {
              const loaded = await loadSession(
                input.workflowExecutionId,
                options,
              );
              if (!loaded.ok) {
                throw new Error(loaded.error.message);
              }
              const sourceRecord = await loadRuntimeMessageForLookup(
                input,
                options,
              );
              if (sourceRecord === null) {
                throw new Error(
                  `communication '${input.communicationId}' was not found in workflow execution '${input.workflowExecutionId}'`,
                );
              }
              const sourceCommunication =
                workflowMessageRecordToCommunication(sourceRecord);

              const outputRaw = loadSourceOutputRaw(sourceRecord);
              const allocatedCommunication =
                await allocateNextWorkflowMessageCommunicationId(
                  {
                    workflowExecutionId: input.workflowExecutionId,
                    sessionCommunicationCounter:
                      loaded.value.communicationCounter,
                  },
                  options,
                );
              const replayedCommunicationId =
                allocatedCommunication.communicationId;
              const replayedDeliveryAttemptId = initialDeliveryAttemptId();
              const replayedArtifactDir = path.join(
                resolveArtifactWorkflowRoot(sourceCommunication.artifactDir),
                "executions",
                sourceCommunication.workflowExecutionId,
                "communications",
                replayedCommunicationId,
              );

              const replayedRecord: CommunicationRecord = {
                workflowId: sourceCommunication.workflowId,
                workflowExecutionId: sourceCommunication.workflowExecutionId,
                communicationId: replayedCommunicationId,
                fromNodeId: sourceCommunication.fromNodeId,
                toNodeId: sourceCommunication.toNodeId,
                routingScope: sourceCommunication.routingScope,
                sourceNodeExecId: sourceCommunication.sourceNodeExecId,
                payloadRef: sourceCommunication.payloadRef,
                deliveryKind: "manual-rerun",
                transitionWhen: `manual-rerun:${sourceCommunication.communicationId}`,
                status: "delivered",
                deliveryAttemptIds: [replayedDeliveryAttemptId],
                activeDeliveryAttemptId: replayedDeliveryAttemptId,
                createdAt: now,
                deliveredAt: now,
                replayedFromCommunicationId:
                  sourceCommunication.communicationId,
                artifactDir: replayedArtifactDir,
              };
              const updatedSourceCommunication = {
                ...sourceCommunication,
                status: "superseded" as const,
                supersededByCommunicationId: replayedCommunicationId,
                supersededAt: now,
              };
              await saveWorkflowMessageReplayToRuntimeDb(
                {
                  replayedCommunication: replayedRecord,
                  sourceCommunication: updatedSourceCommunication,
                  outputRaw,
                  updatedAt: now,
                },
                options,
              );
              const latestSession = await loadSession(
                input.workflowExecutionId,
                options,
              );
              if (!latestSession.ok) {
                throw new Error(latestSession.error.message);
              }
              const latestMessages = await listWorkflowMessagesFromRuntimeDb(
                { workflowExecutionId: input.workflowExecutionId },
                options,
              );
              const updatedSession: WorkflowSessionState = {
                ...latestSession.value,
                communicationCounter: Math.max(
                  latestSession.value.communicationCounter,
                  allocatedCommunication.communicationCounter,
                ),
                communications: latestMessages.map(
                  workflowMessageRecordToCommunication,
                ),
              };
              await persistUpdatedSession(updatedSession, options);
              return {
                sourceCommunicationId: sourceCommunication.communicationId,
                workflowExecutionId: input.workflowExecutionId,
                replayedCommunicationId,
                status: replayedRecord.status,
              } satisfies ReplayCommunicationResult;
            },
          });
        },
      );
    },
    async retryCommunicationDelivery(input, options = {}) {
      return await getWorkflowTelemetry().startSpan(
        "rielflow.communication.retry_delivery",
        {
          "workflow.id": input.workflowId,
          "workflow.execution.id": input.workflowExecutionId,
          "communication.id": input.communicationId,
        },
        async () => {
          const now = deps.now?.() ?? new Date().toISOString();
          return await runIdempotentMutation({
            mutationName: "retryCommunicationDelivery",
            managerSessionId: input.managerSessionId,
            idempotencyKey: input.idempotencyKey,
            normalizedPayload: {
              workflowId: input.workflowId,
              workflowExecutionId: input.workflowExecutionId,
              communicationId: input.communicationId,
              reason: input.reason ?? null,
            },
            store: deps.idempotencyStore,
            now,
            action: async () => {
              const loaded = await loadSession(
                input.workflowExecutionId,
                options,
              );
              if (!loaded.ok) {
                throw new Error(loaded.error.message);
              }
              const record = await loadRuntimeMessageForLookup(input, options);
              if (record === null) {
                throw new Error(
                  `communication '${input.communicationId}' was not found in workflow execution '${input.workflowExecutionId}'`,
                );
              }
              const communication =
                workflowMessageRecordToCommunication(record);
              if (
                communication.status === "superseded" ||
                communication.status === "consumed"
              ) {
                throw new Error(
                  `communication '${communication.communicationId}' cannot be retried from status '${communication.status}'`,
                );
              }

              const activeDeliveryAttemptId = nextDeliveryAttemptId(
                communication.deliveryAttemptIds,
              );
              const updatedRecord: CommunicationRecord = {
                ...communication,
                status: "delivered",
                deliveryAttemptIds: [
                  ...communication.deliveryAttemptIds,
                  activeDeliveryAttemptId,
                ],
                activeDeliveryAttemptId,
                deliveredAt: now,
              };
              await updateWorkflowMessageStatusInRuntimeDb(
                updatedRecord,
                options,
              );
              return {
                communicationId: communication.communicationId,
                activeDeliveryAttemptId,
                status: updatedRecord.status,
              } satisfies RetryCommunicationDeliveryResult;
            },
          });
        },
      );
    },
  };
}
