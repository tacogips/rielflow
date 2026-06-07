import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeMessageAttachmentPath } from "../message-attachment-paths";
import { resolveRootDataDir } from "../paths";
import type { CommunicationRecord } from "../session";
import type { LoadOptions } from "../types";
import type {
  RuntimeWorkflowMessageRecord,
  WorkflowMessageArtifactRef,
} from "./schema-and-record-types";
import { withDatabase } from "./schema-and-record-types";

interface RuntimeWorkflowMessageRow {
  readonly workflow_id: string;
  readonly workflow_execution_id: string;
  readonly communication_id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly routing_scope: string;
  readonly delivery_kind: CommunicationRecord["deliveryKind"];
  readonly transition_when: string;
  readonly source_node_exec_id: string;
  readonly status: CommunicationRecord["status"];
  readonly active_delivery_attempt_id: string | null;
  readonly delivery_attempt_ids_json: string;
  readonly payload_ref_json: string;
  readonly payload_json: string | null;
  readonly artifact_refs_json: string | null;
  readonly artifact_dir: string;
  readonly created_at: string;
  readonly delivered_at: string | null;
  readonly consumed_by_node_exec_id: string | null;
  readonly consumed_at: string | null;
  readonly failure_reason: string | null;
  readonly superseded_by_communication_id: string | null;
  readonly superseded_at: string | null;
  readonly replayed_from_communication_id: string | null;
  readonly manager_message_id: string | null;
  readonly updated_at: string;
}

export interface SaveWorkflowMessageInput {
  readonly communication: CommunicationRecord;
  readonly outputRaw?: string;
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

function isJsonObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return sourcePath.startsWith(prefix)
    ? sourcePath.slice(prefix.length)
    : path.posix.basename(sourcePath);
}

async function materializeRootDataAttachment(input: {
  readonly sourcePath: string;
  readonly communication: CommunicationRecord;
  readonly mediaType: string | undefined;
  readonly options: LoadOptions;
}): Promise<WorkflowMessageArtifactRef> {
  const normalizedSource = normalizeRootDataRelativePath(input.sourcePath);
  const sourceAbsolutePath = path.resolve(
    resolveRootDataDir(input.options),
    ...normalizedSource.split("/"),
  );
  const sourceStats = await stat(sourceAbsolutePath);
  if (!sourceStats.isFile()) {
    throw new Error(
      `message attachment '${input.sourcePath}' is not a regular file`,
    );
  }
  const normalizedTarget = normalizeMessageAttachmentPath(
    {
      workflowId: input.communication.workflowId,
      workflowExecutionId: input.communication.workflowExecutionId,
      communicationId: input.communication.communicationId,
    },
    `files/${messageAttachmentTail(normalizedSource, input.communication)}`,
    input.options,
  );
  await mkdir(path.dirname(normalizedTarget.absolutePath), { recursive: true });
  await copyFile(sourceAbsolutePath, normalizedTarget.absolutePath);
  return {
    pathBase: "attachment-root",
    path: normalizedTarget.relativePath,
    ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    byteLength: sourceStats.size,
    sourcePath: normalizedSource,
  };
}

