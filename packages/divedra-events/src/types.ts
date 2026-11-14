import type { AutoImprovePolicy, LoadOptions } from "divedra-core";

export type JsonObject = Readonly<Record<string, unknown>>;

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

export type ChatSdkProvider =
  | "slack"
  | "teams"
  | "gchat"
  | "discord"
  | "telegram"
  | "github"
  | "linear"
  | "whatsapp"
  | "messenger"
  | "web";

export interface ChatSdkWebhookConfig extends JsonObject {
  readonly path: string;
  readonly signingSecretEnv?: string;
  readonly bearerTokenEnv?: string;
  readonly signatureHeader?: string;
  readonly timestampHeader?: string;
  readonly replayWindowMs?: number;
  readonly rateLimit?: {
    readonly windowMs: number;
    readonly maxRequests: number;
  };
}

export interface ChatSdkSendConfig extends JsonObject {
  readonly endpointUrlEnv: string;
  readonly tokenEnv?: string;
}

export interface ChatSdkSourceConfig extends EventSourceConfigBase {
  readonly kind: "chat-sdk";
  readonly provider: ChatSdkProvider;
  readonly mode?: "generic-webhook";
  readonly webhook: ChatSdkWebhookConfig;
  readonly send?: ChatSdkSendConfig;
  readonly providerConfig?: JsonObject;
}

export interface MatrixSourceRoomConfig extends JsonObject {
  readonly roomId: string;
  readonly alias?: string;
}

export interface MatrixSourceSyncConfig extends JsonObject {
  readonly pollTimeoutMs?: number;
  readonly sinceTokenPath?: string;
}

export interface MatrixSourceConfig extends EventSourceConfigBase {
  readonly kind: "matrix";
  readonly provider?: "matrix" | string;
  readonly homeserverUrlEnv: string;
  readonly accessTokenEnv: string;
  readonly userId: string;
  readonly rooms: readonly MatrixSourceRoomConfig[];
  readonly sync?: MatrixSourceSyncConfig;
  readonly ignoreOwnMessages?: boolean;
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
  | ChatSdkSourceConfig
  | MatrixSourceConfig
  | WebhookSourceConfig
  | S3RepositorySourceConfig
  | EventSourceConfigBase;

export interface EventOutputDestinationConfigBase extends JsonObject {
  readonly id: string;
  readonly kind: string;
  readonly enabled?: boolean;
  readonly provider?: string;
}

export interface ChatOutputDestinationConfig
  extends EventOutputDestinationConfigBase {
  readonly kind: "chat";
  /**
   * Source adapter used for transport delivery until chat providers have
   * independent destination adapters.
   */
  readonly sourceId: string;
  /**
   * Optional provider-side chat target override. When omitted, replies use the
   * inbound event conversation, which is appropriate for normal user replies.
   * When set, supervisors can address another chat conversation or supervisor.
   */
  readonly target?: {
    readonly provider?: string;
    readonly eventId?: string;
    readonly conversationId?: string;
    readonly threadId?: string;
    readonly actorId?: string;
  };
}

export interface S3BackupOutputDestinationConfig
  extends EventOutputDestinationConfigBase {
  readonly kind: "s3-backup";
  readonly provider: "aws-s3" | "s3-compatible";
  readonly endpointUrlEnv?: string;
  readonly region?: string;
  readonly bucket: string;
  readonly rootPrefix?: string;
}

export type EventOutputDestinationConfig =
  | ChatOutputDestinationConfig
  | S3BackupOutputDestinationConfig
  | EventOutputDestinationConfigBase;

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
      readonly template: unknown;
      readonly mirrorToHumanInput?: boolean;
    };

export type EventExecutionMode =
  | "direct"
  | "supervised"
  | "supervisor-dispatch"
  | "schedule-registration";

export type WorkflowScheduleKind = "one-time" | "recurring";

export type WorkflowScheduleStatus =
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export interface WorkflowScheduleCandidate extends JsonObject {
  readonly workflowName: string;
  readonly description?: string;
  readonly confidence?: number;
}

