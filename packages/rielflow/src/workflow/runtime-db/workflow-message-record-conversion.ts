import type { CommunicationRecord } from "../session";
import type { RuntimeWorkflowMessageRecord } from "./schema-and-record-types";

export interface RuntimeWorkflowMessageRow {
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

export function toRuntimeWorkflowMessageRecordFromRow(
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
