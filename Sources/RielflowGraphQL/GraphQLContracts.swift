import Foundation
import RielflowCore

public struct GraphQLStepExecutionDTO: Codable, Equatable, Sendable {
  public var executionId: String
  public var stepId: String
  public var nodeId: String
  public var attempt: Int
  public var backend: String?
  public var status: String
  public var failureReason: String?

  public init(
    executionId: String,
    stepId: String,
    nodeId: String,
    attempt: Int,
    backend: String? = nil,
    status: String,
    failureReason: String? = nil
  ) {
    self.executionId = executionId
    self.stepId = stepId
    self.nodeId = nodeId
    self.attempt = attempt
    self.backend = backend
    self.status = status
    self.failureReason = failureReason
  }
}

public struct GraphQLCommunicationDTO: Codable, Equatable, Sendable {
  public var communicationId: String
  public var fromStepId: String?
  public var toStepId: String?
  public var lifecycleStatus: String
  public var deliveryKind: String
  public var createdOrder: Int

  public init(
    communicationId: String,
    fromStepId: String?,
    toStepId: String?,
    lifecycleStatus: String,
    deliveryKind: String,
    createdOrder: Int
  ) {
    self.communicationId = communicationId
    self.fromStepId = fromStepId
    self.toStepId = toStepId
    self.lifecycleStatus = lifecycleStatus
    self.deliveryKind = deliveryKind
    self.createdOrder = createdOrder
  }
}

public struct GraphQLHookEventDTO: Codable, Equatable, Sendable {
  public var vendor: String
  public var eventName: String
  public var agentSessionId: String
  public var payloadHash: String?

  public init(vendor: String, eventName: String, agentSessionId: String, payloadHash: String? = nil) {
    self.vendor = vendor
    self.eventName = eventName
    self.agentSessionId = agentSessionId
    self.payloadHash = payloadHash
  }
}

public struct GraphQLEventReceiptDTO: Codable, Equatable, Sendable {
  public var sourceId: String
  public var eventId: String
  public var status: String

  public init(sourceId: String, eventId: String, status: String) {
    self.sourceId = sourceId
    self.eventId = eventId
    self.status = status
  }
}

public struct GraphQLReplyDispatchDTO: Codable, Equatable, Sendable {
  public var sourceId: String
  public var provider: String
  public var payload: JSONObject

  public init(sourceId: String, provider: String, payload: JSONObject) {
    self.sourceId = sourceId
    self.provider = provider
    self.payload = payload
  }
}

public struct GraphQLLogEntryDTO: Codable, Equatable, Sendable {
  public var level: String
  public var message: String

  public init(level: String, message: String) {
    self.level = level
    self.message = message
  }
}

public struct GraphQLLLMSessionMessageDTO: Codable, Equatable, Sendable {
  public var role: String
  public var content: String

  public init(role: String, content: String) {
    self.role = role
    self.content = content
  }
}

public struct GraphQLWorkflowSessionDTO: Codable, Equatable, Sendable {
  public var workflowId: String
  public var sessionId: String
  public var status: String
  public var currentStepId: String?
  public var stepExecutions: [GraphQLStepExecutionDTO]
  public var communications: [GraphQLCommunicationDTO]
  public var hookEvents: [GraphQLHookEventDTO]
  public var eventReceipts: [GraphQLEventReceiptDTO]
  public var replyDispatches: [GraphQLReplyDispatchDTO]
  public var logs: [GraphQLLogEntryDTO]
  public var llmSessionMessages: [GraphQLLLMSessionMessageDTO]

