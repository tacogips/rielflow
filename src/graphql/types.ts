import type { MockNodeScenario } from "../workflow/scenario-adapter";
import type { AutoImprovePolicyInput } from "../workflow/auto-improve-policy";
import type { CreateWorkflowTemplateMode } from "../workflow/create";
import type { WorkflowExecutionSummary } from "../shared/ui-contract";
import type {
  SaveWorkflowResponse,
  ValidationResponse,
  WorkflowListResponse,
  WorkflowResponse,
} from "../shared/ui-contract";
import type {
  CommunicationGraphqlView,
  CommunicationLookupInput,
  ReplayCommunicationResult,
  RetryCommunicationDeliveryResult,
} from "../workflow/communication-service";
import type {
  FanoutGroupSummary,
  WorkflowInspectionSummary,
} from "../workflow/inspect";
import type { ManagerControlAction } from "../workflow/manager-control";
import type {
  DataDirFileRef,
  ManagerMessageService,
  SendManagerMessageResult,
} from "../workflow/manager-message-service";
import type {
  AmbientManagerExecutionContext,
  ManagerMessageRecord,
  ManagerSessionRecord,
  ManagerSessionStore,
} from "../workflow/manager-session-store";
import type {
  RuntimeEventReplyDispatchRecord,
  RuntimeLlmSessionMessageRecord,
  RuntimeNodeExecutionSummary,
  RuntimeHookEventRecord,
  RuntimeNodeLogEntry,
} from "../workflow/runtime-db";
import type { SessionStoreOptions } from "../workflow/session-store";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../workflow/session";
import type {
  ChatReplyDispatcher,
  LoadOptions,
  ResolvedWorkflowSource,
  ValidationIssue,
  WorkflowScopeSelector,
} from "../workflow/types";
import type { CommunicationService } from "../workflow/communication-service";
import type { EventSupervisedRunRecord } from "../events/types";
import type {
  ManagedWorkflowRunRecord,
  SupervisorDispatchDecisionRecord,
  WorkflowSupervisorConversationRecord,
} from "../events/supervisor-conversations";
import type {
  DispatchProposalValidationIssue,
  SupervisorDispatchProposal,
} from "../events/supervisor-dispatch-contract";
import type {
  WorkflowCatalogOverview,
  WorkflowStatusOverview,
  WorkflowOverviewStatus,
} from "../workflow/overview";

export interface GraphqlRequestContext
  extends LoadOptions,
    SessionStoreOptions {
  readonly authToken?: string;
  readonly managerSessionId?: string;
  readonly readOnly?: boolean;
  readonly fixedWorkflowName?: string;
  readonly fixedResolvedWorkflowSource?: ResolvedWorkflowSource;
  readonly noExec?: boolean;
  readonly eventRoot?: string;
  readonly eventReplyDispatcher?: ChatReplyDispatcher;
}

export interface WorkflowLookupInput {
  readonly workflowName: string;
}

export interface WorkflowDefinitionLookupInput {
  readonly workflowName: string;
}

export type LlmSessionMessageOrder = "ASC" | "DESC";

export interface LlmSessionMessagesSelectionInput {
  readonly order?: LlmSessionMessageOrder | null;
  readonly limit?: number | null;
}

export interface WorkflowExecutionLookupInput {
  readonly workflowExecutionId: string;
  readonly llmMessages?: LlmSessionMessagesSelectionInput;
}

export interface WorkflowExecutionOverviewLookupInput {
  readonly workflowExecutionId: string;
  readonly recentLogLimit?: number;
  readonly firstCommunications?: number;
  readonly afterCommunicationId?: string;
  readonly llmMessages?: LlmSessionMessagesSelectionInput;
}

export type WorkflowDefinitionsView = WorkflowListResponse["workflows"];

export interface WorkflowExecutionsQueryInput {
  readonly workflowName?: string;
  readonly status?: WorkflowSessionState["status"];
  readonly first?: number;
  readonly afterWorkflowExecutionId?: string;
}

export interface WorkflowCatalogOverviewGraphqlInput {
  readonly workflowScope?: WorkflowScopeSelector;
  readonly status?: WorkflowOverviewStatus;
  readonly limit?: number;
}