async function materializeAttachmentRef(input: {
  readonly attachment: Readonly<Record<string, unknown>>;
  readonly communication: CommunicationRecord;
  readonly options: LoadOptions;
}): Promise<WorkflowMessageArtifactRef | null> {
  const sourcePath = input.attachment["path"];
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    return null;
  }
  const mediaType = input.attachment["mediaType"];
  const normalizedMediaType =
    typeof mediaType === "string" ? mediaType : undefined;
  if (sourcePath.startsWith("files/")) {
    return await materializeRootDataAttachment({
      sourcePath,
      communication: input.communication,
      mediaType: normalizedMediaType,
      options: input.options,
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
  const attachmentStats = await stat(normalized.absolutePath);
  if (!attachmentStats.isFile()) {
    throw new Error(`message attachment '${sourcePath}' is not a regular file`);
  }
  return {
    pathBase: "attachment-root",
    path: normalized.relativePath,
    ...(normalizedMediaType === undefined
      ? {}
      : { mediaType: normalizedMediaType }),
    byteLength: attachmentStats.size,
  };
}

async function buildWorkflowMessagePayloadSnapshot(
  communication: CommunicationRecord,
  outputRaw: string | undefined,
  options: LoadOptions,
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
  for (const attachment of attachments) {
    if (!isJsonObject(attachment)) {
      continue;
    }
    const ref = await materializeAttachmentRef({
      attachment,
      communication,
      options,
    });
    if (ref !== null) {
      artifactRefs.push(ref);
    }
  }
  const sanitizedPayload = {
    ...parsed["payload"],
    attachments: artifactRefs,
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

export function workflowMessageRecordToCommunication(
  record: RuntimeWorkflowMessageRecord,
): CommunicationRecord {
  const payloadRef = JSON.parse(
    record.payloadRefJson,
  ) as CommunicationRecord["payloadRef"];
  const deliveryAttemptIds = JSON.parse(
    record.deliveryAttemptIdsJson,
  ) as readonly string[];
  return {
    workflowId: record.workflowId,
    workflowExecutionId: record.workflowExecutionId,
    communicationId: record.communicationId,
    fromNodeId: record.fromNodeId,
    toNodeId: record.toNodeId,
    routingScope:
      record.routingScope === "external-mailbox"
        ? "external-mailbox"
        : "intra-workflow",
    sourceNodeExecId: record.sourceNodeExecId,
    payloadRef,
    deliveryKind: record.deliveryKind,
    transitionWhen: record.transitionWhen,
    status: record.status,
    deliveryAttemptIds,
    ...(record.activeDeliveryAttemptId === null
      ? {}
      : { activeDeliveryAttemptId: record.activeDeliveryAttemptId }),
    createdAt: record.createdAt,
    ...(record.deliveredAt === null ? {} : { deliveredAt: record.deliveredAt }),
    ...(record.consumedByNodeExecId === null
      ? {}
      : { consumedByNodeExecId: record.consumedByNodeExecId }),
    ...(record.consumedAt === null ? {} : { consumedAt: record.consumedAt }),
    ...(record.failureReason === null
      ? {}
      : { failureReason: record.failureReason }),
    ...(record.supersededByCommunicationId === null
      ? {}
      : { supersededByCommunicationId: record.supersededByCommunicationId }),
    ...(record.supersededAt === null
      ? {}
      : { supersededAt: record.supersededAt }),
    ...(record.replayedFromCommunicationId === null
      ? {}
      : { replayedFromCommunicationId: record.replayedFromCommunicationId }),
    ...(record.managerMessageId === null
      ? {}
      : { managerMessageId: record.managerMessageId }),
    artifactDir: record.artifactDir,
  };
}

function toRuntimeWorkflowMessageRecordFromRow(
  row: RuntimeWorkflowMessageRow,
): RuntimeWorkflowMessageRecord {
  return {
    workflowId: row.workflow_id,
    workflowExecutionId: row.workflow_execution_id,
    communicationId: row.communication_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    routingScope: row.routing_scope,
    deliveryKind: row.delivery_kind,
    transitionWhen: row.transition_when,
    sourceNodeExecId: row.source_node_exec_id,
    status: row.status,
    activeDeliveryAttemptId: row.active_delivery_attempt_id,
    deliveryAttemptIdsJson: row.delivery_attempt_ids_json,
    payloadRefJson: row.payload_ref_json,
    payloadJson: row.payload_json,
    artifactRefsJson: row.artifact_refs_json,
    artifactDir: row.artifact_dir,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    consumedByNodeExecId: row.consumed_by_node_exec_id,
    consumedAt: row.consumed_at,
    failureReason: row.failure_reason,
    supersededByCommunicationId: row.superseded_by_communication_id,
    supersededAt: row.superseded_at,
    replayedFromCommunicationId: row.replayed_from_communication_id,
    managerMessageId: row.manager_message_id,
    updatedAt: row.updated_at,
  };
}

export async function saveWorkflowMessageToRuntimeDb(
  input: SaveWorkflowMessageInput,
  options: LoadOptions = {},
): Promise<RuntimeWorkflowMessageRecord> {
  const preservePayloadOnConflict = input.outputRaw === undefined;
  const payloadSnapshot = await buildWorkflowMessagePayloadSnapshot(
    input.communication,
    input.outputRaw,
    options,
  );
  const record = toRuntimeWorkflowMessageRecord(
    input.communication,
    payloadSnapshot,
    input.updatedAt ?? new Date().toISOString(),
  );
  await withDatabase(options, (db) => {
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
  });
  return record;
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
      WHERE workflow_execution_id = ? AND communication_id = ?
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
