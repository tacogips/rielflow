import { Kind, GraphQLScalarType } from "graphql";
import type { ValueNode } from "graphql";

export const GRAPHQL_SCHEMA_TEXT = `
  scalar JSON

  enum LlmSessionMessageOrder {
    ASC
    DESC
  }

  type WorkflowDefaults {
    maxLoopIterations: Int!
    nodeTimeoutMs: Int!
  }

  type WorkflowCounts {
    steps: Int!
    nodeRegistry: Int!
    crossWorkflowDispatches: Int!
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

  type WorkflowRuntimeRequirement {
    id: String!
    kind: String!
    label: String!
    status: String!
    detail: String!
    sourceStepIds: [String!]!
  }

  type WorkflowRuntimeReadiness {
    ready: Boolean!
    checkedAt: String!
    requirements: [WorkflowRuntimeRequirement!]!
    blockers: [String!]!
  }

  type WorkflowView {
    workflowName: String!
    workflowId: String!
    description: String!
    hasManagerNode: Boolean!
    managerStepId: String
    entryStepId: String
    stepIds: [String!]!
    nodeRegistryIds: [String!]!
    crossWorkflowDispatchIds: [String!]!
    defaults: WorkflowDefaults!
    counts: WorkflowCounts!
    nodeFiles: [String!]!
    workflowDirectory: String!
    artifactWorkflowRoot: String!
    addonSources: [WorkflowAddonSource!]!
    runtime: WorkflowRuntimeReadiness!
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

  type AutoImprovePolicy {
    enabled: Boolean!
    superviserWorkflowId: String
    monitorIntervalMs: Int!
    stallTimeoutMs: Int!
    maxSupervisedAttempts: Int!
    maxWorkflowPatches: Int!
    workflowMutationMode: String!
    allowTargetedRerun: Boolean
  }

  type SupervisionIncident {
    incidentId: String!
    supervisedAttemptId: String!
    category: String!
    summary: String!
    detectedAt: String!
  }

  type SupervisionRemediationRecord {
    remediationId: String!
    incidentId: String!
    decidedAt: String!
    action: String!
    targetStepId: String
    reason: String!
  }

  type SupervisionRunState {
    supervisionRunId: String!
    targetWorkflowId: String!
    superviserWorkflowId: String!
    status: String!
    attemptCount: Int!
    workflowPatchCount: Int!
    mutableWorkflowDir: String
    nestedSuperviserSessionId: String
    policy: AutoImprovePolicy
    incidents: [SupervisionIncident!]!
    remediations: [SupervisionRemediationRecord!]!
  }

  type NodeExecutionRecord {
    nodeId: String!
    stepId: String
    nodeRegistryId: String
    nodeExecId: String!
    mailboxInstanceId: String
    status: String!
    artifactDir: String!
    startedAt: String!
    endedAt: String!
    attempt: Int
    outputAttemptCount: Int
    outputValidationErrors: JSON
    promptVariant: String
    timeoutMs: Int
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
    currentStepId: String
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
    supervision: SupervisionRunState
  }

  type RuntimeNodeExecutionSummary {
    sessionId: String!
    nodeExecId: String!
    nodeId: String!
    stepId: String
    nodeRegistryId: String
    mailboxInstanceId: String
    status: String!
    artifactDir: String!
    startedAt: String!
    endedAt: String!
    attempt: Int
    outputAttemptCount: Int
    outputValidationErrors: JSON
    promptVariant: String
    timeoutMs: Int
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

  type RuntimeLlmSessionMessageRecord {
    id: Int!
    sessionId: String!
    nodeExecId: String!
    nodeId: String!
    provider: String!
    model: String!
    backendSessionId: String
    ordinal: Int!
    role: String
    eventType: String!
    contentText: String
    rawMessageJson: String
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
    llmMessages(order: LlmSessionMessageOrder = DESC, limit: Int = 1): [RuntimeLlmSessionMessageRecord!]!
    hookEvents: [RuntimeHookEventRecord!]!
    replyDispatches: [RuntimeEventReplyDispatchRecord!]!
  }

  type NodeExecutionView {
    workflowId: String!
    workflowExecutionId: String!
    nodeId: String!
    stepId: String
    nodeRegistryId: String
    nodeExecId: String!
    mailboxInstanceId: String
    status: String!
    startedAt: String!
    endedAt: String!
    attempt: Int
    outputAttemptCount: Int
    outputValidationErrors: JSON
    promptVariant: String
    timeoutMs: Int
    backendSessionId: String
    backendSessionMode: String
    restartedFromNodeExecId: String
    artifactDir: String!
    output: String
    meta: String
    terminalMessage: String
    recentLogs: [RuntimeNodeLogEntry!]!
    llmMessages(order: LlmSessionMessageOrder = DESC, limit: Int = 1): [RuntimeLlmSessionMessageRecord!]!
  }

  type CommunicationRecord {
    workflowId: String!
    workflowExecutionId: String!
    communicationId: String!
    fromNodeId: String!
    toNodeId: String!
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

  type WorkflowExecutionCompactSummary {
    workflowExecutionId: String!
    sessionId: String!
    workflowName: String!
    status: String!
    currentNodeId: String
    currentStepId: String
    nodeExecutionCounter: Int!
    startedAt: String!
    endedAt: String
  }

  type WorkflowOverviewRow {
    workflowName: String!
    sourceScope: String!
    workflowDirectory: String!
    description: String!
    aggregateStatus: String!
    activeExecutionCount: Int!
    latestExecution: WorkflowExecutionCompactSummary
  }

  type WorkflowCatalogOverviewPayload {
    workflows: [WorkflowOverviewRow!]!
  }

  type WorkflowStatusOverviewPayload {
    workflowName: String!
    sourceScope: String!
    workflowDirectory: String!
    description: String!
    aggregateStatus: String!
    activeExecutionCount: Int!
    latestExecution: WorkflowExecutionCompactSummary
    newestActiveExecution: WorkflowExecutionCompactSummary
    recentExecutions: [WorkflowExecutionCompactSummary!]!
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
    llmMessages(order: LlmSessionMessageOrder = DESC, limit: Int = 1): [RuntimeLlmSessionMessageRecord!]!
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
    nodeValidationResults: [NodeValidationResult!]
    warnings: JSON
    issues: JSON
    error: String
  }

  type NodeValidationResult {
    status: String!
    message: String!
    nodeId: String
    stepIds: [String!]
    source: String
    path: String
    backend: String
    addonName: String
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
    rerunFromStepId: String
    exitCode: Int!
  }

  type ContinueWorkflowExecutionPayload {
    workflowExecutionId: String!
    sessionId: String!
    status: String!
    exitCode: Int!
    continuedAfterStepRunId: String!
    continuedStartStepId: String!
  }

  type WorkflowExecutionStepRun {
    workflowExecutionId: String!
    timelineOrdinal: Int!
    executionOrdinal: Int!
    stepRunId: String!
    stepId: String
    nodeRegistryId: String
    status: String!
    imported: Boolean!
    sourceWorkflowExecutionId: String!
    startedAt: String!
    endedAt: String!
  }

  type WorkflowExecutionStepRunsPayload {
    workflowExecutionId: String!
    workflowId: String!
    workflowName: String!
    stepRuns: [WorkflowExecutionStepRun!]!
  }

  type CancelWorkflowExecutionPayload {
    accepted: Boolean!
    workflowExecutionId: String!
    sessionId: String!
    status: String!
  }

  type SupervisedWorkflowGraphqlPayload {
    supervisedRun: JSON!
    runnerPoolRunId: String
    activeTargetStatus: String
  }

  type DispatchSupervisorChatResult {
    receiptId: String!
    status: String!
    duplicate: Boolean!
    bindingId: String
    workflowName: String
    workflowExecutionId: String
    supervisedRunId: String
    supervisorExecutionId: String
    error: String
  }

  type DispatchSupervisorChatPayload {
    results: [DispatchSupervisorChatResult!]!
  }

  type DispatchSupervisorConversationPayload {
    conversation: JSON!
    managedRuns: [JSON!]!
    decision: JSON!
    proposal: JSON!
    applied: Boolean!
    validationIssues: JSON
  }

  type SupervisorDispatchConversationPayload {
    conversation: JSON!
    managedRuns: [JSON!]!
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

  input AutoImprovePolicyInput {
    enabled: Boolean!
    superviserWorkflowId: String
    monitorIntervalMs: Int
    stallTimeoutMs: Int
    maxSupervisedAttempts: Int
    maxWorkflowPatches: Int
    workflowMutationMode: String
    allowTargetedRerun: Boolean
  }

  input ExecuteWorkflowInput {
    workflowName: String!
    runtimeVariables: JSON
    nodePatch: JSON
    autoImprove: AutoImprovePolicyInput
    nestedSuperviser: Boolean
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
    executablePreflight: Boolean
    nodePatch: JSON
  }

  input ResumeWorkflowExecutionInput {
    workflowExecutionId: String!
    autoImprove: AutoImprovePolicyInput
    nestedSuperviser: Boolean
    workingDirectory: String
    dryRun: Boolean
    maxSteps: Int
    maxLoopIterations: Int
    defaultTimeoutMs: Int
  }

  input RerunWorkflowExecutionInput {
    workflowExecutionId: String!
    stepId: String!
    autoImprove: AutoImprovePolicyInput
    runtimeVariables: JSON
    workingDirectory: String
    dryRun: Boolean
    maxSteps: Int
    maxLoopIterations: Int
    defaultTimeoutMs: Int
  }

  input ContinueWorkflowExecutionInput {
    sourceWorkflowExecutionId: String!
    startStepId: String!
    afterStepRunId: String!
    autoImprove: AutoImprovePolicyInput
    nestedSuperviser: Boolean
    runtimeVariables: JSON
    workingDirectory: String
    dryRun: Boolean
    maxSteps: Int
    maxLoopIterations: Int
    defaultTimeoutMs: Int
    mockScenario: JSON
  }

  input CancelWorkflowExecutionInput {
    workflowExecutionId: String!
  }

  input EventSupervisorCommandInput {
    commandId: String!
    sourceId: String!
    bindingId: String!
    correlationKey: String!
    action: String!
    targetWorkflowName: String!
    supervisedRunId: String
    targetWorkflowExecutionId: String
    runtimeVariables: JSON
    reason: String
    receivedEventReceiptId: String!
  }

  input DispatchSupervisedWorkflowCommandInput {
    command: EventSupervisorCommandInput!
    binding: JSON!
    runtimeVariables: JSON
    mockScenario: JSON
    dryRun: Boolean
    maxSteps: Int
    maxLoopIterations: Int
    defaultTimeoutMs: Int
  }

  input SupervisedWorkflowLookupGraphqlInput {
    runnerPoolRunId: String
    supervisedRunId: String
    workflowExecutionId: String
    workflowKey: String
    alias: String
    sourceId: String
    bindingId: String
    correlationKey: String
    idempotencyKey: String
  }

  input DispatchSupervisorChatInput {
    sourceId: String!
    text: String!
    conversationId: String
    threadId: String
    eventId: String
    eventType: String
    provider: String
    idempotencyKey: String
  }

  input DispatchSupervisorConversationInput {
    binding: JSON!
    event: JSON!
    supervisorProfileId: String!
    correlationKey: String!
    sourceMessageId: String!
    mockScenario: JSON
    dryRun: Boolean
    maxSteps: Int
    maxLoopIterations: Int
    defaultTimeoutMs: Int
  }

  input SupervisorDispatchConversationLookupInput {
    supervisorConversationId: String!
  }

  input SendManagerMessageInput {
    workflowId: String!
    workflowExecutionId: String!
    message: String
    actions: JSON
    attachments: JSON
    idempotencyKey: String
    managerSessionId: String
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
    workflowCatalogOverview(
      workflowScope: String
      status: String
      limit: Int
    ): WorkflowCatalogOverviewPayload!
    workflowStatusOverview(
      workflowName: String!
      workflowScope: String
      limit: Int
    ): WorkflowStatusOverviewPayload
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
    supervisedWorkflowRun(
      input: SupervisedWorkflowLookupGraphqlInput!
    ): SupervisedWorkflowGraphqlPayload!
    supervisorDispatchConversation(
      input: SupervisorDispatchConversationLookupInput!
    ): SupervisorDispatchConversationPayload!
    workflowExecutionStepRuns(
      workflowExecutionId: String!
      stepId: String
      status: String
    ): WorkflowExecutionStepRunsPayload!
  }

  type Mutation {
    createWorkflowDefinition(input: CreateWorkflowDefinitionInput!): WorkflowDefinitionView!
    saveWorkflowDefinition(input: SaveWorkflowDefinitionInput!): SaveWorkflowDefinitionPayload!
    validateWorkflowDefinition(input: ValidateWorkflowDefinitionInput!): ValidateWorkflowDefinitionPayload!
    executeWorkflow(input: ExecuteWorkflowInput!): ExecuteWorkflowPayload!
    resumeWorkflowExecution(input: ResumeWorkflowExecutionInput!): ResumeWorkflowExecutionPayload!
    rerunWorkflowExecution(input: RerunWorkflowExecutionInput!): RerunWorkflowExecutionPayload!
    continueWorkflowExecution(
      input: ContinueWorkflowExecutionInput!
    ): ContinueWorkflowExecutionPayload!
    sendManagerMessage(input: SendManagerMessageInput!): SendManagerMessagePayload!
    retryCommunicationDelivery(input: RetryCommunicationDeliveryInput!): RetryCommunicationDeliveryPayload!
    replayCommunication(input: ReplayCommunicationInput!): ReplayCommunicationPayload!
    cancelWorkflowExecution(input: CancelWorkflowExecutionInput!): CancelWorkflowExecutionPayload!
    dispatchSupervisedWorkflowCommand(
      input: DispatchSupervisedWorkflowCommandInput!
    ): SupervisedWorkflowGraphqlPayload!
    dispatchSupervisorChat(
      input: DispatchSupervisorChatInput!
    ): DispatchSupervisorChatPayload!
    dispatchSupervisorConversation(
      input: DispatchSupervisorConversationInput!
    ): DispatchSupervisorConversationPayload!
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

export function createJsonScalar(): GraphQLScalarType {
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
