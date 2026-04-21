import { Kind, GraphQLScalarType } from "graphql";
import type { ValueNode } from "graphql";
import { createSchema } from "graphql-yoga";
import { createGraphqlSchema } from "../graphql/schema";
import type {
  GraphqlRequestContext,
  GraphqlSchemaDependencies,
} from "../graphql/types";

const GRAPHQL_SCHEMA_TEXT = `
  scalar JSON

  type WorkflowDefaults {
    maxLoopIterations: Int!
    nodeTimeoutMs: Int!
  }

  type WorkflowCounts {
    nodes: Int!
    edges: Int!
    loops: Int!
    workflowCalls: Int!
    legacySubWorkflows: Int!
  }

  type WorkflowAddonSource {
    nodeId: String!
    name: String!
    version: String!
    scope: String!
    addonRoot: String!
    addonDirectory: String!
    manifestPath: String!
    scopeRoot: String
  }

  type WorkflowView {
    workflowName: String!
    workflowId: String!
    description: String!
    hasManagerNode: Boolean!
    managerNodeId: String
    entryNodeId: String!
    workflowCallIds: [String!]!
    defaults: WorkflowDefaults!
    counts: WorkflowCounts!
    nodeFiles: [String!]!
    workflowDirectory: String!
    artifactWorkflowRoot: String!
    addonSources: [WorkflowAddonSource!]!
  }

  type WorkflowDefinitionView {
    workflowName: String!
    workflowDirectory: String
    artifactWorkflowRoot: String
    revision: String
    bundle: JSON!
    derivedVisualization: JSON!
  }

  type SessionTransition {
    from: String!
    to: String!
    when: String!
  }

  type NodeExecutionRecord {
    nodeId: String!
    nodeExecId: String!
    status: String!
    artifactDir: String!
    startedAt: String!
    endedAt: String!
    attempt: Int
    outputAttemptCount: Int
    outputValidationErrors: JSON
    backendSessionId: String
    backendSessionMode: String
    restartedFromNodeExecId: String
  }

  type WorkflowSessionState {
    sessionId: String!
    workflowName: String!
    workflowId: String!
    status: String!
    startedAt: String!
    endedAt: String
    queue: [String!]!
    currentNodeId: String
    nodeExecutionCounter: Int!
    nodeExecutionCounts: JSON!
    loopIterationCounts: JSON
    restartCounts: JSON
    restartEvents: JSON!
    transitions: [SessionTransition!]!
    nodeExecutions: [NodeExecutionRecord!]!
    communicationCounter: Int!
    communications: JSON!
    conversationTurns: JSON!
    nodeBackendSessions: JSON!
    runtimeVariables: JSON!
    lastError: String
  }

  type RuntimeNodeExecutionSummary {
    sessionId: String!
    nodeExecId: String!
    nodeId: String!
    status: String!
    artifactDir: String!
    startedAt: String!
    endedAt: String!
    attempt: Int
    outputAttemptCount: Int
    outputValidationErrors: JSON
    backendSessionMode: String
    backendSessionId: String
    restartedFromNodeExecId: String
    inputHash: String!
    outputHash: String!
    inputJson: String!
    outputJson: String!
    createdAt: String!
  }

  type RuntimeNodeLogEntry {
    id: Int!
    sessionId: String!
    nodeExecId: String
    nodeId: String
    level: String!
    message: String!
    payloadJson: String
    at: String!
  }

  type RuntimeHookEventRecord {
    hookEventId: String!
    workflowId: String!
    workflowExecutionId: String!
    nodeId: String!
    nodeExecId: String!
    managerSessionId: String
    vendor: String!
    agentSessionId: String!
    rawEventName: String!
    eventName: String!
    cwd: String!
    transcriptPath: String
    model: String
    turnId: String
    payloadHash: String!
    payloadRefJson: String
    responseJson: String
    status: String!
    error: String
    createdAt: String!
    updatedAt: String!
  }

  type RuntimeEventReplyDispatchRecord {
    idempotencyKey: String!
    sourceId: String!
    provider: String!
    workflowId: String!
    workflowExecutionId: String!
    nodeId: String!
    nodeExecId: String!
    eventId: String!
    conversationId: String!
    threadId: String
    actorId: String
    status: String!
    dispatchId: String
    providerMessageId: String
    requestJson: String!
    responseJson: String
    error: String
    createdAt: String!
    updatedAt: String!
  }

  type WorkflowExecutionView {
    workflowExecutionId: String!
    session: WorkflowSessionState!
    nodeExecutions: [RuntimeNodeExecutionSummary!]!
    nodeLogs: [RuntimeNodeLogEntry!]!
    hookEvents: [RuntimeHookEventRecord!]!
    replyDispatches: [RuntimeEventReplyDispatchRecord!]!
  }

  type NodeExecutionView {
    workflowId: String!
    workflowExecutionId: String!
    nodeId: String!
    nodeExecId: String!
    status: String!
    startedAt: String!
    endedAt: String!
    attempt: Int
    outputAttemptCount: Int
    outputValidationErrors: JSON
    backendSessionId: String
    backendSessionMode: String
    restartedFromNodeExecId: String
    artifactDir: String!
    output: String
    meta: String
    terminalMessage: String
    recentLogs: [RuntimeNodeLogEntry!]!
  }

  type CommunicationRecord {
    workflowId: String!
    workflowExecutionId: String!
    communicationId: String!
    fromNodeId: String!
    toNodeId: String!
    fromSubWorkflowId: String
    toSubWorkflowId: String
    routingScope: String!
    sourceNodeExecId: String!
    payloadRef: JSON!
    deliveryKind: String!
    transitionWhen: String!
    status: String!
    deliveryAttemptIds: [String!]!
    activeDeliveryAttemptId: String
    createdAt: String!
    deliveredAt: String
    consumedByNodeExecId: String
    consumedAt: String
    failureReason: String
    supersededByCommunicationId: String
    supersededAt: String
    replayedFromCommunicationId: String
    managerMessageId: String
    artifactDir: String!
  }

  type CommunicationAttemptSnapshot {
    deliveryAttemptId: String!
    attemptJson: String
    receiptJson: String
  }

  type CommunicationArtifactSnapshot {
    messageJson: String
    metaJson: String
    outboxMessageJson: String
    outboxOutputRaw: String
    inboxMessageJson: String
    attemptFiles: [CommunicationAttemptSnapshot!]!
  }

  type CommunicationGraphqlView {
    record: CommunicationRecord!
    sourceNodeExecution: NodeExecutionRecord
    consumedByNodeExecution: NodeExecutionRecord
    artifactSnapshot: CommunicationArtifactSnapshot!
  }

  type CommunicationConnection {
    items: [CommunicationGraphqlView!]!
    totalCount: Int!
    nextCursor: String
  }

  type WorkflowExecutionConnection {
    items: JSON!
    totalCount: Int!
    nextCursor: String
  }

  type WorkflowExecutionOverviewView {
    workflowExecutionId: String!
    workflowId: String!
    workflowName: String!
    status: String!
    session: WorkflowSessionState!
    nodes: [NodeExecutionView!]!
    communications: CommunicationConnection!
    nodeLogs: [RuntimeNodeLogEntry!]!
    hookEvents: [RuntimeHookEventRecord!]!
    replyDispatches: [RuntimeEventReplyDispatchRecord!]!
  }

  type ManagerIntentSummary {
    kind: String!
    targetId: String
    reason: String
  }

  type ManagerSessionView {
    session: JSON!
    messages: JSON!
  }

  type SaveWorkflowDefinitionPayload {
    workflowName: String!
    workflowDirectory: String
    revision: String
    error: String
    currentRevision: String
    issues: JSON
  }

  type ValidateWorkflowDefinitionPayload {
    valid: Boolean!
    workflowId: String
    addonSources: [WorkflowAddonSource!]
    warnings: JSON
    issues: JSON
    error: String
  }

  type ExecuteWorkflowPayload {
    workflowExecutionId: String!
    sessionId: String!
    status: String!
    accepted: Boolean
    exitCode: Int
  }

  type ResumeWorkflowExecutionPayload {
    workflowExecutionId: String!
    sessionId: String!
    status: String!
    exitCode: Int!
  }

  type RerunWorkflowExecutionPayload {
    workflowExecutionId: String!
    sessionId: String!
    status: String!
    exitCode: Int!
  }

  type CancelWorkflowExecutionPayload {
    accepted: Boolean!
    workflowExecutionId: String!
    sessionId: String!
    status: String!
  }

  type SendManagerMessagePayload {
    accepted: Boolean!
    managerMessageId: String!
    parsedIntent: [ManagerIntentSummary!]!
    createdCommunicationIds: [String!]!
    queuedNodeIds: [String!]!
    rejectionReason: String
    workflowId: String!
    workflowExecutionId: String!
    managerSessionId: String!
  }

  type ReplayCommunicationPayload {
    sourceCommunicationId: String!
    workflowExecutionId: String!
    replayedCommunicationId: String!
    status: String!
  }

  type RetryCommunicationDeliveryPayload {
    communicationId: String!
    activeDeliveryAttemptId: String!
    status: String!
  }

  input ExecuteWorkflowInput {
    workflowName: String!
    runtimeVariables: JSON
    workingDirectory: String
    mockScenario: JSON
    async: Boolean
    dryRun: Boolean
    maxSteps: Int
    maxLoopIterations: Int
    defaultTimeoutMs: Int
  }

  enum WorkflowTemplateMode {
    MANAGED
    WORKER_ONLY
  }

  input CreateWorkflowDefinitionInput {
    workflowName: String!
    templateMode: WorkflowTemplateMode
  }

  input SaveWorkflowDefinitionInput {
    workflowName: String!
    bundle: JSON!
    expectedRevision: String
  }

  input ValidateWorkflowDefinitionInput {
    workflowName: String!
    bundle: JSON
  }

  input ResumeWorkflowExecutionInput {
    workflowExecutionId: String!
    workingDirectory: String
    dryRun: Boolean
    maxSteps: Int
    maxLoopIterations: Int
    defaultTimeoutMs: Int
  }

  input RerunWorkflowExecutionInput {
    workflowExecutionId: String!
    nodeId: String!
    runtimeVariables: JSON
    workingDirectory: String
    dryRun: Boolean
    maxSteps: Int
    maxLoopIterations: Int
    defaultTimeoutMs: Int
  }

  input CancelWorkflowExecutionInput {
    workflowExecutionId: String!
  }

  input SendManagerMessageInput {
    workflowId: String!
    workflowExecutionId: String!
    message: String
    actions: JSON
    attachments: JSON
    idempotencyKey: String
    managerSessionId: String
    managerNodeId: String
    managerNodeExecId: String
  }

  input ReplayCommunicationInput {
    workflowId: String!
    workflowExecutionId: String!
    communicationId: String!
    reason: String
    idempotencyKey: String
    managerSessionId: String
  }

  input RetryCommunicationDeliveryInput {
    workflowId: String!
    workflowExecutionId: String!
    communicationId: String!
    reason: String
    idempotencyKey: String
    managerSessionId: String
  }

  type Query {
    workflows: [String!]!
    workflow(workflowName: String!): WorkflowView
    workflowDefinition(workflowName: String!): WorkflowDefinitionView
    workflowExecution(workflowExecutionId: String!): WorkflowExecutionView
    workflowExecutionOverview(
      workflowExecutionId: String!
      recentLogLimit: Int
      firstCommunications: Int
      afterCommunicationId: String
    ): WorkflowExecutionOverviewView
    workflowExecutions(
      workflowName: String
      status: String
      first: Int
      afterWorkflowExecutionId: String
    ): WorkflowExecutionConnection!
    communications(
      workflowId: String!
      workflowExecutionId: String!
      fromNodeId: String
      toNodeId: String
      status: String
      first: Int
      afterCommunicationId: String
    ): CommunicationConnection!
    communication(
      workflowId: String!
      workflowExecutionId: String!
      communicationId: String!
    ): CommunicationGraphqlView
    nodeExecution(
      workflowId: String!
      workflowExecutionId: String!
      nodeId: String!
      nodeExecId: String!
      recentLogLimit: Int
    ): NodeExecutionView
    managerSession(managerSessionId: String): ManagerSessionView
  }

  type Mutation {
    createWorkflowDefinition(input: CreateWorkflowDefinitionInput!): WorkflowDefinitionView!
    saveWorkflowDefinition(input: SaveWorkflowDefinitionInput!): SaveWorkflowDefinitionPayload!
    validateWorkflowDefinition(input: ValidateWorkflowDefinitionInput!): ValidateWorkflowDefinitionPayload!
    executeWorkflow(input: ExecuteWorkflowInput!): ExecuteWorkflowPayload!
    resumeWorkflowExecution(input: ResumeWorkflowExecutionInput!): ResumeWorkflowExecutionPayload!
    rerunWorkflowExecution(input: RerunWorkflowExecutionInput!): RerunWorkflowExecutionPayload!
    sendManagerMessage(input: SendManagerMessageInput!): SendManagerMessagePayload!
    retryCommunicationDelivery(input: RetryCommunicationDeliveryInput!): RetryCommunicationDeliveryPayload!
    replayCommunication(input: ReplayCommunicationInput!): ReplayCommunicationPayload!
    cancelWorkflowExecution(input: CancelWorkflowExecutionInput!): CancelWorkflowExecutionPayload!
  }
`;

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