export interface WorkflowStatusOverviewGraphqlInput {
  readonly workflowName: string;
  readonly workflowScope?: WorkflowScopeSelector;
  readonly limit?: number;
}

export interface NodeExecutionLookupInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly recentLogLimit?: number;
  readonly llmMessages?: LlmSessionMessagesSelectionInput;
}

export interface ManagerSessionLookupInput {
  readonly managerSessionId?: string;
}

export interface CommunicationsQueryInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly fromNodeId?: string;
  readonly toNodeId?: string;
  readonly status?: WorkflowSessionState["communications"][number]["status"];
  readonly first?: number;
  readonly afterCommunicationId?: string;
}

export interface WorkflowView extends WorkflowInspectionSummary {}

export interface WorkflowDefinitionView extends WorkflowResponse {}

export interface WorkflowSessionView extends WorkflowSessionState {
  readonly currentStepId: string | null;
  readonly fanoutSummaries: readonly FanoutGroupSummary[];
}

export interface WorkflowExecutionView {
  readonly workflowExecutionId: string;
  readonly session: WorkflowSessionView;
  readonly nodeExecutions: readonly RuntimeNodeExecutionSummary[];
  readonly nodeLogs: readonly RuntimeNodeLogEntry[];
  readonly llmMessages: readonly RuntimeLlmSessionMessageRecord[];
  readonly hookEvents: readonly RuntimeHookEventRecord[];
  readonly replyDispatches: readonly RuntimeEventReplyDispatchRecord[];
}

export interface WorkflowExecutionOverviewView {
  readonly workflowExecutionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly status: WorkflowSessionState["status"];
  readonly session: WorkflowSessionView;
  readonly nodes: readonly NodeExecutionView[];
  readonly communications: CommunicationConnection;
  readonly nodeLogs: readonly RuntimeNodeLogEntry[];
  readonly llmMessages: readonly RuntimeLlmSessionMessageRecord[];
  readonly hookEvents: readonly RuntimeHookEventRecord[];
  readonly replyDispatches: readonly RuntimeEventReplyDispatchRecord[];
}

export interface WorkflowExecutionConnection {
  readonly items: readonly WorkflowExecutionSummary[];
  readonly totalCount: number;
  readonly nextCursor?: string;
}

export interface NodeExecutionView {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly stepId?: string;
  readonly nodeRegistryId?: string;
  readonly nodeExecId: string;
  readonly mailboxInstanceId?: string;
  readonly status: NodeExecutionRecord["status"];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly attempt?: number;
  readonly outputAttemptCount?: number;
  readonly outputValidationErrors?: readonly {
    readonly path: string;
    readonly message: string;
  }[];
  readonly promptVariant?: string;
  readonly timeoutMs?: number;
  readonly backendSessionId?: string;
  readonly backendSessionMode?: "new" | "reuse";
  readonly restartedFromNodeExecId?: string;
  readonly artifactDir: string;
  readonly output: string | null;
  readonly meta: string | null;
  readonly terminalMessage: string | null;
  readonly recentLogs: readonly RuntimeNodeLogEntry[];
  readonly llmMessages: readonly RuntimeLlmSessionMessageRecord[];
}

export interface CommunicationConnection {
  readonly items: readonly CommunicationGraphqlView[];
  readonly totalCount: number;
  readonly nextCursor?: string;
}

export interface ManagerSessionView {
  readonly session: ManagerSessionRecord;
  readonly messages: readonly ManagerMessageRecord[];
}

export interface ExecuteWorkflowInput {
  readonly workflowName: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly autoImprove?: AutoImprovePolicyInput;
  readonly nestedSuperviser?: boolean;
  readonly workingDirectory?: string;
  readonly mockScenario?: MockNodeScenario;
  readonly async?: boolean;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxConcurrency?: number;
}

export type GraphqlWorkflowTemplateMode =
  | CreateWorkflowTemplateMode
  | "MANAGED"
  | "WORKER_ONLY";

export interface CreateWorkflowDefinitionInput {
  readonly workflowName: string;
  readonly templateMode?: GraphqlWorkflowTemplateMode;
}

export interface SaveWorkflowDefinitionInput {
  readonly workflowName: string;
  readonly bundle: GraphqlWorkflowBundleInput;
  readonly expectedRevision?: string;
}

