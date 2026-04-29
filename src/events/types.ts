import type { AutoImprovePolicy } from "../workflow/types";
import type { DivedraOptions } from "../lib";
import type { JsonObject } from "../shared/json";

export interface EventArtifactRef {
  readonly root: "artifact";
  readonly path: string;
}

export interface EventActor {
  readonly id: string;
  readonly displayName?: string;
}

export interface EventConversation {
  readonly id: string;
  readonly threadId?: string;
}

export interface ExternalEventEnvelope {
  readonly sourceId: string;
  readonly eventId: string;
  readonly provider: string;
  readonly eventType: string;
  readonly occurredAt?: string;
  readonly receivedAt: string;
  readonly dedupeKey: string;
  readonly actor?: EventActor;
  readonly conversation?: EventConversation;
  readonly input: JsonObject;
  readonly rawRef?: EventArtifactRef;
}

export interface EventSourceConfigBase extends JsonObject {
  readonly id: string;
  readonly kind: string;
  readonly enabled?: boolean;
  readonly provider?: string;
}

export interface CronSourceConfig extends EventSourceConfigBase {
  readonly kind: "cron";
  readonly schedule: string;
  readonly timezone: string;
  readonly jitterMs?: number;
  readonly missedRunPolicy?: "skip" | "fire-once";
  readonly lockKey?: string;
}

export interface WebhookSourceConfig extends EventSourceConfigBase {
  readonly kind: "webhook";
  readonly path: string;
  readonly signingSecretEnv?: string;
  readonly signatureHeader?: string;
  readonly timestampHeader?: string;
  readonly replayWindowMs?: number;
  readonly replyEndpointEnv?: string;
}

export interface S3RepositoryEventReceiverConfig extends JsonObject {
  readonly mode: string;
  readonly path?: string;
  readonly signingSecretEnv?: string;
}

export interface S3RepositorySourceConfig extends EventSourceConfigBase {
  readonly kind: "s3-repository";
  readonly provider: "aws-s3" | "s3-compatible";
  readonly endpointUrlEnv?: string;
  readonly region?: string;
  readonly bucket: string;
  readonly rootPrefix?: string;
  readonly eventReceiver: S3RepositoryEventReceiverConfig;
  readonly objectAccess: { readonly mode: "metadata-only" };
  readonly filters?: { readonly suffixes?: readonly string[] };
}

export type EventSourceConfig =
  | CronSourceConfig
  | WebhookSourceConfig
  | S3RepositorySourceConfig
  | EventSourceConfigBase;

export interface EventMatchRule extends JsonObject {
  readonly eventType?: string;
  readonly conversationId?: string;
  readonly pathPrefix?: string;
}

export type EventInputMapping =
  | {
      readonly mode: "event-input";
      readonly mirrorToHumanInput?: boolean;
    }
  | {
      readonly mode: "template";
      readonly template: JsonObject;
      readonly mirrorToHumanInput?: boolean;
    };

export type EventExecutionMode = "direct" | "supervised";

export type EventSupervisorAction =
  | "start"
  | "stop"
  | "restart"
  | "status"
  | "input";

export interface EventSupervisorIntentMappingStructuredOrCommand
  extends JsonObject {
  readonly mode: "structured-or-command";
  readonly defaultAction?: EventSupervisorAction;
}

export interface EventSupervisorIntentMappingCommandMap extends JsonObject {
  readonly mode: "command-map";
  readonly inputPath?: string;
  readonly commands: Readonly<Partial<Record<EventSupervisorAction, string>>>;
  readonly defaultAction?: EventSupervisorAction;
}

export interface EventSupervisorIntentMappingStructuredOnly extends JsonObject {
  readonly mode: "structured-only";
}

export interface EventSupervisorIntentMappingLlm extends JsonObject {
  readonly mode: "llm-command";
  readonly inputPath?: string;
  readonly resolverWorkflowName: string;
  readonly resolverNodeId: string;
  readonly minConfidence?: number;
  readonly defaultAction?: "input" | "ignore";
  readonly allowMultiTargetCommands?: boolean;
}

export type EventSupervisorIntentMapping =
  | EventSupervisorIntentMappingStructuredOrCommand
  | EventSupervisorIntentMappingCommandMap
  | EventSupervisorIntentMappingStructuredOnly
  | EventSupervisorIntentMappingLlm;

export interface EventSupervisorControlPolicy extends JsonObject {
  readonly correlationKey?: string;
  readonly allowActions?: readonly EventSupervisorAction[];
  readonly intentMapping?: EventSupervisorIntentMapping;
  readonly startOnFirstInput?: boolean;
}

export interface EventWorkflowExecutionPolicy extends JsonObject {
  readonly mode?: EventExecutionMode;
  readonly supervisorWorkflowName?: string;
  readonly maxRestartsOnFailure?: number;
  readonly autoImprove?: boolean | AutoImprovePolicy;
  readonly control?: EventSupervisorControlPolicy;
  readonly async?: boolean;
  readonly dedupeWindowMs?: number;
  readonly maxConcurrentPerKey?: number;
  readonly concurrencyKey?: string;
  readonly allowUnsafeSyncWebhook?: boolean;
}

export interface EventBinding extends JsonObject {
  readonly id: string;
  readonly enabled?: boolean;
  readonly sourceId: string;
  readonly match?: EventMatchRule;
  readonly workflowName: string;
  readonly inputMapping: EventInputMapping;
  readonly execution?: EventWorkflowExecutionPolicy;
}

export interface EventConfiguration {
  readonly eventRoot: string;
  readonly sources: readonly EventSourceConfig[];
  readonly bindings: readonly EventBinding[];
}

export interface EventConfigLoadOptions extends DivedraOptions {
  readonly eventRoot?: string;
}

export type EventReceiptStatus =
  | "received"
  | "duplicate"
  | "skipped"
  | "mapped"
  | "accepted"
  | "dispatching"
  | "dispatched"
  | "failed";

export type EventSupervisedRunStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "restarting"
  | "completed"
  | "failed";

export interface EventSupervisedRunRecord {
  readonly supervisedRunId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly supervisorWorkflowName: string;
  readonly supervisorExecutionId?: string;
  readonly targetWorkflowName: string;
  readonly activeTargetExecutionId?: string;
  readonly status: EventSupervisedRunStatus;
  readonly restartCount: number;
  readonly maxRestartsOnFailure: number;
  readonly autoImproveEnabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EventSupervisorCommand {
  readonly commandId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly action: EventSupervisorAction;
  readonly targetWorkflowName: string;
  /**
   * When set, dispatch targets this supervised-run row instead of inferring
   * from correlation alone (must match sourceId, bindingId, correlationKey).
   */
  readonly supervisedRunId?: string;
  readonly targetWorkflowExecutionId?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly receivedEventReceiptId: string;
}

export interface EventReceiptRecord {
  readonly receiptId: string;
  readonly sourceId: string;
  readonly bindingId?: string;
  readonly dedupeKey: string;
  readonly status: EventReceiptStatus;
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
  readonly supervisedRunId?: string;
  readonly supervisorExecutionId?: string;
  readonly rawRef?: EventArtifactRef;
  readonly normalizedRef?: EventArtifactRef;
  readonly inputRef?: EventArtifactRef;
  readonly dispatchRef?: EventArtifactRef;
  readonly errorRef?: EventArtifactRef;
  readonly error?: string;
  readonly receivedAt: string;
  readonly updatedAt: string;
}

export interface EventConfigValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

export interface EventConfigValidationResult {
  readonly valid: boolean;
  readonly issues: readonly EventConfigValidationIssue[];
}
