import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import type { Database } from "bun:sqlite";
import path from "node:path";
import {
  normalizeMessageAttachmentPath,
  resolveWorkflowMessageArtifactRef,
} from "../message-attachment-paths";
import { resolveAttachmentRoot, resolveRootDataDir } from "../paths";
import type { CommunicationRecord } from "../session";
import type { LoadOptions } from "../types";
import type {
  RuntimeWorkflowMessageRecord,
  WorkflowMessageArtifactRef,
} from "./schema-and-record-types";
import { withDatabase } from "./schema-and-record-types";
import {
  cleanupMaterializedAttachmentFiles,
  isErrnoException,
} from "./fs-safety";
import { copyFileHandleContents } from "./file-handle-copy";
import { isJsonObject } from "./value-guards";
import {
  runBeforeAttachmentSourceOpenForTests,
  runBeforeAttachmentTargetCloseForTests,
  runBeforeAttachmentTargetFileWriteForTests,
  runBeforeAttachmentTargetWriteForTests,
} from "./workflow-message-test-hooks";
import {
  toRuntimeWorkflowMessageRecordFromRow,
  type RuntimeWorkflowMessageRow,
} from "./workflow-message-record-conversion";

export interface SaveWorkflowMessageInput {
  readonly communication: CommunicationRecord;
  readonly outputRaw?: string;
  readonly updatedAt?: string;
}

export interface SaveWorkflowMessageReplayInput {
  readonly replayedCommunication: CommunicationRecord;
  readonly sourceCommunication: CommunicationRecord;
  readonly outputRaw: string;
  readonly updatedAt?: string;
}

export interface WorkflowMessageQueryInput {
  readonly workflowExecutionId: string;
  readonly communicationId?: string;
  readonly fromNodeId?: string;
  readonly toNodeId?: string;
}

interface WorkflowMessagePayloadSnapshot {
  readonly payloadJson: string | null;
  readonly artifactRefs: readonly WorkflowMessageArtifactRef[];
}

type WorkflowMessageAttachmentSnapshotResult =
  | {
      readonly kind: "preserve";
      readonly attachment: unknown;
    }
  | {
      readonly kind: "materialized";
      readonly ref: WorkflowMessageArtifactRef;
    };

interface AttachmentSourceSnapshot {
  readonly byteLength: number;
  readonly dev: number;
  readonly ino: number;
  readonly sourceRealPath: string;
}

function normalizeRootDataRelativePath(relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("\\")) {
    throw new Error("message attachment path must be relative to root data");
  }
  const normalized = path.posix.normalize(relativePath.trim());
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error("message attachment path must not escape root data");
  }
  return normalized;
}

function messageAttachmentTail(
  sourcePath: string,
  communication: CommunicationRecord,
): string {
  const prefix = `files/${communication.workflowId}/${communication.workflowExecutionId}/`;
  if (!sourcePath.startsWith(prefix)) {
    throw new Error(
      "message attachment ref must stay within the current workflow execution",
    );
  }
  const tail = sourcePath.slice(prefix.length);
  if (tail.length === 0) {
    throw new Error("message attachment ref must include a scoped file path");
  }
  return tail;
}

function existingAttachmentRootTail(
  sourcePath: string,
  communication: CommunicationRecord,
): string {
  const messageScopePrefix = `${communication.workflowId}/${communication.workflowExecutionId}/messages/`;
  if (!sourcePath.startsWith(messageScopePrefix)) {
    throw new Error(
      "message attachment ref must stay within the current workflow execution",
    );
  }
  const scopedTail = sourcePath.slice(messageScopePrefix.length);
  const [sourceCommunicationId, ...tailSegments] = scopedTail.split("/");
  if (
    sourceCommunicationId === undefined ||
    sourceCommunicationId.length === 0 ||
    tailSegments.length === 0
  ) {
    throw new Error("message attachment ref must include a scoped file path");
  }
  return tailSegments.join("/");
}