  public init(
    workflowId: String,
    sessionId: String,
    status: String,
    currentStepId: String? = nil,
    stepExecutions: [GraphQLStepExecutionDTO] = [],
    communications: [GraphQLCommunicationDTO] = [],
    hookEvents: [GraphQLHookEventDTO] = [],
    eventReceipts: [GraphQLEventReceiptDTO] = [],
    replyDispatches: [GraphQLReplyDispatchDTO] = [],
    logs: [GraphQLLogEntryDTO] = [],
    llmSessionMessages: [GraphQLLLMSessionMessageDTO] = []
  ) {
    self.workflowId = workflowId
    self.sessionId = sessionId
    self.status = status
    self.currentStepId = currentStepId
    self.stepExecutions = stepExecutions
    self.communications = communications
    self.hookEvents = hookEvents
    self.eventReceipts = eventReceipts
    self.replyDispatches = replyDispatches
    self.logs = logs
    self.llmSessionMessages = llmSessionMessages
  }
}

public struct GraphQLInspectSessionRequest: Codable, Equatable, Sendable {
  public var workflowId: String
  public var sessionId: String

  public init(workflowId: String, sessionId: String) {
    self.workflowId = workflowId
    self.sessionId = sessionId
  }
}

public struct GraphQLContinueSessionRequest: Codable, Equatable, Sendable {
  public var workflowId: String
  public var sessionId: String
  public var input: JSONObject

  public init(workflowId: String, sessionId: String, input: JSONObject = [:]) {
    self.workflowId = workflowId
    self.sessionId = sessionId
    self.input = input
  }
}

public struct GraphQLManagerSessionLookupRequest: Codable, Equatable, Sendable {
  public var managerSessionId: String?

  public init(managerSessionId: String? = nil) {
    self.managerSessionId = managerSessionId
  }
}

public struct GraphQLSendManagerMessageRequest: Codable, Equatable, Sendable {
  public var workflowId: String
  public var workflowExecutionId: String
  public var message: String?
  public var actions: JSONValue?
  public var attachments: JSONValue?
  public var idempotencyKey: String?
  public var managerSessionId: String?
  public var managerNodeExecId: String?

  public init(
    workflowId: String,
    workflowExecutionId: String,
    message: String? = nil,
    actions: JSONValue? = nil,
    attachments: JSONValue? = nil,
    idempotencyKey: String? = nil,
    managerSessionId: String? = nil,
    managerNodeExecId: String? = nil
  ) {
    self.workflowId = workflowId
    self.workflowExecutionId = workflowExecutionId
    self.message = message
    self.actions = actions
    self.attachments = attachments
    self.idempotencyKey = idempotencyKey
    self.managerSessionId = managerSessionId
    self.managerNodeExecId = managerNodeExecId
  }
}

public struct GraphQLReplayCommunicationRequest: Codable, Equatable, Sendable {
  public var workflowId: String
  public var workflowExecutionId: String
  public var communicationId: String
  public var reason: String?
  public var idempotencyKey: String?
  public var managerSessionId: String?

  public init(
    workflowId: String,
    workflowExecutionId: String,
    communicationId: String,
    reason: String? = nil,
    idempotencyKey: String? = nil,
    managerSessionId: String? = nil
  ) {
    self.workflowId = workflowId
    self.workflowExecutionId = workflowExecutionId
    self.communicationId = communicationId
    self.reason = reason
    self.idempotencyKey = idempotencyKey
    self.managerSessionId = managerSessionId
  }
}

public typealias GraphQLRetryCommunicationDeliveryRequest = GraphQLReplayCommunicationRequest

public struct GraphQLManagerIntentSummaryDTO: Codable, Equatable, Sendable {
  public var kind: String
  public var targetId: String?
  public var reason: String?

  public init(kind: String, targetId: String? = nil, reason: String? = nil) {
    self.kind = kind
    self.targetId = targetId
    self.reason = reason
  }
}

public struct GraphQLManagerSessionViewDTO: Codable, Equatable, Sendable {
  public var session: JSONValue
  public var messages: JSONValue

  public init(session: JSONValue, messages: JSONValue) {
    self.session = session
    self.messages = messages
  }
}

public struct GraphQLSendManagerMessagePayload: Codable, Equatable, Sendable {
  public var accepted: Bool
  public var managerMessageId: String
  public var parsedIntent: [GraphQLManagerIntentSummaryDTO]
  public var createdCommunicationIds: [String]
  public var queuedNodeIds: [String]
  public var rejectionReason: String?
  public var workflowId: String
  public var workflowExecutionId: String
  public var managerSessionId: String

