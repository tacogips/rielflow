import { access } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile, atomicWriteTextFile } from "../../shared/fs";
import { persistDeliveredCommunicationArtifacts } from "../communication-artifact-persistence";
import { resolveRootDataDir } from "../paths";
import type { SessionStoreOptions } from "../session-store";
import type { CommunicationRecord, ManagerMessagePayloadRef } from "../session";
import type { ManagerControlAction } from "../manager-control";
import type { DataDirFileRef, PersistedManagerMessageArtifacts } from "./types";

export function normalizeFileRef(fileRef: DataDirFileRef): string {
  const candidate = fileRef.path.trim();
  if (candidate.length === 0) {
    throw new Error("attachment path must be non-empty");
  }
  if (path.isAbsolute(candidate)) {
    throw new Error("attachment path must be relative to DIVEDRA_ARTIFACT_DIR");
  }
  if (candidate.includes("\\")) {
    throw new Error("attachment path must use forward slashes");
  }
  const normalized = path.posix.normalize(candidate);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error("attachment path must not escape DIVEDRA_ARTIFACT_DIR");
  }
  return normalized;
}

export function normalizeAttachmentsForIdempotency(
  attachments: readonly DataDirFileRef[],
): readonly DataDirFileRef[] {
  return attachments.map((attachment) => ({
    path: normalizeFileRef(attachment),
    ...(attachment.mediaType === undefined
      ? {}
      : { mediaType: attachment.mediaType }),
  }));
}

export async function validateAttachments(
  attachments: readonly DataDirFileRef[],
  workflowId: string,
  workflowExecutionId: string,
  options: SessionStoreOptions,
): Promise<readonly DataDirFileRef[]> {
  const rootDataDir = resolveRootDataDir(options);
  const expectedPrefix = `files/${workflowId}/${workflowExecutionId}/`;
  const normalizedAttachments: DataDirFileRef[] = [];
  for (const attachment of attachments) {
    const normalized = normalizeFileRef(attachment);
    if (!normalized.startsWith(expectedPrefix)) {
      throw new Error(`attachment path must stay within ${expectedPrefix}`);
    }
    const resolved = path.resolve(rootDataDir, ...normalized.split("/"));
    const rootPrefix = `${rootDataDir}${path.sep}`;
    if (resolved !== rootDataDir && !resolved.startsWith(rootPrefix)) {
      throw new Error("attachment path must stay within DIVEDRA_ARTIFACT_DIR");
    }
    await access(resolved);
    normalizedAttachments.push({
      path: normalized,
      ...(attachment.mediaType === undefined
        ? {}
        : { mediaType: attachment.mediaType }),
    });
  }
  return normalizedAttachments;
}

function buildManagerMessageOutputRaw(args: {
  readonly managerStepId: string;
  readonly message: string | undefined;
  readonly attachments: readonly DataDirFileRef[];
  readonly actions: readonly ManagerControlAction[];
}): string {
  return `${JSON.stringify(
    {
      provider: "manager-message",
      model: args.managerStepId,
      promptText: args.message ?? "",
      completionPassed: true,
      when: { always: true },
      payload: {
        message: args.message ?? "",
        attachments: args.attachments,
        actions: args.actions,
      },
    },
    null,
    2,
  )}\n`;
}

export async function prepareManagerMessageArtifacts(args: {
  readonly artifactWorkflowRoot: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerSessionId: string;
  readonly managerMessageId: string;
  readonly managerStepId: string;
  readonly managerNodeExecId: string;
  readonly message: string | undefined;
  readonly attachments: readonly DataDirFileRef[];
  readonly actions: readonly ManagerControlAction[];
}): Promise<PersistedManagerMessageArtifacts> {
  const artifactDir = path.join(
    args.artifactWorkflowRoot,
    "executions",
    args.workflowExecutionId,
    "manager-sessions",
    args.managerSessionId,
    "messages",
    args.managerMessageId,
  );
  const payloadRef: ManagerMessagePayloadRef = {
    kind: "manager-message",
    workflowId: args.workflowId,
    workflowExecutionId: args.workflowExecutionId,
    outputNodeId: args.managerStepId,
    nodeExecId: args.managerNodeExecId,
    artifactDir,
    managerSessionId: args.managerSessionId,
    managerMessageId: args.managerMessageId,
    managerStepId: args.managerStepId,
    managerNodeExecId: args.managerNodeExecId,
  };
  const outputRaw = buildManagerMessageOutputRaw({
    managerStepId: args.managerStepId,
    message: args.message,
    attachments: args.attachments,
    actions: args.actions,
  });
  await atomicWriteTextFile(path.join(artifactDir, "output.json"), outputRaw);
  return {
    artifactDir,
    outputRaw,
    payloadRef,
  };
}