function isPathWithinScope(scopePath: string, candidatePath: string): boolean {
  const relativePath = path.relative(scopePath, candidatePath);
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

function isPathAtOrWithinScope(
  scopePath: string,
  candidatePath: string,
): boolean {
  const relativePath = path.relative(scopePath, candidatePath);
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function assertDirectoryPathWithoutSymlinks(input: {
  readonly rootAbsolutePath: string;
  readonly segments: readonly string[];
}): Promise<void> {
  await mkdir(input.rootAbsolutePath, { recursive: true });
  let currentPath = input.rootAbsolutePath;
  for (const segment of input.segments) {
    currentPath = path.join(currentPath, segment);
    await ensureDirectoryWithoutSymlink(currentPath);
  }
}

async function ensureDirectoryWithoutSymlink(
  directoryPath: string,
): Promise<void> {
  try {
    const directoryStats = await lstat(directoryPath);
    if (directoryStats.isSymbolicLink()) {
      throw new Error(
        "message attachment target must stay within the current workflow execution",
      );
    }
    if (!directoryStats.isDirectory()) {
      throw new Error("message attachment target parent must be a directory");
    }
    return;
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await mkdir(directoryPath);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "EEXIST") {
      throw error;
    }
  }
  const directoryStats = await lstat(directoryPath);
  if (directoryStats.isSymbolicLink()) {
    throw new Error(
      "message attachment target must stay within the current workflow execution",
    );
  }
  if (!directoryStats.isDirectory()) {
    throw new Error("message attachment target parent must be a directory");
  }
}

async function assertAttachmentSourceWithinScope(input: {
  readonly sourceAbsolutePath: string;
  readonly rootAbsolutePath: string;
  readonly scopeSegments: readonly string[];
  readonly sourcePath: string;
}): Promise<AttachmentSourceSnapshot> {
  const sourceLinkStats = await lstat(input.sourceAbsolutePath);
  if (sourceLinkStats.isSymbolicLink()) {
    throw new Error("message attachment source must not be a symlink");
  }
  if (sourceLinkStats.isFile() && sourceLinkStats.nlink > 1) {
    throw new Error("message attachment source must not be a hardlink");
  }
  const sourceRealPath = await realpath(input.sourceAbsolutePath);
  const rootRealPath = await realpath(input.rootAbsolutePath);
  const expectedScopeRealPath = path.resolve(
    rootRealPath,
    ...input.scopeSegments,
  );
  const scopeRealPath = await realpath(
    path.resolve(input.rootAbsolutePath, ...input.scopeSegments),
  );
  if (
    scopeRealPath !== expectedScopeRealPath ||
    !isPathWithinScope(expectedScopeRealPath, sourceRealPath)
  ) {
    throw new Error(
      "message attachment ref must stay within the current workflow execution",
    );
  }
  const sourceStats = await stat(sourceRealPath);
  if (!sourceStats.isFile()) {
    throw new Error(
      `message attachment '${input.sourcePath}' is not a regular file`,
    );
  }
  if (sourceStats.nlink > 1) {
    throw new Error("message attachment source must not be a hardlink");
  }
  return {
    byteLength: sourceStats.size,
    dev: sourceStats.dev,
    ino: sourceStats.ino,
    sourceRealPath,
  };
}

async function assertAttachmentTargetWithinScope(input: {
  readonly targetAbsolutePath: string;
  readonly rootAbsolutePath: string;
  readonly scopeSegments: readonly string[];
}): Promise<void> {
  const targetParentPath = path.dirname(input.targetAbsolutePath);
  const scopeAbsolutePath = path.resolve(
    input.rootAbsolutePath,
    ...input.scopeSegments,
  );
  if (!isPathAtOrWithinScope(scopeAbsolutePath, targetParentPath)) {
    throw new Error(
      "message attachment target must stay within the current workflow execution",
    );
  }
  const targetParentTail = path.relative(scopeAbsolutePath, targetParentPath);
  await assertDirectoryPathWithoutSymlinks({
    rootAbsolutePath: input.rootAbsolutePath,
    segments: [
      ...input.scopeSegments,
      ...(targetParentTail.length === 0
        ? []
        : targetParentTail.split(path.sep)),
    ],
  });
  const rootRealPath = await realpath(input.rootAbsolutePath);
  const expectedScopeRealPath = path.resolve(
    rootRealPath,
    ...input.scopeSegments,
  );
  const scopeRealPath = await realpath(scopeAbsolutePath);
  const targetParentRealPath = await realpath(targetParentPath);
  if (
    scopeRealPath !== expectedScopeRealPath ||
    !isPathAtOrWithinScope(expectedScopeRealPath, targetParentRealPath)
  ) {
    throw new Error(
      "message attachment target must stay within the current workflow execution",
    );
  }
  try {
    const targetStats = await lstat(input.targetAbsolutePath);
    if (targetStats.isSymbolicLink()) {
      throw new Error(
        "message attachment target must stay within the current workflow execution",
      );
    }
    if (!targetStats.isFile()) {
      throw new Error("message attachment target must be a regular file path");
    }
    if (targetStats.nlink > 1) {
      throw new Error("message attachment target must not be a hardlink");
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function copyAttachmentFileExclusive(input: {
  readonly source: AttachmentSourceSnapshot;
  readonly targetAbsolutePath: string;
  readonly rootAbsolutePath: string;
  readonly scopeSegments: readonly string[];
}): Promise<void> {
  await runBeforeAttachmentSourceOpenForTests(input.source.sourceRealPath);
  let sourceHandle: Awaited<ReturnType<typeof open>> | undefined;
  let targetHandle: Awaited<ReturnType<typeof open>> | undefined;
  let createdTargetPath: string | undefined;
  try {
    sourceHandle = await open(input.source.sourceRealPath, "r");
    const sourceStats = await sourceHandle.stat();
    if (
      !sourceStats.isFile() ||
      sourceStats.nlink > 1 ||
      sourceStats.dev !== input.source.dev ||
      sourceStats.ino !== input.source.ino
    ) {
      throw new Error(
        "message attachment source changed during materialization",
      );
    }
    await assertAttachmentTargetWithinScope(input);
    await runBeforeAttachmentTargetWriteForTests(input.targetAbsolutePath);
    await assertAttachmentTargetWithinScope(input);

    targetHandle = await open(input.targetAbsolutePath, "wx");
    createdTargetPath = input.targetAbsolutePath;
    const rootRealPath = await realpath(input.rootAbsolutePath);
    const expectedScopeRealPath = path.resolve(
      rootRealPath,
      ...input.scopeSegments,
    );
    const targetRealPath = await realpath(input.targetAbsolutePath);
    if (!isPathWithinScope(expectedScopeRealPath, targetRealPath)) {
      throw new Error(
        "message attachment target must stay within the current workflow execution",
      );
    }
    const targetStats = await targetHandle.stat();
    if (!targetStats.isFile() || targetStats.nlink > 1) {
      throw new Error("message attachment target must be a regular file path");
    }
    await runBeforeAttachmentTargetFileWriteForTests(input.targetAbsolutePath);
    await copyFileHandleContents(sourceHandle, targetHandle);
    await runBeforeAttachmentTargetCloseForTests(input.targetAbsolutePath);
    await targetHandle.close();
    targetHandle = undefined;
  } catch (error) {
    if (createdTargetPath !== undefined) {
      await closeFileHandleIgnoringErrors(targetHandle);
      targetHandle = undefined;
      await cleanupMaterializedAttachmentFiles([createdTargetPath]).catch(
        () => undefined,
      );
    }
    if (isErrnoException(error) && error.code === "EEXIST") {
      throw new Error("message attachment target must not already exist");
    }
    throw error;
  } finally {
    await targetHandle?.close();
    await sourceHandle?.close();
  }
}

async function closeFileHandleIgnoringErrors(
  handle: Awaited<ReturnType<typeof open>> | undefined,
): Promise<void> {
  try {
    await handle?.close();
  } catch {
    return;
  }
}

async function materializeRootDataAttachment(input: {
  readonly sourcePath: string;
  readonly communication: CommunicationRecord;
  readonly mediaType: string | undefined;
  readonly options: LoadOptions;
  readonly createdAttachmentPaths: string[];
}): Promise<WorkflowMessageArtifactRef> {
  const normalizedSource = normalizeRootDataRelativePath(input.sourcePath);
  const targetTail = messageAttachmentTail(
    normalizedSource,
    input.communication,
  );
  const rootDataDir = resolveRootDataDir(input.options);
  const sourceAbsolutePath = path.resolve(
    rootDataDir,
    ...normalizedSource.split("/"),
  );
  const source = await assertAttachmentSourceWithinScope({
    sourceAbsolutePath,
    rootAbsolutePath: rootDataDir,
    scopeSegments: [
      "files",
      input.communication.workflowId,
      input.communication.workflowExecutionId,
    ],
    sourcePath: input.sourcePath,
  });
  const normalizedTarget = normalizeMessageAttachmentPath(
    {
      workflowId: input.communication.workflowId,
      workflowExecutionId: input.communication.workflowExecutionId,
      communicationId: input.communication.communicationId,
    },
    `files/${targetTail}`,
    input.options,
  );
  await copyAttachmentFileExclusive({
    source,
    targetAbsolutePath: normalizedTarget.absolutePath,
    rootAbsolutePath: resolveAttachmentRoot(input.options),
    scopeSegments: [
      input.communication.workflowId,
      input.communication.workflowExecutionId,
      "messages",
      input.communication.communicationId,
    ],
  });
  input.createdAttachmentPaths.push(normalizedTarget.absolutePath);
  return {
    pathBase: "attachment-root",
    path: normalizedTarget.relativePath,
    ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    byteLength: source.byteLength,
    sourcePath: normalizedSource,
  };
}

async function materializeAttachmentRootRef(input: {
  readonly sourcePath: string;
  readonly communication: CommunicationRecord;
  readonly mediaType: string | undefined;
  readonly options: LoadOptions;
  readonly createdAttachmentPaths: string[];
}): Promise<WorkflowMessageArtifactRef> {
  const targetTail = existingAttachmentRootTail(
    input.sourcePath,
    input.communication,
  );
  const source = resolveWorkflowMessageArtifactRef(
    {
      pathBase: "attachment-root",
      path: input.sourcePath,
      ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    },
    input.options,
  );
  const attachmentRoot = resolveAttachmentRoot(input.options);
  const sourceFile = await assertAttachmentSourceWithinScope({
    sourceAbsolutePath: source.absolutePath,
    rootAbsolutePath: attachmentRoot,
    scopeSegments: [
      input.communication.workflowId,
      input.communication.workflowExecutionId,
      "messages",
    ],
    sourcePath: input.sourcePath,
  });
  const normalizedTarget = normalizeMessageAttachmentPath(
    {
      workflowId: input.communication.workflowId,
      workflowExecutionId: input.communication.workflowExecutionId,
      communicationId: input.communication.communicationId,
    },
    targetTail,
    input.options,
  );
  if (sourceFile.sourceRealPath !== normalizedTarget.absolutePath) {
    await copyAttachmentFileExclusive({
      source: sourceFile,
      targetAbsolutePath: normalizedTarget.absolutePath,
      rootAbsolutePath: attachmentRoot,
      scopeSegments: [
        input.communication.workflowId,
        input.communication.workflowExecutionId,
        "messages",
        input.communication.communicationId,
      ],
    });
    input.createdAttachmentPaths.push(normalizedTarget.absolutePath);
  }
  return {
    pathBase: "attachment-root",
    path: normalizedTarget.relativePath,
    ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    byteLength: sourceFile.byteLength,
    sourcePath: input.sourcePath,
  };
}

async function materializeAttachmentRef(input: {
  readonly attachment: Readonly<Record<string, unknown>>;
  readonly communication: CommunicationRecord;
  readonly options: LoadOptions;
  readonly createdAttachmentPaths: string[];
}): Promise<WorkflowMessageArtifactRef | null> {
  const sourcePath = input.attachment["path"];
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    return null;
  }
  const mediaType = input.attachment["mediaType"];
  const normalizedMediaType =
    typeof mediaType === "string" ? mediaType : undefined;
  if (input.attachment["pathBase"] === "attachment-root") {
    return await materializeAttachmentRootRef({
      sourcePath,
      communication: input.communication,
      mediaType: normalizedMediaType,
      options: input.options,
      createdAttachmentPaths: input.createdAttachmentPaths,
    });
  }
  if (sourcePath.startsWith("files/")) {
    return await materializeRootDataAttachment({
      sourcePath,
      communication: input.communication,
      mediaType: normalizedMediaType,
      options: input.options,
      createdAttachmentPaths: input.createdAttachmentPaths,
    });
  }
  if (path.isAbsolute(sourcePath)) {
    throw new Error(
      "new message attachments must not use absolute paths; write files under the attachment root",
    );
  }
  const normalized = normalizeMessageAttachmentPath(
    {
      workflowId: input.communication.workflowId,
      workflowExecutionId: input.communication.workflowExecutionId,
      communicationId: input.communication.communicationId,
    },
    sourcePath,
    input.options,
  );
  const attachmentRoot = resolveAttachmentRoot(input.options);
  const attachmentFile = await assertAttachmentSourceWithinScope({
    sourceAbsolutePath: normalized.absolutePath,
    rootAbsolutePath: attachmentRoot,
    scopeSegments: [
      input.communication.workflowId,
      input.communication.workflowExecutionId,
      "messages",
      input.communication.communicationId,
    ],
    sourcePath,
  });
  return {
    pathBase: "attachment-root",
    path: normalized.relativePath,
    ...(normalizedMediaType === undefined
      ? {}
      : { mediaType: normalizedMediaType }),
    byteLength: attachmentFile.byteLength,
  };
}

function isUrlLikeAttachmentPath(sourcePath: string): boolean {
  const trimmed = sourcePath.trim();
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(trimmed);
  if (schemeMatch === null) {
    return false;
  }
  const scheme = schemeMatch[1]?.toLowerCase();
  return scheme !== undefined && scheme !== "file" && scheme.length > 1;
}

async function snapshotAttachmentDescriptor(input: {
  readonly attachment: unknown;
  readonly communication: CommunicationRecord;
  readonly options: LoadOptions;
  readonly createdAttachmentPaths: string[];
}): Promise<WorkflowMessageAttachmentSnapshotResult> {
  if (!isJsonObject(input.attachment)) {
    return { kind: "preserve", attachment: input.attachment };
  }

  const sourcePath = input.attachment["path"];
  if (
    typeof sourcePath !== "string" ||
    sourcePath.trim().length === 0 ||
    (input.attachment["pathBase"] !== "attachment-root" &&
      isUrlLikeAttachmentPath(sourcePath))
  ) {
    return { kind: "preserve", attachment: input.attachment };
  }

  const ref = await materializeAttachmentRef({
    attachment: input.attachment,
    communication: input.communication,
    options: input.options,
    createdAttachmentPaths: input.createdAttachmentPaths,
  });
  return ref === null
    ? { kind: "preserve", attachment: input.attachment }
    : { kind: "materialized", ref };
}

async function buildWorkflowMessagePayloadSnapshot(
  communication: CommunicationRecord,
  outputRaw: string | undefined,
  options: LoadOptions,
  createdAttachmentPaths: string[],
): Promise<WorkflowMessagePayloadSnapshot> {
  if (outputRaw === undefined) {
    return { payloadJson: null, artifactRefs: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputRaw);
  } catch {
    return { payloadJson: null, artifactRefs: [] };
  }
  if (!isJsonObject(parsed) || !isJsonObject(parsed["payload"])) {
    return { payloadJson: JSON.stringify(parsed), artifactRefs: [] };
  }
  const attachments = parsed["payload"]["attachments"];
  if (!Array.isArray(attachments)) {
    return { payloadJson: JSON.stringify(parsed), artifactRefs: [] };
  }
  const artifactRefs: WorkflowMessageArtifactRef[] = [];
  const sanitizedAttachments: unknown[] = [];
  for (const attachment of attachments) {
    const snapshot = await snapshotAttachmentDescriptor({
      attachment,
      communication,
      options,
      createdAttachmentPaths,
    });
    if (snapshot.kind === "preserve") {
      sanitizedAttachments.push(snapshot.attachment);
      continue;
    }
    artifactRefs.push(snapshot.ref);
    sanitizedAttachments.push(snapshot.ref);
  }
  const sanitizedPayload = {
    ...parsed["payload"],
    attachments: sanitizedAttachments,
  };
  return {
    payloadJson: JSON.stringify({
      ...parsed,
      payload: sanitizedPayload,
    }),
    artifactRefs,
  };
}

function toRuntimeWorkflowMessageRecord(
  communication: CommunicationRecord,
  payloadSnapshot: WorkflowMessagePayloadSnapshot,
  updatedAt: string,
): RuntimeWorkflowMessageRecord {
  return {
    workflowId: communication.workflowId,
    workflowExecutionId: communication.workflowExecutionId,
    communicationId: communication.communicationId,
    fromNodeId: communication.fromNodeId,
    toNodeId: communication.toNodeId,
    routingScope: communication.routingScope,
    deliveryKind: communication.deliveryKind,
    transitionWhen: communication.transitionWhen,
    sourceNodeExecId: communication.sourceNodeExecId,
    status: communication.status,
    activeDeliveryAttemptId: communication.activeDeliveryAttemptId ?? null,
    deliveryAttemptIdsJson: JSON.stringify(communication.deliveryAttemptIds),
    payloadRefJson: JSON.stringify(communication.payloadRef),
    payloadJson: payloadSnapshot.payloadJson,
    artifactRefsJson:
      payloadSnapshot.artifactRefs.length === 0
        ? null
        : JSON.stringify(payloadSnapshot.artifactRefs),
    artifactDir: communication.artifactDir,
    createdAt: communication.createdAt,
    deliveredAt: communication.deliveredAt ?? null,
    consumedByNodeExecId: communication.consumedByNodeExecId ?? null,
    consumedAt: communication.consumedAt ?? null,
    failureReason: communication.failureReason ?? null,
    supersededByCommunicationId:
      communication.supersededByCommunicationId ?? null,
    supersededAt: communication.supersededAt ?? null,
    replayedFromCommunicationId:
      communication.replayedFromCommunicationId ?? null,
    managerMessageId: communication.managerMessageId ?? null,
    updatedAt,
  };
}

export async function saveWorkflowMessageToRuntimeDb(
  input: SaveWorkflowMessageInput,
  options: LoadOptions = {},
): Promise<RuntimeWorkflowMessageRecord> {
  const preservePayloadOnConflict = input.outputRaw === undefined;
  const createdAttachmentPaths: string[] = [];
  try {
    const payloadSnapshot = await buildWorkflowMessagePayloadSnapshot(
      input.communication,
      input.outputRaw,
      options,
      createdAttachmentPaths,
    );
    const record = toRuntimeWorkflowMessageRecord(
      input.communication,
      payloadSnapshot,
      input.updatedAt ?? new Date().toISOString(),
    );
    await withDatabase(options, (db) => {
      runWorkflowMessageUpsert(db, record, preservePayloadOnConflict);
    });
    return record;
  } catch (error) {
    await cleanupMaterializedAttachmentFiles(createdAttachmentPaths);
    throw error;
  }
}

function runWorkflowMessageUpsert(
  db: Database,
  record: RuntimeWorkflowMessageRecord,
  preservePayloadOnConflict: boolean,
): void {
  const stmt = db.prepare(`
      INSERT INTO workflow_messages (
        workflow_id, workflow_execution_id, communication_id, from_node_id,
        to_node_id, routing_scope, delivery_kind, transition_when,
        source_node_exec_id, status, active_delivery_attempt_id,
        delivery_attempt_ids_json, payload_ref_json, payload_json,
        artifact_refs_json, artifact_dir, created_at, delivered_at,
        consumed_by_node_exec_id, consumed_at, failure_reason,
        superseded_by_communication_id, superseded_at,
        replayed_from_communication_id, manager_message_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_execution_id, communication_id) DO UPDATE SET
        workflow_id=excluded.workflow_id,
        from_node_id=excluded.from_node_id,
        to_node_id=excluded.to_node_id,
        routing_scope=excluded.routing_scope,
        delivery_kind=excluded.delivery_kind,
        transition_when=excluded.transition_when,
        source_node_exec_id=excluded.source_node_exec_id,
        status=excluded.status,
        active_delivery_attempt_id=excluded.active_delivery_attempt_id,
        delivery_attempt_ids_json=excluded.delivery_attempt_ids_json,
        payload_ref_json=excluded.payload_ref_json,
        payload_json=CASE WHEN ? THEN workflow_messages.payload_json ELSE excluded.payload_json END,
        artifact_refs_json=CASE WHEN ? THEN workflow_messages.artifact_refs_json ELSE excluded.artifact_refs_json END,
        artifact_dir=excluded.artifact_dir,
        created_at=excluded.created_at,
        delivered_at=excluded.delivered_at,
        consumed_by_node_exec_id=excluded.consumed_by_node_exec_id,
        consumed_at=excluded.consumed_at,
        failure_reason=excluded.failure_reason,
        superseded_by_communication_id=excluded.superseded_by_communication_id,
        superseded_at=excluded.superseded_at,
        replayed_from_communication_id=excluded.replayed_from_communication_id,
        manager_message_id=excluded.manager_message_id,
        updated_at=excluded.updated_at
    `);
  stmt.run(
    record.workflowId,
    record.workflowExecutionId,
    record.communicationId,
    record.fromNodeId,
    record.toNodeId,
    record.routingScope,
    record.deliveryKind,
    record.transitionWhen,
    record.sourceNodeExecId,
    record.status,
    record.activeDeliveryAttemptId,
    record.deliveryAttemptIdsJson,
    record.payloadRefJson,
    record.payloadJson,
    record.artifactRefsJson,
    record.artifactDir,
    record.createdAt,
    record.deliveredAt,
    record.consumedByNodeExecId,
    record.consumedAt,
    record.failureReason,
    record.supersededByCommunicationId,
    record.supersededAt,
    record.replayedFromCommunicationId,
    record.managerMessageId,
    record.updatedAt,
    preservePayloadOnConflict,
    preservePayloadOnConflict,
  );
}

export async function saveWorkflowMessageReplayToRuntimeDb(
  input: SaveWorkflowMessageReplayInput,
  options: LoadOptions = {},
): Promise<RuntimeWorkflowMessageRecord> {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const createdAttachmentPaths: string[] = [];
  try {
    const replayPayloadSnapshot = await buildWorkflowMessagePayloadSnapshot(
      input.replayedCommunication,
      input.outputRaw,
      options,
      createdAttachmentPaths,
    );
    const replayRecord = toRuntimeWorkflowMessageRecord(
      input.replayedCommunication,
      replayPayloadSnapshot,
      updatedAt,
    );
    const sourceRecord = toRuntimeWorkflowMessageRecord(
      input.sourceCommunication,
      { payloadJson: null, artifactRefs: [] },
      updatedAt,
    );
    await withDatabase(options, (db) => {
      const saveReplay = db.transaction(() => {
        runWorkflowMessageUpsert(db, replayRecord, false);
        runWorkflowMessageUpsert(db, sourceRecord, true);
      });
      saveReplay();
    });
    return replayRecord;
  } catch (error) {
    await cleanupMaterializedAttachmentFiles(createdAttachmentPaths);
    throw error;
  }
}

export async function loadWorkflowMessageFromRuntimeDb(
  input: {
    readonly workflowExecutionId: string;
    readonly communicationId: string;
  },
  options: LoadOptions = {},
): Promise<RuntimeWorkflowMessageRecord | null> {
  return await withDatabase(options, (db) => {
    const row = db
      .query(
        "SELECT * FROM workflow_messages WHERE workflow_execution_id = ? AND communication_id = ?",
      )
      .get(
        input.workflowExecutionId,
        input.communicationId,
      ) as RuntimeWorkflowMessageRow | null;
    return row === null ? null : toRuntimeWorkflowMessageRecordFromRow(row);
  });
}

export async function listWorkflowMessagesFromRuntimeDb(
  input: WorkflowMessageQueryInput,
  options: LoadOptions = {},
): Promise<readonly RuntimeWorkflowMessageRecord[]> {
  return await withDatabase(options, (db) => {
    const filters = ["workflow_execution_id = ?"];
    const params: string[] = [input.workflowExecutionId];
    if (input.communicationId !== undefined) {
      filters.push("communication_id = ?");
      params.push(input.communicationId);
    }
    if (input.fromNodeId !== undefined) {
      filters.push("from_node_id = ?");
      params.push(input.fromNodeId);
    }
    if (input.toNodeId !== undefined) {
      filters.push("to_node_id = ?");
      params.push(input.toNodeId);
    }
    const rows = db
      .query(
        `SELECT * FROM workflow_messages WHERE ${filters.join(
          " AND ",
        )} ORDER BY created_at ASC, communication_id ASC`,
      )
      .all(...params) as RuntimeWorkflowMessageRow[];
    return rows.map(toRuntimeWorkflowMessageRecordFromRow);
  });
}

export async function markWorkflowMessagesConsumedInRuntimeDb(
  input: {
    readonly workflowExecutionId: string;
    readonly communicationIds: readonly string[];
    readonly consumedByNodeExecId: string;
    readonly consumedAt: string;
  },
  options: LoadOptions = {},
): Promise<void> {
  if (input.communicationIds.length === 0) {
    return;
  }
  await withDatabase(options, (db) => {
    const update = db.prepare(`
      UPDATE workflow_messages
      SET status = 'consumed',
        consumed_by_node_exec_id = ?,
        consumed_at = ?,
        updated_at = ?
      WHERE workflow_execution_id = ? AND communication_id = ? AND status = 'delivered'
    `);
    const runUpdate = db.transaction(() => {
      for (const communicationId of input.communicationIds) {
        update.run(
          input.consumedByNodeExecId,
          input.consumedAt,
          input.consumedAt,
          input.workflowExecutionId,
          communicationId,
        );
      }
    });
    runUpdate();
  });
}

export async function updateWorkflowMessageStatusInRuntimeDb(
  communication: CommunicationRecord,
  options: LoadOptions = {},
): Promise<void> {
  await saveWorkflowMessageToRuntimeDb(
    { communication, updatedAt: new Date().toISOString() },
    options,
  );
}