  public init(
    accepted: Bool,
    managerMessageId: String,
    parsedIntent: [GraphQLManagerIntentSummaryDTO],
    createdCommunicationIds: [String],
    queuedNodeIds: [String],
    rejectionReason: String? = nil,
    workflowId: String,
    workflowExecutionId: String,
    managerSessionId: String
  ) {
    self.accepted = accepted
    self.managerMessageId = managerMessageId
    self.parsedIntent = parsedIntent
    self.createdCommunicationIds = createdCommunicationIds
    self.queuedNodeIds = queuedNodeIds
    self.rejectionReason = rejectionReason
    self.workflowId = workflowId
    self.workflowExecutionId = workflowExecutionId
    self.managerSessionId = managerSessionId
  }
}

public struct GraphQLReplayCommunicationPayload: Codable, Equatable, Sendable {
  public var sourceCommunicationId: String
  public var workflowExecutionId: String
  public var replayedCommunicationId: String
  public var status: String

  public init(
    sourceCommunicationId: String,
    workflowExecutionId: String,
    replayedCommunicationId: String,
    status: String
  ) {
    self.sourceCommunicationId = sourceCommunicationId
    self.workflowExecutionId = workflowExecutionId
    self.replayedCommunicationId = replayedCommunicationId
    self.status = status
  }
}

public struct GraphQLRetryCommunicationDeliveryPayload: Codable, Equatable, Sendable {
  public var communicationId: String
  public var activeDeliveryAttemptId: String
  public var status: String

  public init(communicationId: String, activeDeliveryAttemptId: String, status: String) {
    self.communicationId = communicationId
    self.activeDeliveryAttemptId = activeDeliveryAttemptId
    self.status = status
  }
}

public struct GraphQLControlPlaneResult: Codable, Equatable, Sendable {
  public var accepted: Bool
  public var status: String
  public var diagnostics: [String]

  public init(accepted: Bool, status: String, diagnostics: [String] = []) {
    self.accepted = accepted
    self.status = status
    self.diagnostics = diagnostics
  }
}

public struct GraphQLInspectSessionResult: Codable, Equatable, Sendable {
  public var result: GraphQLControlPlaneResult
  public var session: GraphQLWorkflowSessionDTO?

  public init(result: GraphQLControlPlaneResult, session: GraphQLWorkflowSessionDTO? = nil) {
    self.result = result
    self.session = session
  }
}

public protocol GraphQLControlPlaneServicing: Sendable {
  func inspectSession(_ request: GraphQLInspectSessionRequest) async -> GraphQLInspectSessionResult
  func continueSession(_ request: GraphQLContinueSessionRequest) async -> GraphQLControlPlaneResult
  func managerSession(_ request: GraphQLManagerSessionLookupRequest) async -> GraphQLManagerSessionViewDTO?
  func sendManagerMessage(_ request: GraphQLSendManagerMessageRequest) async -> GraphQLSendManagerMessagePayload
  func replayCommunication(_ request: GraphQLReplayCommunicationRequest) async -> GraphQLReplayCommunicationPayload
  func retryCommunicationDelivery(_ request: GraphQLRetryCommunicationDeliveryRequest) async -> GraphQLRetryCommunicationDeliveryPayload
}