export type WorkflowScheduleIntent =
  | {
      readonly kind: "one-time";
      readonly timezone: string;
      readonly dueAt: string;
    }
  | {
      readonly kind: "recurring";
      readonly timezone: string;
      readonly cron: string;
      readonly nextDueAt?: string;
    };

export interface WorkflowScheduleReadyDecision extends JsonObject {
  readonly status: "ready";
  readonly workflowName: string;
  readonly confidence?: number;
  readonly candidates?: readonly WorkflowScheduleCandidate[];
  readonly schedule: WorkflowScheduleIntent;
  readonly workflowInput: JsonObject;
  readonly confirmationText: string;
}

export interface WorkflowScheduleClarificationDecision extends JsonObject {
  readonly status: "needs-clarification";
  readonly missing: readonly string[];
  readonly candidates?: readonly WorkflowScheduleCandidate[];
  readonly question: string;
}

export interface WorkflowScheduleRefusalDecision extends JsonObject {
  readonly status: "refused";
  readonly reason: string;
  readonly message?: string;
}

export type WorkflowScheduleRegistrationDecision =
  | WorkflowScheduleReadyDecision
  | WorkflowScheduleClarificationDecision
  | WorkflowScheduleRefusalDecision;

export interface WorkflowScheduleRecord extends JsonObject {
  readonly scheduleId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly sourceReceiptId: string;
  readonly workflowName: string;
  readonly workflowSource?: JsonObject;
  readonly kind: WorkflowScheduleKind;
  readonly timezone: string;
  readonly dueAt?: string;
  readonly cron?: string;
  readonly nextDueAt: string;
  readonly status: WorkflowScheduleStatus;
  readonly workflowInput: JsonObject;
  readonly conversationId?: string;
  readonly threadId?: string;
  readonly actorId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastExecutionId?: string;
  readonly lastFiredAt?: string;
  readonly lastOccurrenceId?: string;
  readonly attemptCount: number;
  readonly lastError?: string;
}

export interface EventWorkflowScheduleRegistrationPolicy extends JsonObject {
  readonly mode: "schedule-registration";
  readonly resolverWorkflowName: string;
  readonly resolverNodeId: string;
  readonly minConfidence?: number;
}

export type EventSupervisorAction =
  | "start"
  | "status"
  | "progress"
  | "inbox"
  | "read"
  | "logs"
  | "export"
  | "stop"
  | "cancel"
  | "restart"
  | "rerun"
  | "input"
  | "submit"
  | "resume";

export interface EventSupervisorIntentMappingStructuredOrCommand
  extends JsonObject {
  readonly mode: "structured-or-command";
  readonly defaultAction?: EventSupervisorAction;
}

export interface EventSupervisorIntentMappingCommandMap extends JsonObject {
  readonly mode: "command-map";
  readonly inputPath?: string;
  readonly commands: Readonly<
    Partial<Record<EventSupervisorAction, string | readonly string[]>>
  >;
  readonly defaultAction?: EventSupervisorAction;
  readonly resolverWorkflowName?: string;
  readonly resolverNodeId?: string;
  readonly minConfidence?: number;
  readonly fallbackAction?: "proposal" | "ignore";
  readonly allowMultiTargetCommands?: boolean;
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
  /**
   * Required when `mode` is `supervisor-dispatch`. References a file under
   * `<eventRoot>/supervisors/*.json`.
   */
  readonly supervisorProfileId?: string;
  readonly supervisorWorkflowName?: string;
  readonly resolverWorkflowName?: string;
  readonly resolverNodeId?: string;
  readonly inputPath?: string;
  readonly minConfidence?: number;
  readonly timezonePath?: string;
  readonly maxRestartsOnFailure?: number;
  readonly autoImprove?: boolean | AutoImprovePolicy;
  readonly control?: EventSupervisorControlPolicy;
  readonly async?: boolean;
  readonly dedupeWindowMs?: number;
  readonly maxConcurrentPerKey?: number;
  readonly concurrencyKey?: string;
  readonly allowUnsafeSyncWebhook?: boolean;
}