export interface SaveWorkflowDefinitionPayload
  extends Partial<SaveWorkflowResponse> {
  readonly workflowName: string;
  readonly error?: string;
  readonly currentRevision?: string | null;
  readonly issues?: readonly ValidationIssue[];
}

export interface ValidateWorkflowDefinitionInput {
  readonly workflowName: string;
  readonly bundle?: GraphqlWorkflowBundleInput;
}

export interface GraphqlWorkflowBundleInput {
  readonly workflow: unknown;
  readonly nodePayloads: unknown;
}

export interface ValidateWorkflowDefinitionPayload extends ValidationResponse {}

export interface ExecuteWorkflowPayload {
  readonly workflowExecutionId: string;
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
  readonly accepted?: boolean;
  readonly exitCode?: number;
}

export interface ResumeWorkflowExecutionInput {
  readonly workflowExecutionId: string;
  readonly autoImprove?: AutoImprovePolicyInput;
  readonly nestedSuperviser?: boolean;
  readonly workingDirectory?: string;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxConcurrency?: number;
}

export interface ResumeWorkflowExecutionPayload {
  readonly workflowExecutionId: string;
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
  readonly exitCode: number;
}

export interface RerunWorkflowExecutionInput {
  readonly workflowExecutionId: string;
  readonly stepId: string;
  readonly autoImprove?: AutoImprovePolicyInput;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly workingDirectory?: string;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxConcurrency?: number;
}

export interface RerunWorkflowExecutionPayload {
  readonly workflowExecutionId: string;
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
  readonly rerunFromStepId?: string;
  readonly exitCode: number;
}

export interface ContinueWorkflowExecutionInput {
  readonly sourceWorkflowExecutionId: string;
  readonly startStepId: string;
  readonly afterStepRunId: string;
  readonly autoImprove?: AutoImprovePolicyInput;
  readonly nestedSuperviser?: boolean;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly workingDirectory?: string;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxConcurrency?: number;
  readonly mockScenario?: MockNodeScenario;
}

export interface ContinueWorkflowExecutionPayload {
  readonly workflowExecutionId: string;
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
  readonly exitCode: number;
  readonly continuedAfterStepRunId: string;
  readonly continuedStartStepId: string;
}

export interface WorkflowExecutionStepRunsQueryInput {
  readonly workflowExecutionId: string;
  readonly stepId?: string;
  readonly status?: string;
}

export interface WorkflowExecutionStepRunView {
  readonly workflowExecutionId: string;
  readonly timelineOrdinal: number;
  readonly executionOrdinal: number;
  readonly stepRunId: string;
  readonly stepId?: string;
  readonly nodeRegistryId?: string;
  readonly status: string;
  readonly imported: boolean;
  readonly sourceWorkflowExecutionId: string;
  readonly startedAt: string;
  readonly endedAt: string;
}

export interface WorkflowExecutionStepRunsPayload {
  readonly workflowExecutionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly stepRuns: readonly WorkflowExecutionStepRunView[];
}

export interface CancelWorkflowExecutionInput {
  readonly workflowExecutionId: string;
}

export interface CancelWorkflowExecutionPayload {
  readonly accepted: boolean;
  readonly workflowExecutionId: string;
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
}

export interface EventSupervisorCommandInput {
  readonly commandId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly action: string;
  readonly args?: readonly string[];
  readonly targetWorkflowName: string;
  readonly supervisedRunId?: string;
  readonly targetWorkflowExecutionId?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly receivedEventReceiptId: string;
}

export interface DispatchSupervisedWorkflowCommandInput {
  readonly command: EventSupervisorCommandInput;
  readonly binding: unknown;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxConcurrency?: number;
}

export interface SupervisedWorkflowGraphqlPayload {
  readonly supervisedRun: EventSupervisedRunRecord;
  readonly activeTargetStatus?: WorkflowSessionState["status"];
  readonly commandResult?: Readonly<Record<string, unknown>>;
}

export interface SupervisedWorkflowLookupGraphqlInput {
  readonly supervisedRunId?: string;
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly correlationKey?: string;
}

