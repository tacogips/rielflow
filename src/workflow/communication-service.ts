import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile, atomicWriteTextFile } from "../shared/fs";
import type {
  IdempotentMutationLookup,
  IdempotentMutationRecord,
  ManagerSessionStore,
} from "./manager-session-store";
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

interface IdempotencyStore
  extends Pick<
    ManagerSessionStore,
    "loadIdempotentResult" | "saveIdempotentResult"
  > {}

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

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

function nextCommunicationId(counter: number): string {
  return `comm-${String(counter).padStart(6, "0")}`;
}

function nextDeliveryAttemptId(deliveryAttemptIds: readonly string[]): string {
  return `attempt-${String(deliveryAttemptIds.length + 1).padStart(6, "0")}`;
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return null;
    }
    throw error;
  }
}

function findCommunication(
  session: WorkflowSessionState,
  input: CommunicationLookupInput,
): CommunicationRecord | null {
  if (session.workflowId !== input.workflowId) {
    return null;
  }
  return (
    session.communications.find(
      (communication) =>
        communication.communicationId === input.communicationId,
    ) ?? null
  );
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

async function loadCommunicationSnapshot(
  communication: CommunicationRecord,
): Promise<CommunicationArtifactSnapshot> {
  return {
    messageJson: await readOptionalText(
      path.join(communication.artifactDir, "message.json"),
    ),
    metaJson: await readOptionalText(
      path.join(communication.artifactDir, "meta.json"),
    ),
    outboxMessageJson: await readOptionalText(
      path.join(
        communication.artifactDir,
        "outbox",
        communication.fromNodeId,
        "message.json",
      ),
    ),
    outboxOutputRaw: await readOptionalText(
      path.join(
        communication.artifactDir,
        "outbox",
        communication.fromNodeId,
        "output.json",
      ),
    ),
    inboxMessageJson: await readOptionalText(
      path.join(
        communication.artifactDir,
        "inbox",
        communication.toNodeId,
        "message.json",
      ),
    ),
    attemptFiles: await Promise.all(
      communication.deliveryAttemptIds.map(async (deliveryAttemptId) => ({
        deliveryAttemptId,
        attemptJson: await readOptionalText(
          path.join(
            communication.artifactDir,
            "attempts",
            deliveryAttemptId,
            "attempt.json",
          ),
        ),
        receiptJson: await readOptionalText(
          path.join(
            communication.artifactDir,
            "attempts",
            deliveryAttemptId,
            "receipt.json",
          ),
        ),
      })),
    ),
  };
}

async function loadSourceOutputRaw(
  communication: CommunicationRecord,
): Promise<string> {
  const outboxOutputRaw = await readOptionalText(
    path.join(
      communication.artifactDir,
      "outbox",
      communication.fromNodeId,
      "output.json",
    ),
  );
  if (outboxOutputRaw !== null) {
    return outboxOutputRaw;
  }
  const sourceOutputRaw = await readOptionalText(
    path.join(communication.payloadRef.artifactDir, "output.json"),
  );
  if (sourceOutputRaw !== null) {
    return sourceOutputRaw;
  }
  throw new Error(
    `communication '${communication.communicationId}' does not have a readable source output artifact`,
  );
}

async function loadDeliveredByNodeId(
  communication: CommunicationRecord,
): Promise<string> {
  const activeDeliveryAttemptId =
    communication.activeDeliveryAttemptId ??
    communication.deliveryAttemptIds.at(-1) ??
    "attempt-000001";
  const receiptRaw = await readOptionalText(
    path.join(
      communication.artifactDir,
      "attempts",
      activeDeliveryAttemptId,
      "receipt.json",
    ),
  );
  if (receiptRaw === null) {
    return communication.toNodeId;
  }
  const parsed = JSON.parse(receiptRaw) as Record<string, unknown>;
  const deliveredByNodeId = parsed["deliveredByNodeId"];
  return typeof deliveredByNodeId === "string" && deliveredByNodeId.length > 0
    ? deliveredByNodeId
    : communication.toNodeId;
}

async function runIdempotentMutation<TResult>(args: {
  readonly mutationName: string;
  readonly managerSessionId: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly normalizedPayload: unknown;
  readonly store: IdempotencyStore | undefined;
  readonly action: () => Promise<TResult>;
  readonly now: string;
}): Promise<TResult> {
  if (args.idempotencyKey === undefined) {
    return await args.action();
  }
  if (args.managerSessionId === undefined) {
    throw new Error(
      `${args.mutationName} idempotency requires a managerSessionId scope`,
    );
  }
  if (args.store === undefined) {
    return await args.action();
  }

  const normalizedRequestHash = `sha256:${sha256Hex(
    stableStringify(args.normalizedPayload),
  )}`;
  const lookup: IdempotentMutationLookup = {
    mutationName: args.mutationName,
    managerSessionId: args.managerSessionId,
    idempotencyKey: args.idempotencyKey,
  };
  const existing = await args.store.loadIdempotentResult(lookup);
  if (existing !== null) {
    if (existing.normalizedRequestHash !== normalizedRequestHash) {
      throw new Error(
        `${args.mutationName} idempotency conflict for key '${args.idempotencyKey}'`,
      );
    }
    return JSON.parse(existing.responseJson) as TResult;
  }

  const result = await args.action();
  const record: IdempotentMutationRecord = {
    mutationName: args.mutationName,
    managerSessionId: args.managerSessionId,
    idempotencyKey: args.idempotencyKey,
    normalizedRequestHash,
    responseJson: JSON.stringify(result),
    completedAt: args.now,
  };
  await args.store.saveIdempotentResult(record);
  return result;
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
      const loaded = await loadSession(input.workflowExecutionId, options);
      if (!loaded.ok) {
        return null;
      }
      const communication = findCommunication(loaded.value, input);
      if (communication === null) {
        return null;
      }
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
        artifactSnapshot: await loadCommunicationSnapshot(communication),
      };
    },
    async replayCommunication(input, options = {}) {
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
          const loaded = await loadSession(input.workflowExecutionId, options);
          if (!loaded.ok) {
            throw new Error(loaded.error.message);
          }
          const sourceCommunication = findCommunication(loaded.value, input);
          if (sourceCommunication === null) {
            throw new Error(
              `communication '${input.communicationId}' was not found in workflow execution '${input.workflowExecutionId}'`,
            );
          }

          const outputRaw = await loadSourceOutputRaw(sourceCommunication);
          const deliveredByNodeId =
            await loadDeliveredByNodeId(sourceCommunication);
          const replayedCommunicationId = nextCommunicationId(
            loaded.value.communicationCounter + 1,
          );
          const deliveryAttemptId = "attempt-000001";
          const artifactDir = path.join(
            path.dirname(sourceCommunication.artifactDir),
            replayedCommunicationId,
          );
          await mkdir(
            path.join(artifactDir, "outbox", sourceCommunication.fromNodeId),
            { recursive: true },
          );
          await mkdir(
            path.join(artifactDir, "inbox", sourceCommunication.toNodeId),
            { recursive: true },
          );
          await mkdir(path.join(artifactDir, "attempts", deliveryAttemptId), {
            recursive: true,
          });

          const envelope = {
            workflowId: sourceCommunication.workflowId,
            workflowExecutionId: sourceCommunication.workflowExecutionId,
            communicationId: replayedCommunicationId,
            fromNodeId: sourceCommunication.fromNodeId,
            toNodeId: sourceCommunication.toNodeId,
            ...(sourceCommunication.fromSubWorkflowId === undefined
              ? {}
              : { fromSubWorkflowId: sourceCommunication.fromSubWorkflowId }),
            ...(sourceCommunication.toSubWorkflowId === undefined
              ? {}
              : { toSubWorkflowId: sourceCommunication.toSubWorkflowId }),
            routingScope: sourceCommunication.routingScope,
            sourceNodeExecId: sourceCommunication.sourceNodeExecId,
            deliveryKind: "manual-rerun",
            payloadRef: {
              ...sourceCommunication.payloadRef,
              outputFile: "output.json",
            },
            createdAt: now,
            replayedFromCommunicationId: sourceCommunication.communicationId,
          };
          const meta = {
            status: "delivered",
            workflowId: sourceCommunication.workflowId,
            workflowExecutionId: sourceCommunication.workflowExecutionId,
            communicationId: replayedCommunicationId,
            fromNodeId: sourceCommunication.fromNodeId,
            toNodeId: sourceCommunication.toNodeId,
            sourceNodeExecId: sourceCommunication.sourceNodeExecId,
            ...(sourceCommunication.fromSubWorkflowId === undefined
              ? {}
              : { fromSubWorkflowId: sourceCommunication.fromSubWorkflowId }),
            ...(sourceCommunication.toSubWorkflowId === undefined
              ? {}
              : { toSubWorkflowId: sourceCommunication.toSubWorkflowId }),
            routingScope: sourceCommunication.routingScope,
            deliveryKind: "manual-rerun",
            activeDeliveryAttemptId: deliveryAttemptId,
            deliveryAttemptIds: [deliveryAttemptId],
            createdAt: now,
            deliveredAt: now,
            replayedFromCommunicationId: sourceCommunication.communicationId,
            ...(input.reason === undefined
              ? {}
              : { replayReason: input.reason }),
          };
          const attempt = {
            workflowId: sourceCommunication.workflowId,
            workflowExecutionId: sourceCommunication.workflowExecutionId,
            communicationId: replayedCommunicationId,
            deliveryAttemptId,
            toNodeId: sourceCommunication.toNodeId,
            status: "succeeded",
            startedAt: now,
            endedAt: now,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          };
          const receipt = {
            communicationId: replayedCommunicationId,
            deliveryAttemptId,
            deliveredByNodeId,
            deliveredAt: now,
          };

          await atomicWriteJsonFile(
            path.join(artifactDir, "message.json"),
            envelope,
          );
          await atomicWriteJsonFile(path.join(artifactDir, "meta.json"), meta);
          await atomicWriteJsonFile(
            path.join(
              artifactDir,
              "outbox",
              sourceCommunication.fromNodeId,
              "message.json",
            ),
            envelope,
          );
          await atomicWriteTextFile(
            path.join(
              artifactDir,
              "outbox",
              sourceCommunication.fromNodeId,
              "output.json",
            ),
            outputRaw,
          );
          await atomicWriteJsonFile(
            path.join(
              artifactDir,
              "inbox",
              sourceCommunication.toNodeId,
              "message.json",
            ),
            envelope,
          );
          await atomicWriteJsonFile(
            path.join(
              artifactDir,
              "attempts",
              deliveryAttemptId,
              "attempt.json",
            ),
            attempt,
          );
          await atomicWriteJsonFile(
            path.join(
              artifactDir,
              "attempts",
              deliveryAttemptId,
              "receipt.json",
            ),
            receipt,
          );

          const replayedRecord: CommunicationRecord = {
            workflowId: sourceCommunication.workflowId,
            workflowExecutionId: sourceCommunication.workflowExecutionId,
            communicationId: replayedCommunicationId,
            fromNodeId: sourceCommunication.fromNodeId,
            toNodeId: sourceCommunication.toNodeId,
            ...(sourceCommunication.fromSubWorkflowId === undefined
              ? {}
              : { fromSubWorkflowId: sourceCommunication.fromSubWorkflowId }),
            ...(sourceCommunication.toSubWorkflowId === undefined
              ? {}
              : { toSubWorkflowId: sourceCommunication.toSubWorkflowId }),
            routingScope: sourceCommunication.routingScope,
            sourceNodeExecId: sourceCommunication.sourceNodeExecId,
            payloadRef: sourceCommunication.payloadRef,
            deliveryKind: "manual-rerun",
            transitionWhen: `manual-rerun:${sourceCommunication.communicationId}`,
            status: "delivered",
            deliveryAttemptIds: [deliveryAttemptId],
            activeDeliveryAttemptId: deliveryAttemptId,
            createdAt: now,
            deliveredAt: now,
            replayedFromCommunicationId: sourceCommunication.communicationId,
            artifactDir,
          };
          const updatedCommunications = loaded.value.communications.map(
            (communication) =>
              communication.communicationId ===
              sourceCommunication.communicationId
                ? {
                    ...communication,
                    status: "superseded" as const,
                    supersededByCommunicationId: replayedCommunicationId,
                    supersededAt: now,
                  }
                : communication,
          );
          const updatedSession: WorkflowSessionState = {
            ...loaded.value,
            communicationCounter: loaded.value.communicationCounter + 1,
            communications: [...updatedCommunications, replayedRecord],
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
    async retryCommunicationDelivery(input, options = {}) {
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
          const loaded = await loadSession(input.workflowExecutionId, options);
          if (!loaded.ok) {
            throw new Error(loaded.error.message);
          }
          const communication = findCommunication(loaded.value, input);
          if (communication === null) {
            throw new Error(
              `communication '${input.communicationId}' was not found in workflow execution '${input.workflowExecutionId}'`,
            );
          }
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
          const deliveredByNodeId = await loadDeliveredByNodeId(communication);
          await mkdir(
            path.join(
              communication.artifactDir,
              "attempts",
              activeDeliveryAttemptId,
            ),
            { recursive: true },
          );
          const attempt = {
            workflowId: communication.workflowId,
            workflowExecutionId: communication.workflowExecutionId,
            communicationId: communication.communicationId,
            deliveryAttemptId: activeDeliveryAttemptId,
            toNodeId: communication.toNodeId,
            status: "succeeded",
            startedAt: now,
            endedAt: now,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          };
          const receipt = {
            communicationId: communication.communicationId,
            deliveryAttemptId: activeDeliveryAttemptId,
            deliveredByNodeId,
            deliveredAt: now,
          };
          const metaPath = path.join(communication.artifactDir, "meta.json");
          const existingMetaRaw = await readOptionalText(metaPath);
          const existingMeta =
            existingMetaRaw === null
              ? {}
              : (JSON.parse(existingMetaRaw) as Record<string, unknown>);
          const updatedMeta: Record<string, unknown> = {
            ...existingMeta,
            status: "delivered",
            activeDeliveryAttemptId,
            deliveryAttemptIds: [
              ...communication.deliveryAttemptIds,
              activeDeliveryAttemptId,
            ],
            deliveredAt: now,
          };
          delete updatedMeta["failureReason"];

          await atomicWriteJsonFile(
            path.join(
              communication.artifactDir,
              "attempts",
              activeDeliveryAttemptId,
              "attempt.json",
            ),
            attempt,
          );
          await atomicWriteJsonFile(
            path.join(
              communication.artifactDir,
              "attempts",
              activeDeliveryAttemptId,
              "receipt.json",
            ),
            receipt,
          );
          await atomicWriteJsonFile(metaPath, updatedMeta);

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
          const updatedSession: WorkflowSessionState = {
            ...loaded.value,
            communications: loaded.value.communications.map((entry) =>
              entry.communicationId === communication.communicationId
                ? updatedRecord
                : entry,
            ),
          };
          await persistUpdatedSession(updatedSession, options);
          return {
            communicationId: communication.communicationId,
            activeDeliveryAttemptId,
            status: updatedRecord.status,
          } satisfies RetryCommunicationDeliveryResult;
        },
      });
    },
  };
}
