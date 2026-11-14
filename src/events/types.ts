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

export interface EventWorkflowExecutionPolicy extends JsonObject {
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

export interface EventReceiptRecord {
  readonly receiptId: string;
  readonly sourceId: string;
  readonly bindingId?: string;
  readonly dedupeKey: string;
  readonly status: EventReceiptStatus;
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
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