export async function writeManagerMessageEnvelope(args: {
  readonly artifacts: PersistedManagerMessageArtifacts;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerSessionId: string;
  readonly managerMessageId: string;
  readonly managerStepId: string;
  readonly managerNodeExecId: string;
  readonly message: string | undefined;
  readonly attachments: readonly DataDirFileRef[];
  readonly actions: readonly ManagerControlAction[];
  readonly parsedIntent: readonly import("../manager-session-store").ManagerIntentSummary[];
  readonly createdAt: string;
  readonly accepted: boolean;
  readonly createdCommunicationIds: readonly string[];
  readonly queuedNodeIds: readonly string[];
  readonly rejectionReason?: string;
}): Promise<void> {
  await atomicWriteJsonFile(
    path.join(args.artifacts.artifactDir, "message.json"),
    {
      workflowId: args.workflowId,
      workflowExecutionId: args.workflowExecutionId,
      managerSessionId: args.managerSessionId,
      managerMessageId: args.managerMessageId,
      managerStepId: args.managerStepId,
      managerNodeExecId: args.managerNodeExecId,
      ...(args.message === undefined ? {} : { message: args.message }),
      attachments: args.attachments,
      actions: args.actions,
      parsedIntent: args.parsedIntent,
      accepted: args.accepted,
      createdCommunicationIds: args.createdCommunicationIds,
      queuedNodeIds: args.queuedNodeIds,
      ...(args.rejectionReason === undefined
        ? {}
        : { rejectionReason: args.rejectionReason }),
      createdAt: args.createdAt,
      payloadRef: args.artifacts.payloadRef,
    },
  );
}

export async function persistManagerMessageCommunication(args: {
  readonly artifactWorkflowRoot: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationCounter: number;
  readonly managerMessageId: string;
  readonly managerStepId: string;
  readonly managerNodeExecId: string;
  readonly targetNodeId: string;
  readonly payloadRef: ManagerMessagePayloadRef;
  readonly outputRaw: string;
  readonly createdAt: string;
}): Promise<CommunicationRecord> {
  const persisted = await persistDeliveredCommunicationArtifacts({
    artifactWorkflowRoot: args.artifactWorkflowRoot,
    workflowId: args.workflowId,
    workflowExecutionId: args.workflowExecutionId,
    communicationCounter: args.communicationCounter,
    fromNodeId: args.managerStepId,
    toNodeId: args.targetNodeId,
    routingScope: "intra-workflow",
    sourceNodeExecId: args.managerNodeExecId,
    deliveryKind: "edge-transition",
    payloadRef: args.payloadRef,
    outputRaw: args.outputRaw,
    deliveredByNodeId: args.managerStepId,
    createdAt: args.createdAt,
    extraEnvelopeFields: { managerMessageId: args.managerMessageId },
    extraMetaFields: { managerMessageId: args.managerMessageId },
  });

  return {
    workflowId: args.workflowId,
    workflowExecutionId: args.workflowExecutionId,
    communicationId: persisted.communicationId,
    fromNodeId: args.managerStepId,
    toNodeId: args.targetNodeId,
    routingScope: "intra-workflow",
    sourceNodeExecId: args.managerNodeExecId,
    payloadRef: args.payloadRef,
    deliveryKind: "edge-transition",
    transitionWhen: `manager-message:${args.managerMessageId}:to-node:${args.targetNodeId}`,
    status: "delivered",
    deliveryAttemptIds: [persisted.deliveryAttemptId],
    activeDeliveryAttemptId: persisted.deliveryAttemptId,
    createdAt: args.createdAt,
    deliveredAt: args.createdAt,
    managerMessageId: args.managerMessageId,
    artifactDir: persisted.artifactDir,
  };
}