export interface DispatchSupervisorChatGraphqlInput {
  readonly sourceId: string;
  readonly text: string;
  readonly conversationId?: string;
  readonly threadId?: string;
  readonly eventId?: string;
  readonly eventType?: string;
  readonly provider?: string;
  readonly idempotencyKey?: string;
}

export interface DispatchSupervisorChatResultView {
  readonly receiptId: string;
  readonly status: string;
  readonly duplicate: boolean;
  readonly bindingId?: string;
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
  readonly supervisedRunId?: string;
  readonly supervisorExecutionId?: string;
  readonly error?: string;
}

export interface DispatchSupervisorChatPayload {
  readonly results: readonly DispatchSupervisorChatResultView[];
}

export interface DispatchSupervisorConversationGraphqlInput {
  readonly binding: unknown;
  readonly event: unknown;
  readonly supervisorProfileId: string;
  readonly correlationKey: string;
  readonly sourceMessageId: string;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxConcurrency?: number;
}

export interface DispatchSupervisorConversationPayload {
  readonly conversation: WorkflowSupervisorConversationRecord;
  readonly managedRuns: readonly ManagedWorkflowRunRecord[];
  readonly decision: SupervisorDispatchDecisionRecord;
  readonly proposal: SupervisorDispatchProposal;
  readonly applied: boolean;
  readonly validationIssues?: readonly DispatchProposalValidationIssue[];
}

export interface SupervisorDispatchConversationLookupGraphqlInput {
  readonly supervisorConversationId: string;
}

export interface SupervisorDispatchConversationGraphqlPayload {
  readonly conversation: WorkflowSupervisorConversationRecord;
  readonly managedRuns: readonly ManagedWorkflowRunRecord[];
}

export interface SendManagerMessageInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly message?: string;
  readonly actions?: readonly ManagerControlAction[];
  readonly attachments?: readonly DataDirFileRef[];
  readonly idempotencyKey?: string;
  readonly managerSessionId?: string;
  readonly managerNodeExecId?: string;
}

export interface SendManagerMessagePayload extends SendManagerMessageResult {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerSessionId: string;
}

export interface ReplayCommunicationInput extends CommunicationLookupInput {
  readonly reason?: string;
  readonly idempotencyKey?: string;
  readonly managerSessionId?: string;
}

export interface ReplayCommunicationPayload extends ReplayCommunicationResult {}

export interface RetryCommunicationDeliveryInput
  extends CommunicationLookupInput {
  readonly reason?: string;
  readonly idempotencyKey?: string;
  readonly managerSessionId?: string;
}

export interface RetryCommunicationDeliveryPayload
  extends RetryCommunicationDeliveryResult {}

export interface GraphqlManagerScope {
  readonly context: AmbientManagerExecutionContext | null;
  readonly session: ManagerSessionRecord;
}

export interface GraphqlSchemaDependencies {
  readonly now?: () => string;
  readonly communicationService?: CommunicationService;
  readonly managerMessageService?: ManagerMessageService;
  readonly managerSessionStore?: ManagerSessionStore;
}