export function createExecutableGraphqlSchema(
  deps: GraphqlSchemaDependencies = {},
) {
  const schema = createGraphqlSchema(deps);

  return createSchema<GraphqlRequestContext>({
    typeDefs: GRAPHQL_SCHEMA_TEXT,
    resolvers: {
      JSON: createJsonScalar(),
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
          return schema.query.workflowExecution(args, context);
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
          return schema.query.workflowExecutionOverview(args, context);
        },
        workflowExecutions(
          _parent: unknown,
          args: {
            readonly workflowName?: string;
            readonly status?: string;
            readonly first?: number;
            readonly afterWorkflowExecutionId?: string;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.workflowExecutions(args as never, context);
        },
        communications(
          _parent: unknown,
          args: {
            readonly workflowId: string;
            readonly workflowExecutionId: string;
            readonly fromNodeId?: string;
            readonly toNodeId?: string;
            readonly status?: string;
            readonly first?: number;
            readonly afterCommunicationId?: string;
          },
          context: GraphqlRequestContext,
        ) {
          return schema.query.communications(args as never, context);
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
          return schema.query.nodeExecution(args, context);
        },
        managerSession(
          _parent: unknown,
          args: { readonly managerSessionId?: string },
          context: GraphqlRequestContext,
        ) {
          return schema.query.managerSession(args, context);
        },
      },
      Mutation: {
        createWorkflowDefinition(
          _parent: unknown,
          args: { readonly input: { readonly workflowName: string } },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.createWorkflowDefinition(args.input, context);
        },
        saveWorkflowDefinition(
          _parent: unknown,
          args: {
            readonly input: {
              readonly workflowName: string;
              readonly bundle: unknown;
              readonly expectedRevision?: string;
            };
          },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.saveWorkflowDefinition(
            args.input as never,
            context,
          );
        },
        validateWorkflowDefinition(
          _parent: unknown,
          args: {
            readonly input: {
              readonly workflowName: string;
              readonly bundle?: unknown;
            };
          },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.validateWorkflowDefinition(
            args.input as never,
            context,
          );
        },
        executeWorkflow(
          _parent: unknown,
          args: {
            readonly input: {
              readonly workflowName: string;
              readonly runtimeVariables?: unknown;
              readonly workingDirectory?: string;
              readonly mockScenario?: unknown;
              readonly async?: boolean;
              readonly dryRun?: boolean;
              readonly maxSteps?: number;
              readonly maxLoopIterations?: number;
              readonly defaultTimeoutMs?: number;
            };
          },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.executeWorkflow(args.input as never, context);
        },
        resumeWorkflowExecution(
          _parent: unknown,
          args: {
            readonly input: {
              readonly workflowExecutionId: string;
              readonly workingDirectory?: string;
              readonly dryRun?: boolean;
              readonly maxSteps?: number;
              readonly maxLoopIterations?: number;
              readonly defaultTimeoutMs?: number;
            };
          },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.resumeWorkflowExecution(args.input, context);
        },
        rerunWorkflowExecution(
          _parent: unknown,
          args: {
            readonly input: {
              readonly workflowExecutionId: string;
              readonly nodeId: string;
              readonly runtimeVariables?: unknown;
              readonly workingDirectory?: string;
              readonly dryRun?: boolean;
              readonly maxSteps?: number;
              readonly maxLoopIterations?: number;
              readonly defaultTimeoutMs?: number;
            };
          },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.rerunWorkflowExecution(
            args.input as never,
            context,
          );
        },
        sendManagerMessage(
          _parent: unknown,
          args: {
            readonly input: {
              readonly workflowId: string;
              readonly workflowExecutionId: string;
              readonly message?: string;
              readonly actions?: unknown;
              readonly attachments?: unknown;
              readonly idempotencyKey?: string;
              readonly managerSessionId?: string;
              readonly managerNodeId?: string;
              readonly managerNodeExecId?: string;
            };
          },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.sendManagerMessage(
            args.input as never,
            context,
          );
        },
        retryCommunicationDelivery(
          _parent: unknown,
          args: {
            readonly input: {
              readonly workflowId: string;
              readonly workflowExecutionId: string;
              readonly communicationId: string;
              readonly reason?: string;
              readonly idempotencyKey?: string;
              readonly managerSessionId?: string;
            };
          },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.retryCommunicationDelivery(
            args.input as never,
            context,
          );
        },
        replayCommunication(
          _parent: unknown,
          args: {
            readonly input: {
              readonly workflowId: string;
              readonly workflowExecutionId: string;
              readonly communicationId: string;
              readonly reason?: string;
              readonly idempotencyKey?: string;
              readonly managerSessionId?: string;
            };
          },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.replayCommunication(
            args.input as never,
            context,
          );
        },
        cancelWorkflowExecution(
          _parent: unknown,
          args: { readonly input: { readonly workflowExecutionId: string } },
          context: GraphqlRequestContext,
        ) {
          return schema.mutation.cancelWorkflowExecution(args.input, context);
        },
      },
    },
  });
}
