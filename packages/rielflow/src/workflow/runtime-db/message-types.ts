export type WorkflowMessageDeliveryKind =
  | "edge-transition"
  | "loop-back"
  | "manual-rerun"
  | "conversation-turn"
  | "external-input"
  | "external-output";

export type WorkflowMessageStatus =
  | "created"
  | "delivered"
  | "consumed"
  | "delivery_failed"
  | "superseded";

export type WorkflowMessageArtifactPathBase = "attachment-root";

export interface WorkflowMessageArtifactRef {
  readonly pathBase: WorkflowMessageArtifactPathBase;
  readonly path: string;
  readonly mediaType?: string;
  readonly byteLength?: number;
  readonly sourcePath?: string;
}

export interface RuntimeWorkflowMessageRecord {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly routingScope: string;
  readonly deliveryKind: WorkflowMessageDeliveryKind;
  readonly transitionWhen: string;
  readonly sourceNodeExecId: string;
  readonly status: WorkflowMessageStatus;
  readonly activeDeliveryAttemptId: string | null;
  readonly deliveryAttemptIdsJson: string;
  readonly payloadRefJson: string;
  readonly payloadJson: string | null;
  readonly artifactRefsJson: string | null;
  readonly artifactDir: string;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly consumedByNodeExecId: string | null;
  readonly consumedAt: string | null;
  readonly failureReason: string | null;
  readonly supersededByCommunicationId: string | null;
  readonly supersededAt: string | null;
  readonly replayedFromCommunicationId: string | null;
  readonly managerMessageId: string | null;
  readonly updatedAt: string;
}

export type RuntimeEventReplyDispatchStatus =
  | "dispatching"
  | "sent"
  | "queued"
  | "failed"
  | "no_delivery_target";