public enum GraphQLContractProjector {
  public static let schemaContract = """
  scalar JSON
  scalar JSONObject
  type ControlPlaneResult { accepted: Boolean!, status: String!, diagnostics: [String!]! }
  type ManagerIntentSummary { kind: String!, targetId: String, reason: String }
  type ManagerSessionView { session: JSON!, messages: JSON! }
  type SendManagerMessagePayload { accepted: Boolean!, managerMessageId: String!, parsedIntent: [ManagerIntentSummary!]!, createdCommunicationIds: [String!]!, queuedNodeIds: [String!]!, rejectionReason: String, workflowId: String!, workflowExecutionId: String!, managerSessionId: String! }
  type ReplayCommunicationPayload { sourceCommunicationId: String!, workflowExecutionId: String!, replayedCommunicationId: String!, status: String! }
  type RetryCommunicationDeliveryPayload { communicationId: String!, activeDeliveryAttemptId: String!, status: String! }
  type WorkflowSession { workflowId: String!, sessionId: String!, status: String!, currentStepId: String, stepExecutions: [StepExecution!]!, communications: [Communication!]!, hookEvents: [HookEvent!]!, eventReceipts: [EventReceipt!]!, replyDispatches: [ReplyDispatch!]!, logs: [LogEntry!]!, llmSessionMessages: [LLMSessionMessage!]! }
  type StepExecution { executionId: String!, stepId: String!, nodeId: String!, attempt: Int!, backend: String, status: String!, failureReason: String }
  type Communication { communicationId: String!, fromStepId: String, toStepId: String, lifecycleStatus: String!, deliveryKind: String!, createdOrder: Int! }
  type HookEvent { vendor: String!, eventName: String!, agentSessionId: String!, payloadHash: String }
  type EventReceipt { sourceId: String!, eventId: String!, status: String! }
  type ReplyDispatch { sourceId: String!, provider: String!, payload: JSONObject! }
  type LogEntry { level: String!, message: String! }
  type LLMSessionMessage { role: String!, content: String! }
  input ContinueSessionInput { workflowId: String!, sessionId: String!, input: JSONObject! }
  input SendManagerMessageInput { workflowId: String!, workflowExecutionId: String!, message: String, actions: JSON, attachments: JSON, idempotencyKey: String, managerSessionId: String, managerNodeExecId: String }
  input ReplayCommunicationInput { workflowId: String!, workflowExecutionId: String!, communicationId: String!, reason: String, idempotencyKey: String, managerSessionId: String }
  input RetryCommunicationDeliveryInput { workflowId: String!, workflowExecutionId: String!, communicationId: String!, reason: String, idempotencyKey: String, managerSessionId: String }
  type Query { workflowSession(workflowId: String!, sessionId: String!): WorkflowSession managerSession(managerSessionId: String): ManagerSessionView }
  type Mutation { continueSession(input: ContinueSessionInput!): ControlPlaneResult! sendManagerMessage(input: SendManagerMessageInput!): SendManagerMessagePayload! replayCommunication(input: ReplayCommunicationInput!): ReplayCommunicationPayload! retryCommunicationDelivery(input: RetryCommunicationDeliveryInput!): RetryCommunicationDeliveryPayload! }
  """

  public static func project(
    session: WorkflowSession,
    communications: [WorkflowMessageRecord] = [],
    hookEvents: [GraphQLHookEventDTO] = [],
    eventReceipts: [GraphQLEventReceiptDTO] = [],
    replyDispatches: [GraphQLReplyDispatchDTO] = [],
    logs: [GraphQLLogEntryDTO] = [],
    llmSessionMessages: [GraphQLLLMSessionMessageDTO] = []
  ) -> GraphQLWorkflowSessionDTO {
    .init(
      workflowId: session.workflowId,
      sessionId: session.sessionId,
      status: session.status.rawValue,
      currentStepId: session.currentStepId,
      stepExecutions: session.executions.map {
        .init(
          executionId: $0.executionId,
          stepId: $0.stepId,
          nodeId: $0.nodeId,
          attempt: $0.attempt,
          backend: $0.backend?.rawValue,
          status: $0.status.rawValue,
          failureReason: $0.failureReason
        )
      },
      communications: communications.map {
        .init(
          communicationId: $0.communicationId,
          fromStepId: $0.fromStepId,
          toStepId: $0.toStepId,
          lifecycleStatus: $0.lifecycleStatus.rawValue,
          deliveryKind: $0.deliveryKind.rawValue,
          createdOrder: $0.createdOrder
        )
      },
      hookEvents: hookEvents,
      eventReceipts: eventReceipts,
      replyDispatches: replyDispatches,
      logs: logs,
      llmSessionMessages: llmSessionMessages
    )
  }
}
