import path from "node:path";
import { atomicWriteJsonFile, atomicWriteTextFile } from "../shared/fs";
import {
  initialDeliveryAttemptId,
  nextCommunicationId,
} from "./runtime-execution-contracts";
import type { CommunicationRecord } from "./session";

export interface PersistDeliveredCommunicationArtifactInput {
  readonly artifactWorkflowRoot: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationCounter: number;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly routingScope: CommunicationRecord["routingScope"];
  readonly sourceNodeExecId: string;
  readonly deliveryKind: CommunicationRecord["deliveryKind"];
  readonly payloadRef: CommunicationRecord["payloadRef"];
  readonly outputRaw: string;
  readonly deliveredByNodeId: string;
  readonly createdAt: string;
  readonly extraEnvelopeFields?: Readonly<Record<string, unknown>>;
  readonly extraMetaFields?: Readonly<Record<string, unknown>>;
  readonly extraAttemptFields?: Readonly<Record<string, unknown>>;
}

export interface PersistDeliveredCommunicationArtifactResult {
  readonly communicationId: string;
  readonly deliveryAttemptId: string;
  readonly artifactDir: string;
}

export async function persistDeliveredCommunicationArtifacts(
  input: PersistDeliveredCommunicationArtifactInput,
): Promise<PersistDeliveredCommunicationArtifactResult> {
  const communicationId = nextCommunicationId(input.communicationCounter + 1);
  const deliveryAttemptId = initialDeliveryAttemptId();
  const artifactDir = path.join(
    input.artifactWorkflowRoot,
    "executions",
    input.workflowExecutionId,
    "communications",
    communicationId,
  );
  const envelope = {
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    communicationId,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    routingScope: input.routingScope,
    sourceNodeExecId: input.sourceNodeExecId,
    deliveryKind: input.deliveryKind,
    payloadRef: {
      ...input.payloadRef,
      outputFile: "output.json",
    },
    createdAt: input.createdAt,
    ...(input.extraEnvelopeFields ?? {}),
  };
  const meta = {
    status: "delivered",
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    communicationId,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    sourceNodeExecId: input.sourceNodeExecId,
    routingScope: input.routingScope,
    deliveryKind: input.deliveryKind,
    activeDeliveryAttemptId: deliveryAttemptId,
    deliveryAttemptIds: [deliveryAttemptId],
    createdAt: input.createdAt,
    deliveredAt: input.createdAt,
    ...(input.extraMetaFields ?? {}),
  };
  const attempt = {
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    communicationId,
    deliveryAttemptId,
    toNodeId: input.toNodeId,
    status: "succeeded",
    startedAt: input.createdAt,
    endedAt: input.createdAt,
    ...(input.extraAttemptFields ?? {}),
  };
  const receipt = {
    communicationId,
    deliveryAttemptId,
    deliveredByNodeId: input.deliveredByNodeId,
    deliveredAt: input.createdAt,
  };

  await atomicWriteJsonFile(path.join(artifactDir, "message.json"), envelope);
  await atomicWriteJsonFile(
    path.join(artifactDir, "outbox", input.fromNodeId, "message.json"),
    envelope,
  );
  await atomicWriteTextFile(
    path.join(artifactDir, "outbox", input.fromNodeId, "output.json"),
    input.outputRaw,
  );
  await atomicWriteJsonFile(
    path.join(artifactDir, "inbox", input.toNodeId, "message.json"),
    envelope,
  );
  await atomicWriteJsonFile(
    path.join(artifactDir, "attempts", deliveryAttemptId, "attempt.json"),
    attempt,
  );
  await atomicWriteJsonFile(
    path.join(artifactDir, "attempts", deliveryAttemptId, "receipt.json"),
    receipt,
  );
  await atomicWriteJsonFile(path.join(artifactDir, "meta.json"), meta);

  return { communicationId, deliveryAttemptId, artifactDir };
}
