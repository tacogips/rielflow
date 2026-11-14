import { Kind, GraphQLScalarType } from "graphql";
import type { ValueNode } from "graphql";
import { createSchema } from "graphql-yoga";
import {
  createGraphqlSchema,
  selectGraphqlLlmSessionMessages,
} from "../graphql/schema";
import type {
  CommunicationsQueryInput,
  ContinueWorkflowExecutionInput,
  CreateWorkflowDefinitionInput,
  DispatchSupervisedWorkflowCommandInput,
  DispatchSupervisorChatGraphqlInput,
  DispatchSupervisorConversationGraphqlInput,
  ExecuteWorkflowInput,
  GraphqlRequestContext,
  GraphqlSchemaDependencies,
  LlmSessionMessagesSelectionInput,
  LlmSessionMessageOrder,
  ReplayCommunicationInput,
  RerunWorkflowExecutionInput,
  ResumeWorkflowExecutionInput,
  RetryCommunicationDeliveryInput,
  SaveWorkflowDefinitionInput,
  SendManagerMessageInput,
  SupervisedWorkflowLookupGraphqlInput,
  SupervisorDispatchConversationLookupGraphqlInput,
  ValidateWorkflowDefinitionInput,
  WorkflowCatalogOverviewGraphqlInput,
  WorkflowExecutionsQueryInput,
  WorkflowStatusOverviewGraphqlInput,
} from "../graphql/types";
import type { RuntimeLlmSessionMessageRecord } from "../workflow/runtime-db";
import type { WorkflowOverviewStatus } from "../workflow/overview";
import type { WorkflowScopeSelector } from "../workflow/types";
const FULL_LLM_SESSION_MESSAGES_SELECTION: LlmSessionMessagesSelectionInput = {
  limit: Number.MAX_SAFE_INTEGER,
};
interface GraphqlLlmSessionMessagesFieldArgs {
  readonly order?: LlmSessionMessageOrder | null;
  readonly limit?: number | null;
}
interface GraphqlLlmSessionMessagesParent {
  readonly llmMessages: readonly RuntimeLlmSessionMessageRecord[];
}
const GRAPHQL_SCHEMA_TEXT = ` scalar JSON enum LlmSessionMessageOrder {
ASC DESC }
type WorkflowDefaults { maxLoopIterations: Int! nodeTimeoutMs: Int!
} type WorkflowCounts { steps: Int!
nodeRegistry: Int! crossWorkflowDispatches: Int! }
type WorkflowAddonSource { nodeId: String! name: String!
version: String! scope: String! addonRoot: String!
addonDirectory: String! manifestPath: String! scopeRoot: String
} type WorkflowRuntimeRequirement { id: String!
kind: String! label: String! status: String!
detail: String! sourceStepIds: [String!]! }
type WorkflowRuntimeReadiness { ready: Boolean! checkedAt: String!
requirements: [WorkflowRuntimeRequirement!]! blockers: [String!]! }
type WorkflowView { workflowName: String! workflowId: String!
description: String! hasManagerNode: Boolean! managerStepId: String
entryStepId: String stepIds: [String!]! nodeRegistryIds: [String!]!
crossWorkflowDispatchIds: [String!]! defaults: WorkflowDefaults! counts: WorkflowCounts!
nodeFiles: [String!]! workflowDirectory: String! artifactWorkflowRoot: String!
addonSources: [WorkflowAddonSource!]! runtime: WorkflowRuntimeReadiness! }
type WorkflowDefinitionView { workflowName: String! workflowDirectory: String
artifactWorkflowRoot: String revision: String bundle: JSON!
derivedVisualization: JSON! } type SessionTransition {
from: String! to: String! when: String!
} type AutoImprovePolicy { enabled: Boolean!
superviserWorkflowId: String monitorIntervalMs: Int! stallTimeoutMs: Int!
maxSupervisedAttempts: Int! maxWorkflowPatches: Int! workflowMutationMode: String!
allowTargetedRerun: Boolean } type SupervisionIncident {
incidentId: String! supervisedAttemptId: String! category: String!
summary: String! detectedAt: String! }
type SupervisionRemediationRecord { remediationId: String! incidentId: String!
decidedAt: String! action: String! targetStepId: String
reason: String! } type SupervisionRunState {
supervisionRunId: String! targetWorkflowId: String! superviserWorkflowId: String!
status: String! attemptCount: Int! workflowPatchCount: Int!
mutableWorkflowDir: String nestedSuperviserSessionId: String policy: AutoImprovePolicy
incidents: [SupervisionIncident!]! remediations: [SupervisionRemediationRecord!]! }
type NodeExecutionRecord { nodeId: String! stepId: String
nodeRegistryId: String nodeExecId: String! mailboxInstanceId: String
status: String! artifactDir: String! startedAt: String!
endedAt: String! attempt: Int outputAttemptCount: Int
outputValidationErrors: JSON promptVariant: String timeoutMs: Int
backendSessionId: String backendSessionMode: String restartedFromNodeExecId: String
} type WorkflowSessionState { sessionId: String!
workflowName: String! workflowId: String! status: String!
startedAt: String! endedAt: String queue: [String!]!
currentNodeId: String currentStepId: String nodeExecutionCounter: Int!
nodeExecutionCounts: JSON! loopIterationCounts: JSON restartCounts: JSON
restartEvents: JSON! transitions: [SessionTransition!]! nodeExecutions: [NodeExecutionRecord!]!
communicationCounter: Int! communications: JSON! conversationTurns: JSON!
nodeBackendSessions: JSON! fanoutGroups: JSON! fanoutSummaries: [FanoutGroupSummary!]!
runtimeVariables: JSON! lastError: String supervision: SupervisionRunState
} type FanoutGroupSummary { fanoutGroupRunId: String!
groupId: String! sourceStepId: String! sourceNodeExecId: String!
joinStepId: String! targetStepId: String! targetWorkflowId: String
concurrency: Int! failurePolicy: String! resultOrder: String!
branchCounts: JSON! branches: [FanoutBranchSummary!]! firstFailure: String
} type FanoutBranchSummary { branchIndex: Int!
status: String! workItemId: String! nodeExecIds: [String!]!
outputRef: JSON error: String workspaceRoot: String
supersededWorkspaceRoot: String } type RuntimeNodeExecutionSummary {
sessionId: String! nodeExecId: String! nodeId: String!
stepId: String nodeRegistryId: String mailboxInstanceId: String
status: String! artifactDir: String! startedAt: String!
endedAt: String! attempt: Int outputAttemptCount: Int
outputValidationErrors: JSON promptVariant: String timeoutMs: Int
backendSessionMode: String backendSessionId: String restartedFromNodeExecId: String
inputHash: String! outputHash: String! inputJson: String!
outputJson: String! createdAt: String! }
type RuntimeNodeLogEntry { id: Int! sessionId: String!
nodeExecId: String nodeId: String level: String!
message: String! payloadJson: String at: String!
} type RuntimeLlmSessionMessageRecord { id: Int!
sessionId: String! nodeExecId: String! nodeId: String!
provider: String! model: String! backendSessionId: String
ordinal: Int! role: String eventType: String!
contentText: String rawMessageJson: String at: String!
} type RuntimeHookEventRecord { hookEventId: String!
workflowId: String! workflowExecutionId: String! nodeId: String!
nodeExecId: String! managerSessionId: String vendor: String!
agentSessionId: String! rawEventName: String! eventName: String!
cwd: String! transcriptPath: String model: String
turnId: String payloadHash: String! payloadRefJson: String
responseJson: String status: String! error: String
createdAt: String! updatedAt: String! }
type RuntimeEventReplyDispatchRecord { idempotencyKey: String! sourceId: String!
provider: String! workflowId: String! workflowExecutionId: String!
nodeId: String! nodeExecId: String! eventId: String!
conversationId: String! threadId: String actorId: String
status: String! dispatchId: String providerMessageId: String
requestJson: String! responseJson: String error: String
createdAt: String! updatedAt: String! }
type WorkflowExecutionView { workflowExecutionId: String! session: WorkflowSessionState!
nodeExecutions: [RuntimeNodeExecutionSummary!]! nodeLogs: [RuntimeNodeLogEntry!]! llmMessages(order: LlmSessionMessageOrder = DESC, limit: Int = 1): [RuntimeLlmSessionMessageRecord!]!
hookEvents: [RuntimeHookEventRecord!]! replyDispatches: [RuntimeEventReplyDispatchRecord!]! }
type NodeExecutionView { workflowId: String! workflowExecutionId: String!
nodeId: String! stepId: String nodeRegistryId: String
nodeExecId: String! mailboxInstanceId: String status: String!
startedAt: String! endedAt: String! attempt: Int
outputAttemptCount: Int outputValidationErrors: JSON promptVariant: String
timeoutMs: Int backendSessionId: String backendSessionMode: String
restartedFromNodeExecId: String artifactDir: String! output: String
meta: String terminalMessage: String recentLogs: [RuntimeNodeLogEntry!]!
llmMessages(order: LlmSessionMessageOrder = DESC, limit: Int = 1): [RuntimeLlmSessionMessageRecord!]! } type CommunicationRecord {
workflowId: String! workflowExecutionId: String! communicationId: String!
fromNodeId: String! toNodeId: String! routingScope: String!
sourceNodeExecId: String! payloadRef: JSON! deliveryKind: String!
transitionWhen: String! status: String! deliveryAttemptIds: [String!]!
activeDeliveryAttemptId: String createdAt: String! deliveredAt: String
consumedByNodeExecId: String consumedAt: String failureReason: String
supersededByCommunicationId: String supersededAt: String replayedFromCommunicationId: String
managerMessageId: String artifactDir: String! }
type CommunicationAttemptSnapshot { deliveryAttemptId: String! attemptJson: String
receiptJson: String } type CommunicationArtifactSnapshot {
messageJson: String metaJson: String outboxMessageJson: String
outboxOutputRaw: String inboxMessageJson: String attemptFiles: [CommunicationAttemptSnapshot!]!
} type CommunicationGraphqlView { record: CommunicationRecord!
sourceNodeExecution: NodeExecutionRecord consumedByNodeExecution: NodeExecutionRecord artifactSnapshot: CommunicationArtifactSnapshot!
} type CommunicationConnection { items: [CommunicationGraphqlView!]!
totalCount: Int! nextCursor: String }
type WorkflowExecutionConnection { items: JSON! totalCount: Int!
nextCursor: String } type WorkflowExecutionCompactSummary {
workflowExecutionId: String! sessionId: String! workflowName: String!
status: String! currentNodeId: String currentStepId: String
nodeExecutionCounter: Int! startedAt: String! endedAt: String
} type WorkflowOverviewRow { workflowName: String!
sourceScope: String! workflowDirectory: String! description: String!
aggregateStatus: String! activeExecutionCount: Int! latestExecution: WorkflowExecutionCompactSummary
} type WorkflowCatalogOverviewPayload { workflows: [WorkflowOverviewRow!]!
} type WorkflowStatusOverviewPayload { workflowName: String!
sourceScope: String! workflowDirectory: String! description: String!
aggregateStatus: String! activeExecutionCount: Int! latestExecution: WorkflowExecutionCompactSummary
newestActiveExecution: WorkflowExecutionCompactSummary recentExecutions: [WorkflowExecutionCompactSummary!]! }
type WorkflowExecutionOverviewView { workflowExecutionId: String! workflowId: String!
workflowName: String! status: String! session: WorkflowSessionState!
nodes: [NodeExecutionView!]! communications: CommunicationConnection! nodeLogs: [RuntimeNodeLogEntry!]!
llmMessages(order: LlmSessionMessageOrder = DESC, limit: Int = 1): [RuntimeLlmSessionMessageRecord!]! hookEvents: [RuntimeHookEventRecord!]! replyDispatches: [RuntimeEventReplyDispatchRecord!]!
} type ManagerIntentSummary { kind: String!
targetId: String reason: String }
type ManagerSessionView { session: JSON! messages: JSON!
} type SaveWorkflowDefinitionPayload { workflowName: String!
workflowDirectory: String revision: String error: String
currentRevision: String issues: JSON }
type ValidateWorkflowDefinitionPayload { valid: Boolean! workflowId: String
addonSources: [WorkflowAddonSource!] warnings: JSON issues: JSON
error: String } type ExecuteWorkflowPayload {
workflowExecutionId: String! sessionId: String! status: String!
accepted: Boolean exitCode: Int }
type ResumeWorkflowExecutionPayload { workflowExecutionId: String! sessionId: String!
status: String! exitCode: Int! }
type RerunWorkflowExecutionPayload { workflowExecutionId: String! sessionId: String!
status: String! rerunFromStepId: String exitCode: Int!
} type ContinueWorkflowExecutionPayload { workflowExecutionId: String!
sessionId: String! status: String! exitCode: Int!
continuedAfterStepRunId: String! continuedStartStepId: String! }
type WorkflowExecutionStepRun { workflowExecutionId: String! timelineOrdinal: Int!
executionOrdinal: Int! stepRunId: String! stepId: String
nodeRegistryId: String status: String! imported: Boolean!
sourceWorkflowExecutionId: String! startedAt: String! endedAt: String!
} type WorkflowExecutionStepRunsPayload { workflowExecutionId: String!
workflowId: String! workflowName: String! stepRuns: [WorkflowExecutionStepRun!]!
} type CancelWorkflowExecutionPayload { accepted: Boolean!
workflowExecutionId: String! sessionId: String! status: String!
} type SupervisedWorkflowGraphqlPayload { supervisedRun: JSON!
activeTargetStatus: String commandResult: JSON }
type DispatchSupervisorChatResult { receiptId: String! status: String!
duplicate: Boolean! bindingId: String workflowName: String
workflowExecutionId: String supervisedRunId: String supervisorExecutionId: String
error: String } type DispatchSupervisorChatPayload {
results: [DispatchSupervisorChatResult!]! } type DispatchSupervisorConversationPayload {
conversation: JSON! managedRuns: [JSON!]! decision: JSON!
proposal: JSON! applied: Boolean! validationIssues: JSON
} type SupervisorDispatchConversationPayload { conversation: JSON!
managedRuns: [JSON!]! } type SendManagerMessagePayload {
accepted: Boolean! managerMessageId: String! parsedIntent: [ManagerIntentSummary!]!
createdCommunicationIds: [String!]! queuedNodeIds: [String!]! rejectionReason: String
workflowId: String! workflowExecutionId: String! managerSessionId: String!
} type ReplayCommunicationPayload { sourceCommunicationId: String!
workflowExecutionId: String! replayedCommunicationId: String! status: String!
} type RetryCommunicationDeliveryPayload { communicationId: String!
activeDeliveryAttemptId: String! status: String! }
input AutoImprovePolicyInput { enabled: Boolean! superviserWorkflowId: String
monitorIntervalMs: Int stallTimeoutMs: Int maxSupervisedAttempts: Int
maxWorkflowPatches: Int workflowMutationMode: String allowTargetedRerun: Boolean
} input ExecuteWorkflowInput { workflowName: String!
runtimeVariables: JSON autoImprove: AutoImprovePolicyInput nestedSuperviser: Boolean
workingDirectory: String mockScenario: JSON async: Boolean
dryRun: Boolean maxSteps: Int maxLoopIterations: Int
defaultTimeoutMs: Int maxConcurrency: Int }
enum WorkflowTemplateMode { MANAGED WORKER_ONLY
} input CreateWorkflowDefinitionInput { workflowName: String!
templateMode: WorkflowTemplateMode } input SaveWorkflowDefinitionInput {
workflowName: String! bundle: JSON! expectedRevision: String
} input ValidateWorkflowDefinitionInput { workflowName: String!
bundle: JSON } input ResumeWorkflowExecutionInput {
workflowExecutionId: String! autoImprove: AutoImprovePolicyInput nestedSuperviser: Boolean
workingDirectory: String dryRun: Boolean maxSteps: Int
maxLoopIterations: Int defaultTimeoutMs: Int maxConcurrency: Int
} input RerunWorkflowExecutionInput { workflowExecutionId: String!
stepId: String! autoImprove: AutoImprovePolicyInput runtimeVariables: JSON
workingDirectory: String dryRun: Boolean maxSteps: Int
maxLoopIterations: Int defaultTimeoutMs: Int maxConcurrency: Int
} input ContinueWorkflowExecutionInput { sourceWorkflowExecutionId: String!
startStepId: String! afterStepRunId: String! autoImprove: AutoImprovePolicyInput
nestedSuperviser: Boolean runtimeVariables: JSON workingDirectory: String
dryRun: Boolean maxSteps: Int maxLoopIterations: Int
defaultTimeoutMs: Int maxConcurrency: Int mockScenario: JSON
} input CancelWorkflowExecutionInput { workflowExecutionId: String!
} input EventSupervisorCommandInput { commandId: String!
sourceId: String! bindingId: String! correlationKey: String!
action: String! args: [String!] targetWorkflowName: String!
supervisedRunId: String targetWorkflowExecutionId: String runtimeVariables: JSON
reason: String receivedEventReceiptId: String! }
input DispatchSupervisedWorkflowCommandInput { command: EventSupervisorCommandInput! binding: JSON!
runtimeVariables: JSON mockScenario: JSON dryRun: Boolean
maxSteps: Int maxLoopIterations: Int defaultTimeoutMs: Int
maxConcurrency: Int } input SupervisedWorkflowLookupGraphqlInput {
supervisedRunId: String sourceId: String bindingId: String
correlationKey: String } input DispatchSupervisorChatInput {
sourceId: String! text: String! conversationId: String
threadId: String eventId: String eventType: String
provider: String idempotencyKey: String }
input DispatchSupervisorConversationInput { binding: JSON! event: JSON!
supervisorProfileId: String! correlationKey: String! sourceMessageId: String!
mockScenario: JSON dryRun: Boolean maxSteps: Int
maxLoopIterations: Int defaultTimeoutMs: Int maxConcurrency: Int
} input SupervisorDispatchConversationLookupInput { supervisorConversationId: String!
} input SendManagerMessageInput { workflowId: String!
workflowExecutionId: String! message: String actions: JSON
attachments: JSON idempotencyKey: String managerSessionId: String
managerNodeExecId: String } input ReplayCommunicationInput {
workflowId: String! workflowExecutionId: String! communicationId: String!
reason: String idempotencyKey: String managerSessionId: String
} input RetryCommunicationDeliveryInput { workflowId: String!
workflowExecutionId: String! communicationId: String! reason: String
idempotencyKey: String managerSessionId: String }
type Query { workflows: [String!]! workflow(workflowName: String!): WorkflowView
workflowDefinition(workflowName: String!): WorkflowDefinitionView workflowExecution(workflowExecutionId: String!): WorkflowExecutionView workflowExecutionOverview(
workflowExecutionId: String! recentLogLimit: Int firstCommunications: Int
afterCommunicationId: String ): WorkflowExecutionOverviewView workflowExecutions(
workflowName: String status: String first: Int
afterWorkflowExecutionId: String ): WorkflowExecutionConnection! workflowCatalogOverview(
workflowScope: String status: String limit: Int
): WorkflowCatalogOverviewPayload! workflowStatusOverview( workflowName: String!
workflowScope: String limit: Int ): WorkflowStatusOverviewPayload
communications( workflowId: String! workflowExecutionId: String!
fromNodeId: String toNodeId: String status: String
first: Int afterCommunicationId: String ): CommunicationConnection!
communication( workflowId: String! workflowExecutionId: String!
communicationId: String! ): CommunicationGraphqlView nodeExecution(
workflowId: String! workflowExecutionId: String! nodeId: String!
nodeExecId: String! recentLogLimit: Int ): NodeExecutionView
managerSession(managerSessionId: String): ManagerSessionView supervisedWorkflowRun( input: SupervisedWorkflowLookupGraphqlInput!
): SupervisedWorkflowGraphqlPayload! supervisorDispatchConversation( input: SupervisorDispatchConversationLookupInput!
): SupervisorDispatchConversationPayload! workflowExecutionStepRuns( workflowExecutionId: String!
stepId: String status: String ): WorkflowExecutionStepRunsPayload!
} type Mutation { createWorkflowDefinition(input: CreateWorkflowDefinitionInput!): WorkflowDefinitionView!
saveWorkflowDefinition(input: SaveWorkflowDefinitionInput!): SaveWorkflowDefinitionPayload! validateWorkflowDefinition(input: ValidateWorkflowDefinitionInput!): ValidateWorkflowDefinitionPayload! executeWorkflow(input: ExecuteWorkflowInput!): ExecuteWorkflowPayload!
resumeWorkflowExecution(input: ResumeWorkflowExecutionInput!): ResumeWorkflowExecutionPayload! rerunWorkflowExecution(input: RerunWorkflowExecutionInput!): RerunWorkflowExecutionPayload! continueWorkflowExecution(
input: ContinueWorkflowExecutionInput! ): ContinueWorkflowExecutionPayload! sendManagerMessage(input: SendManagerMessageInput!): SendManagerMessagePayload!
retryCommunicationDelivery(input: RetryCommunicationDeliveryInput!): RetryCommunicationDeliveryPayload! replayCommunication(input: ReplayCommunicationInput!): ReplayCommunicationPayload! cancelWorkflowExecution(input: CancelWorkflowExecutionInput!): CancelWorkflowExecutionPayload!
dispatchSupervisedWorkflowCommand( input: DispatchSupervisedWorkflowCommandInput! ): SupervisedWorkflowGraphqlPayload!
dispatchSupervisorChat( input: DispatchSupervisorChatInput! ): DispatchSupervisorChatPayload!
dispatchSupervisorConversation( input: DispatchSupervisorConversationInput! ): DispatchSupervisorConversationPayload!
} `;
function parseOverviewWorkflowScopeArg(
  value: string | undefined | null,
): WorkflowScopeSelector | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "auto" || value === "project" || value === "user") {
    return value;
  }
  throw new Error(`invalid workflowScope '${value}'`);
}
function parseOverviewAggregateStatusArg(
  value: string | undefined | null,
): WorkflowOverviewStatus | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const allowed: readonly WorkflowOverviewStatus[] = [
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "never-run",
  ];
  if ((allowed as readonly string[]).includes(value)) {
    return value as WorkflowOverviewStatus;
  }
  throw new Error(`invalid workflow overview status '${value}'`);
}
function parseWorkflowCatalogOverviewGraphqlArgs(args: {
  readonly workflowScope?: string | null;
  readonly status?: string | null;
  readonly limit?: number | null;
}): WorkflowCatalogOverviewGraphqlInput {
  const workflowScope = parseOverviewWorkflowScopeArg(args.workflowScope);
  const status = parseOverviewAggregateStatusArg(args.status);
  return {
    ...(workflowScope === undefined ? {} : { workflowScope }),
    ...(status === undefined ? {} : { status }),
    ...(args.limit == null ? {} : { limit: args.limit }),
  };
}
function parseWorkflowStatusOverviewGraphqlArgs(args: {
  readonly workflowName: string;
  readonly workflowScope?: string | null;
  readonly limit?: number | null;
}): WorkflowStatusOverviewGraphqlInput {
  const workflowScope = parseOverviewWorkflowScopeArg(args.workflowScope);
  return {
    workflowName: args.workflowName,
    ...(workflowScope === undefined ? {} : { workflowScope }),
    ...(args.limit == null ? {} : { limit: args.limit }),
  };
}
function parseJsonLiteral(value: ValueNode): unknown {
  switch (value.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return value.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(value.value);
    case Kind.NULL:
      return null;
    case Kind.OBJECT: {
      const result: Record<string, unknown> = {};
      for (const field of value.fields) {
        result[field.name.value] = parseJsonLiteral(field.value);
      }
      return result;
    }
    case Kind.LIST:
      return value.values.map((entry) => parseJsonLiteral(entry));
    case Kind.ENUM:
      return value.value;
  }
  return null;
}
function createJsonScalar(): GraphQLScalarType {
  return new GraphQLScalarType({
    name: "JSON",
    serialize(value: unknown): unknown {
      return value;
    },
    parseValue(value: unknown): unknown {
      return value;
    },
    parseLiteral(value): unknown {
      return parseJsonLiteral(value);
    },
  });
}
function selectLlmMessagesForField(
  parent: GraphqlLlmSessionMessagesParent,
  args: GraphqlLlmSessionMessagesFieldArgs,
): readonly RuntimeLlmSessionMessageRecord[] {
  return selectGraphqlLlmSessionMessages(parent.llmMessages, args);
}
export function createExecutableGraphqlSchema(
  deps: GraphqlSchemaDependencies = {},
) {
  const schema = createGraphqlSchema(deps);
  return createSchema<GraphqlRequestContext>({
    typeDefs: GRAPHQL_SCHEMA_TEXT,
    resolvers: {
      JSON: createJsonScalar(),
      WorkflowSessionState: {
        supervision(parent: { readonly supervision?: unknown }): unknown {
          return parent.supervision ?? null;
        },
      },
      SupervisionRunState: {
        incidents(parent: {
          readonly incidents?: readonly unknown[];
        }): unknown {
          return parent.incidents ?? [];
        },
        remediations(parent: {
          readonly remediations?: readonly unknown[];
        }): unknown {
          return parent.remediations ?? [];
        },
      },
      WorkflowExecutionView: { llmMessages: selectLlmMessagesForField },
      WorkflowExecutionOverviewView: { llmMessages: selectLlmMessagesForField },
      NodeExecutionView: { llmMessages: selectLlmMessagesForField },
      Query: {
        workflows(
          _parent: unknown,
          _args: Record<string, never>,
          context: GraphqlRequestContext,
        ): Promise<readonly string[]> {
          return schema.query.workflows({}, context);
        },
        workflow(
          _parent: unknown,
          args: { readonly workflowName: string },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflow(args, context);
        },
        workflowDefinition(
          _parent: unknown,
          args: { readonly workflowName: string },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowDefinition(args, context);
        },
        workflowExecution(
          _parent: unknown,
          args: { readonly workflowExecutionId: string },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowExecution(
            { ...args, llmMessages: FULL_LLM_SESSION_MESSAGES_SELECTION },
            context,
          );
        },
        workflowExecutionOverview(
          _parent: unknown,
          args: {
            readonly workflowExecutionId: string;
            readonly recentLogLimit?: number;
            readonly firstCommunications?: number;
            readonly afterCommunicationId?: string;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowExecutionOverview(
            { ...args, llmMessages: FULL_LLM_SESSION_MESSAGES_SELECTION },
            context,
          );
        },
        workflowExecutions(
          _parent: unknown,
          args: WorkflowExecutionsQueryInput,
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowExecutions(args, context);
        },
        workflowCatalogOverview(
          _parent: unknown,
          args: {
            readonly workflowScope?: string | null;
            readonly status?: string | null;
            readonly limit?: number | null;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowCatalogOverview(
            parseWorkflowCatalogOverviewGraphqlArgs(args),
            context,
          );
        },
        workflowStatusOverview(
          _parent: unknown,
          args: {
            readonly workflowName: string;
            readonly workflowScope?: string | null;
            readonly limit?: number | null;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowStatusOverview(
            parseWorkflowStatusOverviewGraphqlArgs(args),
            context,
          );
        },
        communications(
          _parent: unknown,
          args: CommunicationsQueryInput,
          context: GraphqlRequestContext,
        ) {
          return schema.query.communications(args, context);
        },
        communication(
          _parent: unknown,
          args: {
            readonly workflowId: string;
            readonly workflowExecutionId: string;
            readonly communicationId: string;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.communication(args, context);
        },
        nodeExecution(
          _parent: unknown,
          args: {
            readonly workflowId: string;
            readonly workflowExecutionId: string;
            readonly nodeId: string;
            readonly nodeExecId: string;
            readonly recentLogLimit?: number;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.nodeExecution(
            { ...args, llmMessages: FULL_LLM_SESSION_MESSAGES_SELECTION },
            context,
          );
        },
        managerSession(
          _parent: unknown,
          args: { readonly managerSessionId?: string },
          context: GraphqlRequestContext,
        ) {
          return schema.query.managerSession(args, context);
        },
        supervisedWorkflowRun(
          _parent: unknown,
          args: { readonly input: SupervisedWorkflowLookupGraphqlInput },
          context: GraphqlRequestContext,
        ) {
          return schema.query.supervisedWorkflowRun(args.input, context);
        },
        supervisorDispatchConversation(
          _parent: unknown,
          args: {
            readonly input: SupervisorDispatchConversationLookupGraphqlInput;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.supervisorDispatchConversation(
            args.input,
            context,
          );
        },
        workflowExecutionStepRuns(
          _parent: unknown,
          args: {
            readonly workflowExecutionId: string;
            readonly stepId?: string | null;
            readonly status?: string | null;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowExecutionStepRuns(
            {
              workflowExecutionId: args.workflowExecutionId,
              ...(args.stepId === undefined ||
              args.stepId === null ||
              args.stepId === ""
                ? {}
                : { stepId: args.stepId }),
              ...(args.status === undefined ||
              args.status === null ||
              args.status === ""
                ? {}
                : { status: args.status }),
            },
            context,
          );
        },
      },
      Mutation: {
        createWorkflowDefinition(
          _parent: unknown,
          args: { readonly input: CreateWorkflowDefinitionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.createWorkflowDefinition(args.input, context);
        },
        saveWorkflowDefinition(
          _parent: unknown,
          args: { readonly input: SaveWorkflowDefinitionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.saveWorkflowDefinition(args.input, context);
        },
        validateWorkflowDefinition(
          _parent: unknown,
          args: { readonly input: ValidateWorkflowDefinitionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.validateWorkflowDefinition(
            args.input,
            context,
          );
        },
        executeWorkflow(
          _parent: unknown,
          args: { readonly input: ExecuteWorkflowInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.executeWorkflow(args.input, context);
        },
        resumeWorkflowExecution(
          _parent: unknown,
          args: { readonly input: ResumeWorkflowExecutionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.resumeWorkflowExecution(args.input, context);
        },
        rerunWorkflowExecution(
          _parent: unknown,
          args: { readonly input: RerunWorkflowExecutionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.rerunWorkflowExecution(args.input, context);
        },
        continueWorkflowExecution(
          _parent: unknown,
          args: { readonly input: ContinueWorkflowExecutionInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.continueWorkflowExecution(args.input, context);
        },
        sendManagerMessage(
          _parent: unknown,
          args: { readonly input: SendManagerMessageInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.sendManagerMessage(args.input, context);
        },
        retryCommunicationDelivery(
          _parent: unknown,
          args: { readonly input: RetryCommunicationDeliveryInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.retryCommunicationDelivery(
            args.input,
            context,
          );
        },
        replayCommunication(
          _parent: unknown,
          args: { readonly input: ReplayCommunicationInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.replayCommunication(args.input, context);
        },
        cancelWorkflowExecution(
          _parent: unknown,
          args: { readonly input: { readonly workflowExecutionId: string } },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.cancelWorkflowExecution(args.input, context);
        },
        dispatchSupervisedWorkflowCommand(
          _parent: unknown,
          args: { readonly input: DispatchSupervisedWorkflowCommandInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.dispatchSupervisedWorkflowCommand(
            args.input,
            context,
          );
        },
        dispatchSupervisorChat(
          _parent: unknown,
          args: { readonly input: DispatchSupervisorChatGraphqlInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.dispatchSupervisorChat(args.input, context);
        },
        dispatchSupervisorConversation(
          _parent: unknown,
          args: { readonly input: DispatchSupervisorConversationGraphqlInput },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.dispatchSupervisorConversation(
            args.input,
            context,
          );
        },
      },
    },
  });
}