export interface GraphqlQueryRoot {
  workflows(
    input: Record<string, never>,
    context?: GraphqlRequestContext,
  ): Promise<WorkflowDefinitionsView>;
  workflow(
    input: WorkflowLookupInput,
    context?: GraphqlRequestContext,
  ): Promise<WorkflowView | null>;
  workflowDefinition(
    input: WorkflowDefinitionLookupInput,
    context?: GraphqlRequestContext,
  ): Promise<WorkflowDefinitionView | null>;
  workflowExecution(
    input: WorkflowExecutionLookupInput,
    context?: GraphqlRequestContext,
  ): Promise<WorkflowExecutionView | null>;
  workflowExecutionOverview(
    input: WorkflowExecutionOverviewLookupInput,
    context?: GraphqlRequestContext,
  ): Promise<WorkflowExecutionOverviewView | null>;
  workflowExecutionStepRuns(
    input: WorkflowExecutionStepRunsQueryInput,
    context?: GraphqlRequestContext,
  ): Promise<WorkflowExecutionStepRunsPayload>;
  workflowExecutions(
    input: WorkflowExecutionsQueryInput,
    context?: GraphqlRequestContext,
  ): Promise<WorkflowExecutionConnection>;
  workflowCatalogOverview(
    input: WorkflowCatalogOverviewGraphqlInput,
    context?: GraphqlRequestContext,
  ): Promise<WorkflowCatalogOverview>;
  workflowStatusOverview(
    input: WorkflowStatusOverviewGraphqlInput,
    context?: GraphqlRequestContext,
  ): Promise<WorkflowStatusOverview | null>;
  communications(
    input: CommunicationsQueryInput,
    context?: GraphqlRequestContext,
  ): Promise<CommunicationConnection>;
  communication(
    input: CommunicationLookupInput,
    context?: GraphqlRequestContext,
  ): Promise<CommunicationGraphqlView | null>;
  nodeExecution(
    input: NodeExecutionLookupInput,
    context?: GraphqlRequestContext,
  ): Promise<NodeExecutionView | null>;
  managerSession(
    input: ManagerSessionLookupInput,
    context?: GraphqlRequestContext,
  ): Promise<ManagerSessionView | null>;
  supervisedWorkflowRun(
    input: SupervisedWorkflowLookupGraphqlInput,
    context?: GraphqlRequestContext,
  ): Promise<SupervisedWorkflowGraphqlPayload>;
  supervisorDispatchConversation(
    input: SupervisorDispatchConversationLookupGraphqlInput,
    context?: GraphqlRequestContext,
  ): Promise<SupervisorDispatchConversationGraphqlPayload>;
}

export interface GraphqlMutationRoot {
  createWorkflowDefinition(
    input: CreateWorkflowDefinitionInput,
    context?: GraphqlRequestContext,
  ): Promise<WorkflowDefinitionView>;
  saveWorkflowDefinition(
    input: SaveWorkflowDefinitionInput,
    context?: GraphqlRequestContext,
  ): Promise<SaveWorkflowDefinitionPayload>;
  validateWorkflowDefinition(
    input: ValidateWorkflowDefinitionInput,
    context?: GraphqlRequestContext,
  ): Promise<ValidateWorkflowDefinitionPayload>;
  executeWorkflow(
    input: ExecuteWorkflowInput,
    context?: GraphqlRequestContext,
  ): Promise<ExecuteWorkflowPayload>;
  resumeWorkflowExecution(
    input: ResumeWorkflowExecutionInput,
    context?: GraphqlRequestContext,
  ): Promise<ResumeWorkflowExecutionPayload>;
  rerunWorkflowExecution(
    input: RerunWorkflowExecutionInput,
    context?: GraphqlRequestContext,
  ): Promise<RerunWorkflowExecutionPayload>;
  continueWorkflowExecution(
    input: ContinueWorkflowExecutionInput,
    context?: GraphqlRequestContext,
  ): Promise<ContinueWorkflowExecutionPayload>;
  sendManagerMessage(
    input: SendManagerMessageInput,
    context?: GraphqlRequestContext,
  ): Promise<SendManagerMessagePayload>;
  retryCommunicationDelivery(
    input: RetryCommunicationDeliveryInput,
    context?: GraphqlRequestContext,
  ): Promise<RetryCommunicationDeliveryPayload>;
  replayCommunication(
    input: ReplayCommunicationInput,
    context?: GraphqlRequestContext,
  ): Promise<ReplayCommunicationPayload>;
  cancelWorkflowExecution(
    input: CancelWorkflowExecutionInput,
    context?: GraphqlRequestContext,
  ): Promise<CancelWorkflowExecutionPayload>;
  dispatchSupervisedWorkflowCommand(
    input: DispatchSupervisedWorkflowCommandInput,
    context?: GraphqlRequestContext,
  ): Promise<SupervisedWorkflowGraphqlPayload>;
  dispatchSupervisorChat(
    input: DispatchSupervisorChatGraphqlInput,
    context?: GraphqlRequestContext,
  ): Promise<DispatchSupervisorChatPayload>;
  dispatchSupervisorConversation(
    input: DispatchSupervisorConversationGraphqlInput,
    context?: GraphqlRequestContext,
  ): Promise<DispatchSupervisorConversationPayload>;
}

export interface GraphqlSchema {
  readonly query: GraphqlQueryRoot;
  readonly mutation: GraphqlMutationRoot;
}

export interface GraphqlExecutionOverrides extends LoadOptions {
  readonly mockScenario?: MockNodeScenario;
}