export interface EventMailboxBridgeOutboundPolicy extends JsonObject {
  readonly reply?: { readonly mode: "none" | "final" };
  readonly progress?: { readonly mode: "none" | "status-only" };
  readonly control?: { readonly mode: "none" | "status-only" };
}

export interface EventMailboxBridgePolicy extends JsonObject {
  readonly input?: {
    readonly consumer: "direct-workflow" | "supervisor";
  };
  readonly output?: EventMailboxBridgeOutboundPolicy;
}

export interface EventTaskPlanningRequiredInput extends JsonObject {
  readonly path: string;
  readonly label?: string;
  readonly question?: string;
}

export interface EventTaskPlanningPolicy extends JsonObject {
  readonly enabled?: boolean;
  readonly requiredInput?: readonly EventTaskPlanningRequiredInput[];
  readonly planTemplate?: string;
  readonly clarificationTemplate?: string;
}

export interface ExternalMailboxAddress extends JsonObject {
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
  readonly supervisedRunId?: string;
  readonly correlationKey?: string;
  readonly conversationId?: string;
  readonly threadId?: string;
  /** Provider event id when known (routing hint, not workflow identity). */
  readonly eventId?: string;
  /** Transport hint for resolving {@link ExternalOutputDispatchTarget}. */
  readonly providerHint?: string;
  readonly actorId?: string;
}

export type ExternalOutputKind =
  | "business-final"
  | "progress"
  | "control-status";

export interface ExternalOutputMessage extends JsonObject {
  readonly kind: "external-output";
  readonly outputKind: ExternalOutputKind;
  readonly address: ExternalMailboxAddress;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface EventBinding extends JsonObject {
  readonly id: string;
  readonly enabled?: boolean;
  readonly sourceId: string;
  readonly outputDestinations?: readonly string[];
  readonly match?: EventMatchRule;
  /**
   * Target workflow for `direct` / `supervised` bindings. Optional for
   * `supervisor-dispatch` (targets come from the supervisor profile).
   */
  readonly workflowName?: string;
  readonly inputMapping: EventInputMapping;
  readonly execution?: EventWorkflowExecutionPolicy;
  readonly taskPlanning?: EventTaskPlanningPolicy;
  /**
   * Optional explicit bridge policy for external mailbox input/output streams.
   * When omitted, {@link resolveEventMailboxBridgePolicy} derives defaults from
   * `execution.mode` and existing binding shape.
   */
  readonly mailboxBridge?: EventMailboxBridgePolicy;
}

export interface EventConfiguration {
  readonly eventRoot: string;
  readonly sources: readonly EventSourceConfig[];
  readonly destinations: readonly EventOutputDestinationConfig[];
  readonly bindings: readonly EventBinding[];
}

export interface NodeMemoryScope extends JsonObject {
  readonly workflowName: string;
  readonly nodeId: string;
  readonly conversationId?: string;
  readonly actorId?: string;
}

export interface NodeMemoryRecord extends JsonObject {
  readonly id: string;
  readonly scope: NodeMemoryScope;
  readonly content: string;
  readonly createdAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NodeMemoryWrite extends JsonObject {
  readonly scope: NodeMemoryScope;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NodeLongTermMemoryStore {
  read(scope: NodeMemoryScope): Promise<readonly NodeMemoryRecord[]>;
  write(record: NodeMemoryWrite): Promise<NodeMemoryRecord>;
}

export interface WorkflowNodeEventAttachment extends JsonObject {
  readonly eventSourceIds?: readonly string[];
  readonly outputDestinationIds?: readonly string[];
  readonly memory?: {
    readonly enabled?: boolean;
    readonly provider?: string;
    readonly scopeTemplate?: string;
  };
  readonly persona?: {
    readonly systemPrompt?: string;
    readonly systemPromptFile?: string;
  };
}

export interface EventConfigLoadOptions extends LoadOptions {
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
  readonly args?: readonly string[];
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
  readonly supervisorConversationId?: string;
  readonly supervisorDecisionId?: string;
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
